# One mind (v0.16.0)

Luke's top priority for 1.0: Blaze has **one continuous conversation** instead of separate chats, and a memory that is the source of truth for what it knows. Projects keep their own threads. Blaze Android mirrors the schema and the shared prompt text below, word for word.

## What the user sees
- **One conversation.** In Chat mode the sidebar shows *Blaze* (the main thread, conversation id `main`) and *Archive*. No "New chat" outside projects. `/clear` opens a fresh context window on the same thread; nothing is deleted.
- **Projects keep their own threads** exactly as before (per-project chat list, New chat, Brief).
- **Archive** (`/views › Archive`, sidebar): every chat from before one mind, read-only. Their words are also in the journal, so `search_chat` / `read_turn` find them.
- **Memory graph** shows the memories table.
- **Settings › Behaviour › Learning › Review past conversations when idle** (on by default).

## Never lose data
- On first launch `migrateMind` copies every old chat into the journal (`UNIQUE(conv, turn)`, so a re-run never duplicates) and imports blaze.db memories into the memories table. Each step sets a `meta` flag only after it finishes; a failure retries next launch. Chat files are never changed or deleted.
- Memories are mirrored back into blaze.db (`mirror` column) so Blaze CLI keeps seeing them.

## Storage
Own database `~/.blaze/desktop/mind.db` (Blaze CLI owns blaze.db and refuses a newer schema). SQLite with FTS5 (porter unicode61).

```sql
CREATE TABLE IF NOT EXISTS journal(
  id INTEGER PRIMARY KEY,
  conv TEXT NOT NULL,             -- 'main', a project chat id, or an archived chat id
  turn INTEGER NOT NULL,          -- position in that conversation
  role TEXT NOT NULL,             -- user | assistant | tool
  content TEXT NOT NULL,
  at INTEGER NOT NULL,            -- unix seconds
  reviewed INTEGER NOT NULL DEFAULT 0,
  UNIQUE(conv, turn)
);
CREATE INDEX IF NOT EXISTS journal_unreviewed ON journal(reviewed, id);
CREATE VIRTUAL TABLE IF NOT EXISTS journal_fts USING fts5(content, content='journal', content_rowid='id', tokenize='porter unicode61');
CREATE TRIGGER IF NOT EXISTS journal_ai AFTER INSERT ON journal BEGIN
  INSERT INTO journal_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TABLE IF NOT EXISTS memories(
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,             -- profile | preference | person | project | decision | fact
  subject TEXT NOT NULL,          -- who/what it is about: 'Luke', 'HomeGlow', 'food'
  text TEXT NOT NULL,             -- one line, the user's conditions kept; '(inferred)' when inferred
  related TEXT NOT NULL DEFAULT '', -- comma-separated subjects
  source_turn INTEGER NOT NULL DEFAULT 0, -- journal.id it came from (0 = typed or imported)
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  mirror INTEGER NOT NULL DEFAULT 0 -- blaze.db memories.id kept in step for Blaze CLI
);
CREATE INDEX IF NOT EXISTS memories_subject ON memories(kind, subject);
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(subject, text, content='memories', content_rowid='id', tokenize='porter unicode61');
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, subject, text) VALUES (new.id, new.subject, new.text);
END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, subject, text) VALUES ('delete', old.id, old.subject, old.text);
END;
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE OF subject, text ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, subject, text) VALUES ('delete', old.id, old.subject, old.text);
  INSERT INTO memories_fts(rowid, subject, text) VALUES (new.id, new.subject, new.text);
END;
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

### Rules on the memories table
- **Source of truth.** The prompt never holds a second copy except the pinned core.
- **Newest wins / no duplicates.** `Save` looks at rows with the same `kind` and (case-insensitive) `subject`; if the best word-overlap (Jaccard) is ≥ 0.5 it rewrites that row (`updated`), identical text is a no-op; otherwise it inserts.
- **Inferences are marked** with "(inferred)" in `text`.
- Kinds, in pinned-core order: `profile, preference, person, project, decision, fact` (unknown → `fact`).
- **Pinned core** (`Core`, 1600 chars): every profile line (newest 20) then the newest 12 preferences.
- **Subject index** (`Index`, 14 per kind): `person: Gloria (3), Mutale (1)`.

## Tools
- `memory_search(query, kind?)` — FTS over subject + text.
- `memory_save(kind, subject, text, related?)` — goes through `Save` (dedupe, newest wins).
- `memory_update(id, text, kind?, subject?)`.
- `search_chat` now covers the journal (every conversation, archived included); `read_turn` accepts a journal id.

## Save as you go
After each finished turn: journal the turn, then one cheap extraction call (`ExtractPrompt`, last ~6000 chars of the turn, EXISTING = pinned core) and `Save` each line. Background; never blocks the answer.

## Idle review
When Blaze has had no turn for 10 minutes, is not busy, is on mains power (Linux sysfs; unknown = yes) and the CPU is quiet, it reviews one chunk (≤12000 chars) of unreviewed journal turns, at most once per 10 minutes. Same `ExtractPrompt`. A failed model call leaves the turns queued. Toggle: prefs `mind_review` (Settings).

**Model:** the memory passes go through **BlazeRouter `auto/best-free`** (free tiers only, cheapest and healthiest first) while the router runs, else `llm.Quick` (free models first). Never paid quota.

## Context ladder (`mind.Ladder`)
1. **Recent** — history under budget (12k tokens or 60% of the model's context, whichever is smaller): turns word for word.
2. **Summary** — over budget: the long-chat rolling summary + recent turns (v0.13 engine).
3. **Lookup** — when the summary plus the recent tail would pass 90% of the window (or summarising failed): only the pinned core + subject index + the last `LookupTail` = 6 messages (cut at a user message), plus `LookupRule`. The agent looks the rest up.

## Prompt
Every system prompt carries `MindRule` + the `WHAT YOU KNOW` block (pinned core + `MEMORY INDEX`) and nothing else from memory.

### Shared prompt text (Android mirrors these exactly)

`MindRule`:
```
ONE MIND
- This is one continuous conversation with the user; there are no separate chats. What you know lives in the memory table and the journal, not in this prompt.
- WHAT YOU KNOW (below) is only the pinned core and an index of subjects. Before answering anything about the user, their people, projects, plans or past conversations, call memory_search (and search_chat for exact earlier words). Never ask the user to repeat something you could look up.
- Save as you go: memory_save for anything lasting (profile, preference, person, project state, decision, commitment). One line each, the user's own conditions kept exactly ("on weekdays", "for work trips"); write "(inferred)" when you inferred it. memory_update rewrites a line that changed; never keep two versions.
- Never save procedure, one-off values (prices, counts, codes) or secrets.
```

`LookupRule`:
```
CONTEXT RESET: earlier turns are NOT in this prompt. You don't remember them; look them up. Use memory_search for facts, preferences and decisions, and search_chat / read_turn for exact earlier words, before you answer. Don't guess and don't ask the user to repeat.
```

`ExtractPrompt` (after-turn pass and idle review; answer is a JSON array):
```
You maintain the user's memory for Blaze. From the conversation below, list what is worth remembering for months: profile facts (name, school, work, where they live), standing preferences (with every condition the user attached), people in their life and who they are to them, project state, decisions and why, commitments and deadlines.
Skip: procedure, how a tool works, one-off values (prices, counts, order numbers, codes), small talk, secrets and passwords, anything already in EXISTING unless it changed.
Write lines no broader or firmer than the user said. Mark your inferences "(inferred)".
Answer ONLY a JSON array, [] when nothing: [{"kind":"profile|preference|person|project|decision|fact","subject":"who or what it is about","text":"one line","related":"other subjects, comma-separated"}]
```

Block format:
```
WHAT YOU KNOW (pinned core; memory_search for the rest)
- [kind] Subject: text
MEMORY INDEX (subjects you have notes on; look them up)
- person: Gloria (3), Mutale (1)
```

## Code
- `internal/mind/` (mind.go, prompt.go, mind_test.go)
- `mind_app.go` (migration, after-turn pass, idle review, tools, prompt block), `mind_app_test.go`
- `longchat_app.go` (ladder wiring, journal-wide search_chat/read_turn), `app.go` (main thread, Archive, `/clear`), `memgraph.go`
- Frontend: `app.js`, `shell.js`, `views.js`, `learn.js` (toggle), `mind.js` + `mind.css` (Archive)
- Tests: `TestMindMigrationIdempotent`, `TestMindIdleReviewMarksTurns`, `TestMindToolsAndPrompt`, `TestOneThreadAndClear`, `TestLookupTail`, internal/mind tests. Shots: `mind-*`.
