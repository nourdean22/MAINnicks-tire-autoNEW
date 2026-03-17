/**
 * City-specific landing page data for local SEO.
 * Each city page targets "[service] near [city]" search queries
 * to capture surrounding suburb traffic.
 */

export interface CityData {
  slug: string;
  name: string;
  metaTitle: string;
  metaDescription: string;
  heroHeadline: string;
  heroSubline: string;
  distance: string;
  driveTime: string;
  neighborhoods: string[];
  localContent: string;
  serviceHighlights: string[];
  testimonial: {
    text: string;
    author: string;
    location: string;
  };
}

export const CITIES: CityData[] = [
  {
    slug: "euclid-auto-repair",
    name: "Euclid",
    metaTitle: "Auto Repair in Euclid, OH | Nick's Tire & Auto | (216) 862-0005",
    metaDescription: "Trusted auto repair shop serving Euclid, Ohio. Brakes, tires, diagnostics, emissions, and oil changes. Located on Euclid Ave, minutes from downtown Euclid. Call (216) 862-0005.",
    heroHeadline: "EUCLID'S TRUSTED\nAUTO REPAIR SHOP",
    heroSubline: "Located right on Euclid Avenue, we have been serving Euclid drivers with honest diagnostics, fair pricing, and expert repairs. From brake jobs to E-Check failures, our technicians handle it all.",
    distance: "0.5 miles",
    driveTime: "2 minutes",
    neighborhoods: ["Downtown Euclid", "Indian Hills", "Euclid Green", "Bluestone", "Upson"],
    localContent: "Nick's Tire & Auto sits right on Euclid Avenue, making us the most convenient auto repair option for Euclid residents. Whether you are coming from Indian Hills, Euclid Green, or anywhere along Lakeshore Boulevard, we are just minutes away. Our shop handles everything from routine oil changes to complex engine diagnostics, and we have built a reputation in the Euclid community for transparent pricing and honest work.",
    serviceHighlights: [
      "Ohio E-Check and emissions repair for Euclid vehicles",
      "Brake inspection and repair with same-day service",
      "Full tire selection — mounting, balancing, and rotation",
      "Check engine light diagnostics using advanced OBD-II scanners",
      "Suspension and steering repair for Northeast Ohio roads",
      "Synthetic and conventional oil changes"
    ],
    testimonial: {
      text: "I live two blocks from Nick's and have been going there for three years. They always explain what is wrong before doing any work. Honest shop.",
      author: "Marcus T.",
      location: "Euclid, OH"
    }
  },
  {
    slug: "lakewood-auto-repair",
    name: "Lakewood",
    metaTitle: "Auto Repair Near Lakewood, OH | Nick's Tire & Auto | (216) 862-0005",
    metaDescription: "Reliable auto repair serving Lakewood, Ohio drivers. Brakes, tires, diagnostics, emissions testing, and general repair. Worth the short drive for honest service. Call (216) 862-0005.",
    heroHeadline: "AUTO REPAIR FOR\nLAKEWOOD DRIVERS",
    heroSubline: "Lakewood drivers trust Nick's Tire & Auto for honest diagnostics and expert repairs. Our experienced technicians handle brakes, tires, emissions, and engine diagnostics at fair prices.",
    distance: "12 miles",
    driveTime: "20 minutes",
    neighborhoods: ["Birdtown", "Gold Coast", "Rockport", "Downtown Lakewood", "Clifton Park"],
    localContent: "Many Lakewood residents make the short drive to Nick's Tire & Auto because they value honest, transparent auto repair. We understand that Lakewood drivers have plenty of local options, and we earn their trust by showing them the problem before we fix it, explaining every repair in plain language, and charging fair prices. Whether you are dealing with a check engine light, need new tires, or failed your E-Check, our team delivers the same quality service that has earned us over 1,600 five-star reviews.",
    serviceHighlights: [
      "Complete brake service — pads, rotors, calipers, and ABS diagnostics",
      "Tire sales and installation from all major brands",
      "Advanced engine diagnostics for check engine lights",
      "Ohio E-Check and emissions system repair",
      "Cooling system, belts, and hose replacement",
      "Steering and suspension repair"
    ],
    testimonial: {
      text: "I drive from Lakewood because I trust them. They diagnosed a problem two other shops missed. Fair price, great work.",
      author: "Jennifer S.",
      location: "Lakewood, OH"
    }
  },
  {
    slug: "parma-auto-repair",
    name: "Parma",
    metaTitle: "Auto Repair Near Parma, OH | Nick's Tire & Auto | (216) 862-0005",
    metaDescription: "Trusted auto repair serving Parma, Ohio. Expert brake, tire, diagnostic, and emissions repair. Over 1,600 five-star reviews. Call Nick's Tire & Auto at (216) 862-0005.",
    heroHeadline: "TRUSTED AUTO REPAIR\nFOR PARMA DRIVERS",
    heroSubline: "Parma drivers choose Nick's Tire & Auto for expert diagnostics, quality repairs, and fair pricing. Our technicians treat every vehicle like their own.",
    distance: "15 miles",
    driveTime: "25 minutes",
    neighborhoods: ["Parma Heights", "Parmatown", "Ridgewood", "Pleasant Valley", "Snow Road"],
    localContent: "Parma is one of the largest suburbs in the Cleveland metro area, and many Parma drivers have discovered that Nick's Tire & Auto is worth the drive. We specialize in the kind of thorough, honest auto repair that is hard to find. Our technicians use advanced OBD-II diagnostic equipment to pinpoint problems accurately, which means you only pay for what actually needs to be fixed. From routine maintenance like oil changes and tire rotations to complex repairs like catalytic converter replacement and suspension work, we handle it all.",
    serviceHighlights: [
      "Full diagnostic service for check engine and warning lights",
      "Brake repair and replacement with quality parts",
      "New and used tire sales with professional installation",
      "Emissions and E-Check failure diagnosis and repair",
      "Exhaust system repair and replacement",
      "General mechanical repair and maintenance"
    ],
    testimonial: {
      text: "My mechanic in Parma retired and a friend recommended Nick's. Best decision I made. They are thorough and honest.",
      author: "Robert K.",
      location: "Parma, OH"
    }
  },
  {
    slug: "east-cleveland-auto-repair",
    name: "East Cleveland",
    metaTitle: "Auto Repair Near East Cleveland, OH | Nick's Tire & Auto | (216) 862-0005",
    metaDescription: "Auto repair serving East Cleveland, Ohio. Brakes, tires, engine diagnostics, emissions repair, and more. Conveniently located on Euclid Ave. Call (216) 862-0005.",
    heroHeadline: "AUTO REPAIR NEAR\nEAST CLEVELAND",
    heroSubline: "Just minutes from East Cleveland on Euclid Avenue, Nick's Tire & Auto provides expert auto repair with honest diagnostics and fair pricing. No surprises, no upselling.",
    distance: "3 miles",
    driveTime: "8 minutes",
    neighborhoods: ["Forest Hills", "Caledonia", "Superior", "Hayden", "Euclid-Green"],
    localContent: "East Cleveland drivers benefit from our convenient location on Euclid Avenue, just a short drive from the East Cleveland border. We serve the East Cleveland community with the same honest, expert auto repair that has made us one of the highest-rated shops in the Cleveland area. Our technicians understand the challenges of Northeast Ohio driving — from pothole damage to salt corrosion — and we repair vehicles to handle these conditions reliably.",
    serviceHighlights: [
      "Pothole damage repair — suspension, alignment, and tire replacement",
      "Brake inspection and repair with honest assessments",
      "Engine diagnostic service for all warning lights",
      "Ohio E-Check preparation and emissions repair",
      "Oil change service — conventional and synthetic",
      "Cooling system repair for all makes and models"
    ],
    testimonial: {
      text: "I have been coming here from East Cleveland for over a year. They always show me what is wrong and give me options. No pressure.",
      author: "Tanya M.",
      location: "East Cleveland, OH"
    }
  }
];

export function getCityBySlug(slug: string): CityData | undefined {
  return CITIES.find(c => c.slug === slug);
}
