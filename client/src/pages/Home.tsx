/*
 * DESIGN: Tesla-Inspired — Dark, Minimal, Full-Bleed, One-Message-Per-Viewport
 * Near-black background, Inter font, yellow + blue accents
 * Photography-driven, maximum whitespace, single-decision-per-fold
 */

import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import BookingForm from "@/components/BookingForm";
import LeadPopup from "@/components/LeadPopup";
import ChatWidget from "@/components/ChatWidget";
import NotificationBar from "@/components/NotificationBar";
import ComparisonTable from "@/components/ComparisonTable";
import InternalLinks from "@/components/InternalLinks";
import { SEOHead, SkipToContent, trackPhoneClick } from "@/components/SEO";
import { Phone, MapPin, Clock, Star, ChevronDown, Menu, X, ArrowRight } from "lucide-react";
import { motion, useInView } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { BUSINESS } from "@shared/business";
import { GBP_REVIEW_URL } from "@shared/const";

const HERO_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-main-DE7GKwfCThaBL66r78QWkU.webp";

const MECHANIC_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/mechanic-night_af6b9eca.jpg";
const TIRES_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-tires-AWxeiFZmv6FQocUMfiJvWb.webp";
const DIAG_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-diagnostics-AN7H3iz5Tow2ab2METgner.webp";
const BRAKES_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-brakes-nKAKuxmW2WAmNrbCFRD9zL.webp";

function FadeIn({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 20 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      transition={{ duration: 0.6, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ─── NAVIGATION — Tesla-style minimal ────────────────────
function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const links = [
    { label: "Services", href: "#services" },
    { label: "Reviews", href: "/reviews" },
    { label: "Specials", href: "/specials" },
    { label: "About", href: "/about" },
    { label: "Contact", href: "/contact" },
  ];

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "bg-background/90 backdrop-blur-xl" : "bg-transparent"}`}>
      <div className="container flex items-center justify-between h-16">
        {/* Logo — minimal wordmark */}
        <a href="#" className="flex items-center gap-2.5">
          <span className="text-primary font-semibold text-lg tracking-tight">Nick's Tire & Auto</span>
        </a>

        {/* Desktop nav — centered, small text */}
        <div className="hidden lg:flex items-center gap-8">
          {links.map((l) =>
            l.href.startsWith("/") ? (
              <Link key={l.href} href={l.href} className="text-sm font-medium text-foreground/70 hover:text-foreground transition-colors tracking-wide">
                {l.label}
              </Link>
            ) : (
              <a key={l.href} href={l.href} className="text-sm font-medium text-foreground/70 hover:text-foreground transition-colors tracking-wide">
                {l.label}
              </a>
            )
          )}
        </div>

        {/* CTA — right side */}
        <div className="hidden lg:flex items-center gap-4">
          <Link href="/diagnose" className="text-sm font-medium text-primary hover:text-primary transition-colors">
            Diagnose My Car
          </Link>
          <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('navbar')} className="text-sm font-medium bg-foreground text-background px-5 py-2 rounded-full hover:bg-foreground/90 transition-colors" aria-label="Call Nick's Tire and Auto">
            {BUSINESS.phone.display}
          </a>
        </div>

        {/* Mobile hamburger */}
        <button onClick={() => setMobileOpen(!mobileOpen)} className="lg:hidden text-foreground p-2" aria-label={mobileOpen ? "Close menu" : "Open menu"} aria-expanded={mobileOpen}>
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile menu — full screen overlay */}
      {mobileOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="lg:hidden fixed inset-0 top-16 bg-background/98 backdrop-blur-xl z-40"
        >
          <div className="container py-12 flex flex-col gap-6">
            {links.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setMobileOpen(false)} className="text-2xl font-semibold text-foreground/80 hover:text-foreground transition-colors tracking-tight">
                {l.label}
              </a>
            ))}
            <Link href="/diagnose" onClick={() => setMobileOpen(false)} className="text-2xl font-semibold text-primary tracking-tight">
              Diagnose My Car
            </Link>
            <div className="pt-6 border-t border-border">
              <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('navbar-mobile')} className="inline-flex items-center gap-2 text-lg text-foreground/60" aria-label="Call Nick's Tire and Auto">
                <Phone className="w-4 h-4" />
                {BUSINESS.phone.display}
              </a>
            </div>
          </div>
        </motion.div>
      )}
    </nav>
  );
}

// ─── HERO — Full-viewport cinematic ──────────────────────
function Hero() {
  const { data: googleData } = trpc.reviews.google.useQuery(undefined, {
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
  const rating = googleData?.rating ?? 4.9;
  const totalReviews = googleData?.totalReviews ?? 1683;

  return (
    <section className="relative min-h-[100svh] flex flex-col justify-end overflow-hidden">
      {/* Full-bleed background */}
      <div className="absolute inset-0">
        <img src={HERO_IMG} alt="Nick's Tire and Auto repair shop in Cleveland Ohio" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
      </div>

      {/* Content — bottom-aligned like Tesla */}
      <div className="relative container pb-20 pt-32">
        <FadeIn>
          <h1 className="text-5xl sm:text-6xl lg:text-[5.5rem] font-bold text-foreground leading-[0.95] tracking-tight max-w-3xl">
            Cleveland's Trusted
            <br />
            <span className="text-primary">Auto Repair</span>
          </h1>
        </FadeIn>

        <FadeIn delay={0.15}>
          <p className="mt-6 text-lg text-foreground/60 max-w-lg font-light leading-relaxed">
            Honest diagnostics. Fair prices. We show you the problem before we fix it.
          </p>
        </FadeIn>

        <FadeIn delay={0.25}>
          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('hero')} className="inline-flex items-center justify-center gap-2 bg-foreground text-background px-8 py-3.5 rounded-full font-medium text-base hover:bg-foreground/90 transition-colors" aria-label="Call for free estimate">
              Call for Free Estimate
            </a>
            <a href="#services" className="inline-flex items-center justify-center gap-2 border border-foreground/30 text-foreground px-8 py-3.5 rounded-full font-medium text-base hover:bg-foreground/5 transition-colors">
              View Services
            </a>
          </div>
        </FadeIn>

        {/* Trust strip — minimal */}
        <FadeIn delay={0.35}>
          <div className="mt-12 flex flex-wrap items-center gap-6 text-sm text-foreground/40">
            <div className="flex items-center gap-1.5">
              <div className="flex gap-0.5">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="w-3.5 h-3.5 fill-nick-yellow text-primary" />
                ))}
              </div>
              <span>{rating.toFixed(1)} · {totalReviews.toLocaleString()}+ reviews</span>
            </div>
            <span className="hidden sm:block w-px h-4 bg-foreground/15" />
            <span>Same-day service</span>
            <span className="hidden sm:block w-px h-4 bg-foreground/15" />
            <span>Walk-ins welcome</span>
          </div>
        </FadeIn>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ repeat: Infinity, duration: 2 }}
        >
          <ChevronDown className="w-5 h-5 text-foreground/30" />
        </motion.div>
      </div>
    </section>
  );
}

// ─── TRUST NUMBERS — Single horizontal strip ─────────────
function TrustNumbers() {
  const { data: googleData } = trpc.reviews.google.useQuery(undefined, {
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
  const totalReviews = googleData?.totalReviews ?? 1683;

  const stats = [
    { value: "4.9", label: "Google Rating" },
    { value: `${totalReviews.toLocaleString()}+`, label: "Reviews" },
    { value: "7", label: "Days a Week" },
    { value: "Same Day", label: "Most Repairs" },
  ];

  return (
    <section className="section-elevated py-16 border-y border-border">
      <div className="container">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-0">
          {stats.map((s, i) => (
            <FadeIn key={s.label} delay={i * 0.1}>
              <div className={`text-center ${i > 0 ? "lg:border-l lg:border-border" : ""}`}>
                <div className="text-3xl lg:text-4xl font-bold text-foreground tracking-tight">{s.value}</div>
                <div className="mt-1 text-sm text-foreground/40 font-medium">{s.label}</div>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── SERVICES — Full-viewport image tiles ────────────────
const services = [
  {
    title: "Tires",
    slug: "/tires",
    desc: "New and used tires. Mounting, balancing, rotation, TPMS sensors, and flat repair.",
    img: TIRES_IMG,
  },
  {
    title: "Brakes",
    slug: "/brakes",
    desc: "Pads, rotors, calipers, brake lines, and ABS diagnostics. We show you the problem first.",
    img: BRAKES_IMG,
  },
  {
    title: "Diagnostics",
    slug: "/diagnostics",
    desc: "Check engine light, OBD-II code reading, advanced computer diagnostics.",
    img: DIAG_IMG,
  },
];

const moreServices = [
  { title: "Emissions & E-Check", slug: "/emissions", desc: "Failed Ohio E-Check? We diagnose and repair emissions problems." },
  { title: "Oil Change", slug: "/oil-change", desc: "Conventional and synthetic oil changes. Quick, affordable, done right." },
  { title: "General Repair", slug: "/general-repair", desc: "Suspension, steering, exhaust, cooling systems, belts, hoses, and more." },
];

function Services() {
  return (
    <section id="services">
      {/* Featured services — large image tiles */}
      {services.map((s, _i) => (
        <div key={s.slug} className="relative min-h-[80vh] flex items-end overflow-hidden">
          <div className="absolute inset-0">
            <img src={s.img} alt={`${s.title} service at Nick's Tire and Auto`} className="w-full h-full object-cover" loading="lazy" />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
          </div>
          <div className="relative container pb-20">
            <FadeIn>
              <h2 className="text-4xl lg:text-6xl font-bold text-foreground tracking-tight">{s.title}</h2>
              <p className="mt-4 text-lg text-foreground/60 max-w-md font-light">{s.desc}</p>
              <div className="mt-6 flex gap-3">
                <Link href={s.slug} className="inline-flex items-center gap-2 bg-foreground text-background px-6 py-3 rounded-full font-medium text-sm hover:bg-foreground/90 transition-colors">
                  Learn More
                </Link>
                <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick(`service-${s.slug}`)} className="inline-flex items-center gap-2 border border-foreground/30 text-foreground px-6 py-3 rounded-full font-medium text-sm hover:bg-foreground/5 transition-colors">
                  Call Now
                </a>
              </div>
            </FadeIn>
          </div>
        </div>
      ))}

      {/* More services — compact grid */}
      <div className="bg-[oklch(0.065_0.004_260)] py-20">
        <div className="container">
          <FadeIn>
            <h2 className="text-3xl lg:text-4xl font-bold text-foreground tracking-tight text-center mb-12">More Services</h2>
          </FadeIn>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {moreServices.map((s, i) => (
              <FadeIn key={s.slug} delay={i * 0.1}>
                <Link href={s.slug} className="group block p-8 border border-border rounded-2xl hover:border-foreground/20 transition-all">
                  <h3 className="text-xl font-semibold text-foreground tracking-tight group-hover:text-primary transition-colors">{s.title}</h3>
                  <p className="mt-3 text-foreground/50 text-sm leading-relaxed">{s.desc}</p>
                  <span className="inline-flex items-center gap-1 mt-5 text-sm text-foreground/40 group-hover:text-primary transition-colors">
                    Learn more <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </Link>
              </FadeIn>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── WHY US — Split layout ───────────────────────────────
function WhyUs() {
  return (
    <section className="bg-[oklch(0.065_0.004_260)] py-24 lg:py-32">
      <div className="container">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <FadeIn>
            <div className="relative rounded-2xl overflow-hidden aspect-[4/3]">
              <img src={MECHANIC_IMG} alt="Mechanic working at Nick's Tire and Auto" className="w-full h-full object-cover" loading="lazy" />
            </div>
          </FadeIn>

          <FadeIn delay={0.15}>
            <div>
              <h2 className="text-4xl lg:text-5xl font-bold text-foreground tracking-tight leading-[1.1]">
                We show you the problem
                <br />
                <span className="text-primary">before we fix it.</span>
              </h2>
              <p className="mt-6 text-foreground/50 text-lg leading-relaxed">
                Most shops hand you a bill and hope you don't ask questions. We walk you through the diagnosis, show you the worn parts, explain your options, and let you decide.
              </p>

              <div className="mt-10 space-y-6">
                {[
                  { title: "Honest Diagnostics", text: "We read the codes, test the components, and show you exactly what failed." },
                  { title: "Upfront Pricing", text: "Written estimates before work begins. No hidden fees, no surprise charges." },
                  { title: "Warranty on Repairs", text: "We stand behind our work. If something isn't right, we make it right." },
                ].map((item, _i) => (
                  <div key={item.title} className="flex gap-4">
                    <div className="w-px bg-primary shrink-0 mt-1" style={{ minHeight: '2.5rem' }} />
                    <div>
                      <h4 className="font-semibold text-foreground text-sm tracking-wide">{item.title}</h4>
                      <p className="text-foreground/40 text-sm mt-1 leading-relaxed">{item.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}

// ─── REVIEWS — Minimal cards ─────────────────────────────
const FALLBACK_REVIEWS = [
  { name: "Nurse Summer", stars: 5, text: "I have been to many mechanics in Cleveland this is the FIRST shop that I felt I could trust! Especially as a woman.. it's very hard to find HONEST and well done mechanic work." },
  { name: "Amber Sartain", stars: 5, text: "I've been in the market for a shop/mechanic, that isn't going to break the bank and does good, honest work. And today I found them." },
  { name: "Tammy Hicks", stars: 5, text: "Jahnah was so helpful and kind! She made sure I got the best tires for my vehicle at a great price. The service was fast and professional." },
];

function Reviews() {
  const { data: googleData } = trpc.reviews.google.useQuery(undefined, {
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  const displayReviews = googleData?.reviews && googleData.reviews.length > 0
    ? googleData.reviews.slice(0, 3).map(r => ({ name: r.authorName, stars: r.rating, text: r.text }))
    : FALLBACK_REVIEWS;

  return (
    <section className="section-elevated py-24 lg:py-32">
      <div className="container">
        <FadeIn>
          <div className="text-center mb-16">
            <h2 className="text-4xl lg:text-5xl font-bold text-foreground tracking-tight">
              Real reviews from real drivers.
            </h2>
            <p className="mt-4 text-foreground/40 text-lg">We don't write our own reviews. These are from Google.</p>
          </div>
        </FadeIn>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {displayReviews.map((r, i) => (
            <FadeIn key={r.name + i} delay={i * 0.1}>
              <div className="p-8 border border-border rounded-2xl h-full flex flex-col">
                <div className="flex gap-0.5 mb-5">
                  {[...Array(r.stars)].map((_, j) => (
                    <Star key={j} className="w-4 h-4 fill-nick-yellow text-primary" />
                  ))}
                </div>
                <p className="text-foreground/70 leading-relaxed flex-1 text-[0.95rem]">"{r.text}"</p>
                <div className="mt-6 pt-5 border-t border-border">
                  <span className="font-semibold text-foreground text-sm">{r.name}</span>
                  <span className="block text-foreground/30 text-xs mt-0.5">Google Review</span>
                </div>
              </div>
            </FadeIn>
          ))}
        </div>

        <FadeIn delay={0.4}>
          <div className="mt-12 text-center">
            <Link href="/reviews" className="inline-flex items-center gap-2 text-sm font-medium text-foreground/50 hover:text-foreground transition-colors">
              See all reviews <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

// ─── CONTACT — Clean split ───────────────────────────────
function Contact() {
  return (
    <section id="contact" className="bg-[oklch(0.065_0.004_260)] py-24 lg:py-32">
      <div className="container">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
          <FadeIn>
            <div>
              <h2 className="text-4xl lg:text-5xl font-bold text-foreground tracking-tight">
                Come see us.
              </h2>
              <p className="mt-4 text-foreground/40 text-lg">Walk-ins welcome. No appointment needed for most services.</p>

              <div className="mt-10 space-y-8">
                <div>
                  <h3 className="text-xs font-semibold text-foreground/30 uppercase tracking-widest mb-3">Location</h3>
                  <div className="flex items-start gap-3">
                    <MapPin className="w-4 h-4 text-primary mt-1 shrink-0" />
                    <div className="text-foreground/70">
                      <p>{BUSINESS.address.street}</p>
                      <p>Cleveland, OH 44112</p>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-foreground/30 uppercase tracking-widest mb-3">Hours</h3>
                  <div className="flex items-start gap-3">
                    <Clock className="w-4 h-4 text-primary mt-1 shrink-0" />
                    <div className="text-foreground/70">
                      <p>Monday – Saturday: 8 AM – 6 PM</p>
                      <p>Sunday: 9 AM – 4 PM</p>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-foreground/30 uppercase tracking-widest mb-3">Phone</h3>
                  <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('contact')} className="flex items-center gap-3 group">
                    <Phone className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-2xl font-semibold text-foreground group-hover:text-primary transition-colors tracking-tight">{BUSINESS.phone.display}</span>
                  </a>
                </div>

                <a
                  href={BUSINESS.urls.googleMapsDirectionsNamed}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-foreground text-background px-6 py-3 rounded-full font-medium text-sm hover:bg-foreground/90 transition-colors"
                >
                  Get Directions
                </a>
              </div>
            </div>
          </FadeIn>

          <FadeIn delay={0.15}>
            <BookingForm />
          </FadeIn>
        </div>

        {/* Map */}
        <FadeIn delay={0.25}>
          <div className="mt-16 w-full aspect-[21/9] rounded-2xl overflow-hidden border border-border">
            <iframe
              src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2987.5!2d-81.5597624!3d41.5525118!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x8830ffda2d516449%3A0xcabdcc3204cd9c5!2sNick&#39;s%20Tire%20And%20Auto%20Euclid!5e0!3m2!1sen!2sus!4v1710000000000"
              width="100%"
              height="100%"
              style={{ border: 0 }}
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              title="Nick's Tire and Auto location"
            />
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

// ─── MOBILE CTA ──────────────────────────────────────────
function MobileCTA() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 600);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-background/95 backdrop-blur-xl border-t border-border p-3 flex gap-2">
      <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('mobile-sticky')} className="flex items-center justify-center gap-2 bg-foreground text-background flex-1 py-3 rounded-full font-medium text-sm" aria-label="Call now">
        <Phone className="w-4 h-4" />
        Call Now
      </a>
      <a href="#contact" className="flex items-center justify-center gap-2 border border-foreground/30 text-foreground flex-1 py-3 rounded-full font-medium text-sm" aria-label="Book online">
        Book Online
      </a>
    </div>
  );
}

// ─── FOOTER — Minimal ────────────────────────────────────
function Footer() {
  return (
    <footer className="bg-[oklch(0.055_0.004_260)] border-t border-border">
      <div className="container py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
          {/* Brand */}
          <div>
            <span className="text-primary font-semibold text-lg tracking-tight">Nick's Tire & Auto</span>
            <p className="mt-3 text-foreground/30 text-sm leading-relaxed">
              Honest auto repair for Cleveland, Euclid, and Northeast Ohio.
            </p>
            <div className="mt-4 flex gap-3">
              <a href="https://www.instagram.com/nicks_tire_euclid/" target="_blank" rel="noopener noreferrer" className="text-foreground/20 hover:text-foreground/50 transition-colors" aria-label="Instagram">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
              </a>
              <a href="https://www.facebook.com/nickstireeuclid/" target="_blank" rel="noopener noreferrer" className="text-foreground/20 hover:text-foreground/50 transition-colors" aria-label="Facebook">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
              </a>
              <a href={GBP_REVIEW_URL} target="_blank" rel="noopener noreferrer" className="text-foreground/20 hover:text-foreground/50 transition-colors" aria-label="Google Reviews">
                <Star className="w-5 h-5" />
              </a>
            </div>
          </div>

          {/* Services */}
          <div>
            <h4 className="text-xs font-semibold text-foreground/30 uppercase tracking-widest mb-4">Services</h4>
            <div className="space-y-2.5 text-sm text-foreground/40">
              <Link href="/tires" className="block hover:text-foreground transition-colors">Tires</Link>
              <Link href="/brakes" className="block hover:text-foreground transition-colors">Brakes</Link>
              <Link href="/diagnostics" className="block hover:text-foreground transition-colors">Diagnostics</Link>
              <Link href="/emissions" className="block hover:text-foreground transition-colors">Emissions</Link>
              <Link href="/oil-change" className="block hover:text-foreground transition-colors">Oil Change</Link>
              <Link href="/general-repair" className="block hover:text-foreground transition-colors">General Repair</Link>
            </div>
          </div>

          {/* Resources */}
          <div>
            <h4 className="text-xs font-semibold text-foreground/30 uppercase tracking-widest mb-4">Resources</h4>
            <div className="space-y-2.5 text-sm text-foreground/40">
              <Link href="/reviews" className="block hover:text-foreground transition-colors">Reviews</Link>
              <Link href="/specials" className="block hover:text-foreground transition-colors">Specials</Link>
              <Link href="/diagnose" className="block hover:text-foreground transition-colors">Diagnose My Car</Link>
              <Link href="/portal" className="block hover:text-foreground transition-colors">Customer Portal</Link>
              <Link href="/blog" className="block hover:text-foreground transition-colors">Blog</Link>
              <Link href="/faq" className="block hover:text-foreground transition-colors">FAQ</Link>
              <Link href="/car-care-guide" className="block hover:text-foreground transition-colors">Car Care Guide</Link>
            </div>
          </div>

          {/* Areas */}
          <div>
            <h4 className="text-xs font-semibold text-foreground/30 uppercase tracking-widest mb-4">Areas Served</h4>
            <div className="space-y-2.5 text-sm text-foreground/40">
              <span className="block">Cleveland, OH</span>
              <Link href="/euclid-auto-repair" className="block hover:text-foreground transition-colors">Euclid, OH</Link>
              <Link href="/east-cleveland-auto-repair" className="block hover:text-foreground transition-colors">East Cleveland, OH</Link>
              <Link href="/lakewood-auto-repair" className="block hover:text-foreground transition-colors">Lakewood, OH</Link>
              <Link href="/parma-auto-repair" className="block hover:text-foreground transition-colors">Parma, OH</Link>
            </div>
          </div>
        </div>

        <div className="mt-14 pt-8 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-foreground/20 text-xs">
            &copy; {new Date().getFullYear()} Nick's Tire & Auto. All rights reserved.
          </p>
          <a href={BUSINESS.phone.href} className="text-foreground/30 text-sm hover:text-foreground/50 transition-colors">
            {BUSINESS.phone.display}
          </a>
        </div>
      </div>
    </footer>
  );
}

// ─── LOCAL BUSINESS SCHEMA ───────────────────────────────
function LocalBusinessSchema() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "AutoRepair",
    "name": "Nick's Tire & Auto",
    "alternateName": "Nick's Tire And Auto Euclid",
    "image": HERO_IMG,
    "@id": "https://nickstire.org",
    "url": "https://nickstire.org",
    "telephone": "+1-" + BUSINESS.phone.dashed,
    "priceRange": "$$",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": BUSINESS.address.street,
      "addressLocality": "Cleveland",
      "addressRegion": "OH",
      "postalCode": "44112",
      "addressCountry": "US"
    },
    "geo": { "@type": "GeoCoordinates", "latitude": 41.5525118, "longitude": -81.5571875 },
    "openingHoursSpecification": [
      { "@type": "OpeningHoursSpecification", "dayOfWeek": ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"], "opens": "08:00", "closes": "18:00" },
      { "@type": "OpeningHoursSpecification", "dayOfWeek": "Sunday", "opens": "09:00", "closes": "16:00" }
    ],
    "aggregateRating": { "@type": "AggregateRating", "ratingValue": "4.9", "reviewCount": "1683", "bestRating": "5" },
    "areaServed": [
      { "@type": "City", "name": "Cleveland", "sameAs": "https://en.wikipedia.org/wiki/Cleveland" },
      { "@type": "City", "name": "Euclid" },
      { "@type": "City", "name": "East Cleveland" },
      { "@type": "City", "name": "South Euclid" },
      { "@type": "City", "name": "Richmond Heights" }
    ],
    "sameAs": [
      "https://www.google.com/maps/place/Nick's+Tire+And+Auto+Euclid/@41.5525118,-81.5571875,17z/",
      "https://www.instagram.com/nicks_tire_euclid/",
      "https://www.facebook.com/nickstireeuclid/"
    ],
    "hasMap": "https://www.google.com/maps/place/Nick's+Tire+And+Auto+Euclid/@41.5525118,-81.5571875,17z/"
  };

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />;
}

// ─── PAGE ────────────────────────────────────────────────
export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <SEOHead
        title="Nick's Tire & Auto | Cleveland Auto Repair Shop"
        description={`Trusted auto repair and tire shop serving Cleveland, Euclid, and Northeast Ohio. Brakes, tires, diagnostics, emissions, and more. 4.9 stars, ${BUSINESS.reviews.countDisplay} reviews.`}
        canonicalPath="/"
      />
      <LocalBusinessSchema />
      <SkipToContent />
      <NotificationBar />
      <Navbar />
      <main id="main-content">
        <Hero />
        <TrustNumbers />
        <Services />
        <WhyUs />
        <Reviews />
        <ComparisonTable />
        <Contact />
        <InternalLinks title="Explore More" />
      </main>
      <Footer />
      <MobileCTA />
      <LeadPopup />
      <ChatWidget />
    </div>
  );
}
