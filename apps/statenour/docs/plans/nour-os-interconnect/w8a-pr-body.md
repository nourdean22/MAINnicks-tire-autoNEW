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

## Kill criterion + live-check date

Kill (revert this PR) if, after it is live, a goal plan still shows phase 2 "current" with zero tasks after the last phase-1 task is checked off, or the card's % and Nick's "Active Goals" line disagree for the same goal. Live check 2026-11-04 (Nour: Plan it on one goal, check off its phase-1 tasks, compare the card % with "what are my goals"; the manager: `goal_events` gains `check_in` rows from the review and `tasks.goal_id` is set on new plan tasks). Second read 2026-11-17.

## 10x

Not more surfaces: fewer rules. This PR ends with ONE task-goal rule (two functions), ONE goal number (one function), ONE completion path (checkTask), ONE check-in writer (logGoalCheckIn, now fed by the card, Nick and the review). The 10x move is that every future surface imports these names and cannot disagree; the next lane (W8c missions linking) consumes `goalTaskWhere` instead of writing a filter.

## Second reader

Run by the manager after RETURN: pr-review-toolkit silent-failure-hunter and pr-test-analyzer over this diff.

Ship record: `apps/statenour/docs/reconciliation/2026-11-03-w8a-goals-core.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
