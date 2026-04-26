/**
 * FocusedServicePage — tight, conversion-optimized SEO template.
 *
 * Pattern extracted from SyntheticOilChangePage (which itself was modelled
 * on AlignmentPage). Far smaller and more focused than the generic
 * ServicePage template, which loads 1173 lines of sections, 3 navbars, 20+
 * imports. This one is built for:
 *
 *   - Fast First Contentful Paint on mobile
 *   - High keyword density for a single intent
 *   - Clear price anchor block (cuts conversion friction)
 *   - FAQ schema for Google rich snippets
 *   - Strong above-fold CTA pair (Call + Book)
 *   - Booking form at the bottom with a service-specific default
 *
 * Pass a ServicePageConfig object. See:
 *   - /brake-repair      → uses this template
 *   - /diagnostics       → uses this template
 *   - /check-engine-light → uses this template
 *   - /synthetic-oil-change (reference implementation — inline structure)
 */

import InternalLinks from "./InternalLinks";
import PageLayout from "./PageLayout";
import { SEOHead } from "./SEO";
import LocalBusinessSchema from "./LocalBusinessSchema";
import BookingForm from "./BookingForm";
import FadeIn from "./FadeIn";
import { BUSINESS } from "@shared/business";
import { Phone, CheckCircle, Clock, ShieldCheck, DollarSign, ChevronDown } from "lucide-react";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const HERO_IMAGE_DEFAULT = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-main-DE7GKwfCThaBL66r78QWkU.webp";

export interface ServicePricingTier {
  name: string;
  price: string;
  sub?: string;
  use: string;
  featured?: boolean;
}

export interface ServiceFaq {
  q: string;
  a: string;
}

export interface ServicePageConfig {
  /** Route path, e.g. "/brake-repair" */
  canonicalPath: string;
  /** Browser tab title */
  title: string;
  /** Meta description */
  description: string;
  /** Eyebrow above H1 */
  eyebrow: string;
  /** H1 text */
  h1: string;
  /** Hero subhead paragraph */
  sub: string;
  /** Optional hero image URL override */
  heroImage?: string;
  /** "From $X" opening price — shown in hero */
  startingPrice?: string;
  /** 3-up pricing cards — middle one defaults to featured */
  pricingTitle: string;
  pricingSub: string;
  tiers: ServicePricingTier[];
  /** "What's Included" bullet list */
  includedTitle: string;
  includedSub: string;
  included: string[];
  /** FAQ entries (used for content + FAQPage schema) */
  faqs: ServiceFaq[];
  /** Booking default service slug for BookingForm */
  bookingService: string;
  /** Offer catalog for JSON-LD */
  serviceType: string;
  /** Bottom-of-page CTA headline */
  ctaHeadline?: string;
  /** Bottom-of-page CTA sub */
  ctaSub?: string;
}

function Hero({ config }: { config: ServicePageConfig }) {
  return (
    <section className="relative min-h-[55vh] flex items-end overflow-hidden">
      <div className="absolute inset-0">
        <img
          loading="lazy"
          src={config.heroImage || HERO_IMAGE_DEFAULT}
          alt={`${config.h1} at Nick's Tire and Auto`}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/40" />
      </div>
      <div className="relative container pb-12 pt-28 lg:pb-16">
        <FadeIn>
          <span className="text-[13px] text-nick-blue-light tracking-wide font-mono">{config.eyebrow}</span>
        </FadeIn>
        <FadeIn delay={0.1}>
          <h1 className="font-bold text-4xl sm:text-5xl lg:text-6xl text-foreground leading-[0.95] tracking-tight max-w-3xl mt-4">
            {config.h1}
          </h1>
        </FadeIn>
        <FadeIn delay={0.2}>
          <p className="mt-5 text-lg text-foreground/80 max-w-2xl font-light leading-relaxed">
            {config.sub}
          </p>
        </FadeIn>
        <FadeIn delay={0.3}>
          <div className="mt-7 flex flex-col sm:flex-row gap-3">
            <a
              href={BUSINESS.phone.href}
              className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground btn-premium px-7 py-4 rounded-md font-bold text-lg tracking-wide hover:opacity-90 transition-colors"
              aria-label={`Call ${BUSINESS.phone.display}`}
            >
              <Phone className="w-5 h-5" /> CALL NOW
            </a>
            <a
              href="#booking"
              className="inline-flex items-center justify-center gap-2 border-2 border-nick-blue/50 text-nick-blue-light px-7 py-4 rounded-md font-bold text-lg tracking-wide hover:bg-nick-blue/10 hover:border-nick-blue transition-colors"
            >
              BOOK TODAY
            </a>
          </div>
        </FadeIn>
        <FadeIn delay={0.4}>
          <div className="mt-8 flex flex-wrap gap-3 text-sm">
            {[
              { icon: <Clock className="w-4 h-4" />, text: "Same-day service" },
              { icon: <ShieldCheck className="w-4 h-4" />, text: "Walk-ins welcome" },
              config.startingPrice ? { icon: <DollarSign className="w-4 h-4" />, text: config.startingPrice } : null,
            ].filter(Boolean).map((item, i) => (
              <div key={i} className="flex items-center gap-2 bg-nick-blue/10 border border-nick-blue/20 rounded-md px-3 py-1.5">
                <span className="text-nick-blue-light">{item!.icon}</span>
                <span className="text-foreground/80 text-[12px]">{item!.text}</span>
              </div>
            ))}
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

function PricingSection({ config }: { config: ServicePageConfig }) {
  return (
    <section className="py-16 bg-background">
      <div className="container max-w-5xl">
        <FadeIn>
          <h2 className="font-bold text-3xl sm:text-4xl text-foreground tracking-tight">{config.pricingTitle}</h2>
          <p className="text-foreground/60 mt-2">{config.pricingSub}</p>
        </FadeIn>
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
          {config.tiers.map((tier) => (
            <FadeIn key={tier.name} delay={0.1}>
              <div className={`border rounded-lg p-6 bg-card transition-all ${tier.featured ? "border-emerald-500/40 ring-1 ring-emerald-500/20" : "border-border/30"}`}>
                {tier.featured && <span className="inline-block text-[10px] font-bold tracking-wider text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded mb-2">RECOMMENDED</span>}
                <h3 className="font-bold text-xl text-foreground">{tier.name}</h3>
                <p className="font-bold text-3xl text-foreground mt-1">{tier.price}</p>
                {tier.sub && <p className="text-[11px] text-foreground/50 mt-1">{tier.sub}</p>}
                <div className="mt-4 space-y-2 text-[13px]">
                  <div className="flex items-start gap-2"><CheckCircle className="w-3.5 h-3.5 text-foreground/40 shrink-0 mt-0.5" /><span className="text-foreground/80">{tier.use}</span></div>
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
        <p className="text-[11px] text-foreground/40 text-center mt-4">Most vehicles. Pricing varies by vehicle and parts. Call for exact quote.</p>
      </div>
    </section>
  );
}

function IncludedSection({ config }: { config: ServicePageConfig }) {
  return (
    <section className="py-16 bg-card/20 border-y border-border/20">
      <div className="container max-w-4xl">
        <FadeIn>
          <h2 className="font-bold text-3xl text-foreground tracking-tight">{config.includedTitle}</h2>
          <p className="text-foreground/60 mt-2">{config.includedSub}</p>
        </FadeIn>
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-3">
          {config.included.map((item, i) => (
            <FadeIn key={i} delay={i * 0.05}>
              <div className="flex items-start gap-3 bg-background/50 border border-border/20 rounded px-4 py-3">
                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span className="text-[13px] text-foreground/90">{item}</span>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQSection({ faqs }: { faqs: ServiceFaq[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  return (
    <section className="py-16 bg-background">
      <div className="container max-w-3xl">
        <FadeIn>
          <h2 className="font-bold text-3xl text-foreground tracking-tight">FREQUENTLY ASKED QUESTIONS</h2>
        </FadeIn>
        <div className="mt-8 space-y-2">
          {faqs.map((faq, i) => {
            const isOpen = openIdx === i;
            return (
              <div key={i} className="border border-border/30 rounded overflow-hidden bg-card/40">
                <button
                  type="button"
                  onClick={() => setOpenIdx(isOpen ? null : i)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-card/60 transition-colors"
                >
                  <span className="font-semibold text-[14px] text-foreground">{faq.q}</span>
                  <ChevronDown className={`w-4 h-4 text-foreground/40 transition-transform shrink-0 ${isOpen ? "rotate-180" : ""}`} />
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <p className="px-4 pb-4 text-[13px] text-foreground/75 leading-relaxed">{faq.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function BookingSection({ config }: { config: ServicePageConfig }) {
  return (
    <section id="booking" className="py-16 bg-card/20 border-t border-border/20">
      <div className="container max-w-4xl">
        <FadeIn>
          <h2 className="font-bold text-3xl text-foreground tracking-tight">
            {config.ctaHeadline || "BOOK YOUR SERVICE"}
          </h2>
          <p className="text-foreground/60 mt-2">
            {config.ctaSub || "Fill out below, we'll confirm by text. Or walk in — 17625 Euclid Ave, Cleveland OH."}
          </p>
        </FadeIn>
        <FadeIn delay={0.1}>
          <div className="mt-6 bg-card border border-border/30 rounded-lg p-6">
            <BookingForm defaultService={config.bookingService} />
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

export default function FocusedServicePage({ config }: { config: ServicePageConfig }) {
  return (
    <PageLayout showChat={true}>
      <SEOHead
        title={config.title}
        description={config.description}
        canonicalPath={config.canonicalPath}
      />
      <LocalBusinessSchema
        additionalSchema={{
          "hasOfferCatalog": {
            "@type": "OfferCatalog",
            "name": config.serviceType,
            "itemListElement": config.tiers.map((t) => ({
              "@type": "Offer",
              "price": t.price.replace(/[^0-9.]/g, "").split(".")[0],
              "priceCurrency": "USD",
              "itemOffered": { "@type": "Service", "name": `${t.name} ${config.serviceType}`, "serviceType": config.serviceType },
            })),
          },
          "mainEntityOfPage": {
            "@type": "FAQPage",
            "mainEntity": config.faqs.map((f) => ({
              "@type": "Question",
              "name": f.q,
              "acceptedAnswer": { "@type": "Answer", "text": f.a },
            })),
          },
        }}
      />
      <Hero config={config} />
      <PricingSection config={config} />
      <IncludedSection config={config} />
      <FAQSection faqs={config.faqs} />
      <BookingSection config={config} />
      <InternalLinks />
    </PageLayout>
  );
}
