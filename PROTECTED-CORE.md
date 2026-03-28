# Protected Core — Do Not Casually Refactor

These files, routes, and systems are load-bearing. Changes require smoke tests and careful validation.

## TIER 1: CRITICAL PATH (breaks everything if wrong)

| File | Why | Blast Radius |
|------|-----|-------------|
| `server/_core/index.ts` | Express app setup, middleware chain, route mounting | ALL endpoints |
| `server/_core/trpc.ts` | tRPC context, auth procedures, admin guard | ALL tRPC endpoints |
| `server/routers.ts` | Router registry — 45 routers mounted | ALL API contracts |
| `drizzle/schema.ts` | 68 table definitions — every query depends on this | ALL data access |
| `server/db.ts` | DB connection pool | ALL data access |
| `client/src/App.tsx` | Route definitions, lazy imports | ALL client pages |

**Rule:** Never edit these without running `bash scripts/smoke-test.sh` after.

## TIER 2: DAILY-DRIVER PATH (breaks /cc if wrong)

| File | Why | Blast Radius |
|------|-----|-------------|
| `server/routers/controlCenter.ts` | 8 endpoints powering /cc | Control center + telemetry |
| `client/src/pages/ControlCenter.tsx` | Entire daily-driver UI | /cc page |
| `server/lib/ai-gateway.ts` | AI routing, circuit breaker, health | All AI features |
| `server/cron/index.ts` | Job runner, timeout, overlap prevention | All background jobs |

**Rule:** Test with smoke test + manual /cc check.

## TIER 3: BUSINESS-CRITICAL (breaks revenue if wrong)

| File | Why | Blast Radius |
|------|-----|-------------|
| `server/routers/booking.ts` | Customer appointment flow | Bookings |
| `server/routers/lead.ts` | Lead capture + AI scoring | Lead pipeline |
| `server/routers/callback.ts` | Callback requests | Customer callbacks |
| `server/gemini.ts` | Lead scoring AI | Urgency scores |
| `server/sheets-sync.ts` | CRM sync to Google Sheets | CRM data |

**Rule:** Test the specific business flow after changes.

## TIER 4: INFRASTRUCTURE (breaks operations if wrong)

| File | Why |
|------|-----|
| `.env.example` | Config documentation |
| `package.json` | Dependencies + scripts |
| `drizzle/meta/_journal.json` | Migration history |
| `client/index.html` | PWA meta, fonts, analytics |
| `client/public/manifest.json` | PWA install config |

## DEPENDENCY HEATMAP (most depended-on → most dangerous to change)

```
drizzle/schema.ts        ████████████████████ (68 tables, every query)
server/_core/trpc.ts     ████████████████     (45 routers depend on it)
server/routers.ts        ███████████████      (mount point for everything)
server/db.ts             ██████████████       (every DB query)
server/lib/logger.ts     █████████████        (51 files import this)
server/lib/cache.ts      ██████████           (15 files import this)
server/lib/ai-gateway.ts ████████             (7 files import this)
```

## SAFE-CHANGE RULES

1. **Tier 1 changes:** Require smoke test + server restart + manual /cc verify
2. **Tier 2 changes:** Require smoke test + /cc verify
3. **Tier 3 changes:** Require specific flow test
4. **Tier 4 changes:** Require `pnpm build` success check
5. **Schema changes:** Never ALTER production tables without migration file
6. **New routers:** Must be mounted in routers.ts AND exported from routers/index.ts
7. **New env vars:** Must be added to .env.example with comment
8. **New cron jobs:** Must use registerJob() pattern with error handling
