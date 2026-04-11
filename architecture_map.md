# Architecture map — nickstire.org

## Request path (simplified)

1. **Browser** → Express (`server/_core/index.ts`).
2. **Static / prerendered** — middleware may serve `prerendered/` for crawlers or configured routes.
3. **Vite dev / built client** — SPA from `client/`; routing via Wouter.
4. **API** — `/api/trpc/*` → tRPC router tree (`server/routers/index.ts`).
5. **Webhooks** — e.g. Twilio under `server/routes/webhooks/`.
6. **Cron** — `server/cron/scheduler.ts` runs tiered timers that call job modules in `server/cron/jobs/`.

## Data

- **ORM:** Drizzle (`drizzle/schema.ts`).
- **Connection:** `DATABASE_URL` (MySQL/TiDB).

## Key subsystems (pointers only)

| Area | Entry |
|------|--------|
| Auth / admin context | `server/_core/context.ts`, OAuth in `_core/oauth.ts` |
| AI routing | `server/lib/ai-gateway.ts` |
| SMS | `server/sms.ts`, Twilio webhook, `server/routers/smsBot.ts` |
| Work orders / ShopDriver | `server/services/workOrderService.ts`, `server/routers/shopdriver.ts` |
| Logging | `server/lib/logger.ts` (`createLogger`) |

## Client

- **tRPC client:** `client/src/lib/trpc.ts`.
- **Admin:** `client/src/pages/admin/*`, command surfaces under `/admin` and related routes per `USAGE-MANUAL.md`.
