# Student pack (v0.15.0)

Plan part C of `plan-v1.0-redesign.md`. For Luke and other students: classes, assignments, revision and group work, on a free tier and on mobile data.

## What shipped
1. **Classroom** (`internal/connect/classroom.go`): `classroom_courses` and `classroom_coursework` through the existing Google connector (group `classroom`). Read only. Scopes `classroom.courses.readonly` + `classroom.coursework.me.readonly` are **on demand** (`Tool.OnDemand`): a plain Google sign-in never asks for them; the first Classroom call shows the Grant access button. Coursework lists due dates in local time (Classroom stores UTC), points and submission state.
   - One-click Google (blaze-auth broker, Cloud project blaze-511220, Testing mode): add the two Classroom scopes and enable the Classroom API there (manual step for Luke). Own-client Google: enable Google Classroom API (the connector's steps say so).
2. **Schedule `once YYYY-MM-DD HH:MM`** (`internal/sched`): one-time reminders (cron `M H D Mo *`, schtasks `/SC ONCE`); `run-job` removes a once-job after it runs.
3. **Skills** (shared `skills/` pack, Android reuses the files): study-planner, tutor, lecture-notes, essay-coach, group-project, classroom-sync. 34 bundled skills now.
4. **Flashcards + Learn view**: `internal/flashcards` (SM-2, `~/.blaze/flashcards.json`), tools `flashcards_add` / `flashcards_due` / `flashcards_review`, Learn view in `learn.js` (`/learn`, `/views › Learn`): decks with due counts, Show answer, Again/Hard/Good/Easy.
5. **Low-data mode** (Settings › Behaviour › Data): prompt line (text first, no screenshots/images/big downloads), `see_screen` hidden, MB per task in the work card (request + reply bytes per model call).

## Tests
`internal/connect/classroom_test.go` (on-demand scopes, consent, courses, coursework filtering + states), `internal/flashcards` (SM-2), `internal/sched/sched_test.go` (once), `student_app_test.go` (low-data tools + prompt + bytes, flashcard tools), skillpack index. Shots: student-learn, student-card, student-lowdata.
