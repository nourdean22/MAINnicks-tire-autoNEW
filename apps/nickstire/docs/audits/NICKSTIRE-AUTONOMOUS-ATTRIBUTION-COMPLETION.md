# Nick's Tire — Autonomous Attribution Completion

_2026-06-10 · branch `nickstire-autonomous-attribution-completion` · starting prod SHA `24656bbf` (verified deployed before any work). Full-autonomy session: finish every remaining attribution HOLD that does not require an owner secret or external login._

---

## 1. Master audit table

| Item | State found | Outcome |
|---|---|---|
| Meta CAPI code | Restored-dormant, untested; token CONFIRMED ABSENT in Railway (env names checked, values never read) | **Tests added** (4: no-token=zero network · SHA-256 hashing exact-match · event_id dedup passthrough · Graph-error swallow) + **Site Health status card** (booleans only) + **activation runbook**. Token = OWNER_SECRET_REQUIRED |
| call_events / journey join | No shared key existed across surfaces. Found: localStorage visitor id (`nick_session_id`) already used by customer_events; Meta pixel event_id generated+RETURNED by trackPhoneCall but discarded | **FINISHED (foundation): migration 0068 + full capture wiring + pure exact-key join helper + 5 tests.** Click->actual-call (vapi) matching stays SPEC-ONLY (approximate by nature — see §5) |
| Sheets headers | **READ-ONLY CHECKED IN PROD: row 1 blank on all 4 tabs** — owner has NOT pasted yet (rows still align underneath) | OWNER_EXTERNAL_ACTION (#1 on the checklist) |
| GA4 repointing | Code emits canonical events (live-verified at 4a12a6c2); remaining work is GA4-UI-only | **DOC_RUNBOOK shipped**: `docs/runbooks/GA4-REPOINTING.md` |
| Historical backfill | Dry-run executed READ-ONLY against prod: leads 9 rows (4 utm) · bookings 22 (19) · callbacks 40 (1) · tire_orders 9 (0) · call_events 41 (0 — all untagged traffic so far) · sessionId 0 everywhere (new) | **CLOSED as NOT-WORTH-RISK** — ~40 candidate rows total; Sheet-row mutation + approximate matching for near-zero value. Re-checkable anytime: `scripts/backfill-attribution-dryrun.ts` (zero write statements by construction) |

## 2. Journey-join foundation (the big finish)

**Design truth:** the only honest join is an exact shared key. The repo already had one — the localStorage visitor id customer_events stores as `sessionId` — and trackPhoneCall already generated (and returned) a Meta `event_id` that was being thrown away. This wave stores both everywhere conversions happen:

- **Migration `0068_journey_session_keys.sql` — APPLIED to prod expand-first, verified 6/6 via information_schema, zero rows mutated:**
```sql
ALTER TABLE call_events ADD COLUMN IF NOT EXISTS sessionId VARCHAR(64) NULL;
ALTER TABLE call_events ADD COLUMN IF NOT EXISTS eventId VARCHAR(64) NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS sessionId VARCHAR(64) NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS sessionId VARCHAR(64) NULL;
ALTER TABLE callback_requests ADD COLUMN IF NOT EXISTS sessionId VARCHAR(64) NULL;
ALTER TABLE tire_orders ADD COLUMN IF NOT EXISTS sessionId VARCHAR(64) NULL;
```
  Rollback (operator-gated): `ALTER TABLE <t> DROP COLUMN <c>;` per column.
- **Client:** `lib/session.ts` = single canonical `getSessionId()` (the exact implementation that lived in SEO.tsx; SEO.tsx now imports it). `getUtmData()` includes `sessionId` → **every existing form spread (lead/booking/callback/financing/tire-order) carries it with zero per-form changes**. `trackPhoneClick` now chains the pixel call and threads the SAME `event_id` the pixel fired into the `callTracking.logCall` row (+ sessionId) — pixel<->CAPI Contact dedup and click-row identity in one move.
- **Server:** zod + insert for `sessionId` on lead/callback(x2 rows)/booking/gatewayTire; `logCall` takes `sessionId` + `eventId`.
- **Join helper:** `shared/journey.ts` `buildSessionJourneys()` — pure, exact-key only, returns honest `coverage {totalRows, attributed, unattributed, multiStepJourneys}`; null sessionIds are COUNTED, never matched. 5 tests pin the no-fabrication contract.
- **Honesty:** historical rows are NULL forever (blind spot, stated). The id is visitor-scoped (localStorage persists across visits) — docs/UI must say "same visitor", not "same visit". An admin journeys surface should be built AFTER data accrues (2-4 weeks) — building it today would render an empty/0-coverage view.

## 3. CAPI status

**DORMANT, now provably so:** token confirmed absent in Railway; unit tests prove the no-token path makes zero network calls; **Site Health now shows a META SERVER-SIDE CONVERSIONS card (ACTIVE/DORMANT from env-presence booleans — token value never reaches the browser)**. Activation = `docs/runbooks/CAPI-ACTIVATION.md` (generate token -> one Railway var -> auto-redeploy -> verify in Meta Test Events). Hashing + event_id dedup are unit-proven ahead of activation.

## 4. What was pushed / gates

Files: `client/src/lib/session.ts` (new) · `client/src/lib/utm.ts` · `client/src/components/SEO.tsx` · `client/src/pages/admin/SiteHealthSection.tsx` · `shared/journey.ts` (new) · `server/journey.test.ts` (new) · `server/meta-capi.test.ts` (new) · `server/routers/{admin,lead,callback,booking,gatewayTire}.ts` · `drizzle/schema.ts` + `drizzle/0068_journey_session_keys.sql` · `scripts/backfill-attribution-dryrun.ts` (new, read-only) · `docs/runbooks/{CAPI-ACTIVATION,GA4-REPOINTING}.md` (new) · this doc.
Gates: tsc 0 · **752 tests** (9 new) · full build · hooks · grep gates (no DROP/RENAME, no sends, no secrets, CAPI env-gated, journey never overclaims).

## 5. Risk register / still open

| Risk/item | Status |
|---|---|
| Click->actual-phone-call (vapi_call_logs) matching | SPEC-ONLY by design: no exact key exists (a tel: click has no caller-id). Any join is a time-window heuristic that MUST be labeled approximate. Build only against a specific ROI question; prerequisite now exists (call_events.eventId/sessionId) for a future call-side capture design. |
| Sheets headers | Owner paste (verified missing). |
| CAPI token | Owner secret. |
| GA4 repointing | Owner GA4-UI actions per runbook. |
| localStorage id loss | Private mode/blocked storage -> null -> honest unattributed rows (never guessed). |
| Visitor-id semantics | Persists across visits; multi-visit journeys join as ONE visitor — correct for "did this person come back and book", must not be read as "one sitting". |

## 6. Owner checklist (everything left, in order)
1. **Paste Sheet headers** (verified still missing): Leads `O1:S1` · Bookings `M1:Q1` · Callbacks `K1:O1` · Financing `K1:O1` -> `UTM Source | UTM Medium | UTM Campaign | Landing Page | Referrer`.
2. **CAPI token** when ready: `docs/runbooks/CAPI-ACTIVATION.md` (5 min). Site Health card flips DORMANT->ACTIVE.
3. **GA4 repoint** (10 min): `docs/runbooks/GA4-REPOINTING.md`.
4. **First tagged boost**: `?utm_source=instagram&utm_medium=boosted_social&utm_campaign=boosted_tread_YYYYMMDD`.

## 7. 7-day watch
First call_events rows with sessionId+eventId (within hours of deploy) · first lead/booking rows with sessionId · first multi-step visitor journey (click->lead same sessionId — queryable; admin surface comes after data accrues) · Sheets tails populating once headers pasted · CAPI card stays DORMANT until the token · no console/tRPC regressions on Site Health.
