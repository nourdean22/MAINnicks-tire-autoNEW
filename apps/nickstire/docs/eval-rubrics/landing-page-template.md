# Landing Page Template Framework

**Skill port:** B5 · landing-page-generator + page-cro + headline-psychologist
**Applies to:** /tires variants, /financing, /diagnose-mechanic, future /service-X pages, all programmatic SEO landing pages.
**Authored:** 2026-05-26.

## Why this doc exists

Every landing page is a CRO experiment. Most are built one-off · operator instinct decides headline + CTA + layout. This works until 5+ pages exist · then drift sets in · some have testimonials, some don't · some have price anchors, some don't.

This doc defines the 7-section template every landing page follows. New pages get this skeleton · variants exist as fills, not structural changes.

## The 7-section template

### Section 1 · Hero (above the fold · 100vh on mobile)

Required elements:
- **H1** · keyword-fronted, 6-9 words max, includes a concrete-noun proof point (price, count, time)
- **Subhead** · the FCFS model promise · "First-come-first-served · written quote · you don't pay until you say yes."
- **Primary CTA** · ONE button, action-verb-led ("BOOK YOUR BRAKE SERVICE", "SCHEDULE DROP-OFF")
- **Trust strip** · 4.9★ / 1,700+ reviews / since 2019 · ONE line, no flourish
- **Hero photo** · the shop · real, not stock · object-position handled per Home.tsx hero pattern

Anti-patterns blocked by lint:
- "best/leading/#1 X" in H1 · use proof point (price/count)
- Multiple CTAs in hero · pick one · the lowest-friction primary
- Stock photo · 0% of competitors use real photos · this is the moat

### Section 2 · Price anchor (3-column table)

The most powerful CRO element on the page. Format:

```
| Cleveland-area dealer (avg quote) | $800       |
| National chain (Firestone/Midas)  | $600       |
| Nick's Tire & Auto                | From $149  | ← highlighted
```

Source line below: "Source: representative dealer + chain quotes for Y, Cleveland metro 2026. Final price varies by vehicle."

Why · the customer's mental anchor is the LOWEST price they could find elsewhere. Forcing the comparison reframes the decision from "expensive" to "comparing apples to apples."

### Section 3 · Loss-aversion stats (3 fear stats)

Format · 3 tile rows with:
- Big number
- Unit (feet, days, dollars)
- Consequence sentence

Example from /brakes:
```
287 feet     Added stopping distance at 60 mph with metal-on-metal brakes
             vs. fresh pads. That's roughly two football fields beyond
             where you thought you'd stop.
```

Why · loss-aversion outperforms gain framing 2:1. "Don't lose 287 feet of stopping distance" beats "improve your braking by X%" every time.

### Section 4 · How it works (3-4 step strip)

The FCFS process in 4 steps:
1. Walk in OR drop off · no appointment
2. Free check · we'll tell you what's wrong
3. Written quote · you don't pay until you say yes
4. Drive away same day (or text confirmation when ready)

Visual · numbered steps with icons · NO walls of text · 8-12 words per step max.

### Section 5 · FAQ (Q&A · 6-7 items)

Use the FAQPageSchema component (Wave S) · emits JSON-LD for rich snippets + AI-citation surface.

Pick questions that match GSC search-console queries for that page. Per the /brakes page comment · GSC data informs FAQ choice ("how long do brakes last" was the #1 query · should be FAQ #1).

### Section 6 · Photo ribbon

PhotoRibbon component · 4-5 horizontal scrolling photos · captioned with concrete proof points ("Real brake job in bay 2 · Tuesday morning"). Real shop photos · NO stock.

### Section 7 · Closing CTA

Repeat the primary CTA from Section 1, with a closer copy line · usually loss-aversion-flavored. Example:

```
BOOK YOUR BRAKE SERVICE
Free check, written quote, you don't pay until you say yes. Walk in 7 days.
```

The H1 and the closing CTA should bookend the page · same action, same proof.

## Anti-patterns

### "Hero soup"

H1 + 4 lines of subhead + 3 CTAs + 8 trust badges + a 30-second video autoplay. Each element halves the next element's effectiveness. Hero is for ONE thing · pick it.

### "Section 8+ creep"

If a page has more than 7 sections, the customer scrolls past the convert-point. Cut the lowest-value section instead of adding a new one. The exit-intent modal is the safety net · not the page itself.

### "Generic FAQ"

FAQ items that match no real query · "What is brake repair?" · cut. Match GSC's actual queries · open the GSC dashboard for that page, sort by impressions, pick top 6.

### "No price anchor"

Price is the #1 CRO lever. Pages without an anchor table convert ~30% lower than pages with one. The anchor doesn't have to be the lowest price · just the comparison.

### "Stock-photo trust"

Stock photos signal "we couldn't be bothered." Real-shop photos signal "we ARE the shop." The moat against every chain is in this 1 line of imagery decision.

## Apply to existing pages

`BrakeRepairPage` · already mostly aligned · just got FAQPageSchema wired (Wave S) · is the reference implementation.

`SyntheticOilChangePage` · check for price anchor section · likely missing.

`TireRepairPage` · check loss-aversion stats · likely too soft on consequences.

`DiagnosticsPage` · check FAQ matches GSC top queries · likely generic.

`TireBrandPage` (programmatic) · should follow this template but probably has a degraded version (cluster pages need ≥3 of the 7 sections · pillar pages need all 7).

## Skill-port lineage

B5 from the audit's Round 2 deep-pass. Companion to:
- Wave Q · brand-archetype linter (Section 1 H1 lint)
- Wave S · FAQPageSchema (Section 5 schema)
- Wave T · unslop linter (every section's copy)
- Wave V · autonomous-action tiers (programmatic SEO crons that generate pages are Tier 2)

Future extension · React component scaffold (`<LandingPageTemplate />`) that takes config props and renders the 7-section shape · enforces structure at compile time.
