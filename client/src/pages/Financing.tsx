import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import PageLayout from "@/components/PageLayout";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import InternalLinks from "@/components/InternalLinks";
import {
  DollarSign, Phone, CheckCircle, CreditCard,
  ChevronRight, AlertCircle, Calculator, Shield,
  Clock, ArrowRight, ChevronDown, ExternalLink,
  BadgeCheck, Wallet, Zap, Star, HelpCircle,
} from "lucide-react";
import { BUSINESS } from "@shared/business";
import { FINANCING_PROVIDERS, PAYMENT_METHODS, FINANCING_FAQ, type FinancingProvider } from "@shared/financing";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import FadeIn from "@/components/FadeIn";

/* ── Badge icon mapping ────────────────────────────────────── */
function ProviderBadge({ badge }: { badge?: string }) {
  if (!badge) return null;
  const icon =
    badge === "No Credit Needed" ? <Shield className="w-3.5 h-3.5" /> :
    badge === "Highest Amount" ? <Star className="w-3.5 h-3.5" /> :
    badge === "0% Interest" ? <Zap className="w-3.5 h-3.5" /> :
    <BadgeCheck className="w-3.5 h-3.5" />;
  return (
    <span className="inline-flex items-center gap-1.5 bg-primary/15 text-primary text-[11px] font-bold tracking-wide px-2.5 py-1 rounded-full">
      {icon} {badge}
    </span>
  );
}

/* ── Provider card ─────────────────────────────────────────── */
function ProviderCard({ provider, index, onApplyClick }: { provider: FinancingProvider; index: number; onApplyClick: (id: string) => void }) {
  return (
    <FadeIn delay={index * 0.1}>
      <div className="bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-6 lg:p-8 flex flex-col h-full hover:border-primary/30 transition-colors group">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-lg flex items-center justify-center text-white font-bold text-sm"
              style={{ backgroundColor: provider.color }}
            >
              {provider.type === "credit-card" ? (
                <CreditCard className="w-5 h-5" />
              ) : (
                <Wallet className="w-5 h-5" />
              )}
            </div>
            <div>
              <h3 className="font-bold text-foreground tracking-wide text-[15px]">{provider.name}</h3>
              <span className="text-[12px] text-foreground/40 font-medium">{provider.typeLabel}</span>
            </div>
          </div>
          <ProviderBadge badge={provider.badge} />
        </div>

        {/* Highlight */}
        <div className="bg-primary/8 border border-primary/15 rounded-lg p-3 mb-5">
          <p className="font-bold text-primary text-sm text-center">{provider.highlight}</p>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="bg-[oklch(0.06_0.004_260/0.5)] rounded-lg p-3 text-center">
            <span className="block text-[11px] text-foreground/40 font-medium mb-1">MAX AMOUNT</span>
            <span className="font-bold text-foreground text-sm">{provider.maxAmount}</span>
          </div>
          <div className="bg-[oklch(0.06_0.004_260/0.5)] rounded-lg p-3 text-center">
            <span className="block text-[11px] text-foreground/40 font-medium mb-1">APPROVAL</span>
            <span className="font-bold text-foreground text-sm">{provider.approvalTime}</span>
          </div>
        </div>

        {/* Features */}
        <ul className="space-y-2 mb-6 flex-1">
          {provider.features.slice(0, 4).map((f) => (
            <li key={f} className="flex items-start gap-2 text-sm text-foreground/70">
              <CheckCircle className="w-4 h-4 text-nick-teal shrink-0 mt-0.5" />
              {f}
            </li>
          ))}
        </ul>

        {/* Ideal for */}
        <p className="text-[12px] text-foreground/50 mb-4 italic">
          Best for: {provider.idealFor}
        </p>

        {/* CTAs */}
        <div className="flex gap-3">
          <a
            href={provider.applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onApplyClick(provider.id)}
            className="flex-1 inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-5 py-3 rounded-lg font-bold text-sm tracking-wide hover:opacity-90 transition-colors"
          >
            APPLY NOW
            <ArrowRight className="w-4 h-4" />
          </a>
          {provider.prequalifyUrl && (
            <a
              href={provider.prequalifyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 bg-transparent border border-primary/40 text-primary px-4 py-3 rounded-lg font-bold text-[12px] tracking-wide hover:bg-primary/10 transition-colors"
            >
              PRE-QUALIFY
            </a>
          )}
        </div>
      </div>
    </FadeIn>
  );
}

/* ── Comparison table ──────────────────────────────────────── */
function ComparisonTable() {
  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full min-w-[600px] text-sm">
        <thead>
          <tr className="border-b border-border/20">
            <th className="text-left py-3 px-4 text-foreground/50 font-medium text-[12px] tracking-wide">FEATURE</th>
            {FINANCING_PROVIDERS.map((p) => (
              <th key={p.id} className="text-center py-3 px-3 text-foreground font-bold text-[13px]">
                {p.shortName}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-foreground/70">
          <tr className="border-b border-border/10">
            <td className="py-3 px-4 font-medium text-foreground/60">Type</td>
            {FINANCING_PROVIDERS.map((p) => (
              <td key={p.id} className="text-center py-3 px-3">{p.typeLabel}</td>
            ))}
          </tr>
          <tr className="border-b border-border/10">
            <td className="py-3 px-4 font-medium text-foreground/60">Max Amount</td>
            {FINANCING_PROVIDERS.map((p) => (
              <td key={p.id} className="text-center py-3 px-3 font-semibold text-foreground">{p.maxAmount}</td>
            ))}
          </tr>
          <tr className="border-b border-border/10">
            <td className="py-3 px-4 font-medium text-foreground/60">Credit Check</td>
            {FINANCING_PROVIDERS.map((p) => (
              <td key={p.id} className="text-center py-3 px-3">{p.creditCheck}</td>
            ))}
          </tr>
          <tr className="border-b border-border/10">
            <td className="py-3 px-4 font-medium text-foreground/60">Approval Speed</td>
            {FINANCING_PROVIDERS.map((p) => (
              <td key={p.id} className="text-center py-3 px-3">{p.approvalTime}</td>
            ))}
          </tr>
          <tr className="border-b border-border/10">
            <td className="py-3 px-4 font-medium text-foreground/60">Terms</td>
            {FINANCING_PROVIDERS.map((p) => (
              <td key={p.id} className="text-center py-3 px-3">{p.termRange}</td>
            ))}
          </tr>
          <tr>
            <td className="py-3 px-4 font-medium text-foreground/60">Apply</td>
            {FINANCING_PROVIDERS.map((p) => (
              <td key={p.id} className="text-center py-3 px-3">
                <a
                  href={p.applyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary font-bold text-[12px] hover:underline"
                >
                  Apply <ExternalLink className="w-3 h-3" />
                </a>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ── FAQ Accordion ─────────────────────────────────────────── */
function FAQItem({ item, isOpen, onToggle }: { item: typeof FINANCING_FAQ[number]; isOpen: boolean; onToggle: () => void }) {
  return (
    <div className="border-b border-border/15 last:border-b-0">
      <button
        onClick={onToggle}
        className="flex items-center justify-between w-full py-4 text-left group"
      >
        <span className="font-semibold text-foreground text-sm pr-4">{item.q}</span>
        <ChevronDown className={`w-5 h-5 text-foreground/40 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>
      {isOpen && (
        <div className="pb-4 pr-8">
          <p className="text-foreground/60 text-sm leading-relaxed">{item.a}</p>
        </div>
      )}
    </div>
  );
}

/* ── Financing Application Schema (JSON-LD) ────────────────── */
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
    "offers": FINANCING_PROVIDERS.map((p) => ({
      "@type": "Offer",
      "name": p.name,
      "description": p.description,
      "url": p.applyUrl,
    })),
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
      provider: providerId as "acima" | "snap" | "koalafi" | "synchrony",
      sourcePage: "/financing",
    });
  }, [trackMutation]);

  return (
    <PageLayout activeHref="/financing">
      <SEOHead
        title="Financing Options | Nick's Tire & Auto Cleveland OH"
        description="4 flexible auto repair financing options in Cleveland. No credit needed lease-to-own from Acima, Snap Finance, Koalafi, plus 0% interest Synchrony Car Care. Apply online in minutes."
        canonicalPath="/financing"
      />
      <Breadcrumbs items={[{ label: "Financing", href: "/financing" }]} />
      <LocalBusinessSchema />
      <FinancingSchema />

      {/* ─── Hero ─────────────────────────────────────────── */}
      <section className="bg-[oklch(0.065_0.004_260)] pt-28 pb-16 lg:pt-36 lg:pb-20">
        <div className="container max-w-4xl text-center">
          <span className="font-mono text-nick-teal text-sm tracking-wide">Payment Options</span>
          <h1 className="font-bold text-4xl lg:text-6xl text-foreground mt-3 tracking-tight">
            FIX YOUR CAR <span className="text-primary">TODAY</span>, PAY OVER TIME
          </h1>
          <p className="mt-4 text-foreground/70 text-lg max-w-2xl mx-auto">
            Do not delay repairs because of cost. We partner with 4 financing providers so you can get approved in seconds — no matter your credit situation.
          </p>

          {/* Quick trust signals */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-sm text-foreground/50">
            <span className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-nick-teal" />
              No credit needed options
            </span>
            <span className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-nick-teal" />
              Approved in seconds
            </span>
            <span className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-nick-teal" />
              Up to $7,500
            </span>
          </div>

          {/* Quick apply bar */}
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {FINANCING_PROVIDERS.map((p) => (
              <a
                key={p.id}
                href={`#${p.id}`}
                className="inline-flex items-center gap-2 bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] px-4 py-2.5 rounded-lg text-sm font-medium text-foreground/70 hover:text-foreground hover:border-primary/30 transition-colors"
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                {p.shortName}
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Provider Cards ───────────────────────────────── */}
      <section className="bg-[oklch(0.055_0.004_260)] py-16 lg:py-20">
        <div className="container max-w-5xl">
          <FadeIn>
            <div className="text-center mb-12">
              <h2 className="font-bold text-3xl text-foreground tracking-tight">
                4 WAYS TO PAY OVER TIME
              </h2>
              <p className="text-foreground/60 mt-3 max-w-xl mx-auto">
                Apply online or at the shop counter. Most approvals take under 60 seconds. Choose the option that works best for your budget.
              </p>
            </div>
          </FadeIn>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {FINANCING_PROVIDERS.map((provider, i) => (
              <div key={provider.id} id={provider.id}>
                <ProviderCard provider={provider} index={i} onApplyClick={handleApplyClick} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Comparison Table ─────────────────────────────── */}
      <section className="bg-[oklch(0.065_0.004_260)] py-16 lg:py-20">
        <div className="container max-w-4xl">
          <FadeIn>
            <h2 className="font-bold text-2xl lg:text-3xl text-foreground tracking-tight text-center mb-10">
              COMPARE OPTIONS AT A GLANCE
            </h2>
            <div className="bg-[oklch(0.08_0.004_260/0.6)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-4 lg:p-6">
              <ComparisonTable />
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ─── How It Works ─────────────────────────────────── */}
      <section className="bg-[oklch(0.055_0.004_260)] py-16 lg:py-20">
        <div className="container max-w-3xl">
          <FadeIn>
            <h2 className="font-bold text-2xl lg:text-3xl text-foreground tracking-tight text-center mb-10">
              HOW IT WORKS
            </h2>
          </FadeIn>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-6">
            {[
              { num: "01", icon: <Calculator className="w-6 h-6" />, title: "Get Your Estimate", desc: "We diagnose the issue and give you a clear repair estimate." },
              { num: "02", icon: <CreditCard className="w-6 h-6" />, title: "Choose a Provider", desc: "Pick the financing option that fits your budget and credit." },
              { num: "03", icon: <Zap className="w-6 h-6" />, title: "Apply & Get Approved", desc: "Apply online or at the counter. Get approved in seconds." },
              { num: "04", icon: <CheckCircle className="w-6 h-6" />, title: "Drive Away Today", desc: "We fix your car today. You pay with easy monthly payments." },
            ].map((step, i) => (
              <FadeIn key={step.num} delay={i * 0.1}>
                <div className="text-center">
                  <span className="font-bold text-3xl text-border/30">{step.num}</span>
                  <div className="w-12 h-12 mx-auto mt-2 mb-3 rounded-full bg-primary/10 flex items-center justify-center text-primary">
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

      {/* ─── FAQ ──────────────────────────────────────────── */}
      <section className="bg-[oklch(0.065_0.004_260)] py-16 lg:py-20">
        <div className="container max-w-3xl">
          <FadeIn>
            <div className="flex items-center gap-3 mb-8">
              <HelpCircle className="w-6 h-6 text-primary" />
              <h2 className="font-bold text-2xl text-foreground tracking-tight">
                FINANCING FAQ
              </h2>
            </div>
            <div className="bg-[oklch(0.08_0.004_260/0.6)] border border-[oklch(0.17_0.004_260)] rounded-2xl px-6">
              {FINANCING_FAQ.map((item, i) => (
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
                "mainEntity": FINANCING_FAQ.map((item) => ({
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

      {/* ─── Payment Methods ──────────────────────────────── */}
      <section className="bg-[oklch(0.055_0.004_260)] py-16 lg:py-20">
        <div className="container max-w-3xl">
          <FadeIn>
            <h2 className="font-bold text-2xl text-foreground tracking-tight text-center mb-8">
              ACCEPTED PAYMENT METHODS
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {PAYMENT_METHODS.map((m) => (
                <div key={m} className="flex items-center gap-2 bg-card/50 border border-border/20 rounded-lg px-4 py-3">
                  <DollarSign className="w-4 h-4 text-nick-teal shrink-0" />
                  <span className="text-[13px] text-foreground/70">{m}</span>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ─── Safety CTA ───────────────────────────────────── */}
      <section className="bg-[oklch(0.065_0.004_260)] py-12 lg:py-16">
        <div className="container max-w-3xl">
          <FadeIn>
            <div className="flex items-start gap-4 bg-primary/5 border border-primary/20 rounded-xl p-6">
              <AlertCircle className="w-6 h-6 text-primary shrink-0 mt-0.5" />
              <div>
                <h3 className="font-bold text-foreground text-sm tracking-[-0.01em] mb-2">DO NOT DELAY SAFETY REPAIRS</h3>
                <p className="text-foreground/70 text-sm leading-relaxed">
                  Brakes, tires, and suspension problems get worse and more expensive over time. If cost is a concern, talk to us about financing before you leave. We would rather help you pay over time than have you driving with a safety issue.
                </p>
              </div>
            </div>
          </FadeIn>

          <div className="mt-8 text-center">
            <a
              href={BUSINESS.phone.href}
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-lg font-bold text-sm tracking-wide hover:opacity-90 transition-colors"
            >
              <Phone className="w-4 h-4" />
              CALL TO DISCUSS OPTIONS — {BUSINESS.phone.display}
            </a>
          </div>
        </div>
      </section>

      <InternalLinks title="Related Services" />
    </PageLayout>
  );
}
