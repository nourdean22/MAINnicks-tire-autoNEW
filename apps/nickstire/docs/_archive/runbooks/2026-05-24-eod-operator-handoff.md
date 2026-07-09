# 2026-05-24 EOD · Operator handoff

> **UPDATE 2026-05-24 LATE-EOD · FULLY ACTIVATED.** Operator said "im
> ready turn it all on" · all 3 manual gates closed autonomously via
> the `nickActions.runMigrations` admin tRPC mutation + `featureFlags
> .toggle` mutations (Chrome MCP fetch from authenticated admin tab).
> Migration 0061 ran clean (41/41 statements applied, 0 errors). Both
> flags ON. v2 model verified returning 50 affinities with
> modelVersion `v2-heuristic-2026-05-24`.
>
> The "Step 1-4" instructions below are PRESERVED for reference but
> are now historical · the manual-gate activation path is no longer
> needed.

The autonomous session shipped Intelligence Dispersal end-to-end and the
Service Affinity v2 closed-loop architecture. This doc captures what is
LIVE, what needs your hand to fully activate, and the order to do it.

Companion docs:
- `docs/2026-05-24-intelligence-dispersal-plan.md` — the dispersal map
- `docs/2026-05-24-service-affinity-v2.md` — the SA v2 design

---

## What landed (code · all live in prod)

### Intelligence Dispersal (7 waves complete)
- **Wave 1 · CUT** — IntelligenceSection.tsx + intelligence/ directory
  entirely deleted from the admin. -1370 LOC nickstire.
- **Wave 1.5 · bridge + /scoreboard** — `master_report` bridge action
  (NICKSTIRE-QUERY-CONTRACT v11.5) + statenour `/scoreboard`
  NickHealthSection consumer with 4-KPI grid + 13-signal collapsible
  breakdown. Refreshes every 120s.
- **Wave 2 · UI absorption** — relevant signals inlined into existing
  admin pages (Money, Customers, Leads, Outreach, Voice).
- **Wave 3 + #78 + #79 · statenour gap surfaces** —
  - `/funnel` · 6-stage Lead→Estimate→Drop-off→Job→Review→Retained +
    per-source first-visit conversion (v11.6 bridge actions)
  - `/seo` · GSC clicks/impressions/CTR/position + top 10 queries +
    top 10 pages (v11.7 added `gsc_top_pages`)
  - `/radar` · brand pulse (review velocity + sentiment) + competitive
    gap + market share + content performance (pure projection of
    master_report · no new bridge)

### Service Affinity v2 (4 waves · code complete · 2 manual gates)
- **Wave 1 · MODEL + SCHEMA** — v2 buildServiceAffinityMap rewrite
  (recency × seasonal × not-recently-had heuristic · per-customer
  confidence + reason + modelVersion). 4-table schema in
  `drizzle/0061_service_affinity_v2.sql`.
- **Wave 2 · CLOSED-LOOP** — `service_affinity_acted_to_revenue_14d`
  resolver in `closedLoop.ts` · ties prediction → outcome via
  prediction_actions/outcomes tables · returns 0-100% booking rate.
- **Wave 3 · OPERATOR SURFACE** (Elon-style ONE surface) — Customers
  roster gets a "Next Service" column (predictedNext + confidence% +
  reason tooltip · `xl:table-cell`, non-sortable · read-only · auto-
  SMS handled by Wave 4 cron, not a roster button).
- **Wave 4 · CRON CONSUMER** — `cron/jobs/crossSellOutreach.ts` rewired
  to read predictions from `service_affinity_predictions` (treatment
  arm + ≥50% confidence) · writes `prediction_impressions` +
  `prediction_actions` for closed-loop measurement · resilient to
  missing tables (upfront table-exists check returns one warn rather
  than 600/day if you flip the flag before applying the migration).
- **Cron registration** — `service-affinity-compute` registered in the
  hourly tier (`scheduler.ts` · every 2h · feature-flag-gated).

---

## What needs your hand (~2 minutes when at workstation)

The TiDB Cloud session expired during the session and I can't enter
credentials per safety rules. Both gates are easy from your workstation.

### Step 1 · Apply migration 0061 (creates 4 closed-loop tables)

```bash
# From repo root (NOURCITY/) with DATABASE_URL in env or in .env:
DATABASE_URL=mysql://... pnpm tsx apps/nickstire/scripts/apply-wave-181-sa-v2.ts

# OR via Railway CLI on the nickstire service:
railway run -- pnpm tsx apps/nickstire/scripts/apply-wave-181-sa-v2.ts
```

The script is idempotent (`CREATE TABLE IF NOT EXISTS`) · re-runnable ·
verifies all 4 tables exist after apply · records the hash in
`__drizzle_migrations` · appends a journal entry.

Tables created:
- `service_affinity_predictions` — per-customer prediction (with
  confidence + features_json + model_version + ab_arm enum)
- `prediction_impressions` — when the prediction was "shown" (selected
  for outreach)
- `prediction_actions` — operator/cron action (sms_sent · dismissed ·
  snoozed · called · modified)
- `prediction_outcomes` — did the customer return for the predicted
  service within 14d (matched flag + invoice_id FK)

### Step 2 · Flip `service_affinity_v2_compute` ON

Admin → Settings → ShopDriver HQ → Feature Flags → search for
`service_affinity_v2_compute` → toggle ON.

The compute cron runs every 2h (it's in the hourly tier). Within ~2h
of the flip, you'll see predictions populated in
`service_affinity_predictions` · 50 per run · 50/50 A/B split between
`treatment` and `control` arms.

### Step 3 · Verify predictions populated (after ~2-6h)

Easiest path — hit the v11.8 status endpoint:
```bash
curl https://nickstire.org/api/nour-os/query?q=service_affinity_v2_status | jq
```

Healthy response shape:
```json
{
  "data": {
    "ok": true,
    "migrated": true,
    "predictions": {
      "total": 50,
      "treatment": 24,
      "control": 26,
      "armRatioTreatmentPct": 48,
      "armSplitHealthy": true,
      "avgConfidenceTreatment": 62.4,
      "avgConfidenceControl": 61.8,
      "distinctModelVersions": 1
    },
    "cron": { "lastTick": "2026-...", "ageMinutes": 12, "running": true },
    "closedLoop": { "impressions": 0, "smsSent": 0, "outcomesMatched": 0 }
  }
}
```

Red flags · `migrated:false` (run the script) · `cron.running:false`
(check feature flag + scheduler logs) · `armSplitHealthy:false` (re-
seed `SA_V2_AB_SEED` env var if the hash is skewed for this customer base).

Also visible in admin: Customers roster → "Next Service" column on
desktop (`xl:table-cell`).

### Step 4 · Flip `sms_cross_sell_outreach` ON

Same admin path · search for `sms_cross_sell_outreach` · toggle ON.

The cross-sell cron now reads from `service_affinity_predictions` ·
filters to `ab_arm='treatment' + confidence ≥ 50%` · 30d cooldown per
phone · TCPA opt-out check · MAX_SMS_PER_RUN=10 (slow ramp · raise
after lift math validates). Sends via F25e (`{ via: "shop" }`) with the
brand-voice-tightened wave-181.46 wording.

### Step 5 · 14-day lift math

After 2 weeks of compute + outreach running:
```bash
curl https://nickstire.org/api/admin/closed-loop/service_affinity_acted_to_revenue_14d
```

This returns the booking-rate % from treatment-arm predictions (vs
the future-control-resolver). Above baseline = v2 model + outreach is
working · below baseline = roll back the cross-sell flag and re-tune
the heuristic.

---

## Operator decisions still open

These were flagged in the design docs and the session deferred them:

1. **A/B baseline math** — currently `service_affinity_acted_to_revenue_14d`
   measures only treatment-arm booking rate. A separate control-arm
   resolver + a lift resolver that joins them is the obvious next step
   once Wave 2-4 deliver real data.
2. **Confidence threshold tuning** — `MIN_CONFIDENCE_TO_ACT = 50` is a
   reasonable default ("more likely than not") but should be re-tuned
   against the first cohort of outcomes. Higher threshold = fewer
   sends but higher booking rate per send.
3. **MAX_SMS_PER_RUN = 10** — keep low until lift math validates.
   Raise to 25-50 after 2 weeks if booking rate is at or above
   baseline.
4. **Drawer + brain panel surfaces** — the design contemplated 3 v2
   surfaces (roster column + customer drawer tile + statenour /brain
   panel). The Elon move for Wave 3 shipped ONE (roster column).
   Drawer + brain surfaces are deferred until usage proves the roster
   isn't enough. YAGNI.

---

## Pending operator-only actions (unrelated to this session)

- `#55` — Verify BDI live via test call. Requires a real outbound test
  call to a known number. Not something I can execute.

---

## Bridge contract version history (relevant to this session)

- **v11.5** (2026-05-24) — `master_report` action
- **v11.6** (2026-05-24) — `funnel_overview` + `funnel_first_visit`
- **v11.7** (2026-05-24) — `gsc_top_pages` (for the new /seo surface)
- **v11.8** (2026-05-24) — `service_affinity_v2_status` (SA v2
  activation observability · curl-friendly · no admin login needed
  to check the gate worked)

All three statenour pages (`/scoreboard`, `/funnel`, `/seo`, `/radar`)
follow the same resilience pattern · graceful self-hide on bridge
failure · matches the editorial-minimalist visual contract
(`border-white/10 bg-white/[0.02]` · `text-[10px] uppercase
tracking-[0.18em] text-white/40` eyebrows).

---

## Quality gates passed

- `pnpm run check` (nickstire) · 0 errors
- `pnpm exec tsc --noEmit` (statenour) · 0 errors
- `pnpm run validate:routes` (nickstire) · 0 errors / 0 warnings
- iOS PWA primitives sweep · 0 new regressions
  (`grep '\(window\.\)\?\(prompt\|alert\|confirm\)('` across client
  src returned only comments, tests, and the ConfirmDialog source)
- Pre-push affected build · turbo cached · 4/4 success

---

## Commits (latest first)

- `aa648205` — wave-181.x #79 · /seo + /radar statenour surfaces +
  gsc_top_pages bridge (v11.7)
- `ed0a50c6` — SA v2 cron upfront table-exists check (resilience)
- `2977e886` — SA v2 Wave 3+4 · operator surface + cron consumer
- `eceb45b5` — migration apply script `scripts/apply-wave-181-sa-v2.ts`
  (committed earlier · ships with this handoff)

---

The session ran ~3.5h+ of dense work. The architecture is in place ·
the manual gates are the operator's 2-minute activation step.
