# Index Coverage Diagnosis — 2026-09-16

> ## ⚠ CORRECTION (same day, after first publication)
>
> **The URL Inspection API returns non-deterministic results on this property.** Measured: the
> same URL (`https://nickstire.org/reviews`), inspected 3 times in a row seconds apart with
> `siteOwner` permission, returned `"Discovered - currently not indexed"` twice and
> `"URL is unknown to Google"` once. An earlier run that same hour returned a third framing.
> `robotsTxtState` and `pageFetchState` both come back `*_UNSPECIFIED`.
>
> Permission is **not** the cause — `sites.list` confirms the service account
> (`nickstire-server@teezy-491218.iam.gserviceaccount.com`) holds **`siteOwner`** on
> `https://nickstire.org/`, which is what URL Inspection requires.
>
> **Consequence for §1 of this document:** the per-group indexing percentages were built from
> single URL Inspection calls. With a demonstrated ~1-in-3 flip rate, **treat that table as
> indicative of direction only, not as measured rates.** Do not quote those percentages as facts.
>
> **What is NOT affected**, because it never depended on URL Inspection:
> - §5's impression counts (Search Analytics — a different API, stable, with a consistent daily
>   series).
> - §2's near-duplicate measurement (a local `diff` of two prerendered files; no API at all).
> - The 150/129 split (read from the GSC web UI).
>
> The core conclusion — that the shortfall is concentrated in `neighborhood` and `tire-size`,
> and that the neighborhood pages are near-duplicates — rests on those three, and stands.

**Question this answers:** GSC's Page Indexing report (read live 2026-09-16) shows **150 indexed /
129 NOT indexed** of 279 known pages. Which pages, and why?

**Method:** stratified sample of 33 URLs across 8 route groups, via the GSC **URL Inspection API**
(`searchconsole/v1/urlInspection/index:inspect`), service-account JWT, run through
`railway run --service MAINnicks-tire-auto`. Sampling was evenly-spaced within each group, not
first-N, so one alphabetical cluster could not stand in for a whole group. One call returned a
transient `503 UNAVAILABLE` and is excluded from its group's denominator below.

Prior art reused rather than rebuilt: `scripts/gsc-errors.ts` already had the working auth +
endpoint shape (`webmasters.readonly` covers URL Inspection). It was not wired to anything and
carried a stale hardcoded 7-URL list from wave-181.29/38.

## 1. Indexing rate is not uniform — it collapses by route group

| Group | Indexed / sampled | Routes in registry | Dominant non-indexed state |
|---|---|---|---|
| utility | 2/2 | 19 | — |
| service | 3/4 | 33 | Discovered - currently not indexed |
| comparison | 2/3 | 15 | URL is unknown to Google |
| core | 2/3 | 7 | URL is unknown to Google |
| problem | 1/3 | 13 | Discovered - currently not indexed |
| city | 1/3 | 21 | Crawled / Discovered - not indexed |
| **neighborhood** | **2/10** | **120** | Discovered - currently not indexed (5x) |
| **tire-size** | **0/4** | **30** | Discovered / Crawled - not indexed |

`neighborhood` (120 routes) and `tire-size` (30 routes) are 150 of the 266 prerendered routes and
index at 20% and 0% in sample. That alone is consistent with the 129-page shortfall; the other
groups are comparatively healthy.

## 2. Root cause for the neighborhood group: the pages are near-duplicates

`/newbury-ohio` came back **"Duplicate, Google chose different canonical than user"** —
Google's canonical for it is `https://nickstire.org/norton-ohio`, a *sibling neighborhood page*.

Measured, not inferred: normalize the town name out of both prerendered documents and they differ
by **2 lines out of ~116 KB**.

```
sed 's/Newbury/TOWN/g' prerendered/newbury-ohio/index.html  > a
sed 's/Norton/TOWN/g'  prerendered/norton-ohio/index.html   > b
diff a b | grep -c '^[<>]'     # => 2
```

Their registry entries are the same sentence with the town swapped:

- `/newbury-ohio` — "Auto Repair Newbury OH — Nick's Tire & Auto" / "Honest auto repair serving
  Newbury, OH. Tires, brakes, check-engine light, oil changes, emissions. Walk-ins welcome 7 days…"
- `/norton-ohio` — identical, "Norton".

This is the documented near-duplicate outcome, not a crawling accident. Note that PR #2323
(2026-09-11) set out to "enrich and index the remaining 109 thin neighborhoods" — whatever that
enrichment changed, these two pages are still templated to within 2 lines of each other, so the
problem is not closed.

One sampled neighborhood page also returned **"Excluded by 'noindex' tag"** — worth identifying
whether that is deliberate.

## 3. `/reviews` — the contradiction, resolved, and the real finding underneath

The first pass flagged `/reviews` and `/compare` returning **"URL is unknown to Google"** against
Search Analytics reporting `/reviews` at ~2.2K impressions the same day. That is now resolved:
**the URL Inspection side of the conflict is an artifact** (see the CORRECTION block at the top —
the same URL returns different coverage states on repeated calls). It is not evidence that
`/reviews` is uncrawled, and the earlier framing here should not be relied on.

Everything checked and ruled out along the way:
- **robots.txt does not block it.** `server/_core/robots.ts` disallows only `/admin`, `/admin/`,
  `/my-garage`, `/portal`, `/api/`, `/status/`, `/inspection/`. `/reviews` is not among them.
- **On-page signals are clean:** self-referencing canonical, `robots: index, follow`,
  `sitemap: true`, `prerender: true`, priority 0.7.
- **Permission is not the issue:** the service account holds `siteOwner`.
- **Trailing-slash variance is not the explanation either** — both forms were probed, and the
  non-slash form itself gave different answers across runs.

**What survives, from the stable API, and is the actually interesting result:**

`/reviews` earns **2,216 impressions over 90 days at average position 8.3**, running a steady
~30-49 impressions/day through 2026-09-14 — and **zero clicks. Every single day. All 90 of them.**

That is the finding worth attention. Page-one visibility converting at exactly 0.00% is not
normal decay; this session's own device-CTR bands, derived from this property's non-brand
queries, put mobile position 4-10 at **1.10%**. Applied to 2,216 impressions that predicts roughly
**24 clicks**. The observed count is 0.

This is a `/reviews`-specific anomaly with real upside if explained, and it is **not** the
neighborhood/tire-size story — different page, different failure. Worth a dedicated look at what
the SERP result for those impressions actually renders as.

## 4. What this does and does not license

It licenses: treating `neighborhood` and `tire-size` as the index-coverage problem, rather than
spreading effort across all 279 pages.

It does **not** license mass-generating "unique" copy for 120 towns. There are no per-town facts
in this repo to differentiate them with, and inventing local detail would violate the
content-and-claim-safety rule in `apps/nickstire/AGENTS.md` ("No invented warranties, wait-times
or reviews"). Differentiation needs real operator-supplied local substance, or it should not
happen.

The live-verified §11 tire-silo consolidation (PR #2350, this same day) is the precedent for the
alternative: when pages log no impressions across a full window, merging them into one page that
does rank beat keeping them. Applying that logic here is a **120-page decision and therefore the
operator's call**, not an agent's.

## 5. What these pages actually earn — live GSC, 90 days (2026-06-16 → 2026-09-14)

Per-page Search Analytics read across the whole property (144 pages earned any impression at all).

| Group | Routes | Earned ≥1 impression | Earned ZERO | Total impressions | Total clicks |
|---|---|---|---|---|---|
| **city** | 21 | 11 | 10 | **9,742** | **31** |
| neighborhood | 120 | 7 | **113** | 28 | **0** |
| tire-size | 30 | 4 | **26** | 54 | 1 |
| problem | 13 | **0** | **13** | **0** | **0** |

`city` is the control that proves the site *can* rank local pages — `/euclid-auto-repair` alone
carries 3,397 impressions at position 11.6, and the group totals 9,742 impressions / 31 clicks.

Against that, the other three groups are not underperforming, they are inert: 120 neighborhood
pages produced **28 impressions and zero clicks** in 90 days, best-in-group `/kent-ohio` at 10
impressions / position 25.5. All 13 `problem` pages produced **nothing at all**.

**Causality caveat, stated rather than glossed:** a page Google declines to index cannot earn
impressions, so "zero impressions" and "not indexed" are partly the same fact seen twice. For
the neighborhood group the direction is nonetheless evidenced — the canonical collision and the
2-line document difference in §2 are upstream of the zero, not downstream of it. For
`tire-size` and `problem` no such root-cause evidence was gathered; their zeros are currently
only correlated with non-indexing, not explained by it.

## 6. The decision, and why it is the operator's

The §11 tire-silo consolidation (PR #2350, merged this same day) retired 3 pages on exactly this
trigger — zero impressions across a full window — after a pre-registered War Room gate. That
precedent is sound and operator-sanctioned. It does **not** automatically extend here:

- §11 covered **3** pages against a rule agreed in advance. This is **152** pages (113 + 26 + 13)
  with no pre-registered rule.
- §11 **merged content into a page that does rank** and 301'd — consolidation, not deletion. Any
  action here should follow the same shape, not simply remove.
- `/kent-ohio` (pos 25.5) and `/broadview-heights` (pos 5.0) are not zero. A blanket sweep would
  take live pages with it.

Three viable directions, in the operator's hands:

1. **Consolidate** the zero-impression neighborhood + problem pages into the city pages that
   already rank, with 301s — the §11 shape, applied at scale.
2. **Differentiate** the keepers with real per-town substance (customers served, landmarks, drive
   routes, local road conditions). This requires operator-supplied facts; it cannot be generated,
   and inventing local detail would breach the claim-safety rule in `apps/nickstire/AGENTS.md`.
3. **Leave them.** They cost crawl budget and dilute the template, but they are not making false
   claims.

Still genuinely unknown, and worth one more read before any sweep: whether the 13 `problem` pages
and 26 zero-impression `tire-size` pages are thin-duplicate like the neighborhoods, or simply
aimed at queries with no local demand. §2's evidence covers the neighborhood group only.
