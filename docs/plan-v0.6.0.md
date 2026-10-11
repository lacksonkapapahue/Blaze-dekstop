# v0.6.0: Orchestrator + specialists

The main agent works like a lead with specialists. v0.4.7/v0.5.0 already had background
agents (dispatch, list, message, cancel, resume; `internal/agents`). Specialists are
built on that engine, not beside it: a specialist is an `agents.Agent` with
`Kind == "specialist"`, so it shares the queue and concurrency cap, Stop / Resume,
steering, approvals on its own row, the result wake-up (Mainline) and persistence.

## Lead tools (`internal/agents/specialists.go`)

| Tool | What it does |
| --- | --- |
| `dispatch_specialist(name, brief, workdir, mode)` | Starts or queues a specialist. `mode` build (default) or plan; `workdir` defaults to the current folder. Returns at once; the lead dispatches every independent piece in one reply, then ends its turn. |
| `check_specialist(name, diff)` | Status, steps, elapsed, last action, its short plan (the "Plan:" line of its first reply), where it works; once finished, the files it changed. `diff: true` adds the diff (12 KB cap). Empty name = all of this chat's specialists. |
| `message_specialist(name, message)` | Steering; reaches it at its next step. |
| `cancel_specialist(name)` | Stops it; its copy stays until applied or discarded. |
| `apply_specialist(name, apply / discard)` | After review: apply brings the changes into the original folder; discard removes the copy (and branch). |

The result arrives automatically as a `[Background agent result …]` platform message; for
specialists it adds the changed files and tells the lead to review before applying, and
to wait (one short progress line) while others still run, summarising once all are in.

## Isolation (`internal/agents/isolate.go`)

- **Git repo** (any folder inside a work tree with a commit): `git worktree add -b
  blaze/<name> ~/.blaze/desktop/worktrees/<name>-<rand> HEAD`. A subfolder workdir maps
  to the same subfolder in the worktree. Parallel specialists get distinct branches.
  If the original had uncommitted changes, `check_specialist` notes that the worktree
  started from the last commit.
- **Not a repo**: a copy of the folder (skips `.git`, `node_modules`, `.venv`, `venv`,
  `__pycache__`, `.next`, `.cache`, `.gradle`), with a SHA-1 manifest. Over 20k files or
  400 MB it refuses and suggests `git init` (worktrees are free).
- **Review**: `Changes()` = `git add -A` + `git diff --cached <base>` in the worktree, or a
  manifest comparison (+ `git diff --no-index` per file when git exists) for copies.
- **Apply**: worktree changes are committed on the branch, then `git apply` (falling back
  to `--3way`) onto the original working tree as uncommitted changes, so the user's
  branch never moves; the worktree and branch are removed. Copies: changed files copied
  back, but a file the user changed since the copy is skipped and reported.
- Discarding a specialist (or pruning it after 7 days) removes its copy; a copy that
  still waits for review is never pruned.
- Specialists with their own copy are refused (`file_write/edit/delete`) on absolute
  paths in the original folder; relative paths resolve in their copy (env root).

## Permissions: never more than the lead

- **Mode**: requested mode is capped at the lead's at dispatch (a Plan lead gets Plan
  specialists), and at every tool call: while the lead is in Plan, every agent's tool
  list is filtered to the read/scout set and other calls are refused (`agentBlock`).
  A Plan lead may dispatch/check/steer/cancel specialists; `apply_specialist` needs Build.
- **Approvals**: specialists use the same gate as background agents (Auto: confirm card
  on its row; Autopilot: approved except the catastrophic blocklist).
- **Budgets**: a specialist's `MaxSteps` is the lead's budget at dispatch (Autopilot's
  150 when on); `Runtime.Guard` stops any agent once the daily spend cap is reached and
  a specialist past Autopilot's time budget.
- Specialists can't start or steer other agents.

## System prompt

`agents.Orchestration` (added after `Delegation`): delegate independent, parallel,
real-sized pieces (2-4 specialists, never two on one file, self-contained briefs);
do small or sequential work yourself; review each result's diff before applying;
summarise once all are in. `agents.SpecSystem` tells the specialist where its copy is,
its mode, to start with "Plan:", stay in its brief and finish with a report.

## UI (`frontend/dist/specialists.{js,css}`)

A compact strip docked above the composer (folds to its header): `SPECIALISTS · 2
running · 1 to review`, one 32 px row per specialist with a mini particle orb (the
same sprite as the chat marks; animates only while running and on screen, frozen with
prefers-reduced-motion), mono name, task, `BUILD · WORKTREE` tag, state, elapsed and
Stop. A second line shows its current step in plain words. Expanding shows its plan,
where it works, the log (same step rows as the chat), its report, the changed files
and Apply / Discard (`SpecialistReview`) when it waits for review. Approvals and
questions from a specialist open on its row. Background agents keep their cards; the
orb's indicator counts both.

## Tests

- `internal/agents/specialists_test.go`: worktree isolation + apply (original untouched
  until apply, user's branch doesn't move, cleanup removes worktree and branch),
  subfolder workdirs and parallel branches, copy isolation with conflict protection,
  full lifecycle (cap + queue, separate worktrees, check with plan, steer, cancel frees
  a slot, result message, diff review, apply, double-apply refused, discard), Plan cap
  and step-budget inheritance, the spend-cap guard.
- `specialists_test.go` (main): Plan/Build enforcement for specialists and background
  agents, writes into the original folder refused, Plan lead may brief but not apply.
- CI shots: `orch-running`, `orch-expanded`, `orch-review` (light + dark).
