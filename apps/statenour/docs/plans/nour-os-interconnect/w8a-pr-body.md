## What

Goals core W8a of job 2026-11-02-nour-os-interconnect: the write and counting side of goals. The audit (`apps/statenour/docs/plans/nour-os-interconnect/02-audit-2026-11-03.md`, copied unchanged) found that after PRs 3519-3527 a goal plan turned only milestone 1 into tasks, plan tasks carried no goal, the card and Nick showed two different numbers, Plan it could lose a mission or an edit, and the brain and wisdom rules fired on guesses. The ship record is `apps/statenour/docs/reconciliation/2026-11-03-w8a-goals-core.md`; the eleven brief items map to it one for one.

1. **One task-goal rule, server side**: `lib/services/task-goal-server.ts` exports `goalTaskWhere(goalIds)` and `taskGoalServer(task)` (+ `TASK_GOAL_SELECT`). W8b and W8c import them; no copy remains in this lane's files.
2. **Milestones 2..N spawn**: `checkTask` calls `maybeSpawnNextPhase` (now returns the count) and lifts the mission's goal; Nick's `completeTask` IS `checkTask`; `updateTask`'s UNREACHABLE branch (130 lines) is deleted.
3. **One goal number**: `goalProgress` (metric with target = value %, else task % over the shared filter, else 0) in `goal-health.ts`; `activeGoalsWithHealth` carries counts + progress; the prompt (`goalSummaryFromHealth`) and the goals-page grounding read it. `latestGoalEvents` is the one "latest check-in per goal" read for getGoals and the prompt.
4. **Plan it**: server-side phase-0 spawn after the save (`runPlanProject` returns `spawned` / `spawnFailed`), phases aligned to the confirmed milestones, `BudgetExceededError` = skeleton, effect keyed on `goal.id`, mission id in a ref, `maxLength` 200, toast from the server's count, the 15-30-step prompt deleted.
5. **Check-ins + since-list**: second same-day check-in with a value sets it; lift marker false only on P2002; `lastTouchedAt`; one row per completion; person journal in `getRelated`.
6. **Weekly review**: health chips make the note a check-in (`logGoalCheckIn`, source `weekly-review`); Close -> Achieved / Missed (`journal.saveWeeklyReview` input changed: `notes[].health`, `achieved`, `missed`; `close` removed).
7. **Brain + wisdom**: GOAL_WORDS guard, skip list in recall, `check_in_due` before `behind_pace`, SQL people filter (`recallPeopleWhere`), urgency order, titles-first goals read, `pinMemory` goalId/personId, /brain goal filter on any category, `goal`/`goal_moment` domain.
8. **Nick's tools**: `createTask` drops an unknown goalId and says so; `getMissions`, the prompt mission block and `listMissions` carry the goal.
9. **Links**: "Next:" / hero -> `/missions?goalId=&taskId=` and the page opens the sheet (`useOpenTaskFromUrl`); Home "Check-in due" -> `/stats?tab=goals&goalId=&checkin=1` (board opens the card, panel open); pace chip "+" = one goal-linked task for today.
10. **Dead weight**: unreachable branch, full-plan prompt, one `clip`, classifier reads `completionCriteria` (falls back to `successMetric`; no column retired), `check:soft-delete` waived by signature for `contradictions.ts`.
11. Audit doc copied unchanged.

MCP surface pin (`tests/security/mcp-surface.snapshot.json`) re-pinned with `pnpm snapshot:mcp-surface`: 4 description hashes moved (completeTask, createTask, getMissions, pinMemory); no tool added or removed, no risk class changed. Finding for the platform lane, not fixed here: the pin's input-schema hash did not move for pinMemory although it gained two inputs (`lib/agent-bridge/surface-digest.ts:103` hashes `stable(t.inputSchema)`, which does not see a zod schema's fields).

Procedure changes (PATH EXCEPTIONS): `lib/trpc/routers/ai.ts` (plan result gains `spawned`, `spawnFailed`), `lib/trpc/routers/journal.ts` (saveWeeklyReview input: `notes[].health`, `achieved`, `missed`). Tool input changes (snapshot regenerated and reviewed, 13 lines): `pinMemory` gains `goalId` / `personId`; `createTask.goalId`, `createTask`, `completeTask`, `getMissions`, `pinMemory` descriptions.

Benchmarked against: research doc 01 sections 3-5 (Linear L1 goal inherited through the project; Sunsama S2 do one step today, S3 review as check-in, S4 close with an outcome). This lane could not web-read; mechanisms were taken from doc 01's citations.

## Self-review (hostile re-read of the full diff)

Found and fixed before this PR:
- `completionCriteria` is a `Json?` column, not a string: the classifier read would have typed `description` as JSON (tsc caught it; now `typeof === "string"` else `successMetric`).
- The first `recallPeopleWhere` dropped 3-letter topics ("sam"), which `matchesTopic` used to match whole; a whole topic of 3+ letters is a term, words of 4+.
- The first positive control for `MilestonesFlow` was red for a harness reason (the HEAD component mounted a mutation the mock lacked); re-run with the mock so HEAD renders: 3 effect fires per 3 renders, no `maxLength`, a second mission on retry (the real failure shapes).
- The recall skip-list test asserted against a test-pool id while `readGoalRecall` reads the real pool; the test now learns the shown maxim's id first.
- `goalLifted` on the completion reward was a claim (`!!task.goalId`); it is now the awaited lift's result.
- The checkTask spawn is awaited (not fire-and-forget) so `nextPhaseSpawned` is a fact and the test cannot pass on a microtask race.

Red-first (failure shape on the unfixed code, then green):
- `check-task-spawns-next-phase.test.ts` 4f/0p ("expected spy to be called with { where }" on `task.count`, `nextPhaseSpawned` undefined, no `phase_progression_failed` warn, no `goal-lift:g-1:t-1`) -> 4p.
- `complete-task-routes-through-check-task.test.ts` 4f/0p (checkTask never called; `task.update` wrote DONE) -> 4p.
- `task-goal-server.test.ts` 9f (module missing) -> 9p.
- `one-goal-number.test.ts` 9f/0p (`goalProgress` not a function; `_count.tasks` undefined; grounding line "20%" from the stored column) -> 9p.
- `ai-plan-project-spawn.test.ts` 6f/2p (no spawn call; phases kept the model's names; BudgetExceededError thrown; no-milestones path called the provider) -> 8p.
- `milestones-flow.test.tsx` 5f/0p on the HEAD component (3 suggestion calls for 3 renders; `maxLength` -1; second `createMission` on retry; `planToast` missing) -> 5p.
- Items 5/7/8: 20 red across `goal-maxim`, `goal-people-recall`, `brain-goal-people`, `goal-checkin`, `pin-memory-goal-person`, `create-task-goal-and-missions-goal`, `recall-people-where`, `prompt-mission-goal` (each for its item's reason, e.g. "check in with mom" produced goal lines; duplicate check-in ignored the value; `pinMemory.create.metadata` undefined) -> all green.
- Item 6: `weekly-review.test.tsx` new cases red on the old `close` contract -> green (23).
- `check:soft-delete`: green with the two ALLOWLIST entries; a planted `prisma.contradiction.count({})` in the same file -> red at :209; restored.

Mutation receipts (mutant in, run, mutant out):
- spawn call removed from `checkTask` -> 2 red (`check-task-spawns-next-phase`).
- `goalTaskWhere` without the mission arm -> 2 red (`task-goal-server`, `goals`, `one-goal-number` set).
- `taskGoalServer` preferring the mission over the own goal -> 1 red.
- `goalProgress` metric branch removed (metric -> task %) -> 5 red.
- GOAL_WORDS guard and skip filter: the new tests are the mutation arms (the guard test fails without the lookahead; the skip test fails without the pool filter), both watched red before the fix.

Not checked: a real phone (Home due-row Link, check-in panel from the deep link, one-step chip, task sheet from `?taskId=`); live recall; the e2e lane (no fixture changed: `task.goals` and `operator.brief` shapes are unchanged in the fields e2e reads).

Rulings (reversible, one line each: what - why - cost if wrong):
- An archived own goal counts for NO goal in `goalTaskWhere` - matches the client rule in `lib/missions/task-goal.ts`; a third filter arm would be a second rule - an archived-goal task is missing from one mission's count until re-aligned.
- "Achieved / Missed" REPLACE "Close", still WEEK goals only - the audit's S4 is about the event; the guard was W7's and is not this wave's to loosen - a MONTH goal cannot be closed from the review (it can from the card).
- `progress` is null (rendered "progress unread") when a task-goal's tasks read failed - empty-vs-error - Nick sees one goal line without a number on a failed read.
- Plan mode without milestones is a 400 - the only caller passes them; the milestone-less prompt never finished on a local model - a future caller must run mode=milestones first.
- "check in on things" is no longer a goal turn - the preposition guard the brief asked for; "check in on my goals" still is - a goal turn phrased "check in on it" gets no goal lines.
- `goal` and `goal_moment` under "Tasks + strategy" in CATEGORY_DOMAINS - neither had a domain; goals are strategy - the /brain categories page groups them there.
- A whole topic of 3+ letters is a people term; words of 4+ - `matchesTopic` matched whole topics of any length; 2-letter terms match inside most names - a 2-letter nickname does not pull a person into recall.
- `lib/home/operator-brief.ts` untouched - lib/home is W8b's path (RULED OUT); its two copies are named in cross-lane needs - until W8b lands, the Home lead context and due row read their own copies (same answer on live goals).

## Manager round 1 (silent-failure reader on 3378eaafcf), fixed in a new commit

Each red-first; failure shape on the unfixed code, then green; mutation where named.
- **P0-1 / P1-8 weekly review check-ins.** `logGoalCheckIn` reports a failed write and a same-day duplicate in its return value, not by throwing; the review counted both as logged. Now only `logged:true` is `checkedIn`, a duplicate is `alreadyCheckedIn` ("Already checked in today on X; this health was not saved."), anything else is `failed`; a health chip with no words logs the check-in with an empty note and writes no journal row. Red 4f/23p (both counted as logged; chip-only rejected "Write one line"). Mutant (count any return) 2 red.
- **P0-2 Plan it retry.** Plan mode reads the mission first: phase 0 already spawned returns the saved plan (`alreadyPlanned`, `spawned: 0`, no model call, no write, no spawn); the write is `updateMany` on the `updatedAt` read; a lost swap re-reads and returns the winner's plan. Unknown mission = 404. Red 6f on the old code (`mission.update` by id, no early return).
- **P0-3 next-phase spawn race.** The plan is read inside the transaction and the write is a swap on the mission's `updatedAt`; the loser throws inside the transaction (its tasks roll back), re-reads, sees the winner's task ids and spawns nothing; a swap lost twice (unrelated edits) throws. Red: two concurrent completions spawned 4 tasks for a 2-step phase; green 2. Mutant (swap without `updatedAt`) 1 red. Not covered by a real-database arm (mocked store only; the predicate assertion is the guard).
- **P1-4** a failed spawn is `nextPhaseSpawnFailed` on `checkTask`, on the PATCH short-circuit, on Nick's `completeTask` (with a note to say so), and a /missions error toast (`lib/missions/next-phase-toast.ts`; `app/(mastery)/missions/hooks/use-mission-actions.ts` two lines, outside the brief's path list, named here). **P1-5** `spawnProjectTasks` runs the loop and the plan write in one transaction (`createTask(input, tx)`), events and the global re-score after the commit.
- **P1-9 / P2-17 / P1-11 the lift.** `liftGoalOnTaskComplete` returns true only after the increment (metric, achieved, repeat: false) and `goalLifted` uses it; the marker and the increment commit together (a failed increment rolls the marker back, so a retry works); a non-metric goal is never auto-achieved by a task count. Mutant (re-add auto-achieve) 1 red.
- **P1-10 ruling reversed (manager).** Round 0 copied `mission.lifeGoalId` into `task.goalId` at write time (the brief's item 2). The goal now flows only through the mission (`goalTaskWhere`, `taskGoalServer`, the lift's `liftGoalId`), so re-linking a mission moves its tasks; `maybeSpawnNextPhase`, `spawnProjectTasks` and `createMissionPlan` leave `goalId` null unless the caller names one.
- **P1-6** a failed weekly-completes read is `loopsThisWeek: null` (the chip hides; `classifyStaleness` treats null as unknown, an absent field keeps 0). **P1-7** a failed goals read sets `goalsReadFailed` and the WHY block says "Active Goals: couldn't read this turn (unknown, not none)". **P1-12** the /stats mastery tab grounding uses `activeGoalsWithHealth` (computed number).
- **P2-13** `createTask.goalLinked` reads the saved row. **P2-14** `pinMemory` merges into the row's metadata. **P2-15** the soft-delete waiver is gone: both contradictions counts spell `deletedAt: null` at the call; `check:soft-delete` exit 0, a planted `count({ where: OPEN_WHERE })` in the same file is caught (red at :210). **P2-16** a budget stop returns `fallbackReason: "budget"` and the skeleton summary and toast say so.

Stored-column readers NOT swapped (follow-ups, each still reads `life_goals.progress`): `lib/brain/goal-staleness.ts:69,95` reads whatever row its caller passes: the goal board passes getGoals rows (the computed number), `lib/services/backfill-tasks.ts:156` passes `g.progress` from its own goals read, `lib/brain/analyzers/goal.ts:152`, `lib/services/operator-pulse.ts:186,288`, `lib/brain/compound-chain.ts:338`.

Found in my own re-read during round 1, not fixed (named for the manager):
- `lib/ai/agent-actions/task-actions.ts:118-145` is a fourth completion writer: it sets DONE itself and lifts `task.goalId` only, so a plan task completed through it neither spawns the next phase nor lifts its mission's goal. Routing it through `checkTask` is the fix; it is outside the brief's paths.
- Correction to round 0's self-review: the 74 eslint warnings were not all pre-existing; `components/goals/goal-board.tsx` (the deep-link effect, react-hooks/set-state-in-effect) was mine. Fixed in round 1 (the open runs on the next frame).

## Manager round 1 part 2 (test-gap reader), same commit

Each test was run against the code that shipped round 1 and against a planted mutant; the failure shapes are below.
- **Soft-delete scanner, red first** (`tests/scripts/audit-soft-delete-filters.test.ts`, the real script on scratch copies of `contradictions.ts`). Exits for clean / appended unfiltered count / the same count six lines above a filtered one / `count({ where })` with an unfiltered local where: **0, 1, 0, 1** with the 12-line window (the third borrowed the next call's `deletedAt`), **0, 1, 1, 1** after the fix. The scanner now reads the call's own argument (balanced parentheses, 4,000-char cap); ALLOWLIST fragments still match on the 12 lines. The positive control caught my own first run: tsx did not resolve from the temp folder and every case "failed" on a crash.
- **The narrower read surfaced 10 hidden sites** on the real tree. 5 were real tombstone counts, now `deletedAt: null`: Nick's output-guardian `task_count` (`lib/ai/chat/output-guardian.ts`), the consolidation category gate, unresolved contradictions and the person count in brain health (`lib/brain/memory-consolidation.ts`), the todo-desk parked count (`lib/services/todo-desk.ts`). 5 are hoisted `where` consts that carry `deletedAt: null` and passed before only because a trailing comment sat inside the window: 3 ALLOWLIST entries with reasons (`lib/knowledge/candidate-actions.ts`, `candidate-store.ts`, `lib/system/stale-data-scanner.ts`). `check:soft-delete` on the real tree: 192 reads, 14 allowlisted, 0 baseline, exit 0. Outside the brief's path list; named here. Residual, not fixed: the regex is unchanged, so a `deletedAt` word inside a comment within the call's own argument, or `deletedAt: { not: null }`, still passes; and ALLOWLIST fragments keep the 12-line reach.
- **Archived own goal** (`check-task-spawns-next-phase.test.ts`). Red: completing a task whose own goal is archived lifted that archived goal (`['goal-lift:g-2:t-1']`). Fix: the lift and the cascaded children's lift resolve through `taskGoalServer` (own live goal, else the mission's live goal). `goalTaskWhere` is unchanged (its archived-own-goal ruling stands, W8b's copy stays byte-identical). Own-goal-first pinned on the lift and on the counts (`one-goal-number.test.ts`); mutants (mission goal first) red on both.
- **Concurrent completions through `checkTask`**: a rollback-aware store (creates pending until commit, a real compare on `updatedAt`, both transactions read before either writes) gives `nextPhaseSpawned` `[0, 2]`, 2 committed tasks, the plan holding exactly those ids. Mutant (ignore a lost swap): `[2, 2]`. Deviation from the brief's "create called 2 times": a mocked create cannot see a rollback, so the count is of committed creates.
- **Lift failures**: `goalLifted` false on a repeat (P2002) and on a failed lift with `goal_lift_failed` logged, the completion still succeeds; a metric marker write that fails for any other reason logs `goal_lift_marker_failed` and throws (mutant "every error is a duplicate": red). **Check-ins**: a milestone goal's same-day duplicate with a value never calls `updateGoal` (mutant: red). **Recall**: the people stage passes `recallPeopleWhere` to `personProfile.findMany` (mutant `where: {}`: red). **Pace**: a `horizon_set` event moves Nick's pace line and due (mutant drops it: red). **Grounding**: a task goal whose tasks read failed shows "[id:g1] progress unread", never 0% (mutant `?? 0`: red). The tautology line in `one-goal-number.test.ts` is deleted.
- **Whole suite after round 1 caught one real defect of mine:** `tests/repo/brain-memory-direct-writers-ratchet.test.ts` flagged `lib/services/tasks.ts`. The lift's marker row moved into the transaction as a one-line `tx.brainMemory.create(`; the base code wrote the same row as `prisma.brainMemory` / `.create(` across two lines, which the ratchet's single-line regex never saw. The row is a claim key, not a semantic memory, so it now carries the `brain-memory-direct-write:` reason the ratchet asks for (follow-up for platform: the ratchet regex misses a call split across lines).
- Inline copies of the task-goal rule still outside `task-goal-server.ts`: `goalTaskCounts` in `lib/services/goal-health.ts:104` (own ?? mission over rows already filtered by `goalTaskWhere`, so the archived case cannot reach it), and `lib/home/operator-brief.ts` (W8b's swap).

## Manager round 2 (verification reader on 4bdc1dd3c5), fixed in a new commit

Each fix has a test that was watched red on the code before it.
- **P1-6 leftover, goal card.** The null guard sat on the done/total span; the "N this week" chip still rendered `{g.loopsThisWeek ?? 0}`. The guard moved to the chip (a failed weekly read hides it; a real 0 still shows). `tests/components/goal-board-loops-null.test.tsx`: red "0 this week" rendered on null.
- **Weekly review, chips-only retry.** A review with health chips and no words wrote no row, so the reviewId had no claim: a lost response plus a phone retry extended the WEEK goal twice (14 days) and called the logged health "not saved". A chips-only review now writes one ungrounded review row ("Weekly review: checked in on ...") inside the same serializable transaction; the retry finds it and replays (no second extend, no second check-in). It is also the next review's `since`. Red: the retry returned `extended: ['g1']`. Deviation from the brief's "create, P2002 = duplicate": brain_dumps has no unique key on the reviewId, so the existing SERIALIZABLE read-then-create is the claim (two concurrent saves conflict, one fails).
- **createTask inside a caller's transaction.** The event, audit, caches, due reminder and `enrichTaskLinkage` fired on the global client before `spawnProjectTasks` committed: enrich found no row and gave up (phase-0 plan tasks never got statHints) and the created TaskEvent raced the commit. `createTask(input, tx, afterCommit)` now queues that work when given a tx (a tx without `afterCommit` throws); `spawnProjectTasks` runs the queue after its commit. `tests/lib/services/create-task-in-tx-defers-side-effects.test.ts`: red `[1, 1, 1]` (event, audit, person link fired before commit); positive control: without a tx all fire.
- **Two tests that checked the mock.** `spawn-tasks-transaction.test.ts` now runs a rollback-aware store (creates pending until the callback returns): on 3378eaafcf's `spawn-tasks.ts` the failure case commits `['t1']` (red), and the new order test needs `["commit", "effect:t1", "effect:t2"]` (red on 4bdc1dd3c5's version: `["commit"]`). `goal-lift-kind.test.ts` gives the transaction its own `brainMemory.create` and commits markers only when the callback returns: on 3378eaafcf's `tasks.ts` the P2-17 case fails on "the marker is never written on the global client ... called 1 times"; the retry after the rollback lifts and commits the marker.
- Not fixed, named by the reader: `createTask`'s sibling-goal inheritance (`lib/services/tasks.ts` ~613-647) can still copy a sibling task's `goalId` onto a phase-0 plan task (P1-10 leftover); the 3 new soft-delete ALLOWLIST entries match on the 12-line window.

## Kill criterion + live-check date

Kill (revert this PR) if, after it is live, a goal plan still shows phase 2 "current" with zero tasks after the last phase-1 task is checked off, or the card's % and Nick's "Active Goals" line disagree for the same goal. Live check 2026-11-04 (Nour: Plan it on one goal, check off its phase-1 tasks, compare the card % with "what are my goals"; the manager: `goal_events` gains `check_in` rows from the review, and new plan tasks count for their goal through `missions.life_goal_id` with `tasks.goal_id` left null (round 1 P1-10)). Second read 2026-11-17.

## 10x

Not more surfaces: fewer rules. This PR ends with ONE task-goal rule (two functions), ONE goal number (one function), ONE completion path for the UI, the PATCH and Nick's completeTask (checkTask; the agent-actions path in `lib/ai/agent-actions/task-actions.ts` is still separate, see round 1), ONE check-in writer (logGoalCheckIn, now fed by the card, Nick and the review). The 10x move is that every future surface imports these names and cannot disagree; the next lane (W8c missions linking) consumes `goalTaskWhere` instead of writing a filter.

## Second reader

Run by the manager after RETURN: pr-review-toolkit silent-failure-hunter and pr-test-analyzer over this diff.

Ship record: `apps/statenour/docs/reconciliation/2026-11-03-w8a-goals-core.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
