import ComparisonPage from "@/components/competitor/ComparisonPage";
import { COMPETITORS, COMPETITOR_REVIEWS, formatRating } from "@/data/competitors";
import { useReviewStats } from "@/hooks/useReviewStats";

/**
 * /mavis-tire-alternative-cleveland
 * Format 1: Alternative — Mavis Discount Tire (now also owns NTB).
 *
 * Note the comparison here is INTERNAL to Mavis — its self-reported 4.6 vs the
 * 3.9 drivers leave on neutral aggregators — so that 0.7 gap is a fixed fact
 * about their two numbers, not a function of Nick's. Only Nick's own side goes
 * live.
 */
export default function MavisAlternative() {
  const { ratingDisplay: reviewRatingDisplay, countDisplay: reviewCountDisplay } = useReviewStats();
  const mavis = COMPETITOR_REVIEWS.mavis;

  return (
    <ComparisonPage
      format="alternative"
      primary={COMPETITORS.mavis}
      slug="mavis-tire-alternative-cleveland"
      seoTitle="Mavis Tire Alternative Cleveland · You See The Cost First | Nick's"
      seoDescription="Mavis advertised tire price low? Final invoice high? Nick's Tire & Auto on Euclid Ave: walk-in 7 days, written quote up front, used tires from $25 installed."
      intro="Mavis Discount Tire wins the advertised tire-only price. They lose the rest of the receipt. Read 100 Mavis reviews on Google or Yelp and you'll see the same line ten times: 'final cost was way more than the quote.' That's because the labor + valve stems + TPMS service + disposal fees aren't in the advertised number. Nick's Tire & Auto on Euclid Ave puts all of that in the quote before the wrench moves. Walk in any day we're awake including Sunday. Used tires from $25 installed when a used tire fits. Free check. Written quote. You don't pay until you say yes."
      extraFaqs={[
        {
          question: "Why does Mavis Tire have so many surprise charges at checkout?",
          answer: "Because the advertised tire-only price doesn't include mount, balance, valve stems, TPMS service, or disposal — and those line items add up. It's not technically dishonest. It's just confusing. Nick's quotes it all in writing before any wrench moves: $25 used tire installed includes mount, balance, valve stems, TPMS reset, and an alignment check. No \"oh by the way\" at checkout.",
        },
        {
          question: "Mavis acquired NTB — is the service quality the same now?",
          answer: "Mavis bought NTB in 2021 and has been converting NTB stores to the Mavis banner. The service quality varies dramatically store-to-store either way. Your good visit at one Mavis location doesn't predict your next one. Nick's is one location at 17625 Euclid Ave — same crew, same shop, same standard every visit. Single-location is a feature, not a bug.",
        },
        {
          question: "Does Nick's Tire & Auto match Mavis advertised tire prices?",
          answer: "On new tires, we're competitive market-rate — sometimes a few dollars over Mavis's advertised price, sometimes under. The honest comparison is total out-the-door cost, not the headline tire price. Nick's quotes the total in writing before installation. On used tires, Mavis doesn't sell them at all — Nick's starts at $25 installed.",
        },
        {
          question: "Mavis is closed Sunday. What about Nick's?",
          answer: "Open. 9am to 4pm. Every Sunday. The chains close. We don't. Most of our Sunday customers found us on a snow-Sunday or a Browns-Sunday when their regular Mavis was locked.",
        },
        {
          question: "Can I walk into Nick's without an appointment like I tried at Mavis?",
          answer: "Yes — first-come-first-served. No appointment system. Pull up, hand us the keys, get in line. Mavis routinely turns walk-ins away in favor of confirmed appointments — Nick's takes you in line order, period. If you want to drop the car and go, we'll Uber you back to work and call when it's ready.",
        },
        {
          // wave-181.10 · new FAQ from May 2026 competitor scrape
          question: "Why does Mavis Pearl Rd show different star ratings on different sites?",
          answer: `Mavis Pearl Rd (Middleburg Heights) shows 4.6 stars on Mavis.com but ${formatRating(mavis.rating ?? 0)} stars on third-party aggregators (${mavis.count} reviews). Same store, different math — the in-house number is curated, the third-party number isn't. The third-party number is harder to dispute because Mavis can't manage it. Nick's: ${reviewRatingDisplay} stars consistently across Google, Yelp, and BBB on ${reviewCountDisplay} reviews. When a shop's self-reported rating is 0.7 stars higher than the rating drivers leave on neutral aggregators, that's a signal worth thinking about.`,
        },
      ]}
    />
  );
}
