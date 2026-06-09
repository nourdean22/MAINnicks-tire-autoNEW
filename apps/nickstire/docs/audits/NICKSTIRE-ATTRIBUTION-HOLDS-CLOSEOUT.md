# Nick's Tire — Attribution HOLD Items Closeout

_2026-06 attribution-holds wave · branch `nickstire-attribution-holds` (from origin/main `78a70acd`)._
_Operator instruction: "continue on hold items." Triage: 3 items actionable in code now, 3 are migrations (specs below, NOT applied), 2 are operator-external actions._

---

## 1. CLOSED THIS WAVE

### A. Financing-tab UTM capture (was HOLD: "new capture field")
- `financing.trackApplication` input now accepts optional/nullish `utmSource/utmMedium/utmCampaign/landingPage/referrer` (same shapes as lead/callback/booking). NOT required — zero behavior change for omitting callers.
- `syncFinancingToSheet` appends the standard 5-cell attribution tail (**Financing tab cols K-O**, 10 -> 15, within A:Z). Admin counter-logged applications (`logApplication`) carry no web attribution -> honest blanks via the unconditional tail.
- Client: `Financing.tsx` Apply clicks spread `getUtmData()` — the prod-proven pattern.
- **Owner header paste now includes a 4th tab: Financing `K1:O1`** -> `UTM Source | UTM Medium | UTM Campaign | Landing Page | Referrer`.

### B. checkTireStock call->lead linkage (was the minor voice-path gap)
- The rack-check insert now uses `$returningId()` and writes `vapi_call_logs.convertedToLead=1 + leadId` — the exact tireInquiry pattern (wave-149 + audit #107). Dedup-hit calls link to the surviving lead. Rack-check calls no longer appear as "wasted calls" in call-conversion views. Fail-open: linkage errors never block capture.

### C. Meta CAPI restored DORMANT (was HOLD: "blocked on token")
- `server/meta-capi.ts` stub replaced with the real implementation restored from commit `37c8093`, modernized: repo logger (no console.*), `META_CAPI_PIXEL_ID` env-overridable (default = the live pixel id), `sendPurchaseEvent` export parity, caller-compatible nullable signatures (tsc-validated against every live call site in lead.ts/callback.ts/booking.ts).
- **Runtime behavior today is IDENTICAL to the stub**: no `META_CAPI_ACCESS_TOKEN` -> debug log + `{success:false}`, zero network calls, zero Meta events. Verified by construction (the token gate is the first statement of `sendCAPIEvent`).
- **ACTIVATION = one operator step, zero code:** Meta Events Manager -> Settings -> Conversions API -> Generate access token -> set `META_CAPI_ACCESS_TOKEN` in Railway (optionally `META_CAPI_PIXEL_ID`). From that moment: server-side Lead (popup/chat/financing-modal/callback/booking) + Schedule (booking) events flow with SHA-256-hashed PII per Meta spec, deduplicated against the browser pixel via the client-generated `event_id` that lead/booking submits already pass (`pixelEventId`).
- After activation, verify in Meta Events Manager -> Test Events / Event Diagnostics: Lead events arriving with `event_id` matching the pixel's (dedup badge), `events_received: 1` in server logs.

## 2. STILL HOLD — migration specs (prepared, NOT applied; each needs your approval + hand-applied SQL)

| Item | Spec | Risk |
|---|---|---|
| UTM Content/Term per-entity | `ALTER TABLE leads ADD COLUMN utmContent VARCHAR(255) NULL, ADD COLUMN utmTerm VARCHAR(255) NULL;` (same for bookings/callback_requests if wanted) + zod/insert/Sheets wiring | LOW (additive) — but utm_content/term are minor analytics; only worth bundling with another migration |
| Tire-order attribution | `ALTER TABLE tireOrders ADD COLUMN utmSource VARCHAR(100) NULL, ... (5 cols)` + gatewayTire.submit zod + client spread + Sheets tab decision | MEDIUM (touches the money order path) — schedule deliberately |
| call_events eventId / click->call->booking join | `ALTER TABLE call_events ADD COLUMN eventId VARCHAR(64) NULL` + client passes the pixel eventID (currently discarded at SEO.tsx trackPhoneClick) + matching-job design | HIGHEST complexity — build only against a specific ROI question |

## 3. STILL OPERATOR-EXTERNAL
- **GA4 repointing**: if any GA4 report keys on `phone_call_click`, re-point to `phone_click` (series cutover at the tracking-wave deploy).
- **Sheets historical backfill**: old rows keep blank tails (bulk row mutation — only on your explicit approval; low value vs. risk).
- **Sheets header paste** (now 4 tabs): Leads `O1:S1` · Bookings `M1:Q1` · Callbacks `K1:O1` · **Financing `K1:O1`**.

---
_Gates: tsc 0 · 743/743 full suite · build green. No schema applied, no migrations, no live Sheet mutation, no customer-contact change, CAPI dormant (zero Meta traffic until your token). Not pushed pending approval._
