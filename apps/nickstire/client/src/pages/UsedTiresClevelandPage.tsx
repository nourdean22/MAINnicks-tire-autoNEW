/**
 * UsedTiresClevelandPage — silo for "used tires" / "cheap tires" intent.
 *
 * Differentiates from /tires (broader new+used buyer journey) and from
 * /tire-shop-near-me (proximity intent). This page is for the
 * value-conscious driver searching "used tires cleveland", "used
 * tires near me", "cheap tires cleveland" — they want price first,
 * proof of inspection second, install third.
 *
 * Positioning: We don't sell junk. Every used tire walks through a
 * 4-point inspection — tread depth, sidewall, DOT date, plug history —
 * before it leaves on a customer's car. The price stays low; the
 * standard does not.
 */

import FocusedServicePage, { type ServicePageConfig } from "@/components/FocusedServicePage";
import { DollarSign, ShieldCheck, Gauge } from "lucide-react";

const CONFIG: ServicePageConfig = {
  canonicalPath: "/used-tires-cleveland",
  // 2026-05-06 wave-16 · pro photo pack: used tires page = primary
  // tire tread closeup per PLACEMENT_GUIDE.md "Used tires page" row
  heroImage: "/photos/rugged-tire-tread-closeup.webp",
  // 2026-05-06 copy wave: title now specifies the 4-point promise
  // upfront. H1 dropped the "no funny business" cliché for the
  // sharper "no time bombs" — operator 4 (anti-pattern of selling
  // tires nobody inspected the DOT date on).
  title: "Used Tires Cleveland · 4-Point Check · From $25 Installed | Nick's",
  description: "Cleveland used tires that don't insult your intelligence. Every tire passes a 4-point check — tread, sidewall, DOT date, plug history — before it earns a spot on your car. Walk-ins 7 days. 4.9★ 1,700+ reviews.",
  eyebrow: "USED TIRES — CLEVELAND'S BEST-KEPT SECRET",
  h1: "USED TIRES CLEVELAND.\n4-POINT CHECK. NO TIME BOMBS.",
  sub: "Need a tire today, not a payment plan? We carry checked used tires in most popular sizes — fully installed, free mount, free balance. Every tire passes a 4-point check before it earns a spot on your car: tread depth measured (not eyeballed), sidewall walked for cracks, DOT date verified (no time bombs), plug history reviewed. Call your size before you drive over — we'll tell you what's on the rack and what we'd put on our own family's car.",
  startingPrice: "From $25 installed (12-inch rims, subject to availability) · walk-in 7 days · most under 90 min",
  pricingTitle: "USED TIRE PRICING — TRANSPARENT BY DEFAULT",
  pricingSub: "Concrete starting prices below — your exact quote depends on size, but you know the floor before driving over. Mount, balance, valve stems, and disposal included on every install. No mystery 'shop supply' fees. We don't believe in those.",
  tiers: [
    { name: "Single Used Tire", price: "From $25", sub: "12-inch rims; most sizes $40-80 installed (mount, balance, disposal · all-in)", use: "You popped one and need to match the others — most common Cleveland-pothole moment" },
    { name: "Pair (matching)", price: "From $79", sub: "two used tires, axle-matched · all-in", use: "Drive-axle replacement — match the pair, not just the one. The other side is wearing too.", featured: true },
    { name: "Full Set (4)", price: "From $159", sub: "four used tires + free alignment check · all-in", use: "Old set is bald, budget is tight, you still want the car safe — the friend-and-family option" },
  ],
  includedTitle: "WHY OUR USED TIRES AREN'T A GAMBLE",
  includedSub: "What we check before any used tire goes on your car.",
  included: [
    "Tread depth measured with gauge — we show you the reading, not 'looks good'",
    "Sidewall walked for cracks, bulges, dry rot, and curb damage",
    "Bead seat inspected — leaks here are why some 'fine' used tires lose air weekly",
    "DOT date code verified — anything older than 6 years gets flagged or rejected",
    "Plug history check — patched/plugged tires get a label and customer disclosure",
    "Belt separation test — visual + flex check before mount",
    "Mount, balance, valve stem, and disposal of old tire — included, not extra",
    "Free alignment check on every install — Cleveland potholes kill new tires fast without it",
  ],
  faqs: [
    { q: "Are used tires actually safe?", a: "Used tires that pass our 4-point inspection are as safe as new tires for the remaining life of the rubber. The risk with used tires comes from shops that buy auction lots and slap them on cars without inspecting. We check every tire before it leaves on a customer's car. If it has a sidewall crack, internal belt separation, or is over 6 years old, it doesn't go up for sale — it goes in the disposal pile." },
    { q: "How long will a used tire last?", a: "Depends on tread depth at install. Tires are legally bald at 2/32\" tread; new tires start around 10-11/32\". A used tire with 6/32\" tread typically has 15,000-25,000 miles left depending on driving conditions, alignment, and rotation discipline. We tell you the exact tread reading at install so you can budget replacement timing." },
    { q: "Why so much cheaper than new tires?", a: "New tires cost $120-$300 each (plus $30-50 install per tire = $30-50 mount/balance/disposal). Used tires let drivers stay safe and legal when budget is the constraint. We price them to move — $40-80 typical for installed quality used tires in popular sizes." },
    { q: "Will my car pass inspection on used tires?", a: "Yes — Ohio has no minimum tread inspection unless required by E-Check (which is emissions, not tires). Federal law requires 2/32\" minimum tread depth across the tire. Our used tires start at 4/32\" or above unless explicitly disclosed and discounted to the customer." },
    { q: "Do you have my exact tire size in stock?", a: "Most popular passenger and light-truck sizes — yes, usually multiple options. Specialty (large SUV, performance, low-profile) — call first to confirm. (216) 862-0005. We'll tell you what's on the rack in your size before you drive over." },
    // 2026-08-11 · corrected to invoice canon (shared/business.ts usedTires.warranty):
    // used tires carry a 7-DAY limited replacement warranty, defect-only — the
    // previous "30 days" answer overclaimed against the invoice terms.
    { q: "What if the used tire fails after install?", a: "Every used tire carries a 7-day limited replacement warranty: verified air loss or internal tire failure from a defect present at the time of sale. If that happens within 7 days, we replace the tire free. Road-hazard damage — punctures, sidewall impacts, bead damage — isn't covered (it wouldn't be on a new tire either without a separate road-hazard plan). Terms are in writing on your invoice." },
    { q: "Can I bring my own used tires for install only?", a: "Yes — we'll mount and balance customer-supplied tires, but we inspect them first. If a tire fails our safety check, we won't install it (it's a liability for both of us). Mount + balance is $20-30 per tire depending on size." },
  ],
  bookingService: "tires",
  serviceType: "Used Tire Sales & Installation",
  ctaHeadline: "GRAB USED TIRES TODAY",
  ctaSub: "Call your size to confirm stock or walk in. Most installs done same-day. 17625 Euclid Ave, Cleveland OH.",

  anchorTable: {
    serviceName: "Used tire (single, installed) — Cleveland market",
    rows: [
      { label: "Big-box / chain (no inspection disclosure)", price: "$70-100" },
      { label: "Tire-only used lot (no install)", price: "$45-80 + $30 mount fee" },
      { label: "Nick's Tire & Auto — inspected + installed", price: "From $25 all-in", ours: true },
    ],
    source: "Cleveland-area pricing as observed 2024-2026. 'All-in' means mount, balance, disposal, and tax included.",
  },
  fearStats: {
    heading: "What \"unchecked used tires\" actually cost.",
    stats: [
      {
        value: "$200",
        consequence: "What you pay for an internal belt separation that wasn't caught at install — vibration that misaligns suspension, blown shock, alignment service, plus replacing the tire anyway.",
      },
      {
        value: "1",
        unit: "blowout = potential collision",
        consequence: "Sidewall failures from undisclosed plugs or dry rot are what kills people on the highway. Cleveland heat + cold cycles compound the risk on tires already past their date.",
      },
      {
        value: "6",
        unit: "year DOT cutoff",
        consequence: "Tires age out by date even if tread is fine. Rubber gets brittle, casing weakens. Anything older than 6 years gets pulled — we don't sell time bombs to save $20.",
      },
    ],
  },
  crossSell: {
    heading: "Or maybe you actually need a different option.",
    items: [
      {
        tone: "info",
        icon: <DollarSign className="w-5 h-5" />,
        symptom: "All four are bald — full set time",
        consequence: "Used set: $240+. New full set with free install package: $400-800 depending on brand/size. Sometimes new is the smarter spend.",
        relief: "Live quotes by tire size on the new-tire page.",
        ctaLabel: "NEW TIRE PRICING",
        ctaHref: "/new-tires-cleveland",
      },
      {
        tone: "warning",
        icon: <Gauge className="w-5 h-5" />,
        symptom: "Just need a flat fixed",
        consequence: "Plug + patch is $15-25, takes 15 minutes. Don't replace if you don't have to.",
        relief: "Free flat inspection — we'll tell you if it's repairable.",
        ctaLabel: "FLAT REPAIR",
        ctaHref: "/tires",
      },
      {
        tone: "info",
        icon: <ShieldCheck className="w-5 h-5" />,
        symptom: "Want full price-shop on size + brand",
        consequence: "Browse by size, see available stock, get installed pricing.",
        relief: "Tire finder with live quotes.",
        ctaLabel: "BROWSE BY SIZE",
        ctaHref: "/tires",
      },
    ],
  },
};

export default function UsedTiresClevelandPage() {
  return <FocusedServicePage config={CONFIG} />;
}
