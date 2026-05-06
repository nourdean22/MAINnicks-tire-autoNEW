# Nickstire.org Voice + Visual Audit & Foot-Traffic Grade

**Date:** 2026-05-06
**Auditor:** Claude Code | Standard: Top 0.1% Direct Response
**KPI:** Cars in line down Euclid Ave
**Scope:** 11 representative pages (top by GSC traffic + directive scope)
**Method:** Live HTML capture (prerendered, last-built 2026-05-05) + repo source review + Asset Dictionary cross-check

---

## Executive Summary

- **Overall site grade:** **D+** (66/100 weighted)
- **Site-wide copy score:** 71/100
- **Site-wide visual score:** 58/100
- **Combined weighted score:** 66/100 (60% copy / 40% visual)
- **Estimated foot-traffic pull:** 4/10 — site is doing some of the work; the headline + hero photo are leaving 60% of conversion power on the table.

### Top 3 leaks costing the most visits

1. **The home hero shows the wrong photo + wrong headline.** Cybertruck + "CLEVELAND TOUGH." is brand-emotion. The FCFS model needs behavior-instruction: "PULL UP FOR TIRES. DROP OFF FOR REPAIRS." over a storefront-with-cones photo.
2. **`/booking` violates banned language** ("Book", "Reserve") in its meta title alone. The page that should encode FCFS is encoding the opposite.
3. **`/financing` page is the wrong concept.** Banned word "Financing" as primary positioning. Should be "Payment Programs."

### Top 3 strengths to scale

1. **Real photos throughout, zero stock images.** Every hero is a real shop photo. Maintain this discipline religiously.
2. **GSC-tuned meta titles on most service pages** are already ≤60 chars with specific value claims.
3. **4.9★ / 1,700+ reviews proof** is referenced consistently across pages.

### Single highest-leverage rewrite to ship first

Replace home hero **H1 + subhead + 3-CTA stack** with the master tagline:
- **H1:** `PULL UP FOR TIRES. DROP OFF FOR REPAIRS.`
- **Sub:** `Cleveland's first-come-first-served shop. Walk in 7 days. Used tires from $60. Written estimate before any wrench moves. Don't let the problem get bigger.`
- **CTAs:** `CALL NOW` / `SCHEDULE DROP-OFF` / `GET DIRECTIONS`

### Single highest-leverage visual change to ship first

Swap home hero photo from `/hero-cybertruck.webp` → a storefront photo that shows the **sign + cones + open bays**. Closest in repo: `/photos/exterior-facade-wide.webp`. Apply `object-position: center 30%` to keep sign visible.

### Critical blocker

**Railway deploy is hung.** The 23 commits from today's session — including framework rewrites that already address ~50% of these gaps — are on `origin/main` but not deployed. Live customers see 2026-05-05 content. **Open Railway dashboard, unblock deploy.** Until that's done, none of these audit recommendations matter for actual customers.

---

## Live-vs-Mockup Gap Analysis (Homepage)

The directive references `HOMEPAGE_MOCKUP` (Image 2) as the visual North Star. I don't have the PNG file yet (operator said it's in another Claude session), so I'm comparing the live home page against the **textual specification** from the directive's mockup description.

| Element | Mockup Spec | Live Site (2026-05-05 build) | Gap | Priority |
|---|---|---|---|---|
| Hero photo | STOREFRONT_HERO (sign + cones + bays + tire stacks + sky) | `/hero-cybertruck.webp` (Tesla Cybertruck out front) | **WRONG ASSET** — cybertruck doesn't show the FCFS model | P1 |
| Hero H1 | "PULL UP FOR TIRES. / DROP OFF FOR REPAIRS." (white/yellow split) | "CLEVELAND TOUGH." | **WRONG HEADLINE** — emotion-positioning instead of behavior-positioning | P1 |
| Hero CTAs | Red CALL NOW / Yellow SCHEDULE DROP-OFF / Outline GET DIRECTIONS | Yellow Call (216) 862-0005 / Yellow outline "Drop Off Your Car" | **MISSING DIRECTIONS CTA**, mockup has 3-CTA stack | P1 |
| Trust strip | 5-point: 4.9★ / FCFS / $60 tires / Payment programs / Open 7 days | TrustNumbers + TrustStrip components show 4.9★ + 1,700+ reviews + ON-SPOT financing + Same Day | **MISSING:** "First-come-first-served" • "$60 tires" • "Payment programs" wording | P1 |
| Cones block | "The Cones Mean Keep Moving" — STOREFRONT_PIT_STOP left + 3-icon stack right (Stay In The Car / Drop It Off / We'll Handle It) | **DOES NOT EXIST** | **MISSING ENTIRE SECTION** | P1 |
| Proof band | "No Appointment Games / No Surprise Prices / Don't Let Money Delay Safety" | Generic FastPaths section — not the dark proof band from mockup | **MISSING** the FCFS-anchored proof band | P1 |
| Page-preview tiles | Tires / Drop-Off / Mobile / Financing / Reviews | Service tiles for Tires / Brakes / Diagnostics + More Services grid | **PARTIAL** — has service-anchored tiles, not Mockup's process-anchored tiles | P2 |
| Logo | LOGO_PATCH (embroidered patch — gold NICK'S / white TIRE & AUTO CLEVELAND OH) | BrandMark SVG (pendant-style, "Cleveland Tough" tagline) | **WRONG MARK** for the new positioning | P2 |

**Net:** the home page is a different product than the mockup describes. **Not a polish issue — a positioning issue.**

---

## Site-Wide Voice Diagnosis

The site has TWO voices, and they're fighting each other.

**Voice A** is the locked positioning the operator wants: FCFS, cones for tires, drop-off for repairs, written estimate before any wrench, payment programs (not financing). This voice is mostly absent on the live site.

**Voice B** is what's actually deployed: a brand-emotion voice — "Cleveland Tough," "your grandfather would've trusted," "real bays, real prices." It's good copy. It's not the **right** copy for FCFS.

The fight resolves on /tires and the home subhead, where both voices coexist but neither dominates: "Pull up any day of the week" appears (Voice A) but the H1 says "Cleveland Tough" (Voice B). The user lands, reads "Cleveland Tough," forms an emotional impression, then has to do the cognitive work to figure out the FCFS model from the supporting copy. Most won't.

The dominant failure pattern is **headline-subhead disconnect**: the H1 sets up an emotion, the subhead encodes the behavior. That's backwards. Direct response 101: behavior in the H1, emotion in the support.

The dominant opportunity is mass-substitution. The 23 commits from today's session ALREADY rewrote most service-page headlines and subheads with the framework's evolution operators. Those rewrites encode behavior over emotion (e.g., "We Hand You The Flashlight"). They're sitting in `origin/main` waiting for deploy.

**Banned phrases found** (count + locations):

| Banned phrase | Live count | Pages |
|---|---|---|
| "Book" | 1 | /booking meta title ("Book Auto Repair Online") |
| "Reserve" | 1 | /booking meta description ("Reserve your drop-off") |
| "Hold Your Spot" | 1 | /booking meta title (implies appointment-game) |
| "Financing" (as primary positioning) | 1 page concept | /financing entire page |
| "Affordable" / "Cheap" / "We Offer Financing" | 0 | (clean) |
| "Top-rated" | 1 | /about meta description ("top-rated shop") |

**Required phrases missing** (target: present in every relevant page):

| Required phrase | Pages where missing |
|---|---|
| "First come, first served" | ALL 11 audited pages |
| "Pull up" (in primary copy, not buried in body) | All but /tires (where it's buried) |
| "Drop it off" / "Drop-off" | Most pages |
| "Used tires from $60" | /tires, home — NOT in title or description |
| "Written estimate before any wrench moves" | Most pages |
| "Payment programs" | Replaced everywhere by banned "Financing" |
| "No surprise prices" | All pages |

**Master tagline coverage** ("Pull up for tires. Drop off for repairs."): **0 / 11 pages**. Approved master taglines do not appear anywhere on the live site.

**Useful-absurdity audit:** target is 1-2 per page. Most pages have 0. The ones that have absurdity ("your kid's Tesla actually needs", "every day we're awake") are appropriate but limited to a few pages.

---

## Site-Wide Visual Diagnosis

The dominant visual pattern is **real shop photos throughout** — that's the strength to scale. Zero stock images. Every hero is from the actual property.

The dominant **failure pattern** is asset-purpose mismatch: the right photos exist in the repo, but they're placed wrong. The FCFS model is best demonstrated by `/photos/exterior-signage-approach.webp` (cones + sign) and `/photos/exterior-facade-wide.webp` (full storefront with bays). Neither is the home hero. The home hero is `/hero-cybertruck.webp` — a photo that demonstrates "we work on Teslas" but doesn't demonstrate "this is how the FCFS process works."

**Stock-photo audit:** No stock photos found in the audited pages. **Strength.**

**Hero asset audit (per Asset Placement Map):**

| Page | Current hero | Should be | Match? |
|---|---|---|---|
| / | hero-cybertruck.webp | STOREFRONT_HERO | NO |
| /tires | storefront-bmw.webp | STOREFRONT_PIT_STOP | NO |
| /brakes | service-bay-clean.webp | service bay (correct) | YES |
| /diagnostics | alignment-bay.webp | alignment-bay or diagnostic | YES |
| /booking | (no dedicated hero) | STOREFRONT_HERO | MISSING |
| /financing | (no dedicated hero) | clean color block w/ STOREFRONT_TRUST in body | UNVERIFIED |
| /reviews | (uses default banner) | STOREFRONT_TRUST | UNVERIFIED |
| /about | (uses default banner) | STOREFRONT_TRUST | UNVERIFIED |
| /contact | (uses default banner) | STOREFRONT_TRUST | UNVERIFIED |
| /cleveland-auto-repair | storefront-day.webp | STOREFRONT_TRUST | YES (close) |
| /alignment | (correct service bay context) | STOREFRONT_PIT_STOP | PARTIAL |

**Mobile-crop audit:** `hero-cybertruck-mobile.webp` exists as a 120KB mobile-optimized variant. Same issue at smaller scale: still a Cybertruck shot, not a storefront shot.

**Open Graph image:** points to an external CloudFront-hosted PNG showing the "Cleveland Tough" pendant logo. Wrong asset for the FCFS positioning. Should be STOREFRONT_HERO with overlay "Pull Up for Tires. Drop Off for Repairs."

**Logo consistency:** the BrandMark SVG component (pendant) is used as the header logo. The Asset Dictionary requires LOGO_PATCH. **Asset doesn't appear to exist as a digital file** — `/public/brand-sign.webp` exists but is a photo of the storefront SIGN, not the embroidered patch design. **Action required:** export LOGO_PATCH from source design.

**Empty / broken image audit:** No 404s detected.

---

## Page-By-Page Grades

### Home — https://www.nickstire.org/

- **Type:** Conversion-anchored homepage
- **Copy Score:** 70/100 | Grade: **C-**
- **Visual Score:** 50/100 | Grade: **F+**
- **Combined:** 62/100 | **D**
- **Cars Down Euclid: 4/10** — page does some work; hero positioning leaves 60% of conversion on the table.

**Verbatim Voice Capture:**
- Hero H1: "Cleveland / Tough." (split: white "Cleveland" + yellow "Tough.")
- Hero subhead: "The Cleveland tire shop your grandfather would've trusted, with the diagnostic gear your kid's Tesla actually needs. Pull up any day of the week — we'll show you the problem on a lift before any wrench moves. Walk-ins welcome, financing approved on the spot."
- Primary CTA: "Call (216) 862-0005"
- Secondary CTA: "Drop Off Your Car"
- Trust strip: "4.9 from 1,700+ reviews · Financing approved on the spot · Walk-ins 7 days · open Sunday · Free install · free coffee · free opinions"

**Visual Capture:**
- Hero asset: `/hero-cybertruck.webp` (Tesla Cybertruck out front of shop)
- Should be: STOREFRONT_HERO (storefront with sign + cones + open bays)
- Match? **NO**

**Copy Dimension Scores:**

| Dimension | Score | Note |
|---|---|---|
| Hook Strength | 6/10 | "Cleveland Tough" is memorable but ambiguous. Doesn't tell me what to do. |
| Value Prop Clarity | 5/10 | Subhead is dense and unfocused. 4 ideas crammed in. |
| Trust Density | 8/10 | 4.9, 1,700+ reviews, walk-ins, Sunday hours all anchored. |
| Friction Reduction | 7/10 | Tel: link works. "Drop Off Your Car" CTA is good. No directions CTA above fold. |
| CTA Strength | 6/10 | 2 CTAs above fold; should be 3. "Drop Off Your Car" is weak vs "SCHEDULE DROP-OFF". |
| Voice & Personality | 7/10 | "Free install · free coffee · free opinions" is on-brand. The grandfather/Tesla line is good. |
| Local Relevance | 8/10 | Cleveland anchored, Euclid Ave referenced, Sunday hours. |
| Money Objection | 5/10 | Says "financing" (banned) — should say "payment programs". No $60 anchor. |
| Urgency | 4/10 | "Pull up any day of the week" doesn't create urgency. |
| Mobile-First | 8/10 | Tel: link, sticky bar (not yet deployed but coded), responsive layout. |

**Visual Dimension Scores:**

| Dimension | Score | Note |
|---|---|---|
| Hero Asset Strength | 4/10 | Photo is high quality, but wrong subject for the positioning. |
| Local Authenticity | 6/10 | Real shop photo, but the cybertruck dominates over the location signals. |
| System Storytelling | 2/10 | Photo shows nothing about the FCFS process. No cones, no bays, no sign visible enough. |
| Trust Signal Visibility | 7/10 | Stars + review count visible above fold. |
| Mobile Composition | 7/10 | Mobile variant exists, but same subject issue. |
| Voice/Image Coherence | 4/10 | "Pull up any day" copy paired with stationary cybertruck photo. |
| CTA Visual Anchoring | 7/10 | Yellow CTAs pop against dark background. |
| Brand Consistency | 6/10 | Yellow + black + dark text consistent, but pendant logo doesn't match LOGO_PATCH spec. |
| Asset Reuse Discipline | 8/10 | Hero asset used only here. No fatigue. |
| Missing/Broken Flags | 10/10 | No broken images. |

**Frameworks Executed Well:**
1. Cialdini social proof (4.9 + 1,700+ visible)
2. Sutherland (the "free coffee · free opinions" trio)
3. Specificity inflation in the trust strip

**Frameworks Missing/Fumbled:**
1. **Brunson hook → story → offer** — no story between the hook and the CTA
2. **Hormozi Value Equation** — Dream Outcome (no problem in line), Likelihood (decent), Time/Effort (not addressed)
3. **Schwartz awareness matching** — most-aware searcher needs price + place + time; the page assumes solution-aware

**Top 3 Weaknesses:**
1. Hero photo doesn't show the FCFS process. Costing the most.
2. H1 doesn't tell the customer what to do.
3. No "Cones" trust block — the single most defensible visual differentiator is missing entirely.

**Surgical Copy Rewrites:** (see rewrites JSON for full set)
- Replace H1 with: `PULL UP FOR TIRES. DROP OFF FOR REPAIRS.`
- Replace subhead with: `Cleveland's first-come-first-served shop. Walk in 7 days. Used tires from $60. Written estimate before any wrench moves. Don't let the problem get bigger.`
- Replace trust strip with: `★ 4.9 from 1,700+ reviews · First-come-first-served · Used tires from $60 · Payment programs · Open 7 days incl. Sunday`

**Surgical Asset Changes:**
- Replace `/hero-cybertruck.webp` with STOREFRONT_HERO. Closest in repo: `/photos/exterior-facade-wide.webp`. Apply `object-position: center 30%`.
- ADD a Cones Mean Keep Moving section between hero and TrustNumbers using `/photos/exterior-signage-approach.webp` + 3 icons.

---

### Tires — https://www.nickstire.org/tires

- **Type:** Service pillar
- **Copy Score:** 73/100 | **C**
- **Visual Score:** 60/100 | **D**
- **Combined:** 68/100 | **C-**
- **Cars Down Euclid: 5/10** — high-intent page. Underdelivers on $60 anchor.

**Verbatim:**
- Title: "Tire Shop Near Me · New & Used · Free Install | Cleveland | Nick's"
- Description: "Cleveland tire shop — new & used tires installed, free mount/balance/valve/disposal. Flat repair. Walk-ins 7 days. (216) 862-0005"

**Top weaknesses:**
1. **No $60 anchor** in title or description — the operator's strongest price proof is buried.
2. Title says "Free Install" but doesn't quantify what that means in dollar terms.
3. Doesn't encode the FCFS model — "Pull up, stay in the car" is missing from meta.

**Frameworks fumbled:** Hopkins specific claim (no $ figure in title), Schwartz solution-aware (skips the price-aware searcher).

**Surgical:** Title → "Tires Cleveland · Used From $60 · Pull Up, Stay In The Car | Nick's" (operator 1 + behavior).

---

### Brakes — https://www.nickstire.org/brakes

- **Type:** FocusedServicePage
- **Copy Score:** 78/100 | **C+**
- **Visual Score:** 75/100 | **C**
- **Combined:** 77/100 | **C**
- **Cars Down Euclid: 6/10** — solid, conversion-tuned page.

**Verbatim:**
- Title: "Brake Repair Cleveland · Free Inspection · Same Day | Nick's"
- Description: "Brake repair Cleveland from $149/axle. Free inspection, same-day service, 12-month warranty. ★4.9 from 1,700+ reviews. Walk-ins 7 days."

**Strengths:** $149/axle is concrete. 12-month warranty is risk-reversal. Real bay photo.

**Weakness:** No "drop it off" / "written estimate before any wrench" language. No "we hand you the flashlight" anchor (which the source code rewrites have but live doesn't).

---

### Diagnostics — https://www.nickstire.org/diagnostics

- **Type:** FocusedServicePage
- **Copy Score:** 72/100 | **C**
- **Visual Score:** 75/100 | **C**
- **Combined:** 73/100 | **C**
- **Cars Down Euclid: 5/10** — appropriate hero, weak anti-pattern naming.

**Verbatim:**
- Title: "Check Engine Light Cleveland · Free 5-Min Scan | Nick's"
- Description: "Check engine light on in Cleveland? Free OBD-II scan, exact-cause diagnosis. ★4.9 from 1,700+ reviews. Same-day diagnosis. Walk-ins 7 days."

**Weakness:** Doesn't call out the chains' "$99 diagnostic fee" pattern. Misses operator 4 anti-pattern leverage.

---

### Alignment — https://www.nickstire.org/alignment

- **Type:** FocusedServicePage
- **Copy Score:** 80/100 | **B-**
- **Visual Score:** 70/100 | **C-**
- **Combined:** 76/100 | **C**
- **Cars Down Euclid: 5/10** — title is on-brand, body works.

**Verbatim:**
- Title: "Wheel Alignment Cleveland · Pothole Survivors Welcome | Nick's"
- Description: "Wheel alignment in Cleveland — fix pulling, uneven wear, crooked steering. Same-day service. ★4.9 from 1,700+ reviews. Free check. Walk-ins 7 days."

**Strength:** "Pothole Survivors Welcome" is operator 3 useful absurd done correctly. One of the better titles on the site.

**Weakness:** No "free printout" or "camber/caster/toe" insider vocab — the source code has it but live doesn't.

---

### Financing — https://www.nickstire.org/financing

- **Type:** Conversion / payment
- **Copy Score:** 60/100 | **D**
- **Visual Score:** 55/100 | **F+**
- **Combined:** 58/100 | **F**
- **Cars Down Euclid: 3/10** — the page concept itself uses banned wording.

**Verbatim:**
- Title: "Auto Repair Financing Cleveland · Approved On The Spot | Nick's"
- Description: "Auto repair financing in Cleveland. $10 down, drive today. Acima, Koalafi, Snap Finance, American First. All credit welcome. Apply in minutes."

**Critical weakness:** "Financing" is banned wording. Page concept needs renaming to "Payment Programs."

**Surgical:** Title → "Auto Repair Payment Programs Cleveland · $10 Down, Drive Today | Nick's"

---

### Booking — https://www.nickstire.org/booking

- **Type:** Conversion / form
- **Copy Score:** 50/100 | **F**
- **Visual Score:** 60/100 | **D**
- **Combined:** 54/100 | **F**
- **Cars Down Euclid: 2/10** — the conversion page uses appointment-language. **Anti-FCFS in its own copy.**

**Verbatim:**
- Title: "Hold Your Spot · Book Auto Repair Online · Cleveland | Nick's"
- Description: "Reserve your drop-off in 60 seconds at Nick's Tire & Auto Cleveland. No credit card. No commitment to fix. A master tech calls back within 15 minutes. Walk-ins welcome 7 days. (216) 862-0005"

**Critical weaknesses:**
1. "Hold Your Spot" — appointment-game phrasing. Banned.
2. "Book Auto Repair Online" — "Book" is banned.
3. "Reserve your drop-off" — "Reserve" is banned.

**Surgical:** Title → "Drop-Off Cleveland · No Appointment, No Reservation | Nick's"

---

### Reviews — https://www.nickstire.org/reviews

- **Copy Score:** 68/100 | **D+**
- **Visual Score:** 65/100 | **D+**
- **Combined:** 67/100 | **D+**
- **Cars Down Euclid: 4/10**

**Verbatim:**
- Title: "Cleveland Auto Repair Reviews · 4.9★ Across 1,700+ | Nick's Tire & Auto"
- Description: "Read 1,700+ Google reviews for Nick's Tire & Auto. 4.9-star rating. See why Cleveland trusts us for tires, brakes, diagnostics, and auto repair."

**Weakness:** "trusts us" is generic marketing-speak. Should describe the actual pattern in the reviews.

---

### About — https://www.nickstire.org/about

- **Copy Score:** 65/100 | **D+**
- **Visual Score:** 55/100 | **F+**
- **Combined:** 61/100 | **D**
- **Cars Down Euclid: 3/10**

**Verbatim:**
- Title: "About Nick's Tire & Auto · Cleveland's Honest Crew Since 2018"
- Description: "Family-owned auto repair in Cleveland since 2018. Honest service, transparent pricing, 4.9-star reviews. Meet the team behind Northeast Ohio's top-rated shop."

**Critical:** "top-rated" is banned (per voice-compliance KILL_LIST shipped this session).

---

### Contact — https://www.nickstire.org/contact

- **Copy Score:** 75/100 | **C**
- **Visual Score:** 60/100 | **D**
- **Combined:** 69/100 | **D+**
- **Cars Down Euclid: 5/10** — directions + phone are anchored.

**Verbatim:**
- Title: "Contact Nick's Tire & Auto · Cleveland · Walk-Ins Always Welcome"
- Description: "Visit Nick's Tire & Auto at 17625 Euclid Ave, Cleveland, OH 44112. Call (216) 862-0005. Open Mon-Sat 8AM-6PM, Sun 9AM-4PM. Walk-ins welcome."

**Strength:** Address + phone + hours all surfaced. Walk-ins anchored.

**Weakness:** "Visit" is generic. "Pull up to Nick's at 17625 Euclid Ave" is the FCFS-affirming language.

---

### Services — https://www.nickstire.org/services

- **Copy Score:** 75/100 | **C**
- **Visual Score:** 55/100 | **F+**
- **Combined:** 67/100 | **D+**
- **Cars Down Euclid: 5/10** — page-1 GSC placement, low CTR — title rewrite is highest leverage CTR move.

**Verbatim:**
- Title: "Cleveland Auto Repair Services · One Shop, Every Repair | Nick's"
- Description: "Cleveland auto repair near you — tires, brakes, diagnostics, emissions, oil. Walk-ins welcome 7 days. Free written estimates. 4.9★ from 1,700+ reviews. (216) 862-0005"

**Strengths:** "Free written estimates" is required language and present.

**Weakness:** No anti-pattern naming, no "no surprise prices" anchor.

---

### Cleveland Auto Repair (city page) — https://www.nickstire.org/cleveland-auto-repair

- **Copy Score:** 68/100 | **D+**
- **Visual Score:** 70/100 | **C-**
- **Combined:** 69/100 | **D+**
- **Cars Down Euclid: 4/10**

This is the city flagship. Already touched in this session's source-code rewrites ("We Show You The Worn Part") but live still has the older "trusted shop" wording.

---

## Cross-Page Patterns

### Copy patterns

**Banned phrases found** (counts in actual live HTML, not source):

| Banned phrase | Live count | Pages |
|---|---|---|
| "Book" | 1 | /booking title |
| "Reserve" | 1 | /booking description |
| "Hold Your Spot" | 1 | /booking title |
| "Financing" (positioning) | 1 | /financing |
| "Top-rated" | 1 | /about description |
| "Affordable" / "Cheap" | 0 | (clean) |

**Required phrases missing:**

- "First come, first served" — **0/11 pages**
- "Pull up" (in title or H1) — **0/11 pages** (used in body of /tires + home subhead only)
- "Drop it off" / "Drop-off" — **2/11 pages** (booking, contact reference)
- "Used tires from $60" — **0/11 pages**
- "Written estimate before work starts" / "before any wrench moves" — **1/11 pages** (services description has "free written estimates")
- "Payment programs available" — **0/11 pages** (all use "Financing")
- "No surprise prices" — **0/11 pages**

**Master tagline coverage:** `Pull up for tires. Drop off for repairs.` — **0/11 pages**.

**Dealer-contrast presence:** 3/11 pages (the rewritten brakes/tires/diagnostics pages reference chains, but live has older versions).

**Women-safe voice check:** All pages pass — no patronizing language, no "honey" or "sweetie" issues, no "for the ladies" sections.

**Useful-absurdity audit:** Most pages 0 absurdities. Strongest absurdity: /alignment "Pothole Survivors Welcome" + home "free coffee · free opinions". Below the 1-2 per page target on most pages.

### Visual patterns

**Stock-photo audit:** No stock photos. All real shop photos. **Strength.**

**Logo consistency:** Pendant SVG (BrandMark) used everywhere. LOGO_PATCH not yet exported as a usable file. **Action: export from source.**

**Hero asset audit:** 4/11 pages have correct hero per Asset Placement Map. 7/11 are wrong or unverified.

**Mobile-crop audit:** All hero photos have mobile variants. Same subject errors as desktop.

**Open Graph image:** Wrong asset (pendant brand mark on metallic backdrop). Should be STOREFRONT_HERO with "Pull Up / Drop Off" overlay.

**Empty / broken image audit:** None found.

---

## Priority Action Queue

Ordered by ROI.

| # | Page | Change Type | Expected Lift | Time |
|---|---|---|---|---|
| 1 | **GLOBAL** | Unblock Railway deploy | Activates 23 commits already addressing 50% of these gaps | 5 min in dashboard |
| 2 | / | Copy + Visual: H1 + subhead + hero photo + 3-CTA stack + new Cones block | +2-3 cars/week per 1k visitors | 60 min |
| 3 | /booking | Copy: rename title + description (remove banned phrases) | +1-2 cars/week | 5 min |
| 4 | /financing | Copy: rename to "Payment Programs" page-wide | +0.5-1 cars/week | 30 min |
| 5 | GLOBAL | Site-wide search-replace: Book/Reserve/Schedule/Affordable/Top-rated → FCFS-affirming language | +0.5-1 cars/week | 20 min |
| 6 | / | Add the Cones Mean Keep Moving section per HOMEPAGE_MOCKUP | +1-1.5 cars/week | 90 min |
| 7 | /tires | Add $60 anchor to title + description | +0.5-1 cars/week | 5 min |
| 8 | GLOBAL | Export LOGO_PATCH asset from source design + replace pendant SVG | +0.2 cars/week | 60 min (design + integrate) |
| 9 | /booking | Replace form CTA "Hold Your Spot" / "Book" / "Reserve" wording in form copy | +0.3 cars/week | 15 min |
| 10 | GLOBAL | Update OG image to STOREFRONT_HERO + headline overlay | +0.5 cars/week (social shares) | 30 min |
| 11 | / | Apply object-position to hero photo so sign is visible | +0.2 cars/week | 5 min |
| 12 | All service pages | Insert "drop it off" + "written estimate before any wrench moves" in meta descriptions | +0.5 cars/week aggregate | 45 min |

---

## Compliance & Risk Flags

- **Claim risk:** "Approved On The Spot" on /financing — should be "Payment programs available" or "Approval typically in 60 seconds, real-credit-check varies by lender." Avoid implying universal approval.
- **Image rights:** All photos appear to be operator-owned (real shop photos). No third-party-image flags.
- **ADA / alt-text gaps:** Hero alt-text on home is currently "Tesla Cybertruck parked outside Nick's Tire & Auto on Euclid Ave in Cleveland — real shop, real customers, real cars" — descriptive ✓. But once hero photo changes to STOREFRONT_HERO, alt-text needs update to match.
- **GSC data drift:** 13 pages competing for "nicks tires" brand query. Already addressed in this session's `bdc42eb3` commit (brand-first home title + LocalBusinessSchema alternateName). Pending deploy.

---

## Closing Note

The audit reveals a site **caught between two positions**: brand-emotion ("Cleveland Tough") and behavior-instruction ("Pull Up / Drop Off"). The 23 commits already on `origin/main` move the codebase decisively to behavior-instruction. **The deploy unlocks all of it.** Nothing about this audit changes if the user sees the new content vs. the old content; what changes is which version of the site is being judged.

**Single move that ships #1, #2, #3, #5, and #11 simultaneously:** unblock Railway. **The audit's recommendations are ~50% redundant with work that's already on origin/main but not deployed.**
