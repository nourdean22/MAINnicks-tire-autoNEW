# Nick's Tire & Auto — Main Application Operating Repository

Production application platform for Nick's Tire & Auto. This repository powers customer acquisition flows, shop operations interfaces, admin controls, and multi-system integrations that directly affect revenue and service delivery.

---

## 1) Mission of this repository

This is **not** a brochure website repo. It is an operating system for:

- customer-facing conversion flows
- admin/business control surfaces
- automation and integration pipelines
- reliability-sensitive business processes

If this repo drifts from truth (docs/scripts/env/CI), operator trust degrades and failure risk rises.

---

## 2) Current stack (source of truth)

- **Package manager:** `pnpm`
- **Runtime:** Node.js 20+ (CI uses Node 22)
- **Frontend:** React + Vite + TypeScript
- **Backend:** Node.js + Express (`server/_core/index.ts` entrypoint)
- **Database:** MySQL + Drizzle ORM + Drizzle Kit migrations
- **Testing:** Vitest
- **Formatting/lint baseline:** Prettier (repo-scoped script targets)

---

## 3) Local operator quickstart

### Prerequisites

- Node.js 20+
- pnpm 9+
- MySQL instance reachable by `DATABASE_URL`

### Setup

```bash
pnpm install
cp .env.example .env
pnpm env:validate
```

### Development

```bash
pnpm dev
```

Default app URL: `http://localhost:3000`

---

## 4) Core command surface (required to know)

| Command             | Purpose                                                                  | When to run                 |
| ------------------- | ------------------------------------------------------------------------ | --------------------------- |
| `pnpm dev`          | Start local dev server                                                   | During feature/dev work     |
| `pnpm check`        | TypeScript safety gate                                                   | Before every PR             |
| `pnpm lint`         | Prettier/format lint gate on governance contract files                   | Before every PR             |
| `pnpm lint:fix`     | Auto-fix formatting for lint targets                                     | Before commit if lint fails |
| `pnpm test`         | Vitest suite                                                             | Before PR + CI              |
| `pnpm build`        | Production build for client + bundled server                             | Before deploy               |
| `pnpm env:validate` | Environment contract validation (`.env.example`)                         | Local setup + CI            |
| `pnpm verify`       | Local CI-equivalent chain (`env:validate → check → lint → test → build`) | Before merge/deploy         |
| `pnpm db:push`      | Generate + run DB migrations                                             | Schema changes              |

---

## 5) Architecture boundaries (operator model)

### Customer runtime

- path: `client/`
- responsibility: conversion, booking, contact, financing CTAs, public experience

### Server/control runtime

- path: `server/`
- responsibility: routing, auth, admin APIs, integrations, business logic

### Core bootstrap

- path: `server/_core/index.ts`
- responsibility: runtime assembly, middleware, mounts, boot behavior

### Data model + migrations

- paths: `drizzle/`, `drizzle.config.ts`
- responsibility: schema truth, migration evolution, DB contract

### Shared domain contracts

- path: `shared/`
- responsibility: cross-runtime constants, route/domain semantics, SEO/service datasets

### Ops scripts

- path: `scripts/`
- responsibility: deploy helpers, validation tasks, operational tooling

---

## 6) Environment contract strategy

- `.env.example` is the baseline environment contract for this repo.
- Section headers classify variables by operational requirement level.
- `pnpm env:validate` enforces required-key coverage in `.env.example`.
- Runtime validation mode exists via:

```bash
pnpm env:validate -- --runtime
```

### Environment governance rules

1. Never commit real secrets.
2. New env keys must be added to `.env.example` with explanatory comments.
3. If a key is required for baseline operation, add it to validator required lists.
4. If a key is optional integration-only, document fallback behavior.

---

## 7) CI enforcement model

`/.github/workflows/test.yml` enforces:

1. dependency install
2. environment contract validation
3. type checking
4. lint gate
5. tests
6. production build
7. failure artifact upload and summary output

CI should be treated as the authoritative contract gate for merge safety.

---

## 8) Load-bearing systems (do not change blindly)

Any changes touching these areas require explicit risk review + validation notes in PR:

- authentication and admin authorization paths
- Stripe/payment paths
- Twilio/SMS and notification flows
- cron/background job trigger paths
- bridge/sync integration paths
- DB schema/migrations
- webhook verification paths (Meta/Twilio/etc.)

---

## 9) Deployment and rollback baseline

### Deploy baseline

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm build
```

Deploy bundled output from `dist/` with required environment configuration.

### Rollback baseline

- revert to previous known-good deploy artifact/commit
- verify critical business flows (booking, lead/contact, admin login)
- review integration heartbeat (SMS, bridge sync, payment endpoints)

---

## 10) Operational incident checklist (minimum)

When production issues occur:

1. identify scope (public, admin, integration, DB, deploy)
2. inspect latest deploy/commit and CI status
3. validate env contract and required keys presence
4. run targeted critical path checks
5. decide rollback vs hotfix
6. record root cause + prevention action

---

## 11) Contribution and governance

- Contribution standards: `CONTRIBUTING.md`
- Security reporting: `SECURITY.md`
- PR process and quality checklist: `.github/pull_request_template.md`
- Ownership routing: `.github/CODEOWNERS`

---

## 12) License

MIT
