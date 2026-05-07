import ComparisonPage from "@/components/competitor/ComparisonPage";
import { COMPETITORS } from "@/data/competitors";

/**
 * /nicks-tire-vs-mavis-cleveland
 * Format 3: You vs Competitor — Mavis Discount Tire.
 */
export default function NicksVsMavis() {
  return (
    <ComparisonPage
      format="vs"
      primary={COMPETITORS.mavis}
      slug="nicks-tire-vs-mavis-cleveland"
      seoTitle="Nick's Tire & Auto vs Mavis Cleveland · Honest Compare"
      seoDescription="Mavis advertised tire price low? Total ticket high? Nick's Tire & Auto on Euclid Ave: walk-in 7 days, used tires from $60, the estimate in writing before the wrench moves."
      intro="Mavis advertises tire-only prices that look amazing. The advertised price is real. The total receipt rarely is. That's the Mavis pattern — low headline number, then mount + balance + valve stems + TPMS service + disposal pile up at checkout. Nick's Tire & Auto on Euclid Ave runs the opposite math: $60 used tire installed includes everything, in writing, before the wrench moves. Two different ways of running a tire shop. One yellow sign on Euclid Ave. One real address. One actual person on the phone."
      extraFaqs={[
        {
          question: "Why does Mavis seem so much cheaper than Nick's at first glance?",
          answer: "Because the tire-only price is genuinely competitive — Mavis wins on advertised pricing. The illusion is that the tire price IS the total. It isn't. Add the labor, valve stems, TPMS service, and disposal and the gap closes — sometimes inverts. Nick's quotes the total in writing before installation. No \"oh by the way\" math at checkout.",
        },
        {
          question: "Mavis has more Cleveland locations than Nick's. Is that a real advantage?",
          answer: "If you live closer to a Mavis than to 17625 Euclid Ave, yes — geography wins. If you're East Side anywhere along the Euclid Ave corridor, Nick's is comparable or closer. Location count matters less than which specific location is on your route.",
        },
        {
          question: "Can Nick's beat Mavis on installation speed?",
          answer: "First-come-first-served means our wait is the line at the moment you pull up — could be 30 minutes on a quiet weekday, could be 90 on a snow Saturday. Mavis's appointment system promises a slot but reviews say the slot frequently doesn't match the actually-rolling-out time. We'd rather tell you the honest current wait than promise a fake one. Drop-off + Uber pickup is available if you'd rather not wait at all.",
        },
        {
          question: "What about Mavis's online booking — does Nick's have that?",
          answer: "Nick's runs first-come-first-served, no booking system to schedule into. Walk in, get in line. If you want to coordinate ahead, call (216) 862-0005 — actual person on the line — and we'll tell you the current wait so you can time your visit. Old-school, but it works because the person on the phone is the person at the shop.",
        },
      ]}
    />
  );
}
