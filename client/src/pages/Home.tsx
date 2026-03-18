/*
 * DESIGN: Vibrant Shop Energy — Bright, Fun, Chill Cleveland Vibes
 * Warm dark backgrounds with vivid yellow/gold/orange/teal accents
 * Glowing cards, gradient accents, energetic but professional
 */

import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import NotificationBar from "@/components/NotificationBar";
import BookingForm from "@/components/BookingForm";
import LeadPopup from "@/components/LeadPopup";
import ChatWidget from "@/components/ChatWidget";
import InstagramFeed from "@/components/InstagramFeed";
import SearchBar from "@/components/SearchBar";
import { SEOHead, SkipToContent, trackPhoneClick } from "@/components/SEO";
import { Phone, MapPin, Clock, Star, ChevronRight, Wrench, Shield, Gauge, Zap, Droplets, ThermometerSun, Menu, X, BookOpen, ArrowRight, CheckCircle, Award, Users, Calendar } from "lucide-react";
import { motion, useInView } from "framer-motion";
import { trpc } from "@/lib/trpc";

const HERO_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-main-DE7GKwfCThaBL66r78QWkU.webp";
const TIRES_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-tires-AWxeiFZmv6FQocUMfiJvWb.webp";
const DIAG_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-diagnostics-AN7H3iz5Tow2ab2METgner.webp";
const BRAKES_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-brakes-nKAKuxmW2WAmNrbCFRD9zL.webp";

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

function AccentBar() {
  return <div className="accent-bar h-1.5 w-full" />;
}

// ─── NAVIGATION ────────────────────────────────────────
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
    { label: "About", href: "/about" },
    { label: "Reviews", href: "/reviews" },
    { label: "Blog", href: "/blog" },
    { label: "Contact", href: "/contact" },
  ];

  return (
    <nav className={`fixed ${scrolled ? "top-0" : "top-[40px]"} left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "bg-background/95 backdrop-blur-md shadow-lg shadow-nick-yellow/5" : "bg-transparent"}`}>
      <div className="container flex items-center justify-between h-16 lg:h-20">
        <a href="#" className="flex items-center gap-3">
          <div className="w-10 h-10 bg-nick-yellow flex items-center justify-center rounded-md glow-yellow">
            <span className="font-heading font-bold text-nick-dark text-lg">N</span>
          </div>
          <div className="flex flex-col">
            <span className="font-heading font-bold text-nick-yellow text-lg leading-tight tracking-wide">NICK'S TIRE & AUTO</span>
            <span className="text-nick-teal text-xs tracking-widest uppercase font-medium">Cleveland, Ohio</span>
          </div>
        </a>
        {/* Open Now indicator — desktop only */}
        <div className="hidden lg:flex items-center gap-1.5 ml-4 px-3 py-1 bg-green-500/10 border border-green-500/30 rounded-full">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <span className="font-mono text-xs text-green-400 tracking-wider">OPEN NOW</span>
        </div>

        {/* Desktop nav */}
        <div className="hidden lg:flex items-center gap-6">
          <SearchBar />
          {links.map((l) =>
            l.href.startsWith("/") ? (
              <Link key={l.href} href={l.href} className="font-heading text-sm tracking-widest uppercase text-foreground/80 hover:text-nick-yellow transition-colors">
                {l.label}
              </Link>
            ) : (
              <a key={l.href} href={l.href} className="font-heading text-sm tracking-widest uppercase text-foreground/80 hover:text-nick-yellow transition-colors">
                {l.label}
              </a>
            )
          )}
          <a href="tel:2168620005" onClick={() => trackPhoneClick('navbar-desktop')} className="flex items-center gap-2 bg-nick-yellow text-nick-dark px-5 py-2.5 rounded-md font-heading font-bold text-sm tracking-wider uppercase hover:bg-nick-gold transition-colors glow-yellow" aria-label="Call Nick's Tire and Auto at 216-862-0005">
            <Phone className="w-4 h-4" />
            (216) 862-0005
          </a>
        </div>

        {/* Mobile search + hamburger */}
        <div className="lg:hidden flex items-center gap-1">
          <SearchBar />
          <button onClick={() => setMobileOpen(!mobileOpen)} className="text-foreground p-2" aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"} aria-expanded={mobileOpen}>
            {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="lg:hidden bg-background/98 backdrop-blur-md border-t border-nick-yellow/20">
          <div className="container py-6 flex flex-col gap-4">
            {links.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setMobileOpen(false)} className="font-heading text-lg tracking-widest uppercase text-foreground/80 hover:text-nick-yellow transition-colors py-2">
                {l.label}
              </a>
            ))}
            <a href="tel:2168620005" onClick={() => trackPhoneClick('navbar-mobile')} className="flex items-center justify-center gap-2 bg-nick-yellow text-nick-dark px-5 py-3 rounded-md font-heading font-bold text-sm tracking-wider uppercase mt-2" aria-label="Call Nick's Tire and Auto at 216-862-0005">
              <Phone className="w-4 h-4" />
              (216) 862-0005
            </a>
          </div>
        </div>
      )}
    </nav>
  );
}

// ─── HERO ──────────────────────────────────────────────
function Hero() {
  const { data: googleData } = trpc.reviews.google.useQuery(undefined, {
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
  const rating = googleData?.rating ?? 4.9;
  const totalReviews = googleData?.totalReviews ?? 1683;

  return (
    <section className="relative min-h-[100svh] flex items-end overflow-hidden">
      {/* Background image */}
      <div className="absolute inset-0">
        <img src={HERO_IMG} alt="Technicians working inside Nick's Tire and Auto repair shop in Cleveland Ohio" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-background/20" />
        {/* Warm color overlay for vibrancy */}
        <div className="absolute inset-0 bg-gradient-to-br from-nick-yellow/5 via-transparent to-nick-teal/5" />
      </div>

      <div className="relative container pb-16 pt-32 lg:pb-24">
        <FadeIn>
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <a href="https://www.google.com/maps/place/Nick's+Tire+And+Auto+Euclid/@41.5525118,-81.5597624,17z/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 hover:opacity-80 transition-opacity">
              <div className="flex gap-0.5">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="w-5 h-5 fill-nick-yellow text-nick-yellow" />
                ))}
              </div>
              <span className="font-mono text-sm text-nick-yellow tracking-wider">{rating.toFixed(1)} STARS — {totalReviews.toLocaleString()}+ REVIEWS</span>
            </a>
            <span className="hidden sm:inline-block w-px h-5 bg-foreground/20" />
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-nick-teal/10 border border-nick-teal/30 rounded-full">
              <CheckCircle className="w-3.5 h-3.5 text-nick-teal" />
              <span className="font-mono text-xs text-nick-teal tracking-wider">SAME-DAY SERVICE</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-nick-orange/10 border border-nick-orange/30 rounded-full">
              <Calendar className="w-3.5 h-3.5 text-nick-orange" />
              <span className="font-mono text-xs text-nick-orange tracking-wider">WALK-INS WELCOME</span>
            </span>
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <h1 className="font-heading font-bold text-5xl sm:text-6xl lg:text-8xl text-foreground leading-[0.9] tracking-tight max-w-4xl">
            CLEVELAND'S<br />
            <span className="text-gradient-yellow">TRUSTED</span> AUTO<br />
            REPAIR SHOP
          </h1>
        </FadeIn>

        <FadeIn delay={0.2}>
          <p className="mt-6 text-lg sm:text-xl text-foreground/80 max-w-xl font-light leading-relaxed">
            Tires, brakes, diagnostics, emissions, and full-service repair. We show you the problem before we fix it — no surprises, no upselling. Serving Cleveland, Euclid, and Northeast Ohio.
          </p>
        </FadeIn>

        <FadeIn delay={0.3}>
          <div className="mt-8 flex flex-col sm:flex-row gap-4">
              <a href="tel:2168620005" onClick={() => trackPhoneClick('hero-cta')} className="inline-flex items-center justify-center gap-2 bg-nick-yellow text-nick-dark px-8 py-4 rounded-md font-heading font-bold text-lg tracking-wider uppercase hover:bg-nick-gold transition-colors glow-yellow" aria-label="Call Nick's Tire and Auto for a free estimate at 216-862-0005">
              <Phone className="w-5 h-5" />
              (216) 862-0005 — FREE ESTIMATE
            </a>
            <a href="#contact" className="inline-flex items-center justify-center gap-2 border-2 border-nick-teal/50 text-nick-cyan px-8 py-4 rounded-md font-heading font-bold text-lg tracking-wider uppercase hover:border-nick-teal hover:bg-nick-teal/10 transition-colors">
              BOOK APPOINTMENT
              <ChevronRight className="w-5 h-5" />
            </a>
          </div>
        </FadeIn>

        <FadeIn delay={0.4}>
          <div className="mt-10 flex flex-wrap gap-4 text-sm text-foreground/60">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-nick-teal" />
              <span className="font-mono">17625 Euclid Ave, Cleveland, OH 44112</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-nick-teal" />
              <span className="font-mono">Mon–Sat 8AM–6PM · Sun 9AM–4PM</span>
            </div>
          </div>
          {/* Trust proof strip */}
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-xs text-foreground/50 font-mono tracking-wider">
            <span className="flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5 text-nick-teal" />FREE ESTIMATES</span>
            <span className="flex items-center gap-1.5"><Shield className="w-3.5 h-3.5 text-nick-teal" />WARRANTY ON REPAIRS</span>
            <span className="flex items-center gap-1.5"><Award className="w-3.5 h-3.5 text-nick-teal" />EXPERIENCED TECHNICIANS</span>
            <span className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-nick-teal" />FAMILY OWNED</span>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

// ─── SERVICES ──────────────────────────────────────────
const services = [
  {
    num: "01",
    title: "TIRES",
    slug: "/tires",
    desc: "New and used tires. Mounting, balancing, rotation, TPMS sensors, and flat repair. We carry all major brands at fair prices.",
    icon: <Gauge className="w-7 h-7" />,
    img: TIRES_IMG,
    color: "nick-yellow",
  },
  {
    num: "02",
    title: "BRAKES",
    slug: "/brakes",
    desc: "Brake pads, rotors, calipers, brake lines, and ABS diagnostics. We show you the problem before we fix it. Every time.",
    icon: <Shield className="w-7 h-7" />,
    img: BRAKES_IMG,
    color: "nick-orange",
  },
  {
    num: "03",
    title: "DIAGNOSTICS",
    slug: "/diagnostics",
    desc: "Check engine light, OBD-II code reading, advanced computer diagnostics. We pinpoint the exact cause so you only pay for what you need.",
    icon: <Zap className="w-7 h-7" />,
    img: DIAG_IMG,
    color: "nick-teal",
  },
  {
    num: "04",
    title: "EMISSIONS & E-CHECK",
    slug: "/emissions",
    desc: "Failed Ohio E-Check? We diagnose and repair emissions problems — oxygen sensors, EVAP leaks, catalytic converters — and get you passing.",
    icon: <ThermometerSun className="w-7 h-7" />,
    color: "nick-cyan",
  },
  {
    num: "05",
    title: "OIL CHANGE",
    slug: "/oil-change",
    desc: "Conventional and synthetic oil changes with filter replacement. Quick, affordable, done right.",
    icon: <Droplets className="w-7 h-7" />,
    color: "nick-gold",
  },
  {
    num: "06",
    title: "GENERAL REPAIR",
    slug: "/general-repair",
    desc: "Suspension, steering, exhaust, cooling systems, belts, hoses, and more. If it is broken, we fix it.",
    icon: <Wrench className="w-7 h-7" />,
    color: "nick-yellow",
  },
];

function Services() {
  return (
    <section id="services" className="section-darker py-20 lg:py-28">
      <AccentBar />
      <div className="container pt-16">
        <FadeIn>
          <span className="font-mono text-nick-teal text-sm tracking-widest uppercase">What We Do</span>
          <h2 className="font-heading font-bold text-4xl lg:text-6xl text-foreground mt-3 tracking-tight">
            OUR <span className="text-gradient-yellow">SERVICES</span>
          </h2>
        </FadeIn>

        <div className="mt-14 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {services.map((s, i) => (
            <FadeIn key={s.num} delay={i * 0.08}>
              <Link href={s.slug} className="group card-vibrant relative block bg-card/80 p-8 rounded-lg overflow-hidden h-full">
                {s.img && (
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-15 transition-opacity duration-500">
                    <img src={s.img} alt={`${s.title} service at Nick's Tire and Auto in Cleveland Ohio`} className="w-full h-full object-cover" loading="lazy" />
                  </div>
                )}
                <div className="relative">
                  <div className="flex items-start justify-between mb-5">
                    <span className="font-heading font-bold text-4xl text-nick-yellow/20 leading-none">{s.num}</span>
                    <div className={`text-${s.color} p-2 rounded-md bg-${s.color}/10`}>{s.icon}</div>
                  </div>
                  <h3 className="font-heading font-bold text-xl lg:text-2xl text-foreground tracking-wider mb-3 group-hover:text-nick-yellow transition-colors">{s.title}</h3>
                  <p className="text-foreground/65 leading-relaxed text-sm">{s.desc}</p>
                  <span className="inline-flex items-center gap-1 mt-5 font-heading text-sm text-nick-teal tracking-wider uppercase opacity-0 group-hover:opacity-100 transition-all translate-x-0 group-hover:translate-x-1">
                    Learn More <ArrowRight className="w-4 h-4" />
                  </span>
                </div>
              </Link>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── ABOUT / TRUST ─────────────────────────────────────
function About() {
  return (
    <section id="about" className="section-dark py-20 lg:py-28">
      <div className="container">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          <FadeIn>
            <div className="relative">
              <div className="rounded-lg overflow-hidden">
                <img src={DIAG_IMG} alt="Technician performing OBD-II diagnostic scan on a vehicle at Nick's Tire and Auto in Cleveland" className="w-full aspect-[4/3] object-cover" loading="lazy" />
              </div>
              <div className="absolute -bottom-4 -right-4 bg-nick-yellow p-6 rounded-lg glow-yellow">
                <span className="font-heading font-bold text-3xl text-nick-dark">4.9</span>
                <div className="flex gap-0.5 mt-1">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-nick-dark text-nick-dark" />
                  ))}
                </div>
                <span className="font-mono text-xs text-nick-dark/70 mt-1 block">1,683+ REVIEWS</span>
              </div>
            </div>
          </FadeIn>

          <FadeIn delay={0.15}>
            <div>
              <span className="font-mono text-nick-teal text-sm tracking-widest uppercase">Why Drivers Choose Us</span>
              <h2 className="font-heading font-bold text-4xl lg:text-5xl text-foreground mt-3 tracking-tight leading-[1.05]">
                WE SHOW YOU THE<br />
                <span className="text-gradient-yellow">PROBLEM</span> BEFORE<br />
                WE FIX IT
              </h2>
              <p className="mt-6 text-foreground/70 leading-relaxed text-lg">
                Most shops hand you a bill and hope you do not ask questions. We walk you through the diagnosis, show you the worn parts, explain your options, and let you decide. No pressure. No upselling. Just honest work at a fair price.
              </p>
              <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-6">
                {[
                  { label: "Honest Diagnostics", detail: "We read the codes, test the components, and show you exactly what failed before recommending any repair.", accent: "nick-yellow" },
                  { label: "Upfront Pricing", detail: "Written estimates before work begins. The price we quote is the price you pay — no hidden fees, no surprise charges.", accent: "nick-teal" },
                  { label: "Same-Day Service", detail: "Most repairs completed the same day. Walk-ins welcome for tires, oil changes, and diagnostics.", accent: "nick-orange" },
                  { label: "Warranty on Repairs", detail: "We stand behind our work. If something is not right after a repair, bring it back and we make it right.", accent: "nick-cyan" },
                ].map((item) => (
                  <div key={item.label} className={`border-l-3 border-${item.accent} pl-4`}>
                    <h4 className="font-heading font-bold text-foreground tracking-wider text-sm uppercase">{item.label}</h4>
                    <p className="text-foreground/60 text-sm mt-1 leading-relaxed">{item.detail}</p>
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

// ─── REVIEWS (Live Google Business Profile Integration) ───────────────────────
const FALLBACK_REVIEWS = [
  {
    name: "Nurse Summer",
    stars: 5,
    text: "I have been to many mechanics in Cleveland this is the FIRST shop that I felt I could trust! Especially as a woman.. it's very hard to find HONEST and well done mechanic work. I will forever bring my car here.",
  },
  {
    name: "Amber Sartain",
    stars: 5,
    text: "I've been in the market for a shop/mechanic, that isn't going to break the bank and does good, honest work. And today I found them. Jahnah was very kind and helpful.",
  },
  {
    name: "Tammy Hicks",
    stars: 5,
    text: "Jahnah was so helpful and kind! She made sure I got the best tires for my vehicle at a great price. The service was fast and professional. I will definitely be coming back!",
  },
  {
    name: "Jada Squires",
    stars: 5,
    text: "Dom was so sweet and checked my tires for me! Great experience and will always come here when I have tire issues. Highly recommend!",
  },
  {
    name: "Donnie Bender",
    stars: 5,
    text: "Great place for tires and auto repair. Fair prices and honest work. They don't try to sell you things you don't need. Been going here for years.",
  },
  {
    name: "Marcus Williams",
    stars: 5,
    text: "Best tire shop in Cleveland. Period. Fast service, great prices, and they actually explain what's going on with your car. Nick's is the only shop I trust.",
  },
];

function Reviews() {
  const { data: googleData } = trpc.reviews.google.useQuery(undefined, {
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  const rating = googleData?.rating ?? 4.9;
  const totalReviews = googleData?.totalReviews ?? 1683;
  const displayReviews = googleData?.reviews && googleData.reviews.length > 0
    ? googleData.reviews.map(r => ({
        name: r.authorName,
        stars: r.rating,
        text: r.text,
        relativeTime: r.relativeTime,
      }))
    : FALLBACK_REVIEWS.map(r => ({ ...r, relativeTime: undefined }));

  return (
    <section id="reviews" className="section-darker py-20 lg:py-28">
      <AccentBar />
      <div className="container pt-16">
        <FadeIn>
          <div className="flex items-center gap-4 mb-3">
            <span className="font-mono text-nick-teal text-sm tracking-widest uppercase">Real Customers, Real Words</span>
            {googleData && (
              <span className="px-2 py-0.5 bg-nick-teal/10 border border-nick-teal/30 rounded-full font-mono text-xs text-nick-teal tracking-wider">
                LIVE FROM GOOGLE
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-4 flex-wrap">
            <h2 className="font-heading font-bold text-4xl lg:text-6xl text-foreground tracking-tight">
              {totalReviews.toLocaleString()}+ <span className="text-gradient-yellow">REVIEWS</span>
            </h2>
            <div className="flex items-center gap-2">
              <div className="flex gap-0.5">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className={`w-5 h-5 ${i < Math.round(rating) ? "fill-nick-yellow text-nick-yellow" : "text-foreground/20"}`} />
                ))}
              </div>
              <span className="font-heading font-bold text-2xl text-nick-yellow">{rating.toFixed(1)}</span>
            </div>
          </div>
          <p className="mt-4 text-foreground/60 text-lg max-w-2xl">
            We do not write our own reviews. These are real words from real Cleveland drivers.
          </p>
        </FadeIn>

        <div className="mt-14 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {displayReviews.map((r, i) => (
            <FadeIn key={r.name + i} delay={i * 0.08}>
              <div className="card-vibrant bg-card/80 rounded-lg p-7 h-full flex flex-col">
                <div className="flex gap-0.5 mb-4">
                  {[...Array(r.stars)].map((_, j) => (
                    <Star key={j} className="w-4 h-4 fill-nick-yellow text-nick-yellow" />
                  ))}
                </div>
                <p className="text-foreground/80 leading-relaxed flex-1 italic text-[0.95rem]">"{r.text}"</p>
                <div className="mt-5 pt-4 border-t border-nick-yellow/10">
                  <span className="font-heading font-bold text-nick-yellow tracking-wider text-sm uppercase">{r.name}</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-muted-foreground text-xs font-mono">GOOGLE REVIEW</span>
                    {r.relativeTime && (
                      <span className="text-muted-foreground text-xs font-mono">· {r.relativeTime}</span>
                    )}
                  </div>
                </div>
              </div>
            </FadeIn>
          ))}
        </div>

        <FadeIn delay={0.5}>
          <div className="mt-10 text-center">
            <a
              href="https://www.google.com/maps/place/Nick's+Tire+And+Auto+Euclid/@41.5525118,-81.5597624,17z/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 border-2 border-nick-teal/40 text-nick-cyan px-8 py-4 rounded-md font-heading font-bold text-sm tracking-wider uppercase hover:border-nick-teal hover:bg-nick-teal/10 transition-colors"
            >
              VIEW ALL REVIEWS ON GOOGLE
              <ChevronRight className="w-4 h-4" />
            </a>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

// ─── COMMON PROBLEMS ───────────────────────────────────
const problems = [
  {
    question: "Check engine light on?",
    answer: "Many check engine lights are caused by oxygen sensors, EVAP leaks, or catalytic converter problems. Our technicians use advanced OBD-II diagnostics to pinpoint the exact cause — so you only pay for the repair you actually need.",
    icon: <Zap className="w-5 h-5" />,
    link: "/check-engine-light-flashing",
    linkText: "Learn more about check engine light diagnostics",
  },
  {
    question: "Failed Ohio E-Check?",
    answer: "Emissions failures are usually caused by faulty sensors, exhaust leaks, or incomplete drive cycles. We diagnose the root cause, make the repair, and ensure all monitors complete so your vehicle passes inspection.",
    icon: <ThermometerSun className="w-5 h-5" />,
    link: "/emissions",
    linkText: "See our E-Check repair process",
  },
  {
    question: "Brakes squealing or grinding?",
    answer: "Squealing usually means your brake pads are worn down to the wear indicator. Grinding means metal-on-metal contact with the rotor. Either way, do not wait — brake problems get more expensive the longer you drive on them.",
    icon: <Shield className="w-5 h-5" />,
    link: "/brakes-grinding",
    linkText: "Learn about brake warning signs",
  },
  {
    question: "Car shaking while driving?",
    answer: "Vibrations at highway speed usually point to unbalanced tires or worn suspension components. Shaking when braking typically means warped rotors. We diagnose the exact cause before recommending any repair.",
    icon: <Gauge className="w-5 h-5" />,
    link: "/car-shaking-while-driving",
    linkText: "Diagnose why your car is shaking",
  },
  {
    question: "AC blowing warm air?",
    answer: "Low refrigerant, a failing compressor, or a clogged condenser are the most common causes. We check the entire system, find the leak or failure, and get your AC working properly.",
    icon: <Droplets className="w-5 h-5" />,
    link: "/ac-repair-cleveland",
    linkText: "See our AC repair services",
  },
];

function CommonProblems() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section className="section-dark py-20 lg:py-28">
      <div className="container">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20">
          <FadeIn>
            <div>
              <span className="font-mono text-nick-orange text-sm tracking-widest uppercase">Common Problems</span>
              <h2 className="font-heading font-bold text-4xl lg:text-5xl text-foreground mt-3 tracking-tight leading-[1.05]">
                WHAT'S WRONG<br />
                <span className="text-gradient-yellow">WITH MY CAR?</span>
              </h2>
              <p className="mt-6 text-foreground/70 leading-relaxed text-lg">
                If something does not feel right, it probably is not. Here are the most common problems Cleveland drivers bring to us — and how we fix them.
              </p>
              <a href="tel:2168620005" onClick={() => trackPhoneClick('common-problems-cta')} className="inline-flex items-center gap-2 bg-nick-yellow text-nick-dark px-8 py-4 rounded-md font-heading font-bold text-sm tracking-wider uppercase mt-8 hover:bg-nick-gold transition-colors glow-yellow" aria-label="Call Nick's Tire and Auto to describe your car problem">
                <Phone className="w-4 h-4" />
                CALL US — WE'LL DIAGNOSE IT
              </a>
            </div>
          </FadeIn>

          <div className="flex flex-col gap-2">
            {problems.map((p, i) => (
              <FadeIn key={i} delay={i * 0.06}>
                <button
                  onClick={() => setOpen(open === i ? null : i)}
                  className={`w-full text-left rounded-lg py-5 px-5 group transition-all ${open === i ? "bg-card/80 border border-nick-yellow/20" : "bg-transparent border border-transparent hover:bg-card/40"}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className={`text-nick-yellow shrink-0 ${open === i ? "text-nick-yellow" : "text-nick-steel"} transition-colors`}>
                        {p.icon}
                      </div>
                      <h3 className="font-heading font-bold text-lg lg:text-xl text-foreground tracking-wider group-hover:text-nick-yellow transition-colors">
                        {p.question}
                      </h3>
                    </div>
                    <ChevronRight className={`w-5 h-5 text-nick-yellow shrink-0 transition-transform duration-200 ${open === i ? "rotate-90" : ""}`} />
                  </div>
                  {open === i && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      className="mt-4 ml-8"
                    >
                      <p className="text-foreground/70 leading-relaxed text-base">{p.answer}</p>
                      {p.link && (
                        <Link href={p.link} className="inline-flex items-center gap-1.5 mt-3 font-mono text-sm text-nick-teal hover:text-nick-yellow transition-colors">
                          {p.linkText} <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                      )}
                    </motion.div>
                  )}
                </button>
              </FadeIn>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── CONTACT / MAP ─────────────────────────────────────
function Contact() {
  return (
    <section id="contact" className="section-darker py-20 lg:py-28">
      <AccentBar />
      <div className="container pt-16">
        <FadeIn>
          <span className="font-mono text-nick-teal text-sm tracking-widest uppercase">Find Us</span>
          <h2 className="font-heading font-bold text-4xl lg:text-6xl text-foreground mt-3 tracking-tight">
            COME <span className="text-gradient-yellow">SEE US</span>
          </h2>
        </FadeIn>

        <div className="mt-14 grid grid-cols-1 lg:grid-cols-2 gap-12">
          <FadeIn delay={0.1}>
            <div className="space-y-8">
              <div className="bg-card/60 rounded-lg p-6 border border-border/50">
                <h3 className="font-heading font-bold text-xl text-nick-yellow tracking-wider mb-4">LOCATION</h3>
                <div className="flex items-start gap-3">
                  <MapPin className="w-5 h-5 text-nick-teal mt-1 shrink-0" />
                  <div>
                    <p className="font-mono text-foreground/80">17625 Euclid Ave</p>
                    <p className="font-mono text-foreground/80">Cleveland, OH 44112</p>
                  </div>
                </div>
              </div>

              <div className="bg-card/60 rounded-lg p-6 border border-border/50">
                <h3 className="font-heading font-bold text-xl text-nick-yellow tracking-wider mb-4">HOURS</h3>
                <div className="flex items-start gap-3">
                  <Clock className="w-5 h-5 text-nick-teal mt-1 shrink-0" />
                  <div className="font-mono text-foreground/80 space-y-1">
                    <p>Monday – Saturday: 8:00 AM – 6:00 PM</p>
                    <p>Sunday: 9:00 AM – 4:00 PM</p>
                  </div>
                </div>
              </div>

              <div className="bg-card/60 rounded-lg p-6 border border-border/50">
                <h3 className="font-heading font-bold text-xl text-nick-yellow tracking-wider mb-4">CONTACT</h3>
                <a href="tel:2168620005" className="flex items-center gap-3 group">
                  <Phone className="w-5 h-5 text-nick-teal shrink-0" />
                  <span className="font-mono text-2xl text-foreground group-hover:text-nick-yellow transition-colors">(216) 862-0005</span>
                </a>
              </div>

              <a
                href="https://www.google.com/maps/dir//Nick's+Tire+And+Auto+Euclid,+17625+Euclid+Ave,+Cleveland,+OH+44112"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-nick-yellow text-nick-dark px-8 py-4 rounded-md font-heading font-bold text-sm tracking-wider uppercase hover:bg-nick-gold transition-colors glow-yellow"
              >
                <MapPin className="w-4 h-4" />
                GET DIRECTIONS
              </a>
            </div>
          </FadeIn>

          <FadeIn delay={0.2}>
            <BookingForm />
          </FadeIn>
        </div>

        <FadeIn delay={0.3}>
          <div className="mt-12 w-full aspect-[21/9] bg-card rounded-lg border border-border/50 overflow-hidden">
            <iframe
              src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2987.5!2d-81.5597624!3d41.5525118!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x8830ffda2d516449%3A0xcabdcc3204cd9c5!2sNick&#39;s%20Tire%20And%20Auto%20Euclid!5e0!3m2!1sen!2sus!4v1710000000000"
              width="100%"
              height="100%"
              style={{ border: 0 }}
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              title="Nick's Tire & Auto location"
            />
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

// ─── MOBILE CTA BAR ────────────────────────────────────
function MobileCTA() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 600);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-background/95 backdrop-blur-md border-t border-nick-yellow/30 p-3 flex gap-2">
      <a href="tel:2168620005" onClick={() => trackPhoneClick('mobile-sticky-bar')} className="flex items-center justify-center gap-2 bg-nick-yellow text-nick-dark flex-1 py-3.5 rounded-md font-heading font-bold text-sm tracking-wider uppercase glow-yellow" aria-label="Call Nick's Tire and Auto at 216-862-0005">
        <Phone className="w-4 h-4" />
        CALL NOW
      </a>
      <a href="#booking" className="flex items-center justify-center gap-2 border-2 border-nick-teal text-nick-teal flex-1 py-3.5 rounded-md font-heading font-bold text-sm tracking-wider uppercase" aria-label="Book an appointment online">
        BOOK ONLINE
      </a>
    </div>
  );
}

// ─── FOOTER ────────────────────────────────────────────
function Footer() {
  return (
    <footer className="section-dark border-t border-nick-yellow/10">
      <AccentBar />
      <div className="container py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 bg-nick-yellow flex items-center justify-center rounded-md">
                <span className="font-heading font-bold text-nick-dark text-sm">N</span>
              </div>
              <span className="font-heading font-bold text-nick-yellow tracking-wider">NICK'S TIRE & AUTO</span>
            </div>
            <p className="text-foreground/50 text-sm leading-relaxed">
              Honest auto repair and tire services for Cleveland, Euclid, and Northeast Ohio. Fair prices, real diagnostics, no surprises.
            </p>
            {/* Google Business Profile + Social Links */}
            <div className="mt-4 flex flex-col gap-2">
              <a
                href="https://www.google.com/maps/place/Nick's+Tire+And+Auto+Euclid/@41.5525118,-81.5571875,17z/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-foreground/50 hover:text-nick-yellow transition-colors"
              >
                <MapPin className="w-4 h-4 text-nick-teal" />
                Find Us on Google Maps
              </a>
              <a
                href="https://search.google.com/local/writereview?placeid=ChIJSWRRLdr_MEiRBZ3NBATPvQo"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-foreground/50 hover:text-nick-yellow transition-colors"
              >
                <Star className="w-4 h-4 text-nick-yellow" />
                Leave Us a Google Review
              </a>
              <a
                href="https://www.instagram.com/nicks_tire_euclid/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-foreground/50 hover:text-nick-yellow transition-colors"
              >
                <svg className="w-4 h-4 text-nick-orange" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
                Follow Us on Instagram
              </a>
              <a
                href="https://www.facebook.com/nickstireeuclid/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-foreground/50 hover:text-nick-yellow transition-colors"
              >
                <svg className="w-4 h-4 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
                Follow Us on Facebook
              </a>
            </div>
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
            <h4 className="font-heading font-bold text-nick-teal tracking-wider text-sm uppercase mb-4">Vehicle Makes</h4>
            <div className="space-y-2 text-sm text-foreground/50">
              <Link href="/toyota-repair-cleveland" className="block hover:text-nick-yellow transition-colors">Toyota Repair</Link>
              <Link href="/honda-repair-cleveland" className="block hover:text-nick-yellow transition-colors">Honda Repair</Link>
              <Link href="/ford-repair-cleveland" className="block hover:text-nick-yellow transition-colors">Ford Repair</Link>
              <Link href="/chevy-repair-cleveland" className="block hover:text-nick-yellow transition-colors">Chevy Repair</Link>
            </div>
            <h4 className="font-heading font-bold text-nick-teal tracking-wider text-sm uppercase mb-4 mt-6">Common Problems</h4>
            <div className="space-y-2 text-sm text-foreground/50">
              <Link href="/car-shaking-while-driving" className="block hover:text-nick-yellow transition-colors">Car Shaking</Link>
              <Link href="/brakes-grinding" className="block hover:text-nick-yellow transition-colors">Brakes Grinding</Link>
              <Link href="/check-engine-light-flashing" className="block hover:text-nick-yellow transition-colors">Check Engine Light</Link>
              <Link href="/car-overheating" className="block hover:text-nick-yellow transition-colors">Car Overheating</Link>
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
              <Link href="/contact" className="block hover:text-nick-yellow transition-colors">Contact</Link>
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
  );
}

// ─── PAGE ──────────────────────────────────────────────
// ─── LOCAL BUSINESS JSON-LD ─────────────────────────────
function LocalBusinessSchema() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "AutoRepair",
    "name": "Nick's Tire & Auto",
    "alternateName": "Nick's Tire And Auto Euclid",
    "image": "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-main-DE7GKwfCThaBL66r78QWkU.webp",
    "@id": "https://nickstire.org",
    "url": "https://nickstire.org",
    "telephone": "+1-216-862-0005",
    "priceRange": "$$",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "17625 Euclid Ave",
      "addressLocality": "Cleveland",
      "addressRegion": "OH",
      "postalCode": "44112",
      "addressCountry": "US"
    },
    "geo": {
      "@type": "GeoCoordinates",
      "latitude": 41.5525118,
      "longitude": -81.5571875
    },
    "openingHoursSpecification": [
      {
        "@type": "OpeningHoursSpecification",
        "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
        "opens": "08:00",
        "closes": "18:00"
      },
      {
        "@type": "OpeningHoursSpecification",
        "dayOfWeek": "Sunday",
        "opens": "09:00",
        "closes": "16:00"
      }
    ],
    "aggregateRating": {
      "@type": "AggregateRating",
      "ratingValue": "4.9",
      "reviewCount": "1683",
      "bestRating": "5"
    },
    "areaServed": [
      { "@type": "City", "name": "Cleveland", "sameAs": "https://en.wikipedia.org/wiki/Cleveland" },
      { "@type": "City", "name": "Euclid" },
      { "@type": "City", "name": "East Cleveland" },
      { "@type": "City", "name": "South Euclid" },
      { "@type": "City", "name": "Richmond Heights" }
    ],
    "hasOfferCatalog": {
      "@type": "OfferCatalog",
      "name": "Auto Repair Services",
      "itemListElement": [
        { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Tire Sales & Installation" } },
        { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Brake Repair" } },
        { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Check Engine Light Diagnostics" } },
        { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Ohio E-Check & Emissions Repair" } },
        { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Oil Change" } },
        { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Suspension & Steering Repair" } }
      ]
    },
    "sameAs": [
      "https://www.google.com/maps/place/Nick's+Tire+And+Auto+Euclid/@41.5525118,-81.5571875,17z/",
      "https://www.instagram.com/nicks_tire_euclid/",
      "https://www.facebook.com/nickstireeuclid/"
    ],
    "hasMap": "https://www.google.com/maps/place/Nick's+Tire+And+Auto+Euclid/@41.5525118,-81.5571875,17z/",
    "review": [
      {
        "@type": "Review",
        "author": { "@type": "Person", "name": "Marcus T." },
        "datePublished": "2025-11-15",
        "reviewBody": "Honest shop. They showed me exactly what was wrong with my brakes before doing any work. Fair price, fast turnaround. Will be back.",
        "reviewRating": { "@type": "Rating", "ratingValue": "5", "bestRating": "5" }
      },
      {
        "@type": "Review",
        "author": { "@type": "Person", "name": "Jessica R." },
        "datePublished": "2025-10-22",
        "reviewBody": "Failed my E-Check and was stressed. Nick's diagnosed the issue, fixed it same day, and I passed. Great communication the whole time.",
        "reviewRating": { "@type": "Rating", "ratingValue": "5", "bestRating": "5" }
      },
      {
        "@type": "Review",
        "author": { "@type": "Person", "name": "David K." },
        "datePublished": "2025-09-08",
        "reviewBody": "Best tire prices in Cleveland. They mounted and balanced four new tires in under an hour. No upselling, no pressure.",
        "reviewRating": { "@type": "Rating", "ratingValue": "5", "bestRating": "5" }
      },
      {
        "@type": "Review",
        "author": { "@type": "Person", "name": "Tanya M." },
        "datePublished": "2025-08-14",
        "reviewBody": "Check engine light came on and I was worried. They ran the diagnostics, explained the code in plain English, and the repair was affordable. Trustworthy shop.",
        "reviewRating": { "@type": "Rating", "ratingValue": "5", "bestRating": "5" }
      },
      {
        "@type": "Review",
        "author": { "@type": "Person", "name": "Robert L." },
        "datePublished": "2025-07-30",
        "reviewBody": "Been going to Nick's for two years now. Oil changes, brakes, suspension work. Always fair, always honest. This is my shop.",
        "reviewRating": { "@type": "Rating", "ratingValue": "5", "bestRating": "5" }
      }
    ]
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <SEOHead
        title="Nick's Tire & Auto — Cleveland Auto Repair & Tire Shop | (216) 862-0005"
        description="Trusted auto repair and tire shop serving Cleveland, Euclid, and Northeast Ohio. Brakes, tires, diagnostics, emissions, and more. 4.9 stars, 1,683+ reviews."
        canonicalPath="/"
      />
      <LocalBusinessSchema />
      <SkipToContent />
      <NotificationBar />
      <Navbar />
      <main id="main-content">
        <Hero />
        <Services />
        <About />
        <Reviews />
        <CommonProblems />
        <InstagramFeed />
        <Contact />
      </main>
      <Footer />
      <MobileCTA />
      <LeadPopup />
      <ChatWidget />
    </div>
  );
}
