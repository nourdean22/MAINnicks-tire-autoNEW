# Handoff

## State
Built 655 total systems for nickstire.org across 2 mega sessions. 38 router files (45 appRouter entries, 122+ procedures), 28 services, 6 lib modules, 6 middleware, 10 cron jobs, 67 DB tables, 307 SEO pages (260 service+city + 50 intersection + 21 city), 44 pages, 51 components. All pushed to main, build passes from both `C:/Users/nourd/OneDrive/.../NICK TIRE/repo` (editing) and `C:/Users/nourd/nickstire` (dev server). Financing audit complete: 0 Synchrony, 0 Sunbit, correct dealer URLs for Acima/Snap/Koalafi/AmericanFirst. Review count updated to 1,700 everywhere. Stale duplicate dirs deleted (48K lines). All middleware wired into Express, cron jobs registered, 10 new tRPC routers wired into appRouter.

## Next
1. **Test every tRPC endpoint on live server** — `shop.getStatus`, `estimates.generate`, `serviceMatcher.match`, `specials.getActive`, `workOrders.getRecent`, `inventory.getAll`, `warranties.getExpiringSoon`, `waitlist.join`, `fleet.inquiry`
2. **Run `drizzle-kit push`** to create the 16 new tables in production DB (customers UUID version removed, but vehicles/workOrders/specials/warranties/inventory/waitlist/cronLog/webhookDeliveries/otpCodes/auditLog/pushSubscriptions still need creating)
3. **Enable feature flags incrementally** — SMS appointment reminders first, then review requests, then retention sequences
4. **Build remaining tRPC procedures** — `customers.search`, `orders.calculateTotals`, `admin.getDashboard`, `analytics.trackEvent`, `content.generate`

## Context
- Two repo dirs: `C:/Users/nourd/OneDrive/.../NICK TIRE/repo` (edit here) and `C:/Users/nourd/nickstire` (dev server). Must sync files between them + sync package.json for deps.
- `nickstire.org` = PRIMARY domain. Zero `autonicks.com` in customer-facing code.
- NOT Next.js — Vite + React + Wouter. Ignore all "use client" / Next.js hook suggestions.
- NO manualChunks in vite.config.ts. Feature flags all start DISABLED.
- shopStatus.ts had broken import from client code — fixed to use inline hours logic.
- customerLookup.ts fixed to use int IDs (matching real customers table) not UUIDs.
- Duplicate customers/referrals table defs in schema.ts were removed (kept originals).
- User added: abandonedForms service, featureFlags seeder, warrantyAlerts cron, dashboardSync cron, staleLeadFollowup cron, more intersection data (50 total).
- Financing rules: "Pay Over Time" not "Financing Options", no "credit" in headers, Synchrony/Sunbit = ZERO refs.
