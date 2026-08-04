# Dev Workflow — Local + CI Guardrails

> **Refreshed 2026-08-04** — the hook runner is **lefthook**, configured in the
> repo-root `lefthook.yml`. Husky is retired: there is no `.husky/` directory and
> no `prepare` script. An earlier version of this page described the husky layout
> and told contributors to bypass with `--no-verify`; both are corrected below.

## Local hooks

**`pre-commit`** (repo-root `lefthook.yml`, `root: "apps/nickstire"`, staged-glob
scoped) runs, in parallel with the statenour jobs:
1. `pnpm run lint:brand-voice` — claim safety
2. `pnpm run lint:source` — custom source linter (no console.* in server, any/sql counts)
3. `pnpm run lint:hooks` — `audit-hook-after-return.mjs` (wave-76, prevents
   the wave-65-style hook-after-early-return crash)
4. `pnpm run validate:routes` — route registry
5. `pnpm run check` — TypeScript

**`pre-push`** runs `pnpm run build:affected`.

**Never bypass with `--no-verify`.** It is forbidden by the canonical policy
(root `AGENTS.md` → "Branching") — a slow hook is a reason to fix the hook, not
to skip the gate. If a check is genuinely wrong, change the check in a PR.

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
