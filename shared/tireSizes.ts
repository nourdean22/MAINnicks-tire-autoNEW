/**
 * Programmatic tire size pages — each targets "225/65R17 tires cleveland" etc.
 * These are high-intent commercial keywords with strong purchase intent.
 * 30 pages targeting the most searched tire sizes in the US.
 */

export interface TireSizePage {
  size: string;       // "225/65R17"
  slug: string;       // "225-65r17"
  commonVehicles: string[];
  category: "SUV/Crossover" | "Sedan" | "Truck" | "Performance";
  metaTitle: string;
  metaDescription: string;
}

export const TIRE_SIZE_PAGES: TireSizePage[] = [
  {
    size: "225/65R17",
    slug: "225-65r17",
    commonVehicles: ["Honda CR-V", "Toyota RAV4", "Ford Escape", "Chevy Equinox"],
    category: "SUV/Crossover",
    metaTitle: "225/65R17 Tires Cleveland | In Stock | Nick's Tire & Auto",
    metaDescription: "Buy 225/65R17 tires in Cleveland. Fits Honda CR-V, Toyota RAV4, Ford Escape, Chevy Equinox. New & used in stock. Free installation. Walk-ins welcome. (216) 862-0005",
  },
  {
    size: "235/65R18",
    slug: "235-65r18",
    commonVehicles: ["Toyota Highlander", "Honda Pilot", "Ford Explorer"],
    category: "SUV/Crossover",
    metaTitle: "235/65R18 Tires Cleveland | In Stock | Nick's Tire & Auto",
    metaDescription: "Buy 235/65R18 tires in Cleveland. Fits Toyota Highlander, Honda Pilot, Ford Explorer. New & used in stock. Free installation. Walk-ins welcome. (216) 862-0005",
  },
  {
    size: "265/70R17",
    slug: "265-70r17",
    commonVehicles: ["Ford F-150", "Chevy Silverado", "Ram 1500", "Toyota Tacoma"],
    category: "Truck",
    metaTitle: "265/70R17 Tires Cleveland | In Stock | Nick's Tire & Auto",
    metaDescription: "Buy 265/70R17 tires in Cleveland. Fits Ford F-150, Chevy Silverado, Ram 1500, Toyota Tacoma. New & used in stock. Free installation. Walk-ins welcome. (216) 862-0005",
  },
  {
    size: "245/60R18",
    slug: "245-60r18",
    commonVehicles: ["Chevy Traverse", "Chevy Tahoe", "Honda Pilot"],
    category: "SUV/Crossover",
    metaTitle: "245/60R18 Tires Cleveland | In Stock | Nick's Tire & Auto",
    metaDescription: "Buy 245/60R18 tires in Cleveland. Fits Chevy Traverse, Chevy Tahoe, Honda Pilot. New & used in stock. Free installation. Walk-ins welcome. (216) 862-0005",
  },
  {
    size: "215/55R17",
    slug: "215-55r17",
    commonVehicles: ["Toyota Camry", "Honda Accord", "Chevy Malibu"],
    category: "Sedan",
    metaTitle: "215/55R17 Tires Cleveland | In Stock | Nick's Tire & Auto",
    metaDescription: "Buy 215/55R17 tires in Cleveland. Fits Toyota Camry, Honda Accord, Chevy Malibu. New & used in stock. Free installation. Walk-ins welcome. (216) 862-0005",
  },
  {
    size: "225/60R18",
    slug: "225-60r18",
    commonVehicles: ["Mazda CX-5", "Hyundai Tucson", "Kia Sportage"],
    category: "SUV/Crossover",
    metaTitle: "225/60R18 Tires Cleveland | In Stock | Nick's Tire & Auto",
    metaDescription: "Buy 225/60R18 tires in Cleveland. Fits Mazda CX-5, Hyundai Tucson, Kia Sportage. New & used in stock. Free installation. Walk-ins welcome. (216) 862-0005",
  },
  {
    size: "205/55R16",
    slug: "205-55r16",
    commonVehicles: ["Honda Civic", "Toyota Corolla", "Chevy Cruze", "Ford Focus"],
    category: "Sedan",
    metaTitle: "205/55R16 Tires Cleveland | In Stock | Nick's Tire & Auto",
    metaDescription: "Buy 205/55R16 tires in Cleveland. Fits Honda Civic, Toyota Corolla, Chevy Cruze, Ford Focus. New & used in stock. Free installation. Walk-ins welcome. (216) 862-0005",
  },
  {
    size: "235/55R19",
    slug: "235-55r19",
    commonVehicles: ["Lexus RX 350", "Nissan Murano", "Ford Edge"],
    category: "SUV/Crossover",
    metaTitle: "235/55R19 Tires Cleveland | In Stock | Nick's Tire & Auto",
    metaDescription: "Buy 235/55R19 tires in Cleveland. Fits Lexus RX 350, Nissan Murano, Ford Edge. New & used in stock. Free installation. Walk-ins welcome. (216) 862-0005",
  },
  {
    size: "275/55R20",
    slug: "275-55r20",
    commonVehicles: ["Ford F-150", "Chevy Silverado", "Ram 1500"],
    category: "Truck",
    metaTitle: "275/55R20 Tires Cleveland | In Stock | Nick's Tire & Auto",
    metaDescription: "Buy 275/55R20 tires in Cleveland. Fits Ford F-150, Chevy Silverado, Ram 1500. New & used in stock. Free installation. Walk-ins welcome. (216) 862-0005",
  },
  {
    size: "245/65R17",
    slug: "245-65r17",
    commonVehicles: ["Jeep Grand Cherokee", "Toyota 4Runner"],
    category: "SUV/Crossover",
    metaTitle: "245/65R17 Tires Cleveland | In Stock | Nick's Tire & Auto",
    metaDescription: "Buy 245/65R17 tires in Cleveland. Fits Jeep Grand Cherokee, Toyota 4Runner. New & used in stock. Free installation. Walk-ins welcome. (216) 862-0005",
  },
  {
    size: "215/60R16",
    slug: "215-60r16",
    commonVehicles: ["Toyota Camry", "Nissan Altima", "Ford Fusion"],
    category: "Sedan",
    metaTitle: "215/60R16 Tires Cleveland | In Stock | Nick's Tire & Auto",
    metaDescription: "Buy 215/60R16 tires in Cleveland. Fits Toyota Camry, Nissan Altima, Ford Fusion. New & used in stock. Free installation. Walk-ins welcome. (216) 862-0005",
  },
  {
    size: "225/55R18",
    slug: "225-55r18",
    commonVehicles: ["Mazda CX-5", "Nissan Rogue", "Ford Escape"],
    category: "SUV/Crossover",
    metaTitle: "225/55R18 Tires Cleveland | In Stock | Nick's Tire & Auto",
    metaDescription: "Buy 225/55R18 tires in Cleveland. Fits Mazda CX-5, Nissan Rogue, Ford Escape. New & used in stock. Free installation. Walk-ins welcome. (216) 862-0005",
  },
  {
    size: "235/70R16",
    slug: "235-70r16",
    commonVehicles: ["Toyota Tacoma", "Nissan Frontier", "Chevy Colorado"],
    category: "Truck",
    metaTitle: "235/70R16 Tires Cleveland | In Stock | Nick's Tire & Auto",
    metaDescription: "Buy 235/70R16 tires in Cleveland. Fits Toyota Tacoma, Nissan Frontier, Chevy Colorado. New & used in stock. Free installation. Walk-ins welcome. (216) 862-0005",
  },
  {
    size: "265/65R18",
    slug: "265-65r18",
    commonVehicles: ["Ford F-150", "Chevy Silverado", "Toyota Tundra"],
    category: "Truck",
    metaTitle: "265/65R18 Tires Cleveland | In Stock | Nick's Tire & Auto",
    metaDescription: "Buy 265/65R18 tires in Cleveland. Fits Ford F-150, Chevy Silverado, Toyota Tundra. New & used in stock. Free installation. Walk-ins welcome. (216) 862-0005",
  },
  {
    size: "235/60R18",
    slug: "235-60r18",
    commonVehicles: ["Toyota Highlander", "Honda Pilot", "VW Atlas"],
    category: "SUV/Crossover",
    metaTitle: "235/60R18 Tires Cleveland | In Stock | Nick's Tire & Auto",
    metaDescription: "Buy 235/60R18 tires in Cleveland. Fits Toyota Highlander, Honda Pilot, VW Atlas. New & used in stock. Free installation. Walk-ins welcome. (216) 862-0005",
  },
  {
    size: "245/50R20",
    slug: "245-50r20",
    commonVehicles: ["Ford Explorer", "Chevy Traverse", "Dodge Durango"],
    category: "SUV/Crossover",
    metaTitle: "245/50R20 Tires Cleveland | In Stock | Nick's Tire & Auto",
    metaDescription: "Buy 245/50R20 tires in Cleveland. Fits Ford Explorer, Chevy Traverse, Dodge Durango. New & used in stock. Free installation. Walk-ins welcome. (216) 862-0005",
  },
  {
    size: "215/65R16",
    slug: "215-65r16",
    commonVehicles: ["Subaru Forester", "Subaru Outback", "Nissan Rogue"],
    category: "SUV/Crossover",
    metaTitle: "215/65R16 Tires Cleveland | In Stock | Nick's Tire & Auto",
    metaDescription: "Buy 215/65R16 tires in Cleveland. Fits Subaru Forester, Subaru Outback, Nissan Rogue. New & used in stock. Free installation. Walk-ins welcome. (216) 862-0005",
  },
  {
    size: "255/55R18",
    slug: "255-55r18",
    commonVehicles: ["Jeep Grand Cherokee", "Toyota 4Runner"],
    category: "SUV/Crossover",
    metaTitle: "255/55R18 Tires Cleveland | In Stock | Nick's Tire & Auto",
    metaDescription: "Buy 255/55R18 tires in Cleveland. Fits Jeep Grand Cherokee, Toyota 4Runner. New & used in stock. Free installation. Walk-ins welcome. (216) 862-0005",
  },
  {
    size: "275/60R20",
    slug: "275-60r20",
    commonVehicles: ["Chevy Silverado", "GMC Sierra", "Chevy Tahoe"],
    category: "Truck",
    metaTitle: "275/60R20 Tires Cleveland | In Stock | Nick's Tire & Auto",
    metaDescription: "Buy 275/60R20 tires in Cleveland. Fits Chevy Silverado, GMC Sierra, Chevy Tahoe. New & used in stock. Free installation. Walk-ins welcome. (216) 862-0005",
  },
  {
    size: "225/50R17",
    slug: "225-50r17",
    commonVehicles: ["Honda Accord", "Toyota Camry", "VW Passat"],
    category: "Sedan",
    metaTitle: "225/50R17 Tires Cleveland | In Stock | Nick's Tire & Auto",
    metaDescription: "Buy 225/50R17 tires in Cleveland. Fits Honda Accord, Toyota Camry, VW Passat. New & used in stock. Free installation. Walk-ins welcome. (216) 862-0005",
  },
  {
    size: "235/45R18",
    slug: "235-45r18",
    commonVehicles: ["BMW 3 Series", "Audi A4", "Lexus IS"],
    category: "Performance",
    metaTitle: "235/45R18 Tires Cleveland | In Stock | Nick's Tire & Auto",
    metaDescription: "Buy 235/45R18 tires in Cleveland. Fits BMW 3 Series, Audi A4, Lexus IS. New & used in stock. Free installation. Walk-ins welcome. (216) 862-0005",
  },
  {
    size: "245/45R18",
    slug: "245-45r18",
    commonVehicles: ["Mercedes C-Class", "BMW 3 Series", "Acura TLX"],
    category: "Performance",
    metaTitle: "245/45R18 Tires Cleveland | In Stock | Nick's Tire & Auto",
    metaDescription: "Buy 245/45R18 tires in Cleveland. Fits Mercedes C-Class, BMW 3 Series, Acura TLX. New & used in stock. Free installation. Walk-ins welcome. (216) 862-0005",
  },
  {
    size: "215/50R17",
    slug: "215-50r17",
    commonVehicles: ["Honda Civic", "VW Jetta", "Hyundai Elantra"],
    category: "Sedan",
    metaTitle: "215/50R17 Tires Cleveland | In Stock | Nick's Tire & Auto",
    metaDescription: "Buy 215/50R17 tires in Cleveland. Fits Honda Civic, VW Jetta, Hyundai Elantra. New & used in stock. Free installation. Walk-ins welcome. (216) 862-0005",
  },
  {
    size: "255/65R18",
    slug: "255-65r18",
    commonVehicles: ["Jeep Grand Cherokee", "Toyota 4Runner"],
    category: "SUV/Crossover",
    metaTitle: "255/65R18 Tires Cleveland | In Stock | Nick's Tire & Auto",
    metaDescription: "Buy 255/65R18 tires in Cleveland. Fits Jeep Grand Cherokee, Toyota 4Runner. New & used in stock. Free installation. Walk-ins welcome. (216) 862-0005",
  },
  {
    size: "225/45R17",
    slug: "225-45r17",
    commonVehicles: ["Honda Civic", "Toyota Corolla", "Mazda3"],
    category: "Sedan",
    metaTitle: "225/45R17 Tires Cleveland | In Stock | Nick's Tire & Auto",
    metaDescription: "Buy 225/45R17 tires in Cleveland. Fits Honda Civic, Toyota Corolla, Mazda3. New & used in stock. Free installation. Walk-ins welcome. (216) 862-0005",
  },
  {
    size: "245/55R19",
    slug: "245-55r19",
    commonVehicles: ["Ford Explorer", "Kia Sorento", "Kia Telluride"],
    category: "SUV/Crossover",
    metaTitle: "245/55R19 Tires Cleveland | In Stock | Nick's Tire & Auto",
    metaDescription: "Buy 245/55R19 tires in Cleveland. Fits Ford Explorer, Kia Sorento, Kia Telluride. New & used in stock. Free installation. Walk-ins welcome. (216) 862-0005",
  },
  {
    size: "265/60R18",
    slug: "265-60r18",
    commonVehicles: ["Ram 1500", "Toyota Tundra"],
    category: "Truck",
    metaTitle: "265/60R18 Tires Cleveland | In Stock | Nick's Tire & Auto",
    metaDescription: "Buy 265/60R18 tires in Cleveland. Fits Ram 1500, Toyota Tundra. New & used in stock. Free installation. Walk-ins welcome. (216) 862-0005",
  },
  {
    size: "225/65R16",
    slug: "225-65r16",
    commonVehicles: ["Ford Escape", "Nissan Rogue", "Subaru Forester"],
    category: "SUV/Crossover",
    metaTitle: "225/65R16 Tires Cleveland | In Stock | Nick's Tire & Auto",
    metaDescription: "Buy 225/65R16 tires in Cleveland. Fits Ford Escape, Nissan Rogue, Subaru Forester. New & used in stock. Free installation. Walk-ins welcome. (216) 862-0005",
  },
  {
    size: "235/50R18",
    slug: "235-50r18",
    commonVehicles: ["Subaru Outback", "Nissan Rogue", "Kia Sorento"],
    category: "SUV/Crossover",
    metaTitle: "235/50R18 Tires Cleveland | In Stock | Nick's Tire & Auto",
    metaDescription: "Buy 235/50R18 tires in Cleveland. Fits Subaru Outback, Nissan Rogue, Kia Sorento. New & used in stock. Free installation. Walk-ins welcome. (216) 862-0005",
  },
  {
    size: "255/70R18",
    slug: "255-70r18",
    commonVehicles: ["Ram 1500", "Chevy Silverado"],
    category: "Truck",
    metaTitle: "255/70R18 Tires Cleveland | In Stock | Nick's Tire & Auto",
    metaDescription: "Buy 255/70R18 tires in Cleveland. Fits Ram 1500, Chevy Silverado. New & used in stock. Free installation. Walk-ins welcome. (216) 862-0005",
  },
];

/** Look up a tire size page by its URL slug */
export function getTireSizeBySlug(slug: string): TireSizePage | undefined {
  return TIRE_SIZE_PAGES.find(p => p.slug === slug);
}

/** All tire size slugs for sitemap/prerender */
export function getAllTireSizeSlugs(): string[] {
  return TIRE_SIZE_PAGES.map(p => p.slug);
}
