/**
 * Standalone /contact page for Nick's Tire & Auto
 * Provides full contact information, embedded Google Map, booking form,
 * and structured data for local SEO.
 */

import InternalLinks from "@/components/InternalLinks";
import PageLayout from "@/components/PageLayout";
import { useEffect } from "react";
import BookingForm from "@/components/BookingForm";
import TrustBlock from "@/components/TrustBlock";
import { SEOHead, Breadcrumbs, trackPhoneClick, trackEvent } from "@/components/SEO";
import { Phone, MapPin, Clock, Star, Navigation } from "lucide-react";
import { BUSINESS } from "@shared/business";
import { Link } from "wouter";
import { GBP_REVIEW_URL } from "@shared/const";
import FadeIn from "@/components/FadeIn";

function ContactSchema() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "AutoRepair",
    name: "Nick's Tire & Auto",
    telephone: `+1-${BUSINESS.phone.dashed}`,
    url: "https://nickstire.org/contact",
    address: {
      "@type": "PostalAddress",
      streetAddress: BUSINESS.address.street,
      addressLocality: "Cleveland",
      addressRegion: "OH",
      postalCode: "44112",
      addressCountry: "US",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: BUSINESS.geo.lat,
      longitude: BUSINESS.geo.lng,
    },
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
        opens: "08:00",
        closes: "18:00",
      },
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: "Sunday",
        opens: "09:00",
        closes: "16:00",
      },
    ],
    hasMap: "https://www.google.com/maps/place/Nick's+Tire+And+Auto+Euclid/@41.5525118,-81.5571875,17z/",
    sameAs: [...BUSINESS.sameAs],
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: String(BUSINESS.reviews.rating),
      reviewCount: String(BUSINESS.reviews.count),
      bestRating: "5",
    },
    // 2026-05-06 wave-16 · pro photo pack: contact page schema image
    // uses the roadside sign (wayfinding-first) per PLACEMENT_GUIDE.md
    image: `${BUSINESS.urls.website}/photos/roadside-sign-exterior-wide.webp`,
    priceRange: "$$",
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

export default function Contact() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <PageLayout showChat={true}>
      {/* 2026-05-07 GSC tune: was "Contact Nick's Tire & Auto · Cleveland
          · Walk-Ins Always Welcome" — 493 imps / 0 clicks in 90 days.
          Front-load phone + address + 7-day-open in the title so the SERP
          result IS the answer to the searcher's intent. */}
      {/* wave-174 — GSC showed /contact at pos 8.9 with 0.50% CTR over
          201 impressions. Description was 188 chars → truncated, cutting
          off the hours + walk-in line. Trimmed to 134 chars: phone +
          address + hours + walk-in all visible. */}
      <SEOHead
        title="Contact Nick's Tire & Auto · Cleveland & Euclid Auto Shop"
        description="Contact Nick's Tire & Auto in Euclid/Cleveland. Hours: Mon-Sat 8-6, Sun 9-4. First come, first served. Vehicle drop-off welcome. Call (216) 862-0005."
        canonicalPath="/contact"
      />
      <Breadcrumbs items={[{ label: "Contact", href: "/contact" }]} />
      <ContactSchema />
      
      
        {/* Hero */}
        <section className="relative pt-32 lg:pt-40 pb-16 lg:pb-20 bg-[oklch(0.065_0.004_260)]">
          <div className="container">
            <FadeIn>
              <span className="font-mono text-nick-blue-light text-sm tracking-wide">Get In Touch</span>
              {/* SEO/a11y · keep visual line break via <br> but include a
                  literal space so text extraction (Google, screen readers)
                  doesn't render this as "OURCLEVELAND". */}
              <h1 className="font-bold text-4xl sm:text-5xl lg:text-7xl text-foreground mt-3 tracking-tight leading-[0.95]">
                CONTACT OUR{" "}<br />
                <span className="text-primary">CLEVELAND</span> SHOP
              </h1>
              <p className="mt-6 text-lg sm:text-xl text-foreground/70 max-w-2xl leading-relaxed">
                Call us, text us, or just pull up — walk in 7 days a week, no appointment needed. We are on Euclid Avenue in Cleveland, serving drivers across Northeast Ohio. 4.9★ from 1,700+ reviews.
              </p>
              {/* wave-181.48 · Repair Haiku trust line — same phrase as the
                  VAPI prompt, /services hero, /about tile. Cross-touchpoint
                  consistency per brand-perception step 5 (open question #1
                  in .claude/brand-voice-guidelines.md). */}
              <p className="mt-4 text-lg text-foreground/80 max-w-2xl leading-relaxed">
                Free check. Written quote. <span className="text-[#FDB913] font-semibold">You don't pay until you say yes.</span>
              </p>
            </FadeIn>
          </div>
        </section>

        
        {/* Contact Info + Booking Form */}
        <section className="bg-[oklch(0.055_0.004_260)] py-16 lg:py-24">
          <div className="container">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20">
              <FadeIn>
                <div className="space-y-8">
                  <div>
                    <h2 className="font-bold text-2xl lg:text-3xl text-foreground tracking-[-0.01em] mb-6">
                      SHOP <span className="text-primary">INFORMATION</span>
                    </h2>
                  </div>

                  {/* Phone */}
                  <div className="bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-6 surface-raised-card">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 bg-primary/10 flex items-center justify-center rounded-md">
                        <Phone className="w-5 h-5 text-primary" />
                      </div>
                      <h3 className="font-bold text-foreground tracking-wider text-sm uppercase">Phone</h3>
                    </div>
                    <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick("contact-info")} className="font-mono text-2xl text-foreground hover:text-primary transition-colors">
                      {BUSINESS.phone.display}
                    </a>
                    <p className="text-foreground/50 text-sm mt-2">Answered by an actual person at the shop — no phone tree, no call-center. Open hours: under 30 seconds typical. After hours: leave a message, called back first thing next morning.</p>
                  </div>

                  {/* Address */}
                  <div className="bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-6 surface-raised-card">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 bg-nick-blue/10 flex items-center justify-center rounded-md">
                        <MapPin className="w-5 h-5 text-nick-blue-light" />
                      </div>
                      <h3 className="font-bold text-foreground tracking-wider text-sm uppercase">Address</h3>
                    </div>
                    <p className="font-mono text-foreground/80 text-lg">{BUSINESS.address.street}</p>
                    <p className="font-mono text-foreground/80 text-lg">Cleveland, OH 44112</p>
                    <a
                      href={BUSINESS.urls.googleMapsDirectionsNamed}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => trackEvent("directions_click", { source: "contact-address" })}
                      className="inline-flex items-center gap-2 mt-3 text-nick-blue-light hover:text-nick-blue-light transition-colors text-sm font-medium"
                    >
                      <Navigation className="w-4 h-4" />
                      Get Directions
                    </a>
                  </div>

                  {/* Wayfinding & Landmarks */}
                  <div className="bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-6 surface-raised-card">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 bg-primary/10 flex items-center justify-center rounded-md">
                        <Navigation className="w-5 h-5 text-primary" />
                      </div>
                      <h3 className="font-bold text-foreground tracking-wider text-sm uppercase">Directions & Landmarks</h3>
                    </div>
                    <p className="text-foreground/75 text-sm leading-relaxed">
                      Located directly on <strong>Euclid Ave</strong>, we're just minutes off the <strong>I-90 exit (Exit 182C for East 185th St/Euclid Ave)</strong> or <strong>Route 2</strong>. Our shop is situated near the major intersection of <strong>Euclid Ave & London Rd</strong>. Look for our signature yellow sign and tire racks right by the road!
                    </p>
                  </div>

                  {/* Hours */}
                  <div className="bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-6 surface-raised-card">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 bg-primary/10 flex items-center justify-center rounded-md">
                        <Clock className="w-5 h-5 text-primary" />
                      </div>
                      <h3 className="font-bold text-foreground tracking-wider text-sm uppercase">Hours</h3>
                    </div>

                    <div className="mt-4 p-3 bg-primary/10 border border-primary/20 rounded-md">
                      <p className="text-foreground/70 text-[13px] leading-relaxed">
                        <span className="text-primary font-semibold">After hours?</span> Leave a message and we'll call first thing.
                      </p>
                    </div>
                    <div className="font-mono text-foreground/80 space-y-1">
                      <div className="flex justify-between">
                        <span>Monday – Saturday</span>
                        <span className="text-primary">8:00 AM – 6:00 PM</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Sunday</span>
                        <span className="text-primary">9:00 AM – 4:00 PM</span>
                      </div>
                    </div>
                  </div>

                  {/* Areas Served */}
                  <div className="bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-6">
                    <h3 className="font-bold text-foreground tracking-wider text-sm uppercase mb-3">Areas We Serve</h3>
                    <p className="text-foreground/60 text-sm leading-relaxed">
                      Cleveland, Euclid, East Cleveland, South Euclid, Richmond Heights, Lyndhurst, Wickliffe, Willoughby, and surrounding Northeast Ohio communities. If you can drive to us, we can help.
                    </p>
                  </div>

                  <p className="text-sm text-foreground/60 mt-4">
                    We accept all major cards, Apple Pay, Google Pay, plus <Link href="/financing?utm_source=contact" className="text-emerald-400">lease-to-own &amp; payment programs</Link>.
                  </p>

                  {/* Google Business Profile */}
                  <div className="bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-6">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 bg-primary/10 flex items-center justify-center rounded-md">
                        <Star className="w-5 h-5 text-primary" />
                      </div>
                      <h3 className="font-bold text-foreground tracking-wider text-sm uppercase">Google Reviews</h3>
                    </div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="flex gap-0.5">
                        {[...Array(5)].map((_, i) => (
                          <Star key={i} className="w-5 h-5 fill-nick-yellow text-primary" />
                        ))}
                      </div>
                      <span className="font-mono text-primary text-lg font-bold">{BUSINESS.reviews.rating}</span>
                      <span className="text-foreground/50 text-sm">from {BUSINESS.reviews.countDisplay} reviews</span>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <a
                        href="https://www.google.com/maps/place/Nick's+Tire+And+Auto+Euclid/@41.5525118,-81.5571875,17z/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-nick-blue/10 border border-nick-blue/30 rounded-md text-nick-blue-light hover:bg-nick-blue/20 transition-colors text-sm font-medium"
                      >
                        <MapPin className="w-4 h-4" />
                        View on Google Maps
                      </a>
                      <a
                        href={GBP_REVIEW_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-primary/10 border border-primary/30 rounded-md text-primary hover:bg-primary/20 transition-colors text-sm font-medium"
                      >
                        <Star className="w-4 h-4" />
                        Leave a Review
                      </a>
                    </div>
                  </div>
                </div>
              </FadeIn>

              <FadeIn delay={0.15}>
                <div>
                  <h2 className="font-bold text-2xl lg:text-3xl text-foreground tracking-[-0.01em] mb-6">
                    DROP IT OFF <span className="text-primary">TODAY</span>
                  </h2>
                  <p className="text-foreground/60 mb-6 leading-relaxed">
                    We run on a <strong>first-come, first-served (FCFS)</strong> model. No appointments are needed. Pull up anytime, drop off your vehicle, and we will get to work. We recommend calling ahead to check current bay queue times.
                  </p>
                  <p className="text-foreground/60 mb-6 leading-relaxed">
                    Whether you need a same-day check for <Link href="/brakes" className="underline text-primary hover:text-primary-foreground font-semibold">brake repair</Link>, quick mounting of new or used <Link href="/tires" className="underline text-primary hover:text-primary-foreground font-semibold">tires</Link>, an OBD-II scan for <Link href="/diagnostics" className="underline text-primary hover:text-primary-foreground font-semibold">engine diagnostics</Link>, or want to set up one of our flexible <Link href="/financing" className="underline text-primary hover:text-primary-foreground font-semibold">repair payment programs</Link>, we've got you covered.
                  </p>
                  <BookingForm />
                </div>
              </FadeIn>
            </div>

            {/* Reusable Trust Block */}
            <div className="mt-16">
              <TrustBlock />
            </div>
          </div>
        </section>

        {/* Google Map */}
        <section className="bg-[oklch(0.065_0.004_260)] py-16 lg:py-20">
          <div className="container">
            <FadeIn>
              <h2 className="font-bold text-2xl lg:text-3xl text-foreground tracking-[-0.01em] mb-8">
                FIND US ON <span className="text-primary">EUCLID AVE</span>
              </h2>
              <div className="w-full aspect-[21/9] bg-card rounded-lg border border-border/50 overflow-hidden">
                <iframe
                  src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2987.5!2d-81.5597624!3d41.5525118!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x8830ffda2d516449%3A0xcabdcc3204cd9c5!2sNick&#39;s%20Tire%20And%20Auto%20Euclid!5e0!3m2!1sen!2sus!4v1710000000000"
                  width="100%"
                  height="100%"
                  style={{ border: 0 }}
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  title="Nick's Tire & Auto location on Euclid Ave, Cleveland OH"
                />
              </div>
            </FadeIn>
          </div>
        </section>

        {/* Footer */}
        

      <InternalLinks title="Our Services" />
    </PageLayout>
  );
}
