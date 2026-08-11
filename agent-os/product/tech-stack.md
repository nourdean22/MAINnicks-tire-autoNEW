# Tech Stack — NOURCITY

**The shared stack is the standard, not a copy of it.** Read
[`agent-os/standards/global/tech-stack.md`](../standards/global/tech-stack.md), whose own canonical
source is [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml) (`catalog:`). If this file and the
catalog disagree, **the catalog wins** — re-run `/discover-standards` to refresh.

Shared across every app: **TypeScript 5.9** (strict) · **Node ≥ 24** · ESM · **pnpm 10** ·
**Turborepo 2.10** · **React 19** · **Tailwind CSS v4** · **tRPC 11** · **Zod 4** · **Vitest 3** ·
**lefthook** · **Prettier**.

## Per-app deltas — where the two products genuinely differ

The apps are independent: different frameworks, different databases, different domains. They share
only this repo, the tooling, `main`, a small bridge contract and the workspace packages. **Do not
generalize a pattern from one app to the other.**

| | `apps/nickstire` | `apps/statenour` | `apps/worker` |
|---|---|---|---|
| Framework | Vite 7 + React 19 PWA client · Express 4 server | Next.js 16 (App Router) | Express 4 + node-cron |
| ORM | Drizzle | Prisma 6.19 | **none** |
| Database | TiDB Cloud (MySQL) | Neon Postgres (pgvector/tsvector via **raw SQL only**) | **no DB client** — all I/O over authenticated HTTP |
| Migrations | Hand-applied SQL in `drizzle/*.sql` — no auto-migrate | Hand-applied — one wrong flag silently drops pgvector | — |
| Deploys to | nickstire.org | bdnick.info | Railway internal |

## Constraints that bite

- **Migrations are hand-applied in both apps.** `prisma db push --accept-data-loss`, `DROP` and
  `TRUNCATE` are protected operations requiring an explicit per-action instruction.
- **`apps/worker` has no database client by design.** A change that needs data there is a design
  error, not a missing dependency.
- **`packages/**` changes hit BOTH web apps** — build the package before testing consumers.
- **Dependency installs need the ellipsis**: `pnpm install --frozen-lockfile --filter "<app>..."`.
  A bare `--filter` skips workspace deps and yields phantom import failures.
- **Tests are not symmetric.** nickstire must run serial (`--pool=forks
  --poolOptions.forks.singleFork=true`) on Windows; statenour needs `@statenour/lenses` built
  first; worker has no suite at all.
- **Check [`docs/UPSTREAMS.md`](../../docs/UPSTREAMS.md) before proposing any new platform, library
  or MCP server.**

Full commands, verify gates and Windows gotchas: [`AGENTS.md`](../../AGENTS.md).
