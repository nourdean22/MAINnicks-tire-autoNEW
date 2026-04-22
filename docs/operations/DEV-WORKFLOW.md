# Dev Workflow — Local + CI Guardrails

## Local hooks

**Husky pre-commit** lives at `.husky/pre-commit`. It runs:
1. `pnpm run lint:source` — custom source linter (no console.* in server, any/sql counts)
2. `pnpm run check` — TypeScript
3. `pnpm run test --bail=1` — bail on first test failure

**Enable it once:**
```bash
pnpm add -D husky
pnpm exec husky init
# The .husky/pre-commit file is already in place; it'll be activated.
```

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
