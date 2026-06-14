/**
 * GBP Q&A seed pairs — copy-paste source for the Google Business Profile
 * Q&A section.
 *
 * 2026-06-10 GBP growth wave. The GBP Q&A section is empty/underused —
 * a high-leverage local-SEO + trust surface. The owner posts BOTH the
 * question and answer from the business account; nothing here posts to
 * Google. Static and hand-curated so claim safety is reviewable.
 *
 * BRAND VOICE: direct, plain English, no hype, no false guarantees, no
 * invented prices (except the approved used-tire wording), no "everyone
 * uses us", no pushy sales language. Payment programs (not "financing")
 * is the FCFS brand term. Used-tire wording approved by owner:
 *   "used tires from $25 installed on select 12-inch sizes; most used
 *    tires run $40-80 installed."
 *
 * SAFETY: no "free estimate" promise beyond the site's existing "free
 * check / written quote" language, no invented warranties, no invented
 * wait times, no "guaranteed same-day". Tests in
 * server/gbp-growth.test.ts enforce the forbidden-claim list.
 */

export type GbpQaCategory =
  | "hours"
  | "tires"
  | "brakes"
  | "diagnostics"
  | "emissions"
  | "payment"
  | "scheduling"
  | "vehicles"
  | "tire-repair"
  | "alignment"
  | "oil"
  | "what-to-bring"
  | "pricing"
  | "trust"
  | "philosophy";

export interface GbpQa {
  category: GbpQaCategory;
  question: string;
  answer: string;
}

export const GBP_QA_SEEDS: GbpQa[] = [
  {
    category: "hours",
    question: "Do I need an appointment or can I walk in?",
    answer:
      "Walk-ins are welcome 7 days a week. You can also drop your vehicle off and we'll work it first come, first served. We're on Euclid Ave in Cleveland — call (216) 862-0005 if you want to check the wait before you come.",
  },
  {
    category: "tires",
    question: "Do you sell used tires, and how much are they?",
    answer:
      "Yes — new and used. Used tires start from $25 installed on select 12-inch sizes; most used tires run $40-80 installed depending on size and condition. Every used tire is inspected for tread, sidewall damage, and age before we put it on your car.",
  },
  {
    category: "tires",
    question: "Can you get my tire size if it's not in stock?",
    answer:
      "Usually yes. We stock common sizes and can order most others from our suppliers, often within a day or two. Tell us the size on your sidewall (like 215/60R16) and we'll let you know what we can do.",
  },
  {
    category: "brakes",
    question: "My brakes are squealing — can you check them?",
    answer:
      "Bring it in. Squealing, grinding, or a soft pedal all point to brake wear we should look at. We check the pads, rotors, and lines and tell you what actually needs doing before any work starts.",
  },
  {
    category: "diagnostics",
    question: "My check engine light is on. What now?",
    answer:
      "Come in and we'll pull the codes and run a diagnostic. A check engine light can be something small like a loose gas cap or something bigger — we find the real cause first instead of guessing or replacing parts you don't need.",
  },
  {
    category: "emissions",
    question: "Can you help if my car failed the Ohio E-Check?",
    answer:
      "Yes. If your vehicle failed Ohio E-Check, bring the report — we diagnose what caused the failure and fix it so you can pass. A lot of failures come down to emissions or check-engine issues we handle every week.",
  },
  {
    category: "payment",
    question: "Do you offer payment programs if I can't pay all at once?",
    answer:
      "Yes — we work with lease-to-own and payment-program providers like Acima and Snap so you can split the cost. Approval is quick and there's no hard credit check to apply. Ask us at the counter or check the Payment Programs page on nickstire.org.",
  },
  {
    category: "scheduling",
    question: "Is it better to make an appointment or drop off?",
    answer:
      "Both work. Walk in and wait, or drop the car off and we'll get to it in order. For bigger jobs, dropping off in the morning usually means a faster turnaround. Whatever's easier for you.",
  },
  {
    category: "vehicles",
    question: "What makes and models do you work on?",
    answer:
      "Just about anything on the road — domestic and import, cars, trucks, and SUVs, daily drivers to work vehicles. If you're not sure we handle your vehicle, call (216) 862-0005 and ask.",
  },
  {
    category: "tire-repair",
    question: "I have a nail in my tire — can you repair it instead of replacing it?",
    answer:
      "Often, yes. If the puncture is in the repairable area of the tread and the tire's otherwise in good shape, a patch or plug is usually the right call — and a lot cheaper than a new tire. We'll tell you honestly if it's repairable or not.",
  },
  {
    category: "alignment",
    question: "My car pulls to one side after a pothole — is that alignment?",
    answer:
      "Could be alignment, could be suspension. Cleveland potholes knock both out of spec. Pulling, uneven tire wear, or a crooked steering wheel are worth getting checked — we look at it and show you what's going on before recommending anything.",
  },
  {
    category: "oil",
    question: "Do you do oil changes, and do I need an appointment?",
    answer:
      "Yes, conventional and synthetic, no appointment needed. We include a courtesy inspection so you find out about small issues before they turn into big ones. Walk in any day we're open.",
  },
  {
    category: "what-to-bring",
    question: "What should I bring for my visit?",
    answer:
      "Just your vehicle and a description of what's going on. If it's an E-Check failure bring the report; if a warning light is on, note when it started. The more you can tell us, the faster we narrow it down.",
  },
  {
    category: "pricing",
    question: "How does your pricing work?",
    answer:
      "We check the vehicle, tell you what it actually needs, and give you a written quote before any work begins — you don't pay until you say yes. Prices depend on the vehicle and parts, so we quote it straight rather than throwing out a number that changes later.",
  },
  {
    category: "trust",
    question: "I don't know much about cars — will you explain what's wrong?",
    answer:
      "Always. We explain every repair in plain language before work begins, no pressure and no pushy upsells. A lot of our customers come to us because they were tired of feeling talked down to somewhere else. Ask as many questions as you want.",
  },
  {
    category: "philosophy",
    question: "Why do you check first instead of just replacing the part?",
    answer:
      "Because replacing parts you don't need wastes your money and doesn't always fix the problem. We diagnose first, find the real cause, and only recommend what the vehicle actually needs. It's cheaper for you and it's how we earn repeat customers.",
  },
  {
    category: "tires",
    question: "Do you mount and balance tires I bought somewhere else?",
    answer:
      "Yes, we mount and balance tires you bring in. Bring the tires and your vehicle and we'll get them on and balanced. Call ahead at (216) 862-0005 if you want to check the wait.",
  },
  {
    category: "diagnostics",
    question: "Do you work on cars from other Northeast Ohio suburbs, not just Euclid?",
    answer:
      "Of course. We're on Euclid Ave in Cleveland and serve drivers from across Northeast Ohio — Euclid, East Cleveland, Cleveland Heights, and beyond. It's worth the drive for honest diagnostics and fair pricing.",
  },
];

/** Group the seeds by category for the admin/copy surface. */
export function gbpQaByCategory(): Record<GbpQaCategory, GbpQa[]> {
  return GBP_QA_SEEDS.reduce((acc, qa) => {
    (acc[qa.category] ??= []).push(qa);
    return acc;
  }, {} as Record<GbpQaCategory, GbpQa[]>);
}
