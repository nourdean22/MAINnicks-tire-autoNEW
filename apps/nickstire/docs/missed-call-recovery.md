# Missed-Call Recovery (Wave F) — Operational Runbook

**Status:** LIVE (armed) as of 2026-07-13. Shipped in PR #720.
**Owner action surface:** one env var (`MISSED_CALL_RECOVERY_SEND`) + one feature flag (`missed_call_recovery`).

Proactively follows up with people who **called the VAPI line but didn't
convert** (no lead, no callback) — a "sorry we missed your call, what's up
with the car?" text. Standard practice for a service shop; the audience is
people who *just contacted the business*, so it is a relationship follow-up,
not cold marketing.

> ⚠️ This is an **automated outbound-SMS channel** (TCPA surface). Read the
> "Controls" and "Compliance" sections before changing anything.

---

## How it works

```
cron "missed-call-recovery" (hourly tier · every 2h, business-hours only)
  → query vapi_call_logs for eligible missed calls
  → orchestrateSms({ type: "vapi_forwarded_call_followup", phone, vapiCallId })
        └─ the EXISTING orchestrator type → inherits ALL compliance
```

- **Code:** `server/cron/jobs/missedCallRecovery.ts` (registered in
  `server/cron/scheduler.ts`, **hourly tier · every 2h**, `businessHoursOnly: true`
  — so it runs at most every 2 hours during 9am–5pm ET).
- **Zero new shared-SMS code.** It *feeds* the pre-existing
  `vapi_forwarded_call_followup` orchestrator type. Every send therefore
  inherits opt-out enforcement, quiet-hours, per-run caps, the auto STOP
  footer, and `complianceLog` — the same machinery that guards every other
  transactional SMS.
- The message copy is the existing `vapi_forwarded_call_followup` template
  (`server/services/smsMessageCatalog.ts`), e.g. *"Hey, this is Nick's Tire
  & Auto. Sorry we missed your call. Text us what's going on with the car
  and the crew will get on it."*

## Eligibility (who gets a text)

The pure, unit-tested `isMissedCallEligible()` decides. A call qualifies only when **all** hold:

| Rule | Value | Why |
|---|---|---|
| Not converted | `convertedToLead = 0`, `leadId IS NULL`, `callbackId IS NULL` | They didn't already become a lead/callback |
| Has a phone | `phoneNumber IS NOT NULL` | Can't text otherwise |
| Real conversation | `durationSeconds >= 15` | Excludes hangups / robocalls / wrong numbers |
| Recent | `createdAt` within the last **24h**, **older than 45 min** | Timely relationship message; the 45-min floor lets the shop's own callback go first |
| Not already recovered | `metadata.recoverySmsAt` unset | One-shot |
| Not opted out | phone not in `customers.smsOptOut = 1` | (transport `sendSms` re-checks this too) |
| In business hours | 9am–5pm ET | Never text off-hours |
| Under the run cap | ≤ **15** sends per run | Human-scale volume |

## Controls (the two gates)

| `missed_call_recovery` flag | `MISSED_CALL_RECOVERY_SEND` env | Behavior |
|---|---|---|
| off | (any) | **Disabled** — cron no-ops entirely |
| **on** | unset / `0` | **SHADOW** — identifies + logs + Telegrams the audience (masked phones + copy), **sends nothing**, claims nothing |
| **on** | `1` | **LIVE** — claims `metadata.recoverySmsAt` then sends via the orchestrator |

- The flag lives in the `feature_flags` DB table (set via `setFlag` / admin).
- The env lives on the Railway service `MAINnicks-tire-auto`. Changing it
  triggers a redeploy so the running process picks it up.

### Go live
```
railway variables --service MAINnicks-tire-auto --set "MISSED_CALL_RECOVERY_SEND=1"
```
Recommended: enable the flag first (shadow), watch one business-hours
Telegram run to eyeball the real audience + copy, **then** flip the env.

### Kill-switch (instant)
```
# Back to shadow (stops sends, keeps identifying the audience):
railway variables --service MAINnicks-tire-auto --set "MISSED_CALL_RECOVERY_SEND=0"

# Full off (cron no-ops):
#   set feature flag `missed_call_recovery` = false (admin flags UI / setFlag)
```

## Compliance model

- **Opt-out / STOP:** enforced twice — the job filters `customers.smsOptOut`,
  and the transport `sendSms` re-checks its own opt-out cache (the TCPA net
  hardened after the non-customer-STOP incident). The STOP footer is
  auto-appended by `sendSms`.
- **Quiet hours + caps:** applied by the orchestrator for
  `vapi_forwarded_call_followup` (it "must NOT skip quiet-hours, caps, or the
  STOP footer" — see `smsOrchestrator.ts`).
- **At-most-once (no double-texts):** two independent guards —
  1. Durable stamp `metadata.recoverySmsAt` on the call log, claimed with a
     conditional `UPDATE … WHERE recoverySmsAt IS NULL` **before** the send
     (survives restarts).
  2. `orchestrateSms` idempotency key is per `vapiCallId`, so a call already
     followed up (by the webhook path *or* a prior run) is never re-texted.

## Monitoring

- **Telegram:** each run posts a summary. Shadow → the would-be audience;
  live → count sent.
- **Who got texted:** `SELECT phoneNumber, metadata FROM vapi_call_logs
  WHERE JSON_EXTRACT(metadata,'$.recoverySmsAt') IS NOT NULL` — the stamp is
  the durable record of a recovery send.
- **Logs:** logger scope `cron:missed-call-recovery`.
- **Read-only audience preview** (no state change, any time):
  filter `vapi_call_logs` by the eligibility rules above.

## Tests

`server/__tests__/missedCallRecovery.test.ts` locks the eligibility rule
(window edges, no-phone, converted/captured, one-shot, hangup < 15s,
too-soon / too-old). Shared-SMS regression is covered by
`smsOrchestrator.golden.test.ts` (unchanged, 39/39).

---

## Appendix — the 2026-07 HomeV2 + Recovery arc (context)

Wave F shipped alongside the homepage/order-funnel overhaul. For the record:

| Wave | PR | What |
|---|---|---|
| A–C | #708 | HomeV2 subtract-and-route homepage (old page kept as `HomeLegacy.tsx` for rollback); FCFS `UrgencyWidget` fix; `$289→$266` reconcile; conversion events persisted to `customer_events`; MyGarage confirm-hang fix; UTM hero personalization |
| D | #708 | Tire order money-path: **variant price-guard fix** (expected price = MIN across brand+model variants — kills false "Price has changed" rejections), Stripe-return handler, silent-submit inline error, server-error surfacing |
| G | #708 | Tire cards show real feed specs (load+speed chip) + live stock chip |
| E | #710 | Abandoned-form durability — `abandoned_forms` table (migration `0081`, applied 2026-07-13) so partials survive restarts |
| F | #720 | **This doc** — missed-call recovery SMS |

Rollback for HomeV2: point the `/` route back at `HomeLegacy.tsx`.
