/**
 * Third-party payment providers accepted by Nick's Tire & Auto.
 *
 * Customer-facing rule: describe the product each provider actually offers.
 * Do not collapse lease-to-own, installment credit, and loans into generic
 * "financing," and do not promise approval, a fixed initial payment, a credit
 * outcome, or a promotional payoff result. The provider agreement controls.
 *
 * Last truth review: 2026-07-16 against provider-published disclosures.
 */

export interface FinancingProvider {
  id: string;
  name: string;
  shortName: string;
  type: "lease_to_own" | "revolving_credit" | "installment";
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
  disclosure: string;
}

export const FINANCING_PROVIDERS: FinancingProvider[] = [
  {
    id: "acima",
    name: "Acima",
    shortName: "Acima",
    type: "lease_to_own",
    typeLabel: "Lease-to-Own",
    color: "#00B2A9",
    highlight: "Up to $5,000 for qualifying applicants",
    maxAmount: "Up to $5,000",
    approvalTime: "Usually fast; provider decision",
    creditCheck: "Uses consumer-reporting and other application data",
    termRange: "Terms shown in your lease agreement",
    features: [
      "Apply online; some approval amounts may require an in-store application",
      "Early purchase options may reduce the total cost",
      "Payment schedule and total cost are shown before you sign",
      "The standard lease path can cost substantially more than the cash price",
    ],
    applyUrl: "https://apply.acima.com/?app_id=lo&location_guid=loca-436877bd-bae3-482b-8d6c-21430690117f&utm_medium=merchant&utm_source=web",
    merchantPortalUrl: "https://merchant.acima.com/",
    customerPortalUrl: "https://my.acima.com/",
    description: "Acima offers lease-to-own purchasing. It is not a loan or credit product. Approval, initial payment, taxes, fees, and early-purchase terms vary by application and location.",
    howItWorks: [
      "Complete Acima's application",
      "Review the amount and terms Acima offers",
      "Choose an eligible repair or tire purchase at Nick's",
      "Read and sign the provider agreement before work begins",
    ],
    idealFor: "Customers comparing a lease-to-own option",
    badge: "Lease-to-Own",
    disclosure: "Acima is a lease-to-own provider, not a lender. Not all applicants are approved. A $10 start is available only in select circumstances and does not include taxes or other charges. Review the agreement for total cost and early-purchase terms.",
  },
  {
    id: "snap",
    name: "Snap Finance",
    shortName: "Snap",
    type: "installment",
    typeLabel: "Lease-to-Own / Installment Options",
    color: "#FF6B00",
    highlight: "$300-$5,000 for qualifying applicants",
    maxAmount: "$300-$5,000",
    approvalTime: "Decision may be available in seconds",
    creditCheck: "No impact to FICO score; other consumer-report scores may be affected",
    termRange: "Varies by product and agreement",
    features: [
      "Online application designed to take only a few minutes",
      "Product offered may be lease-to-own or an installment arrangement",
      "Promotional payoff periods and charges vary by merchant and product",
      "All payment amounts and total cost appear in the agreement",
    ],
    applyUrl: "https://getsnap.snapfinance.com/lease/en-US/consumer/apply?ep=store-locator&merchantId=490295617&externalMerchantId=77661",
    merchantPortalUrl: "https://merchant.snapfinance.com/",
    customerPortalUrl: "https://my.snapfinance.com/",
    description: "Snap offers several payment products. The exact product, approval amount, payment schedule, promotional period, and cost depend on the application and agreement.",
    howItWorks: [
      "Complete Snap's application",
      "Review the product, approval amount, and payment schedule offered",
      "Use the approved amount for an eligible purchase at Nick's",
      "Confirm the total cost and promotional terms before signing",
    ],
    idealFor: "Customers comparing a fast online payment application",
    badge: "Multiple Products",
    disclosure: "Applying does not affect your FICO score, but Snap may obtain information from consumer-reporting agencies and another consumer-report score may be affected. Approval is not guaranteed. Promotional terms vary.",
  },
  {
    id: "koalafi",
    name: "Koalafi",
    shortName: "Koalafi",
    type: "installment",
    typeLabel: "Lease-to-Own / Lending Options",
    color: "#5B21B6",
    highlight: "Up to $7,500 for qualifying applicants",
    maxAmount: "Up to $7,500",
    approvalTime: "Provider decision after application",
    creditCheck: "Looks beyond a credit score; payment history may be reported",
    termRange: "Varies by product and agreement",
    features: [
      "Published approval amounts up to $7,500 for qualifying applicants",
      "May offer lease-to-own or a lending product depending on eligibility",
      "Early-purchase or payoff options may reduce total cost",
      "Positive and negative payment history may be reported to credit bureaus",
    ],
    applyUrl: "https://s.koalafi.com/GWPaPM",
    merchantPortalUrl: "https://merchant.koalafi.com/",
    customerPortalUrl: "https://my.koalafi.com/",
    description: "Koalafi offers lease-to-own and lending solutions. The product, amount, payment schedule, reporting, and total cost depend on the application and agreement.",
    howItWorks: [
      "Complete Koalafi's application",
      "Review the product and amount offered",
      "Choose an eligible purchase at Nick's",
      "Review payment reporting, payoff, and total-cost terms before signing",
    ],
    idealFor: "Customers whose repair may require a higher approval amount",
    badge: "Up to $7,500",
    disclosure: "Up to $7,500 is available only to qualifying applicants. Koalafi may offer lease-to-own or lending products and may report payment history. Approval and terms are not guaranteed.",
  },
  {
    id: "american-first",
    name: "American First Finance",
    shortName: "American First",
    type: "installment",
    typeLabel: "Loan / Retail Installment / Lease Options",
    color: "#1E40AF",
    highlight: "Multiple product types; terms vary",
    maxAmount: "Amount determined by provider",
    approvalTime: "May be immediate or require additional review",
    creditCheck: "Credit and consumer-report information may be checked",
    termRange: "Varies by product and agreement",
    features: [
      "May offer a loan, retail installment agreement, or lease-to-own product",
      "Approval and same-day decision are not guaranteed",
      "Early payoff or buyout options may be available",
      "Review APR or lease cost, payment frequency, and total of payments carefully",
    ],
    applyUrl: "https://americanfirstfinance.com/app/?dealer=25207&loc=1&src=UA&usetextpin=Y",
    customerPortalUrl: "https://www.americanfirstfinance.com/",
    description: "American First Finance may offer different product types. Rates or lease costs can be high, so compare the total of payments and early-payoff terms before signing.",
    howItWorks: [
      "Complete American First Finance's application",
      "Wait for the provider's decision or any requested follow-up",
      "Review the exact product, payment amount, and total cost",
      "Sign only after the agreement fits your budget",
    ],
    idealFor: "Customers comparing another third-party payment provider",
    badge: "Alternative Option",
    disclosure: "American First Finance may check credit and consumer-report information. Approval and same-day decisions are not guaranteed. Product examples published by the provider can carry very high APRs or total lease costs; the agreement controls.",
  },
];

/** Quick-access map by provider ID */
export const PROVIDER_MAP = Object.fromEntries(
  FINANCING_PROVIDERS.map((provider) => [provider.id, provider])
) as Record<string, FinancingProvider>;

/** Accepted payment methods at Nick's */
export const PAYMENT_METHODS = [
  "Cash",
  "Visa / Mastercard / Discover / Amex",
  "Debit Cards",
  "Apple Pay / Google Pay",
  "Acima Lease-to-Own",
  "Snap Finance",
  "Koalafi",
  "American First Finance",
] as const;

/** Customer-facing payment-option FAQ items. */
export const FINANCING_FAQ = [
  {
    q: "Does Nick's approve the application?",
    a: "No. Acima, Snap, Koalafi, and American First Finance are independent third-party providers. Each provider decides whether to approve an application and sets the product, amount, payment schedule, fees, and total cost.",
  },
  {
    q: "Is every option a loan?",
    a: "No. Some offers are lease-to-own, while others may be loans or retail installment agreements. Those products work differently. Read the product type and total-of-payments disclosure before signing.",
  },
  {
    q: "Will applying affect my credit?",
    a: "It depends on the provider and product. Snap says applying does not affect your FICO score, although another consumer-report score may be affected. American First Finance may check credit. Koalafi may report payment history. Review each provider's application disclosure before submitting.",
  },
  {
    q: "How much could I be approved for?",
    a: "Published maximums include up to $5,000 with Acima, $300-$5,000 with Snap, and up to $7,500 with Koalafi for qualifying applicants. American First Finance determines its offered amount after application. Maximums are not guarantees.",
  },
  {
    q: "Is $10 down guaranteed?",
    a: "No. Acima advertises a $10 start only in select circumstances, and taxes or other charges may still be due. Initial payment requirements vary by provider, product, approval, purchase, and agreement.",
  },
  {
    q: "Can I pay early and save money?",
    a: "Many agreements include an early-purchase, buyout, or payoff option that can reduce total cost. The deadline, required additional payments, and savings vary. Ask the provider for the exact payoff amount and date in writing.",
  },
  {
    q: "Can I apply before coming to the shop?",
    a: "Yes. Use the provider links on this page to apply directly. For the most accurate repair amount, Nick's can inspect the vehicle first and give you a written estimate before you choose a payment option.",
  },
] as const;
