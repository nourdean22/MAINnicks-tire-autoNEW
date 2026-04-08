/*
 * Home Page — Nick's Tire & Auto
 * Dark, bold hero with Barlow Condensed headings, DM Sans body,
 * JetBrains Mono stat numbers, gold accents
 */

import { Link } from "wouter";
import BookingForm from "@/components/BookingForm";
import FinancingCTA from "@/components/FinancingCTA";
import LeadPopup from "@/components/LeadPopup";
import ComparisonTable from "@/components/ComparisonTable";
import InternalLinks from "@/components/InternalLinks";
import PageLayout from "@/components/PageLayout";
import { SEOHead, trackPhoneClick } from "@/components/SEO";
import { Phone, MapPin, Clock, Star, ChevronDown, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import React from "react";
import { BUSINESS } from "@shared/business";
import { GBP_REVIEW_URL } from "@shared/const";
import TrustStrip from "@/components/TrustStrip";
import TrustBadges from "@/components/TrustBadges";
import FastPaths from "@/components/FastPaths";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import FadeIn from "@/components/FadeIn";

const HERO_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-main-DE7GKwfCThaBL66r78QWkU.webp";

const MECHANIC_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/mechanic-night_af6b9eca.jpg";
const TIRES_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-tires-AWxeiFZmv6FQocUMfiJvWb.webp";
const DIAG_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-diagnostics-AN7H3iz5Tow2ab2METgner.webp";
const BRAKES_IMG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-brakes-nKAKuxmW2WAmNrbCFRD9zL.webp";

// ─── HERO — Full-viewport cinematic with left content ────
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
          loading="eager"
          fetchPriority="high"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(135deg, rgba(10,10,10,0.85) 0%, rgba(10,10,10,0.4) 100%)",
          }}
        />
      </div>

      {/* Content — left-aligned */}
      <div className="relative container">
        <div className="max-w-[60%] max-lg:max-w-full">
          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3, ease: "easeOut" }}
            className="font-heading text-[2.5rem] sm:text-5xl lg:text-[5.5rem] font-extrabold uppercase text-[#F5F5F5] leading-[0.95] tracking-tight"
          >
            Your Trusted Mechanic
            <br />
            <span className="text-[#FDB913] text-gradient-yellow">& Auto Repair Near Me</span>
          </motion.h1>

          {/* Subheadline */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.5, ease: "easeOut" }}
            className="mt-6 text-lg sm:text-xl lg:text-2xl font-sans text-[#A0A0A0] max-w-lg"
          >
            Cleveland&rsquo;s #1 rated auto shop. We show you the problem before we fix it.
          </motion.p>

          {/* CTA buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.7, ease: "easeOut" }}
            className="mt-8 flex flex-col sm:flex-row gap-3"
          >
            <a
              href={BUSINESS.phone.href}
              onClick={() => trackPhoneClick("hero")}
              className="inline-flex items-center justify-center gap-2 bg-[#FDB913] text-[#0A0A0A] px-8 py-3.5 rounded-lg font-semibold text-lg hover:bg-[#FDB913]/90 transition-colors btn-premium"
              aria-label="Call for service"
            >
              <Phone className="w-5 h-5" />
              Call {BUSINESS.phone.display}
            </a>
            <a
              href="#booking"
              className="inline-flex items-center justify-center gap-2 border-2 border-[#FDB913] text-[#FDB913] px-8 py-3.5 rounded-lg font-semibold text-lg hover:bg-[#FDB913]/10 transition-colors btn-premium"
            >
              Drop Off Your Car
            </a>
          </motion.div>

          {/* Social proof strip */}
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
            <span className="text-[#A0A0A0]">&bull; Same-day service</span>
            <span className="text-[#A0A0A0]">&bull; Walk-ins welcome</span>
            <span className="text-[#A0A0A0]">&bull; Open 7 days</span>
          </motion.div>
        </div>
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
  const totalReviews = googleData?.totalReviews ?? BUSINESS.reviews.count;

  const stats = [
    { value: String(googleData?.rating ?? BUSINESS.reviews.rating), label: "Google Rating" },
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
                <div className="text-3xl lg:text-4xl font-bold text-[#FDB913] tracking-tight font-mono text-gradient-yellow">{s.value}</div>
                <div className="mt-1 text-sm text-foreground/40 font-medium">{s.label}</div>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── USED TIRES CALLOUT — "Too good to be true" hook ────
function UsedTiresCallout() {
  return (
    <section className="bg-[#FDB913] py-12 lg:py-16">
      <div className="container">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-6">
          <div className="text-center lg:text-left">
            <FadeIn>
              <h2 className="font-heading text-4xl lg:text-5xl font-extrabold text-black uppercase tracking-tight">
                USED TIRES FROM $60
              </h2>
              <p className="mt-2 text-black/70 text-lg lg:text-xl font-medium max-w-lg">
                In and out in under 20 minutes. Drive away like nothing happened.
              </p>
            </FadeIn>
          </div>
          <FadeIn delay={0.15}>
            <div className="flex flex-col sm:flex-row gap-3">
              <a
                href={BUSINESS.phone.href}
                onClick={() => trackPhoneClick("used-tires-callout")}
                className="inline-flex items-center justify-center gap-2 bg-black text-[#FDB913] px-8 py-3.5 rounded-lg font-bold text-base hover:bg-black/90 transition-colors"
              >
                <Phone className="w-5 h-5" />
                Call Now
              </a>
              <Link
                href="/tires"
                className="inline-flex items-center justify-center gap-2 border-2 border-black text-black px-8 py-3.5 rounded-lg font-bold text-base hover:bg-black/10 transition-colors"
              >
                See Tire Options
                <ArrowRight className="w-5 h-5" />
              </Link>
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
    price: "Quality tires at fair prices",
  },
  {
    title: "Brakes",
    slug: "/brakes",
    desc: "Pads, rotors, calipers, brake lines, and ABS diagnostics. We show you the problem first.",
    img: BRAKES_IMG,
    price: "Free inspection",
  },
  {
    title: "Diagnostics",
    slug: "/diagnostics",
    desc: "Check engine light, OBD-II code reading, advanced computer diagnostics.",
    img: DIAG_IMG,
    price: "Free scan with repair",
  },
];

const moreServices = [
  { title: "Emissions & E-Check", slug: "/emissions", desc: "Failed Ohio E-Check? We diagnose and repair emissions problems.", price: "Walk-ins welcome" },
  { title: "Oil Change", slug: "/oil-change", desc: "Conventional and synthetic oil changes. Quick, affordable, done right.", price: "Quick service" },
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 stagger-in">
            {moreServices.map((s, i) => (
              <FadeIn key={s.slug} delay={i * 0.1}>
                <Link href={s.slug} className="group block p-8 border border-border rounded-2xl hover:border-foreground/20 transition-all card-gold-hover">
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 stagger-in">
          {displayReviews.map((r, i) => (
            <FadeIn key={r.name + i} delay={i * 0.1}>
              <div className="p-8 border border-border rounded-2xl h-full flex flex-col glow-on-hover">
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
              Read all 1,700+ reviews <ArrowRight className="w-3.5 h-3.5" />
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
                Pull up anytime.
              </h2>
              <p className="mt-4 text-foreground/40 text-lg">No appointment needed. Drop off your car and go — we'll call when it's done.</p>

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

// ─── PAGE ────────────────────────────────────────────────
export default function Home() {
  return (
    <PageLayout activeHref="/" showChat={true}>
      <SEOHead
        title="Mechanic Near Me | Auto Repair Cleveland OH | Nick's Tire & Auto"
        description="Looking for a mechanic near me or auto repair near me in Cleveland? 4.9 stars, 1700+ reviews. Brakes, tires, diagnostics, oil changes. Walk-ins 7 days. (216) 862-0005"
        canonicalPath="/"
      />
      <LocalBusinessSchema includeHowTo includeReviews includeServices />
      <Hero />
      <TrustStrip />
      <TrustBadges />
      <FastPaths />
      <UsedTiresCallout />
      <TrustNumbers />
      <Services />
      <WhyUs />
      <Reviews />
      <ComparisonTable />
      <Contact />
      {/* SEO: Comprehensive internal link section for homepage link equity */}
      <section className="bg-[oklch(0.055_0.004_260)] py-16 border-t border-border/30">
        <div className="container">
          <h2 className="font-heading text-2xl font-bold text-foreground tracking-tight uppercase mb-8">
            Your Mechanic Near Me in Cleveland — Every Service, One Shop
          </h2>
          <p className="text-foreground/50 text-sm leading-relaxed mb-8 max-w-3xl">
            Whether you are searching for a mechanic near me, auto repair near me, or a tire shop near me in Cleveland, Nick's Tire & Auto has you covered. From brake repair and oil changes to check engine light diagnostics and wheel alignment, we are the trusted auto shop near me that Cleveland drivers rely on for honest, affordable service 7 days a week.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Services column */}
            <div>
              <h3 className="text-xs font-semibold text-foreground/30 uppercase tracking-widest mb-4">Our Services</h3>
              <ul className="space-y-2">
                {[
                  { href: "/tires", label: "Tire Shop Near Me" },
                  { href: "/brakes", label: "Brake Repair Cleveland" },
                  { href: "/diagnostics", label: "Check Engine Light Near Me" },
                  { href: "/emissions", label: "Emissions & E-Check" },
                  { href: "/oil-change", label: "Oil Change Cleveland" },
                  { href: "/general-repair", label: "Auto Repair Near Me" },
                  { href: "/ac-repair", label: "AC & Heating" },
                  { href: "/transmission", label: "Transmission" },
                  { href: "/alignment", label: "Wheel Alignment Cleveland" },
                  { href: "/electrical", label: "Electrical Repair" },
                  { href: "/battery", label: "Battery Service" },
                  { href: "/exhaust", label: "Muffler Shop Near Me" },
                  { href: "/services", label: "View All Services" },
                ].map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-foreground/50 hover:text-primary transition-colors">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            {/* Tools & Resources column */}
            <div>
              <h3 className="text-xs font-semibold text-foreground/30 uppercase tracking-widest mb-4">Tools & Resources</h3>
              <ul className="space-y-2">
                {[
                  { href: "/diagnose", label: "Diagnose My Car" },
                  { href: "/pricing", label: "Price Estimator" },
                  { href: "/financing", label: "Financing — No Credit Check" },
                  { href: "/booking", label: "Book Appointment Online" },
                  { href: "/specials", label: "Specials & Coupons" },
                  { href: "/blog", label: "Repair Tips Blog" },
                  { href: "/car-care-guide", label: "Car Care Guide" },
                  { href: "/faq", label: "FAQ" },
                  { href: "/reviews", label: "Customer Reviews" },
                  { href: "/fleet", label: "Fleet Accounts" },
                  { href: "/rewards", label: "Rewards Program" },
                  { href: "/about", label: "About Us" },
                ].map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-foreground/50 hover:text-primary transition-colors">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            {/* Service Areas column */}
            <div>
              <h3 className="text-xs font-semibold text-foreground/30 uppercase tracking-widest mb-4">Areas We Serve</h3>
              <ul className="space-y-2">
                {[
                  { href: "/cleveland-auto-repair", label: "Cleveland" },
                  { href: "/euclid-auto-repair", label: "Euclid" },
                  { href: "/lakewood-auto-repair", label: "Lakewood" },
                  { href: "/parma-auto-repair", label: "Parma" },
                  { href: "/east-cleveland-auto-repair", label: "East Cleveland" },
                  { href: "/shaker-heights-auto-repair", label: "Shaker Heights" },
                  { href: "/cleveland-heights-auto-repair", label: "Cleveland Heights" },
                  { href: "/mentor-auto-repair", label: "Mentor" },
                  { href: "/strongsville-auto-repair", label: "Strongsville" },
                  { href: "/south-euclid-auto-repair", label: "South Euclid" },
                  { href: "/garfield-heights-auto-repair", label: "Garfield Heights" },
                  { href: "/richmond-heights-auto-repair", label: "Richmond Heights" },
                ].map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-foreground/50 hover:text-primary transition-colors">
                      Auto Repair in {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>
      <InternalLinks title="Explore More" />
      <LeadPopup />
    </PageLayout>
  );
}
