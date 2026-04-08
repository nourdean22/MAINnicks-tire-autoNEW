/**
 * Vehicle Make + Service combo pages — 50 pages targeting
 * "[Make] [Service] Cleveland" keywords (e.g., "Honda Brake Repair Cleveland").
 * High-intent commercial keywords with strong local search volume.
 */

export interface VehicleServicePage {
  make: string;
  service: string;
  serviceSlug: string;
  slug: string;         // "honda-brake-repair"
  metaTitle: string;
  metaDescription: string;
  commonModels: string[];
}

const MAKES: { name: string; models: string[] }[] = [
  { name: "Honda", models: ["Civic", "Accord", "CR-V", "Pilot", "HR-V", "Odyssey"] },
  { name: "Toyota", models: ["Camry", "Corolla", "RAV4", "Highlander", "Tacoma", "4Runner"] },
  { name: "Ford", models: ["F-150", "Escape", "Explorer", "Fusion", "Edge", "Bronco"] },
  { name: "Chevrolet", models: ["Silverado", "Equinox", "Malibu", "Traverse", "Tahoe", "Colorado"] },
  { name: "Nissan", models: ["Altima", "Rogue", "Sentra", "Pathfinder", "Frontier", "Maxima"] },
  { name: "Hyundai", models: ["Elantra", "Tucson", "Sonata", "Santa Fe", "Kona", "Palisade"] },
  { name: "Kia", models: ["Forte", "Sportage", "Sorento", "Soul", "Telluride", "K5"] },
  { name: "Jeep", models: ["Wrangler", "Cherokee", "Grand Cherokee", "Compass", "Renegade", "Gladiator"] },
  { name: "BMW", models: ["3 Series", "5 Series", "X3", "X5", "X1", "4 Series"] },
  { name: "Dodge", models: ["Charger", "Challenger", "Durango", "Ram 1500", "Journey", "Grand Caravan"] },
];

const SERVICES: { name: string; slug: string; action: string }[] = [
  { name: "Brake Repair", slug: "brake-repair", action: "brake repair" },
  { name: "Oil Change", slug: "oil-change", action: "oil change" },
  { name: "Tire Service", slug: "tire-service", action: "tire service" },
  { name: "Diagnostics", slug: "diagnostics", action: "engine diagnostics" },
  { name: "Suspension", slug: "suspension-repair", action: "suspension repair" },
];

function generatePages(): VehicleServicePage[] {
  const pages: VehicleServicePage[] = [];

  for (const make of MAKES) {
    for (const service of SERVICES) {
      const slug = `${make.name.toLowerCase()}-${service.slug}`;
      pages.push({
        make: make.name,
        service: service.name,
        serviceSlug: service.slug,
        slug,
        metaTitle: `${make.name} ${service.name} Cleveland | Nick's Tire & Auto`,
        metaDescription: `${make.name} ${service.action} in Cleveland. Expert service for ${make.models.slice(0, 4).join(", ")}. Same-day service, transparent pricing. 4.9 stars. Call (216) 862-0005.`,
        commonModels: make.models,
      });
    }
  }

  return pages;
}

export const VEHICLE_SERVICE_PAGES: VehicleServicePage[] = generatePages();

/** Look up a vehicle+service page by its URL slug */
export function getVehicleServiceBySlug(slug: string): VehicleServicePage | undefined {
  return VEHICLE_SERVICE_PAGES.find(p => p.slug === slug);
}

/** All vehicle+service slugs for sitemap/prerender */
export function getAllVehicleServiceSlugs(): string[] {
  return VEHICLE_SERVICE_PAGES.map(p => p.slug);
}
