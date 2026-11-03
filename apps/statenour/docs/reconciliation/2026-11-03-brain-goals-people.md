> ## 2026-11-03 · The brain knows goals and people (job 2026-11-02-nour-os-interconnect W6) · 1 ship
>
> Research map gap 7: the brain was keyed by chat topic, not by goals or people. Now goal moments are written into the brain, recall carries goal state and each person's newest fact, and /brain can filter by goal or person.
>
> - **Goal moments into BrainMemory.** A check-in, an achieved goal and a missed goal each write one row, category `goal`, key `goal_event:<GoalEvent.id>`, metadata `{ goalId, kind, goalEventId }`, through `brainMemory.remember` (admission gate, embeds on create). `lib/brain/goal-brain.ts`, called fire-and-forget from `logGoalCheckIn` and from `emitGoalEvent` (which holds the event id, so every achieved/missed path is covered). Task completions are not written.
> - **maximForGoalMoment** (`lib/brain/goal-maxim.ts`, pure, client-safe): one maxim from his books (MAXIM_POOL) per goal moment. States off_track > behind_pace > at_risk > check_in_due, achieved wins; tags decisions, timing, focus, focus, learning. The goal card (W5) and recall pick the same line.
> - **Recall.** A turn that names a goal or talks about goals gets up to 3 goal lines with id, health and pace (`lib/brain/goal-people-recall.ts`, reading `activeGoalsWithHealth`, the getGoals read). A goal off track or behind pace adds one maxim, which takes one of the 3 wisdom slots (`selectWisdomSlots` `goalMaximSlots`). Each recalled person's line carries their newest journal entry (`brain_dumps.person_ids`) and last contact; a failed read says "unread".
> - **Nick's getGoals** health is `goalHealthFrom` with the horizon cadence (`lib/services/goal-health.ts`), so Nick and the card agree: a check-in past its cadence is `no_check_in`, an off-list health is `unknown`.
> - **Spine.** A metric goal's `task_completed` GoalEvent collapses into the task's own titled row in `relatedActivity`.
> - **/brain.** The Memory tab's Context fold has goal and person filters (`brain.goalPeopleMemories`); a failed read renders "couldn't load", never an empty brain.
>
> **Flagged · NOT fixed**
> - Live recall quality is unmeasured: whether the goal lines and the goal maxim help Nick's replies needs a read of real turns after deploy.
> - A `task_completed` goal event whose task rows fell outside the window stays untitled ("task completed").
