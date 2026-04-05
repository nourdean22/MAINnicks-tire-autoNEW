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
        <Link href="/" className="flex items-center gap-3 stagger-in">
          <div className="w-10 h-10 bg-primary flex items-center justify-center rounded-sm">
            <span className="font-semibold font-bold text-primary-foreground text-lg">N</span>
          </div>
          <div className="flex flex-col">
            <span className="font-semibold font-bold text-primary text-lg leading-tight tracking-wide">NICK'S TIRE & AUTO</span>
            <span className="text-muted-foreground text-xs tracking-wide">Serving {city.name}</span>
          </div>
        </Link>

        <div className="hidden lg:flex items-center gap-6 stagger-in">
          <a href="#services" className="font-semibold text-sm tracking-wide text-foreground/80 hover:text-primary transition-colors">Services</a>
          <a href="#about" className="font-semibold text-sm tracking-wide text-foreground/80 hover:text-primary transition-colors">About</a>
          <a href="#booking" className="font-semibold text-sm tracking-wide text-foreground/80 hover:text-primary transition-colors">Book Now</a>
          <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('city-navbar-desktop')} className="flex items-center gap-2 stagger-in bg-primary text-primary-foreground btn-premium px-5 py-2.5 rounded-md font-semibold font-bold text-sm tracking-wide hover:opacity-90 transition-colors" aria-label="Call Nick's Tire and Auto at 216-862-0005">
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
          <div className="container py-6 flex flex-col gap-4 stagger-in">
            <Link href="/" onClick={() => setMobileOpen(false)} className="flex items-center gap-2 stagger-in font-semibold text-lg tracking-wide text-foreground/60 hover:text-nick-blue-light transition-colors py-2">
              <ArrowLeft className="w-5 h-5" />
              Back to Home
            </Link>
            <a href="#services" onClick={() => setMobileOpen(false)} className="font-semibold text-lg tracking-wide text-foreground/80 hover:text-primary transition-colors py-2">Services</a>
            <a href="#about" onClick={() => setMobileOpen(false)} className="font-semibold text-lg tracking-wide text-foreground/80 hover:text-primary transition-colors py-2">About</a>
            <a href="#booking" onClick={() => setMobileOpen(false)} className="font-semibold text-lg tracking-wide text-foreground/80 hover:text-primary transition-colors py-2">Book Now</a>
            <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('city-navbar-mobile')} className="flex items-center justify-center gap-2 stagger-in bg-primary text-primary-foreground btn-premium px-5 py-3 rounded-md font-semibold font-bold text-sm tracking-wide mt-2" aria-label="Call Nick's Tire and Auto at 216-862-0005">
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
          <Link href="/" className="inline-flex items-center gap-2 stagger-in bg-primary text-primary-foreground btn-premium px-8 py-4 rounded-md font-semibold font-bold text-sm tracking-wide">
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
              <div className="flex items-center gap-3 stagger-in mb-4 mt-4">
                <div className="flex gap-0 stagger-in.5">
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
              <div className="mt-8 flex flex-col sm:flex-row gap-4 stagger-in">
                <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('city-hero-cta')} className="inline-flex items-center justify-center gap-2 stagger-in bg-primary text-primary-foreground btn-premium px-8 py-4 rounded-md font-semibold font-bold text-lg tracking-wide hover:opacity-90 transition-colors" aria-label="Call Nick's Tire and Auto at 216-862-0005">
                  <Phone className="w-5 h-5" />
                  CALL FOR A FREE QUOTE
                </a>
                <a href="#booking" className="inline-flex items-center justify-center gap-2 stagger-in border-2 border-nick-blue/50 text-nick-blue-light px-8 py-4 rounded-md font-semibold font-bold text-lg tracking-wide hover:bg-nick-blue/10 hover:border-nick-blue transition-colors">
                  BOOK ONLINE
                  <ChevronRight className="w-5 h-5" />
                </a>
              </div>
            </FadeIn>

            <FadeIn delay={0.4}>
              <div className="mt-8 flex flex-wrap gap-6 stagger-in text-sm text-foreground/60">
                <div className="flex items-center gap-2 stagger-in">
                  <Navigation className="w-4 h-4 text-nick-blue-light" />
                  <span className="font-mono">{city.distance} from {city.name} — {city.driveTime} drive</span>
                </div>
                <div className="flex items-center gap-2 stagger-in">
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
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 stagger-in lg:gap-20 items-center">
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
                  <div className="flex items-center gap-3 stagger-in mb-6">
                    <Star className="w-6 h-6 fill-nick-yellow text-primary" />
                    <span className="font-semibold font-bold text-foreground text-lg">CUSTOMER REVIEW</span>
                  </div>
                  <blockquote className="text-foreground/80 text-lg leading-relaxed italic mb-6">
                    "{city.testimonial.text}"
                  </blockquote>
                  <div className="flex items-center gap-3 stagger-in">
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

            <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger-in">
              {city.serviceHighlights.map((highlight, i) => (
                <FadeIn key={i} delay={i * 0.05}>
                  <div className="flex items-start gap-3 stagger-in bg-card/50 border border-border/50 rounded-lg p-5">
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
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 stagger-in">
                  {topServices.map((s) => (
                    <Link key={s.slug} href={`/${s.slug}`} className="bg-card/80 border border-border/50 rounded-lg p-4 text-center hover:border-primary/30 hover:bg-card transition-colors group">
                      <span className="font-semibold font-bold text-sm text-foreground/80 group-hover:text-primary transition-colors tracking-wider">{s.title}</span>
                    </Link>
                  ))}
                </div>
              </div>
            </FadeIn>

            <FadeIn delay={0.4}>
              <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 stagger-in">
                {SERVICES.slice(6).map((s) => (
                  <Link key={s.slug} href={`/${s.slug}`} className="bg-card/80 border border-border/50 rounded-lg p-4 text-center hover:border-primary/30 hover:bg-card transition-colors group">
                    <span className="font-semibold text-xs text-foreground/60 group-hover:text-primary transition-colors tracking-wider">{s.title}</span>
                  </Link>
                ))}
                <Link href="/alignment" className="bg-card/80 border border-border/50 rounded-lg p-4 text-center hover:border-primary/30 hover:bg-card transition-colors group">
                  <span className="font-semibold text-xs text-foreground/60 group-hover:text-primary transition-colors tracking-wider">ALIGNMENT</span>
                </Link>
              </div>
            </FadeIn>

            <div className="mt-8 flex flex-wrap justify-center gap-4 stagger-in text-sm text-foreground/50">
              <Link href="/financing" className="text-emerald-400 hover:underline">Financing from $10 down</Link>
              <span className="text-foreground/20">|</span>
              <Link href="/booking" className="hover:text-primary transition-colors">Book online</Link>
              <span className="text-foreground/20">|</span>
              <Link href="/diagnose" className="hover:text-primary transition-colors">Diagnose my car</Link>
              <span className="text-foreground/20">|</span>
              <Link href="/blog" className="hover:text-primary transition-colors">Repair tips blog</Link>
              <span className="text-foreground/20">|</span>
              <Link href="/reviews" className="hover:text-primary transition-colors">Read reviews</Link>
            </div>
          </div>
        </section>

        {/* Why Choose Nick's */}
        <section className="py-16 lg:py-24 bg-[oklch(0.055_0.004_260)]">
          <div className="container max-w-4xl">
            <FadeIn>
              <span className="font-mono text-nick-blue-light text-sm tracking-wide">The Nick's Difference</span>
              <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight">
                WHY {city.name.toUpperCase()} DRIVERS TRUST NICK'S
              </h2>
              <p className="mt-6 text-foreground/70 leading-relaxed text-lg">
                Finding an honest mechanic shouldn't feel like a gamble. At Nick's Tire & Auto on Euclid Ave in Cleveland, we've built our reputation one car at a time — and {BUSINESS.reviews.countDisplay} Google reviews at {BUSINESS.reviews.rating} stars prove it. Here's what {city.name} drivers can count on every visit.
              </p>
            </FadeIn>
            <div className="mt-10 space-y-6">
              <FadeIn delay={0.05}>
                <div className="flex items-start gap-4 stagger-in bg-card/30 border border-border/50 rounded-lg p-6">
                  <CheckCircle className="w-6 h-6 text-nick-blue-light flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold font-bold text-foreground text-lg mb-2">Transparent Pricing, No Surprises</h3>
                    <p className="text-foreground/70 leading-relaxed">We quote you a price before we start any work. If something changes during the repair, we call you first. No hidden fees, no upsells, no pressure. What we quote is what you pay.</p>
                  </div>
                </div>
              </FadeIn>
              <FadeIn delay={0.1}>
                <div className="flex items-start gap-4 stagger-in bg-card/30 border border-border/50 rounded-lg p-6">
                  <CheckCircle className="w-6 h-6 text-nick-blue-light flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold font-bold text-foreground text-lg mb-2">Walk-Ins Welcome, First Come First Served</h3>
                    <p className="text-foreground/70 leading-relaxed">No appointment needed for most services. Drive in from {city.name} and we'll get you taken care of. We operate on a first-come, first-served basis — the earlier you arrive, the sooner you're back on the road. Our shop is open {BUSINESS.hours.display}, including Sundays from 9 to 4.</p>
                  </div>
                </div>
              </FadeIn>
              <FadeIn delay={0.15}>
                <div className="flex items-start gap-4 stagger-in bg-card/30 border border-border/50 rounded-lg p-6">
                  <CheckCircle className="w-6 h-6 text-nick-blue-light flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold font-bold text-foreground text-lg mb-2">Affordable Financing From $10 Down</h3>
                    <p className="text-foreground/70 leading-relaxed">Need tires or a major repair but can't pay in full today? We offer <Link href="/financing" className="text-nick-blue-light hover:underline">financing starting at just $10 down</Link>. Get the repair done now and pay over time — so you're never stuck driving on unsafe brakes or bald tires.</p>
                  </div>
                </div>
              </FadeIn>
              <FadeIn delay={0.2}>
                <div className="flex items-start gap-4 stagger-in bg-card/30 border border-border/50 rounded-lg p-6">
                  <CheckCircle className="w-6 h-6 text-nick-blue-light flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold font-bold text-foreground text-lg mb-2">Real Mechanics, Real Experience</h3>
                    <p className="text-foreground/70 leading-relaxed">Our technicians work on everything from daily drivers to trucks and SUVs. Whether it's a <Link href="/check-engine-light-cleveland" className="text-nick-blue-light hover:underline">check engine light</Link>, <Link href="/brakes" className="text-nick-blue-light hover:underline">brake job</Link>, or <Link href="/tires" className="text-nick-blue-light hover:underline">full tire replacement</Link>, we diagnose the actual problem — not just the most expensive one.</p>
                  </div>
                </div>
              </FadeIn>
            </div>
          </div>
        </section>

        {/* Common Services for Area */}
        <section className="py-16 lg:py-24 bg-[oklch(0.065_0.004_260)]">
          <div className="container max-w-4xl">
            <FadeIn>
              <span className="font-mono text-nick-blue-light text-sm tracking-wide">Popular in {city.name}</span>
              <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight">
                COMMON REPAIRS FOR {city.name.toUpperCase()} VEHICLES
              </h2>
              <p className="mt-6 text-foreground/70 leading-relaxed text-lg">
                Ohio roads are tough on cars. Between potholes, salt, and temperature swings, {city.name} drivers deal with wear and tear that drivers in milder climates never see. These are the repairs we handle most often for customers coming from {city.name}.
              </p>
            </FadeIn>
            <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-4 stagger-in">
              <FadeIn delay={0.05}>
                <Link href="/tires" className="bg-card/30 border border-border/50 rounded-lg p-5 hover:border-primary/30 transition-colors block">
                  <h3 className="font-semibold font-bold text-foreground mb-2">Tire Replacement & Repair</h3>
                  <p className="text-foreground/60 text-sm leading-relaxed">Potholes on {city.name} roads cause flats, sidewall damage, and uneven wear. We carry new and used tires from all major brands — mounted and balanced while you wait.</p>
                </Link>
              </FadeIn>
              <FadeIn delay={0.1}>
                <Link href="/brakes" className="bg-card/30 border border-border/50 rounded-lg p-5 hover:border-primary/30 transition-colors block">
                  <h3 className="font-semibold font-bold text-foreground mb-2">Brake Pads, Rotors & Lines</h3>
                  <p className="text-foreground/60 text-sm leading-relaxed">Stop-and-go traffic wears brakes fast. Squealing, grinding, or a soft pedal? We inspect and replace pads, rotors, calipers, and brake lines same-day in most cases.</p>
                </Link>
              </FadeIn>
              <FadeIn delay={0.15}>
                <Link href="/check-engine-light-cleveland" className="bg-card/30 border border-border/50 rounded-lg p-5 hover:border-primary/30 transition-colors block">
                  <h3 className="font-semibold font-bold text-foreground mb-2">Check Engine Light Diagnostics</h3>
                  <p className="text-foreground/60 text-sm leading-relaxed">That dashboard warning could be a loose gas cap or a failing catalytic converter. We pull codes, run full diagnostics, and tell you exactly what's wrong before recommending any repairs.</p>
                </Link>
              </FadeIn>
              <FadeIn delay={0.2}>
                <Link href="/oil-change" className="bg-card/30 border border-border/50 rounded-lg p-5 hover:border-primary/30 transition-colors block">
                  <h3 className="font-semibold font-bold text-foreground mb-2">Oil Changes & Fluid Services</h3>
                  <p className="text-foreground/60 text-sm leading-relaxed">Regular oil changes are the cheapest way to avoid expensive engine damage. We do conventional and synthetic oil changes with a courtesy inspection included — no appointment needed.</p>
                </Link>
              </FadeIn>
              <FadeIn delay={0.25}>
                <Link href="/emissions" className="bg-card/30 border border-border/50 rounded-lg p-5 hover:border-primary/30 transition-colors block">
                  <h3 className="font-semibold font-bold text-foreground mb-2">E-Check & Emissions Testing</h3>
                  <p className="text-foreground/60 text-sm leading-relaxed">Need to pass Ohio E-Check for your registration renewal? We handle emissions testing and can fix whatever's causing a failure so you pass the first time.</p>
                </Link>
              </FadeIn>
              <FadeIn delay={0.3}>
                <Link href="/suspension-repair-cleveland" className="bg-card/30 border border-border/50 rounded-lg p-5 hover:border-primary/30 transition-colors block">
                  <h3 className="font-semibold font-bold text-foreground mb-2">Suspension & Steering</h3>
                  <p className="text-foreground/60 text-sm leading-relaxed">Hitting Cleveland potholes takes a toll on struts, shocks, tie rods, and ball joints. If your car pulls, bounces, or the steering feels loose, bring it in before it gets worse.</p>
                </Link>
              </FadeIn>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-16 lg:py-24 bg-[oklch(0.055_0.004_260)]">
          <div className="container max-w-4xl">
            <FadeIn>
              <span className="font-mono text-nick-blue-light text-sm tracking-wide">Common Questions</span>
              <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight mb-10">
                FREQUENTLY ASKED QUESTIONS
              </h2>
            </FadeIn>
            <div className="space-y-6">
              <FadeIn delay={0.05}>
                <div className="border border-border/40 p-6 bg-card/30 rounded-lg">
                  <h3 className="font-semibold font-bold text-lg text-foreground mb-3">Do I need an appointment, or can I just walk in?</h3>
                  <p className="text-foreground/70 leading-relaxed">Walk-ins are welcome for most services including oil changes, tire work, brake inspections, and diagnostics. We work on a first-come, first-served basis. If you want to guarantee a specific time, you can <Link href="/booking" className="text-nick-blue-light hover:underline">book online</Link> or call us at {BUSINESS.phone.display}. We're open {BUSINESS.hours.display} and Sundays 9 AM to 4 PM.</p>
                </div>
              </FadeIn>
              <FadeIn delay={0.1}>
                <div className="border border-border/40 p-6 bg-card/30 rounded-lg">
                  <h3 className="font-semibold font-bold text-lg text-foreground mb-3">How far is Nick's from {city.name}?</h3>
                  <p className="text-foreground/70 leading-relaxed">Our shop at {BUSINESS.address.full} is about {city.distance} from {city.name} — roughly a {city.driveTime} drive. We're right on Euclid Ave with easy access from I-90 and Route 2. Plenty of {city.name} residents already make the drive because of our honest pricing and fast turnaround.</p>
                </div>
              </FadeIn>
              <FadeIn delay={0.15}>
                <div className="border border-border/40 p-6 bg-card/30 rounded-lg">
                  <h3 className="font-semibold font-bold text-lg text-foreground mb-3">What if I can't afford the repair right now?</h3>
                  <p className="text-foreground/70 leading-relaxed">We offer <Link href="/financing" className="text-nick-blue-light hover:underline">financing from just $10 down</Link> on tires and major repairs. Get the work done today and pay over time. We never want you driving on unsafe equipment because of cost — we'll find a way to make it work.</p>
                </div>
              </FadeIn>
            </div>
          </div>
        </section>

        {/* Neighborhoods */}
        <section className="py-16 lg:py-20 bg-[oklch(0.065_0.004_260)]">
          <div className="container">
            <FadeIn>
              <h2 className="font-semibold font-bold text-2xl lg:text-3xl text-foreground tracking-tight mb-8">
                NEIGHBORHOODS WE SERVE IN {city.name.toUpperCase()}
              </h2>
              <div className="flex flex-wrap gap-3 stagger-in">
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
            <div className="flex flex-wrap gap-3 stagger-in">
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
      <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-background/90 backdrop-blur-md border-t border-primary/30 p-3 flex gap-2 stagger-in">
        <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('city-mobile-sticky')} className="flex items-center justify-center gap-2 stagger-in bg-primary text-primary-foreground btn-premium flex-1 py-3.5 rounded-md font-semibold font-bold text-sm tracking-wide" aria-label="Call Nick's Tire and Auto at 216-862-0005">
          <Phone className="w-4 h-4" />
          CALL NOW
        </a>
        <a href="#booking" className="flex items-center justify-center gap-2 stagger-in border-2 border-nick-blue text-nick-blue-light flex-1 py-3.5 rounded-md font-semibold font-bold text-sm tracking-wide" aria-label="Book an appointment online">
          BOOK ONLINE
        </a>
      </div>
    
      <InternalLinks />
</PageLayout>
  );
}
