# v0.5.1: Memories, skills and tools in a local database

Every turn used to paste all of `memory.md`, every skill and every tool schema into
the request. With a few hundred memories and a few dozen tools that is ~10k tokens
per step before the user has said anything. Now a turn pulls only the rows it needs.

## The database

- `internal/store`: `~/.blaze/blaze.db`, pure-Go SQLite (`modernc.org/sqlite`, no
  cgo, so the Windows and macOS cross-builds are unchanged), WAL mode, one
  connection, schema versioned with `PRAGMA user_version`.
- Tables: `memories` (id, text, norm, category, project, chat, created, updated,
  uses, last_used, pinned) + `memories_fts` (FTS5, porter); `skills` + `skills_fts`;
  `tools` + `tools_fts` (rebuilt from the Go registry when it changes);
  `active_tools` (conversation → tools turned on); `meta`.
- Migration: on first open `memory.md` and the v0.5 sidecar `memory.meta.json`
  (created time, project, chat, AI category) are imported and renamed to
  `*.migrated`. Importing is idempotent: if `memory.md` reappears (the CLI or a hand
  edit), the next start imports the new lines and skips the rest.
- Skills: the `~/.blaze/skills/*/SKILL.md` folder (shared with Android and the CLI)
  stays the source of truth; the index follows it by file count and mtime.

## Prompting

- **Memories:** pinned memories, then the top 8 BM25 matches for the last three
  user messages and the last reply, topped up with the most-used ones when little
  matches, capped at ~600 tokens. Each shown memory gets `uses`/`last_used` bumped.
  Each line carries its id (`[#12]`) so `forget` can target it.
- **Tools:** `remember` (deduplicates: identical text is kept once, ≥85% shared
  words updates the existing memory), `recall(query)`, `forget(#id or text)`.
- **Skills:** names + one-line descriptions only; every skill when there are ≤ 8,
  otherwise the 8 best matches. `load_skill(name)` reads one (`use_skill` stays as a
  hidden alias).
- **Tool list:** a core set every step (run_shell, file_*, web_search, fetch_page,
  git, job_log, remember, recall, forget, load_skill, find_tools, notify, plus the
  agent tools, update_blaze and connectors as before). The rest are named in one
  `MORE TOOLS` line; `find_tools(query)` searches the tools index and turns matches
  on for the rest of that conversation (stored per chat / per background agent).
  Calling one by its exact name also works and turns it on.
- Plan mode still filters the list (`recall`, `load_skill`, `find_tools` are
  read-only). Background agents use the same mechanism with their own key; a
  dispatch `tools` scope still narrows an agent to exactly those tools.

## Memory screen

Reads and writes the database (ids are now stable row ids, so editing keeps the
id). New: an "In prompts" line (pinned / used N×), a Pin button, and the search box
adds the database's word-form matches ("deploying" finds "deploys").

## Measured (200 facts, 60 tools)

See the PR: memory ~3.7k → ~0.2k tokens, tools ~6.0k → ~1.8k tokens, ~80% fewer
tokens per step.
