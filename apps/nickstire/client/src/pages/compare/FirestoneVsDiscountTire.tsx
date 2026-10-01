import ComparisonPage from "@/components/competitor/ComparisonPage";
import { COMPETITORS } from "@/data/competitors";

/**
 * /firestone-vs-discount-tire-cleveland
 * Format 4: Third-party comparison — captures the Firestone-vs-Discount
 * search bracket; introduces Nick's as the third option that does what
 * neither does (Sunday hours + walk-in + used tires + full mechanical).
 */
export default function FirestoneVsDiscountTire() {
  return (
    <ComparisonPage
      format="third-party"
      primary={COMPETITORS.firestone}
      secondary={COMPETITORS["discount-tire"]}
      slug="firestone-vs-discount-tire-cleveland"
      seoTitle="Firestone vs Discount Tire Cleveland · Honest Compare + 3rd Option"
      seoDescription="Firestone vs Discount Tire in Cleveland. Tires, brakes, alignment, pricing — head-to-head. Plus the third option that does Sunday + walk-in + used tires."
      h1="Firestone vs Discount Tire — Cleveland honest compare"
      intro="Firestone is corporate Bridgestone — full-service tires + brakes + alignment, chain-tier pricing, appointment-required, lifetime alignment program. Discount Tire is the national tire-only specialist — free flat repair, free balance, free rotation lifetime, no mechanical work. Two completely different models. Both close Sunday. Both want an appointment. The third option Cleveland drivers actually use when neither fits: Nick's Tire & Auto on Euclid Ave — open 7 days including Sunday, walk-in any time, used tires from $25 installed (select 12-inch; most $40-80), full mechanical repair under one roof. The yellow sign you've driven past."
      extraFaqs={[
        {
          question: "Firestone vs Discount Tire — which is better?",
          answer: "Different jobs. Firestone is full-service: they'll do tires AND brakes AND alignment AND oil change in one visit (with an appointment). Discount Tire is tires-only: they'll do tires fast and cheap with free lifetime services, but anything mechanical is a separate trip to a separate shop. Pick Firestone if you want one-stop premium service. Pick Discount Tire if you only need tires and want the lifetime free flat repair.",
        },
        {
          question: "Why would I pick Nick's over either Firestone or Discount Tire?",
          answer: "Three reasons. One: open Sunday — both Firestone and Discount Tire close Sunday, Nick's is open 9am–4pm. Two: full-service walk-in — Nick's does tires + brakes + alignment + oil + mechanical without an appointment. Three: used tires from $25 (select 12-inch; most $40-80) — neither Firestone nor Discount Tire sells used tires. If you need tires AND brakes AND it's Sunday afternoon, Nick's is the only option that handles all of that in one visit.",
        },
        {
          question: "Is Nick's pricing closer to Firestone or Discount Tire?",
          answer: "Closer to Discount Tire's competitive market-rate on tire prices, but with full-service mechanical Firestone-style. Different cost structure: Firestone is chain-level labor rates, Discount Tire is competitive tire-only pricing, Nick's is honest mechanic-owned single-location pricing with everything quoted in writing before the wrench moves.",
        },
        {
          question: "Does Nick's offer Discount Tire's lifetime free services?",
          answer: "We don't run a lifetime free flat / balance / rotation program — that's Discount Tire's specific model and they're great at it. Every Nick's install includes free mount, free balance, free valve stems, free TPMS reset, and a free alignment check. Different value proposition: lower-friction service, full-service same visit, no warranty paperwork.",
        },
      ]}
    />
  );
}
