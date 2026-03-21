/**
 * /specials — Coupons & Special Offers page
 * Shows active promotions with countdown timers and mobile-friendly "show this coupon" display.
 */

import PageLayout from "@/components/PageLayout";
import { useState, useEffect, useRef, useMemo } from "react";
import { Link } from "wouter";
import { SEOHead, Breadcrumbs, trackPhoneClick } from "@/components/SEO";
import { Phone, Tag, Timer, Gift, Percent, ChevronRight, Copy, Check, Scissors } from "lucide-react";
import { motion, useInView, AnimatePresence } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { BUSINESS } from "@shared/business";
import InternalLinks from "@/components/InternalLinks";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import { QueryError } from "@/components/QueryState";

function FadeIn({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 30 }} animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }} transition={{ duration: 0.5, delay, ease: "easeOut" }} className={className}>
      {children}
    </motion.div>
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
    <div className="flex items-center gap-1.5 text-nick-blue-light">
      <Timer className="w-3.5 h-3.5" />
      <div className="flex gap-1 text-[12px] tracking-wider">
        {timeLeft.days > 0 && <span className="bg-nick-blue/10 px-1.5 py-0.5 rounded">{timeLeft.days}d</span>}
        <span className="bg-nick-blue/10 px-1.5 py-0.5 rounded">{String(timeLeft.hours).padStart(2, "0")}h</span>
        <span className="bg-nick-blue/10 px-1.5 py-0.5 rounded">{String(timeLeft.minutes).padStart(2, "0")}m</span>
        <span className="bg-nick-blue/10 px-1.5 py-0.5 rounded">{String(timeLeft.seconds).padStart(2, "0")}s</span>
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
    <div className={`relative border ${coupon.isFeatured ? "border-primary/50" : "border-primary/15"} bg-background/50 overflow-hidden`}>
      {coupon.isFeatured && (
        <div className="absolute top-0 right-0 bg-primary text-primary-foreground px-3 py-1 font-semibold font-bold text-xs tracking-wider">
          FEATURED
        </div>
      )}

      {/* Dashed border coupon effect */}
      <div className="p-6 lg:p-8">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="font-semibold font-bold text-primary text-3xl lg:text-4xl tracking-tight">
              {discountDisplay}
            </div>
            <h3 className="font-semibold font-bold text-foreground text-lg lg:text-xl tracking-wider mt-2 uppercase">
              {coupon.title}
            </h3>
          </div>
          <div className="shrink-0 w-14 h-14 bg-primary/10 flex items-center justify-center rounded-md">
            {coupon.discountType === "percent" ? <Percent className="w-7 h-7 text-primary" /> : coupon.discountType === "free" ? <Gift className="w-7 h-7 text-primary" /> : <Tag className="w-7 h-7 text-primary" />}
          </div>
        </div>

        <p className="text-foreground/70 leading-relaxed mb-4">{coupon.description}</p>

        {coupon.applicableServices !== "all" && (
          <p className="text-nick-blue-light text-sm mb-3">
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
              className="flex items-center justify-center gap-2 border border-dashed border-primary/50 bg-primary/5 px-4 py-2.5 text-primary text-sm tracking-wider hover:bg-primary/10 transition-colors"
            >
              <Scissors className="w-4 h-4" />
              {copied ? "COPIED!" : coupon.code}
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          )}
          <button
            onClick={() => setShowCoupon(true)}
            className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-6 py-2.5 font-semibold font-bold text-sm tracking-wide hover:opacity-90 transition-colors"
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
              <div className="w-16 h-16 bg-primary mx-auto flex items-center justify-center rounded-md mb-6">
                <span className="font-semibold font-bold text-primary-foreground text-2xl">N</span>
              </div>
              <h2 className="font-semibold font-bold text-primary-foreground text-2xl tracking-[-0.01em] mb-2">NICK'S TIRE & AUTO</h2>
              <div className="hidden" />
              <div className="font-semibold font-bold text-primary-foreground text-5xl tracking-tight my-6">
                {discountDisplay}
              </div>
              <h3 className="font-semibold font-bold text-primary-foreground text-xl tracking-wide mb-3">
                {coupon.title}
              </h3>
              <p className="text-gray-600 mb-4">{coupon.description}</p>
              {coupon.code && (
                <div className="border-2 border-dashed border-nick-dark/30 px-6 py-3 inline-block text-primary-foreground text-xl tracking-widest mb-4">
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
  const { data: dbCoupons, isLoading , isError, error } = trpc.coupons.active.useQuery(undefined, {
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
    <PageLayout>
      <SEOHead
        title="Specials & Coupons | Nick's Tire & Auto Cleveland"
        description="Save on auto repair at Nick's Tire & Auto in Cleveland. Current specials on brakes, oil changes, diagnostics, tires, and more."
        canonicalPath="/specials"
      />
      
      
        {/* Hero */}
        <section className="relative pt-32 lg:pt-40 pb-16 lg:pb-20 bg-background">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--nick-yellow-alpha)_0%,_transparent_60%)] opacity-20" />
          <div className="relative container">
            <Breadcrumbs items={[{ label: "Specials & Coupons" }]} />
      <LocalBusinessSchema />
            <FadeIn>
              <div className="flex items-center gap-3 mb-4">
                <Tag className="w-6 h-6 text-primary" />
                <span className="font-mono text-nick-blue-light text-sm tracking-wide">Current Offers</span>
              </div>
              <h1 className="font-semibold font-bold text-4xl sm:text-5xl lg:text-7xl text-foreground tracking-tight leading-[0.95]">
                SPECIALS &<br />
                <span className="text-primary">COUPONS</span>
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
                <span className="font-mono text-primary text-sm tracking-wide">Featured Deal</span>
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
        <section className="py-12 lg:py-16 bg-[oklch(0.055_0.004_260)]">
          <div className="hidden" />
          <div className="container pt-12">
            <FadeIn>
              <span className="font-mono text-nick-blue-light text-sm tracking-wide">All Current Specials</span>
              <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight">
                SAVE ON YOUR NEXT REPAIR
              </h2>
            </FadeIn>

            {isError ? (
              <QueryError message="Failed to load data. Please try again." onRetry={() => window.location.reload()} />
            ) : isLoading ? (
              <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-6">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="border border-primary/10 bg-background/30 p-8 animate-pulse">
                    <div className="h-8 w-32 bg-primary/10 rounded mb-4" />
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
              <h2 className="font-semibold font-bold text-3xl lg:text-4xl text-foreground tracking-tight text-center">
                HOW TO <span className="text-primary">REDEEM</span>
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
                    <span className="font-semibold font-bold text-5xl text-primary/20">{step.num}</span>
                    <h3 className="font-semibold font-bold text-foreground text-lg tracking-wide mt-2">{step.title}</h3>
                    <p className="text-foreground/60 mt-2 leading-relaxed">{step.desc}</p>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 lg:py-20 bg-[oklch(0.055_0.004_260)]">
          <div className="container text-center">
            <FadeIn>
              <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-foreground tracking-tight">
                READY TO <span className="text-primary">SAVE</span>?
              </h2>
              <p className="mt-4 text-foreground/70 text-lg max-w-xl mx-auto">
                Call us or book online to schedule your service. Mention any coupon code and we will apply the discount.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
                <a
                  href={BUSINESS.phone.href}
                  onClick={() => trackPhoneClick("specials_cta")}
                  className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-semibold font-bold text-lg tracking-wide hover:opacity-90 transition-colors"
                >
                  <Phone className="w-5 h-5" />
                  CALL NOW
                </a>
                <Link
                  href="/contact"
                  className="inline-flex items-center justify-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 font-semibold font-bold text-lg tracking-wide hover:border-primary hover:text-primary transition-colors"
                >
                  BOOK ONLINE
                  <ChevronRight className="w-5 h-5" />
                </Link>
              </div>
            </FadeIn>
          </div>
        </section>

        {/* Footer */}
        

    
      <InternalLinks />
</PageLayout>
  );
}
