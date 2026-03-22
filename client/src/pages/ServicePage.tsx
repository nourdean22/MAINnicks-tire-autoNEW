/*
 * ServicePage — Individual SEO-optimized service pages
 * Each page follows the brand's content structure:
 * Problem Hook → Simple Explanation → Diagnostic Authority → Solution → Local Trust → CTA
 */

import InternalLinks from "@/components/InternalLinks";
import ExitIntentOffer from "@/components/ExitIntentOffer";
import PageLayout from "@/components/PageLayout";
import { useState, useEffect } from "react";
import { useRoute, Link } from "wouter";
import { SERVICES, type ServiceData } from "@shared/services";
import BookingForm from "@/components/BookingForm";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import { Phone, MapPin, Clock, Star, ChevronRight, ChevronDown, ArrowLeft, Wrench, Shield, Gauge, Zap, Droplets, ThermometerSun, Menu, X, CreditCard } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { BUSINESS } from "@shared/business";
import FadeIn from "@/components/FadeIn";
import ServiceDetailsAccordion from "@/components/ServiceDetailsAccordion";

// CDN images
const HERO_IMAGES: Record<string, string> = {
  tires: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-tires-AWxeiFZmv6FQocUMfiJvWb.webp",
  brakes: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-brakes-nKAKuxmW2WAmNrbCFRD9zL.webp",
  diagnostics: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-diagnostics-AN7H3iz5Tow2ab2METgner.webp",
  emissions: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-main-DE7GKwfCThaBL66r78QWkU.webp",
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

// ─── SERVICE NAVBAR ────────────────────────────────────
function ServiceNavbar({ service: _service }: { service: ServiceData }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={`fixed ${scrolled ? "top-0" : "top-[40px]"} left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "bg-background/95 backdrop-blur-md shadow-lg shadow-nick-yellow/5" : "bg-transparent"}`}>
      <div className="container flex items-center justify-between h-16 lg:h-20">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary flex items-center justify-center rounded-md">
            <span className="font-semibold font-bold text-primary-foreground text-lg">N</span>
          </div>
          <div className="flex flex-col">
            <span className="font-semibold font-bold text-primary text-lg leading-tight tracking-wide">NICK'S TIRE & AUTO</span>
            <span className="text-nick-blue-light/70 text-xs tracking-wide">Cleveland, Ohio</span>
          </div>
        </Link>

        <div className="hidden lg:flex items-center gap-6">
          
          <Link href="/" className="flex items-center gap-1 font-semibold text-sm tracking-wide text-foreground/60 hover:text-nick-blue-light transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Home
          </Link>
          <a href="#problems" className="font-semibold text-sm tracking-wide text-foreground/80 hover:text-primary transition-colors">
            Common Problems
          </a>
          <a href="#process" className="font-semibold text-sm tracking-wide text-foreground/80 hover:text-primary transition-colors">
            Our Process
          </a>
          <a href="#booking" className="font-semibold text-sm tracking-wide text-foreground/80 hover:text-primary transition-colors">
            Book Now
          </a>
          <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('service-navbar-desktop')} className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-md font-semibold font-bold text-sm tracking-wide hover:opacity-90 transition-colors" aria-label="Call Nick's Tire and Auto at 216-862-0005">
            <Phone className="w-4 h-4" />
            {BUSINESS.phone.display}
          </a>
        </div>

        <div className="lg:hidden flex items-center gap-1">
          
          <button onClick={() => setMobileOpen(!mobileOpen)} className="text-foreground p-2">
            {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="lg:hidden bg-background/98 backdrop-blur-md border-t border-primary/20">
          <div className="container py-6 flex flex-col gap-4">
            <Link href="/" onClick={() => setMobileOpen(false)} className="flex items-center gap-2 font-semibold text-lg tracking-wide text-foreground/60 hover:text-nick-blue-light transition-colors py-2">
              <ArrowLeft className="w-5 h-5" />
              Back to Home
            </Link>
            <a href="#problems" onClick={() => setMobileOpen(false)} className="font-semibold text-lg tracking-wide text-foreground/80 hover:text-primary transition-colors py-2">
              Common Problems
            </a>
            <a href="#process" onClick={() => setMobileOpen(false)} className="font-semibold text-lg tracking-wide text-foreground/80 hover:text-primary transition-colors py-2">
              Our Process
            </a>
            <a href="#booking" onClick={() => setMobileOpen(false)} className="font-semibold text-lg tracking-wide text-foreground/80 hover:text-primary transition-colors py-2">
              Book Now
            </a>
            <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('service-navbar-mobile')} className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-5 py-3 rounded-md font-semibold font-bold text-sm tracking-wide mt-2" aria-label="Call Nick's Tire and Auto at 216-862-0005">
              <Phone className="w-4 h-4" />
              {BUSINESS.phone.display}
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
        <img loading="lazy" src={heroImg} alt={`${service.title} service at Nick's Tire and Auto in Cleveland Ohio`} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/40" />
      </div>

      <div className="relative container pb-16 pt-32 lg:pb-24">
        <FadeIn>
          <Breadcrumbs items={[{ label: service.title }]} />
        </FadeIn>

        <FadeIn delay={0.1}>
          <div className="flex items-center gap-4 mb-4">
            <div className="text-nick-blue-light">{icon}</div>
            <span className="text-[13px] text-nick-blue-light tracking-wide">Service {service.num}</span>
          </div>
          <h1 className="font-semibold font-bold text-4xl sm:text-5xl lg:text-7xl text-foreground leading-[0.9] tracking-tight max-w-3xl">
            {service.heroHeadline}
          </h1>
        </FadeIn>

        <FadeIn delay={0.2}>
          <p className="mt-6 text-lg sm:text-xl text-foreground/80 max-w-2xl font-light leading-relaxed">
            {service.heroSubline}
          </p>
        </FadeIn>
        <FadeIn delay={0.3}>
          <div className="mt-6 flex items-center gap-2 bg-nick-teal/10 border border-nick-teal/30 rounded-md px-4 py-3 w-fit mb-4">
            <div className="w-2 h-2 rounded-full bg-nick-teal animate-pulse" />
            <span className="text-sm font-medium text-nick-teal">Walk-ins welcome! Same-day appointments available.</span>
          </div>
          <div className="mt-4 flex flex-col sm:flex-row gap-4">
            <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('service-hero-cta')} className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-md font-semibold font-bold text-lg tracking-wide hover:opacity-90 transition-colors" aria-label="Call Nick's Tire and Auto at 216-862-0005">
              <Phone className="w-5 h-5" />
              {service.heroCTA || "CALL NOW"}
            </a>
            <a href="#booking" className="inline-flex items-center justify-center gap-2 border-2 border-nick-blue/50 text-nick-blue-light px-8 py-4 rounded-md font-semibold font-bold text-lg tracking-wide hover:bg-nick-blue/10 hover:border-nick-blue transition-colors">
              BOOK ONLINE
              <ChevronRight className="w-5 h-5" />
            </a>
          </div>
        </FadeIn>

        {/* Turnaround + Pricing badges */}
        <FadeIn delay={0.4}>
          <div className="mt-8 flex flex-wrap gap-4 text-sm">
            {service.turnaround && (
              <div className="flex items-center gap-2 bg-nick-blue/10 border border-nick-blue/20 rounded-md px-4 py-2">
                <Clock className="w-4 h-4 text-nick-blue-light shrink-0" />
                <span className="text-foreground/80 text-[12px]">{service.turnaround}</span>
              </div>
            )}
            {service.pricingNote && (
              <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-md px-4 py-2">
                <Star className="w-4 h-4 text-primary shrink-0" />
                <span className="text-foreground/80 text-[12px]">{service.pricingNote}</span>
              </div>
            )}
          </div>
        </FadeIn>

        {/* Urgency alert — only shown for safety-critical services */}
        {service.urgencyNote && (
          <FadeIn delay={0.5}>
            <div className="mt-6 space-y-4">
              <div className="flex items-start gap-3 bg-red-950/40 border border-red-800/40 rounded-md px-5 py-4 max-w-2xl">
                <span className="text-red-400 text-lg shrink-0 mt-0.5">⚠</span>
                <p className="text-red-300/90 text-sm leading-relaxed">{service.urgencyNote}</p>
              </div>

              {/* Urgent callout */}
              <div className="flex items-start gap-3 bg-amber-950/40 border border-amber-800/40 rounded-md px-5 py-4 max-w-2xl">
                <span className="text-amber-400 text-lg shrink-0 mt-0.5">⚡</span>
                <div>
                  <p className="text-amber-200/90 text-sm font-semibold mb-2">Is this urgent?</p>
                  <p className="text-amber-200/70 text-sm leading-relaxed">
                    Call us — we prioritize same-day emergencies.
                  </p>
                  <a
                    href={BUSINESS.phone.href}
                    onClick={() => trackPhoneClick('service-urgent-cta')}
                    className="inline-flex items-center gap-2 mt-3 text-amber-400 hover:text-amber-300 font-semibold text-sm transition-colors"
                  >
                    <Phone className="w-4 h-4" />
                    {BUSINESS.phone.display}
                  </a>
                </div>
              </div>
            </div>
          </FadeIn>
        )}
      </div>
    </section>
  );
}

// ─── COMMON PROBLEMS ───────────────────────────────────
function Problems({ service }: { service: ServiceData }) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="problems" className="bg-[oklch(0.055_0.004_260)] py-20 lg:py-28">
      
      <div className="container pt-16">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20">
          <FadeIn>
            <div>
              <span className="font-mono text-nick-blue-light text-sm tracking-wide">Common Problems</span>
              <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight leading-[1.05]">
                WHAT DRIVERS<br />
                <span className="text-primary">ASK US</span>
              </h2>
              <p className="mt-6 text-foreground/70 leading-relaxed text-lg">
                {service.slug === "tires" && "These are the tire problems Cleveland drivers bring to us most often. Catching tire issues early saves money and keeps you safe on the road."}
                {service.slug === "brakes" && "Brake problems are one of the most common — and most urgent — reasons drivers visit our shop. Here are the signs Cleveland drivers ask us about most."}
                {service.slug === "diagnostics" && "Warning lights and performance issues can mean dozens of different things. These are the diagnostic questions we answer every day in our Cleveland shop."}
                {service.slug === "emissions" && "Ohio E-Check failures are stressful, but most emissions problems have straightforward solutions. Here is what Cleveland drivers ask us most."}
                {service.slug === "oil-change" && "Oil changes are the most important routine maintenance for your engine. Here are the questions Cleveland drivers ask us about oil service."}
                {service.slug === "general-repair" && "From strange noises to overheating, these are the general repair concerns Cleveland drivers bring to us most often."}
              </p>
              <div className="mt-8 flex items-center gap-3 text-foreground/50">
                <div className="flex gap-0.5">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-nick-yellow text-primary" />
                  ))}
                </div>
                <span className="text-[12px]">4.9 stars from {BUSINESS.reviews.countDisplay} reviews</span>
              </div>
            </div>
          </FadeIn>

          <div className="flex flex-col gap-0">
            {service.problems.map((p, i) => (
              <FadeIn key={i} delay={i * 0.06}>
                <button
                  onClick={() => setOpen(open === i ? null : i)}
                  className="w-full text-left border-b border-nick-blue/15 py-6 group"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold font-bold text-lg lg:text-xl text-foreground tracking-wider group-hover:text-primary transition-colors">
                      {p.question}
                    </h3>
                    <ChevronDown className={`w-5 h-5 text-nick-blue-light transition-transform duration-200 shrink-0 ml-4 ${open === i ? "rotate-180" : ""}`} />
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

// ─── WARNING SIGNS ────────────────────────────────────
function WarningSigns({ service }: { service: ServiceData }) {
  if (!service.signs || service.signs.length === 0) return null;

  return (
    <section className="bg-[oklch(0.065_0.004_260)] py-16 lg:py-20">
      <div className="container">
        <FadeIn>
          <div className="max-w-4xl mx-auto">
            <span className="font-mono text-primary text-sm tracking-wide">Warning Signs</span>
            <h2 className="font-semibold font-bold text-3xl lg:text-4xl text-foreground mt-3 tracking-tight">
              SIGNS YOU NEED <span className="text-primary">{service.title}</span> SERVICE
            </h2>
            <p className="mt-4 text-foreground/60 text-lg">
              If you notice any of these, do not wait. Bring your vehicle in for an inspection.
            </p>

            <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {service.signs.map((sign, i) => (
                <FadeIn key={i} delay={i * 0.05}>
                  <div className="flex items-start gap-3 bg-card/60 border border-nick-blue/10 rounded-md p-4">
                    <div className="w-6 h-6 bg-primary/15 flex items-center justify-center rounded-full shrink-0 mt-0.5">
                      <span className="text-primary text-xs font-bold">{i + 1}</span>
                    </div>
                    <p className="text-foreground/80 text-sm leading-relaxed">{sign}</p>
                  </div>
                </FadeIn>
              ))}
            </div>

            {service.urgencyNote && (
              <FadeIn delay={0.3}>
                <div className="mt-8 bg-primary/10 border border-primary/25 rounded-md p-5">
                  <p className="text-foreground/90 text-sm leading-relaxed">
                    <strong className="text-primary">Important:</strong> {service.urgencyNote}
                  </p>
                </div>
              </FadeIn>
            )}

            <FadeIn delay={0.35}>
              <div className="mt-8 flex flex-col sm:flex-row gap-4">
                <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('service-signs-cta')} className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-md font-semibold font-bold text-sm tracking-wide hover:opacity-90 transition-colors" aria-label="Call Nick's Tire and Auto at 216-862-0005">
                  <Phone className="w-4 h-4" />
                  CALL {BUSINESS.phone.display}
                </a>
                <a href="#booking" className="inline-flex items-center justify-center gap-2 border-2 border-nick-blue/40 text-nick-blue-light px-6 py-3 rounded-md font-semibold font-bold text-sm tracking-wide hover:bg-nick-blue/10 transition-colors">
                  SCHEDULE INSPECTION
                  <ChevronRight className="w-4 h-4" />
                </a>
              </div>
            </FadeIn>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

// ─── OUR PROCESS ───────────────────────────────────────
function Process({ service }: { service: ServiceData }) {
  return (
    <section id="process" className="bg-[oklch(0.065_0.004_260)] py-20 lg:py-28">
      <div className="container">
        <FadeIn>
          <span className="font-mono text-primary text-sm tracking-wide">How We Work</span>
          <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight">
            OUR <span className="text-primary">{service.title}</span> PROCESS
          </h2>
          <p className="mt-4 text-foreground/60 text-lg max-w-2xl">
            Every repair follows a structured process. We diagnose first, explain what we find, and fix it right.
          </p>
        </FadeIn>

        <div className="mt-14 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {service.process.map((step, i) => (
            <FadeIn key={i} delay={i * 0.08}>
              <div className="relative bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-6 lg:p-8 h-full">
                <div className="flex items-center gap-3 mb-4">
                  <span className="font-semibold font-bold text-4xl text-primary/30">{String(i + 1).padStart(2, "0")}</span>
                </div>
                <h3 className="font-semibold font-bold text-lg text-nick-blue-light tracking-[-0.01em] mb-3">{step.step}</h3>
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
    <section className="bg-[oklch(0.055_0.004_260)] py-20 lg:py-28">
      <div className="h-1.5 w-full bg-gradient-to-r from-nick-teal via-nick-yellow to-nick-yellow" />
      <div className="container pt-16">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          <FadeIn>
            <div>
              <span className="font-mono text-nick-blue-light text-sm tracking-wide">Why Nick's</span>
              <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight leading-[1.05]">
                {service.title} SERVICE<br />
                <span className="text-primary">YOU CAN TRUST</span>
              </h2>
              <p className="mt-4 text-foreground/70 leading-relaxed text-base bg-primary/5 border border-primary/20 rounded-md px-4 py-3">
                <strong className="text-primary">Our Guarantee:</strong> We stand behind every repair with a warranty on parts and labor. If something is not right, we make it right.
              </p>
              <p className="mt-4 text-foreground/70 leading-relaxed text-lg">
                {service.slug === "tires" && "We carry all major tire brands at fair prices, and our technicians help you find the right tire for your vehicle and budget. No pressure, no upselling — just honest recommendations from a shop Cleveland drivers trust."}
                {service.slug === "brakes" && "We show you the worn brake components before any work begins. You see the problem, understand the repair, and approve the price. That transparency is why Cleveland drivers trust us with their brake work."}
                {service.slug === "diagnostics" && "We test before we replace. Our advanced OBD-II scanners and live data analysis pinpoint the exact failed component so you only pay for what you actually need. That approach has earned us the trust of Cleveland drivers."}
                {service.slug === "emissions" && "We specialize in Ohio E-Check failures and know the exact drive cycles to get your monitors to complete. We fix the root cause — not just clear codes — so you pass inspection the first time back."}
                {service.slug === "oil-change" && "We use the correct oil weight per your manufacturer specification and quality filters. Every oil change includes a free multi-point inspection so we can catch small problems before they become expensive ones."}
                {service.slug === "general-repair" && "From suspension and steering to exhaust and cooling systems, we diagnose the root cause and explain every repair in plain language. Written estimates before any work begins — no surprises on the bill."}
              </p>
            </div>
          </FadeIn>

          <FadeIn delay={0.15}>
            <div className="space-y-4">
              {service.whyUs.map((item, i) => (
                <div key={i} className="flex items-start gap-4 p-4 bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl">
                  <div className="w-8 h-8 bg-primary/10 flex items-center justify-center rounded-md shrink-0 mt-0.5">
                    <span className="font-semibold font-bold text-primary text-sm">{String(i + 1).padStart(2, "0")}</span>
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


// ─── SERVICE DETAILS ACCORDION (WHAT'S INCLUDED) ─────────
function ServiceDetails({ service }: { service: ServiceData }) {
  // Build accordion sections from service data
  const sections = [];
  
  if (service.includedItems && service.includedItems.length > 0) {
    sections.push({
      title: `What's included in ${service.title.toLowerCase()}`,
      items: service.includedItems,
    });
  }
  
  if (service.pricingTiers && service.pricingTiers.length > 0) {
    // For pricing, we'll render as content with formatted list
    const pricingContent = service.pricingTiers.map((tier) => `${tier.label}: ${tier.range}`).join(" · ");
    sections.push({
      title: `How much does it cost?`,
      content: pricingContent,
    });
  }
  
  if (service.duration) {
    sections.push({
      title: `How long does it take?`,
      content: service.duration,
    });
  }

  if (sections.length === 0) return null;

  return (
    <section className="bg-[oklch(0.065_0.004_260)] py-20 lg:py-28">
      <div className="container">
        <FadeIn>
          <div className="max-w-3xl">
            <span className="font-mono text-nick-blue-light text-sm tracking-wide">What to Expect</span>
            <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight">
              SERVICE <span className="text-primary">DETAILS</span>
            </h2>
            <p className="mt-4 text-foreground/60 text-lg">
              Everything included in our {service.title.toLowerCase()} service, plus transparent pricing and timeframe estimates.
            </p>

            {/* Price Anchor & Financing Badge */}
            {service.startingPrice && (
              <FadeIn delay={0.1}>
                <div className="mt-8 flex flex-wrap items-center gap-4">
                  <div className="bg-primary/5 border border-primary/20 rounded-lg px-6 py-4">
                    <div className="text-sm text-foreground/60 mb-1">Starting at</div>
                    <div className="font-bold text-2xl text-primary">{service.startingPrice}</div>
                  </div>
                  <Link href="/financing" className="flex items-center gap-2 bg-nick-teal/5 border border-nick-teal/20 rounded-lg px-4 py-3 text-sm text-nick-teal hover:bg-nick-teal/10 transition-colors">
                    <CreditCard className="w-4 h-4" />
                    <span>Financing available · No credit needed options →</span>
                  </Link>
                </div>
              </FadeIn>
            )}

            {/* Duration Info */}
            {service.duration && (
              <FadeIn delay={0.15}>
                <div className="mt-6 flex items-center gap-3 text-foreground/60">
                  <Clock className="w-5 h-5 text-nick-blue-light" />
                  <span>Estimated time: <strong className="text-foreground">{service.duration}</strong></span>
                </div>
              </FadeIn>
            )}
          </div>
        </FadeIn>

        {/* Accordion */}
        <FadeIn delay={0.2}>
          <div className="mt-12 max-w-3xl">
            <ServiceDetailsAccordion sections={sections} />
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

// ─── AEO QUICK ANSWERS ────────────────────────────────
function QuickAnswers({ service }: { service: ServiceData }) {
  if (!service.quickAnswers || service.quickAnswers.length === 0) return null;

  return (
    <section className="bg-[oklch(0.055_0.004_260)] py-20 lg:py-28">
      <div className="container">
        <FadeIn>
          <span className="font-mono text-nick-blue-light text-sm tracking-wide">Quick Answers</span>
          <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight">
            PEOPLE <span className="text-primary">ALSO ASK</span>
          </h2>
          <p className="mt-4 text-foreground/60 text-lg max-w-2xl">
            Answers to the most common questions Cleveland drivers ask about {service.title.toLowerCase()} service.
          </p>
        </FadeIn>

        <div className="mt-12 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {service.quickAnswers.map((qa, i) => (
            <FadeIn key={i} delay={i * 0.08}>
              <div className="bg-card/60 border border-nick-blue/10 rounded-lg p-6 lg:p-8 h-full">
                <h3 className="font-semibold font-bold text-lg text-primary tracking-wide mb-4">
                  {qa.question}
                </h3>
                <p className="text-foreground/70 leading-relaxed text-base">
                  {qa.answer}
                </p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── BOOKING SECTION ───────────────────────────────────
function BookingSection({ service }: { service: ServiceData }) {
  return (
    <section id="booking" className="bg-[oklch(0.065_0.004_260)] py-20 lg:py-28">
      <div className="container">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20">
          <FadeIn>
            <div>
              <span className="font-mono text-primary text-sm tracking-wide">Get Started</span>
              <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight leading-[1.05]">
                SCHEDULE YOUR<br />
                <span className="text-primary">{service.title}</span> SERVICE
              </h2>
              <p className="mt-6 text-foreground/70 leading-relaxed text-lg">
                Fill out the form and we will call you to confirm your appointment. Or call us directly — walk-ins are always welcome.
              </p>

              <div className="mt-8 space-y-6">
                <div className="flex items-start gap-3">
                  <MapPin className="w-5 h-5 text-nick-blue-light mt-1 shrink-0" />
                  <div>
                    <p className="font-mono text-foreground/80">{BUSINESS.address.street}</p>
                    <p className="font-mono text-foreground/80">Cleveland, OH 44112</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Clock className="w-5 h-5 text-nick-blue-light mt-1 shrink-0" />
                  <div className="font-mono text-foreground/80 space-y-1">
                    <p>Monday – Saturday: 8:00 AM – 6:00 PM</p>
                    <p>Sunday: 9:00 AM – 4:00 PM</p>
                  </div>
                </div>
                <a href={BUSINESS.phone.href} className="flex items-center gap-3 group">
                  <Phone className="w-5 h-5 text-primary shrink-0" />
                  <span className="font-mono text-2xl text-foreground group-hover:text-primary transition-colors">{BUSINESS.phone.display}</span>
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
    <section className="bg-[oklch(0.055_0.004_260)] py-16 lg:py-20">
      
      <div className="container pt-12">
        <FadeIn>
          <span className="font-mono text-nick-blue-light text-sm tracking-wide">More Services</span>
          <h2 className="font-semibold font-bold text-2xl lg:text-4xl text-foreground mt-3 tracking-tight">
            OTHER SERVICES WE OFFER
          </h2>
        </FadeIn>

        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {others.map((s, i) => (
            <FadeIn key={s.slug} delay={i * 0.06}>
              <Link
                href={`/${s.slug}`}
                className="block bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-6 group"
              >
                <div className="text-nick-blue-light mb-3 group-hover:text-primary transition-colors">{SERVICE_ICONS[s.slug]}</div>
                <h3 className="font-semibold font-bold text-foreground tracking-wider text-sm group-hover:text-primary transition-colors">
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


// ─── MOBILE CTA ────────────────────────────────────────


// ─── JSON-LD SCHEMA ────────────────────────────────────
function ServiceSchema({ service }: { service: ServiceData }) {
  // Normalize service names for Google schema
  const serviceNameMap: Record<string, string> = {
    tires: "Tire Service",
    brakes: "Brake Repair Service",
    diagnostics: "Automotive Diagnostics Service",
    emissions: "Emissions Testing & Repair Service",
    "oil-change": "Oil Change Service",
    "general-repair": "General Automotive Repair Service",
  };

  const schema = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: serviceNameMap[service.slug] || `${service.title} Service`,
    description: service.shortDesc,
    provider: {
      "@type": ["LocalBusiness", "AutoRepair", "TireShop"],
      name: BUSINESS.name,
      image: `${BUSINESS.urls.website}/favicon.ico`,
      description: BUSINESS.seo.defaultDescription,
      address: {
        "@type": "PostalAddress",
        streetAddress: BUSINESS.address.street,
        addressLocality: BUSINESS.address.city,
        addressRegion: BUSINESS.address.state,
        postalCode: BUSINESS.address.zip,
        addressCountry: "US",
      },
      geo: {
        "@type": "GeoCoordinates",
        latitude: BUSINESS.geo.lat,
        longitude: BUSINESS.geo.lng,
      },
      telephone: `+1-${BUSINESS.phone.dashed}`,
      url: BUSINESS.urls.website,
      openingHoursSpecification: {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
        opens: "09:00",
        closes: "18:00",
      },
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue: BUSINESS.reviews.rating,
        reviewCount: BUSINESS.reviews.count,
        bestRating: 5,
      },
      hasMap: BUSINESS.urls.googleBusiness,
      sameAs: BUSINESS.sameAs,
    },
    areaServed: {
      "@type": "City",
      name: "Cleveland",
    },
    serviceType: `${service.title} Service`,
    availableAt: {
      "@type": "Place",
      name: BUSINESS.name,
      address: {
        "@type": "PostalAddress",
        streetAddress: BUSINESS.address.street,
        addressLocality: BUSINESS.address.city,
        addressRegion: BUSINESS.address.state,
        postalCode: BUSINESS.address.zip,
        addressCountry: "US",
      },
      geo: {
        "@type": "GeoCoordinates",
        latitude: BUSINESS.geo.lat,
        longitude: BUSINESS.geo.lng,
      },
    },
  };

  const allFAQs = [
    ...service.problems.map((p) => ({
      "@type": "Question" as const,
      name: p.question,
      acceptedAnswer: {
        "@type": "Answer" as const,
        text: p.answer,
      },
    })),
    ...(service.quickAnswers || []).map((qa) => ({
      "@type": "Question" as const,
      name: qa.question,
      acceptedAnswer: {
        "@type": "Answer" as const,
        text: qa.answer,
      },
    })),
  ];

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: allFAQs,
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

  // SEOHead handles title, meta description, and canonical tag

  if (!service) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="font-semibold font-bold text-4xl text-foreground mb-4">SERVICE NOT FOUND</h1>
          <p className="text-foreground/60 mb-8">The service page you are looking for does not exist.</p>
          <Link href="/" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-md font-semibold font-bold text-sm tracking-wide">
            <ArrowLeft className="w-4 h-4" />
            BACK TO HOME
          </Link>
        </div>
      </div>
    );
  }

  return (
    <PageLayout>
      {service && (
        <SEOHead
          title={service.metaTitle}
          description={service.metaDescription}
          canonicalPath={`/${service.slug}`}
        />
      )}
      <ServiceSchema service={service} />
      
      
      <ServiceNavbar service={service} />

        <ServiceHero service={service} />
        <ServiceDetails service={service} />
        <Problems service={service} />
        <WarningSigns service={service} />
        <Process service={service} />
        <WhyUs service={service} />
        <QuickAnswers service={service} />
        <BookingSection service={service} />
        <OtherServices currentSlug={service.slug} />

      
      <InternalLinks title="Related Services" />
      <ExitIntentOffer serviceName={service.title} />
    </PageLayout>
  );
}
