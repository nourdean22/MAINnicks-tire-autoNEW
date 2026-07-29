---
clarity-gate-version: 2.1
processed-date: 2026-07-29
processed-by: Claude (Fable 5) — SMS Revenue Agent OS wave
clarity-status: CLEAR
hitl-status: PENDING
hitl-pending-count: 2
points-passed: 1-9
document-sha256: 9ff5a0a14d9a3ca68e9f78f1f82e250b9bce3ac284c3ababa4603a08572e331b
hitl-claims:
  - id: claim-pause-runtime
    text: "The sms_global_pause flag holds and resumes production sends end-to-end"
    value: "hold-and-drain observed in prod"
    source: "Post-deploy: arm the pause from the SMS Ops strip, send a test marketing SMS, observe status='queued', lift, observe drain"
    location: "smsControl/1"
    round: B
  - id: claim-rehydrate-runtime
    text: "Timer rehydration loads rows queued mid-run without a restart"
    value: "queued row sent within ~6 min without restart"
    source: "Post-deploy: insert/observe a queued row after boot, watch the 5-min recovery+rehydrate pass claim and send it"
    location: "smsQueue/1"
    round: B
  - id: claim-stale-lead-volume
    text: "The stale_lead collector's real-world volume is small (leads table held 2 rows total on 2026-07-20)"
    value: "0 eligible rows observed (two independent prod reads)"
    source: "Prod reads 2026-07-29: stale-lead window query returned 0 rows; leads 15d phone fetch returned 0"
    location: "collector/1"
    round: A
    confirmed-by: runtime observation (read-only prod queries, operator-approved session)
    confirmed-date: 2026-07-29
---

# SMS Revenue Agent OS — wave truth ledger (2026-07-29)

**Epistemic key:** `[VERIFIED-code]` = pinned by a test on this branch · `[VERIFIED-run]` = observed in a local run · `[DESIGNED]` = code asserts it, no runtime observation yet · `[UNKNOWN-runtime]` = prod state not read.

## What is now true in the CODE (all `[VERIFIED-code]` unless noted)

1. **Kill switch:** `sms_global_pause` holds automated customer sends (marketing + followup) in the durable queue; confirmations + internal flow; the drain holds while paused `[VERIFIED-code: sendSmsControlGates.test.ts]`. Unreadable switch state fails CLOSED for marketing, OPEN for followups `[VERIFIED-code]`. End-to-end prod behavior `[DESIGNED]` → Round-B claim 1.
2. **Global cap:** automated sends are refused at ≥ cap (default 200/24h, `SMS_GLOBAL_DAILY_CAP` overrides; counted from `sms_messages`, all doors) `[VERIFIED-code]`. The count query's fail-open is visible (`readable:false`) `[VERIFIED-code]`.
3. **Takeover at chokepoint:** automated classes are suppressed to a human-held phone; `humanInitiated` exempts operator sends (no self-deadlock) `[VERIFIED-code]`.
4. **Continuous rehydration:** boot AND ~5-min timer passes; dedup by DB id BEFORE the claim; 2-min claim grace; two identical texts = two obligations `[VERIFIED-code: smsQueueRehydrate.test.ts + smsSendingRecovery.test.ts wiring pins]`. Mid-run pickup in prod `[DESIGNED]` → Round-B claim 2.
5. **Autonomy ladder:** registry of 18 automations with levels 0-4; `setRolloutMode` rejects flips above the declared ceiling; only `inbound_sms` holds level 2; every level-4 entry declares an arming mechanism `[VERIFIED-code: smsAutonomyPolicy.test.ts]`.
6. **Speed-to-lead:** 24h–30d uncontacted non-careers/non-callback leads become Decision-Inbox rows with **no invented value** (null unless a quote was recorded) `[VERIFIED-code: opportunityStaleLeads.test.ts]`; >30d ages out queue-side only (leads table never mutated by the reconciler) `[VERIFIED-code]`. Real-world volume → Round-A claim 3.
7. **Draft bridge:** deterministic drafts only (no LLM); total banned-claims sweep passes (no $, %, guarantees, warranties, urgency, wait-times, "financing", template vars) `[VERIFIED-code: opportunityDraft.test.ts]`; call-first types (callback / complaint / promise) get NO draft `[VERIFIED-code]`; send requires operator two-tap and rides every sendSms gate `[VERIFIED-code + DESIGNED for UI tap-path]`.
8. **Ops surface:** `smsOps.opsStatus` reports pause/gateway/queue-depth/oldest-age/cap/suppressions/failures/drafts/ladder; failed reads render UNKNOWN, never zero `[DESIGNED — admin-truth pattern followed; no UI test added]`. **queue→sent latency is deliberately not reported** (no sent-at column — refusing to fabricate) `[VERIFIED-code: absent by construction]`.
9. **Suite:** 4,214 tests · 3 initial failures → 2 were this branch's to fix (fixed: wiring-pin re-pin, integration-mock class isolation), 1 (`audioQa`) is a pre-existing load flake that passes in isolation and touches no file in this diff `[VERIFIED-run 2026-07-29]`.

## What this wave does NOT claim

- No production flag/env state (`[UNKNOWN-runtime]` until read via railway/cron_log).
- No revenue impact, no lift, no response-rate change — no send has occurred because of this wave; the autonomy default for everything new is draft-only/surfaced.
- No migrations were applied; no schema changed.

## Residual holes carried forward (named, not hidden)

~~`scripts/fire-declined-recovery.ts` bypasses all gates~~ *(corrected Wave 5: the relay call is a read-only preflight probe; sends ride the gated cron path)* · per-pod 5-min opt-out cache window · ~~`campaignEligiblePhoneSql` under-filters~~ *(fixed Wave 5: three-source predicate + parity tripwire)* · takeover lacks read-signal/release · ~~queue→sent latency needs a sent-at column~~ *(fixed Wave 2: migration 0105)*.

---

## HITL Verification Record

### Round A: Derived Data Confirmation
- stale_lead collector volume expectation — **CONFIRMED by observation 2026-07-29** (two independent prod reads: 0 eligible rows in the 24h–30d window; leads pool tiny as predicted) ✓

### Round B: True HITL Verification
| # | Claim | Status | Verified By | Date |
|---|-------|--------|-------------|------|
| 1 | Pause holds+drains end-to-end in prod | ☐ pending first real occurrence (flag verified seeded OFF in prod; stuck-queue alert is the tripwire) | — | — |
| 2 | Timer rehydrate picks up mid-run rows in prod | ☐ pending first real occurrence (queue verified empty: 0 queued/0 sending — nothing to observe yet) | — | — |

### Runtime observations (2026-07-29 truth pass, read-only + one manual collector run)
- **Collectors live-verified in prod:** `human_pending_sms` produced **3 rows** from the 3 genuinely-waiting customers (verified/critical, now in the Decision Inbox); `stale_lead` / `no_show_booking` / `abandoned_form` produced honest zeros against verified-empty eligible pools (each source query independently returned 0 — zero-with-verified-empty-source, not silent idle). All arc collector queries measured ~30ms each.
- `sms_global_pause` = 0 (OFF) confirmed; outbound queue clean (0 queued / 0 sending); no operator levers fired yet (`sms.*` audit rows: none).
- Cadence finding: the refresh cron's own loop-shape contract flags under-scheduling ("ran 1× in 7d, expected ~7") — pre-existing, recorded for a scheduler-cadence wave.
- Diagnosis correction (owning it): two suspected "stalls" during verification were my throwaway scripts' DB pool holding the process open after completing — not slow queries (all ~30ms), not the collector quadratic. #1215's flat-query hardening stands on its own merits.

<!-- CLARITY_GATE_END -->
Clarity Gate: CLEAR | PENDING
