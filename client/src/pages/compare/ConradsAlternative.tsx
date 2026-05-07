import ComparisonPage from "@/components/competitor/ComparisonPage";
import { COMPETITORS } from "@/data/competitors";

/**
 * /conrads-tire-alternative-cleveland
 * Format 1: Alternative — singular competitor → switch intent.
 * Highest-volume target in the comparison set; Conrad's is THE
 * Cleveland chain most local drivers grew up with.
 */
export default function ConradsAlternative() {
  return (
    <ComparisonPage
      format="alternative"
      primary={COMPETITORS.conrads}
      slug="conrads-tire-alternative-cleveland"
      seoTitle="Conrad's Tire Alternative Cleveland · Open Sundays | Nick's"
      seoDescription="Tired of Conrad's? Nick's Tire & Auto on Euclid Ave is open 7 days, walk-in any time, used tires from $60 installed. Written estimate before any wrench moves."
      intro="Conrad's has been Cleveland's tire chain since 1934. Nothing wrong with that. They've got 37 locations, full-service repair, established financing. They're also closed Sunday, want an appointment, and won't sell you a used tire. Nick's Tire & Auto on Euclid Ave is what the chain isn't: walk-in any day we're awake including Sundays, used tires from $60 installed, the estimate in writing before any wrench moves. Same Euclid Ave you've driven past a hundred times. Yellow sign. Real address. Mechanic on duty."
      extraFaqs={[
        {
          question: "Why do Cleveland drivers switch from Conrad's to Nick's?",
          answer: "Three reasons every time. One: Conrad's closes Sunday — when your tire blows after the Browns game, the lights are off. Nick's stays open. Two: Conrad's wants an appointment — Nick's is first-come-first-served, walk in any time. Three: Conrad's invoice often shows up bigger than the verbal quote — Nick's hands you the estimate in writing before we touch a wrench. The metal doesn't lie. Neither do we.",
        },
        {
          question: "How does Nick's tire pricing compare to Conrad's?",
          answer: "On new tires, similar competitive market rates. The difference is what's NOT on Nick's invoice: no shop fee surprise, no TPMS service line item that should've been in the quote, no disposal fee math gymnastics. On used tires, there's no comparison — Conrad's won't sell you one. Nick's starts at $60 installed (mount, balance, valve stems, TPMS reset, alignment check, all free). When a $60 used tire solves it, we don't push a $200 new one.",
        },
        {
          question: "Is Nick's Tire & Auto closer than Conrad's for East Side drivers?",
          answer: "Depends on your block — Conrad's has 37 locations spread across Greater Cleveland. Nick's has one location at 17625 Euclid Ave (East Cleveland, between East 174th and Lakeshore Blvd). If you're commuting on Euclid Ave or live anywhere from Glenville to Collinwood to East Cleveland to Cleveland Heights, we're closer than the Conrad's drive most of the time. If you're in Brunswick, Conrad's wins on geography alone.",
        },
        {
          question: "Does Conrad's still sell used tires? What about Nick's?",
          answer: "Conrad's sells new tires only — that's been the chain's policy for years. Nick's sells used tires from $60 installed, every used tire passes a 4-point inspection (tread depth, sidewall, bead seat, age date) stricter than the Ohio driver's test. If a used tire is wrong for your car, we tell you and put new ones on instead. Honesty is the floor.",
        },
        {
          question: "How long is the wait at Nick's vs Conrad's?",
          answer: "First-come-first-served means the wait is whatever the line is when you pull up. On a slow Tuesday morning you'll be rolling in 30 minutes. On a Saturday afternoon snow-warning weekend, every shop in Cleveland is slammed — including us. The difference: we tell you the honest wait when you arrive, set you up with Uber/Lyft if you want to drop the car, and call when it's done. Conrad's appointment system means the appointment-time and the actually-rolling-out time often don't match.",
        },
      ]}
    />
  );
}
