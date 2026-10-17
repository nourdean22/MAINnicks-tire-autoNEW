| Job id | Date | Job | Lanes | Status | PR / SHA | Next action or blocker | Lesson |
|---|---|---|---|---|---|---|---|
| 2026-10-17-brain-fu2-replay-date | 2026-10-17 | Brain follow-up 2: pickDueReplays honours the decision's own review date (passed date due at any age, future date blocks, 30-day rule otherwise); a failed replay lookup no longer re-asks reviewed decisions | statenour, manager | MERGED | this PR (statenour/brain-fu2-replay-date) | no live effect: the replay coach has no production caller (recorded); next FU6 (weekly XP readers UNKNOWN on a failed read) | a follow-up written from a review note can target unwired code: grep the function's production callers before briefing the fix, and say so in the PR |

| Job id | After the PR opened (Codex, human) | Manager catches before it opened | Red-first (new tests red on unfixed code / new tests) | Mutation (killed / tried) | Cycle time (first dispatch to merge) | Rework pushes | Source |
|---|---|---|---|---|---|---|---|
| 2026-10-17-brain-fu2-replay-date | UNKNOWN until the PR closes | lane: 1 (no production caller: the fix is BUILT + UNWIRED), reported in its RETURN; no lens run (no live effect) | 9 failed / 10 passed on unfixed code | 2 / 2 | dispatch 2026-10-17 to merge: UNKNOWN at row time | 0 at row time | lane RETURN, manager caller grep, PR body |
