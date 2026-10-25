# Public site measures (2026-10-25)

Job 2026-10-25-public-site-measures, branch `nickstire/public-site-measures-2026-10-25`, cut from `origin/main` `51e8be7ea`.
These are the three read-only measurements that `REVIEW-ACCURACY-2026-10-25.md` ranked 1, 3 and 4. Nothing on the site was changed; what to do with the numbers is Nour's call.

## Answer first

1. **Place pages (ranked 1): no two of the 122 place-named pages are copies, and none reaches 0.9. FACT, read 2026-10-25 15:46Z.**
   35 of the 7,381 page pairs inside the place set (0.5%) score 0.80 or higher, the closest 0.856 (`/brecksville` and `/richfield-ohio`). All 35 appear only after each page's own place name is masked; with raw text the best pair is under 0.80. The bulk of the set sits at 0.4 to 0.6 masked (53.5% of pairs): a shared template with different local detail, not a find-and-replace of the city. The 0.8 line is this job's, not Google's: Google publishes no number, and its doorway test is about purpose (pages that funnel users to one destination), which a text score cannot decide.
2. **Phone first view (ranked 3): on the local build under a 4G profile the GET TIRES NOW tile is visible at 6.4 s, 8.2 s and 8.3 s (median 8.2 s); fixed layers cover 25.0% of the screen after a 600 px scroll. FACT for this harness, not for production's live page.**
   Unthrottled the same tile is visible at 1.8 s. The tile appears 1.4 to 1.6 s after it enters the page in every run, throttled or not, so about 1.5 s of every load is the entrance fade, a fixed cost on top of load time. This confirms the review's weak inference that a fade-in delays the main call to action; it is a delay of about 1.5 s, not 3 s.
3. **Field speed (ranked 4): UNMEASURED. Google has no field (CrUX) data for nickstire.org, on mobile or desktop.** The report page says "No Data" for both. There are no LCP, INP or CLS field values to record, and that is not a pass. The keyless API refused every read (HTTP 429, daily quota), so the numbers below come from the pagespeed.web.dev report page. Lab (one run each, 2026-10-25): mobile performance 58, LCP 15.2 s; desktop performance 74, LCP 3.1 s, CLS 0.128.

What this implies, in order of size:
- The lab LCP on mobile (15.2 s) is far past the 2.5 s "good" line and is the loudest number here. The same report lists `admin-*.js` (about 167 KiB) and `blog-*.js` (about 343 KiB) on the homepage, and a local `vite build` prints "Circular chunk: blog -> admin -> blog". That is WEAK INFERENCE for a chunk-split problem pulling admin code into the public first load. Not traced.
- The tile wait is mostly load time (6.4 to 8.3 s throttled against 1.8 s unthrottled), then a fixed 1.5 s fade.
- The bottom of the phone screen holds 17.5% of fixed chrome after scrolling (review toast 8.8%, CALL/TEXT/DIRECTIONS bar 8.1%, chat button 0.6%) plus 7.4% for the top nav.
- The place pages are not the urgent risk the review feared; the 35 closest pairs are the first candidates if Nour wants to differentiate any.

## 1. Place-page similarity

Script: `apps/nickstire/scripts/place-page-similarity.mjs` (read-only, no network; run from `apps/nickstire`: `node scripts/place-page-similarity.mjs`). Read 2026-10-25T15:46:36Z from `apps/nickstire/prerendered/`.

**Which pages.** Set A: every route in `shared/routes.ts` `ALL_ROUTES` with group `city` or `neighborhood`: 122 routes, 122 have a prerendered file, 0 lack a `<main>`. Set B: 89 other prerendered pages (blog, guides, root) whose slug contains a place name from set A; in practice all name "cleveland" (blog posts, brand-alternative pages, guides). The review's "up to 127" was a slug regex over the sitemap; this count comes from the route table instead, so the two do not match and neither is wrong. Measured 211 pages, 22,155 pairs, 7,381 of them inside set A.

**Method.** Main text only (`<main>`; nav, footer, aside, header, scripts, styles removed), lowercased words. Similarity is Jaccard over word 3-shingles. Shingles catch reused phrases, which is what a template leaves behind; a plain word-set Jaccard would be inflated by shared vocabulary such as "brakes" and "tires". Each pair gets two scores: RAW, and MASKED, where each page's own place name is replaced by one token, so a city-swapped template scores as the copy it is. Page length (main-text words): minimum 483, median 615, maximum 2,210.

**Controls (printed first, all passed; the script exits 1 if any fails).**

| Control | Score | Needed |
|---|---|---|
| C1 two copies of one page (`/amherst-ohio` copied to the temp dir), raw | 1.000 | exactly 1.0 |
| C2 two unrelated pages (`/brakes` vs `/car-care-guide`), raw | 0.050 | under 0.3 |
| C3 `/amherst-ohio` with the city renamed to a made-up one, masked | 1.000 | exactly 1.0 |
| C4 the same renamed copy, raw | 0.852 | under 1.0 (proves masking is what closes the gap) |

Mutation receipts (scorer broken on purpose, then restored, final run exit 0): scoring always 1 failed 2 of 4 controls (C2, C4); text extraction returning nothing failed 4 of 4; masking disabled failed 1 of 4 (C3). The instrument can go red.

**Distribution, set A only (7,381 pairs), pairs per 0.1 bucket.**

| Bucket | Raw | Masked |
|---|---|---|
| 0.0 to 0.1 | 2,121 (28.7%) | 2,121 (28.7%) |
| 0.1 to 0.2 | 26 | 2 |
| 0.2 to 0.3 | 210 | 149 |
| 0.3 to 0.4 | 953 | 238 |
| 0.4 to 0.5 | 2,755 (37.3%) | 2,094 (28.4%) |
| 0.5 to 0.6 | 834 | 1,849 (25.1%) |
| 0.6 to 0.7 | 442 | 579 |
| 0.7 to 0.8 | 40 | 314 |
| 0.8 to 0.9 | 0 | 35 |
| 0.9 to 1.0 | 0 | 0 |

All 22,155 pairs (set B included) are in the script output; 72.7% sit below 0.1, which is set B pages being about different topics, so the set A table is the honest denominator for the place-page question. The 28.7% of set A pairs below 0.1 means set A holds at least two page families that share almost nothing; which pages form each family was not examined.

**Pairs at 0.80 or higher (all inside set A, masked score first, raw second).**
`/brecksville` `/richfield-ohio` 0.856 0.752; `/moreland-hills` `/linndale` 0.850 0.732; `/brunswick-ohio` `/copley-ohio` 0.849 0.748; `/independence-ohio` `/seven-hills` 0.843 0.736; `/stow-ohio` `/grafton-ohio` 0.842 0.749; `/vermilion-ohio` `/green-ohio` 0.836 0.728; `/north-ridgeville` `/linndale` 0.832 0.718; `/glenwillow` `/brooklyn-ohio` 0.830 0.721; `/grafton-ohio` `/valley-view` 0.828 0.715; `/elyria-ohio` `/burton-ohio` 0.826 0.731; `/oakwood-village` `/valley-view` 0.825 0.710; `/grafton-ohio` `/oakwood-village` 0.822 0.714; `/olmsted-falls` `/bentleyville` 0.817 0.705; `/norton-ohio` `/union-miles` 0.816 0.703; `/south-russell` `/cuyahoga-heights` 0.815 0.698; `/stow-ohio` `/valley-view` 0.814 0.714; `/concord-township` `/oakwood-village` 0.813 0.698; `/northfield-ohio` `/bentleyville` 0.813 0.711; `/northfield-ohio` `/olmsted-falls` 0.811 0.700; `/kent-ohio` `/walton-hills` 0.810 0.708; `/grafton-ohio` `/concord-township` 0.810 0.700; `/wadsworth-ohio` `/olmsted-falls` 0.809 0.706; `/woodmere` `/cuyahoga-heights` 0.809 0.697; `/stow-ohio` `/oakwood-village` 0.808 0.710; `/south-russell` `/woodmere` 0.807 0.702; `/fairview-park` `/copley-ohio` 0.807 0.698; `/concord-township` `/valley-view` 0.806 0.694; `/sagamore-hills` `/sheffield-lake` 0.805 0.684; `/tallmadge-ohio` `/bentleyville` 0.804 0.702; `/orange-village` `/lee-miles` 0.804 0.699; `/walton-hills` `/glenville` 0.803 0.700; `/olmsted-falls` `/tallmadge-ohio` 0.803 0.698; `/medina-ohio` `/cuyahoga-heights` 0.803 0.703; `/amherst-ohio` `/norton-ohio` 0.802 0.698; `/cuyahoga-falls` `/sheffield-lake` 0.800 0.676.

Pages in the most pairs: `/grafton-ohio`, `/valley-view`, `/oakwood-village`, `/olmsted-falls` (4 each); `/stow-ohio`, `/bentleyville`, `/cuyahoga-heights`, `/concord-township` (3 each).

## 2. Phone first view of the homepage

Spec: `apps/nickstire/tests/e2e/home-first-view.spec.ts` (opt-in, `HOME_FIRST_VIEW=1`, so the live canary job skips it; a measurement, it asserts no budget). Read 2026-10-25T16:00:31Z. Run: `HOME_FIRST_VIEW=1 HOME_FIRST_VIEW_CHANNEL=chrome node node_modules/@playwright/test/cli.js test tests/e2e/home-first-view.spec.ts --project=iphone-se --workers=1` after `node node_modules/vite/bin/vite.js build`, through `scripts/agent-os/heavy.mjs run --slot chrome`. Result: 1 passed, exit 0.

**Method.** The local `vite build` (`dist/public`, source `51e8be7ea`) is served from 127.0.0.1 by a small in-process server (gzip on text, as production's). A 375x812 phone context loads `/`; an in-page recorder samples every animation frame and stamps the first moment the "Get tires now" link exists and the first moment it is on screen with an effective opacity of 0.95 or more (Playwright's own visibility check counts opacity 0 as visible, so it cannot see a fade). Then it waits 4 s, scrolls to 600 px, waits 1.5 s, and measures coverage: a 6 px grid over the screen, at each point the topmost non-transparent element a tap would land on, counted when it sits inside a fixed or sticky layer. Throttle: the repo has no throttled-4G fixture (nothing in `apps/nickstire` or `.github`), so the spec defines the PageSpeed mobile profile: 150 ms round trip, 1.6 Mbit/s down, 750 kbit/s up, 4x CPU slowdown, applied by the browser. Run 1 is unthrottled; runs 2 to 4 are throttled. Browser: the installed Google Chrome (`channel: chrome`; Playwright's bundled Chromium 1248 is not downloaded on this machine, and a download is an install, so it was not done).

**Controls (run first in the same spec, all passed).** A tile planted to turn opaque at 2,000 ms read 2,056 ms. A tile that stays at opacity 0 is in the page (24 ms) and is never reported visible. A planted solid 375x100 fixed bar read 11.9% (100 of 812 px is 12.3%; the grid is good to about one point) and alone counted as a layer next to a pointer-events-none overlay and an opacity-0 overlay. This control caught a defect in the first version of the instrument: it read 0% because an invisible overlay on top hid the bar beneath it; the probe now looks through fully transparent elements.

| Run | Throttled | Tile in page | Tile visible | Fade (gap) | First paint | Fixed-layer share at top | After 600 px scroll |
|---|---|---|---|---|---|---|---|
| 1 | no | 393 ms | 1,781 ms | 1,388 ms | 1,148 ms | 15.4% | 25.0% |
| 2 | yes | 6,737 ms | 8,317 ms | 1,580 ms | 7,268 ms | 15.4% | 25.0% |
| 3 | yes | 4,832 ms | 6,420 ms | 1,588 ms | 5,368 ms | 15.4% | 25.0% |
| 4 | yes | 6,714 ms | 8,230 ms | 1,516 ms | 7,180 ms | 15.4% | 25.0% |

Three throttled samples, spread of about 2 s between the fastest and the others: a median, not a distribution. First paint equals the largest paint in every run, so the hero is what paints. The throttled first paint (5.4 to 7.3 s) brackets PageSpeed's own mobile first paint of 7.1 s, which is a sanity check that the profile is not wildly off.

**Fixed layers after the 600 px scroll (identical in all four runs).** Review toast `div.fixed.bottom-4` 8.8% (at x=16, y=637, 295x91); CALL/TEXT/DIRECTIONS bar `div.fixed.bottom-0` 8.1% (at x=0, y=744, 375x68); top nav 7.4% (375x61); chat button 0.6% (at x=311, y=620, 48x48). Total 25.0%; bottom layers alone 17.5%. At the top of the page the nav is 123 px tall and covers 14.8% (nav plus chat 15.4%), so on first view about 15% of the screen is fixed header. The review's own phone read (24%, 192 of 812 px) covered the chat button, toast and CALL/TEXT/DIRECTIONS bar at a 1,500 px scroll; the same three layers are 17.5% here at 600 px. The gap (24% against 17.5%) was not reconciled (UNKNOWN): the review's layer heights sum to 206 px, not 192, so its own arithmetic is loose.

**Limits of this measure.** Every `/api/` call answered 404 (12 distinct tRPC reads, among them weather, shop status, reviews, specials and notifications) and four third-party hosts were refused (`fonts.googleapis.com`, `connect.facebook.net`, `www.googletagmanager.com`, `analytics.ahrefs.com`). Real data could add or change fixed layers (the toast's text, a weather banner) and web fonts would change widths; this is the shell's cost, not the live page's. The throttle is browser-applied, harsher than Lighthouse's simulated one. The machine was shared with other sessions, which adds noise to the throttled times.

## 3. Field speed

Recorded in `apps/nickstire/docs/CURRENT-TRUTH.md`, section "Field speed". Read 2026-10-25 15:48Z to 15:57Z.

- **API read: UNMEASURED.** `pagespeedonline/v5/runPagespeed` without a key returned HTTP 429, "Quota exceeded for quota metric 'Queries' and limit 'Queries per day'", 12 of 12 attempts (6 mobile, 6 desktop, 25 s apart, 15:48Z to 15:53Z). The project has no PageSpeed key (the only Google keys in `.env.example` are Maps, Places and the Search Console service account, none designated for this), so none was used or printed.
- **Report page read:** pagespeed.web.dev, same Lighthouse 13.5.0. Field data: "No Data" on both form factors. Lab, one run each:

| Form factor | Read (EDT) | Performance | Accessibility | Best practices | SEO | First paint | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|---|
| Mobile (Moto G Power, Slow 4G) | 2026-10-25 11:50:56 | 58 | 96 | 92 | 100 | 7.1 s | 15.2 s | 80 ms | 0 |
| Desktop | 2026-10-25 11:56:46 | 74 | 96 | 92 | 100 | 1.3 s | 3.1 s | 50 ms | 0.128 |

Single lab runs; Lighthouse varies by several points between runs, so treat 58 and 74 as one sample each. The mobile report shows a 0 ms server response and 830 ms of element render delay inside LCP; the 7.1 s first paint with a 0 ms response points at the amount of script and image data, not the server. Not diagnosed further.

## Words-only fixes

- `apps/nickstire/server/services/featureFlags.ts:21`: the `sms_review_requests` description now reads "Auto-send the review request SMS after service (delay from review_settings)". It said "3 days after service" while the delay is `review_settings.delayMinutes`.
- `apps/nickstire/server/services/invoiceReviewRequests.ts:12-15`: the header paragraph now says this lane keeps its own review cooldown and the 7-day post-visit lane keeps a 3-day gap from any shop text (`POST_VISIT_TEXT_GAP_DAYS`). Both edits are comments or a description string; no code line changed.
- Adjacent, left alone (not in this job's files): `apps/nickstire/server/cron/jobs/reviewRequests.ts:3` still says "3 days after service completion", and `apps/nickstire/server/db.ts:2334` documents a 1440-minute default delay. The live `delayMinutes` value was not read.

## NOT CHECKED

- Which pages make up the two families in set A (28.7% of pairs below 0.1), and whether set B's 89 pages deserve a separate similarity read.
- Any judgement of Google's doorway test itself (purpose, funnel, unique value): the score is text overlap only.
- The live homepage on a real phone: this harness has no live API data, no web fonts and no third-party scripts; the review's 24% and 3 s samples were not repeated against production.
- Whether the tile fade is a deliberate animation or a late-mounted section, and which component sets the 1.5 s.
- Whether the admin and blog chunks are really loaded by the public first load on production (only PageSpeed's network list and a build warning point there).
- Field data by any route other than PageSpeed: the CrUX API itself and Search Console's Core Web Vitals report were not read.
- Safari or any non-Chrome engine; Chrome's version was not recorded.
- The full suite, `pnpm run verify` and the nickstire preflight: only `pnpm run check`, eslint on the four touched files and the one spec were run.
