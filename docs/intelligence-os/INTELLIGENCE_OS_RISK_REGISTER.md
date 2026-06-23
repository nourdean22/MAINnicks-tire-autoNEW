# INTELLIGENCE OS RISK REGISTER
> Security, Privacy, Financial, Operational & Technical Risk Controls

---

## 1. Security & Privacy Risks

### R-01: SSRF / Ingestion Pipeline Exploitation
* **Likelihood**: Medium
* **Impact**: Critical
* **Description**: Scraper scripts fetch malicious URLs containing local network targets (such as DB connections or internal server pings).
* **Mitigation**: Implement strict public IP domain validation in the fetcher wrapper (`assertPublicUrl`). Strip all local hostnames and private subnet ranges.

### R-02: API Credential Leakage in Ingest Logs
* **Likelihood**: Low
* **Impact**: High
* **Description**: Ingest trace logs capture raw authorization headers or database URL variables.
* **Mitigation**: Run the automated secret scanner (`scripts/scan-secrets.ts`) on logs; apply data redaction middleware (`lib/research/redact.ts`) to all trace outputs.

---

## 2. Financial Risks

### R-03: Infinite Loop Token Billing
* **Likelihood**: Medium
* **Impact**: High
* **Description**: Parallel web scraping loops or recursive RAG queries consume excessive tokens on OpenAI/Perplexity APIs.
* **Mitigation**: Wire tool quota gates (`lib/ai/tool-quota.ts`) and enforce hard timeout settings on all AI calls (max 15s timeout per extraction round).

---

## 3. Operational Risks

### R-04: Briefing Fatigue / Information Pollution
* **Likelihood**: High
* **Impact**: Medium
* **Description**: Daily briefings accumulate low-urgency notifications, leading to cognitive overload.
* **Mitigation**: Enforce SQS thresholds. Exclude items scoring $< 75.0$ from the Daily Executive Brief.

---

## 4. Technical Risks

### R-05: Database Schema Drift
* **Likelihood**: Medium
* **Impact**: High
* **Description**: Applying new Prisma schemas via `db push` causes data truncation or index conflicts.
* **Mitigation**: Add migration logs to `SchemaChangeLedger`. Require approval of the rollback strategy before applying any schema pushes.
