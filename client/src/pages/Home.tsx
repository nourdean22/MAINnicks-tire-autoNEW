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
import { Phone, MapPin, Clock, Star, ChevronDown, ArrowRight, Disc, Activity, Wrench, Zap, AlertTriangle, Snowflake } from "lucide-react";
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
import BrandMark from "@/components/BrandMark";
import ShopStatusWidget from "@/components/ShopStatusWidget";
import UberDropoffWidget from "@/components/UberDropoffWidget";
// Conversion-architecture components (Batch 1 of v1.1 spec)
import LiveVisitorCounter from "@/components/conversion/LiveVisitorCounter";
import ServiceTriageCard from "@/components/conversion/ServiceTriageCard";
import AnchorAdjustmentTable from "@/components/conversion/AnchorAdjustmentTable";
import FearCalibrationBlock from "@/components/conversion/FearCalibrationBlock";
import LossAversionStat from "@/components/conversion/LossAversionStat";
import { useWeatherCTA } from "@/hooks/useWeatherCTA";
import { useConversionTracking } from "@/hooks/useConversionTracking";

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
          {/* Brand pendant above the H1 — inline SVG, no image file needed.
              Hides on very small screens to leave room for the massive H1. */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.15, ease: "easeOut" }}
            className="hidden sm:block mb-6"
            aria-hidden="true"
          >
            <BrandMark variant="full" size={88} background="#0a1628" />
          </motion.div>

          {/* H1: 'CLEVELAND TOUGH.' — short, confident, matches the pendant
              tagline. SEO keywords live in the subhead below. */}
          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3, ease: "easeOut" }}
            className="font-heading text-[4rem] sm:text-7xl lg:text-[8.5rem] font-extrabold uppercase text-[#F5F5F5] leading-[0.85] tracking-tight"
          >
            Cleveland
            <br />
            <span className="text-[#FDB913] text-gradient-yellow">Tough.</span>
          </motion.h1>

          {/* Subheadline */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.5, ease: "easeOut" }}
            className="mt-6 text-lg sm:text-xl lg:text-2xl font-sans text-[#A0A0A0] max-w-lg"
          >
            Used tires from $60 installed free. $10 down financing — no credit check. Walk-ins 7 days. You see the problem. Then we fix it.
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
              Get $10-Down Quote
            </a>
          </motion.div>

          {/* Social proof strip — review stars + LiveVisitorCounter (real-time
              from tRPC, hides automatically when fewer than 3 active sessions). */}
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
            <span className="text-[#A0A0A0]">&bull; $10 down · no credit check</span>
            <span className="text-[#A0A0A0]">&bull; Same-day · walk-ins 7 days</span>
            <span className="text-[#A0A0A0]">&bull; Free install on tires</span>
          </motion.div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 1.1, ease: "easeOut" }}
            className="mt-3"
          >
            <LiveVisitorCounter minToShow={3} />
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
    { value: `${totalReviews.toLocaleString()}+`, label: "5-Star Reviews" },
    { value: "$10", label: "Down · No Credit" },
    { value: "Same Day", label: "Walk-Ins 7 Days" },
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
                USED TIRES FROM $60 — INSTALLED FREE
              </h2>
              <p className="mt-2 text-black/70 text-lg lg:text-xl font-medium max-w-lg">
                Pull up. Stay in your car. Free mount, balance, valve stems — out the door in 20 minutes.
              </p>
              <p className="mt-1 text-black/50 text-sm lg:text-base max-w-lg">
                $10 down financing on tire sets. Every size, every car. 7 days a week — rain, snow, or shine.
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
                See Tires from $60
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
    desc: "New & used tires Cleveland. Free mount, balance, rotation, TPMS sensors, flat repair. $10 down financing — no credit check.",
    img: TIRES_IMG,
    price: "Used from $60 · installed free",
  },
  {
    title: "Brakes",
    slug: "/brakes",
    desc: "Pads, rotors, calipers, brake lines, ABS diagnostics. We show you the worn parts before we touch the bill.",
    img: BRAKES_IMG,
    price: "Free brake inspection",
  },
  {
    title: "Diagnostics",
    slug: "/diagnostics",
    desc: "Check engine light, OBD-II code reading, advanced computer diagnostics. Free 5-min scan, written estimate before any work.",
    img: DIAG_IMG,
    price: "Free scan · written estimate",
  },
];

const moreServices = [
  { title: "Emissions & E-Check", slug: "/emissions", desc: "Failed Ohio E-Check Cleveland? State-certified emissions repair — pass guaranteed or we keep working.", price: "Same-day fix · walk-ins" },
  { title: "Oil Change", slug: "/oil-change", desc: "Cheap oil change Cleveland — conventional & synthetic. Free 27-point inspection on every service.", price: "From $29.99 · in & out fast" },
  { title: "General Repair", slug: "/general-repair", desc: "Suspension, steering, exhaust, cooling systems, belts, hoses, electrical — full-service auto repair Cleveland.", price: "Free estimate · all makes" },
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
                You see the problem.
                <br />
                <span className="text-primary">Then we fix it.</span>
              </h2>
              <p className="mt-6 text-foreground/50 text-lg leading-relaxed">
                Most Cleveland auto shops hand you a bill and hope you don't ask questions. We walk you through the diagnosis, show you the worn parts on a lift, explain every option, and let you decide. No hidden fees. No upsells. Family-owned, 1,700+ five-star reviews.
              </p>

              <div className="mt-10 space-y-6">
                {[
                  { title: "Honest Diagnostics", text: "We read the codes, test the components, and show you exactly what failed — on the lift, before a wrench moves." },
                  { title: "Upfront Pricing", text: "Written estimates before work begins. No hidden fees, no surprise charges, no \"we found something else\" scams." },
                  { title: "$10 Down Financing", text: "Acima · Snap · Koalafi · American First. Approved in 90 seconds, no credit check, drive away today, pay over time." },
                  { title: "Warranty on Repairs", text: "We stand behind our work. If something isn't right, we make it right — every time." },
                  { title: "Trusted by Women", text: "Many of our regulars are women who say this is the first Cleveland auto shop where they felt safe, informed, and never talked down to." },
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
                <Link href="/financing" className="inline-flex items-center gap-2 border border-foreground/30 text-foreground px-6 py-3 rounded-full font-medium text-sm hover:bg-foreground/5 transition-colors">
                  Apply for $10-Down Financing
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
            <p className="mt-4 text-foreground/40 text-lg">Verified by Google. Written by real Cleveland drivers — no bots, no buyouts, no fake reviews.</p>
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
              <p className="mt-4 text-foreground/40 text-lg">No appointment needed. Walk in 7 days a week, drop the keys, request an Uber from our lot — we'll text the moment your car is ready.</p>

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

// ─── WEATHER BANNER — dynamic top-of-page CTA driven by useWeatherCTA ────
//
// Renders only when weather genuinely matters (snow / heat / rain / surge).
// On calm days the hook returns null and this section disappears entirely
// — no manufactured urgency on a 70°F day.
function WeatherBanner() {
  const cta = useWeatherCTA();
  const track = useConversionTracking();
  if (!cta) return null;

  const tone =
    cta.urgency === "high"
      ? "bg-red-500/10 border-red-500/30 text-red-300"
      : cta.urgency === "medium"
        ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
        : "bg-foreground/[0.04] border-border/30 text-foreground/80";

  return (
    <section className={`border-b ${tone} px-4 py-2.5`}>
      <div className="container flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-2.5">
          {cta.urgency === "high" ? (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          ) : (
            <Snowflake className="w-4 h-4 shrink-0" />
          )}
          <div className="text-sm">
            <span className="font-bold">{cta.message}</span>
            <span className="opacity-80"> — {cta.sub}</span>
          </div>
        </div>
        <Link
          href={cta.ctaHref}
          onClick={() => track({ type: "weather_cta_clicked", element: cta.ctaHref, props: { urgency: cta.urgency } })}
          className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded bg-foreground/10 hover:bg-foreground/20 px-3 py-1.5 text-xs font-bold tracking-wide whitespace-nowrap"
        >
          {cta.ctaLabel}
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </section>
  );
}

// ─── TRIAGE GRID — Cialdini-architected service entry points ──
//
// Replaces the generic "service tiles" pattern with a triage decision:
// each card asks the visitor "do you have THIS symptom?" → quantifies
// the consequence → offers the immediate-relief CTA.
//
// Per the conversion-overhaul spec, ICON → SYMPTOM → CONSEQUENCE → CTA.
// Tone gradient: danger (red) for urgent / warning (amber) / info (yellow).
function TriageGrid() {
  return (
    <section className="bg-[oklch(0.055_0.004_260)] py-16 lg:py-20 border-t border-border/30">
      <div className="container">
        <FadeIn>
          <div className="text-center mb-10">
            <div className="text-[#FDB913] text-[10px] font-mono uppercase tracking-widest mb-2">
              What's your car telling you?
            </div>
            <h2 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-black text-foreground uppercase tracking-tight">
              Pick your symptom — we'll fix it today.
            </h2>
            <p className="mt-3 text-foreground/50 text-sm sm:text-base max-w-2xl mx-auto">
              Honest diagnosis before any work. Free inspection under 1 hour. Most repairs done same day. $10 down financing available — no credit check, drive away today.
            </p>
          </div>
        </FadeIn>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <ServiceTriageCard
            tone="danger"
            icon={<Disc className="w-5 h-5" />}
            symptom="Grinding or squealing brakes?"
            consequence="Worn pads eat rotors with every stop. Wait too long, a pads-only job becomes pads + rotors + caliper — multiplying the bill."
            relief="Free brake inspection. Written estimate before we touch anything."
            ctaLabel="STOP THE DAMAGE"
            ctaHref="/brakes"
          />
          <ServiceTriageCard
            tone="warning"
            icon={<Activity className="w-5 h-5" />}
            symptom="Check engine light on?"
            consequence="A $200 oxygen sensor untreated typically becomes a $4,000 catalytic converter in 30 days. Damage compounds every mile."
            relief="Free 5-minute code scan. Deeper diagnostic gets a written estimate before any work."
            ctaLabel="DIAGNOSE NOW"
            ctaHref="/diagnostics"
          />
          <ServiceTriageCard
            tone="info"
            icon={<Wrench className="w-5 h-5" />}
            symptom="Tires bald, low, or vibrating?"
            consequence="Stopping distance doubles in rain. Cleveland potholes shred unmatched treads in weeks."
            relief="New & used tires installed with free mount, balance, and alignment check. Walk in or call for a live quote on your size."
            ctaLabel="GET TIRES TODAY"
            ctaHref="/tires"
          />
          <ServiceTriageCard
            tone="warning"
            icon={<Zap className="w-5 h-5" />}
            symptom="AC weak or not cold?"
            consequence="Once it stops working, repairs typically run $400-$1,500 industry-wide. Catching it early often means a simple recharge."
            relief="Free AC inspection. Written estimate before any work."
            ctaLabel="FIX AC NOW"
            ctaHref="/ac-repair"
          />
          <ServiceTriageCard
            tone="warning"
            icon={<Clock className="w-5 h-5" />}
            symptom="Failed Ohio E-Check?"
            consequence="30-day deadline. Day 31 = parking tickets, impound risk, criminal charges for expired registration."
            relief="State-certified emissions repair. Same-day fix — pass guaranteed or we keep working."
            ctaLabel="GET LEGAL"
            ctaHref="/emissions"
          />
          <ServiceTriageCard
            tone="info"
            icon={<Wrench className="w-5 h-5" />}
            symptom="Just need the basics?"
            consequence="Routine oil + filter prevents engine sludge that destroys engines after 60K miles."
            relief="Free 27-point inspection on every oil change. Walk-ins welcome 7 days."
            ctaLabel="BOOK MAINTENANCE"
            ctaHref="/oil-change"
          />
        </div>
      </div>
    </section>
  );
}

// ─── PRICE COMPARE — Anchor & adjustment table ──────────────
//
// Three-row anchor table ("Dealer / Chain / Nick's") for the three highest-
// volume services. Anchor + adjustment is one of the most reliable CRO
// patterns — first number you see sets your reference frame, ours feels
// like rescue.
function PriceCompareSection() {
  return (
    <section className="bg-background py-16 border-t border-border/30">
      <div className="container">
        <FadeIn>
          <div className="text-center mb-10 max-w-2xl mx-auto">
            <div className="text-[#FDB913] text-[10px] font-mono uppercase tracking-widest mb-2">
              The honest math
            </div>
            <h2 className="font-heading text-3xl sm:text-4xl font-black text-foreground uppercase tracking-tight">
              Same job. A fraction of the price.
            </h2>
            <p className="mt-3 text-foreground/50 text-sm sm:text-base">
              Cleveland-area dealer & national-chain quotes vs. ours — on the three services we do most. Same parts, same warranty, a fraction of the price.
            </p>
          </div>
        </FadeIn>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <FadeIn delay={0.05}>
            <AnchorAdjustmentTable
              serviceName="Brake repair, per axle"
              rows={[
                { label: "Cleveland-area dealer", price: "$800" },
                { label: "National chain shop", price: "$600" },
                { label: "Nick's", price: "Free estimate", ours: true },
              ]}
              source="Avg quote, Cleveland metro 2026. Your exact number comes from a free written estimate after we look at the car."
            />
          </FadeIn>
          <FadeIn delay={0.1}>
            <AnchorAdjustmentTable
              serviceName="Synthetic oil change"
              rows={[
                { label: "Dealer", price: "$110" },
                { label: "Chain shop", price: "$89" },
                { label: "Nick's", price: "Free quote", ours: true },
              ]}
              source="Free 27-point inspection included on every oil change. Call or walk in for your live quote."
            />
          </FadeIn>
          <FadeIn delay={0.15}>
            <AnchorAdjustmentTable
              serviceName="OBD-II diagnostic"
              rows={[
                { label: "Dealer", price: "$185" },
                { label: "Chain shop", price: "$120" },
                { label: "Nick's", price: "Free*", ours: true },
              ]}
              source="*Free 5-min scan. Anything beyond that gets a written estimate before we start, credited toward repair if you have us fix it."
            />
          </FadeIn>
        </div>
      </div>
    </section>
  );
}

// ─── SAFETY FACTS — Fear-calibration block ──────────────────
//
// Three big numbers + grim consequences that make abstract risk visceral.
// These are the kind of stats that turn a "maybe later" into "right now."
function SafetyFactsSection() {
  return (
    <section className="bg-[oklch(0.055_0.004_260)] py-12 border-t border-b border-border/30">
      <div className="container">
        <FearCalibrationBlock
          heading="What waiting actually costs"
          stats={[
            {
              value: "287",
              unit: "feet",
              consequence:
                "Added stopping distance at 60 mph with worn brake pads. That's two football fields into an intersection.",
              source: "NHTSA stopping-distance benchmarks.",
            },
            {
              value: "$3,800",
              consequence:
                "Average compounded cost when a $89 fix gets postponed for 90+ days. Sensors fail, parts seize, labor multiplies.",
            },
            {
              value: "30",
              unit: "days",
              consequence:
                "Ohio E-Check deadline. Day 31: parking tickets, impound risk, expired registration. Drive at your own risk.",
            },
          ]}
        />
      </div>
    </section>
  );
}

// ─── LOSS OPPORTUNITY — financing-led urgency ──────────────
//
// Two LossAversionStat cards framed as "ongoing daily loss" — leads
// directly into the financing CTA.
function LossOpportunitySection() {
  return (
    <section className="bg-background py-16 border-t border-border/30">
      <div className="container">
        <FadeIn>
          <div className="text-center mb-10 max-w-2xl mx-auto">
            <div className="text-red-400 text-[10px] font-mono uppercase tracking-widest mb-2">
              The cost of waiting
            </div>
            <h2 className="font-heading text-3xl sm:text-4xl font-black text-foreground uppercase tracking-tight">
              Every day your car gets sicker.
            </h2>
            <p className="mt-3 text-foreground/50 text-sm sm:text-base">
              Don't have the cash today? $0 down financing approved in 90 seconds —
              4 lenders, no hard credit pull, drive away protected.
            </p>
          </div>
        </FadeIn>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <LossAversionStat
            amount={8.5}
            unit="per day"
            label="lost in preventable damage"
            reason="Worn brake pads eat rotors faster every mile. The longer you wait, the bigger the bill."
            ctaHref="/brakes"
            ctaLabel="STOP THE DAMAGE"
          />
          <LossAversionStat
            amount={47}
            unit="per day"
            label="of compounding engine damage"
            reason="Ignored check-engine light = $1,400 in additional repairs after 30 days, on average."
            ctaHref="/diagnostics"
            ctaLabel="DIAGNOSE NOW"
          />
        </div>

        <FadeIn delay={0.2}>
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
            <div className="text-[10px] font-mono uppercase tracking-widest text-emerald-400 mb-2">
              Can't afford NOT to fix it
            </div>
            <h3 className="font-bold text-2xl text-foreground mb-3">
              $0 down · approved in 90 seconds · 4 lenders
            </h3>
            <p className="text-sm text-foreground/60 max-w-xl mx-auto mb-5">
              Acima · Snap · Koalafi · American First. No hard credit pull. Most
              customers approved $500–$5,000. Drive away today, pay over time.
            </p>
            <Link
              href="/financing"
              className="inline-flex items-center gap-2 rounded-full bg-emerald-500 text-emerald-950 px-6 py-3 text-sm font-bold tracking-wide hover:bg-emerald-400 transition-colors"
            >
              SEE FINANCING OPTIONS
              <ArrowRight className="w-4 h-4" />
            </Link>
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
        title="Tire Shop & Auto Repair Cleveland · Walk-Ins 7 Days | Nick's"
        description="Cleveland tire shop & auto repair. Used tires from $60 installed FREE. $10 down financing — no credit check. Brakes, oil change, diagnostics, alignment. 4.9★ · 1,700+ reviews. Walk-ins 7 days · same-day service. (216) 862-0005"
        canonicalPath="/"
      />
      <LocalBusinessSchema includeHowTo includeReviews includeServices />
      {/* Weather-driven banner — only renders when conditions warrant
          (snow / heat / rain / surge demand). Per the conversion spec:
          no manufactured urgency on a calm 70°F day. */}
      <WeatherBanner />
      <Hero />
      {/* ── LIVE STATUS STRIP — Pillar 3 (Happy Wait) ────────── */}
      <section className="bg-[oklch(0.055_0.004_260)] py-6 border-t border-b border-border/30">
        <div className="container flex items-center justify-center">
          <ShopStatusWidget compact />
        </div>
      </section>
      <TrustStrip />
      <TrustBadges />
      <FastPaths />
      <UsedTiresCallout />
      <TrustNumbers />
      {/* CONVERSION ARCHITECTURE (v1.1 spec) — TriageGrid replaces the
          generic service-tile decision flow with a Cialdini-architected
          "pick your symptom" pattern. PriceCompare anchors against
          dealer/chain quotes. SafetyFacts makes risk visceral. */}
      <TriageGrid />
      <PriceCompareSection />
      <SafetyFactsSection />
      <Services />
      <WhyUs />
      <LossOpportunitySection />
      <Reviews />
      <ComparisonTable />
      {/* ── DROP-OFF + UBER-OUT — Pillar 4, the killer flywheel ──────────── */}
      <section className="bg-[oklch(0.055_0.004_260)] py-14 border-t border-border/30">
        <div className="container">
          <div className="max-w-2xl mx-auto text-center mb-8">
            <div className="text-[#FDB913] text-[10px] font-mono uppercase tracking-widest mb-2">
              The Drop-Off Flywheel
            </div>
            <h2 className="font-heading text-3xl sm:text-4xl font-black text-foreground uppercase tracking-tight">
              Drop the car. Keep your day.
            </h2>
            <p className="text-foreground/60 text-sm mt-3 max-w-lg mx-auto">
              Pull up, hand us the keys, tap below to call an Uber right from our lot. We text you the second your car is ready. No waiting-room torture, no wasted PTO.
            </p>
          </div>
          <UberDropoffWidget theme="gold" />
        </div>
      </section>
      <Contact />
      {/* SEO: Comprehensive internal link section for homepage link equity */}
      <section className="bg-[oklch(0.055_0.004_260)] py-16 border-t border-border/30">
        <div className="container">
          <h2 className="font-heading text-2xl font-bold text-foreground tracking-tight uppercase mb-8">
            Your Mechanic Near Me in Cleveland — Every Service, One Shop
          </h2>
          <p className="text-foreground/50 text-sm leading-relaxed mb-8 max-w-3xl">
            Whether you're searching for a mechanic near me, auto repair near me, used tires Cleveland, cheap tires Cleveland, or a tire shop near me — Nick's Tire & Auto has you covered. From brake repair and oil change Cleveland to check engine light diagnostics, wheel alignment, AC repair, and emissions/E-Check, we're the trusted Cleveland auto shop drivers rely on for honest, affordable service 7 days a week. $10 down financing available — no credit check. New & used tires installed free. Walk-ins welcome at our Euclid Avenue location, serving Cleveland, Euclid, Lakewood, Parma, East Cleveland, Cleveland Heights, Shaker Heights, South Euclid, Garfield Heights, Richmond Heights, Mentor, and Strongsville.
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
                  { href: "/booking", label: "Schedule Drop-Off Online" },
                  { href: "/specials", label: "Specials & Coupons" },
                  { href: "/blog", label: "Repair Tips Blog" },
                  { href: "/car-care-guide", label: "Car Care Guide" },
                  { href: "/faq", label: "FAQ" },
                  { href: "/reviews", label: "Customer Reviews" },
                  { href: "/fleet", label: "Fleet Accounts" },
                  { href: "/rewards", label: "Rewards Program" },
                  { href: "/about", label: "About Us" },
                  { href: "/moes-tire-euclid", label: "Looking for Moe's Tire? (Same Spot)" },
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
