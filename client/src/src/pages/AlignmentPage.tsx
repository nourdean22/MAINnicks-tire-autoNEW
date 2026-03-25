/**
 * AlignmentPage — Wheel Alignment Service Page
 * SEO-optimized page for wheel alignment and tire balancing service
 * Problem Hook → Signs → Benefits → FAQ → Booking CTA
 */

import PageLayout from "@/components/PageLayout";
import { SEOHead } from "@/components/SEO";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import BookingForm from "@/components/BookingForm";
import FinancingCTA from "@/components/FinancingCTA";
import FadeIn from "@/components/FadeIn";
import { BUSINESS } from "@shared/business";
import { Phone, CheckCircle, AlertTriangle, Clock, MapPin, CreditCard } from "lucide-react";
import { Link } from "wouter";
import { ACIMA_COMPACT_DISCLOSURE } from "@/lib/acima";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

// Hero image URL
const HERO_IMAGE = "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-main-DE7GKwfCThaBL66r78QWkU.webp";

// ─── HERO SECTION ──────────────────────────────────────
function AlignmentHero() {
  return (
    <section className="relative min-h-[60vh] lg:min-h-[70vh] flex items-end overflow-hidden">
      <div className="absolute inset-0">
        <img
          loading="lazy"
          src={HERO_IMAGE}
          alt="Professional wheel alignment service at Nick's Tire and Auto in Cleveland Ohio"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/40" />
      </div>

      <div className="relative container pb-16 pt-32 lg:pb-24">
        <FadeIn>
          <span className="text-[13px] text-nick-blue-light tracking-wide font-mono">TIRE MAINTENANCE</span>
        </FadeIn>

        <FadeIn delay={0.1}>
          <h1 className="font-semibold font-bold text-4xl sm:text-5xl lg:text-7xl text-foreground leading-[0.9] tracking-tight max-w-3xl mt-4">
            WHEEL ALIGNMENT & TIRE BALANCING
          </h1>
        </FadeIn>

        <FadeIn delay={0.2}>
          <p className="mt-6 text-lg sm:text-xl text-foreground/80 max-w-2xl font-light leading-relaxed">
            Professional wheel alignment keeps your tires pointing in the right direction. Proper alignment extends tire life, improves fuel economy, and ensures safer handling on Cleveland roads.
          </p>
        </FadeIn>

        <FadeIn delay={0.3}>
          <div className="mt-8 flex flex-col sm:flex-row gap-4">
            <a
              href={BUSINESS.phone.href}
              className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-md font-semibold font-bold text-lg tracking-wide hover:opacity-90 transition-colors"
              aria-label={`Call Nick's Tire and Auto at ${BUSINESS.phone.display}`}
            >
              <Phone className="w-5 h-5" />
              CALL NOW
            </a>
            <a
              href="#booking"
              className="inline-flex items-center justify-center gap-2 border-2 border-nick-blue/50 text-nick-blue-light px-8 py-4 rounded-md font-semibold font-bold text-lg tracking-wide hover:bg-nick-blue/10 hover:border-nick-blue transition-colors"
            >
              BOOK ONLINE
            </a>
          </div>
        </FadeIn>

        <FadeIn delay={0.4}>
          <div className="mt-8 flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-2 bg-nick-blue/10 border border-nick-blue/20 rounded-md px-4 py-2">
              <Clock className="w-4 h-4 text-nick-blue-light shrink-0" />
              <span className="text-foreground/80 text-[12px]">Most alignments completed same day</span>
            </div>
            <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-md px-4 py-2">
              <CheckCircle className="w-4 h-4 text-primary shrink-0" />
              <span className="text-foreground/80 text-[12px]">Alignment typically $80–$120 per vehicle</span>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-emerald-500/5 border border-emerald-500/20 rounded-md px-4 py-2">
            <CreditCard className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-foreground/80 text-[12px]">
              Payment options available — <Link href="/financing?utm_source=alignment" className="text-emerald-400 hover:text-emerald-300">lease-to-own from $10 down</Link>
            </span>
          </div>
          <p className="text-[9px] text-foreground/25 mt-1 ml-6">{ACIMA_COMPACT_DISCLOSURE}</p>
        </FadeIn>
      </div>
    </section>
  );
}

// ─── SIGNS YOU NEED ALIGNMENT ──────────────────────────
function SignsSection() {
  return (
    <section className="bg-[oklch(0.055_0.004_260)] py-20 lg:py-28">
      <div className="container">
        <FadeIn>
          <span className="font-mono text-nick-blue-light text-sm tracking-wide">Common Signs</span>
          <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight">
            SIGNS YOU NEED AN <span className="text-primary">ALIGNMENT</span>
          </h2>
          <p className="mt-4 text-foreground/60 text-lg max-w-2xl">
            If you notice any of these warning signs, your vehicle likely needs a wheel alignment adjustment.
          </p>
        </FadeIn>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
          {[
            {
              title: "Car Pulling to One Side",
              description: "If your vehicle drifts left or right without you turning the wheel, alignment is needed.",
            },
            {
              title: "Uneven Tire Wear",
              description: "Check your tire treads carefully. Wear on one edge means your wheels are angled incorrectly.",
            },
            {
              title: "Crooked Steering Wheel",
              description: "When driving straight, your steering wheel should be centered. If it's off-center, alignment has shifted.",
            },
            {
              title: "Vibration or Shaking",
              description: "Alignment problems can cause subtle vibration through the steering wheel or seat, especially at highway speeds.",
            },
          ].map((sign, i) => (
            <FadeIn key={i} delay={i * 0.08}>
              <div className="bg-card/60 border border-nick-blue/10 rounded-lg p-6 lg:p-8">
                <div className="flex items-start gap-4">
                  <AlertTriangle className="w-6 h-6 text-primary shrink-0 mt-1" />
                  <div>
                    <h3 className="font-semibold font-bold text-lg text-foreground tracking-wide mb-2">
                      {sign.title}
                    </h3>
                    <p className="text-foreground/70 leading-relaxed">{sign.description}</p>
                  </div>
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── BENEFITS SECTION ──────────────────────────────────
function BenefitsSection() {
  return (
    <section className="py-20 lg:py-28">
      <div className="container">
        <FadeIn>
          <span className="font-mono text-nick-blue-light text-sm tracking-wide">Why Alignment Matters</span>
          <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight">
            BENEFITS OF REGULAR <span className="text-primary">ALIGNMENT</span>
          </h2>
          <p className="mt-4 text-foreground/60 text-lg max-w-2xl">
            Proper wheel alignment protects your investment and improves your driving experience.
          </p>
        </FadeIn>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            {
              title: "Extends Tire Life",
              description: "Misaligned wheels cause premature and uneven tire wear. Proper alignment means your tires last 10,000+ miles longer.",
              icon: "🛞",
            },
            {
              title: "Better Fuel Economy",
              description: "Wheels that point in different directions create drag. Proper alignment improves gas mileage by 3–5%.",
              icon: "⛽",
            },
            {
              title: "Safer Handling",
              description: "Your vehicle responds more predictably when wheels are aligned. Safer stops, turns, and emergency maneuvers.",
              icon: "🛡️",
            },
          ].map((benefit, i) => (
            <FadeIn key={i} delay={i * 0.08}>
              <div className="bg-[oklch(0.055_0.004_260)] border border-nick-blue/10 rounded-lg p-8">
                <div className="text-4xl mb-4">{benefit.icon}</div>
                <h3 className="font-semibold font-bold text-xl text-foreground mb-3">{benefit.title}</h3>
                <p className="text-foreground/70 leading-relaxed">{benefit.description}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── FAQ SECTION ───────────────────────────────────────
function FAQSection() {
  const [open, setOpen] = useState<number | null>(0);

  const faqs = [
    {
      question: "How much does a wheel alignment cost?",
      answer: "A standard two-wheel alignment typically costs $80–$100, while a four-wheel alignment runs $100–$120 depending on your vehicle. We provide a free alignment inspection so you know exactly what your vehicle needs.",
    },
    {
      question: "How long does an alignment take?",
      answer: "Most alignments take 45 minutes to an hour. We use computerized alignment equipment to precisely adjust all wheels to manufacturer specifications. You can wait in our comfortable lounge or grab a coffee nearby.",
    },
    {
      question: "When should I get an alignment?",
      answer: "Get an alignment whenever you notice pulling, uneven tire wear, or a crooked steering wheel. We also recommend alignments after new tires, suspension work, or hitting a pothole. Many drivers align twice yearly given Cleveland's tough road conditions.",
    },
    {
      question: "Is a two-wheel or four-wheel alignment better?",
      answer: "Four-wheel alignments are more precise and correct all four wheels. However, most front-wheel-drive vehicles only need a two-wheel (front) alignment. We'll inspect your vehicle and recommend what's best for your make and model.",
    },
    {
      question: "Can alignment affect my gas mileage?",
      answer: "Yes. Misaligned wheels create rolling resistance and drag. Proper alignment can improve fuel economy by 3–5%, which adds up to real savings over time.",
    },
  ];

  return (
    <section className="bg-[oklch(0.055_0.004_260)] py-20 lg:py-28">
      <div className="container">
        <FadeIn>
          <span className="font-mono text-nick-blue-light text-sm tracking-wide">Questions</span>
          <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight">
            FREQUENTLY ASKED <span className="text-primary">QUESTIONS</span>
          </h2>
          <p className="mt-4 text-foreground/60 text-lg max-w-2xl">
            Everything you need to know about wheel alignment and tire balancing.
          </p>
        </FadeIn>

        <div className="mt-12 max-w-3xl">
          {faqs.map((faq, i) => (
            <FadeIn key={i} delay={i * 0.06}>
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full text-left border-b border-nick-blue/15 py-6 group"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold font-bold text-lg lg:text-xl text-foreground tracking-wider group-hover:text-primary transition-colors">
                    {faq.question}
                  </h3>
                  <ChevronDown
                    className={`w-5 h-5 text-nick-blue-light transition-transform duration-200 shrink-0 ml-4 ${
                      open === i ? "rotate-180" : ""
                    }`}
                  />
                </div>
                <AnimatePresence>
                  {open === i && (
                    <motion.p
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-4 text-foreground/70 leading-relaxed text-base overflow-hidden"
                    >
                      {faq.answer}
                    </motion.p>
                  )}
                </AnimatePresence>
              </button>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── BOOKING SECTION ───────────────────────────────────
function BookingSection() {
  return (
    <section id="booking" className="bg-[oklch(0.065_0.004_260)] py-20 lg:py-28">
      <div className="container">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20">
          <FadeIn>
            <div>
              <span className="font-mono text-primary text-sm tracking-wide">Get Started</span>
              <h2 className="font-semibold font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight leading-[1.05]">
                SCHEDULE YOUR
                <br />
                <span className="text-primary">ALIGNMENT SERVICE</span>
              </h2>
              <p className="mt-6 text-foreground/70 leading-relaxed text-lg">
                Fill out the form and we will call you to confirm your appointment. Or call us directly at {BUSINESS.phone.display} — walk-ins are always welcome.
              </p>

              <div className="mt-8 space-y-6">
                <div className="flex items-start gap-3">
                  <MapPin className="w-5 h-5 text-nick-blue-light mt-1 shrink-0" />
                  <div>
                    <p className="font-mono text-foreground/80">{BUSINESS.address.street}</p>
                    <p className="font-mono text-foreground/80">Cleveland, OH 44112</p>
                  </div>
                </div>
              </div>
            </div>
          </FadeIn>

          <FadeIn delay={0.1}>
            <BookingForm defaultService="Alignment" />
            <FinancingCTA variant="banner" className="mt-6" />
          </FadeIn>
        </div>
      </div>
    </section>
  );
}

// ─── MAIN PAGE ─────────────────────────────────────────
export default function AlignmentPage() {
  return (
    <PageLayout>
      <SEOHead
        title="Wheel Alignment Cleveland OH | Nick's Tire & Auto"
        description="Professional wheel alignment and tire balancing in Cleveland. We fix pulling, uneven tire wear, and crooked steering wheels. Same-day service. Call (216) 862-0005."
        canonicalPath="/alignment"
      />
      <LocalBusinessSchema additionalSchema={{ "hasOfferCatalog": { "@type": "OfferCatalog", "name": "Wheel Alignment", "itemListElement": [{ "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Wheel Alignment", "serviceType": "Wheel Alignment" } }] } }} />

      <AlignmentHero />
      <SignsSection />
      <BenefitsSection />
      <FAQSection />
      <BookingSection />
    </PageLayout>
  );
}
