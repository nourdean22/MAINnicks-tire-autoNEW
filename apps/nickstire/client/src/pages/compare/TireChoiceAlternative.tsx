import ComparisonPage from "@/components/competitor/ComparisonPage";
import { COMPETITORS } from "@/data/competitors";
import { BUSINESS } from "@shared/business";

/**
 * /tire-choice-alternative-cleveland
 * Format 1: Alternative, same shape as the Conrad's page. The Business Profile
 * shows "tire choice" searches the site never answered (GBP vs GSC, 2026-11-07).
 * Tire Choice facts below were read from its public Cleveland store page on
 * 2026-11-07: open Sundays, free written estimate, new tires listed, no used tires listed.
 */
export default function TireChoiceAlternative() {
  return (
    <ComparisonPage
      format="alternative"
      primary={COMPETITORS["tire-choice"]}
      slug="tire-choice-alternative-cleveland"
      seoTitle="Tire Choice Alternative Cleveland · Used Tires | Nick's"
      seoDescription="Past Tire Choice? Nick's Tire & Auto on Euclid Ave: one local shop, walk-ins 7 days, used tires from $25 installed (select 12-inch; most $40-80)."
      intro={`Tire Choice is a chain with stores across Ohio, including Cleveland, Parma Heights, North Olmsted and Berea. It is open Sundays and offers tires, brakes, oil changes and repair. Nick's Tire & Auto is one shop on Euclid Ave. ${BUSINESS.model.walkIns}, used tires from $25 installed (select 12-inch; most $40-80), and the quote in writing before any wrench moves. Free check. Written quote. You don't pay until you say yes.`}
      extraFaqs={[
        {
          question: "How is Nick's different from Tire Choice?",
          answer: "Tire Choice is a chain with online scheduling, a free written estimate on repairs, and Sunday hours. Nick's is one shop on Euclid Ave with one crew. You can walk in any day, and we sell used tires from $25 installed (select 12-inch; most $40-80), which Tire Choice does not list on its Cleveland store page. If a used tire solves it, we say so.",
        },
        {
          question: "Does Nick's fix flat tires?",
          answer: "Yes. Flat tire repair: plug or patch while you wait, when the puncture is in the tread. A sidewall puncture, or a tire driven flat, needs a replacement, and we show you why.",
        },
        {
          question: "Is Tire Choice open on Sundays?",
          answer: "Its Cleveland store on W 117th St lists Sunday 9am to 5pm. Nick's is open Sunday 9am to 4pm. Hours change, so call before you drive.",
        },
      ]}
    />
  );
}
