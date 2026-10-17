| Job id | Date | Job | Lanes | Status | PR / SHA | Next action or blocker | Lesson |
|---|---|---|---|---|---|---|---|
| 2026-10-14-lane-paths-empty-diff | 2026-10-14 | check-lane-paths exits 2 on an EMPTY diff from a lane that owns paths, not OK | platform | MERGED | #3025 (8be60bae, merged 2026-10-14 16:00Z; checks green before merge) | none: the manager skill's gate step (step 6) reads exit 2 as not checked | a gate that exits 0 on zero input verifies nothing; the first fix also made the research lane exit 2 on zero changes, and a research control test caught it |
