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

## Item verdicts

| ID | Report item | Verdict | Receipt |
|---|---|---|---|
| T01 | ZIP 44110 vs 44112 | VERIFIED, fixed | One passage, `shared/guides.ts` (tire shipping). The ZIP is 44112: Cuyahoga parcel 117-07-027 and the Census geocoder agree, and so does `BUSINESS.address.zip`. |
| T02 | E-Check claims | VERIFIED, fixed. Wider than reported. | There is no 30-day rule in OAC 3745-26 or ORC 4503.10. Nick's is not on Ohio EPA's certified repair facility list (OAC 3745-26-15) and is not an official test site. The claims were live on Home, /diagnostics, /emissions (with a made-up "Ohio BMV" source), the Sunday muffler page, city pages, llms.txt and the GBP post generator. The facts now live in `shared/echeck.ts`, with sources. |
| T03 | Financing language | VERIFIED, fixed. Wider than reported. | Measured on the committed `prerendered/` tree (grep, 2026-10-01): the footer link "No-Credit-Check Tires" was on 379 of 380 pages, "No credit check auto financing" was in LocalBusiness JSON-LD on 124, and "No credit check required" was in FAQ answers and FAQPage JSON-LD on 30. Also in llms.txt and the website chat prompt. It is false for Koalafi ("we check your credit") and American First Finance ("credit may be checked"). The provider-language layer the report asked for already existed as `shared/financing.ts`; the copy now reads its `PAYMENT_PROGRAMS_*` lines. |
| T04 | Build a Business Facts layer | NATIVE | `shared/business.ts` (SSOT), `server/services/businessFacts.ts` (facts store with source, approver and verified dates, plus a DB override), `shared/financing.ts`, `shared/pricing.ts`. The gap was copy that bypassed them. |
| T05 | Homepage H1 announced twice | REFUTED (accessibility) | Every split-letter span is `aria-hidden="true"` next to one visually hidden full string, so the accessibility tree reads the heading once. The report's text scraper ignored `aria-hidden`. Crawler `textContent` does double the text; that is low impact and was not changed. |
| T06 | Hours conflict | VERIFIED, fixed | `/wheel-alignment-cleveland` (not `/alignment`) said "9am-6pm Mon-Sat". The existing `WEEKDAY_OPEN_AT_9` test could not see that spelling. |
| T07 | Review summary + empty reviews | NATIVE + PARTIAL, fixed | `resolveReviewDisplay` and `useReviewStats` already exist. On 2026-10-01, 3 of the 5 live feed reviews had empty text. /reviews rendered them as blank cards, and the homepage showcase could render `""`. The fallback count went 1710 -> 1715 to match live data. |
| T08 | Offers and expiry | PARTIAL, OPEN for the operator | `SpecialsPage` already hides expired offers at runtime. The OIL2999 card expired 2026-09-30, but the /oil-change meta description and FAQ answers (`shared/routes.ts`, `shared/services.ts`) and the phone agent's script (`server/services/vapi.ts`) still tell customers to use the code, while `BUSINESS` treats $49 as the regular price. |
| T09 | Fact-integrity tests | PARTIAL, extended | `client/src/__tests__/canonical-business-truth.test.ts` already existed. It now also checks every Mon-Sat hours span, ZIPs (including `postalCode`), the shop's own pad and oil prices, and the kernel `claim.*` rules (`shared/voice.ts`) over client, shared and server customer copy, line by line and with wrapped lines joined. On unfixed main it fails with 180 claim findings plus the hours, ZIP and price drift. |
| T10 | Playwright golden journeys | NATIVE + OPEN | `@playwright/test` 1.63.0 is ADOPTED (`docs/UPSTREAMS.md`). `tests/e2e/` runs post-deploy against the LIVE site (`nickstire-proof.yml`). Journeys that submit forms would write production leads, so they need a non-production target first. |
| T11 | `@axe-core/playwright` | ADOPT-CANDIDATE, now measured | Live scan with axe-core 4.11.4: 10 pages x 2 viewports, WCAG 2.2 AA, serious and critical only. With reduced motion: 71 color-contrast nodes on 16 of 20 page-views, plus 2 link-in-text-block, 2 scrollable-region-focusable (`.photo-rail`) and 2 svg-img-alt. Without reduced motion it reports 213, because framer fade-ins are measured mid-animation. A gate would be red today. Fix the contrast utilities first (`text-foreground/30`-`/40` at 10-12px, `text-nick-blue-light`, white on `bg-red-500`), and run axe with `reducedMotion: "reduce"`. Every scanned page had exactly one H1. |
| T12 | Persistent route shell | VERIFIED, OPEN | The fallback is `PageLoader` (`client/src/App.tsx`), a full-screen loader around the whole `<Switch>`. Navbar and call bar mount per page in `PageLayout`. Browsers get the SPA shell (only bots get prerendered HTML), so a direct landing on a lazy route shows it until the chunk loads. Inferred from code, not measured in a browser. A fix must be route-aware (/admin, /lp/*, /portal, /track) and checked in a real browser. |
| T13 | RUM | PARTIAL | `client/src/lib/cwv.ts` -> `/api/cwv` -> an in-memory ring buffer with p50/p75/p95 (`controlCenter.webVitals`). No persistence, no device dimension and no UI consumer (BUILT + UNWIRED). INP is queued per event over 40 ms, and CLS has no session windows. |
| T14 | Public crawl | PARTIAL | `validate:routes`, `prerender:check`, `prerender:semantic-check` exist. In `scripts/validate-route-registry.mjs` the title and description patterns (`[^"']*`) stop at the apostrophe in "Nick's", so a title containing it is length-checked only up to "Nick". |
| T15-T16 | Admin usage + workflow compression | OPEN, needs operator | Nothing records section opens. A durable counter needs a table, which means a hand-applied migration and operator approval. |
| T17 | Admin truth/failure states | NATIVE, in flight | The Q-23 wave (phases 3-13, #2826-#2848) is doing exactly this. Do not duplicate it. |
| T18 | Standardize repeated primitives | OPEN | No duplicate pair was measured in this pass. Name the two implementations, with their importers, before starting. |
| T19 | Alignment overlap via GSC | OPEN | The Ahrefs project "Nickstire" (9619097) has no Search Console data connected, so the evidence was not available. |
| T20 | Dead code | 1 deleted | `server/services/financingPreQual.ts` had zero importers (it was on the knip baseline) and made-up approval rates. |
| T21-T22 | Motion and visual polish | PARK | The report itself orders these after the measurable defects (T11 contrast first). |

## Open for the operator (cannot be settled from code)

1. **"$10 down"**: it still appears on many surfaces. Acima says its $10 start is "in select stores only", and `client/src/lib/acima.ts` requires the Reg M disclosure next to every "$10". Is Nick's a $10 store, and should the hook stay?
2. **Diagnostic fee**: `shared/guides.ts` says $49 waived with repair, the `BlogPost` CTA says "$95 deeper check credited", and `BUSINESS.prices.diagnostic` says "Free with repair".
3. **Pads + rotors floor**: $250 (guides) vs $279 (llms.txt), with no canonical value.
4. **Inspection point count on oil changes**: 21 vs 27 vs "multi-point". The canonical /oil-change copy says multi-point.
5. **"We'll Uber you back"**: claimed on the Firestone/Conrad's comparison pages and in llms.txt ("ride back to work"). It is in no canonical source.
6. **OIL2999**: extend the coupon, or remove the code from /oil-change copy and the phone agent's script (T08). `server/services/vapi.ts` is a protected surface, so that edit needs its own approval.
7. **Testimonials in `shared/proof.ts`** carry names but no source link. They are used only by the admin review-request screen.
8. **Ohio EPA repair-facility certification**: if the shop holds it, add the certificate to `shared/echeck.ts` and the copy can say so.
