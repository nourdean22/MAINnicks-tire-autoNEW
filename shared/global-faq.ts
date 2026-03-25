/**
 * Global FAQ questions that appear on every service/page-level FAQ schema.
 * These were previously in client/index.html as a separate FAQPage schema block,
 * but Google requires exactly ONE FAQPage schema per page. Now they get merged
 * into each page's FAQPage schema instead.
 */
export const GLOBAL_FAQ_QUESTIONS = [
  {
    "@type": "Question" as const,
    name: "Can I buy tires online from Nick's Tire & Auto?",
    acceptedAnswer: {
      "@type": "Answer" as const,
      text: "Yes. Visit autonicks.com/tires to search by tire size, compare options from major brands, and place your order online. Every tire purchase includes our free Premium Installation Package ($289+ value) with mounting, balancing, valve stems, TPMS reset, alignment check, and a 20-point safety inspection.",
    },
  },
  {
    "@type": "Question" as const,
    name: "How much does flat tire repair cost at Nick's Tire & Auto?",
    acceptedAnswer: {
      "@type": "Answer" as const,
      text: "Flat tire repair at Nick's Tire & Auto costs $15 to $25. Most repairs are done in about 15 minutes using professional plug and patch methods. We will never sell you a new tire if your current tire can be safely repaired.",
    },
  },
  {
    "@type": "Question" as const,
    name: "Do you sell used tires?",
    acceptedAnswer: {
      "@type": "Answer" as const,
      text: "Yes. We carry a large selection of quality used tires. Every used tire is inspected for tread depth, sidewall condition, and safety before it goes on your vehicle. Used tires include the same professional installation service. Walk-ins welcome — inventory changes daily.",
    },
  },
  {
    "@type": "Question" as const,
    name: "What is included in the free installation package?",
    acceptedAnswer: {
      "@type": "Answer" as const,
      text: "Nick's Premium Installation Package includes 15 services at no extra charge: professional mounting, computer balancing, new rubber valve stems, TPMS sensor reset, alignment check, 20-point safety inspection, rim cleaning and degreasing, tire disposal and recycling, lug nut torque to spec, tire pressure optimization, brake visual inspection, suspension visual check, tread depth documentation, free flat repair for the first 12 months, and free tire rotation for the first year.",
    },
  },
  {
    "@type": "Question" as const,
    name: "What areas does Nick's Tire & Auto serve?",
    acceptedAnswer: {
      "@type": "Answer" as const,
      text: "Nick's Tire & Auto is located at 17625 Euclid Ave, Cleveland, OH 44112. We serve Cleveland, Euclid, Lakewood, Parma, East Cleveland, Shaker Heights, Cleveland Heights, South Euclid, Garfield Heights, Mentor, Strongsville, and all of Northeast Ohio.",
    },
  },
];
