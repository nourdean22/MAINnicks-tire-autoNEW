/**
 * NoCreditCheckTiresPage — SEO landing for the "no credit check tires
 * Cleveland" search, answered honestly.
 *
 * wave-181.5 built this page to capture a chain-free SERP. It did that by
 * promising what the providers do not: "no credit check", "doesn't pull
 * credit", "soft pre-qualification on all four", "decision in 60 seconds",
 * "90-day same-as-cash", "most customers approve up to $5,000", plus an
 * unsourced competitor down-payment table and accident-cost stats.
 *
 * 2026-10-01 rewrite. Koalafi's own site says "we check your credit", and
 * American First Finance says "credit may be checked", so the old headline
 * was false for half the providers. The page keeps the URL and the search
 * phrase (as a question it answers) and now says what is true: some programs
 * don't need established credit, every provider reviews the application and
 * decides approval, and the agreement shows the total cost. Provider facts
 * come from shared/financing.ts, prices from BUSINESS, and the claim.* rules
 * in shared/voice.ts block the old promises from coming back.
 */

import FocusedServicePage, { type ServicePageConfig } from "@/components/FocusedServicePage";
import { BUSINESS } from "@shared/business";
import { FINANCING_PROVIDERS, PAYMENT_PROGRAMS_SHORT } from "@shared/financing";
import { Disc, DollarSign, ShieldCheck } from "lucide-react";

const USED = BUSINESS.usedTires;

const CONFIG: ServicePageConfig = {
  canonicalPath: "/no-credit-check-tires-cleveland",
  heroImage: "/photos/shopfront-clear-vertical-sign-bays.webp",
  // Title and description mirror shared/routes.ts so the prerendered head and
  // the live SPA agree. The search phrase stays, as a question this page answers.
  title: "No Credit Check Tires Cleveland? Straight Answers | Nick's",
  description: "Searching for no credit check tires? Straight answer: all 4 payment providers review applications, but some don't need established credit. Walk in 7 days.",
  eyebrow: "TIRE PAYMENT OPTIONS · CLEVELAND",
  h1: "SEARCHING FOR NO CREDIT CHECK TIRES?\nHERE'S THE STRAIGHT ANSWER.",
  sub: `Every payment provider we work with reviews your application. Koalafi says it checks credit, and American First Finance says credit may be checked. What some of them don't need is established credit. The provider decides approval and terms, and you see the total cost before you sign. Used tires ${USED.priceDisplay} (${USED.fineprint}; ${USED.typicalBand}). New ${BUSINESS.newTires.priceDisplay}.`,
  startingPrice: "4 payment providers · each decides approval",
  pricingTitle: "WHAT A SET OF TIRES COSTS AT NICK'S",
  pricingSub: "Out-the-door pricing: mount, balance, valve stems, TPMS reset and alignment check included. A payment program can spread the cost; its agreement shows the total before you sign.",
  tiers: [
    {
      name: "Used Set of 4",
      // FocusedServicePage turns tier.price into Offer JSON-LD by stripping
      // non-digits, so a range here would publish "160320". One floor only.
      price: "From $160",
      sub: `${USED.typicalBand}; from $25 on ${USED.fineprint}`,
      use: "DOT-dated tires with measured tread depth. The honest used tire that gets you legal and through a Cleveland winter.",
    },
    {
      name: "New Set of 4",
      price: "From $356",
      sub: `${BUSINESS.newTires.priceDisplay} per tire`,
      use: "Fresh tread. Tell us your budget and we'll show you what fits it.",
      featured: true,
    },
    {
      name: "Tires + Brakes",
      price: "Free estimate",
      sub: "One written estimate for both",
      use: "Brakes squealing on the way over? We check them free and put both jobs on one written estimate before any work, so you apply for the right amount.",
    },
  ],
  includedTitle: "HOW THE FOUR PAYMENT PROGRAMS WORK",
  includedSub: "Four independent providers. Each runs its own application and sets its own terms.",
  // Straight from shared/financing.ts, so this list cannot drift from /financing.
  included: [
    ...FINANCING_PROVIDERS.map((p) => `${p.name} (${p.typeLabel}): ${p.creditCheck}`),
    "Initial payment varies by provider and agreement. Acima's $10 start is offered only in select circumstances",
    "Early purchase or payoff options can lower the total cost; the agreement controls",
    "You see the payment schedule and total cost before you sign",
    "We inspect the car and write the estimate first, so you apply for the right amount",
  ],
  faqs: [
    {
      q: "Can I get tires with no credit check?",
      a: "Yes, if you pay cash or card. With a payment program, every provider reviews your application: Acima uses consumer-report data, Snap says applying won't affect your FICO score but may affect another consumer-report score, Koalafi says it checks credit through alternative credit bureaus, and American First Finance may check credit. What some of them don't need is an established credit history. Apply, see what the provider offers, and decide.",
    },
    {
      q: "Will applying hurt my credit score?",
      a: "It depends on the provider. Snap says applying won't affect your FICO score, though another consumer-report score may be affected. Koalafi says its check runs through alternative bureaus and doesn't touch your FICO score, though it may change your score at those bureaus, and that it reports lease payments to TransUnion. American First Finance may run soft and hard credit checks. Read each provider's disclosure before you submit.",
    },
    {
      q: "What's the catch?",
      a: "A payment program costs more than paying cash if you run the full term. Early purchase or payoff options can lower the total; the deadline and the savings vary by provider and agreement. The agreement shows the payment schedule and the total cost before you sign. Read it, and ask us anything.",
    },
    {
      q: "Can I use a payment program on used tires?",
      a: `Ask at the counter: each provider decides which purchases qualify. Used tires are ${USED.priceDisplay} (${USED.fineprint}; ${USED.typicalBand}), so many customers pay for a used set outright.`,
    },
    {
      q: "How is this different from your /financing page?",
      a: "Same four providers. /financing compares them side by side with each one's disclosure. This page answers the 'no credit check tires' search directly.",
    },
    {
      q: "What if no provider approves me?",
      a: `It happens. We'll tell you straight and walk through what's left: a smaller or used set you can pay for today, or replacing the most urgent tire first. We're here ${BUSINESS.hours.display}.`,
    },
    {
      q: "How fast is the decision?",
      a: "That's the provider's call, not ours. Snap says a decision may be available in seconds; other providers can take longer, and some applications need more review.",
    },
    {
      q: "Do I need an appointment?",
      a: `No. First come, first served, 7 days a week. Walk in or drop off at ${BUSINESS.address.full}.`,
    },
  ],
  bookingService: "tires",
  serviceType: "Tire Sales & Installation",
  ctaHeadline: "APPLY WITH THE PROVIDER · SEE YOUR TERMS FIRST",
  ctaSub: `${PAYMENT_PROGRAMS_SHORT}. Apply online or at the counter. Call ${BUSINESS.phone.display} or walk in to ${BUSINESS.address.full}.`,

  crossSell: {
    heading: "Want the full provider comparison? Got brakes too?",
    items: [
      {
        tone: "info",
        symptom: "I want to compare all four providers.",
        consequence: "The products differ: lease-to-own, installment and loan options cost different amounts over the term.",
        relief: "Our /financing page lays out each provider's product type, published maximum and disclosure side by side.",
        ctaLabel: "Compare the providers",
        ctaHref: "/financing",
        icon: <DollarSign className="w-5 h-5" />,
      },
      {
        tone: "warning",
        symptom: "Brakes also squealing on the way over?",
        consequence: "Applying once for the full job beats a second application later.",
        relief: "We run the free brake check while we're looking at your tires, then write one estimate for both.",
        ctaLabel: "Brake check — free",
        ctaHref: "/brakes",
        icon: <Disc className="w-5 h-5" />,
      },
      {
        tone: "info",
        symptom: "I'm not sure what credit I have or whether I'll qualify.",
        consequence: "Nobody can tell you that before you apply, including us.",
        relief: "Each provider's disclosure says how it checks credit. Read it, apply with the one that fits, and see the offer before you sign anything.",
        ctaLabel: "Call the shop",
        ctaHref: BUSINESS.phone.href,
        icon: <ShieldCheck className="w-5 h-5" />,
      },
    ],
  },
};

export default function NoCreditCheckTiresPage() {
  return <FocusedServicePage config={CONFIG} />;
}
