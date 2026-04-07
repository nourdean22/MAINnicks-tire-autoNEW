/**
 * Services Overview Page — /services
 * Dedicated landing page listing all services for SEO and user navigation.
 * Follows the brand content structure: Problem Hook → Explanation → Authority → CTA
 */
import { Link } from "wouter";
import PageLayout from "@/components/PageLayout";
import InternalLinks from "@/components/InternalLinks";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import { Phone, ChevronRight, Wrench, Shield, Gauge, Zap, Droplets, ThermometerSun, Star, MapPin, Snowflake, Settings, Battery, Wind, Thermometer, ClipboardCheck, Cable, CircleDot } from "lucide-react";
import { BUSINESS } from "@shared/business";

const SERVICES_LIST = [
  {
    slug: "tires",
    title: "Tires",
    icon: <Gauge className="w-8 h-8" />,
    shortDesc: "New and used tires, mounting, balancing, rotation, TPMS sensors, and flat repair.",
    problems: ["Uneven tire wear", "Low tire pressure warning", "Vibration at highway speed"],
  },
  {
    slug: "brakes",
    title: "Brakes",
    icon: <Shield className="w-8 h-8" />,
    shortDesc: "Brake pads, rotors, calipers, brake lines, and ABS diagnostics.",
    problems: ["Squealing when braking", "Grinding noise", "Brake pedal feels soft"],
  },
  {
    slug: "diagnostics",
    title: "Diagnostics",
    icon: <Zap className="w-8 h-8" />,
    shortDesc: "Check engine light, OBD-II code reading, and advanced computer diagnostics.",
    problems: ["Check engine light on", "Warning lights on dashboard", "Car running rough"],
  },
  {
    slug: "emissions",
    title: "Emissions & E-Check",
    icon: <ThermometerSun className="w-8 h-8" />,
    shortDesc: "Ohio E-Check diagnosis and repair — oxygen sensors, EVAP leaks, catalytic converters.",
    problems: ["Failed Ohio E-Check", "Emissions warning light", "High emissions readings"],
  },
  {
    slug: "oil-change",
    title: "Oil Change",
    icon: <Droplets className="w-8 h-8" />,
    shortDesc: "Conventional and synthetic oil changes with filter replacement.",
    problems: ["Oil change light on", "Dark or dirty oil", "Engine running louder than usual"],
  },
  {
    slug: "general-repair",
    title: "General Repair",
    icon: <Wrench className="w-8 h-8" />,
    shortDesc: "Suspension, steering, exhaust, cooling systems, belts, hoses, and more.",
    problems: ["Car pulling to one side", "Unusual noises", "Fluid leaks under vehicle"],
  },
  {
    slug: "ac-repair",
    title: "AC & Heating",
    icon: <Snowflake className="w-8 h-8" />,
    shortDesc: "AC recharge, compressor, condenser, evaporator, heater core, and blower motor.",
    problems: ["AC blowing warm air", "Weak airflow", "Heater not working"],
  },
  {
    slug: "transmission",
    title: "Transmission",
    icon: <Settings className="w-8 h-8" />,
    shortDesc: "Transmission fluid service, diagnostics, solenoid repair, and rebuilds.",
    problems: ["Transmission slipping", "Hard shifting", "Burning smell"],
  },
  {
    slug: "electrical",
    title: "Electrical",
    icon: <Zap className="w-8 h-8" />,
    shortDesc: "Battery, alternator, starter, wiring, fuses, power windows.",
    problems: ["Car won't start", "Battery dies overnight", "Dimming lights"],
  },
  {
    slug: "battery",
    title: "Battery Service",
    icon: <Battery className="w-8 h-8" />,
    shortDesc: "Free battery testing and same-day replacement. Don't get stranded.",
    problems: ["Slow cranking", "Battery light on", "Needed a jump start"],
  },
  {
    slug: "exhaust",
    title: "Exhaust & Muffler",
    icon: <Wind className="w-8 h-8" />,
    shortDesc: "Muffler, catalytic converter, exhaust pipe, manifold, and resonator.",
    problems: ["Loud exhaust", "Failed E-Check", "Exhaust smell inside car"],
  },
  {
    slug: "cooling",
    title: "Cooling System",
    icon: <Thermometer className="w-8 h-8" />,
    shortDesc: "Radiator, water pump, thermostat, coolant flush, and hose replacement.",
    problems: ["Engine overheating", "Coolant leak", "Temperature gauge high"],
  },
  {
    slug: "pre-purchase-inspection",
    title: "Pre-Purchase Inspection",
    icon: <ClipboardCheck className="w-8 h-8" />,
    shortDesc: "150+ point used car inspection with written report. Know before you buy.",
    problems: ["Buying a used car", "Unknown service history", "Too good to be true price"],
  },
  {
    slug: "belts-hoses",
    title: "Belts & Hoses",
    icon: <Cable className="w-8 h-8" />,
    shortDesc: "Serpentine belt, timing belt, radiator hoses, and heater hoses.",
    problems: ["Squealing on startup", "Visible belt cracks", "Coolant leak from hose"],
  },
  {
    slug: "starter-alternator",
    title: "Starter & Alternator",
    icon: <CircleDot className="w-8 h-8" />,
    shortDesc: "Starter motor and alternator diagnostics and same-day replacement.",
    problems: ["Clicking no-start", "Battery keeps dying", "Charging system light"],
  },
];

export default function ServicesOverview() {
  return (
    <PageLayout showChat={true}>
      <SEOHead
        title="Auto Repair Services | Nick's Tire & Auto Cleveland"
        description={`Complete auto repair services in Cleveland, Ohio. Tires, brakes, diagnostics, emissions, oil changes, and general repair. ${BUSINESS.taglines.hookAction} Honest diagnostics, fair prices. Call ${BUSINESS.phone.display}.`}
        canonicalPath="/services"
      />
      <Breadcrumbs items={[{ label: "Services", href: "/services" }]} />

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
            <p className="mt-6 text-foreground/70 text-lg leading-relaxed max-w-2xl">
              From routine oil changes to complex engine diagnostics, our experienced technicians handle every repair with honest communication and fair pricing. We explain the problem, show you the worn parts, and let you decide — no pressure, no upselling.
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
                <span className="font-bold text-2xl text-foreground">Expert</span>
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
            <Link href="/contact" className="inline-flex items-center gap-2 border border-foreground/30 text-foreground px-8 py-4 rounded-full font-medium hover:bg-foreground/5 transition-colors">
              Get Directions
              <ChevronRight className="w-5 h-5" />
            </Link>
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
