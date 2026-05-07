# Dev Workflow — Local + CI Guardrails

> **Refreshed 2026-05-07 wave-78** — husky already initialized (the
> bootstrap "Enable it once" section was removed since it confused
> contributors); pre-commit hook gained `pnpm lint:hooks` (wave-76)
> for React Rules-of-Hooks enforcement.

## Local hooks

**Husky pre-commit** at `.husky/pre-commit` runs:
1. `pnpm run lint:source` — custom source linter (no console.* in server, any/sql counts)
2. `pnpm run check` — TypeScript
3. `pnpm run test --bail=1` — bail on first test failure
4. `pnpm run lint:hooks` — `audit-hook-after-return.mjs` (wave-76, prevents
   the wave-65-style hook-after-early-return crash)

The hook is already active. Running `pnpm install` re-applies it via the
`prepare` script if it ever falls off.

If a hook run is too slow, bypass with `git commit --no-verify` (avoid
unless you have a very good reason; CI will still block on push).

## CI workflow

`.github/workflows/test.yml` runs on every push + PR to main:
1. Env validation (`pnpm env:validate`)
2. TypeScript check (`pnpm check`)
3. Prettier lint (`pnpm lint`)
4. Source lint (`pnpm lint:source`) — new
5. Tests with coverage (`pnpm test --coverage`)
6. Full production build (`pnpm build`)

Any step failing blocks the merge/deploy. That's the point.

## Dependabot

`.github/dependabot.yml` runs weekly (Monday 09:00 ET) and groups updates:
- `radix-ui` — all @radix-ui/*
- `tanstack` — all @tanstack/*
- `trpc` — all @trpc/*
- `aws-sdk` — all @aws-sdk/*
- `types` — all @types/*
- `dev-minor` — all dev deps, minor+patch
- `prod-minor` — all prod deps, minor+patch
- Majors: ignored by default (review by hand)

Max 5 PRs open at any time. GH Actions gets its own schedule (monthly).

## `pnpm run verify`

Full verify chain (same as CI):
```
pnpm run env:validate
  && pnpm run check
  && pnpm run lint
  && pnpm run lint:source
  && pnpm run test
  && pnpm run build
```

Run before any significant push. ~30-60 seconds total.
