# Next-Wave Page Plan — Blue-Ocean Expansion (2026-05-30)

> Produced under `/brainstorming` rigor: validated design, explicit assumptions, a hard gate on capability questions, and a decision log — grounded in the actual codebase, not generic SEO. **This is a plan, not an implementation.** Nothing here ships until the capability gate (below) is cleared and the prerender pipeline is confirmed working.

---

## 1. Understanding Summary

- **What:** a set of NEW customer-facing pages that capture commercial-intent local search nickstire doesn't currently rank for, chosen because a real Cleveland competitor monetizes them and the local SERP is weak/empty.
- **Why:** on-page is mature; net-new *blue-ocean* pages (low local competition + real buyer intent) are the cheapest remaining on-site growth for a <60-day domain that can't yet win competitive head terms.
- **Who:** Cleveland/Euclid/East-side drivers + (for two pages) local *businesses* (fleet) — the highest-LTV segment.
- **Key constraints:** (a) **brand voice** — banned words: "premium", "tier", "inspection" (say "check"); Caregiver+Everyman, first-person, concrete proof, "you don't pay until you say yes"; (b) **schema lives in shared components** — new service pages should use `FocusedServicePage` (auto-emits FAQPage/Service/Breadcrumb/LocalBusiness/OfferCatalog + the AEO answer-block + 4 internal-link blocks); (c) **prerender constraint** — every new page needs `prerender: true` in `shared/routes.ts` + a working regen to reach bots (pipeline fix in progress); (d) **don't claim capabilities the shop lacks** (see §2).
- **Non-goals:** NOT rebuilding existing pages here (those are separate upgrades, §5); NOT chasing competitive national head terms; NOT programmatic city×service explosion (thin-content risk — the 154 `/near/*` pages were already deleted for that reason).

## 2. ⛔ CAPABILITY GATE — confirm BEFORE building (hard stop)

Brand integrity rule: **we never publish a page for a service the shop doesn't actually perform.** Each page below is tagged with its gate. Operator must confirm:

| # | Question | Gates which page |
|---|---|---|
| G1 | Does the shop have **physical space to store** customers' off-season tire sets? | Tire Storage (#1) |
| G2 | Does the shop **sell + install custom wheels/rims** (wheel+tire packages), or only standard tires? | Custom Wheels (#4) |
| G3 | Does the shop **service hybrids/EVs** — and to what depth (basic: brakes/tires/12V/maintenance, vs. HV-battery work)? | Hybrid/EV (#5) |
| G4 | Does the shop **participate in manufacturer rebate programs** (Michelin/Goodyear/Bridgestone/Cooper)? | Tire Rebates (#2) |

**Pages with NO capability gate (safe to build on confirm of plan):** Warranties hub (#3), Tire Cost money-page (#6).

## 3. Implementation pattern (how each page gets built — reused for all)

Each new service page is **~1 small config object**, not a bespoke build:
1. `client/src/pages/<Name>.tsx` → `export default () => <FocusedServicePage config={CONFIG} />` with a `ServicePageConfig` (canonicalPath, title, description, eyebrow, h1, sub, **aeoAnswer**, startingPrice, pricingTitle/Sub, **tiers[]**, included[], **faqs[]**, bookingService, serviceType, optional anchorTable/fearStats/lossStats/crossSell/photoRibbon).
2. Register in `shared/routes.ts`: `{ path, priority, changefreq, title, description, group:"service", sitemap:true, prerender:true }`.
3. Mount the route in `App.tsx`.
4. Next prerender regen captures it (FAQPage + Service + Breadcrumb + LocalBusiness + OfferCatalog schema + the AEO answer-block + InternalLinks/RelatedServices/Cities/crossSell all emit automatically).

→ **Cost per page ≈ writing one config + 2 one-line registrations.** Schema/AEO/internal-linking are free via the template.

---

## 4. THE PAGES — full specs, ranked by leverage ÷ effort

### #1 · Tire Storage / "Tire Hotel" — `/tire-storage` 🟦 BLUE-OCEAN · gate G1
- **Leverage: HIGH · Effort: S–M · Rank: 1** (recurring revenue + zero local competition + extreme seasonal fit)
- **H1:** `Off-Season Tire Storage in Euclid — Drop Your Winter (or Summer) Set, We Keep It Safe`
- **Meta title:** `Tire Storage in Cleveland & Euclid — Off-Season Tire Hotel | Nick's` · **Desc:** `Swapping to winter or summer tires? Store the off-season set with us — climate-kept, tagged, ready for your next changeover. Walk in 7 days. (216) 862-0005`
- **Intent/keywords:** "tire storage near me", "winter tire storage cleveland", "where to store winter tires", "tire changeover cleveland", "tire hotel".
- **Why:** Discount Tire ("Tire Hotel"), Les Schwab, local Weber Automotive all monetize this (~$125/season benchmark). **No Euclid/Cleveland tire-shop competitor owns a page** (Conrad's, Best Buy, Moe's = none). Lake-effect winter = Nov→Apr demand; customer returns **twice/year** (retention + a built-in changeover/alignment upsell).
- **serviceType:** `Seasonal Tire Storage` · **bookingService:** `tire-storage`
- **aeoAnswer (≈45 words):** "Nick's Tire & Auto stores your off-season tires at 17625 Euclid Ave in Cleveland/Euclid, OH — we tag your set, keep it safe between seasons, and remount it at your next changeover. Walk in 7 days a week; storage starts around $X/season. Call (216) 862-0005."
- **tiers[]:** Single-season storage · Storage + changeover package (mount/balance/swap) · Storage + changeover + alignment-check (the retention bundle). *Operator sets real prices.*
- **faqs (AEO/snippet fuel):** "How does off-season tire storage work?" · "How much does tire storage cost in Cleveland?" · "When should I switch to winter tires in Ohio?" · "Do you remount and balance when I pick them up?" · "How long can you store my tires?"
- **Internal links:** ↔ `/tires`, `/new-tires-cleveland`, `/alignment`, winter blog cluster (`best-tires-for-cleveland-winter`, `first-snow-tire-guide-cleveland`, `all-season-vs-winter-tires-cleveland`).
- **Seasonality:** set `changefreq:"weekly"` Oct–Dec; feature on homepage seasonal slot in fall.

### #2 · Tire Rebates / Current Deals — `/tire-rebates` · gate G4
- **Leverage: HIGH · Effort: S · Rank: 2** (bottom-funnel buy intent, evergreen template)
- **H1:** `Tire Rebates & Manufacturer Deals in Cleveland — Current Savings, No Games`
- **Meta title:** `Tire Rebates Cleveland — Michelin, Goodyear, Bridgestone Deals | Nick's` · **Desc:** `Current tire rebates and manufacturer deals at Nick's on Euclid Ave. We tell you the real out-the-door price — rebate or not. Walk in 7 days. (216) 862-0005`
- **Intent/keywords:** "tire rebates", "michelin rebate 2026", "tire deals cleveland", "goodyear rebate", "[brand] tire sale near me".
- **Why:** Best Buy Tire has a dynamic `/rebates` template; Conrad's runs `/specials`. Highest commercial intent in the category — searcher is ready to buy, hunting savings. **Evergreen page refreshed when brands run quarterly campaigns.** nickstire already has Michelin/Goodyear/Bridgestone/Continental brand pages → internal-link them here.
- **serviceType:** `Tire Sales & Rebates` · **bookingService:** `tires`
- **aeoAnswer:** "Nick's Tire & Auto honors current manufacturer tire rebates (Michelin, Goodyear, Bridgestone, Cooper) at 17625 Euclid Ave, Cleveland/Euclid, OH — and we quote your real out-the-door price, rebate or not. New tires from $60 installed, used from $40. Walk in 7 days. (216) 862-0005."
- **Content:** a maintainable rebate table (brand · offer · expires · how to claim) the operator updates quarterly; "how rebates work" explainer; honest "even without a rebate, here's our price" angle (the trust differentiator vs chains that hide pricing).
- **faqs:** "How do tire rebates work?" · "Which brands have rebates right now?" · "Do I get the rebate instantly or mail-in?" · "Can I combine a rebate with financing?"
- **Internal links:** → all 4 brand-tire pages, `/tires`, `/financing`.
- **⚠ Cannibalization guard:** keep this rebate-/deal-intent only; don't let it compete with `/tires` for "buy tires cleveland".

### #3 · Warranties Hub — `/warranties` · NO gate
- **Leverage: MED-HIGH · Effort: S · Rank: 3** (pure trust/conversion; critical for a low-authority young domain; data already exists)
- **H1:** `Our Warranties — 12-Month Parts & Labor, Road Hazard & a Promise in Writing`
- **Meta title:** `Warranties — 12-Month Parts & Labor, Road Hazard | Nick's Tire & Auto` · **Desc:** `Every repair backed by our 12-month / 12,000-mile parts-and-labor warranty, printed on your invoice. Road-hazard coverage on tires. Cleveland's Euclid Ave shop.`
- **Intent/keywords:** "nick's tire warranty", "tire road hazard warranty cleveland", "auto repair warranty euclid", trust/brand queries + a conversion asset linked sitewide.
- **Why:** Conrad's makes "Nationwide Warranty" a top-nav trust asset; Best Buy has `/terms/warranty`. nickstire has **no consolidated warranty page** — yet warranty is a top purchase objection for a new shop. Cheap, high-trust, removes hesitation. Data already in `BUSINESS` (12mo/12k).
- **serviceType:** `Warranty & Guarantees` · **bookingService:** `general-repair`
- **aeoAnswer:** "Nick's Tire & Auto backs every repair with a 12-month / 12,000-mile parts-and-labor warranty, printed on your invoice — plus road-hazard coverage on tires. We show you the worn part before we replace it, and you don't pay until you say yes. 17625 Euclid Ave, Cleveland/Euclid. (216) 862-0005."
- **Content:** parts/labor warranty terms · tire road-hazard terms · the "real warranty, not a sticker" angle · how to claim. **No `tiers[]`** (use a plain content layout or a minimal config).
- **faqs:** "What does your warranty cover?" · "Is the road-hazard warranty extra?" · "How do I claim a warranty repair?" · "Do you warranty used tires?"
- **Internal links:** linked from EVERY service page footer area + homepage trust bar.

### #4 · Custom Wheels & Rims — `/wheels` 🟦 thin local field · gate G2
- **Leverage: MED-HIGH · Effort: M · Rank: 4** (higher ticket/margin; one real local player = Best Buy)
- **H1:** `Custom Wheels & Rims in Cleveland — Wheel + Tire Packages, Mounted Right`
- **Meta title:** `Custom Wheels & Rims Cleveland — Wheel + Tire Packages | Nick's` · **Desc:** `Upgrade your look: custom wheels and wheel+tire packages installed on Euclid Ave. Financing available — $10 down, no credit check. Walk in 7 days. (216) 862-0005`
- **Intent/keywords:** "custom wheels cleveland", "rims and tires package", "wheel financing near me", "[size] rims euclid".
- **Why:** Best Buy Tire owns this locally (20+ brand configurator + financing); Conrad's/Mavis don't push it. Higher ticket than tires; the local SERP has ~one real player. nickstire's 4 brand-tire pages + existing `/financing` make wheel+tire packages a natural cross-sell.
- **serviceType:** `Custom Wheels & Rims` · **bookingService:** `tires`
- **aeoAnswer:** "Nick's Tire & Auto installs custom wheels and wheel-plus-tire packages at 17625 Euclid Ave in Cleveland/Euclid, OH — mounted, balanced, and TPMS-set. Financing is $10 down, no credit check, approved in ~90 seconds. Walk in 7 days. (216) 862-0005."
- **tiers[]:** Wheels only (install) · Wheel + tire package · Package + financing. *Real prices/brands per operator.*
- **YAGNI:** ship a content+packages page v1; the brand *configurator/visualizer* is a later phase — do NOT gold-plate v1.
- **faqs:** "Can I finance wheels and tires?" · "Will custom wheels affect my TPMS?" · "Do you do staggered setups?" · "Can I bring my own wheels to mount?"
- **Internal links:** → 4 brand-tire pages, `/tires`, `/financing`, `/alignment` (new wheels → alignment upsell).

### #5 · Hybrid & EV Service — `/hybrid-ev-repair` 🟦 BLUE-OCEAN · gate G3
- **Leverage: MED · Effort: S · Rank: 5** (future-proof, first-mover keyword, lower current volume)
- **H1:** `Hybrid & EV Service in Cleveland — Brakes, Tires & Maintenance Done Right`
- **Meta title:** `Hybrid & EV Service Cleveland — Brakes, Tires, Maintenance | Nick's` · **Desc:** `Drive a hybrid or EV? We handle brakes, tires, fluids, and maintenance for Cleveland's electric and hybrid drivers on Euclid Ave. Walk in 7 days. (216) 862-0005`
- **Intent/keywords:** "EV service near me", "hybrid mechanic cleveland", "EV tire shop", "hybrid brake service euclid".
- **Why:** **None of the three core competitors surface a dedicated EV/hybrid page.** Growing search; EV/hybrid owners search specifically for shops that *name* the capability. First-mover on the keyword.
- **⚠ Scope to real capability (G3):** if the shop does basic hybrid/EV work (brakes — incl. regen-brake wear, tires, 12V battery, fluids, alignment) but NOT HV-battery service, the page must **say exactly that** ("what we do / what needs a dealer"). Honesty = the differentiator + avoids false claims.
- **serviceType:** `Hybrid & EV Service` · **bookingService:** `general-repair`
- **aeoAnswer:** "Nick's Tire & Auto services hybrids and EVs at 17625 Euclid Ave, Cleveland/Euclid, OH — brakes (including regen-brake wear), tires, alignment, 12V batteries, and routine maintenance. We're upfront about what's in our lane and what needs a dealer. Walk in 7 days. (216) 862-0005."
- **faqs:** "Do you work on EVs and hybrids?" · "Can a regular shop service my hybrid's brakes?" · "Do EVs need alignments and tire rotations?" (yes — heavy + instant torque) · "What hybrid/EV work needs a dealer?"
- **Internal links:** → `/brakes`, `/tires`, `/alignment`, `/battery`.

### #6 · Tire-Cost Money Page (geo) — `/tire-cost-cleveland` · NO gate · ⚠ cannibalization check
- **Leverage: MED-HIGH · Effort: S · Rank: 6** (high-converting "[product] cost + city" intent; leverages the existing estimator)
- **H1:** `How Much Do New Tires Cost in Cleveland? (2026 Price Guide)`
- **Why:** Best Buy/Conrad's **hide pricing** ("Get a Quote" only) — that's the gap. A transparent price-range page wins the click AND trust; embed the existing estimator tool for a content+tool combo competitors can't match.
- **aeoAnswer:** "New tires in Cleveland cost roughly $60–$200+ per tire installed at Nick's Tire & Auto, depending on size and brand — used tires start at $40 installed, and install (mount, balance, valve stems, TPMS) is free. Get your exact size quoted live. 17625 Euclid Ave. (216) 862-0005."
- **⚠ HARD CHECK FIRST:** the 120-blog set has tire/brake cost guides (e.g. `brake-repair-cost-cleveland-2026`, `how-much-brake-repair-cost-cleveland`). **Confirm no existing post is already the canonical "tire cost cleveland" page.** If one exists → **upgrade it into the money-page** (don't create a competing URL — keyword cannibalization caps both). If none → build this.
- **Internal links:** → `/tires`, `/used-tires-cleveland`, `/estimate` (estimator), `/financing`.

---

## 5. UPGRADES (existing pages — NOT new builds)

The competitor agent surfaced these as "gaps" but they already exist; treat as enhancements:
- **Fleet page (exists, `Fleet.tsx`)** — add: which **fleet cards** you accept (WEX/Voyager/Fuelman/national accounts), a fleet-account inquiry form, "[N]-vehicle and up" framing. Conrad's/Best Buy/Rad Air all rank for B2B; this is the **highest-LTV** segment — worth a real upgrade.
- **`/used-tires-cleveland` (exists)** — strengthen the blue-ocean angle: the 4-point used-tire check, a safety/warranty FAQ, "from $40 installed" anchor. SERP is weak (only thin listings) → a real page with schema can outrank incumbents.
- **`/pre-purchase-inspection` (exists)** — only mobile-mechanics rank locally; lean into "a shop with a lift + diagnostics beats a mobile guy" + flat fee + the checklist.

## 6. ON-PAGE TACTICS (apply to existing AND new service pages)

1. **"Cities We Serve" block** — `FocusedServicePage` already emits one (8-city block). Confirm the **custom** money pages (`ServicesOverview`, `TireFinder`) also carry it; if not, add (strengthens internal linking + local relevance — the Best Buy "fuse geo into service pages" tactic).
2. **Inline estimator/quote CTA** — surface the existing estimator **within service-page body copy**, not just nav. (Best Buy repeats quote CTAs mid-flow.)
3. **"Text-me-my-report" digital vehicle check** — Conrad's headline trust asset is "digital report sent to your phone." nickstire has SMS infra + a `TextMeQuote` component — brand it as a named DVI trust signal on service pages + homepage. Concrete differentiator over the price-hiding chains.
4. **Cited statistic per page** (Princeton GEO +37% AI-citation lever) — one dated, sourced stat per service page (NHTSA/AAA/Tire Rack). Many `FocusedServicePage` configs have `fearStats` already — extend the pattern.

## 7. Leverage ranking (final)

| Rank | Page | Leverage | Effort | Gate | Blue-ocean |
|---|---|---|---|---|---|
| 1 | Tire Storage `/tire-storage` | HIGH | S–M | G1 | 🟦 |
| 2 | Tire Rebates `/tire-rebates` | HIGH | S | G4 | — |
| 3 | Warranties `/warranties` | MED-HIGH | S | none | — |
| 4 | Custom Wheels `/wheels` | MED-HIGH | M | G2 | 🟦(thin) |
| 5 | Hybrid/EV `/hybrid-ev-repair` | MED | S | G3 | 🟦 |
| 6 | Tire-Cost `/tire-cost-cleveland` | MED-HIGH | S | none | — |
| — | Fleet / Used-Tires / PPI (UPGRADES) | MED | S | none | — |

**Ship order if all gates clear:** ③ Warranties + ② Tire Rebates first (S-effort, no/low gate, immediate trust+intent), then ① Tire Storage (seasonal — land before fall), then ⑥ Tire-Cost (after cannibalization check), then ④ Wheels + ⑤ Hybrid/EV.

## 8. Decision Log

- **Use `FocusedServicePage`, not bespoke pages** — alts: custom React per page (rejected: re-implements schema/AEO/linking, brand-drift risk) · generic ServicePage (rejected: 1,173-line heavy template). Chosen for free schema/AEO/internal-linking + 1-config cost.
- **Cross-checked every idea vs live routes** — alt: take the competitor agent's list at face value (rejected: it false-flagged /used-tires, /pre-purchase-inspection, Fleet as gaps → would've built duplicates + cannibalization).
- **Capability gate before build** — alt: build all + assume capability (rejected: brand-integrity + false-claims risk; we never publish a service the shop doesn't do).
- **Blue-ocean over competitive head terms** — alt: chase "tire shop cleveland" harder (rejected: domain too young to win competitive heads; low-competition intent pages rank faster).
- **No programmatic city×service explosion** — alt: generate every service×suburb (rejected: thin-content/doorway risk; 154 `/near/*` pages already deleted for this).
- **Tire-Cost = upgrade-or-build, not auto-build** — alt: just create it (rejected: cannibalization with existing cost blogs).

## 9. Open Questions (must resolve before implementation)
1. Capability gates **G1–G4** (§2).
2. **Real prices** for Tire Storage tiers + wheel packages (operator-set).
3. **Tire-Cost cannibalization** check (§4 #6).
4. **Prerender pipeline** must be working (in progress) so new pages reach bots — otherwise they'd ship as shells like the current money pages.

**Status:** plan validated and documented. Implementation gated on the capability answers + a working prerender pipeline. On the operator's confirm, each page is ~1 config + 2 registrations away.
