# Dream-to-Proof — the loop, and where each piece lives

**One runtime, five primitives.** Everything else is a projection, an evaluator, or a UI over these. Shipped 2026-09-15 across `apps/nickstire`, `apps/statenour`, `scripts/` and `.github/workflows/`. The research behind the verdict (why this and not the twelve-subsystem "NOUR DARWIN" plan) is the Reality Loop report; this file is the map.

```
GOAL CONTRACT ──► REALITY LEDGER ◄── code / site / shop
   frozen first        │  events + graded claims
                       ▼
                 EXPERIENCE GYM ── real failures become episodes
                       │
                       ▼
                 MUTATION LAB ──── Night Shift: 3–5 candidates, Pareto frontier, ONE PR
                       │
                       ▼
                 PROOF ENGINE ──── deterministic gates → critics → preview → sequential experiment → physical outcome
                       │
                       ▼
                 DECISION RECEIPT ─ human merge · taste judgment · flag flip
                       │
                       └──────────► StateNour remembers (BrainMemory, OPERATOR tier) ───┐
                                                                                         └──► next night
```

## The primitives

| Primitive | Where | What it is |
|---|---|---|
| **Goal Contract** | `apps/nickstire/goals/*.json` · `shared/goalContract.ts` | Frozen before results: surfaces, truth sources, protected invariants, the ONE metric, guardrails, minimum evidence, kill criteria, rollback. `contractHash()` travels with every verdict. `authorityFor(grade)` is the evidence thermostat — the highest grade still ends at a *recommendation*. |
| **Reality Ledger** | `apps/statenour/prisma` (`reality_events`, `evidence_claims`, `taste_judgments`) · `lib/services/reality-ledger.ts` · `POST/GET /api/sync/evidence` | OCEL-style events (one event, many objects) + claims graded H0–H5. PII-shaped payload keys are refused at the door. Langfuse traces carry the same grade via `lib/observability/evidence-metadata.ts`. |
| **Experience Gym** | `apps/nickstire/tests/episodes/*.json` · `tests/e2e/episodes.spec.ts` · `scripts/proof/promote-episode.mjs` | Goal + viewport + tap/time budget + success oracle. Deterministic Playwright is the oracle. A failure writes a record; `promote-episode.mjs` compiles it into the next episode. |
| **Mutation Lab** | `scripts/night-shift/` | One nightly headless run: reads the ledger (failures and refuted claims first), picks one contract, generates 3–5 genuinely different candidates, keeps the Pareto frontier, opens ONE PR. Never merges. |
| **Proof Engine** | nickstire `pnpm run verify` chain · `playwright.config.ts` · `.github/workflows/nickstire-proof.yml` (Argos + sitespeed.io) · `shared/experimentKernel.ts` · `server/cron/jobs/webExperimentResolve.ts` | Layers, cheapest first: typecheck/lint/brand-voice/PII → episodes + a11y invariants → screenshot/ARIA diff (Argos) → Core Web Vitals (sitespeed.io) → critics → flag-gated live experiment judged by the sequential kernel (mSPRT, SRM check, guardrails) → physical outcome. |

## Where the site, admin and shop meet

`shared/shopState.ts` + `server/services/shopState.ts` → `shopStatus.getState`. Hours + booking-derived capacity + an aggregate lot count (flag `shopstate_lot_band`, no plate column is ever selected) + Open-Meteo → `light / steady / busy / unknown` bands, a weather risk, a recommendation, and an evidence line per input. `useWeatherCTA` is now a pure projection of it. The property test in `shared/shopState.test.ts` proves no derived state ever carries a plate/customer/phone-shaped key and never says open outside `BUSINESS.hours`.

## The rule that makes the loop safe enough to be creative

**Evaluator separation.** `config/agent-os/evaluator-paths.json` lists the judges. A `darwin/*` or `night-shift/*` branch that edits one is red (`scripts/agent-os/check-evaluator-separation.mjs`, canaried in `evaluatorSeparation.test.mjs`, enforced on PRs by `.github/workflows/evaluator-separation.yml`). Changing a judge is a normal branch, reviewed as a judge change.

## Operating it

1. **The first experiment is armed** (`web_experiment_home_hero_subline_2026_09` flipped on 2026-09-15; `GET /api/trpc/experiments.active` lists it). Flip it off in the admin flags panel to return every visitor to control. The daily `web-experiment-resolve` cron proposes a verdict over Telegram; nothing is applied.
2. **Read `/proof`** (statenour): claims by grade, recent reality, standing claims, your judgments, Night Shift proposals.
3. **Record taste**: `POST /api/proof/taste` with two candidates, a winner, reason codes from `TASTE_REASON_CODES`. It mirrors into BrainMemory at OPERATOR trust.
4. **The lot band is on** (`shopstate_lot_band`, 2026-09-15). It reads `unknown` until the camera bridge heartbeats again — `shopStatus.getState` says `lot:offline (no recent observation)` when the flag is on but `camera_runtime.receivedAt` is stale, and bare `lot:offline` when the flag is off.
5. **Night Shift**: run `scripts/night-shift/run.ps1` by hand first; register with `register-task.ps1` when you trust it. Give it `EVIDENCE_LEDGER_KEY` (statenour env var; opens `/api/sync/evidence` only) — never `STATENOUR_SYNC_KEY`, which is the whole cross-app bridge. `run.ps1` scrubs the bridge key from the child process on purpose.
6. **The migration is applied** (`20260915140000_reality_ledger`, 2026-09-15; `prisma migrate status` clean). `/proof` shows a not-migrated banner if a future environment lacks it.

## Kill criteria

- Any customer-facing change reaches `main` without a human merge → stop everything; this is the one true incident.
- Three consecutive Night Shift PRs rejected for something a deterministic gate should have caught → unregister the task, fix the gate, add its canary.
- An H4 claim later contradicted by H5 data more than rarely → freeze the kernel's held-out-metric rule and re-audit.
- Nightly review costs more time than doing the change by hand → cut scope, not polish.
