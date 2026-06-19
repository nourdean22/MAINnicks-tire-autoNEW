/**
 * Services Overview Page — /services
 * Dedicated landing page listing all services for SEO and user navigation.
 * Follows the brand content structure: Problem Hook → Explanation → Authority → CTA
 *
 * wave-110 — list now derives from @shared/services SERVICES (single
 * source of truth). Slug → icon mapping stays local (visual concern,
 * doesn't belong in canonical data). `alignment` appended manually
 * because it's a bespoke page (AlignmentPage, not GenericServicePage),
 * deliberately not in canonical SERVICES.
 *
 * Each card's "Common problems we fix" list is derived from the first
 * 3 entries of canonical `commonSymptoms` (or `signs` as fallback) so
 * homepage drift is impossible.
 */
import { Link } from "wouter";
import PageLayout from "@/components/PageLayout";
import InternalLinks from "@/components/InternalLinks";
import AeoAnswerBlock from "@/components/AeoAnswerBlock";
// wave-2-2026-05-30 (SEO-AEO parity) · /services hub (1,791 imp/90d)
// carried LocalBusiness + AggregateRating but no FAQPage schema — the
// AI-answer-engine citation surface its service-page peers already have.
import FAQPageSchema, { SERVICES_OVERVIEW_FAQ } from "@/components/FAQPageSchema";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import { Phone, ChevronRight, Wrench, Shield, Gauge, Zap, Droplets, ThermometerSun, Star, MapPin, Snowflake, Settings, Battery, Wind, Thermometer, ClipboardCheck, Cable, CircleDot, Clock } from "lucide-react";
import { BUSINESS } from "@shared/business";
import { SERVICES, type ServiceData } from "@shared/services";
import TrustBlock from "@/components/TrustBlock";

// Slug → lucide icon map. Lives here (not in canonical) because it's
// a visual concern that depends on the specific icon set this page
// uses. If a new service is added to canonical, add an icon here too.
const ICON_BY_SLUG: Record<string, React.ReactNode> = {
  tires: <Gauge className="w-8 h-8" />,
  brakes: <Shield className="w-8 h-8" />,
  diagnostics: <Zap className="w-8 h-8" />,
  emissions: <ThermometerSun className="w-8 h-8" />,
  "oil-change": <Droplets className="w-8 h-8" />,
  "general-repair": <Wrench className="w-8 h-8" />,
  "ac-repair": <Snowflake className="w-8 h-8" />,
  transmission: <Settings className="w-8 h-8" />,
  electrical: <Zap className="w-8 h-8" />,
  battery: <Battery className="w-8 h-8" />,
  exhaust: <Wind className="w-8 h-8" />,
  cooling: <Thermometer className="w-8 h-8" />,
  "pre-purchase-inspection": <ClipboardCheck className="w-8 h-8" />,
  "belts-hoses": <Cable className="w-8 h-8" />,
  "starter-alternator": <CircleDot className="w-8 h-8" />,
  alignment: <Gauge className="w-8 h-8" />,
};

// Title-Case the canonical UPPERCASE titles for the card display.
// Canonical stores them as "BRAKES" / "AC & HEATING" for hero headings;
// the card grid wants Title Case.
function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// Build card-shape from canonical ServiceData. `commonSymptoms` (long-
// tail SEO phrases) makes a great "Common problems we fix" list. Fall
// back to `signs` (warning signs) when commonSymptoms isn't populated.
function toCard(svc: ServiceData) {
  const problems = (svc.commonSymptoms || svc.signs || []).slice(0, 3);
  return {
    slug: svc.slug,
    title: toTitleCase(svc.title),
    icon: ICON_BY_SLUG[svc.slug] || <Wrench className="w-8 h-8" />,
    shortDesc: svc.shortDesc,
    problems,
  };
}

// Bespoke services not in canonical SERVICES (have their own routes
// and pages, e.g. AlignmentPage). Hand-curated card shape.
const BESPOKE_EXTRAS = [
  {
    slug: "alignment",
    title: "Wheel Alignment",
    icon: ICON_BY_SLUG.alignment,
    shortDesc: "Precision 4-wheel alignment to extend tire life, improve handling, and stop the steering pull. Same-day in most cases.",
    problems: ["Steering pulls to one side", "Uneven tire wear", "Crooked steering wheel after pothole"],
  },
];

const SERVICES_LIST = [...SERVICES.map(toCard), ...BESPOKE_EXTRAS];

export default function ServicesOverview() {
  return (
    <PageLayout showChat={true}>
      {/* 2026-05-06 copy wave · GSC: 734 imps at 0.8% CTR, pos 2.6.
          Page 1 placement, terrible click-through. Title rewrite is
          the highest-leverage CTR move available. */}
      {/* wave-174 — GSC data (28d) revealed /services ranks position 1.7
          for "nicks tires" with 120 impressions and 0.0% CTR. People search
          the BRAND, see a result that doesn't lead with "Nick's" (old title
          buried it after a generic "Auto Repair Cleveland"), and scroll
          past. New title leads with "Nick's Tire & Auto" so brand searches
          recognize the match. Description trimmed from 175 → 152 chars so
          the phone number survives SERP truncation on mobile. */}
      {/* wave-181.44 · meta rewrite v2 applying the relief haiku.
          V1 (Benefit Lead) per seo-aeo-meta-description-generator skill.
          Replaces the prior feature-list meta which earned 0.5% CTR at
          pos 3.1 across 1,486 90-day impressions — strong rank, weak
          earn = snippet wasn't differentiating. Title is 53 chars
          (well under 60 hard limit). Description is 146 chars (within
          140-155 sweet spot). Aligned with routes.ts so prerender +
          runtime <head> match. */}
      <SEOHead
        title="Cleveland Auto Repair & Tires · No Pay Til You Say Yes | Nick's"
        description="Tires, brakes, diagnostics, oil & emissions in one Euclid shop. Free check, written quote, you don't pay until you say yes. 4.9★ from 1,700+ drivers."
        canonicalPath="/services"
      />
      <Breadcrumbs items={[{ label: "Services", href: "/services" }]} />

      {/* Panoramic shop banner — real photo of the lot, full breadth of operation */}
      <section className="relative h-[280px] sm:h-[340px] lg:h-[420px] overflow-hidden">
        <img
          src="/services-panoramic.webp"
          alt="Panoramic view of Nick's Tire & Auto on Euclid Ave Cleveland — full lot, multiple bays, real working shop"
          className="absolute inset-0 w-full h-full object-cover"
          loading="eager"
          fetchPriority="high"
          decoding="async"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background/95 via-background/60 to-background/40" />
        <div className="absolute inset-0 flex items-end pb-10">
          <div className="container">
            <span className="font-mono text-primary text-xs tracking-[0.2em] uppercase">17625 Euclid Ave · One Shop · Every Repair</span>
          </div>
        </div>
      </section>

      {/* Hero Section */}
      <section className="relative py-16 lg:py-24 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-nick-yellow/5 to-transparent" />
        <div className="container relative">
          <div className="max-w-3xl">
            <span className="font-mono text-primary text-sm tracking-wide">What We Do</span>
            <h1 className="font-bold text-4xl sm:text-5xl lg:text-6xl text-foreground mt-3 tracking-tight leading-[1.05]">
              COMPLETE AUTO REPAIR<br />
              <span className="text-primary">SERVICES</span>
            </h1>
            {/* 2026-05-06 copy wave: useful-absurd close ("We call it
                Tuesday") names the chain pattern ($99 diagnostic fee)
                without lecturing about it. Operators 4 + 3 stacked.
                wave-181.44: added the RELIEF haiku as a second sentence —
                same line that lands on every VAPI repair call. Cross-
                touchpoint consistency per brand-perception step 5. */}
            <p className="mt-6 text-foreground/70 text-lg leading-relaxed max-w-2xl body-pretty">
              Oil change to head gasket — same playbook every time. Lift the car, hand you the flashlight, walk you under it before any wrench moves. The chains call that <span className="text-foreground/85">"a $99 diagnostic fee."</span> <span className="text-[#FDB913]">We call it Tuesday.</span>
            </p>
            <p className="mt-4 text-foreground/80 text-lg leading-relaxed max-w-2xl body-pretty">
              Free check. Written quote. <span className="text-[#FDB913] font-semibold">You don't pay until you say yes.</span>
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <a
                href={BUSINESS.phone.href}
                onClick={() => trackPhoneClick("services-hero")}
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-full font-bold text-lg hover:bg-primary/90 transition-colors"
              >
                <Phone className="w-5 h-5" />
                {BUSINESS.phone.display}
              </a>
              <Link href="/contact" className="inline-flex items-center gap-2 border border-foreground/30 text-foreground px-8 py-4 rounded-full font-medium hover:bg-foreground/5 transition-colors">
                Drop Off Today
                <ChevronRight className="w-5 h-5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* AEO answer-first block — first body content after the hero so AI
          answer-engines + featured snippets lift a clean, declarative answer
          for "auto repair Cleveland / Euclid" intent. */}
      <AeoAnswerBlock
        answer="Nick's Tire & Auto is a full-service auto repair shop at 17625 Euclid Ave in Cleveland (Euclid), Ohio — brakes, tires, oil changes, engine diagnostics, wheel alignment, and Ohio E-Check emissions for all makes and models, including European. Walk in 7 days a week with no appointment, get a written estimate before any work, and you don't pay until you say yes. Call (216) 862-0005."
      />

      {/* Core Service Pathways & Sunday Availability */}
      <section className="py-12 bg-background border-b border-border/20">
        <div className="container">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left Column: Quick Pathways */}
            <div className="lg:col-span-8 space-y-6">
              <h2 className="font-heading font-black text-2xl uppercase tracking-tight text-foreground">
                Quick Service Pathways
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Link href="/tires" className="p-4 border border-border/30 rounded-xl bg-card/40 hover:border-primary/40 hover:bg-card/80 transition-all text-center block group">
                  <span className="font-heading font-extrabold text-sm text-foreground group-hover:text-primary transition-colors block">TIRES</span>
                  <span className="text-[10px] text-foreground/50 block mt-1">New & Used</span>
                </Link>
                <Link href="/brakes" className="p-4 border border-border/30 rounded-xl bg-card/40 hover:border-primary/40 hover:bg-card/80 transition-all text-center block group">
                  <span className="font-heading font-extrabold text-sm text-foreground group-hover:text-primary transition-colors block">BRAKES</span>
                  <span className="text-[10px] text-foreground/50 block mt-1">Free Check</span>
                </Link>
                <Link href="/diagnostics" className="p-4 border border-border/30 rounded-xl bg-card/40 hover:border-primary/40 hover:bg-card/80 transition-all text-center block group">
                  <span className="font-heading font-extrabold text-sm text-foreground group-hover:text-primary transition-colors block">DIAGNOSTICS</span>
                  <span className="text-[10px] text-foreground/50 block mt-1">Check Engine</span>
                </Link>
                <Link href="/oil-change" className="p-4 border border-border/30 rounded-xl bg-card/40 hover:border-primary/40 hover:bg-card/80 transition-all text-center block group">
                  <span className="font-heading font-extrabold text-sm text-foreground group-hover:text-primary transition-colors block">OIL CHANGES</span>
                  <span className="text-[10px] text-foreground/50 block mt-1">Fast Service</span>
                </Link>
                <Link href="/emissions" className="p-4 border border-border/30 rounded-xl bg-card/40 hover:border-primary/40 hover:bg-card/80 transition-all text-center block group">
                  <span className="font-heading font-extrabold text-sm text-foreground group-hover:text-primary transition-colors block">EMISSIONS</span>
                  <span className="text-[10px] text-foreground/50 block mt-1">Ohio E-Check</span>
                </Link>
                <Link href="/auto-repair-near-me" className="p-4 border border-border/30 rounded-xl bg-card/40 hover:border-primary/40 hover:bg-card/80 transition-all text-center block group">
                  <span className="font-heading font-extrabold text-sm text-foreground group-hover:text-primary transition-colors block">SUSPENSION</span>
                  <span className="text-[10px] text-foreground/50 block mt-1">Struts & Shocks</span>
                </Link>
                <Link href="/alignment" className="p-4 border border-border/30 rounded-xl bg-card/40 hover:border-primary/40 hover:bg-card/80 transition-all text-center block group">
                  <span className="font-heading font-extrabold text-sm text-foreground group-hover:text-primary transition-colors block">STEERING</span>
                  <span className="text-[10px] text-foreground/50 block mt-1">Alignment</span>
                </Link>
                <Link href="/financing" className="p-4 border border-border/30 rounded-xl bg-card/40 hover:border-primary/40 hover:bg-card/80 transition-all text-center block group">
                  <span className="font-heading font-extrabold text-sm text-foreground group-hover:text-primary transition-colors block">FINANCING</span>
                  <span className="text-[10px] text-foreground/50 block mt-1">$10 Down</span>
                </Link>
              </div>
            </div>

            {/* Right Column: Sunday Hours & Drop-off info */}
            <div className="lg:col-span-4 bg-[#1a1c20] border border-primary/20 rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-2 text-primary">
                <Clock className="w-5 h-5" />
                <span className="font-heading font-extrabold tracking-wide uppercase text-sm">Sunday Service Available</span>
              </div>
              <h3 className="font-heading font-black text-xl text-white uppercase tracking-tight">
                Open Every Sunday: 9:00 AM – 4:00 PM
              </h3>
              <p className="text-xs text-foreground/70 leading-relaxed">
                Most shops close on Sundays, but Nick's Tire & Auto is fully operational. Stop by for urgent tire repairs, brake checkups, or regular oil changes. Vehicle drop-off options are welcomed, and we'll ensure you get back on the road in no time.
              </p>
              <div className="pt-2 border-t border-border/30 flex gap-3">
                <a href={BUSINESS.phone.href} className="text-xs font-bold text-primary hover:underline flex items-center gap-1">
                  <Phone className="w-3.5 h-3.5" /> Call Shop
                </a>
                <span className="text-foreground/20">|</span>
                <Link href="/contact" className="text-xs font-bold text-nick-blue-light hover:underline">
                  Directions & Drop-off
                </Link>
              </div>
            </div>
          </div>

          {/* Contextual linking text block for SEO */}
          <div className="mt-8 p-6 bg-card/10 border border-border/20 rounded-xl text-sm text-foreground/75 leading-relaxed space-y-3">
            <p>
              Need a quick solution? We offer <Link href="/tires" className="underline text-primary hover:text-primary-foreground font-semibold">Tire repair and replacement</Link> and complete <Link href="/brakes" className="underline text-primary hover:text-primary-foreground font-semibold">Brake repair in Euclid</Link> and Cleveland. Our ASE-trained crew handles advanced <Link href="/diagnostics" className="underline text-primary hover:text-primary-foreground font-semibold">Vehicle diagnostics and troubleshooting</Link>, as well as state-compliant <Link href="/emissions" className="underline text-primary hover:text-primary-foreground font-semibold">E-Check and emissions testing</Link>. Don't postpone critical repairs due to cost — check out our soft-pull <Link href="/financing" className="underline text-primary hover:text-primary-foreground font-semibold">Financing options for repairs</Link> with only $10 down. <Link href="/contact" className="underline text-primary hover:text-primary-foreground font-semibold">Contact Nick’s Tire & Auto</Link> today to check line wait times.
            </p>
          </div>

          {/* Reusable Trust Block */}
          <div className="mt-8">
            <TrustBlock />
          </div>
        </div>
      </section>

      {/* Services Grid */}
      <section className="py-16 lg:py-20">
        <div className="container">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {SERVICES_LIST.map((service) => (
              <Link
                key={service.slug}
                href={`/${service.slug}`}
                className="group block border border-border/50 rounded-lg p-8 hover:border-primary/50 hover:bg-card/50 transition-all duration-300"
              >
                <div className="flex items-center gap-4 mb-4">
                  <div className="text-primary">{service.icon}</div>
                  <h3 className="font-bold text-2xl text-foreground tracking-wide group-hover:text-primary transition-colors">
                    {service.title}
                  </h3>
                </div>
                <p className="text-foreground/70 leading-relaxed mb-4">{service.shortDesc}</p>
                <div className="space-y-2">
                  <span className="text-xs text-foreground/50 uppercase tracking-wider">Common problems we fix:</span>
                  <ul className="space-y-1">
                    {service.problems.map((problem) => (
                      <li key={problem} className="text-sm text-foreground/60 flex items-center gap-2">
                        <ChevronRight className="w-3 h-3 text-primary flex-shrink-0" />
                        {problem}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="mt-6 flex items-center gap-2 text-primary font-medium text-sm">
                  Learn More <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Trust Section */}
      <section className="py-16 lg:py-20 bg-card/30">
        <div className="container">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="font-bold text-3xl lg:text-4xl text-foreground tracking-tight">
              WHY CLEVELAND DRIVERS CHOOSE US
            </h2>
            <p className="mt-4 text-foreground/70 text-lg leading-relaxed">
              Every repair starts with a free check, a written quote, and you don't pay until you say yes. We tell you the cost before we touch the car — and you watch it happen if you want to.
            </p>
            <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-8">
              <div className="text-center">
                <div className="flex justify-center gap-0.5 mb-2">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-5 h-5 fill-nick-yellow text-primary" />
                  ))}
                </div>
                <span className="font-bold text-2xl text-foreground">{BUSINESS.reviews.rating} Stars</span>
                <p className="text-foreground/60 text-sm mt-1">{BUSINESS.reviews.countDisplay} Google Reviews</p>
              </div>
              <div className="text-center">
                <MapPin className="w-8 h-8 text-primary mx-auto mb-2" />
                <span className="font-bold text-2xl text-foreground">Local</span>
                <p className="text-foreground/60 text-sm mt-1">Cleveland owned and operated</p>
              </div>
              <div className="text-center">
                <Wrench className="w-8 h-8 text-primary mx-auto mb-2" />
                <span className="font-bold text-2xl text-foreground">ASE</span>
                <p className="text-foreground/60 text-sm mt-1">{BUSINESS.ase.display}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ — AEO + featured-snippet surface · wave-2-2026-05-30.
          Native <details> renders the Q&A into the prerendered HTML
          (crawlable, no hydration); FAQPageSchema emits the matching
          FAQPage JSON-LD per Google's spec. Targets the cross-service
          "auto repair Cleveland" intent this hub page ranks for. */}
      <section className="py-16 lg:py-20 border-t border-border/30">
        <div className="container max-w-3xl">
          <span className="font-mono text-primary text-sm tracking-wide">Common Questions</span>
          <h2 className="font-bold text-3xl lg:text-4xl text-foreground tracking-tight mt-3 mb-8">
            CLEVELAND AUTO REPAIR — STRAIGHT ANSWERS
          </h2>
          <div className="space-y-3">
            {SERVICES_OVERVIEW_FAQ.map((item) => (
              <details
                key={item.q}
                className="group border border-border/40 rounded-lg p-5 bg-card/40 [&_summary::-webkit-details-marker]:hidden"
              >
                <summary className="flex items-center justify-between gap-4 cursor-pointer list-none font-semibold text-foreground">
                  {item.q}
                  <ChevronRight className="w-4 h-4 text-primary shrink-0 transition-transform group-open:rotate-90" />
                </summary>
                <p className="mt-3 text-foreground/70 leading-relaxed text-sm">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
      {/* JSON-LD mirrors the visible Q&A above (Google FAQPage spec). */}
      <FAQPageSchema qa={SERVICES_OVERVIEW_FAQ} />

      {/* CTA Section */}
      <section className="py-16 lg:py-20">
        <div className="container text-center">
          <h2 className="font-bold text-3xl lg:text-4xl text-foreground tracking-tight">
            GOT A CAR PROBLEM? PULL UP.
          </h2>
          <p className="mt-4 text-foreground/70 text-lg max-w-xl mx-auto">
            Call us, text us, or just pull up. We serve Cleveland, Euclid, Lakewood, Parma, and all of Northeast Ohio.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <a
              href={BUSINESS.phone.href}
              onClick={() => trackPhoneClick("services-cta")}
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-full font-bold text-lg hover:bg-primary/90 transition-colors"
            >
              <Phone className="w-5 h-5" />
              Call {BUSINESS.phone.display}
            </a>
            {/* wave-110 — was /contact (label lie: directions ≠ contact form).
                Now opens Google Maps with the shop pre-set as destination. */}
            <a
              href={BUSINESS.urls.googleMapsDirectionsNamed}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 border border-foreground/30 text-foreground px-8 py-4 rounded-full font-medium hover:bg-foreground/5 transition-colors"
            >
              Get Directions
              <ChevronRight className="w-5 h-5" />
            </a>
          </div>
          <p className="mt-6 text-foreground/50 text-sm">
            {BUSINESS.address.full} — {BUSINESS.hours.display}
          </p>
        </div>
      </section>

      <InternalLinks exclude={["/services"]} />

      {/* LocalBusiness Schema */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "AutoRepair",
            name: "Nick's Tire & Auto",
            description: "Complete auto repair services in Cleveland, Ohio. Tires, brakes, diagnostics, emissions, oil changes, and general repair.",
            url: "https://nickstire.org/services",
            telephone: `+1-${BUSINESS.phone.dashed}`,
            address: {
              "@type": "PostalAddress",
              streetAddress: BUSINESS.address.street,
              addressLocality: "Cleveland",
              addressRegion: "OH",
              postalCode: "44112",
              addressCountry: "US",
            },
            aggregateRating: {
              "@type": "AggregateRating",
              ratingValue: String(BUSINESS.reviews.rating),
              reviewCount: String(BUSINESS.reviews.count),
            },
            hasOfferCatalog: {
              "@type": "OfferCatalog",
              name: "Auto Repair Services",
              itemListElement: SERVICES_LIST.map((s, i) => ({
                "@type": "Offer",
                itemOffered: {
                  "@type": "Service",
                  name: s.title,
                  description: s.shortDesc,
                },
                position: i + 1,
              })),
            },
          }),
        }}
      />
    </PageLayout>
  );
}
