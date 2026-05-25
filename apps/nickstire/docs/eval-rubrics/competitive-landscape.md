# Competitive-Landscape Audit Rubric

**Skill port:** B13 · competitive-landscape + competitor-alternatives
**Applies to:** the existing Apify-weekly-competitor cron (memory #51) · pair this rubric with the raw data to produce actionable intelligence.
**Authored:** 2026-05-26.

## Why this doc exists

The Apify cron scrapes Cleveland-area competitor data weekly · raw data lives in `competitor_snapshots` (per memory's migration 0058). Without a scoring rubric, the operator gets data dumps. With one · the operator gets "Mike's Tire is overtaking us on 'tires near me' due to 47 new reviews this month."

## The 6-dimension competitive score (per competitor · 0-100 each)

### 1 · Review velocity (0-20)

Reviews acquired in the last 30 days, normalized to total review count.

| Score | Criteria |
|---|---|
| 20 | 5%+ of total reviews acquired in last 30d (fast growth) |
| 15 | 3-5% |
| 10 | 1-3% |
| 5 | 0-1% (mostly dormant) |
| 0 | 0 new reviews (deteriorating) |

Why · review velocity beats review count for local-pack ranking · stale 5-star shops slip below growing 4-star shops.

### 2 · Service breadth (0-15)

Distinct service categories the competitor lists. Tires only = 5. Tires + brakes + alignment + diagnostics = 15.

| Score | Criteria |
|---|---|
| 15 | 4+ service categories (full-service shop · direct competitor) |
| 10 | 3 categories |
| 5 | 2 categories |
| 0 | 1 category (tires-only chain) |

Nick's is 4+ · so a 15-score competitor is a direct threat · a 5-score is adjacent.

### 3 · Price visibility (0-15)

Does the competitor publish prices on their site?

| Score | Criteria |
|---|---|
| 15 | Specific prices for top 3 services on homepage |
| 10 | Price range on services page |
| 5 | "Call for quote" everywhere |
| 0 | No pricing info at all |

Why · price-visible competitors win the click-intent search. Per memory's Wave 176 price-anchor titles on /brakes /diagnostics /oil-change · Nick's owns this lever. Track who else adopts it.

### 4 · Site / SEO quality (0-20)

Combination of PSI mobile score, top-keyword rankings, and content depth.

| Score | Criteria |
|---|---|
| 20 | PSI mobile >80, ranks top-3 on "tire shop cleveland", 50+ blog posts |
| 15 | PSI 60-80, top-10 ranking, 10+ posts |
| 10 | PSI 40-60, top-20 ranking, some content |
| 5 | PSI <40, page-2 rankings |
| 0 | Static brochure site, no SEO |

Nick's was 46 → 54 (Wave M+O lift) · midfield. Track if any competitor lands ≥70.

### 5 · Customer-visibility moves (0-15)

Recent customer-facing changes the competitor shipped · new financing, new SMS confirmations, new free-service offers, new payment plans.

| Score | Criteria |
|---|---|
| 15 | 2+ visible customer-facing changes in last 30d (active competitor) |
| 10 | 1 visible change in last 30d |
| 5 | Stable / no recent changes |
| 0 | Site looks abandoned |

Why · this is the early-warning signal. A competitor adding "no credit check financing" is a direct attack on Nick's `/financing` page.

### 6 · Customer perception gap (0-15)

From scraped review text · sentiment analysis on top complaints.

| Score | Criteria |
|---|---|
| 15 | Most reviews mention 1+ thing Nick's does better (price, walk-in, weekend hours) |
| 10 | Reviews praise things Nick's also has |
| 5 | Reviews praise things Nick's lacks |
| 0 | Reviews praise unique advantages we can't match |

Score 15 = an opportunity. Score 0 = a threat to differentiate against.

## Total score → action bucket

| Total | Bucket | What to do |
|---|---|---|
| 85-100 | **Direct existential threat** | Operator-direct attention · maybe rebrand / new pricing model |
| 70-84 | **Active competitor** | Watch weekly · counter-program their visible moves |
| 50-69 | **Adjacent player** | Quarterly review · do they overlap on any of our 4 service categories? |
| 30-49 | **Background noise** | Just track existence · automatic alerts only |
| 0-29 | **Not a competitor** | Drop from active list |

## Weekly-report shape

The Apify cron output (raw competitor data) gets reshaped into a 3-line tile per competitor per Wave W dashboard-storytelling.md:

```
Mike's Tire           ← competitor name
↑ 12 reviews (last 30d) ← #1 dimension, biggest change
Acquiring brake mkt   ← #5 dimension narrative
```

Then a tile-grid of the top 8 competitors. Total operator review time · 2 minutes per Monday.

## Anti-patterns

### "Spreadsheet of competitors"

Raw data dump · 80 fields per competitor · operator never reads it. The 6-dimension score is the FILTER.

### "All competitors equally weighted"

A direct-service-category competitor (full-service shop on Euclid Ave) is 100x more important to track than a tires-only chain in Akron. Weight by geography × overlap × size.

### "Only watch leaders"

The threat is usually the rising challenger, not the leader. A 4.7★ shop with 47 new reviews in 30d is more dangerous than a 4.9★ shop with 2 new reviews.

### "React without context"

"Mike's Tire dropped their oil-change price to $29" · don't reflexively match · understand if they're: (a) a loss-leader campaign · (b) a real cost-structure advantage · (c) signaling distress. Different responses for each.

## Skill-port lineage

B13 from the audit's Round 2 deep-pass. Pairs with:
- Memory #51 · Apify weekly competitor cron (data source)
- Wave W · dashboard-storytelling.md (how to display the score)
- Wave Q+T · brand-voice linters (catches when WE adopt competitor-speak by accident)

Future · model the 6 dimensions as a regression that PREDICTS local-pack ranking changes · validates the rubric empirically.
