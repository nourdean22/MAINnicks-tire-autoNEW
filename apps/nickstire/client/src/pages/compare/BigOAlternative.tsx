import ComparisonPage from "@/components/competitor/ComparisonPage";
import { COMPETITORS } from "@/data/competitors";

/**
 * /big-o-tires-alternative-cleveland
 * Format 1: Alternative — Big O Tires.
 */
export default function BigOAlternative() {
  return (
    <ComparisonPage
      format="alternative"
      primary={COMPETITORS["big-o"]}
      slug="big-o-tires-alternative-cleveland"
      seoTitle="Big O Tires Alternative Cleveland · Open 7 Days | Nick's"
      seoDescription="Big O has only a handful of Cleveland locations. Nick's Tire & Auto on Euclid Ave: walk-in 7 days, used tires from $25 (select 12-inch; most $40-80), the quote in writing before any wrench moves."
      intro="Big O Tires runs decent house-brand tire warranties — Big Foot, Legacy lines, road hazard programs. The catch in Cleveland: Big O's footprint is thin here. A handful of stores serving Greater Cleveland. If the closest Big O is 20 miles away and you're on the East Side, Nick's Tire & Auto on Euclid Ave is closer, open later, open Sunday, and willing to sell you a used tire from $25 (select 12-inch; most $40-80) if a used tire fits. Yellow sign on Euclid Ave. Real address. Free check. Written quote. You don't pay until you say yes."
      extraFaqs={[
        {
          question: "Is Big O Tires worth the drive in Cleveland?",
          answer: "Depends on geography and what you need. Big O's road hazard warranty + house-brand tire programs are legitimate value if you're committed to the brand and live near a store. If the closest Big O is a 25-minute drive, you're paying in time what you saved on the warranty. Nick's is one location at 17625 Euclid Ave — if you're East Side, we're probably closer.",
        },
        {
          question: "Does Nick's match Big O's road hazard warranty?",
          answer: "We don't run a national-chain road hazard program — that's a Big O strength we acknowledge. Nick's offers honest used tires from $25 installed (select 12-inch; most $40-80), free mount/balance/valve stems on every install, and an alignment check included. Different value proposition: lower-friction service, lower-friction install, no warranty paperwork.",
        },
        {
          question: "Why are Big O prices higher than Nick's on most installs?",
          answer: "Chain pricing structure. Corporate sets labor rates, shop fees, parts markup. Single-location independents like Nick's set our own rates and we keep them honest because we live in the same neighborhood as our customers. The quote hits your hand in writing before the wrench moves. We tell you the cost before we touch anything.",
        },
        {
          question: "Is Big O open Sundays in Cleveland?",
          answer: "Most Greater Cleveland Big O locations are closed Sunday or open limited hours. Nick's is open Sunday 9am–4pm, every Sunday. The chains close. We don't.",
        },
      ]}
    />
  );
}
