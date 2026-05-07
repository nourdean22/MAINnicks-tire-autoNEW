import ComparisonPage from "@/components/competitor/ComparisonPage";
import { COMPETITORS, NICKS_TIRE } from "@/data/competitors";

/**
 * /best-tire-shops-cleveland
 * Format 2: Roundup — broad "best tire shops in Cleveland" page.
 * Lists Nick's first + 6 honest alternatives from the COMPETITORS set.
 */
export default function BestTireShopsCleveland() {
  return (
    <ComparisonPage
      format="roundup"
      primary={NICKS_TIRE}
      slug="best-tire-shops-cleveland"
      seoTitle="Best Tire Shops Cleveland · 7 Honest Picks Ranked | Nick's"
      seoDescription="The honest ranking of Cleveland tire shops. Nick's, Conrad's, Mavis, Discount Tire, Firestone, Monro, Big O — sorted by walk-in policy, Sunday hours, used tire access."
      h1="Best tire shops in Cleveland — the honest ranking"
      intro="Most 'best tire shops in Cleveland' lists are paid placement or copied off Yelp. This one's different. Below: seven shops Cleveland drivers actually use, ranked by what matters when you actually need work done — walk-in availability, Sunday hours, written-estimate-before-the-wrench, used tire access, and how often the receipt matches the verbal quote. Nick's leads on those axes. The chains lead on location count and warranty paperwork. You decide which matters more for your car."
      roundupCompetitors={[
        COMPETITORS.conrads,
        COMPETITORS["discount-tire"],
        COMPETITORS.firestone,
        COMPETITORS.mavis,
        COMPETITORS.monro,
        COMPETITORS["big-o"],
      ]}
      extraFaqs={[
        {
          question: "What's actually the best tire shop in Cleveland?",
          answer: "Depends on what \"best\" means for you. If best = closest, the chains win on location count. If best = lowest advertised tire price, Mavis. If best = lifetime free flat repair on tires you bought there, Discount Tire. If best = walk in any day we're awake, used tires from $60, the estimate in writing before any wrench moves, and a mechanic who hands you the flashlight to see the worn part — that's Nick's. Honest answer for honest question.",
        },
        {
          question: "Which Cleveland tire shop is open Sundays?",
          answer: "Most chains close. Nick's Tire & Auto on Euclid Ave is open Sunday 9am–4pm, every Sunday. The chains close. We don't. Conrad's, Mavis, NTB, Firestone, Big O, Monro / Mr. Tire — most Sunday-closed. Some Discount Tire locations open limited Sunday hours; check their site.",
        },
        {
          question: "Where can I find used tires in Cleveland?",
          answer: "Most chains don't sell used tires — corporate policy. Nick's Tire & Auto sells used tires from $60 installed. Every used tire passes a 4-point inspection (tread depth, sidewall integrity, bead seat, age date). If a used tire is wrong for your car, we say so and put new ones on instead. Honesty is the floor.",
        },
        {
          question: "Which tire shop in Cleveland writes the estimate before starting work?",
          answer: "Nick's does — every visit, in writing, before any wrench moves. Most chains start work after a verbal quote and the written total appears on the final invoice, sometimes higher than the verbal. We hand you the estimate before installation. New things found mid-job get a second authorization before any additional work — never a surprise on the final bill.",
        },
        {
          question: "How do I pick between Nick's and the chains?",
          answer: "If you live closer to a chain location and you don't need Sunday service, the chain works. If you want walk-in flexibility, Sunday hours, used tire access, and a written estimate before the wrench moves — that's Nick's. The trade-off is one location vs many. We can't compete on geography. We compete on how the shop runs.",
        },
      ]}
    />
  );
}
