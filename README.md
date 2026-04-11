# Nick's Tire & Auto — Main Application

Production web platform for Nick's Tire & Auto: customer-facing site + admin tooling + automation and integrations used to support lead generation, operations, and growth.

## Tech Stack

- **Package manager:** `pnpm`
- **Runtime:** Node.js 20+ (CI uses Node 22)
- **Frontend:** React + Vite + TypeScript
- **Backend:** Node.js + Express (bundled from `server/_core/index.ts`)
- **Database:** MySQL + Drizzle ORM / Drizzle Kit
- **Testing:** Vitest
- **Formatting:** Prettier

## Quickstart (Local Development)

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Create local env file:

   ```bash
   cp .env.example .env
   ```

3. Start dev server:

   ```bash
   pnpm dev
   ```

4. Open app (default):
   - `http://localhost:3000`

## Core Commands

- Start local dev: `pnpm dev`
- Type check: `pnpm check`
- Lint (format check): `pnpm lint`
- Auto-fix formatting: `pnpm lint:fix`
- Run tests: `pnpm test`
- Build app/server: `pnpm build`
- Build + prerender: `pnpm build:prerender`
- Run production bundle: `pnpm start`
- Generate + run DB migrations: `pnpm db:push`
- Validate env contract (template): `pnpm env:validate`
- Full local gate (CI-like): `pnpm verify`

## Runtime Architecture (Practical)

- `client/` — React frontend and UI runtime
- `server/` — API, integrations, background behaviors, and business logic
- `server/_core/index.ts` — primary server entrypoint used for dev/build
- `shared/` — cross-runtime constants/types/SEO content data
- `drizzle/` + `drizzle.config.ts` — schema + SQL migrations
- `scripts/` — operational scripts (preflight, prerender, utilities)

## Environment Strategy

- `.env.example` is the canonical environment contract.
- Required local baseline is called out under sections marked **required**.
- Optional integrations are intentionally commented and can be enabled as needed.
- Railway-specific variables are host-provided and should not be set manually.

## Deployment Notes

- Production run target is the bundled Node server in `dist/index.js`.
- Typical deploy flow:
  1. `pnpm install --frozen-lockfile`
  2. `pnpm verify`
  3. `pnpm build`
  4. deploy `dist/` with required environment variables

## Load-Bearing Areas (Handle Carefully)

Before changing these, review impact and add tests where possible:

- Auth and admin access control
- Payment and Stripe paths
- CRM/sync and bridge integrations
- Twilio and outbound communication flows
- Cron/background job endpoints
- Data schema/migrations

## Governance & Contribution

- See `CONTRIBUTING.md` for workflow and standards.
- See `SECURITY.md` for vulnerability reporting.
- PRs use `.github/pull_request_template.md`.

## License

MIT
