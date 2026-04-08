import PageLayout from "@/components/PageLayout";
import { useParams } from "wouter";
import { Link } from "wouter";
import { Phone, ChevronRight, ShieldCheck, Clock, Star, Wrench } from "lucide-react";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import { getVehicleServiceBySlug, VEHICLE_SERVICE_PAGES } from "@shared/vehicleServicePages";
import { BUSINESS } from "@shared/business";
import InternalLinks from "@/components/InternalLinks";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import FadeIn from "@/components/FadeIn";
import { trackPhoneClick } from "@/lib/analytics";

/** Service-specific content blocks */
const SERVICE_CONTENT: Record<string, { signs: string[]; includes: string[]; whyUs: string }> = {
  "brake-repair": {
    signs: [
      "Squealing or grinding noise when braking",
      "Brake pedal feels soft or spongy",
      "Vehicle pulls to one side when stopping",
      "Steering wheel vibrates during braking",
      "ABS or brake warning light on",
      "Longer stopping distances than usual",
    ],
    includes: [
      "Full brake system inspection",
      "Pad thickness measurement",
      "Rotor surface and thickness check",
      "Caliper and brake line inspection",
      "Brake fluid condition test",
      "Road test before and after",
    ],
    whyUs: "We show you the worn parts before any work begins. No upselling, no scare tactics — just honest measurements and your options explained clearly.",
  },
  "oil-change": {
    signs: [
      "Oil change reminder light on",
      "Dark or gritty oil on the dipstick",
      "Engine running louder than usual",
      "Past due by mileage or time",
      "Burning oil smell",
      "Oil level dropping between changes",
    ],
    includes: [
      "Drain and replace engine oil",
      "New oil filter",
      "Multi-point vehicle inspection",
      "Tire pressure check and adjust",
      "Fluid level check (all systems)",
      "Visual brake inspection",
    ],
    whyUs: "We use the correct oil weight and type specified by your vehicle's manufacturer. Conventional, synthetic blend, or full synthetic — we stock them all.",
  },
  "tire-service": {
    signs: [
      "Tread depth below 4/32 of an inch",
      "Uneven tire wear patterns",
      "Vibration at highway speeds",
      "Tire pressure warning light on",
      "Visible sidewall damage or bulges",
      "Tires older than 6 years",
    ],
    includes: [
      "Tread depth measurement all four tires",
      "Tire condition and age inspection",
      "Tire pressure check and adjust",
      "Wheel alignment check",
      "Tire rotation (if applicable)",
      "TPMS sensor check",
    ],
    whyUs: "Cleveland's #1 tire shop. New and used options in stock. Every tire we sell includes our free premium installation package — mount, balance, alignment check, and lifetime rotations.",
  },
  "diagnostics": {
    signs: [
      "Check engine light on or flashing",
      "Poor fuel economy",
      "Rough idle or stalling",
      "Unusual noises from the engine",
      "Loss of power or hesitation",
      "Failed emissions / e-check test",
    ],
    includes: [
      "OBD-II code scan and analysis",
      "Live sensor data review",
      "Component-level testing",
      "Electrical system check",
      "Vacuum and pressure tests",
      "Clear explanation of findings",
    ],
    whyUs: "We use factory-level scan tools, not generic code readers. We diagnose the actual problem — not just read codes and guess. You get a clear explanation before any repair.",
  },
  "suspension-repair": {
    signs: [
      "Car bouncing excessively over bumps",
      "Nose diving when braking",
      "Vehicle pulling to one side",
      "Uneven tire wear",
      "Clunking or knocking over bumps",
      "Steering feels loose or wandering",
    ],
    includes: [
      "Full suspension inspection",
      "Shock and strut test",
      "Ball joint and tie rod check",
      "Control arm bushing inspection",
      "Wheel bearing assessment",
      "Alignment check",
    ],
    whyUs: "Cleveland roads are brutal on suspension. Potholes, salt, and freeze-thaw cycles destroy components fast. We see it daily and know exactly what to look for on every make and model.",
  },
};

export default function VehicleServicePage() {
  const { slug: paramSlug } = useParams<{ slug: string }>();
  const slug = paramSlug || (typeof window !== "undefined" ? window.location.pathname.replace(/^\//, "").split("/")[0] : "");
  const page = slug ? getVehicleServiceBySlug(slug) : undefined;

  if (!page) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="font-semibold text-4xl text-foreground mb-4">Page Not Found</h1>
          <Link href="/services" className="text-primary hover:underline">View All Services</Link>
        </div>
      </div>
    );
  }

  const content = SERVICE_CONTENT[page.serviceSlug] || SERVICE_CONTENT["diagnostics"];

  const breadcrumbs = [
    { label: "Services", href: "/#services" },
    { label: `${page.make} ${page.service}` },
  ];

  // Related pages: same make different services, or same service different makes
  const sameMakePages = VEHICLE_SERVICE_PAGES
    .filter(p => p.make === page.make && p.slug !== page.slug)
    .slice(0, 4);
  const sameServicePages = VEHICLE_SERVICE_PAGES
    .filter(p => p.service === page.service && p.slug !== page.slug)
    .slice(0, 4);

  return (
    <PageLayout showChat={true}>
      <SEOHead
        title={page.metaTitle}
        description={page.metaDescription}
        canonicalPath={`/${page.slug}`}
      />
      <LocalBusinessSchema pageName={`${page.make} ${page.service} Cleveland - Nick's Tire & Auto`} />

      {/* Hero */}
      <section className="relative pt-28 pb-16 lg:pt-36 lg:pb-24">
        <div className="absolute inset-0 bg-gradient-to-b from-background via-background/95 to-background" />
        <div className="relative container">
          <Breadcrumbs items={breadcrumbs} />
          <FadeIn>
            <h1 className="font-semibold font-bold text-5xl sm:text-6xl lg:text-7xl text-foreground leading-[0.9] tracking-tight mt-6">
              <span className="text-primary">{page.make}</span>
              <br />{page.service} Cleveland
            </h1>
          </FadeIn>
          <FadeIn delay={0.1}>
            <p className="mt-6 text-lg sm:text-xl text-foreground/80 max-w-2xl font-light leading-relaxed">
              Expert {page.service.toLowerCase()} for {page.make} vehicles in Cleveland.
              We service all {page.make} models including {page.commonModels.slice(0, 4).join(", ")}.
              Same-day service available. 4.9-star rated with 1,685+ reviews.
            </p>
          </FadeIn>
          <FadeIn delay={0.2}>
            <div className="mt-8 flex flex-col sm:flex-row gap-4">
              <a
                href={BUSINESS.phone.href}
                onClick={() => trackPhoneClick(`vehicle-service-${page.slug}-hero`)}
                className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-semibold font-bold text-lg tracking-wide hover:bg-primary/90 transition-colors"
              >
                <Phone className="w-5 h-5" />CALL FOR A FREE QUOTE
              </a>
              <Link
                href="/contact"
                className="inline-flex items-center justify-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 font-semibold font-bold text-lg tracking-wide hover:border-primary hover:text-primary transition-colors"
              >
                SCHEDULE ONLINE <ChevronRight className="w-5 h-5" />
              </Link>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Trust Bar */}
      <section className="py-8 bg-card/50 border-y border-border/30">
        <div className="container">
          <div className="flex flex-wrap items-center justify-center gap-8 text-sm text-foreground/60">
            <div className="flex items-center gap-2"><Star className="w-4 h-4 text-primary" /> 4.9 Stars, 1,685+ Reviews</div>
            <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-primary" /> Same-Day Service</div>
            <div className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary" /> Warranty on All Work</div>
            <div className="flex items-center gap-2"><Wrench className="w-4 h-4 text-primary" /> All {page.make} Models</div>
          </div>
        </div>
      </section>

      {/* Warning Signs */}
      <section className="py-16">
        <div className="container max-w-4xl">
          <FadeIn>
            <h2 className="font-semibold text-3xl text-foreground mb-6">
              Signs Your {page.make} Needs {page.service}
            </h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {content.signs.map(sign => (
                <div key={sign} className="flex items-start gap-3 p-4 bg-card rounded-sm border border-border/30">
                  <ChevronRight className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  <span className="text-foreground/80">{sign}</span>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* What's Included */}
      <section className="py-16 bg-card/50 border-y border-border/30">
        <div className="container max-w-4xl">
          <FadeIn>
            <h2 className="font-semibold text-3xl text-foreground mb-6">
              What Our {page.make} {page.service} Includes
            </h2>
            <div className="grid sm:grid-cols-2 gap-4 mb-8">
              {content.includes.map(item => (
                <div key={item} className="flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                  <span className="text-foreground/80">{item}</span>
                </div>
              ))}
            </div>
            <p className="text-foreground/70 text-sm border-l-2 border-primary/30 pl-4">
              {content.whyUs}
            </p>
          </FadeIn>
        </div>
      </section>

      {/* Models We Service */}
      <section className="py-16">
        <div className="container max-w-4xl">
          <FadeIn>
            <h2 className="font-semibold text-3xl text-foreground mb-6">
              {page.make} Models We Service
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {page.commonModels.map(model => (
                <div key={model} className="p-4 bg-card rounded-sm border border-border/30 text-center">
                  <span className="font-medium text-foreground">{page.make} {model}</span>
                </div>
              ))}
            </div>
            <p className="mt-6 text-foreground/60 text-sm">
              Don't see your model? We service all {page.make} vehicles — including older and less common models.
              Call{" "}
              <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick(`vehicle-service-${page.slug}-models`)} className="text-primary hover:underline">
                {BUSINESS.phone.display}
              </a>
              .
            </p>
          </FadeIn>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 bg-primary/5 border-y border-primary/10">
        <div className="container text-center">
          <FadeIn>
            <h2 className="font-semibold text-3xl text-foreground mb-4">
              Need {page.service} for Your {page.make}?
            </h2>
            <p className="text-foreground/70 mb-8 max-w-xl mx-auto">
              Call now for a free quote. Same-day service available. Walk-ins welcome 7 days a week.
              Transparent pricing — no surprises.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href={BUSINESS.phone.href}
                onClick={() => trackPhoneClick(`vehicle-service-${page.slug}-cta`)}
                className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-semibold font-bold text-lg tracking-wide hover:bg-primary/90 transition-colors"
              >
                <Phone className="w-5 h-5" />{BUSINESS.phone.display}
              </a>
              <Link
                href="/contact"
                className="inline-flex items-center justify-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 font-semibold font-bold text-lg tracking-wide hover:border-primary hover:text-primary transition-colors"
              >
                SCHEDULE ONLINE <ChevronRight className="w-5 h-5" />
              </Link>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Related: Same Make */}
      {sameMakePages.length > 0 && (
        <section className="py-16">
          <div className="container">
            <FadeIn>
              <h2 className="font-semibold text-2xl text-foreground mb-6">More {page.make} Services</h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {sameMakePages.map(p => (
                  <Link
                    key={p.slug}
                    href={`/${p.slug}`}
                    className="group p-4 bg-card rounded-sm border border-border/30 hover:border-primary/30 transition-colors"
                  >
                    <div className="font-semibold text-foreground group-hover:text-primary transition-colors">{p.make} {p.service}</div>
                    <div className="text-sm text-foreground/50 mt-1">Cleveland, OH</div>
                  </Link>
                ))}
              </div>
            </FadeIn>
          </div>
        </section>
      )}

      {/* Related: Same Service */}
      {sameServicePages.length > 0 && (
        <section className="py-12 border-t border-border/20">
          <div className="container">
            <FadeIn>
              <h2 className="font-semibold text-2xl text-foreground mb-6">{page.service} for Other Makes</h2>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {sameServicePages.map(p => (
                  <Link
                    key={p.slug}
                    href={`/${p.slug}`}
                    className="group p-4 bg-card rounded-sm border border-border/30 hover:border-primary/30 transition-colors"
                  >
                    <div className="font-semibold text-foreground group-hover:text-primary transition-colors">{p.make} {p.service}</div>
                    <div className="text-sm text-foreground/50 mt-1">Cleveland, OH</div>
                  </Link>
                ))}
              </div>
            </FadeIn>
          </div>
        </section>
      )}

      <InternalLinks />
    </PageLayout>
  );
}
