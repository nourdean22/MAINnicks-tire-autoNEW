# Observability · statenour-os

> **v10.0.529.106 Wave 75 status update**: this doc historically
> claimed 14 /system/* surfaces · post-consolidation there are now 30+
> /system/* sub-pages plus the new Wave 65 `/system/cockpit` (the
> single-pane-of-glass aggregate). The table below is partially
> stale · for the authoritative list run `ls app/(mastery)/system/`
> in the repo. The Wave 65 cockpit + Wave 73 identity-trajectory are
> the recommended morning-ritual entry points · then drill into the
> sub-pages as needed.

The /system/* surfaces and what each one is for. Bookmark this;
you'll navigate faster.

---

## Entry points

| Surface | Purpose | Key signal | Refresh |
|---|---|---|---|
| `/system` | Top-level dashboard | Overall health + drill-down chips | 60s |
| `/system/pulse` (API only) | Tiny vitals rollup · powers the orb | 9 counters in one read | 30s client |

## Observability deck

| Surface | What it shows | Control knobs |
|---|---|---|
| `/system/crons` | 31 scheduled + 5 folded + 1 retired · last-run · duration sparkline · success % · drift detector | kill switch per cron · manual "run now" · kill-all |
| `/system/errors` | ErrorLog grouped by message fingerprint · recent 50 feed | → task conversion · level filter · dismiss |
| `/system/ai-cost` | Today/7d/30d · by feature × model · 14-day trend · burn rate vs 7d avg | window pick · budget wire lives in /system/power |
| `/system/actions` | AutonomousAction audit · rule leaderboard w/ SVG success rings | approval filter · rule drill-down · expand payload |
| `/system/logs` | Unified live tail: ErrorLog + CronJobLog + SystemMetric + AutonomousAction + slow-or-failed ApiRequestLog | level × source × 5m/1h/24h filters · auto-refresh toggle |
| `/system/devices` | Smart-home fleet · staleness grid · command queue | per-device drill · agent-liveness banner when cold |

## Meta-intelligence deck (v11 W12)

| Surface | Question it answers | Data source |
|---|---|---|
| `/system/quality` | Is Nick getting better or worse this week? | `BrainMemory(nick_quality)` scorecards written post-stream by the critic |
| `/system/anti-patterns` | Which past failures should I never repeat? | `BrainMemory(anti_pattern)` — hand-logged + auto-promoted from D/F decisions |
| `/system/decision-drift` | Am I reviewing my decisions? Are my predictions improving? | `MasteryDecision` rows with grade + actualOutcome |
| `/system/ghost-nour` | What would past-Nour do with this situation? | Jaccard similarity over last 500 decisions · 0¢/query |
| `/system/gaps` | What's rotting? | 6-class scanner: dark crons, empty API dirs, tool-catalog drift, stale models, missing env, retired-past-due |

## Power

| Surface | Control |
|---|---|
| `/system/power` | Provider pin · daily cost cap · strict mode · pause-all-crons · quiet mode · shadow mode · danger zone |

---

## Data flow map

```
                                  ┌──────────────────────┐
   Nick chat turn  ───────────┬──>│  AiGeneration table  │─────> /system/ai-cost
                              │   └──────────────────────┘
   Output critic  ──(post)──┐ │
                            ▼ │
   BrainMemory(nick_quality)  │────>  /system/quality ── pulse ──> orb 🧠 badge
                              │
   Post-stream 1                                     │
                              │   ┌──────────────────────┐
   Any cron run ─────────────┼──>│    CronJobLog        │─────> /system/crons
                              │   └──────────────────────┘
                              │
                              │   ┌──────────────────────┐
   Any error boundary ───────┼──>│     ErrorLog         │─────> /system/errors
                              │   └──────────────────────┘
                              │
   executeActions() ────────┬─┼──>│  AutonomousAction    │─────> /system/actions
                            │ │   └──────────────────────┘
                            ▼ │
                      (user prompt)
                              │   ┌──────────────────────┐
   apiHandler wrapper ───────┴──>│   ApiRequestLog      │─────> /system/logs
                                  └──────────────────────┘

   ── nightly ──
   /api/cron/auto-calibrate ──> beliefs refresh + anti-pattern auto-promote
                                  ↓
                                  BrainMemory(anti_pattern) ──> /system/anti-patterns

   /api/cron/data-cleanup ───> truncate per config/retention.ts + BRAIN_MEMORY_RETENTION
                                  ↓
                                  CronJobLog entry w/ per-category deletion counts
```

---

## Navigation

**From the bottom tab bar / More sheet:** navigation is the fixed
bottom tab bar + the More sheet (`components/layout/bottom-tab-bar.tsx`
· `more-sheet.tsx`). (2026-07-25 correction: the FloatingHome orb this
section used to describe is retired and its component deleted — only
its smart-now picker survives in `lib/floating-home/smart-now.ts`,
consumed by the More sheet.)

**From the `/system` hub:** the hub grid groups every live system
surface into health / governance / AI / data tiles with live chips,
and lifts degraded surfaces into a needs-attention strip.

**From anywhere:** `⌘K` palette includes every `/system/*` route.
`G` then letter for vim-style jump (`g c` = crons, `g q` = quality,
`g p` = power, `g d` = devices, etc. · see `components/hud/
keyboard-shortcuts.tsx`).

---

## When to look where

| Symptom | Surface |
|---|---|
| "Something's wrong and I don't know what" | `/system` — orb tone + drill to whatever's pulsing |
| "Nick feels dumb lately" | `/system/quality` — check trend + regen rate |
| "My deploy spend exploded" | `/system/ai-cost` — burn rate + by-feature |
| "Which cron is failing?" | `/system/crons` — sort by success-rate |
| "What did Nick do autonomously?" | `/system/actions` — rule leaderboard |
| "What's Nick writing?" | `/system/logs` — filter source=actions |
| "I'm about to decide X" | `/system/ghost-nour` — type X, see past patterns |
| "Have I done this before?" | `/system/anti-patterns` — search library |
| "Am I following through?" | `/system/decision-drift` — grade trend |
| "Pause everything" | `/system/power` — big red buttons |
| "What's rotting under the hood?" | `/system/gaps` — automated scan |
| "Recent request slow?" | `/system/logs` — source=requests + slow filter |

---

## Metadata shapes

Shared types live at [`lib/brain/memory-metadata-types.ts`](../lib/brain/memory-metadata-types.ts).
Every `/system/*` consumer that reads `BrainMemory.metadata` should
import from there instead of redefining inline.

| BrainMemory category | Shape |
|---|---|
| `anti_pattern` | `AntiPatternMeta` · attempt, outcome, severity, domain, revisitCount, tags |
| `nick_quality` · `reply_quality` | `NickQualityMeta` · overall, specificity, cliche, antiNour, length, shouldRegen, turnIntent, turnShape |
| `power_panel` | `PowerPanelMeta` · value, updatedAt, note |
| `cron_control` | `CronControlMeta` · enabled, updatedAt, note |
| `identity_snapshot` · `belief` · others | read from the row (content + confidence only) |

## Retention policy

Table retention: [`config/retention.ts`](../config/retention.ts) ·
`RETENTION` · 20 models documented.
BrainMemory category retention: same file ·
`BRAIN_MEMORY_RETENTION` · 5 volatile categories capped (60-365d).

Enforced weekly Sunday 3am UTC by `/api/cron/data-cleanup` · writes
per-category deletion counts to `CronJobLog.output`.

---

## Last updated

v11.0 · 2026-04-22 · 14 surfaces live, 114 tools, 15 `@relation`, tsconfig.strict=true, 0 secrets in git history.

---

**Reconciled at v10.0.484** · 2026-05-08 EOD · this doc was reviewed against the live state of the OS in the v10.0.442-484 sprint reconciliation pass. See `docs/cohort-2026-05-08-eod-summary.md` for the sprint summary and which sections of this doc were touched. If a claim in this doc contradicts code reality, the code wins · open an issue.
