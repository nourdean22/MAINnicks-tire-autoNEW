/**
 * SyntheticOilChangePage — targeted SEO landing for "synthetic oil change"
 *
 * Real GSC data (30d): 3,333 impressions ranking #64. Zero clicks.
 * That's thousands of people searching "synthetic oil change" and we're
 * deep in the results with no dedicated page. This fixes that.
 *
 * Page anatomy (classic SEO service page, no dead calories):
 *  - Hero H1 with the exact query + local (Cleveland/Euclid)
 *  - Price anchor block (up-front transparency cuts CTR friction)
 *  - Full vs synthetic blend vs conventional comparison (builds intent)
 *  - What's included (parts, time, warranty)
 *  - FAQ schema + content (matches Google's People Also Ask)
 *  - Booking CTA + phone CTA
 *
 * Stays under 350 lines by reusing shared components (PageLayout,
 * SEOHead, LocalBusinessSchema, BookingForm, FadeIn, FinancingCTA).
 */

import InternalLinks from "@/components/InternalLinks";
import PageLayout from "@/components/PageLayout";
import { SEOHead, Breadcrumbs } from "@/components/SEO";
import LocalBusinessSchema from "@/components/LocalBusinessSchema";
import BookingForm from "@/components/BookingForm";
import FadeIn from "@/components/FadeIn";
import { BUSINESS } from "@shared/business";
import { Phone, CheckCircle, Clock, ShieldCheck, Droplet, DollarSign } from "lucide-react";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

// 2026-05-06 wave-16 · pro photo pack: oil change page hero per
// PLACEMENT_GUIDE.md "Oil change page" row — interior bay reads
// clean / fast / professional, NOT heavy under-car repair
const HERO_IMAGE = "/photos/interior-service-bay-car-lift.webp";

// ─── HERO ──────────────────────────────────────────────
function Hero() {
  return (
    <section className="relative min-h-[55vh] flex items-end overflow-hidden">
      <div className="absolute inset-0">
        {/* LCP fix · above-the-fold hero */}
        <img
          loading="eager"
          fetchPriority="high"
          src={HERO_IMAGE}
          alt="Full synthetic oil change Cleveland — Nick's Tire & Auto Euclid Ave"
          className="w-full h-full object-cover"
          style={{ objectPosition: "center 45%" }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/40" />
      </div>
      <div className="relative container pb-12 pt-28 lg:pb-16">
        <FadeIn>
          <span className="text-[13px] text-nick-blue-light tracking-wide font-mono">OIL CHANGE SERVICE</span>
        </FadeIn>
        <FadeIn delay={0.1}>
          <h1 className="font-bold text-4xl sm:text-5xl lg:text-6xl text-foreground leading-[0.95] tracking-tight max-w-3xl mt-4">
            SYNTHETIC OIL CHANGE CLEVELAND
          </h1>
        </FadeIn>
        <FadeIn delay={0.2}>
          <p className="mt-5 text-lg text-foreground/80 max-w-2xl font-light leading-relaxed">
            Full synthetic oil change from <span className="font-semibold text-foreground">$80</span>. Better engine protection, longer intervals (7,500–10,000 mi), cleaner burn. Same-day at Nick&apos;s Tire &amp; Auto in Euclid — walk-ins welcome 7 days a week.
          </p>
        </FadeIn>
        <FadeIn delay={0.3}>
          <div className="mt-7 flex flex-col sm:flex-row gap-3">
            <a
              href={BUSINESS.phone.href}
              className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground btn-premium px-7 py-4 rounded-md font-bold text-lg tracking-wide hover:opacity-90 transition-colors"
              aria-label={`Call ${BUSINESS.phone.display}`}
            >
              <Phone className="w-5 h-5" /> {BUSINESS.phone.display}
            </a>
            {/* 2026-07-02 operator rule · oil changes are first-come,
                first-served sit-and-wait — no drop-off. Same swap as
                /oil-change (see serviceConversionData "oil-change"). */}
            <a
              href="#booking"
              className="inline-flex items-center justify-center gap-2 border-2 border-nick-blue/50 text-nick-blue-light px-7 py-4 rounded-md font-bold text-lg tracking-wide hover:bg-nick-blue/10 hover:border-nick-blue transition-colors"
            >
              CAN I COME NOW?
            </a>
          </div>
        </FadeIn>
        <FadeIn delay={0.4}>
          <div className="mt-8 flex flex-wrap gap-3 text-sm">
            {[
              { icon: <Clock className="w-4 h-4" />, text: "30-minute service" },
              { icon: <ShieldCheck className="w-4 h-4" />, text: "Top-tier oil brands" },
              { icon: <DollarSign className="w-4 h-4" />, text: "From $80 full synthetic" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-2 bg-nick-blue/10 border border-nick-blue/20 rounded-md px-3 py-1.5">
                <span className="text-nick-blue-light">{item.icon}</span>
                <span className="text-foreground/80 text-[12px]">{item.text}</span>
              </div>
            ))}
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

// ─── PRICING ANCHOR ────────────────────────────────────
function PricingSection() {
  const tiers = [
    { name: "Conventional", price: "$49", miles: "3,000–5,000 mi", use: "Older vehicles, low-mileage drivers", tint: "text-foreground/70" },
    { name: "Synthetic Blend", price: "$49", miles: "5,000–7,500 mi", use: "Most modern cars, daily commuting", tint: "text-primary" },
    { name: "Full Synthetic", price: "$80", miles: "7,500–10,000 mi", use: "Turbocharged, high-performance, cold-weather driving", tint: "text-emerald-400", featured: true },
  ];
  return (
    <section className="py-16 bg-background">
      <div className="container max-w-5xl">
        <FadeIn>
          <h2 className="font-bold text-3xl sm:text-4xl text-foreground tracking-tight">OIL CHANGE PRICING</h2>
          <p className="text-foreground/60 mt-2">Up-front pricing. No upsell games. Full synthetic highly recommended for 2012+ engines.</p>
        </FadeIn>
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4">
          {tiers.map((tier) => (
            <FadeIn key={tier.name} delay={0.1}>
              <div className={`border rounded-lg p-6 bg-card transition-all ${tier.featured ? "border-emerald-500/40 ring-1 ring-emerald-500/20" : "border-border/30"}`}>
                {tier.featured && <span className="inline-block text-[10px] font-bold tracking-wider text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded mb-2">RECOMMENDED</span>}
                <h3 className={`font-bold text-xl ${tier.tint}`}>{tier.name}</h3>
                <p className="font-bold text-3xl text-foreground mt-1">{tier.price}</p>
                <p className="text-[11px] text-foreground/50 mt-1">starting, up to 5 quarts</p>
                <div className="mt-4 space-y-2 text-[13px]">
                  <div className="flex items-start gap-2"><Droplet className="w-3.5 h-3.5 text-foreground/40 shrink-0 mt-0.5" /><span className="text-foreground/80">Change interval: {tier.miles}</span></div>
                  <div className="flex items-start gap-2"><CheckCircle className="w-3.5 h-3.5 text-foreground/40 shrink-0 mt-0.5" /><span className="text-foreground/70">{tier.use}</span></div>
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
        <p className="text-[11px] text-foreground/40 text-center mt-4">Diesel, European, and special-spec oil pricing varies. Call for quote.</p>
      </div>
    </section>
  );
}

// ─── WHAT'S INCLUDED ───────────────────────────────────
function IncludedSection() {
  const items = [
    "Up to 5 quarts of premium synthetic oil (Mobil 1, Pennzoil Platinum, Valvoline)",
    "New OEM-spec oil filter",
    "Complete drain and refill",
    "Top-off all fluids (washer, power steering, coolant)",
    "Tire pressure check and adjustment",
    "20-point safety check — brakes, belts, lights, battery",
    "Courtesy reset of oil life monitor",
    "Printed service record + sticker reminder",
  ];
  return (
    <section className="py-16 bg-card/20 border-y border-border/20">
      <div className="container max-w-4xl">
        <FadeIn>
          <h2 className="font-bold text-3xl text-foreground tracking-tight">WHAT&apos;S INCLUDED</h2>
          <p className="text-foreground/60 mt-2">Every synthetic oil change at Nick&apos;s comes with this full package — we tell you the cost before we touch anything.</p>
        </FadeIn>
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-3">
          {items.map((item, i) => (
            <FadeIn key={i} delay={i * 0.05}>
              <div className="flex items-start gap-3 bg-background/50 border border-border/20 rounded px-4 py-3">
                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span className="text-[13px] text-foreground/90">{item}</span>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── FAQ ───────────────────────────────────────────────
const FAQS = [
  { q: "How often should I get a synthetic oil change?", a: "Most modern cars with full synthetic oil can go 7,500–10,000 miles between changes. Check your owner's manual — some high-performance or turbo engines call for 5,000 mi intervals. If in doubt, we'll check your factory spec and let you know." },
  { q: "Is full synthetic really worth the extra $30?", a: "For 2012+ engines, yes. Synthetic oil resists breakdown at high temps, keeps engines cleaner, and protects better in Cleveland's cold winters. Over a year, you'll do fewer changes — so the cost-per-mile is often LOWER than conventional." },
  { q: "Do I need an appointment?", a: "No — walk-ins welcome 7 days a week. Most oil changes done in 30 minutes. Call ahead at (216) 862-0005 if you want to skip the short wait." },
  { q: "What synthetic oil brands do you use?", a: "Mobil 1, Pennzoil Platinum, and Valvoline Full Synthetic — all top-tier API-certified brands meeting manufacturer specs for your vehicle." },
  { q: "Can you reset my oil life monitor?", a: "Yes, included free with every oil change. We reset the dash indicator so your car knows a fresh change was done." },
  { q: "Do you offer diesel oil changes?", a: "Yes — we service diesel engines (Duramax, Cummins, Power Stroke). Diesel oil changes are priced per-quart given larger capacity. Call for exact quote." },
  { q: "How long does a synthetic oil change take?", a: "About 30 minutes for most vehicles. If you drop off, we'll text when it's ready. Dropping off is often fastest during morning rush (7–10 AM) or weekends." },
];

function FAQSection() {
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  return (
    <section className="py-16 bg-background">
      <div className="container max-w-3xl">
        <FadeIn>
          <h2 className="font-bold text-3xl text-foreground tracking-tight">FREQUENTLY ASKED QUESTIONS</h2>
        </FadeIn>
        <div className="mt-8 space-y-2">
          {FAQS.map((faq, i) => {
            const isOpen = openIdx === i;
            return (
              <div key={i} className="border border-border/30 rounded overflow-hidden bg-card/40">
                <button
                  type="button"
                  onClick={() => setOpenIdx(isOpen ? null : i)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-card/60 transition-colors"
                >
                  <span className="font-semibold text-[14px] text-foreground">{faq.q}</span>
                  <ChevronDown className={`w-4 h-4 text-foreground/40 transition-transform shrink-0 ${isOpen ? "rotate-180" : ""}`} />
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <p className="px-4 pb-4 text-[13px] text-foreground/75 leading-relaxed">{faq.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── BOOKING CTA ───────────────────────────────────────
function BookingSection() {
  return (
    <section id="booking" className="py-16 bg-card/20 border-t border-border/20">
      <div className="container max-w-4xl">
        <FadeIn>
          <h2 className="font-bold text-3xl text-foreground tracking-tight">CAN I COME NOW? YES — PULL UP.</h2>
          <p className="text-foreground/60 mt-2">Oil changes are first-come, first-served. No appointment, no drop-off — pull up, have a seat, and most are done in about 15 minutes. 17625 Euclid Ave, Cleveland OH. Or send your info below and we&apos;ll text you back.</p>
        </FadeIn>
        <FadeIn delay={0.1}>
          <div className="mt-6 bg-card border border-border/30 rounded-lg p-6">
            <BookingForm defaultService="oil-change" />
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

// ─── MAIN PAGE ─────────────────────────────────────────
export default function SyntheticOilChangePage() {
  return (
    <PageLayout showChat={true}>
      <SEOHead
        title="Synthetic Oil Change Cleveland · From $80 · Walk-In 7 Days | Nick's"
        description="Full synthetic oil change in Cleveland/Euclid from $80. Mobil 1, Pennzoil, Valvoline. Walk-ins 7 days. 10,000-mile intervals. (216) 862-0005"
        canonicalPath="/synthetic-oil-change"
      />
      {/* v1.7 SEO · BreadcrumbList */}
      <Breadcrumbs items={[{ label: "Synthetic Oil Change" }]} />
      <LocalBusinessSchema
        additionalSchema={{
          "hasOfferCatalog": {
            "@type": "OfferCatalog",
            "name": "Synthetic Oil Change",
            "itemListElement": [
              { "@type": "Offer", "price": "80", "priceCurrency": "USD", "itemOffered": { "@type": "Service", "name": "Full Synthetic Oil Change", "serviceType": "Oil Change" } },
              { "@type": "Offer", "price": "49", "priceCurrency": "USD", "itemOffered": { "@type": "Service", "name": "Synthetic Blend Oil Change", "serviceType": "Oil Change" } },
              { "@type": "Offer", "price": "49", "priceCurrency": "USD", "itemOffered": { "@type": "Service", "name": "Conventional Oil Change", "serviceType": "Oil Change" } },
            ],
          },
        }}
      />
      {/* FAQPage as its own top-level JSON-LD — fixes "Duplicate field FAQPage" GSC error */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": FAQS.map((f) => ({
              "@type": "Question",
              "name": f.q,
              "acceptedAnswer": { "@type": "Answer", "text": f.a },
            })),
          }),
        }}
      />
      {/* wave-178: top-level Service entity with provider + areaServed.
          Previously this page only emitted an OfferCatalog inside
          LocalBusiness — Google saw the offers but not a Service entity
          for "synthetic oil change Cleveland" queries to attach to.
          Now there's an explicit Service that Google can rank for. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Service",
            name: "Synthetic Oil Change",
            description: "Full synthetic oil change in Cleveland from $80. Mobil 1, Pennzoil Platinum, Valvoline. 30-minute service, walk-ins 7 days. 10,000-mile intervals.",
            serviceType: "Oil Change",
            image: "https://nickstire.org/photos/interior-service-bay-car-lift.webp",
            provider: {
              "@type": "AutoRepair",
              name: "Nick's Tire & Auto",
              telephone: "+1-216-862-0005",
              url: "https://nickstire.org/synthetic-oil-change",
              address: {
                "@type": "PostalAddress",
                streetAddress: "17625 Euclid Ave",
                addressLocality: "Cleveland",
                addressRegion: "OH",
                postalCode: "44112",
                addressCountry: "US",
              },
            },
            areaServed: [
              { "@type": "City", name: "Cleveland" },
              { "@type": "City", name: "Euclid" },
              { "@type": "City", name: "Parma" },
              { "@type": "City", name: "Lakewood" },
              { "@type": "City", name: "Cleveland Heights" },
              { "@type": "City", name: "East Cleveland" },
            ],
            offers: {
              "@type": "AggregateOffer",
              priceCurrency: "USD",
              lowPrice: "39",
              highPrice: "89",
              offerCount: "3",
            },
          }),
        }}
      />

      <Hero />
      <PricingSection />
      <IncludedSection />
      <FAQSection />
      <BookingSection />
      <InternalLinks />
    </PageLayout>
  );
}
