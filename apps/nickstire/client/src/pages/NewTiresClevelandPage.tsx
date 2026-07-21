/**
 * NewTiresClevelandPage — silo for "new tires" / "tire installation" intent.
 *
 * Differentiates from /tires (broad finder + brand grid) and from
 * /tire-shop-near-me (proximity intent). This is for the buyer
 * actively shopping new tires — they want brands they recognize,
 * the install package they're getting for free, and an honest read
 * on what's overkill vs what fits their car/budget.
 *
 * Positioning: We sell new tires at fair prices and install them
 * with the package the chains charge $266 extra for — for free.
 * Mount, balance, valve stems, TPMS reset, alignment check, and
 * 20-point inspection on every install.
 */

import FocusedServicePage, { type ServicePageConfig } from "@/components/FocusedServicePage";
import { TIRES_PHOTOS } from "@/components/PhotoRibbon";
import { Award, ShieldCheck, Gauge } from "lucide-react";

const CONFIG: ServicePageConfig = {
  canonicalPath: "/new-tires-cleveland",
  // 2026-05-06 wave-16 · pro photo pack: rugged tire tread closeup per
  // PLACEMENT_GUIDE.md "Tires page" row — the strongest tire-authority shot
  heroImage: "/photos/rugged-tire-tread-closeup.webp",
  title: "New Tires Cleveland — Install Package Free, Not An Upsell | Nick's",
  description: "Cleveland new tires where mount/balance/valve stems/TPMS reset/alignment check come included, not added at the register. Major brands stocked. Walk-ins 7 days. 4.9★ 1,700+ reviews.",
  eyebrow: "NEW TIRES — CLEVELAND",
  h1: "NEW TIRES.\nFREE INSTALL · FREE COFFEE · FREE OPINIONS.",
  sub: "The chain advertises a tire price. They don't advertise the $266 they tack on at the register for mount, balance, valve stems, TPMS reset, alignment check, and disposal. At Nick's that's the welcome mat — it's already in the price. Major brands stocked, specialty sizes here in 24 hours, most sets installed before your coffee gets cold. Call your tire size for a live quote — friendlier than your phone bill, faster than your barista.",
  startingPrice: "From $89/tire installed · $0 install package · most sets under 90 min",
  pricingTitle: "NEW TIRE PACKAGES",
  pricingSub: "Concrete starting prices below — your exact quote depends on size and brand, but you know the floor before driving over. The install package ($266 elsewhere) is included on every set — mount, balance, valve stems, TPMS reset, alignment check.",
  tiers: [
    { name: "Budget All-Season", price: "From $89/tire", sub: "Cooper, General, Firestone Champion, Hankook Kinergy · install free", use: "Daily commuter — safe tires without the premium-brand markup" },
    { name: "Premium All-Season", price: "From $149/tire", sub: "Michelin Defender, Goodyear Assurance, Bridgestone Turanza · install free", use: "Longest tread life, quietest ride — the brand-name peace-of-mind tier", featured: true },
    { name: "Performance / Truck / SUV", price: "From $179/tire", sub: "Michelin LTX, Bridgestone Dueler, Goodyear Wrangler, Pirelli · install free", use: "Truck, SUV, performance car, or the third-row family-hauler that's seen things" },
  ],
  includedTitle: "WHAT'S IN THE FREE INSTALL PACKAGE",
  includedSub: "What chains charge $266 extra for. Included on every new-tire purchase.",
  included: [
    "Tire mount (each tire on the wheel) — $25/tire elsewhere",
    "Wheel balance (computerized) — $20/tire elsewhere",
    "New valve stems — $5/tire elsewhere",
    "TPMS sensor reset (where equipped) — $40 service charge elsewhere",
    "Alignment check — $35 elsewhere (full alignment service is separate if needed)",
    "20-point safety check — brakes, suspension, fluid levels, lights, wipers",
    "Disposal of old tires — $5/tire fee elsewhere",
    "Wheel cleaning before re-mount — they look how they should",
    "Torque to spec with calibrated torque wrench (not impact gun) — protects studs + rotors",
    "12-month parts / 90-day labor warranty",
  ],
  faqs: [
    { q: "What brands of new tires do you stock?", a: "We stock or special-order all major brands: Michelin, Goodyear, Bridgestone, Continental, Pirelli, Firestone, Cooper, General, Hankook, Yokohama, Kumho, Falken, Nexen. Most sizes available same-day from local distribution. Specialty sizes ship in 24 hours from regional warehouse. Call your size + preferred brand to confirm." },
    { q: "Is the 'free install package' really free?", a: "Yes — every line item listed above is included on every set of new tires you buy from us. There's no asterisk pricing where the tire is cheap and then the install adds $266 at the register. The price you see on the tire is what you pay (plus tax). We make our money on tire margin, not nickel-and-dime install fees." },
    { q: "Do I need a 4-wheel alignment with new tires?", a: "Not always — but you should always get the alignment CHECKED (which is included free). If your alignment is within spec, we say so and don't charge for the service. If it's out of spec — common after Cleveland pothole season — uneven tire wear will eat $200 off the lifespan of your new tires within 8,000 miles. Alignment is $79-99 if needed." },
    { q: "Should I get all-season or all-weather tires?", a: "All-season works for 90% of Cleveland drivers — daily commute, occasional snow, decent grip year-round. All-weather (snowflake-rated) is better if you drive heavily in snow or have to make it to work no matter what. Dedicated winter tires are better still in deep snow but require swapping twice a year. We'll match the tire to how you actually drive." },
    { q: "How long does new-tire install take?", a: "Most full-set installs are 60-90 minutes, including the alignment check and inspection. We'll tell you the realistic wait time when you call or arrive. Walk-in friendly, but appointments get faster turnaround on busy days." },
    { q: "What's the warranty on new tires?", a: "Manufacturer warranty (varies by brand — 40,000-80,000 miles for tread depth, plus defect coverage). Our install workmanship is backed by our 12-month parts / 90-day labor warranty — if something we did fails, we fix it free. Road-hazard coverage is separate and offered as an upsell on premium tires." },
    { q: "Can I finance new tires?", a: "Yes — we offer no-credit-check lease-to-own through Acima starting at $10 down. Approval in 60 seconds. Set of 4 quality tires can be on the road today, paid off over 90 days same-as-cash." },
  ],
  bookingService: "tires",
  serviceType: "New Tire Sales & Installation",
  ctaHeadline: "GET NEW TIRES — FREE INSTALL",
  ctaSub: "Call your tire size for a live quote, or walk in. We can usually have you driving on new tires within 90 minutes. 17625 Euclid Ave, Cleveland OH.",

  anchorTable: {
    serviceName: "New tire set (4) all-in — Cleveland market",
    rows: [
      { label: "Dealership tire shop (full retail + install)", price: "Tire MSRP + $266 install" },
      { label: "Big-box chain (mid-tier brand)", price: "Tire price + $80-180 install fees" },
      { label: "Nick's Tire & Auto — install package included", price: "Tire price + $0 install", ours: true },
    ],
    source: "Cleveland-area observed 2024-2026. The chain figure varies — some pad install, some bundle 'free' but charge for valve stems / TPMS / disposal as separate adds.",
  },
  fearStats: {
    heading: "What \"cheap install\" actually costs.",
    stats: [
      {
        value: "$200+",
        consequence: "Premature tire wear from skipped alignment check — Cleveland's pothole roads turn a 60K-mile tire into a 35K-mile tire if the alignment is off when new tires go on.",
      },
      {
        value: "$80",
        consequence: "TPMS sensor replacement when an old/cracked sensor gets damaged during install at a shop that doesn't reset properly. Free at Nick's, $40-80 elsewhere.",
      },
      {
        value: "1",
        unit: "wheel stud / rotor",
        consequence: "Over-torqued lug nuts from impact-gun install warp rotors and snap studs. We torque to spec on every wheel — basic mechanic discipline some shops skip to save 60 seconds per car.",
      },
    ],
  },
  photoRibbon: {
    photos: TIRES_PHOTOS,
    eyebrow: "Inventory · Mounted · Driven Off the Lot",
    headingLine1: "Stacked floor-to-ceiling.",
    headingLine2: "Mounted in 90 minutes.",
    subhead: "Real inventory. Real installs. Real customers driving out the same day they walked in.",
  },
  crossSell: {
    heading: "Or maybe a different fit makes more sense.",
    items: [
      {
        tone: "info",
        icon: <Award className="w-5 h-5" />,
        symptom: "Want a specific brand quote",
        consequence: "Live pricing by brand and size. Install package included on every set.",
        relief: "Browse all stocked brands.",
        ctaLabel: "BROWSE TIRES",
        ctaHref: "/tires",
      },
      {
        tone: "warning",
        icon: <Gauge className="w-5 h-5" />,
        symptom: "Budget-tight, can't do new today",
        consequence: "Inspected used tires from $25 installed.",
        relief: "Same install standards. Lower price.",
        ctaLabel: "USED TIRE OPTIONS",
        ctaHref: "/used-tires-cleveland",
      },
      {
        tone: "info",
        icon: <ShieldCheck className="w-5 h-5" />,
        symptom: "Need alignment with new tires",
        consequence: "Cleveland potholes will eat your new tires without it.",
        relief: "Wheel alignment same-day, walk-ins welcome.",
        ctaLabel: "ALIGNMENT INFO",
        ctaHref: "/alignment",
      },
    ],
  },
};

export default function NewTiresClevelandPage() {
  return <FocusedServicePage config={CONFIG} />;
}
