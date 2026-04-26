/**
 * TireShopNearMePage — targets "tire shops near me" query cluster.
 * GSC (30d): "tire shops near me" 3,387 imps at #7.8 = 54 clicks,
 * "tire shop near me" 1,140 imps at #15.1 = 41 clicks, "tire shop near
 * me open now" 109 imps at #11.4 = 0 clicks. Biggest discovery query
 * for us — a dedicated, optimized page should push rank from #7-15
 * toward top 3 = ~3-4× click volume on ~4,600 monthly impressions.
 */

import FocusedServicePage, { type ServicePageConfig } from "@/components/FocusedServicePage";

const CONFIG: ServicePageConfig = {
  canonicalPath: "/tire-shop-near-me",
  title: "Tire Shop Near Me — Open Now in Cleveland | New & Used | Nick's Tire & Auto",
  description: "Local tire shop in Cleveland/Euclid — open 7 days, walk-ins welcome. New & used tires from $60. Free install, balance, alignment check. 4.9★ · 1,700+ reviews. (216) 862-0005",
  eyebrow: "LOCAL TIRE SHOP",
  h1: "TIRE SHOP NEAR YOU — CLEVELAND / EUCLID",
  sub: "Searching for a tire shop near me? Nick's Tire & Auto at 17625 Euclid Ave, Cleveland is open 7 days a week with walk-ins welcome. New & used tires from $60 with free mounting, balancing, and alignment check. Most installs in 30-45 minutes.",
  startingPrice: "New tires from $60",
  pricingTitle: "TIRE PRICING",
  pricingSub: "Buy one or all four. Free installation package included — no hidden fees.",
  tiers: [
    { name: "Used Tires", price: "$40+", sub: "per tire, mounted & balanced", use: "Budget-friendly option — hand-inspected tread, no sidewall damage" },
    { name: "New Economy", price: "$85+", sub: "per tire, installed", use: "Solid daily-driver tires from trusted brands", featured: true },
    { name: "Premium / Performance", price: "$150+", sub: "Michelin, Bridgestone, Continental", use: "Long warranty, best wet/snow handling, premium feel" },
  ],
  includedTitle: "EVERY TIRE PURCHASE INCLUDES",
  includedSub: "No surprise fees. The sticker price covers the full install.",
  included: [
    "Mounting and balancing on new or used tires",
    "Valve stem replacement (standard rubber)",
    "Tire rotation reminder schedule",
    "Free flat repair for 12 months after purchase",
    "Free alignment check (not full alignment — we tell you if you need one)",
    "TPMS reset and reprogram",
    "Old tire disposal included",
    "Test drive to confirm balance and no vibration",
  ],
  faqs: [
    { q: "Are you open right now?", a: "Nick's Tire & Auto is open 7 days a week: Monday–Saturday 8 AM–6 PM, Sunday 9 AM–4 PM. Walk-ins welcome — no appointment needed for tires, oil changes, or tire repair. If it's after hours, leave a voicemail at (216) 862-0005 and we'll call back first thing." },
    { q: "How much is a new tire installed?", a: "Economy new tires start at $85 per tire installed (includes mounting, balancing, valve stem, TPMS reset, disposal). Premium tires (Michelin, Bridgestone) from $150+. Used tires from $40. Four-tire package deals save you $20-$40 vs individual pricing. Call (216) 862-0005 for exact quote on your tire size." },
    { q: "Do you sell used tires?", a: "Yes — we hand-inspect every used tire before mounting. Minimum 5/32\" tread depth, no sidewall damage, no dry rot. Used tires are a great budget option for older vehicles or beaters. We DON'T sell sketchy tires; if it wouldn't go on our own car, it doesn't go on yours." },
    { q: "How long does a tire install take?", a: "Most 4-tire installs done in 45-60 minutes. Single tire replacement 20-30 minutes. We don't take appointments for tires — walk in and we start as soon as a bay is free. Call ahead at (216) 862-0005 if you want us to have the exact size pulled." },
    { q: "Do you have my tire size in stock?", a: "We stock 12+ common sizes in both new and used (225/65R17, 245/60R18, 265/65R17, etc.). For special sizes, performance, or winter tires, we can usually have them same-day from local warehouses or next-day from national distributors. Call (216) 862-0005 with your size and we'll confirm." },
    { q: "Can you fix a flat tire instead of replacing it?", a: "If the puncture is in the tread area (not sidewall) and under 1/4\" wide, yes — we patch-plug from the inside. Flat repair is $25-$35 per tire. If the puncture is in the sidewall or the tire was driven flat, it needs replacement — we'll show you exactly why and give you options." },
    { q: "Do you do alignment and rotation?", a: "Yes. Alignment runs $89 front-end / $129 four-wheel on most vehicles. Rotation is $25 ($0 if you bought the tires here within 12 months). We check alignment free on every tire install — you'll know if you need one before you pay." },
    { q: "Do you finance tires?", a: "Yes — we offer $0 down financing through Snap Finance, Acima, and Koalafi. $89 a month gets most people into 4 new tires with install. Pre-approval takes 2 minutes, no hard credit pull. Ask at the counter or apply on our financing page." },
  ],
  bookingService: "tires",
  serviceType: "Tire Installation",
  ctaHeadline: "WALK IN OR BOOK ONLINE",
  ctaSub: "Open 7 days, walk-ins welcome. Call ahead at (216) 862-0005 and we'll have your size ready. 17625 Euclid Ave, Cleveland OH.",
};

export default function TireShopNearMePage() {
  return <FocusedServicePage config={CONFIG} />;
}
