/**
 * SeasonalPage — Seasonal car care landing pages for time-sensitive local SEO
 * Targets queries like "winter tires Cleveland" and "summer AC repair Cleveland"
 */

import PageLayout from "@/components/PageLayout";
import { useEffect, useRef, useState } from "react";
import { useRoute, Link } from "wouter";
import { SEASONAL_PAGES } from "@shared/seasonal";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import BookingForm from "@/components/BookingForm";
import { Phone, ChevronRight, ArrowLeft, Snowflake, Sun, CheckCircle, AlertTriangle, Wrench, Menu, X } from "lucide-react";
import { motion, useInView } from "framer-motion";
import { BUSINESS } from "@shared/business";
import InternalLinks from "@/components/InternalLinks";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";

const HERO_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-main-DE7GKwfCThaBL66r78QWkU.webp";

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

// ─── NAVBAR ───────────────────────────────────────────
function SeasonalNavbar({ season }: { season: string }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const SeasonIcon = season === "Winter" ? Snowflake : Sun;

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "bg-background/90 backdrop-blur-md shadow-lg" : "bg-transparent"}`} aria-label="Seasonal page navigation">
      <div className="container flex items-center justify-between h-16 lg:h-20">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary flex items-center justify-center rounded-sm">
            <span className="font-semibold font-bold text-primary-foreground text-lg">N</span>
          </div>
          <div className="flex flex-col">
            <span className="font-semibold font-bold text-primary text-lg leading-tight tracking-wide">NICK'S TIRE & AUTO</span>
            <span className="text-muted-foreground text-xs tracking-wide flex items-center gap-1">
              <SeasonIcon className="w-3 h-3" /> {season} Car Care
            </span>
          </div>
        </Link>

        <div className="hidden lg:flex items-center gap-6">
          <a href="#checklist" className="font-semibold text-sm tracking-wide text-foreground/80 hover:text-primary transition-colors">Checklist</a>
          <a href="#problems" className="font-semibold text-sm tracking-wide text-foreground/80 hover:text-primary transition-colors">Common Problems</a>
          <a href="#booking" className="font-semibold text-sm tracking-wide text-foreground/80 hover:text-primary transition-colors">Book Now</a>
          <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('seasonal-navbar-desktop')} className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-md font-semibold font-bold text-sm tracking-wide hover:opacity-90 transition-colors" aria-label="Call Nick's Tire and Auto at 216-862-0005">
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
            <a href="#checklist" onClick={() => setMobileOpen(false)} className="font-semibold text-lg tracking-wide text-foreground/80 hover:text-primary transition-colors py-2">Checklist</a>
            <a href="#problems" onClick={() => setMobileOpen(false)} className="font-semibold text-lg tracking-wide text-foreground/80 hover:text-primary transition-colors py-2">Common Problems</a>
            <a href="#booking" onClick={() => setMobileOpen(false)} className="font-semibold text-lg tracking-wide text-foreground/80 hover:text-primary transition-colors py-2">Book Now</a>
            <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('seasonal-navbar-mobile')} className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-5 py-3 rounded-md font-semibold font-bold text-sm tracking-wide mt-2" aria-label="Call Nick's Tire and Auto at 216-862-0005">
              <Phone className="w-4 h-4" />
              {BUSINESS.phone.display}
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────
export default function SeasonalPage() {
  const [, params] = useRoute("/:slug");
  const slug = params?.slug || "";
  const page = SEASONAL_PAGES.find((s) => s.slug === slug);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [slug]);

  if (!page) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="font-semibold font-bold text-4xl text-foreground mb-4">PAGE NOT FOUND</h1>
          <Link href="/" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-md font-semibold font-bold text-sm tracking-wide">
            <ArrowLeft className="w-4 h-4" />
            BACK TO HOME
          </Link>
        </div>
      </div>
    );
  }

  const SeasonIcon = page.season === "Winter" ? Snowflake : Sun;

  return (
    <PageLayout>
      <SEOHead
        title={page.metaTitle}
        description={page.metaDescription}
        canonicalPath={`/${page.slug}`}
      />
      
      
      <SeasonalNavbar season={page.season} />


        {/* Hero */}
        <section className="relative min-h-[55vh] lg:min-h-[65vh] flex items-end overflow-hidden">
          <div className="absolute inset-0">
            <img loading="lazy" src={HERO_IMG} alt={`${page.season} car care at Nick's Tire and Auto Cleveland`} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-background/30" />
          </div>

          <div className="relative container pb-16 pt-32 lg:pb-24">
            <FadeIn>
              <Breadcrumbs items={[{ label: `${page.season} Car Care` }]} />
      <LocalBusinessSchema />
            </FadeIn>

            <FadeIn delay={0.1}>
              <div className="flex items-center gap-2 mt-4 mb-4">
                <SeasonIcon className="w-5 h-5 text-primary" />
                <span className="font-mono text-primary text-sm tracking-wide">SEASONAL SERVICE</span>
              </div>
              <h1 className="font-semibold font-bold text-4xl sm:text-5xl lg:text-7xl text-foreground leading-[0.9] tracking-tight max-w-3xl whitespace-pre-line">
                {page.heroHeadline}
              </h1>
            </FadeIn>

            <FadeIn delay={0.2}>
              <p className="mt-6 text-lg sm:text-xl text-foreground/70 max-w-2xl leading-relaxed">
                {page.heroSubline}
              </p>
            </FadeIn>

            <FadeIn delay={0.3}>
              <div className="mt-8 flex flex-col sm:flex-row gap-4">
                <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('seasonal-hero-cta')} className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-md font-semibold font-bold text-lg tracking-wide hover:opacity-90 transition-colors" aria-label="Call Nick's Tire and Auto at 216-862-0005">
                  <Phone className="w-5 h-5" />
                  SCHEDULE {page.season.toUpperCase()} SERVICE
                </a>
                <a href="#checklist" className="inline-flex items-center justify-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 rounded-md font-semibold font-bold text-lg tracking-wide hover:border-primary hover:text-primary transition-colors">
                  VIEW CHECKLIST
                  <ChevronRight className="w-5 h-5" />
                </a>
              </div>
            </FadeIn>
          </div>
        </section>

        {/* Intro */}
        <section className="py-16 lg:py-20 bg-[oklch(0.065_0.004_260)]">
          <div className="container max-w-3xl">
            <FadeIn>
              <p className="text-foreground/70 text-lg leading-relaxed">
                {page.intro}
              </p>
            </FadeIn>
          </div>
        </section>

        {/* Checklist */}
        <section id="checklist" className="py-16 lg:py-24 bg-[oklch(0.055_0.004_260)]">
          <div className="container">
            <FadeIn>
              <span className="font-mono text-nick-blue-light text-sm tracking-wide">{page.season} Preparation</span>
              <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight">
                {page.season.toUpperCase()} VEHICLE CHECKLIST
              </h2>
            </FadeIn>

            <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6">
              {page.checklist.map((item, i) => (
                <FadeIn key={i} delay={i * 0.06}>
                  <div className="bg-card/30 border border-border/50 rounded-lg p-6 h-full">
                    <div className="flex items-start gap-3 mb-3">
                      <CheckCircle className="w-5 h-5 text-nick-blue-light flex-shrink-0 mt-0.5" />
                      <h3 className="font-semibold font-bold text-foreground tracking-wider text-sm uppercase">{item.title}</h3>
                    </div>
                    <p className="text-foreground/60 text-sm leading-relaxed pl-8">{item.description}</p>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </section>

        {/* Common Problems */}
        <section id="problems" className="py-16 lg:py-24 bg-[oklch(0.065_0.004_260)]">
          <div className="container">
            <FadeIn>
              <span className="font-mono text-nick-blue-light text-sm tracking-wide">Diagnostics</span>
              <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight">
                COMMON {page.season.toUpperCase()} PROBLEMS
              </h2>
            </FadeIn>

            <div className="mt-10 flex flex-col gap-8">
              {page.commonProblems.map((cp, i) => (
                <FadeIn key={i} delay={i * 0.08}>
                  <div className="bg-card/30 border border-border/50 rounded-lg overflow-hidden">
                    <div className="p-6 lg:p-8">
                      <div className="flex items-start gap-3 mb-4">
                        <AlertTriangle className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                        <h3 className="font-semibold font-bold text-xl text-foreground tracking-wider">{cp.problem}</h3>
                      </div>
                      <div className="pl-8 space-y-4">
                        <div>
                          <span className="font-semibold text-xs tracking-wide text-foreground/40">WHY IT HAPPENS</span>
                          <p className="text-foreground/70 leading-relaxed mt-1">{cp.explanation}</p>
                        </div>
                        <div>
                          <span className="font-semibold text-xs tracking-wide text-nick-blue-light flex items-center gap-1">
                            <Wrench className="w-3 h-3" /> HOW WE FIX IT
                          </span>
                          <p className="text-foreground/70 leading-relaxed mt-1">{cp.solution}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </section>

        {/* Booking */}
        <section id="booking" className="py-16 lg:py-24 bg-[oklch(0.055_0.004_260)]">
          <div className="container max-w-3xl">
            <FadeIn>
              <div className="text-center mb-10">
                <span className="font-mono text-nick-blue-light text-sm tracking-wide">Schedule Service</span>
                <h2 className="font-semibold font-bold text-3xl lg:text-4xl text-foreground mt-3 tracking-tight">
                  BOOK YOUR {page.season.toUpperCase()} SERVICE
                </h2>
                <p className="mt-4 text-foreground/60 max-w-lg mx-auto">
                  {page.ctaText}
                </p>
              </div>
            </FadeIn>
            <FadeIn delay={0.1}>
              <BookingForm />
            </FadeIn>
          </div>
        </section>

        {/* Other seasonal pages */}
        <section className="py-12 lg:py-16 bg-[oklch(0.065_0.004_260)] border-t border-border/50">
          <div className="container">
            <h3 className="font-semibold font-bold text-lg text-foreground/60 tracking-[-0.01em] mb-6">MORE SEASONAL GUIDES</h3>
            <div className="flex flex-wrap gap-3">
              {SEASONAL_PAGES.filter(s => s.slug !== page.slug).map((s) => (
                <Link key={s.slug} href={`/${s.slug}`} className="px-4 py-2 bg-card/50 border border-border/50 rounded-md text-sm text-foreground/70 hover:text-primary hover:border-primary/30 transition-colors flex items-center gap-2">
                  {s.season === "Winter" ? <Snowflake className="w-3 h-3" /> : <Sun className="w-3 h-3" />}
                  {s.season} Car Care
                </Link>
              ))}
              <Link href="/blog" className="px-4 py-2 bg-card/50 border border-border/50 rounded-md text-sm text-foreground/70 hover:text-primary hover:border-primary/30 transition-colors">
                More Tips on Our Blog
              </Link>
            </div>
          </div>
        </section>


      {/* Footer */}
      

      {/* Mobile Sticky CTA */}
      <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-background/90 backdrop-blur-md border-t border-primary/30 p-3 flex gap-2">
        <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('seasonal-mobile-sticky')} className="flex items-center justify-center gap-2 bg-primary text-primary-foreground flex-1 py-3.5 rounded-md font-semibold font-bold text-sm tracking-wide" aria-label="Call Nick's Tire and Auto at 216-862-0005">
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
