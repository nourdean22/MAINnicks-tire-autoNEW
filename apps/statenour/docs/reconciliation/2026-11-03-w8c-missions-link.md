> ## 2026-11-03 · W8c missions link: mission goal select + suggestion, the linker embeds the chats it skipped · 1 ship
>
> Branch `statenour/w8c-missions-link` (job 2026-11-02-nour-os-interconnect, fix wave W8c). PARTIAL: items 1, 2, 3,
> 4, 7, 8 shipped; 5 (plan from milestones / ladder on the card) and 6 (`?taskId=` opens the task sheet) not built:
> both wait on W8a (`MilestonesFlow` has no mission prop; W8a owns the page's taskId read).
>
> - Mission goal link: the edit drawer has a goal select (active goals + No goal, 16 px / 44 px), writing
>   `fields.lifeGoalId` through PATCH /api/missions/[id] -> `services/missions.updateMission` (the service
>   `trpc.task.missionUpdate` calls). The card shows "align to goal" on an unlinked mission and opens the drawer at
>   the select. GUARD: `updateMission` refuses any new `lifeGoalId` that is not an active goal's id (400).
> - Suggested goal: `lib/missions/suggest-goal.ts suggestGoalForMission` (`trpc.task.suggestMissionGoal`), the
>   linker's cosine over same-model vectors (`SUGGEST_GOAL_MIN_COSINE` 0.45), word-overlap fallback labelled
>   (`SUGGEST_GOAL_MIN_WORDS` 0.25) until every active goal has a vector. Read on drawer open, not page load.
> - Linker: embeds up to `LINKER_EMBED_PER_RUN` (40) chats a night from title + summary + first
>   `LINKER_FIRST_USER_MESSAGES` (5) user messages via `getEmbeddingWithModel`, stores model + contentFingerprint,
>   never embeds the same text twice, re-embeds the retired venice-bge-m3 mission rows once, embeds active goals
>   (`life_goal`), scores same-model pairs only, explicit `resultCount`. Thresholds 0.55 / 0.45 kept, not re-tuned.
> - Chats line: per-mission review count ("2 chats need a yes" -> /brain?tab=memory); one board line "No chats
>   linked yet · the nightly linker embeds up to 40 chats a night" on a measured empty read.
> - `?goalId=` chips merge into the current query (`?inspect=` survives). `mission-helpers.ts` false comment fixed.
> - Read after deploy (owed): `cron_job_logs` for conversation-mission-link the night after merge (resultCount > 0,
>   result JSON `embedded` near 40); `vector_embeddings` count by sourceType and model; then re-run
>   `scripts/probe-cosine-distribution.mjs` on same-model vectors before touching the thresholds.
