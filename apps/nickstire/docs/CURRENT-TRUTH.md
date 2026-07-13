# Nick's Tire & Auto — Current Truth

**Status:** active operating contract  
**Verified against:** `main` on 2026-07-11  
**Owner:** Nick's Tire & Auto operator

Live code and production evidence override this document when they disagree. Update this file in the same change that alters a listed contract.

## Live application

- Application: `apps/nickstire`
- Public site and admin: `https://nickstire.org`
- Deployment: GitHub `main` to Railway
- Client: React 19 and Vite
- Server: Express 4 and tRPC 11
- Canonical operational database: TiDB Cloud / MySQL through Drizzle
- Package manager: pnpm workspace
- Master application gate: `pnpm run verify` from `apps/nickstire`

## Canonical business records

- Leads: `leads`
- Booking requests and job-stage records: `bookings`
- Customers: `customers`
- Repair revenue: `invoices`
- Shop work: `work_orders` and imported ShopDriver records
- AI receptionist calls: `vapi_call_logs`
- Callback requests: `callback_requests`
- Search detail: `search_performance`

A transcript classification, tool invocation, direction instruction, transfer attempt, estimated value, or modeled close rate is not a paid invoice.

## GSC data flow

1. `server/pipelines/gsc-data.ts` authenticates with the Google service account.
2. A dimensional request stores query, page, date, device and country rows in `search_performance`.
3. Those rows support query, page, device, country and trend analysis.
4. A separate no-dimension Search Analytics request is the authoritative source for headline clicks, impressions, CTR and average position.
5. Dimensional rows may be incomplete because Search Analytics returns bounded top rows. Their sums must be labeled detailed-row totals, not official totals.
6. GSC jobs are automated through the pipeline scheduler when production credentials are configured.

## VAPI data flow

1. VAPI sends signed webhook events to `/api/webhooks/vapi`.
2. Tool calls invoke the internal voice-agent router.
3. End-of-call events create or reconcile `vapi_call_logs`.
4. The daily VAPI evaluator classifies operational outcomes and records quality evidence.
5. Leads, callbacks, bookings and invoices remain separate operational records.
6. Tool engagement is an observed call fact. It is not automatically a lead, booking, arrival or paid job.
7. Any classifier-derived outcome must carry a definition version and evidence level before it is used in executive reporting.

## Lead and booking creation

- Website lead forms write `leads`.
- Website booking flows write `bookings`.
- Voice tools may create a lead or callback, but the current `bookSlot` tool provides first-come-first-served walk-in guidance and does not persist an appointment.
- A booking is verified only when a booking row exists.
- An arrival is verified only from an operational arrival/check-in or repair-order signal.
- Paid conversion is verified only from a paid invoice linked by a defensible matching rule.

## Crawler HTML

- Normal visitors receive the React SPA.
- Recognized crawlers receive committed files from `apps/nickstire/prerendered/` through `server/prerender-middleware.ts`.
- Railway normally does not regenerate prerendered HTML during deploys.
- `.github/workflows/prerender-refresh.yml` performs the scheduled refresh.
- `pnpm run prerender:check` verifies route-tree presence.
- Semantic parity checks must verify identity, metadata, H1, canonical URL and structured data for key routes.

## Automated systems

- GSC dimensional ingestion and SEO analysis
- VAPI end-of-call ingestion and daily evaluation
- Scheduled prerender refresh
- Lead, callback and booking persistence
- ShopDriver invoice/customer synchronization where configured
- Selected internal alerts and recovery workflows

Automation success is valid only when the final system of record confirms the action.

## Manual or operator-gated systems

- Applying SEO copy changes to source
- Publishing generated content or GBP material
- Approving and publishing Instagram Studio V2 drafts — server-owned quality gate (review/declined-work require a verified DB record), deterministic HTML→JPEG render, and an explicit approve → schedule/publish step; nothing posts without operator action (`server/services/instagramStudio.ts`, `server/routers/instagramStudio.ts`)
- Pushing VAPI prompt/configuration changes
- Resolving weak invoice or customer matches
- Approving outbound campaigns
- Correcting historical classifications
- Production migrations and credential rotation

## Experimental or modeled systems

- Classifier-derived call outcomes
- Duration-based warm-transfer connection estimates
- Modeled receptionist pipeline value
- AI-generated recommendations and drafts
- Weak phone/time attribution without direct identifiers

These must remain visibly labeled as inferred or modeled.

## Retired or historical-only material

- Files under `docs/_archive/` are historical evidence, not current instructions.
- The archived `docs/_archive/root_reports/truth_os.md` is not the current operating contract.
- Old audit findings are not standing truth. Reverify them against current source, tests, generated output and production evidence.

## Not currently measurable with full confidence

- Universal transfer connection without a direct VAPI human-answer signal
- Arrival from a walk-in direction unless a later operational record is linked
- Paid revenue attributable to a call without a defensible invoice match
- Exhaustive GSC query/page totals from bounded dimensional API rows
- Revenue caused by a classifier outcome

## Authoritative operator surfaces

- Paid revenue: invoice-backed revenue views
- Leads and bookings: their respective operational tables and admin workflows
- Voice call activity: Voice Receptionist admin, with metric definitions from `METRICS-CONTRACT.md`
- Search performance: official GSC aggregate totals plus separately labeled detailed-row analysis
- System health: integration-specific timestamps and error states, not a single blended score

## Production actions not performed by documentation changes

Documentation does not deploy, migrate data, reclassify history, contact customers, update VAPI, publish GBP content or modify external accounts.