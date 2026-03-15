/*
 * ServicePage — Individual SEO-optimized service pages
 * Each page follows the brand's content structure:
 * Problem Hook → Simple Explanation → Diagnostic Authority → Solution → Local Trust → CTA
 */

import { useState, useEffect, useRef } from "react";
import { useRoute, Link } from "wouter";
import { SERVICES, type ServiceData } from "@shared/services";
import NotificationBar from "@/components/NotificationBar";
import BookingForm from "@/components/BookingForm";
import { Phone, MapPin, Clock, Star, ChevronRight, ChevronDown, ArrowLeft, Wrench, Shield, Gauge, Zap, Droplets, ThermometerSun, Menu, X } from "lucide-react";
import { motion, useInView, AnimatePresence } from "framer-motion";

// CDN images
const HERO_IMAGES: Record<string, string> = {
  tires: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-tires-AWxeiFZmv6FQocUMfiJvWb.webp",
  brakes: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-brakes-nKAKuxmW2WAmNrbCFRD9zL.webp",
  diagnostics: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-diagnostics-AN7H3iz5Tow2ab2METgner.webp",
  emissions: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-diagnostics-AN7H3iz5Tow2ab2METgner.webp",
  "oil-change": "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-main-DE7GKwfCThaBL66r78QWkU.webp",
  "general-repair": "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-main-DE7GKwfCThaBL66r78QWkU.webp",
};

const SERVICE_ICONS: Record<string, React.ReactNode> = {
  tires: <Gauge className="w-8 h-8" />,
  brakes: <Shield className="w-8 h-8" />,
  diagnostics: <Zap className="w-8 h-8" />,
  emissions: <ThermometerSun className="w-8 h-8" />,
  "oil-change": <Droplets className="w-8 h-8" />,
  "general-repair": <Wrench className="w-8 h-8" />,
};

function FadeIn({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function CautionStripe() {
  return <div className="caution-stripe h-2 w-full" />;
}

// ─── SERVICE NAVBAR ────────────────────────────────────
function ServiceNavbar({ service }: { service: ServiceData }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={`fixed ${scrolled ? "top-0" : "top-[40px]"} left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "bg-nick-dark/95 backdrop-blur-md shadow-lg" : "bg-transparent"}`}>
      <div className="container flex items-center justify-between h-16 lg:h-20">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary flex items-center justify-center rounded-sm">
            <span className="font-heading font-bold text-primary-foreground text-lg">N</span>
          </div>
          <div className="flex flex-col">
            <span className="font-heading font-bold text-primary text-lg leading-tight tracking-wide">NICK'S TIRE & AUTO</span>
            <span className="text-muted-foreground text-xs tracking-widest uppercase">Cleveland, Ohio</span>
          </div>
        </Link>

        <div className="hidden lg:flex items-center gap-6">
          <Link href="/" className="flex items-center gap-1 font-heading text-sm tracking-widest uppercase text-foreground/60 hover:text-primary transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Home
          </Link>
          <a href="#problems" className="font-heading text-sm tracking-widest uppercase text-foreground/80 hover:text-primary transition-colors">
            Common Problems
          </a>
          <a href="#process" className="font-heading text-sm tracking-widest uppercase text-foreground/80 hover:text-primary transition-colors">
            Our Process
          </a>
          <a href="#booking" className="font-heading text-sm tracking-widest uppercase text-foreground/80 hover:text-primary transition-colors">
            Book Now
          </a>
          <a href="tel:2168620005" className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 font-heading font-bold text-sm tracking-wider uppercase hover:bg-primary/90 transition-colors">
            <Phone className="w-4 h-4" />
            (216) 862-0005
          </a>
        </div>

        <button onClick={() => setMobileOpen(!mobileOpen)} className="lg:hidden text-foreground p-2">
          {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="lg:hidden bg-nick-dark/98 backdrop-blur-md border-t border-border">
          <div className="container py-6 flex flex-col gap-4">
            <Link href="/" onClick={() => setMobileOpen(false)} className="flex items-center gap-2 font-heading text-lg tracking-widest uppercase text-foreground/60 hover:text-primary transition-colors py-2">
              <ArrowLeft className="w-5 h-5" />
              Back to Home
            </Link>
            <a href="#problems" onClick={() => setMobileOpen(false)} className="font-heading text-lg tracking-widest uppercase text-foreground/80 hover:text-primary transition-colors py-2">
              Common Problems
            </a>
            <a href="#process" onClick={() => setMobileOpen(false)} className="font-heading text-lg tracking-widest uppercase text-foreground/80 hover:text-primary transition-colors py-2">
              Our Process
            </a>
            <a href="#booking" onClick={() => setMobileOpen(false)} className="font-heading text-lg tracking-widest uppercase text-foreground/80 hover:text-primary transition-colors py-2">
              Book Now
            </a>
            <a href="tel:2168620005" className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-5 py-3 font-heading font-bold text-sm tracking-wider uppercase mt-2">
              <Phone className="w-4 h-4" />
              (216) 862-0005
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}

// ─── SERVICE HERO ──────────────────────────────────────
function ServiceHero({ service }: { service: ServiceData }) {
  const heroImg = HERO_IMAGES[service.slug] || HERO_IMAGES["general-repair"];
  const icon = SERVICE_ICONS[service.slug];

  return (
    <section className="relative min-h-[60vh] lg:min-h-[70vh] flex items-end overflow-hidden">
      <div className="absolute inset-0">
        <img src={heroImg} alt={`${service.title} service at Nick's Tire & Auto`} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-nick-dark via-nick-dark/80 to-nick-dark/40" />
      </div>

      <div className="relative container pb-16 pt-32 lg:pb-24">
        <FadeIn>
          <div className="flex items-center gap-3 mb-4">
            <Link href="/" className="font-mono text-xs text-foreground/50 hover:text-primary transition-colors">
              Home
            </Link>
            <ChevronRight className="w-3 h-3 text-foreground/30" />
            <span className="font-mono text-xs text-primary">{service.title}</span>
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <div className="flex items-center gap-4 mb-4">
            <div className="text-primary">{icon}</div>
            <span className="font-mono text-sm text-primary tracking-widest uppercase">Service {service.num}</span>
          </div>
          <h1 className="font-heading font-bold text-4xl sm:text-5xl lg:text-7xl text-foreground leading-[0.9] tracking-tight max-w-3xl">
            {service.heroHeadline}
          </h1>
        </FadeIn>

        <FadeIn delay={0.2}>
          <p className="mt-6 text-lg sm:text-xl text-foreground/80 max-w-2xl font-light leading-relaxed">
            {service.heroSubline}
          </p>
        </FadeIn>

        <FadeIn delay={0.3}>
          <div className="mt-8 flex flex-col sm:flex-row gap-4">
            <a href="tel:2168620005" className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-heading font-bold text-lg tracking-wider uppercase hover:bg-primary/90 transition-colors">
              <Phone className="w-5 h-5" />
              CALL NOW
            </a>
            <a href="#booking" className="inline-flex items-center justify-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 font-heading font-bold text-lg tracking-wider uppercase hover:border-primary hover:text-primary transition-colors">
              BOOK ONLINE
              <ChevronRight className="w-5 h-5" />
            </a>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

// ─── COMMON PROBLEMS ───────────────────────────────────
function Problems({ service }: { service: ServiceData }) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="problems" className="section-darker py-20 lg:py-28">
      <CautionStripe />
      <div className="container pt-16">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20">
          <FadeIn>
            <div>
              <span className="font-mono text-primary text-sm tracking-widest uppercase">Common Problems</span>
              <h2 className="font-heading font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight leading-[1.05]">
                WHAT DRIVERS<br />
                <span className="text-gradient-yellow">ASK US</span>
              </h2>
              <p className="mt-6 text-foreground/70 leading-relaxed text-lg">
                These are the most common {service.title.toLowerCase()} problems Cleveland drivers bring to us. If something does not feel right with your vehicle, it probably is not.
              </p>
              <div className="mt-8 flex items-center gap-3 text-foreground/50">
                <div className="flex gap-0.5">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-primary text-primary" />
                  ))}
                </div>
                <span className="font-mono text-xs">4.9 stars from 1,683+ reviews</span>
              </div>
            </div>
          </FadeIn>

          <div className="flex flex-col gap-0">
            {service.problems.map((p, i) => (
              <FadeIn key={i} delay={i * 0.06}>
                <button
                  onClick={() => setOpen(open === i ? null : i)}
                  className="w-full text-left border-b border-border/30 py-6 group"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-heading font-bold text-lg lg:text-xl text-foreground tracking-wider group-hover:text-primary transition-colors">
                      {p.question}
                    </h3>
                    <ChevronDown className={`w-5 h-5 text-primary transition-transform duration-200 shrink-0 ml-4 ${open === i ? "rotate-180" : ""}`} />
                  </div>
                  <AnimatePresence>
                    {open === i && (
                      <motion.p
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-4 text-foreground/70 leading-relaxed text-base overflow-hidden"
                      >
                        {p.answer}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </button>
              </FadeIn>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── OUR PROCESS ───────────────────────────────────────
function Process({ service }: { service: ServiceData }) {
  return (
    <section id="process" className="section-dark py-20 lg:py-28">
      <div className="container">
        <FadeIn>
          <span className="font-mono text-primary text-sm tracking-widest uppercase">How We Work</span>
          <h2 className="font-heading font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight">
            OUR {service.title} PROCESS
          </h2>
          <p className="mt-4 text-foreground/60 text-lg max-w-2xl">
            Every repair follows a structured process. We diagnose first, explain what we find, and fix it right.
          </p>
        </FadeIn>

        <div className="mt-14 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-0 lg:gap-0">
          {service.process.map((step, i) => (
            <FadeIn key={i} delay={i * 0.08}>
              <div className="relative border border-border/30 p-6 lg:p-8 h-full">
                <div className="flex items-center gap-3 mb-4">
                  <span className="font-heading font-bold text-4xl text-primary/30">{String(i + 1).padStart(2, "0")}</span>
                </div>
                <h3 className="font-heading font-bold text-lg text-foreground tracking-wider mb-3">{step.step}</h3>
                <p className="text-foreground/60 text-sm leading-relaxed">{step.detail}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── WHY CHOOSE US ─────────────────────────────────────
function WhyUs({ service }: { service: ServiceData }) {
  return (
    <section className="section-darker py-20 lg:py-28">
      <CautionStripe />
      <div className="container pt-16">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          <FadeIn>
            <div>
              <span className="font-mono text-primary text-sm tracking-widest uppercase">Why Nick's</span>
              <h2 className="font-heading font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight leading-[1.05]">
                {service.title} SERVICE<br />
                <span className="text-gradient-yellow">YOU CAN TRUST</span>
              </h2>
              <p className="mt-6 text-foreground/70 leading-relaxed text-lg">
                We do not just fix cars. We explain what is wrong, show you the problem, and let you decide. That is how we have earned 1,683+ five-star reviews from Cleveland drivers.
              </p>
            </div>
          </FadeIn>

          <FadeIn delay={0.15}>
            <div className="space-y-4">
              {service.whyUs.map((item, i) => (
                <div key={i} className="flex items-start gap-4 p-4 border border-border/30 hover:border-primary/30 transition-colors">
                  <div className="w-8 h-8 bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="font-heading font-bold text-primary text-sm">{String(i + 1).padStart(2, "0")}</span>
                  </div>
                  <p className="text-foreground/80 leading-relaxed">{item}</p>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}

// ─── BOOKING SECTION ───────────────────────────────────
function BookingSection({ service }: { service: ServiceData }) {
  return (
    <section id="booking" className="section-dark py-20 lg:py-28">
      <div className="container">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20">
          <FadeIn>
            <div>
              <span className="font-mono text-primary text-sm tracking-widest uppercase">Get Started</span>
              <h2 className="font-heading font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight leading-[1.05]">
                SCHEDULE YOUR<br />
                <span className="text-gradient-yellow">{service.title}</span> SERVICE
              </h2>
              <p className="mt-6 text-foreground/70 leading-relaxed text-lg">
                Fill out the form and we will call you to confirm your appointment. Or call us directly — walk-ins are always welcome.
              </p>

              <div className="mt-8 space-y-6">
                <div className="flex items-start gap-3">
                  <MapPin className="w-5 h-5 text-primary mt-1 shrink-0" />
                  <div>
                    <p className="font-mono text-foreground/80">17625 Euclid Ave</p>
                    <p className="font-mono text-foreground/80">Cleveland, OH 44112</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Clock className="w-5 h-5 text-primary mt-1 shrink-0" />
                  <div className="font-mono text-foreground/80 space-y-1">
                    <p>Monday – Saturday: 8:00 AM – 6:00 PM</p>
                    <p>Sunday: 9:00 AM – 4:00 PM</p>
                  </div>
                </div>
                <a href="tel:2168620005" className="flex items-center gap-3 group">
                  <Phone className="w-5 h-5 text-primary shrink-0" />
                  <span className="font-mono text-2xl text-foreground group-hover:text-primary transition-colors">(216) 862-0005</span>
                </a>
              </div>
            </div>
          </FadeIn>

          <FadeIn delay={0.15}>
            <BookingForm defaultService={service.title === "EMISSIONS & E-CHECK" ? "Ohio E-Check / Emissions Repair" : service.title === "DIAGNOSTICS" ? "Check Engine Light / Diagnostics" : service.title === "OIL CHANGE" ? "Oil Change" : service.title === "GENERAL REPAIR" ? "General Repair / Other" : service.title === "TIRES" ? "Tires — New, Used, Repair" : "Brake Repair"} />
          </FadeIn>
        </div>
      </div>
    </section>
  );
}

// ─── OTHER SERVICES ────────────────────────────────────
function OtherServices({ currentSlug }: { currentSlug: string }) {
  const others = SERVICES.filter((s) => s.slug !== currentSlug);

  return (
    <section className="section-darker py-16 lg:py-20">
      <CautionStripe />
      <div className="container pt-12">
        <FadeIn>
          <span className="font-mono text-primary text-sm tracking-widest uppercase">More Services</span>
          <h2 className="font-heading font-bold text-2xl lg:text-4xl text-foreground mt-3 tracking-tight">
            OTHER SERVICES WE OFFER
          </h2>
        </FadeIn>

        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {others.map((s, i) => (
            <FadeIn key={s.slug} delay={i * 0.06}>
              <Link
                href={`/${s.slug}`}
                className="block border border-border/30 p-6 hover:border-primary/50 hover:bg-card/30 transition-colors group"
              >
                <div className="text-primary mb-3">{SERVICE_ICONS[s.slug]}</div>
                <h3 className="font-heading font-bold text-foreground tracking-wider text-sm group-hover:text-primary transition-colors">
                  {s.title}
                </h3>
                <p className="text-foreground/50 text-xs mt-2 leading-relaxed line-clamp-2">{s.shortDesc}</p>
              </Link>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── FOOTER ────────────────────────────────────────────
function ServiceFooter() {
  return (
    <footer className="section-dark border-t border-border/30">
      <CautionStripe />
      <div className="container py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <Link href="/" className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 bg-primary flex items-center justify-center rounded-sm">
                <span className="font-heading font-bold text-primary-foreground text-sm">N</span>
              </div>
              <span className="font-heading font-bold text-primary tracking-wider">NICK'S TIRE & AUTO</span>
            </Link>
            <p className="text-foreground/50 text-sm leading-relaxed">
              Honest auto repair and tire services for Cleveland, Euclid, and Northeast Ohio. Fair prices, real diagnostics, no surprises.
            </p>
          </div>

          <div>
            <h4 className="font-heading font-bold text-foreground tracking-wider text-sm uppercase mb-4">Services</h4>
            <div className="space-y-2 text-sm">
              {SERVICES.map((s) => (
                <Link key={s.slug} href={`/${s.slug}`} className="block text-foreground/50 hover:text-primary transition-colors">
                  {s.title === "EMISSIONS & E-CHECK" ? "Ohio E-Check & Emissions" : s.title.charAt(0) + s.title.slice(1).toLowerCase()}
                </Link>
              ))}
            </div>
          </div>

          <div>
            <h4 className="font-heading font-bold text-foreground tracking-wider text-sm uppercase mb-4">Areas Served</h4>
            <div className="space-y-2 text-sm text-foreground/50">
              <p>Cleveland, OH</p>
              <p>Euclid, OH</p>
              <p>East Cleveland, OH</p>
              <p>South Euclid, OH</p>
              <p>Richmond Heights, OH</p>
              <p>Northeast Ohio</p>
            </div>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-border/20 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-foreground/30 text-xs font-mono">
            &copy; {new Date().getFullYear()} NICK'S TIRE &amp; AUTO. ALL RIGHTS RESERVED.
          </p>
          <a href="tel:2168620005" className="text-primary font-mono text-sm hover:text-primary/80 transition-colors">
            (216) 862-0005
          </a>
        </div>
      </div>
    </footer>
  );
}

// ─── MOBILE CTA ────────────────────────────────────────
function MobileCTA() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-nick-dark/95 backdrop-blur-md border-t border-primary/30 p-3">
      <a href="tel:2168620005" className="flex items-center justify-center gap-2 bg-primary text-primary-foreground w-full py-3.5 font-heading font-bold text-base tracking-wider uppercase">
        <Phone className="w-5 h-5" />
        CALL (216) 862-0005
      </a>
    </div>
  );
}

// ─── JSON-LD SCHEMA ────────────────────────────────────
function ServiceSchema({ service }: { service: ServiceData }) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: service.title === "EMISSIONS & E-CHECK" ? "Ohio E-Check & Emissions Repair" : `${service.title.charAt(0)}${service.title.slice(1).toLowerCase()} Service`,
    description: service.metaDescription,
    provider: {
      "@type": "AutoRepair",
      name: "Nick's Tire & Auto",
      address: {
        "@type": "PostalAddress",
        streetAddress: "17625 Euclid Ave",
        addressLocality: "Cleveland",
        addressRegion: "OH",
        postalCode: "44112",
        addressCountry: "US",
      },
      telephone: "+1-216-862-0005",
      url: "https://nickstire-fqyrztyc.manus.space",
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue: "4.9",
        reviewCount: "1683",
      },
    },
    areaServed: [
      { "@type": "City", name: "Cleveland" },
      { "@type": "City", name: "Euclid" },
      { "@type": "City", name: "East Cleveland" },
      { "@type": "City", name: "South Euclid" },
      { "@type": "City", name: "Richmond Heights" },
    ],
  };

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: service.problems.map((p) => ({
      "@type": "Question",
      name: p.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: p.answer,
      },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
    </>
  );
}

// ─── MAIN PAGE ─────────────────────────────────────────
export default function ServicePage() {
  const [, params] = useRoute("/:slug");
  const slug = params?.slug || "";
  const service = SERVICES.find((s) => s.slug === slug);

  // Scroll to top on route change
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [slug]);

  // Update document title and meta
  useEffect(() => {
    if (service) {
      document.title = service.metaTitle;
      const metaDesc = document.querySelector('meta[name="description"]');
      if (metaDesc) {
        metaDesc.setAttribute("content", service.metaDescription);
      } else {
        const meta = document.createElement("meta");
        meta.name = "description";
        meta.content = service.metaDescription;
        document.head.appendChild(meta);
      }
    }
  }, [service]);

  if (!service) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="font-heading font-bold text-4xl text-foreground mb-4">SERVICE NOT FOUND</h1>
          <p className="text-foreground/60 mb-8">The service page you are looking for does not exist.</p>
          <Link href="/" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-heading font-bold text-sm tracking-wider uppercase">
            <ArrowLeft className="w-4 h-4" />
            BACK TO HOME
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <ServiceSchema service={service} />
      <NotificationBar />
      <ServiceNavbar service={service} />
      <main>
        <ServiceHero service={service} />
        <Problems service={service} />
        <Process service={service} />
        <WhyUs service={service} />
        <BookingSection service={service} />
        <OtherServices currentSlug={service.slug} />
      </main>
      <ServiceFooter />
      <MobileCTA />
    </div>
  );
}
