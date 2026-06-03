# Front-facing site uniformity audit + fix — wave-183

**Scope:** every public/customer-facing nickstire.org page (~90 routes / ~75 page files + shared chrome). Goal: visual + copy + data + SEO uniformity, no deficit, nothing broken. Read-only audit was a 9-agent fan-out vs the canonical ruler (`shared/business.ts` + `shared/pricing.ts` + `PageLayout` + `SEOHead`), cross-checked against my own ground-truth greps. 86 findings (28 high / 30 med / 28 low).

## Understanding (brainstorming lock)
- The site is well-factored: shared `PageLayout` chrome, `SEOHead`, a shadcn `ui/` system, and 9 shared data modules. So "uniformity" = *does every page compose the chrome + pull NAP/price/hours from `shared/*` instead of hardcoding.*
- **Data correctness verdict:** phone / address / hours are uniformly CORRECT everywhere (hardcodes match canon → DRY-debt, not bugs). Warranty was clean in `client/src` but **`shared/blog.ts` still claims 36-month** (real = 12mo). Founding year is wrong on 2 pages. Review count stale on 1.
- **The headline defect is tire pricing**, and the operator reframed the fix (see Decision Log #1).

## Decision Log
**#1 — Tire pricing strategy (operator decision, 2026-06-03).** The site contradicted itself ($40 used everywhere incl. Google schema, vs `business.ts` "$60"; new tires "$60" vs "$80"). Operator's call — NOT a simple uniformity sweep, a **new strategy**:
- **Used tires → DECOY anchor "from $25 installed"** + *small* fine print: `12″ rims · subject to availability`. Legitimate loss-leader (codebase already has `DecoyPricingTable`/`AnchorAdjustmentTable`). Honesty guardrail: the fine-print qualifier MUST travel with the $25 everywhere it shows (incl. schema), and Nick must genuinely stock $25 12″ tires (operator asserts yes).
- **New tires → NO price** (every size differs). Replace with positioning: **"We can order any tire you want — Nick never says no!™"**
- *Alternatives considered:* sweep to $60 (rejected — operator says $25 decoy); keep $40 (rejected — operator raising the hook). 
- *Why:* operator owns pricing; decoy maximizes call/walk-in conversion; "Nick never says no" removes the price objection on new tires + is a brand asset.

**#2 — Centralize tire pricing (kaizen/standardize).** Root cause of the 76-occurrence drift = no single source for tire prices (only `OIL_PRICE` is centralized). Fix: add `BUSINESS.usedTires` decoy + fineprint + `BUSINESS.newTires.positioning` + `BUSINESS.taglines.neverNo`, and reference them everywhere. Error-proofs against future drift.

**#3 — Brand-voice: fix self-praise kills, keep clever/sanctioned variants.** Remove "family-owned"/"Family Owned" (TrustStrip chip, About/Careers SEO→Google), fabricated-quote "Cleveland drivers trust Nick's", "quality" filler. KEEP "family-run" (sanctioned in the VAPI wave) and competitor-directed/contrarian uses of "trust" (e.g. footer "Don't trust shops you can't see" — that's a hook against chains, not fake self-praise). Judge per-item, don't blanket-sweep.

**#4 — NAP DRY: fix structured, defer prose.** Centralize the repeated/structured hardcodes (Home/Contact city-zip + hours blocks, schema files). DEFER the ~45 prose-sentence address/phone hardcodes (correct values; interpolation hurts readability — YAGNI).

**#5 — Chrome: wrap only where the omission is a real defect.** Some pages omit `PageLayout` deliberately (ad LPs, focused utilities). Verify each: likely wrap CustomerPortal + BookingPage; leave intentional full-screen trackers if the chrome-less choice is deliberate.

## Fix buckets
- **W1 — zero-ambiguity bugs/false-facts (no review needed):** blog.ts 36mo→12mo · LandingPage "Since 2005"→2018 + hardcoded phone · WomensSafety "20 years"→since 2018 + "1,688"→1,700+ + add phone CTA + off-palette · BlogPost oil "$29.99"→$49 · SyntheticOil schema 39/89→49/80 · NeighborhoodPage stale map coords→BUSINESS.geo · undefined `--nick-yellow-alpha` (Specials+Referral) · StatusTracker conflicting `rounded-2xl rounded-lg` · dead-link slugs (ComparisonPage RoundupTile moes routes, PriceEstimator breadcrumb) · DiagnosticsPage missing title suffix.
- **W2 — tire pricing/positioning sweep (after adversarial review):** centralize constant → sweep ~25 used-$40→$25-decoy+fineprint · new→"Nick never says no!™" · update LocalBusinessSchema/FAQPageSchema/Product+Service JSON-LD · brake-pad $129/$149→standardize $149 · re-prerender.
- **W3 — brand-voice + SEO suffix + chrome:** family-owned/quality/trusted clear-kills · add canonical title suffix where missing (Blog/GuidesIndex/CarCareGuide/NotFound/Diagnostics/WomensSafety) · wrap CustomerPortal/BookingPage in PageLayout if warranted.
- **W4 — selective DRY:** Home/Contact structured NAP + hours from BUSINESS · oil $49/$80 refs → OIL_PRICE.
- **DEFER:** prose NAP hardcodes (correct values) · estimator near-duplicate consolidation (PriceEstimator vs LaborEstimator — bigger refactor, separate task).
- **HOLD:** none new. (GBP still held from prior session.)

## Verify
tsc 0 · vitest · `lint:brand-voice` 0 · `pnpm run prerender` (NAP/price/schema changed) · drive the site (Playwright/Chrome) on Home/UsedTires/FAQ/compare · `bash ~/push-main.sh` per wave (rebase on sibling).
