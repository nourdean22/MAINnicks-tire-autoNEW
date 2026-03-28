# Foundation Scorecard

Structural health gauge. Updated after each foundation pass.
Score 1-5: 1=broken, 2=fragile, 3=functional, 4=solid, 5=industrial.

## Current Scores (March 28, 2026)

| Domain | Score | Evidence |
|--------|-------|----------|
| Schema discipline | 3 | 68 tables, mixed naming, 8 missing timestamps, 22 missing indexes |
| Contract consistency | 2 | 45 routers, no shape audit done, no standard error format |
| Job reliability | 4 | Overlap prevention, timeout, force-reset, DB logging |
| Config discipline | 4 | .env.example matches code, required/optional separation |
| Observability | 2 | Logs exist but no signal/noise discipline, no subsystem tracing |
| Recovery readiness | 4 | RECOVERY.md, smoke tests, restart checklist |
| Testing depth | 3 | 21 smoke checks, but no mode/contract/degraded tests |
| Source-truth clarity | 3 | KB drift documented, Drive sources registered, repo activity tracked |
| Governance strength | 3 | Protected-core list, THRESHOLDS extracted, but no change budget |
| Cleanup/manageability | 3 | Gitignore fixed, Drive classified, stale files identified |
| Mastery support | 3 | Daily rhythm, habits, streaks, carry-forward, but no execution debt tracking |
| AI discipline | 2 | Circuit breaker exists, but no suitability map, no cost tracking |
| Revenue chain | 2 | Revenue queue exists, aging escalation, but no follow-through tracking |

**Overall: 2.9 / 5.0 — Functional but not yet industrial.**

## Foundation Gate Rule

If overall score < 3.0:
- No new major subsystems should be added
- Focus on deepening existing foundation
- Speculative features are auto-downgraded

If overall score >= 4.0:
- Safe to add new floors
- Change budget increases
- Extension becomes lower-risk

## Entropy Indicators

| Signal | Current | Target |
|--------|---------|--------|
| Duplicate configs | 0 (fixed) | 0 |
| Stale Drive docs | 5 empty, 2 stale | 0 empty, 0 stale |
| Mixed naming (schema) | ~30% snake_case | Accept, standardize forward |
| Unowned modules | ~10 advanced routers unclear | 0 |
| Temp files in repo | 0 (gitignored) | 0 |
| Magic numbers | 0 (THRESHOLDS extracted) | 0 |
| Undocumented env vars | 0 (fixed) | 0 |

## How to Improve Score

- Schema → 4: Add missing timestamps to 8 tables, add key indexes
- Contracts → 3: Audit top 5 largest routers for shape consistency
- Observability → 3: Add subsystem identity to error logs
- AI discipline → 3: Create model suitability map
- Revenue chain → 3: Add follow-through state tracking
- Mastery → 4: Add execution debt meter, avoidance detector
