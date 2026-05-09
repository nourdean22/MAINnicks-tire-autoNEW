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
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import { Phone, ChevronRight, Wrench, Shield, Gauge, Zap, Droplets, ThermometerSun, Star, MapPin, Snowflake, Settings, Battery, Wind, Thermometer, ClipboardCheck, Cable, CircleDot } from "lucide-react";
import { BUSINESS } from "@shared/business";
import { SERVICES, type ServiceData } from "@shared/services";

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
      <SEOHead
        title="Auto Repair Cleveland · No Mystery Fees, Walk-Ins 7 Days | Nick's"
        description={`Cleveland auto shop where invoice line items make sense. Tires, brakes, oil, diagnostics, AC, transmission, exhaust. Walk-ins 7 days. 4.9★ 1,700+ reviews. ${BUSINESS.phone.display}`}
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
                without lecturing about it. Operators 4 + 3 stacked. */}
            <p className="mt-6 text-foreground/70 text-lg leading-relaxed max-w-2xl body-pretty">
              Oil change to head gasket — same playbook every time. Lift the car, hand you the flashlight, walk you under it before any wrench moves. The chains call that <span className="text-foreground/85">"a $99 diagnostic fee."</span> <span className="text-[#FDB913]">We call it Tuesday.</span>
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
                Schedule Online
                <ChevronRight className="w-5 h-5" />
              </Link>
            </div>
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
                  <h2 className="font-bold text-2xl text-foreground tracking-wide group-hover:text-primary transition-colors">
                    {service.title}
                  </h2>
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
              We do not just fix cars — we build trust. Every repair starts with an honest diagnosis, a clear explanation, and a fair price. No surprises, no hidden fees.
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
                <p className="text-foreground/60 text-sm mt-1">Advanced OBD-II diagnostics</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 lg:py-20">
        <div className="container text-center">
          <h2 className="font-bold text-3xl lg:text-4xl text-foreground tracking-tight">
            NEED A REPAIR?
          </h2>
          <p className="mt-4 text-foreground/70 text-lg max-w-xl mx-auto">
            Call us or stop by. We serve Cleveland, Euclid, Lakewood, Parma, and all of Northeast Ohio.
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
