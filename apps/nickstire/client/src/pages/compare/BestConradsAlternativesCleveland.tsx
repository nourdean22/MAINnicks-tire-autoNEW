import ComparisonPage from "@/components/competitor/ComparisonPage";
import { COMPETITORS } from "@/data/competitors";

/**
 * /best-conrads-tire-alternatives-cleveland
 * Format 2: Roundup — Conrad's-specific alternatives roundup.
 * Captures broader research-stage searches.
 */
export default function BestConradsAlternativesCleveland() {
  return (
    <ComparisonPage
      format="roundup"
      primary={COMPETITORS.conrads}
      slug="best-conrads-tire-alternatives-cleveland"
      seoTitle="Best Conrad's Tire Alternatives Cleveland · 6 Honest Picks | Nick's"
      seoDescription="Looking for Conrad's Tire alternatives in Cleveland? 6 ranked options — Nick's Tire & Auto, Mavis, Discount Tire, Firestone, Monro, Big O. Honest comparison."
      h1="Best Conrad's Tire alternatives in Cleveland"
      intro="Conrad's Tire Express has been Cleveland's tire chain since 1934 — established, reliable in a chain way, 37 locations across Greater Cleveland. Plenty of reasons to shop them. Plenty of reasons to look elsewhere too: closed Sunday, appointment-preferred, no used tires, and the occasional checkout-math surprise. If you're researching Conrad's alternatives, here are the six honest options Cleveland drivers compare. Nick's Tire & Auto leads on walk-in policy + Sunday hours + used tire access. The chains lead on location count. You decide. Free check. Written quote. You don't pay until you say yes."
      roundupCompetitors={[
        COMPETITORS.mavis,
        COMPETITORS["discount-tire"],
        COMPETITORS.firestone,
        COMPETITORS.monro,
        COMPETITORS["big-o"],
        COMPETITORS.ntb,
      ]}
      extraFaqs={[
        {
          question: "Why are people looking for Conrad's Tire alternatives?",
          answer: "Three patterns show up in reviews most often: closed Sunday (working drivers can't get there), appointment-preferred (walk-in friction), and surprise charges on the final invoice that didn't match the verbal quote. None of those mean Conrad's is a bad shop — they mean the chain model has trade-offs that don't fit every customer. The alternatives below address one or more of those friction points.",
        },
        {
          question: "Is Mavis cheaper than Conrad's?",
          answer: "On advertised tire-only prices, Mavis usually wins. On total invoice including labor + valve stems + TPMS service + disposal, the gap closes — sometimes inverts. Both are chains. Both run the same general advertised-low-then-add-fees pattern. If the headline tire price matters more than the total cost, Mavis. If the total cost matters more, compare both written quotes side-by-side before installation.",
        },
        {
          question: "What's the best alternative if I need Sunday service?",
          answer: "Nick's Tire & Auto on Euclid Ave is open Sunday 9am–4pm, every Sunday. Most other Cleveland-area shops including Conrad's, Mavis, NTB, Firestone, Big O, Monro are Sunday-closed. Some Discount Tire locations have limited Sunday hours — check their site for the specific store. Nick's is the consistent Sunday option.",
        },
        {
          question: "Where can I find used tires when Conrad's only sells new?",
          answer: "Nick's Tire & Auto sells used tires from $40 installed. Most chains including Conrad's, Mavis, NTB, Firestone, Big O don't sell used tires at all — corporate policy. If a used tire fits your car (tread depth, age, condition) Nick's will install it with free mount, balance, valve stems, TPMS reset, and alignment check.",
        },
      ]}
    />
  );
}
