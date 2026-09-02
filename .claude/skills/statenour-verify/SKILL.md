---
name: statenour-verify
description: Use before committing or pushing changes to the statenour app (apps/statenour/) — the real local verification sequence and the two gates that silently pass when run naively.
---

# statenour-verify

Verify a statenour change is safe to commit/push. The gate names are
non-obvious and two of them silently lie if run carelessly.

## Run, in order (from `apps/statenour/`)

1. `pnpm typecheck` — `tsc --noEmit`. Must be 0 errors.
2. `pnpm lint` — `eslint .` (2026-07 consolidation; the old
   `lint:source` script no longer exists — if you see it referenced,
   that doc is stale).
3. `pnpm test` — vitest. Must end `Test Files N passed (N)`, exit 0.
4. (full gate) `pnpm verify:hard` — typecheck:raw + lint + test +
   check:raw-sql + check:crons + check:stale-docs (strict) +
   prompt:size-check + prisma validate.

## Traps

- **A typecheck error inside `.next/types/**` is a STALE LOCAL ARTIFACT,
  not your diff.** Symptom: `tsc --noEmit` fails on
  `.next/types/validator.ts` — `Cannot find module '../../app/api/<x>/
  route.js'` — for a route that does not exist. Cause: `main` deleted the
  route after your worktree's last `next build`; the generated validator
  still enumerates it. Fix: **overwrite** the offending generated file
  (e.g. write a one-line comment into it); the next build regenerates it.
  Do NOT recursively delete `.next/types` — `Remove-Item -Recurse` on a
  worktree path is policy-blocked (the junctions walk into the primary
  checkout). Witnessed 2026-08-07 on `app/api/system/prompt-compare`.
- **`pnpm test | tail` masks the exit code.** A piped command's exit
  status is `tail`'s (0), not vitest's. Read the actual
  `Test Files … failed` summary line, or run `pnpm test; echo "EXIT=$?"`
  with no pipe.
- **PowerShell `Select-String` is case-insensitive by default.** A vitest
  summary capture with a bare `'Tests'` pattern also matches `tests 14ms`
  inside the Duration line — witnessed 2026-08-04: four mutation probes
  printed Duration lines as their "results" and verified nothing. Use
  `-CaseSensitive` with an anchored pattern (`'^\s*Tests\s+\d'`), and read
  one captured line before trusting a batch of them.
- **`typecheck` does NOT cover `tests/`.** A green `tsc --noEmit` says
  nothing about test-fixture correctness — only a test run does. Proven
  2026-07-30 (#1238): a test fixture omitted a newly-required field on
  an interface, typecheck exited 0, and vitest was the only thing that
  caught it. Never report "verified" off typecheck alone.
- **TS2307 "cannot find module" in a file OUTSIDE your diff = stale-junction
  phantom, not your regression.** Worktree node_modules are junctions to the
  PRIMARY checkout; if the primary sits behind main, packages added since
  (witnessed 2026-08-27: `edge-tts-universal` from #1930) do not resolve.
  Confirm with `git show HEAD:apps/statenour/package.json | grep <pkg>` vs
  what is installed - the fix is refreshing the PRIMARY checkout, never
  patching the app.
- **lefthook's parallel pre-commit jobs can flake red under memory
  pressure** and pass unchanged on retry (witnessed twice 2026-08-27:
  statenour-typecheck 149s red -> green, agent-os-verify red while the
  same command passed standalone). Rerun ONCE before diagnosing; twice
  red at identical duration = real.
- **TS2307 "cannot find module" in a file OUTSIDE your diff = stale-junction
  phantom, not your regression.** Worktree node_modules are junctions to the
  PRIMARY checkout; if the primary sits behind main, packages added since
  (witnessed 2026-08-27: `edge-tts-universal` from #1930) do not resolve.
  Confirm with `git show HEAD:apps/statenour/package.json | grep <pkg>` vs
  what is installed - the fix is refreshing the PRIMARY checkout, never
  patching the app.
- **lefthook's parallel pre-commit jobs can flake red under memory
  pressure** and pass unchanged on retry (witnessed twice 2026-08-27:
  statenour-typecheck 149s red -> green, agent-os-verify red while the
  same command passed standalone). Rerun ONCE before diagnosing; twice
  red at identical duration = real.
- ~405 eslint `any` warnings are pre-existing and non-blocking — only
  `error`-severity problems fail the gate.
- Vitest can abort with a native `failed to delete napi ref` crash on
  Windows (exit 0xC0000409) right after other heavy node processes —
  that's infra flake, not a test failure. Re-run standalone.
- Pushing `main` deploys statenour to Railway; the repo-level pre-push
  hook runs `turbo build`, NOT the test suite — confirming a green
  `pnpm test` locally is on you.
- **Never invoke `cross-env` bare in PowerShell, and never trust a
  `FINAL_EXIT=$LASTEXITCODE` sentinel after a `&&` chain.** Witnessed:
  chaining gates through `... && cross-env STALE_DOCS_STRICT=1 pnpm
  check:stale-docs && ...` broke at bare `cross-env` — CommandNotFound is
  a resolution error, not an exit code, so the trailing sentinel printed
  **0** while three gates had silently never run. Use
  `$env:VAR='1'; pnpm <script>` instead, and **count the gate outputs
  rather than reading the sentinel** — a green sentinel after a broken
  chain reports the last RESOLVED command.
- **`check:lint-baseline` reporting NEW FILE on a file outside your diff
  is dep-bump archaeology, not your regression.** Confirm with
  `git diff origin/main -- <file>` (empty = not yours), then compare the
  baseline snapshot's last commit against the last eslint bump — a bump
  mints new warning classes in files nobody touched. Witnessed 2026-08-06:
  `app/(mastery)/system/fleet/page.tsx` was byte-identical to `main`
  while #1357's eslint dev-minor bump minted a fresh react-hooks class.
  Root `AGENTS.md` classifies this check non-blocking-red: **disclose it,
  chip the fix, do not absorb it into your PR.**
- **A prompt section joins the budget/trim economy ONLY with a `## `
  title.** `trimPromptToBudget` splits on `\n## ` and nothing else, so
  `###` sub-blocks FUSE into the preceding `## ` section and the trimmer
  can then only keep or drop the fused blob wholesale. Root cause of
  #1450: the Master Content Engine's ~30 `###` sub-blocks fused into one
  atomic ~80k section, so the 65k runtime slice dropped the ENTIRE engine
  on the primary lane — every non-anthropic content turn served with no
  content engine, behind a `prompt:size-check` that had been red since
  #687 and that everyone had learned to ignore.
- **A fire-and-forget write sharing a mocked model with the code under test
  spills calls ACROSS tests.** `vi.clearAllMocks` cannot fence an unawaited
  promise — the Phase-1 memory gateway's shadow receipts ride the SAME mocked
  `brainMemory.create` the tests spy on, and receipts from earlier tests land
  in later tests' spy windows (5 visible in one window; red on main for a day,
  #1532). Assert with a discriminator filter (e.g.
  `category !== "memory_gateway_shadow"`), never raw call counts, and treat
  `calls[0]` reads as the same hazard.

## Before shipping any report / diagnostic section

**Prove the source receives rows from the path it claims to observe.**
Run the query against prod — code inspection is not enough. A filter
whose discriminator value has no writer renders a fabricated all-clear,
and it is invisible to tests, typecheck, and lint.

This shape landed three times in one day (2026-07-30):

| Read | Reality |
|---|---|
| `apiRequestLog` where `path` starts `/api/ai/chat` | chat route never passes through the request logger — 0 rows ever |
| `ai_generations` where `status='failed'` | writers only ever emit `complete` / `error` |
| `error_logs` where `level='fatal'` | writers only ever emit `error` / `warn` |

Corollary: **a failed read must never render as good news.** Distinguish
"query failed" from "genuinely empty" — reference implementation is
`lib/observability/fleet-truth.ts`, where a thrown probe becomes
`unknown` and `unknown` never counts as healthy.

**When a finding rests on what a structure does NOT contain, read the
WHOLE structure by its delimiters — never a line-number window.**
`sed -n '/const typeMap/,/};/p'`, not `sed -n '140,165p'`. A truncated
read of a map is how orphaned-subject false positives are manufactured:
witnessed 2026-08-26, an audit reported nickstire's `typeMap` as having
"no mapping that yields booking" — delivered to the operator as a
finding — because the window cut off the map's head, whose first line is
`"nickstire:booking": "booking"`. Refuted only when fix work forced a
full read. Absence claims inherit the blast radius of "not in the repo
is a fact about your search": prove the search saw the whole subject.

## Confirming a merge is DEPLOYED

"Merged" and "deployed" are different claims. Confirm via the
unauthenticated deploy surface, and compare by ANCESTRY, never equality:

```bash
DEPLOYED=$(curl -s https://bdnick.info/api/version | jq -r .data.build.commit)
git merge-base --is-ancestor <your-merge-sha> "$DEPLOYED" && echo LIVE
```

Two waiter failure modes witnessed 2026-08-26, same session:
- **SHA equality breaks the moment a sibling merges** — the deployed SHA
  legitimately overtakes the one you await (watched prod run two
  later commits containing nothing of mine, then one containing
  everything; an equality waiter would call all three "not deployed").
- **A prefix longer than `commitShort` never matches** — the endpoint's
  `commitShort` is `sha.slice(0, 7)`; a 9-char comparison printed
  "still not deployed" forever over a build that was already live.
  Compare full SHAs via ancestry, or exactly 7 chars, nothing between.

## When the operator DECLINES a gate finding

A gate that always fails is a gate everyone learns to ignore — the exact
rot this repo keeps removing. So when the operator waives a finding:

- Waive **by signature, not by filename.** Put a marker on the offending
  line with a dated reason. Excluding the whole file blinds the check to
  every future violation in it.
- **Red-green the waiver:** green with it in place, and a fresh violation
  in the same file must still fail. Verify both; don't assume.
- Precedent: `check:anti-slop` + the stats-page gradient (#1239).

## Extra checks worth running (not in `verify:hard`)

- `pnpm check:anti-slop` — UI slop signatures (Inter/Roboto/Arial fonts,
  purple SaaS gradients). Line-level `anti-slop-allow` waivers.
- `pnpm check:policy-coverage` — every active cron has an
  AutomationPolicy row. **Needs prod `DATABASE_URL`**, so it can never be
  a CI/pre-push gate; run it manually.
- **Skill-registry freshness** — if `data/skills-registry.json`
  `generatedAt` is stale or `scripts/audit-skill-embeddings.ts` reports
  missing embeddings, the recall layer is blind to recently-installed
  skills. Refresh with `build-skill-registry.ts --merge` (**never
  `--force`** — it drops entries belonging to your other machines), then
  embed. Target state is `verdict: IN SYNC ✓`.

## When no statenour toolchain exists on the box

Witnessed 2026-09-02 (#2068): the primary checkout's `apps/**` had been wiped,
every worktree's `apps/statenour/node_modules` junction dangled, and
`pnpm install` inside a worktree is policy-blocked — so `typecheck`, `lint`
and the full vitest could not run anywhere. What still verifies, in order:

1. **Pure helpers run under the SIBLING app's vitest.** Put an ad-hoc config
   INSIDE `apps/nickstire/` (a config in the scratchpad cannot resolve
   `vitest/config`): `root` = the statenour dir, `resolve.alias["@"]` = that
   dir, `test.include` = your test files; run
   `apps/nickstire/node_modules/.bin/vitest run --config <it>`; delete the
   config after. Proves the helper, not the app.
2. **Static `check:*` scripts run under nickstire's `tsx`.** These ran
   without statenour deps: `anti-slop`, `et-clock`, `stale-docs` (STRICT),
   `raw-sql`, `get-auth`, `mutations:strict`, `soft-delete`, `crons`,
   `runbooks`. These could NOT load: `prompt-injection` (needs `glob`),
   `policy-coverage` (needs `@prisma/client` and prod `DATABASE_URL`).
3. **Commit + push from a hookless sparse scratch clone**, because the
   lefthook pre-commit typecheck and pre-push build would fail on the missing
   toolchain: `git clone --no-checkout <url> <dir>` · `git sparse-checkout
   init --cone` · `git sparse-checkout set apps/statenour` · branch from
   `origin/main` · `git apply` the patch from your worktree · commit · push.
   No install, so no hooks. **Disclose it in the PR body** ("commit pushed from
   a hookless scratch clone; CI is the gate") and merge only on fully green.

## Before calling a wave done

The author's own hostile pass is necessary, not sufficient. On the 2026-09-01
nickstire wave it found 5 defects; three parallel independent reviewers over
the full diff (silent-failure, schema + cross-app contracts, client/docs) found
24 more, including two P0 regressions the wave introduced. Dispatch reviewers
per subsystem with a file:line brief and a "verified OK / not checked" answer
shape, verify their top findings yourself, then declare done.

## Running an operator script that needs real credentials

`.env.local` is **not** the full credential set — several keys live only
on Railway. A provider-failure cascade is not proof of a billing problem
until you check which lanes actually had keys.

> Prefer `railway run --service statenour-web <cmd>` over hand-exporting
> vars. It injects the real environment, so the preferred provider lane
> actually gets tried.

Proven 2026-07-30: `embed-skills.ts` failed every provider (HuggingFace
402 credits-depleted, OpenAI 429 quota) and looked billing-blocked. The
real cause was that **Cohere — first in the chain and the only lane pinned
to 1024 dimensions — has no key locally but does on Railway.** Under
`railway run` it embedded 8 skills in one second.

Dimension trap in the same chain: Cohere pins `output_dimension: 1024`
and rejects anything else, but the OpenAI fallback returns **1536** with
no length guard. "Succeeding" on that fallback would silently poison a
1024-dim corpus — check `embedding_dim` after any embedding backfill.

## When NOT to use

Non-statenour work, or nickstire (it has its own `pnpm run verify`).
