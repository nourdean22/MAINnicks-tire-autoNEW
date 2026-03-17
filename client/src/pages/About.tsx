/**
 * Standalone /about page for Nick's Tire & Auto
 * Business story, philosophy, team overview, and trust signals.
 */

import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import NotificationBar from "@/components/NotificationBar";
import SearchBar from "@/components/SearchBar";
import { Phone, MapPin, Clock, Star, Menu, X, Shield, Wrench, Users, Award, CheckCircle } from "lucide-react";
import { motion, useInView } from "framer-motion";
import { trpc } from "@/lib/trpc";

const HERO_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-main-DE7GKwfCThaBL66r78QWkU.webp";
const DIAG_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-diagnostics-AN7H3iz5Tow2ab2METgner.webp";

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

function AboutNavbar() {
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
            <Link key={l.href} href={l.href} className={`font-heading text-sm tracking-widest uppercase transition-colors ${l.href === "/about" ? "text-nick-yellow" : "text-foreground/80 hover:text-nick-yellow"}`}>
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

export default function About() {
  const { data: googleData } = trpc.reviews.google.useQuery(undefined, {
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
  const rating = googleData?.rating ?? 4.9;
  const totalReviews = googleData?.totalReviews ?? 1683;

  useEffect(() => {
    document.title = "About Nick's Tire & Auto | Cleveland's Trusted Auto Repair Shop Since Day One";
    const metaDesc = document.querySelector('meta[name="description"]');
    const content = "Learn about Nick's Tire & Auto, Cleveland's trusted independent auto repair shop. Honest diagnostics, fair pricing, and experienced technicians serving Euclid Ave and Northeast Ohio.";
    if (metaDesc) {
      metaDesc.setAttribute("content", content);
    } else {
      const meta = document.createElement("meta");
      meta.name = "description";
      meta.content = content;
      document.head.appendChild(meta);
    }
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <NotificationBar />
      <AboutNavbar />

      <main>
        {/* Hero */}
        <section className="relative pt-32 lg:pt-40 pb-20 lg:pb-28 overflow-hidden">
          <div className="absolute inset-0">
            <img src={HERO_IMG} alt="Inside Nick's Tire & Auto shop in Cleveland" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-background/50" />
          </div>
          <div className="relative container">
            <FadeIn>
              <span className="font-mono text-nick-teal text-sm tracking-widest uppercase">Our Story</span>
              <h1 className="font-heading font-bold text-4xl sm:text-5xl lg:text-7xl text-foreground mt-3 tracking-tight leading-[0.95]">
                ABOUT <span className="text-gradient-yellow">NICK'S</span><br />
                TIRE & AUTO
              </h1>
              <p className="mt-6 text-lg sm:text-xl text-foreground/70 max-w-2xl leading-relaxed">
                An independent auto repair shop on Euclid Avenue in Cleveland, built on a simple idea: show drivers the problem before you fix it, charge a fair price, and earn their trust one repair at a time.
              </p>
            </FadeIn>

            <FadeIn delay={0.2}>
              <div className="mt-8 flex items-center gap-4">
                <div className="flex gap-0.5">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-5 h-5 fill-nick-yellow text-nick-yellow" />
                  ))}
                </div>
                <span className="font-mono text-sm text-nick-yellow tracking-wider">{rating.toFixed(1)} STARS — {totalReviews.toLocaleString()}+ GOOGLE REVIEWS</span>
              </div>
            </FadeIn>
          </div>
        </section>

        <div className="h-1.5 w-full bg-gradient-to-r from-nick-yellow via-nick-teal to-nick-orange" />

        {/* Our Philosophy */}
        <section className="section-darker py-20 lg:py-28">
          <div className="container">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
              <FadeIn>
                <div>
                  <span className="font-mono text-nick-teal text-sm tracking-widest uppercase">Our Philosophy</span>
                  <h2 className="font-heading font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight leading-[1.05]">
                    WE SHOW YOU THE<br />
                    <span className="text-gradient-yellow">PROBLEM</span> BEFORE<br />
                    WE FIX IT
                  </h2>
                  <p className="mt-6 text-foreground/70 leading-relaxed text-lg">
                    Most shops hand you a bill and hope you do not ask questions. That is not how we operate. When you bring your vehicle to Nick's Tire & Auto, we walk you through the diagnosis step by step. We show you the worn parts. We explain your options in plain language. Then we let you decide.
                  </p>
                  <p className="mt-4 text-foreground/70 leading-relaxed text-lg">
                    No pressure. No upselling. No hidden fees. The price we quote is the price you pay. That approach has earned us {totalReviews.toLocaleString()}+ five-star reviews from Cleveland drivers who keep coming back.
                  </p>
                </div>
              </FadeIn>

              <FadeIn delay={0.15}>
                <div className="relative rounded-lg overflow-hidden">
                  <img src={DIAG_IMG} alt="Technician performing vehicle diagnostics at Nick's Tire & Auto" className="w-full aspect-[4/3] object-cover" />
                  <div className="absolute -bottom-4 -right-4 bg-nick-yellow p-6 rounded-lg glow-yellow">
                    <span className="font-heading font-bold text-3xl text-nick-dark">{rating.toFixed(1)}</span>
                    <div className="flex gap-0.5 mt-1">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} className="w-4 h-4 fill-nick-dark text-nick-dark" />
                      ))}
                    </div>
                    <span className="font-mono text-xs text-nick-dark/70 mt-1 block">{totalReviews.toLocaleString()}+ REVIEWS</span>
                  </div>
                </div>
              </FadeIn>
            </div>
          </div>
        </section>

        {/* What Sets Us Apart */}
        <section className="section-dark py-20 lg:py-28">
          <div className="h-1.5 w-full bg-gradient-to-r from-nick-teal via-nick-yellow to-nick-orange" />
          <div className="container pt-16">
            <FadeIn>
              <span className="font-mono text-nick-orange text-sm tracking-widest uppercase">What Sets Us Apart</span>
              <h2 className="font-heading font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight">
                WHY CLEVELAND DRIVERS <span className="text-gradient-yellow">TRUST US</span>
              </h2>
            </FadeIn>

            <div className="mt-14 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[
                {
                  icon: <Shield className="w-7 h-7" />,
                  title: "Honest Diagnostics",
                  desc: "We use advanced OBD-II scanners and live data analysis to pinpoint the exact problem. We test before we replace, so you never pay for parts you do not need.",
                  color: "nick-yellow",
                },
                {
                  icon: <Award className="w-7 h-7" />,
                  title: "Fair Pricing",
                  desc: "No hidden fees. No surprise charges. No bait-and-switch estimates. The price we quote is the price you pay, and we explain every line item before we start.",
                  color: "nick-teal",
                },
                {
                  icon: <Users className="w-7 h-7" />,
                  title: "Experienced Technicians",
                  desc: "Our team handles everything from basic oil changes and tire rotations to complex engine diagnostics, emissions repair, and suspension work.",
                  color: "nick-orange",
                },
                {
                  icon: <Wrench className="w-7 h-7" />,
                  title: "Full-Service Shop",
                  desc: "Tires, brakes, diagnostics, Ohio E-Check and emissions repair, oil changes, suspension, steering, exhaust, and general repair. One shop for everything your vehicle needs.",
                  color: "nick-cyan",
                },
                {
                  icon: <CheckCircle className="w-7 h-7" />,
                  title: "Warranty on Repairs",
                  desc: "We stand behind our work. Our repairs come with a warranty because we are confident in the quality of our parts and labor. If something is not right, we make it right.",
                  color: "nick-gold",
                },
                {
                  icon: <MapPin className="w-7 h-7" />,
                  title: "Cleveland Proud",
                  desc: "Locally owned and operated on Euclid Avenue. We serve Cleveland, Euclid, East Cleveland, South Euclid, Richmond Heights, and the surrounding Northeast Ohio community.",
                  color: "nick-yellow",
                },
              ].map((item, i) => (
                <FadeIn key={item.title} delay={i * 0.08}>
                  <div className="card-vibrant bg-card/80 rounded-lg p-8 h-full">
                    <div className={`text-${item.color} mb-4`}>{item.icon}</div>
                    <h3 className="font-heading font-bold text-lg text-foreground tracking-wider mb-3">{item.title}</h3>
                    <p className="text-foreground/60 text-sm leading-relaxed">{item.desc}</p>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </section>

        {/* Services Overview */}
        <section className="section-darker py-20 lg:py-28">
          <div className="container">
            <FadeIn>
              <span className="font-mono text-nick-teal text-sm tracking-widest uppercase">What We Do</span>
              <h2 className="font-heading font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight">
                OUR <span className="text-gradient-yellow">SERVICES</span>
              </h2>
              <p className="mt-4 text-foreground/60 text-lg max-w-2xl">
                From routine maintenance to complex repairs, we handle it all under one roof.
              </p>
            </FadeIn>

            <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { title: "Tires", slug: "/tires", desc: "New and used tires, mounting, balancing, rotation, TPMS sensors, flat repair" },
                { title: "Brake Repair", slug: "/brakes", desc: "Pads, rotors, calipers, brake lines, ABS diagnostics, brake fluid service" },
                { title: "Diagnostics", slug: "/diagnostics", desc: "Check engine light, OBD-II code reading, advanced computer diagnostics" },
                { title: "E-Check & Emissions", slug: "/emissions", desc: "Ohio E-Check repair, oxygen sensors, EVAP leaks, catalytic converters" },
                { title: "Oil Changes", slug: "/oil-change", desc: "Conventional and synthetic oil changes with filter replacement" },
                { title: "General Repair", slug: "/general-repair", desc: "Suspension, steering, exhaust, cooling, belts, hoses, and more" },
              ].map((s, i) => (
                <FadeIn key={s.slug} delay={i * 0.06}>
                  <Link href={s.slug} className="block card-vibrant bg-card/80 rounded-lg p-6 group h-full">
                    <h3 className="font-heading font-bold text-foreground tracking-wider mb-2 group-hover:text-nick-yellow transition-colors">
                      {s.title}
                    </h3>
                    <p className="text-foreground/50 text-sm leading-relaxed">{s.desc}</p>
                  </Link>
                </FadeIn>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="section-dark py-20 lg:py-28">
          <div className="h-1.5 w-full bg-gradient-to-r from-nick-yellow via-nick-orange to-nick-teal" />
          <div className="container pt-16 text-center">
            <FadeIn>
              <h2 className="font-heading font-bold text-3xl lg:text-5xl text-foreground tracking-tight">
                READY TO <span className="text-gradient-yellow">GET STARTED</span>?
              </h2>
              <p className="mt-4 text-foreground/60 text-lg max-w-xl mx-auto">
                Call us for a quote, schedule an appointment online, or just stop by. Walk-ins are always welcome.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
                <a href="tel:2168620005" className="inline-flex items-center justify-center gap-2 bg-nick-yellow text-nick-dark px-8 py-4 rounded-md font-heading font-bold text-lg tracking-wider uppercase hover:bg-nick-gold transition-colors glow-yellow">
                  <Phone className="w-5 h-5" />
                  CALL (216) 862-0005
                </a>
                <Link href="/contact" className="inline-flex items-center justify-center gap-2 border-2 border-nick-teal/50 text-nick-teal px-8 py-4 rounded-md font-heading font-bold text-lg tracking-wider uppercase hover:bg-nick-teal/10 hover:border-nick-teal transition-colors">
                  BOOK ONLINE
                </Link>
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
      </main>

      <MobileCTA />
    </div>
  );
}
