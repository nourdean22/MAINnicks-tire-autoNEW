# SearchFit SEO Framework

**Skill port:** B7 · searchfit-seo bundle (audit + content + competitor + AEO)
**Applies to:** nickstire.org SEO posture · programmatic SEO pages (`/tires/[city]`, `/brakes`, `/oil-change`, `/diagnostics`, etc.) · backlink + Citation + AEO surfaces · the GBP + Google Search Console feedback loop.
**Authored:** 2026-05-26.

## Why this doc exists

nickstire.org is a service business. ~80% of leads come from organic search (per memory's traffic mix). SEO health is REVENUE. But SEO is also a domain where 90% of advice is wrong-for-our-scale, vendor-pushing, or about a future Google that doesn't exist yet.

This framework codifies the operator-grade SEO posture: **what to do for a service business under 100 employees in a single-metro market**, when to ignore the generic "SEO best practice" cargo cult, and how to measure whether SEO work is paying off.

It does NOT cover · ecom/affiliate-SEO patterns · technical-SEO tooling shootouts · keyword-research vendor recs (the audit's B7 includes a separate searchfit-seo bundle for that).

## The 4 SEO pillars (each pulls its own weight)

### Pillar 1 · Site-quality basics (the foundation · ~30% of SEO outcome)

| Item | Target | Status check |
|---|---|---|
| Core Web Vitals · mobile LCP | < 2.5s | Monthly PageSpeed Insights |
| Core Web Vitals · mobile CLS | < 0.1 | Same |
| Schema markup · LocalBusiness + Service | Present on every service page | Google Rich Results Test |
| Sitemap · indexable + fresh | XML at `/sitemap.xml` · ≤ 24hr stale | Search Console |
| Robots.txt | Allows crawl of all customer-facing pages | curl `/robots.txt` |
| HTTPS + HSTS | Enabled · no mixed-content warnings | DevTools security tab |
| Internal linking depth | Every page ≤ 3 clicks from home | Manual audit (or Ahrefs Site Audit) |
| Pagination + canonical | Per-page canonical · `rel=next/prev` removed (Google deprecated) | Inspect a service page |

**Anti-pattern · "Perfect Core Web Vitals while body content is empty."** Bots use vitals to rank · humans use vitals to NOT bounce. A 2.0s LCP page with 12 words of content ranks worse than a 4.0s LCP page with 800 high-quality words. Focus order · CONTENT first, then vitals.

### Pillar 2 · Content depth (the engine · ~50% of SEO outcome)

Per memory · we have 7 high-value programmatic landing pages (Home, TireFinder, /brakes, /diagnostics, /oil-change, /financing, /booking). Each needs:

| Content element | Why | Where it lives |
|---|---|---|
| **800-1500 words of original copy** | Below this, Google's "thin-content" classifier suppresses · above this, diminishing returns | `client/src/pages/<Page>.tsx` static text |
| **FAQ section · 5-10 Q&A** | FAQPage schema · captures AEO citations | `client/src/components/FAQPageSchema.tsx` (cross-ref Wave PORT 3) |
| **Service-specific photo gallery** | Image search + page dwell time | Existing photo positioning (Wave M / 0739260d) |
| **Price anchor table** | "How much is X?" intent capture | `client/src/pages/<Page>.tsx` (Wave 181.92+ SERP price-anchor titles) |
| **Customer-quote testimonial** | E-E-A-T signal · trust transfer | Pulled from `customer_reviews` table |
| **Service-area mention** | Local pack ranking | "Cleveland · Euclid · Parma · Brook Park · ..." footer |
| **Updated-date stamp** | Freshness signal · Google likes 1-90d updates | `<meta name="lastmod">` per page |

**Cadence** · update each service page's price anchors + FAQs quarterly. Auto-flag stale pages in `/system/seo`.

### Pillar 3 · Local SEO (the multiplier for service businesses · ~15% · but compounding)

| Item | Target | Status check |
|---|---|---|
| **Google Business Profile (GBP)** | Complete · weekly posts · respond to every review within 24h | gbp.google.com · weekly audit |
| **GBP photos** | 50+ new photos / quarter · operator-uploaded | GBP Insights · "Photos viewed" metric |
| **NAP consistency** | Name/Address/Phone IDENTICAL across nickstire.org + GBP + Yelp + BBB + 30 directories | Whitespark / Moz Local audit yearly |
| **Local pack ranking** | Top 3 for "[service] [city]" within 5mi of shop | rank-tracker (Ahrefs has city-grid view) |
| **Reviews velocity** | 5-10 new 5-star reviews / month · 80%+ response rate | GBP dashboard |
| **Citations** | 30-50 high-quality local directory listings | Listing-service OR manual + spreadsheet |

**Anti-pattern · "Buy 100 citations from Fiverr."** Spam citations actively hurt now (Google's local-spam classifier flags burst patterns). 30 hand-built citations on real directories (Yelp · BBB · Angi · YellowPages · Chamber of Commerce) beat 300 garbage links.

### Pillar 4 · AEO (Answer Engine Optimization · ~5% today · 30% by 2027 per industry projection)

AEO is "showing up in ChatGPT / Perplexity / Google AI Overviews answers." Distinct from SEO because the citation surfaces are different.

| Surface | What to do | How to track |
|---|---|---|
| **Google AI Overviews** | FAQPage schema + clear Q-format headings · the SAME content that ranks in featured snippets gets cited in AIO | Search Console "Top queries with AI" filter |
| **Perplexity citations** | Real customer-friendly text (no marketing fluff) + canonical URL + LD+JSON Article schema | Perplexity Pro can show you cited pages |
| **ChatGPT (browser-mode)** | Same as Perplexity · plus claims that are FACTUALLY VERIFIABLE | Manual prompt testing monthly |
| **Voice-assistant answers** | Local schema · explicit hours · explicit phone in plain text | Operator says "Hey Siri, where can I get tires in Euclid" |

**The AEO ROI signal · brand-radar surface · cross-ref statenour `/radar`.** Tracks weekly mention-rate across LLM engines vs competitors.

**Anti-pattern · "Stuff content with `<faq>` tags."** AEO classifiers detect templated FAQ-spam · same way Google's old keyword-stuffing detection killed `/keyword-list.html` pages. Write FAQs as if the customer asked you in the shop · not as if a robot wrote them.

## The 90-day audit cycle

Every quarter, operator (or designated) runs through:

1. **Indexation health** · Search Console · how many pages indexed vs sitemap submitted · gap = problem
2. **Top-10 query review** · biggest opportunities (high impressions · low CTR) → improve title/description
3. **Lost-rank report** · pages that fell out of top 10 · why? (algo update? competitor activity? content stale?)
4. **GBP audit** · photo cadence · review response · NAP consistency drift
5. **Citation refresh** · 5-10 new high-quality directories
6. **Content refresh** · update 2-3 service pages with new copy + photos
7. **Competitor sweep** · what did the top 3 competitors do this quarter? Mirror what works, ignore what doesn't

Output · 1-page quarterly SEO health report · operator decides what to fix in the next 30 days.

## Anti-patterns

### "Keyword density"

Long-dead metric. Modern Google uses semantic embedding-based relevance. Writing for the customer naturally produces the right density. Anyone selling "X% keyword density optimization" is selling 2014.

### "Backlinks from any high-DA site"

Google's link-quality classifier penalizes burst-backlinks from off-topic sites. ONE backlink from Cleveland.com (local relevance) beats 50 from generic high-DA blogs. Quality > volume.

### "Optimize for featured snippets"

Featured snippets are A side-channel · not the main path. Optimizing structure for snippets (numbered lists, definition-style Q&A) helps · obsessing over them and breaking your content's flow doesn't.

### "Update the date stamp without updating content"

Google detects stale-content-with-fresh-date-stamp as a manipulation pattern. The freshness signal MUST correlate with actual content changes. Otherwise you trip the manipulation detector + lose ranking.

### "Generic content for 10 service pages"

Programmatic SEO pages that all read "Looking for [SERVICE] in [CITY]? Look no further!" rank zero. Each page needs ORIGINAL copy targeted at that specific service+city combination · cross-ref the city-title sync pattern (Wave 181.92+).

## The SEO/AEO data plumbing

These surfaces should exist (some already do, some queued):

- **statenour `/seo`** · weekly Search Console KPIs · top queries · top pages · device split · CTR by position [SHIPPED]
- **statenour `/radar`** · brand pulse · competitor mention rate · AEO citation surface [SHIPPED]
- **statenour `/funnel`** · per-source first-visit conversion · which channel = which revenue [SHIPPED]
- **nickstire `/api/seo/keywords`** · pre-aggregated keyword opportunities · powers GBP post generator [QUEUED]
- **nickstire admin `/seo/audit`** · 1-page health dashboard rolling the 4 pillars [QUEUED · candidate for Wave Z]
- **Programmatic-SEO regenerator cron** · weekly job · refreshes content/photos/FAQs on the 7 service pages [QUEUED · pairs with NickGPT for draft generation]

## Skill-port lineage

B7 from the audit's Round 2 (searchfit-seo bundle is one part · the broader audit included content/competitor analysis · we ported the framework here · the actual keyword-research tooling stays in the searchfit-seo MCP at https://github.com/searchfit). Pairs with:

- `docs/eval-rubrics/landing-page-template.md` (Pillar 2 · content depth)
- `docs/eval-rubrics/competitive-landscape.md` (Pillar 4 AEO competitor mention tracking · cross-ref)
- `docs/eval-rubrics/agent-ready-apis.md` (AEO surfaces · agents cite your APIs)
- `docs/eval-rubrics/viral-content-engine.md` (Pillar 2 content production at scale)
- `docs/runbooks/photo-assess-mms.md` (Pillar 3 · GBP gets new photos · photo-assess captures damage photos that double as before/after content)
- statenour `/seo` + `/radar` + `/funnel` surfaces (data plumbing already shipped)

Future · a SEO-AEO-blend agent that runs the 90-day audit cycle weekly · auto-generates the 1-page health report · operator reviews and acts. Cross-ref autonomous-action-tiers · this is Tier-4 read-only · auditor-recommends, operator-decides.
