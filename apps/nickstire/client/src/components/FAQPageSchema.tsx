/**
 * FAQPageSchema · skill-audit PORT 3 (SEO-AEO schema-generator) · wave-R 2026-05-26
 *
 * Emits Schema.org FAQPage JSON-LD for service pages. Two SEO wins:
 *
 * 1. RICH SNIPPETS · Google can render the Q&A as an expandable
 *    accordion directly in SERP results, increasing CTR by ~15-30%
 *    on info-intent queries ("how long do brakes last", "tire repair
 *    cost", etc.)
 *
 * 2. ANSWER ENGINE (AEO) · ChatGPT, Gemini, Perplexity, Claude when
 *    answering "best brake shop near Cleveland" actively cite pages
 *    that have structured Q&A. Zero schema = zero citations from
 *    AI-generated answers. This is a NEW discovery surface · the
 *    growth channel most local-service shops haven't touched.
 *
 * Usage:
 *   <FAQPageSchema qa={[
 *     { q: "How long do brakes last?", a: "Most brake pads last..." },
 *     { q: "Do you offer same-day brake service?", a: "Yes, walk-in..." },
 *   ]} />
 *
 * Drop into ANY service page that has a Q&A section. Keep the on-page
 * Q&A visible (CRO + EEAT) · the JSON-LD is a parallel description
 * for search engines.
 *
 * Rules per Google's FAQPage spec:
 *   - Each Q must be answered (no empty answers)
 *   - Don't markup Q&A users submit (user-generated content)
 *   - Don't markup ads
 *   - All Q&A on the page should be present in the JSON-LD
 *   - Don't put advertising in mainEntity
 */
import React from "react";

export interface FAQItem {
  q: string;
  a: string;
}

export interface FAQPageSchemaProps {
  qa: FAQItem[];
}

export default function FAQPageSchema({ qa }: FAQPageSchemaProps) {
  if (!qa || qa.length === 0) return null;

  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: qa.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  };

  return (
    <script
      type="application/ld+json"
      // Schema.org JSON-LD · plain JSON, safe to dangerouslySetInnerHTML
      // (the content is a JSON.stringify of our own controlled data ·
      // no user input, no XSS surface)
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

/**
 * Pre-baked FAQ sets for top service pages. Add new sets here as you
 * write content. Each set is keyed by service slug for easy import.
 *
 * Voice/tone: Caregiver + Everyman archetype per brand-voice-guidelines.
 * No corporate-speak. Concrete proof points. First-person.
 */
export const BRAKE_REPAIR_FAQ: FAQItem[] = [
  {
    q: "How long do brake pads typically last?",
    a: "Most pads last 30,000-70,000 miles depending on how you drive — city stop-and-go burns them faster than highway. We can check yours for free during any visit · no appointment needed.",
  },
  {
    q: "Do I need to make an appointment for brake service?",
    a: "No · we're first-come-first-served 7 days a week. Walk in or drop off · we'll text you when it's ready. Average brake job is 1-2 hours.",
  },
  {
    q: "How much does brake service cost in Cleveland?",
    a: "Pads start at $89 per axle installed · pads + rotors start at $189 per axle installed. We give you a written estimate before any wrench moves · you don't pay until you say yes.",
  },
  {
    q: "What are the signs my brakes need service?",
    a: "Squealing or grinding · vibration when braking · brake pedal feels soft or low · brake warning light on dash · or it's been 20,000+ miles since last service. Bring it in · the check is free.",
  },
  {
    q: "Do you offer brake service same-day?",
    a: "Yes — about 90% of brake jobs we finish same day. Drop off in the morning · we'll text you with the written estimate · text back yes and we wrench. Most are out before 6 PM.",
  },
  {
    q: "Are your brake pads warrantied?",
    a: "Yes · our pads carry a 12-month parts / 90-day labor warranty. The warranty card prints with your invoice.",
  },
];

export const TIRE_REPAIR_FAQ: FAQItem[] = [
  {
    q: "How much does tire repair cost?",
    a: "Plug + patch starts at $25 · most repairs $25-40. We'll tell you if the puncture is repairable before we touch it · sidewall damage usually means a new tire instead.",
  },
  {
    q: "Can you repair my flat tire?",
    a: "Most tread punctures yes (under 1/4 inch, not near the sidewall). Sidewall damage no · that's a new-tire job. We diagnose for free · no charge if it can't be safely repaired.",
  },
  {
    q: "How long does tire repair take?",
    a: "Most plug-and-patch repairs are 30-60 minutes. Walk in 7 days · we work first-come-first-served · we'll text you when it's done.",
  },
  {
    q: "Do I need to schedule an appointment?",
    a: "No · just walk in. We're open 7 days. If you can't wait, drop the tire (or the whole car) and we'll text you when it's ready.",
  },
  {
    q: "What about used tires for replacement?",
    a: "We stock used tires from $25 installed (12-inch rims; most sizes $40-80). New tires from $89 installed. Installation includes mount, balance, valve stems, and disposal of your old tire.",
  },
];

export const OIL_CHANGE_FAQ: FAQItem[] = [
  {
    q: "How much is an oil change in Cleveland?",
    // keep in sync with OIL_PRICE
    a: "Conventional oil change starts at $49 · synthetic oil change starts at $80. Includes new filter, top-off of all fluids, and a free 21-point inspection.",
  },
  {
    q: "Do you offer synthetic oil changes?",
    a: "Yes · full synthetic, synthetic blend, and high-mileage synthetic. We use major brands (Pennzoil, Valvoline, Mobil 1). Synthetic typically lasts 7,500-10,000 miles between changes.",
  },
  {
    q: "How long does an oil change take?",
    a: "About 20-30 minutes if you wait · or drop it off and we'll text you when it's done. Walk in 7 days a week · no appointment needed.",
  },
  {
    q: "Do you check other things during the oil change?",
    a: "Yes · free 21-point inspection comes with every oil change. We check tire wear, brakes, fluids, lights, belts, hoses, and battery. We'll tell you what needs attention · you decide what to do.",
  },
];

// wave-fix-2026-05-28 (SEO-AEO parity) · tire-BUYING FAQ for /tires.
// Distinct from TIRE_REPAIR_FAQ above (that's flat/patch repair) · this
// set targets the buy-tires-near-me / tire-installation-cost intent the
// money page ranks for. Voice: Caregiver + Everyman · concrete · no
// corporate-speak. (Wording deliberately avoids the install-package's
// brand-name adjective so the brand-voice pre-commit lint stays clean.)
export const TIRE_BUYING_FAQ: FAQItem[] = [
  {
    q: "How much do tires cost in Cleveland?",
    a: "Used tires from $25 installed (12-inch rims; most sizes $40-80) · new tires from $89 installed. Installation is free with every tire — mount, balance, valve stems, and disposal of your old tire all included. We quote your exact size live · no surprise add-ons at the counter.",
  },
  {
    q: "What's included when I buy tires at Nick's?",
    a: "Every tire purchase includes the full install package free: mount, computer balance, new valve stems, TPMS reset, a tire-pressure set to spec, and disposal of your old tires. You pay for the tire · the install work is on us.",
  },
  {
    q: "Do I need an appointment to get tires?",
    a: "No · walk in 7 days a week. We're first-come-first-served. Most tire installs are done in 30-45 minutes. Drop off if you'd rather · we'll text you when it's ready.",
  },
  {
    q: "Can I buy tires online and have you install them?",
    a: "Yes · pick your size on this page, order online, and we install them here. You can also bring tires you bought elsewhere · mount-and-balance starts at $25 per tire. Either way you get the same free pressure check and disposal.",
  },
  {
    q: "Do you offer financing on tires?",
    a: "Yes · $10 down, no credit check, approved in about 90 seconds. We work with Acima, Snap, Koalafi, and American First. Most customers approved $500–$5,000 · drive away on new tires today and pay over time. Soft pull only · no FICO ding.",
  },
  {
    q: "Are used tires safe to buy?",
    a: "The ones we sell are. Every used tire passes a 4-point check before it goes on a car — tread depth, sidewall condition, DOT date, and plug history. We don't sell a tire we wouldn't put on our own family's car. From $25 installed (12-inch rims; most sizes $40-80).",
  },
];

// wave-2-2026-05-30 (SEO-AEO parity) · broad auto-repair FAQ for the
// /services hub (2nd-highest-impression page, 1,791 imp/90d, had no
// FAQPage schema). Answers the cross-service "auto repair Cleveland"
// intent — appointment, estimates, makes, financing, area, speed,
// payment. Voice: Caregiver + Everyman · concrete · first-person.
export const SERVICES_OVERVIEW_FAQ: FAQItem[] = [
  {
    q: "Do I need an appointment for auto repair?",
    a: "No · we're first-come-first-served 7 days a week. Walk in or drop off and we'll text you when it's ready. Calling ahead at (216) 862-0005 just lets us have the right parts staged.",
  },
  {
    q: "Are your repair estimates free?",
    a: "Yes · the check is free and you get a written quote before any wrench moves. You don't pay until you say yes. No diagnostic-fee games, no surprise line items at pickup.",
  },
  {
    q: "What kinds of cars do you work on?",
    a: "All makes and models — domestic, import, and European (BMW, Mercedes, Audi, VW, Volvo, and more). Cars, trucks, SUVs, and fleet vehicles. We stock or source OE-spec parts and reset your dashboard sensors after service.",
  },
  {
    q: "Do you offer financing for repairs?",
    a: "Yes · $10 down, no credit check, approved in about 90 seconds. We work with Acima, Snap, Koalafi, and American First. Most customers approved $500–$5,000 · soft pull only, no FICO ding. Drive away today, pay over time.",
  },
  {
    q: "What areas do you serve?",
    a: "We're on Euclid Ave and serve all of Northeast Ohio — Cleveland, Euclid, Parma, Lakewood, Cleveland Heights, East Cleveland, Lyndhurst, Shaker Heights, and the neighborhoods between. 17625 Euclid Ave, Cleveland OH 44112.",
  },
  {
    q: "How fast can you fix my car?",
    a: "Most repairs are same-day if you drop off before mid-morning. Quick jobs (oil, flat repair, battery, brakes) are often done while you wait. We'll give you an honest time estimate with the written quote.",
  },
  {
    q: "What payment methods do you accept?",
    a: "Cash, Visa, Mastercard, Discover, American Express, and debit. Plus the $10-down financing programs (Acima, Snap, Koalafi, American First) if you'd rather pay over time. No-credit-check options approved on the spot.",
  },
];
