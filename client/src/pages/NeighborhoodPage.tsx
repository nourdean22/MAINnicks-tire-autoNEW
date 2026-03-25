/**
 * NeighborhoodPage — Neighborhood-specific landing pages for hyperlocal SEO
 * Dynamic routes for 18+ neighborhoods around Cleveland service area
 */

import PageLayout from "@/components/PageLayout";
import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import { NEIGHBORHOODS, type Neighborhood } from "@shared/neighborhoods";
import { BUSINESS } from "@shared/business";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import { Phone, MapPin, Star, ChevronRight, ArrowLeft, Navigation, CheckCircle, Menu, X } from "lucide-react";
import { motion } from "framer-motion";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import InternalLinks from "@/components/InternalLinks";
import FadeIn from "@/components/FadeIn";

const HERO_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-main-DE7GKwfCThaBL66r78QWkU.webp";

const SERVICES = [
  { id: 1, name: "Brakes", icon: "🛑" },
  { id: 2, name: "Tires", icon: "🛞" },
  { id: 3, name: "Oil Change", icon: "🛢️" },
  { id: 4, name: "Diagnostics", icon: "🔧" },
  { id: 5, name: "Alignment", icon: "⚖️" },
  { id: 6, name: "General Repair", icon: "🔩" },
];

const STATIC_REVIEWS = [
  {
    text: "Nick's team is honest, fast, and fair. They diagnosed my car issue in minutes and got me back on the road.",
    author: "Sarah M.",
  },
  {
    text: "Best local shop in the area. They actually explain what they're doing instead of just taking your money.",
    author: "James T.",
  },
  {
    text: "I've been coming here for 5 years. Never had an issue. Highly recommend to anyone in the neighborhood.",
    author: "Maria L.",
  },
];

// ─── NEIGHBORHOOD NAVBAR ───────────────────────────────────
function NeighborhoodNavbar({ neighborhood }: { neighborhood: Neighborhood }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "bg-background/90 backdrop-blur-md shadow-lg" : "bg-transparent"}`} aria-label="Neighborhood page navigation">
      <div className="container flex items-center justify-between h-16 lg:h-20">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary flex items-center justify-center rounded-sm">
            <span className="font-semibold font-bold text-primary-foreground text-lg">N</span>
          </div>
          <div className="flex flex-col">
            <span className="font-semibold font-bold text-primary text-lg leading-tight tracking-wide">NICK'S TIRE & AUTO</span>
            <span className="text-muted-foreground text-xs tracking-wide">Serving {neighborhood.name}</span>
          </div>
        </Link>

        <div className="hidden lg:flex items-center gap-6">
          <a href="#services" className="font-semibold text-sm tracking-wide text-foreground/80 hover:text-primary transition-colors">Services</a>
          <a href="#reviews" className="font-semibold text-sm tracking-wide text-foreground/80 hover:text-primary transition-colors">Reviews</a>
          <a href="#booking" className="font-semibold text-sm tracking-wide text-foreground/80 hover:text-primary transition-colors">Book Now</a>
          <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('neighborhood-navbar-desktop')} className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-md font-semibold font-bold text-sm tracking-wide hover:opacity-90 transition-colors" aria-label={`Call ${BUSINESS.name} at ${BUSINESS.phone.display}`}>
            <Phone className="w-4 h-4" />
            {BUSINESS.phone.display}
          </a>
        </div>

        <button onClick={() => setMobileOpen(!mobileOpen)} className="lg:hidden text-foreground p-2" aria-label={mobileOpen ? "Close menu" : "Open menu"}>
          {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="lg:hidden bg-background/98 backdrop-blur-md border-t border-primary/20">
          <div className="container py-6 flex flex-col gap-4">
            <Link href="/" onClick={() => setMobileOpen(false)} className="flex items-center gap-2 font-semibold text-lg tracking-wide text-foreground/60 hover:text-nick-blue-light transition-colors py-2">
              <ArrowLeft className="w-5 h-5" />
              Back to Home
            </Link>
            <a href="#services" onClick={() => setMobileOpen(false)} className="font-semibold text-lg tracking-wide text-foreground/80 hover:text-primary transition-colors py-2">Services</a>
            <a href="#reviews" onClick={() => setMobileOpen(false)} className="font-semibold text-lg tracking-wide text-foreground/80 hover:text-primary transition-colors py-2">Reviews</a>
            <a href="#booking" onClick={() => setMobileOpen(false)} className="font-semibold text-lg tracking-wide text-foreground/80 hover:text-primary transition-colors py-2">Book Now</a>
            <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('neighborhood-navbar-mobile')} className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-5 py-3 rounded-md font-semibold font-bold text-sm tracking-wide mt-2" aria-label={`Call ${BUSINESS.name} at ${BUSINESS.phone.display}`}>
              <Phone className="w-4 h-4" />
              {BUSINESS.phone.display}
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}

// ─── NEIGHBORHOOD SCHEMA ──────────────────────────────────
function NeighborhoodSchema({ neighborhood }: { neighborhood: Neighborhood }) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "AutoRepair",
    name: `${BUSINESS.name} — Serving ${neighborhood.name}`,
    description: neighborhood.description,
    url: `https://nickstire.org/${neighborhood.slug}`,
    telephone: `+1-${BUSINESS.phone.dashed}`,
    address: {
      "@type": "PostalAddress",
      streetAddress: BUSINESS.address.street,
      addressLocality: BUSINESS.address.city,
      addressRegion: BUSINESS.address.state,
      postalCode: BUSINESS.address.zip,
      addressCountry: "US",
    },
    areaServed: {
      "@type": "City",
      name: neighborhood.name,
    },
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: "4.9",
      reviewCount: "180+",
    },
  };

  // FAQPage schema with location-specific FAQs
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: `How long does it take to get to ${neighborhood.name} from Nick's Tire & Auto?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `It takes approximately ${neighborhood.driveTime} from our main location to ${neighborhood.name}. ${neighborhood.directionsFrom}`,
        },
      },
      {
        "@type": "Question",
        name: `What services do you offer for ${neighborhood.name} residents?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: "We offer a full range of auto repair services including brakes, tires, oil changes, diagnostics, alignment, and general repairs for all makes and models.",
        },
      },
      {
        "@type": "Question",
        name: `Do you serve the ${neighborhood.name} area?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `Yes, we proudly serve ${neighborhood.name} and surrounding areas with professional auto repair and maintenance services.`,
        },
      },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
    </>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────
export default function NeighborhoodPage() {
  const [location] = useLocation();
  const slug = location.startsWith("/") ? location.slice(1) : location;
  const neighborhood = NEIGHBORHOODS.find((n) => n.slug === slug);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [slug]);

  if (!neighborhood) {
    return (
      <PageLayout>
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="text-center">
            <h1 className="font-semibold font-bold text-4xl text-foreground mb-4">PAGE NOT FOUND</h1>
            <p className="text-foreground/60 mb-8">This neighborhood page does not exist.</p>
            <Link href="/" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-md font-semibold font-bold text-sm tracking-wide">
              <ArrowLeft className="w-4 h-4" />
              BACK TO HOME
            </Link>
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <SEOHead
        title={`${neighborhood.name} Auto Repair — ${BUSINESS.name} (${neighborhood.driveTime} Away)`}
        description={neighborhood.description}
        canonicalPath={`/${neighborhood.slug}`}
      />
      <NeighborhoodSchema neighborhood={neighborhood} />

      <NeighborhoodNavbar neighborhood={neighborhood} />

      {/* Hero */}
      <section className="relative min-h-[60vh] lg:min-h-[70vh] flex items-end overflow-hidden">
        <div className="absolute inset-0">
          <img loading="lazy" src={HERO_IMG} alt={`${BUSINESS.name} serving ${neighborhood.name}`} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-background/30" />
        </div>

        <div className="relative container pb-16 pt-32 lg:pb-24">
          <FadeIn>
            <Breadcrumbs items={[{ label: `${neighborhood.name} Auto Repair` }]} />
          </FadeIn>

          <FadeIn delay={0.1}>
            <div className="flex items-center gap-3 mb-4 mt-4">
              <div className="flex gap-0.5">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="w-4 h-4 fill-nick-yellow text-primary" />
                ))}
              </div>
              <span className="text-[13px] text-primary tracking-wider">4.9 STARS — 180+ REVIEWS</span>
            </div>
            <h1 className="font-semibold font-bold text-4xl sm:text-5xl lg:text-7xl text-foreground leading-[0.9] tracking-tight max-w-3xl whitespace-pre-line">
              {neighborhood.headline}
            </h1>
          </FadeIn>

          <FadeIn delay={0.2}>
            <p className="mt-6 text-lg sm:text-xl text-foreground/70 max-w-2xl leading-relaxed">
              {neighborhood.description}
            </p>
          </FadeIn>

          <FadeIn delay={0.3}>
            <div className="mt-8 flex flex-col sm:flex-row gap-4">
              <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('neighborhood-hero-cta')} className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-md font-semibold font-bold text-lg tracking-wide hover:opacity-90 transition-colors" aria-label={`Call ${BUSINESS.name} at ${BUSINESS.phone.display}`}>
                <Phone className="w-5 h-5" />
                CALL FOR A FREE QUOTE
              </a>
              <a href="#booking" className="inline-flex items-center justify-center gap-2 border-2 border-nick-blue/50 text-nick-blue-light px-8 py-4 rounded-md font-semibold font-bold text-lg tracking-wide hover:bg-nick-blue/10 hover:border-nick-blue transition-colors">
                BOOK ONLINE
                <ChevronRight className="w-5 h-5" />
              </a>
            </div>
          </FadeIn>

          <FadeIn delay={0.4}>
            <div className="mt-8 flex flex-wrap gap-6 text-sm text-foreground/60">
              <div className="flex items-center gap-2">
                <Navigation className="w-4 h-4 text-nick-blue-light" />
                <span className="font-mono">Only {neighborhood.driveTime} away!</span>
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-primary" />
                <span className="font-mono">{BUSINESS.address.full}</span>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Directions */}
      <section className="py-16 lg:py-24 bg-[oklch(0.065_0.004_260)]">
        <div className="container">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            <FadeIn>
              <div>
                <span className="font-mono text-nick-blue-light text-sm tracking-wide">Getting Here</span>
                <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight leading-[1.05]">
                  How to Get Here<br />
                  <span className="text-primary">from {neighborhood.name}</span>
                </h2>
                <p className="mt-6 text-foreground/70 leading-relaxed text-lg">
                  {neighborhood.directionsFrom}
                </p>
                <div className="mt-6 space-y-3">
                  <div className="flex items-center gap-3 text-foreground/80">
                    <Navigation className="w-5 h-5 text-primary flex-shrink-0" />
                    <span className="text-sm">Drive time: {neighborhood.driveTime}</span>
                  </div>
                  <div className="flex items-center gap-3 text-foreground/80">
                    <MapPin className="w-5 h-5 text-primary flex-shrink-0" />
                    <span className="text-sm">Distance: {neighborhood.driveMiles}</span>
                  </div>
                </div>
              </div>
            </FadeIn>

            <FadeIn delay={0.15}>
              <div className="bg-card/50 border border-border/50 rounded-lg overflow-hidden h-96">
                <iframe
                  width="100%"
                  height="100%"
                  style={{ border: 0 }}
                  loading="lazy"
                  allowFullScreen
                  referrerPolicy="no-referrer-when-downgrade"
                  src={`https://www.google.com/maps/embed/v1/directions?key=AIzaSyDYAq3hKrKnNRoXVcvgr0AZb2Y-xKG4BfU&origin=${neighborhood.lat},${neighborhood.lng}&destination=${BUSINESS.geo.lat},${BUSINESS.geo.lng}`}
                />
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* Local Content */}
      <section className="py-16 lg:py-24 bg-[oklch(0.055_0.004_260)]">
        <div className="container max-w-3xl">
          <FadeIn>
            <p className="text-foreground/70 leading-relaxed text-lg">
              {neighborhood.localContent}
            </p>
          </FadeIn>
        </div>
      </section>

      {/* Services */}
      <section id="services" className="py-16 lg:py-24 bg-[oklch(0.065_0.004_260)]">
        <div className="container">
          <FadeIn>
            <span className="font-mono text-nick-blue-light text-sm tracking-wide">Our Services</span>
            <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight">
              WHAT WE FIX
            </h2>
          </FadeIn>

          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {SERVICES.map((service, i) => (
              <FadeIn key={service.id} delay={i * 0.05}>
                <a href={`/contact?service=${service.name.toLowerCase().replace(/\s+/g, '-')}`} className="flex items-center gap-3 bg-card/50 border border-border/50 rounded-lg p-5 hover:border-primary/30 hover:bg-card transition-colors group">
                  <span className="text-2xl">{service.icon}</span>
                  <span className="text-foreground/80 text-sm font-semibold group-hover:text-primary transition-colors">{service.name}</span>
                  <ChevronRight className="w-4 h-4 text-foreground/30 group-hover:text-primary ml-auto transition-colors" />
                </a>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* Reviews */}
      <section id="reviews" className="py-16 lg:py-24 bg-[oklch(0.055_0.004_260)]">
        <div className="container">
          <FadeIn>
            <span className="font-mono text-nick-blue-light text-sm tracking-wide">What {neighborhood.name} Residents Say</span>
            <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight">
              CUSTOMER REVIEWS
            </h2>
          </FadeIn>

          <div className="mt-10 grid grid-cols-1 lg:grid-cols-3 gap-6">
            {STATIC_REVIEWS.map((review, i) => (
              <FadeIn key={i} delay={i * 0.05}>
                <div className="bg-card/50 border border-border/50 rounded-lg p-6">
                  <div className="flex gap-0.5 mb-4">
                    {[...Array(5)].map((_, j) => (
                      <Star key={j} className="w-4 h-4 fill-nick-yellow text-primary" />
                    ))}
                  </div>
                  <blockquote className="text-foreground/80 leading-relaxed italic mb-4">
                    "{review.text}"
                  </blockquote>
                  <p className="font-semibold font-bold text-foreground text-sm">— {review.author}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section id="booking" className="py-16 lg:py-24 bg-[oklch(0.065_0.004_260)]">
        <div className="container max-w-3xl">
          <FadeIn>
            <div className="text-center">
              <span className="font-mono text-nick-blue-light text-sm tracking-wide">Schedule Service</span>
              <h2 className="font-semibold font-bold text-3xl lg:text-4xl text-foreground mt-3 tracking-tight">
                BOOK YOUR APPOINTMENT
              </h2>
              <p className="mt-4 text-foreground/60 text-lg">
                {neighborhood.name} residents are just {neighborhood.driveTime} away. Call us or book online.
              </p>
            </div>

            <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-6">
              <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('neighborhood-cta-call')} className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-md font-semibold font-bold text-lg tracking-wide hover:opacity-90 transition-colors" aria-label={`Call ${BUSINESS.name} at ${BUSINESS.phone.display}`}>
                <Phone className="w-5 h-5" />
                {BUSINESS.phone.display}
              </a>
              <a href="https://nickstire.org/book" className="flex items-center justify-center gap-2 border-2 border-nick-blue/50 text-nick-blue-light px-8 py-4 rounded-md font-semibold font-bold text-lg tracking-wide hover:bg-nick-blue/10 hover:border-nick-blue transition-colors">
                BOOK ONLINE
                <ChevronRight className="w-5 h-5" />
              </a>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Nearby Neighborhoods */}
      <section className="py-12 lg:py-16 bg-[oklch(0.055_0.004_260)] border-t border-border/50">
        <div className="container">
          <FadeIn>
            <h3 className="font-semibold font-bold text-lg text-foreground/60 tracking-[-0.01em] mb-6">NEARBY NEIGHBORHOODS</h3>
            <div className="flex flex-wrap gap-3">
              {neighborhood.nearbyLandmarks
                .slice(0, 4)
                .map((landmark, i) => {
                  const nearbyNeighborhood = NEIGHBORHOODS.find((n) => n.name === landmark || n.name.includes(landmark));
                  return nearbyNeighborhood ? (
                    <Link key={i} href={`/${nearbyNeighborhood.slug}`} className="px-4 py-2 bg-card/50 border border-border/50 rounded-md text-sm text-foreground/70 hover:text-primary hover:border-primary/30 transition-colors">
                      {landmark}
                    </Link>
                  ) : null;
                })}
              <Link href="/" className="px-4 py-2 bg-card/50 border border-border/50 rounded-md text-sm text-foreground/70 hover:text-primary hover:border-primary/30 transition-colors">
                View All Areas
              </Link>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Mobile Sticky CTA */}
      <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-background/90 backdrop-blur-md border-t border-primary/30 p-3 flex gap-2">
        <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('neighborhood-mobile-sticky')} className="flex items-center justify-center gap-2 bg-primary text-primary-foreground flex-1 py-3.5 rounded-md font-semibold font-bold text-sm tracking-wide" aria-label={`Call ${BUSINESS.name} at ${BUSINESS.phone.display}`}>
          <Phone className="w-4 h-4" />
          CALL NOW
        </a>
        <a href="#booking" className="flex items-center justify-center gap-2 border-2 border-nick-blue text-nick-blue-light flex-1 py-3.5 rounded-md font-semibold font-bold text-sm tracking-wide" aria-label="Book an appointment online">
          BOOK ONLINE
        </a>
      </div>

      <InternalLinks />
    </PageLayout>
  );
}
