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
    a: "Yes · standard pads carry a 12-month / 12,000-mile warranty · premium pads carry 24-month / 24,000-mile. The warranty card prints with your invoice.",
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
    a: "We stock used tires starting at $40 installed. New tires from $60 installed. Installation includes mount, balance, valve stems, and disposal of your old tire.",
  },
];

export const OIL_CHANGE_FAQ: FAQItem[] = [
  {
    q: "How much is an oil change in Cleveland?",
    a: "Conventional oil change starts at $39 · synthetic oil change starts at $69. Includes new filter, top-off of all fluids, and a free 21-point inspection.",
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
