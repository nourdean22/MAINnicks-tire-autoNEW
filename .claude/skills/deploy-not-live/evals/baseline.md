# Baseline: deploy-not-live

recorded: 2026-10-22

Question: what goes wrong when a merged PR is not live in production and the agent has no procedure for finding out why?
Recorded before `SKILL.md` was written; `forge.mjs check --git` verifies that order on the branch.

## Tasks run without the skill

| task | what happened | evidence |
|---|---|---|
| T1: one fresh headless run without the skill, read-only tools, planned prompt: "merged an hour ago, site shows the old thing, railway looks stuck, get it live" | NOT RUN. The headless `claude` login had expired, so no fresh-run result exists and none is claimed. This row is a record of the gap, not a measurement; rows T2 to T5 are real past incidents instead. | `claude -p` from the clone and from the scratchpad, 2026-10-22, both exit 1 with "Failed to authenticate: OAuth session expired and could not be refreshed"; `claude auth status` printed `loggedIn: false` |
| T2: Railway paused builds platform-wide (security incident) from 2026-10-21; six PRs merged and sat "merged, not live" for hours (incident, one occurrence) | Production kept serving an older commit from the evening of 10-21 until builds resumed about 05:21Z on 10-22. Nothing paged (the project has no deploy webhook, see T5). Three sessions each wrote the state down in their own words ("stuck", "NOT LIVE at", "none was live") and each recorded the running commit on its own; the live receipts stayed owed across sessions. No shared status line exists in `.claude/skills` or `docs/skill-proposals.md` (grepped 2026-10-22), so the next session had nothing to reuse. | agent memory files `telegram-alert-cleanup-3215.md`, `ai-referrals-2026-10-21.md`, `shop-eyes-ears-2026-10-21.md`; merge times from `gh pr view` for PRs 3210, 3209, 3214, 3215, 3213 and 3216 (19:21Z on 10-21 to 02:30Z on 10-22) |
| T3: the statenour build died of a Node heap out-of-memory in the TypeScript step, about 06:00Z on 2026-10-22 (incident, one occurrence) | The fix was a build-stage Dockerfile change (PR 3223), which is deploy config and needs Nour's explicit go. The session held it, correctly, but only told him after he woke: everything statenour stayed not live for about four more hours and he read the hold as the session not listening. No step prepared a one-line "approve this PR" ask for the moment the build died. The PR merged at 10:42Z and `/api/version` on the statenour site then reported the PR's own merge commit as running. | `feedback-collect-goes-before-sleep.md`; PR 3223 (the heap test `apps/statenour/tests/repo/dockerfile-build-heap.test.ts` names the two failed Railway builds); a public GET of `/api/version` at 11:39Z returned the merge commit |
| T4: the Railway command-line login expired mid-incident (incident, seen in two sessions) | Every Railway read failed with an unauthorized error. One session worked around it for the database probes by reading the connection string from a local env file. For the question "which commit is running" that workaround was unnecessary, because the public version route answers it with no login at all. Without a rule, the login problem can look like the whole problem. | `telegram-alert-cleanup-3215.md` ("login had expired 22:30Z"); `shop-eyes-ears-2026-10-21.md` ("session expired mid-day"); my own GET of the version route on both sites on 2026-10-22 returned a commit, no login used |
| T5: a row where it went fine: after a merge on 2026-10-20 a session read the deployment list for each touched service (one session, one occurrence) | It found "merged, not deployed" correctly, but only because it was running the broad production audit. The rule sits in `production-health-report`, which loads for a health report, not for "my PR is not live yet". | `docs/skill-proposals.md` entry P6 (merges on 10-20 produced no deployment for the touched service while untouched services got skipped records) |

## Failure shape

When a merge is not live, the work that matters is small and the same every time: ask each app which commit it runs, compare it
with the merge, then name the cause with an honest label. Without a procedure, each session words the state differently, treats
a stuck platform, a dead build and an expired login as one problem, and finds out late that the fix (a Dockerfile edit) is
deploy config that waits for Nour. The skill must make the first check the running commit, force the cause into a labelled
class, and put the one thing Nour has to do at the top of the answer, with the deploy-config fix named and left unapplied.
