/**
 * Service+City SEO Combinator — Generates 260+ unique page routes
 * Each combination targets "[service] [city] OH" search queries.
 * Example: /oil-change-euclid-oh, /brakes-parma-oh, /tires-lakewood-oh
 */

export interface ServiceCityPage {
  slug: string;
  serviceSlug: string;
  serviceName: string;
  citySlug: string;
  cityName: string;
  title: string;
  metaDescription: string;
  h1: string;
  intro: string;
}

const SERVICES = [
  { slug: "tires", name: "Tires", price: "from $60" },
  { slug: "brakes", name: "Brake Repair", price: "from $89" },
  { slug: "oil-change", name: "Oil Change", price: "from $39" },
  { slug: "diagnostics", name: "Engine Diagnostics", price: "from $49" },
  { slug: "emissions", name: "E-Check & Emissions", price: "from $29" },
  { slug: "alignment", name: "Wheel Alignment", price: "from $79" },
  { slug: "ac-repair", name: "AC Repair", price: "from $49" },
  { slug: "suspension", name: "Suspension Repair", price: "from $100" },
  { slug: "transmission", name: "Transmission Service", price: "from $149" },
  { slug: "electrical", name: "Electrical Repair", price: "from $49" },
  { slug: "exhaust", name: "Exhaust Repair", price: "from $79" },
  { slug: "general-repair", name: "General Auto Repair", price: "free estimate" },
  { slug: "battery", name: "Battery Service", price: "free test" },
];

const CITIES = [
  { slug: "cleveland", name: "Cleveland", driveMin: 15 },
  { slug: "euclid", name: "Euclid", driveMin: 3 },
  { slug: "east-cleveland", name: "East Cleveland", driveMin: 10 },
  { slug: "south-euclid", name: "South Euclid", driveMin: 12 },
  { slug: "cleveland-heights", name: "Cleveland Heights", driveMin: 15 },
  { slug: "lakewood", name: "Lakewood", driveMin: 20 },
  { slug: "parma", name: "Parma", driveMin: 22 },
  { slug: "parma-heights", name: "Parma Heights", driveMin: 25 },
  { slug: "shaker-heights", name: "Shaker Heights", driveMin: 15 },
  { slug: "garfield-heights", name: "Garfield Heights", driveMin: 22 },
  { slug: "maple-heights", name: "Maple Heights", driveMin: 18 },
  { slug: "bedford", name: "Bedford", driveMin: 20 },
  { slug: "wickliffe", name: "Wickliffe", driveMin: 10 },
  { slug: "willoughby", name: "Willoughby", driveMin: 15 },
  { slug: "mentor", name: "Mentor", driveMin: 20 },
  { slug: "richmond-heights", name: "Richmond Heights", driveMin: 10 },
  { slug: "lyndhurst", name: "Lyndhurst", driveMin: 12 },
  { slug: "warrensville-heights", name: "Warrensville Heights", driveMin: 15 },
  { slug: "strongsville", name: "Strongsville", driveMin: 30 },
  { slug: "collinwood", name: "Collinwood", driveMin: 10 },
];

function generateIntro(service: string, city: string, driveMin: number, price: string): string {
  const intros = [
    `Looking for ${service.toLowerCase()} near ${city}? Nick's Tire & Auto is just ${driveMin} minutes away at 17625 Euclid Ave. With 4.9 stars and 1,700+ Google reviews, we're the most trusted independent shop serving ${city} drivers. ${service} ${price} — walk-ins welcome 7 days a week.`,
    `${city} drivers choose Nick's Tire & Auto for reliable ${service.toLowerCase()} at fair prices. We're ${driveMin} minutes from ${city} on Euclid Ave, and our 4.9-star reputation means you're in good hands. ${service} ${price}. No appointment needed — call (216) 862-0005.`,
    `Need ${service.toLowerCase()} in ${city}? Don't overpay at the dealer. Nick's Tire & Auto offers expert ${service.toLowerCase()} ${price}, backed by a labor warranty. We're only ${driveMin} minutes from ${city}. 1,700+ five-star reviews can't be wrong.`,
  ];
  // Deterministic selection based on combined slug
  const index = (service.length + city.length) % intros.length;
  return intros[index];
}

/** Generate all service+city page combinations */
export function generateServiceCityPages(): ServiceCityPage[] {
  const pages: ServiceCityPage[] = [];

  for (const service of SERVICES) {
    for (const city of CITIES) {
      const slug = `${service.slug}-${city.slug}-oh`;
      pages.push({
        slug,
        serviceSlug: service.slug,
        serviceName: service.name,
        citySlug: city.slug,
        cityName: city.name,
        title: `${service.name} in ${city.name}, OH | Nick's Tire & Auto | (216) 862-0005`,
        metaDescription: `${service.name} ${service.price} near ${city.name}, OH. 4.9★ (1,700+ reviews). Walk-ins welcome. Call (216) 862-0005.`,
        h1: `${service.name} Near ${city.name}`,
        intro: generateIntro(service.name, city.name, city.driveMin, service.price),
      });
    }
  }

  return pages;
}

/** Get a specific page by slug */
export function getServiceCityPage(slug: string): ServiceCityPage | undefined {
  return generateServiceCityPages().find(p => p.slug === slug);
}

/** Total pages generated */
export const TOTAL_SERVICE_CITY_PAGES = SERVICES.length * CITIES.length; // 13 × 20 = 260
