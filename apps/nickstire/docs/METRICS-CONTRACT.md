# Nick's Tire & Auto — Metrics Contract

**Version:** revenue-ops-v1  
**Time zone:** America/New_York unless a source contract requires otherwise  
**Rule:** no percentage may be shown without its denominator; no modeled value may be labeled verified revenue.

## Evidence levels

- `observed`: deterministic source event or persisted row.
- `inferred`: classifier or matching logic derived from observed evidence.
- `verified`: direct business-system evidence confirms the outcome.

## Voice and demand metrics

| Canonical metric | Definition | Unit | Source | Inclusion / exclusion | Deduplication | Freshness | Evidence | Executive / ROI use | Owner / version |
|---|---|---:|---|---|---|---|---|---|---|
| Total inbound calls | Unique inbound VAPI calls received in the window | calls | `vapi_call_logs.vapiCallId` | Excludes outbound calls; includes failures and abandons | unique VAPI call ID | near-real-time webhook | observed | executive yes; ROI no | Front desk / v1 |
| Qualified service inquiries | Inbound customer conversations with a detected automotive service or pricing intent | calls | versioned VAPI classification | Excludes spam, outbound and pure operational-info calls | unique VAPI call ID | daily evaluation | inferred | executive yes with version; ROI no | Operations / classifier-v2 |
| Tool engagements | Calls where a tracked voice tool was invoked | calls | voice state trail | Includes read/write/confirmation tools as separately typed facts | unique call, optionally tool count | near-real-time / daily reconcile | observed | executive diagnostic; ROI no | Voice system / facts-v1 |
| Leads created | Calls linked to an actual `leads` row | leads and calls | `vapi_call_logs.leadId` or explicit linked receipt | Excludes tool-only activity | lead ID; unique call for rate | daily reconcile | verified | executive yes; ROI pipeline only | Front desk / facts-v1 |
| Callbacks created | Calls linked to an actual `callback_requests` row | callbacks and calls | callback ID or explicit receipt | Excludes callback intent without persistence | callback ID | daily reconcile | verified | executive yes; ROI pipeline only | Front desk / facts-v1 |
| Bookings created | Calls linked to an actual `bookings` row | bookings and calls | booking ID / receipt | `bookSlot` walk-in guidance without a booking row does not count | booking ID | daily reconcile | verified | executive yes; ROI pipeline only | Front desk / facts-v1 |
| Walk-ins directed | Calls where the customer was instructed to visit or drop off | calls | transcript/classifier or explicit tool receipt | Does not imply arrival | unique VAPI call ID | daily evaluation | inferred unless deterministic receipt exists | executive yes with label; ROI no | Operations / classifier-v2 |
| Transfer attempts | Calls where transfer execution was initiated | calls | VAPI ended reason/state | Does not imply human answer | unique VAPI call ID | near-real-time | observed | reliability yes; ROI no | Voice system / facts-v1 |
| Transfer connections | Transfer attempts with a direct human-answer signal | calls | provider signal when available | Duration proxy is reported separately as inferred | unique VAPI call ID | provider-dependent | verified | executive only when direct; ROI no | Voice system / v1 |
| Likely transfer connections | Duration-based estimate among attempts | calls / rate | transfer duration heuristic | Must say inferred; withheld below reliability threshold | unique attempt | rolling 14d | inferred | diagnostic only; ROI no | Voice system / heuristic-v1 |
| Arrivals verified | Customer arrival/check-in linked to the originating demand record | arrivals | booking/work-order/check-in evidence | Directions alone excluded | arrival or repair-order ID | operational sync | verified | executive and attribution yes | Shop operations / v1 |
| Paid call conversions | Paid invoices defensibly linked to an originating call | invoices / calls | paid `invoices` plus attribution link | Weak phone/time match remains inferred and separate | invoice ID; one canonical origin | invoice sync | verified | executive and ROI yes | Finance / v1 |
| Technical failures | Calls classified as provider, audio, webhook or assistant failure | calls | deterministic ended reason plus classifier version | Never removed from reliability denominator | unique VAPI call ID | near-real-time / daily | observed or inferred | executive reliability yes; ROI no | Engineering / classifier-v2 |
| Abandoned calls | Genuine customer calls ending before useful connection | calls | duration/transcript/ended reason | Spam and sub-2-second empty misdials excluded | unique VAPI call ID | daily evaluation | inferred | executive reliability yes | Front desk / classifier-v2 |

## Rates and denominators

| Metric | Numerator | Denominator | Notes |
|---|---|---|---|
| Qualified-call to lead rate | calls with verified lead creation | qualified service inquiries | Never use all calls as the denominator |
| Qualified-call to booking rate | calls with verified booking creation | qualified service inquiries | A callback or walk-in direction is not a booking |
| Paid conversion rate | qualified calls linked to a paid invoice | qualified service inquiries | Not available until matching is verified |
| Technical-failure rate | technical failures | all inbound calls | Failures remain visible |
| Abandonment rate | genuine abandons | all inbound calls | Spam/misdials remain a separate bucket |
| Transfer-connection rate | verified connections | transfer attempts | Duration proxy must be labeled inferred |
| Recovery rate | previously lost opportunities later verified won | eligible lost opportunities | Requires durable queue outcome evidence |

## Voice quality score

- Purpose: measure conversation execution independently of commercial outcome.
- Unit: 0–100 or unavailable.
- Inputs: greeting/state evidence, intent identification, accurate/useful next step, escalation handling, provider success evaluation, productive duration and explicit failure signals.
- Exclusions: spam, outbound calls and genuine pre-connect abandons.
- Technical failures remain visible in reliability metrics even when a conversational-quality score is unavailable.
- A booking does not automatically increase quality; lack of booking does not automatically reduce quality.
- Version: `vapi-quality-v1`.
- Executive reporting: yes only with score version, sample size, excluded count and evaluation timestamp.
- ROI use: no.

## Revenue concepts

| Canonical name | Definition | Evidence | ROI-safe? |
|---|---|---|---|
| Verified attributed revenue | Paid invoice linked to a source through direct IDs or an operator-confirmed match | verified | yes |
| Modeled pipeline value | Observed/inferred opportunities multiplied by disclosed ticket and close-rate assumptions | modeled | no; planning only |
| Potential pipeline value | Sum of quoted or estimated work not yet paid | observed/modelled depending source | no |
| Unmatched paid revenue | Paid invoices without a canonical source link | verified revenue, unknown attribution | total revenue yes; channel ROI no |
| Estimated recovery opportunity | Open lost/declined work with an estimate or bounded value assumption | observed/modelled | no |

## GSC metrics

| Canonical metric | Definition | Source | Evidence / limitation | Freshness | Executive use |
|---|---|---|---|---|---|
| Official GSC clicks | No-dimension Search Analytics clicks for the window | GSC API | authoritative aggregate for configured property/window | last successful aggregate fetch | yes |
| Official GSC impressions | No-dimension Search Analytics impressions | GSC API | authoritative aggregate | last successful aggregate fetch | yes |
| Official GSC CTR | official clicks divided by official impressions / API value | GSC API | aggregate, not an average of detail rows | same | yes |
| Official GSC average position | no-dimension GSC position | GSC API | not a universal rank tracker | same | yes with explanation |
| Stored detailed clicks/impressions | Sum of persisted query/page/date/device/country rows | `search_performance` | bounded detail, potentially incomplete | last dimensional sync | analysis only |
| Detailed-row coverage | stored detail divided by official aggregate for clicks/impressions | both | operational diagnostic, not completeness proof | when both windows match | diagnostic |
| Detailed row count | persisted rows in the window | `search_performance` | affected by dimensions, row limit and dedupe | dimensional sync | diagnostic |

## Data quality requirements

Every executive metric response should expose, where applicable:

- canonical metric name;
- time window and time zone;
- numerator and denominator;
- source;
- evidence level;
- definition/classifier version;
- last attempted and last successful refresh;
- data-as-of timestamp;
- partial-failure or unavailable state;
- known limitations.

Mutable review counts and ratings are externally sourced marketing facts with timestamps and fallback behavior. They are not revenue-operating metrics.