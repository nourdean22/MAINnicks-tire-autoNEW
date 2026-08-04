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
- ~405 eslint `any` warnings are pre-existing and non-blocking — only
  `error`-severity problems fail the gate.
- Vitest can abort with a native `failed to delete napi ref` crash on
  Windows (exit 0xC0000409) right after other heavy node processes —
  that's infra flake, not a test failure. Re-run standalone.
- Pushing `main` deploys statenour to Railway; the repo-level pre-push
  hook runs `turbo build`, NOT the test suite — confirming a green
  `pnpm test` locally is on you.

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
