/**
 * BrakeRepairPage — targeted SEO landing for "brake repair Cleveland" +
 * related queries. GSC (30d): /brakes 1,307 impressions at #37.7, 0 clicks.
 * Plus "brake repair cleveland oh" (69 imps #24.8), "brakes grinding",
 * etc. — this replaces the generic ServicePage route for /brakes with
 * a tighter, price-anchored, FAQ-schema conversion page.
 */

import FocusedServicePage, { type ServicePageConfig } from "@/components/FocusedServicePage";

const CONFIG: ServicePageConfig = {
  canonicalPath: "/brakes",
  title: "Brake Repair Cleveland | Pads from $149 | Same Day | Nick's Tire & Auto",
  description: "Brake repair in Cleveland/Euclid from $149 per axle. Free inspection, quality pads, rotors if needed. Most done same day. Walk-ins 7 days. (216) 862-0005",
  eyebrow: "BRAKE SERVICE",
  h1: "BRAKE REPAIR CLEVELAND",
  sub: "Squealing, grinding, or soft pedal? Brake repair from $149 per axle at Nick's Tire & Auto in Euclid. Free inspection on every visit. Quality pads, honest diagnosis — we don't replace what doesn't need replacing. Walk-ins 7 days a week.",
  startingPrice: "From $149 per axle",
  pricingTitle: "BRAKE SERVICE PRICING",
  pricingSub: "Up-front pricing. We show you the worn pad before we touch anything.",
  tiers: [
    { name: "Pad Replacement", price: "$149", sub: "per axle, most vehicles", use: "Pads worn but rotors still within spec" },
    { name: "Pads + Rotors", price: "$329", sub: "per axle, most vehicles", use: "Rotors scored or below minimum thickness", featured: true },
    { name: "Full Brake Job", price: "$449+", sub: "per axle, includes calipers if needed", use: "Calipers seized, lines leaking, or full system refresh" },
  ],
  includedTitle: "WHAT'S INCLUDED",
  includedSub: "Every brake service at Nick's comes with this — no surprise add-ons.",
  included: [
    "Free visual inspection (no obligation)",
    "Measurement of pad thickness and rotor wear",
    "Quality brake pads (ceramic or semi-metallic per vehicle spec)",
    "New rotors if measured below minimum thickness",
    "Caliper slide lubrication",
    "Brake fluid top-off",
    "Full brake system test drive",
    "12-month / 12,000-mile warranty on parts and labor",
  ],
  faqs: [
    { q: "How do I know if my brakes need replacing?", a: "Classic signs: squealing or squeaking when you brake (wear indicators), grinding (metal-on-metal, pads fully worn), soft or spongy pedal (air in lines or low fluid), pulsation through the pedal (warped rotors), or the dashboard brake light stays on. If you notice any of these, call us — driving on metal grinds into the rotor and costs way more to fix." },
    { q: "How much does a brake job cost in Cleveland?", a: "Pad replacement averages $149-$199 per axle for most vehicles. Pads + rotors together runs $329-$429 per axle. European vehicles (BMW, Audi, Mercedes) and performance brakes cost more. We give you the exact number after the free inspection — no upsell games." },
    { q: "How long does brake repair take?", a: "Most pad replacements take 60-90 minutes per axle. Pads + rotors usually 90 minutes. If you drop off before 10 AM, it's done same day. Walk-ins welcome but calling ahead at (216) 862-0005 lets us have the right parts ready." },
    { q: "Do you replace brakes on European cars?", a: "Yes — we service BMW, Mercedes, Audi, Volkswagen, Volvo, Porsche, and most European brands. These typically use specific pads and sensors; we stock or source OEM-quality parts and reset the wear indicator on your dashboard after service." },
    { q: "My brake warning light is on — can I drive?", a: "If it's the ABS light only, you can drive cautiously to the shop. If it's the brake warning light (red), that means low brake fluid or a hydraulic problem — pull over and call us. Driving on a failing brake system is how accidents happen." },
    { q: "Why do new brakes squeak?", a: "New brakes can squeak during the bed-in period (first 200 miles) while the pad material transfers to the rotor. Most squeaks go away on their own. If it's persistent or shrill after 200 miles, bring it back — we check glazing, hardware alignment, and reseat if needed (covered by our warranty)." },
    { q: "Do you offer a warranty on brake work?", a: "Every brake job includes our 12-month / 12,000-mile warranty covering parts and labor. If a pad is defective or fails early, we replace it free. Real warranty — not the 'comes with a sticker but good luck claiming it' kind." },
  ],
  bookingService: "brakes",
  serviceType: "Brake Repair",
  ctaHeadline: "BOOK YOUR BRAKE SERVICE",
  ctaSub: "Free inspection, up-front pricing, same-day service. Call or walk in — 17625 Euclid Ave, Cleveland OH.",
};

export default function BrakeRepairPage() {
  return <FocusedServicePage config={CONFIG} />;
}
