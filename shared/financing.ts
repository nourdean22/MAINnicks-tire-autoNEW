/**
 * Financing provider constants — single source of truth.
 * Used by the customer-facing Financing page, admin dashboard, and sheets sync.
 */

export interface FinancingProvider {
  id: string;
  name: string;
  shortName: string;
  type: "lease-to-own" | "bnpl" | "credit-card";
  typeLabel: string;
  color: string;           // brand color hex
  highlight: string;       // main selling point
  maxAmount: string;       // e.g. "$5,000"
  approvalTime: string;    // e.g. "60 seconds"
  creditCheck: string;     // e.g. "No hard pull"
  termRange: string;       // e.g. "12–24 months"
  features: string[];
  applyUrl: string;        // customer application URL
  prequalifyUrl?: string;  // pre-qualification URL if available
  merchantPortalUrl: string;
  customerPortalUrl: string;
  description: string;     // 1–2 sentence summary
  howItWorks: string[];    // step-by-step for customers
  idealFor: string;        // who this option is best for
  badge?: string;          // e.g. "Most Popular", "Highest Amount"
}

export const FINANCING_PROVIDERS: FinancingProvider[] = [
  {
    id: "acima",
    name: "Acima Leasing",
    shortName: "Acima",
    type: "lease-to-own",
    typeLabel: "Lease-to-Own",
    color: "#00B894",
    highlight: "No credit needed — approval in seconds",
    maxAmount: "$5,000",
    approvalTime: "60 seconds",
    creditCheck: "No traditional credit check",
    termRange: "12 months",
    features: [
      "No credit needed to apply",
      "Up to $5,000 in lease-to-own purchasing power",
      "Apply online, in-app, or in-store",
      "Early buyout options available",
      "90-day same-as-cash option",
      "Flexible payment schedules",
    ],
    applyUrl: "https://www.acima.com/en/applicationprocess",
    merchantPortalUrl: "https://merchant.acima.com",
    customerPortalUrl: "https://customer.acima.com",
    description: "Acima offers lease-to-own financing with no credit needed. Get approved in seconds and pay for your repairs over time with flexible monthly payments.",
    howItWorks: [
      "Apply online or at the counter — takes about 60 seconds",
      "Get approved for up to $5,000 with no traditional credit check",
      "We complete your repair and Acima covers the cost",
      "You make easy monthly lease payments directly to Acima",
    ],
    idealFor: "Customers who want flexible payments without a credit check",
    badge: "No Credit Needed",
  },
  {
    id: "snap",
    name: "Snap Finance",
    shortName: "Snap",
    type: "lease-to-own",
    typeLabel: "Lease-to-Own",
    color: "#1B5E20",
    highlight: "Apply in minutes — decision in seconds",
    maxAmount: "$5,000",
    approvalTime: "Seconds",
    creditCheck: "No credit needed",
    termRange: "12–24 months",
    features: [
      "No credit needed to apply",
      "$300 to $5,000 in lease-to-own financing",
      "Get a decision in seconds",
      "Apply online, in-app, or in-store",
      "Easy monthly payments",
      "Early payoff available with savings",
    ],
    applyUrl: "https://snapfinance.com/",
    merchantPortalUrl: "https://merchant.snapfinance.com",
    customerPortalUrl: "https://customer.snapfinance.com",
    description: "Snap Finance provides lease-to-own financing with no credit needed. Apply from your phone and get a decision in seconds for up to $5,000.",
    howItWorks: [
      "Apply online or on your phone — takes just a few minutes",
      "Get a decision in seconds for up to $5,000",
      "We fix your vehicle and Snap Finance covers the cost",
      "You make manageable monthly payments to Snap",
    ],
    idealFor: "Customers who prefer a fast mobile-friendly application",
  },
  {
    id: "koalafi",
    name: "Koalafi",
    shortName: "Koalafi",
    type: "lease-to-own",
    typeLabel: "Lease-to-Own",
    color: "#6C63FF",
    highlight: "Up to $7,500 — highest approval amount",
    maxAmount: "$7,500",
    approvalTime: "10 seconds",
    creditCheck: "No traditional credit check",
    termRange: "12–24 months",
    features: [
      "Up to $7,500 in lease-to-own financing",
      "Highest approval amount available",
      "Apply online or at the shop in seconds",
      "No traditional credit check required",
      "Flexible payment options",
      "Early buyout discounts available",
    ],
    applyUrl: "https://koalafi.com/for-customers/",
    merchantPortalUrl: "https://koalafi.com/",
    customerPortalUrl: "https://koalafi.com/for-customers/",
    description: "Koalafi offers the highest lease-to-own approval amount at up to $7,500. Perfect for larger repairs like engine work, transmission, or full brake jobs.",
    howItWorks: [
      "Fill out a short application online or at the counter",
      "Get approved in as little as 10 seconds for up to $7,500",
      "We complete the repair and Koalafi handles the payment",
      "You pay it off with affordable monthly payments",
    ],
    idealFor: "Larger repairs that need more than $5,000 in financing",
    badge: "Highest Amount",
  },
  {
    id: "americanfirst",
    name: "American First Finance",
    shortName: "American First",
    type: "lease-to-own",
    typeLabel: "Lease-to-Own",
    color: "#1A5276",
    highlight: "Wide approval range — multiple payment options",
    maxAmount: "$5,000",
    approvalTime: "60 seconds",
    creditCheck: "No traditional credit check",
    termRange: "12-24 months",
    features: [
      "Wide approval range for all credit types",
      "Apply in 60 seconds — in store or online",
      "No traditional credit check — does not hit the Big 3 bureaus",
      "Multiple payment plan options",
      "Early payoff with no penalties",
      "Use for any auto repair or tire purchase",
    ],
    applyUrl: "https://americanfirstfinance.com/app/?dealer=25207&loc=1&src=UA&usetextpin=Y",
    prequalifyUrl: "https://americanfirstfinance.com/app/?dealer=25207&loc=1&src=UA&usetextpin=Y",
    merchantPortalUrl: "https://americanfirstfinance.com/",
    customerPortalUrl: "https://americanfirstfinance.com/",
    description: "American First Finance offers flexible lease-to-own options with a wide approval range. Apply in 60 seconds with no traditional credit check. Perfect for customers who want multiple payment options.",
    howItWorks: [
      "Apply online or in-store in 60 seconds",
      "Get approved with no traditional credit check",
      "Choose your payment plan",
      "Pay off early with no penalties",
    ],
    idealFor: "Customers who want flexible approval and multiple payment options",
    badge: "0% Interest",
  },
];

/** Quick-access map by provider ID */
export const PROVIDER_MAP = Object.fromEntries(
  FINANCING_PROVIDERS.map((p) => [p.id, p])
) as Record<string, FinancingProvider>;

/** Accepted payment methods at Nick's */
export const PAYMENT_METHODS = [
  "Cash",
  "Visa / Mastercard / Discover / Amex",
  "Debit Cards",
  "Apple Pay / Google Pay",
  "Acima Lease-to-Own",
  "Snap Finance",
  "Koalafi Lease-to-Own",
  "American First Finance Car Care Card",
] as const;

/** Financing FAQ items */
export const FINANCING_FAQ = [
  {
    q: "Do I need good credit to get approved?",
    a: "Not necessarily. Acima, Snap Finance, and Koalafi all offer lease-to-own options with no traditional credit check. These are great options if you have limited or challenged credit. American First Finance does check credit but offers a pre-qualification with no impact to your score.",
  },
  {
    q: "How much can I get approved for?",
    a: "Approval amounts vary by provider: Acima and Snap Finance offer up to $5,000, Koalafi offers up to $7,500, and American First Finance credit limits are based on your individual approval. Most customers get approved for enough to cover common repairs.",
  },
  {
    q: "How long does the application take?",
    a: "All four providers offer fast applications. Most take 1–2 minutes to fill out, and you get a decision in seconds. You can apply online from your phone or at the shop counter.",
  },
  {
    q: "Can I apply for financing before I come in?",
    a: "Yes! All four providers allow online applications. Get pre-approved before your visit so you know your budget when you arrive. Just click any Apply button on this page to start.",
  },
  {
    q: "What if I need a repair I cannot afford right now?",
    a: "That is exactly what financing is for. Do not delay safety repairs like brakes or tires because of cost. Apply for financing and get your vehicle fixed today — you can pay over time with manageable monthly payments.",
  },
  {
    q: "Is there a down payment required?",
    a: "Most lease-to-own options (Acima, Snap, Koalafi) require a small initial payment. The American First Finance credit card has no down payment — you just make monthly payments on your balance.",
  },
  {
    q: "Can I pay off my financing early?",
    a: "Yes. All four providers allow early payoff. Acima offers a 90-day same-as-cash option, and Snap and Koalafi offer early buyout discounts. American First Finance has no early payment penalties.",
  },
] as const;
