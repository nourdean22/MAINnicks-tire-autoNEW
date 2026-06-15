import FocusedServicePage, { type ServicePageConfig } from "@/components/FocusedServicePage";

const CONFIG: ServicePageConfig = {
  canonicalPath: "/tire-rebates",
  title: "Tire Rebates & Deals Cleveland — Save on Major Brands | Nick's",
  description: "Find current tire rebates, promotions, and deals on Michelin, Goodyear, Bridgestone, and Cooper tires in Cleveland. Walk in 7 days.",
  eyebrow: "TIRE REBATES & DEALS · SAVE BIG",
  h1: "MANUFACTURER TIRE REBATES\n& ACTIVE PROMOTIONS.",
  sub: "Get cash back on your new set of tires. We coordinate directly with major manufacturers to pass national rebate promotions straight to you. Save up to $100+ on Michelin, Goodyear, Bridgestone, Continental, and more. Walk in or drop off on Euclid Ave.",
  startingPrice: "Active savings programs",
  pricingTitle: "REBATE PROGRAMS",
  pricingSub: "Typical manufacturer rebate values on a set of 4 new tires.",
  tiers: [
    {
      name: "Tier 1 Brands",
      price: "Up to $100 back",
      sub: "Michelin & Bridgestone",
      use: "Available during seasonal manufacturer promotions on sets of four select tires.",
      featured: true,
    },
    {
      name: "Tier 2 Brands",
      price: "Up to $80 back",
      sub: "Goodyear & Continental",
      use: "Mail-in or online submission rebates available periodically throughout the year.",
    },
    {
      name: "Tier 3 Brands",
      price: "Up to $60 back",
      sub: "Cooper & Firestone",
      use: "Standard rebates on popular passenger, SUV, or light truck tires.",
    },
  ],
  includedTitle: "HOW IT WORKS",
  includedSub: "We make it easy to submit your rebate and get your money back.",
  included: [
    "We provide the official manufacturer rebate form at checkout",
    "We print a dedicated, itemized invoice with all required purchase details",
    "Instructions provided for online or mail-in submissions",
    "Free alignment check included with every new tire set",
    "Mounting, balancing, and new valve stems completed in-shop",
    "Rebate deadlines tracked so you never miss a submission window",
  ],
  faqs: [
    {
      q: "How do I claim a tire rebate?",
      a: "When you purchase a qualifying set of 4 new tires, we hand you the rebate form and invoice. You can submit either by mail or online at the manufacturer's rebate website (such as Michelin or Goodyear) using the receipt we print for you. You will receive a prepaid card or check in the mail from the manufacturer.",
    },
    {
      q: "Can I combine rebates with financing/payment programs?",
      a: "Yes! You can use our payment programs (like Snap, Acima, or Koalafi) to purchase the tires and still submit the manufacturer rebate to get your cash back. The manufacturer only requires proof of purchase of the tires.",
    },
    {
      q: "How long does it take to get my rebate?",
      a: "Most manufacturers process and send out the rebate (usually as a prepaid Visa card) within 6 to 8 weeks after you submit the online or mail-in form.",
    },
    {
      q: "Do used tires qualify for rebates?",
      a: "No, used tires do not qualify for manufacturer rebates. Rebates are national promotions run directly by tire manufacturers (Michelin, Goodyear, etc.) to promote their brand-new tire lines.",
    },
  ],
  bookingService: "tires",
  serviceType: "Tire Rebates & Promotions",
};

export default function TireRebatesPage() {
  return <FocusedServicePage config={CONFIG} />;
}
