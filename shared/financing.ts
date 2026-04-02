/**
 * Financing Providers — All financing options for Nick's Tire & Auto
 * Updated: American First Finance replaced Synchrony
 */

export interface FinancingProvider {
  id: string;
  name: string;
  shortName: string;
  type: "lease-to-own" | "credit-card" | "installment";
  typeLabel: string;
  color: string;
  highlight: string;
  maxAmount: string;
  approvalTime: string;
  creditCheck: string;
  termRange: string;
  features: string[];
  applyUrl: string;
  prequalifyUrl?: string;
  merchantPortalUrl?: string;
  customerPortalUrl?: string;
  description: string;
  howItWorks: string[];
  idealFor: string;
  badge: string;
}

export const FINANCING_PROVIDERS: FinancingProvider[] = [
  {
    id: "acima",
    name: "Acima Credit",
    shortName: "Acima",
    type: "lease-to-own",
    typeLabel: "Lease-to-Own",
    color: "#00B2A9",
    highlight: "90-day same-as-cash option",
    maxAmount: "Up to $5,000",
    approvalTime: "Seconds",
    creditCheck: "No traditional credit check",
    termRange: "12 months",
    features: [
      "No credit needed — uses bank history instead",
      "90-day same-as-cash: pay within 90 days and pay no more than the cash price",
      "Early buyout available at any time",
      "Apply online or in-store",
      "Quick digital lease agreement",
      "Use at any participating retailer",
    ],
    applyUrl: "https://acima.us/1TjEOYtr6C",
    merchantPortalUrl: "https://merchant.acima.com/",
    customerPortalUrl: "https://my.acima.com/",
    description: "Acima offers lease-to-own financing with no traditional credit check. Get approved using your bank account history and enjoy a 90-day same-as-cash option.",
    howItWorks: [
      "Fill out a quick application (2 minutes)",
      "Get approved using your bank account history — no hard credit pull",
      "Choose your payment schedule (weekly, bi-weekly, or monthly)",
      "Enjoy 90-day same-as-cash — pay early and save",
    ],
    idealFor: "Customers with limited or no credit who want a same-as-cash option",
    badge: "90-Day Cash",
  },
  {
    id: "snap",
    name: "Snap Finance",
    shortName: "Snap",
    type: "lease-to-own",
    typeLabel: "Lease-to-Own",
    color: "#FF6B00",
    highlight: "100-day same-as-cash",
    maxAmount: "Up to $5,000",
    approvalTime: "Seconds",
    creditCheck: "No traditional credit check",
    termRange: "12 months",
    features: [
      "No credit needed — everyone is welcome to apply",
      "100-day early buyout option",
      "Flexible payment schedules",
      "Apply in 60 seconds from your phone",
      "Fast approval decision",
      "Easy online account management",
    ],
    applyUrl: "https://getsnap.snapfinance.com/lease/en-US/consumer/apply/landing",
    merchantPortalUrl: "https://merchant.snapfinance.com/",
    customerPortalUrl: "https://my.snapfinance.com/",
    description: "Snap Finance makes it easy to get the auto repairs you need with no traditional credit check. Apply in seconds and enjoy flexible payment options.",
    howItWorks: [
      "Apply online or at the counter (60 seconds)",
      "Get approved — no hard credit check required",
      "Pick your payment plan (weekly or bi-weekly)",
      "Get your car fixed today, pay over time",
    ],
    idealFor: "Quick approval with no credit requirements and flexible payments",
    badge: "Easiest Approval",
  },
  {
    id: "koalafi",
    name: "Koalafi",
    shortName: "Koalafi",
    type: "lease-to-own",
    typeLabel: "Lease-to-Own",
    color: "#5B21B6",
    highlight: "Up to $7,500 for larger repairs",
    maxAmount: "Up to $7,500",
    approvalTime: "Seconds",
    creditCheck: "No traditional credit check",
    termRange: "12-24 months",
    features: [
      "Up to $7,500 — highest approval amount",
      "No traditional credit check required",
      "Multiple early buyout options with savings",
      "Apply online or in-store",
      "Longer terms available for larger repairs",
      "Low initial payment to get started",
    ],
    applyUrl: "https://s.koalafi.com/GWPaPM",
    merchantPortalUrl: "https://merchant.koalafi.com/",
    customerPortalUrl: "https://my.koalafi.com/",
    description: "Koalafi offers the highest approval amounts of our lease-to-own options — up to $7,500. Perfect for larger repairs like engine work, transmissions, or multiple services.",
    howItWorks: [
      "Fill out a quick application online or in-store",
      "Get approved for up to $7,500 — no credit check",
      "Choose your payment schedule",
      "Pay off early to save with buyout discounts",
    ],
    idealFor: "Larger repairs that need more than $5,000 in financing",
    badge: "Highest Amount",
  },
  {
    id: "american-first",
    name: "American First Finance",
    shortName: "American First",
    type: "lease-to-own",
    typeLabel: "Lease-to-Own",
    color: "#1E40AF",
    highlight: "No credit needed — fast approval",
    maxAmount: "Up to $5,000",
    approvalTime: "Minutes",
    creditCheck: "No traditional credit check",
    termRange: "12 months",
    features: [
      "No credit needed — uses alternative underwriting",
      "90-day same-as-cash option available",
      "Early payoff with no penalties",
      "Apply online or in-store in minutes",
      "Flexible payment schedules",
      "Accepted at Nick's Tire & Auto",
    ],
    applyUrl: "https://americanfirstfinance.com/app/?dealer=25207&loc=1&src=UA&usetextpin=Y",
    customerPortalUrl: "https://www.americanfirstfinance.com/",
    description: "American First Finance offers lease-to-own financing with no traditional credit check. Get approved fast and pay over time with flexible terms.",
    howItWorks: [
      "Apply online or at the shop counter",
      "Get a fast approval decision — no hard credit pull",
      "Choose your payment schedule (weekly, bi-weekly, or monthly)",
      "90-day same-as-cash option — pay early and save",
    ],
    idealFor: "Customers who want flexible lease-to-own with no credit requirements",
    badge: "No Credit Needed",
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
  "American First Finance",
] as const;

/** Financing FAQ items */
export const FINANCING_FAQ = [
  {
    q: "Do I need good credit to get approved?",
    a: "Not necessarily. All four of our financing providers — Acima, Snap Finance, Koalafi, and American First Finance — offer lease-to-own options with no traditional credit check. These are great options if you have limited or challenged credit.",
  },
  {
    q: "How much can I get approved for?",
    a: "Approval amounts vary by provider: Acima and Snap Finance offer up to $5,000, Koalafi offers up to $7,500, and American First Finance offers up to $5,000. Most customers get approved for enough to cover common repairs.",
  },
  {
    q: "How long does the application take?",
    a: "All four providers offer fast applications. Most take 1-2 minutes to fill out, and you get a decision in seconds. You can apply online from your phone or at the shop counter.",
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
    a: "Most lease-to-own options require a small initial payment. The exact amount varies by provider and approval amount.",
  },
  {
    q: "Can I pay off my financing early?",
    a: "Yes. All four providers allow early payoff. Acima offers a 90-day same-as-cash option, Snap and Koalafi offer early buyout discounts, and American First Finance has no early payment penalties.",
  },
] as const;
