> ## 2026-11-02 · Missions show the goal: inherit, chip, align, filter, pace risk (job 2026-11-02-nour-os-interconnect W3) · 1 ship
>
> Nour (2026-11-02): "i dont think they talk to each other the goals and the ai and missions". PR 3520 put the goal on the mission card; the task rows, the filter and the goal-pace risk bump still never read a goal.
>
> - **One rule.** `lib/missions/task-goal.ts taskGoal`: a task's own `goalId` wins, else its mission's `lifeGoal` (Linear L1, read time, no backfill). `use-missions-data` reads `task.goals` once and hands every task a `goal`; the chips, the filter and hidden-risk all read it.
> - **Chips.** A task row shows `goal · <title>` only for its OWN goal (an inherited one is on the mission card above). Both chips link to `/missions?goalId=<id>`: they set the page filter, they do not leave the page.
> - **Align (Sunsama S1).** The task editor has a goal picker (active goals, none); More > "Align to goal" opens it at that field. The write is `trpc.task.update` `fields.goalId`, keyed by the task id only.
> - **Filter.** Chips under the deck controls for goals with linked work (cap 6, hidden when none); `?goalId=` is the state, so the goal card's mission chip and its pace chip now deep-link into a filtered board.
> - **Pace risk.** `goalLineage` (goalPaceView verdicts) is passed to `computeHiddenRiskSummary`, with inherited goals resolved, so a hidden task under a goal behind pace reads high risk.
>
> **Flagged · NOT fixed**
> - The domain lanes stay unfiltered by goal: their open counts come from the deck, and filtering their rows would contradict the count beside them.
> - A chip tap replaces the URL with `/missions?goalId=`, which drops any open `?inspect=` param.
