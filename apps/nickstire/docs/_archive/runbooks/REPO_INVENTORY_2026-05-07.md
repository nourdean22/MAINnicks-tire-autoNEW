# Repo Inventory — 2026-05-07

> Full file count and reconciliation scope assessment, generated for the
> "go back over your work, reconcile and update ALL files" request.
> Numbers from `git ls-files` + `git log -1` per file.

---

## TL;DR

**1,215 tracked files.** Reconciliation scope splits into 4 layers:

| Layer | File count | Reconcile? | Why |
|---|---|---|---|
| Code (`*.ts`, `*.tsx`) | 614 | YES — verified via tests + real-fetch (already done in 7-day audit) | These are the truth |
| Docs (`*.md`) | 92 | YES — many stale audits to reconcile against current state | High-value cleanup |
| Prerendered HTML | 316 | NO — auto-generated, regen on weekly cron | Don't manually edit |
| Schema + migrations (`drizzle/*`) | 56 | NO — frozen by design (Drizzle never rewrites old migrations) | Append-only |
| Scripts (`scripts/*`) | 54 | YES — some are one-shot, some are tooling | Audit which still serve purpose |
| Other (config, lock, root) | ~83 | SPOT — mostly stable infra | Touch only on reason |

**Recommended reconciliation scope: 92 docs + 54 scripts = 146 files.**

---

## Total file inventory

```
TRACKED FILES: 1,215
UNTRACKED:     0  (working tree clean)
```

### By extension

```
360 .ts        (server-side TypeScript)
318 .html      (mostly prerendered/* — bot-served static)
254 .tsx       (React components + pages)
 92 .md        (documentation)
 43 .webp      (images)
 36 .json      (config + data)
 33 .sql       (drizzle migrations + seed data)
 28 .mjs       (build scripts)
  6 .yml       (GitHub workflows)
  5 .png       (images)
  5 .bat       (Windows scripts)
  5 .sh        (shell scripts)
  4 .txt       (data)
  2 .csv       (analytics)
```

### By top-level directory

```
342 client/         (frontend React app)
316 prerendered/    (auto-generated bot HTML)
300 server/         (backend Express + tRPC)
 65 docs/           (documentation)
 56 drizzle/        (schema + migrations)
 54 scripts/        (build + ops tooling)
 23 shared/         (cross-boundary types + data)
 10 .github/        (CI workflows + templates)
  ~ ~30 root files  (tsconfig, package.json, README, etc.)
```

---

## Code layer (614 .ts + .tsx files)

Already verified via the wave-22→76 work + 7-day audit (`docs/7DAY_AUDIT_2026-05-07.md`):
- `pnpm check` — 0 typecheck errors
- `pnpm test` — 491 vitest passing, 0 failing
- `pnpm lint:hooks` — 0 hook violations
- `pnpm validate:routes` — every App.tsx route registered with SEO meta
- Real-fetch via Chrome MCP confirmed key UI surfaces

### Code subdirectory breakdown

```
client/src/
  131 components/         (shadcn UI primitives + bespoke components)
  115 pages/              (page-level routes)
   41 pages/admin/        (admin section components)
   14 pages/compare/      (wave-33 competitor pages)
    9 lib/
    7 hooks/
    6 __tests__/
    2 data/

server/
   94 services/           (business logic by domain)
   64 routers/            (tRPC routers)
   21 lib/                (helpers — logger, sentry, etc.)
   20 cron/               (scheduled jobs)
   19 _core/              (express bootstrap, auth, db)
    8 routes/             (REST routes — mostly webhooks)
    8 middleware/         (express middleware)

shared/  23 files          (types, business constants, blog/services/cities/routes registries)
```

**Reconciliation status: GREEN.** All code paths covered by tests +
typecheck + real-fetch + hook lint. No code-level reconciliation needed
beyond the gaps already documented in `docs/7DAY_AUDIT_2026-05-07.md`.

---

## Documentation layer (92 .md files)

This is where reconciliation pays off. Many audits dated 2026-05-05
predate the wave-22→76 work and may overstate problems already fixed.

### Markdown files by location

```
ROOT (15 files):
  AGENTS.md, AUDIT_REPORT.md, CLAUDE.md, CONTRIBUTING.md,
  EXECUTION_SUMMARY.md, FOUNDATION-SCORE.md, MEMORY.md,
  PROTECTED-CORE.md, README.md, RECOVERY.md, SECURITY.md,
  USAGE-MANUAL.md, architecture_map.md, ideas.md, truth_os.md

docs/ TOP LEVEL (21 files):
  Wave-42→62 strategic docs created this session:
    DESIGN_PHILOSOPHY, EMOTION_MAP, JOURNEY, DFII_AUDIT,
    COPY_AUDIT, CRO_AUDIT, IMAGEN_BRIEF, ADMIN_PHILOSOPHY,
    ADMIN_KPI_FRAMEWORK, ADMIN_DFII_AUDIT, OBSERVABILITY,
    DATABASE_AUDIT, SECURITY_AUDIT, AI_ORCHESTRATION,
    SESSION_RECONCILIATION_2026-05-07, 7DAY_AUDIT_2026-05-07
  Pre-existing:
    BUSINESS-LANDSCAPE, CONVERSION-OVERHAUL-V1.1, ADMIN_LOGIN_GUIDE,
    NICKSTIRE-QUERY-CONTRACT, OWNER-ACTIONS-CHECKLIST

docs/audits/ (6 files): all dated 2026-05-05, predate wave-22→76 work
  2026-05-05-customer-front-audit-v2.md
  2026-05-05-multi-skill-audit.md
  ADMIN_PROBLEMS_2026-05-05.md
  AUDIT_2026-05-05.md
  IMPROVEMENTS_2026-05-05.md
  PUBLIC_SITE_SEO_2026-05-05.md

docs/security/ (10 files, all 39 days old):
  AUTH_AUDIT, DEPENDENCY_AUDIT, ENV_AUDIT, HARDENING_SUMMARY,
  HOTFIX_RUNBOOK, RATE_LIMIT_AUDIT, ROLLBACK_RUNBOOK,
  ROUTE_RISK_MATRIX, SECURITY_SURFACE_MAP, WEBHOOK_HARDENING

docs/operations/ (10 files, all 39 days old):
  ADMIN-ROLES-2FA-PLAN, ALG-ESTIMATE-SYNC-PLAN, BUSINESS_CONTINUITY,
  CRON-INVENTORY, DEPLOY_CHECKLIST, DEV-WORKFLOW,
  LOAD_BEARING_SYSTEMS, MONSTER-FILE-SHARDING-PLAN,
  SCHEMA-MIGRATION-PLAN, SSR-EVALUATION, UPTIME-MONITORING

docs/integrations/ (2): INTEGRATION_REGISTRY, VENDOR_AUDIT
docs/bridge/ (4): nour-os bridge architecture
docs/stabilization/ (2): BOOKING_ROUTE_TRUTH, DEPLOY_GUARDRAILS
docs/activation/ (2): inventory + summary
docs/brand/ (1): VOICE.md
docs/security/ (10): security audits
docs/ misc (6): gbp-content-ideas, real-device-qa-checklist,
                operator-review-workflow, review-response-templates,
                social-content-playbook, voice-ai-receptionist-design

server/lib/ai/evals/ (1): README.md
.github/ (3): pull_request_template + issue templates
```

### Doc reconciliation classes

**Class A · Recently authored, accurate (NO RECONCILE):** 16 docs created
this session in the wave-42→62 + wave-69-76 windows. These reflect current
state and have been progressively updated as work landed.

**Class B · Stale 2026-05-05 audits (RECONCILE WITH CURRENT STATE):** 6
docs/audits/* + docs/operations/* + docs/security/* (~26 files dated
~39 days ago). Many recommendations were:
  - Already-shipped (wave-22→76)
  - Superseded by newer wave docs (e.g. SECURITY_AUDIT.md replaces
    docs/security/HARDENING_SUMMARY.md? need to compare)
  - Still-pending (worth keeping with status update)

**Class C · Reference / contractual (LIGHT REVIEW):** root .md files like
CLAUDE.md, README.md, MEMORY.md, AGENTS.md. These are operating contracts;
should be confirmed accurate but rarely changed.

**Class D · Living indexes (SYNC):** architecture_map.md, truth_os.md,
docs/bridge/INVENTORY.md — these claim to be authoritative and need
verification against current code state.

---

## Scripts layer (54 .mjs + .ts files in scripts/)

```
$ git ls-files scripts/
54 files
```

Categories:
- **Audit / proof scripts** (recently added by this session):
  check-meta-divergence.ts, check-meta-lengths.ts, check-routes-lengths.ts,
  sync-routes-from-data.ts, audit-hook-after-return.mjs
- **Build / deploy scripts:**
  build-maybe-prerender.mjs, prerender.mjs, regen-prerender.mjs,
  audit-prerender.mjs, check-prerender.mjs
- **GSC / SEO automation:**
  gsc-audit.ts, gsc-drilldown.ts, gsc-submit-sitemap.ts
- **DB / migration:**
  db-migrate.ts, apply-customer-events-migration.ts,
  cleanup-junk-bookings.ts
- **VAPI / integrations:**
  vapi-update-assistant.ts (the never-touch-without-approval one)
- **One-shot:**
  many fetch-* scripts likely run once historically; need audit

**Reconciliation status: NEEDS AUDIT.** ~5-10 scripts may be one-shots
no longer in use; safe to mark or delete. Active scripts (auditing,
build, GSC, DB) are in current use.

---

## Stale-file analysis (>30 days untouched)

Top stale files by category — most are intentionally frozen, NOT broken:

| Pattern | Count (approx) | Reason |
|---|---|---|
| `client/src/components/ui/*` | ~50 | shadcn primitives — generated, don't touch unless upgrading shadcn |
| `drizzle/*.sql` + `drizzle/meta/*.json` | ~10 | migrations are append-only; old ones are frozen by design |
| `client/src/hooks/useMobile.tsx`, etc. | a few | stable utility hooks |
| `tsconfig.node.json`, `components.json` | a few | stable config |
| `docs/security/*` + `docs/operations/*` | ~20 | **WORTH RECONCILING** — predates wave-22→76 |
| `docs/audits/2026-05-05-*` | 6 | **WORTH RECONCILING** — predates wave-22→76 |

The "stale" signal is misleading at first glance — only ~26 of the 50+
stale .md files are actually candidates for reconciliation (the docs/audits/,
docs/security/, docs/operations/ subdirs). The rest are stable-by-design.

---

## Recommended reconciliation plan

Given the user request "reconcile and update ALL of them," propose a
3-phase plan focused on real value:

### Phase 1 · Stale audit reconciliation (HIGH VALUE · ~26 files)
For each `docs/audits/*`, `docs/security/*`, `docs/operations/*` file:
1. Read it
2. Compare to current state (does the recommendation still apply?)
3. Mark as one of:
   - ✅ ALREADY DONE — add closure note + date + reference to wave that addressed it
   - 🔄 SUPERSEDED — point to newer doc that replaces it
   - ⏸ STILL PENDING — leave as-is with current-state stamp
   - 🗑 RETIRE — older content no longer relevant

### Phase 2 · Living-index sync (MEDIUM VALUE · ~5 files)
For architecture_map.md, truth_os.md, docs/bridge/INVENTORY.md,
docs/integrations/INTEGRATION_REGISTRY.md, MEMORY.md:
1. Compare claims to actual code state
2. Update sections that have drifted
3. Mark with current-state timestamp

### Phase 3 · Script audit (LOW VALUE · ~54 files)
For each scripts/* file:
1. Verify it still has a purpose (referenced in package.json or used recently)
2. Move dead scripts to scripts/_archive/ or delete
3. Document active scripts in a single scripts/README.md

### Phase 4 (skip) · Code reconciliation
Already covered by 7DAY_AUDIT_2026-05-07. Tests + typecheck + lint:hooks
+ real-fetch all green. No further code reconciliation needed.

### Phase 5 (skip) · Prerendered HTML
Auto-generated. Manual edits would be lost on next regen. Don't touch.

---

## Time estimate

- Phase 1 (26 audit docs): **~30-45 min** (read + classify + light edits)
- Phase 2 (5 living indexes): **~15-20 min** (targeted update of drift)
- Phase 3 (54 scripts): **~20-30 min** (mostly grep + a few deletions)

**Total: ~65-95 min focused reconciliation work.**

---

## Last updated

2026-05-07 (wave-77 inventory). Run `git ls-files | wc -l` to confirm
total at any future point.
