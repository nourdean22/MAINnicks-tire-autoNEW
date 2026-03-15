/*
 * DESIGN: Industrial Grit — Cleveland Blue-Collar Authenticity
 * Dark charcoal bg, Nick's signature yellow accents, Oswald headlines
 * Full-bleed sections like shop bays, caution-stripe dividers
 */

import { useState, useEffect, useRef } from "react";
import { Phone, MapPin, Clock, Star, ChevronRight, Wrench, Shield, Gauge, Zap, Droplets, ThermometerSun, Menu, X } from "lucide-react";
import { motion, useInView } from "framer-motion";

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

function CautionStripe() {
  return <div className="caution-stripe h-2 w-full" />;
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
    { label: "Contact", href: "#contact" },
  ];

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? "bg-nick-dark/95 backdrop-blur-md shadow-lg" : "bg-transparent"}`}>
      <div className="container flex items-center justify-between h-16 lg:h-20">
        <a href="#" className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary flex items-center justify-center rounded-sm">
            <span className="font-heading font-bold text-primary-foreground text-lg">N</span>
          </div>
          <div className="flex flex-col">
            <span className="font-heading font-bold text-primary text-lg leading-tight tracking-wide">NICK'S TIRE & AUTO</span>
            <span className="text-muted-foreground text-xs tracking-widest uppercase">Cleveland, Ohio</span>
          </div>
        </a>

        {/* Desktop nav */}
        <div className="hidden lg:flex items-center gap-8">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="font-heading text-sm tracking-widest uppercase text-foreground/80 hover:text-primary transition-colors">
              {l.label}
            </a>
          ))}
          <a href="tel:2168620005" className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 font-heading font-bold text-sm tracking-wider uppercase hover:bg-primary/90 transition-colors">
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
        <div className="lg:hidden bg-nick-dark/98 backdrop-blur-md border-t border-border">
          <div className="container py-6 flex flex-col gap-4">
            {links.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setMobileOpen(false)} className="font-heading text-lg tracking-widest uppercase text-foreground/80 hover:text-primary transition-colors py-2">
                {l.label}
              </a>
            ))}
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

// ─── HERO ──────────────────────────────────────────────
function Hero() {
  return (
    <section className="relative min-h-[100svh] flex items-end overflow-hidden">
      {/* Background image */}
      <div className="absolute inset-0">
        <img src={HERO_IMG} alt="Nick's Tire & Auto shop interior" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-nick-dark via-nick-dark/70 to-nick-dark/30" />
      </div>

      <div className="relative container pb-16 pt-32 lg:pb-24">
        <FadeIn>
          <div className="flex items-center gap-3 mb-6">
            <div className="flex gap-0.5">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="w-5 h-5 fill-primary text-primary" />
              ))}
            </div>
            <span className="font-mono text-sm text-primary tracking-wider">4.9 STARS — 1,683+ REVIEWS</span>
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
            <a href="tel:2168620005" className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-heading font-bold text-lg tracking-wider uppercase hover:bg-primary/90 transition-colors">
              <Phone className="w-5 h-5" />
              CALL NOW
            </a>
            <a href="#services" className="inline-flex items-center justify-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 font-heading font-bold text-lg tracking-wider uppercase hover:border-primary hover:text-primary transition-colors">
              OUR SERVICES
              <ChevronRight className="w-5 h-5" />
            </a>
          </div>
        </FadeIn>

        <FadeIn delay={0.4}>
          <div className="mt-12 flex flex-wrap gap-6 text-sm text-foreground/60">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-primary" />
              <span className="font-mono">17625 Euclid Ave, Cleveland, OH 44112</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              <span className="font-mono">Mon–Sat 9AM–6PM</span>
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
    desc: "New and used tires. Mounting, balancing, rotation, TPMS sensors, and flat repair. We carry all major brands at fair prices.",
    icon: <Gauge className="w-7 h-7" />,
    img: TIRES_IMG,
  },
  {
    num: "02",
    title: "BRAKES",
    desc: "Brake pads, rotors, calipers, brake lines, and ABS diagnostics. We show you the problem before we fix it. Every time.",
    icon: <Shield className="w-7 h-7" />,
    img: BRAKES_IMG,
  },
  {
    num: "03",
    title: "DIAGNOSTICS",
    desc: "Check engine light, OBD-II code reading, advanced computer diagnostics. We pinpoint the exact cause so you only pay for what you need.",
    icon: <Zap className="w-7 h-7" />,
    img: DIAG_IMG,
  },
  {
    num: "04",
    title: "EMISSIONS & E-CHECK",
    desc: "Failed Ohio E-Check? We diagnose and repair emissions problems — oxygen sensors, EVAP leaks, catalytic converters — and get you passing.",
    icon: <ThermometerSun className="w-7 h-7" />,
  },
  {
    num: "05",
    title: "OIL CHANGE",
    desc: "Conventional and synthetic oil changes with filter replacement. Quick, affordable, done right.",
    icon: <Droplets className="w-7 h-7" />,
  },
  {
    num: "06",
    title: "GENERAL REPAIR",
    desc: "Suspension, steering, exhaust, cooling systems, belts, hoses, and more. If it is broken, we fix it.",
    icon: <Wrench className="w-7 h-7" />,
  },
];

function Services() {
  return (
    <section id="services" className="section-darker py-20 lg:py-28">
      <CautionStripe />
      <div className="container pt-16">
        <FadeIn>
          <span className="font-mono text-primary text-sm tracking-widest uppercase">What We Do</span>
          <h2 className="font-heading font-bold text-4xl lg:text-6xl text-foreground mt-3 tracking-tight">
            OUR SERVICES
          </h2>
        </FadeIn>

        <div className="mt-14 grid grid-cols-1 lg:grid-cols-2 gap-0">
          {services.map((s, i) => (
            <FadeIn key={s.num} delay={i * 0.08}>
              <div className="group relative border border-border/50 p-8 lg:p-10 hover:bg-card/50 transition-colors overflow-hidden">
                {s.img && (
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity duration-500">
                    <img src={s.img} alt="" className="w-full h-full object-cover" />
                  </div>
                )}
                <div className="relative">
                  <div className="flex items-start justify-between mb-6">
                    <span className="font-heading font-bold text-5xl lg:text-6xl text-border/60 leading-none">{s.num}</span>
                    <div className="text-primary">{s.icon}</div>
                  </div>
                  <h3 className="font-heading font-bold text-2xl lg:text-3xl text-foreground tracking-wider mb-4">{s.title}</h3>
                  <p className="text-foreground/70 leading-relaxed text-base">{s.desc}</p>
                </div>
              </div>
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
              <img src={DIAG_IMG} alt="Technician performing vehicle diagnostics" className="w-full aspect-[4/3] object-cover" />
              <div className="absolute -bottom-4 -right-4 bg-primary p-6">
                <span className="font-heading font-bold text-3xl text-primary-foreground">4.9</span>
                <div className="flex gap-0.5 mt-1">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-primary-foreground text-primary-foreground" />
                  ))}
                </div>
                <span className="font-mono text-xs text-primary-foreground/80 mt-1 block">1,683+ REVIEWS</span>
              </div>
            </div>
          </FadeIn>

          <FadeIn delay={0.15}>
            <div>
              <span className="font-mono text-primary text-sm tracking-widest uppercase">Why Drivers Choose Us</span>
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
                  { label: "Honest Diagnostics", detail: "We explain every code and every repair in plain language." },
                  { label: "Fair Pricing", detail: "No hidden fees. No surprise charges. The price we quote is the price you pay." },
                  { label: "Experienced Team", detail: "Our technicians handle everything from basic maintenance to complex diagnostics." },
                  { label: "Cleveland Proud", detail: "Locally owned, serving Euclid and Northeast Ohio drivers every day." },
                ].map((item) => (
                  <div key={item.label} className="border-l-2 border-primary pl-4">
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

// ─── REVIEWS ───────────────────────────────────────────
const reviews = [
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
  return (
    <section id="reviews" className="section-darker py-20 lg:py-28">
      <CautionStripe />
      <div className="container pt-16">
        <FadeIn>
          <span className="font-mono text-primary text-sm tracking-widest uppercase">Real Customers, Real Words</span>
          <h2 className="font-heading font-bold text-4xl lg:text-6xl text-foreground mt-3 tracking-tight">
            1,683+ REVIEWS
          </h2>
          <p className="mt-4 text-foreground/60 text-lg max-w-2xl">
            We do not write our own reviews. These are real words from real Cleveland drivers.
          </p>
        </FadeIn>

        <div className="mt-14 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {reviews.map((r, i) => (
            <FadeIn key={r.name} delay={i * 0.08}>
              <div className="bg-card border border-border/50 p-8 h-full flex flex-col">
                <div className="flex gap-0.5 mb-4">
                  {[...Array(r.stars)].map((_, j) => (
                    <Star key={j} className="w-4 h-4 fill-primary text-primary" />
                  ))}
                </div>
                <p className="text-foreground/80 leading-relaxed flex-1 italic">"{r.text}"</p>
                <div className="mt-6 pt-4 border-t border-border/30">
                  <span className="font-heading font-bold text-foreground tracking-wider text-sm uppercase">{r.name}</span>
                  <span className="block text-muted-foreground text-xs font-mono mt-0.5">GOOGLE REVIEW</span>
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── COMMON PROBLEMS ───────────────────────────────────
const problems = [
  {
    question: "Check engine light on?",
    answer: "Many check engine lights are caused by oxygen sensors, EVAP leaks, or catalytic converter problems. Our technicians use advanced OBD-II diagnostics to pinpoint the exact cause — so you only pay for the repair you actually need.",
  },
  {
    question: "Failed Ohio E-Check?",
    answer: "Emissions failures are usually caused by faulty sensors, exhaust leaks, or incomplete drive cycles. We diagnose the root cause, make the repair, and ensure all monitors complete so your vehicle passes inspection.",
  },
  {
    question: "Brakes squealing or grinding?",
    answer: "Squealing usually means your brake pads are worn down to the wear indicator. Grinding means metal-on-metal contact with the rotor. Either way, do not wait — brake problems get more expensive the longer you drive on them.",
  },
  {
    question: "Car shaking while driving?",
    answer: "Vibrations at highway speed usually point to unbalanced tires or worn suspension components. Shaking when braking typically means warped rotors. We diagnose the exact cause before recommending any repair.",
  },
  {
    question: "AC blowing warm air?",
    answer: "Low refrigerant, a failing compressor, or a clogged condenser are the most common causes. We check the entire system, find the leak or failure, and get your AC working properly.",
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
              <span className="font-mono text-primary text-sm tracking-widest uppercase">Common Problems</span>
              <h2 className="font-heading font-bold text-4xl lg:text-5xl text-foreground mt-3 tracking-tight leading-[1.05]">
                WHAT'S WRONG<br />
                <span className="text-gradient-yellow">WITH MY CAR?</span>
              </h2>
              <p className="mt-6 text-foreground/70 leading-relaxed text-lg">
                If something does not feel right, it probably is not. Here are the most common problems Cleveland drivers bring to us — and how we fix them.
              </p>
              <a href="tel:2168620005" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-heading font-bold text-sm tracking-wider uppercase mt-8 hover:bg-primary/90 transition-colors">
                <Phone className="w-4 h-4" />
                DESCRIBE YOUR PROBLEM
              </a>
            </div>
          </FadeIn>

          <div className="flex flex-col gap-0">
            {problems.map((p, i) => (
              <FadeIn key={i} delay={i * 0.06}>
                <button
                  onClick={() => setOpen(open === i ? null : i)}
                  className="w-full text-left border-b border-border/30 py-6 group"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-heading font-bold text-lg lg:text-xl text-foreground tracking-wider group-hover:text-primary transition-colors">
                      {p.question}
                    </h3>
                    <ChevronRight className={`w-5 h-5 text-primary transition-transform duration-200 ${open === i ? "rotate-90" : ""}`} />
                  </div>
                  {open === i && (
                    <motion.p
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      className="mt-4 text-foreground/70 leading-relaxed text-base"
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
      <CautionStripe />
      <div className="container pt-16">
        <FadeIn>
          <span className="font-mono text-primary text-sm tracking-widest uppercase">Find Us</span>
          <h2 className="font-heading font-bold text-4xl lg:text-6xl text-foreground mt-3 tracking-tight">
            COME SEE US
          </h2>
        </FadeIn>

        <div className="mt-14 grid grid-cols-1 lg:grid-cols-2 gap-12">
          <FadeIn delay={0.1}>
            <div className="space-y-8">
              <div>
                <h3 className="font-heading font-bold text-xl text-foreground tracking-wider mb-4">LOCATION</h3>
                <div className="flex items-start gap-3">
                  <MapPin className="w-5 h-5 text-primary mt-1 shrink-0" />
                  <div>
                    <p className="font-mono text-foreground/80">17625 Euclid Ave</p>
                    <p className="font-mono text-foreground/80">Cleveland, OH 44112</p>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-heading font-bold text-xl text-foreground tracking-wider mb-4">HOURS</h3>
                <div className="flex items-start gap-3">
                  <Clock className="w-5 h-5 text-primary mt-1 shrink-0" />
                  <div className="font-mono text-foreground/80 space-y-1">
                    <p>Monday – Friday: 9:00 AM – 6:00 PM</p>
                    <p>Saturday: 9:00 AM – 5:00 PM</p>
                    <p>Sunday: Closed</p>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-heading font-bold text-xl text-foreground tracking-wider mb-4">CONTACT</h3>
                <a href="tel:2168620005" className="flex items-center gap-3 group">
                  <Phone className="w-5 h-5 text-primary shrink-0" />
                  <span className="font-mono text-2xl text-foreground group-hover:text-primary transition-colors">(216) 862-0005</span>
                </a>
              </div>

              <a
                href="https://www.google.com/maps/dir//Nick's+Tire+And+Auto+Euclid,+17625+Euclid+Ave,+Cleveland,+OH+44112"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-heading font-bold text-sm tracking-wider uppercase hover:bg-primary/90 transition-colors"
              >
                <MapPin className="w-4 h-4" />
                GET DIRECTIONS
              </a>
            </div>
          </FadeIn>

          <FadeIn delay={0.2}>
            <div className="w-full aspect-[4/3] bg-card border border-border/50 overflow-hidden">
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
    <div className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-nick-dark/95 backdrop-blur-md border-t border-primary/30 p-3">
      <a href="tel:2168620005" className="flex items-center justify-center gap-2 bg-primary text-primary-foreground w-full py-3.5 font-heading font-bold text-base tracking-wider uppercase">
        <Phone className="w-5 h-5" />
        CALL (216) 862-0005
      </a>
    </div>
  );
}

// ─── FOOTER ────────────────────────────────────────────
function Footer() {
  return (
    <footer className="section-dark border-t border-border/30">
      <CautionStripe />
      <div className="container py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 bg-primary flex items-center justify-center rounded-sm">
                <span className="font-heading font-bold text-primary-foreground text-sm">N</span>
              </div>
              <span className="font-heading font-bold text-primary tracking-wider">NICK'S TIRE & AUTO</span>
            </div>
            <p className="text-foreground/50 text-sm leading-relaxed">
              Honest auto repair and tire services for Cleveland, Euclid, and Northeast Ohio. Fair prices, real diagnostics, no surprises.
            </p>
          </div>

          <div>
            <h4 className="font-heading font-bold text-foreground tracking-wider text-sm uppercase mb-4">Services</h4>
            <div className="space-y-2 text-sm text-foreground/50">
              <p>Tires &amp; Tire Repair</p>
              <p>Brake Repair</p>
              <p>Check Engine Light Diagnostics</p>
              <p>Ohio E-Check &amp; Emissions Repair</p>
              <p>Oil Changes</p>
              <p>Suspension &amp; Steering</p>
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

// ─── PAGE ──────────────────────────────────────────────
export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main>
        <Hero />
        <Services />
        <About />
        <Reviews />
        <CommonProblems />
        <Contact />
      </main>
      <Footer />
      <MobileCTA />
    </div>
  );
}
