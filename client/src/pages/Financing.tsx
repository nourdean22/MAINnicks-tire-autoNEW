import { useState, useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import PageLayout from "@/components/PageLayout";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import InternalLinks from "@/components/InternalLinks";
import {
  DollarSign, Phone, CheckCircle, CreditCard,
  ChevronRight, AlertCircle, Calculator, Shield,
  Clock, ArrowRight, ChevronDown, ExternalLink,
  BadgeCheck, Wallet, Zap, Star, HelpCircle,
  FileText, Wrench, Car,
} from "lucide-react";
import { BUSINESS } from "@shared/business";
import { FINANCING_PROVIDERS, PAYMENT_METHODS, FINANCING_FAQ, type FinancingProvider } from "@shared/financing";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import FadeIn from "@/components/FadeIn";

/* ── Provider card data (static, inline) ──────────────────── */
const PROVIDERS = [
  {
    id: "americanfirst",
    name: "American First Finance",
    primary: true,
    tagline: "Wide approval range, multiple payment options, 60-second application",
    features: ["Wide approval range for all credit types", "Apply in 60 seconds", "No traditional credit check", "Multiple payment plan options"],
  },
  {
    id: "koalafi",
    name: "Koalafi",
    primary: false,
    tagline: "Lease-to-own up to $7,500, no credit score requirement",
    features: ["Lease-to-own up to $7,500", "No credit score requirement", "Flexible payment schedules", "Early buyout option available"],
  },
  {
    id: "snap",
    name: "Snap Finance",
    primary: false,
    tagline: "Up to $3,000 for tires and wheels, 100-day early payoff",
    features: ["Up to $3,000 for tires & wheels", "100-day early payoff option", "All credit types accepted", "Quick online application"],
  },
  {
    id: "acima",
    name: "Acima",
    primary: false,
    tagline: "Lease-to-own, no credit needed, early buyout available",
    features: ["Lease-to-own, no credit needed", "Early buyout saves you money", "90-day purchase option", "Flexible payment schedule"],
  },
];

/* ── Monthly Payment Calculator ───────────────────────────── */
function PaymentCalculator() {
  const [amount, setAmount] = useState(1500);
  const terms = [6, 12, 18, 24];

  const payments = useMemo(() => {
    // Simple estimated monthly (no interest for illustration)
    // Using a modest illustrative rate
    const rate = 0.099 / 12; // ~9.9% APR illustrative
    return terms.map((months) => {
      const monthly = (amount * rate * Math.pow(1 + rate, months)) / (Math.pow(1 + rate, months) - 1);
      return { months, monthly: Math.round(monthly) };
    });
  }, [amount]);

  return (
    <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl p-6 lg:p-8">
      <h3 className="font-heading text-2xl font-bold text-white uppercase tracking-wide mb-2">
        Monthly Payment Calculator
      </h3>
      <p className="text-white/50 text-sm mb-6">
        Estimate your monthly payment. Actual rates vary by provider and credit.
      </p>

      {/* Slider */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <label className="text-white/60 text-sm font-medium">Repair Amount</label>
          <span className="font-heading text-3xl font-bold text-[#FDB913]">
            ${amount.toLocaleString()}
          </span>
        </div>
        <input
          type="range"
          min={100}
          max={5000}
          step={50}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          className="w-full h-2 bg-[#2A2A2A] rounded-full appearance-none cursor-pointer accent-[#FDB913]"
        />
        <div className="flex justify-between text-xs text-white/30 mt-2">
          <span>$100</span>
          <span>$5,000</span>
        </div>
      </div>

      {/* Results grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {payments.map(({ months, monthly }) => (
          <div
            key={months}
            className="bg-[#141414] border border-[#2A2A2A] rounded-xl p-4 text-center"
          >
            <span className="block text-white/40 text-xs font-medium mb-1">{months} MONTHS</span>
            <span className="font-heading text-2xl font-bold text-white">${monthly}</span>
            <span className="block text-white/40 text-xs">/mo</span>
          </div>
        ))}
      </div>

      <p className="text-white/30 text-xs mt-4 text-center">
        *Estimates are illustrative. Actual APR and terms depend on provider and approval.
      </p>
    </div>
  );
}

/* ── FAQ Accordion ─────────────────────────────────────────── */
const FAQ_ITEMS = [
  {
    q: "Will applying hurt my credit score?",
    a: "No. Our financing partners use a soft credit check for pre-qualification, which does not affect your credit score. A hard inquiry only occurs if you choose to proceed with a full application.",
  },
  {
    q: "What happens if I get declined by one provider?",
    a: "You can apply with a different provider immediately. Each provider has different approval criteria, and many of our customers who are declined by one are approved by another. We have four options specifically so more people can get approved.",
  },
  {
    q: "Can I pay off my balance early?",
    a: "Yes! All of our financing providers allow early payoff. Snap Finance offers a 100-day early payoff option, and Acima has a 90-day purchase option that can save you money on fees.",
  },
  {
    q: "What services can I finance?",
    a: "You can finance any service we offer — tires, brakes, engine repair, transmission work, diagnostics, and more. If we can fix it, you can finance it.",
  },
];

function FAQItem({ item, isOpen, onToggle }: { item: typeof FAQ_ITEMS[number]; isOpen: boolean; onToggle: () => void }) {
  return (
    <div className="border-b border-[#2A2A2A] last:border-b-0">
      <button
        onClick={onToggle}
        className="flex items-center justify-between w-full py-5 text-left group"
      >
        <span className="font-semibold text-white text-sm pr-4">{item.q}</span>
        <ChevronDown className={`w-5 h-5 text-white/40 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
      </button>
      {isOpen && (
        <div className="pb-5 pr-8">
          <p className="text-white/60 text-sm leading-relaxed">{item.a}</p>
        </div>
      )}
    </div>
  );
}

/* ── Financing Schema (JSON-LD) ────────────────────────────── */
function FinancingSchema() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "FinancialProduct",
    "name": "Auto Repair Financing at Nick's Tire & Auto",
    "description": "Flexible financing options for auto repairs including lease-to-own and credit card options with no credit needed.",
    "provider": {
      "@type": "AutoRepair",
      "name": BUSINESS.name,
      "address": {
        "@type": "PostalAddress",
        "streetAddress": BUSINESS.address.street,
        "addressLocality": BUSINESS.address.city,
        "addressRegion": BUSINESS.address.state,
        "postalCode": BUSINESS.address.zip,
      },
      "telephone": BUSINESS.phone.display,
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

/* ── Main Financing Page ───────────────────────────────────── */
export default function Financing() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const trackMutation = trpc.financing.trackApplication.useMutation();

  const handleApplyClick = useCallback((providerId: string) => {
    trackMutation.mutate({
      provider: providerId as "acima" | "snap" | "koalafi" | "americanfirst",
      sourcePage: "/financing",
    });
  }, [trackMutation]);

  return (
    <PageLayout activeHref="/financing">
      <SEOHead
        title="Pay Over Time | Nick's Tire & Auto Cleveland OH"
        description="Pay over time for auto repair in Cleveland. No traditional credit check. Acima, Snap Finance, Koalafi, American First Finance. Apply in 60 seconds. (216) 862-0005."
        canonicalPath="/financing"
      />
      <Breadcrumbs items={[{ label: "Financing", href: "/financing" }]} />
      <LocalBusinessSchema />
      <FinancingSchema />

      {/* ─── Hero ─────────────────────────────────────────── */}
      <section className="bg-[#141414] pt-28 pb-16 lg:pt-36 lg:pb-24">
        <div className="container max-w-4xl text-center">
          <h1 className="font-heading text-5xl lg:text-7xl font-bold text-white tracking-tight uppercase">
            Don't Let Cost Keep You{" "}
            <span className="text-[#FDB913]">Off the Road</span>
          </h1>
          <p className="mt-5 text-white/70 text-xl lg:text-2xl max-w-2xl mx-auto font-medium">
            $0 Down. Instant Approval. No Hard Credit Check.
          </p>

          <div className="mt-8">
            <a
              href="#providers"
              className="inline-flex items-center gap-2 bg-[#FDB913] text-black px-8 py-4 rounded-lg font-bold text-base tracking-wide hover:bg-[#FDB913]/90 transition-colors"
            >
              Check Your Rate
              <ArrowRight className="w-5 h-5" />
            </a>
          </div>

          {/* Trust signals */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-6 text-sm text-white/50">
            <span className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-[#FDB913]" />
              No credit needed options
            </span>
            <span className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#FDB913]" />
              Approved in seconds
            </span>
            <span className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-[#FDB913]" />
              Up to $7,500
            </span>
          </div>
        </div>
      </section>

      {/* ─── Provider Cards ───────────────────────────────── */}
      <section id="providers" className="bg-[#111111] py-16 lg:py-24">
        <div className="container max-w-5xl">
          <FadeIn>
            <div className="text-center mb-12">
              <h2 className="font-heading text-3xl lg:text-4xl font-bold text-white tracking-tight uppercase">
                Our Financing Partners
              </h2>
              <p className="text-white/50 mt-3 max-w-xl mx-auto">
                Choose the option that fits your budget. Apply online or at the counter.
              </p>
            </div>
          </FadeIn>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {PROVIDERS.map((provider, i) => (
              <FadeIn key={provider.id} delay={i * 0.1}>
                <div
                  className={`bg-[#1A1A1A] border rounded-2xl p-6 lg:p-8 flex flex-col h-full transition-colors ${
                    provider.primary
                      ? "border-[#FDB913] shadow-[0_0_20px_rgba(253,185,19,0.08)]"
                      : "border-[#2A2A2A] hover:border-white/20"
                  }`}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-heading text-2xl font-bold text-white uppercase tracking-wide">
                      {provider.name}
                    </h3>
                    {provider.primary && (
                      <span className="text-xs font-bold tracking-wider bg-[#FDB913]/15 text-[#FDB913] px-3 py-1 rounded-full uppercase">
                        Primary
                      </span>
                    )}
                  </div>

                  {/* Tagline */}
                  <p className="text-[#FDB913] font-semibold text-sm mb-5">
                    {provider.tagline}
                  </p>

                  {/* Features */}
                  <ul className="space-y-2.5 mb-6 flex-1">
                    {provider.features.map((f) => (
                      <li key={f} className="flex items-start gap-2.5 text-sm text-white/70">
                        <CheckCircle className="w-4 h-4 text-[#FDB913] shrink-0 mt-0.5" />
                        {f}
                      </li>
                    ))}
                  </ul>

                  {/* CTA */}
                  <a
                    href={FINANCING_PROVIDERS.find((p) => p.id === provider.id)?.applyUrl || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => handleApplyClick(provider.id)}
                    className="inline-flex items-center justify-center gap-2 bg-[#FDB913] text-black px-5 py-3 rounded-lg font-bold text-sm tracking-wide hover:bg-[#FDB913]/90 transition-colors"
                  >
                    APPLY NOW
                    <ArrowRight className="w-4 h-4" />
                  </a>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Monthly Payment Calculator ───────────────────── */}
      <section className="bg-[#141414] py-16 lg:py-24">
        <div className="container max-w-3xl">
          <FadeIn>
            <PaymentCalculator />
          </FadeIn>
        </div>
      </section>

      {/* ─── How It Works ─────────────────────────────────── */}
      <section className="bg-[#111111] py-16 lg:py-24">
        <div className="container max-w-3xl">
          <FadeIn>
            <h2 className="font-heading text-3xl lg:text-4xl font-bold text-white tracking-tight uppercase text-center mb-12">
              How It Works
            </h2>
          </FadeIn>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {[
              { num: "01", icon: <FileText className="w-7 h-7" />, title: "Get Your Estimate", desc: "We diagnose the issue and give you a clear, honest repair estimate." },
              { num: "02", icon: <CreditCard className="w-7 h-7" />, title: "Pick a Plan & Apply", desc: "Choose a financing provider and apply in seconds — online or at the counter." },
              { num: "03", icon: <Car className="w-7 h-7" />, title: "Drive Away Today", desc: "We fix your car today. You pay with easy monthly payments that fit your budget." },
            ].map((step, i) => (
              <FadeIn key={step.num} delay={i * 0.12}>
                <div className="text-center">
                  <span className="font-heading text-4xl font-bold text-[#2A2A2A]">{step.num}</span>
                  <div className="w-14 h-14 mx-auto mt-3 mb-4 rounded-full bg-[#FDB913]/10 flex items-center justify-center text-[#FDB913]">
                    {step.icon}
                  </div>
                  <h3 className="font-heading text-lg font-bold text-white uppercase tracking-wide mb-2">{step.title}</h3>
                  <p className="text-white/50 text-sm leading-relaxed">{step.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FAQ ──────────────────────────────────────────── */}
      <section className="bg-[#141414] py-16 lg:py-24">
        <div className="container max-w-3xl">
          <FadeIn>
            <h2 className="font-heading text-3xl font-bold text-white tracking-tight uppercase text-center mb-10">
              Frequently Asked Questions
            </h2>
            <div className="bg-[#1A1A1A] border border-[#2A2A2A] rounded-2xl px-6">
              {FAQ_ITEMS.map((item, i) => (
                <FAQItem
                  key={i}
                  item={item}
                  isOpen={openFaq === i}
                  onToggle={() => setOpenFaq(openFaq === i ? null : i)}
                />
              ))}
            </div>
          </FadeIn>

          {/* FAQ Schema */}
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "FAQPage",
                "mainEntity": FAQ_ITEMS.map((item) => ({
                  "@type": "Question",
                  "name": item.q,
                  "acceptedAnswer": {
                    "@type": "Answer",
                    "text": item.a,
                  },
                })),
              }),
            }}
          />
        </div>
      </section>

      {/* ─── Bottom CTA ───────────────────────────────────── */}
      <section className="bg-[#111111] py-12 lg:py-16">
        <div className="container max-w-3xl text-center">
          <FadeIn>
            <h2 className="font-heading text-2xl lg:text-3xl font-bold text-white uppercase tracking-wide mb-4">
              Ready to Get Started?
            </h2>
            <p className="text-white/50 text-sm mb-6 max-w-lg mx-auto">
              Call us or stop by. We will help you find the financing option that works best for your budget.
            </p>
            <a
              href={BUSINESS.phone.href}
              className="inline-flex items-center gap-2 bg-[#FDB913] text-black px-8 py-4 rounded-lg font-bold text-sm tracking-wide hover:bg-[#FDB913]/90 transition-colors"
            >
              <Phone className="w-4 h-4" />
              CALL {BUSINESS.phone.display}
            </a>
          </FadeIn>
        </div>
      </section>

      <InternalLinks title="Related Services" />
    </PageLayout>
  );
}
