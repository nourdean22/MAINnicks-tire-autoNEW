import ComparisonPage from "@/components/competitor/ComparisonPage";
import { COMPETITORS } from "@/data/competitors";

/**
 * /discount-tire-alternative-cleveland
 * Format 1: Alternative — Discount Tire (national, tires-only).
 */
export default function DiscountTireAlternative() {
  return (
    <ComparisonPage
      format="alternative"
      primary={COMPETITORS["discount-tire"]}
      slug="discount-tire-alternative-cleveland"
      seoTitle="Discount Tire Alternative Cleveland · One-Stop Shop | Nick's"
      seoDescription="Discount Tire is tires only — they can't do brakes, oil, or alignment. Nick's Tire & Auto: tires + brakes + repair under one roof, open 7 days, walk-in any time."
      intro="Discount Tire is genuinely good — at tires. Free flat repair, free balance, free rotation for the lifetime of the tire. We respect that model. The catch: it's tires only. Brakes? Different shop. Oil change? Different shop. Alignment? Most Discount Tires don't do it. So when you've got a tire problem AND something else going on, that's two trips to two places — usually on different days. Nick's Tire & Auto on Euclid Ave does both at the same time. Walk in 7 days. Used tires from $40 installed. Brakes, oil, alignment, mechanical repair — all under one roof. Same yellow sign."
      extraFaqs={[
        {
          question: "Why doesn't Discount Tire do brakes or alignment?",
          answer: "Strategic focus. Discount Tire built a tires-only model and they're the best at it nationwide — free flat repair, free balance, free rotation lifetime, fast service. That model can't economically include full mechanical repair. So they don't pretend to. We respect the discipline. But if your check engine light is on AND you need tires, you need a shop that does both. That's Nick's.",
        },
        {
          question: "Are Discount Tire's free lifetime services actually worth it?",
          answer: "Yes — IF you stay loyal to Discount Tire for tires. The math works: 50,000-mile tire × 4 free rotations × free flat repairs over 4 years adds up. The trade-off is convenience. Every rotation, every flat, every balance — back to Discount Tire. Different shop than where you get your oil. Different shop than where you get your brakes. Nick's is one stop for all of it.",
        },
        {
          question: "What does Nick's offer that Discount Tire can't?",
          answer: "Brakes, oil change, alignment, suspension, mechanical repair, used tires from $40, Sunday hours, written estimate before any wrench moves, and a mechanic who can hand you a flashlight and walk you under your car so you can see the worn part yourself. Discount Tire is excellent at the slice of work they do. Nick's covers the whole car.",
        },
        {
          question: "Can Nick's match Discount Tire's free services on tires they install?",
          answer: "On every tire we install — new or used — we include free mount, free balance, free valve stems, free TPMS reset, and a free alignment check. That's the install. We don't promise lifetime free rotations the way Discount Tire does — we're one location, can't economically match that — but our installed price is competitive and the labor is honest.",
        },
        {
          question: "Is Nick's open Sundays like Discount Tire?",
          answer: "Discount Tire's Cleveland-area locations are typically closed Sunday. Nick's is open Sunday 9am–4pm, every Sunday. The chains close. We don't.",
        },
      ]}
    />
  );
}
