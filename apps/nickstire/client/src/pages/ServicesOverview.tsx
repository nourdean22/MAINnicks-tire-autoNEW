/**
 * Services Overview Page — /services
 * The broad service hub for search, wayfinding, and first-visit conversion.
 * Canonical service data stays in shared/services; shop facts stay in
 * shared/business. This page owns presentation and route-specific copy.
 */
import { Link } from "wouter";
import {
  Battery,
  Cable,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  Clock,
  Droplets,
  Gauge,
  Phone,
  Settings,
  Shield,
  Snowflake,
  Star,
  Thermometer,
  ThermometerSun,
  Wind,
  Wrench,
  Zap,
} from "lucide-react";
import AeoAnswerBlock from "@/components/AeoAnswerBlock";
import FAQPageSchema, {
  SERVICES_OVERVIEW_FAQ,
} from "@/components/FAQPageSchema";
import InternalLinks from "@/components/InternalLinks";
import PageLayout from "@/components/PageLayout";
import {
  Breadcrumbs,
  SEOHead,
  trackEvent,
  trackPhoneClick,
} from "@/components/SEO";
import ServicesDifferentiators from "@/components/ServicesDifferentiators";
import { BUSINESS } from "@shared/business";
import { trpc } from "@/lib/trpc";
import { SERVICES, type ServiceData } from "@shared/services";

const ICON_BY_SLUG: Record<string, React.ReactNode> = {
  tires: <Gauge className="h-8 w-8" />,
  brakes: <Shield className="h-8 w-8" />,
  diagnostics: <Zap className="h-8 w-8" />,
  emissions: <ThermometerSun className="h-8 w-8" />,
  "oil-change": <Droplets className="h-8 w-8" />,
  "general-repair": <Wrench className="h-8 w-8" />,
  "ac-repair": <Snowflake className="h-8 w-8" />,
  transmission: <Settings className="h-8 w-8" />,
  electrical: <Zap className="h-8 w-8" />,
  battery: <Battery className="h-8 w-8" />,
  exhaust: <Wind className="h-8 w-8" />,
  cooling: <Thermometer className="h-8 w-8" />,
  "pre-purchase-inspection": <ClipboardCheck className="h-8 w-8" />,
  "belts-hoses": <Cable className="h-8 w-8" />,
  "starter-alternator": <CircleDot className="h-8 w-8" />,
  alignment: <Gauge className="h-8 w-8" />,
};

const QUICK_PATHS = [
  { href: "/tires", title: "TIRES", detail: "New & used" },
  { href: "/brakes", title: "BRAKES", detail: "Free check" },
  { href: "/diagnostics", title: "CHECK ENGINE", detail: "Find the cause" },
  { href: "/oil-change", title: "OIL CHANGES", detail: "Walk in" },
  { href: "/emissions", title: "E-CHECK", detail: "Failure repair" },
  { href: "/auto-repair-near-me", title: "SUSPENSION", detail: "Struts & shocks" },
  { href: "/alignment", title: "STEERING", detail: "Alignment" },
  {
    href: "/financing",
    title: "PAYMENT OPTIONS",
    detail: BUSINESS.financing.downPayment,
  },
] as const;

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function toCard(service: ServiceData) {
  return {
    slug: service.slug,
    title: toTitleCase(service.title),
    icon: ICON_BY_SLUG[service.slug] || <Wrench className="h-8 w-8" />,
    shortDesc: service.shortDesc,
    problems: (service.commonSymptoms || service.signs || []).slice(0, 3),
  };
}

const BESPOKE_EXTRAS = [
  {
    slug: "alignment",
    title: "Wheel Alignment",
    icon: ICON_BY_SLUG.alignment,
    shortDesc:
      "Precision 4-wheel alignment to protect tire life, straighten the wheel, and stop the pull. Walk in or drop off.",
    problems: [
      "Steering pulls to one side",
      "Uneven tire wear",
      "Crooked steering wheel after a pothole",
    ],
  },
];

const SERVICES_LIST = [...SERVICES.map(toCard), ...BESPOKE_EXTRAS];

const SERVICES_PAGE_FAQ = [
  ...SERVICES_OVERVIEW_FAQ,
  {
    q: "How does Nick's use AI in the shop?",
    a: "AI-assisted systems organize calls, service history, parts research, customer updates, follow-ups, and daily shop data so fewer details get lost. They do not replace the person checking your car or make the repair decision for you. A technician checks the vehicle, we show you what we found, and you decide what happens next.",
  },
];

const AEO_ANSWER = `${BUSINESS.name} is a full-service auto repair shop at ${BUSINESS.address.full}. We handle tires, brakes, oil changes, check-engine problems, wheel alignment, electrical work, and Ohio E-Check failures for domestic, import, and European vehicles. ${BUSINESS.model.walkIns}. Get a written quote before work starts, and you don't pay until you say yes. Call ${BUSINESS.phone.display}.`;

// A function, not a module-level const: the review rating/count need to come
// from live data resolved at RENDER time (see ServicesOverview below), and a
// module-level const is computed once at import time, before any component
// — including one with a live query — ever runs.
function servicesMetaDescription(reviewRating: number, reviewCountDisplay: string): string {
  return `Tires, brakes, diagnostics, oil & emissions in one Euclid shop. Free check, written quote, you don't pay until you say yes. ${reviewRating}★ from ${reviewCountDisplay} drivers.`;
}

function trackServicesAction(
  surface: string,
  action: string,
  destination: string,
  label?: string,
) {
  trackEvent("services_cta_click", {
    surface,
    action,
    destination,
    ...(label ? { label } : {}),
  });
}

export default function ServicesOverview() {
  const { data: googleData } = trpc.reviews.google.useQuery(undefined, { staleTime: 60 * 60 * 1000, retry: 1 });
  const reviewRating = googleData?.rating ?? BUSINESS.reviews.rating;
  const reviewCount = googleData?.totalReviews ?? BUSINESS.reviews.count;
  const reviewCountDisplay = `${reviewCount.toLocaleString("en-US")}+`;

  return (
    <PageLayout showChat={true}>
      <SEOHead
        title="Cleveland Auto Repair & Tires · No Pay Til You Say Yes | Nick's"
        description={servicesMetaDescription(reviewRating, reviewCountDisplay)}
        canonicalPath="/services"
      />
      <Breadcrumbs items={[{ label: "Services", href: "/services" }]} />

      <section className="relative h-[280px] overflow-hidden sm:h-[340px] lg:h-[420px]">
        <img
          src="/services-panoramic.webp"
          alt={`Panoramic view of ${BUSINESS.name} at ${BUSINESS.address.street}`}
          className="absolute inset-0 h-full w-full object-cover"
          loading="eager"
          fetchPriority="high"
          decoding="async"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background/95 via-background/60 to-background/40" />
        <div className="absolute inset-0 flex items-end pb-10">
          <div className="container">
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
              {BUSINESS.address.street} · TIRES TO ENGINE WORK · ONE CLEAR PLAN
            </span>
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden py-16 lg:py-24">
        <div className="absolute inset-0 bg-gradient-to-b from-nick-yellow/5 to-transparent" />
        <div className="container relative">
          <div className="max-w-3xl">
            <span className="font-mono text-sm tracking-wide text-primary">
              WHAT WE DO
            </span>
            <h1 className="mt-3 font-heading text-4xl font-black leading-[1.05] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              COMPLETE AUTO REPAIR
              <br />
              <span className="text-primary">WITHOUT THE RUNAROUND</span>
            </h1>
            <p className="body-pretty mt-6 max-w-2xl text-lg leading-relaxed text-foreground/70">
              Oil change to head gasket — the process stays simple. We check the car, show you what we found, write the number down, and wait for your answer before the work starts.
            </p>
            <p className="body-pretty mt-4 max-w-2xl text-lg leading-relaxed text-foreground/80">
              Free check. Written quote.{" "}
              <span className="font-semibold text-primary">
                You don't pay until you say yes.
              </span>
            </p>

            <div className="mt-7">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground/50">
                  Jump straight to a service
                </span>
                <Link
                  href="/diagnose"
                  onClick={() =>
                    trackServicesAction("hero_quick_paths", "describe_problem", "/diagnose")
                  }
                  className="text-xs font-bold text-primary hover:underline"
                >
                  Not sure? Describe the problem
                </Link>
              </div>
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {QUICK_PATHS.map((path) => (
                  <Link
                    key={path.href}
                    href={path.href}
                    onClick={() =>
                      trackServicesAction(
                        "hero_quick_paths",
                        "open_path",
                        path.href,
                        path.title,
                      )
                    }
                    className="shrink-0 rounded-full border border-border/40 bg-card/55 px-4 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-card"
                  >
                    <span className="block font-heading text-xs font-extrabold text-foreground">
                      {path.title}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-foreground/45">
                      {path.detail}
                    </span>
                  </Link>
                ))}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-4">
              <a
                href={BUSINESS.phone.href}
                onClick={() => trackPhoneClick("services-hero")}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-8 py-4 text-lg font-bold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Phone className="h-5 w-5" />
                {BUSINESS.phone.display}
              </a>
              <Link
                href="/contact"
                onClick={() =>
                  trackServicesAction("hero", "drop_off", "/contact")
                }
                className="inline-flex items-center gap-2 rounded-full border border-foreground/30 px-8 py-4 font-medium text-foreground transition-colors hover:bg-foreground/5"
              >
                Drop off today
                <ChevronRight className="h-5 w-5" />
              </Link>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border/30 pt-6 text-sm text-foreground/60">
              <a
                href={BUSINESS.reviews.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() =>
                  trackServicesAction(
                    "hero_proof",
                    "read_reviews",
                    BUSINESS.reviews.url,
                  )
                }
                className="inline-flex items-center gap-2 font-semibold text-foreground/80 transition-colors hover:text-primary"
              >
                <Star className="h-4 w-4 fill-primary text-primary" />
                {reviewRating} · {reviewCountDisplay} Google reviews
              </a>
              <span>{BUSINESS.hours.shortDisplay}</span>
              <span>{BUSINESS.warranty.shortDisplay}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 lg:py-20" id="services-board">
        <div className="container">
          <div className="mb-10 max-w-3xl">
            <span className="font-mono text-sm tracking-wide text-primary">
              THE FULL BOARD
            </span>
            <h2 className="mt-3 font-heading text-3xl font-black uppercase tracking-tight text-foreground lg:text-4xl">
              Pick the problem. See what we do.
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-foreground/65">
              Every card opens the service page with warning signs, what we check, and the next move. No mystery menu.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {SERVICES_LIST.map((service) => (
              <Link
                key={service.slug}
                href={`/${service.slug}`}
                onClick={() =>
                  trackServicesAction(
                    "service_board",
                    "open_service",
                    `/${service.slug}`,
                    service.title,
                  )
                }
                className="group flex min-h-[132px] flex-col rounded-xl border border-border/40 bg-card/20 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:bg-card/50"
              >
                <div className="flex items-center gap-3">
                  <div className="shrink-0 scale-75 text-primary">{service.icon}</div>
                  <h3 className="font-heading text-lg font-black tracking-wide text-foreground transition-colors group-hover:text-primary">
                    {service.title}
                  </h3>
                </div>
                <p className="mt-2 line-clamp-2 text-sm leading-snug text-foreground/60">
                  {service.shortDesc}
                </p>
                <div className="mt-auto flex items-center gap-1 pt-3 text-xs font-bold text-primary">
                  See service
                  <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <AeoAnswerBlock answer={AEO_ANSWER} />

      <ServicesDifferentiators />

      <section className="border-t border-border/30 py-16 lg:py-20">
        <div className="container max-w-3xl">
          <span className="font-mono text-sm tracking-wide text-primary">
            COMMON QUESTIONS
          </span>
          <h2 className="mb-8 mt-3 font-heading text-3xl font-black uppercase tracking-tight text-foreground lg:text-4xl">
            Cleveland auto repair — straight answers
          </h2>
          <div className="space-y-3">
            {SERVICES_PAGE_FAQ.map((item) => (
              <details
                key={item.q}
                className="group rounded-lg border border-border/40 bg-card/40 p-5 [&_summary::-webkit-details-marker]:hidden"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-foreground">
                  {item.q}
                  <ChevronRight className="h-4 w-4 shrink-0 text-primary transition-transform group-open:rotate-90" />
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-foreground/70">
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>
      <FAQPageSchema qa={SERVICES_PAGE_FAQ} />

      <section className="py-16 lg:py-20">
        <div className="container text-center">
          <h2 className="font-heading text-3xl font-black uppercase tracking-tight text-foreground lg:text-4xl">
            Got a car problem? Pull up.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-foreground/70">
            Call, drop it off, or come by. We serve {BUSINESS.address.region} from one shop on {BUSINESS.address.street}.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <a
              href={BUSINESS.phone.href}
              onClick={() => trackPhoneClick("services-cta")}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-8 py-4 text-lg font-bold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Phone className="h-5 w-5" />
              Call {BUSINESS.phone.display}
            </a>
            <a
              href={BUSINESS.urls.googleMapsDirectionsNamed}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() =>
                trackServicesAction(
                  "final_cta",
                  "directions",
                  BUSINESS.urls.googleMapsDirectionsNamed,
                )
              }
              className="inline-flex items-center gap-2 rounded-full border border-foreground/30 px-8 py-4 font-medium text-foreground transition-colors hover:bg-foreground/5"
            >
              Get directions
              <ChevronRight className="h-5 w-5" />
            </a>
          </div>
          <p className="mt-6 text-sm text-foreground/50">
            {BUSINESS.address.full} — {BUSINESS.hours.display}
          </p>
        </div>
      </section>

      <InternalLinks exclude={["/services"]} />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "AutoRepair",
            name: BUSINESS.name,
            description:
              "Auto repair and tire service in Cleveland, Ohio, including brakes, oil changes, electrical work, emissions repair, alignment, and general repair.",
            url: `${BUSINESS.urls.website}/services`,
            telephone: `+1-${BUSINESS.phone.dashed}`,
            address: {
              "@type": "PostalAddress",
              streetAddress: BUSINESS.address.street,
              addressLocality: BUSINESS.address.city,
              addressRegion: BUSINESS.address.state,
              postalCode: BUSINESS.address.zip,
              addressCountry: "US",
            },
            aggregateRating: {
              "@type": "AggregateRating",
              ratingValue: String(reviewRating),
              reviewCount: String(reviewCount),
            },
            hasOfferCatalog: {
              "@type": "OfferCatalog",
              name: "Auto Repair Services",
              itemListElement: SERVICES_LIST.map((service, index) => ({
                "@type": "Offer",
                position: index + 1,
                itemOffered: {
                  "@type": "Service",
                  name: service.title,
                  description: service.shortDesc,
                },
              })),
            },
          }),
        }}
      />
    </PageLayout>
  );
}
