# nickstire — System Map (Audit Phase 0 · 2026-07-03)

**App:** `apps/nickstire` → nickstire.org · Railway (Nixpacks) deploy from `main`
**Stack (verified):** Vite 7 + React 19 + Tailwind 4 PWA client (`client/`) · Express 4 + tRPC 11 (`server/`) · Drizzle ORM → MySQL/TiDB (`drizzle/schema.ts`, hand-applied SQL migrations) · pnpm 10 / Node ≥20 · Vitest.

## Entry points
- Server bootstrap: `server/_core/index.ts` (esbuild-bundled to `dist/index.js`; `start` = `node dist/index.js`)
- Client: `vite.config.ts` → `client/` SPA (wouter router), route registry `shared/routes.ts` (gated by `validate:routes`)
- Build: `vite build` + esbuild server bundle + `scripts/build-maybe-prerender.mjs` (puppeteer prerender → `prerendered/`, 336 files)
- Webhooks: `server/routes/webhooks/{twilio,vapi,smsGateway}.ts`
- Non-tRPC Express routes: `server/routes/` (analytics, meta/CAPI, push, nour-os bridge, admin, simulator…)
- Cron: `server/cron/jobs/` — ~40 jobs (daily report, reels, review monitor, SMS recovery, sitemap/SEO forensic, statenour sync…)

## Scripts & gates
`pnpm run verify` = env:validate → typecheck:raw → prettier lint (docs only) → lint:source → lint:hooks → lint:brand-voice → lint:pii → validate:routes → vitest → build.

## Env inventory (top refs)
DATABASE_URL(129) · VAPI_API_KEY(80) · AUTO_LABOR_USERNAME/PASSWORD · OPENAI_API_KEY · REEL_* arms · STATENOUR_SYNC_KEY/URL · GOOGLE_SERVICE_ACCOUNT_* · STRIPE_SECRET_KEY · SHOP_SMS_GATEWAY_* · TWILIO_* · SMS_KILL_SWITCH · ADMIN_API_KEY · META_CAPI_ACCESS_TOKEN · GOOGLE_SHEETS_CRM_ID · PRERENDER_MODE · SITE_URL.
Required-at-boot (env-validate): NODE_ENV, PORT, DATABASE_URL, JWT_SECRET, ADMIN_API_KEY, VITE_GOOGLE_OAUTH_CLIENT_ID (+ prod: GOOGLE_OAUTH_*, OWNER_OPEN_ID).

## Change velocity
Recent nickstire commits: storefront hero/CTA fix (#478), design-token alignment (#461), social pipeline health (#459/#460). Bulk of monorepo velocity is statenour; nickstire is in maintain/grow mode.

## Deploy
`nixpacks.toml` appends ffmpeg + dejavu fonts for reel assembly. Prod start = single Node process; health/error-handling assessed in Phase 9.
