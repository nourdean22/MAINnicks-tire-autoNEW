> ## 2026-11-02 · Nick can see goals by id, attach work to them and read everything related · 1 ship
>
> Nour: "i dont think they talk to each other the goals and the ai and missions and other things". Job 2026-11-02-nour-os-interconnect, wave W1; the plan is `docs/plans/nour-os-interconnect/01-connectivity-map-and-benchmark.md` (in this PR), gap 2 and the 10x option in its section 5.
>
> - **The spine** (`lib/services/related-activity.ts`). `relatedActivity({ goalId?, missionId?, personId? }, { since?, limit? })` returns `{ items, failed }`. It reads the tables that already exist: GoalEvent, TaskEvent, Task, BrainDump, Reflection, SituationLog, DecisionReplay, RelationshipLedger (contact rows only) and ChatConversation, newest first, capped at 50 items and 90 days. A goal also picks up tasks through `Mission.lifeGoalId` when the task has no goalId of its own (Linear L1, done at read time). Each table read fails on its own and is named in `failed`. No new table.
> - **Nick tools** (`lib/ai/tools/goals.ts`). `getGoals` returns ids, value, due date, pace and health from the latest check-in (`no_check_in` when there is none, `unknown` when the read fails). `getRelated` runs the spine on demand. `logGoalCheckIn` writes one `check_in` GoalEvent per goal per ET day; the idempotency key is the claim. It matches the goal by id only and sets `currentValue` only on a metric goal.
> - **Ids reach Nick.** Each Active Goals prompt line now ends `[id:<id>]`, and the goals page data names ids, so `createTask.goalId` works. `createMissionPlan` takes `lifeGoalId` and links it only to a goal that is still live.
> - **Selector.** A new family for getRelated. Goal, mission and project words no longer pull the personal relationship picks ("check in on my revenue goal").
>
> **Flagged · NOT fixed**
> - Task completion still adds +1 to `currentValue` whatever the unit (`lib/services/tasks.ts`). That belongs to the goal-card wave.
> - If the value write fails after the check-in event lands, the check-in stays and the value is not set (reported as `valueError`). A retry the same day is a duplicate, so Nour sets the value on the card.
> - No journal table carries personId yet (W4), so a person's spine covers only contacts and tasks.
