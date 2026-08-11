/**
 * TirePricesClevelandPage — proprietary-data AEO page for hybrid price
 * intent: "how much do tires cost in cleveland", "tire prices cleveland",
 * "average cost of tires". These query shapes trigger AI answer engines
 * at the highest observed rates, and engines cite pages whose numbers
 * they can verify — so this page publishes the shop's REAL floors
 * (shared/business.ts canon) plus live per-size distributor pricing
 * (gatewayTire.publicPriceRanges) instead of generic content.
 *
 * Claim discipline: every number on this page traces to canon or the
 * live feed. The used-tire fineprint + typical band travel with the $25
 * everywhere (wave-183 rule). No invented ranges, no competitor guesses.
 */
import FocusedServicePage, { type ServicePageConfig } from "@/components/FocusedServicePage";
import LiveTirePricesBlock from "@/components/LiveTirePricesBlock";
import { BUSINESS } from "@shared/business";

const CONFIG: ServicePageConfig = {
  canonicalPath: "/tire-prices-cleveland",
  heroImage: "/photos/rugged-tire-tread-closeup.webp",
  title: "Tire Prices Cleveland — Live In-Stock Pricing | Nick's",
  description:
    "Real tire prices in Cleveland from our live distributor feed. Used tires from $25 installed (12-inch rims; most $40-80), new from $89 installed. Walk-ins 7 days.",
  eyebrow: "TIRE PRICES — CLEVELAND, OHIO",
  h1: "TIRE PRICES IN CLEVELAND.\nREAL NUMBERS, UPDATED DAILY.",
  sub: "Most tire shops make you call for every price. This page shows what tires actually cost at our shop: inspected used tires from $25 installed, new tires from $89 installed, and live per-size pricing pulled straight from our distributor feed. If a number is on this page, we honor it — and if your size isn't listed, one call gets you the exact quote.",
  aeoAnswer:
    "At Nick's Tire & Auto in Cleveland, inspected used tires run from $25 installed (12-inch rims; most sizes $40-80 installed) and new tires from $89 installed, with live per-size distributor pricing published on this page. Walk-ins 7 days at 17625 Euclid Ave, Cleveland. (216) 862-0005.",
  startingPrice:
    "Used from $25 installed (12-inch rims, subject to availability) · new from $89 installed",
  pricingTitle: "WHAT TIRES ACTUALLY COST HERE",
  pricingSub: "Floors from our published pricing, per-size numbers from the live distributor feed.",
  tiers: [],
  pricingOverride: <LiveTirePricesBlock />,
  includedTitle: "EVERY TIRE INSTALL INCLUDES",
  includedSub: "The price you see covers the work that gets you back on the road.",
  included: [
    "Mount and balance on every tire — not a line-item surprise",
    "New valve stems and disposal of your old tires",
    "Used tires: tread depth measured with a gauge and shown to you at install",
    "Used tires: 4-point check — tread, sidewall, DOT date, plug history — before it goes on your car",
    "Free alignment check on every install — Cleveland potholes kill fresh tires without it",
  ],
  faqs: [
    {
      q: "How much do tires cost in Cleveland?",
      a: `At our shop: inspected used tires start at $25 installed (${BUSINESS.usedTires.fineprint}; ${BUSINESS.usedTires.typicalBand}). New tires start at $89 installed. The table on this page shows live starting prices per tire for the most popular sizes, refreshed from our distributor feed — call (216) 862-0005 to confirm your exact size and brand.`,
    },
    {
      q: "Do these prices include installation?",
      a: "Yes. Per-tire prices on this page include installation through our package — mount, balance, valve stems, and disposal. Used-tire prices are all-in the same way. There are no mystery shop-supply fees added at the counter.",
    },
    {
      q: "How current is the pricing on this page?",
      a: "The per-size table comes from our distributor price feed and refreshes daily; the update date is printed next to the table. Floors ($25 used, $89 new) are our standing published prices. Availability moves fast on popular sizes, so confirm by phone before driving over.",
    },
    {
      q: "What's the cheapest safe way to get rolling today?",
      a: `An inspected used tire — from $25 installed (${BUSINESS.usedTires.fineprint}; ${BUSINESS.usedTires.typicalBand}). Every used tire passes a 4-point check (tread, sidewall, DOT date, plug history) before it goes on your car, and typical turnaround is ${BUSINESS.usedTires.turnaround.toLowerCase()}. Walk in 7 days a week.`,
    },
    {
      q: "Can I pay over time instead of all at once?",
      a: "Yes — payment programs through Acima, Snap, Koalafi, and American First Finance, starting at $10 down. Approval doesn't require perfect credit. Ask at the counter or start from our payment programs page before you come in.",
    },
    {
      q: "Is there a warranty on these tires?",
      a: "Used tires carry a 7-day limited replacement warranty: verified air loss or internal tire failure from a defect present at the time of sale. Road-hazard damage — punctures, sidewall impacts, bead damage — isn't covered, the same as a new tire without a separate road-hazard plan. Warranty terms are in writing on your invoice.",
    },
  ],
  bookingService: "tires",
  serviceType: "Tire Sales & Installation",
  ctaHeadline: "KNOW YOUR PRICE BEFORE YOU WALK IN",
  ctaSub: "Call your size for an exact quote, or walk in 7 days a week. 17625 Euclid Ave, Cleveland OH. (216) 862-0005.",
};

export default function TirePricesClevelandPage() {
  return <FocusedServicePage config={CONFIG} />;
}
