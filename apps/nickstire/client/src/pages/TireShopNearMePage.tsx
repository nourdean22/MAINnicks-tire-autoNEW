/**
 * TireShopNearMePage — targets "tire shops near me" query cluster.
 * GSC (30d): "tire shops near me" 3,387 imps at #7.8 = 54 clicks,
 * "tire shop near me" 1,140 imps at #15.1 = 41 clicks, "tire shop near
 * me open now" 109 imps at #11.4 = 0 clicks. Biggest discovery query
 * for us — a dedicated, optimized page should push rank from #7-15
 * toward top 3 = ~3-4× click volume on ~4,600 monthly impressions.
 */

import { Disc, Wrench, Activity } from "lucide-react";
import FocusedServicePage, { type ServicePageConfig } from "@/components/FocusedServicePage";
import { useReviewStats } from "@/hooks/useReviewStats";

// A FUNCTION, not a module constant: the rating and review count are live
// (useReviewStats), and a module-scope object is built once at import time —
// before any hook can run — so it could only ever carry the static floor.
const buildConfig = (reviewRating: string, reviewCountDisplay: string): ServicePageConfig => ({
  canonicalPath: "/tire-shop-near-me",
  // wave-181.x · upgraded to wide-storefront shot · GSC query "tire shop
  // near me" (29,869 imp / pos 8.3 over 90d) wants visual confirmation
  // it's a real local tire shop · this photo shows Nick's full exterior
  // with General Tire + Continental banners + tire stacks on the sidewalk ·
  // unmistakably a real tire shop. Filename
  // "nicks-tire-auto-cleveland-euclid-ave-storefront" hits the GSC query.
  heroImage: "/photos/nicks-tire-auto-cleveland-euclid-ave-storefront.webp",
  // 2026-05-06 copy wave · This page targets "tire shops near me"
  // 3,387 imp/mo cluster. Title kept short + Sunday-differentiator.
  // Sub rewritten with operators 3 + 4 + 5.
  title: "Tire Shop Near Me Cleveland · Open 7 Days, Sunday Too | Nick's",
  description: `Cleveland tire shop on Euclid Ave. New + used tires, free mount/balance/valve stems/alignment check on every set. Open 7 days, even Sunday. ${reviewRating}★ ${reviewCountDisplay} reviews.`,
  eyebrow: "LOCAL TIRE SHOP",
  h1: "WALK IN. PICK A TIRE.\nLEAVE BEFORE YOUR PODCAST ENDS.",
  sub: "Cleveland's neighborhood tire shop, no Yelp filter required. Walk in, pick a tire, hand us the keys — most installs wrap before your podcast episode does. New tires, used tires, the weird sizes the chain told you to special-order in 5 days. Free mount, balance, valve stems, alignment check. Open every day we're awake. Yes, including Sunday.",
  startingPrice: "Free quote in shop or by phone",
  pricingTitle: "TIRE OPTIONS",
  pricingSub: "Walk in or call — we quote your exact size live with current inventory. Free installation package included with every tire (mount, balance, valve stem, disposal).",
  tiers: [
    { name: "Used Tires", price: "Free quote", sub: "hand-checked, mounted & balanced", use: "Budget-friendly option — every used tire passes our tread + sidewall + dry-rot check" },
    { name: "New Economy", price: "Free quote", sub: "name-brand tires, installed", use: "Solid daily-driver tires from name-brand manufacturers (Goodyear, Cooper, Hankook, etc)", featured: true },
    { name: "Premium / Performance", price: "Free quote", sub: "Michelin, Bridgestone, Continental", use: "Long warranty, best wet/snow handling, premium feel" },
  ],
  includedTitle: "EVERY TIRE PURCHASE INCLUDES",
  includedSub: "The sticker price covers the full install — we tell you the cost before we touch anything.",
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
    { q: "How much is a new tire installed?", a: "Pricing depends on your exact size and brand — economy daily-drivers, premium (Michelin, Bridgestone), and used inventory all sit at different price points. Every tire we install includes mounting, balancing, valve stem, TPMS reset, and disposal at no extra charge. Call (216) 862-0005 with your tire size and we'll quote it live, or walk in and we'll give you options on the spot. Four-tire package deals always save vs. individual pricing." },
    { q: "Do you sell used tires?", a: "Yes — we hand-inspect every used tire before mounting. Minimum 5/32\" tread depth, no sidewall damage, no dry rot. Used tires are a great budget option for older vehicles or beaters. We DON'T sell sketchy tires; if it wouldn't go on our own car, it doesn't go on yours." },
    { q: "How long does a tire install take?", a: "Most 4-tire installs done in 45-60 minutes. Single tire replacement 20-30 minutes. We don't take appointments for tires — walk in and we start as soon as a bay is free. Call ahead at (216) 862-0005 if you want us to have the exact size pulled." },
    { q: "Do you have my tire size in stock?", a: "We stock 12+ common sizes in both new and used (225/65R17, 245/60R18, 265/65R17, etc.). For special sizes, performance, or winter tires, we can usually have them same-day from local warehouses or next-day from national distributors. Call (216) 862-0005 with your size and we'll confirm." },
    { q: "Can you fix a flat tire instead of replacing it?", a: "If the puncture is in the tread area (not sidewall) and under 1/4\" wide, yes — we patch-plug from the inside. Flat repair is one of our cheapest line items; we'll quote it on inspection. If the puncture is in the sidewall or the tire was driven flat, it needs replacement — we'll show you exactly why and give you options." },
    { q: "Do you do alignment and rotation?", a: "Yes — both. Rotation is free if you bought the tires here within the last 12 months. Alignment (front-end or four-wheel) gets a written estimate based on your vehicle. We check alignment free on every tire install — you'll know if you need one before you pay." },
    { q: "Do you finance tires?", a: "Yes — we offer $10 down financing through Snap Finance, Acima, and Koalafi. Pre-approval takes 2 minutes, no hard credit pull. Most customers can roll a 4-tire install into a manageable monthly payment. Ask at the counter or apply on our financing page." },
  ],
  bookingService: "tires",
  serviceType: "Tire Installation",
  ctaHeadline: "WALK IN OR DROP IT OFF",
  ctaSub: "Open 7 days, walk-ins welcome. Call ahead at (216) 862-0005 and we'll have your size ready. 17625 Euclid Ave, Cleveland OH.",

  // ── Conversion scaffold (added 2026-05-30 CRO wave) ──
  // This is the highest-traffic discovery page (~4,600 imp/mo) but opted
  // into none of the conversion-architecture sections. price-psychology:
  // anchor the FREE install package against what chains nickel-and-dime.
  anchorTable: {
    serviceName: "What tire install actually costs — Cleveland",
    rows: [
      { label: "Chain store (mount + balance + valve + TPMS + disposal)", price: "Add-ons per tire" },
      { label: "Dealer tire center", price: "Add-ons per tire" },
      { label: "Nick's — all of it, every tire", price: "$0 with tire", ours: true },
    ],
    source: "The big chains quote you the tire, then add mount, balance, valve stems, TPMS reset, and disposal at the counter — it adds up fast. At Nick's the install package is included with every tire, new or used. Walk in or call (216) 862-0005 for a live quote on your size.",
  },
  // loss-aversion-designer (honest, NHTSA-sourced — no invented daily $).
  lossStats: [
    {
      amount: 2,
      unit: "/32\" tread",
      label: "is the legal-bald line — and stopping distance grows long before it",
      reason: "On a wet road, worn tread can't channel water away — so worn tires take well over a car length farther to stop than fresh tread, right when you need it most. Cleveland rain and winter slush make that gap a real-world risk, not a stat. A free tread check tells you exactly how many miles you have left before it's a problem.",
      ctaHref: "#booking",
      ctaLabel: "FREE TREAD CHECK",
    },
  ],
  // objection-preemptor: high-intent "tire shop near me" visitors who don't
  // convert on tires often have an adjacent problem — recover them.
  crossSell: {
    heading: "Came in for tires, but something else is off?",
    items: [
      {
        tone: "info",
        icon: <Disc className="w-5 h-5" />,
        symptom: "New tires wearing on one edge, or the car pulls?",
        consequence: "Bad alignment eats a fresh set of tires in months — we check it free on every install.",
        relief: "Free alignment check with your tires. Written estimate only if you actually need the full alignment.",
        ctaLabel: "ALIGNMENT CHECK",
        ctaHref: "/wheel-alignment-cleveland",
      },
      {
        tone: "warning",
        icon: <Wrench className="w-5 h-5" />,
        symptom: "Grinding or squealing when you stop?",
        consequence: "Wheels are already off for the tires — cheapest possible time to measure the pads.",
        relief: "Free brake check while the wheels are off. You see the pads before any quote.",
        ctaLabel: "BRAKE CHECK",
        ctaHref: "/brakes",
      },
      {
        tone: "info",
        icon: <Activity className="w-5 h-5" />,
        symptom: "Due for an oil change too?",
        consequence: "Knock both out in one visit instead of two trips across town.",
        relief: "Oil change while you wait — walk in 7 days, no appointment.",
        ctaLabel: "OIL CHANGE",
        ctaHref: "/oil-change",
      },
    ],
  },
});

export default function TireShopNearMePage() {
  const { ratingDisplay: reviewRating, countDisplay: reviewCountDisplay } = useReviewStats();
  return <FocusedServicePage config={buildConfig(reviewRating, reviewCountDisplay)} />;
}
