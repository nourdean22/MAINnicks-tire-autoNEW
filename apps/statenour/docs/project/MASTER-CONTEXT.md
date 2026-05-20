# NOUR OS — Universal Agent Context (v7.0-alpha)
> **🗄 STATUS: HISTORICAL.** This file is from the v7.0-alpha era
> (April 12, 2026). Predates v7.6 chat overhaul, v8 mega-overhaul,
> v9 Command Spine + NICK Prime, and v10 Prime Reliability +
> Control Layer.
>
> For current truth read [`../RECONCILIATION.md`](../RECONCILIATION.md).
> For active execution read [`V10-PLAN.md`](./V10-PLAN.md).
>
> Paste this into ANY AI agent for HISTORICAL v7.0 context.
> Last updated: April 12, 2026.

---

## WHO IS NOUR

Nour Dean, 31, CEO of Nick's Tire & Auto (Cleveland/Euclid area). Lebanese-American. ADHD (Adderall IR 10mg). Building NOUR OS as a personal mastery + business operating system.

**Communication style:** ALL CAPS = emphasis (not anger). Sends 5-10 requests per message from phone. "GO" = start now. "Continue" = keep going. "Deploy" = commit + push + verify. Hates: vague work, lazy code, missing details, having to ask twice.

**Operating energy:** Controlled Tasmanian Devil — chaos → devastating output. Fortune 500 CEO quality minimum at all times.

**Core rule:** NEVER ASSUME ANYTHING. Always verify by checking files, git history, or asking.

---

## THE TWO SYSTEMS

### 1. statenour-os (bdnick.info) — Personal Command Center
- **Stack:** Next.js 16 App Router, TypeScript, Prisma, Neon PostgreSQL, Tailwind CSS 4
- **Deployed on:** Vercel (auto-deploys on push)
- **Repo:** github.com/nourdean22/statenour-os
- **Branches:** Push to BOTH `codex/ollama-local` AND `statenour-master` (Vercel production = statenour-master)
- **AI:** Venice AI (primary, OpenAI-compatible), Anthropic (fallback)
- **Deploy command:** `git push origin codex/ollama-local`
- **Local path:** `C:\Users\nourd\NOUR-OS\apps\statenour-os`

**What it contains (v7.0-alpha):**
- 155+ AI tools (including predictStaffing, generateImage, findCustomer 360°, githubSafeCommit, buildArchitectureMemory, learnCodingPreference, checkDeployStatus, getRepoMap, githubReadMultiple)
- 25 autonomous nudge rules + 9 brain intelligence engines
- 17+ brain engines: weather, revenue playbook, synthesis, contextual recall (SEMANTIC embeddings), emotional arc, financial forecast, time intelligence, learning velocity, outcome tracker, blind spot detector, counter-intuitive, wisdom distiller, attention tracker, correlation finder, learning journal, brain maturity, teaching moments
- Vector embedding memory: cosine similarity, hybrid scoring (70% semantic + 15% recency + 15% category), auto-embeds on write, auto-backfill cron (30/run, morning + evening)
- Morning Auto-Pilot: ONE Telegram message with schedule + brief + leads + weather + synthesis + staffing + revenue pace + "Approve All" button
- Evening debrief: AI brief + staffing prediction + dashboard action button
- Telegram: 12 commands (/status, /pace, /schedule, /staffing, /brief, /memory, /imagine, /customer, /shop, /brain, /help) + photo analysis (Venice qwen3-vl vision) + voice transcription (Whisper) + URL analysis
- Venice AI image generation: inline in chat (tap-to-expand) + /imagine Telegram command, nano-banana-2, 512x512 default
- Nick personality: provocative challenger, catches blind spots, teaches through data, tracks own prediction accuracy
- Builder mode: GitHub read/write/search/commit/deploy for BOTH repos, safe branch workflow, architecture memory, coding preferences
- "Hey Nick" wake word: Web Speech API continuous recognition, green pulse mic toggle
- Dashboard: animated counters, live clock, sparklines, progress rings, habit heatmap, weather card, arsenal health, brain health ring, SSE real-time streaming
- Chat: voice input (single + continuous + wake word), TTS, pin messages, inline image rendering, quick-action buttons
- Command palette (Cmd+K): 41 items — all 28 pages + 9 quick actions + 5 system commands
- Auto-pilot controls (9 toggles, server-synced)
- In-memory TTL cache: system prompt 5min, dashboard 30s, attention/maturity 10min
- Revenue pace tracker: $20K monthly target, business days calculation
- 360° customer lookup: searches BOTH nickstire (jobs/invoices) AND brain memories + person profiles
- Marriage health tracking, Dania neglect nudge
- Causation map page (/causation)

### 2. nickstire.org — Business Website + Admin
- **Stack:** Express 4, tRPC 11, React 19, Vite, TypeScript, Drizzle ORM, TiDB (MySQL)
- **Deployed on:** Railway (auto-deploys on push to main)
- **Repo:** github.com/nourdean22/MAINnicks-tire-autoNEW
- **Branch:** `main`
- **AI:** Venice AI (OpenAI-compatible)
- **Deploy command:** `git push origin main`
- **Local path:** `C:\Users\nourd\projects\nickstire`

**What it contains:**
- Customer-facing website: 40+ pages, SEO optimized, LocalBusiness schema on 44 pages
- 8 chat tools: check_schedule, get_price_estimate, lookup_booking, lookup_customer, get_current_specials, find_tire_in_stock, estimate_wait_time, check_financing
- Admin panel: 30+ sections across Operations, Sales, Revenue, Customers, Marketing, Intelligence, System
- Intelligence center: 50 engines across 7 categories (Overview, Revenue, Customers, Operations, Marketing, Growth, Safety)
- Lead management: Kanban board, SLA timers, NOT YET CONTACTED alert banner, AI draft response
- Estimate pipeline: aging dashboard with visual bars, follow-up tracking, pipeline value
- Customer journey funnel: Lead → Estimate → Drop-Off → Job → Review → Retained
- Weather correlation card (pulls from statenour /api/weather)
- NOUR OS Brain link card (pulls from statenour /api/brain/status)
- 17 cron jobs: review requests, stale lead follow-up, morning brief, customer segmentation, win-back, etc.
- Bridge to statenour: dual-push (file + HTTP webhook), circuit breaker, deduplication, retry queue
- AI review draft (negative reviews get Venice AI-drafted responses)
- Review request system (Twilio SMS, 2hr delay, feature-flagged)
- Content generator, Instagram integration, Meta CAPI

---

## BUSINESS MODEL

**Nick's Tire & Auto** — FCFS (First Come First Served) / Drop-Off / Appointmentless
- NOT an appointment shop. NEVER say "Book Appointment" — say "Schedule Your Drop-Off"
- Customers drive down, drop off their car, call an Uber out
- The goal: a LINE OF CARS at the shop every day
- Free inspections under 30 minutes
- Estimates ≠ invoices (customer may decline after inspection)
- Cleveland/Euclid area, Mon-Sat 8am-6pm
- Phone: (216) 862-0005
- Revenue target: $20K/month take-home
- CRM: AutoLaborExperts (DO NOT break existing ALG integrations)
- Competitors: AutoLabor, DK Tire, chain shops
- Advantage: speed, trust, pricing transparency, AI-powered estimates

---

## BRIDGE BETWEEN SYSTEMS

Events flow: nickstire.org → bridge → statenour-os (dual-push: /api/sync/events + /api/webhooks/nickstire)

Event types: new_lead, booking_complete, invoice, callback, emergency, review, revenue, stage-change

The webhook receiver on statenour triggers instant Telegram alerts for critical events (new leads, callbacks, emergencies, reviews).

---

## ENV VARS ON VERCEL (statenour-os)

Set across all environments:
- DATABASE_URL, DIRECT_URL (Neon PostgreSQL)
- VENICE_API_KEY (primary AI)
- ANTHROPIC_API_KEY (fallback AI)
- TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
- STATENOUR_SYNC_KEY (bridge auth)
- GITHUB_TOKEN (GitHub file tools)
- HUGGINGFACE_API_KEY (Whisper voice)
- GOOGLE_SERVICE_ACCOUNT_KEY (Drive access — share folders with nour-os-drive@teezy-491218.iam.gserviceaccount.com)
- CRON_SECRET
- AUTH_SECRET, AUTH_GOOGLE_CLIENT_ID, AUTH_GOOGLE_CLIENT_SECRET

---

## KEY FILE PATHS (statenour-os)

| File | What it does |
|------|-------------|
| lib/ai/tools.ts | 145+ AI tools (tool calling with AI SDK) |
| lib/ai/system-prompt.ts | Nick's system prompt builder (pulls live DB data + all brain engines) |
| lib/brain/autonomous-engine.ts | 25 autonomous nudge rules |
| lib/brain/weather-intelligence.ts | Cleveland weather → business impact |
| lib/brain/synthesis-engine.ts | Unified intelligence from all engines |
| lib/brain/revenue-playbook.ts | What conditions produce $1K+ days |
| lib/brain/daily-scheduler.ts | Auto time-blocked schedule |
| lib/brain/contextual-recall.ts | Semantic memory recall (vector embeddings + hybrid scoring) |
| lib/brain/embedding-utils.ts | Cosine similarity, embedding storage, semantic search |
| lib/services/telegram.ts | Telegram bot (sendMessage, inline keyboards, edit, callbacks) |
| lib/services/lead-drafts.ts | AI draft generator for stale leads |
| lib/services/autopilot-approve.ts | Executes morning autopilot approval actions |
| app/api/cron/autopilot-morning/route.ts | Morning auto-pilot orchestrator (ONE message) |
| app/api/telegram/webhook/route.ts | Telegram callback_query handler for inline buttons |
| app/(mastery)/command/page.tsx | Main dashboard (SSE streaming, animated) |
| app/(mastery)/chat/page.tsx | Nick chat (voice, TTS, pins, quick actions) |
| app/(mastery)/causation/page.tsx | Cross-domain causation map |
| app/(mastery)/settings/page.tsx | Auto-pilot toggles, themes, system info |
| components/hud/ | Notification center, keyboard shortcuts, status bar, neural background |
| components/ui/ | AnimatedCounter, Sparkline, ProgressRing, ActivityHeatmap, LiveClock |
| prisma/schema.prisma | ~96 models, Neon PostgreSQL |

## KEY FILE PATHS (nickstire.org)

| File | What it does |
|------|-------------|
| server/routers.ts | All tRPC routers (55+) |
| server/nour-os-bridge.ts | Event bridge to statenour (dual-push) |
| server/services/chatTools.ts | 8 customer chat tools |
| server/cron/ | 17 cron jobs |
| server/_core/llm.ts | Venice AI LLM wrapper |
| client/src/pages/admin/ | 30+ admin sections |
| client/src/pages/admin/intelligence/ | 7-tab intelligence center |
| drizzle/schema.ts | Database schema (TiDB/MySQL) |

---

## NOUR'S PERSONAL CONTEXT

- Boxing at Strong Style, weight goal 186 from 230
- Wife: Dania (marriage health tracked in brain memories)
- ADHD: Adderall IR 10mg, peak focus 45-180min after dose
- Build-Drift-Reset cycle: boredom → new projects → drift → reset
- When stressed: impulse purchases, premature investments
- Revenue up → overconfidence → relaxed follow-through → drift (the day after a $2K+ day is most dangerous)

## CROSS-DOMAIN CAUSATION CHAINS (Nick uses these proactively)

1. Body → Business: skip workouts 3+ days → discipline drops → revenue follows within 5 days
2. Sleep → Decisions: under 6h sleep → 2x higher regret rate
3. Callbacks → Revenue: every hour unanswered → -15% conversion probability
4. Adderall → Deep Work: peak 45-180min after dose, protect for MIT
5. Boredom → Drift: "I want to try something new" = Phase 1 drift
6. Stress → Spending: elevated stress → impulse purchases
7. Dania → Performance: no mentions in 7+ days → life satisfaction drops
8. Loops → Anxiety: open loops > 8 → scattered state → poor sleep
9. Revenue Up → Overconfidence: $2K+ day → next day is highest drift risk
10. Habits 90%+ → Level Up: if it's not hard, it's not growing you

---

## RULES FOR ANY AGENT

1. Never say "Book Appointment" — say "Schedule Your Drop-Off"
2. statenour-os deploys to Vercel (push to BOTH branches)
3. nickstire.org deploys to Railway (push to main)
4. Venice AI is primary, NOT OpenAI or Vercel AI Gateway
5. Never assume — always verify files, git history, or ask
6. Fortune 500 quality minimum
7. ADHD-aware: Build-Drift-Reset cycle is real, system must account for it
8. AutoLaborExperts is the shop CRM — never break ALG integrations
9. The business is FCFS/drop-off, NOT appointments
10. Nour controls from phone — all UI must be mobile-friendly
11. When in doubt, choose speed + action over perfection + hesitation
12. Never suggest new systems — say "Run what you have"
13. Always end with ONE specific action for the next 5 minutes
14. ALL CAPS from Nour = emphasis, not anger
