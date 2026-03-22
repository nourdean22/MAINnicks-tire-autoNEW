/**
 * Financing — Payment options page.
 * COMPLIANCE: Acima (lease-to-own) is SEPARATED from financing providers.
 * Acima is a rental purchase agreement, NOT financing/credit/loan.
 * Per Acima merchant guidelines: must not be presented alongside or commingled with credit/financing products.
 */

import PageLayout from "@/components/PageLayout";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import InternalLinks from "@/components/InternalLinks";
import FadeIn from "@/components/FadeIn";
import {
  DollarSign, Phone, CheckCircle, CreditCard, ShieldCheck,
  ChevronRight, AlertCircle, Calculator, Clock, Users,
  Banknote, BadgeCheck, Zap, ArrowRight, Package,
} from "lucide-react";
import { BUSINESS } from "@shared/business";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import { ACIMA_PROMO_YEAR, ACIMA_SOCIAL_PROOF, buildAcimaUrl } from "@/lib/acima";

// ─── ACIMA (Lease-to-Own — NOT financing) ──────────────
const ACIMA = {
  title: "ACIMA LEASING",
  type: "Lease-to-Own",
  highlight: "No credit history required — lease what you need today",
  description:
    "Acima offers a lease-to-own option that lets you get the auto services you need today and make payments over time. This is a rental purchase agreement — not a loan, not financing, and not a credit transaction. You lease the merchandise and own it at the end of the agreement, or you can exercise an early purchase option to save on total cost.",
  features: [
    "No credit history required to apply",
    "90-day early purchase option available",
    "Flexible payment schedules (weekly, bi-weekly, monthly)",
    "Early purchase options to reduce total cost",
    "Apply online or in-store in minutes",
  ],
  idealFor: "Ideal if you have limited or no credit history and need service today",
  applyUrl: buildAcimaUrl("financing_hero"),
};

// ─── FINANCING PROVIDERS (separate from Acima) ────────────
const FINANCING_OPTIONS = [
  {
    title: "SNAP FINANCE",
    type: "Buy Now, Pay Later",
    highlight: "All credit types welcome — up to $5,000 spending power",
    description:
      "Snap Finance specializes in approving customers that other lenders may decline. With spending power up to $5,000, you can cover major repairs like tire sets, brake jobs, or engine work without paying everything upfront.",
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
    description:
      "Koalafi (formerly West Creek Financial) gives you the flexibility to choose between lease-to-own and traditional loan options depending on what you qualify for. One simple application, multiple options presented to you.",
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
    description:
      "The Synchrony Car Care credit card is accepted at thousands of auto shops nationwide. Get promotional financing on qualifying purchases and use it for ongoing maintenance, not just today's repair.",
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
    q: "What is Acima and how is it different from financing?",
    a: "Acima is a lease-to-own program — it is not a loan or credit. You lease the merchandise (in this case, auto parts and service) and own it at the end of the agreement. No credit history is required to apply. Financing options like Snap Finance, Koalafi, and Synchrony are separate credit products with their own terms.",
  },
  {
    q: "Do I need good credit to get approved?",
    a: "It depends on the option. Acima's lease-to-own program does not require credit history. Snap Finance welcomes all credit types. Koalafi offers options for a wide range of credit profiles. Synchrony typically requires fair to good credit. We have options for nearly every situation.",
  },
  {
    q: "How fast is the approval process?",
    a: "Most applications take under 60 seconds. You can apply on your phone while you wait, or our team will help you at the counter.",
  },
  {
    q: "Can I pay off early?",
    a: "Yes. All providers offer early payoff options. Acima has a 90-day early purchase option. Snap offers a 100-day cash payoff. Early payoff can significantly reduce the total amount you pay.",
  },
  {
    q: "What is the total cost if I use Acima?",
    a: "The total cost of your lease-to-own agreement depends on the payment schedule you choose and when you exercise your purchase option. The 90-day early purchase option costs the least. Your full cost, payment schedule, and purchase options will be clearly disclosed before you sign. You are not obligated to complete the lease — you may return the merchandise at any time.",
  },
  {
    q: "What services can I use these options for?",
    a: "All of our services — tires, brakes, engine work, diagnostics, oil changes, suspension, and more. Any repair or maintenance we perform can be covered through our payment partners.",
  },
  {
    q: "Can I apply before I come in?",
    a: "Yes. Each provider has an online application. You can get pre-approved before your visit so you know your options ahead of time.",
  },
];

// Comparison table data (shared between desktop table + mobile cards)
const COMPARISON_PROVIDERS = [
  { name: "Snap Finance", type: "BNPL", credit: "All types", payoff: "100-day cash option" },
  { name: "Koalafi", type: "Lease or Loan", credit: "Wide range", payoff: "90-day purchase" },
  { name: "Synchrony", type: "Credit Card", credit: "Good/Fair", payoff: "6-mo promo at 0%" },
];

// Required Acima disclosure
const ACIMA_DISCLAIMER =
  "Acima is a lease-to-own program. It is not a loan, credit, or financing. You will not own the merchandise until you make all payments under the lease agreement or exercise an early purchase option. Lease payments may be higher than the cash price of the merchandise. Not available in MN, NJ, WI, or WY. See lease for details.";

export default function Financing() {
  return (
    <PageLayout activeHref="/financing">
      <SEOHead
        title="Payment Options & Lease-to-Own | Nick's Tire & Auto Cleveland"
        description={`Multiple ways to pay at Nick's Tire & Auto in Cleveland. ${BUSINESS.taglines.hookAction} Acima lease-to-own (no credit history needed), Snap Finance, Koalafi, and Synchrony. Apply in minutes.`}
        canonicalPath="/financing"
      />
      <Breadcrumbs items={[{ label: "Payment Options", href: "/financing" }]} />
      <LocalBusinessSchema additionalSchema={{
        paymentAccepted: "Cash, Visa, Mastercard, Discover, American Express, Debit Cards, Apple Pay, Google Pay",
      }} />

      {/* Hero */}
      <section className="bg-[oklch(0.065_0.004_260)] pt-28 pb-16 lg:pt-36 lg:pb-20">
        <div className="container max-w-4xl text-center">
          <FadeIn>
            <span className="font-mono text-nick-teal text-sm tracking-wide">
              Multiple Ways to Pay
            </span>
            <h1 className="font-bold text-4xl lg:text-6xl text-foreground mt-3 tracking-tight">
              DON'T DELAY <span className="text-primary">REPAIRS</span>
            </h1>
            <p className="mt-4 text-foreground/70 text-lg max-w-2xl mx-auto leading-relaxed">
              Get your car fixed today and pay over time. We offer lease-to-own
              and financing options so there's a solution for nearly every
              situation. Apply in minutes — right at the counter or online.
            </p>
            <p className="mt-3 text-emerald-400/70 text-sm font-medium">{ACIMA_SOCIAL_PROOF}</p>
          </FadeIn>

          <FadeIn delay={0.1}>
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              <div className="flex items-center gap-2 bg-nick-teal/10 border border-nick-teal/20 rounded-full px-4 py-2 text-sm text-nick-teal">
                <ShieldCheck className="w-4 h-4" />
                No credit history needed options
              </div>
              <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-2 text-sm text-primary">
                <Zap className="w-4 h-4" />
                60-second approvals
              </div>
              <div className="flex items-center gap-2 bg-nick-blue/10 border border-nick-blue/20 rounded-full px-4 py-2 text-sm text-nick-blue-light">
                <Banknote className="w-4 h-4" />
                Flexible payment schedules
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Quick comparison */}
      <section className="bg-[oklch(0.055_0.004_260)] py-12">
        <div className="container max-w-4xl">
          <FadeIn>
            {/* Desktop: table layout */}
            <div className="hidden md:block overflow-x-auto">
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
                  <tr className="border-b border-emerald-500/10 bg-emerald-500/[0.03]">
                    <td className="py-3 px-4 font-medium text-foreground">Acima <span className="text-[10px] text-emerald-400 ml-1 font-normal">LEASE</span></td>
                    <td className="py-3 px-4 text-foreground/60">Lease-to-Own</td>
                    <td className="py-3 px-4 text-foreground/60">No credit history required</td>
                    <td className="py-3 px-4 text-foreground/60">90-day early purchase</td>
                  </tr>
                  {COMPARISON_PROVIDERS.map((row) => (
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

            {/* Mobile: stacked cards */}
            <div className="md:hidden space-y-3">
              {/* Acima card — emerald accent */}
              <div className="bg-emerald-500/[0.03] border border-emerald-500/10 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="font-medium text-foreground">Acima</span>
                  <span className="text-[10px] text-emerald-400 font-medium px-1.5 py-0.5 rounded bg-emerald-500/10">LEASE</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><span className="text-foreground/40 text-xs">Type</span><p className="text-foreground/70">Lease-to-Own</p></div>
                  <div><span className="text-foreground/40 text-xs">Credit</span><p className="text-foreground/70">No history required</p></div>
                  <div><span className="text-foreground/40 text-xs">Early Payoff</span><p className="text-foreground/70">90-day purchase</p></div>
                </div>
              </div>
              {/* Financing provider cards */}
              {COMPARISON_PROVIDERS.map((row) => (
                <div key={row.name} className="bg-card/30 border border-border/10 rounded-lg p-4">
                  <span className="font-medium text-foreground text-sm">{row.name}</span>
                  <div className="grid grid-cols-2 gap-2 text-sm mt-3">
                    <div><span className="text-foreground/40 text-xs">Type</span><p className="text-foreground/70">{row.type}</p></div>
                    <div><span className="text-foreground/40 text-xs">Credit</span><p className="text-foreground/70">{row.credit}</p></div>
                    <div><span className="text-foreground/40 text-xs">Early Payoff</span><p className="text-foreground/70">{row.payoff}</p></div>
                  </div>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════
          SECTION 1: ACIMA LEASE-TO-OWN (separate from financing)
          ═══════════════════════════════════════════════════════ */}
      <section className="bg-[oklch(0.055_0.004_260)] py-16 lg:py-20">
        <div className="container max-w-5xl">
          <FadeIn>
            <div className="text-center mb-12">
              <span className="inline-block bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold tracking-wider px-3 py-1 rounded-full mb-4">
                LEASE-TO-OWN
              </span>
              <h2 className="font-bold text-3xl text-foreground tracking-tight">
                ACIMA — <span className="text-emerald-400">NO CREDIT HISTORY NEEDED</span>
              </h2>
              <p className="text-foreground/60 mt-3 max-w-xl mx-auto">
                Acima is a lease-to-own program — not a loan or line of credit.
                Get the auto service you need today and make flexible payments
                over time.
              </p>
            </div>
          </FadeIn>

          <FadeIn delay={0.08}>
            <div className="bg-[oklch(0.08_0.004_260/0.8)] border border-emerald-500/20 rounded-2xl p-6 lg:p-8 max-w-2xl mx-auto">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-md flex items-center justify-center text-emerald-400 bg-emerald-500/10 border border-emerald-500/20">
                  <Package className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-foreground tracking-wider text-sm">
                    {ACIMA.title}
                  </h3>
                  <span className="text-[12px] text-emerald-400/70">
                    {ACIMA.type}
                  </span>
                </div>
              </div>

              <div className="border rounded-md p-3 mb-4 text-emerald-400 bg-emerald-500/10 border-emerald-500/20">
                <p className="font-bold text-sm text-center">
                  {ACIMA.highlight}
                </p>
              </div>

              <p className="text-foreground/60 text-sm leading-relaxed mb-4">
                {ACIMA.description}
              </p>

              <ul className="space-y-2 mb-4">
                {ACIMA.features.map((f) => (
                  <li
                    key={f}
                    className="flex items-start gap-2 text-sm text-foreground/70"
                  >
                    <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>

              <div className="bg-foreground/[0.03] border border-border/10 rounded-md px-3 py-2 mb-5">
                <p className="text-xs text-foreground/50 italic">
                  {ACIMA.idealFor}
                </p>
              </div>

              <a
                href={ACIMA.applyUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 bg-emerald-600 text-white px-6 py-3 rounded-md font-bold text-sm tracking-wide hover:opacity-90 transition-colors w-full sm:w-auto"
              >
                START LEASE APPLICATION
                <ChevronRight className="w-4 h-4" />
              </a>

              {/* Required Acima disclosure */}
              <p className="text-[10px] text-foreground/30 mt-4 leading-relaxed">
                {ACIMA_DISCLAIMER}
              </p>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════
          SECTION 2: FINANCING OPTIONS (credit-based products)
          ═══════════════════════════════════════════════════════ */}
      <section className="bg-[oklch(0.065_0.004_260)] py-16 lg:py-20">
        <div className="container max-w-5xl">
          <FadeIn>
            <div className="text-center mb-12">
              <span className="inline-block bg-primary/10 border border-primary/20 text-primary text-xs font-bold tracking-wider px-3 py-1 rounded-full mb-4">
                FINANCING
              </span>
              <h2 className="font-bold text-3xl text-foreground tracking-tight">
                FINANCING <span className="text-primary">OPTIONS</span>
              </h2>
              <p className="text-foreground/60 mt-3 max-w-xl mx-auto">
                Traditional financing and credit options for auto repairs. Each
                provider has different terms, approval criteria, and benefits.
              </p>
            </div>
          </FadeIn>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {FINANCING_OPTIONS.map((opt, i) => (
              <FadeIn key={opt.title} delay={i * 0.08}>
                <div className="bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-6 flex flex-col h-full">
                  <div className="flex items-center gap-3 mb-4">
                    <div
                      className={`w-10 h-10 rounded-md flex items-center justify-center ${opt.color}`}
                    >
                      <CreditCard className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-foreground tracking-wider text-sm">
                        {opt.title}
                      </h3>
                      <span className="text-[12px] text-foreground/40">
                        {opt.type}
                      </span>
                    </div>
                  </div>

                  <div className={`border rounded-md p-3 mb-4 ${opt.color}`}>
                    <p className="font-bold text-sm text-center">
                      {opt.highlight}
                    </p>
                  </div>

                  <p className="text-foreground/60 text-sm leading-relaxed mb-4">
                    {opt.description}
                  </p>

                  <ul className="space-y-2 mb-4 flex-1">
                    {opt.features.map((f) => (
                      <li
                        key={f}
                        className="flex items-start gap-2 text-sm text-foreground/70"
                      >
                        <CheckCircle className="w-4 h-4 text-nick-teal shrink-0 mt-0.5" />
                        {f}
                      </li>
                    ))}
                  </ul>

                  <div className="bg-foreground/[0.03] border border-border/10 rounded-md px-3 py-2 mb-5">
                    <p className="text-xs text-foreground/50 italic">
                      {opt.idealFor}
                    </p>
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
      <section className="bg-[oklch(0.055_0.004_260)] py-16 lg:py-20">
        <div className="container max-w-3xl">
          <FadeIn>
            <h2 className="font-bold text-2xl lg:text-3xl text-foreground tracking-tight text-center mb-10">
              HOW IT WORKS
            </h2>
          </FadeIn>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {[
              {
                num: "01",
                icon: <Calculator className="w-6 h-6" />,
                title: "Get Your Estimate",
                desc: "We diagnose the issue and give you a clear repair estimate with no hidden fees.",
              },
              {
                num: "02",
                icon: <CreditCard className="w-6 h-6" />,
                title: "Choose Your Option",
                desc: "Apply for a lease or financing right at the counter or on your phone. Most approvals take under 60 seconds.",
              },
              {
                num: "03",
                icon: <CheckCircle className="w-6 h-6" />,
                title: "Drive Away Today",
                desc: "We complete the repair and you make payments over time on a schedule that works for you.",
              },
            ].map((step, i) => (
              <FadeIn key={step.num} delay={i * 0.1}>
                <div className="text-center">
                  <span className="font-bold text-4xl text-border/40">
                    {step.num}
                  </span>
                  <div className="w-12 h-12 mx-auto mt-3 mb-3 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                    {step.icon}
                  </div>
                  <h3 className="font-bold text-foreground tracking-wider text-sm mb-2">
                    {step.title}
                  </h3>
                  <p className="text-foreground/60 text-sm">{step.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="bg-[oklch(0.065_0.004_260)] py-16 lg:py-20">
        <div className="container max-w-3xl">
          <FadeIn>
            <h2 className="font-bold text-2xl lg:text-3xl text-foreground tracking-tight text-center mb-10">
              PAYMENT <span className="text-primary">FAQ</span>
            </h2>
          </FadeIn>
          <div className="space-y-4">
            {FAQ_ITEMS.map((faq, i) => (
              <FadeIn key={i} delay={i * 0.05}>
                <div className="bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-xl p-5 lg:p-6">
                  <h3 className="font-bold text-foreground text-sm tracking-[-0.01em] mb-2">
                    {faq.q}
                  </h3>
                  <p className="text-foreground/60 text-sm leading-relaxed">
                    {faq.a}
                  </p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* Payment Methods */}
      <section className="bg-[oklch(0.055_0.004_260)] py-16 lg:py-20">
        <div className="container max-w-3xl">
          <FadeIn>
            <h2 className="font-bold text-2xl text-foreground tracking-tight text-center mb-8">
              ALL ACCEPTED PAYMENT METHODS
            </h2>
          </FadeIn>
          <FadeIn delay={0.1}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {PAYMENT_METHODS.map((m) => (
                <div
                  key={m}
                  className="flex items-center gap-2 bg-card/50 border border-border/20 rounded-md px-4 py-3"
                >
                  <DollarSign className="w-4 h-4 text-nick-teal shrink-0" />
                  <span className="text-[13px] text-foreground/70">{m}</span>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Safety Callout + CTA */}
      <section className="bg-[oklch(0.065_0.004_260)] py-12 lg:py-16">
        <div className="container max-w-3xl">
          <FadeIn>
            <div className="flex items-start gap-4 bg-primary/5 border border-primary/20 rounded-md p-5">
              <AlertCircle className="w-6 h-6 text-primary shrink-0 mt-0.5" />
              <div>
                <h3 className="font-bold text-foreground text-sm tracking-[-0.01em] mb-2">
                  DO NOT DELAY SAFETY REPAIRS
                </h3>
                <p className="text-foreground/70 text-sm leading-relaxed">
                  Brakes, tires, and suspension problems get worse and more
                  expensive over time. If cost is a concern, talk to us about
                  payment options before you leave. We would rather help you pay
                  over time than have you driving with a safety issue.
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

          {/* Acima disclaimer at page bottom */}
          <div className="mt-12 border-t border-border/10 pt-6">
            <p className="text-[10px] text-foreground/25 leading-relaxed max-w-2xl mx-auto text-center">
              {ACIMA_DISCLAIMER}
            </p>
          </div>
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

      {/* FinancialProduct schema for Acima lease-to-own */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FinancialProduct",
            name: "Acima Lease-to-Own",
            description: "Lease-to-own program for auto repair and tire services. No credit history required. 90-day early purchase option available.",
            provider: {
              "@type": "Organization",
              name: "Acima",
              url: "https://www.acima.com",
            },
            feesAndCommissionsSpecification: "$10 initial payment required. Lease terms and total cost vary by item and payment schedule.",
            annualPercentageRate: "N/A — this is a lease, not a loan",
            areaServed: {
              "@type": "Country",
              name: "US",
            },
          }),
        }}
      />

      <InternalLinks title="Related Services" />
    </PageLayout>
  );
}
