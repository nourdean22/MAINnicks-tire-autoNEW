import FocusedServicePage, { type ServicePageConfig } from "@/components/FocusedServicePage";

const CONFIG: ServicePageConfig = {
  canonicalPath: "/hybrid-ev-repair",
  title: "Hybrid & EV Repair Cleveland — Tires, Brakes & Battery | Nick's",
  description: "Cleveland hybrid and EV mechanical service. Tires, brakes, suspensions, alignments, and 12V battery replacements. Walk in 7 days.",
  eyebrow: "HYBRID & ELECTRIC VEHICLE CARE",
  h1: "HYBRID & EV MECHANICAL SERVICE\n& MAINTENANCE.",
  sub: "Ensure your hybrid or electric vehicle runs efficiently and safely. Nick's Tire & Auto on Euclid Ave offers specialized mechanical services for hybrids and EVs. Tires, brakes, steering, suspension, alignments, and auxiliary 12V batteries. Walk in 7 days.",
  startingPrice: "Specialized hybrid/EV care",
  pricingTitle: "EV & HYBRID MAINTENANCE TIERS",
  pricingSub: "Routine maintenance and checks for high-efficiency vehicles.",
  tiers: [
    {
      name: "12V Battery Check",
      price: "FREE",
      sub: "Load & health test",
      use: "Testing the 12V auxiliary battery that boots the EV/hybrid computer systems.",
    },
    {
      name: "EV Alignment Check",
      price: "FREE",
      sub: "Laser alignment pull-check",
      use: "Ensuring proper wheel angles to prevent rapid tire wear from heavy EV torque.",
      featured: true,
    },
    {
      name: "Mechanical Diagnostic",
      price: "From $89",
      sub: "Suspension, steering, brakes",
      use: "Complete inspection of the unique regeneration systems, shocks, and ball joints.",
    },
  ],
  includedTitle: "WHAT'S INCLUDED",
  includedSub: "Specialized handling for the heavier chassis and unique dynamics of EVs.",
  included: [
    "Brake pads and rotor checks tailored for regenerative braking",
    "EV-rated tire inspections (load index and noise reduction tech)",
    "Suspension bushing and shock checks (heavy EV battery pack weight wear)",
    "12V auxiliary battery testing and replacement",
    "Precision wheel alignments to maximize battery range",
    "Written quote before any work begins",
  ],
  faqs: [
    {
      q: "Do you service high-voltage hybrid or EV batteries?",
      a: "No, we do not service or repair high-voltage lithium-ion propulsion battery packs or high-voltage electric drivetrain wiring. We handle all mechanical, tire, suspension, alignment, braking, and standard 12-volt electrical service for hybrids and electric vehicles.",
    },
    {
      q: "Why do EVs wear out tires faster?",
      a: "Electric vehicles are significantly heavier due to battery packs and produce instant electric torque. This puts extreme stress on tires. We inspect and supply EV-specific tire lines designed with reinforced load ratings and noise-dampening foam to extend tread life.",
    },
    {
      q: "Do hybrids require special brake service?",
      a: "Hybrids use regenerative braking, which uses the electric motor to slow down and charge the battery. This means physical brake pads and rotors last much longer, but they are prone to rust and sticking due to underuse. We perform specialized slide-lubrication and rotor inspections to ensure they operate safely.",
    },
    {
      q: "Can you change the battery on my Prius or Tesla?",
      a: "Yes, we can test and replace the standard 12V lead-acid or AGM auxiliary battery. This battery powers the door locks, lights, dashboard, and boots the vehicle's computer systems. When it fails, the vehicle will not start, even if the high-voltage pack is fully charged.",
    },
  ],
  bookingService: "general-repair",
  serviceType: "Hybrid & EV Mechanical Service",
};

export default function HybridEvRepairPage() {
  return <FocusedServicePage config={CONFIG} />;
}
