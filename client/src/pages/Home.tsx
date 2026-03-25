/*
 * Home Page — Nick's Tire & Auto (PIT CREW OS)
 * Inter headings, Roboto Mono body, Oswald labels
 * Cobalt blue + gold accent system
 */

import { Link } from "wouter";
import BookingForm from "@/components/BookingForm";
import FinancingCTA from "@/components/FinancingCTA";
import LeadPopup from "@/components/LeadPopup";
import ComparisonTable from "@/components/ComparisonTable";
import SnapToQuote from "@/components/SnapToQuote";
import InternalLinks from "@/components/InternalLinks";
import PageLayout from "@/components/PageLayout";
import SiteSearchSchema from "@/components/SiteSearchSchema";
import TestimonialCarousel from "@/components/TestimonialCarousel";
import { SEOHead, trackPhoneClick } from "@/components/SEO";
import { Phone, MapPin, Clock, Star, ChevronDown, ArrowRight, Gift, Snowflake, Sun, Shield, Users, Gauge } from "lucide-react";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { useAnimatedCounter } from "@/hooks/useAnimatedCounter";
import { BUSINESS } from "@shared/business";
import { GBP_REVIEW_URL } from "@shared/const";

const HERO_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-main-DE7GKwfCThaBL66r78QWkU.webp";

const MECHANIC_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/mechanic-night_af6b9eca.jpg";
const TIRES_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-tires-AWxeiFZmv6FQocUMfiJvWb.webp";
const DIAG_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-diagnostics-AN7H3iz5Tow2ab2METgner.webp";
const BRAKES_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-brakes-nKAKuxmW2WAmNrbCFRD9zL.webp";

function FadeIn({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1 }}
      transition={{ duration: 0.6, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ─── HERO — Bold dual-accent with building blue + gold ────
function Hero() {
  const { data: googleData } = trpc.reviews.google.useQuery(undefined, {
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
  const rating = googleData?.rating ?? 4.9;
  const totalReviews = googleData?.totalReviews ?? BUSINESS.reviews.count;

  return (
    <section className="relative h-[100svh] flex items-center overflow-hidden">
      {/* Full-bleed background */}
      <div className="absolute inset-0">
        <img
          src={HERO_IMG}
          alt="Nick's Tire and Auto repair shop in Cleveland Ohio"
          className="w-full h-full object-cover"
        />
        {/* Blue-tinted gradient overlay matching building color */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(135deg, rgba(15,40,71,0.92) 0%, rgba(30,77,140,0.65) 40%, rgba(10,10,10,0.45) 100%)",
          }}
        />
      </div>

      {/* Content — left-aligned */}
      <div className="relative container">
        <div className="max-w-[65%] max-lg:max-w-full">
          {/* Top badges — inspired by AI Studio layout */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2, ease: "easeOut" }}
            className="flex flex-wrap items-center gap-3 mb-6"
          >
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold tracking-wide uppercase bg-[#FDB913] text-[#0B0E14]">
              <Star className="w-3.5 h-3.5 fill-current" />
              Cleveland&rsquo;s #1 Tire Shop
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold tracking-wide uppercase border border-emerald-500/40 text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Walk-ins Welcome
            </span>
          </motion.div>

          {/* Headline — directive: "PRECISION REPAIR. EUCLID TOUGH." */}
          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3, ease: "easeOut" }}
            className="font-heading text-[2rem] sm:text-5xl lg:text-[4.5rem] font-extrabold uppercase text-white leading-[0.95] tracking-tight"
          >
            Precision Repair.
            <br />
            <span className="text-[#FDB913]">Euclid Tough.</span>
          </motion.h1>

          {/* Subheadline */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.5, ease: "easeOut" }}
            className="mt-6 text-lg sm:text-xl lg:text-2xl font-sans text-white/70 max-w-xl"
          >
            Cleveland&rsquo;s #1 for tires, brakes, and diagnostics. We beat any quote.
          </motion.p>

          {/* CTA buttons — Gold for revenue, outline for secondary */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.7, ease: "easeOut" }}
            className="mt-8 flex flex-col sm:flex-row gap-3"
          >
            <Link
              href="/booking"
              className="btn-gold inline-flex items-center justify-center gap-2 text-lg"
            >
              Book Appointment Now
            </Link>
            <a
              href={`sms:${BUSINESS.phone.raw}`}
              className="btn-outline inline-flex items-center justify-center gap-2 text-lg"
            >
              Text a Mechanic
            </a>
          </motion.div>

          {/* Trust row — 3 inline badges */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.9, ease: "easeOut" }}
            className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm sm:text-base"
          >
            <span className="inline-flex items-center gap-1.5 text-[#FDB913]">
              <span className="flex gap-0.5">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="w-4 h-4 fill-[#FDB913] text-[#FDB913]" />
                ))}
              </span>
              {rating.toFixed(1)} from {totalReviews.toLocaleString()}+ reviews
            </span>
            <span className="text-white/50">&bull; ASE Certified</span>
            <span className="text-white/50">&bull; 3-Year Warranty</span>
          </motion.div>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ repeat: Infinity, duration: 2 }}
        >
          <ChevronDown className="w-5 h-5 text-white/30" />
        </motion.div>
      </div>
    </section>
  );
}

// ─── ANIMATED STAT — Single counter with viewport trigger ───
function AnimatedStat({ end, decimals = 0, suffix = "", label, delay = 0 }: {
  end: number; decimals?: number; suffix?: string; label: string; delay?: number;
}) {
  const { value, ref } = useAnimatedCounter({ end, duration: 2000, delay, decimals });
  return (
    <div ref={ref} className="text-center">
      <div className="text-3xl lg:text-4xl font-bold text-[#FDB913] tracking-tight font-mono">
        {decimals > 0 ? value.toFixed(decimals) : value.toLocaleString()}{suffix}
      </div>
      <div className="mt-1 text-sm text-foreground/40 font-medium">{label}</div>
    </div>
  );
}

// ─── TRUST NUMBERS — Single horizontal strip with animated counters ───
function TrustNumbers() {
  const { data: googleData } = trpc.reviews.google.useQuery(undefined, {
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
  const totalReviews = googleData?.totalReviews ?? BUSINESS.reviews.count;

  return (
    <section className="section-elevated py-16 border-y border-border">
      <div className="container">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-0">
          <FadeIn delay={0}>
            <div className="lg:border-r-0">
              <AnimatedStat end={4.9} decimals={1} label="Google Rating" delay={0} />
            </div>
          </FadeIn>
          <FadeIn delay={0.1}>
            <div className="lg:border-l lg:border-border">
              <AnimatedStat end={totalReviews} suffix="+" label="Reviews" delay={100} />
            </div>
          </FadeIn>
          <FadeIn delay={0.2}>
            <div className="lg:border-l lg:border-border">
              <AnimatedStat end={7} label="Days a Week" delay={200} />
            </div>
          </FadeIn>
          <FadeIn delay={0.3}>
            <div className="lg:border-l lg:border-border text-center">
              <div className="text-3xl lg:text-4xl font-bold text-[#FDB913] tracking-tight font-mono">Same Day</div>
              <div className="mt-1 text-sm text-foreground/40 font-medium">Most Repairs</div>
            </div>
          </FadeIn>
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
    price: "From $89/tire installed",
  },
  {
    title: "Brakes",
    slug: "/brakes",
    desc: "Pads, rotors, calipers, brake lines, and ABS diagnostics. We show you the problem first.",
    img: BRAKES_IMG,
    price: "From $149/axle",
  },
  {
    title: "Diagnostics",
    slug: "/diagnostics",
    desc: "Check engine light, OBD-II code reading, advanced computer diagnostics.",
    img: DIAG_IMG,
    price: "From $49.99",
  },
];

const moreServices = [
  { title: "Emissions & E-Check", slug: "/emissions", desc: "Failed Ohio E-Check? We diagnose and repair emissions problems.", price: "From $29.99" },
  { title: "Oil Change", slug: "/oil-change", desc: "Conventional and synthetic oil changes. Quick, affordable, done right.", price: "From $39.99" },
  { title: "General Repair", slug: "/general-repair", desc: "Suspension, steering, exhaust, cooling systems, belts, hoses, and more.", price: "Free estimate" },
];

function Services() {
  return (
    <section id="services">
      {/* Featured services — large image tiles */}
      {services.map((s) => (
        <div key={s.slug} className="relative min-h-[80vh] flex items-end overflow-hidden">
          <div className="absolute inset-0">
            <img src={s.img} alt={`${s.title} service at Nick's Tire and Auto`} className="w-full h-full object-cover" loading="lazy" />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
          </div>
          <div className="relative container pb-20">
            <FadeIn>
              <h2 className="font-heading text-4xl lg:text-6xl font-bold text-foreground tracking-tight uppercase">{s.title}</h2>
              <p className="mt-2 text-[#FDB913] font-semibold text-lg">{s.price}</p>
              <p className="mt-3 text-lg text-foreground/60 max-w-md font-light">{s.desc}</p>
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
            <h2 className="font-heading text-3xl lg:text-4xl font-bold text-foreground tracking-tight text-center mb-12 uppercase">More Services</h2>
          </FadeIn>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {moreServices.map((s, i) => (
              <FadeIn key={s.slug} delay={i * 0.1}>
                <Link href={s.slug} className="group block p-8 border border-border rounded-2xl hover:border-foreground/20 transition-all">
                  <h3 className="font-heading text-xl font-semibold text-foreground tracking-tight group-hover:text-primary transition-colors uppercase">{s.title}</h3>
                  <p className="mt-1 text-[#FDB913] font-semibold text-sm">{s.price}</p>
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
              <h2 className="font-heading text-4xl lg:text-5xl font-bold text-foreground tracking-tight leading-[1.1] uppercase">
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
                  { title: "Trusted by Women", text: "Many of our regulars are women who say this is the first shop where they felt safe, informed, and never talked down to." },
                ].map((item) => (
                  <div key={item.title} className="flex gap-4">
                    <div className="w-px bg-primary shrink-0 mt-1" style={{ minHeight: '2.5rem' }} />
                    <div>
                      <h4 className="font-semibold text-foreground text-sm tracking-wide">{item.title}</h4>
                      <p className="text-foreground/40 text-sm mt-1 leading-relaxed">{item.text}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-10 flex flex-wrap gap-3">
                <a href={BUSINESS.phone.href} onClick={() => trackPhoneClick('whyus-cta')} className="inline-flex items-center gap-2 bg-foreground text-background px-6 py-3 rounded-full font-medium text-sm hover:bg-foreground/90 transition-colors">
                  Call for Free Estimate
                </a>
                <Link href="/booking" className="inline-flex items-center gap-2 border border-foreground/30 text-foreground px-6 py-3 rounded-full font-medium text-sm hover:bg-foreground/5 transition-colors">
                  Book Online
                </Link>
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

  const totalReviews = googleData?.totalReviews ?? BUSINESS.reviews.count;
  const displayReviews = googleData?.reviews && googleData.reviews.length > 0
    ? googleData.reviews.slice(0, 3).map(r => ({ name: r.authorName, stars: r.rating, text: r.text }))
    : FALLBACK_REVIEWS;

  return (
    <section className="section-elevated py-24 lg:py-32">
      <div className="container">
        <FadeIn>
          <div className="text-center mb-16">
            <h2 className="font-heading text-4xl lg:text-5xl font-bold text-foreground tracking-tight uppercase">
              {totalReviews.toLocaleString()}+ five&#8209;star reviews.
            </h2>
            <p className="mt-4 text-foreground/40 text-lg">Verified by Google. Written by real Cleveland drivers.</p>
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

        {/* Testimonial Carousel — auto-rotating social proof */}
        <FadeIn delay={0.3}>
          <div className="mt-16 pt-12 border-t border-border">
            <TestimonialCarousel />
          </div>
        </FadeIn>

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
              <h2 className="font-heading text-4xl lg:text-5xl font-bold text-foreground tracking-tight uppercase">
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
            <div id="booking">
              <BookingForm />
            </div>
            <FinancingCTA variant="banner" className="mt-6" />
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

// ─── SEASONAL SPECIALS — Blue brand section ──────────────
function SeasonalSpecials() {
  const specials = [
    {
      icon: Sun,
      title: "Spring Brake Special",
      desc: "Full brake inspection + pad replacement. Keep your family safe this season.",
      price: "$149",
      badge: "Save $50",
    },
    {
      icon: Shield,
      title: "Free Tire Safety Check",
      desc: "Not sure if you need new tires? Get a professional inspection for free. No obligation.",
      price: "FREE",
      badge: "Popular",
    },
    {
      icon: Snowflake,
      title: "A/C Ready Package",
      desc: "Full A/C system check, recharge, and leak inspection before summer hits.",
      price: "$89",
      badge: "Seasonal",
    },
  ];

  return (
    <section id="specials-home" className="relative py-24 lg:py-32 overflow-hidden">
      {/* Building blue gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#0F2847] via-[#1E4D8C] to-[#153A6B]" />
      <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, rgba(59,130,246,0.3) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(253,185,19,0.15) 0%, transparent 40%)' }} />

      <div className="relative container">
        <FadeIn>
          <div className="text-center mb-16">
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold tracking-widest uppercase bg-[#FDB913]/10 text-[#FDB913] border border-[#FDB913]/20 mb-6">
              <Gift className="w-3.5 h-3.5" />
              Limited Time Offers
            </span>
            <h2 className="font-heading text-4xl lg:text-5xl font-bold text-white tracking-tight uppercase">
              Seasonal Specials
            </h2>
            <p className="mt-4 text-white/50 text-lg max-w-xl mx-auto">Save more with our current promotions. Walk in or call to claim.</p>
          </div>
        </FadeIn>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {specials.map((s, i) => (
            <FadeIn key={s.title} delay={i * 0.1}>
              <div className="relative p-8 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 hover:border-[#FDB913]/30 transition-all group">
                <div className="absolute top-4 right-4">
                  <span className="px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase bg-[#FDB913] text-[#0B0E14]">
                    {s.badge}
                  </span>
                </div>
                <s.icon className="w-8 h-8 text-[#FDB913] mb-4" />
                <h3 className="font-heading text-xl font-bold text-white uppercase tracking-tight">{s.title}</h3>
                <p className="mt-2 text-white/50 text-sm leading-relaxed">{s.desc}</p>
                <div className="mt-4 text-2xl font-bold text-[#FDB913] font-mono">{s.price}</div>
                <a
                  href={BUSINESS.phone.href}
                  onClick={() => trackPhoneClick(`special-${s.title}`)}
                  className="mt-6 inline-flex items-center gap-2 w-full justify-center bg-white/10 hover:bg-[#FDB913] hover:text-[#0B0E14] text-white px-4 py-3 rounded-lg font-semibold text-sm transition-all"
                >
                  Claim This Offer
                  <ArrowRight className="w-4 h-4" />
                </a>
              </div>
            </FadeIn>
          ))}
        </div>

        <FadeIn delay={0.4}>
          <div className="mt-12 text-center">
            <Link href="/specials" className="inline-flex items-center gap-2 text-sm font-medium text-white/50 hover:text-[#FDB913] transition-colors">
              View all specials <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

// ─── REFER A FRIEND — Community rewards ──────────────────
function ReferAFriend() {
  return (
    <section className="py-24 lg:py-32 bg-[oklch(0.065_0.004_260)]">
      <div className="container">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <FadeIn>
            <div>
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold tracking-widest uppercase bg-[#1E4D8C]/20 text-[#1E4D8C] border border-[#1E4D8C]/20 mb-6">
                <Users className="w-3.5 h-3.5" />
                Community Rewards
              </span>
              <h2 className="font-heading text-4xl lg:text-5xl font-bold text-foreground tracking-tight uppercase leading-[1.05]">
                Refer a Friend.
                <br />
                <span className="text-[#FDB913]">You both save $20.</span>
              </h2>
              <p className="mt-6 text-foreground/50 text-lg leading-relaxed max-w-md">
                Know someone who needs tires or auto work? Send them our way. When they mention your name, you both get $20 off your next service.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <a
                  href={BUSINESS.phone.href}
                  onClick={() => trackPhoneClick("referral-cta")}
                  className="inline-flex items-center justify-center gap-2 bg-[#FDB913] text-[#0B0E14] px-6 py-3.5 rounded-lg font-bold text-sm hover:bg-[#FFD54F] transition-colors"
                >
                  <Phone className="w-4 h-4" />
                  Call to Refer
                </a>
                <Link
                  href="/referral"
                  className="inline-flex items-center justify-center gap-2 border border-foreground/20 text-foreground px-6 py-3.5 rounded-lg font-semibold text-sm hover:bg-foreground/5 transition-colors"
                >
                  Learn More
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </FadeIn>
          <FadeIn delay={0.15}>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-6 rounded-2xl bg-[#1E4D8C]/10 border border-[#1E4D8C]/20">
                <div className="text-3xl font-bold text-[#1E4D8C] font-mono mb-2">$20</div>
                <div className="text-sm text-foreground/50">Your friend saves on their first visit</div>
              </div>
              <div className="p-6 rounded-2xl bg-[#FDB913]/10 border border-[#FDB913]/20">
                <div className="text-3xl font-bold text-[#FDB913] font-mono mb-2">$20</div>
                <div className="text-sm text-foreground/50">You save on your next service</div>
              </div>
              <div className="col-span-2 p-6 rounded-2xl bg-foreground/5 border border-border">
                <div className="text-3xl font-bold text-foreground font-mono mb-2">No Limit</div>
                <div className="text-sm text-foreground/50">Refer as many friends as you want. Stack your savings.</div>
              </div>
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}

// ─── TIRE PRESSURE GUIDE — Utility tool ──────────────────
function TirePressureGuide() {
  const vehicles = [
    { type: "Sedan / Compact", psi: "32-35 PSI", icon: "🚗" },
    { type: "SUV / Crossover", psi: "35-38 PSI", icon: "🚙" },
    { type: "Truck / Van", psi: "35-44 PSI", icon: "🛻" },
    { type: "Sports Car", psi: "30-35 PSI", icon: "🏎️" },
  ];

  return (
    <section className="py-20 section-elevated border-y border-border">
      <div className="container">
        <FadeIn>
          <div className="flex flex-col lg:flex-row items-start lg:items-center gap-8 lg:gap-16">
            <div className="lg:w-1/3">
              <div className="flex items-center gap-3 mb-4">
                <Gauge className="w-6 h-6 text-[#1E4D8C]" />
                <span className="text-xs font-bold tracking-widest uppercase text-foreground/40">Quick Reference</span>
              </div>
              <h3 className="font-heading text-2xl lg:text-3xl font-bold text-foreground tracking-tight uppercase">Tire Pressure Guide</h3>
              <p className="mt-3 text-foreground/50 text-sm leading-relaxed">Not sure what PSI? Check your door jamb sticker or use these general recommendations.</p>
              <a
                href={`https://www.google.com/maps/dir//${encodeURIComponent(BUSINESS.address.full)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-[#1E4D8C] hover:text-[#FDB913] transition-colors"
              >
                <MapPin className="w-3.5 h-3.5" />
                Get Directions for Free Air Check
              </a>
            </div>
            <div className="lg:w-2/3 grid grid-cols-2 sm:grid-cols-4 gap-4">
              {vehicles.map((v) => (
                <div key={v.type} className="text-center p-5 rounded-xl bg-background border border-border">
                  <div className="text-2xl mb-2">{v.icon}</div>
                  <div className="text-lg font-bold text-[#FDB913] font-mono">{v.psi}</div>
                  <div className="text-xs text-foreground/40 mt-1">{v.type}</div>
                </div>
              ))}
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
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
    "@id": "https://autonicks.com",
    "url": "https://autonicks.com",
    "telephone": "+1-" + BUSINESS.phone.dashed,
    "priceRange": "$$",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": BUSINESS.address.street,
      "addressLocality": "Euclid",
      "addressRegion": "OH",
      "postalCode": "44112",
      "addressCountry": "US"
    },
    "geo": { "@type": "GeoCoordinates", "latitude": 41.5525118, "longitude": -81.5571875 },
    "openingHoursSpecification": [
      { "@type": "OpeningHoursSpecification", "dayOfWeek": ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"], "opens": "08:00", "closes": "18:00" },
      { "@type": "OpeningHoursSpecification", "dayOfWeek": "Sunday", "opens": "09:00", "closes": "16:00" }
    ],
    "aggregateRating": { "@type": "AggregateRating", "ratingValue": String(BUSINESS.reviews.rating), "reviewCount": String(BUSINESS.reviews.count), "bestRating": "5" },
    "areaServed": [
      { "@type": "City", "name": "Cleveland", "sameAs": "https://en.wikipedia.org/wiki/Cleveland" },
      { "@type": "City", "name": "Euclid" },
      { "@type": "City", "name": "East Cleveland" },
      { "@type": "City", "name": "South Euclid" },
      { "@type": "City", "name": "Richmond Heights" }
    ],
    "sameAs": [...BUSINESS.sameAs],
    "hasMap": BUSINESS.urls.googleBusiness
  };

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />;
}

// ─── PAGE ────────────────────────────────────────────────
export default function Home() {
  return (
    <PageLayout activeHref="/" showChat={true}>
      <SEOHead
        title="Nick's Tire & Auto — Cleveland's #1 Tire Shop & Auto Repair"
        description={`Cleveland's top-rated new & used tire specialist + full-service auto repair. Free premium installation ($289 value). Flat repair $15. Brakes, diagnostics, emissions. ${BUSINESS.reviews.countDisplay} reviews, 4.9 stars. Walk-ins 7 days. $10 down financing.`}
        canonicalPath="/"
      />
      <LocalBusinessSchema />
      <SiteSearchSchema />
      <Hero />
      <TrustNumbers />
      <div className="content-lazy"><SnapToQuote /></div>
      <Services />
      <div className="content-lazy"><WhyUs /></div>
      <div className="content-lazy"><SeasonalSpecials /></div>
      <div className="content-lazy"><Reviews /></div>
      <div className="content-lazy"><TirePressureGuide /></div>
      <div className="content-lazy"><ReferAFriend /></div>
      <div className="content-lazy"><ComparisonTable /></div>
      <div className="content-lazy"><Contact /></div>
      <div className="content-lazy"><InternalLinks title="Explore More" /></div>
      <LeadPopup />
    </PageLayout>
  );
}
