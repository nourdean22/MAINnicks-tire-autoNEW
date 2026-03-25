# MASTER UPGRADE PROMPT — Nick's Tire & Auto

You are working on `nicks-tire-auto`, a production full-stack TypeScript app for a local auto repair shop in Cleveland, OH. This is a comprehensive upgrade covering dead code cleanup, orphaned module integration, new feature builds, database schema additions, SEO fixes, security hardening, performance optimization, and operational infrastructure.

## TECH STACK
- **Frontend:** React 19, Vite 7, Tailwind CSS 4, wouter router, Framer Motion, Radix UI, shadcn/ui
- **Backend:** Express 4, tRPC 11, Drizzle ORM, MySQL (TiDB), esbuild
- **Services:** Twilio (SMS), AWS S3 (storage), Gmail MCP (email), Google Places API (reviews), Gemini (AI), Meta CAPI
- **Deploy:** Railway, prerendered SSG for SEO pages

## KEY FILES MAP
- Server entry: `server/_core/index.ts` — Express app, all middleware, webhook endpoints, crons
- Client entry: `client/src/App.tsx` — React root, all routes, global providers
- Router registry: `server/routers.ts` — all tRPC routers merged into appRouter
- Router files: `server/routers/*.ts` — 28 feature routers
- DB schema: `drizzle/schema.ts` — 47 Drizzle tables, 1297 lines
- Business constants: `shared/business.ts` — single source of truth for all business data
- SEO routes: `shared/routes.ts` — 60+ page definitions with meta data
- Email system: `server/email-notify.ts` — Gmail MCP notification routing (shop + CEO)
- SMS system: `server/sms.ts` — Twilio send + templates + E.164 normalization
- GA4 client: `client/src/lib/ga4.ts` — event tracking (used in 21 files, but initGA4() never called)
- Meta Pixel: `client/src/lib/metaPixel.ts` — conversion tracking
- Schema markup: `client/src/components/LocalBusinessSchema.tsx` — JSON-LD (exists, used on some pages)
- SEO head: `client/src/components/SEO.tsx` — canonical, breadcrumbs, meta tags

## BRANCH STATE
- **Main:** `origin/main` — production code
- **Phase 2+3 branch:** `origin/claude/backend-upgrades-phase-2-ghHi8` — 54 files, 17,850 lines written but only 5 integrated. Rest are orphaned modules that nothing imports.

## EXECUTION ORDER
Work through these phases sequentially. After EACH phase, run `npm run check && npm run test && npm run build` and fix any errors before proceeding.

---

# ═══════════════════════════════════════════════════════
# PHASE 1: MERGE + DEAD CODE PURGE
# ═══════════════════════════════════════════════════════

## 1A. Merge Phase 2+3 branch
```bash
git checkout main
git pull origin main
git merge origin/claude/backend-upgrades-phase-2-ghHi8
```
Resolve conflicts if any. The branch mostly adds new files with minimal changes to existing ones.

## 1B. Delete over-engineered orphaned files from the branch
These add complexity with zero business value at current scale. Remove completely:
- `client/src/lib/session-analytics.ts` (712 lines — GA4 covers this)
- `client/src/lib/user-journey.ts` (616 lines — GA4 covers this)
- `client/src/lib/pwa-manager.ts` (532 lines — customers don't install PWAs)
- `client/src/lib/form-engine.ts` (634 lines — existing forms work fine)
- `client/src/components/InstallPrompt.tsx` (203 lines — PWA not needed)
- `client/src/components/OfflineBanner.tsx` (76 lines — PWA not needed)
- `client/src/components/SmartFormFields.tsx` (800 lines — existing forms work fine)
- `client/public/sw.js` (187 lines — remove service worker)
- `server/metrics.ts` (599 lines — use Railway monitoring instead)
- `server/db-monitor.ts` (531 lines — depends on metrics.ts)
- `server/rate-limiter-advanced.ts` (545 lines — existing express-rate-limit with 3 tiers is sufficient)
- `server/api-docs.ts` (429 lines — solo dev, tRPC gives type safety)
- `server/seo-automation.ts` (692 lines — SEO strategy is manual and working)

Also remove the SW registration from App.tsx (the useEffect that registers `/sw.js`).

## 1C. Delete pre-existing dead code on main
- Delete `server/analytics.ts` entirely (0 imports anywhere, never called)
- Delete `server/follow-ups.ts` entirely (0 imports, superseded by `server/postInvoiceFollowUp.ts`)
- Remove the unused `addServiceRecord()` function from `server/db.ts`
- In `client/src/lib/metaPixel.ts`: grep all files importing from it, delete any exported functions that are never imported elsewhere (keep only the ones actually used)

## 1D. Verify clean state
Run `npm run check && npm run test && npm run build`. Fix anything broken. Commit: "chore: merge Phase 2+3 + purge dead code (~7,500 lines removed)"

---

# ═══════════════════════════════════════════════════════
# PHASE 2: WIRE IN ORPHANED MODULES (already written, just need imports)
# ═══════════════════════════════════════════════════════

## 2A. Cookie Consent + GDPR Compliance [LEGAL PRIORITY]
**Files:** `client/src/components/CookieConsent.tsx`, `client/src/lib/consent-manager.ts`
1. Import and render `<CookieConsent />` in `client/src/App.tsx` inside `<ThemeProvider>`, AFTER `<Toaster />`
2. Wire consent-manager to gate ALL tracking:
   - In `client/src/lib/ga4.ts`: wrap every tracking function to check `consent-manager.hasConsent('analytics')` before firing. If no consent, silently return.
   - In `client/src/lib/metaPixel.ts`: same — check `consent-manager.hasConsent('marketing')` before firing.
3. Consent categories: `necessary` (always on), `analytics` (GA4, Web Vitals), `marketing` (Meta Pixel)
4. Store consent state in a cookie named `nta_consent` with 365-day expiry, path=/, SameSite=Lax
5. Style the banner to match dark industrial theme — dark bg, white text, orange accent buttons matching existing CTA colors

## 2B. Error Tracking [RELIABILITY]
**File:** `client/src/lib/error-tracker.ts`
1. Initialize in `client/src/App.tsx` via useEffect on mount
2. Connect to `ErrorBoundary.tsx` — in the componentDidCatch, call `errorTracker.captureError(error, errorInfo)`
3. Add server endpoint `POST /api/track-error` in `server/_core/index.ts`:
   - Accept `{ message, stack, breadcrumbs, url, userAgent, timestamp }`
   - Log via structured logger (Phase 2C)
   - Rate limit: max 10 error reports per IP per minute
4. Track: unhandled rejections, uncaught exceptions, React render errors, failed tRPC calls
5. Add breadcrumb collection: last 20 user actions (route changes, clicks on data-track elements, form submissions)

## 2C. Structured Logging [OPERATIONS]
**Files:** `server/logger.ts`, `server/request-logger.ts`
1. Replace ALL `console.log`, `console.warn`, `console.error` across the ENTIRE `server/` directory with `logger.info()`, `logger.warn()`, `logger.error()` respectively. Search every `.ts` file in server/ including routers/ and _core/.
2. Register request-logger as Express middleware in `server/_core/index.ts` — add BEFORE the rate limiter so it captures all requests
3. Log format: `{ timestamp, level, correlationId, message, data }` as JSON
4. Generate correlationId (nanoid) per request, pass through tRPC context so all logs from one request are traceable
5. Mask sensitive data in log output: replace phone numbers with `***-***-XXXX` (last 4 visible), email with `n***@***.com`, any field named password/token/secret/apiKey with `[REDACTED]`
6. In production: only log `warn` and above unless `LOG_LEVEL=debug` is set in env

## 2D. Security Middleware [SECURITY]
**File:** `server/security-audit.ts`
1. Register as Express middleware in `server/_core/index.ts` — add AFTER body parser, BEFORE routes
2. Scan query params, body, and URL path for: XSS payloads (`<script`, `javascript:`, `onerror=`), SQL injection (`UNION SELECT`, `OR 1=1`, `DROP TABLE`, `--`), path traversal (`../`, `..%2f`, `..%5c`)
3. On detection: return 403 with `{ error: "Request blocked" }`, log the attempt with full details via structured logger
4. Brute force detection: if same IP triggers 10+ blocks in 5 minutes, temp-ban IP for 30 minutes (in-memory Map with TTL)
5. Whitelist: skip scanning for `/api/health`, `/api/webhooks/*` (webhook bodies contain legitimate special characters)
6. Add to admin health dashboard: blocked request count (last 24h), top blocked IPs

## 2E. Server-Side Cache [PERFORMANCE]
**File:** `server/cache.ts`
1. Import cache and wrap these external API calls with caching:
   - `server/google-reviews.ts` — cache Google Places API response. Key: `reviews:google`. TTL: 1 hour.
   - `server/content-generator.ts` — cache generated articles. Key: `content:{slug}`. TTL: 24 hours.
   - `server/weather.ts` — cache weather data. Key: `weather:current`. TTL: 30 minutes.
   - `server/instagram.ts` — cache Instagram feed. Key: `instagram:feed`. TTL: 1 hour.
   - `server/gemini.ts` — cache AI responses. Key: `ai:{query-hash}`. TTL: 10 minutes.
2. Pattern: `const cached = cache.get(key); if (cached) return cached; const fresh = await fetchFromAPI(); cache.set(key, fresh, ttl); return fresh;`
3. Add admin endpoints in `server/routers/admin.ts`:
   - `cacheStats` (admin) — returns hit/miss rates, memory usage, keys per namespace
   - `cacheClear` (admin) — clears specific namespace or all
4. Add "Cache" section to admin dashboard showing stats

## 2F. CSRF Protection [SECURITY]
**File:** `server/csrf.ts`
1. Register CSRF middleware in `server/_core/index.ts` for non-GET, non-HEAD, non-OPTIONS requests
2. EXCLUDE from CSRF: `/api/webhooks/*` (Twilio, Stripe), `/api/trpc/*` (tRPC uses its own CSRF via custom Content-Type header)
3. Generate CSRF token on page load (add to a meta tag in `client/index.html` template or via initial API response)
4. Validate X-CSRF-Token header on protected form submissions

## 2G. 404 Tracker + Admin View [SEO]
**Files:** `client/src/components/NotFoundTracker.tsx`, server additions
1. Verify NotFoundTracker is rendered in `client/src/pages/NotFound.tsx`
2. The branch already added `POST /api/track-404` endpoint — verify it works
3. Add in-memory ring buffer (last 1000 entries) for 404s with: URL, referrer, user-agent, timestamp, count
4. Add tRPC procedure `admin.get404Log` returning top 404 URLs sorted by frequency
5. Add admin section "Broken Links" showing the 404 log — URL, hit count, last seen, referrer

## 2H. LazyImage Component [PERFORMANCE]
**File:** `client/src/components/LazyImage.tsx`
1. Search all `<img` tags across `client/src/` — replace with `<LazyImage>` where the image is below the fold
2. Priority targets: Home.tsx (hero images can stay as `<img>` with eager loading), ServicePage.tsx, Blog.tsx, ReviewsPage.tsx, Gallery components
3. Add native `loading="lazy"` as baseline, IntersectionObserver for blur-up effect
4. Do NOT replace images inside `<LazyImage>` that are already using it, or images that are critical above-the-fold content

## 2I. Accessibility [UX + COMPLIANCE]
**File:** `client/src/lib/accessibility.ts`
1. Import focus trap and apply to ALL modal/dialog components:
   - `client/src/components/CallbackModal.tsx`
   - `client/src/components/BookingWizard.tsx`
   - `client/src/components/LeadPopup.tsx`
   - `client/src/components/ExitIntentOffer.tsx`
   - `client/src/components/ManusDialog.tsx`
   - Any other modal/overlay components
2. Escape key closes all modals (verify this works on each)
3. Add skip-to-main-content link as first child in App.tsx: `<a href="#main-content" className="sr-only focus:not-sr-only ...">Skip to main content</a>`
4. Add `id="main-content"` to the main content wrapper in App.tsx
5. Add `aria-live="polite"` region for toast/notification updates

## 2J. Link Prefetch [PERFORMANCE]
**File:** `client/src/lib/link-prefetch.ts`
1. Initialize in App.tsx on mount
2. Prefetch on hover: when user hovers any `<Link>` or `<a>` with internal href for >150ms, prefetch that route's JS chunk
3. On idle: prefetch the top 3 most linked pages (Services, Contact, Book)
4. Do NOT prefetch admin pages, external links, or tel:/mailto: links

## 2K. Image Optimizer [PERFORMANCE]
**File:** `server/image-optimizer.ts`
1. Install `sharp`: `npm install sharp`
2. Wire into the S3 upload flow in `server/storage.ts`:
   - On image upload: compress to WebP (quality 80), generate 400px thumbnail, upload both to S3
   - Store original key + optimized key + thumbnail key
3. Add endpoint `GET /api/image/:key` with query params `?w=400&q=80&format=webp` for on-demand resizing
4. Set `Cache-Control: public, max-age=31536000, immutable` on all optimized image responses
5. Use in inspection reports, gallery, and any user-uploaded images

## 2L. Search Overlay [UX]
**Files:** `client/src/components/SearchOverlay.tsx`, `client/src/lib/search-client.ts`
1. Import and render `<SearchOverlay />` in App.tsx
2. Trigger: Cmd+K / Ctrl+K keyboard shortcut (check it doesn't conflict with existing SearchBar in SiteNavbar)
3. Wire search-client.ts to call existing tRPC procedures: `search.quickSearch` and `search.aiSearch`
4. Add suggested searches: "oil change price", "brake repair", "tire prices", "check engine light", "book appointment"
5. Results grouped by category: Services, Blog Posts, FAQ, Pages
6. On result click: navigate to page and close overlay

## 2M. Keep But Don't Wire Yet
These files are well-built but not needed now. Leave them in the codebase for future use:
- `server/webhook-manager.ts` — needed when Stripe is added (Phase 4)
- `server/job-queue.ts` — needed for future async processing
- `client/src/lib/ab-testing.ts` — needed when actively optimizing conversion
- `client/src/lib/feature-flags.ts` — needed for gradual rollouts
- `client/src/lib/geo-utils.ts` — needed for multi-location or service area features
- `client/src/lib/notification-center.ts` — evaluate if existing Toaster covers this
- `client/src/hooks/useEngagement.ts` — wire when engagement tracking is prioritized

Add a comment block at the top of each: `// STATUS: Standalone module — not yet integrated. See MASTER-UPGRADE-PROMPT.md for integration plan.`

**Commit:** "feat: wire in consent, error tracking, logging, security, cache, CSRF, 404, images, a11y, search"

---

# ═══════════════════════════════════════════════════════
# PHASE 3: DATABASE SCHEMA ADDITIONS
# ═══════════════════════════════════════════════════════

Add these tables to `drizzle/schema.ts`. After adding, run `npm run db:push` to migrate.

## 3A. Communication Log (unified contact history)
```typescript
export const communicationLog = mysqlTable("communication_log", {
  id: int("id").primaryKey().autoincrement(),
  customerId: int("customer_id").references(() => customers.id),
  customerPhone: varchar("customer_phone", { length: 20 }),
  type: varchar("type", { length: 20 }).notNull(), // sms, email, call, note
  direction: varchar("direction", { length: 10 }).notNull(), // inbound, outbound, internal
  subject: varchar("subject", { length: 255 }),
  body: text("body"),
  metadata: json("metadata"), // extra context (twilio SID, email ID, etc.)
  staffName: varchar("staff_name", { length: 100 }), // who sent/logged it
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

## 3B. SMS Preferences (opt-in/opt-out — TCPA compliance)
```typescript
export const smsPreferences = mysqlTable("sms_preferences", {
  id: int("id").primaryKey().autoincrement(),
  phone: varchar("phone", { length: 20 }).notNull().unique(),
  optedOut: boolean("opted_out").default(false).notNull(),
  optOutKeyword: varchar("opt_out_keyword", { length: 20 }), // STOP, CANCEL, etc.
  optedOutAt: timestamp("opted_out_at"),
  optedInAt: timestamp("opted_in_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
```

## 3C. Form Abandonment Tracking
```typescript
export const formAbandonment = mysqlTable("form_abandonment", {
  id: int("id").primaryKey().autoincrement(),
  phone: varchar("phone", { length: 20 }),
  name: varchar("name", { length: 100 }),
  email: varchar("email", { length: 255 }),
  formType: varchar("form_type", { length: 50 }).notNull(), // booking, lead, callback
  fieldsCompleted: json("fields_completed"), // which fields were filled
  recoverySmsSent: boolean("recovery_sms_sent").default(false),
  recovered: boolean("recovered").default(false), // did they complete the form later?
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

## 3D. Payments (for Stripe integration)
```typescript
export const payments = mysqlTable("payments", {
  id: int("id").primaryKey().autoincrement(),
  customerId: int("customer_id").references(() => customers.id),
  customerPhone: varchar("customer_phone", { length: 20 }),
  customerName: varchar("customer_name", { length: 200 }),
  amount: int("amount").notNull(), // cents
  description: varchar("description", { length: 500 }),
  stripePaymentLinkId: varchar("stripe_payment_link_id", { length: 255 }),
  stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
  status: varchar("status", { length: 20 }).default("pending").notNull(), // pending, paid, failed, refunded
  paidAt: timestamp("paid_at"),
  invoiceId: int("invoice_id").references(() => invoices.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
```

## 3E. Error Log (server-side error tracking persistence)
```typescript
export const errorLog = mysqlTable("error_log", {
  id: int("id").primaryKey().autoincrement(),
  source: varchar("source", { length: 20 }).notNull(), // client, server
  message: text("message").notNull(),
  stack: text("stack"),
  url: varchar("url", { length: 500 }),
  userAgent: varchar("user_agent", { length: 500 }),
  metadata: json("metadata"), // breadcrumbs, context, correlationId
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

## 3F. Appointment Reminders Tracking
```typescript
export const appointmentReminders = mysqlTable("appointment_reminders", {
  id: int("id").primaryKey().autoincrement(),
  bookingId: int("booking_id").references(() => bookings.id).notNull(),
  type: varchar("type", { length: 20 }).notNull(), // 24h, 2h
  sentAt: timestamp("sent_at"),
  smsSid: varchar("sms_sid", { length: 100 }),
  status: varchar("status", { length: 20 }).default("pending").notNull(), // pending, sent, failed
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

## 3G. Indexes
Add indexes on all new tables:
- `communicationLog`: index on `customer_id`, `customer_phone`, `type`, `created_at`
- `smsPreferences`: unique index on `phone`
- `formAbandonment`: index on `phone`, `created_at`, `recovered`
- `payments`: index on `customer_id`, `status`, `stripe_payment_intent_id`, `created_at`
- `errorLog`: index on `source`, `created_at`
- `appointmentReminders`: index on `booking_id`, `type`, `status`

**Commit:** "feat: add 6 new database tables — communication log, SMS prefs, payments, errors, reminders, abandonment"

---

# ═══════════════════════════════════════════════════════
# PHASE 4: NEW FEATURES — REVENUE + OPERATIONS
# ═══════════════════════════════════════════════════════

## 4A. Two-Way SMS (Inbound Message Handling) [REVENUE]
1. Add Twilio inbound webhook: `POST /api/webhooks/twilio/inbound` in `server/_core/index.ts`
   - Validate Twilio request signature using `twilio.validateRequest()`
   - Parse incoming SMS: `req.body.From`, `req.body.Body`
   - Match phone to customer record in `customers` table
   - Insert into `smsMessages` table with direction = 'inbound'
   - Insert into `communicationLog` table
2. Auto-responses:
   - "STOP" → opt out customer in `smsPreferences`, reply: "You've been unsubscribed from Nick's Tire & Auto texts. Reply START to re-subscribe."
   - "START" → opt back in, reply: "Welcome back! You'll receive updates from Nick's Tire & Auto."
   - After hours (check BUSINESS.hours) → "Thanks for texting Nick's! We're currently closed. Hours: Mon-Sat 8AM-6PM, Sun 9AM-4PM. We'll respond first thing!"
   - During hours → push notification to admin, no auto-reply (staff will manually reply)
3. Add admin section "SMS Inbox" showing threaded conversations by phone number
4. Add admin "Reply" action — textbox that sends SMS via existing `sendSms()` function
5. Send push notification to admin (via `email-notify.ts`) on every inbound SMS

## 4B. SMS Opt-Out Compliance (TCPA) [LEGAL]
1. Create `server/sms-preferences.ts` with functions: `isOptedOut(phone)`, `optOut(phone, keyword)`, `optIn(phone)`
2. Update `server/sms.ts` `sendSms()` function: BEFORE every send, call `isOptedOut(phone)`. If opted out, return `{ success: false, error: "Customer opted out" }` without sending.
3. Handle STOP/CANCEL/UNSUBSCRIBE/QUIT keywords in inbound webhook (4A)
4. Handle START/YES/UNSTOP keywords for re-subscribe
5. Add opt-out count to admin SMS dashboard
6. Log all opt-outs in communication_log

## 4C. Stripe Payment Links [REVENUE]
1. Install: `npm install stripe`
2. Add env vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
3. Create `server/routers/payments.ts` with procedures:
   - `createPaymentLink` (admin) — input: amount (dollars), description, customerPhone, customerName. Creates Stripe Payment Link. Stores in `payments` table. Returns the link URL.
   - `sendPaymentLink` (admin) — input: paymentId. Sends the payment link via SMS to the customer. Logs in communication_log.
   - `listPayments` (admin) — list all payments with status, date, amount. Sortable.
   - `getPaymentStats` (admin) — total collected this month, pending, average payment size.
4. Add Stripe webhook: `POST /api/webhooks/stripe` in `server/_core/index.ts`
   - Verify webhook signature with `stripe.webhooks.constructEvent()`
   - On `payment_intent.succeeded`: update payment status to "paid", set paidAt, send thank-you SMS, log in communication_log
   - On `payment_intent.payment_failed`: update status to "failed", notify admin
5. Register `payments` router in `server/routers.ts` and `server/routers/index.ts`
6. Add admin section "Payments" with: create payment link form, payment history table, stats cards (collected/pending/failed)
7. Add "Send Payment Link" button in admin customer detail view

## 4D. Appointment Reminders [RETENTION]
1. Create `server/appointment-reminders.ts`:
   - `processReminders()` — query bookings with confirmed status + scheduled date within next 24h or next 2h
   - Check `appointmentReminders` table to avoid duplicate sends
   - For 24h reminder: send SMS template: "Hi {name}! Reminder: your appointment at Nick's Tire & Auto is tomorrow. We're at 17625 Euclid Ave, Cleveland. Reply CANCEL to cancel. Questions? Call (216) 862-0005"
   - For 2h reminder: "Your appointment at Nick's is in about 2 hours! We're at 17625 Euclid Ave, Cleveland. See you soon!"
   - Insert into `appointmentReminders` table with status sent/failed
   - Log in `communicationLog`
2. Add cron in `server/_core/index.ts`: run `processReminders()` every 15 minutes
3. Handle "CANCEL" keyword in inbound SMS (4A) — mark booking as cancelled, send confirmation: "Your appointment has been cancelled. To rebook, visit autonicks.com or call (216) 862-0005"
4. Add admin toggle to enable/disable reminders in shop settings

## 4E. Communication Log Integration [OPERATIONS]
1. Update `server/sms.ts`: after every successful `sendSms()`, insert into `communicationLog` with type='sms', direction='outbound'
2. Update `server/email-notify.ts`: after every email send attempt, insert into `communicationLog` with type='email', direction='outbound'
3. Add manual note entry: tRPC procedure `admin.addCommunicationNote` — input: customerId or phone, body, subject. Inserts with type='note', direction='internal'
4. Add admin UI: "Communication History" tab in customer detail modal showing unified timeline of all SMS, emails, notes sorted by date
5. Each entry shows: icon (SMS/email/phone/note), direction arrow, timestamp, preview of body, staff name if applicable

## 4F. Abandoned Form Recovery [CONVERSION]
1. Create `client/src/hooks/useFormAbandonment.ts`:
   - Track booking form fields: when name AND phone are filled but form is not submitted within 3 minutes, fire abandonment event to `POST /api/track-abandonment`
   - Include: phone, name, form type, which fields were filled
   - Only fire once per session per form
2. Create server endpoint `POST /api/track-abandonment` in `server/_core/index.ts`:
   - Validate input, insert into `formAbandonment` table
   - Rate limit: 5 per IP per hour
3. Create `server/form-recovery.ts`:
   - `processAbandonments()` — every 30 minutes, check `formAbandonment` where `recoverySmsSent = false` AND `createdAt` > 30 min ago AND `createdAt` < 24h ago
   - Check customer didn't complete a booking in that time (query bookings table by phone)
   - Check customer isn't opted out (query smsPreferences)
   - Send recovery SMS: "Hey {name}! We noticed you were looking at booking with Nick's. Need help or have questions? Call us at (216) 862-0005 or reply to this text!"
   - Mark `recoverySmsSent = true`
   - Max 1 recovery SMS per phone per 24 hours
4. Add cron in `server/_core/index.ts`
5. Wire `useFormAbandonment` hook into `BookingForm.tsx` and `BookingWizard.tsx`
6. Add admin section "Form Recovery" showing: abandonment rate, recovery rate, recent abandonments

## 4G. AI Review Response Drafts [REPUTATION]
1. Add tRPC procedures in `server/routers/reviewReplies.ts` (already exists):
   - `generateReplyDraft` (admin) — input: reviewerName, rating, reviewText. Uses existing Gemini integration to generate a response draft.
   - Prompt: "You are responding on behalf of Nick's Tire & Auto in Cleveland. Write a professional, warm Google review response. Thank {name} by name. If positive (4-5 stars): express gratitude, mention a specific detail from their review, invite back. If negative (1-3 stars): apologize sincerely, acknowledge the issue, offer to make it right, provide phone number (216) 862-0005. Keep under 100 words. Do not use exclamation marks excessively."
   - Store draft in `reviewReplies` table with status = 'draft'
2. Add admin section enhancement: show unresponded reviews with "Generate Response" button, editable text area, "Copy to Clipboard" button (admin will paste into Google)
3. Priority sort: 1-3 star reviews first (reputation management), then 4-5 star

**Commit:** "feat: two-way SMS, Stripe payments, appointment reminders, form recovery, review AI, comms log"

---

# ═══════════════════════════════════════════════════════
# PHASE 5: SEO + STRUCTURED DATA
# ═══════════════════════════════════════════════════════

## 5A. Expand JSON-LD Structured Data
`client/src/components/LocalBusinessSchema.tsx` already exists. Enhance and add more schemas:

1. **Home page** — Ensure `LocalBusiness` schema includes:
   - `aggregateRating` with current review count and rating (fetch from business constants or hardcode current: 4.8 rating, 1685+ reviews)
   - `openingHoursSpecification` for each day (Mon-Sat 8AM-6PM, Sun 9AM-4PM)
   - `geo` coordinates: `{ latitude: 41.5946, longitude: -81.5211 }`
   - `priceRange`: "$$"
   - `paymentAccepted`: "Cash, Credit Card, Debit Card, Financing"
   - `areaServed`: array of all cities from your city pages

2. **Every service page** — Add `Service` schema:
   ```json
   { "@type": "Service", "name": "Brake Repair", "description": "...", "provider": { "@type": "AutoRepair", "name": "Nick's Tire & Auto" }, "areaServed": { "@type": "City", "name": "Cleveland" } }
   ```

3. **FAQ page** — Add `FAQPage` schema wrapping all Q&A pairs:
   ```json
   { "@type": "FAQPage", "mainEntity": [{ "@type": "Question", "name": "...", "acceptedAnswer": { "@type": "Answer", "text": "..." } }] }
   ```

4. **Blog posts** — Add `Article` schema:
   ```json
   { "@type": "Article", "headline": "...", "author": { "@type": "Organization", "name": "Nick's Tire & Auto" }, "datePublished": "...", "publisher": { "@type": "Organization", "name": "Nick's Tire & Auto" } }
   ```

5. **Reviews page** — Add `AggregateRating` schema

6. **All city pages** — Add `LocalBusiness` with `areaServed` set to that specific city

7. **Breadcrumb schema** — The SEO.tsx component already renders visual breadcrumbs. Add `BreadcrumbList` JSON-LD alongside it on every page.

Create a reusable helper: `function renderJsonLd(schema: object)` that returns `<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />`

## 5B. Open Graph + Twitter Cards
Update `client/src/components/SEO.tsx` to add:
- `og:title`, `og:description`, `og:url`, `og:image`, `og:type` (website for home, article for blog)
- `og:locale`: "en_US"
- `og:site_name`: "Nick's Tire & Auto"
- `twitter:card`: "summary_large_image"
- `twitter:title`, `twitter:description`
- Default `og:image`: create a branded social share image (use existing logo/brand colors) and put in `client/public/og-image.jpg` (1200x630px)

## 5C. GA4 Client Fix [ANALYTICS]
1. `initGA4()` in `client/src/lib/ga4.ts` is defined but NEVER called. Call it in App.tsx on mount, BUT only after consent is granted (check consent-manager from 2A).
2. Add `trackPageView()` call on every route change — use wouter's `useLocation` hook in App.tsx to detect route changes and fire page_view event.
3. Verify `trackFormSubmission` is called in `BookingForm.tsx`, `BookingWizard.tsx`, `LeadPopup.tsx`, `CallbackModal.tsx` — it's already imported in many pages but verify it fires on successful submission.
4. Verify `trackPhoneClick` is called on all tel: links across the site.

## 5D. Meta Pixel Dedup Fix
1. Check if Meta Pixel events fire both client-side AND server-side (via meta-capi.ts). If so, ensure eventID deduplication is working — same eventID must be passed to both client pixel and server CAPI.
2. If dedup isn't working: generate a unique eventId in the client before form submission, pass it to both the client pixel call AND the tRPC mutation (which then passes it to server-side CAPI).

**Commit:** "feat: JSON-LD structured data, Open Graph, GA4 fix, Meta Pixel dedup"

---

# ═══════════════════════════════════════════════════════
# PHASE 6: PERFORMANCE + INFRASTRUCTURE
# ═══════════════════════════════════════════════════════

## 6A. Health Check Enhancement
Update `server/health.ts`:
1. Current check: database only. Add:
   - Twilio: call `client.api.accounts(accountSid).fetch()` wrapped in try/catch, timeout 5s
   - S3: call `headBucket()` on the configured bucket, timeout 5s
   - Google Places: make a lightweight test request, timeout 5s
2. Return per-service status: `{ status: "ok"|"degraded"|"error", services: { db: "ok", twilio: "ok", s3: "degraded", google: "ok" }, uptime: processUptime, timestamp }`
3. Cache health results for 60 seconds (don't hammer external APIs on every health check)
4. Update admin "Site Health" section to show per-service status with green/yellow/red indicators

## 6B. Email Retry Queue
Update `server/email-notify.ts`:
1. Add in-memory retry queue: `{ category, subject, body, recipients, attempts, nextRetryAt }`
2. On email send failure: push to retry queue instead of logging and moving on
3. Retry schedule: attempt 1 immediately, attempt 2 after 5 seconds, attempt 3 after 30 seconds
4. Process retry queue every 10 seconds via setInterval
5. After 3 failures: log as CRITICAL via structured logger, send push notification to CEO email
6. Add stats to delivery log: `{ sent, failed, retrying, retrySuccesses }` accessible via `getDeliveryStats()`
7. Show retry stats in admin health dashboard

## 6C. Database Backup to S3
Create `server/db-backup.ts`:
1. Daily backup cron at 3 AM EST (add to `server/_core/index.ts` cron section)
2. Export critical tables to JSON: customers, bookings, leads, invoices, communicationLog, smsMessages, payments
3. Use Drizzle to `select * from table` for each, serialize to JSON
4. Compress with zlib (built-in Node)
5. Upload to S3: key = `backups/${YYYY-MM-DD}/db-export.json.gz`
6. Keep last 30 days (add S3 lifecycle rule or delete old backups in the script)
7. On success: log via structured logger. On failure: send CRITICAL alert to CEO via email-notify
8. Add admin action: "Trigger Backup Now" button

## 6D. Admin Real-Time Updates (SSE)
1. Add `GET /api/admin/events` endpoint in `server/_core/index.ts` using Server-Sent Events:
   ```typescript
   app.get("/api/admin/events", adminAuth, (req, res) => {
     res.setHeader("Content-Type", "text/event-stream");
     res.setHeader("Cache-Control", "no-cache");
     res.setHeader("Connection", "keep-alive");
     // store res in a Set of active SSE connections
     // when new booking/lead/SMS arrives, iterate and send to all
   });
   ```
2. Create a simple event bus: `server/event-bus.ts` with `emit(event, data)` and `on(event, handler)`
3. Fire events from: booking creation, lead submission, callback request, inbound SMS, payment received
4. Admin dashboard connects on mount, shows real-time toast for new activity
5. Add green connection indicator dot in admin header

## 6E. Gzip/Brotli Compression
1. Install: `npm install compression`
2. Add `compression()` middleware in `server/_core/index.ts` BEFORE static file serving
3. This alone can reduce transfer size by 60-80% for HTML/JS/CSS responses

## 6F. Build Optimization
1. In `vite.config.ts`, add manual chunk splitting:
   ```typescript
   build: {
     rollupOptions: {
       output: {
         manualChunks: {
           'vendor-react': ['react', 'react-dom'],
           'vendor-ui': ['@radix-ui/react-dialog', '@radix-ui/react-tooltip', ...other radix],
           'vendor-motion': ['framer-motion'],
           'vendor-charts': ['recharts'],
         }
       }
     }
   }
   ```
2. Add `build.reportCompressedSize: true` to see gzipped sizes in build output
3. Target: no single chunk over 250KB gzipped. If any exceed, split further.

**Commit:** "feat: health checks, email retry, db backup, SSE, compression, build optimization"

---

# ═══════════════════════════════════════════════════════
# PHASE 7: ADMIN DASHBOARD UPGRADES
# ═══════════════════════════════════════════════════════

## 7A. New Admin Sections
Add these lazy-loaded sections to the admin dashboard (follow existing pattern in `client/src/pages/Admin.tsx`):

1. **Payments** — Create link, send via SMS, payment history table, stats cards (total collected/pending/failed this month)
2. **SMS Inbox** — Threaded conversations, reply textbox, inbound/outbound labels, customer name lookup
3. **Broken Links (404s)** — Top 404 URLs by frequency, referrer, last seen, "create redirect" action
4. **Form Recovery** — Abandonment list, recovery rate metric, recent abandonments with phone/name/service
5. **Communication Log** — Unified view filterable by customer, type (sms/email/note), date range
6. **Cache Status** — Hit/miss rates, memory usage, clear buttons per namespace
7. **Error Log** — Recent client + server errors, stack traces, frequency, URL

## 7B. Existing Admin Section Improvements
1. **Overview** — Add real-time new booking/lead count badge (via SSE from 6D). Add today's revenue from payments table.
2. **Customers** — Add "Communication History" tab to customer detail modal (from 4E). Add "Send Payment Link" button. Add "Send SMS" quick action.
3. **SMS** — Merge SMS Conversations + SMS Inbox into one unified view. Show opt-out status per customer. Add "opted out" badge.
4. **Site Health** — Show per-service health (db/twilio/s3/google). Show email retry stats. Show cache stats. Show error rate (last 24h).
5. **Bookings** — Add "Send Reminder" manual button per booking. Show reminder status (sent/pending/failed).

**Commit:** "feat: 7 new admin sections + admin UX improvements"

---

# ═══════════════════════════════════════════════════════
# PHASE 8: TESTING + FINAL VERIFICATION
# ═══════════════════════════════════════════════════════

## 8A. New Tests
Write tests for all new critical functionality:
1. `server/__tests__/sms-preferences.test.ts` — test opt-in/opt-out logic, STOP/START keyword handling
2. `server/__tests__/appointment-reminders.test.ts` — test reminder scheduling, duplicate prevention, CANCEL handling
3. `server/__tests__/payments.test.ts` — test payment link creation, webhook handling, status updates
4. `server/__tests__/form-recovery.test.ts` — test abandonment tracking, recovery SMS scheduling, rate limiting
5. `server/__tests__/communication-log.test.ts` — test log insertion from SMS, email, manual notes
6. `server/__tests__/email-retry.test.ts` — test retry queue, backoff timing, max attempts
7. Existing `server/__tests__/cache.test.ts`, `security-audit.test.ts`, `webhook-manager.test.ts` — verify they still pass

## 8B. Full Verification Checklist
Run each and fix any failures:
```bash
npm run check          # TypeScript — 0 errors
npm run test           # Vitest — all passing
npm run build          # Vite + esbuild — clean build
```

Then verify manually:
- [ ] Cookie consent banner appears on first visit
- [ ] GA4 events fire only after consent
- [ ] Meta Pixel fires only after marketing consent
- [ ] /api/health returns all service statuses
- [ ] Admin dashboard loads all sections without errors
- [ ] Search overlay opens with Cmd+K
- [ ] 404 page tracks and shows in admin
- [ ] All modals are keyboard-accessible (Tab, Escape)
- [ ] Skip-to-content link works
- [ ] Images lazy load below the fold
- [ ] Build output: no chunk exceeds 250KB gzipped

## 8C. Final Cleanup
1. Grep for any remaining `console.log` in server/ — replace with logger calls
2. Grep for any `TODO` or `FIXME` comments — address or document
3. Verify all new admin sections are behind `adminProcedure` (auth-gated)
4. Verify all new Express endpoints have rate limiting
5. Verify all SMS sends check opt-out status
6. Remove `MASTER-UPGRADE-PROMPT.md` from the repo (it's instructions, not code)

**Commit:** "test: add 6 new test suites + full verification pass"

---

# ═══════════════════════════════════════════════════════
# RULES (apply to ALL phases)
# ═══════════════════════════════════════════════════════

1. **Use existing patterns.** tRPC for APIs, Drizzle for DB, Tailwind for styles, wouter for routing, Radix/shadcn for UI components. Don't introduce new frameworks or patterns.
2. **Import business constants from `shared/business.ts`** — never hardcode phone number, address, hours, URLs, or store name anywhere.
3. **Every new tRPC router must be registered** in both `server/routers/index.ts` (export) and `server/routers.ts` (add to appRouter).
4. **Every new admin section must use `adminProcedure`** — no public access to admin data.
5. **Every new Express endpoint must have rate limiting** — use existing rate limiter patterns.
6. **Every SMS send must check opt-out status** before sending (after Phase 4B is complete).
7. **All new admin sections must be lazy-loaded** — follow the existing dynamic import pattern in Admin.tsx.
8. **Log everything via structured logger** (after Phase 2C) — no console.log/warn/error in server code.
9. **All SMS templates must use short URLs** — `autonicks.com/review` not the full Google review URL.
10. **After EACH phase**, run `npm run check && npm run test && npm run build` and fix errors before moving to next phase.
11. **Do NOT create README.md or documentation files** unless explicitly part of a task.
12. **Do NOT install unnecessary dependencies.** Only install what's specified: `sharp`, `stripe`, `compression`.
13. **Keep all new code production-quality.** No placeholder comments like "add logic here". No half-finished implementations. Ship working code.
14. **One commit per phase.** Clean, descriptive commit messages as specified.

---

# DEPENDENCY SUMMARY
```bash
npm install sharp stripe compression
```
That's it. 3 new packages total.

# NEW ENV VARS NEEDED
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```
All other services (Twilio, S3, GA4, Gmail) are already configured.

# ESTIMATED SCOPE
- Phase 1: ~7,500 lines deleted, merge only
- Phase 2: ~500 lines of integration code (wiring existing modules)
- Phase 3: ~150 lines of schema additions
- Phase 4: ~2,500 lines of new feature code
- Phase 5: ~400 lines of SEO/meta additions
- Phase 6: ~800 lines of infrastructure
- Phase 7: ~1,500 lines of admin UI
- Phase 8: ~600 lines of tests
- **Net change: ~6,000 lines added, ~7,500 lines removed = leaner, more integrated codebase**
