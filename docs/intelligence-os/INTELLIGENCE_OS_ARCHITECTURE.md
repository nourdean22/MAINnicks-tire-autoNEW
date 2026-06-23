# INTELLIGENCE OS ARCHITECTURE
> Global Intelligence & Opportunity Operating System

---

## 1. System Planes Architecture

The system is structured into four distinct functional planes with clean boundaries:

```mermaid
graph TB
    subgraph Acquisition Plane [Acquisition Plane]
        RS[Registered Sources] -->|Pull/Fetch| FC[Connectors / Scrapers]
        FC -->|Raw Content| DS[Document Store]
    end

    subgraph Discovery Plane [Discovery Plane]
        DS -->|Evaluate| DR[Discovery Engine]
        DR -->|Score Trust| SQS[Source Quality Score]
        SQS -->|Update SQS| RS
    end

    subgraph Intelligence Plane [Intelligence Plane]
        DS -->|Schema-Constrained extraction| EX[AI Extractor]
        EX -->|Grounding Match| GV[Grounding Validator]
        GV -->|Vector Parity| BM[(BrainMemory DB)]
        EX -->|Extract Claims| IC[Claims / Opps / Threats]
    end

    subgraph Decision Plane [Decision Plane]
        IC -->|Score Prioritization| SC[Opportunity / Threat Scoring]
        SC -->|Render Brief| BR[Briefing Engine]
        BR -->|Push Notification| PWA[Operator PWA]
        BR -->|Record Recommendations| DL[Decision Ledger]
        DL -->|Outcome Loop| SQS
    end
    
    style RS fill:#1e293b,stroke:#475569,stroke-width:1px,color:#f8fafc
    style FC fill:#1e293b,stroke:#475569,stroke-width:1px,color:#f8fafc
    style DS fill:#1e293b,stroke:#475569,stroke-width:1px,color:#f8fafc
    style DR fill:#0f172a,stroke:#38bdf8,stroke-width:2px,color:#f8fafc
    style SQS fill:#0f172a,stroke:#38bdf8,stroke-width:2px,color:#f8fafc
    style EX fill:#0f172a,stroke:#10b981,stroke-width:2px,color:#f8fafc
    style GV fill:#0f172a,stroke:#10b981,stroke-width:2px,color:#f8fafc
    style BM fill:#1e1b4b,stroke:#4f46e5,stroke-width:1px,color:#f8fafc
    style IC fill:#0f172a,stroke:#10b981,stroke-width:2px,color:#f8fafc
    style SC fill:#064e3b,stroke:#059669,stroke-width:2px,color:#f8fafc
    style BR fill:#064e3b,stroke:#059669,stroke-width:2px,color:#f8fafc
    style PWA fill:#1e293b,stroke:#475569,stroke-width:1px,color:#f8fafc
    style DL fill:#064e3b,stroke:#059669,stroke-width:2px,color:#f8fafc
```

---

## 2. Ingestion Pipeline & Data Flow

```mermaid
sequenceDiagram
    autonumber
    participant IngestCron as Inngest Trigger
    participant Registry as Source Registry
    participant Scraper as Firecrawl Scraper
    participant Extractor as AI Extractor (JSON Schema)
    participant Grounding as Grounding Engine
    participant DB as Postgres DB

    IngestCron->>Registry: Get active sources configuration
    Registry-->>IngestCron: Active sources list
    loop For each source
        IngestCron->>Scraper: Fetch document & markdown metadata
        Scraper-->>IngestCron: Raw Markdown + meta
        IngestCron->>Extractor: Extract Claim/Opp/Threat objects (with schema constraints)
        Extractor-->>IngestCron: Extracted Claim JSON Objects
        IngestCron->>Grounding: Check Cosine Similarity against source chunks
        Grounding-->>IngestCron: Verification Score
        IngestCron->>DB: Save Claim (with SQS score and status)
    end
```

---

## 3. Grounding & Verification Logic

To prevent hallucinated data from entering the briefings, the grounding engine calculates vector similarities:

1. **Chunking**: Source documents are split into overlapping chunks (1200 characters, 200 characters overlap).
2. **Embedding**: Text embeddings are generated using the configured model (`getEmbedding`).
3. **Similarity Match**: The cosine similarity between the extracted claim embedding and all document chunk embeddings is computed:
   $$Similarity(A, B) = \frac{A \cdot B}{\|A\| \|B\|}$$
4. **Decision Boundary**:
   * $\ge 0.80 \rightarrow$ `source_supported` (safe for auto-briefing inclusion).
   * $0.55 \text{ to } 0.79 \rightarrow$ `weak_support` (flagged for manual verify, visible in cockpit).
   * $< 0.55 \rightarrow$ `unverified_hallucination` (automatically excluded from briefings).

---

## 4. Integration Points with Existing Architecture

* **Mastra**: Extracted opportunities are whitelisted as context tools, allowing Nick agent instances to retrieve active decisions/claims dynamically.
* **Inngest**: Workflows handle cron-driven schedules for fetchers, scrapers, and briefing builders, incorporating automatic retries and fallback handling.
* **Braintrust**: Baseline evals verify that claim extraction formats are stable and do not drift across model upgrades.
* **BrainMemory**: Distilled claims are indexed as semantic facts inside the `brain_memories` table, ensuring cross-session consistency.
* **Obsidian**: Reports are mirrored to the local markdown vault, keeping your offline notes in sync.
