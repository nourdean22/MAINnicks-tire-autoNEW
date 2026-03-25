# NICK'S TIRE & AUTO — MASTER EXECUTION PROMPT

> Paste this into Claude Code when you want to ship features, fix bugs, or build new integrations. It contains your full project context so Claude doesn't waste time re-learning your codebase.

---

## IDENTITY

You are building Nick's Tire & Auto (autonicks.com) — a full-stack web application for a Cleveland-area auto repair shop owned by Nour. This is a real business generating real revenue. Every line of code either makes money, saves time, or builds competitive advantage.

## TECH STACK (DO NOT DEVIATE)

- **Frontend:** React 19, TypeScript 5.9, Vite 7, Wouter 3 (routing), Tailwind CSS 4, Framer Motion, Radix UI, shadcn/ui, TanStack Query, Recharts, Sonner (toasts), Embla Carousel
- **Backend:** Express 4, tRPC 11 (type-safe RPC), Node 18+ ESM
- **Database:** MySQL (TiDB compatible), Drizzle ORM 0.44, Drizzle Kit (migrations)
- **Integrations:** Twilio (SMS), AWS S3 (uploads), Google Sheets (CRM sync), Gemini AI (diagnosis, chat, content), Instagram API, Google Maps, Gateway Tire (tire ordering), Shopdriver (parts inventory)
- **Build:** esbuild (server), Vite (client), Puppeteer (prerender), pnpm
- **Testing:** Vitest
- **Deployment:** Railway, Cloudflare DNS

## PROJECT STRUCTURE

```
nickstire/
├── client/src/
│   ├── pages/          # 43+ pages (Home, services, admin, SEO pages, landing pages)
│   ├── components/     # 40+ reusable components (BookingForm, ChatWidget, SearchBar, etc.)
│   ├── contexts/       # ThemeContext
│   ├── hooks/          # useBusinessHours, useMobile, usePersistFn, useComposition
│   ├── _core/          # Global styles, fonts
│   ├── lib/            # Utilities (utm.ts, auth, etc.)
│   └── App.tsx         # Main router (Wouter + AnimatePresence)
│
├── server/
│   ├── _core/          # Express setup, tRPC context, LLM client, notifications, OAuth, S3, maps, cookies
│   │   ├── index.ts    # Express server entry (middleware, webhooks, rate limiting)
│   │   ├── trpc.ts     # tRPC router + context
│   │   ├── llm.ts      # Gemini AI client
│   │   ├── notification.ts  # Email + SMS sender
│   │   └── dataApi.ts  # Google Sheets sync + external APIs
│   ├── routers/        # 27 tRPC routers (booking, lead, admin, chat, sms, campaigns, etc.)
│   ├── routers.ts      # Main appRouter (mounts 26 routers)
│   └── db.ts           # Database helpers
│
├── shared/             # Code shared between client & server
│   ├── const.ts        # Store name, phone, address, Google Place ID, hours
│   ├── routes.ts       # Sitemap + route registry
│   ├── services.ts     # Service definitions (tires, brakes, etc.) with pricing/FAQ
│   ├── business.ts     # Hours (Mon-Sat 8-6, Sun 9-4), holidays
│   ├── types.ts        # Shared TypeScript types
│   ├── cities.ts       # 10 city landing page configs
│   ├── neighborhoods.ts # 15 neighborhood micro-pages
│   └── blog.ts, seasonal.ts, financing.ts, global-faq.ts
│
├── drizzle/
│   ├── schema.ts       # 49 tables (users, bookings, leads, customers, coupons, invoices, etc.)
│   └── migrations/     # Generated migration files
│
├── scripts/            # prerender.mjs, fetch-instagram.mjs, sms-audit.mjs
├── package.json        # Dependencies + scripts (dev, build, start, test, db:push)
├── vite.config.ts, drizzle.config.ts, vitest.config.ts, tsconfig.json
└── todo.md             # Feature roadmap (23+ phases)
```

## DATABASE SCHEMA (49 TABLES — KEY ONES)

**Core:** users (auth, roles, loyalty), bookings (appointments, status, UTM), leads (forms, AI scoring, Sheets sync), customers (VIN, history, loyalty), booking_request_callbacks

**Commerce:** coupons, service_pricing, invoices, tire_orders (Gateway Tire PO tracking), emergency_requests

**Communication:** sms_conversations, sms_messages, sms_campaigns, review_requests, review_replies, notification_messages, service_reminders

**Customer Data:** customer_vehicles, service_history, vehicle_inspections, inspection_items, call_events, referrals, loyalty_rewards, loyalty_transactions

**Engagement:** winback_campaigns, winback_messages, winback_sends, dynamic_articles, chat_sessions, mechanicQA, share_cards, repair_gallery

**Operations:** job_assignments, technicians, kpi_snapshots, analytics_snapshots, portalSessions, shopSettings, integrationFailures

## tRPC ROUTER MAP (26 ROUTERS)

Public: weather, reviews, instagram, search, diagnose, laborEstimate, costEstimator, content
Customer-facing: booking, callback, lead, chat, coupons, garage, referrals, qa, pricing, inspection, loyalty
Admin: adminDashboard, contentAdmin, analytics, customerNotifications, followUps, weeklyReport, sms, reviewRequests, reminders, smsConversations, smsBot, reviewReplies, shareCards, gallery, technicians, customers, winback, shopdriver
Advanced: jobAssignments, invoices, kpi, portal, gatewayTire, autoLabor, campaigns, emergency, messengerBot, financing, callTracking, export, auth, system

## DESIGN SYSTEM

- Primary Yellow: #FFD700 (from shop signage)
- Primary Orange: #FF6B35 (CTAs, urgency)
- Dark Background: #0A0A0A
- Text: #A0A0A0 to #F5F5F5
- Font: Oswald (headings), system sans-serif (body)
- Vibe: No-nonsense, working-class authenticity, high contrast, mobile-first
- Animations: Minimal — scroll-triggered fade-in only (Framer Motion)

## WHAT'S ALREADY BUILT (DO NOT REBUILD)

- Multi-step booking wizard (vehicle → service → contact → photo upload)
- 14+ service detail pages + 4 Google Ads landing pages
- AI diagnostic tool (symptom → diagnosis via Gemini)
- AI chat widget, AI search bar, AI content generation
- Admin dashboard (bookings, leads, analytics, content management)
- Lead capture popup (exit-intent, scroll-triggered)
- Google Sheets CRM sync (leads + bookings)
- SMS automation (Twilio bot, review requests, campaigns, win-back)
- Customer loyalty program, referral program, coupon system
- My Garage (vehicle registry, service history, maintenance reminders)
- Customer portal (invoices, history)
- Digital inspection reports (shareable via token)
- Gateway Tire integration (PO creation, delivery tracking)
- Shopdriver inventory lookup
- Financing calculator
- Fleet booking
- Emergency request form
- 10 city landing pages, 15 neighborhood micro-pages, 13 problem/symptom pages, 10 vehicle make pages, 6 SEO service pages
- Full SEO: schema markup, sitemaps, canonical tags, breadcrumbs, prerendering
- Instagram feed, Google reviews showcase, weather-reactive alerts
- 20+ test files (Vitest)

## WHAT STILL NEEDS TO BE BUILT (PRIORITY ORDER)

### TIER 1 — Revenue & Retention Impact
1. **Post-service follow-up automation** — After a booking is marked complete, auto-send SMS: "How was your visit? Leave us a review: [link]". Use existing Twilio + review_requests infrastructure.
2. **Automated review request pipeline** — Trigger review SMS 2 hours after service completion. Track sent/opened/completed. Use existing review_requests table.
3. **Weekly business summary email** — Auto-generate and email: bookings this week, revenue estimate, top services, lead conversion rate, review count. Use existing analytics + kpi_snapshots tables. Send to Nour's email.
4. **Email capture with lead magnet** — "Download our Winter Car Care Checklist" PDF gate. Capture email → leads table → Google Sheets sync. Create the PDF content and the capture form.
5. **Geographic heatmap** — Admin page showing customer distribution by zip/city. Use existing customers table addresses. Render with a simple chart or map component.
6. **Shop gallery section** — Before/after photos from repair_gallery table displayed on a public /gallery page. Admin upload already exists.

### TIER 2 — Engagement & Polish
7. **"Why Choose Us" animated stats counter** — Animated number counters on homepage: "5000+ Cars Serviced", "15+ Years Experience", "4.8★ Google Rating", "Same-Day Service Available"
8. **Seasonal maintenance reminders** — Use service_reminders table. Auto-SMS customers when their next service is due based on service_history intervals.
9. **PWA install prompt** — manifest.json exists. Add install prompt banner for mobile users.
10. **Push notifications for specials** — Service worker + push API for coupon/special announcements.
11. **QR code generator** — Admin can generate QR codes for in-shop marketing (link to booking, reviews, specials).
12. **Video testimonials embed** — YouTube/Vimeo embed section on reviews page.
13. **Competitor monitoring** — Scrape or API-check competitor pricing/reviews periodically. Admin alert when changes detected.

## CODE RULES (NON-NEGOTIABLE)

1. **Use existing patterns.** Read surrounding code before writing. Match the style, imports, and conventions already in use.
2. **tRPC for all API calls.** No raw fetch/axios. Define procedures in the appropriate router, use TanStack Query hooks on the client.
3. **Drizzle for all DB queries.** No raw SQL strings. Use the schema from drizzle/schema.ts.
4. **Shared types in shared/.** If both client and server need a type, it goes in shared/types.ts.
5. **New pages go in client/src/pages/.** Register routes in App.tsx (Wouter). Add to shared/routes.ts for sitemap.
6. **New routers go in server/routers/.** Export from server/routers/index.ts. Mount in server/routers.ts.
7. **New tables go in drizzle/schema.ts.** Run `pnpm db:push` after schema changes.
8. **Tailwind only for styling.** No CSS files. Use existing color variables and design tokens.
9. **Mobile-first.** Every component must work on 375px screens. Test responsive behavior.
10. **No placeholder code.** Every function must be complete and working. No "TODO" comments, no "add logic here".
11. **Error handling everywhere.** tRPC procedures need try/catch. Client needs error states. Log to integrationFailures table when external calls fail.
12. **Test what you build.** Add Vitest tests for new routers/utilities. Follow existing test patterns in server/*.test.ts.

## EXECUTION PROTOCOL

When given a task:

1. **Read first.** Before writing any code, read the relevant existing files to understand current patterns.
2. **Schema first.** If the feature needs new data, update drizzle/schema.ts first.
3. **Backend second.** Build the tRPC router/procedures.
4. **Frontend third.** Build the UI that consumes the API.
5. **Test fourth.** Write tests and verify the feature works.
6. **Wire up last.** Register routes, update exports, add to sitemap if public-facing.

For multi-feature work, ship one complete feature at a time. Each feature should be a working, testable unit before moving to the next.

## INTEGRATION PATTERNS (USE THESE)

**SMS (Twilio):**
```typescript
// server/_core/notification.ts has sendSMS()
// Use existing patterns in server/routers/reviewRequests.ts and server/routers/campaigns.ts
```

**Google Sheets sync:**
```typescript
// server/_core/dataApi.ts has appendToSheet(), updateSheet()
// Use existing patterns in server/routers/lead.ts
```

**Gemini AI:**
```typescript
// server/_core/llm.ts has generateContent(), chat()
// Use existing patterns in server/routers/chat.ts and server/routers/public.ts (diagnose)
```

**S3 uploads:**
```typescript
// server/_core/index.ts has upload middleware
// Use existing patterns in booking photo upload
```

**Email:**
```typescript
// server/email-notify.ts has email templates
// server/_core/notification.ts has sendEmail()
```

## CONTEXT THAT MATTERS

- **Business hours:** Mon-Sat 8AM-6PM, Sun 9AM-4PM (shared/business.ts)
- **Location:** 22001 Euclid Ave, Euclid, OH 44117
- **Phone:** (216) 400-0396
- **Google Place ID:** In shared/const.ts
- **Domain:** autonicks.com
- **Target customers:** Working-class Cleveland metro residents who need affordable, honest auto repair
- **Competitive advantage:** Speed (same-day service), transparency (digital inspections), technology (AI tools), and trust (reviews, warranty)

## WHEN IN DOUBT

- Check todo.md for context on what was planned
- Check existing routers for patterns on how similar features were built
- Check drizzle/schema.ts for available data
- Check shared/const.ts for business constants
- Ask before adding new dependencies — the stack is already comprehensive
- Ship working code over perfect code. Iterate later.
