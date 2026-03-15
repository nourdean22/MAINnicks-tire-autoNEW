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
import { Phone, MapPin, Clock, Star, ChevronRight, Wrench, Shield, Gauge, Zap, Droplets, ThermometerSun, Menu, X, BookOpen, ArrowRight } from "lucide-react";
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
    { label: "About", href: "#about" },
    { label: "Reviews", href: "#reviews" },
    { label: "Blog", href: "/blog" },
    { label: "Contact", href: "#contact" },
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

        {/* Desktop nav */}
        <div className="hidden lg:flex items-center gap-8">
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
          <a href="tel:2168620005" className="flex items-center gap-2 bg-nick-yellow text-nick-dark px-5 py-2.5 rounded-md font-heading font-bold text-sm tracking-wider uppercase hover:bg-nick-gold transition-colors glow-yellow">
            <Phone className="w-4 h-4" />
            (216) 862-0005
          </a>
        </div>

        {/* Mobile hamburger */}
        <button onClick={() => setMobileOpen(!mobileOpen)} className="lg:hidden text-foreground p-2">
          {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
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
        <img src={HERO_IMG} alt="Nick's Tire & Auto shop interior" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-background/20" />
        {/* Warm color overlay for vibrancy */}
        <div className="absolute inset-0 bg-gradient-to-br from-nick-yellow/5 via-transparent to-nick-teal/5" />
      </div>

      <div className="relative container pb-16 pt-32 lg:pb-24">
        <FadeIn>
          <div className="flex items-center gap-3 mb-6">
            <div className="flex gap-0.5">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="w-5 h-5 fill-nick-yellow text-nick-yellow" />
              ))}
            </div>
            <span className="font-mono text-sm text-nick-yellow tracking-wider">{rating.toFixed(1)} STARS — {totalReviews.toLocaleString()}+ REVIEWS</span>
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <h1 className="font-heading font-bold text-5xl sm:text-6xl lg:text-8xl text-foreground leading-[0.9] tracking-tight max-w-4xl">
            CLEVELAND'S<br />
            <span className="text-gradient-yellow">TRUSTED</span> SHOP
          </h1>
        </FadeIn>

        <FadeIn delay={0.2}>
          <p className="mt-6 text-lg sm:text-xl text-foreground/80 max-w-xl font-light leading-relaxed">
            Honest diagnostics. Fair prices. Real repairs. Serving Cleveland, Euclid, and Northeast Ohio drivers since day one.
          </p>
        </FadeIn>

        <FadeIn delay={0.3}>
          <div className="mt-8 flex flex-col sm:flex-row gap-4">
            <a href="tel:2168620005" className="inline-flex items-center justify-center gap-2 bg-nick-yellow text-nick-dark px-8 py-4 rounded-md font-heading font-bold text-lg tracking-wider uppercase hover:bg-nick-gold transition-colors glow-yellow">
              <Phone className="w-5 h-5" />
              CALL NOW
            </a>
            <a href="#services" className="inline-flex items-center justify-center gap-2 border-2 border-nick-teal/50 text-nick-cyan px-8 py-4 rounded-md font-heading font-bold text-lg tracking-wider uppercase hover:border-nick-teal hover:bg-nick-teal/10 transition-colors">
              OUR SERVICES
              <ChevronRight className="w-5 h-5" />
            </a>
          </div>
        </FadeIn>

        <FadeIn delay={0.4}>
          <div className="mt-12 flex flex-wrap gap-6 text-sm text-foreground/60">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-nick-teal" />
              <span className="font-mono">17625 Euclid Ave, Cleveland, OH 44112</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-nick-teal" />
              <span className="font-mono">Mon–Sat 8AM–6PM · Sun 9AM–4PM</span>
            </div>
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
                    <img src={s.img} alt="" className="w-full h-full object-cover" />
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
                <img src={DIAG_IMG} alt="Technician performing vehicle diagnostics" className="w-full aspect-[4/3] object-cover" />
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
                  { label: "Honest Diagnostics", detail: "We explain every code and every repair in plain language.", accent: "nick-yellow" },
                  { label: "Fair Pricing", detail: "No hidden fees. No surprise charges. The price we quote is the price you pay.", accent: "nick-teal" },
                  { label: "Experienced Team", detail: "Our technicians handle everything from basic maintenance to complex diagnostics.", accent: "nick-orange" },
                  { label: "Cleveland Proud", detail: "Locally owned, serving Euclid and Northeast Ohio drivers every day.", accent: "nick-cyan" },
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
  },
  {
    question: "Failed Ohio E-Check?",
    answer: "Emissions failures are usually caused by faulty sensors, exhaust leaks, or incomplete drive cycles. We diagnose the root cause, make the repair, and ensure all monitors complete so your vehicle passes inspection.",
    icon: <ThermometerSun className="w-5 h-5" />,
  },
  {
    question: "Brakes squealing or grinding?",
    answer: "Squealing usually means your brake pads are worn down to the wear indicator. Grinding means metal-on-metal contact with the rotor. Either way, do not wait — brake problems get more expensive the longer you drive on them.",
    icon: <Shield className="w-5 h-5" />,
  },
  {
    question: "Car shaking while driving?",
    answer: "Vibrations at highway speed usually point to unbalanced tires or worn suspension components. Shaking when braking typically means warped rotors. We diagnose the exact cause before recommending any repair.",
    icon: <Gauge className="w-5 h-5" />,
  },
  {
    question: "AC blowing warm air?",
    answer: "Low refrigerant, a failing compressor, or a clogged condenser are the most common causes. We check the entire system, find the leak or failure, and get your AC working properly.",
    icon: <Droplets className="w-5 h-5" />,
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
              <a href="tel:2168620005" className="inline-flex items-center gap-2 bg-nick-yellow text-nick-dark px-8 py-4 rounded-md font-heading font-bold text-sm tracking-wider uppercase mt-8 hover:bg-nick-gold transition-colors glow-yellow">
                <Phone className="w-4 h-4" />
                DESCRIBE YOUR PROBLEM
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
                    <motion.p
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      className="mt-4 ml-8 text-foreground/70 leading-relaxed text-base"
                    >
                      {p.answer}
                    </motion.p>
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
    <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-background/95 backdrop-blur-md border-t border-nick-yellow/30 p-3">
      <a href="tel:2168620005" className="flex items-center justify-center gap-2 bg-nick-yellow text-nick-dark w-full py-3.5 rounded-md font-heading font-bold text-base tracking-wider uppercase glow-yellow">
        <Phone className="w-5 h-5" />
        CALL (216) 862-0005
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
              <p>Euclid, OH</p>
              <p>East Cleveland, OH</p>
              <p>South Euclid, OH</p>
              <p>Richmond Heights, OH</p>
              <p>Northeast Ohio</p>
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
export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <NotificationBar />
      <Navbar />
      <main>
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
