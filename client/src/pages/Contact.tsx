/**
 * Standalone /contact page for Nick's Tire & Auto
 * Provides full contact information, embedded Google Map, booking form,
 * and structured data for local SEO.
 */

import InternalLinks from "@/components/InternalLinks";
import PageLayout from "@/components/PageLayout";
import { useEffect, useRef } from "react";
import BookingForm from "@/components/BookingForm";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import { Phone, MapPin, Clock, Star, Navigation } from "lucide-react";
import { motion, useInView } from "framer-motion";
import { BUSINESS } from "@shared/business";
import { Link } from "wouter";
import { GBP_REVIEW_URL } from "@shared/const";

function FadeIn({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

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
      latitude: 41.5525118,
      longitude: -81.5571875,
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
    image: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-main-DE7GKwfCThaBL66r78QWkU.webp",
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
      <SEOHead
        title="Contact Us | Nick's Tire & Auto Cleveland"
        description={`Contact Nick's Tire & Auto at ${BUSINESS.phone.display}. Located at ${BUSINESS.address.full}. Open ${BUSINESS.hours.display}. Walk-ins welcome.`}
        canonicalPath="/contact"
      />
      <Breadcrumbs items={[{ label: "Contact", href: "/contact" }]} />
      <ContactSchema />
      
      
        {/* Hero */}
        <section className="relative pt-32 lg:pt-40 pb-16 lg:pb-20 bg-[oklch(0.065_0.004_260)]">
          <div className="container">
            <FadeIn>
              <span className="font-mono text-nick-blue-light text-sm tracking-wide">Get In Touch</span>
              <h1 className="font-semibold font-bold text-4xl sm:text-5xl lg:text-7xl text-foreground mt-3 tracking-tight leading-[0.95]">
                CONTACT OUR<br />
                <span className="text-primary">CLEVELAND</span> SHOP
              </h1>
              <p className="mt-6 text-lg sm:text-xl text-foreground/70 max-w-2xl leading-relaxed">
                Call us, stop by, or fill out the form below. Walk-ins are always welcome. We are located on Euclid Avenue in Cleveland, serving drivers across Northeast Ohio.
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
                    <h2 className="font-semibold font-bold text-2xl lg:text-3xl text-foreground tracking-[-0.01em] mb-6">
                      SHOP <span className="text-primary">INFORMATION</span>
                    </h2>
                  </div>

                  {/* Phone */}
                  <div className="bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-6 surface-raised-card">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 bg-primary/10 flex items-center justify-center rounded-md">
                        <Phone className="w-5 h-5 text-primary" />
                      </div>
                      <h3 className="font-semibold font-bold text-foreground tracking-wider text-sm uppercase">Phone</h3>
                    </div>
                    <a href={BUSINESS.phone.href} className="font-mono text-2xl text-foreground hover:text-primary transition-colors">
                      {BUSINESS.phone.display}
                    </a>
                    <p className="text-foreground/50 text-sm mt-2">Call for appointments, quotes, or questions. Walk-ins always welcome.</p>
                  </div>

                  {/* Address */}
                  <div className="bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-6 surface-raised-card">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 bg-nick-blue/10 flex items-center justify-center rounded-md">
                        <MapPin className="w-5 h-5 text-nick-blue-light" />
                      </div>
                      <h3 className="font-semibold font-bold text-foreground tracking-wider text-sm uppercase">Address</h3>
                    </div>
                    <p className="font-mono text-foreground/80 text-lg">{BUSINESS.address.street}</p>
                    <p className="font-mono text-foreground/80 text-lg">Cleveland, OH 44112</p>
                    <a
                      href={BUSINESS.urls.googleMapsDirectionsNamed}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 mt-3 text-nick-blue-light hover:text-nick-blue-light transition-colors text-sm font-medium"
                    >
                      <Navigation className="w-4 h-4" />
                      Get Directions
                    </a>
                  </div>

                  {/* Hours */}
                  <div className="bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-6 surface-raised-card">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 bg-primary/10 flex items-center justify-center rounded-md">
                        <Clock className="w-5 h-5 text-primary" />
                      </div>
                      <h3 className="font-semibold font-bold text-foreground tracking-wider text-sm uppercase">Hours</h3>
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
                    <h3 className="font-semibold font-bold text-foreground tracking-wider text-sm uppercase mb-3">Areas We Serve</h3>
                    <p className="text-foreground/60 text-sm leading-relaxed">
                      Cleveland, Euclid, East Cleveland, South Euclid, Richmond Heights, Lyndhurst, Wickliffe, Willoughby, and surrounding Northeast Ohio communities. If you can drive to us, we can help.
                    </p>
                  </div>

                  <p className="text-sm text-foreground/60 mt-4">
                    We accept all major cards, Apple Pay, Google Pay, and offer <Link href="/financing?utm_source=contact" className="text-emerald-400">lease-to-own &amp; financing options</Link>.
                  </p>

                  {/* Google Business Profile */}
                  <div className="bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-6">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 bg-primary/10 flex items-center justify-center rounded-md">
                        <Star className="w-5 h-5 text-primary" />
                      </div>
                      <h3 className="font-semibold font-bold text-foreground tracking-wider text-sm uppercase">Google Reviews</h3>
                    </div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="flex gap-0.5">
                        {[...Array(5)].map((_, i) => (
                          <Star key={i} className="w-5 h-5 fill-nick-yellow text-primary" />
                        ))}
                      </div>
                      <span className="font-mono text-primary text-lg font-bold">4.9</span>
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
                  <h2 className="font-semibold font-bold text-2xl lg:text-3xl text-foreground tracking-[-0.01em] mb-6">
                    REQUEST AN <span className="text-primary">APPOINTMENT</span>
                  </h2>
                  <p className="text-foreground/60 mb-6 leading-relaxed">
                    Fill out the form and we will call you to confirm your appointment. Or call us directly — walk-ins are always welcome.
                  </p>
                  <BookingForm />
                </div>
              </FadeIn>
            </div>
          </div>
        </section>

        {/* Google Map */}
        <section className="bg-[oklch(0.065_0.004_260)] py-16 lg:py-20">
          <div className="container">
            <FadeIn>
              <h2 className="font-semibold font-bold text-2xl lg:text-3xl text-foreground tracking-[-0.01em] mb-8">
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
