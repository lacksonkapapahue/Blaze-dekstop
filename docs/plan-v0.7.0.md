# v0.7.0: Bundled skill library and proactive memory & skills

## Part A: the skill library

- **Pack**: `skills/<name>/SKILL.md` (+ optional `skills/<name>/assets/*`) at the repo root,
  embedded with `//go:embed all:skills` (`learn_app.go`). `skills/index.json` is a generated
  table of contents (name, description, tags, version, sha256 of SKILL.md, files); the
  `internal/skillpack` test fails when it is stale (`UPDATE_SKILL_INDEX=1 go test ./internal/skillpack/`).
- **SKILL.md**: YAML front matter (`name` = folder name, kebab-case; `description` = what + when;
  `tags: [a, b]`; `version: <int>`), then a Markdown body of steps, checklists and templates.
  Assets are referenced by relative path from the body.
- **Seeding** (`internal/skillpack.Seed`, run on start): the skills folder stays the source of
  truth (shared with the CLI and the Android app) and the SQLite skills index follows it. State
  lives in `~/.blaze/skills/.bundled.json` so every app sharing the folder agrees:
  - missing and never seeded → written;
  - on disk and byte-identical (after CRLF→LF) to what Blaze last wrote, pack version ≥ recorded → upgraded;
  - on disk but changed (by the user or by Blaze's `write_skill`) → kept, shown as *Edited*, with
    *Update* when the pack has a newer version (Reset takes it);
  - seeded before and now gone → recorded as deleted, never re-seeded (Restore brings it back);
  - a user's own skill with a bundled name → theirs wins;
  - an older pack (an older CLI) never downgrades.
- **Disable**: `disabled` list in the manifest; disabled skills stay on disk and in Settings but are
  left out of the prompt's SKILLS block.
- **Settings › Skills** (`frontend/dist/learn.js`): filter, state badge (Bundled · vN / Edited / Yours /
  Removed), tags, View (SKILL.md preview), Reset, Delete, Restore, on/off switch.
- 19 skills: web-design-teamofkeys (+ tokens.css, starter.html; studied from teamofkeys.com's CSS
  and JS), web-design-blaze-classic (+ tokens.css, starter.html; from blazeinchue.netlify.app),
  landing-page-builder (+ template.html), slide-deck (+ deck.html), document-writing,
  deep-research, code-review, debugging, git-pr-workflow, writing-tests, refactoring,
  data-analysis, shell-sysadmin, email-drafting, planning-task-breakdown, image-assets, web-audit,
  api-integration, skill-creator.

## Part B: proactive memory & skills

- **Prompt** (`internal/learn.Rules`): save durable facts silently with context and the user's
  certainty, never secrets or one-off details; replace stale memories (`remember(fact, replaces="#id")`);
  forget on request; write a skill when a multi-step workflow repeats or the user teaches a method;
  rewrite a skill when a better way is found; one short line to the user when a skill changes.
- **Runtime nudges**: `remember` returns similar saved memories (word overlap 0.34-0.85) so the
  model can forget or replace the stale one; `remember` takes `replaces`; `write_skill` takes
  `tags`, creates or rewrites, bumps `version`, and tells the model to mention it in one line.
- **End-of-turn reflection** (`learn_app.go`): `learn.Decide` is a local check with no model call.
  It skips small talk and turns that already saved; it reflects when the user stated a fact or
  preference (cue phrases), taught a method, or repeated a multi-step workflow (Jaccard ≥ 0.5 of
  tool set + key words against the last 40 workflows, kept in `meta.learn_workflows`). The call is
  `llm.Quick` (cheapest healthy model, free first, 25 s timeout), at most once a minute, never past
  the daily spend cap. Its JSON answer is filtered by `learn.Accept` (no secrets/card numbers, no
  "today"/"right now" facts, no task logs, 3-45 words) and `learn.GoodSkill`; at most 2 memories;
  a background reflection never overwrites an existing skill.
- **UI**: every memory/skill change emits a `learned` event: a square mark under the answer
  (click → Memory or Settings › Skills) and a toast for skills, automatic saves or when the chat
  isn't visible. **Settings › Behaviour › Learning**: "Learn automatically" (default on) and "Show
  what Blaze learns" (default on), stored in `desktop.json` `learn: {off, no_marks}`.

## Tests

`internal/skillpack` (seed idempotent, upgrade untouched, never overwrite edits, deleted stays
deleted, user skill wins, CRLF, disable, real-pack lint + index), `internal/learn` (trivial turns,
Decide table, workflow repeats, Accept filter, Parse), `internal/tools` (seed into folder and
index, prompt filtering of disabled skills, delete/restore, write_skill events and edit
protection, remember replaces + nudge, forget events), `internal/store` (Related), main
(`TestEmbeddedPackLoads`, `TestTurnSlice`).

## Porting (CLI, Android)

The pack is plain files: copy `skills/` (the CLI embeds a synced copy, `scripts/sync-skills.sh`).
Android: ship `skills/` as assets, read `index.json` to enumerate, seed into the shared skills
folder with the same manifest rules (`.bundled.json`: `{format, bundled: {name: {version, sha256}},
deleted: [], disabled: []}`, sha256 over SKILL.md with LF line endings).
