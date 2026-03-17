/**
 * Standalone /contact page for Nick's Tire & Auto
 * Provides full contact information, embedded Google Map, booking form,
 * and structured data for local SEO.
 */

import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import NotificationBar from "@/components/NotificationBar";
import BookingForm from "@/components/BookingForm";
import SearchBar from "@/components/SearchBar";
import { SEOHead, Breadcrumbs, SkipToContent, trackPhoneClick } from "@/components/SEO";
import { Phone, MapPin, Clock, Star, Menu, X, Mail, Navigation } from "lucide-react";
import { motion, useInView } from "framer-motion";
import { trpc } from "@/lib/trpc";

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

function ContactNavbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const links = [
    { label: "Services", href: "/#services" },
    { label: "About", href: "/about" },
    { label: "Reviews", href: "/#reviews" },
    { label: "Blog", href: "/blog" },
    { label: "Contact", href: "/contact" },
  ];

  return (
    <nav className={`fixed ${scrolled ? "top-0" : "top-[40px]"} left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "bg-background/95 backdrop-blur-md shadow-lg shadow-nick-yellow/5" : "bg-transparent"}`}>
      <div className="container flex items-center justify-between h-16 lg:h-20">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-10 h-10 bg-nick-yellow flex items-center justify-center rounded-md glow-yellow">
            <span className="font-heading font-bold text-nick-dark text-lg">N</span>
          </div>
          <div className="flex flex-col">
            <span className="font-heading font-bold text-nick-yellow text-lg leading-tight tracking-wide">NICK'S TIRE & AUTO</span>
            <span className="text-nick-teal text-xs tracking-widest uppercase font-medium">Cleveland, Ohio</span>
          </div>
        </Link>

        <div className="hidden lg:flex items-center gap-6">
          <SearchBar />
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={`font-heading text-sm tracking-widest uppercase transition-colors ${l.href === "/contact" ? "text-nick-yellow" : "text-foreground/80 hover:text-nick-yellow"}`}>
              {l.label}
            </Link>
          ))}
          <a href="tel:2168620005" className="flex items-center gap-2 bg-nick-yellow text-nick-dark px-5 py-2.5 rounded-md font-heading font-bold text-sm tracking-wider uppercase hover:bg-nick-gold transition-colors glow-yellow">
            <Phone className="w-4 h-4" />
            (216) 862-0005
          </a>
        </div>

        <div className="lg:hidden flex items-center gap-1">
          <SearchBar />
          <button onClick={() => setMobileOpen(!mobileOpen)} className="text-foreground p-2">
            {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="lg:hidden bg-background/98 backdrop-blur-md border-t border-nick-yellow/20">
          <div className="container py-6 flex flex-col gap-4">
            {links.map((l) => (
              <Link key={l.href} href={l.href} onClick={() => setMobileOpen(false)} className="font-heading text-lg tracking-widest uppercase text-foreground/80 hover:text-nick-yellow transition-colors py-2">
                {l.label}
              </Link>
            ))}
            <a href="tel:2168620005" className="flex items-center justify-center gap-2 bg-nick-yellow text-nick-dark px-5 py-3 rounded-md font-heading font-bold text-sm tracking-wider uppercase mt-2">
              <Phone className="w-4 h-4" />
              (216) 862-0005
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}

function ContactSchema() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "AutoRepair",
    name: "Nick's Tire & Auto",
    telephone: "+1-216-862-0005",
    url: "https://nickstire.org/contact",
    address: {
      "@type": "PostalAddress",
      streetAddress: "17625 Euclid Ave",
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
    sameAs: [
      "https://www.google.com/maps/place/Nick's+Tire+And+Auto+Euclid/@41.5525118,-81.5571875,17z/",
      "https://www.instagram.com/nicks_tire_euclid/",
      "https://www.facebook.com/nickstireeuclid/",
    ],
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: "4.9",
      reviewCount: "1683",
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

function MobileCTA() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-background/95 backdrop-blur-md border-t border-nick-yellow/30 p-3">
      <a href="tel:2168620005" className="flex items-center justify-center gap-2 bg-nick-yellow text-nick-dark w-full py-3.5 rounded-md font-heading font-bold text-base tracking-wider uppercase glow-yellow">
        <Phone className="w-5 h-5" />
        CALL (216) 862-0005
      </a>
    </div>
  );
}

export default function Contact() {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <SEOHead
        title="Contact Nick's Tire & Auto | Cleveland Auto Repair Shop | (216) 862-0005"
        description="Contact Nick's Tire & Auto at (216) 862-0005. Located at 17625 Euclid Ave, Cleveland, OH 44112. Open Mon-Sat 8AM-6PM, Sun 9AM-4PM. Walk-ins welcome."
        canonicalPath="/contact"
      />
      <ContactSchema />
      <SkipToContent />
      <NotificationBar />
      <ContactNavbar />

      <main id="main-content">
        {/* Hero */}
        <section className="relative pt-32 lg:pt-40 pb-16 lg:pb-20 section-dark">
          <div className="container">
            <FadeIn>
              <span className="font-mono text-nick-teal text-sm tracking-widest uppercase">Get In Touch</span>
              <h1 className="font-heading font-bold text-4xl sm:text-5xl lg:text-7xl text-foreground mt-3 tracking-tight leading-[0.95]">
                CONTACT OUR<br />
                <span className="text-gradient-yellow">CLEVELAND</span> SHOP
              </h1>
              <p className="mt-6 text-lg sm:text-xl text-foreground/70 max-w-2xl leading-relaxed">
                Call us, stop by, or fill out the form below. Walk-ins are always welcome. We are located on Euclid Avenue in Cleveland, serving drivers across Northeast Ohio.
              </p>
            </FadeIn>
          </div>
        </section>

        <div className="h-1.5 w-full bg-gradient-to-r from-nick-yellow via-nick-teal to-nick-orange" />

        {/* Contact Info + Booking Form */}
        <section className="section-darker py-16 lg:py-24">
          <div className="container">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20">
              <FadeIn>
                <div className="space-y-8">
                  <div>
                    <h2 className="font-heading font-bold text-2xl lg:text-3xl text-foreground tracking-wider mb-6">
                      SHOP <span className="text-nick-yellow">INFORMATION</span>
                    </h2>
                  </div>

                  {/* Phone */}
                  <div className="card-vibrant bg-card/80 rounded-lg p-6">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 bg-nick-yellow/10 flex items-center justify-center rounded-md">
                        <Phone className="w-5 h-5 text-nick-yellow" />
                      </div>
                      <h3 className="font-heading font-bold text-foreground tracking-wider text-sm uppercase">Phone</h3>
                    </div>
                    <a href="tel:2168620005" className="font-mono text-2xl text-foreground hover:text-nick-yellow transition-colors">
                      (216) 862-0005
                    </a>
                    <p className="text-foreground/50 text-sm mt-2">Call for appointments, quotes, or questions. Walk-ins always welcome.</p>
                  </div>

                  {/* Address */}
                  <div className="card-vibrant bg-card/80 rounded-lg p-6">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 bg-nick-teal/10 flex items-center justify-center rounded-md">
                        <MapPin className="w-5 h-5 text-nick-teal" />
                      </div>
                      <h3 className="font-heading font-bold text-foreground tracking-wider text-sm uppercase">Address</h3>
                    </div>
                    <p className="font-mono text-foreground/80 text-lg">17625 Euclid Ave</p>
                    <p className="font-mono text-foreground/80 text-lg">Cleveland, OH 44112</p>
                    <a
                      href="https://www.google.com/maps/dir//Nick's+Tire+And+Auto+Euclid,+17625+Euclid+Ave,+Cleveland,+OH+44112"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 mt-3 text-nick-teal hover:text-nick-cyan transition-colors text-sm font-medium"
                    >
                      <Navigation className="w-4 h-4" />
                      Get Directions
                    </a>
                  </div>

                  {/* Hours */}
                  <div className="card-vibrant bg-card/80 rounded-lg p-6">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 bg-nick-orange/10 flex items-center justify-center rounded-md">
                        <Clock className="w-5 h-5 text-nick-orange" />
                      </div>
                      <h3 className="font-heading font-bold text-foreground tracking-wider text-sm uppercase">Hours</h3>
                    </div>
                    <div className="font-mono text-foreground/80 space-y-1">
                      <div className="flex justify-between">
                        <span>Monday – Saturday</span>
                        <span className="text-nick-yellow">8:00 AM – 6:00 PM</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Sunday</span>
                        <span className="text-nick-yellow">9:00 AM – 4:00 PM</span>
                      </div>
                    </div>
                  </div>

                  {/* Areas Served */}
                  <div className="card-vibrant bg-card/80 rounded-lg p-6">
                    <h3 className="font-heading font-bold text-foreground tracking-wider text-sm uppercase mb-3">Areas We Serve</h3>
                    <p className="text-foreground/60 text-sm leading-relaxed">
                      Cleveland, Euclid, East Cleveland, South Euclid, Richmond Heights, Lyndhurst, Wickliffe, Willoughby, and surrounding Northeast Ohio communities. If you can drive to us, we can help.
                    </p>
                  </div>

                  {/* Google Business Profile */}
                  <div className="card-vibrant bg-card/80 rounded-lg p-6">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 bg-nick-yellow/10 flex items-center justify-center rounded-md">
                        <Star className="w-5 h-5 text-nick-yellow" />
                      </div>
                      <h3 className="font-heading font-bold text-foreground tracking-wider text-sm uppercase">Google Reviews</h3>
                    </div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="flex gap-0.5">
                        {[...Array(5)].map((_, i) => (
                          <Star key={i} className="w-5 h-5 fill-nick-yellow text-nick-yellow" />
                        ))}
                      </div>
                      <span className="font-mono text-nick-yellow text-lg font-bold">4.9</span>
                      <span className="text-foreground/50 text-sm">from 1,683+ reviews</span>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <a
                        href="https://www.google.com/maps/place/Nick's+Tire+And+Auto+Euclid/@41.5525118,-81.5571875,17z/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-nick-teal/10 border border-nick-teal/30 rounded-md text-nick-teal hover:bg-nick-teal/20 transition-colors text-sm font-medium"
                      >
                        <MapPin className="w-4 h-4" />
                        View on Google Maps
                      </a>
                      <a
                        href="https://search.google.com/local/writereview?placeid=ChIJSWRRLdr_MEiRBZ3NBATPvQo"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-nick-yellow/10 border border-nick-yellow/30 rounded-md text-nick-yellow hover:bg-nick-yellow/20 transition-colors text-sm font-medium"
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
                  <h2 className="font-heading font-bold text-2xl lg:text-3xl text-foreground tracking-wider mb-6">
                    REQUEST AN <span className="text-nick-yellow">APPOINTMENT</span>
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
        <section className="section-dark py-16 lg:py-20">
          <div className="container">
            <FadeIn>
              <h2 className="font-heading font-bold text-2xl lg:text-3xl text-foreground tracking-wider mb-8">
                FIND US ON <span className="text-nick-yellow">EUCLID AVE</span>
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
        <footer className="section-dark border-t border-nick-yellow/10">
          <div className="h-1.5 w-full bg-gradient-to-r from-nick-yellow via-nick-orange to-nick-teal" />
          <div className="container py-12">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div>
                <Link href="/" className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 bg-nick-yellow flex items-center justify-center rounded-md">
                    <span className="font-heading font-bold text-nick-dark text-sm">N</span>
                  </div>
                  <span className="font-heading font-bold text-nick-yellow tracking-wider">NICK'S TIRE & AUTO</span>
                </Link>
                <p className="text-foreground/50 text-sm leading-relaxed">
                  Honest auto repair and tire services for Cleveland, Euclid, and Northeast Ohio. Fair prices, real diagnostics, no surprises.
                </p>
              </div>

              <div>
                <h4 className="font-heading font-bold text-nick-teal tracking-wider text-sm uppercase mb-4">Services</h4>
                <div className="space-y-2 text-sm text-foreground/50">
                  <p><Link href="/tires" className="hover:text-nick-yellow transition-colors">Tires &amp; Tire Repair</Link></p>
                  <p><Link href="/brakes" className="hover:text-nick-yellow transition-colors">Brake Repair</Link></p>
                  <p><Link href="/diagnostics" className="hover:text-nick-yellow transition-colors">Check Engine Light Diagnostics</Link></p>
                  <p><Link href="/emissions" className="hover:text-nick-yellow transition-colors">Ohio E-Check &amp; Emissions Repair</Link></p>
                  <p><Link href="/oil-change" className="hover:text-nick-yellow transition-colors">Oil Changes</Link></p>
                  <p><Link href="/general-repair" className="hover:text-nick-yellow transition-colors">Suspension &amp; Steering</Link></p>
                </div>
              </div>

              <div>
                <h4 className="font-heading font-bold text-nick-teal tracking-wider text-sm uppercase mb-4">Areas Served</h4>
                <div className="space-y-2 text-sm text-foreground/50">
                  <p>Cleveland, OH</p>
                  <Link href="/euclid-auto-repair" className="block hover:text-nick-yellow transition-colors">Euclid, OH</Link>
                  <Link href="/east-cleveland-auto-repair" className="block hover:text-nick-yellow transition-colors">East Cleveland, OH</Link>
                  <Link href="/lakewood-auto-repair" className="block hover:text-nick-yellow transition-colors">Lakewood, OH</Link>
                  <Link href="/parma-auto-repair" className="block hover:text-nick-yellow transition-colors">Parma, OH</Link>
                  <p>Northeast Ohio</p>
                </div>
                <h4 className="font-heading font-bold text-nick-teal tracking-wider text-sm uppercase mb-4 mt-6">Resources</h4>
                <div className="space-y-2 text-sm text-foreground/50">
                  <Link href="/faq" className="block hover:text-nick-yellow transition-colors">FAQ</Link>
                  <Link href="/blog" className="block hover:text-nick-yellow transition-colors">Auto Repair Blog</Link>
                  <Link href="/about" className="block hover:text-nick-yellow transition-colors">About Us</Link>
                </div>
              </div>
            </div>

            <div className="mt-12 pt-8 border-t border-nick-yellow/10 flex flex-col sm:flex-row items-center justify-between gap-4">
              <p className="text-foreground/30 text-xs font-mono">
                &copy; {new Date().getFullYear()} NICK'S TIRE &amp; AUTO. ALL RIGHTS RESERVED.
              </p>
              <a href="tel:2168620005" className="text-nick-yellow font-mono text-sm hover:text-nick-gold transition-colors">
                (216) 862-0005
              </a>
            </div>
          </div>
        </footer>
      </main>

      <MobileCTA />
    </div>
  );
}
