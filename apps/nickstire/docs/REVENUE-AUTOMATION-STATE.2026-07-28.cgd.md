---
clarity-gate-version: 2.1
processed-date: 2026-07-28
processed-by: Claude Code (session self-audit) + Nour (Go)
clarity-status: CLEAR
hitl-status: PENDING
hitl-pending-count: 2
points-passed: 1-9
document-sha256: 881c88f4e5d9048f369413d06634e581c38fe207c204d5423094a390405d4104
hitl-claims:
  - id: claim-9ac47b97
    text: "590 declined-recovery texts sent 2026-05-19 to 2026-07-26"
    value: "590"
    source: "prod sms_messages SELECT (variantKey LIKE 'declined_%', direction=outbound, createdAt < 2026-07-28), run 2026-07-28"
    location: "runtime-flag-truth/1"
    round: A
  - id: claim-851afca6
    text: "Cross-sell send history is 575 texts across 2026-05-19 to 05-21 and zero since"
    value: "575"
    source: "prod sms_messages SELECT (variantKey='cross_sell'), run 2026-07-28"
    location: "runtime-flag-truth/2"
    round: A
  - id: claim-8bccb570
    text: "All five send gates were ON in prod before 2026-07-28"
    value: "3 DB flags + 2 env vars"
    source: "prod feature_flags SELECT + railway variables (service MAINnicks-tire-auto), run 2026-07-28"
    location: "runtime-flag-truth/3"
    round: A
  - id: claim-24787295
    text: "Operator's declared IG autopost cap is 2 per day"
    value: "2/day"
    source: "Confirm with Nour — recorded in agent memory 2026-07-27; only the operator can confirm their declared intent"
    location: "open-items/1"
    round: B
  - id: claim-fa1a72aa
    text: "J.D. Power 2025 ASI: 41% with photo/video evidence completed recommended work vs 17% without, full-service repair segment"
    value: "41% vs 17%"
    source: "Check jdpower.com 2025 ASI press release — our 2026-07-28 fetch returned HTTP 403; figure inherited from the operator's plan"
    location: "dvi-scope/1"
    round: B
---

# Revenue-Automation State — Clarity-Gated Snapshot (2026-07-28)

> **Point-in-time gated snapshot.** The living document is
> [`REVENUE-AUTOMATION-STATE.md`](./REVENUE-AUTOMATION-STATE.md); this file freezes
> what was verified, how, and what remains humanly unconfirmed as of the arc's
> close. If the two disagree, the living doc is newer — re-gate before citing.

## What is VERIFIED (session evidence witnessed, Round A)

- Nine PRs (#1144→#1158) + docs PR #1159 merged; full serial suite grew 3,976 → 4,079 tests, never red *(vitest summary lines)*.
- Migrations 0099-0102 applied to prod TiDB, each applicator's own post-check passing *(script output)*.
- All five send gates ON in prod **before** today *(DB + Railway reads)* — see claim-8bccb570.
- **590 declined-recovery texts sent 2026-05-19 → 2026-07-26** — the copy corrected in #1146 was reaching customers at verified scale: psychographic P3 track ×367 (incl. "quote is still good" ×88, "keep that quote open" ×60), legacy `declined_d30` "We'll honor that pricing" ×46 *(see claim-9ac47b97)*. The P2 "photos of the worn parts" variants were **not observed** in the top-10 — ≤~24 sends if any *(bounded, not zero-proven)*.
- Cross-sell: **575 texts, all within 2026-05-19 → 05-21, none since** — a 3-day burst then dormancy *(claim-851afca6)*. Current eligible pool: 4 treatment customers ≥0.5 confidence `[VOLATILE — re-check after each affinity recompute]`.
- Work-order state machine: legal-transition guard, lifecycle timestamps stamped on transitions, `work_order_transitions` history, `dropOffFlow` verified-transition customer sends *(code read)*.

## What is INFERRED (labeled, not proven)

- Cross-sell volume risk "nil" — an inference from the 4-customer pool + cap 10/run + 30d cooldown; the May burst is the precedent that pools change.
- The 9 declined-recovery texts sent on 2026-07-28 itself may carry either old or corrected copy (send-time vs deploy-time unresolved).

## What awaits HUMAN confirmation (Round B — the 2 pending)

| # | Claim | Status |
|---|---|---|
| 1 | Declared IG autopost cap is 2/day (claim-24787295) | ☐ PENDING — Nour |
| 2 | J.D. Power 41%/17% as cited (claim-fa1a72aa) | ☐ PENDING — source fetch blocked (403); accept-as-plan-cited or verify manually |

## HITL Verification Record

### Round A: Derived Data Confirmation
- 590 declined sends pre-07-28 (prod `sms_messages` query, output witnessed) ✓
- 575 cross-sell sends, May-only (same query batch) ✓
- 5/5 gates ON (prod `feature_flags` + `railway variables`, outputs witnessed) ✓
- Histogram 29,300 = 28,499 + 771 + 30; 4 treatment ≥0.5 (prod query; arithmetic checks) ✓
- Test counts, migration post-checks, work-order stamping (session artifacts) ✓

*Operator said "Go" on the gate's proposed actions 2026-07-28; Round A items are agent-witnessed source reads, not human re-derivations.*

### Round B: True HITL Verification
| # | Claim | Status | Verified By | Date |
|---|---|---|---|---|
| 1 | IG cap declared = 2/day | ☐ Pending | — | — |
| 2 | J.D. Power 41%/17% (full-service segment) | ☐ Pending | — | — |

<!-- CLARITY_GATE_END -->
Clarity Gate: CLEAR | PENDING
