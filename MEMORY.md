# Memory index (nickstire repo)

Read **`CLAUDE.md`** (repo root) for operating rules. Use this file as a **router**, not a duplicate of the business vision doc.

## Where things live

| Topic | Location |
|-------|-----------|
| Business constants (phone, address, hours, reviews display) | `shared/business.ts` |
| SEO page definitions | `shared/seo-pages.ts`, `shared/services.ts`, `shared/cities.ts`, `shared/intersections.ts` |
| API / tRPC | `server/routers/`, composed in `server/routers/index.ts` |
| Cron / background | `server/cron/scheduler.ts`, `server/cron/jobs/` |
| DB schema | `drizzle/schema.ts` |
| Declined work recovery | `server/services/declinedWorkRecovery.ts`, `dispatch.declinedLedger` / `markRecovered` / `recordDeclineOutreach` |
| Env reference | `.env.example`, `docs/security/ENV_AUDIT.md` |
| Site usage (URLs, admin paths) | `USAGE-MANUAL.md` |

## After substantive changes

1. Run `pnpm run check` and `pnpm test`.  
2. If SEO HTML changed, run `pnpm run prerender` before release.  
3. Bump `truth_os.md` if production behavior or env requirements changed.
