# Index Coverage Diagnosis — 2026-09-16

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

## 3. Unresolved contradiction — do NOT act on either side yet

`/reviews` and `/compare` both returned **"URL is unknown to Google."**

This **conflicts with** the GSC Search Analytics read taken earlier the same day, which showed
`/reviews` at **2,155 impressions / 0 clicks over 90 days** — a page Google has never heard of
cannot accumulate impressions.

On-page signals are clean for both (checked directly): self-referencing canonical, `robots:
index, follow`, `sitemap: true`, `prerender: true`, priority 0.7 / 0.9. So nothing on the page
explains it.

Candidate explanations, none verified: trailing-slash URL variance between the two APIs; the
impressions being historical while the page has since dropped out; a property-scope difference
between the Search Analytics and URL Inspection reads. **Resolve this before drawing any
conclusion about `/reviews`** — it is a money page and the two Google surfaces disagree.

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
