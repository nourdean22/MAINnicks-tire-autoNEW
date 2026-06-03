import ComparisonPage from "@/components/competitor/ComparisonPage";
import { COMPETITORS } from "@/data/competitors";

/**
 * /conrads-vs-mavis-tire-cleveland
 * Format 4: Third-party comparison — captures search traffic where
 * customers are comparing two competitors. We position as the
 * objective analyst first, then introduce Nick's as the third option.
 */
export default function ConradsVsMavis() {
  return (
    <ComparisonPage
      format="third-party"
      primary={COMPETITORS.conrads}
      secondary={COMPETITORS.mavis}
      slug="conrads-vs-mavis-tire-cleveland"
      seoTitle="Conrad's vs Mavis Tire Cleveland · Honest Compare + 3rd Option"
      seoDescription="Conrad's Tire vs Mavis Discount Tire in Cleveland. Hours, pricing, walk-ins, used tires — head-to-head. Plus the third option neither chain wants you to know about."
      h1="Conrad's vs Mavis Tire — Cleveland honest compare"
      intro="Conrad's is Cleveland's hometown chain since 1934 — 37 locations, established, full-service. Mavis is the national chain that bought NTB in 2021 — aggressive growth, low advertised tire prices. Both close Sunday. Both want an appointment. Both have the same checkout-math pattern in their reviews. If neither feels right, the third option Cleveland drivers actually use: Nick's Tire & Auto on Euclid Ave — open 7 days including Sunday, walk-in any time, used tires from $25 installed. Free check. Written quote. You don't pay until you say yes. The yellow sign you've probably driven past."
      extraFaqs={[
        {
          question: "Conrad's or Mavis — which has better pricing?",
          answer: "Mavis wins on advertised tire-only prices. Conrad's wins on bundled service (mounting + balance + valve stems often included in the quote vs Mavis line-itemed at checkout). On total out-the-door cost, comparison depends on the specific tire and the specific store. Both are chains. Both have the advertised-low-then-add-fees pattern in reviews. Get a written quote from each before you commit.",
        },
        {
          question: "Conrad's or Mavis — which has better service?",
          answer: "Both are bimodal in reviews — some happy customers, some unhappy ones, depending on the location and manager. Conrad's has the longer Cleveland history and more brand familiarity. Mavis has more aggressive promotional pricing. Neither has consistently better service in aggregate. The honest answer: visit your specific local store of each, talk to the front-counter, and trust your gut.",
        },
        {
          question: "Why would I pick Nick's over Conrad's or Mavis?",
          answer: "Three reasons. One: open Sunday — both Conrad's and Mavis close Sunday, Nick's is open 9am–4pm. Two: walk-in policy — Nick's is first-come-first-served, no appointment, both chains are appointment-preferred. Three: written quote before any wrench moves — you see the cost before we touch the car. Plus used tires from $25 (chains don't sell them).",
        },
        {
          question: "Is Nick's a chain?",
          answer: "No. Nick's Tire & Auto is one location at 17625 Euclid Ave, Cleveland, OH 44112 — mechanic-owned, family-run, opened 2018. The person quoting your work is the person doing it. Single-location is a feature, not a bug — one shop, one crew, one standard every visit.",
        },
      ]}
    />
  );
}
