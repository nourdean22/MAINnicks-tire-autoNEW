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
import ResponsivePhoto from "./ResponsivePhoto";
import RelatedServices from "./RelatedServices";
import ServiceReviewsBlock from "./ServiceReviewsBlock";
import PageLayout from "./PageLayout";
import { SEOHead, Breadcrumbs } from "./SEO";
import LocalBusinessSchema from "./LocalBusinessSchema";
import PhotoRibbon from "./PhotoRibbon";
import RiseInView from "./RiseInView";
import { Link } from "wouter";
import { CITIES } from "@shared/cities";

// v1.7 SEO · breadcrumb label auto-derived from canonicalPath slug.
// "/auto-repair-near-me" → "Auto Repair Near Me". Always works, no
// per-page config knob needed. The Breadcrumbs component prepends
// "Home" automatically, so we only pass the leaf.
function slugToTitle(path: string): string {
  return path
    .replace(/^\//, "")
    .split(/[-/]/)
    .map((s) => (s ? s[0].toUpperCase() + s.slice(1) : ""))
    .join(" ")
    .trim();
}
import BookingForm from "./BookingForm";
import FadeIn from "./FadeIn";
import { BUSINESS } from "@shared/business";
import { Phone, CheckCircle, Clock, ShieldCheck, DollarSign, ChevronDown } from "lucide-react";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
// Conversion-architecture overlays (Batch 1 components, plumbed in Batch 3
// of the v1.1 spec). All fields are OPTIONAL so existing services keep
// rendering unchanged unless they opt in.
import AnchorAdjustmentTable, { type Row as AnchorRow } from "./conversion/AnchorAdjustmentTable";
import FearCalibrationBlock, { type FearStat } from "./conversion/FearCalibrationBlock";
import LossAversionStat from "./conversion/LossAversionStat";
import ServiceTriageCard from "./conversion/ServiceTriageCard";
import TextMeQuote from "./conversion/TextMeQuote";

// Default hero swapped from CloudFront stock → real shop storefront (May 2026).
// This propagates the real photo to every service page using FocusedServicePage
// that doesn't override `heroImage` — brakes, diagnostics, used-tires, new-tires,
// tire-shop-near-me, auto-repair-near-me, and more. Pages with stronger visual
// context override via config.heroImage.
const HERO_IMAGE_DEFAULT = "/storefront-day.webp";

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

  // ─── CONVERSION ARCHITECTURE (v1.1) ──────────────────────
  // All optional. When provided, renders the corresponding conversion
  // section in the right place on the page. When omitted, page renders
  // exactly like before. Per docs/CONVERSION-OVERHAUL-V1.1.md.

  /** Anchor & adjustment table shown ABOVE pricing — dealer / chain / Nick's. */
  anchorTable?: {
    serviceName: string;
    rows: AnchorRow[];
    source?: string;
  };
  /** Fear-calibration block (3 stats) shown BETWEEN pricing and "what's included". */
  fearStats?: {
    heading: string;
    stats: FearStat[];
  };
  /** Loss-aversion stat shown BEFORE the FAQ. Animates in on scroll. */
  lossStats?: Array<{
    amount: number;
    unit: string;
    label: string;
    reason?: string;
    ctaHref?: string;
    ctaLabel?: string;
  }>;
  /** Optional cross-sell block — links to OTHER services using ServiceTriageCard pattern.
   *  Rendered after the FAQ. Useful to keep visitors converting if this
   *  service page didn't match their actual symptom. */
  crossSell?: {
    heading: string;
    items: Array<{
      tone?: "danger" | "warning" | "info";
      symptom: string;
      consequence: string;
      relief: string;
      ctaLabel: string;
      ctaHref: string;
      icon?: React.ReactNode;
    }>;
  };

  /** Optional cinematic photo ribbon — real shop photos relevant to the
   *  service. Renders between "What's Included" and the review block —
   *  the natural beat where the reader has just learned what they get
   *  and now sees physical proof of where they'd get it. Mobile-fast
   *  (CSS-only, IntersectionObserver-gated, real photos already on CDN). */
  photoRibbon?: {
    photos: import("./PhotoRibbon").RibbonPhoto[];
    eyebrow?: string;
    headingLine1?: string;
    headingLine2?: string;
    subhead?: string;
  };
}

function Hero({ config }: { config: ServicePageConfig }) {
  return (
    <section className="relative min-h-[55vh] flex items-end overflow-hidden">
      <div className="absolute inset-0">
        {/* LCP fix · above-the-fold hero on every FocusedServicePage instance.
            ResponsivePhoto serves /<photo>-mobile.webp (~85-180KB) under 768px
            instead of the desktop variant (~200-470KB). Powers TireShopNearMe,
            Sunday-muffler, Used-tires, and 5+ other focused service pages. */}
        <ResponsivePhoto
          loading="eager"
          fetchPriority="high"
          src={config.heroImage || HERO_IMAGE_DEFAULT}
          alt={`${config.h1} at Nick's Tire & Auto Cleveland`}
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
              <Phone className="w-5 h-5" /> {BUSINESS.phone.display}
            </a>
            <a
              href="#booking"
              className="inline-flex items-center justify-center gap-2 border-2 border-nick-blue/50 text-nick-blue-light px-7 py-4 rounded-md font-bold text-lg tracking-wide hover:bg-nick-blue/10 hover:border-nick-blue transition-colors"
            >
              HOLD MY BAY
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
        {/* 2026-05-05 — stack-grid + tilt-card give the 3 pricing tiers
            a 3D-feel layer. Middle tier already lifts via .stack-grid
            CSS rule. Featured tier gets tilt-primary for stronger lift. */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 stack-grid">
          {config.tiers.map((tier) => (
            <FadeIn key={tier.name} delay={0.1}>
              <div className={`tilt-card ${tier.featured ? "tilt-primary" : ""} border rounded-lg p-6 bg-card transition-all ${tier.featured ? "border-emerald-500/40 ring-1 ring-emerald-500/20" : "border-border/30"}`}>
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

// ─── CONVERSION OVERLAYS ─────────────────────────────────
// Optional sections that only render when config opts in. Keep them
// inside this file so service-page configs are the single contract;
// no caller needs to import 5 components.

function AnchorSection({ config }: { config: ServicePageConfig }) {
  if (!config.anchorTable) return null;
  return (
    <section className="bg-background border-t border-border/30 py-12">
      <div className="container max-w-3xl">
        <FadeIn>
          <AnchorAdjustmentTable
            serviceName={config.anchorTable.serviceName}
            rows={config.anchorTable.rows}
            source={config.anchorTable.source}
          />
        </FadeIn>
      </div>
    </section>
  );
}

function FearStatsSection({ config }: { config: ServicePageConfig }) {
  if (!config.fearStats || config.fearStats.stats.length === 0) return null;
  return (
    <section className="bg-[oklch(0.055_0.004_260)] border-y border-border/30 py-12">
      <div className="container">
        <FearCalibrationBlock
          heading={config.fearStats.heading}
          stats={config.fearStats.stats}
        />
      </div>
    </section>
  );
}

function LossSection({ config }: { config: ServicePageConfig }) {
  if (!config.lossStats || config.lossStats.length === 0) return null;
  return (
    <section className="bg-background border-t border-border/30 py-12">
      <div className="container max-w-5xl">
        <div className={`grid gap-4 ${config.lossStats.length > 1 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"}`}>
          {config.lossStats.map((s, i) => (
            <LossAversionStat
              key={i}
              amount={s.amount}
              unit={s.unit}
              label={s.label}
              reason={s.reason}
              ctaHref={s.ctaHref}
              ctaLabel={s.ctaLabel}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function TextMeSection({ config }: { config: ServicePageConfig }) {
  // Drops the SMS-back capture between the FAQ and the booking form.
  // Phone-only path for visitors not ready to fill the full booking.
  return (
    <section className="bg-background border-t border-border/30 py-12">
      <div className="container max-w-3xl">
        <FadeIn>
          <TextMeQuote serviceLabel={config.serviceType || config.h1} />
        </FadeIn>
      </div>
    </section>
  );
}

function CrossSellSection({ config }: { config: ServicePageConfig }) {
  if (!config.crossSell || config.crossSell.items.length === 0) return null;
  return (
    <section className="bg-card/20 border-t border-border/30 py-12">
      <div className="container">
        <FadeIn>
          <h2 className="font-bold text-2xl sm:text-3xl text-foreground tracking-tight mb-6">
            {config.crossSell.heading}
          </h2>
        </FadeIn>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {config.crossSell.items.map((item, i) => (
            <ServiceTriageCard
              key={i}
              tone={item.tone}
              icon={item.icon ?? <CheckCircle className="w-5 h-5" />}
              symptom={item.symptom}
              consequence={item.consequence}
              relief={item.relief}
              ctaLabel={item.ctaLabel}
              ctaHref={item.ctaHref}
            />
          ))}
        </div>
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
        }}
      />
      {/* Page-specific Service schema (the actual service this page is for).
          Replaces the generic "Premium Tire Installation Package" schema
          that was previously hardcoded in index.html and shipped to every
          page. Each FocusedServicePage instance now declares its real
          service type — /brakes = "Brake Repair", /diagnostics = "Engine
          Diagnostics", etc. — so Google's entity graph stops collapsing
          all 22+ service pages into one duplicate. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Service",
            name: config.serviceType,
            description: config.description,
            serviceType: config.serviceType,
            // 2026-05-06 SEO audit · associate the service-specific
            // hero photo (or default) with this service entity. Lets
            // Google's image search surface the right photo for the
            // right service intent. Absolute URL required by spec.
            image: `https://nickstire.org${config.heroImage || HERO_IMAGE_DEFAULT}`,
            provider: {
              "@type": "AutoRepair",
              name: "Nick's Tire & Auto",
              telephone: "+1-216-862-0005",
              url: `https://nickstire.org${config.canonicalPath}`,
              address: {
                "@type": "PostalAddress",
                streetAddress: "17625 Euclid Ave",
                addressLocality: "Euclid",
                addressRegion: "OH",
                postalCode: "44112",
                addressCountry: "US",
              },
            },
            areaServed: [
              { "@type": "City", name: "Cleveland" },
              { "@type": "City", name: "Euclid" },
              { "@type": "City", name: "Parma" },
              { "@type": "City", name: "Lakewood" },
              { "@type": "City", name: "Cleveland Heights" },
              { "@type": "City", name: "Shaker Heights" },
            ],
            offers: config.tiers.map((t) => ({
              "@type": "Offer",
              name: t.name,
              price: t.price.replace(/[^0-9.]/g, "").split(".")[0] || "0",
              priceCurrency: "USD",
              availability: "https://schema.org/InStock",
            })),
            // AggregateRating drives the ★ rich-snippet in Google search.
            // Same numbers used everywhere on the brand — single source
            // of truth (BUSINESS.reviews.rating / count). Google requires
            // ratingValue + reviewCount + bestRating + worstRating for
            // the snippet to render.
            aggregateRating: {
              "@type": "AggregateRating",
              ratingValue: 4.9,
              reviewCount: 1700,
              bestRating: 5,
              worstRating: 1,
            },
            url: `https://nickstire.org${config.canonicalPath}`,
          }),
        }}
      />
      {/* FAQPage emitted as its OWN top-level JSON-LD (not nested inside
          LocalBusiness as mainEntityOfPage — that structure was causing GSC
          "Duplicate field FAQPage" errors on 14 pages, May 2026 audit). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": config.faqs.map((f) => ({
              "@type": "Question",
              "name": f.q,
              "acceptedAnswer": { "@type": "Answer", "text": f.a },
            })),
          }),
        }}
      />
      {/* v1.7 SEO · BreadcrumbList JSON-LD + visible nav. Single edit
          here covers all 5 FocusedServicePage consumers (BrakeRepairPage,
          DiagnosticsPage, AutoRepairNearMePage, TireShopNearMePage,
          GenericServicePage). Rich-snippet eligibility = +CTR in SERP. */}
      <Breadcrumbs items={[{ label: slugToTitle(config.canonicalPath) }]} />
      <Hero config={config} />
      {/* 2026-05-06 visual wave 4: each major section is wrapped in
          RiseInView (Framer fade-and-rise on viewport entry, all
          browsers) + .parallax-rise (CSS scroll-driven drift, modern
          browsers only). Same depth treatment Home page got — service
          pages now feel like distinct rooms instead of one infinite
          scroll. Hero and breadcrumbs stay static; everything below
          is on the conveyor. */}
      {/* Anchor table renders ABOVE pricing — sets the dealer/chain
          reference frame so Nick's price feels like rescue. */}
      <RiseInView className="parallax-rise"><AnchorSection config={config} /></RiseInView>
      <RiseInView className="parallax-rise"><PricingSection config={config} /></RiseInView>
      {/* Fear-calibration AFTER pricing — readers who saw the price are now
          asking "is it worth it?" The fear stats answer with quantified risk. */}
      <RiseInView className="parallax-rise"><FearStatsSection config={config} /></RiseInView>
      <RiseInView className="parallax-rise"><IncludedSection config={config} /></RiseInView>
      {/* Cinematic photo ribbon — physical proof of the shop running
          this service. Lands between "what you get" and "what others
          said about it" — the natural beat where the reader is
          deciding "is this real?" Photos answer that. Renders nothing
          when config.photoRibbon is undefined, so service pages that
          haven't curated a photo set get zero visual change. */}
      {config.photoRibbon && (
        <RiseInView className="parallax-rise">
          <PhotoRibbon
            photos={config.photoRibbon.photos}
            eyebrow={config.photoRibbon.eyebrow}
            headingLine1={config.photoRibbon.headingLine1}
            headingLine2={config.photoRibbon.headingLine2}
            subhead={config.photoRibbon.subhead}
            dataDriven
          />
        </RiseInView>
      )}
      {/* Real-customer review block — pulled from reviewReplies via
          serviceReviews.forService. Surfaces 4-5 star reviews mentioning
          this service. Lands AFTER pricing (reduces sticker-shock) and
          BEFORE loss-aversion (loads the "but does it work?" answer
          before the closer). Renders nothing (no empty section band)
          when no matching reviews — graceful degradation for services
          without keyword matches yet. */}
      <RiseInView className="parallax-rise">
        <ServiceReviewsBlock
          service={config.bookingService}
          serviceTitle={config.serviceType ?? config.h1}
        />
      </RiseInView>
      {/* Loss-aversion BEFORE FAQ — animated on scroll-in, last conversion
          push before the cooldown FAQ section. */}
      <RiseInView className="parallax-rise"><LossSection config={config} /></RiseInView>
      <RiseInView className="parallax-rise"><FAQSection faqs={config.faqs} /></RiseInView>
      {/* SMS-back capture — phone-only, low-friction path for visitors
          who scrolled the FAQ but aren't ready for the full booking. */}
      <RiseInView className="parallax-rise"><TextMeSection config={config} /></RiseInView>
      {/* Cross-sell renders AFTER FAQ — catches visitors whose actual
          symptom didn't match this page's service. */}
      <CrossSellSection config={config} />
      <BookingSection config={config} />
      <InternalLinks />
      {/* 2026-05-05 audit follow-up · contextual related-services strip
          (different from InternalLinks' random shuffle). The component
          already existed in the repo with rich card styling but had
          never been rendered. Wires it to the FocusedServicePage's
          bookingService slug as the "current" so the DEFAULT_RELATED
          map picks the right cluster. */}
      <RelatedServices current={config.bookingService} />
      {/* v1.7 Q9 (W2) · city cross-link block on every FocusedServicePage.
          Single edit gives 5+ service pages a topical authority lift +
          deeper crawl reach to the city cluster. Mirrors the "ALSO
          SERVING" pattern from CityPage.tsx:560 so styling is consistent. */}
      <section className="py-12 lg:py-16 bg-[oklch(0.065_0.004_260)] border-t border-border/50">
        <div className="container">
          <h3 className="font-semibold font-bold text-lg text-foreground/60 tracking-[-0.01em] mb-6">CITIES WE SERVE</h3>
          <div className="flex flex-wrap gap-3">
            {CITIES.slice(0, 8).map((c) => (
              <Link
                key={c.slug}
                href={`/${c.slug}`}
                className="px-4 py-2 bg-card/50 border border-border/50 rounded-md text-sm text-foreground/70 hover:text-primary hover:border-primary/30 transition-colors"
              >
                {c.name} Auto Repair
              </Link>
            ))}
          </div>
        </div>
      </section>
    </PageLayout>
  );
}
