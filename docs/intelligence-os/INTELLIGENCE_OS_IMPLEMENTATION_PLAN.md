# INTELLIGENCE OS IMPLEMENTATION PLAN
> Phased Engineering & Deployment Roadmap

---

## Phase 1: Database Schemas & Source Registry (MVP Design & Schemas)

### Objective
Establish the database models for `RegisteredSource`, `IntelligenceClaim`, and `BriefingLog` in Prisma, apply them, and seed the initial MVP sources.

### Files to Inspect
* [schema.prisma](file:///C:/Users/nourd/NOURCITY/apps/statenour/prisma/schema.prisma)

### Files to Modify
* [schema.prisma](file:///C:/Users/nourd/NOURCITY/apps/statenour/prisma/schema.prisma) (Add new models)

### New Files to Create
* `apps/statenour/prisma/seeds/seed-sources.ts` (Registry seed script)
* `apps/statenour/scripts/apply-intelligence-schema.ts` (Migration runner)

### Existing Systems to Reuse
* Neon database client `apps/statenour/lib/prisma.ts`
* Schema tracking ledger `SchemaChangeLedger`

### Database Changes
* `RegisteredSource` table:
  - `id` String (cuid) @id
  - `name` String
  - `url` String @unique
  - `domain` String (ai | seo | competitor | automotive | macro)
  - `authScore` Float @default(70.0)
  - `refreshInterval` Int @default(86400) (seconds)
  - `lastFetched` DateTime?
  - `createdAt` DateTime @default(now())
* `IntelligenceClaim` table:
  - `id` String (cuid) @id
  - `text` String
  - `sourceId` String
  - `domain` String
  - `confidence` Float
  - `status` String (source_supported | weak_support | unverified)
  - `verificationScore` Float
  - `createdAt` DateTime @default(now())

### API Routes
* `/api/intelligence/sources` (GET/POST - Manage registry)

### Background Jobs
* None in this phase.

### UI Changes
* None in this phase.

### Tests
* `tests/intelligence-schema.test.ts` (Verify model validations and query lookups)

### Risks
* Prisma `db push` schema changes might conflict with existing tables if naming overlaps.
* Mitigation: Pre-run verification script and inspect database tables.

### Rollback Plan
* Remove the new models from `schema.prisma`, run `prisma db push --force` (only drops the new tables, preserving existing ones).

### Definition of Done
* Database models applied to production Neon PG.
* Seeding script executes successfully, registering FRED, GSC, and NHTSA APIs.

---

## Phase 2: Ingestion & Extraction Plane (Acquisition & Ingestion)

### Objective
Implement the Acquisition connectors and the JSON-schema-constrained Claim extraction pipeline with vector grounding.

### Files to Inspect
* [generate-source-pack.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/scripts/generate-source-pack.ts)
* [ingest-notebooklm-output.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/scripts/ingest-notebooklm-output.ts)
* [provider.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/lib/ai/provider.ts)

### Files to Modify
* None.

### New Files to Create
* `apps/statenour/lib/intelligence/connectors/fred.ts` (FRED Macro connector)
* `apps/statenour/lib/intelligence/connectors/nhtsa.ts` (NHTSA Recall connector)
* `apps/statenour/lib/intelligence/extraction.ts` (Structured JSON claims extractor)
* `apps/statenour/lib/intelligence/grounding.ts` (Grounding & similarity validator)

### Existing Systems to Reuse
* Firecrawl scraper client (`lib/integrations/firecrawl.ts`)
* Vector embeddings generation (`lib/ai/provider.ts`)
* Cosine similarity utilities (`lib/brain/embedding-utils.ts`)

### Database Changes
* None.

### API Routes
* `/api/intelligence/ingest` (POST - Trigger manual run for specific source)

### Background Jobs
* None in this phase.

### UI Changes
* None.

### Tests
* `tests/ingest-connectors.test.ts` (Verify data retrieval and mock HTTP responses)
* `tests/claims-extraction.test.ts` (Validate JSON schema extraction accuracy)

### Risks
* High token cost and rate limit hits during parallel Perplexity searches.
* Mitigation: Enforce strict throttling and local caching of scraped source files.

### Rollback Plan
* Disable the new connectors; falls back to manual folder-based RAG uploads.

### Definition of Done
* Claims extraction service runs successfully, converting scraped documents into schema-valid Claim structures.
* Semantic grounding correctly flags claims with similarity scores $< 0.55$.

---

## Phase 3: Scoring & Briefing Engine (Scoring & Briefings)

### Objective
Build the Opportunity/Threat scoring algorithms and schedule the Daily/Weekly Executive Briefing generations on Inngest.

### Files to Inspect
* [morning-brief.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/src/inngest/functions/morning-brief.ts)
* [jobs.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/src/inngest/jobs.ts)

### Files to Modify
* [jobs.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/src/inngest/jobs.ts) (Add briefing cron schedules)

### New Files to Create
* `apps/statenour/lib/intelligence/scoring.ts` (SQS, Opportunity, and Threat calculators)
* `apps/statenour/src/inngest/functions/intelligence-brief.ts` (Cron briefing generator)

### Existing Systems to Reuse
* Inngest worker client (`src/inngest/client.ts`)
* Web push notification pipeline (`lib/notifications/push.ts`)

### Database Changes
* Add `BriefingLog` table to persist historical briefs.

### API Routes
* `/api/intelligence/briefs/today` (GET - Fetch latest generated brief)

### Background Jobs
* Inngest Cron `intelligence-daily-brief` (Daily at 10:00 UTC)
* Inngest Cron `intelligence-weekly-brief` (Sundays at 11:00 UTC)

### UI Changes
* None.

### Tests
* `tests/briefing-generator.test.ts` (Verify formatting and section structures)

### Risks
* Briefings might contain hallucinated opportunities or stale indicators.
* Mitigation: Verify SQS threshold ($\ge 50$) and exclude low-confidence sources.

### Rollback Plan
* Disable Inngest crons; fallback to legacy daily journal summary briefings.

### Definition of Done
* Briefs generate automatically every morning, push notification successfully dispatched to operator's PWA.

---

## Phase 4: Mastery Cockpit Integration (Command Center & UI)

### Objective
Create the visual frontend elements in Statenour to display the briefings, opportunities queue, registered sources status, and the decision ledger.

### Files to Inspect
* [page.tsx](file:///C:/Users/nourd/NOURCITY/apps/statenour/app/(mastery)/research/page.tsx)
* [page.tsx](file:///C:/Users/nourd/NOURCITY/apps/statenour/app/(mastery)/goals/page.tsx)

### Files to Modify
* [page.tsx](file:///C:/Users/nourd/NOURCITY/apps/statenour/app/(mastery)/research/page.tsx) (Integrate registry view)

### New Files to Create
* `apps/statenour/app/(mastery)/intelligence/brief/page.tsx` (Briefing display page)
* `apps/statenour/app/(mastery)/intelligence/ledger/page.tsx` (Decision outcome logging view)
* `apps/statenour/components/intelligence/OpportunityCard.tsx` (Reusable UI card)

### Existing Systems to Reuse
* Mastery UI shell components

### Database Changes
* None.

### API Routes
* `/api/intelligence/decisions/log` (POST - Record operator choice)

### Background Jobs
* None.

### UI Changes
* Mobile-first briefings viewport.
* Two-tap execution approval modals for tasks.

### Tests
* Playwright E2E renders tests on `/intelligence/brief`.

### Risks
* UI bloating.
* Mitigation: Keep a strict editorial-minimalist approach. Max 5 key actions on screen.

### Rollback Plan
* Disable navigation links to the `/intelligence` subroutes.

### Definition of Done
* All visual pages accessible, data loads correctly from Neon DB, operator can submit decision outcome updates via the web UI.
