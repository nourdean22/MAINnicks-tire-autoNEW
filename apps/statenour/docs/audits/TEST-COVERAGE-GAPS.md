# Test Coverage Gaps Audit · Track B.3

**Run Date:** 2026-06-29  
**Scope:** 9 system helpers/components shipped in v9.1.22–v9.1.27  
**Status:** Audit complete · Mapped to new test suites  

---

## Mapped Components & Gaps

| # | Helper / Wire-up | File Path | Status | Verification Target |
|---|---|---|---|---|
| 1 | `invalidateMutationCaches` | `lib/services/tasks.ts`<br>`lib/services/missions.ts` | 🟢 Verified | Covered by `tests/lib/cache.test.ts` |
| 2 | Journal Sanitization wire-up | `lib/brain/journal-ingest.ts` | 🟢 Verified | Covered by `tests/brain/journal-sanitize.test.ts` |
| 3 | Reflection Idempotency wire-up | `lib/brain/reflection-engine.ts` | 🟢 Verified | Covered by `tests/brain/reflection-idempotency.test.ts` |
| 4 | Autonomous Engine Lock-First | `lib/brain/autonomous-engine.ts` | 🔴 Missing | Create `tests/lib/brain/autonomous-engine-lock.test.ts` |
| 5 | `maybeSpawnNextPhase` Transaction | `lib/services/tasks.ts` | 🔴 Missing | Create `tests/lib/services/maybe-spawn-next-phase.test.ts` |
| 6 | Wisdom Jaccard Dedup | `lib/brain/wisdom-distiller.ts` | 🟡 Partial | Add specific Jaccard threshold checks to `tests/lib/brain-enrichments.test.ts` |
| 7 | Importance Scorer TTL | `lib/brain/importance-scorer.ts` | 🔴 Missing | Create `tests/lib/brain/importance-scorer-ttl.test.ts` |
| 8 | `claimWorkItems` TOCTOU Exclusion | `lib/services/runner-state.ts` | 🔴 Missing | Create `tests/lib/services/claim-work-items.test.ts` |
| 9 | Entity-Audit Chat turn wrapping | `app/api/ai/chat/route.ts` | 🔴 Missing | Create `tests/lib/services/chat-entity-audit.test.ts` |

---

## Action Plan

1. **`maybeSpawnNextPhase`**: Assert transaction block behavior, prevent duplicate phase spawning, check `planData` serialization structure.
2. **Autonomous Engine Locking**: Mock `idempotentCreate` to verify lock checks before policy reads and execution.
3. **Importance Scorer TTL**: Verify `expiresAt` is exactly 30 days in the future for scores <8, and `null` for scores ≥8. Pin deterministic tiebreaker ordering.
4. **`claimWorkItems`**: Mock concurrent nodes competing for pending tasks; check `id: { notIn: [...] }` exclusions and `limit * 2` iteration safety caps.
5. **Chat Entity Auditing**: Verify that `POST /api/ai/chat` wrapping triggers `withActor("nick")` so downstream database audits record the correct actor.
