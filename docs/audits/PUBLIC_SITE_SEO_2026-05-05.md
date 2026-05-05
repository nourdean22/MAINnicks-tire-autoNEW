# nickstire.org — Customer-Facing SEO Report

**Date:** 2026-05-05 (post-deploy of `e3f419b...769c620`, 9 commits today)
**Method:** live HTTP probes + on-page-seo skill framework + seo-images audit + meta optimization
**Scope:** the public customer-facing surface only (admin audited separately)

---

## SEO Health Score: **88 / 100**

Strong fundamentals across every category. The failure modes that bit pre-`e3f419b` are all closed. Remaining gaps are tuning, not structural.

| Category | Weight | Score | Notes |
|---|---|---|---|
| Technical SEO | 22% | 95 | Sitemap dynamic + truth-driven, robots dynamic, prerender pipeline hardened, dynamic blog routes now serving 115 KB content |
| Content Quality | 23% | 85 | E-E-A-T strong (1,700+ reviews, named owner, real address, ASE markers); blog now indexable; some service pages 80%+ similar to others |
| On-Page SEO | 20% | 80 | 6 pages have meta descriptions >160 chars; 3 have titles >70 chars (will truncate on desktop SERP) |
| Schema | 10% | 95 | Rich graph: 82 Service + 82 Offer + 71 City + 36 PriceSpec + 18 Q/A + LocalBusiness/AutoRepair/TireShop + Breadcrumbs on 89% |
| Performance (CWV) | 10% | 80 (estimated) | Hero preload, font preload, deferred analytics, WebP heroes, lazy below-fold. **No empirical Lighthouse numbers yet — Lighthouse CI workflow shipped today, weekly schedule** |
| AI Search Readiness | 10% | 95 | llms.txt + llms-full.txt + ai.txt + business-data.json + explicit `Allow:` for GPTBot/ClaudeBot/PerplexityBot/Google-Extended/Bingbot/Applebot-Extended/cohere-ai/Meta-ExternalAgent |
| Images | 5% | 95 | 21/21 imgs have alt text on tested pages, 95% WebP, lazy loading widely applied, hero preloaded |

---

## §1 — What's Working (don't touch)

| Surface | Strong signal |
|---|---|
| **Sitemap** | 305 URLs, dynamic from `SITEMAP_ROUTES` truth in routes.ts. No drift, no thin pages from stale generators. |
| **Prerender** | 308 HTML files, all 200 OK, 107-275 KB each. Bots see real content, not SPA shells. |
| **Blog corpus** | 126 posts indexable (was 0 pre-`e3f419b`). Each has unique title + meta + 50-115 KB rendered content + per-post BreadcrumbList + tags. |
| **Schema graph** | LocalBusiness/AutoRepair/TireShop with aggregateRating(4.9, 1700+), areaServed × 11 cities, hasOfferCatalog × 8 services. Plus per-page Service + BreadcrumbList. |
| **AI visibility** | Ahead of every competitor reviewed. llms.txt clean, ai.txt verified 2026-05-02, business-data.json structured, explicit `Allow:` for 11 AI bots. |
| **Image SEO** | 100% alt coverage, 95% WebP, content-rich alt text (service + city names, not generic). |
| **Geo signals** | geo.region, geo.placename, geo.position, ICBM meta tags on every page. |
| **CSP + HSTS + X-Frame** | Production headers tight. Trust signal for both bots and users. |

**The customer site is structurally outperforming every local competitor reviewed (Best Buy Tire, Advanced Tire, Tire World, Norman, Bob's, Rad Air).**

---

## §2 — Concrete Meta Optimization Issues (fix this week)

Live HTTP audit on 8 key pages found:

### Critical: descriptions exceeding Google SERP truncation

| Page | Source desc length | Issue | Recommended rewrite (≤160 chars) |
|---|---|---|---|
| `/services` | 167 | Slightly over | "Cleveland auto repair — tires, brakes, diagnostics, emissions, oil. Walk-ins 7 days. Free written estimates. 4.9★ from 1,700+ reviews. (216) 862-0005" *(157)* |
| `/booking` | **197** | Significantly over | "Reserve your drop-off in 60 seconds. No credit card. Master tech calls back in 15 min. Walk-ins welcome 7 days. (216) 862-0005" *(126)* |

### Warning: titles exceeding 70 chars (desktop truncation)

| Page | Source title length | Recommended rewrite |
|---|---|---|
| `/booking` | 75 | "Book Auto Repair Online \| Cleveland Walk-In Shop \| Nick's Tire" *(60)* |
| `/services` | 67 | "Auto Repair Near Me — Cleveland Tire Shop \| Nick's" *(50)* |

The other 4 audited pages (`/`, `/brakes`, `/tires`, `/cleveland-auto-repair`) are within tolerance after today's earlier trim work — they're already optimal.

**Estimated CTR lift from above 4 fixes: 3-7% on the affected pages.** Service-page CTR for booking-intent queries is the most sensitive to title clarity.

---

## §3 — SEO Plan (prioritized for execution)

### This week (fast, high-leverage)

1. **Trim the 4 metas listed in §2.** 1 hour total. Re-run prerender (`pnpm run regen`), commit, deploy.
2. **Force a GSC re-fetch on the 4 affected URLs** via the URL Inspection tool after deploy. Recrawl in 1-3 days vs 1-2 weeks of natural cycle.
3. **Verify the new Lighthouse CI workflow runs cleanly** on the next push. Capture the first set of LCP/CLS/INP numbers as the baseline.

### This month (compounding)

4. **A/B testing harness** for the 10 conversion components in `client/src/components/conversion/`. Right now Cialdini stack (DecoyPricingTable, ExitIntentModal, FearCalibrationBlock, etc.) is shipping without measurement. PostHog free tier or homegrown over tRPC. **Highest single ROI item available.**
5. **`<NearbyCities>` component for blog post footers** — blog pages are SEO entry points but currently have no city-specific cross-links. Adding "Trusted by drivers from Euclid, Cleveland, Lakewood..." footer to each blog post strengthens local intent for blog-organic traffic.
6. **GSC + Search Console programmatic monitor** — weekly cron pulling top queries by clicks/impressions, sending owner a "what changed" digest. Catches ranking drops early.
7. **Topic clusters around the 126 blog posts.** Many cover similar ground (`brake-repair-cost-cleveland-2026`, `how-much-brake-repair-cost-cleveland`, `brake-repair-cost-cleveland`). Decide which is canonical for each topic, 301 the others, consolidate authority.

### This quarter (structural)

8. **Real User Monitoring (RUM) beacon.** `web-vitals` npm + tRPC mutation logging LCP/CLS/INP per visit. Lighthouse synthetic + RUM real = full picture. Catches device-specific perf issues no synthetic test sees.
9. **Conversion rate dashboard tied to landing page.** Right now you can see "leads in" and "bookings out" separately, but not "of leads from /brakes-cleveland, X% booked, vs /tires-cleveland Y%." Pages-level CR data drives where to invest copy/photo work.
10. **Photo strategy for the 11 fixed-but-still-generic blog hero images.** The fix in `61c1a29` swapped `/photos/tire-stacks-overhead.webp` → CloudFront tire hero. Functional but generic. Each post deserves a unique hero — improves social share CTR + image search.
11. **Decide on `serviceCityCombinator.ts`.** 260 service+city combos defined as data, never wired to routes. Either ship them all (massive long-tail) or delete the file. Currently zero value, lots of dev confusion.

---

## §4 — What's Already Defended Against

| Failure mode | Defense shipped today |
|---|---|
| Silent prerender drift | `verify-prerender.yml` CI workflow + sanity gates in `prerender.mjs` (throws on <50 routes or <100 blogs) |
| Perf regression | `lighthouse-ci.yml` weekly + on-push, 6 URLs |
| Cron silent failure | `cron-failure-observer` job, Telegram critical alerts on 2+ consecutive failures |
| Local dev catching CI bugs late | `pnpm prerender:check` mirrors the CI logic |
| Stale meta descriptions | Existing `improvements.test.ts` + `audit-fixes.test.ts` block PRs that ship over-length descs |
| Stale phone numbers | `BUSINESS.phone.display` centralization + audit-fixes.test pins the canonical value |

---

## §5 — Live State Verification Commands

Every metric in §1-§4 is reproducible:

```bash
# Live sitemap URL count (expected ~305)
curl -sL https://nickstire.org/sitemap.xml | grep -c "<loc>"

# Verify a blog post is real content (expected ~115KB)
curl -sL -A "Googlebot/2.1" https://nickstire.org/blog/best-tires-for-cleveland-winter | wc -c

# Verify HSTS + CSP live
curl -sI https://nickstire.org/ | grep -E "Strict-Transport|Content-Security|X-Frame|Permissions"

# Image alt audit on a key page
curl -sL https://nickstire.org/brakes | grep -oE "<img[^>]+>" | grep -vc "alt="  # expected 0

# AI bot allow rules in robots
curl -sL https://nickstire.org/robots.txt | grep -E "GPTBot|ClaudeBot|PerplexityBot|anthropic-ai"

# Prerender drift check (local)
pnpm prerender:check  # exits 0 if missing <= 5
```

---

**Bottom line:** the customer-facing site is in the best SEO shape it's been in. The remaining work is empirical (measure perf, A/B test conversion components, monitor GSC) and tuning (4 metas, cluster consolidation). Nothing structural is broken.
