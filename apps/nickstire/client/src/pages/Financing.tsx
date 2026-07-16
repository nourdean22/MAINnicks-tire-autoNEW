import { useCallback, useState } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  CheckCircle,
  ChevronDown,
  Clock,
  CreditCard,
  ExternalLink,
  FileText,
  Info,
  MapPin,
  Phone,
  ShieldCheck,
  Store,
} from "lucide-react";
import PageLayout from "@/components/PageLayout";
import { Breadcrumbs, SEOHead, trackEvent, trackPhoneClick } from "@/components/SEO";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import FadeIn from "@/components/FadeIn";
import { trpc } from "@/lib/trpc";
import { getUtmData } from "@/lib/utm";
import { BUSINESS } from "@shared/business";
import {
  FINANCING_FAQ,
  FINANCING_PROVIDERS,
  type FinancingProvider,
} from "@shared/financing";

function ProviderCard({
  provider,
  onApply,
}: {
  provider: FinancingProvider;
  onApply: (providerId: string) => void;
}) {
  return (
    <article className="flex h-full flex-col rounded-2xl border border-white/10 bg-[#191919] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors hover:border-[#FDB913]/35">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-md border border-[#FDB913]/25 bg-[#FDB913]/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[#FDB913]">
          {provider.badge}
        </span>
        <span className="text-xs font-semibold text-white/45">{provider.maxAmount}</span>
      </div>

      <h3 className="font-heading text-2xl font-bold uppercase tracking-wide text-white">
        {provider.name}
      </h3>
      <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-white/45">
        {provider.typeLabel}
      </p>
      <p className="mt-4 text-sm leading-relaxed text-white/70">{provider.description}</p>

      <dl className="mt-5 space-y-3 rounded-xl border border-white/8 bg-black/15 p-4 text-sm">
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-wider text-white/35">Published amount</dt>
          <dd className="mt-1 text-white/75">{provider.highlight}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-wider text-white/35">Application review</dt>
          <dd className="mt-1 text-white/75">{provider.creditCheck}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-wider text-white/35">Timing</dt>
          <dd className="mt-1 text-white/75">{provider.approvalTime}</dd>
        </div>
      </dl>

      <ul className="mt-5 flex-1 space-y-2.5">
        {provider.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm leading-relaxed text-white/65">
            <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#FDB913]" aria-hidden="true" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <p className="mt-5 border-t border-white/8 pt-4 text-[11px] leading-relaxed text-white/40">
        {provider.disclosure}
      </p>

      <a
        href={provider.applyUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => onApply(provider.id)}
        className="mt-5 inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#FDB913] px-5 py-3 text-sm font-bold text-black transition-opacity hover:opacity-90"
      >
        APPLY ON {provider.shortName.toUpperCase()}'S SITE
        <ExternalLink className="h-4 w-4" aria-hidden="true" />
      </a>
    </article>
  );
}

function FAQItem({
  question,
  answer,
  open,
  onToggle,
}: {
  question: string;
  answer: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-b border-white/10 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 py-5 text-left"
        aria-expanded={open}
      >
        <span className="font-semibold text-white">{question}</span>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-white/45 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {open && <p className="pb-5 pr-8 text-sm leading-relaxed text-white/65">{answer}</p>}
    </div>
  );
}

export default function Financing() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const trackMutation = trpc.financing.trackApplication.useMutation();

  const handleApplyClick = useCallback(
    (providerId: string) => {
      if (!FINANCING_PROVIDERS.some((provider) => provider.id === providerId)) return;
      trackEvent("financing_apply_click", { provider: providerId, source: "provider-card" });
      trackMutation.mutate({
        provider: providerId as "acima" | "snap" | "koalafi" | "american-first",
        sourcePage: "/financing",
        ...getUtmData(),
      });
    },
    [trackMutation],
  );

  return (
    <PageLayout activeHref="/financing" showChat={true}>
      <SEOHead
        title="Auto Repair Payment Options Cleveland | Nick's Tire & Auto"
        description="Compare third-party payment options for tires and auto repair at Nick's Tire & Auto in Cleveland. See product types, published limits, key disclosures, and direct application links."
        canonicalPath="/financing"
      />
      <Breadcrumbs items={[{ label: "Payment Options", href: "/financing" }]} />
      <LocalBusinessSchema />

      <section className="bg-[#121212] pb-16 pt-28 lg:pb-20 lg:pt-32">
        <div className="container max-w-5xl">
          <div className="grid items-center gap-10 lg:grid-cols-[1.2fr_0.8fr]">
            <div>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#FDB913]/30 bg-[#FDB913]/8 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-[#FDB913]">
                <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
                Four third-party payment providers
              </div>
              <h1 className="font-heading text-5xl font-bold uppercase leading-[1.02] tracking-tight text-white lg:text-7xl">
                Fix the car.
                <span className="block text-[#FDB913]">Choose how to pay.</span>
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/70">
                Get a written repair estimate from Nick's, compare the product and total cost each provider offers, then apply directly with the provider that fits your budget.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href="#providers"
                  onClick={() => trackEvent("financing_compare_click", { source: "hero" })}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#FDB913] px-7 py-3.5 font-bold text-black transition-opacity hover:opacity-90"
                >
                  COMPARE PAYMENT OPTIONS
                  <ArrowRight className="h-5 w-5" aria-hidden="true" />
                </a>
                <a
                  href={BUSINESS.phone.href}
                  onClick={() => trackPhoneClick("financing-hero")}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white/20 px-7 py-3.5 font-bold text-white transition-colors hover:border-[#FDB913]/50 hover:text-[#FDB913]"
                >
                  <Phone className="h-5 w-5" aria-hidden="true" />
                  CALL {BUSINESS.phone.display}
                </a>
              </div>

              <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm text-white/55">
                <span className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-[#FDB913]" aria-hidden="true" />
                  Written estimate first
                </span>
                <span className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-[#FDB913]" aria-hidden="true" />
                  Approval comes from provider
                </span>
                <span className="flex items-center gap-2">
                  <Store className="h-4 w-4 text-[#FDB913]" aria-hidden="true" />
                  Walk-ins welcome 7 days
                </span>
              </div>
            </div>

            <aside className="rounded-2xl border border-[#FDB913]/25 bg-[#191919] p-6 lg:p-7">
              <div className="flex items-start gap-3">
                <Info className="mt-0.5 h-5 w-5 shrink-0 text-[#FDB913]" aria-hidden="true" />
                <div>
                  <h2 className="font-heading text-xl font-bold uppercase tracking-wide text-white">
                    What this page does
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-white/65">
                    It helps you compare the options Nick's accepts and sends you to each provider's official application.
                  </p>
                </div>
              </div>
              <div className="my-5 h-px bg-white/10" />
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#FDB913]" aria-hidden="true" />
                <div>
                  <h2 className="font-heading text-xl font-bold uppercase tracking-wide text-white">
                    What it does not do
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-white/65">
                    Nick's does not approve applications, set rates or lease costs, or promise a specific down payment. The provider agreement controls.
                  </p>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <section className="border-y border-white/8 bg-[#0f0f0f] py-14 lg:py-16">
        <div className="container max-w-6xl">
          <FadeIn>
            <div className="mb-9 text-center">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#FDB913]">A clearer path</p>
              <h2 className="mt-2 font-heading text-3xl font-bold uppercase tracking-tight text-white lg:text-5xl">
                Three steps from problem to repair
              </h2>
            </div>
          </FadeIn>
          <div className="grid gap-5 md:grid-cols-3">
            {[
              {
                icon: Store,
                number: "01",
                title: "Bring us the car",
                body: "Walk in or drop off. We inspect the problem and explain what is urgent, what can wait, and what the repair will cost.",
              },
              {
                icon: FileText,
                number: "02",
                title: "Get the exact estimate",
                body: "A real repair amount makes it easier to compare provider limits and avoid applying for more than you need.",
              },
              {
                icon: CreditCard,
                number: "03",
                title: "Apply and review",
                body: "Apply on the provider's site. Compare the product type, payment schedule, total of payments, and early-payoff terms before signing.",
              },
            ].map((step, index) => (
              <FadeIn key={step.number} delay={index * 0.08}>
                <div className="h-full rounded-2xl border border-white/10 bg-[#191919] p-6">
                  <div className="mb-5 flex items-center justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#FDB913]/12 text-[#FDB913]">
                      <step.icon className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <span className="font-heading text-2xl font-bold text-white/15">{step.number}</span>
                  </div>
                  <h3 className="font-heading text-xl font-bold uppercase tracking-wide text-white">{step.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-white/60">{step.body}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      <section id="providers" className="scroll-mt-24 bg-[#121212] py-16 lg:py-20">
        <div className="container max-w-6xl">
          <FadeIn>
            <div className="mx-auto mb-10 max-w-3xl text-center">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#FDB913]">Compare before applying</p>
              <h2 className="mt-2 font-heading text-3xl font-bold uppercase tracking-tight text-white lg:text-5xl">
                Payment options accepted at Nick's
              </h2>
              <p className="mt-4 text-base leading-relaxed text-white/60">
                These companies use different products and approval methods. A higher published limit does not automatically mean a lower total cost.
              </p>
            </div>
          </FadeIn>

          <div className="grid gap-5 lg:grid-cols-2">
            {FINANCING_PROVIDERS.map((provider, index) => (
              <FadeIn key={provider.id} delay={index * 0.06}>
                <ProviderCard provider={provider} onApply={handleApplyClick} />
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#0f0f0f] py-16 lg:py-20">
        <div className="container max-w-5xl">
          <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
            <FadeIn>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#FDB913]">Before you sign</p>
                <h2 className="mt-2 font-heading text-3xl font-bold uppercase tracking-tight text-white lg:text-5xl">
                  Compare the total cost, not just the payment
                </h2>
                <p className="mt-4 text-base leading-relaxed text-white/60">
                  A small weekly payment can still produce a large total. Ask for these five answers in writing.
                </p>
              </div>
            </FadeIn>

            <FadeIn delay={0.08}>
              <div className="rounded-2xl border border-white/10 bg-[#191919] p-6 lg:p-8">
                <ol className="space-y-5">
                  {[
                    ["What product is this?", "Lease-to-own, loan, and retail installment products have different costs and ownership rules."],
                    ["What is due today?", "Confirm the initial payment, taxes, fees, and any other amount required before service begins."],
                    ["What is the total of all payments?", "Do not compare offers using only the weekly or monthly number."],
                    ["What is the exact early-payoff date and amount?", "Promotional purchase or payoff windows can reduce cost, but the deadline and conditions matter."],
                    ["Will payment history be reported?", "Ask whether positive or late payments may be reported to consumer-reporting agencies."],
                  ].map(([title, body], index) => (
                    <li key={title} className="flex gap-4">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#FDB913] text-sm font-bold text-black">
                        {index + 1}
                      </span>
                      <div>
                        <h3 className="font-semibold text-white">{title}</h3>
                        <p className="mt-1 text-sm leading-relaxed text-white/55">{body}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      <section className="bg-[#121212] py-16 lg:py-20">
        <div className="container max-w-4xl">
          <FadeIn>
            <div className="mb-9 text-center">
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#FDB913]">Common questions</p>
              <h2 className="mt-2 font-heading text-3xl font-bold uppercase tracking-tight text-white lg:text-5xl">
                Payment option FAQ
              </h2>
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#191919] px-6 lg:px-8">
              {FINANCING_FAQ.map((item, index) => (
                <FAQItem
                  key={item.q}
                  question={item.q}
                  answer={item.a}
                  open={openFaq === index}
                  onToggle={() => setOpenFaq(openFaq === index ? null : index)}
                />
              ))}
            </div>
          </FadeIn>

          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "FAQPage",
                mainEntity: FINANCING_FAQ.map((item) => ({
                  "@type": "Question",
                  name: item.q,
                  acceptedAnswer: { "@type": "Answer", text: item.a },
                })),
              }),
            }}
          />
        </div>
      </section>

      <section className="border-t border-white/8 bg-[#0b0b0b] py-16 lg:py-20">
        <div className="container max-w-4xl text-center">
          <FadeIn>
            <h2 className="font-heading text-3xl font-bold uppercase tracking-tight text-white lg:text-5xl">
              Start with the repair estimate
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-white/60">
              Bring the vehicle to {BUSINESS.address.street}. We will inspect it, explain the work, and give you the amount you need before you choose a payment option.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <a
                href={BUSINESS.urls.googleMapsDirections}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => trackEvent("directions_click", { source: "financing-bottom" })}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#FDB913] px-7 py-3.5 font-bold text-black transition-opacity hover:opacity-90"
              >
                <MapPin className="h-5 w-5" aria-hidden="true" />
                GET DIRECTIONS
              </a>
              <a
                href={BUSINESS.phone.href}
                onClick={() => trackPhoneClick("financing-bottom")}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white/20 px-7 py-3.5 font-bold text-white transition-colors hover:border-[#FDB913]/50 hover:text-[#FDB913]"
              >
                <Phone className="h-5 w-5" aria-hidden="true" />
                CALL THE SHOP
              </a>
            </div>
            <p className="mt-5 flex items-center justify-center gap-2 text-sm text-white/45">
              <Clock className="h-4 w-4 text-[#FDB913]" aria-hidden="true" />
              {BUSINESS.hours.display}
            </p>
            <p className="mt-5 text-xs text-white/35">
              Looking for service details first? Browse <Link href="/services" className="text-[#FDB913] hover:underline">all repair services</Link> or review our <Link href="/tires" className="text-[#FDB913] hover:underline">tire options</Link>.
            </p>
          </FadeIn>
        </div>
      </section>
    </PageLayout>
  );
}
