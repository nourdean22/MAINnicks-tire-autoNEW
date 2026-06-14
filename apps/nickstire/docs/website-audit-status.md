# Website Audit — Status (2026-06-10)

What the old site audits flagged vs what is actually fixed. Evidence =
merged commits or live QA this session; "open" = nobody fixed it yet.

## Fixed (verified)

| Item | Evidence |
|---|---|
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
| Used-tire price channel split | phone/SMS/IG/voice + AI price-validator still quote "$60 used" vs site "from $25 installed" (`igAutopost.ts:683` et al). **Owner pricing decision required first.** | decision + small PR |
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
