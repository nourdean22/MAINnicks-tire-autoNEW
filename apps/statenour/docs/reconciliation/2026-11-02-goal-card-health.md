> ## 2026-11-02 · Goal card health, since-last-check-in, Nick-drafted check-in, Home check-in due (job 2026-11-02-nour-os-interconnect, wave W2) · 1 ship
>
> Branch `statenour/goal-card-health`, cut from `92e6ca5865` (PR 3521, the W1 spine). Plan: `docs/plans/nour-os-interconnect/01-connectivity-map-and-benchmark.md` sections 3 (gaps 3, 6), 4.1 (L2-L5), 4.3 (T1).
>
> **What shipped**
>
> | Piece | Where | Rule |
> |---|---|---|
> | Health from the newest check-in | `lib/brain/goal-pace.ts` (`CHECK_IN_CADENCE_DAYS`, `goalHealthFrom`), `lib/services/goals.ts getGoals` | gray past the cadence (DAY 1, WEEK 7, MONTH 30, QUARTER 90, YEAR 180; LIFE/none = YEAR); failed read = `unknown` |
> | One check-in writer | `lib/services/goal-checkin.ts logGoalCheckIn` | Nick's `logGoalCheckIn` tool delegates; matched by id only; one per goal per ET day |
> | Since last check-in | `goalSinceCheckIn` + `SinceCheckInView` | spine read, 8 rows, a failed source is "couldn't read <name>" |
> | Nick-drafted check-in | `draftGoalCheckIn` + `GoalCheckInPanel` | one `fast` call, items fenced as data, sentinel = no draft, number only when it moved |
> | Home check-in due | `lib/home/operator-brief.ts goalCheckInDue`, Goals card line | most overdue goal; `"unknown"` on a failed read |
> | Metric lift fix | `lib/services/tasks.ts liftGoalOnTaskComplete` | `kind=metric` (unitless too) gets no +1; GoalEvent `task_completed` instead |
> | Nick remembers | `lib/home/nick-remembers.ts`, command line | a throw is named in `failed`, never `[]` |
>
> **Decisions**
> - Unitless metric goals keep NO +1. FACT: schema `kind` is metric | milestone | narrative (`prisma/schema.prisma`, "metric (target/unit)"); the brief rules out moving a metric value from anywhere but a check-in or an edit. Milestone and narrative goals keep the +1.
> - New tRPC procedures: three, not one (`goalSinceCheckIn`, `draftGoalCheckIn`, `goalCheckIn`): the list needs a read and the save needs a mutation. No Nick tool added; `tests/ai/tool-schemas.snapshot.json` unchanged.
> - Second reader (pr-review-toolkit; Codex usage-limited): an unavailable draft no longer keeps yesterday's words in the form; the brief's failed goals read and the "Nick remembers" read are logged and named in `failedSources` / `failed`; `goalSinceCheckIn` says "goal not found" apart from a failed read.
>
> **Live checks owed**
> - 2026-11-09: one check-in saved from the card shows as a GoalEvent `check_in` with `source = goal-card`; Home shows the due row.
> - 2026-11-23 (kill criterion L2): every goal still gray for 3 weeks means Nour is not checking in; drop the row.
>
> **Flagged · NOT fixed**
> - `lib/services/tasks.ts:1612` lift marker `.catch(() => false)` treats any DB error as already lifted (pre-existing).
> - Nick's `getGoals` tool computes health without the cadence (a stale check-in reads current to Nick, gray on the card); a finished metric task can appear twice in the since-list (`task_completed` + TaskEvent).
> - The Home "Check-in due" row has no e2e assertion; the /home snapshot PNGs did not change.
