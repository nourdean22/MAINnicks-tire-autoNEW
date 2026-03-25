/**
 * Citation Manager — Tracks NAP (Name, Address, Phone) consistency
 * across business directories for local SEO.
 */

import { createLogger } from "../lib/logger";
const log = createLogger("citations");

export interface Citation {
  id: string;
  directoryName: string;
  url: string;
  status: "verified" | "needs-update" | "not-listed" | "pending";
  nameCorrect: boolean;
  addressCorrect: boolean;
  phoneCorrect: boolean;
  hoursCorrect: boolean;
  lastChecked: Date | null;
  notes?: string;
}

// Canonical business info (source of truth)
const CANONICAL = {
  name: "Nick's Tire & Auto",
  address: "17625 Euclid Ave, Euclid, OH 44112",
  phone: "(216) 862-0005",
  hours: "Mon-Sat 8AM-6PM, Sun 9AM-4PM",
  website: "https://nickstire.org",
};

// Known directories to track
export const DIRECTORY_LIST: Array<{ name: string; url: string; priority: "high" | "medium" | "low" }> = [
  { name: "Google Business Profile", url: "https://business.google.com", priority: "high" },
  { name: "Yelp", url: "https://www.yelp.com", priority: "high" },
  { name: "Facebook Business", url: "https://www.facebook.com", priority: "high" },
  { name: "Apple Maps", url: "https://mapsconnect.apple.com", priority: "high" },
  { name: "BBB", url: "https://www.bbb.org", priority: "high" },
  { name: "Yellow Pages", url: "https://www.yellowpages.com", priority: "medium" },
  { name: "Angi (Angie's List)", url: "https://www.angi.com", priority: "medium" },
  { name: "CarFax Service Center", url: "https://www.carfax.com", priority: "high" },
  { name: "RepairPal", url: "https://repairpal.com", priority: "high" },
  { name: "AutoMD", url: "https://www.automd.com", priority: "medium" },
  { name: "Nextdoor", url: "https://nextdoor.com", priority: "medium" },
  { name: "Bing Places", url: "https://www.bingplaces.com", priority: "medium" },
  { name: "MapQuest", url: "https://www.mapquest.com", priority: "low" },
  { name: "Foursquare", url: "https://foursquare.com", priority: "low" },
  { name: "Superpages", url: "https://www.superpages.com", priority: "low" },
  { name: "Manta", url: "https://www.manta.com", priority: "low" },
  { name: "Euclid Chamber of Commerce", url: "https://euclidchamber.com", priority: "medium" },
  { name: "Cleveland.com", url: "https://www.cleveland.com", priority: "medium" },
  { name: "Instagram", url: "https://www.instagram.com/nicks_tire_euclid/", priority: "high" },
];

/** Get the canonical business info */
export function getCanonicalNAP() {
  return CANONICAL;
}

/** Generate a citation audit report */
export function generateCitationReport(citations: Citation[]): {
  total: number;
  verified: number;
  needsUpdate: number;
  notListed: number;
  napConsistencyScore: number;
} {
  const verified = citations.filter(c => c.status === "verified").length;
  const needsUpdate = citations.filter(c => c.status === "needs-update").length;
  const notListed = citations.filter(c => c.status === "not-listed").length;
  const total = citations.length;

  // NAP consistency = % of verified citations where all fields are correct
  const fullyCorrect = citations.filter(c =>
    c.status === "verified" && c.nameCorrect && c.addressCorrect && c.phoneCorrect
  ).length;
  const napConsistencyScore = verified > 0 ? Math.round((fullyCorrect / verified) * 100) : 0;

  return { total, verified, needsUpdate, notListed, napConsistencyScore };
}

log.info(`Citation manager loaded: tracking ${DIRECTORY_LIST.length} directories`);
