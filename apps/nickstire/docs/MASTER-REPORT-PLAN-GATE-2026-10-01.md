# Gate: "Website + Admin Master Reconciliation" (2026-10-01)

A pasted, ChatGPT-assembled master report ("Nick's Tire & Auto - Website + Admin Master
Reconciliation, Audit and Direct Execution Blueprint", 43 sections, backlog T01-T22) was
gated against the repo, production and primary sources on 2026-10-01 under `plan-gate`.
The same report may be pasted into later sessions, so this file records what it got right,
what was already built, and what it got wrong. **Read this before re-executing any item
from that report.**

Verdict vocabulary: VERIFIED (defect real) - NATIVE (already built, do not rebuild) -
REFUTED (claim is wrong) - PARTIAL - OPEN (real, not done in this pass) - PARK (deliberately
deferred).

## Summary

Of the 13 rows below that propose building something, 8 already exist in full or in part
(T04, T07-T10, T13, T14, T17). Each specific public-truth defect the report named was real,
and the E-Check and payment-program claims were on many more surfaces than it listed. The
fixes and the regression gate shipped in the PR from branch `claude/kind-johnson-u7hxab`.

A hostile pre-merge review of that PR (three independent reviewers, every finding reproduced
before it was fixed) found the first pass had missed whole classes. Those classes are listed
under "Second pass" below. A second review round found more, several introduced by the first
round's own fixes; see "Third pass". The gate now covers all of them.

## Item verdicts

| ID | Report item | Verdict | Receipt |
|---|---|---|---|
| T01 | ZIP 44110 vs 44112 | VERIFIED, fixed | One passage, `shared/guides.ts` (tire shipping). The ZIP is 44112: Cuyahoga parcel 117-07-027 and the Census geocoder agree, and so does `BUSINESS.address.zip`. |
| T02 | E-Check claims | VERIFIED, fixed. Wider than reported. | There is no 30-day rule in OAC 3745-26 or ORC 4503.10. Nick's is not on Ohio EPA's certified repair facility list (OAC 3745-26-15) and is not an official test site. The claims were live on Home, /diagnostics, /emissions (with a made-up "Ohio BMV" source), the Sunday muffler page, city pages, llms.txt and the GBP post generator. The facts now live in `shared/echeck.ts`, with sources. The third pass found the test scope stale on seven lines: HB 54 (effective 2025-06-30) made the new-vehicle exemption six years (seven for non-plug-in hybrids), diesels are tested, and the tailpipe test ended in January 2020. That is now `OHIO_ECHECK.scope`. |
| T03 | Financing language | VERIFIED, fixed. Wider than reported. | Measured on the committed `prerendered/` tree (grep, 2026-10-01): the footer link "No-Credit-Check Tires" was on 379 of 380 pages, "No credit check auto financing" was in LocalBusiness JSON-LD on 124, and "No credit check required" was in FAQ answers and FAQPage JSON-LD on 30. Also in llms.txt and the website chat prompt. It is false for Koalafi ("we check your credit") and American First Finance ("credit may be checked"). The provider-language layer the report asked for already existed as `shared/financing.ts`; the copy now reads its `PAYMENT_PROGRAMS_*` lines. |
| T04 | Build a Business Facts layer | NATIVE | `shared/business.ts` (SSOT), `server/services/businessFacts.ts` (facts store with source, approver and verified dates, plus a DB override), `shared/financing.ts`, `shared/pricing.ts`. The gap was copy that bypassed them. |
| T05 | Homepage H1 announced twice | REFUTED (accessibility) | Every split-letter span is `aria-hidden="true"` next to one visually hidden full string, so the accessibility tree reads the heading once. The report's text scraper ignored `aria-hidden`. Crawler `textContent` does double the text; that is low impact and was not changed. |
| T06 | Hours conflict | VERIFIED, fixed | `/wheel-alignment-cleveland` (not `/alignment`) said "9am-6pm Mon-Sat". The existing `WEEKDAY_OPEN_AT_9` test could not see that spelling. |
| T07 | Review summary + empty reviews | NATIVE + PARTIAL, fixed | `resolveReviewDisplay` and `useReviewStats` already exist. On 2026-10-01, 3 of the 5 live feed reviews had empty text. /reviews rendered them as blank cards, and the homepage showcase could render `""`. The fallback count stays 1710, a floor: the live count was 1715 on 2026-10-01, and a fallback set to today's exact value overstates the moment a review is removed. |
| T08 | Offers and expiry | VERIFIED, fixed with the operator | OIL2999 ended 2026-09-30, but the /oil-change meta description and FAQ answers and the phone agent's script still told customers to use it. On 2026-10-01 the operator renamed it NICKSOIL through 2026-12-31. The code now lives once, in `shared/pricing.ts` (`OIL_COUPON`), and copy drops it after its last day. `SpecialsPage` hid every hardcoded offer one day early, because `new Date("September 30, 2026")` is midnight at the start of that day; it now runs through the end of the day. `/brakes` still advertised a "Summer Special — up to 30% off" that ended September 30; it now shows real starting prices. |
| T09 | Fact-integrity tests | PARTIAL, extended | `client/src/__tests__/canonical-business-truth.test.ts` already existed. It now also checks every Mon-Sat hours span, ZIPs (including `postalCode`) and the shop's own pad and oil prices. It runs the seven kernel `claim.*` rules (`shared/voice.ts`) over client and shared copy, every non-test server file, `client/index.html` and the source of the three workspace packages nickstire imports. It reads each line on its own and with wrapped lines joined, skipping comments. A second set checks facts no claim rule can express: the used-tire "$25" fine print, Acima's "$10" disclosure, the address city, Ohio's E-Check fees and test scope, the invoice warranty term, new tires priced at the used floor, and JSON-LD property names. The fact checks also read tag attributes (meta content, alt, title). Positive control: with this PR's kernel over unfixed `origin/main` (664c6ffc), the file fails 15 of 133 tests on 625 findings: 241 claim findings, 150 "$25" lines, 103 "$10" lines, 64 address lines, 19 pads-and-rotors prices, 11 E-Check scope statements, 10 oil-coupon lines, 9 oil prices, 4 pad prices, 4 E-Check figures, 3 mileage-warranty lines, 3 new-tire floors, 2 JSON-LD properties, 1 hours span and 1 ZIP. On this branch it passes 133 of 133. |
| T10 | Playwright golden journeys | NATIVE + OPEN | `@playwright/test` 1.63.0 is ADOPTED (`docs/UPSTREAMS.md`). `tests/e2e/` runs post-deploy against the LIVE site (`nickstire-proof.yml`). Journeys that submit forms would write production leads, so they need a non-production target first. |
| T11 | `@axe-core/playwright` | ADOPT-CANDIDATE, now measured | Live scan with axe-core 4.11.4: 10 pages x 2 viewports, WCAG 2.2 AA, serious and critical only. With reduced motion: 71 color-contrast nodes on 16 of 20 page-views, plus 2 link-in-text-block, 2 scrollable-region-focusable (`.photo-rail`) and 2 svg-img-alt. Without reduced motion it reports 213, because framer fade-ins are measured mid-animation. A gate would be red today. Fix the contrast utilities first (`text-foreground/30`-`/40` at 10-12px, `text-nick-blue-light`, white on `bg-red-500`), and run axe with `reducedMotion: "reduce"`. Every scanned page had exactly one H1. |
| T12 | Persistent route shell | VERIFIED, OPEN | The fallback is `PageLoader` (`client/src/App.tsx`), a full-screen loader around the whole `<Switch>`. Navbar and call bar mount per page in `PageLayout`. Browsers get the SPA shell (only bots get prerendered HTML), so a direct landing on a lazy route shows it until the chunk loads. Inferred from code, not measured in a browser. A fix must be route-aware (/admin, /lp/*, /portal, /track) and checked in a real browser. |
| T13 | RUM | PARTIAL | `client/src/lib/cwv.ts` -> `/api/cwv` -> an in-memory ring buffer with p50/p75/p95 (`controlCenter.webVitals`). No persistence, no device dimension and no UI consumer (BUILT + UNWIRED). INP is queued per event over 40 ms, and CLS has no session windows. |
| T14 | Public crawl | PARTIAL, gate fixed | `validate:routes`, `prerender:check`, `prerender:semantic-check` exist. `scripts/validate-route-registry.mjs` had two parser bugs. Its string pattern (`[^"']*`) stopped at the apostrophe in "Nick's", so lengths were measured only up to "Nick". It also skipped every entry with a comment before `path:`. It reported 0 warnings while `origin/main` had 3 titles over 70 chars and 10 descriptions over 165. Both bugs are fixed, with canaries that are red on the old script. It now checks 238 of 238 entries, skips entries inside comments, and fails when it reads fewer SEO entries than are registered. Its warnings are 3 titles and 6 descriptions, each on text identical to main. The fine-print sweep had pushed 8 descriptions over the limit, and those were trimmed back. |
| T15-T16 | Admin usage + workflow compression | OPEN, needs operator | Nothing records section opens. A durable counter needs a table, which means a hand-applied migration and operator approval. |
| T17 | Admin truth/failure states | NATIVE, in flight | The Q-23 wave (phases 3-13, #2826-#2848) is doing exactly this. Do not duplicate it. |
| T18 | Standardize repeated primitives | OPEN | No duplicate pair was measured in this pass. Name the two implementations, with their importers, before starting. |
| T19 | Alignment overlap via GSC | OPEN | The Ahrefs project "Nickstire" (9619097) has no Search Console data connected, so the evidence was not available. |
| T20 | Dead code | 1 deleted | `server/services/financingPreQual.ts` had zero importers (it was on the knip baseline) and made-up approval rates. |
| T21-T22 | Motion and visual polish | PARK | The report itself orders these after the measurable defects (T11 contrast first). |

## Second pass: what the pre-merge review found

Each item was reproduced before it was fixed, and each is now pinned by a test. Three were found later, while verifying the review's fixes: the service-word routing in item 4, the /warranties Offer in item 9, and item 12.

1. **SMS drafts were never claim-checked.** `planViolations` checked only each plan's own prohibited list. A draft saying "no credit check, approved on the spot" passed with `[]`. Now every SMS draft also runs the kernel `claim.*` rules, and a hit holds the draft for operator review.
2. **Social and Meta-ads drafts were never claim-checked.** `validateClaimSafety` (`server/services/contentManufacturing.ts`) had no credit, approval or E-Check terms. It now runs the same rules ("Rule 2a").
3. **The website chat computed monthly payments.** `check_financing` returned "$X/mo" plans. The providers set terms, not the shop, so it now returns a note that each provider shows the schedule and the total cost before signing.
4. **Everyday words.** "Do you have payment options?" and "lease to own" did not reach the financing playbook. The router, the stop-selling guard and the voice demand classifier now know them. "Can I do payments on brakes?" and "can I pay over time for an alignment?" routed to the brake or alignment price ALONE, so the price template answered them with nothing about paying in parts. They now carry financing as well, which holds them for a drafted reply. Settling a bill ("I made a payment", "pay my invoice") still does not count as financing.
5. **Used-tire "$25"** appeared without its fine print on 146 lines. Every line now carries the 12-inch fine print and the $40-80 typical band, usually as "(select 12-inch; most $40-80)". Titles are the exception: a title and its description count as one unit, and a title whose description has no fine print dropped "$25".
6. **"$10"** now always names Acima and carries "in select circumstances" with the canonical disclosure (`ACIMA_COMPACT_DISCLOSURE` in `client/src/lib/acima.ts`).
7. **Address city.** 57 lines and the invoice letterhead said "17625 Euclid Ave, Euclid". The parcel and `BUSINESS.address` say Cleveland.
8. **E-Check.** Stale fee figures ($19.50, $27.50, a $300 waiver) were corrected from `shared/echeck.ts`. A seventh rule, `claim.echeck-certified`, covers "state certified E-Check repair facility" and "certified test station". The LocalBusiness JSON-LD offer and two `PropertyValue`s asserted certification and "no credit check", and were renamed or removed.
9. **JSON-LD prices.** `FocusedServicePage` stripped every non-digit from a tier's display price. The committed `prerendered/warranties/index.html` publishes the tier "12-Mo Parts / 90-Day Labor" as an Offer priced $1290. `client/src/lib/offerPrice.ts` now reads only dollar amounts: a "$A-$B" range becomes a `PriceSpecification`, and a tier with no dollar amount gets no Offer. The same code fused six ranges on the committed `/transmission` and `/exhaust` pages (`shared/services.ts` tiers via `GenericServicePage`): "$1,500–$3,500" is published as an Offer priced 15003500. Those pages refresh on merge.
10. **A DB-published blog post** (`/blog/tire-shop-near-me-open-now`) promised "$0 down financing ... 2-minute approval, no hard credit check". Editing a production row is a protected operation, so the URL now 301s to `/tire-shop-near-me` until the operator corrects the row (`server/_core/redirects.ts`). The sitemap already omits redirected paths.
11. **Timelines.** "Cold Air By Lunch" (the /ac-repair title), "most jobs blow cold by lunch" and "the rumble stops by lunch" were removed.
12. **Route descriptions.** See T14. The fine-print sweep had pushed 8 crawler descriptions over 165 characters. The route validator did not notice, because of its own parser bugs.

## Third pass: the second pre-merge review

A second round of independent review over the whole diff found more defects, several of them introduced by the first round's fixes. Each was reproduced, then fixed with a test that is red on the old code.

1. **A redirect did not withdraw the DB article.** The 301 fires only on a full page load, so `/blog` and `/site-map` still linked the article, the SPA rendered it in-app, and the prerenderer kept it. `getPublishedArticles` and `getDynamicArticleBySlug` now drop any slug `server/_core/redirects.ts` redirects (`redirectedArticleWithdrawn.test.ts`).
2. **The everyday-financing words over-reached.** Bare "payments", "monthly" and "installments" pulled texts about settling a bill into the financing playbook, and "we take cash, cards and Apple Pay as payment options" read as a financing pitch. The router and the planner now need a financing phrasing ("payments on my brakes", "pay it off over time", "split the bill"), and a payment-options list of cash or cards is not a pitch. Five new tests are red on the old code.
3. **Kernel gaps.** "90-second approval", "decision in under a minute", "Snap pre-qualifies you in 60 seconds" and "we don't run a credit check" all passed. A curly apostrophe defeated every contraction in every rule; text is now normalized first. The same fixes removed false positives: "a soft pull to one side" (an alignment symptom), "you have 30 days" about a title transfer, "ASE-certified", and "we'll get you legal" with no E-Check context.
4. **The route validator could still under-read.** See T14.
5. **The gate's own blind spots.** JSX `{" "}` wrapping; a flat-repair "$25", a referral credit or a range top read as the tire floor; a "$25" whose subject is earlier in the sentence ("On used tires ... Nick's starts at $25"); cities written " in Euclid", " (East Cleveland" or "Cleveland/Euclid"; and any fact inside a tag attribute, such as index.html's `twitter:description`. Each now has a canary.
6. **What the sharper gate then found.** Eleven more lines (4 "$25", 1 "$10", 6 address), plus the copy reviewer's list: merged parentheticals ("most $40-80; mount, balance, ..."), "$25 x 4 = $240" (now the typical $60), a Koalafi sentence that read as if reporting payments to TransUnion leaves FICO untouched, "returning customers often qualify for increased spending power", and a readiness check that "tells you if you'll pass".
7. **Found while fixing, and now gated.**
   - The E-Check test scope on seven lines (see T02).
   - The Meta-ads package still wrote "12-month / 12,000-mile warranty" into ad drafts; the invoice has no mileage term.
   - Two pages said "New and used tires from $25".
   - The About page put the shop "in the heart of East Cleveland". The Census geocoder places 17625 Euclid Ave inside Cleveland city, so it now says "Cleveland's East Side".
   - `/monro-mr-tire-alternative-cleveland` had read "OE-specvaries" since the monorepo import. That was an over-eager rename of "quality", which the voice rules ban, and it now reads "service varies".
   - The oil FAQ said "Mention the code when you arrive" unconditionally, so it would have outlived the code. `oilCouponCopy.test.ts` checks the copy on both sides of the last day.
8. **Merged with #2865** (Creative Intelligence OS, on main since this PR opened). It compiles the article and ad facts from the SSOT and had already fixed the ad package's mileage warranty. Its conflicts resolve to main's side. Four of its lines went further than the facts and are adjusted here: an ad sentence ending "$10 down, drive today", a CLI preset saying "— $10 down", a house rule that quoted "guaranteed pass" (the gate reads that as the claim), and an admin Ad Studio angle labelled "$10 down / financing ... drive today".

## Open for the operator (cannot be settled from code)

1. **"$10"**: ANSWERED by the operator, 2026-10-01. Nick's is an Acima $10-start store, and the initial payment can be $0, depending on the approval. The copy keeps "can start at $10 in select circumstances" with Acima's disclosure. "$0" or "free" is not advertised, because "no down payment" is a Regulation M trigger term that requires the full lease disclosure next to it.
2. **Diagnostic fee**: `shared/guides.ts` says $49 waived with repair, the `BlogPost` CTA says "$95 deeper check credited", and `BUSINESS.prices.diagnostic` says "Free with repair".
3. **Pads + rotors floor**: ANSWERED by the operator, 2026-10-01: "starting at $149.99, depending on vehicle", with the condition in fine print at the bottom of the page. `BRAKE_PRICE.padsAndRotorsStarting` holds it. `/brakes` shows it with its fine print, and eleven article lines that quoted Nick's own pads-and-rotors price ($249-$500 ranges, per-model figures, a four-wheel total) now quote it. Pad replacement alone stays $149 (`BRAKE_PRICE.padsStarting`). Five lines still sold an "$89 brake special" that no longer exists; they now say pads from $149.
4. **Inspection point count on oil changes**: 21 vs 27 vs "multi-point". The canonical /oil-change copy says multi-point.
5. **"We'll Uber you back"**: claimed on the Firestone/Conrad's comparison pages and in llms.txt ("ride back to work"). It is in no canonical source.
6. **OIL2999**: ANSWERED by the operator, 2026-10-01 (the owner is the source). It is now NICKSOIL, valid through 2026-12-31 (see T08). The phone agent's script in `server/services/vapi.ts` reads the code too, but the live assistant only changes when `scripts/vapi-update-assistant.ts` pushes the prompt. That is an operator action, and it also pushes every other prompt change made in code since the last push, so run `scripts/vapi-prompt-diff.ts` first.
7. **Testimonials in `shared/proof.ts`** carry names but no source link. They are used only by the admin review-request screen.
8. **Ohio EPA repair-facility certification**: if the shop holds it, add the certificate to `shared/echeck.ts` and the copy can say so.
9. **Timelines.** ANSWERED by the operator, 2026-10-01: leave them. "Same-day" (181 lines) and "under 20 minutes" / "in and out" (10 lines) stay, with the owner as the source.
10. **"Cleveland's largest new & used tire selection"** (`shared/cities.ts`) is a superlative with no source.
11. **New-tire floor**: the /tires price table (`shared/services.ts`) says new tires run $80-$250 each, while `BUSINESS.newTires` and the rest of the site say from $89 installed.

## Copies outside this repository's code (operator actions)

A code merge cannot reach these, and they may still carry the old claims:

1. GBP posts and Q&A answers already published.
2. Live Meta and Google ads.
3. Scheduled posts and drafts already stored in the DB.
4. The live VAPI assistant config (a config push, not this merge).
5. DB `business_facts` rows. `getFact` reads them before the code seed (`server/services/businessFacts.ts`), so an old row outranks a corrected seed.
6. The DB blog row behind `/blog/tire-shop-near-me-open-now`. Once it is corrected, delete the redirect.
7. statenour `apps/statenour/lib/ai/knowledge/brand-constants.ts` tells its model the opposite of this PR. Lines 78 and 158 allow "$0 down financing", and line 147 asserts it. Lines 86 and 146 cite a "36-month warranty on most repairs". Line 147 also lists SNAP and Afterpay as payment types, and neither is among the four programs in `shared/financing.ts`.

## Proposed next gates (not built here)

1. **Scan `prerendered/` in `prerender-refresh.yml`.** Run the claim rules on the regenerated tree before committing it. That is a deploy-config change, so it needs the operator.
2. **Claim-check the remaining model output lanes:** website chat replies, review replies, the comment responder, and the voice post-call guard (`server/services/voiceClaimGuard.ts` keeps its own list, not the kernel rules).
3. **Enforce the "$25" and "$10" fact checks at runtime.** The two matchers live only in `canonical-business-truth.test.ts`, so they cover the code's copy but not generated text. The Ad Studio prompt asks for both (`adCopyGen.ts:82`), but `lintAdCopy` checks neither, so a generated "$10 DOWN." with no disclosure passes it. Moving the matchers into `shared/` would let `lintAdCopy`, `validateClaimSafety` and `planViolations` call them.
