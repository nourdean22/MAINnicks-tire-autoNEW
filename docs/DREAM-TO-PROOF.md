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
| **Experience Gym** | `apps/nickstire/tests/episodes/*.json` · `tests/e2e/episodes.spec.ts` · `scripts/proof/promote-episode.mjs` · hidden holdout: `scripts/proof/unpack-holdout.mjs` + `holdout-summary.mjs` | Goal + viewport + tap/time budget + success oracle. Deterministic Playwright is the oracle. A failure writes a record; `promote-episode.mjs` compiles it into the next episode. A second, **hidden** set (`HO-xxx`, the `HOLDOUT_EPISODES_B64` secret, never in the tree) is replayed by the same runner with the oracles withheld from every title, label and record — the visible episodes are what Night Shift optimises, the holdout is how we learn whether it optimised the page or the test. |
| **Mutation Lab** | `scripts/night-shift/` | One nightly headless run: reads the ledger (failures and refuted claims first), picks one contract, generates 3–5 genuinely different candidates, keeps the Pareto frontier, opens ONE PR. Never merges. |
| **Proof Engine** | nickstire `pnpm run verify` chain · `playwright.config.ts` · `.github/workflows/nickstire-proof.yml` (Argos + sitespeed.io) · `shared/experimentKernel.ts` · `server/cron/jobs/webExperimentResolve.ts` | Layers, cheapest first: typecheck/lint/brand-voice/PII → episodes + a11y invariants → screenshot/ARIA diff (Argos) → Core Web Vitals (sitespeed.io) → critics → flag-gated live experiment judged by the sequential kernel (mSPRT, SRM check, guardrails) → physical outcome. |

## Where the site, admin and shop meet

`shared/shopState.ts` + `server/services/shopState.ts` → `shopStatus.getState`. Hours + booking-derived capacity + an aggregate lot count (flag `shopstate_lot_band`, no plate column is ever selected) + Open-Meteo → `light / steady / busy / unknown` bands, a weather risk, a recommendation, and an evidence line per input. `useWeatherCTA` is now a pure projection of it. The property test in `shared/shopState.test.ts` proves no derived state ever carries a plate/customer/phone-shaped key and never says open outside `BUSINESS.hours`.

## The rule that makes the loop safe enough to be creative

**Evaluator separation.** `config/agent-os/evaluator-paths.json` lists the judges. A `darwin/*` or `night-shift/*` branch that edits one is red (`scripts/agent-os/check-evaluator-separation.mjs`, canaried in `evaluatorSeparation.test.mjs`, enforced on PRs by `.github/workflows/evaluator-separation.yml`). Changing a judge is a normal branch, reviewed as a judge change.

**Producers submit observations; the ledger computes authority (2026-09-15).** The door a request came
through decides how much its claims may be believed and who they are recorded as
(`apps/statenour/lib/services/reality-ledger.ts` `PRODUCER_CEILING` / `PRODUCER_AUTHOR`): the scoped
`EVIDENCE_LEDGER_KEY` (proof workflow, Night Shift) ≤ H2 as AGENT · the bridge key (nickstire's server,
the experiment resolver) ≤ H4 as CRON · only an owner surface asserts H5 as OPERATOR. A claim that asks
for more, or for `createdBy: "operator"` through a key, is refused by index — loud, never clamped. H4
from the resolver rests on a **measured** rule since 2026-09-15: `shared/experimentKernelCalibration.ts`
(re-run it any time with `pnpm calibrate:kernel` from `apps/nickstire/`)
runs the kernel on seeded A/A, injected-effect and broken-split traffic (any-peek false positives 1.3%
over 30 daily reads, 2.2% over 90, against a naive peeked z-test at 26% / 34%; +5pp found 98.7% of the
time with zero wrong-arm calls; a 60/40 split refused 100%). The harness also found and fixed its first
defect the same day: the SRM alarm is peeked daily too, and at the "conventional" per-look p<0.001 it
falsely refused a balanced split in 1.45% of 30-day runs — `DEFAULT_SRM_ALPHA` is 1e-4 now (0.05%
false refusal, 60/40 still caught 100%, 55/45 95.1%), with the old alpha kept as a CONTROL in the
test so the defect stays reproducible. The GrowthBook cross-check is done too
(`scripts/proof/growthbook-crosscheck.py` feeds gbstats' sequential test the SAME daily counts, via
`pnpm calibrate:kernel -- --stream`): the two engines agree run-for-run — A/A 0.8% vs 0.8% on the same
runs, +3pp 66.8% vs 66.6%, +5pp 98.4% vs 98.6%, wrong arm 0% for both (UPSTREAMS row). Lineage is structural: a claim names `sourceEventIndexes` into its
own batch and the ledger stores the created event ids in `sourceEventKeys`, so a verdict rests on its
verdict event instead of travelling beside it. PII is refused recursively (nested keys, email/phone/VIN
shaped values, `objects[].id`, `source.uri`, claim text).

**Night Shift cannot merge — as a capability, not a sentence.** Inside a `.worktrees/night-shift-*` cwd
the PreToolUse policy denies `gh pr merge`, REST/GraphQL merge and auto-merge, `/merges`, rulesets,
branch protection, secrets, workflow toggles, `gh alias set`/`extension install`, any push to a branch
other than `night-shift/*`, and any Write/Edit of a judge in `config/agent-os/evaluator-paths.json`
(plus `.claude/settings.json` and `lefthook.yml`, which decide whether guards run at all). The same
judge list is denied through the shell (Codex review of #2335): a redirect into a judge, `tee`,
`sed -i`/`perl -pi`, `cp`/`mv`/`rm`, `Set-Content`/`Out-File`/`Copy-Item`, `git rm`/`mv`/`checkout`
of the file, inline `node -e`/`python -c` naming it, and `curl -o`/`-OutFile` sinks — and the
engine's read-only skip no longer swallows `cat x > judge` (a redirect is a write). Reading or
running a judge stays allowed. Probed through the real hook in
`scripts/agent-os/nightShiftPolicy.test.mjs`. Residual, stated on purpose: a script file the run
authors that writes a judge path without naming it in the command is beyond any command-text hook;
`evaluator-separation.yml` catches that after the push, and the merge ban holds regardless. The
credential-level boundary landed the same day: `run.ps1` refuses to start unless `NIGHT_SHIFT_GH_TOKEN`
names a SEPARATE identity that `scripts/night-shift/identity-preflight.mjs` (run as the operator)
judges structurally unable to land a change on `main` — read/triage permission with the fork flow, or
write only behind an ACTIVE ruleset that does not bypass it. On the Free plan a private repo has no
rulesets or branch protection (the API answers 403), so read/triage + fork is the boundary; the ruleset
for a Pro repo is in `scripts/night-shift/ruleset-night-shift-boundary.json`. A refusal is a
`darwin.run_refused` ledger event, and the child process holds the token only as `GH_TOKEN`. What the
operator still owns: creating the machine account and its token (README, Identity).

## Operating it

1. **The first experiment is armed** (`web_experiment_home_hero_subline_2026_09` flipped on 2026-09-15; `GET /api/trpc/experiments.active` lists it). Flip it off in the admin flags panel to return every visitor to control. The daily `web-experiment-resolve` cron proposes a verdict over Telegram; nothing is applied.
2. **Read `/proof`** (statenour): claims by grade, recent reality, standing claims, your judgments, Night Shift proposals.
3. **Record taste**: `POST /api/proof/taste` with two candidates, a winner, reason codes from `TASTE_REASON_CODES`. It mirrors into BrainMemory at OPERATOR trust.
4. **The lot band is on** (`shopstate_lot_band`, 2026-09-15). It reads `unknown` until the camera bridge heartbeats again — `shopStatus.getState` says `lot:offline (no recent observation)` when the flag is on but `camera_runtime.receivedAt` is stale, and bare `lot:offline` when the flag is off.
5. **Night Shift**: run `scripts/night-shift/run.ps1` by hand first; register with `register-task.ps1` when you trust it. Give it `EVIDENCE_LEDGER_KEY` (statenour env var; opens `/api/sync/evidence` only) — never `STATENOUR_SYNC_KEY`, which is the whole cross-app bridge. `run.ps1` scrubs the bridge key from the child process on purpose.
6. **The migration is applied** (`20260915140000_reality_ledger`, 2026-09-15; `prisma migrate status` clean). `/proof` shows a not-migrated banner if a future environment lacks it.
7. **The hidden holdout is armed** (2026-09-15): `HOLDOUT_EPISODES_B64` holds three `HO-xxx` episodes on routes the visible five never touch; the plain copy lives outside every checkout at `~/.nourcity-holdout/holdout-episodes.json` (rotate it there, then `base64 -w0 <file> | gh secret set HOLDOUT_EPISODES_B64`). Every proof run posts `proof.holdout` — counts and ids only, or **unmeasured** when the secret is absent, so a missing holdout can never pass by silence. The holdout's report, traces and log never leave the runner. Three consecutive visible-green / holdout-red runs is the overfitting signal: the loop is learning the tests, not the customer.
8. **Read the Repo Time Machine** on `/proof` (or `GET /api/proof/timeline`): one row per commit nickstire.org actually served when judged, newest first, with the visible run, the holdout, and the delta against the previous judged commit (failures introduced and fixed by name). Grouping is on the judged sha, never the requested one — a push-triggered run that measured the previous deploy lands under that deploy.

## Kill criteria

- Any customer-facing change reaches `main` without a human merge → stop everything; this is the one true incident.
- Three consecutive Night Shift PRs rejected for something a deterministic gate should have caught → unregister the task, fix the gate, add its canary.
- An H4 claim later contradicted by H5 data more than rarely → freeze the kernel's held-out-metric rule and re-audit.
- Nightly review costs more time than doing the change by hand → cut scope, not polish.
