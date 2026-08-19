# Website Audit — Status (2026-08-19)

What the old site audits flagged vs what is actually fixed. Evidence =
merged commits or live QA this session; "open" = nobody fixed it yet.

## Fixed (verified)

| Item | Evidence |
|---|---|
| Registry snippet prices contradicted canon (`/tires` desc "from $60", `/used-tires-cleveland` title $25 vs desc $40 in the SAME snippet) | war-room batch #1709 (2026-08-19) |
| Homepage meta description drift (registry ≠ Home.tsx SEOHead → SERP snippet ≠ social card); unified + Sunday differentiator added, title untouched | #1709 |
| Tire silo orphaned from its own hub — /tires linked NONE of /used-tires-cleveland, /new-tires-cleveland, /tire-prices-cleveland | #1709 (hub→silo links; consolidation decision gated on 28d read ≈ 2026-09-16) |
| Footer linked three 301s (/general-repair, /appointment, /estimate) + "View all 150+ locations" copy on a one-location shop | #1709 |
| 4 zero-inlink orphan pages adopted into footer (/warranties, /check-engine-light-diagnostic, /tire-storage, /hybrid-ev-repair) | #1709 |
| robots.txt disallowed /loyalty + /referral — paths that don't exist (live: /rewards, /refer, both meant to be crawled) | #1709 |
| 7 redirecting URLs prerendered (unservable HTML + permanent false MISSING alarm) → prerender:false, /estimate pattern | #1709 |
| prerender soft-404 recovery crash — esc/escReplace scoped inside if(routeInfo) while the H1-insert block outside calls it; 10 blog routes died + lost files on regen | #1709 (hoisted; 335/337, 0 failures) |
| Review-request scheduler could only text the SHOP (client hardcodes own number on tel: click) + SMS-spam vector (caller-controlled phone on publicProcedure) | #1709 (deleted; prod: review_requests had 1 row EVER) |
| AggregateRating emitted twice with different values for the same @id (ReviewsPage live 1706 vs schema floor 1700) | #1709 (stable floor in all structured data) |
| conversionEvents in-memory ring buffer (500 events lost per deploy, duplicated customer_events insert) | #1709 (deleted; recentEvents reads customer_events) |
| Shadowed client/public/llms.txt (dynamic handler always wins; static copy unreachable) | #1709 |
| 7 review-reply drafts sat invisible since 08-11 | #1709 (drafts-waiting banner in GrowthSection) |
| False "36-month/36,000-mile" warranty → 12mo everywhere | frontface audit wave `66d5fda6` (2026-06-03) |
| False founding "2005"/"20yr" → 2018/1,700+ reviews | same wave |
| Geo-coords reverting bug (patch-prerender) | removed, same wave |
| Tire pricing centralized (used "from $25 installed", new "from $89") | `BUSINESS.usedTires/newTires`, ~45 files swept |
| Family-owned → family-run | `c0e190e0` |
| RoundupTile 404s (4/7 competitor routes) | route-map `15c47e10` |
| Booking lie (fake slot booking) → FCFS drop-off card | wave 181.92 |
| /tires claim safety (reservation language, estimates honesty) | PRs #42/#44/#45 + cockpit copy |
| Checkout copy contradiction ("No charge until we confirm" vs Pay Now) | PR #42/#46 lineage |
| Phone consistency (216) 862-0005 | `BUSINESS.phone` shared constant |

## Open (honest list)

| Item | Detail | Size |
|---|---|---|
| Used-tire price channel split | phone/SMS/IG/voice + AI price-validator still quote "$60 used" vs site "from $25 installed" (`igAutopost.ts:683` et al). Site-side copy is now fully canon (#1709); the remaining split is the PHONE/SMS/IG channel. **Owner pricing decision required first.** | decision + small PR |
| Off-site entity fracture (operator queue) | Five colliding identities at/around 17625 Euclid: Birdeye "Moe's" profile w/ **1,763 reviews UNCLAIMED** (excluded from the ranked list AI engines cite), live legacy Google Sites microsite listed as the official website by BBB/Birdeye/AutoTechIQ, BBB phone WRONG (682-0005), Monro ghost owns the address on Yelp, Facebook display name still Moe's. **Entity Continuity File + canonical GBP identity FIRST (Moe's→Nick's = major name change per Google policy), then claim/correct.** War-room artifact §16 has the sequence. | operator, zero code |
| GBP access chain | API project quota=0 (access form) + token granted by nourdean22 which manages zero businesses (re-Connect as moeseuclid@gmail.com). Blocks gbp.performance, the map-pack scoreboard, and review ingest verification. | operator |
| Tire-silo consolidation | GATED: read the hub→silo link test ≈ 2026-09-16 (decision rule in war-room artifact §11). Do not 301 anything before that read. | decision + M PR |
| Sitewide title unification (PR-3) | prerender overwrites desc/og unconditionally from registry but <title> only on a default-list match — /tires, /brakes, /financing SEOHead titles still diverge from registry og:title. Needs its own protected-core PR + validator rule. | M PR |
| llms.txt canon derivation | dynamic handler verified canon-correct 2026-08-19 but hardcoded (drift risk); derive from BUSINESS + routes. llms-full.txt is static + hand-maintained. | S-M PR |
| /tires search size duplication | input self-concatenates → cache miss → silent catalog fallback (live QA 2026-06-10). In `TireFinder.tsx` — owned by open PR #43's author; do not collide | small fix in #43's domain |
| /emissions meta description 168 > 165 chars | route validator advisory warn | one line |
| Off-palette hardcoded hex | DiagnosePage, SharePage, TrackJob, WomensSafety | hygiene PR |
| Chrome pages without PageLayout | TrackJob, Booking, CustomerPortal, Landing — possibly intentional | owner call |
| Google Reviews API / Place ID reliability | code exists (`server/google-reviews.ts`); prod failure rate unverified — check Railway logs for `[GoogleReviews] Failed to fetch` | verify then fix |
| Prerendered HTML staleness | regenerates weekly via CI; live hydration is correct meanwhile | known tradeoff |
| Popup aggressiveness | 3 friction popups already removed (181.92); current popup state acceptable per CRO audit — re-audit only if bounce data says so | watch |

## Rule for fixes

Copy/CTA/link/meta fixes ship freely in small PRs. Anything touching
payment flow, schema, or large visuals gets its own scoped PR.
