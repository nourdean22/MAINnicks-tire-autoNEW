# GSC Index Status — 2026-05-07

> Real-fetch verification of Google Search Console URL Inspection
> results for all 14 wave-33 competitor comparison pages.
> Generated wave-83 via Chrome MCP automation against the operator's
> authenticated GSC session.

---

## Headline result

**14 of 14 wave-33 competitor pages are INDEXED in Google.** ✅

The wave-33 SEO authority cluster (shipped 2026-05-06) is fully
crawled. Google's URL Inspection returns "URL is on Google" for every
competitor comparison page. Indexing took roughly 24 hours from
sitemap submission.

---

## Per-URL results

All checks performed via GSC URL Inspection at
`https://search.google.com/search-console/inspect?resource_id=https://nickstire.org/`
on 2026-05-07. Status field = top inspection-result line returned by GSC.

### Singular alternative pages (7 of 7 indexed)

| URL | Status |
|---|---|
| `/conrads-tire-alternative-cleveland` | ✅ URL is on Google |
| `/mavis-tire-alternative-cleveland` | ✅ URL is on Google |
| `/discount-tire-alternative-cleveland` | ✅ URL is on Google |
| `/firestone-alternative-cleveland` | ✅ URL is on Google |
| `/monro-alternative-cleveland` | ✅ URL is on Google |
| `/big-o-tire-alternative-cleveland` | ✅ URL is on Google |
| `/ntb-alternative-cleveland` | ✅ URL is on Google |

### Head-to-head vs pages (3 of 3 indexed)

| URL | Status |
|---|---|
| `/nicks-tire-vs-conrads-cleveland` | ✅ URL is on Google |
| `/nicks-tire-vs-mavis-cleveland` | ✅ URL is on Google |
| `/nicks-tire-vs-firestone-cleveland` | ✅ URL is on Google |

### Roundup hubs + 3rd-party comparisons (4 of 4 indexed)

| URL | Status |
|---|---|
| `/best-tire-shops-cleveland` (HUB) | ✅ URL is on Google |
| `/best-conrads-tire-alternatives-cleveland` | ✅ URL is on Google |
| `/conrads-vs-mavis-cleveland` | ✅ URL is on Google |
| `/firestone-vs-discount-tire-cleveland` | ✅ URL is on Google |

---

## Verification methodology

Real-fetch via Chrome MCP automation against the operator's
authenticated GSC session. For each URL:

1. Locate `<input aria-label="Inspect any URL in https://nickstire.org">`
   in the GSC top bar
2. Use React's internal `_valueTracker.setValue('')` to mark dirty,
   then `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set`
   to set the new URL
3. Dispatch `input` event so React picks up the controlled-input change
4. Wait 11 seconds for GSC to navigate to inspection result and fetch
   from Google index API
5. Read `document.body.innerText` and check for "URL is on Google"
   (indexed) or "URL is not on Google" / "URL isn't on Google" (not
   indexed)

This bypasses the form_input + Enter approach which doesn't sync with
GSC's React controlled-input state. The URL bar's React state requires
the `_valueTracker` reset trick to recognize a programmatic value change.

---

## What this confirms

- ✅ Wave-33 14-page comparison cluster is real production SEO surface
- ✅ Sitemap submission via the wave-33 sitemap entries was effective
  (all 14 URLs were discovered via `sitemap.xml`, no manual indexing
  request was needed for any of them)
- ✅ The hub-and-spoke topology is in place — `/best-tire-shops-cleveland`
  hub plus all 13 spoke pages crawlable + indexed
- ✅ Wave-72 routes.ts ↔ data sync did not break crawlability

---

## Next-tier SEO indexing tasks (not in this audit)

- 3 wave-35-37 pillar articles (`/blog/complete-cleveland-tire-guide`,
  `/blog/cleveland-auto-repair-owners-manual`,
  `/blog/cleveland-pothole-salt-damage-guide`) — should be inspected
  similarly to confirm indexed
- ~30 existing blog spoke articles — wave-38 cross-links these to
  pillars; status of pillar links flowing through SERPs is a separate
  metric (impressions / position) not captured by URL inspection alone

These can be checked via GSC Performance tab over the next 14 days as
ranking data accumulates.

---

## Last updated

2026-05-07 (wave-83) via Chrome MCP. All 14 confirmed indexed in a
single session run.
