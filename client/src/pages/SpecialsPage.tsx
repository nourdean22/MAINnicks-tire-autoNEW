/**
 * /specials — Coupons & Special Offers page
 * Shows active promotions with countdown timers and mobile-friendly "show this coupon" display.
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { Link } from "wouter";
import NotificationBar from "@/components/NotificationBar";
import SearchBar from "@/components/SearchBar";
import { SEOHead, Breadcrumbs, SkipToContent, trackPhoneClick } from "@/components/SEO";
import { Phone, MapPin, Clock, Menu, X, Tag, Timer, Gift, Percent, ChevronRight, Copy, Check, Scissors } from "lucide-react";
import { motion, useInView, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";

function FadeIn({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 30 }} animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }} transition={{ duration: 0.5, delay, ease: "easeOut" }} className={className}>
      {children}
    </motion.div>
  );
}

function SpecialsNavbar() {
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
    { label: "Reviews", href: "/reviews" },
    { label: "Specials", href: "/specials" },
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
            <Link key={l.href} href={l.href} className={`font-heading text-sm tracking-widest uppercase transition-colors ${l.href === "/specials" ? "text-nick-yellow" : "text-foreground/80 hover:text-nick-yellow"}`}>
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

// ─── COUNTDOWN TIMER ───────────────────────────────────
function CountdownTimer({ expiresAt }: { expiresAt: string | Date | null }) {
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!expiresAt) return;
    const target = new Date(expiresAt).getTime();

    const tick = () => {
      const now = Date.now();
      const diff = target - now;
      if (diff <= 0) {
        setExpired(true);
        return;
      }
      setTimeLeft({
        days: Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
        minutes: Math.floor((diff / (1000 * 60)) % 60),
        seconds: Math.floor((diff / 1000) % 60),
      });
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  if (!expiresAt) return null;
  if (expired) return <span className="font-mono text-red-400 text-xs tracking-wider">EXPIRED</span>;

  return (
    <div className="flex items-center gap-1.5 text-nick-teal">
      <Timer className="w-3.5 h-3.5" />
      <div className="flex gap-1 font-mono text-xs tracking-wider">
        {timeLeft.days > 0 && <span className="bg-nick-teal/10 px-1.5 py-0.5 rounded">{timeLeft.days}d</span>}
        <span className="bg-nick-teal/10 px-1.5 py-0.5 rounded">{String(timeLeft.hours).padStart(2, "0")}h</span>
        <span className="bg-nick-teal/10 px-1.5 py-0.5 rounded">{String(timeLeft.minutes).padStart(2, "0")}m</span>
        <span className="bg-nick-teal/10 px-1.5 py-0.5 rounded">{String(timeLeft.seconds).padStart(2, "0")}s</span>
      </div>
    </div>
  );
}

// ─── COUPON CARD ───────────────────────────────────────
function CouponCard({ coupon }: { coupon: any }) {
  const [showCoupon, setShowCoupon] = useState(false);
  const [copied, setCopied] = useState(false);

  const discountDisplay = coupon.discountType === "dollar"
    ? `$${coupon.discountValue} OFF`
    : coupon.discountType === "percent"
    ? `${coupon.discountValue}% OFF`
    : "FREE";

  const copyCode = () => {
    if (coupon.code) {
      navigator.clipboard.writeText(coupon.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className={`relative border ${coupon.isFeatured ? "border-nick-yellow/50" : "border-nick-yellow/15"} bg-nick-dark/50 overflow-hidden`}>
      {coupon.isFeatured && (
        <div className="absolute top-0 right-0 bg-nick-yellow text-nick-dark px-3 py-1 font-heading font-bold text-xs tracking-wider">
          FEATURED
        </div>
      )}

      {/* Dashed border coupon effect */}
      <div className="p-6 lg:p-8">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="font-heading font-bold text-nick-yellow text-3xl lg:text-4xl tracking-tight">
              {discountDisplay}
            </div>
            <h3 className="font-heading font-bold text-foreground text-lg lg:text-xl tracking-wider mt-2 uppercase">
              {coupon.title}
            </h3>
          </div>
          <div className="shrink-0 w-14 h-14 bg-nick-yellow/10 flex items-center justify-center rounded-md">
            {coupon.discountType === "percent" ? <Percent className="w-7 h-7 text-nick-yellow" /> : coupon.discountType === "free" ? <Gift className="w-7 h-7 text-nick-yellow" /> : <Tag className="w-7 h-7 text-nick-yellow" />}
          </div>
        </div>

        <p className="text-foreground/70 leading-relaxed mb-4">{coupon.description}</p>

        {coupon.applicableServices !== "all" && (
          <p className="text-nick-teal text-sm font-mono mb-3">
            Applies to: {coupon.applicableServices}
          </p>
        )}

        {coupon.expiresAt && (
          <div className="mb-4">
            <CountdownTimer expiresAt={coupon.expiresAt} />
          </div>
        )}

        {coupon.terms && (
          <p className="text-foreground/40 text-xs mb-4 italic">{coupon.terms}</p>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          {coupon.code && (
            <button
              onClick={copyCode}
              className="flex items-center justify-center gap-2 border border-dashed border-nick-yellow/50 bg-nick-yellow/5 px-4 py-2.5 font-mono text-nick-yellow text-sm tracking-wider hover:bg-nick-yellow/10 transition-colors"
            >
              <Scissors className="w-4 h-4" />
              {copied ? "COPIED!" : coupon.code}
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          )}
          <button
            onClick={() => setShowCoupon(true)}
            className="flex items-center justify-center gap-2 bg-nick-yellow text-nick-dark px-6 py-2.5 font-heading font-bold text-sm tracking-wider uppercase hover:bg-nick-gold transition-colors"
          >
            SHOW THIS COUPON
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Full-screen coupon display for in-shop use */}
      <AnimatePresence>
        {showCoupon && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-white flex flex-col items-center justify-center p-8 text-center"
            onClick={() => setShowCoupon(false)}
          >
            <div className="max-w-md w-full">
              <div className="w-16 h-16 bg-nick-yellow mx-auto flex items-center justify-center rounded-md mb-6">
                <span className="font-heading font-bold text-nick-dark text-2xl">N</span>
              </div>
              <h2 className="font-heading font-bold text-nick-dark text-2xl tracking-wider mb-2">NICK'S TIRE & AUTO</h2>
              <div className="caution-stripe h-2 w-full my-4" />
              <div className="font-heading font-bold text-nick-dark text-5xl tracking-tight my-6">
                {discountDisplay}
              </div>
              <h3 className="font-heading font-bold text-nick-dark text-xl tracking-wider uppercase mb-3">
                {coupon.title}
              </h3>
              <p className="text-gray-600 mb-4">{coupon.description}</p>
              {coupon.code && (
                <div className="border-2 border-dashed border-nick-dark/30 px-6 py-3 inline-block font-mono text-nick-dark text-xl tracking-widest mb-4">
                  {coupon.code}
                </div>
              )}
              {coupon.terms && <p className="text-gray-400 text-xs mt-4">{coupon.terms}</p>}
              <p className="text-gray-400 text-sm mt-6">Tap anywhere to close</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── HARDCODED SEASONAL SPECIALS (always shown) ────────
const SEASONAL_SPECIALS = [
  {
    id: -1,
    title: "Spring Brake Inspection",
    description: "Winter roads take a toll on your brakes. Get a free visual brake inspection this spring. We check pads, rotors, calipers, and brake lines — and show you exactly what we find.",
    discountType: "free" as const,
    discountValue: 0,
    code: null,
    applicableServices: "Brakes",
    terms: "Visual inspection only. Additional diagnostics may apply.",
    isFeatured: 1,
    expiresAt: null,
  },
  {
    id: -2,
    title: "Oil Change Special",
    description: "Conventional oil change with filter replacement. Quick, affordable, done right. Includes a complimentary multi-point vehicle inspection.",
    discountType: "dollar" as const,
    discountValue: 10,
    code: "OIL10",
    applicableServices: "Oil Change",
    terms: "Conventional oil only. Synthetic upgrade available at additional cost.",
    isFeatured: 0,
    expiresAt: null,
  },
  {
    id: -3,
    title: "Check Engine Light Diagnostic",
    description: "Check engine light on? Do not ignore it. We use advanced OBD-II diagnostics to pinpoint the exact cause — no guessing, no unnecessary repairs.",
    discountType: "dollar" as const,
    discountValue: 25,
    code: "DIAG25",
    applicableServices: "Diagnostics",
    terms: "Diagnostic fee applied toward repair if service is performed.",
    isFeatured: 0,
    expiresAt: null,
  },
  {
    id: -4,
    title: "Refer a Friend — Both Save $25",
    description: "Know someone who needs honest auto repair? Refer them to Nick's and you both get $25 off your next service. Real rewards for real trust.",
    discountType: "dollar" as const,
    discountValue: 25,
    code: "REFER25",
    applicableServices: "all",
    terms: "Referee must be a new customer. Both parties receive $25 off services of $75+.",
    isFeatured: 0,
    expiresAt: null,
  },
];

export default function SpecialsPage() {
  const { data: dbCoupons, isLoading } = trpc.coupons.active.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Merge DB coupons with seasonal specials, DB coupons first
  const allCoupons = useMemo(() => {
    const db = dbCoupons ?? [];
    // Filter out expired DB coupons
    const activeDbs = db.filter((c: any) => !c.expiresAt || new Date(c.expiresAt).getTime() > Date.now());
    return [...activeDbs, ...SEASONAL_SPECIALS];
  }, [dbCoupons]);

  const featuredCoupons = allCoupons.filter((c: any) => c.isFeatured);
  const regularCoupons = allCoupons.filter((c: any) => !c.isFeatured);

  return (
    <div className="min-h-screen flex flex-col">
      <SEOHead
        title="Specials & Coupons | Nick's Tire & Auto — Cleveland Auto Repair Deals"
        description="Save on auto repair at Nick's Tire & Auto in Cleveland. Current specials on brakes, oil changes, diagnostics, tires, and more. Print or show coupons on your phone."
        canonicalPath="/specials"
      />
      <SkipToContent />
      <NotificationBar />
      <SpecialsNavbar />

      <main id="main-content">
        {/* Hero */}
        <section className="relative pt-32 lg:pt-40 pb-16 lg:pb-20 bg-background">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--nick-yellow-alpha)_0%,_transparent_60%)] opacity-20" />
          <div className="relative container">
            <Breadcrumbs items={[{ label: "Specials & Coupons" }]} />
            <FadeIn>
              <div className="flex items-center gap-3 mb-4">
                <Tag className="w-6 h-6 text-nick-yellow" />
                <span className="font-mono text-nick-teal text-sm tracking-widest uppercase">Current Offers</span>
              </div>
              <h1 className="font-heading font-bold text-4xl sm:text-5xl lg:text-7xl text-foreground tracking-tight leading-[0.95]">
                SPECIALS &<br />
                <span className="text-gradient-yellow">COUPONS</span>
              </h1>
              <p className="mt-6 text-foreground/70 text-lg max-w-2xl leading-relaxed">
                Honest auto repair at fair prices — plus these current specials. Show any coupon on your phone at the shop or mention the code when you call.
              </p>
            </FadeIn>
          </div>
        </section>

        {/* Featured Specials */}
        {featuredCoupons.length > 0 && (
          <section className="py-12 lg:py-16 bg-background">
            <div className="container">
              <FadeIn>
                <span className="font-mono text-nick-yellow text-sm tracking-widest uppercase">Featured Deal</span>
              </FadeIn>
              <div className="mt-6 grid grid-cols-1 gap-6">
                {featuredCoupons.map((c: any) => (
                  <FadeIn key={c.id}>
                    <CouponCard coupon={c} />
                  </FadeIn>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* All Specials Grid */}
        <section className="py-12 lg:py-16 section-darker">
          <div className="caution-stripe h-2 w-full" />
          <div className="container pt-12">
            <FadeIn>
              <span className="font-mono text-nick-teal text-sm tracking-widest uppercase">All Current Specials</span>
              <h2 className="font-heading font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight">
                SAVE ON YOUR NEXT REPAIR
              </h2>
            </FadeIn>

            {isLoading ? (
              <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-6">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="border border-nick-yellow/10 bg-nick-dark/30 p-8 animate-pulse">
                    <div className="h-8 w-32 bg-nick-yellow/10 rounded mb-4" />
                    <div className="h-5 w-48 bg-foreground/10 rounded mb-3" />
                    <div className="h-4 w-full bg-foreground/5 rounded mb-2" />
                    <div className="h-4 w-3/4 bg-foreground/5 rounded" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-6">
                {regularCoupons.map((c: any, i: number) => (
                  <FadeIn key={c.id} delay={i * 0.05}>
                    <CouponCard coupon={c} />
                  </FadeIn>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* How to Redeem */}
        <section className="py-16 lg:py-20 bg-background">
          <div className="container">
            <FadeIn>
              <h2 className="font-heading font-bold text-3xl lg:text-4xl text-foreground tracking-tight text-center">
                HOW TO <span className="text-gradient-yellow">REDEEM</span>
              </h2>
            </FadeIn>
            <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
              {[
                { num: "01", title: "Choose Your Deal", desc: "Browse our current specials above and find the one that fits your needs." },
                { num: "02", title: "Show or Mention", desc: "Show the coupon on your phone at the shop, or mention the code when you call to book." },
                { num: "03", title: "Save Money", desc: "The discount is applied to your service. No hidden fees, no catches." },
              ].map((step, i) => (
                <FadeIn key={step.num} delay={i * 0.1}>
                  <div className="text-center">
                    <span className="font-heading font-bold text-5xl text-nick-yellow/20">{step.num}</span>
                    <h3 className="font-heading font-bold text-foreground text-lg tracking-wider uppercase mt-2">{step.title}</h3>
                    <p className="text-foreground/60 mt-2 leading-relaxed">{step.desc}</p>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 lg:py-20 section-darker">
          <div className="container text-center">
            <FadeIn>
              <h2 className="font-heading font-bold text-3xl lg:text-5xl text-foreground tracking-tight">
                READY TO <span className="text-gradient-yellow">SAVE</span>?
              </h2>
              <p className="mt-4 text-foreground/70 text-lg max-w-xl mx-auto">
                Call us or book online to schedule your service. Mention any coupon code and we will apply the discount.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
                <a
                  href="tel:2168620005"
                  onClick={() => trackPhoneClick("specials_cta")}
                  className="inline-flex items-center justify-center gap-2 bg-nick-yellow text-nick-dark px-8 py-4 font-heading font-bold text-lg tracking-wider uppercase hover:bg-nick-gold transition-colors glow-yellow"
                >
                  <Phone className="w-5 h-5" />
                  CALL NOW
                </a>
                <Link
                  href="/contact"
                  className="inline-flex items-center justify-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 font-heading font-bold text-lg tracking-wider uppercase hover:border-nick-yellow hover:text-nick-yellow transition-colors"
                >
                  BOOK ONLINE
                  <ChevronRight className="w-5 h-5" />
                </Link>
              </div>
            </FadeIn>
          </div>
        </section>

        {/* Footer */}
        <footer className="bg-background border-t border-nick-yellow/10 py-12 lg:py-16">
          <div className="container">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10">
              <div>
                <Link href="/" className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 bg-nick-yellow flex items-center justify-center rounded-md">
                    <span className="font-heading font-bold text-nick-dark text-sm">N</span>
                  </div>
                  <span className="font-heading font-bold text-nick-yellow tracking-wider">NICK'S TIRE & AUTO</span>
                </Link>
                <p className="text-foreground/50 text-sm leading-relaxed">
                  Honest auto repair and tire services for Cleveland, Euclid, and Northeast Ohio.
                </p>
              </div>
              <div>
                <h4 className="font-heading font-bold text-nick-teal tracking-wider text-sm uppercase mb-4">Services</h4>
                <div className="space-y-2 text-sm text-foreground/50">
                  <p><Link href="/tires" className="hover:text-nick-yellow transition-colors">Tires & Tire Repair</Link></p>
                  <p><Link href="/brakes" className="hover:text-nick-yellow transition-colors">Brake Repair</Link></p>
                  <p><Link href="/diagnostics" className="hover:text-nick-yellow transition-colors">Check Engine Light</Link></p>
                  <p><Link href="/emissions" className="hover:text-nick-yellow transition-colors">Ohio E-Check</Link></p>
                  <p><Link href="/oil-change" className="hover:text-nick-yellow transition-colors">Oil Changes</Link></p>
                </div>
              </div>
              <div>
                <h4 className="font-heading font-bold text-nick-teal tracking-wider text-sm uppercase mb-4">Quick Links</h4>
                <div className="space-y-2 text-sm text-foreground/50">
                  <p><Link href="/specials" className="hover:text-nick-yellow transition-colors">Specials & Coupons</Link></p>
                  <p><Link href="/reviews" className="hover:text-nick-yellow transition-colors">Customer Reviews</Link></p>
                  <p><Link href="/diagnose" className="hover:text-nick-yellow transition-colors">Diagnose My Car</Link></p>
                  <p><Link href="/blog" className="hover:text-nick-yellow transition-colors">Auto Repair Blog</Link></p>
                  <p><Link href="/contact" className="hover:text-nick-yellow transition-colors">Contact Us</Link></p>
                </div>
              </div>
              <div>
                <h4 className="font-heading font-bold text-nick-teal tracking-wider text-sm uppercase mb-4">Contact</h4>
                <div className="space-y-3 text-sm text-foreground/50">
                  <div className="flex items-start gap-2">
                    <MapPin className="w-4 h-4 text-nick-yellow mt-0.5 shrink-0" />
                    <span>17625 Euclid Ave<br />Cleveland, OH 44112</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-nick-yellow shrink-0" />
                    <a href="tel:2168620005" className="hover:text-nick-yellow transition-colors">(216) 862-0005</a>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-nick-yellow shrink-0" />
                    <span>Mon–Sat 9AM–6PM</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-12 pt-8 border-t border-nick-yellow/10 flex flex-col sm:flex-row items-center justify-between gap-4">
              <p className="text-foreground/30 text-xs font-mono">&copy; {new Date().getFullYear()} NICK'S TIRE & AUTO. ALL RIGHTS RESERVED.</p>
              <a href="tel:2168620005" className="text-nick-yellow font-mono text-sm hover:text-nick-gold transition-colors">(216) 862-0005</a>
            </div>
          </div>
        </footer>
      </main>

      <MobileCTA />
    </div>
  );
}
