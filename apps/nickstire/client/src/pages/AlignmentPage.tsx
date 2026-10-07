/**
 * AlignmentPage — Wheel Alignment Service Page
 * SEO-optimized page for wheel alignment and tire balancing service
 * Problem Hook → Signs → Benefits → FAQ → Booking CTA
 */

import InternalLinks from "@/components/InternalLinks";
import PageLayout from "@/components/PageLayout";
import { SEOHead } from "@/components/SEO";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import BookingForm from "@/components/BookingForm";
import FinancingCTA from "@/components/FinancingCTA";
import FadeIn from "@/components/FadeIn";
import { BUSINESS } from "@shared/business";
import { getRouteByPath } from "@shared/routes";
import { Phone, CheckCircle, AlertTriangle, Clock, MapPin, CreditCard } from "lucide-react";
import { Link } from "wouter";
import { ACIMA_COMPACT_DISCLOSURE } from "@/lib/acima";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

// Hero image URL
// 2026-05-06 wave-16 · pro photo pack: alignment is general-repair
// per the placement guide → busy-shop-action-mechanics shows real
// shop activity, the right credibility shot for non-tire mechanical work
const HERO_IMAGE = "/photos/busy-shop-action-mechanics.webp";

// FAQ data — lifted to module scope so it can power BOTH the visual accordion
// and the JSON-LD FAQPage schema (which becomes Google rich snippets).
const ALIGNMENT_FAQS = [
  {
    question: "How much does a wheel alignment cost?",
    answer: "Pull-check is free — we put the car on the Hunter rack and measure camber, caster, and toe. If the alignment is in spec, you owe nothing. If it needs work, we put the price in writing before any wrench moves — you don't pay until you say yes.",
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
    answer: "Yes. Misaligned wheels create rolling resistance and drag. Proper alignment can improve fuel economy by 3-5%, which adds up to real savings over time.",
  },
  {
    question: "Where can I get wheel alignment near me in Cleveland?",
    answer: "Nick's Tire & Auto at 17625 Euclid Ave, Cleveland, OH 44112. Hunter alignment rack, all wheels adjusted to manufacturer spec. Walk-ins welcome 7 days a week. Call (216) 862-0005.",
  },
  {
    question: "How much does wheel alignment cost in Cleveland?",
    answer: "Pull-check is free at Nick's on Euclid Ave — we put the car on the Hunter rack and measure. If alignment is needed, we put the price in writing before any wrench moves. You don't pay until you say yes.",
  },
];

// ─── HERO SECTION ──────────────────────────────────────
function AlignmentHero() {
  return (
    <section className="relative min-h-[60vh] lg:min-h-[70vh] flex items-end overflow-hidden">
      <div className="absolute inset-0">
        {/* LCP fix · above-the-fold hero */}
        <img
          loading="eager"
          fetchPriority="high"
          src={HERO_IMAGE}
          alt="Wheel alignment Cleveland — precision Hunter alignment at Nick's Tire & Auto Euclid Ave"
          className="w-full h-full object-cover"
          style={{ objectPosition: "center 50%" }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/40" />
      </div>

      <div className="relative container pb-16 pt-32 lg:pb-24">
        <FadeIn>
          <span className="text-[13px] text-nick-blue-light tracking-wide font-mono">TIRE MAINTENANCE</span>
        </FadeIn>

        <FadeIn delay={0.1}>
          <h1 className="font-bold text-4xl sm:text-5xl lg:text-7xl text-foreground leading-[0.9] tracking-tight max-w-3xl mt-4">
            WHEEL ALIGNMENT CLEVELAND OH
          </h1>
        </FadeIn>

        <FadeIn delay={0.2}>
          {/* 2026-05-06 copy wave: insider vocab (camber/caster/toe)
              + useful absurd ("road that filed for divorce") + anti-
              pattern (most chains hand you a slip with no numbers). */}
          <p className="mt-6 text-lg sm:text-xl text-foreground/80 max-w-2xl font-light leading-relaxed body-pretty">
            Steering wheel pulls left like it's filing for divorce? Tires chewing on one edge after a winter of potholes? Pull up to Nick's. We hook your car to the Hunter rack, measure camber, caster, and toe to a tenth of a degree, and hand you the printout when we're done. Most chains keep that paper. We give it to you. Walk-ins 7 days, most jobs out the door before lunch.
          </p>
        </FadeIn>

        <FadeIn delay={0.3}>
          <div className="mt-8 flex flex-col sm:flex-row gap-4 stagger-in">
            <a
              href={BUSINESS.phone.href}
              className="inline-flex items-center justify-center gap-2 stagger-in bg-primary text-primary-foreground btn-premium px-8 py-4 rounded-md font-bold text-lg tracking-wide hover:opacity-90 transition-colors"
              aria-label={`Call Nick's Tire and Auto at ${BUSINESS.phone.display}`}
            >
              <Phone className="w-5 h-5" />
              {BUSINESS.phone.display}
            </a>
            <a
              href="#booking"
              className="inline-flex items-center justify-center gap-2 stagger-in border-2 border-nick-blue/50 text-nick-blue-light px-8 py-4 rounded-md font-bold text-lg tracking-wide hover:bg-nick-blue/10 hover:border-nick-blue transition-colors"
            >
              SCHEDULE DROP-OFF
            </a>
          </div>
        </FadeIn>

        <FadeIn delay={0.4}>
          <div className="mt-8 flex flex-wrap gap-4 stagger-in text-sm">
            <div className="flex items-center gap-2 stagger-in bg-nick-blue/10 border border-nick-blue/20 rounded-md px-4 py-2">
              <Clock className="w-4 h-4 text-nick-blue-light shrink-0" />
              <span className="text-foreground/80 text-[12px]">Most alignments completed same day</span>
            </div>
            <div className="flex items-center gap-2 stagger-in bg-primary/10 border border-primary/20 rounded-md px-4 py-2">
              <CheckCircle className="w-4 h-4 text-primary shrink-0" />
              <span className="text-foreground/80 text-[12px]">Free pull-check · written quote · you don't pay until you say yes</span>
            </div>
          </div>
          <div className="flex items-center gap-2 stagger-in bg-emerald-500/5 border border-emerald-500/20 rounded-md px-4 py-2">
            <CreditCard className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-foreground/80 text-[12px]">
              Payment programs available — <Link href="/financing?utm_source=alignment" className="text-emerald-400 hover:text-emerald-300">Acima lease-to-own can start at $10 in select circumstances</Link>
            </span>
          </div>
          <p className="text-[10px] text-foreground/50 mt-1 ml-6">{ACIMA_COMPACT_DISCLOSURE}</p>
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
          <h2 className="font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight">
            SIGNS YOU NEED AN <span className="text-primary">ALIGNMENT</span>
          </h2>
          <p className="mt-4 text-foreground/60 text-lg max-w-2xl">
            If you notice any of these warning signs, your vehicle likely needs a wheel alignment adjustment.
          </p>
        </FadeIn>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6 stagger-in">
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
                <div className="flex items-start gap-4 stagger-in">
                  <AlertTriangle className="w-6 h-6 text-primary shrink-0 mt-1" />
                  <div>
                    <h3 className="font-bold text-lg text-foreground tracking-wide mb-2">
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
          <h2 className="font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight">
            BENEFITS OF REGULAR <span className="text-primary">ALIGNMENT</span>
          </h2>
          <p className="mt-4 text-foreground/60 text-lg max-w-2xl">
            Proper wheel alignment protects your investment and improves your driving experience.
          </p>
        </FadeIn>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-8 stagger-in">
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
                <h3 className="font-bold text-xl text-foreground mb-3">{benefit.title}</h3>
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
  const faqs = ALIGNMENT_FAQS;

  return (
    <section className="bg-[oklch(0.055_0.004_260)] py-20 lg:py-28">
      <div className="container">
        <FadeIn>
          <span className="font-mono text-nick-blue-light text-sm tracking-wide">Questions</span>
          <h2 className="font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight">
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
                  <h3 className="font-bold text-lg lg:text-xl text-foreground tracking-wider group-hover:text-primary transition-colors">
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 stagger-in lg:gap-20">
          <FadeIn>
            <div>
              <span className="font-mono text-primary text-sm tracking-wide">Get Started</span>
              <h2 className="font-bold text-3xl lg:text-5xl text-foreground mt-3 tracking-tight leading-[1.05]">
                DROP IT OFF
                <br />
                <span className="text-primary">FOR ALIGNMENT</span>
              </h2>
              <p className="mt-6 text-foreground/70 leading-relaxed text-lg">
                Fill out below and we'll text you back fast. Or just pull up — walk-ins always welcome, 7 days at 17625 Euclid Ave. Or call {BUSINESS.phone.display}.
              </p>

              <div className="mt-8 space-y-6">
                <div className="flex items-start gap-3 stagger-in">
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
  // FAQPage schema — turns the FAQ section into a Google rich snippet that
  // can show as expandable answers in SERP, dramatically boosting CTR.
  const faqPageSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: ALIGNMENT_FAQS.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: f.answer,
      },
    })),
  };

  // BreadcrumbList schema — shows the breadcrumb trail in SERP listings,
  // which signals site structure to Google and boosts visual prominence.
  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://nickstire.org/" },
      { "@type": "ListItem", position: 2, name: "Services", item: "https://nickstire.org/services" },
      { "@type": "ListItem", position: 3, name: "Wheel Alignment", item: "https://nickstire.org/alignment" },
    ],
  };

  // Service schema — gives Google explicit signals that this page IS the
  // wheel-alignment service offering. Note: `aggregateRating` was removed
  // because schema.org Service does NOT support it as a direct property
  // (it belongs on LocalBusiness/Product). LocalBusinessSchema component
  // already emits the AggregateRating on the AutoRepair node, so Google
  // gets the rating signal from there.
  const serviceSchema = {
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: "Wheel Alignment",
    provider: {
      "@type": "AutoRepair",
      name: BUSINESS.name,
      telephone: `+1-${BUSINESS.phone.dashed}`,
      address: {
        "@type": "PostalAddress",
        streetAddress: BUSINESS.address.street,
        addressLocality: BUSINESS.address.city,
        addressRegion: BUSINESS.address.state,
        postalCode: BUSINESS.address.zip,
      },
    },
    areaServed: { "@type": "City", name: "Cleveland" },
    description: "Computerized wheel alignment service. Fix pulling, uneven tire wear, and crooked steering. Same-day service, walk-ins welcome 7 days a week.",
  };

  return (
    <PageLayout showChat={true}>
      {/* wave-176 · GSC (28d): /alignment at pos 31.6 / 0% CTR over
          300 impressions. Old description was 200 chars → truncated
          mid-sentence on mobile SERP, hiding the phone + free-check offer.
          Trimmed to 152 chars so the value props all survive.
          2026-10-07 · title comes from shared/routes.ts. The literal that
          used to sit here was byte-identical to WheelAlignmentClevelandPage's,
          so two URLs served one <title> and the registry's wave-181.6
          "near me" rewrite never reached the page
          (client/src/__tests__/seo-title-single-source.test.ts). */}
      <SEOHead
        title={getRouteByPath("/alignment")?.title ?? ""}
        description="Cleveland wheel alignment on Euclid Ave. Hunter rack, free pull-check first, written quote before any work. You don't pay until you say yes. Walk in 7 days."
        canonicalPath="/alignment"
      />
      <LocalBusinessSchema additionalSchema={{ "hasOfferCatalog": { "@type": "OfferCatalog", "name": "Wheel Alignment", "itemListElement": [{ "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Wheel Alignment", "serviceType": "Wheel Alignment" } }] } }} />

      {/* JSON-LD: FAQPage + BreadcrumbList + Service. Three separate tags is
          preferred over @graph — Google parses each independently. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqPageSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceSchema) }} />

      <AlignmentHero />
      <SignsSection />
      <BenefitsSection />
      <FAQSection />
      <BookingSection />
      <InternalLinks />
    </PageLayout>
  );
}
