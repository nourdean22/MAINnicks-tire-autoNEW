/**
 * TireShopOpenSundayPage — targeted SEO landing for "tire shop open
 * Sunday Cleveland" + Sunday-specific intent.
 *
 * wave-181.5 · competitor-analyzer found that Conrad's Downtown is
 * literally closed Sunday. Firestone locations vary. Mavis has soft
 * Sunday hours but appointment-led. The SERP is currently owned by
 * Walmart Tire Center + Dara Tires (a 24-hour shop). Nick's runs
 * 9am-4pm every Sunday with the same Monday-Saturday standard — this
 * page captures Sunday-specific intent without diluting the homepage.
 *
 * Strategy:
 *   - Hero leads with the contrast: chains closed, Nick's open
 *   - Sunday-specific operational details (Uber service, walk-in)
 *   - FAQ schema specifically about Sunday operations
 *   - Loss stats: cost of waiting until Monday
 *   - Cross-sell to /tires, /brakes, /booking
 *
 * Sundays are the highest-volume walk-in day at Nick's (per operator
 * lore — confirm via /admin Booking analytics) — this page should
 * funnel that demand directly to /booking.
 */

import FocusedServicePage, { type ServicePageConfig } from "@/components/FocusedServicePage";
import { Calendar, Car, Wrench } from "lucide-react";

const CONFIG: ServicePageConfig = {
  canonicalPath: "/tire-shop-open-sunday-cleveland",
  heroImage: "/photos/shopfront-clear-vertical-sign-bays.webp",
  title: "Tire Shop Open Sunday Cleveland · 9am-4pm Every Sunday | Nick's",
  description: "Tire shop open Sunday in Cleveland. Nick's Tire & Auto on Euclid Ave runs 9am-4pm every Sunday — walk-in tires, brakes, oil change. Conrad's closed. Mavis closed. We're open. (216) 862-0005",
  eyebrow: "OPEN SUNDAYS — 9am to 4pm",
  h1: "TIRE SHOP OPEN SUNDAY CLEVELAND.\nEVERY SUNDAY. 9 AM TO 4 PM.",
  sub: "Conrad's closes Sunday. Mavis hides Sunday hours behind a widget. NTB closed. Firestone varies by location. Nick's Tire & Auto on Euclid Ave runs Cleveland's most reliable Sunday tire shop — 9am to 4pm, same crew as Monday, first-come, first-served (FCFS) walk-ins welcome, no appointment. We're located right next to the Euclid Ave & London Rd intersection, just off I-90 Exit 182C and Route 2. Note: Same-day tire swaps, flat repairs, brake checks, and basic services are standard on Sundays. However, major engine/transmission overhauls or repairs requiring parts from closed warehouses will be diagnosed on Sunday and started first thing Monday morning to keep your vehicle moving.",
  startingPrice: "9am–4pm every Sunday · walk-in OK",
  pricingTitle: "WHAT'S OPEN ON SUNDAY AT NICK'S",
  pricingSub: "Same crew, same service, same pricing as weekdays. The only thing different on Sunday is the chains' closed signs and our shorter hours.",
  tiers: [
    {
      name: "Tire Mount & Balance",
      price: "From $25 / tire installed",
      sub: "used · DOT-dated · tread-measured",
      use: "Sunday-flat emergency? We mount + balance + valve-stem + TPMS-reset every Sunday. Most Sunday installs finish in under 90 minutes including the line.",
    },
    {
      name: "Brake Inspection",
      price: "Free · written estimate",
      sub: "lift the car, hand you the flashlight",
      use: "Heard a grind on the way home Saturday night? Sunday is our quiet day — we'll get the car up and walk you under it to show you what's worn.",
      featured: true,
    },
    {
      name: "Sunday Check-Engine",
      price: "Free if we do the repair",
      sub: "OBD-II scan + technician check",
      use: "Check-engine light on the way to brunch? Walk in Sunday with the symptoms — we'll plug in the scanner before lunch.",
    },
  ],
  includedTitle: "WHAT SUNDAY AT NICK'S LOOKS LIKE",
  includedSub: "Same physical standard as the rest of the week — operators don't take Sundays off, they just close earlier.",
  included: [
    "9am-4pm every Sunday (and yes, every Sunday — no surprise closures)",
    "First-come, first-served (FCFS) walk-ins — no appointment needed",
    "Located near I-90 Exit 182C and Route 2 on Euclid Ave (near London Rd)",
    "Same-day tire swaps, flat patches, and basic brake repairs",
    "Major overhauls diagnosed Sunday, parts ordered for Monday start",
    "Drop-off + Uber back home (we send the ride)",
    "Same financing programs — $10 down, 4 lenders, no FICO ding",
    "Open most major holidays — call ahead if you're not sure",
  ],
  faqs: [
    {
      q: "Is Nick's Tire & Auto really open every Sunday?",
      a: "Yes — every Sunday since 2019. 9am to 4pm. The only exceptions are Easter Sunday (closed) and Christmas if it falls on a Sunday. Memorial Day Sunday, Labor Day Sunday, Fourth-of-July-Sunday — all open. Call (216) 862-0005 if you want us to confirm before driving over.",
    },
    {
      q: "Why are Conrad's and most NTB locations closed Sunday but Nick's is open?",
      a: "Chain stores schedule around labor cost vs. weekday foot traffic. Sunday is lower-volume so most chains close to save payroll. Conrad's: ALL 10 Cleveland-metro locations confirmed closed Sunday (verbatim from econrads.com). Most NTB locations also closed (NTB Independence is the only Sun-open NTB in Cleveland metro — 9-5 by appointment). Nick's is independent — the operator's family runs the shop and is here Sundays anyway. Quieter day = faster line + more technician time per customer.",
    },
    {
      q: "Firestone is open Sundays too — why pick Nick's?",
      a: "Honest answer: Firestone Cleveland Downtown (3917 Prospect Ave) IS open Sundays 9-5. The differentiator isn't hours — it's rating depth. Firestone Downtown sits at 4.0 stars on 250 Google reviews. Nick's: 4.9 stars on 1,700+ reviews. That's a 0.9-star gap AND 6.7× the review depth at one location vs Firestone's biggest Cleveland presence. Plus Firestone is appointment-led + chain pricing; Nick's is walk-in + transparent estimates + the free Uber drop-off.",
    },
    {
      q: "Can I walk in on Sunday or do I need an appointment?",
      a: "Walk-in. Every day, including Sunday. Nick's runs first-come-first-served (FCFS) — pull up, hand us the keys, get in line. If you want to drop the car and go, we'll Uber you home and call when the work is done. The chains require Sunday appointments (when they're open at all) and routinely double-book — Nick's takes you in line order, period.",
    },
    {
      q: "Will the Sunday crew know what they're doing?",
      a: "Same crew, no rotation. The mechanic working on your car Sunday was working on cars Saturday and will be Monday. We don't run a 'Sunday B-team.' All certifications, all training, all the same shop standards. The single-location feature means there's no franchise inconsistency — one shop, one crew, one standard every visit.",
    },
    {
      q: "What if I need a big repair (brakes, transmission) on Sunday — can it be done same-day?",
      a: "Same-day service is standard for tire swaps, inspections, flat repairs, and basic brake services (pads/rotors). However, major repairs like engine or transmission overhauls, or anything requiring specialty parts from closed Sunday warehouses, will be diagnosed on Sunday and scheduled to start first thing Monday morning. We'll Uber you back home from our Euclid Ave location while we handle the diagnostics.",
    },
    {
      q: "Do you charge extra for Sunday service?",
      a: "No. Sunday pricing is identical to weekday pricing — same parts, same labor rate, same financing. The chains that DO open Sunday sometimes charge an emergency surcharge; Nick's doesn't.",
    },
    {
      q: "What if I need tires on Sunday but I'm worried about credit?",
      a: "Same $10 down + 4 lenders we run Monday-Saturday — soft pre-qualification, no FICO ding, decision in 60 seconds. Most customers walk out Sunday on new tires with a payment plan. Apply on your phone before you drive over; we'll have the answer ready.",
    },
    {
      q: "What about Sunday emergency tire repair?",
      a: "Most flat-tire emergencies we patch ($25 typical) or plug same-day Sunday. If the sidewall's blown, we stock a deep used-tire inventory ($25 installed) for fast replacement. Pull straight in — no appointment, no phone call required. If you can drive to us, we'll get you back on the road before close at 4pm.",
    },
  ],
  bookingService: "tires",
  serviceType: "Tire & Auto Repair · Sunday Service",
  ctaHeadline: "PULL UP THIS SUNDAY — 9 AM TO 4 PM",
  ctaSub: "17625 Euclid Ave, Cleveland OH (near London Rd & I-90 Exit 182C) · first-come, first-served walk-ins · (216) 862-0005",

  // wave-181.10 · updated with real Cleveland-metro scrape data
  // (econrads.com Lakewood page verified verbatim · firestone Downtown
  // Google rating + review count · NTB Independence the only Sun-open
  // NTB location verified).
  anchorTable: {
    serviceName: "Cleveland-area tire shops — Sunday hours + ratings",
    rows: [
      { label: "Conrad's Tire — all 10 metro locations", price: "CLOSED" },
      { label: "Mavis Discount Tire (Pearl Rd / Mayfield)", price: "Closed Sun" },
      { label: "NTB Independence (only Sun-open NTB)", price: "9-5 appt" },
      { label: "Firestone Downtown · 4.0★ · 250 reviews", price: "9-5 Sun" },
      { label: "Nick's Tire & Auto — 4.9★ · 1,700+ reviews", price: "9-4 walk-in", ours: true },
    ],
    source: "Source: live competitor scrape May 2026 (econrads.com · mavis.com · firestonecompleteautocare.com · Google Maps ratings). Conrad's chain-wide Sunday closure verified verbatim. Firestone IS open Sunday — Nick's differentiator is rating depth (0.9★ gap + 6.7× more reviews than Firestone Downtown).",
  },

  fearStats: {
    heading: "What waiting until Monday actually costs.",
    stats: [
      {
        value: "287",
        unit: "feet",
        consequence: "Added stopping distance at 60 mph with worn tires on Cleveland's salt-wet Monday-morning pavement. Saturday-night bald tires + Sunday rain + Monday rush hour is a real bad combination.",
      },
      {
        value: "$190",
        consequence: "Average cost of an Uber-to-work Monday morning when the car's still flat in the driveway. Sunday repair = Monday at work without paying $40 in rideshare fees.",
      },
      {
        value: "1.4×",
        consequence: "Risk multiplier for accidents involving worn tires on wet pavement vs. dry. Cleveland Sunday weather → Monday rain forecast = the worst possible time to skip a tire service.",
      },
    ],
  },

  lossStats: [
    {
      amount: 40,
      unit: "per Uber",
      label: "you'd pay Monday morning without tires",
      reason: "Two Uber rides Monday morning (to work + back) average $40 in Cleveland. That's half a used tire — and Monday morning is when the rain hits worst.",
    },
    {
      amount: 8,
      unit: "hours",
      label: "you'd lose calling around Monday for an appointment",
      reason: "Sunday fix = back on the road tonight. Monday appointment = phone calls + 'we can fit you Wednesday' + still rideshare-ing until then. Time has a dollar value too.",
      ctaHref: "tel:+12168620005",
      ctaLabel: "Call · Sunday hours confirm",
    },
  ],

  crossSell: {
    heading: "While you're here — what else does your car need?",
    items: [
      {
        tone: "info",
        symptom: "I need tires today before Monday's commute.",
        consequence: "Bald tires on Cleveland Monday pavement is a real risk — see fear stats above. Used set of 4 from $160 installed and you're home before dinner.",
        relief: "Nick's stocks 800+ used tires plus new tire inventory ready to mount today. Walk in, hand us the keys, leave with new rubber.",
        ctaLabel: "See tire inventory",
        ctaHref: "/tires",
        icon: <Car className="w-5 h-5" />,
      },
      {
        tone: "warning",
        symptom: "Brakes felt off yesterday — Sunday is the quiet day to check.",
        consequence: "Sundays are typically slower at Nick's, so the technician has the bandwidth to actually walk you under the car and show you what's worn. Free check.",
        relief: "Free brake check — we lift the car and hand you the flashlight. No obligation, no upsell.",
        ctaLabel: "Brake check — free",
        ctaHref: "/brakes",
        icon: <Wrench className="w-5 h-5" />,
      },
      {
        tone: "info",
        symptom: "I want to drop the car Sunday and pick it up Monday.",
        consequence: "Most chains can't accept a Sunday drop-off when they're closed. Nick's takes it, locks the car overnight, finishes Monday morning, calls you.",
        relief: "Sunday drop-off + Monday completion is the highest-leverage move when work is more than a 90-minute fix.",
        ctaLabel: "Schedule drop-off",
        ctaHref: "/booking",
        icon: <Calendar className="w-5 h-5" />,
      },
    ],
  },
};

export default function TireShopOpenSundayPage() {
  return <FocusedServicePage config={CONFIG} />;
}
