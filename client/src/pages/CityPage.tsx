/**
 * CityPage — City-specific landing pages for local SEO
 * Targets "[service] near [city]" search queries to capture suburb traffic
 */

import PageLayout from "@/components/PageLayout";
import { useEffect } from "react";
import { useRoute, Link } from "wouter";
import { CITIES, type CityData } from "@shared/cities";
import { SERVICES } from "@shared/services";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import BookingForm from "@/components/BookingForm";
import { Phone, MapPin, Star, ChevronRight, ArrowLeft, Navigation, CheckCircle, Menu, X } from "lucide-react";
import { motion } from "framer-motion";
import { useState } from "react";
import { BUSINESS } from "@shared/business";
import InternalLinks from "@/components/InternalLinks";
import FadeIn from "@/components/FadeIn";

const HERO_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-main-DE7GKwfCThaBL66r78QWkU.webp";

// ─── NAVBAR ───────────────────────────────────────────
function CityNavbar({ city }: { city: CityData }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "bg-background/90 backdrop-blur-md shadow-lg" : "bg-transparent"}`} aria-label="City page navigation">
      <div className="container flex items-center justify-between h-16 lg:h-20">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary flex items-center justify-center rounded-sm">
            <span className="font-semibold font-bold text-primary-foreground text-lg">N</span>
          </div>
          <div className="flex flex-col">
            <span className="font-semibold font-bold text-primary text-lg leading-tight tracking-wide">NICK'S TIRE & AUTO</span>
            <span className="text-muted-foreground text-xs tracking-wide">Serving {city.name}</span>
          </div>
        </Link>

        <div className="hidden lg:flex items-center gap-6">
          <a href="#services" className="font-semibold text-sm tracking-wide text-foreground/80 hover:text-primary transition-colors">Services</a>
          <a href="#about" className="font-semibold text-sm tracking-wide text-foreground/80 hover:text-primary transition-colors">About</a>
          <a href="#booking" className="font-semibold text-sm tracking-wide text-foreground/80 hover:text-primary transition-colors">Book Now</a>
          <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('city-navbar-desktop')} className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-md font-semibold font-bold text-sm tracking-wide hover:opacity-90 transition-colors" aria-label="Call Nick's Tire and Auto at 216-862-0005">
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
            <a href="#about" onClick={() => setMobileOpen(false)} className="font-semibold text-lg tracking-wide text-foreground/80 hover:text-primary transition-colors py-2">About</a>
            <a href="#booking" onClick={() => setMobileOpen(false)} className="font-semibold text-lg tracking-wide text-foreground/80 hover:text-primary transition-colors py-2">Book Now</a>
            <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('city-navbar-mobile')} className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-5 py-3 rounded-md font-semibold font-bold text-sm tracking-wide mt-2" aria-label="Call Nick's Tire and Auto at 216-862-0005">
              <Phone className="w-4 h-4" />
              {BUSINESS.phone.display}
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}

// ─── CITY SCHEMA ──────────────────────────────────────
function CitySchema({ city }: { city: CityData }) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "AutoRepair",
    name: `Nick's Tire & Auto — Serving ${city.name}`,
    description: city.metaDescription,
    url: `https://nickstire.org/${city.slug}`,
    telephone: `+1-${BUSINESS.phone.dashed}`,
    address: {
      "@type": "PostalAddress",
      streetAddress: BUSINESS.address.street,
      addressLocality: "Cleveland",
      addressRegion: "OH",
      postalCode: "44112",
      addressCountry: "US",
    },
    areaServed: {
      "@type": "City",
      name: city.name,
      containedInPlace: {
        "@type": "State",
        name: "Ohio",
      },
    },
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: String(BUSINESS.reviews.rating),
      reviewCount: String(BUSINESS.reviews.count),
    },
    hasMap: BUSINESS.urls.googleBusiness,
    sameAs: [...BUSINESS.sameAs],
  };

  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
  );
}

// ─── MAIN PAGE ────────────────────────────────────────
export default function CityPage() {
  const [, params] = useRoute("/:slug");
  const slug = params?.slug || "";
  const city = CITIES.find((c) => c.slug === slug);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [slug]);

  if (!city) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="font-semibold font-bold text-4xl text-foreground mb-4">PAGE NOT FOUND</h1>
          <p className="text-foreground/60 mb-8">This city page does not exist.</p>
          <Link href="/" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-md font-semibold font-bold text-sm tracking-wide">
            <ArrowLeft className="w-4 h-4" />
            BACK TO HOME
          </Link>
        </div>
      </div>
    );
  }

  const topServices = SERVICES.slice(0, 6);

  return (
    <PageLayout>
      <SEOHead
        title={city.metaTitle}
        description={city.metaDescription}
        canonicalPath={`/${city.slug}`}
      />
      <CitySchema city={city} />
      
      
      <CityNavbar city={city} />


        {/* Hero */}
        <section className="relative min-h-[60vh] lg:min-h-[70vh] flex items-end overflow-hidden">
          <div className="absolute inset-0">
            <img loading="lazy" src={HERO_IMG} alt={`Nick's Tire and Auto serving ${city.name} Ohio drivers`} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-background/30" />
          </div>

          <div className="relative container pb-16 pt-32 lg:pb-24">
            <FadeIn>
              <Breadcrumbs items={[{ label: `${city.name} Auto Repair` }]} />
            </FadeIn>

            <FadeIn delay={0.1}>
              <div className="flex items-center gap-3 mb-4 mt-4">
                <div className="flex gap-0.5">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-nick-yellow text-primary" />
                  ))}
                </div>
                <span className="text-[13px] text-primary tracking-wider">4.9 STARS — {BUSINESS.reviews.countDisplay} REVIEWS</span>
              </div>
              <h1 className="font-semibold font-bold text-4xl sm:text-5xl lg:text-7xl text-foreground leading-[0.9] tracking-tight max-w-3xl whitespace-pre-line">
                {city.heroHeadline}
              </h1>
            </FadeIn>

            <FadeIn delay={0.2}>
              <p className="mt-6 text-lg sm:text-xl text-foreground/70 max-w-2xl leading-relaxed">
                {city.heroSubline}
              </p>
            </FadeIn>

            <FadeIn delay={0.3}>
              <div className="mt-8 flex flex-col sm:flex-row gap-4">
                <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('city-hero-cta')} className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-md font-semibold font-bold text-lg tracking-wide hover:opacity-90 transition-colors" aria-label="Call Nick's Tire and Auto at 216-862-0005">
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
                  <span className="font-mono">{city.distance} from {city.name} — {city.driveTime} drive</span>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-primary" />
                  <span className="font-mono">{BUSINESS.address.full}</span>
                </div>
              </div>
            </FadeIn>
          </div>
        </section>

        {/* Local Content */}
        <section id="about" className="py-16 lg:py-24 bg-[oklch(0.065_0.004_260)]">
          <div className="container">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
              <FadeIn>
                <div>
                  <span className="font-mono text-nick-blue-light text-sm tracking-wide">Serving {city.name}, Ohio</span>
                  <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight leading-[1.05]">
                    WHY {city.name.toUpperCase()} DRIVERS<br />
                    <span className="text-primary">CHOOSE US</span>
                  </h2>
                  <p className="mt-6 text-foreground/70 leading-relaxed text-lg">
                    {city.localContent}
                  </p>
                </div>
              </FadeIn>

              <FadeIn delay={0.15}>
                <div className="bg-card/50 border border-border/50 rounded-lg p-8">
                  <div className="flex items-center gap-3 mb-6">
                    <Star className="w-6 h-6 fill-nick-yellow text-primary" />
                    <span className="font-semibold font-bold text-foreground text-lg">CUSTOMER REVIEW</span>
                  </div>
                  <blockquote className="text-foreground/80 text-lg leading-relaxed italic mb-6">
                    "{city.testimonial.text}"
                  </blockquote>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center">
                      <span className="font-semibold font-bold text-primary text-sm">{city.testimonial.author.charAt(0)}</span>
                    </div>
                    <div>
                      <p className="font-semibold font-bold text-foreground text-sm">{city.testimonial.author}</p>
                      <p className="text-foreground/50 text-xs">{city.testimonial.location}</p>
                    </div>
                  </div>
                </div>
              </FadeIn>
            </div>
          </div>
        </section>

        {/* Service Highlights */}
        <section id="services" className="py-16 lg:py-24 bg-[oklch(0.055_0.004_260)]">
          <div className="container">
            <FadeIn>
              <span className="font-mono text-nick-blue-light text-sm tracking-wide">Our Services</span>
              <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight">
                WHAT WE FIX FOR {city.name.toUpperCase()} DRIVERS
              </h2>
            </FadeIn>

            <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {city.serviceHighlights.map((highlight, i) => (
                <FadeIn key={i} delay={i * 0.05}>
                  <div className="flex items-start gap-3 bg-card/50 border border-border/50 rounded-lg p-5">
                    <CheckCircle className="w-5 h-5 text-nick-blue-light flex-shrink-0 mt-0.5" />
                    <span className="text-foreground/80 text-sm leading-relaxed">{highlight}</span>
                  </div>
                </FadeIn>
              ))}
            </div>

            {/* Links to full service pages */}
            <FadeIn delay={0.3}>
              <div className="mt-12">
                <h3 className="font-semibold font-bold text-xl text-foreground mb-6 tracking-wider">EXPLORE OUR SERVICES</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {topServices.map((s) => (
                    <Link key={s.slug} href={`/${s.slug}`} className="bg-card/80 border border-border/50 rounded-lg p-4 text-center hover:border-primary/30 hover:bg-card transition-colors group">
                      <span className="font-semibold font-bold text-sm text-foreground/80 group-hover:text-primary transition-colors tracking-wider">{s.title}</span>
                    </Link>
                  ))}
                </div>
              </div>
            </FadeIn>
          </div>
        </section>

        {/* Neighborhoods */}
        <section className="py-16 lg:py-20 bg-[oklch(0.065_0.004_260)]">
          <div className="container">
            <FadeIn>
              <h2 className="font-semibold font-bold text-2xl lg:text-3xl text-foreground tracking-tight mb-8">
                NEIGHBORHOODS WE SERVE IN {city.name.toUpperCase()}
              </h2>
              <div className="flex flex-wrap gap-3">
                {city.neighborhoods.map((n) => (
                  <span key={n} className="px-4 py-2 bg-card/50 border border-border/50 rounded-full text-sm text-foreground/70">
                    {n}
                  </span>
                ))}
                <span className="px-4 py-2 bg-primary/10 border border-primary/30 rounded-full text-sm text-primary">
                  + surrounding areas
                </span>
              </div>
            </FadeIn>
          </div>
        </section>

        {/* Booking */}
        <section id="booking" className="py-16 lg:py-24 bg-[oklch(0.055_0.004_260)]">
          <div className="container max-w-3xl">
            <FadeIn>
              <div className="text-center mb-10">
                <span className="font-mono text-nick-blue-light text-sm tracking-wide">Schedule Service</span>
                <h2 className="font-semibold font-bold text-3xl lg:text-4xl text-foreground mt-3 tracking-tight">
                  BOOK YOUR APPOINTMENT
                </h2>
                <p className="mt-4 text-foreground/60 max-w-lg mx-auto">
                  {city.name} residents — schedule your service online or call us directly at {BUSINESS.phone.display}.
                </p>
              </div>
            </FadeIn>
            <FadeIn delay={0.1}>
              <BookingForm />
            </FadeIn>
          </div>
        </section>

        {/* Other Cities */}
        <section className="py-12 lg:py-16 bg-[oklch(0.065_0.004_260)] border-t border-border/50">
          <div className="container">
            <h3 className="font-semibold font-bold text-lg text-foreground/60 tracking-[-0.01em] mb-6">ALSO SERVING</h3>
            <div className="flex flex-wrap gap-3">
              {CITIES.filter(c => c.slug !== city.slug).map((c) => (
                <Link key={c.slug} href={`/${c.slug}`} className="px-4 py-2 bg-card/50 border border-border/50 rounded-md text-sm text-foreground/70 hover:text-primary hover:border-primary/30 transition-colors">
                  {c.name} Auto Repair
                </Link>
              ))}
              <Link href="/" className="px-4 py-2 bg-card/50 border border-border/50 rounded-md text-sm text-foreground/70 hover:text-primary hover:border-primary/30 transition-colors">
                Cleveland (Main Shop)
              </Link>
            </div>
          </div>
        </section>


      {/* Footer */}
      

      {/* Mobile Sticky CTA */}
      <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-background/90 backdrop-blur-md border-t border-primary/30 p-3 flex gap-2">
        <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('city-mobile-sticky')} className="flex items-center justify-center gap-2 bg-primary text-primary-foreground flex-1 py-3.5 rounded-md font-semibold font-bold text-sm tracking-wide" aria-label="Call Nick's Tire and Auto at 216-862-0005">
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
