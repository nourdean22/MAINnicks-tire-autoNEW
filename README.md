# Nick's Tire & Auto — nickstire.org

Monorepo: **Vite 7 + React 19** (client), **Express 4 + tRPC 11** (server), **Drizzle ORM** + TiDB/MySQL, deployed on **Railway**.

## Quick start

1. **Node:** 20+ (CI uses 22). **pnpm:** 9+.
2. Copy env: `cp .env.example .env` and fill required keys (see `.env.example` headers).
3. Install: `pnpm install`
4. Dev server: `pnpm dev` — serves API + Vite client.
5. Typecheck: `pnpm run check`
6. Tests: `pnpm test`

## Layout

| Path | Purpose |
|------|---------|
| `client/src` | React app, pages, admin |
| `server` | Express entry `_core/index.ts`, `routers/`, `services/`, `cron/` |
| `shared` | Shared constants (`business.ts`, SEO data) |
| `drizzle` | Schema (`schema.ts`) + SQL migrations |
| `scripts` | Prerender, sitemap, deploy helpers |
| `prerendered` | **Generated** static HTML — regenerate with `pnpm run prerender`, do not hand-edit for NAP/SEO facts |

## Agent / operator docs

- `MEMORY.md` — index of where to look next  
- `truth_os.md` — what is supposed to be true in prod (update when shipping)  
- `architecture_map.md` — high-level request flow  
- `CLAUDE.md` — project operating rules for AI  

## Database migrations

After pulling schema changes, apply SQL in `drizzle/` to your database (e.g. `0026_work_order_items_decline_recovery.sql`) using your standard migration process, then `pnpm run check`.
