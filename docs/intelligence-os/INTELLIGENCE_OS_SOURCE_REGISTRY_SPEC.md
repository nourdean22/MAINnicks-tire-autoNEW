# INTELLIGENCE OS SOURCE REGISTRY SPEC
> Registry Management, Discovery Engine & Source Quality Evaluation

---

## 1. Registered Source Database Fields

Every source integrated into the Acquisition Plane must have a configuration entry containing:

* `id` (String / CUID): Unique identifier.
* `name` (String): Human-readable source label (e.g., "FRED Local Consumer Index").
* `url` (String): Scrape endpoint or API target.
* `domain` (Enum): `ai` | `seo` | `competitor` | `automotive` | `macro`.
* `sourceType` (Enum): `official` | `primary` | `secondary` | `community`.
* `accessMode` (Enum): `api` | `scraper` | `rss` | `manual`.
* `freshnessPattern` (String): Cron expression for checking updates (e.g., `0 9 * * 1` for weekly).
* `authorityScore` (Float): Initialized score $0.0 \text{ to } 100.0$ based on source type:
  - `official` (e.g., FRED, NHTSA, SEC): 95.0
  - `primary` (e.g., competitor pricing, Google ranks): 85.0
  - `secondary` (e.g., technology reviews): 60.0
  - `community` (e.g., social forums, chat): 40.0
* `historicalHitRate` (Float): Ratio of correct/actionable predictions from this source.
* `noiseRate` (Float): Percentage of unverified or hallucinated claims from this source.
* `trustTier` (Enum): `TIER_A` (Auto-include) | `TIER_B` (Verify first) | `TIER_C` (Strategy review only).
* `status` (Enum): `ACTIVE` | `PAUSED` | `BLACKLISTED`.

---

## 2. Discovery Engine & Authority Scoring

The Discovery Engine evaluates source relevance and quality dynamically.

### Initial SQS (Source Quality Score)
$$\text{SQS}_{\text{init}} = (\text{AuthorityScore} \times 0.6) + (\text{AccessModeWeight} \times 0.4)$$
*AccessModeWeight*: `api` = 100, `scraper` = 80, `rss` = 70, `manual` = 50.

### SQS Adjustment Loop
Every time a recommendation is evaluated:
* **Correct Prediction / Actionable Win**:
  $$\text{SQS}_{\text{new}} = \min(100.0, \text{SQS}_{\text{old}} + 5.0)$$
* **Incorrect Prediction / Stale Hallucination**:
  $$\text{SQS}_{\text{new}} = \max(0.0, \text{SQS}_{\text{old}} - 10.0)$$

---

## 3. Freshness & Decay Policy

To prevent the system from relying on obsolete data, sources undergo age decay:

$$Freshness = 1.0 - \left(\frac{\text{Age in Days}}{\text{Decay Half-Life}}\right)$$

*Decay Half-Life* values:
* **AI Intelligence**: 14 Days (Fast shifts)
* **Local SEO / GBP**: 7 Days (Critical daily movements)
* **Competitor Pricing**: 14 Days
* **Automotive Recalls**: 90 Days
* **Macro Indicators**: 180 Days (Long-term cycles)

If a source's calculated Freshness falls below $0.2$, the system triggers an automatic acquisition run.

---

## 4. Blacklisting Policy

A source is automatically flipped to `BLACKLISTED` status if:
1. SQS drops below $30.0$.
2. Ingestion failure occurs consecutively $> 5$ times (network downtime or scraping blocks).
3. The system detects $> 3$ consecutive direct contradictions with verified TIER_A sources.

Once blacklisted, all related claims are soft-deleted (`deletedAt` timestamp recorded) and excluded from future briefings.
