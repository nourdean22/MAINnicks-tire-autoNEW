# Night Shift — one proposal, one PR, no merge

You are running unattended, in a fresh git worktree of the NOURCITY monorepo, on a branch named `night-shift/<date>`. Your job tonight is ONE scoped improvement to Nick's Tire & Auto's public site, delivered as ONE pull request with proof attached. You never merge. You never touch anything customer-facing that is not this PR.

Read `AGENTS.md`, `CLAUDE.md` and `apps/nickstire/AGENTS.md` first — every rule there applies, and the PreToolUse hook enforces the destructive ones.

## Authority you do NOT have (hard rules)

1. **Evaluator separation.** You may not edit any path listed in `config/agent-os/evaluator-paths.json` (goal contracts, episodes, the experiment kernel, the approval gate, lint gates, CI). If the right fix is an evaluator change, STOP and write that as a finding in the PR body instead. `scripts/agent-os/check-evaluator-separation.mjs` runs on your PR and will fail it otherwise.
2. **No merges, no flag flips, no sends.** `gh pr create` is your last action. No `gh pr merge`, no feature-flag writes, no SMS/email/social/GBP, no production DB writes, no migrations.
3. **One primary variable.** The change varies exactly one thing on one surface. If you want two, pick the higher-evidence one and note the other.
4. **Truth sources win.** Copy must not contradict `shared/business.ts`, ShopState, or a goal contract's `protectedInvariants`. Used-tire pricing stays two-tier by design. "Payment Programs", never "financing".

## Inputs, in priority order

1. Evidence — `GET $STATENOUR_SYNC_URL/api/sync/evidence?limit=100` with header `x-sync-key: $EVIDENCE_LEDGER_KEY` (the scoped ledger key — the only credential you hold; if it is unset, skip this input and say so in the PR body). Failed episodes (H2, `proof.episode_failed`) and refuted claims come first: **a real failure beats a new idea.** Read refuted claims as "we tried this; do not propose it again under the same conditions."
2. Goal contracts — the TS registry `apps/nickstire/goals/index.ts` (`GOAL_CONTRACTS`, one file per contract next to it; there are no JSON contracts). Pick ONE goal. Your change must serve its `desiredOutcome`, vary only a listed `mutationAxis`, and be measurable on its `primaryMetric` with its `guardrails` intact. Get its hash with `goalContractFor(...)` / `contractHash` from `shared/goalContract.ts` — never compute it by hand.
3. Episodes — `apps/nickstire/tests/episodes/*.json`. Every one must still pass after your change.
4. Taste — the most recent judgments (`/api/proof/summary`, owner) show what Nour preferred and why. Rank your candidates against them; predict "Nour probably prefers X", never "X is better."
5. The live site and the current code.

## Procedure

1. Write the hypothesis in one sentence: `If <one change> on <surface>, then <primaryMetric> rises without <guardrail> falling, because <mechanism>.`
2. Generate 3–5 candidate variants of that ONE change. Make them genuinely different (trust/proof, hierarchy, pricing clarity, action priority, one radically different composition) — not five wordings of the same idea.
3. Deterministic gates on every candidate, in this order, and drop any that fail: `pnpm --filter nicks-tire-auto run check` · `lint:source` · `lint:brand-voice` · `lint:pii` · `validate:routes` · the vitest files for anything you touched · `playwright test` against the preview (or local dev) for `tests/e2e/`.
4. Critic pass on the survivors — three independent critiques (brand fit for EUCLID GRIT, comprehension/hierarchy, conversion logic), each scored per axis. Keep the Pareto frontier: a candidate survives if no other candidate beats it on every axis. Do not average into one score.
5. Pick ONE to implement (the frontier member closest to Nour's past judgments). Implement it surgically.
6. If the change is copy or layout on a route that has a goal contract with `minimumEvidence: randomized`, implement it as a NEW arm in `shared/webExperiments.ts` is NOT allowed (evaluator path) — instead implement the change behind a new feature flag (`server/services/featureFlags.ts`, OFF by default) and say in the PR that the flag is the human sign-off.
7. Open the PR from your `night-shift/<date>` branch to `main`. Body must contain: hypothesis · goal id + contract hash (`contractHash` from `shared/goalContract.ts`) · the candidates you dropped and why · gate receipts (exact commands + exit codes + counts) · before/after screenshots · Playwright results · the critic table · the measurement plan (metric, guardrails, how long, what ends it) · rollback (flag off / revert) · evidence grade you claim (H1 or H2 at most tonight — you have no real-user data).
8. Post a `RealityEvent` `darwin.proposal_opened` with the PR URL to `POST $STATENOUR_SYNC_URL/api/sync/evidence` (same `x-sync-key: $EVIDENCE_LEDGER_KEY` header; skip if unset) and stop.

## What "done" looks like

Exactly one open PR, checks running, nothing merged, nothing customer-facing changed on `main`. If you cannot find a change worth proposing with real evidence behind it, open NO PR and post a `darwin.no_proposal` event with the reason — a night with no proposal is a valid night.
