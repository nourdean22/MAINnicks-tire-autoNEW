import ComparisonPage from "@/components/competitor/ComparisonPage";
import { COMPETITORS, COMPETITOR_REVIEWS, formatMultiple, formatRating } from "@/data/competitors";
import { useReviewStats } from "@/hooks/useReviewStats";

/**
 * /firestone-alternative-cleveland
 * Format 1: Alternative — Firestone Complete Auto Care.
 *
 * The star gap and the review-depth multiple are COMPUTED from Nick's live
 * count and Firestone's researched snapshot, never typed. Hand-written, they
 * were true the week they were written and decayed into a false public claim
 * about a named competitor as Nick's count grew.
 */
export default function FirestoneAlternative() {
  const { rating: reviewRating, ratingDisplay: reviewRatingDisplay, count: reviewCount, countDisplay: reviewCountDisplay } = useReviewStats();
  const fs = COMPETITOR_REVIEWS.firestone;
  const starGap = formatMultiple(reviewRating - (fs.rating ?? 0));
  const reviewDepth = formatMultiple(reviewCount / fs.count);

  return (
    <ComparisonPage
      format="alternative"
      primary={COMPETITORS.firestone}
      slug="firestone-alternative-cleveland"
      seoTitle="Firestone Alternative Cleveland · No Chain Pricing | Nick's"
      seoDescription="Firestone wants $200/hr labor, an appointment, and a Firestone credit card. Nick's Tire & Auto on Euclid Ave: walk-in 7 days, transparent pricing, real address."
      intro={`Firestone is fine if you want corporate paperwork. Lifetime alignment program. Bridgestone tire selection. Brand recognition. Also: appointment-required, chain-level labor rates, dealership-style upsell pressure, and a ${formatRating(fs.rating ?? 0)}-star Google rating on ${fs.count} reviews at the Downtown Cleveland location vs Nick's ${reviewRatingDisplay} stars on ${reviewCountDisplay} reviews at one shop on Euclid Ave. Nick's is the opposite of corporate. Mechanic-owned. First-come-first-served. The estimate hits your hand in writing before any wrench moves. Used tires from $25 installed if a used tire fits. Open 7 days including Sunday. Yellow sign on Euclid Ave. Real address. Phone answered by an actual person at the shop.`}
      extraFaqs={[
        {
          question: "Is Firestone's lifetime alignment program worth it?",
          answer: "If you keep your car 5+ years and live in Cleveland (which means potholes), yes — the math works. ~$170-200 one-time vs paying $80-100 every 18-24 months. The catch: you have to go to Firestone for every alignment, you have to make an appointment, and the labor markup on adjacent work (control arms, tie rod ends) is chain-tier pricing. Nick's quotes alignment per-visit at honest market rate. Different model, both legitimate.",
        },
        {
          question: "Why is Firestone so much more expensive than Nick's?",
          answer: "Two reasons. One: Firestone is corporate Bridgestone — labor rates and shop fees set by a national franchise, not the bay where the work happens. Two: the recommended-services list often includes optional preventative work treated as urgent. Nick's quotes only what your car actually needs, in writing, before the wrench moves. If we recommend it, we'll show you why — flashlight in hand, you under the car.",
        },
        {
          question: "Does Nick's accept the Firestone credit card?",
          answer: "No — Firestone's credit card is a Firestone-only program. Nick's offers payment programs through Acima, Snap, Affirm, and partner lenders that work at most service providers. Pre-qualified in 60 seconds with a soft credit pull (no impact to your score), up to $4,000 approved. Same financing convenience, no chain lock-in.",
        },
        {
          question: "Why do so many Firestone reviews mention surprise charges?",
          answer: "Because the dealership-style sales process recommends services beyond the original ask, and customers don't always know they can decline. \"While we have it on the lift\" is the phrase. Nick's doesn't run that play. The estimate is the estimate. New things found mid-job get a second authorization before any additional work — never a surprise on the final bill.",
        },
        {
          // wave-181.10 · new FAQ from May 2026 competitor scrape
          question: "How does Firestone Cleveland's rating actually compare to Nick's?",
          answer: `Firestone's biggest Cleveland location — Downtown at 3917 Prospect Ave — sits at ${formatRating(fs.rating ?? 0)} stars on ${fs.count} Google reviews. Nick's Tire & Auto on Euclid Ave: ${reviewRatingDisplay} stars on ${reviewCountDisplay} Google reviews. That's a ${starGap}-star gap AND ${reviewDepth}× the review depth at a single Nick's location vs Firestone's largest Cleveland presence. Firestone is fine. Nick's is consistently better-rated by way more drivers who've actually used both.`,
        },
        {
          // wave-181.10 · corrected the Sunday claim (Firestone IS open Sun)
          question: "Is Nick's open Sundays?",
          answer: "Yes — 9am–4pm every Sunday. Firestone Downtown (Prospect Ave) and Cleveland Heights (Cedar Rd) are also open Sundays 9-5 — the differentiator isn't hours, it's the rating gap and the appointment vs walk-in model. Firestone is appointment-led; Nick's is first-come-first-served + free drop-off + Uber back home. Pull up to Nick's at 17625 Euclid Ave when you want walk-in service on a Sunday.",
        },
      ]}
    />
  );
}
