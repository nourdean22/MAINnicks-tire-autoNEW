# Design Spec: Memory Inbox Ingestion Pipeline

This document specifies the pipeline, data structures, and human-in-the-loop (HITL) gate for importing external or untrusted content into long-term **BrainMemory**.

---

## 1. Core Principle

> [!CRITICAL]
> **No Direct Ingestion**: External content, fetched documents, and web search results must NEVER write directly to long-term BrainMemory without undergoing validation, verification, and explicit owner sign-off. The path to BrainMemory must go through a staged, quarantine sandbox.

---

## 2. Ingestion Pipeline

```
[ Source ]
    │ (web search / URL fetch / document import)
    ▼
[ Extraction ]
    │ (HTML parsing / OCR / plain text extraction)
    ▼
[ Fenced Content ]
    │ (fenceContent wrapper: tags and strips injection keywords)
    ▼
[ Summary ]
    │ (LLM compiles a factual, clean summary)
    ▼
[ Claim Extraction ]
    │ (Extract distinct atomic claims as {fact, source, location})
    ▼
[ Confidence Score ]
    │ (Rate claim plausibility: low, medium, high)
    ▼
[ Privacy Classification ]
    │ (Tag sensitivity: public, internal, private_owner)
    ▼
[ Contradiction Check ]
    │ (Semantic search against existing memories for conflicts)
    ▼
[ Owner Approval ]
    │ (Human reviews claims, resolves contradiction verdicts)
    ▼
[ BrainMemory Write ]
    │ (Prisma write to database, index via pgvector)
    ▼
[* Pinned Memory *]
```

### Pipeline Stage Details

1. **Source**: The starting document or external resource (e.g., Perplexity search JSON, downloaded PDF, Gmail body).
2. **Extraction**: The raw text extraction phase (untrusted data stream).
3. **Fenced Content**: Enclosed in `<tool_data tool="..." source="...">` and scrubbed of any fake closing tags.
4. **Summary**: The agent produces a clean summary of the contents, filtering out formatting noise.
5. **Claim Extraction**: The model identifies atomic factual claims.
6. **Confidence Score**: Heuristic or model-based verification rate of the claim's source credibility.
7. **Privacy Classification**: Tagging of information boundaries to prevent leakages across sessions.
8. **Contradiction Check**: Running a vector search query against the database of existing memories to identify contradictions (surfaces matching records to be deprecated or updated).
9. **Owner Approval**: Interactive UI screen where the operator confirms which claims are valid.
10. **BrainMemory Write**: Success path writes to Postgres and schedules embedding calculation.

---

## 3. States

A Memory Inbox item progresses through the following status values:

- `quarantined`: Initial state after claim extraction. Undergoing checks.
- `conflicting`: Flagged by the contradiction engine. Needs resolution choice.
- `approved`: Marked safe for long-term insertion.
- `discarded`: Deleted by operator or rejected during review.
- `committed`: Written to the permanent `BrainMemory` table.

---

## 4. Fields

The schema representation:

```typescript
model MemoryInboxItem {
  id                      String           @id @default(uuid())
  sourceUrl               String?
  sourceType              String           // "web" | "document" | "email"
  rawTextFenced           String           // The fenced extraction payload
  extractedClaims         Json             // Array of atomic claims: { id, text, confidence }
  contradictionLogs       Json?            // Conflicting memory IDs and descriptions
  privacyClass            String           // "public" | "internal" | "private"
  status                  String           // "quarantined" | "conflicting" | "approved" | "discarded" | "committed"
  reviewedBy              String?
  reviewedAt              DateTime?
  createdAt               DateTime         @default(now())
}
```

---

## 5. Contradiction Handling

When the contradiction check triggers:
1. **Identify**: Retrieve existing memories with cosine distance `≤ 0.15` (high similarity).
2. **Classify**: The policy engine checks if the new claim logically opposes the existing one (e.g., "front door lock is broken" vs "front door lock is fixed").
3. **Verdict Options presented to Operator**:
   - **Overwrite**: Commit new memory and deprecate/delete the old one.
   - **Reject New**: Discard the new claim; keep the old one active.
   - **Coexist**: Save both as separate context entries.

---

## 6. Privacy Classes

To protect the owner's privacy, all incoming facts are classified:

- **Public**: Safe to utilize in public AI responses, external widgets, and search contexts.
- **Internal**: Accessible only inside Statenour workspace services (auth required).
- **Private (Owner Only)**: Contains highly sensitive personal data. Restricted from secondary LLM contexts; requires additional biometric/2FA or restricted system prompt visibility.

---

## 7. Retention & Expiry Rules

- **Quarantine Expiration**: Items in `quarantined` or `conflicting` state expire and are automatically hard-deleted after **7 days** to avoid database clutter.
- **Operator Dismissal**: Discarded items are purged immediately or marked deleted.
- **Committed Retention**: Once committed to BrainMemory, records remain indefinitely unless manually pruned or superseded by a contradiction resolution.

---

## 8. Tests Required

1. **No Auto-Commit**: Assert that new external URL ingests do NOT create active rows in `BrainMemory` directly.
2. **Fencing Constraint**: Verify that any text containing missing fences throws an error at the inbox parser stage.
3. **Contradiction Surfacing**: Mock a memory conflict (e.g., "Nour is in Cleveland" vs "Nour is in New York") and assert the engine flags it as `conflicting`.
4. **Privacy Auto-Tagging**: Verify that strings containing keywords like "password", "bank", "SSN" are automatically classified as `private`.
