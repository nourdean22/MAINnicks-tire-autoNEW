/**
 * SundayMufflerPage — niche capture for "muffler shop open on sunday"
 * cluster. GSC (16mo): "muffler shop open on sunday" 10 imps at 20% CTR
 * pos 3.7. Cleveland has near-zero supply for Sunday muffler service —
 * a dedicated page locks the SERP at low difficulty, captures
 * commercial intent (broken exhaust = drive-stopper).
 *
 * Also captures: "mechanics open on sunday" (1 click pos 6),
 * "muffler shops near me" (34 imps pos 10.9), and the long tail of
 * Sunday-emergency exhaust queries.
 */

import FocusedServicePage, { type ServicePageConfig } from "@/components/FocusedServicePage";
import { Volume2, Clock, AlertTriangle } from "lucide-react";

const CONFIG: ServicePageConfig = {
  canonicalPath: "/muffler-shop-open-sunday-cleveland",
  // Snow shot — visual proof "we work in any weather, even Sunday"
  heroImage: "/storefront-snow.webp",
  title: "Muffler Shop Open Sunday · Cleveland · Walk-In | Nick's Tire & Auto",
  description: "Cleveland muffler shop open on Sunday — 9 AM to 4 PM. Because exhaust never breaks Tuesday afternoon when shops are open. Muffler repair, full exhaust, catalytic converter, weld jobs, free written estimate. Walk-ins welcome. (216) 862-0005",
  eyebrow: "MUFFLER SHOP — SUNDAY HOURS · CLEVELAND",
  h1: "MUFFLER SHOP OPEN SUNDAY — CLEVELAND",
  sub: "Loud exhaust on a Sunday morning and every other shop is hibernating? Nick's Tire & Auto on Euclid Ave is open Sunday 9 AM to 4 PM. Walk in for muffler repair, full exhaust replacement, catalytic converter work, weld jobs, or just a free inspection if you're not sure what the noise is. Most exhaust repairs done same day, written estimate before any work, financing on the spot. Your car can stop announcing itself to the entire neighborhood by lunch.",
  startingPrice: "Free exhaust inspection",
  pricingTitle: "EXHAUST & MUFFLER WORK",
  pricingSub: "Walk in any Sunday — we put it on a lift, show you exactly what's leaking or rotted, and quote on the spot. No phantom upsells.",
  tiers: [
    { name: "Muffler Replacement", price: "Free quote", sub: "muffler + clamps + labor (most cars)", use: "Rusted-through muffler, big drone, the rumble that announces you to the block" },
    { name: "Full Exhaust Repair", price: "Free quote", sub: "pipe + muffler + clamps + welding", use: "Multiple leaks, rotted flex pipe, dragging exhaust — the multi-symptom Sunday emergency", featured: true },
    { name: "Catalytic Converter", price: "Free quote", sub: "OEM or aftermarket, written estimate before work", use: "P0420 / P0430 codes, sulfur smell, failed E-Check — the bad-news muffler problem" },
  ],
  includedTitle: "WHY SUNDAY MUFFLER WORK MATTERS",
  includedSub: "Most Cleveland shops close Sunday. We don't. Here's why drivers come to us.",
  included: [
    "Open Sunday 9 AM – 4 PM. No appointment needed.",
    "Free exhaust inspection on a lift — we show you the leak, not just describe it",
    "Written estimate before any wrench moves — no surprise bills",
    "Most muffler repairs done in 60–90 minutes",
    "Welding done in-house — no waiting for a third-party welder",
    "Catalytic converter work with written estimate, OEM-spec parts available",
    "$10 down financing — Acima · Snap · Koalafi · American First",
    "Free Uber home and back if you don't want to wait",
  ],
  faqs: [
    { q: "Are you really open on Sunday?", a: "Yes — every Sunday, 9 AM to 4 PM. Walk-ins welcome, no appointment needed. Most Sundays we have multiple bays free, so wait time is shorter than a weekday rush. Mon–Sat hours: 8 AM–6 PM. Address: 17625 Euclid Ave, Cleveland OH 44112. (216) 862-0005." },
    { q: "Can I get a muffler replaced today?", a: "Most muffler replacements take 60–90 minutes once we're under the car. If we have your part in stock or it's a common-fit muffler, you're driving home today. If we need to order an OEM-specific part, it's usually next-day from a local supplier. Walk in or call (216) 862-0005 with your year/make/model and we'll confirm timing on the spot." },
    { q: "How much does a muffler cost in Cleveland?", a: "Most muffler replacements run $189–$450 depending on vehicle, muffler grade (universal vs. OEM-fit), and whether the pipes/clamps need to be replaced too. Full exhaust system work (manifold to tailpipe) is $400–$1,200. Catalytic converter work is significantly more — $600–$2,500 — depending on whether OEM or aftermarket. We quote every job in writing before we start, so you'll know your number before any work begins." },
    { q: "What if I just need a weld, not a full replacement?", a: "Weld jobs are common — pinhole leaks, broken hangers, cracked flex pipes — and usually $80–$180 depending on access and weld time. We do welding in-house so there's no waiting on a third-party shop. Walk in and we'll inspect free; if it's weldable, we tell you. If it's rotted past welding, we tell you that too." },
    { q: "My car failed E-Check — can you fix that?", a: "Yes — most E-Check failures are catalytic converter, oxygen sensor, EVAP, or exhaust-leak related. We're state-certified for emissions repair. Free initial diagnostic to identify the failure cause, then a written estimate before any work. We back our emissions repair: pass guaranteed or we keep working." },
    { q: "Can I finance an exhaust repair?", a: "Yes — $10 down, no credit check, approved in 90 seconds. We work with Acima, Snap, Koalafi, and American First. Most exhaust jobs ($200–$800) fit comfortably in financing terms. Drive away today, pay over time." },
    { q: "Do you do work on diesel exhaust?", a: "We service light-duty gas and diesel exhaust — passenger cars, light trucks, vans. Heavy-duty commercial diesel (semi tractors, large box trucks) and DPF/DEF system work on heavy diesel is outside our scope; we'll refer you to a specialist if your vehicle falls in that category." },
  ],
  bookingService: "general-repair",
  serviceType: "Muffler & Exhaust Repair",
  ctaHeadline: "LOUD EXHAUST? PULL UP TODAY.",
  ctaSub: "Open Sunday 9 AM–4 PM. Walk in or call (216) 862-0005. Free inspection, written estimate before any work, $10-down financing available.",

  fearStats: {
    heading: "What waiting on an exhaust leak actually costs.",
    stats: [
      {
        value: "$400–$2,500",
        consequence: "Catalytic converter damage from running with an exhaust leak. The unburned air pulled into the system overheats the cat, melting the substrate. A $189 muffler patch ignored becomes $1,500+ in cat work.",
      },
      {
        value: "30",
        unit: "day E-Check deadline",
        consequence: "Failed Ohio E-Check has a 30-day repair window. Day 31 = parking tickets, expired registration, impound risk. Most failures are exhaust-related and fixable same day.",
      },
      {
        value: "1",
        unit: "missed Monday",
        consequence: "Most exhaust shops are closed Sunday. Drivers wait until Monday, then can't get to work. We're open Sunday 9–4 — handle it now, drive Monday morning normally.",
      },
    ],
  },
  crossSell: {
    heading: "What's actually wrong?",
    items: [
      {
        tone: "danger",
        icon: <Volume2 className="w-5 h-5" />,
        symptom: "Loud rumble, drone, or vibration",
        consequence: "Usually a rotted muffler or blown gasket. Free lift inspection identifies it in 5 minutes.",
        relief: "Walk in any Sunday 9–4. Most replacements done in 60–90 min.",
        ctaLabel: "BOOK MUFFLER REPAIR",
        ctaHref: "/exhaust",
      },
      {
        tone: "warning",
        icon: <AlertTriangle className="w-5 h-5" />,
        symptom: "Check engine light + sulfur smell",
        consequence: "P0420 / P0430 codes — catalytic converter failing. Drive on it and the damage compounds fast.",
        relief: "Free 5-min code scan + written estimate before any cat work.",
        ctaLabel: "DIAGNOSE NOW",
        ctaHref: "/diagnostics",
      },
      {
        tone: "info",
        icon: <Clock className="w-5 h-5" />,
        symptom: "Failed Ohio E-Check",
        consequence: "30-day deadline. Most failures are exhaust-related. We're state-certified.",
        relief: "Same-day fix on most failures — pass guaranteed or we keep working.",
        ctaLabel: "GET LEGAL",
        ctaHref: "/emissions",
      },
    ],
  },
};

export default function SundayMufflerPage() {
  return <FocusedServicePage config={CONFIG} />;
}
