/**
 * Google Business Profile Q&A — Pre-generated answers
 * Seed data for the GBP Q&A management system.
 */

export interface GBPQAEntry {
  question: string;
  answer: string;
  category: "hours" | "services" | "pricing" | "location" | "financing" | "warranty";
}

export const SEED_QA: GBPQAEntry[] = [
  { question: "What are your hours?", answer: "We're open Mon-Sat 8AM-6PM, Sunday 9AM-4PM. Walk-ins welcome! Call (216) 862-0005.", category: "hours" },
  { question: "Do you do alignments?", answer: "Yes! We offer full 4-wheel precision alignment starting at $79. Call (216) 862-0005 or book online at nickstire.org.", category: "services" },
  { question: "Do you sell tires?", answer: "Yes — new and used tires. We carry all major brands and can match or beat any price. Visit nickstire.org/tires or call (216) 862-0005.", category: "services" },
  { question: "Do you offer financing?", answer: "Yes! We work with Acima, Snap Finance, Koalafi, and American First Finance. Bad credit or no credit — we can help. Apply in store or online.", category: "financing" },
  { question: "How much is an oil change?", answer: "Conventional oil changes start at $39.99, full synthetic from $69.99. Includes filter, fluid top-off, and multi-point inspection.", category: "pricing" },
  { question: "Do you do inspections / E-Check?", answer: "Yes, we're a certified Ohio E-Check emissions testing station. Walk-ins welcome, usually done in 30 minutes or less.", category: "services" },
  { question: "Do you work on trucks / SUVs?", answer: "Absolutely. We service all makes and models — cars, trucks, SUVs, and vans. Foreign and domestic.", category: "services" },
  { question: "Do you offer free estimates?", answer: "Yes, we provide free estimates on all services. No pressure, no obligation. Call (216) 862-0005 or stop by.", category: "pricing" },
  { question: "How long does a brake job take?", answer: "Most brake jobs are completed same-day, typically 1-3 hours depending on what's needed. We'll give you an accurate time estimate before starting.", category: "services" },
  { question: "Do you have a warranty?", answer: "Yes! We stand behind our work with warranties on parts and labor. Specific warranty terms vary by service — ask your advisor for details.", category: "warranty" },
  { question: "Where are you located?", answer: "We're at 17625 Euclid Ave, Euclid, OH 44112 — right on the Euclid/East Cleveland border. Easy to find, plenty of parking.", category: "location" },
  { question: "Do you accept walk-ins?", answer: "Yes! Walk-ins are welcome Mon-Sat 8AM-6PM, Sunday 9AM-4PM. For faster service, you can also book online at nickstire.org.", category: "hours" },
  { question: "Can you diagnose my check engine light?", answer: "Yes — we have professional-grade diagnostic equipment. Check engine light diagnostics start at $49.99 and include a full report.", category: "services" },
  { question: "Do you do transmission work?", answer: "Yes, we handle transmission diagnostics, fluid flushes, and repairs. Call (216) 862-0005 for an estimate.", category: "services" },
  { question: "Is there a waiting area?", answer: "Yes, we have a comfortable waiting area with Wi-Fi. Most services can be done while you wait.", category: "location" },
  { question: "Do you sell used tires?", answer: "Yes! Quality inspected used tires starting at $60. Every tire is checked for tread depth, sidewall condition, and safety before sale.", category: "pricing" },
  { question: "How much does flat tire repair cost?", answer: "Flat tire repair is $15-$25. Most repairs done in about 15 minutes. We'll never sell you a new tire if yours can be safely repaired.", category: "pricing" },
  { question: "Do you take appointments?", answer: "Yes — book online at nickstire.org or call (216) 862-0005. Walk-ins are also welcome 7 days a week.", category: "hours" },
  { question: "What forms of payment do you accept?", answer: "Cash, all major credit/debit cards, and multiple financing options (Acima, Snap Finance, Koalafi, American First Finance).", category: "financing" },
  { question: "Do you do AC repair?", answer: "Yes! AC system diagnostics, recharge, and repair. If your AC is blowing warm air, bring it in — we'll find the problem. Starting at $49 for inspection.", category: "services" },
];
