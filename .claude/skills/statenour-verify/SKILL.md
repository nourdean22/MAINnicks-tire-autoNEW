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
- ~405 eslint `any` warnings are pre-existing and non-blocking — only
  `error`-severity problems fail the gate.
- Vitest can abort with a native `failed to delete napi ref` crash on
  Windows (exit 0xC0000409) right after other heavy node processes —
  that's infra flake, not a test failure. Re-run standalone.
- Pushing `main` deploys statenour to Railway; the repo-level pre-push
  hook runs `turbo build`, NOT the test suite — confirming a green
  `pnpm test` locally is on you.

## When NOT to use

Non-statenour work, or nickstire (it has its own `pnpm run verify`).
