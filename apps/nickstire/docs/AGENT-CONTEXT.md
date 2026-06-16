# AGENT-CONTEXT.md — Nick's Tire & Auto
> Quick-load context for Antigravity and any AI agent working on `apps/nickstire/`.
> For full context, read `CLAUDE.md` in this directory and apply the [CIITTY framework](.agents/frameworks/ciitty/SKILL.md).
> For monorepo rules, read root `AGENT-OPERATING-PROFILE.md`.
>
> Last verified: 2026-06-10 · Post wave-109 + admin-excellence

---

## What This App Is

**Nick's Tire & Auto** — full-service auto repair + tire shop in Cleveland/Euclid/Parma, Ohio.
This is the **customer-facing website + business operations platform** for a real, active business.

- **Production:** `https://nickstire.org`
- **Railway service:** `MAINnicks-tire-auto`
- **Local path:** `[REPO_ROOT]/apps/nickstire/`
- **Deploy:** Push `main` → Railway auto-deploys

---

## Stack at a Glance

| Layer | Tech |
|---|---|
| Frontend | Vite 7 + React 19 + Tailwind CSS 4 |
| Backend | Express 4 + tRPC 11 |
| Database | Drizzle ORM + MySQL / TiDB Cloud |
| Voice AI | VAPI (voice receptionist) |
| SMS | Twilio via F25e gateway · Primary: 216-862-0005 |
| Payments | Stripe |
| Deploy | Railway |
| Tests | Vitest (~700+ tests) |

---

## Directory Map

| Path | Purpose |
|---|---|
| `client/src/pages/` | React pages |
| `client/src/pages/admin/` | Admin UI panels |
| `server/_core/index.ts` | Express entry (single entry — no multi-entry split) |
| `server/routers/` | tRPC routers |
| `server/services/` | Business logic |
| `server/cron/` | Scheduled jobs |
| `shared/` | Constants used by client + server |
| `drizzle/schema.ts` | **DB source of truth** |
| `drizzle/*.sql` | Hand-applied migrations (NOT auto-run) |
| `prerendered/` | Generated static HTML — **never hand-edit** |
| `scripts/` | Prerender · sitemap · deploy helpers · validators |
| `docs/integrations/INTEGRATION_REGISTRY.md` | Canonical integration list |
| `docs/operations/LOAD_BEARING_SYSTEMS.md` | Canonical load-bearing systems |

---

## Verify Gates (Run Before Every Push)

```bash
cd [REPO_ROOT]/apps/nickstire

pnpm run verify         # MASTER GATE — env + check + lint + source-lint + hooks-lint + route-validate + tests + build
pnpm run check          # tsc --noEmit (must be 0)
pnpm run lint           # eslint
pnpm test               # vitest
pnpm run validate:routes  # confirm registered routes match handler files
pnpm run lint:hooks       # catch useState used after early-return (silently breaks React)
pnpm run prerender        # regenerate prerendered HTML after content changes (DO NOT hand-edit prerendered/)
```

---

## Critical Safety Rules

### 🚨 SMS / Twilio (HIGH RISK)

```
NEVER: Send test SMS to real customer phone numbers
NEVER: Change Twilio routing without explicit approval
NEVER: Remove TCPA STOP footer from outbound campaigns
ALWAYS: Rate limits and caps are in place — don't remove them
Primary SMS: 216-862-0005 via F25e gateway
```

### 🚨 Google Business Profile — GBP CONTENT RISK

```
✅ RESOLVED (Y1):
   Name and price fabrications are fully blocked via Jaccard and customer identity
   validation assertions in server/services/gbpContentGenerator.ts. It fetches real 
   reviews and rejects fabricated testimonial quotes or unverified pricing.

DO NOT: Expand this file's functionality without operator approval
DO NOT: Add new auto-posting features without operator approval
DO NOT: Run it with new content types
```

### 🚨 Pricing

```
Canonical prices are in: shared/pricing.ts
Confirmed correct (2026-06-01):
  Oil change: $49 (conventional) / $80 (premium)
  
DO NOT change prices in any file without updating shared/pricing.ts and re-running pnpm run prerender
SERP meta descriptions also contain prices — sync those too
```

### 🚨 Migrations

```
Migrations are hand-applied SQL — NOT auto-run.
Process:
  1. Write SQL → drizzle/NNNN_*.sql
  2. Apply to DB manually (Railway CLI or scripts/apply-*.ts)
  3. Run pnpm run check to confirm
  4. Update truth_os.md

NEVER: Run drizzle-kit migrate in production without explicit approval
```

### 🚨 Voice / VAPI

```
VAPI webhook secret required for admin push
voiceAgent.tireInquiry: Only create a lead for rack-check (not every caller)
PII projection must stay trimmed in all VAPI tool responses
```

---

## AI Gateway Rules

```
Structured output (JSON schema) → MUST use OpenAI invokeLLM()
  Ollama CANNOT do strict JSON schema — will silently fail or return malformed output

Unstructured generation → OK to use local Ollama if AI_PROVIDER allows
DO NOT hardcode AI_PROVIDER in env or production config — disables failover
```

---

## Active State (2026-06-05)

- **AI gateway:** Live — Ollama local-first + OpenAI fallback
- **Admin:** All 5 panels rendering · Feature Flags = 39 (engine flags removed)
- **Pricing:** Fixed · NITTO/BFG prices halved after D&K field inversion bug
- **SMS:** F25e live · TCPA STOP footer in outbound campaigns
- **Tests:** ~700 passing (single-fork mode recommended on this machine)
- **Migrations:** 0066 (drop_engine_flags) applied to prod

## Completed Follow-Ups (Resolved & Deployed)

| ID | Issue | Resolution |
|---|---|---|
| Y1 | GBP content fabrication in `gbpContentGenerator.ts` | Prevented mock data/price fabrication by fetching real customer reviews and enforcing Jaccard check assertions. |
| Y8 | Winback `tire_customer` segment has no tire signal | Added exists subquery across invoices, orders, and service history, with a generic copy fallback. |
| Y9 | WalkIn calculator oil presets compute ~$82 vs advertised $49 | Calibrated presets in `WalkInCalculatorSection.tsx` to set `laborHours: 0` so flat rates match advertised pricing. |
| Y12 | CommandCenterSection nav-dead (only via `?tab=commandCenter` deep-link) | Dead UI section removed completely from the code and router references. |
| Y13 | Coupon `maxRedemptions` declared but never enforced | Atomic concurrency-safe coupon validation and redemption cap increment implemented in `db.ts` and `services.ts`. |

---

## Canonical Context Files (Read These First)

| File | Purpose |
|---|---|
| `CLAUDE.md` | **Primary** — full agent context + MASTER OPERATING DIRECTIVE |
| `.remember/remember.md` | Last-session handoff |
| `truth_os.md` | What's live in prod right now |
| `architecture_map.md` | Request flow diagram |
| `PROTECTED-CORE.md` | Files you cannot touch without explicit approval |
| `RECOVERY.md` | Recovery procedures |
| `MEMORY.md` | Operator memory index |

---

## iOS PWA — Critical UI Rule

`nickstire.org` runs as a standalone iOS PWA on the operator's phone.

```
window.confirm()  → SILENTLY SUPPRESSED (user sees nothing, action doesn't fire)
window.alert()    → SILENTLY SUPPRESSED
window.prompt()   → SILENTLY SUPPRESSED

Replace with: in-DOM two-tap confirm component (tap → "Are you sure?" → tap again)
This applies to ALL admin destructive actions.
```

---

## High-Risk Change Policy

These require explicit approval + impact analysis + rollback path:

- Auth / admin access
- Payments / Stripe
- Twilio / SMS / notifications
- Cron / background jobs
- Webhook verification logic
- DB schema and migrations
- GBP posting logic

---

*Update after each major wave. Last updated: 2026-06-10.*
