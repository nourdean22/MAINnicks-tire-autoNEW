/*
 * ServicePage — Individual SEO-optimized service pages
 * Each page follows the brand's content structure:
 * Problem Hook → Simple Explanation → Diagnostic Authority → Solution → Local Trust → CTA
 */

import InternalLinks from "@/components/InternalLinks";
import RelatedServices from "@/components/RelatedServices";
import PageLayout from "@/components/PageLayout";
import { useState, useEffect } from "react";
import { useRoute, Link } from "wouter";
import { SERVICES, type ServiceData } from "@shared/services";
import BookingForm from "@/components/BookingForm";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import { Phone, MapPin, Clock, Star, ChevronRight, ChevronDown, ArrowLeft, Wrench, Shield, Gauge, Zap, Droplets, ThermometerSun, Snowflake, Menu, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { BUSINESS } from "@shared/business";
import FadeIn from "@/components/FadeIn";
import FinancingCTA from "@/components/FinancingCTA";
import ServiceProofBlock from "@/components/ServiceProofBlock";
import ObjectionProofBlock from "@/components/ObjectionProofBlock";
import ProofClusterStrip from "@/components/ProofClusterStrip";
import ApprovalPromiseBlock from "@/components/ApprovalPromiseBlock";
import WhatToExpectAtYourVisit from "@/components/WhatToExpectAtYourVisit";
import WhatAffectsPrice, { PRICE_FACTORS } from "@/components/WhatAffectsPrice";
import EstimateTrustBlock from "@/components/EstimateTrustBlock";
import { getProofConfig } from "@shared/proof";

// CDN images
const DEFAULT_HERO = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-main-DE7GKwfCThaBL66r78QWkU.webp";

const HERO_IMAGES: Record<string, string> = {
  tires: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-tires-AWxeiFZmv6FQocUMfiJvWb.webp",
  brakes: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-brakes-nKAKuxmW2WAmNrbCFRD9zL.webp",
  diagnostics: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-diagnostics-AN7H3iz5Tow2ab2METgner.webp",
  emissions: DEFAULT_HERO,
  "oil-change": DEFAULT_HERO,
  "general-repair": DEFAULT_HERO,
  "ac-repair": DEFAULT_HERO,
  transmission: DEFAULT_HERO,
  electrical: DEFAULT_HERO,
  battery: DEFAULT_HERO,
  exhaust: DEFAULT_HERO,
  cooling: DEFAULT_HERO,
  "pre-purchase-inspection": DEFAULT_HERO,
  "belts-hoses": DEFAULT_HERO,
  "starter-alternator": DEFAULT_HERO,
};

const SERVICE_ICONS: Record<string, React.ReactNode> = {
  tires: <Gauge className="w-8 h-8" />,
  brakes: <Shield className="w-8 h-8" />,
  diagnostics: <Zap className="w-8 h-8" />,
  emissions: <ThermometerSun className="w-8 h-8" />,
  "oil-change": <Droplets className="w-8 h-8" />,
  "general-repair": <Wrench className="w-8 h-8" />,
  "ac-repair": <Snowflake className="w-8 h-8" />,
  transmission: <Wrench className="w-8 h-8" />,
  electrical: <Zap className="w-8 h-8" />,
  battery: <Zap className="w-8 h-8" />,
  exhaust: <ThermometerSun className="w-8 h-8" />,
  cooling: <Droplets className="w-8 h-8" />,
  "pre-purchase-inspection": <Shield className="w-8 h-8" />,
  "belts-hoses": <Gauge className="w-8 h-8" />,
  "starter-alternator": <Zap className="w-8 h-8" />,
};

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
    <nav className={`fixed ${scrolled ? "top-0" : "top-[40px]"} left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "bg-background/95 backdrop-blur-md shadow-lg shadow-nick-yellow/5" : "bg-transparent"}`}>
      <div className="container flex items-center justify-between h-16 lg:h-20">
        <Link href="/" className="flex items-center gap-3 stagger-in">
          <div className="w-10 h-10 bg-primary flex items-center justify-center rounded-md">
            <span className="font-semibold font-bold text-primary-foreground text-lg">N</span>
          </div>
          <div className="flex flex-col">
            <span className="font-semibold font-bold text-primary text-lg leading-tight tracking-wide">NICK'S TIRE & AUTO</span>
            <span className="text-nick-blue-light/70 text-xs tracking-wide">Cleveland, Ohio</span>
          </div>
        </Link>

        <div className="hidden lg:flex items-center gap-6 stagger-in">
          
          <Link href="/" className="flex items-center gap-1 stagger-in font-semibold text-sm tracking-wide text-foreground/60 hover:text-nick-blue-light transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Home
          </Link>
          <a href="#problems" className="font-semibold text-sm tracking-wide text-foreground/80 hover:text-primary transition-colors">
            Common Problems
          </a>
          {service.costBreakdown && (
            <a href="#costs" className="font-semibold text-sm tracking-wide text-foreground/80 hover:text-primary transition-colors">
              Costs
            </a>
          )}
          <a href="#process" className="font-semibold text-sm tracking-wide text-foreground/80 hover:text-primary transition-colors">
            Our Process
          </a>
          {service.faq && (
            <a href="#faq" className="font-semibold text-sm tracking-wide text-foreground/80 hover:text-primary transition-colors">
              FAQ
            </a>
          )}
          <a href="#booking" className="font-semibold text-sm tracking-wide text-foreground/80 hover:text-primary transition-colors">
            Book Now
          </a>
          <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('service-navbar-desktop')} className="flex items-center gap-2 stagger-in bg-primary text-primary-foreground btn-premium px-5 py-2.5 rounded-md font-semibold font-bold text-sm tracking-wide hover:opacity-90 transition-colors" aria-label="Call Nick's Tire and Auto at 216-862-0005">
            <Phone className="w-4 h-4" />
            {BUSINESS.phone.display}
          </a>
        </div>

        <div className="lg:hidden flex items-center gap-1 stagger-in">
          
          <button onClick={() => setMobileOpen(!mobileOpen)} className="text-foreground p-2">
            {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="lg:hidden bg-background/98 backdrop-blur-md border-t border-primary/20">
          <div className="container py-6 flex flex-col gap-4 stagger-in">
            <Link href="/" onClick={() => setMobileOpen(false)} className="flex items-center gap-2 stagger-in font-semibold text-lg tracking-wide text-foreground/60 hover:text-nick-blue-light transition-colors py-2">
              <ArrowLeft className="w-5 h-5" />
              Back to Home
            </Link>
            <a href="#problems" onClick={() => setMobileOpen(false)} className="font-semibold text-lg tracking-wide text-foreground/80 hover:text-primary transition-colors py-2">
              Common Problems
            </a>
            {service.costBreakdown && (
              <a href="#costs" onClick={() => setMobileOpen(false)} className="font-semibold text-lg tracking-wide text-foreground/80 hover:text-primary transition-colors py-2">
                Costs
              </a>
            )}
            <a href="#process" onClick={() => setMobileOpen(false)} className="font-semibold text-lg tracking-wide text-foreground/80 hover:text-primary transition-colors py-2">
              Our Process
            </a>
            {service.faq && (
              <a href="#faq" onClick={() => setMobileOpen(false)} className="font-semibold text-lg tracking-wide text-foreground/80 hover:text-primary transition-colors py-2">
                FAQ
              </a>
            )}
            <a href="#booking" onClick={() => setMobileOpen(false)} className="font-semibold text-lg tracking-wide text-foreground/80 hover:text-primary transition-colors py-2">
              Book Now
            </a>
            <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('service-navbar-mobile')} className="flex items-center justify-center gap-2 stagger-in bg-primary text-primary-foreground btn-premium px-5 py-3 rounded-md font-semibold font-bold text-sm tracking-wide mt-2" aria-label="Call Nick's Tire and Auto at 216-862-0005">
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
          <div className="flex items-center gap-4 stagger-in mb-4">
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
          <div className="mt-8 flex flex-col sm:flex-row gap-4 stagger-in">
            <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('service-hero-cta')} className="inline-flex items-center justify-center gap-2 stagger-in bg-primary text-primary-foreground btn-premium px-8 py-4 rounded-md font-semibold font-bold text-lg tracking-wide hover:opacity-90 transition-colors" aria-label="Call Nick's Tire and Auto at 216-862-0005">
              <Phone className="w-5 h-5" />
              {service.heroCTA || "CALL NOW"}
            </a>
            <a href="#booking" className="inline-flex items-center justify-center gap-2 stagger-in border-2 border-nick-blue/50 text-nick-blue-light px-8 py-4 rounded-md font-semibold font-bold text-lg tracking-wide hover:bg-nick-blue/10 hover:border-nick-blue transition-colors">
              BOOK ONLINE
              <ChevronRight className="w-5 h-5" />
            </a>
          </div>
        </FadeIn>

        {/* Turnaround + Pricing badges */}
        <FadeIn delay={0.4}>
          <div className="mt-8 flex flex-wrap gap-4 stagger-in text-sm">
            {service.turnaround && (
              <div className="flex items-center gap-2 stagger-in bg-nick-blue/10 border border-nick-blue/20 rounded-md px-4 py-2">
                <Clock className="w-4 h-4 text-nick-blue-light shrink-0" />
                <span className="text-foreground/80 text-[12px]">{service.turnaround}</span>
              </div>
            )}
            {service.pricingNote && (
              <div className="flex items-center gap-2 stagger-in bg-primary/10 border border-primary/20 rounded-md px-4 py-2">
                <Star className="w-4 h-4 text-primary shrink-0" />
                <span className="text-foreground/80 text-[12px]">{service.pricingNote}</span>
              </div>
            )}
          </div>
        </FadeIn>

        {/* Urgency alert — only shown for safety-critical services */}
        {service.urgencyNote && (
          <FadeIn delay={0.5}>
            <div className="mt-6 flex items-start gap-3 stagger-in bg-red-950/40 border border-red-800/40 rounded-md px-5 py-4 max-w-2xl">
              <span className="text-red-400 text-lg shrink-0 mt-0.5">⚠</span>
              <p className="text-red-300/90 text-sm leading-relaxed">{service.urgencyNote}</p>
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 stagger-in lg:gap-20">
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
                {service.slug === "ac-repair" && "These are the AC and heating problems Cleveland drivers bring to us most often. Knowing the symptoms helps you get the right repair — not just a refrigerant top-off that won't fix the real issue."}
                {service.slug === "transmission" && "Transmission problems are some of the most expensive repairs if ignored. These are the warning signs Cleveland drivers ask us about most."}
                {service.slug === "electrical" && "Modern vehicles rely on complex electrical systems. These are the electrical problems Cleveland drivers bring to us most often."}
                {service.slug === "battery" && "A dead or weak battery is the #1 reason for roadside breakdowns. Here are the battery questions Cleveland drivers ask us most."}
                {service.slug === "exhaust" && "Exhaust leaks and muffler problems affect both your vehicle and your health. Here is what Cleveland drivers ask about exhaust repair."}
                {service.slug === "cooling" && "Overheating can destroy an engine in minutes. These are the cooling system questions Cleveland drivers bring to us most often."}
                {service.slug === "pre-purchase-inspection" && "Buying a used car is risky without a professional inspection. Here is what Cleveland buyers ask us before making a decision."}
                {service.slug === "belts-hoses" && "Worn belts and cracked hoses cause breakdowns without warning. These are the questions Cleveland drivers ask about preventive replacement."}
                {service.slug === "starter-alternator" && "If your car won't start or the battery keeps dying, the starter or alternator may be the cause. Here is what Cleveland drivers ask us most."}
              </p>
              <div className="mt-8 flex items-center gap-3 stagger-in text-foreground/50">
                <div className="flex gap-0 stagger-in.5">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-nick-yellow text-primary" />
                  ))}
                </div>
                <span className="text-[12px]">4.9 stars from {BUSINESS.reviews.countDisplay} reviews</span>
              </div>
            </div>
          </FadeIn>

          <div className="flex flex-col gap-0 stagger-in">
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

            <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3 stagger-in">
              {service.signs.map((sign, i) => (
                <FadeIn key={i} delay={i * 0.05}>
                  <div className="flex items-start gap-3 stagger-in bg-card/60 border border-nick-blue/10 rounded-md p-4">
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
              <div className="mt-8 flex flex-col sm:flex-row gap-4 stagger-in">
                <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('service-signs-cta')} className="inline-flex items-center justify-center gap-2 stagger-in bg-primary text-primary-foreground btn-premium px-6 py-3 rounded-md font-semibold font-bold text-sm tracking-wide hover:opacity-90 transition-colors" aria-label="Call Nick's Tire and Auto at 216-862-0005">
                  <Phone className="w-4 h-4" />
                  CALL {BUSINESS.phone.display}
                </a>
                <a href="#booking" className="inline-flex items-center justify-center gap-2 stagger-in border-2 border-nick-blue/40 text-nick-blue-light px-6 py-3 rounded-md font-semibold font-bold text-sm tracking-wide hover:bg-nick-blue/10 transition-colors">
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

        <div className="mt-14 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 stagger-in">
          {service.process.map((step, i) => (
            <FadeIn key={i} delay={i * 0.08}>
              <div className="relative bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-6 lg:p-8 h-full">
                <div className="flex items-center gap-3 stagger-in mb-4">
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 stagger-in lg:gap-20 items-center">
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
                {service.slug === "ac-repair" && "We diagnose before we repair. Too many shops just dump refrigerant in and send you on your way — then it blows warm again in two weeks because the leak was never fixed. We find the actual problem, explain it, and give you a written estimate before we touch anything."}
                {service.slug === "transmission" && "Transmission work requires precision and experience. We diagnose shifting problems, fluid leaks, and slipping with proper scan tools and road testing — not guesswork. You get an honest assessment and fair price."}
                {service.slug === "electrical" && "Electrical problems stump a lot of shops. We use wiring diagrams, multimeters, and systematic testing to find the actual fault — not just replace parts until the light goes off."}
                {service.slug === "battery" && "We test your battery and charging system for free before recommending anything. If you need a replacement, we install quality batteries at fair prices with a warranty."}
                {service.slug === "exhaust" && "We inspect your entire exhaust system from manifold to tailpipe. Whether it is a leak repair, muffler replacement, or catalytic converter issue, you get a written estimate before we start."}
                {service.slug === "cooling" && "Overheating damage is preventable with proper cooling system service. We pressure test for leaks, check your thermostat and water pump, and flush the system with the correct coolant for your vehicle."}
                {service.slug === "pre-purchase-inspection" && "Buying a used car without an inspection is a gamble. Our detailed inspection covers the engine, transmission, brakes, suspension, electrical, and body — so you know exactly what you are getting before you sign."}
                {service.slug === "belts-hoses" && "Belts and hoses deteriorate from the inside out — they can look fine but be ready to fail. We inspect them during every service visit and recommend replacement before they leave you stranded."}
                {service.slug === "starter-alternator" && "When your car won't start, we test the battery, starter, and alternator to find the actual cause. No parts-swapping guesswork — just accurate diagnosis and fair repair prices."}
              </p>
            </div>
          </FadeIn>

          <FadeIn delay={0.15}>
            <div className="space-y-4">
              {service.whyUs.map((item, i) => (
                <div key={i} className="flex items-start gap-4 stagger-in p-4 bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl">
                  <div className="w-8 h-8 bg-primary/10 flex items-center justify-center rounded-md shrink-0 mt-0.5">
                    <span className="font-semibold font-bold text-primary text-sm">{String(i + 1).padStart(2, "0")}</span>
                  </div>
                  <p className="text-foreground/80 leading-relaxed">{item}</p>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>

        {/* Proof cluster — customers confirm what we just claimed */}
        {(() => {
          const proof = getProofConfig(service.slug);
          if (!proof) return null;
          return (
            <FadeIn delay={0.2}>
              <div className="mt-16">
                <ServiceProofBlock
                  quotes={proof.featuredQuotes}
                  heading="What Cleveland drivers say"
                />
              </div>
            </FadeIn>
          );
        })()}
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

        <div className="mt-12 grid grid-cols-1 lg:grid-cols-2 gap-6 stagger-in">
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

// ─── PILLAR INTRO (extended guide intro + seasonal CTA) ──
function PillarIntro({ service }: { service: ServiceData }) {
  if (!service.pillarIntro) return null;

  return (
    <section className="bg-[oklch(0.055_0.004_260)] py-20 lg:py-28">
      <div className="container">
        <div className="max-w-4xl mx-auto">
          <FadeIn>
            <span className="font-mono text-nick-blue-light text-sm tracking-wide">Complete Guide</span>
            <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight leading-[1.05]">
              HOW YOUR CAR'S <span className="text-primary">AC SYSTEM</span> WORKS
            </h2>
            <p className="mt-8 text-foreground/70 leading-relaxed text-lg">
              {service.pillarIntro}
            </p>
          </FadeIn>

          {service.seasonalCTA && (
            <FadeIn delay={0.15}>
              <div className="mt-10 bg-primary/10 border-l-4 border-primary rounded-r-lg p-6 lg:p-8">
                <div className="flex items-start gap-4 stagger-in">
                  <ThermometerSun className="w-6 h-6 text-primary shrink-0 mt-1" />
                  <div>
                    <h3 className="font-semibold font-bold text-lg text-primary tracking-wide mb-2">
                      SEASONAL REMINDER
                    </h3>
                    <p className="text-foreground/80 leading-relaxed">
                      {service.seasonalCTA}
                    </p>
                    <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('pillar-seasonal-cta')} className="inline-flex items-center gap-2 stagger-in bg-primary text-primary-foreground btn-premium px-6 py-3 rounded-md font-semibold font-bold text-sm tracking-wide hover:opacity-90 transition-colors mt-4" aria-label="Call Nick's Tire and Auto">
                      <Phone className="w-4 h-4" />
                      SCHEDULE SPRING AC CHECK
                    </a>
                  </div>
                </div>
              </div>
            </FadeIn>
          )}
        </div>
      </div>
    </section>
  );
}

// ─── COST BREAKDOWN ──────────────────────────────────────
function CostBreakdown({ service }: { service: ServiceData }) {
  if (!service.costBreakdown || service.costBreakdown.length === 0) return null;

  return (
    <section id="costs" className="bg-[oklch(0.065_0.004_260)] py-20 lg:py-28">
      <div className="container">
        <FadeIn>
          <span className="font-mono text-primary text-sm tracking-wide">Pricing Transparency</span>
          <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight">
            AC REPAIR COSTS IN <span className="text-primary">CLEVELAND</span>
          </h2>
          <p className="mt-4 text-foreground/60 text-lg max-w-2xl">
            Real pricing from our shop. No hidden fees. Written estimate before any work begins.
          </p>
        </FadeIn>

        <div className="mt-12 space-y-4">
          {service.costBreakdown.map((item, i) => (
            <FadeIn key={i} delay={i * 0.08}>
              <div className="bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-6 lg:p-8">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 stagger-in mb-3">
                  <h3 className="font-semibold font-bold text-lg lg:text-xl text-foreground tracking-wide">
                    {item.service}
                  </h3>
                  <span className="font-semibold font-bold text-xl lg:text-2xl text-primary whitespace-nowrap">
                    {item.range}
                  </span>
                </div>
                <p className="text-foreground/60 leading-relaxed text-sm lg:text-base">
                  {item.description}
                </p>
              </div>
            </FadeIn>
          ))}
        </div>

        <FadeIn delay={0.4}>
          <p className="mt-8 text-foreground/50 text-sm italic">
            Prices reflect typical ranges for the Cleveland area as of 2024-2025. Your actual cost depends on your specific vehicle and the components that need replacement. We always provide a written estimate before starting work.
          </p>
        </FadeIn>

        {/* What affects the price — education removes fear */}
        {PRICE_FACTORS[service.slug] && (
          <FadeIn delay={0.45}>
            <div className="mt-10">
              <WhatAffectsPrice
                service={service.title.toLowerCase()}
                factors={PRICE_FACTORS[service.slug]}
                reassurance="All of these variables are visible in your written estimate before any work begins. No surprises."
              />
            </div>
          </FadeIn>
        )}

        {/* Price objection proof — placed exactly where sticker shock lives */}
        {(() => {
          const proof = getProofConfig(service.slug);
          const priceQuotes = proof?.objectionQuotes?.price;
          if (!priceQuotes?.length) return null;
          return (
            <FadeIn delay={0.5}>
              <ObjectionProofBlock
                objectionLabel="What customers say about our pricing"
                quotes={priceQuotes}
                statLine={proof?.statLine}
              />
            </FadeIn>
          );
        })()}

        {/* Estimate trust — locks in confidence right before the booking form */}
        <FadeIn delay={0.55}>
          <div className="mt-10">
            <EstimateTrustBlock service={service.title.toLowerCase()} />
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

// ─── COMPREHENSIVE FAQ ───────────────────────────────────
function PillarFAQ({ service }: { service: ServiceData }) {
  if (!service.faq || service.faq.length === 0) return null;

  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <section id="faq" className="bg-[oklch(0.055_0.004_260)] py-20 lg:py-28">
      <div className="container">
        <FadeIn>
          <span className="font-mono text-nick-blue-light text-sm tracking-wide">FAQ</span>
          <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight">
            FREQUENTLY ASKED <span className="text-primary">QUESTIONS</span>
          </h2>
          <p className="mt-4 text-foreground/60 text-lg max-w-2xl">
            In-depth answers to the questions Cleveland drivers ask us about AC repair.
          </p>
        </FadeIn>

        <div className="mt-12 max-w-3xl">
          {service.faq.map((item, i) => (
            <FadeIn key={i} delay={i * 0.05}>
              <button
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="w-full text-left border-b border-nick-blue/15 py-6 group"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold font-bold text-base lg:text-lg text-foreground tracking-wider group-hover:text-primary transition-colors pr-4">
                    {item.question}
                  </h3>
                  <ChevronDown className={`w-5 h-5 text-nick-blue-light transition-transform duration-200 shrink-0 ${openFaq === i ? "rotate-180" : ""}`} />
                </div>
                <AnimatePresence>
                  {openFaq === i && (
                    <motion.p
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-4 text-foreground/70 leading-relaxed text-base overflow-hidden"
                    >
                      {item.answer}
                    </motion.p>
                  )}
                </AnimatePresence>
              </button>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── RELATED LINKS ───────────────────────────────────────
function RelatedLinks({ service }: { service: ServiceData }) {
  if (!service.relatedLinks || service.relatedLinks.length === 0) return null;

  return (
    <section className="bg-[oklch(0.065_0.004_260)] py-16 lg:py-20">
      <div className="container">
        <FadeIn>
          <span className="font-mono text-primary text-sm tracking-wide">Related Pages</span>
          <h2 className="font-semibold font-bold text-2xl lg:text-4xl text-foreground mt-3 tracking-tight">
            LEARN MORE ABOUT <span className="text-primary">{service.title}</span>
          </h2>
        </FadeIn>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6 stagger-in">
          {service.relatedLinks.map((link, i) => (
            <FadeIn key={i} delay={i * 0.1}>
              <Link
                href={link.href}
                className="block bg-[oklch(0.08_0.004_260/0.8)] border border-[oklch(0.17_0.004_260)] rounded-2xl p-6 lg:p-8 group hover:border-primary/40 transition-colors"
              >
                <h3 className="font-semibold font-bold text-lg text-foreground tracking-wide group-hover:text-primary transition-colors flex items-center gap-2 stagger-in">
                  {link.label}
                  <ChevronRight className="w-5 h-5 text-nick-blue-light group-hover:text-primary transition-colors" />
                </h3>
                <p className="mt-3 text-foreground/60 leading-relaxed text-sm">
                  {link.description}
                </p>
              </Link>
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 stagger-in lg:gap-20">
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
                <div className="flex items-start gap-3 stagger-in">
                  <MapPin className="w-5 h-5 text-nick-blue-light mt-1 shrink-0" />
                  <div>
                    <p className="font-mono text-foreground/80">{BUSINESS.address.street}</p>
                    <p className="font-mono text-foreground/80">Cleveland, OH 44112</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 stagger-in">
                  <Clock className="w-5 h-5 text-nick-blue-light mt-1 shrink-0" />
                  <div className="font-mono text-foreground/80 space-y-1">
                    <p>Monday – Saturday: 8:00 AM – 6:00 PM</p>
                    <p>Sunday: 9:00 AM – 4:00 PM</p>
                  </div>
                </div>
                <a href={BUSINESS.phone.href} className="flex items-center gap-3 stagger-in group">
                  <Phone className="w-5 h-5 text-primary shrink-0" />
                  <span className="font-mono text-2xl text-foreground group-hover:text-primary transition-colors">{BUSINESS.phone.display}</span>
                </a>
              </div>
            </div>
          </FadeIn>

          <FadeIn delay={0.15}>
            <ApprovalPromiseBlock variant="compact" />
            <div className="mt-4">
              <BookingForm defaultService={service.title === "EMISSIONS & E-CHECK" ? "Ohio E-Check / Emissions Repair" : service.title === "DIAGNOSTICS" ? "Check Engine Light / Diagnostics" : service.title === "OIL CHANGE" ? "Oil Change" : service.title === "GENERAL REPAIR" ? "General Repair / Other" : service.title === "TIRES" ? "Tires — New, Used, Repair" : service.title === "AC & HEATING" ? "AC / Heating Repair" : "Brake Repair"} />
            </div>
            <FinancingCTA variant="banner" className="mt-6" />
            <div className="mt-6">
              <WhatToExpectAtYourVisit />
            </div>
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

        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 stagger-in">
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


// ─── GLOBAL FAQ Q&As (previously in index.html, merged here to prevent duplicates) ─
const GLOBAL_FAQ_ITEMS = [
  {
    "@type": "Question" as const,
    name: "Can I buy tires online from Nick's Tire & Auto?",
    acceptedAnswer: {
      "@type": "Answer" as const,
      text: "Yes. Visit nickstire.org/tires to search by tire size, compare options from major brands, and place your order online. Every tire purchase includes our free Premium Installation Package ($289+ value) with mounting, balancing, valve stems, TPMS reset, alignment check, and a 20-point safety inspection.",
    },
  },
  {
    "@type": "Question" as const,
    name: "How much does flat tire repair cost at Nick's Tire & Auto?",
    acceptedAnswer: {
      "@type": "Answer" as const,
      text: "Flat tire repair at Nick's Tire & Auto costs $15 to $25. Most repairs are done in about 15 minutes using professional plug and patch methods. We will never sell you a new tire if your current tire can be safely repaired.",
    },
  },
  {
    "@type": "Question" as const,
    name: "Do you sell used tires?",
    acceptedAnswer: {
      "@type": "Answer" as const,
      text: "Yes. We carry a large selection of quality used tires. Every used tire is inspected for tread depth, sidewall condition, and safety before it goes on your vehicle. Used tires include the same professional installation service. Walk-ins welcome — inventory changes daily.",
    },
  },
  {
    "@type": "Question" as const,
    name: "What is included in the free installation package?",
    acceptedAnswer: {
      "@type": "Answer" as const,
      text: "Nick's Premium Installation Package includes 15 services at no extra charge: professional mounting, computer balancing, new rubber valve stems, TPMS sensor reset, alignment check, 20-point safety inspection, rim cleaning and degreasing, tire disposal and recycling, lug nut torque to spec, tire pressure optimization, brake visual inspection, suspension visual check, tread depth documentation, free flat repair for the first 12 months, and free tire rotation for the first year.",
    },
  },
  {
    "@type": "Question" as const,
    name: "What areas does Nick's Tire & Auto serve?",
    acceptedAnswer: {
      "@type": "Answer" as const,
      text: "Nick's Tire & Auto is located at 17625 Euclid Ave, Cleveland, OH 44112. We serve Cleveland, Euclid, Lakewood, Parma, East Cleveland, Shaker Heights, Cleveland Heights, South Euclid, Garfield Heights, Mentor, Strongsville, and all of Northeast Ohio.",
    },
  },
];

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
    "ac-repair": "Auto AC & Heating Repair Service",
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
    ...(service.faq || []).map((fq) => ({
      "@type": "Question" as const,
      name: fq.question,
      acceptedAnswer: {
        "@type": "Answer" as const,
        text: fq.answer,
      },
    })),
    ...GLOBAL_FAQ_ITEMS,
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
  // Fallback: extract slug from pathname if useRoute doesn't match (e.g., during prerendering)
  const slug = params?.slug || (typeof window !== "undefined" ? window.location.pathname.replace(/^\//, "").split("/")[0] : "");
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
          <Link href="/" className="inline-flex items-center gap-2 stagger-in bg-primary text-primary-foreground btn-premium px-8 py-4 rounded-md font-semibold font-bold text-sm tracking-wide">
            <ArrowLeft className="w-4 h-4" />
            BACK TO HOME
          </Link>
        </div>
      </div>
    );
  }

  return (
    <PageLayout showChat={true}>
      {service && (
        <SEOHead
          title={service.metaTitle}
          description={service.metaDescription}
          canonicalPath={`/${service.slug}`}
        />
      )}
      <ServiceSchema service={service} />
      
      
        <ServiceHero service={service} />
        {/* Proof cluster strip — anchors trust immediately after hero */}
        {(() => {
          const proof = getProofConfig(service.slug);
          if (!proof) return null;
          return (
            <ProofClusterStrip
              trustTags={proof.trustTags}
              spotlight={proof.featuredQuotes[0]}
              showRating
            />
          );
        })()}
        <PillarIntro service={service} />
        <Problems service={service} />
        <WarningSigns service={service} />
        <CostBreakdown service={service} />
        <Process service={service} />
        <WhyUs service={service} />
        <QuickAnswers service={service} />
        <PillarFAQ service={service} />
        <RelatedLinks service={service} />
        <BookingSection service={service} />
        <OtherServices currentSlug={service.slug} />
        <RelatedServices current={service.slug} />


      <InternalLinks title="More From Nick's Tire & Auto" />
    </PageLayout>
  );
}
