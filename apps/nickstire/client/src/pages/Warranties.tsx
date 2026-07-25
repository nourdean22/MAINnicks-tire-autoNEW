import FocusedServicePage, { type ServicePageConfig } from "@/components/FocusedServicePage";

const CONFIG: ServicePageConfig = {
  canonicalPath: "/warranties",
  title: "12-Month Parts / 90-Day Labor Auto Repair Warranty Cleveland | Nick's",
  description: "Our 12-month parts / 90-day labor warranty backs every repair. Transparency, trust, and honest service on Euclid Ave. Pull up any day.",
  eyebrow: "REPAIR GUARANTEE · BUILT ON TRUST",
  h1: "12-MONTH PARTS / 90-DAY LABOR\nWARRANTY.",
  sub: "Every repair at Nick's Tire & Auto is backed by our 12-month parts / 90-day labor guarantee. We stand behind our work because we do it right the first time. Written estimate before any wrench moves. You don't pay until you say yes.",
  startingPrice: "Guaranteed repair backing",
  pricingTitle: "WARRANTY TIERS",
  pricingSub: "Coverage that gives you peace of mind on Cleveland roads.",
  tiers: [
    {
      name: "Parts & Labor",
      price: "12-Mo Parts / 90-Day Labor",
      sub: "Standard coverage",
      use: "Every mechanical repair we perform automatically gets this guarantee.",
      featured: true,
    },
    {
      name: "Road Hazard",
      price: "Optional",
      sub: "Tire protection",
      use: "Add-on coverage for tires against nails, potholes, and road debris.",
    },
    {
      name: "Manufacturer Guarantee",
      price: "Varies",
      sub: "Part warranty",
      use: "Many brand-name parts carry extended manufacturer warranties beyond 12 months.",
    },
  ],
  includedTitle: "WHAT'S COVERED",
  includedSub: "No fine print, no runarounds. If we fixed it and it fails under warranty, we make it right.",
  included: [
    "Replacement parts at no cost if a covered part fails",
    "Labor included at no charge to swap the warrantied part",
    "Written warranty documentation handed to you on receipt",
    "First-come-first-served priority handling if you have a warranty issue",
    "Fully documented service records kept in our system",
    "Local service backing right here on Euclid Ave",
  ],
  faqs: [
    {
      q: "What does the 12-month parts / 90-day labor warranty cover?",
      a: "It covers the parts we supplied for 12 months and the labor we performed for 90 days from the original service date. If a part we installed fails due to defect or our workmanship during that period, we replace it and perform the labor at zero cost to you.",
    },
    {
      q: "Do used tires have a warranty?",
      a: "Used tires carry a 7-day limited replacement warranty covering verified air loss or internal tire failure from a defect present at time of sale only — it does not cover road hazard, punctures, or impact damage. Every used tire also passes our rigorous 4-point safety inspection (tread depth, sidewalls, bead, and DOT age date) before installation.",
    },
    {
      q: "Is the warranty nationwide?",
      a: "Our warranty is serviced locally at our shop at 17625 Euclid Ave in Cleveland. If you experience an issue, pull right up and we will take care of it as a first priority.",
    },
    {
      q: "Do you offer road hazard warranty on new tires?",
      a: "Yes! We offer optional road hazard protection packages on new tires that cover tire replacement or repair if you run over a nail, hit a pothole, or experience other road hazards.",
    },
  ],
  bookingService: "general-repair",
  serviceType: "Warranty Information",
};

export default function WarrantiesPage() {
  return <FocusedServicePage config={CONFIG} />;
}
