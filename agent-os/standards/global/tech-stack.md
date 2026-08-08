# Tech Stack

Versions verified from the workspace catalog + installed tree. The catalog is
the source of truth; this doc is the rationale.

## Language & runtime

- **TypeScript 5.9** (strict) · **Node >= 24** · ES modules

## Monorepo tooling

- **pnpm 10** (pinned via `packageManager`) · **Turborepo 2.10**
- **pnpm catalog** (`pnpm-workspace.yaml`) for shared version pinning — add
  shared deps to `catalog:` and reference `catalog:` in the package
- **syncpack** + **sherif** keep versions aligned · **lefthook** git hooks
- **Prettier** formatting (double quotes, printWidth 80 — see code-style)

## Shared libraries

- **React 19** · **Tailwind CSS v4** · **lucide-react**
- **tRPC 11** (`@trpc/server` + `@trpc/client`) for typed client↔server calls
- **Zod 4** for schema validation at every boundary
- **Vitest 3** for tests

## Adding to the stack

- Prefer a library already in the catalog.
- New shared dep → add to `catalog:`, reference `catalog:` in packages.
- Check the upstream-adoption record before proposing anything new.
- New heavy dependency → justify against bundle size, maintenance, and
  supply-chain risk. Review the pnpm `overrides` block before pulling in
  transitive risk.

## Dependency installs

If dependencies or `pnpm-lock.yaml` change:

```bash
pnpm install --frozen-lockfile --filter "<app>..."
```

**Keep the `...` suffix** — a bare `--filter` skips workspace deps and produces
phantom import failures.
