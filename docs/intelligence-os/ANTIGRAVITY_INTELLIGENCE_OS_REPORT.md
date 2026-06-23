# ANTIGRAVITY INTELLIGENCE OS REPORT
> **Global Intelligence & Opportunity Operating System Strategy & Audit**
> **Date:** June 23, 2026
> **Client:** NOUR
> **Architect:** Antigravity CTO & Strategic Research Architect

---

## 1. Our Report (Summary of User Vision & Strategic Report)

The previous strategic report, *Upgrading the Global Intelligence and Opportunity Operating System*, outlines a bold transition from a passive database-pull model to an active **Decision Advantage Operating System** (system-push). 

### Key Elements of the Proposed System:
* **The Mission**: Build a private decision-advantage system that continuously converts verified external and internal signals into prioritized actions, forecasts, and institutional memory for Nour.
* **The Structured Lifecycle**:
  $$\text{Raw Data} \rightarrow \text{Verified Sources} \rightarrow \text{Evidence} \rightarrow \text{Claims} \rightarrow \text{Opportunities/Threats} \rightarrow \text{Actions} \rightarrow \text{Decisions} \rightarrow \text{Outcomes}$$
* **Four System Planes**: Acquisition, Discovery, Intelligence, and Decision.
* **Three Priority Tiers**:
  * *Tier A (Immediate)*: AI vendor intelligence, local SEO/GBP, competitor pricing, auto demand trends, macro signals.
  * *Tier B (Adjacencies)*: CEO/investor intel, acquisition targets, SMB wealth.
  * *Tier C (Frontier)*: Human performance, broad tech scouting.
* **Closed-loop Learning**: Recommendation made $\rightarrow$ Action taken/declined $\rightarrow$ Outcome observed $\rightarrow$ Value measured $\rightarrow$ Forecast Brier resolution $\rightarrow$ Source SQS updated $\rightarrow$ Loop improves.

---

## 2. Antigravity Independent Report

As CTO and systems architect, I have pressure-tested this proposal against both software engineering constraints and real-world intelligence failures. Below is my independent strategic assessment.

### Executive Verdict
* **What is Excellent**:
  * The transition to a **decision-quality loop** (tracking outcomes and calculating Brier scores) is world-class. It prevents the system from becoming a costly, high-churn summary aggregator.
  * Splitting the codebase into four explicit planes (Acquisition, Discovery, Intelligence, Decision) with strict API and schema contracts is the correct software engineering approach.
* **What is Overbuilt / Highly Fragile**:
  * **Competitor Scraping at Scale**: Web scraping of competitor sites without a proxy rotation strategy will quickly hit Cloudflare/WAF blocks.
  * **Convex / Mem0 / Letta Deferral**: The decision to defer Convex, Mem0, and Letta is correct. Adding more SaaS abstractions before the local database schema and cache are stable would introduce unnecessary complexity.
* **What is Missing**:
  * **Reversibility as a First-Class Variable**: In business operations, a high-impact, *irreversible* decision (e.g., changing CRM or buying a building) requires a significantly higher proof burden than a high-impact, *easily reversible* decision (e.g., shifting ad spend). Reversibility must be coded into the scoring algorithms.
  * **Rate Limit Fail-Safes**: Deep research parallel queries will quickly deplete rate limits. A queue-based backoff wrapper is missing from the core design.
  * **Human-in-the-loop (HITL) Gateways**: No automated tasks should ever modify live production routing or dispatch customer-facing communications without explicit, multi-tap operator confirmation.

---

## 3. Repo Reality Audit

We performed a deep audit of the `NOURCITY` monorepo codebase. Here is the classification and action plan for existing infrastructure:

### A. Research Systems
* *Status*: `REUSE_WITH_EXTENSION`
* *Existing Files*:
  - [generate-source-pack.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/scripts/generate-source-pack.ts) (creates markdown packs for RAG)
  - [ingest-research-pack.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/scripts/ingest-research-pack.ts) (ingests pack manifest)
  - [ingest-notebooklm-output.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/scripts/ingest-notebooklm-output.ts) (parses NotebookLM markdown outputs)
* *Action*: Retain the Firecrawl scraping and folder structures. Extend the ingestion parser to write directly to new schema-valid `SourceDocument` and `IntelligenceClaim` tables instead of generic `BrainMemory`.

### B. Memory Systems (Brain Memory & Graphs)
* *Status*: `REUSE_UNCHANGED`
* *Existing Files*:
  - `BrainMemory` table in Prisma schema (`schema.prisma` lines 1590-1640).
  - `MemoryEdge` table in Prisma schema (lines 1878-1897).
  - `SemanticEdge` table in Prisma schema (lines 1467-1490).
* *Action*: Reuse these tables as the long-term semantic memory store. Use `MemoryEdge` for mapping claims to historical memories.

### C. Research Lab
* *Status*: `REUSE_WITH_EXTENSION`
* *Existing Files*:
  - [page.tsx](file:///C:/Users/nourd/NOURCITY/apps/statenour/app/(mastery)/research/page.tsx) (visual cockpit for research packs)
* *Action*: Extend the UI to display the Opportunity Queue, Registered Sources registry status, and SQS trend graphs.

### D. Scheduled Jobs, Runners, and Crons
* *Status*: `REUSE_WITH_EXTENSION`
* *Existing Files*:
  - Inngest crons: `apps/statenour/src/inngest/functions/morning-brief.ts` and `mega-fanout.ts`.
  - Verification: `apps/statenour/scripts/verify-crons.ts`.
  - Durable bus: `BrainBusEvent` Prisma model.
* *Action*: Add new Inngest handlers for the daily ingestion loops and the briefing compiler.

### E. Ingestion Systems
* *Status*: `REUSE_WITH_EXTENSION`
* *Existing Files*:
  - Firecrawl client: `apps/statenour/lib/integrations/firecrawl.ts`.
* *Action*: Reuse. Add specific API connectors for FRED, SEC EDGAR, and Google Business Profile performance.

### F. Revenue Systems & Customer Intelligence
* *Status*: `REUSE_UNCHANGED`
* *Existing Files*:
  - Customer 360: `apps/statenour/app/(mastery)/customer-360/[customerId]/page.tsx`.
  - Preference inference: `apps/statenour/lib/brain/customer-preferences.ts`.
* *Action*: Keep these files unchanged; they already provide structured LTV, ticket averages, and declined-recovery insights.

### G. NICK Reasoning Systems
* *Status*: `REUSE_WITH_EXTENSION`
* *Existing Files*:
  - `apps/statenour/lib/ai/reasoning/` and `lib/ai/nick-agent.ts`.
* *Action*: Expose read-only tools to allow Nick agents to query registered claims and opportunities in flight.

### H. Database Schema & Vector Store
* *Status*: `REUSE_WITH_EXTENSION`
* *Existing Files*:
  - Prisma schema: `apps/statenour/prisma/schema.prisma`.
  - Vector indexing: `apps/statenour/scripts/add-hnsw-index.ts` (configures pgvector).
* *Action*: Add new Prisma models for `RegisteredSource`, `SourceDocument`, and `IntelligenceClaim`. Keep existing pgvector indexing unchanged.

### I. Testing Infrastructure
* *Status*: `REUSE_WITH_EXTENSION`
* *Existing Files*:
  - Vitest configuration: `apps/statenour/vitest.config.ts`.
  - Braintrust baseline: `apps/statenour/tests/eval/run-suite.ts` and `evals/nick-baseline.eval.ts`.
* *Action*: Add assertion tests for structured extraction formats and grounding thresholds.

---

## 4. Contradiction / Improvement Analysis

Here are the specific points where the **Antigravity Independent Design** challenges or improves the **Strategic Report**:

| Concept | Strategic Report Position | Antigravity Design Choice | Rationale for Change |
| :--- | :--- | :--- | :--- |
| **Ingestion Pipeline** | Ingest any interesting web/newsletter feeds. | Strict **Source Registry** configuration table. | Prevents random scrapers from writing unstructured noise to database. |
| **Claim Verification** | Summarize contradictory views. | Flag contradictions as separate database records. | Contradictions must downgrade the SQS score of the offending source, rather than just being summarized. |
| **Scoring Model** | Score by Impact and Urgency. | Score by **Impact, Urgency, and Reversibility**. | Reversible actions should be prioritized over irreversible ones to protect capital and focus execution speed. |
| **Outcome Tracking** | Broad calibration logs. | Brier Score calibration dashboard. | Quantifiably measures how accurate the forecasting layer has been at predicting events. |
| **Gated Execution** | Auto-task generation. | strict HITL two-tap confirmation modals. | Eliminates risk of automated code modifications or communications firing due to bad external data. |

---

## 5. Merged Best-Version Architecture

By merging the original vision with the independent audit findings and strategic corrections, we establish the definitive architecture:

### 1. Ingestion Plane (Acquisition)
* Connectors scrape raw files only from registered sources matching active cron patterns.
* Normalizes data into clean markdown, hashes contents, and writes a single `SourceDocument` record.

### 2. Discovery Plane
* Maintains the SQS (Source Quality Score) registry.
* Automatically decays source freshness daily.
* Blacklists sources that hit limit thresholds or produce conflicting hallucinations.

### 3. Intelligence Plane
* Runs AI-driven extraction of claims and opportunities constrained by JSON schemas.
* Grounding engine matches claims against source document chunks using cosine similarity.
* Generates contradictions when new claims conflict with existing validated memories.

### 4. Decision Plane
* Priority Scoring:
  $$\text{Opportunity Priority} = \frac{\text{Impact} \times \text{Relevance} \times \text{Confidence} \times \text{Novelty}}{\text{Proof Burden} \times \text{Execution Cost} \times \text{Time-to-Value}}$$
* Renders Daily Briefings and pushes alerts to the operator.
* Records decision approvals inside the **Decision Ledger** and tracks actual outcomes.

---

## 6. Implementation Plan

```txt
Phase 1: DB Schema & Source Registry
  -> Add RegisteredSource, SourceDocument, and IntelligenceClaim models to Prisma.
  -> Run migration and seed 5 initial MVP sources.

Phase 2: Ingestion & Extraction Connectors
  -> Implement FRED (macro), NHTSA (recalls), and GSC (SEO) API connectors.
  -> Build JSON-schema-constrained claim extraction and cosine similarity grounding engine.

Phase 3: Scoring & Inngest Briefing Workflows
  -> Implement SQS, Opportunity, and Threat scoring calculations.
  -> Schedule Daily Executive and Weekly Strategic Briefing workflows in Inngest.

Phase 4: Cockpit UI Integration
  -> Create mobile-first briefing viewport and Decision Ledger logging view.
  -> Build two-tap task and decision confirmation modals.

Phase 5: Verification & Evals
  -> Wire Braintrust baseline regression tests for extraction stability.
  -> Verify calibration metrics (Brier Score resolutions) are working.
```
