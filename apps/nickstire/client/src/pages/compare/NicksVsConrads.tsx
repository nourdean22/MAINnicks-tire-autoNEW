import ComparisonPage from "@/components/competitor/ComparisonPage";
import { COMPETITORS } from "@/data/competitors";

/**
 * /nicks-tire-vs-conrads-cleveland
 * Format 3: You vs Competitor — direct head-to-head.
 */
export default function NicksVsConrads() {
  return (
    <ComparisonPage
      format="vs"
      primary={COMPETITORS.conrads}
      slug="nicks-tire-vs-conrads-cleveland"
      seoTitle="Nick's Tire & Auto vs Conrad's Cleveland · Honest Compare"
      seoDescription="Conrad's vs Nick's Tire & Auto in Cleveland. Hours, pricing, walk-in policy, used tires, written estimates — head-to-head, no spin."
      intro="Conrad's has been Cleveland's tire chain since 1934. Family-grown into 37 locations. Established. Reliable in a chain way. Nick's Tire & Auto opened on Euclid Ave in 2018. One location. Mechanic-owned. First-come-first-served. Same job, two ways of running it. Conrad's gives you 37 lots to pick from and a chain process. Nick's gives you one yellow sign on Euclid Ave and an actual person on the phone. Read the comparison. You'll know which one fits."
      extraFaqs={[
        {
          question: "Conrad's has 37 locations. Nick's has 1. Why does that matter?",
          answer: "If you live 25 miles from Euclid Ave, geography wins — drive to your nearest Conrad's. If you commute on Euclid or live anywhere on the East Side from East Cleveland to Cleveland Heights to Glenville to Collinwood, Nick's is closer than the average Conrad's drive. The 37-location number sounds bigger than it is when only one of them is on your route.",
        },
        {
          question: "Can Nick's actually do everything Conrad's does?",
          answer: "On the work most customers actually need — yes. Tires, brakes, oil change, alignment, mechanical repair, used tires, payment programs, written estimates. Conrad's wins on fleet contracts and corporate invoicing relationships — that's a real difference for fleet customers and B2B accounts. For individual and family customers, Nick's covers the whole car at honest market rates.",
        },
        {
          question: "Why is Nick's first-come-first-served instead of appointment-based like Conrad's?",
          answer: "Because the appointment system Conrad's runs has the same problem most chains have: the appointment time and the actually-rolling-out time often don't match. We'd rather quote you the honest current wait when you arrive than over-promise an appointment and run an hour behind. If you can't sit, drop the car off — we'll Uber you back to work and call when it's done.",
        },
        {
          question: "Conrad's price-match guarantees a competitor's tire price. Does Nick's?",
          answer: "Bring us a written quote on the same tire from any Cleveland-area shop and we'll match honest competitor pricing. The catch: we'll match the tire, not the tire-plus-padded-labor games. The total out-the-door price is what matters, and we put it in writing before installation. If the competitor's quote includes hidden fees that show up at checkout, we won't match the false bottom-line — we'll show you the honest total.",
        },
      ]}
    />
  );
}
