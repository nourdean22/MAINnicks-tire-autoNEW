/**
 * Financing — Payment plans and financing options page.
 * 4 providers: Acima, Snap Finance, Koalafi, Synchrony
 * Strategy: Remove cost as a barrier. Get repairs done today, pay over time.
 */

import PageLayout from "@/components/PageLayout";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import InternalLinks from "@/components/InternalLinks";
import FadeIn from "@/components/FadeIn";
import {
  DollarSign, Phone, CheckCircle, CreditCard, ShieldCheck,
  ChevronRight, AlertCircle, Calculator, Clock, Users,
  Banknote, BadgeCheck, Zap, ArrowRight,
} from "lucide-react";
import { BUSINESS } from "@shared/business";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";

// ─── FINANCING PROVIDERS ─────────────────────────────
const FINANCING_OPTIONS = [
  {
    title: "ACIMA LEASING",
    type: "Lease-to-Own",
    highlight: "No credit needed — lease-to-own with flexible payments",
    description: "Acima offers lease-to-own solutions for customers who may not qualify for traditional financing. Get approved quickly and make payments over time. Early buyout options available to save on total cost.",
    features: [
      "No credit score required to apply",
      "90-day same-as-cash option available",
      "Flexible payment schedules (weekly, bi-weekly, monthly)",
      "Early purchase options to save money",
      "Apply online or in-store in minutes",
    ],
    idealFor: "Best if you have limited or no credit history",
    applyUrl: "https://www.acima.com/apply",
    color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    iconColor: "text-emerald-400",
  },
  {
    title: "SNAP FINANCE",
    type: "Buy Now, Pay Later",
    highlight: "All credit types welcome — up to $5,000 spending power",
    description: "Snap Finance specializes in approving customers that other lenders may decline. With spending power up to $5,000, you can cover major repairs like tire sets, brake jobs, or engine work without paying everything upfront.",
    features: [
      "All credit types welcome — high approval rates",
      "Up to $5,000 spending power",
      "100-day cash payoff option",
      "12-month payment plans available",
      "Quick 30-second application",
    ],
    idealFor: "Best for larger repairs ($500+) when you need flexible terms",
    applyUrl: "https://www.snapfinance.com",
    color: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    iconColor: "text-blue-400",
  },
  {
    title: "KOALAFI",
    type: "Flexible Financing",
    highlight: "Multiple plan options — lease-to-own or loan, you choose",
    description: "Koalafi (formerly West Creek Financial) gives you the flexibility to choose between lease-to-own and traditional loan options depending on what you qualify for. One simple application, multiple options presented to you.",
    features: [
      "One application, multiple financing options",
      "Lease-to-own and loan options available",
      "Approval for a wide range of credit profiles",
      "Transparent terms — no hidden fees",
      "90-day purchase option on lease plans",
    ],
    idealFor: "Best if you want to compare multiple plan types",
    applyUrl: "https://www.koalafi.com",
    color: "text-violet-400 bg-violet-500/10 border-violet-500/20",
    iconColor: "text-violet-400",
  },
  {
    title: "SYNCHRONY CAR CARE",
    type: "Credit Card",
    highlight: "6 months promotional financing on purchases of $199+",
    description: "The Synchrony Car Care credit card is accepted at thousands of auto shops nationwide. Get promotional financing on qualifying purchases and use it for ongoing maintenance, not just today's repair.",
    features: [
      "6-month promotional financing on $199+ purchases",
      "No annual fee",
      "Accepted at thousands of auto locations nationwide",
      "Easy online account management",
      "Reusable credit line for future repairs",
    ],
    idealFor: "Best if you have good credit and want a reusable card",
    applyUrl: "https://www.mysynchrony.com/car-care",
    color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    iconColor: "text-amber-400",
  },
];

const PAYMENT_METHODS = [
  "Cash",
  "Visa / Mastercard / Discover / Amex",
  "Debit Cards",
  "Apple Pay / Google Pay",
  "Synchrony Car Care Card",
  "Acima Leasing",
  "Snap Finance",
  "Koalafi",
];

const FAQ_ITEMS = [
  {
    q: "Do I need good credit to get financing?",
    a: "No. Acima requires no credit check at all, and Snap Finance welcomes all credit types. We have options for nearly every situation — just ask us at the counter.",
  },
  {
    q: "How fast is the approval process?",
    a: "Most applications take under 60 seconds. You can apply on your phone while you wait, or our team will help you at the counter.",
  },
  {
    q: "Can I pay off early?",
    a: "Yes. All four providers offer early payoff options. Acima and Snap both have 90-day or 100-day same-as-cash options that can save you significantly on total cost.",
  },
  {
    q: "What repairs can I finance?",
    a: "Everything. Tires, brakes, engine work, diagnostics, oil changes, suspension — any service we offer can be financed through our partners.",
  },
  {
    q: "Is there a minimum amount?",
    a: "It varies by provider, but most have minimums around $150–$300. For smaller repairs, you can use any of our standard payment methods including debit, credit, or cash.",
  },
  {
    q: "Can I apply before I come in?",
    a: "Yes. Each provider has an online application. You can get pre-approved before your visit so you know your options ahead of time.",
  },
];

export default function Financing() {
  return (
    <PageLayout activeHref="/financing">
      <SEOHead
        title="Financing & Payment Plans | Nick's Tire & Auto Cleveland"
        description="Affordable auto repair financing in Cleveland. Acima lease-to-own, Snap Finance, Koalafi, and Synchrony — no credit needed options available. Apply in minutes at Nick's Tire & Auto."
        canonicalPath="/financing"
      />
      <Breadcrumbs items={[{ label: "Financing", href: "/financing" }]} />
      <LocalBusinessSchema />

      {/* Hero */}
      <section className="bg-[oklch(0.065_0.004_260)] pt-28 pb-16 lg:pt-36 lg:pb-20">
        <div className="container max-w-4xl text-center">
          <FadeIn>
            <span className="font-mono text-nick-teal text-sm tracking-wide">Payment Plans Available</span>
            <h1 className="font-bold text-4xl lg:text-6xl text-foreground mt-3 tracking-tight">
              DON'T DELAY <span className="text-primary">REPAIRS</span>
            </h1>
            <p className="mt-4 text-foreground/70 text-lg max-w-2xl mx-auto leading-relaxed">
              Get your car fixed today and pay over time. We partner with 4 financing providers so there's an option for nearly every credit situation. Apply in minutes — right at the counter or online.
            </p>
          </FadeIn>

          <FadeIn delay={0.1}>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <div className="flex items-center gap-2 bg-nick-teal/10 border border-nick-teal/20 rounded-full px-4 py-2 text-sm text-nick-teal">
                <ShieldCheck className="w-4 h-4" />
                No credit needed options
              </div>
              <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-2 text-sm text-primary">
                <Zap className="w-4 h-4" />
                60-second approvals
              </div>
              <div className="flex items-center gap-2 bg-nick-blue/10 border border-nick-blue/20 rounded-full px-4 py-2 text-sm text-nick-blue-light">
                <Banknote className="w-4 h-4" />
                Payments as low as $25/mo
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Quick comparison */}
      <section className="bg-[oklch(0.055_0.004_260)] py-12">
        <div className="container max-w-4xl">
          <FadeIn>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/20">
                    <th className="text-left py-3 px-4 text-foreground/40 font-medium text-xs tracking-wider">PROVIDER</th>
                    <th className="text-left py-3 px-4 text-foreground/40 font-medium text-xs tracking-wider">TYPE</th>
                    <th className="text-left py-3 px-4 text-foreground/40 font-medium text-xs tracking-wider">CREDIT NEEDED</th>
                    <th className="text-left py-3 px-4 text-foreground/40 font-medium text-xs tracking-wider">EARLY PAYOFF</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { name: "Acima", type: "Lease-to-Own", credit: "None", payoff: "90-day same-as-cash" },
                    { name: "Snap Finance", type: "BNPL", credit: "All types", payoff: "100-day cash option" },
                    { name: "Koalafi", type: "Lease or Loan", credit: "Wide range", payoff: "90-day purchase" },
                    { name: "Synchrony", type: "Credit Card", credit: "Good/Fair", payoff: "6-mo promo at 0%" },
                  ].map((row) => (
                    <tr key={row.name} className="border-b border-border/10">
                      <td className="py-3 px-4 font-medium text-foreground">{row.name}</td>
                      <td className="py-3 px-4 text-foreground/60">{row.type}</td>
                      <td className="py-3 px-4 text-foreground/60">{row.credit}</td>
                      <td className="py-3 px-4 text-foreground/60">{row.payoff}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Financing Provider Cards */}
      <section className="bg-[oklch(0.055_0.004_260)] py-16 lg:py-20">
        <div className="container max-w-5xl">
          <FadeIn>
            <div className="text-center mb-12">
              <h2 className="font-bold text-3xl text-foreground tracking-tight">
                4 WAYS TO <span className="text-primary">PAY OVER TIME</span>
              </h2>
              <p className="text-foreground/60 mt-3 max-w-xl mx-auto">
                Each provider has different strengths. Not sure which is right for you? Ask us at the counter — we'll help you pick the best option.
              </p>
            </div>
          </FadeIn>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {FINANCING_OPTIONS.map((opt, i) => (
              <FadeIn key={opt.title} delay={i * 0.08}>
                <div className="bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-6 lg:p-8 flex flex-col h-full">
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`w-10 h-10 rounded-md flex items-center justify-center ${opt.color}`}>
                      <CreditCard className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-foreground tracking-wider text-sm">{opt.title}</h3>
                      <span className="text-[12px] text-foreground/40">{opt.type}</span>
                    </div>
                  </div>

                  <div className={`border rounded-md p-3 mb-4 ${opt.color}`}>
                    <p className="font-bold text-sm text-center">{opt.highlight}</p>
                  </div>

                  <p className="text-foreground/60 text-sm leading-relaxed mb-4">{opt.description}</p>

                  <ul className="space-y-2 mb-4 flex-1">
                    {opt.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm text-foreground/70">
                        <CheckCircle className="w-4 h-4 text-nick-teal shrink-0 mt-0.5" />
                        {f}
                      </li>
                    ))}
                  </ul>

                  <div className="bg-foreground/[0.03] border border-border/10 rounded-md px-3 py-2 mb-5">
                    <p className="text-xs text-foreground/50 italic">{opt.idealFor}</p>
                  </div>

                  <a
                    href={opt.applyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-md font-bold text-sm tracking-wide hover:opacity-90 transition-colors"
                  >
                    APPLY NOW
                    <ChevronRight className="w-4 h-4" />
                  </a>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="bg-[oklch(0.065_0.004_260)] py-16 lg:py-20">
        <div className="container max-w-3xl">
          <FadeIn>
            <h2 className="font-bold text-2xl lg:text-3xl text-foreground tracking-tight text-center mb-10">
              HOW IT WORKS
            </h2>
          </FadeIn>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {[
              { num: "01", icon: <Calculator className="w-6 h-6" />, title: "Get Your Estimate", desc: "We diagnose the issue and give you a clear repair estimate with no hidden fees." },
              { num: "02", icon: <CreditCard className="w-6 h-6" />, title: "Choose Your Plan", desc: "Apply for financing right at the counter or on your phone. Most approvals take under 60 seconds." },
              { num: "03", icon: <CheckCircle className="w-6 h-6" />, title: "Drive Away Today", desc: "We complete the repair and you pay over time with manageable monthly payments." },
            ].map((step, i) => (
              <FadeIn key={step.num} delay={i * 0.1}>
                <div className="text-center">
                  <span className="font-bold text-4xl text-border/40">{step.num}</span>
                  <div className="w-12 h-12 mx-auto mt-3 mb-3 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                    {step.icon}
                  </div>
                  <h3 className="font-bold text-foreground tracking-wider text-sm mb-2">{step.title}</h3>
                  <p className="text-foreground/60 text-sm">{step.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="bg-[oklch(0.055_0.004_260)] py-16 lg:py-20">
        <div className="container max-w-3xl">
          <FadeIn>
            <h2 className="font-bold text-2xl lg:text-3xl text-foreground tracking-tight text-center mb-10">
              FINANCING <span className="text-primary">FAQ</span>
            </h2>
          </FadeIn>
          <div className="space-y-4">
            {FAQ_ITEMS.map((faq, i) => (
              <FadeIn key={i} delay={i * 0.05}>
                <div className="bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-xl p-5 lg:p-6">
                  <h3 className="font-bold text-foreground text-sm tracking-[-0.01em] mb-2">{faq.q}</h3>
                  <p className="text-foreground/60 text-sm leading-relaxed">{faq.a}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* Payment Methods */}
      <section className="bg-[oklch(0.065_0.004_260)] py-16 lg:py-20">
        <div className="container max-w-3xl">
          <FadeIn>
            <h2 className="font-bold text-2xl text-foreground tracking-tight text-center mb-8">
              ALL ACCEPTED PAYMENT METHODS
            </h2>
          </FadeIn>
          <FadeIn delay={0.1}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {PAYMENT_METHODS.map((m) => (
                <div key={m} className="flex items-center gap-2 bg-card/50 border border-border/20 rounded-md px-4 py-3">
                  <DollarSign className="w-4 h-4 text-nick-teal shrink-0" />
                  <span className="text-[13px] text-foreground/70">{m}</span>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Safety Callout + CTA */}
      <section className="bg-[oklch(0.055_0.004_260)] py-12 lg:py-16">
        <div className="container max-w-3xl">
          <FadeIn>
            <div className="flex items-start gap-4 bg-primary/5 border border-primary/20 rounded-md p-5">
              <AlertCircle className="w-6 h-6 text-primary shrink-0 mt-0.5" />
              <div>
                <h3 className="font-bold text-foreground text-sm tracking-[-0.01em] mb-2">DO NOT DELAY SAFETY REPAIRS</h3>
                <p className="text-foreground/70 text-sm leading-relaxed">
                  Brakes, tires, and suspension problems get worse and more expensive over time. If cost is a concern, talk to us about financing before you leave. We would rather help you pay over time than have you driving with a safety issue.
                </p>
              </div>
            </div>
          </FadeIn>

          <FadeIn delay={0.1}>
            <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href={BUSINESS.phone.href}
                className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-md font-bold text-sm tracking-wide hover:opacity-90 transition-colors"
              >
                <Phone className="w-4 h-4" />
                CALL US — {BUSINESS.phone.display}
              </a>
              <a
                href="/book"
                className="inline-flex items-center justify-center gap-2 border-2 border-nick-blue/50 text-nick-blue-light px-8 py-4 rounded-md font-bold text-sm tracking-wide hover:bg-nick-blue/10 transition-colors"
              >
                BOOK APPOINTMENT
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* JSON-LD FAQ Schema */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: FAQ_ITEMS.map((faq) => ({
              "@type": "Question",
              name: faq.q,
              acceptedAnswer: { "@type": "Answer", text: faq.a },
            })),
          }),
        }}
      />

      <InternalLinks title="Related Services" />
    </PageLayout>
  );
}
