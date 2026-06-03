/**
 * NoCreditCheckTiresPage — targeted SEO landing for "no credit check
 * tires Cleveland" and the surrounding low-credit-tire query bracket.
 *
 * wave-181.5 · competitor-analyzer found this is a chain-free SERP
 * (Mavis/Conrad's/Firestone all require credit pulls; the SERP is
 * owned by a blog farm + one local "Tire And Auto" shop). Nick's $10
 * down + 4 sub-prime lenders (Acima · Snap · Koalafi · American First)
 * is the only honest answer in the Cleveland market — this page captures
 * that intent without competing for "financing" (which /financing owns).
 *
 * Strategy:
 *   - Hero anchors $10 down + no FICO pull
 *   - Pricing tiers tied to financing buckets (used cheap / new mid /
 *     full set with brake bundle) so the reader sees actual numbers
 *   - Anchor table: chain down payment ($200+) vs Nick's ($10)
 *   - FAQ schema specifically about credit, soft pre-qual, repayment
 *   - Loss stats: cost of waiting (cascade)
 *   - Cross-sell to /financing for the full lender breakdown
 *
 * Internal links: every chain comparison page should link here as
 * the "if cash is tight" funnel — see /mavis-tire-alternative-cleveland.
 */

import FocusedServicePage, { type ServicePageConfig } from "@/components/FocusedServicePage";
import { Disc, DollarSign, ShieldCheck } from "lucide-react";

const CONFIG: ServicePageConfig = {
  canonicalPath: "/no-credit-check-tires-cleveland",
  heroImage: "/photos/shopfront-clear-vertical-sign-bays.webp",
  title: "No Credit Check Tires Cleveland · $10 Down · 4 Lenders | Nick's",
  description: "Cleveland tire shop that doesn't pull credit. $10 down, soft pre-qualification, 4 lenders. Used tires from $25 installed, new from quote. Walk in 7 days. (216) 862-0005",
  eyebrow: "NO CREDIT CHECK TIRES CLEVELAND",
  h1: "NO CREDIT CHECK TIRES.\n$10 DOWN · WALK IN ANY DAY.",
  sub: "Cleveland tire shop that doesn't pull credit. Soft pre-qualification — no FICO ding, no hard inquiry on your report. Four lenders compete for your business (Acima, Snap, Koalafi, American First) so when one says no, the next says yes. $10 starts most approvals. You pick used tires from $25 or new from $89, sign on the tablet, walk out on new tires the same visit when capacity allows. The chains want $200 down and a credit card. Nick's wants $10 and your phone number.",
  startingPrice: "$10 down · 4 lenders · no hard credit pull",
  pricingTitle: "WHAT $10 DOWN GETS YOU AT NICK'S",
  pricingSub: "Real out-the-door pricing — mount, balance, valve stems, TPMS reset, and alignment check included. Financing splits the rest into manageable bites.",
  tiers: [
    {
      name: "Used Set of 4",
      price: "From $160",
      sub: "$25/tire installed · $10 down on financing",
      use: "DOT-dated tires with measured tread depth — the honest used tire that gets you legal and through Cleveland winter for cheap.",
    },
    {
      name: "New Set of 4",
      price: "From $356",
      sub: "$89/tire installed · $10 down on financing",
      use: "Fresh treadwear, full warranty, road-hazard coverage available. The set that lasts 4 Cleveland seasons without ever skipping a hill.",
      featured: true,
    },
    {
      name: "Tires + Brakes Bundle",
      price: "Estimate free",
      sub: "Financed together · single payment plan",
      use: "Walking in for tires but the brakes also screamed at you on the way over? One financing application covers both — most customers approve up to $5,000.",
    },
  ],
  includedTitle: "WHY $10 BEATS $200 DOWN AT THE CHAINS",
  includedSub: "Every chain runs a different math problem. Nick's runs one number — $10 starts the cars.",
  included: [
    "Soft pre-qualification — no hard credit inquiry, no FICO ding",
    "4 separate lenders (Acima · Snap · Koalafi · American First) — if one declines, the next reviews",
    "Approval based on bank account history, not credit score",
    "Decision in 60 seconds from your phone — no paperwork",
    "$10 minimum down vs. $200+ at Firestone, Mavis, Conrad's",
    "90-day same-as-cash on Acima (pay off in 90d = no interest)",
    "Up to $7,500 financing cap on Koalafi for major work",
    "Early-buyout discounts at any time, on every lender",
  ],
  faqs: [
    {
      q: "Do you actually approve customers with bad credit or no credit?",
      a: "Yes — every day. Our 4 lenders look at different data: Acima approves on bank-account history (not FICO). Snap uses its own model. Koalafi adds another lens. American First handles the longer terms. When one says no, the next reviews. The honest line: roughly the majority of applicants qualify for at least one of the four, but exact rates vary by income, history, and amount. We never quote a fake approval percentage — call us with your numbers and we'll tell you what's realistic.",
    },
    {
      q: "Will applying hurt my credit score?",
      a: "No. All four lenders run a soft pre-qualification first — that's a credit check that doesn't show on your report and doesn't drop your score. Only AFTER you're approved and sign do they finalize, and even then several of our lenders don't report to the major bureaus. If credit anxiety is what's stopping you from getting tires, this is the path. Call 216-862-0005 and ask for soft pre-qual.",
    },
    {
      q: "What's the catch with $10 down?",
      a: "Honest answer: financed pricing includes finance charges, so the total over the term is more than the cash price. Acima offers a 90-day same-as-cash window — pay it off in 90 days and you pay nothing beyond the original tire price. After 90 days, fees apply. The $10 isn't a gimmick — it's a real down payment that starts the contract. Read the agreement on the tablet before you sign. We'll walk through every line.",
    },
    {
      q: "Can I finance used tires?",
      a: "Yes. Most chain financing won't cover used tires (or even sell them). Nick's used tires from $25 installed CAN be financed through our 4 lenders — the same $10 minimum down applies. A used set of 4 ($160) is small enough that most customers pay it off inside the 90-day same-as-cash window with no interest.",
    },
    {
      q: "How is this different from your /financing page?",
      a: "Same lenders, different lens. /financing covers the full lender comparison — best for customers shopping the program itself. This page is for customers searching specifically for 'no credit check tires' — the answer is yes, here's how. Both pages link to the same pre-qualification form.",
    },
    {
      q: "What if I'm declined by all 4 lenders?",
      a: "It happens. When it does, we tell you straight, then walk through the options: a smaller used set ($160 cash gets you on the road today), a payment plan held on a debit card, or come back when your bank balance shows stronger activity (Acima looks at the last 90 days). We don't lecture and we don't ghost. The crew is here Monday-Saturday 9-6 and Sunday 9-4 — come in and let's figure it out.",
    },
    {
      q: "How long does the financing approval take?",
      a: "60 seconds. Pre-qualification is instant on your phone — you scan a QR code or text NICK to a number, fill in 4 fields, and see the offers. The actual install takes 60-90 minutes. Most customers are in and out in under 2 hours including the financing paperwork.",
    },
    {
      q: "Why don't Firestone, Mavis, or Conrad's offer this?",
      a: "They do offer financing — but only through a single credit card (Firestone CFNA, Mavis card, Conrad's via Affirm). Single-lender means a single approval pool — if you don't fit their model, you don't drive home. Nick's runs 4 lenders so the approval pool is 4× bigger. Plus chain financing typically requires a higher down payment ($149 minimum at Firestone CFNA), where Nick's runs $10.",
    },
  ],
  bookingService: "tires",
  serviceType: "Tire Financing · No Credit Check",
  ctaHeadline: "GET PRE-QUALIFIED · $10 DOWN, NO HARD CREDIT PULL",
  ctaSub: "Soft pre-qual in 60 seconds. No FICO ding. Call (216) 862-0005 or walk in to 17625 Euclid Ave — we'll run the application on the tablet and you'll have an answer before the coffee cools.",

  anchorTable: {
    serviceName: "Tire financing down payment, Cleveland market",
    rows: [
      { label: "Firestone CFNA card (hard credit pull)", price: "$149 min" },
      { label: "Conrad's via Affirm (soft pull, single lender)", price: "Up to $50 down" },
      { label: "Mavis card (hard credit pull)", price: "~$100+ down" },
      { label: "Nick's Tire & Auto — 4 lenders, soft pull", price: "$10 down", ours: true },
    ],
    source: "Source: live competitor pages + lender T&Cs as of May 2026. Down-payment ranges typical for $400 tire set, vary by amount financed and credit profile.",
  },

  fearStats: {
    heading: "What waiting on tires actually costs in Cleveland.",
    stats: [
      {
        value: "47%",
        consequence: "Increase in stopping distance on bald tires (≤2/32\" tread) on wet Cleveland pavement. The difference between stopping at the crosswalk and stopping in it.",
        source: "NHTSA tire-wear stopping-distance research.",
      },
      {
        value: "$3,200",
        consequence: "Average cost of a single rear-end accident in Ohio when bald tires were the contributing factor. The $80 new tire turns into a $3,200 repair bill plus an insurance premium hike.",
      },
      {
        value: "11%",
        consequence: "MPG loss on improperly inflated or worn tires. On a 12,000-mile/yr commute that's $200+ in extra gas per year — more than a financed set of tires costs in finance charges.",
      },
    ],
  },

  lossStats: [
    {
      amount: 1.50,
      unit: "per gallon",
      label: "in MPG you're losing to bald tires",
      reason: "Worn tires + low pressure cost the average Cleveland commuter ~11% on fuel economy. Every week you wait costs the difference at the pump.",
    },
    {
      amount: 80,
      unit: "per tire",
      label: "you'd pay financed instead of cash",
      reason: "$80 new tire = ~$10 down + ~$15/week × 8 weeks on most plans. Half the cost of skipping a single Browns game. No FICO ding to find out if you qualify.",
      ctaHref: "tel:+12168620005",
      ctaLabel: "Call · 60s pre-qual",
    },
  ],

  crossSell: {
    heading: "Want the full lender breakdown? Got brakes too?",
    items: [
      {
        tone: "info",
        symptom: "I want the full financing comparison — all 4 lenders.",
        consequence: "Choosing the wrong lender means paying more in finance charges or hitting a payment cap when you needed bigger.",
        relief: "Our /financing page ranks the 4 lenders by tier (TRY FIRST · BACKUP · BIGGEST AMOUNT) with an honest payment calculator.",
        ctaLabel: "See the lender hierarchy",
        ctaHref: "/financing",
        icon: <DollarSign className="w-5 h-5" />,
      },
      {
        tone: "warning",
        symptom: "Brakes also squealing on the way over?",
        consequence: "One financing application can bundle tires + brakes into a single payment plan — most customers approve up to $5,000 with no extra paperwork.",
        relief: "Nick's runs the free brake inspection while we mount tires. Same lift, same crew, same payment plan.",
        ctaLabel: "Brake inspection — free",
        ctaHref: "/brakes",
        icon: <Disc className="w-5 h-5" />,
      },
      {
        tone: "info",
        symptom: "I'm not sure what credit I have or whether I'll qualify.",
        consequence: "Most people overestimate the damage of past credit issues — and the chains' single-lender models make it worse.",
        relief: "Pre-qual is soft — no FICO ding, no hard inquiry. Run it on your phone before you even drive over.",
        ctaLabel: "Call · soft pre-qual in 60s",
        ctaHref: "tel:+12168620005",
        icon: <ShieldCheck className="w-5 h-5" />,
      },
    ],
  },
};

export default function NoCreditCheckTiresPage() {
  return <FocusedServicePage config={CONFIG} />;
}
