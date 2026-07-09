# 2026-05-25 · Audit-Fix Session · Wave Summary

**Pattern in use** · two-session split. Audit session reads from
`OneDrive/Desktop/Nicks Tire Euclid/main-readonly-audit/` and catalogs
findings into the task board. This (fix) session reads tasks, applies
surgical fixes from `C:\Users\nourd\NOURCITY\`, commits to origin/main,
verifies prod 200 after Railway redeploy.

## Sessions

| Side | Checkout | Role |
|---|---|---|
| Fix | `C:\Users\nourd\NOURCITY\` (writable) | Edit + commit + push + smoke |
| Audit | `OneDrive/.../main-readonly-audit/` (read-only) | Read + grep + catalog into shared task store |

## Waves shipped (all live on origin/main)

| Wave | Commit | Findings fixed | Lines | Risk |
|---|---|---|---|---|
| **A** | `c8e4de56` | #87 · cross-dyno cron lock on tiered scheduler | +37/-3 | low |
| **B** | `948ceb70` | #151 · placeOrder server-side price floor · #152 · $0 tire filter | +109/-6 | medium (security) |
| **C** | `b3ba9e8c` | #98 #99 #100 #101 · SA v2 tier shuffle + INSERT IGNORE + cooldown abort + migration 0050 | +99/-22 | medium (data + schema) |
| **D** | `a79f23a9` | #113 · Stripe webhook half-config detection · #117 · ?paid=1 URL cleanup | +22/-1 | low |
| **E.1** | `44de4a12` | #106 · VAPI artifact-transcript fallback · #107 · convertedToLead UPDATE in bookSlot + tireInquiry | +48/-2 | low |
| **F** | `8d91d5c5` | #111 · STATENOUR_SYNC_URL fallback (9 server files) · #164 · autonicks.com SITE_URL comment | +14/-11 | low |
| **H** | `916419f4` | statenour · CSP connect-src + ollama.com + localhost:11434 · activeProviderSupportsTools allowlist (not blanket true) | +22/-3 | low |
| **J** | `37c05377` | #216 · self-healing DB reset (3 sites, ESM mutation no-op → resetDbConnection) · #217 · memory threshold inversion (95/97 swap, degraded branch made reachable) | +27/-18 | low |

**Total** · 8 commits · ~15 P0/P1 findings · 1 new migration (0050).

## Operator-action required (post-deploy)

1. **Migration 0050** · `apps/nickstire/drizzle/0050_wave_audit_unique_pred_surface.sql`
   needs hand-applying to TiDB prod per CLAUDE.md "Migrations are
   hand-applied SQL". After apply, verify · `SHOW INDEXES FROM
   prediction_impressions` should list `uk_prediction_surface`. INSERT
   IGNORE in crossSellOutreach.ts is a no-op until the index exists.

2. **STRIPE_WEBHOOK_SECRET** · if it isn't set on Railway, Wave D's
   #113 fix will start returning 500 from the webhook handler. That's
   intentional · forces visible failures in the Stripe dashboard
   instead of silent drops. Set the env var on Railway to clear.

3. **Verify cron lock** · trigger a job from admin while watching
   Railway logs · expect `"manual run skipped — cross-dyno lock held by
   another process"` if the tier was mid-firing the same job. Otherwise
   clean acquired/released log pair.

## Deferred from these waves

- **#114** · confirmCheckout phone validation · needs client-side
  localStorage flow to pass phone without putting it in the success
  URL. Deferred to its own wave.
- **#115** · 2% card-fee undercount · already self-corrects in
  finalizeTireOrderPayment (totalAmount = full Stripe-charged amount).
  Audit's concern is the "received but not yet paid" window only.
  Closed without code change.
- **#157** · serviceFeePerTire DEFAULT 3500 vs 0 · audit's clarity-gate
  Round B verification found this was a FALSE POSITIVE. Schema +
  migration both say DEFAULT 3500. No fix needed.
- **#94 + #104 + #105** · `{ via: "shop" }` sweep across 17 SMS sites.
  Mechanical defense-in-depth · MEMORY note "wave-181.60 (May 18) · SMS
  routing default flipped Twilio→shop" means omitting `via` is
  already safe. Deferred to dedicated sweep wave for explicit-intent
  hardening.
- **NickHealthSection → usePollingFetch** refactor (statenour Wave H
  subset) · ~80 LOC structural change · deferred for dedicated session.
- **Migration journal entries for 14 out-of-band migrations** · audit
  finding requires `SHOW COLUMNS` audit per table before deciding
  whether to add journal entries (table-already-applied path) or
  re-apply with IF NOT EXISTS guards (truly missing path). Operator
  decision needed.

## Verification approach (per audit session)

The audit session ran its own clarity-gate Round B pass on the 9
highest-stakes P0 claims · result · **7/9 verified exactly · 2/9
partial (count/framing only) · 0 hallucinated**. Findings sampled
~87% exact, 100% directionally correct. Confidence is high that
the remaining unverified findings are also real.

## What's NOT in this summary

- The other 23+ NEW findings the audit session's parallel verifiers
  surfaced after this fix session finished waves A-J. Those are
  cataloged as tasks #275+ in the audit session's task store and
  await the next fix session.

- The dual-self-healer landmine the verifier surfaced (broken one
  wired up, working one orphaned) · Wave J fixed the BROKEN one
  in-place rather than rewiring. The working one
  (`services/selfHealing.ts`) was already serving the cron path
  correctly · the broken one (`lib/self-healing.ts`) handled startup,
  request tracking, and manual-recovery, all of which now use
  `resetDbConnection()` properly.
