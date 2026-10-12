# Long-chat engine (v0.12.0)

Step 3 of [plan-v1.0-redesign.md](plan-v1.0-redesign.md), part B. Branch `long-chat`.

## Code
- `internal/longchat/db.go`: own SQLite file `~/.blaze/desktop/longchat.db` (not blaze.db: Blaze CLI refuses a newer blaze.db schema). Tables `chat_fts` (FTS5: chat_id, turn_id, role, content), `chat_state` (summary, upto, indexed), `project_brief`.
- `internal/longchat/compact.go`: `Context(hist, &state, budget, summarise)` folds everything before the tail (last 12 messages, moved back to a user message) into the summary when the un-summarised part is over `Budget(ctx)` = min(12k, 60% of context). `Transcript` renders turns for the summariser; `SummarisePrompt` keeps Goal / Decisions / Facts / Open threads / Files touched.
- `internal/longchat/artifacts.go`: `Aside` (results over 4,000 chars to `~/.blaze/artifacts/<sha1-12>.txt`; head 40 + tail 20 lines + `artifact:<id>`), `ReadArtifact`.
- `longchat_app.go`: `longContext` (index new messages, brief, summary; falls back to `trim` on any failure), `asideResult` (skills and the long-chat tools stay whole), `emitTokens` (`tokens` event: in, out, limit, high at 80%), `FreshChat`, `ProjectBrief`/`SetProjectBrief`, tools `search_chat`, `read_turn`, `read_artifact`, `update_brief` (all core).
- `app.go` turn loop: `a.longContext(...)` replaces `trim(s.hist)`; `longChatLine` + brief + summary go into the system prompt; tool results go through `asideResult`; `emitTokens` after each reply; deleting a chat forgets its index.
- `sessions.go`: a chat's env `Conv` is its own id.
- Frontend: live card meter (`liveMeta` reads `turn.tokens`), fresh-chat offer card, project page Brief editor.

## Not in this step
Memory ranking (item 5) already ships via `store.ForPrompt`. Specialist 300-word reports (item 6) are unchanged.
