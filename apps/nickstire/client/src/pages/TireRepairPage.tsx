/**
 * TireRepairPage — targeted SEO landing for "tire repair Cleveland",
 * "flat tire repair near me", "tire patch near me" and the surrounding
 * tire-emergency intent cluster.
 *
 * wave-181.7 · per the Ahrefs/GSC audit (audit move #6, expected
 * +20-30 clicks/mo):
 *   - "tire repair" — 28.4 avg position · in striking distance
 *   - "tire repair near me" — 7.2 avg position · already page-1
 *   - "tire repair cleveland" — 20.7 avg position
 *   - "tire repair parma" — 43.6 avg position
 *   - "tire repair 44129" — 30.4 avg position
 *
 * No dedicated tire-repair landing exists today (repo has flat-tire
 * language embedded in /tires body, but no titled landing). This page
 * captures the cluster intent: "I have a nail, I need a plug NOW."
 *
 * Strategy:
 *   - Hero anchors on speed (15-min typical) + price ($25)
 *   - Pricing tiers tied to repair type (plug · patch · plug-patch combo)
 *   - Fear stats: why a slow leak gets expensive fast
 *   - FAQ schema · tire-repair specific questions
 *   - Cross-sell to /tires (if repair isn't possible) + /alignment
 *
 * Internal links: /tires, /tire-shop-near-me, every city page should
 * link here as the "if you've got a flat" funnel.
 */

import FocusedServicePage, { type ServicePageConfig } from "@/components/FocusedServicePage";
import { Car, Activity, AlertTriangle } from "lucide-react";

const CONFIG: ServicePageConfig = {
  canonicalPath: "/tire-repair-cleveland",
  heroImage: "/photos/busy-shop-action-mechanics.webp",
  title: "Tire Repair Cleveland · Free Check · Walk-In 7 Days | Nick's",
  description: "Cleveland tire repair on Euclid Ave. Nail in your tire? Slow leak? Free check, written quote, you don't pay until you say yes. Walk in 7 days. (216) 862-0005",
  eyebrow: "TIRE REPAIR CLEVELAND · WALK-IN 7 DAYS",
  h1: "TIRE REPAIR CLEVELAND.\nFREE CHECK · YOU DON'T PAY UNTIL YOU SAY YES.",
  sub: "Nail in your tire? Slow leak that ruined your morning? Drive-on flat? Nick's Tire & Auto on Euclid Ave — pull up, hand us the keys, we'll check the tire free first. We don't push you toward a new tire when a quick repair would have held. Serving Cleveland, Euclid, Parma, Cleveland Heights, Lakewood, Lyndhurst, and every neighborhood in between — walk in any day we're open including Sunday.",
  startingPrice: "Free check · written quote · walk-in 7 days",
  pricingTitle: "TIRE REPAIR PRICING — STRAIGHTFORWARD",
  pricingSub: "Every repair starts with a free check. If it's safe and effective to fix, we fix it. If the damage is in the sidewall or shoulder zone (unrepairable per industry standard), we'll show you why and offer a used tire from $25 installed.",
  tiers: [
    {
      name: "Plug Repair",
      price: "From $25",
      sub: "fast roadside-style fix",
      use: "Nail or screw in the tread center. Inserts a rubber plug from the outside without removing the tire. Fast for unobtrusive punctures.",
    },
    {
      name: "Plug + Patch Combo",
      price: "From $35",
      sub: "the industry-recommended fix",
      use: "Tire comes off the wheel, gets inspected from the inside, then plug-and-patch from both sides. The fix the tire manufacturers and DOT recommend.",
      featured: true,
    },
    {
      name: "Used Tire Replacement",
      price: "From $25 installed",
      sub: "when repair isn't safe",
      use: "Sidewall puncture or shoulder damage = unrepairable per industry standard. We'll show you why, then mount a used tire from our 800+ inventory same visit.",
    },
  ],
  includedTitle: "WHAT EVERY TIRE REPAIR AT NICK'S INCLUDES",
  includedSub: "No upsells, no \"oh by the way you need a TPMS sensor\" math after the fact — we tell you the cost before we touch anything.",
  included: [
    "Free check to determine if the tire is safely repairable",
    "Honest verdict — we say repair when repair holds, replacement when it won't",
    "TPMS reset after the repair (so the dashboard light goes off)",
    "Tire-pressure check on all 4 tires while the car is in the bay",
    "Visual check of the other 3 tires for hidden issues",
    "12-month parts / 90-day labor warranty — if the patch fails, we redo it free",
    "Walk-in welcome 7 days — no appointment system, first-come-first-served",
    "Same crew as Monday-Saturday on Sundays (9am-4pm)",
  ],
  faqs: [
    {
      q: "How much does a tire repair cost in Cleveland?",
      a: "Plug repair runs $25 typical, plug-and-patch combo $35, depending on tire size and damage location. Final pricing is set after the free check — we won't quote blind because the wrong fix on a sidewall puncture costs you the tire later. If the damage is unrepairable per industry standard, we'll show you why and offer a used tire from $25 installed.",
    },
    {
      q: "How long does tire repair take?",
      a: "About 15 minutes for a standard plug, 30 minutes for plug-and-patch. If you're walk-in on a busy Saturday afternoon there might be a queue ahead of you — we'll give you a realistic wait estimate when you arrive. Drop-off + Uber back home is free if you don't want to wait.",
    },
    {
      q: "Can my tire be repaired or do I need a new one?",
      a: "Industry-standard rule: punctures up to 1/4\" in the tire's tread center (between the shoulder grooves) are typically repairable. Damage in the sidewall or shoulder zone is NOT repairable per RMA (Rubber Manufacturers Association) guidelines — the repair won't hold under flexing and you risk a blowout. Our free check determines this in 60 seconds.",
    },
    {
      q: "Is a plug or a patch better?",
      a: "A plug-and-patch combo is the industry-recommended repair — the tire comes off the wheel, the inside gets inspected for damage you can't see from the outside, then we plug from the outside and patch from the inside. A plug-only repair is faster and cheaper, but the patch step is what makes the seal permanent. For Cleveland winter conditions, we recommend the combo on any repair that has to hold through salt + cold.",
    },
    {
      q: "Will my TPMS light come back on after the repair?",
      a: "No — we reset the TPMS as part of every repair. If the light returns within 24 hours, bring it back free; we'll re-check the seal and the TPMS sensor itself (sometimes a sensor needs a new battery, ~$30-50 typical).",
    },
    {
      q: "Can you repair run-flat tires?",
      a: "Most run-flat tires (BMW, Mini, some Mercedes) are repairable for puncture damage in the tread per the manufacturer's guidelines. The exception: if the tire has been driven flat for more than the rated distance (typically 50 miles at 50 mph), the internal sidewall structure is compromised and the tire must be replaced. We'll inspect first and tell you straight.",
    },
    {
      q: "What if you can't repair it — do you have used tires in my size?",
      a: "Yes — Nick's stocks 800+ used tires across every common size for the cars Cleveland actually drives (Toyota, Honda, Ford, Chevy, GM, plus most European). Used tires start at $25 installed, mounted, balanced, and warrantied for 30 days. If your size is in stock, we'll have you back on the road within the same visit.",
    },
    {
      q: "Do you charge to inspect a flat?",
      a: "No. The inspection is always free, on every tire, regardless of whether you decide to repair, replace, or take it home and think about it. We'd rather you trust us with the next repair than nickel-and-dime you on the inspection.",
    },
  ],
  bookingService: "tires",
  serviceType: "Tire Repair · Flat Repair · Puncture Repair",
  ctaHeadline: "WALK IN WITH A FLAT · LEAVE WITH A FIX",
  ctaSub: "17625 Euclid Ave, Cleveland OH · 9am-6pm Mon-Sat · 9am-4pm Sun · walk-in welcome · drop-off + Uber back home · (216) 862-0005",

  anchorTable: {
    serviceName: "Tire repair · Cleveland market rates",
    rows: [
      { label: "Cleveland-area dealer", price: "$50-75" },
      { label: "National chain (Discount Tire / Mavis tier)", price: "$25 free if you bought there" },
      { label: "Nick's Tire & Auto — plug repair", price: "$25", ours: true },
      { label: "Nick's Tire & Auto — plug + patch combo", price: "$35", ours: true },
    ],
    source: "Source: representative dealer + chain quotes for Cleveland metro, 2026. Chains often patch free on tires bought there; Nick's repairs any tire regardless of where you bought it.",
  },

  fearStats: {
    heading: "What a slow leak actually costs you.",
    stats: [
      {
        value: "47%",
        consequence: "Increase in tire wear when pressure is 25% low (a typical slow leak). The single under-inflated tire wears unevenly and develops cupping that ruins the tire long before its mileage is up.",
      },
      {
        value: "11%",
        consequence: "MPG loss with one tire at 22 PSI vs 32 PSI. On a 12,000-mile/yr commute that's $200+/year — far more than the $25 repair would have cost.",
      },
      {
        value: "$280",
        consequence: "Average tow + replacement cost when a slow leak becomes a roadside blowout. The 15-minute plug visit avoids the tow truck math entirely.",
      },
    ],
  },

  lossStats: [
    {
      amount: 12,
      unit: "per day",
      label: "in tire wear and gas burn",
      reason: "A slow leak burns roughly $4/day extra in gas + $8/day in accelerated tire wear (typical Cleveland commute). A week of \"I'll fix it next weekend\" costs nearly $100. The repair is $25.",
    },
    {
      amount: 280,
      unit: "tow + replacement",
      label: "when a slow leak becomes a blowout",
      reason: "Cleveland highway pothole + already-low tire = blowout. Tow truck + tire + sometimes a wheel = around $280 average. The 15-minute repair would have prevented it.",
      ctaHref: "tel:+12168620005",
      ctaLabel: "Walk-in today",
    },
  ],

  crossSell: {
    heading: "While we have the wheel off — what else might be hiding?",
    items: [
      {
        tone: "warning",
        symptom: "If this tire's at end-of-life, the others might be too.",
        consequence: "Tires bought together usually wear out together. A flat repair is the natural moment to check all 4 — we measure tread free while the car is on the lift.",
        relief: "Walk-in tire inspection — 4 tires checked, tread depth measured, sidewall checked. No upsell, just data.",
        ctaLabel: "Tire inventory",
        ctaHref: "/tires",
        icon: <Car className="w-5 h-5" />,
      },
      {
        tone: "info",
        symptom: "The car has been pulling left even before this flat.",
        consequence: "Slow leaks mask alignment issues — once the tire's fixed, the pulling pattern becomes obvious. Alignment is what stops uneven wear from killing the new tire too.",
        relief: "Free alignment check + written estimate after the tire repair. Most alignments take 45 minutes.",
        ctaLabel: "Wheel alignment near me",
        ctaHref: "/wheel-alignment-cleveland",
        icon: <Activity className="w-5 h-5" />,
      },
      {
        tone: "danger",
        symptom: "Brakes squeal? That's a Cleveland-winter classic combo with a flat.",
        consequence: "Salt + slush + slow leaks + cold metal = the four horsemen of Cleveland brake failure. Sundays are quiet — perfect day for a free brake inspection.",
        relief: "Free brake inspection — we lift the car and hand you the flashlight. No obligation.",
        ctaLabel: "Brake inspection — free",
        ctaHref: "/brakes",
        icon: <AlertTriangle className="w-5 h-5" />,
      },
    ],
  },
};

export default function TireRepairPage() {
  return <FocusedServicePage config={CONFIG} />;
}
