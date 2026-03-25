# Nick's Tire & Auto — Phase 4: Integration + Infrastructure Mega-Upgrade

You are working on `nicks-tire-auto`, a full-stack TypeScript app (React 19 + Vite + tRPC + Drizzle ORM + MySQL + Express). It's a local auto repair shop website with booking, CRM, SMS, admin dashboard, and 60+ SEO pages.

## CURRENT STATE

**Branch:** `claude/backend-upgrades-phase-2-ghHi8` has 54 files / 17,850 lines that were written but **only 5 are actually imported**. The rest are orphaned — well-built modules that nothing calls. Your job is to merge that branch into main, then wire in the useful modules, delete the junk, build what's missing, and leave the codebase clean and integrated.

**Main branch:** `origin/main` at commit `3849177`
**Phase 2+3 branch:** `origin/claude/backend-upgrades-phase-2-ghHi8` at commit `0b1c9fa`

**Stack:** React 19, Vite 7, tRPC 11, Drizzle ORM, MySQL (TiDB), Express, Twilio, AWS S3, Tailwind 4, Framer Motion, Radix UI, wouter router

**Key files:**
- Server entry: `server/_core/index.ts` (Express app, middleware, routes)
- Client entry: `client/src/App.tsx` (React app, all routes)
- tRPC routers: `server/routers.ts` (imports all routers from `server/routers/`)
- DB schema: `shared/schema.ts` (Drizzle tables)
- Business constants: `shared/business.ts`
- Email system: `server/email-notify.ts` (Gmail MCP, notification routing)
- SMS system: `server/sms.ts` (Twilio, templates, E.164 normalization)

---

## PHASE 1: MERGE + CLEAN (do this first)

### 1A. Merge the Phase 2+3 branch into main
```
git checkout main
git merge origin/claude/backend-upgrades-phase-2-ghHi8
```
Resolve any conflicts. The branch adds files but barely touches existing ones (only `server/_core/index.ts` and `client/src/App.tsx` have small diffs), so conflicts should be minimal.

### 1B. Delete these orphaned files (over-engineered, not needed)
Remove these files entirely — they add complexity with no business value at current scale:
- `client/src/lib/session-analytics.ts` — GA4 already covers this
- `client/src/lib/user-journey.ts` — GA4 already covers this
- `client/src/lib/pwa-manager.ts` — customers don't install PWAs
- `client/src/components/InstallPrompt.tsx` — same reason
- `client/src/components/OfflineBanner.tsx` — same reason
- `client/public/sw.js` — remove service worker (remove SW registration from App.tsx too)
- `client/src/lib/form-engine.ts` — 634 lines for forms we'll never build
- `client/src/components/SmartFormFields.tsx` — 800 lines, same reason
- `server/metrics.ts` — Prometheus export for a single-shop site, use Railway monitoring
- `server/db-monitor.ts` — depends on metrics.ts, same reason
- `server/rate-limiter-advanced.ts` — existing express-rate-limit with 3 tiers is sufficient
- `server/api-docs.ts` — solo developer, tRPC gives type safety
- `server/seo-automation.ts` — 692 lines of automation for a manual SEO strategy that's working

That's ~6,650 lines of dead weight removed.

### 1C. Delete pre-existing dead code on main
- `server/analytics.ts` — 0 imports, never called
- `server/follow-ups.ts` — 0 imports, superseded by `postInvoiceFollowUp.ts`
- Remove unused `addServiceRecord()` export from `server/db.ts`
- Clean unused exports from `client/src/lib/ga4.ts` (keep only what's imported)
- Clean unused exports from `client/src/lib/metaPixel.ts` (keep only what's imported)

---

## PHASE 2: WIRE IN EXISTING MODULES (already written, just need imports)

### 2A. Cookie Consent + GDPR (LEGAL — do first)
**Files:** `client/src/components/CookieConsent.tsx` + `client/src/lib/consent-manager.ts`
**Action:**
1. Import `CookieConsent` in `client/src/App.tsx` and render it inside the `<ThemeProvider>` wrapper
2. Wire `consent-manager.ts` to gate GA4 and Meta Pixel — do NOT fire tracking scripts until user consents
3. Update `client/src/lib/ga4.ts` to check consent before sending events
4. Update `client/src/lib/metaPixel.ts` to check consent before sending events
5. Store consent in a cookie (NOT localStorage) with 365-day expiry
6. Add consent categories: `necessary`, `analytics`, `marketing`
7. Style the banner to match the dark industrial theme (Tailwind dark classes)

### 2B. Error Tracking
**File:** `client/src/lib/error-tracker.ts`
**Action:**
1. Initialize error tracker in `client/src/App.tsx` at app mount (useEffect)
2. Connect it to the existing `ErrorBoundary` component — when ErrorBoundary catches, report to error-tracker
3. Add server-side error endpoint: `POST /api/track-error` in `server/_core/index.ts` that receives client errors and logs them structured
4. Track: unhandled promise rejections, uncaught exceptions, React render errors, API call failures
5. Include breadcrumbs: last 20 user actions before error (clicks, navigations, API calls)
6. Rate limit error reports (max 10/minute per session to prevent flood)

### 2C. Structured Logging
**Files:** `server/logger.ts` + `server/request-logger.ts`
**Action:**
1. Replace ALL `console.log`, `console.warn`, `console.error` across the entire server directory with `logger.info()`, `logger.warn()`, `logger.error()` from `server/logger.ts`
2. Register `request-logger.ts` as Express middleware in `server/_core/index.ts` BEFORE the rate limiter (so it logs all requests including rate-limited ones)
3. Add correlation ID generation (uuid) per request, pass through tRPC context
4. Log format: JSON with `{ timestamp, level, correlationId, message, data }`
5. Mask sensitive fields in logs: phone numbers, email addresses, API keys
6. Add log levels: in production only log `warn` and above unless `LOG_LEVEL=debug` env var is set

### 2D. Security Middleware
**File:** `server/security-audit.ts`
**Action:**
1. Register as Express middleware in `server/_core/index.ts` after body parser, before routes
2. Block requests containing XSS payloads in query/body params
3. Block requests containing SQL injection patterns
4. Block path traversal attempts (`../`, `..%2f`)
5. Log blocked requests via the new logger (don't just silently drop)
6. Add brute force detection: if same IP triggers 10+ blocks in 5 minutes, temp-ban for 30 minutes
7. Whitelist the admin IP ranges and health check endpoint from security scanning

### 2E. Server-Side Cache
**File:** `server/cache.ts`
**Action:**
1. Import cache in these existing files and wrap their external API calls:
   - `server/google-reviews.ts` — cache Google Places API responses for 1 hour
   - `server/content-generator.ts` — cache generated articles for 24 hours
   - `server/weather.ts` — cache weather data for 30 minutes
   - `server/instagram.ts` — cache Instagram feed for 1 hour
   - `server/gemini.ts` — cache AI search responses for 10 minutes (already has some caching, standardize it)
2. Add cache stats endpoint: `GET /api/admin/cache-stats` (admin-only) returning hit/miss rates, memory usage, namespace breakdown
3. Add cache clear endpoint: `POST /api/admin/cache-clear/:namespace` (admin-only)

### 2F. 404 Tracker
**Files:** `client/src/components/NotFoundTracker.tsx` (already exists), `client/src/pages/NotFound.tsx` (already modified on branch)
**Action:**
1. Verify NotFoundTracker is imported in NotFound.tsx (it should be from the branch)
2. Create admin section to view 404s: add to `server/routers/admin.ts` a `get404Logs` procedure
3. Store 404s in a simple in-memory ring buffer (last 500) with URL, referrer, timestamp, user-agent
4. Add admin UI section "Broken Links" showing the 404 log with frequency counts

### 2G. LazyImage Component
**File:** `client/src/components/LazyImage.tsx`
**Action:**
1. Find all `<img>` tags across client components and replace with `<LazyImage>`
2. Priority: focus on pages with multiple images — Home, ServicePage, Gallery, Blog
3. Add blur-up placeholder (tiny base64 preview while loading)
4. Add WebP format detection and fallback

### 2H. CSRF Protection
**File:** `server/csrf.ts`
**Action:**
1. Register CSRF middleware for all POST/PUT/DELETE routes in `server/_core/index.ts`
2. Exclude webhook endpoints (Twilio SMS webhook, Stripe webhooks if added)
3. Exclude the tRPC endpoint (tRPC has its own CSRF via custom header requirement)
4. Generate CSRF token on GET requests, validate on mutations
5. Store token in httpOnly cookie, validate via X-CSRF-Token header

### 2I. Accessibility Utilities
**File:** `client/src/lib/accessibility.ts`
**Action:**
1. Import focus trap utility and apply to ALL modal/dialog components (booking modal, admin modals, search overlay)
2. Add keyboard navigation: Escape closes modals, Tab cycles through focusable elements
3. Add skip-to-main-content link at top of App.tsx (before nav)
4. Add aria-live region for dynamic content updates (toast notifications, form validation errors)
5. Run contrast audit function on the dark theme — flag any text below 4.5:1 ratio and fix

### 2J. Link Prefetch
**File:** `client/src/lib/link-prefetch.ts`
**Action:**
1. Initialize in App.tsx — prefetch top 3 most common navigation targets on idle
2. Prefetch on hover: when user hovers a nav link for >100ms, prefetch that route's chunk
3. Prefetch service pages from the Home page (users commonly navigate Home → Service)
4. Do NOT prefetch admin pages (waste of bandwidth for non-admin users)

### 2K. Image Optimizer (Server)
**File:** `server/image-optimizer.ts`
**Action:**
1. Wire into the S3 upload flow in `server/storage.ts`
2. On upload: compress images to WebP, generate thumbnail (200px wide), store both
3. Add sharp as dependency (`npm install sharp`)
4. Add endpoint `GET /api/image/:key?w=400&q=80` for on-demand resizing
5. Set Cache-Control headers on optimized images (1 year, immutable)

### 2L. Webhook Manager
**File:** `server/webhook-manager.ts`
**Action:**
1. Keep for future Stripe integration — don't wire in yet
2. Add HMAC signature validation helper that Stripe webhooks will use
3. Document the integration point in the file header

### 2M. Search Overlay
**Files:** `client/src/components/SearchOverlay.tsx` + `client/src/lib/search-client.ts`
**Action:**
1. Import SearchOverlay in App.tsx, render it (it should use Cmd+K / Ctrl+K to open)
2. Wire search-client.ts to call the existing tRPC `public.aiSearch` and `public.search` procedures
3. Add recent searches (stored in React state, not localStorage)
4. Add popular/suggested searches: "brake repair", "tire prices", "oil change", "check engine light"
5. Add search result categories: Services, Blog Posts, FAQ, Pages

---

## PHASE 3: BUILD NEW (high-impact features that don't exist yet)

### 3A. Email Retry Queue
**Where:** Enhance `server/email-notify.ts`
**Action:**
1. Add a simple in-memory retry queue (max 3 attempts, exponential backoff: 1s, 5s, 30s)
2. On email send failure, push to retry queue instead of failing silently
3. Process retry queue every 10 seconds via setInterval
4. Log all failures with attempt count via structured logger
5. After 3 failures, log as CRITICAL and send push notification to CEO
6. Add delivery stats to admin health dashboard: sent/failed/retrying counts

### 3B. Two-Way SMS (Inbound Message Handling)
**Where:** New `server/routers/smsInbound.ts` + update `server/_core/index.ts`
**Action:**
1. Add Twilio webhook endpoint: `POST /api/webhooks/twilio/inbound` in `server/_core/index.ts`
2. Validate Twilio signature on inbound requests
3. Store inbound messages in a new `sms_messages` table:
   ```
   sms_messages: id, customer_phone, direction (inbound/outbound), body, twilio_sid, created_at
   ```
4. Add to Drizzle schema in `shared/schema.ts`, run migration
5. When inbound SMS received: match phone to customer record, store message, send push notification to admin
6. Add admin UI: "SMS Inbox" section showing conversations threaded by phone number
7. Add admin action: "Reply" button that sends SMS back via existing Twilio setup
8. Add auto-reply for after-hours messages: "Thanks for texting Nick's! We're currently closed. Our hours are Mon-Sat 8AM-6PM, Sun 9AM-4PM. We'll get back to you first thing!"

### 3C. Stripe Payment Links
**Where:** New `server/routers/payments.ts` + new admin section
**Action:**
1. Install Stripe SDK: `npm install stripe`
2. Add env vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
3. Create tRPC router `payments` with procedures:
   - `createPaymentLink` (admin) — generates Stripe payment link for a specific amount + description
   - `listPayments` (admin) — lists recent payments from Stripe
   - `getPaymentStatus` (admin) — check status of a specific payment
4. Add Stripe webhook endpoint: `POST /api/webhooks/stripe` in `server/_core/index.ts`
5. On successful payment: update invoice status, send thank-you SMS to customer, log in communication history
6. Add admin section: "Payments" with create link form, payment history, and status tracking
7. Add "Send Payment Link" button in admin customer detail modal — generates link and sends via SMS

### 3D. Appointment Reminders
**Where:** New `server/appointment-reminders.ts` + cron in `server/_core/index.ts`
**Action:**
1. Query bookings table every 15 minutes for appointments in next 24h and next 2h
2. Send reminder SMS (new template in `server/sms.ts`):
   - 24h before: "Reminder: Your appointment at Nick's Tire & Auto is tomorrow at {time}. Reply CANCEL to cancel."
   - 2h before: "Your appointment at Nick's is in 2 hours! We're at 17625 Euclid Ave, Cleveland. See you soon!"
3. Track which reminders have been sent in a `reminder_sent` column on bookings table (prevent duplicates)
4. Handle CANCEL reply via the inbound SMS system (3B) — mark booking as cancelled, send confirmation
5. Add admin toggle: enable/disable reminders per booking

### 3E. Customer Communication Log
**Where:** New table + updates to existing routers
**Action:**
1. Add `communication_log` table to Drizzle schema:
   ```
   communication_log: id, customer_id, customer_phone, type (sms|email|call|note), direction (inbound|outbound), subject, body, metadata (JSON), created_at
   ```
2. Update `server/sms.ts` — after every SMS send, insert into communication_log
3. Update `server/email-notify.ts` — after every email send, insert into communication_log
4. Update inbound SMS handler (3B) — log inbound messages
5. Add admin UI: "Communication History" tab in customer detail modal showing timeline of all interactions
6. Add "Add Note" action in customer detail for manual notes (phone call summaries, in-person conversations)

### 3F. JSON-LD Structured Data
**Where:** New `client/src/components/StructuredData.tsx` + update all pages
**Action:**
1. Create reusable `<StructuredData>` component that renders `<script type="application/ld+json">`
2. Add to Home page: `LocalBusiness` schema with name, address, phone, hours, geo coordinates, reviews aggregate
3. Add to every service page: `Service` schema with name, description, provider, areaServed, price range
4. Add to Reviews page: `AggregateRating` schema with rating value, review count
5. Add to FAQ page: `FAQPage` schema with all Q&A pairs
6. Add to Blog posts: `Article` schema with author, datePublished, dateModified, image
7. Add to city pages: `LocalBusiness` with `areaServed` set to that city
8. Use business constants from `shared/business.ts` for all data
9. Add breadcrumb schema (`BreadcrumbList`) on all pages with proper hierarchy

### 3G. Database Backup to S3
**Where:** New `server/db-backup.ts` + cron in `server/_core/index.ts`
**Action:**
1. Add daily backup cron (run at 3 AM EST)
2. Export key tables to JSON: customers, bookings, leads, service_history, communication_log
3. Compress with gzip
4. Upload to S3 bucket with key: `backups/{date}/db-export.json.gz`
5. Keep last 30 days of backups (auto-delete older via S3 lifecycle policy)
6. Log success/failure via structured logger
7. On failure: send push notification to CEO via email-notify

### 3H. GA4 Client Initialization Fix
**Where:** `client/src/lib/ga4.ts` + `client/src/App.tsx`
**Action:**
1. The GA4 gtag is loaded in `client/index.html` but the Measurement Protocol client code never initializes
2. In App.tsx, call `initGA4()` on mount (ONLY after consent is granted — tie to consent-manager)
3. Ensure these events are actually firing: `page_view` on route change, `phone_click` on tel: links, `form_submission` on booking/lead/callback submit, `search` on search use
4. Verify by checking Network tab for requests to google-analytics.com
5. Remove any duplicate/dead GA4 code

### 3I. Admin Real-Time Push (SSE)
**Where:** New endpoint in `server/_core/index.ts` + admin dashboard update
**Action:**
1. Add `GET /api/admin/events` endpoint using Server-Sent Events (SSE)
2. When a new booking, lead, callback, or SMS comes in, push event to all connected admin SSE clients
3. Admin dashboard connects on mount, shows real-time toast notifications for new activity
4. Replace the 30-second polling on campaign progress and other admin sections with SSE updates
5. Add connection status indicator in admin header (green dot = connected, red = disconnected)

### 3J. Review Response AI
**Where:** New `server/routers/reviewResponses.ts` + admin section
**Action:**
1. When Google reviews are fetched, identify reviews without responses
2. Add admin section: "Review Responses" showing unresponded reviews
3. For each review, generate AI draft response using existing Gemini integration
4. Response rules: thank by name, acknowledge specific feedback, keep under 100 words, mention one service they used, invite back
5. Admin can edit and approve before sending
6. Track response status: draft, approved, sent (manual — admin copies to Google)
7. Priority: respond to all 1-3 star reviews first

### 3K. Abandoned Form Recovery
**Where:** New client hook + server endpoint
**Action:**
1. Create `client/src/hooks/useFormAbandonment.ts`
2. Track booking form: when user fills name + phone but doesn't submit within 5 minutes, fire event
3. Server endpoint receives abandonment event, stores in `form_abandonment` table: phone, name, service, timestamp
4. After 30 minutes (if no completed booking), send SMS: "Hey {name}, we noticed you started booking at Nick's. Need help? Call us at (216) 862-0005 or reply to this text!"
5. Add admin section showing abandonment rate and recovery rate
6. Only send 1 recovery SMS per phone per 24 hours (prevent spam)

### 3L. Customer SMS Opt-Out
**Where:** Update `server/sms.ts` + new table
**Action:**
1. Add `sms_preferences` table: `customer_phone, opted_out, opted_out_at, opt_out_reason`
2. Check opt-out status BEFORE every SMS send — skip if opted out
3. Handle "STOP" keyword in inbound SMS (3B) — auto opt-out, reply "You've been unsubscribed from Nick's Tire & Auto texts. Reply START to re-subscribe."
4. Handle "START" keyword — re-subscribe
5. Add opt-out count to admin SMS dashboard
6. This is legally required for SMS marketing under TCPA

### 3M. Health Check Enhancement
**Where:** Update `server/health.ts`
**Action:**
1. Current health check only tests DB connectivity
2. Add checks for: Twilio API (send test request), S3 connectivity (head bucket), Google Places API (test request)
3. Return status per service: `{ db: "ok", twilio: "ok", s3: "degraded", google: "ok" }`
4. Cache health results for 60 seconds (don't hammer external APIs)
5. Add to admin health dashboard with color-coded status per service

---

## PHASE 4: FINAL CLEANUP + VERIFICATION

### 4A. Remove all `console.log` from server
After logger.ts is wired in, grep for any remaining console.log/warn/error in server/ and replace with logger calls.

### 4B. Run full test suite
```
npm run test
npm run check  # TypeScript
npm run build  # Verify build passes
```
Fix any failures.

### 4C. Test every admin section
Manually verify each admin section loads and functions.

### 4D. Verify build size
Run `npm run build` and check output size. Flag if any chunk exceeds 500KB.

### 4E. Commit strategy
Make one commit per phase:
1. "chore: merge Phase 2+3 branch + remove dead code"
2. "feat: wire in consent, error tracking, logging, security, cache, search, a11y"
3. "feat: email retry, 2-way SMS, Stripe payments, reminders, JSON-LD, backup"
4. "chore: cleanup, test fixes, build verification"

Push all to a new branch: `phase-4/integration-upgrade`

---

## RULES

1. Do NOT create new files unless specified above. Prefer editing existing files.
2. Do NOT add dependencies unless specified (sharp, stripe). Keep it lean.
3. Every new feature must have at least basic error handling (try/catch, fallback behavior).
4. Every new admin section must be behind adminProcedure (auth-gated).
5. Every new Express endpoint must have rate limiting applied.
6. Use the existing patterns: tRPC for typed APIs, Drizzle for DB, Tailwind for styles, wouter for routing.
7. Import business constants from `shared/business.ts` — never hardcode phone, address, hours.
8. All SMS templates must use the short URL format (nickstire.org/review, not the full Google URL).
9. After EACH phase, run `npm run check && npm run test && npm run build` and fix any errors before moving on.
10. Keep the admin dashboard sections lazy-loaded (dynamic import pattern matching existing sections).
