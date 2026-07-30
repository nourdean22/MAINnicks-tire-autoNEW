---
clarity-gate-version: 2.1
processed-date: 2026-07-29
processed-by: Claude Fable 5 (observability arc session) — operator review complete
clarity-status: CLEAR
hitl-status: REVIEWED
hitl-pending-count: 0
points-passed: 1-9
document-sha256: 68df65f1a344660dbefbbe5026e0c7ff8ca71d65d2a814fcf6447bc53417be6e
hitl-claims:
  - id: claim-0eb5cebd
    text: "Prod api_request_logs has zero /api/ai/chat rows ever; the chat route never passes through the apiHandler request logger"
    value: "0 rows"
    source: "Operator's own Neon SQL (task brief 2026-07-29) + witnessed structural proof: bare POST at app/api/ai/chat/route.ts:40, apiRequestLog.create only in lib/utils/http.ts"
    location: "diagnose-defect/1"
    round: A
    confirmed-by: Nour (operator, in-session)
    confirmed-date: 2026-07-29
  - id: claim-f267ea9a
    text: "provider_pings' only writer was removed in the wave-AE cron prune (f87fb7e62); no writer existed after it"
    value: "f87fb7e62"
    source: "git show f87fb7e62 deletes app/api/cron/provider-ping/route.ts (99 lines, contains the providerPing.create loop); git log -S providerPing.create and -S 'INSERT INTO provider_pings' surface no later writer commit"
    location: "provider-pings/1"
    round: A
    confirmed-by: Nour (operator, in-session)
    confirmed-date: 2026-07-29
  - id: claim-eb6104eb
    text: "All four resolve-recorded sibling migrations were fully applied in prod before recording"
    value: "4/4 complete"
    source: "Single object-probe SQL 2026-07-29: FOLLOW_UP enum=1, intelligence_outcomes + 2/2 indexes, commitments 7/7 lifecycle columns + source_ref index, health_samples + health_ingest_batches + 4/4 indexes"
    location: "ledger-reconciliation/1"
    round: A
    confirmed-by: Nour (operator, in-session)
    confirmed-date: 2026-07-29
  - id: claim-0d413e52
    text: "No janitor or other prod code touched provider_pings in the DROP-to-deploy window"
    value: "0 janitor runs · 0 failures"
    source: "Prod probe 2026-07-29 (4h window spanning the DROP): 32 cron_job_logs runs, 0 failed, 0 cleanup/autonomic/orchestrator runs at all, 0 ai_error rows mentioning provider_pings — deploy ordering rendered moot; supersedes pending claim-3b94d87b (deploy-finished-first, as such unverifiable post-hoc)"
    location: "drop-window/1"
    round: B
    confirmed-by: Nour (operator, in-session)
    confirmed-date: 2026-07-29
  - id: claim-c14f0c28
    text: "No consumer outside the monorepo read provider_pings"
    value: "0 external readers"
    source: "Operator attestation in-session 2026-07-29 (their tooling domain; operator also ordered the deletion); table dropped ~22:07 EDT with no downstream complaint since"
    location: "provider-pings/2"
    round: B
    confirmed-by: Nour (operator, in-session)
    confirmed-date: 2026-07-29
---

# Statenour Observability Truth Arc — Clarity-Gated Session Report

**Date:** 2026-07-29 · **Ships:** PR [#1228](https://github.com/nourdean22/MAINnicks-tire-autoNEW/pull/1228) (squash `0ecffcb8e`) + prod `_prisma_migrations` ledger reconciliation (no code) · **Author:** single session, operator-directed.

Two defects shared one shape — *a reporter reading a source the reported path never writes* — plus the ledger cleanup that followed. This document separates what the session **witnessed** (tool receipts in-session), what it **inferred**, and what remains **pending human verification**.

## Witnessed facts (Tier 1 — tool receipts; no HITL required)

### Defect 1 — /diagnose read sources that cannot receive rows

- `app/api/ai/chat/route.ts:40` exports a bare `POST`; `apiRequestLog.create` exists in exactly one file, `lib/utils/http.ts` (`apiHandler`) — the chat route structurally cannot produce request-log rows.
- Pre-fix `runChatDiagnostic` filtered `apiRequestLog` to `path startsWith "/api/ai/chat"` for its "Chat errors" and "Slow requests" sections, and its advice branch (`recentErrors.length === 0 && allOk`) printed "transient network blip — tap Retry" whenever those structurally-empty reads returned nothing — i.e. always, including during real outages.
- `recordError()` writes `auditEvent(eventType="ai_error", actor=domain-prefix)` — actor is `"chat"` for every `chat:*` domain. `trackGeneration()` writes `aiGeneration(feature="chat", durationMs=...)` from chat post-persist ("Always runs", 5s cap, comment witnessed in `post-persist-verification.ts`).
- Post-fix sections read: chat errors ← `ai_error actor="chat"`; slow ← `aiGeneration feature="chat" durationMs>=15s`; other AI errors ← non-chat actors. A failed chat-trail read renders "error trail unavailable" (null sentinel), never "none".
- Gates on the change: new+kept diagnose tests 9/9 (written red-first; the prisma mock deliberately omits `apiRequestLog` so a regression crashes on the missing mock) · orchestrator tests 6/6 · `tsc --noEmit` exit 0 · `eslint .` 0 errors (165 pre-existing warnings) · `prisma validate` clean · pre-commit hooks green · pre-push `turbo build --affected` green (79s) · single commit `246335c1d`, no riders, squash-merged as `0ecffcb8e`.

### Defect 2 — provider_pings drop

- `git show f87fb7e62` (wave-AE "cron prune · 107 → 35") deletes `app/api/cron/provider-ping/route.ts` (99 lines) containing the `prisma.providerPing.create` loop; the same-session searches `git log -S "providerPing.create"` and `git log -S "INSERT INTO provider_pings"` surface no other writer commit.
- Prod probes on Neon `spring-art-47050555`, in order: `COUNT(*)=0` → `DROP TABLE IF EXISTS "provider_pings"` → `to_regclass('public.provider_pings') IS NULL` → migration `20260729120000_drop_provider_pings` resolve-recorded (`finished=true`).
- All in-repo references removed in #1228: Prisma model, two janitor `deleteMany` blocks (autonomic-orchestrator Phase 4, data-cleanup), retention entry, health-script + parity-probe entries, the provider_pings-only probe script, two orchestrator table-watch arrays.

### Ledger reconciliation (operator-approved chip task, same evening)

- Baseline `prisma migrate status` (run twice, identical): 4 local migrations "not yet applied" + 9 DB rows "not found locally", exit 1.
- Object probe for the 4 (single SQL): `FOLLOW_UP` enum present; `intelligence_outcomes` + its 2 indexes; `commitments` 7/7 lifecycle columns + `commitments_source_ref_idx`; `health_samples` + `health_ingest_batches` + all 4 indexes. Then 4 × `prisma migrate resolve --applied` → "marked as applied" each.
- The 9 orphan rows all carried hand-written checksums (`manual-endpoint-*`, `manual-apply-*`, `manual-20260625000000`). Full-row snapshot saved (session scratchpad `prisma-migrations-orphan-snapshot-2026-07-29.json`), then deleted with an explicit 9-name list + `checksum LIKE 'manual-%'` guard; `RETURNING` listed exactly the 9.
- The inserters are **live in-repo code**: `app/api/system/apply-pending-migration/route.ts:430-433` INSERTs `_prisma_migrations` rows with `manual-endpoint-${name}` checksums, and one-off scripts `apply-ambition-migration.ts`, `apply-brain-fts.ts`, `apply-mission-links-migration.ts`, `apply-social-publish-queue.ts` each insert their own row. These account for the orphan naming and the duplicate (below).
- `20260623000000_add_social_publish_queue` had TWO ledger rows — same name, same `manual-apply-social-publish-queue-2026-06-23` checksum, inserted 17 minutes apart; the later one (`360187b6-…`) deleted with operator approval, the earlier kept.
- Final state, CLI-confirmed: `46 migrations found in prisma/migrations` · "Database schema is up to date!" · **exit 0**; ledger 46 rows = 46 distinct names, 0 unfinished, 0 rolled back `[SNAPSHOT]` (2026-07-29 late evening EDT).

## Inferences and hypotheses (marked — do not cite as fact)

- **PRECISION on "zero rows ever":** the operator's SQL witnessed `api_request_logs` empty for `/api/ai/chat` at check time; the structural code proof makes all-time emptiness the expected consequence. The session itself only witnessed the structural half (`claim-0eb5cebd`, Round A).
- **PRECISION on provider_pings history:** "write-dead since wave-AE" is the defensible claim. Whether the table was empty for its *entire* life is unknowable post-hoc — the pre-prune pinger may have written rows that the 7-day janitors later purged. "Prod SELECT returns 0 rows" is witnessed; "never received a row ever" is not, and this document supersedes any earlier unqualified use of that phrasing.
- **INFERRED (strong):** the duplicate ledger row came from `apply-social-publish-queue.ts` running twice on 2026-06-23 [two rows, identical hand-written checksum, 17 minutes apart; the script unconditionally INSERTs].
- **VERIFIED POST-HOC (claim-0d413e52, supersedes the projected claim-3b94d87b):** the DROP-vs-deploy window was initially assumed safe by schedule reasoning only. A prod probe over the 4h window spanning the DROP then showed 32 cron runs / 0 failures / **zero** janitor (cleanup/autonomic/orchestrator) runs / zero `ai_error` rows mentioning the table — nothing attempted to touch provider_pings, so whether the deploy finished first is moot. "Deploy finished before the DROP" as originally worded remains unverified and is withdrawn rather than confirmed.
- **ASSUMPTION (recovery):** "Neon PITR also covers recovery" of the deleted rows is plan-dependent and was not checked; the scratchpad snapshot is the verified recovery path.
- **HYPOTHESIS (downgraded — see Corrections):** restoring stub dirs for the orphans "would checksum-mismatch". In-session evidence contradicts this for `migrate status` (below). Whether `migrate dev`/`migrate deploy` would object is untested and moot — neither runs against prod here (witnessed: no `migrate deploy`/`release:db` in package.json, Dockerfile, or railway configs).

## Corrections applied by this gate

1. **Checksum-mismatch claim downgraded to hypothesis.** The session asserted stub-dir restoration was unviable because Prisma "checksum-validates local dirs against ledger rows". Counter-evidence was sitting in the witnessed data: `20260623000000_add_social_publish_queue` has a real local dir whose true checksum cannot equal its ledger value `manual-apply-social-publish-queue-2026-06-23`, yet `migrate status` reports "up to date", exit 0 — `migrate status` does not checksum-validate applied rows. The **delete-over-stubs decision stands** on the witnessed grounds: the rows were ad-hoc notes from in-repo inserters, nothing consumes the ledger at deploy time, and deletion adds no repo junk.
2. **"Migration squash remnants" hypothesis replaced.** The orphan rows were written by the live apply-endpoint/scripts above (witnessed), not left behind by a history squash.
3. **Memory softened** (`statenour-diagnose-truth-provider-pings-2026-07-29.md` + `MEMORY.md` index): checksum-mismatch wording re-marked as untested hypothesis; inserter provenance recorded.

## Open finding (not fixed in this arc)

**Re-drift is live:** `app/api/system/apply-pending-migration/route.ts` and the one-off `scripts/apply-*.ts` insert `_prisma_migrations` rows whose names need not correspond to a local `prisma/migrations/<name>/` dir — the exact mechanism that produced this drift. Until the endpoint refuses (or auto-creates) dir-less names, `migrate status` can go red again on their next use.

## HITL Verification Record

### Round A: Derived Data Confirmation

- `claim-0eb5cebd` — api_request_logs had zero `/api/ai/chat` rows (operator's own Neon SQL + witnessed structural proof) ✓ Nour, 2026-07-29
- `claim-f267ea9a` — wave-AE prune removed the only provider_pings writer (git show + two `-S` searches) ✓ Nour, 2026-07-29
- `claim-eb6104eb` — the four resolve-recorded migrations were fully applied first (object-probe SQL reading) ✓ Nour, 2026-07-29

### Round B: True HITL Verification

| # | ID | Claim | Status | Verified By | Date |
|---|----|-------|--------|-------------|------|
| 1 | claim-0d413e52 | No janitor or other prod code touched provider_pings in the DROP window (evidence probe: 0 janitor runs, 0 failures, 0 table-mentioning errors in 4h) | ✓ Confirmed | Nour (operator) + in-session prod probe | 2026-07-29 |
| 2 | claim-c14f0c28 | No off-repo consumer (saved query/dashboard/notebook) read provider_pings | ✓ Confirmed | Nour (operator) | 2026-07-29 |

Original Round B claim-3b94d87b ("deploy finished before the DROP") was **withdrawn, not confirmed** — unverifiable post-hoc; superseded by the evidence-backed claim-0d413e52.

<!-- CLARITY_GATE_END -->
Clarity Gate: CLEAR | REVIEWED
