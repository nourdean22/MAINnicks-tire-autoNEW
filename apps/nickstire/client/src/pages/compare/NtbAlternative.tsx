import ComparisonPage from "@/components/competitor/ComparisonPage";
import { COMPETITORS } from "@/data/competitors";

/**
 * /ntb-alternative-cleveland
 * Format 1: Alternative — NTB (now Mavis-owned).
 */
export default function NtbAlternative() {
  return (
    <ComparisonPage
      format="alternative"
      primary={COMPETITORS.ntb}
      slug="ntb-alternative-cleveland"
      seoTitle="NTB Alternative Cleveland · Post-Mavis Acquisition | Nick's"
      seoDescription="NTB became Mavis in 2021. Same checkout pattern, same closed Sundays. Nick's Tire & Auto on Euclid Ave: walk-in 7 days, used tires $25, quote up front."
      intro="NTB used to be its own brand. Mavis acquired NTB in 2021 and has been folding NTB stores into the Mavis banner ever since. If your last decent visit at NTB was before 2021, the shop you're remembering doesn't really exist anymore — it's a Mavis with NTB signage. Same checkout-math pattern as everywhere else in the Mavis system. Same Sunday closures. Nick's Tire & Auto on Euclid Ave: still independent, still mechanic-owned, still walk-in 7 days, still hands you the quote in writing before the wrench moves. Used tires from $25 installed when a used tire fits. Free check. Written quote. You don't pay until you say yes."
      extraFaqs={[
        {
          question: "Is NTB still NTB after the Mavis acquisition?",
          answer: "Functionally, no. Mavis bought NTB in 2021 and has been converting NTB stores to Mavis-branded service. The pricing model, the appointment system, and the customer experience now match Mavis's playbook. Brand recognition for NTB is fading as the conversions complete. If you were an NTB regular before 2021, you're effectively a Mavis customer now.",
        },
        {
          question: "Why do NTB / Mavis stores have such variable service quality?",
          answer: "Acquisition-driven growth concentrates on store count, not store standards. Mavis added hundreds of NTB locations in 2021 and integrated them under the same management framework that produces the existing review variance. Same brand sign, very different store-to-store experience. Single-location independents like Nick's have one standard because there's one bay where the work happens.",
        },
        {
          question: "Does Nick's accept old NTB warranties?",
          answer: "Honor warranties at the shop that wrote them. NTB warranties are honored by NTB / Mavis stores. If you've got a transferable manufacturer tire warranty (Bridgestone, Michelin, etc.), Nick's can install replacement tires under that warranty on your visit — same as any tire shop. The labor and install we put in writing before any wrench moves — you don't pay until you say yes.",
        },
        {
          question: "Is Nick's open Sundays when NTB is closed?",
          answer: "Yes — Sunday 9am–4pm, every Sunday. NTB / Mavis closes Sunday at most Cleveland-area locations. The chains close. We don't.",
        },
      ]}
    />
  );
}
