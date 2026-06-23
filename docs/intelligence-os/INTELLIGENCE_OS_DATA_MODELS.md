# INTELLIGENCE OS DATA MODELS
> Canonical Schema & Database Design Specifications

---

## 1. Prisma Schema Specifications

The following models will be appended to the Statenour Prisma schema:

```prisma
// ── Intelligence OS Core ──

model RegisteredSource {
  id              String           @id @default(cuid())
  name            String
  url             String           @unique
  domain          String           // ai | seo | competitor | automotive | macro
  sourceType      String           // official | primary | secondary | community
  authScore       Float            @default(70.0) @map("auth_score")
  refreshInterval Int              @default(86400) @map("refresh_interval") // refresh period in seconds
  lastFetched     DateTime?        @map("last_fetched")
  createdAt       DateTime         @default(now()) @map("created_at")
  updatedAt       DateTime         @updatedAt @map("updated_at")
  documents       SourceDocument[]

  @@index([domain])
  @@index([createdAt])
  @@map("intelligence_sources")
}

model SourceDocument {
  id           String             @id @default(cuid())
  sourceId     String             @map("source_id")
  source       RegisteredSource   @relation(fields: [sourceId], references: [id], onDelete: Cascade)
  rawContent   String             @db.Text @map("raw_content")
  url          String?
  capturedAt   DateTime           @default(now()) @map("captured_at")
  claims       IntelligenceClaim[]

  @@index([sourceId])
  @@index([capturedAt])
  @@map("source_documents")
}

model IntelligenceClaim {
  id                String          @id @default(cuid())
  documentId        String          @map("document_id")
  document          SourceDocument  @relation(fields: [documentId], references: [id], onDelete: Cascade)
  text              String          @db.Text
  category          String          // research_claim | research_contradiction | research_action | research_question
  confidence        Float           @default(0.5)
  verificationScore Float           @map("verification_score")
  status            String          @default("unverified") // source_supported | weak_support | unverified
  bestMatchChunk    String?         @db.Text @map("best_match_chunk")
  createdAt         DateTime        @default(now()) @map("created_at")

  @@index([documentId])
  @@index([category, status])
  @@index([createdAt])
  @@map("intelligence_claims")
}

model OpportunityLog {
  id           String    @id @default(cuid())
  title        String
  description  String    @db.Text
  domain       String    // ai | seo | competitor | automotive | macro
  impact       Float     // 0 - 100
  urgency      Float     // 0 - 100
  confidence   Float     // 0.0 - 1.0
  reversibility Float    // 0 - 100
  score        Float     // calculated priority score
  status       String    @default("pending") // pending | accepted | declined | resolved
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")

  @@index([status, score(sort: Desc)])
  @@index([domain])
  @@index([createdAt])
  @@map("opportunity_logs")
}

model BriefingLog {
  id           String    @id @default(cuid())
  briefType    String    @map("brief_type") // daily | weekly | monthly
  content      String    @db.Text
  sentAt       DateTime  @default(now()) @map("sent_at")
  createdAt    DateTime  @default(now()) @map("created_at")

  @@index([briefType, createdAt(sort: Desc)])
  @@map("briefing_logs")
}
```

---

## 2. TypeScript Interface Definitions

```typescript
export interface RegisteredSourceConfig {
  id: string;
  name: string;
  url: string;
  domain: 'ai' | 'seo' | 'competitor' | 'automotive' | 'macro';
  sourceType: 'official' | 'primary' | 'secondary' | 'community';
  authScore: number;
  refreshInterval: number;
  lastFetched?: Date;
}

export interface ExtractedClaimJSON {
  text: string;
  category: 'research_claim' | 'research_contradiction' | 'research_action' | 'research_question';
  citation?: string;
  confidence: number;
}

export interface ScoredOpportunity {
  id: string;
  title: string;
  description: string;
  domain: string;
  impact: number;
  urgency: number;
  confidence: number;
  reversibility: number;
  score: number;
  status: 'pending' | 'accepted' | 'declined' | 'resolved';
}
```

---

## 3. Relationships & Validations

* **Cascade Deletes**: If a `RegisteredSource` is deleted, all related `SourceDocument` records and their `IntelligenceClaim` mappings are automatically removed by Cascade constraints.
* **Idempotency**: Claim ingestion uses deterministic IDs generated from the SHA256 hashes of the text to prevent duplicates on repeated scans of the same source documents.
* **Structured Constraints**: Extractors are validated against JSON schema models using Zod wrappers to ensure database insertions never fail due to malformed payloads.
