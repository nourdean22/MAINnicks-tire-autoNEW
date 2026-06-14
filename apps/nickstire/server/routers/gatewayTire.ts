/**
 * Gateway Tire (Dunlap & Kyle / b2b.dktire.com) Integration Router
 * 
 * Full tire ordering system:
 * - 100% markup pricing (wholesale cost × 2)
 * - Nick's Premium Installation Package (FREE with every tire)
 * - Live Gateway B2B inventory search
 * - Curated catalog fallback with real brand/model data
 * - Customer order placement with DB tracking
 * - Google Sheets auto-sync for every order
 * - Gmail email notification to shop
 * - Owner notification on new orders
 * - Admin order management (view, update status, notes)
 */
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import { notifyTireOrder } from "../email-notify";
import { getNextInvoiceNumber, createInvoice } from "../db";
import { syncInvoiceToSheet, syncTireOrderToSheet } from "../sheets-sync";
import {
  evaluateOrderPrice,
  getIdempotencyKey,
  generateOrderNumber,
  isDuplicateKeyError,
  buildCancellationAlert,
} from "../lib/tire-order-guards";
import { z } from "zod";
import { eq, desc, sql, and } from "drizzle-orm";
import { tireOrders, shopSettings, bookings } from "../../drizzle/schema";

import { db } from "../lib/db-helper";

import { createLogger } from "../lib/logger";

const log = createLogger("routers:gatewayTire");
// 2026-06-10 checkout-hardening wave · autoCreateInvoiceFromTireOrder
// deleted — zero call sites since invoice creation moved to placeOrder
// (updateOrder explicitly must NOT create a second invoice). Keeping a
// dead "create invoice on installed" path invites a double-invoice bug.

// ─── Gateway Tire B2B Session ─────────────────────────
// Shared client lives at server/services/gatewayClient.ts. We re-export
// getLastAuthFailure under its historical name so the admin status
// endpoint signature doesn't change.
import {
  GATEWAY_PORTAL_BASE,
  searchTiresBySize as gatewaySearchTires,
  pickWholesaleCost,
  getLastGatewayFailure,
} from "../services/gatewayClient";
import { DkClient } from "../services/dkClient";

export const getLastAuthFailure = getLastGatewayFailure;

// ─── Pricing: 100% markup (cost × 2) ─────────────────
async function getTireMarkup(): Promise<number> {
  const d = await db();
  if (!d) return 100; // Default 100% markup
  const result = await d.select().from(shopSettings).where(eq(shopSettings.key, "tireMarkup")).limit(1);
  return result.length > 0 ? parseFloat(result[0].value) : 100;
}

// ─── Nick's Premium Installation Package ──────────────
// This is the genius: $0 service fee. Everything is FREE.
// The value is baked into the tire price (100% markup).
// Customer sees a massive free package and stops caring about tire price.
const NICKS_PACKAGE = {
  name: "Nick's Premium Installation Package",
  tagline: "Included FREE with every tire",
  totalRetailValue: 289, // What these services would cost elsewhere per set
  services: [
    { name: "Professional Mounting", value: 20, desc: "Expert tire mounting by certified technicians" },
    { name: "Computer Balancing", value: 18, desc: "Precision spin-balance for smooth, vibration-free driving" },
    { name: "New Valve Stems", value: 8, desc: "Brand new rubber valve stems on every wheel" },
    { name: "Tire Disposal & Recycling", value: 5, desc: "Eco-friendly disposal of your old tires" },
    { name: "Rim Cleaning & Inspection", value: 15, desc: "Wheels cleaned, inspected for damage, and prepped" },
    { name: "Tire Sealant Application", value: 12, desc: "Bead sealant applied to prevent slow leaks" },
    { name: "Torque-to-Spec Lug Tightening", value: 10, desc: "Lug nuts torqued to manufacturer specifications" },
    { name: "TPMS Sensor Reset", value: 25, desc: "Tire pressure monitoring system recalibrated" },
    { name: "Free Air Pressure Check (Lifetime)", value: 0, desc: "Come back anytime for a free pressure check" },
    { name: "Free Tire Rotation (First Year)", value: 40, desc: "One free rotation within 12 months of purchase" },
    { name: "Free Flat Repair (First Year)", value: 35, desc: "Free patch or plug repair for repairable punctures" },
    { name: "20-Point Safety Inspection", value: 49, desc: "Full vehicle safety check: brakes, suspension, lights, fluids" },
    { name: "Alignment Check", value: 29, desc: "Alignment angles checked and report provided" },
    { name: "Road Hazard Advisory", value: 0, desc: "Expert advice on road hazard warranty options" },
    { name: "Priority Scheduling", value: 0, desc: "Online tire orders get priority shop scheduling" },
  ],
};

// Calculate total package value per tire (for display)
const PACKAGE_VALUE_PER_SET = NICKS_PACKAGE.services.reduce((sum, s) => sum + s.value, 0);

// Service fee is $0 — everything is included in the tire price
const SERVICE_FEE_PER_TIRE = 0;

// ─── Data Freshness Tracking ────────────────────────
interface SearchCacheEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- search results have varied shapes across live/catalog/pipeline
  results: any;
  fetchedAt: number;
  source: "live" | "catalog";
}
const searchCache = new Map<string, SearchCacheEntry>();
const SEARCH_CACHE_TTL = 15 * 60 * 1000; // 15 minutes
let lastLiveFetchAt: string | null = null;
let lastLiveFetchSuccess = false;

function getCachedSearch(key: string): SearchCacheEntry | null {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > SEARCH_CACHE_TTL) {
    searchCache.delete(key);
    return null;
  }
  return entry;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- search results have varied shapes
function setCachedSearch(key: string, results: any, source: "live" | "catalog") {
  // Keep cache bounded
  if (searchCache.size > 100) {
    const oldest = [...searchCache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)[0];
    if (oldest) searchCache.delete(oldest[0]);
  }
  searchCache.set(key, { results, fetchedAt: Date.now(), source });
}

// ─── Order Idempotency ──────────────────────────────
// L1: in-memory map (fast path, this instance only). L2: a durable DB
// check inside placeOrder — the map dies on every redeploy and never
// existed on a second instance, so it CANNOT be the only guard.
// Pure helpers (getIdempotencyKey, generateOrderNumber, price guards)
// live in ../lib/tire-order-guards so they're unit-testable.
const recentOrderKeys = new Map<string, { orderNumber: string; at: number }>();
const IDEMPOTENCY_WINDOW = 5 * 60 * 1000; // 5 minutes

function checkDuplicateOrder(key: string): string | null {
  const existing = recentOrderKeys.get(key);
  if (existing && Date.now() - existing.at < IDEMPOTENCY_WINDOW) {
    return existing.orderNumber;
  }
  return null;
}

function recordOrder(key: string, orderNumber: string) {
  recentOrderKeys.set(key, { orderNumber, at: Date.now() });
  // Prune old entries
  for (const [k, v] of recentOrderKeys) {
    if (Date.now() - v.at > IDEMPOTENCY_WINDOW) recentOrderKeys.delete(k);
  }
}

// 2026-06-10 checkout-hardening wave · the legacy syncOrderToGoogleSheet
// here read /home/ubuntu/.gdrive-rclone.ini (Manus-era path that does not
// exist on Railway) — order rows NEVER reached the sheet in production.
// Replaced by syncTireOrderToSheet in ../sheets-sync (service-account
// auth, same as every other working sync).

// ─── Gmail notification (uses dual-email system) ────

// ─── Curated tire catalog ─────────────────────────────
interface CatalogTire {
  brand: string;
  model: string;
  category: "budget" | "mid" | "premium";
  baseCost: number;
  warranty: string;
  features: string[];
  speedRating: string;
  loadIndex: string;
}

function getCuratedCatalog(): CatalogTire[] {
  return [
    { brand: "FORTUNE", model: "Perfectus FSR602", category: "budget", baseCost: 52, warranty: "60,000 mi", features: ["All-Season", "Fuel Efficient", "Quiet Ride"], speedRating: "H", loadIndex: "95" },
    { brand: "AMERICUS", model: "Sport HP", category: "budget", baseCost: 48, warranty: "50,000 mi", features: ["All-Season", "Performance", "Wet Traction"], speedRating: "H", loadIndex: "95" },
    { brand: "NEXEN", model: "N'Priz AH5", category: "mid", baseCost: 68, warranty: "70,000 mi", features: ["All-Season", "Comfort", "Long Tread Life"], speedRating: "H", loadIndex: "95" },
    { brand: "HANKOOK", model: "Kinergy GT H436", category: "mid", baseCost: 75, warranty: "70,000 mi", features: ["All-Season", "Grand Touring", "Low Noise"], speedRating: "H", loadIndex: "95" },
    { brand: "COOPER", model: "CS5 Ultra Touring", category: "mid", baseCost: 82, warranty: "70,000 mi", features: ["All-Season", "Touring", "Wear Square Indicator"], speedRating: "H", loadIndex: "95" },
    { brand: "CONTINENTAL", model: "TrueContact Tour", category: "premium", baseCost: 98, warranty: "80,000 mi", features: ["All-Season", "EcoPlus Technology", "Premium Comfort"], speedRating: "H", loadIndex: "95" },
    { brand: "GENERAL", model: "AltiMAX RT45", category: "mid", baseCost: 72, warranty: "65,000 mi", features: ["All-Season", "Replacement Tire Monitoring", "Visual Alignment Indicator"], speedRating: "H", loadIndex: "95" },
    { brand: "FIRESTONE", model: "Champion Fuel Fighter", category: "mid", baseCost: 78, warranty: "70,000 mi", features: ["All-Season", "Fuel Efficient", "Confident Handling"], speedRating: "H", loadIndex: "95" },
  ];
}

// ─── Public tire type ────────────────────────────────
interface PublicTire {
  id: string;
  name: string;
  brand: string;
  model: string;
  size: string;
  category: "budget" | "mid" | "premium";
  shopPrice: number;
  pricePerTireCents: number;
  warranty: string;
  features: string[];
  speedRating: string;
  loadIndex: string;
  inStock: boolean;
  estimatedDelivery: string;
}

// ─── Common tire sizes ───────────────────────────────
const POPULAR_SIZES = [
  "2055516", "2156016", "2156017", "2257017", "2356518",
  "2457016", "2657017", "2657018", "2756020", "3157017",
  "1956515", "2155517", "2256017", "2356517", "2457517",
];

const TIRE_BRANDS = [
  "FORTUNE", "AMERICUS", "NEXEN", "HANKOOK", "CONTINENTAL",
  "GENERAL", "COOPER", "FIRESTONE", "GOODYEAR", "MICHELIN",
  "BRIDGESTONE", "PIRELLI", "YOKOHAMA", "TOYO", "FALKEN",
];

// ═══════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════

export const gatewayTireRouter = router({
  // ─── PUBLIC: Get the Nick's Package details ────────
  getPackage: publicProcedure.query(() => ({
    ...NICKS_PACKAGE,
    packageValuePerSet: PACKAGE_VALUE_PER_SET,
  })),

  // ─── PUBLIC: Search tires ──────────────────────────
  publicSearch: publicProcedure
    .input(z.object({
      size: z.string().min(3).max(20),
      category: z.enum(["all", "budget", "mid", "premium"]).default("all"),
      sortBy: z.enum(["price-low", "price-high", "warranty", "brand"]).default("price-low"),
    }))
    .query(async ({ input }) => {
      const markup = await getTireMarkup();
      const sizeClean = input.size.replace(/[\/Rr\s-]/g, "");
      const sizeFormatted = sizeClean.length >= 7
        ? `${sizeClean.slice(0, 3)}/${sizeClean.slice(3, 5)}R${sizeClean.slice(5)}`
        : input.size;

      // Check search cache first
      const cacheKey = `${sizeClean}|${input.category}|${input.sortBy}|${markup}`;
      const cached = getCachedSearch(cacheKey);
      if (cached) {
        return { ...cached.results, cached: true, cachedAt: new Date(cached.fetchedAt).toISOString() };
      }

      // Check pipeline price cache first (populated by daily cron, avoids hitting Gateway live)
      try {
        const { getCachedPrices } = await import("../services/dataPipelines");
        const pipelineCached = getCachedPrices(sizeClean);
        if (pipelineCached && pipelineCached.length > 0) {
          let tires: PublicTire[] = pipelineCached.flatMap((item, idx) => {
            // wave-fix-2026-05-25 (audit #152) · filter $0 cache tires.
            // wholesaleCost could be 0 if D&K returned a backorder row
            // with no pricing location attached. Without this filter the
            // tire renders at $0.00 in TireFinder, customer taps Order,
            // and placeOrder's `pricePerTireCents: z.number().int().min(0)`
            // happily accepts the 0 input.
            if (item.wholesaleCost <= 0) {
              log.warn(`[gatewayTire:publicSearch] filtered $0 cache tire: ${item.brand} ${item.model}`);
              return [];
            }
            const shopPrice = Math.ceil(item.wholesaleCost * (1 + markup / 100) * 100) / 100;
            const pricePerTireCents = Math.round(shopPrice * 100);
            const cat = item.wholesaleCost < 60 ? "budget" : item.wholesaleCost < 90 ? "mid" : "premium";
            return [{
              id: `cache-${idx}-${item.brand.toLowerCase()}`,
              name: `${item.brand} ${item.model}`.trim(),
              brand: item.brand,
              model: item.model,
              size: item.size || sizeFormatted,
              category: cat as "budget" | "mid" | "premium",
              shopPrice,
              pricePerTireCents,
              warranty: "",
              features: [],
              speedRating: "",
              loadIndex: "",
              inStock: item.localQty > 0,
              estimatedDelivery: item.localQty > 0 ? "Same day" : "1-2 business days",
            }];
          });

          if (input.category !== "all") tires = tires.filter(t => t.category === input.category);
          tires.sort((a, b) => input.sortBy === "price-high" ? b.shopPrice - a.shopPrice : a.shopPrice - b.shopPrice);

          const cacheResult = {
            tires,
            source: "pipeline-cache" as const,
            serviceFee: 0,
            sizeFormatted,
            package: NICKS_PACKAGE,
            packageValue: PACKAGE_VALUE_PER_SET,
            dataFreshness: new Date(pipelineCached[0].fetchedAt).toISOString(),
          };
          setCachedSearch(cacheKey, cacheResult, "live");
          return { ...cacheResult, cached: false };
        }
      } catch (e) { log.warn("[gatewayTire:search] pipeline cache lookup failed, falling through to live:", e); }

      // Try live Gateway Tire API via the new POST /quicksearch/cache
      // endpoint (replaced the old GET /api/products/search after the
      // 2026-05 SPA migration). gatewaySearchTires handles the auth +
      // POST + JSON parse + 401 retry handling; we just map the response
      // shape to our PublicTire interface here.
      const rawTires = await gatewaySearchTires(sizeFormatted);

      if (rawTires && rawTires.length > 0) {
        try {
          let tires: PublicTire[] = rawTires.flatMap((item, idx) => {
            const cost = pickWholesaleCost(item);
            // wave-fix-2026-05-25 (audit #152) · filter $0 live tires.
            // pickWholesaleCost returns 0 when D&K's pricing_data is
            // missing/malformed. Without this filter the tire renders at
            // $0.00 and placeOrder accepts pricePerTireCents:0 input.
            if (cost <= 0) {
              log.warn(`[gatewayTire:publicSearch] filtered $0 live tire: ${item.make} ${item.minor_name}`);
              return [];
            }
            // 100% markup: customer pays 2× wholesale
            const shopPrice = Math.ceil(cost * (1 + markup / 100) * 100) / 100;
            const pricePerTireCents = Math.round(shopPrice * 100);
            const cat = cost < 60 ? "budget" : cost < 90 ? "mid" : "premium";
            // brand = item.make (e.g. "LANDSAIL").
            // model = item.minor_name stripped of "BRAND - " prefix
            //   (e.g. "LAND - LS388" → "LS388").
            const brandRaw = String(item.make || "").toUpperCase();
            const modelRaw = String(item.minor_name || "");
            const model = modelRaw.replace(/^[A-Z]+\s*-\s*/, "");
            // Speed + load are concatenated in invent_lrsr (e.g. "95H").
            const lrsr = String(item.invent_lrsr || "");
            const loadIdx = lrsr.match(/^\d+/)?.[0] || "";
            const speedRating = lrsr.replace(/^\d+/, "");
            const onHand = typeof item.on_hand === "number" ? item.on_hand : 0;
            return [{
              id: `gw-${idx}-${item.dk_part_number || sizeClean}`,
              name: String(item.display_name || `${brandRaw} ${model}`).trim(),
              brand: brandRaw,
              model,
              size: String(item.invent_size || sizeFormatted),
              category: cat as "budget" | "mid" | "premium",
              shopPrice,
              pricePerTireCents,
              warranty: "",
              features: [],
              speedRating,
              loadIndex: loadIdx,
              inStock: onHand > 0,
              estimatedDelivery: onHand > 0 ? "Same day" : "1-2 business days",
            }];
          });

          if (input.category !== "all") {
            tires = tires.filter(t => t.category === input.category);
          }

          tires.sort((a, b) => {
            switch (input.sortBy) {
              case "price-low": return a.shopPrice - b.shopPrice;
              case "price-high": return b.shopPrice - a.shopPrice;
              case "warranty": return (b.warranty || "").localeCompare(a.warranty || "");
              case "brand": return a.brand.localeCompare(b.brand);
              default: return 0;
            }
          });

          lastLiveFetchAt = new Date().toISOString();
          lastLiveFetchSuccess = true;
          const liveResult = {
            tires,
            source: "live" as const,
            serviceFee: 0,
            sizeFormatted,
            package: NICKS_PACKAGE,
            packageValue: PACKAGE_VALUE_PER_SET,
            dataFreshness: lastLiveFetchAt,
          };
          setCachedSearch(cacheKey, liveResult, "live");
          return liveResult;
        } catch (err) {
          log.error("[GatewayTire] Live tire search mapping failed, falling through to catalog:", err instanceof Error ? (err as Error).message : err);
        }
      }

      // Curated catalog fallback
      const catalog = getCuratedCatalog();
      let tires: PublicTire[] = catalog.map((item, idx) => {
        const shopPrice = Math.ceil(item.baseCost * (1 + markup / 100) * 100) / 100;
        const pricePerTireCents = Math.round(shopPrice * 100);
        const partNumber = `CAT-${sizeClean}-${item.brand.slice(0, 3)}-${item.model.replace(/\s+/g, "")}`.toUpperCase();
        const inStock = DkClient.getStockStatus(partNumber) === "in_stock";
        return {
          id: `cat-${idx}-${item.brand.toLowerCase()}`,
          name: `${item.brand} ${item.model}`,
          brand: item.brand,
          model: item.model,
          size: sizeFormatted,
          category: item.category,
          shopPrice,
          pricePerTireCents,
          warranty: item.warranty,
          features: item.features,
          speedRating: item.speedRating,
          loadIndex: item.loadIndex,
          inStock,
          estimatedDelivery: inStock ? "Same day" : "1-2 business days",
        };
      });

      if (input.category !== "all") {
        tires = tires.filter(t => t.category === input.category);
      }

      tires.sort((a, b) => {
        switch (input.sortBy) {
          case "price-low": return a.shopPrice - b.shopPrice;
          case "price-high": return b.shopPrice - a.shopPrice;
          case "warranty": return (b.warranty || "").localeCompare(a.warranty || "");
          case "brand": return a.brand.localeCompare(b.brand);
          default: return 0;
        }
      });

      const catalogResult = {
        tires,
        source: "catalog" as const,
        serviceFee: 0,
        sizeFormatted,
        package: NICKS_PACKAGE,
        packageValue: PACKAGE_VALUE_PER_SET,
        dataFreshness: null as string | null,
      };
      setCachedSearch(cacheKey, catalogResult, "catalog");
      return catalogResult;
    }),

  // ─── PUBLIC: Place a tire order ────────────────────
  placeOrder: publicProcedure
    .input(z.object({
      customerName: z.string().min(1).max(255),
      customerPhone: z.string().min(7).max(30),
      customerEmail: z.string().email().optional(),
      vehicleInfo: z.string().max(255).optional(),
      tireBrand: z.string().min(1),
      tireModel: z.string().min(1),
      tireSize: z.string().min(3),
      quantity: z.number().int().min(1).max(20).default(4),
      pricePerTireCents: z.number().int().min(0),
      customerNotes: z.string().max(1000).optional(),
      installPreference: z.enum(["walk-in", "drop-off-morning", "drop-off-afternoon", "ship"]).default("walk-in"),
      // attribution-holds migration 0067 — optional UTM context so tire
      // ORDERS (the money path) attribute to channel/campaign/page.
      utmSource: z.string().max(100).nullish(),
      utmMedium: z.string().max(100).nullish(),
      utmCampaign: z.string().max(255).nullish(),
      landingPage: z.string().max(500).nullish(),
      referrer: z.string().max(500).nullish(),
      // journey-join migration 0068 - localStorage visitor id
      sessionId: z.string().max(64).nullish(),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) return { success: false, error: "Service unavailable" };

      // Idempotency check — prevent duplicate orders within 5 minutes.
      // L1: in-memory map (fast, this instance only).
      const idemKey = getIdempotencyKey(input);
      const existingOrder = checkDuplicateOrder(idemKey);
      if (existingOrder) {
        console.info(`[tireorder:dedup] Duplicate blocked — existing order ${existingOrder}`);
        return { success: true, orderNumber: existingOrder, totalAmount: 0, duplicate: true };
      }

      // L2: durable DB check — the map dies on every redeploy, so the
      // same customer + exact tire + qty inside the window is treated as
      // the same submission retried (double-tap, page refresh, redeploy
      // mid-flow). Cancelled orders don't block a genuine re-order.
      // Fail-open on query error: a dedup outage must not block sales.
      try {
        const windowStart = new Date(Date.now() - IDEMPOTENCY_WINDOW);
        const [recent] = await d.select({
          orderNumber: tireOrders.orderNumber,
          totalAmount: tireOrders.totalAmount,
        })
          .from(tireOrders)
          .where(and(
            eq(tireOrders.customerPhone, input.customerPhone),
            eq(tireOrders.tireBrand, input.tireBrand),
            eq(tireOrders.tireModel, input.tireModel),
            eq(tireOrders.tireSize, input.tireSize),
            eq(tireOrders.quantity, input.quantity),
            sql`${tireOrders.createdAt} >= ${windowStart}`,
            sql`${tireOrders.status} <> 'cancelled'`,
          ))
          .orderBy(desc(tireOrders.createdAt))
          .limit(1);
        if (recent) {
          console.info(`[tireorder:dedup-db] Duplicate blocked — existing order ${recent.orderNumber}`);
          return { success: true, orderNumber: recent.orderNumber, totalAmount: recent.totalAmount / 100, duplicate: true };
        }
      } catch (e) {
        log.warn("[tireorder:dedup-db] durable dedup check failed — continuing:", e instanceof Error ? e.message : e);
      }

      // wave-fix-2026-05-25 (audit #151) · server-side price re-derivation.
      // SECURITY · without this, a malicious customer can manipulate the
      // tRPC payload to send `pricePerTireCents: 100` for a $200 tire
      // and Stripe charges $1. The only previous guard was
      // `z.number().int().min(0)` which allowed any non-negative integer.
      //
      // Strategy · re-derive the EXPECTED minimum price from the same
      // markup formula publicSearch uses (cost × (1 + markup/100), ceil to
      // cents). Reject if client-sent price is more than 5% below expected
      // (allow legit sale prices + small rounding drift).
      //
      // Fail-safe · if we can't derive expected (Gateway down + cache cold),
      // fall back to an ABSOLUTE floor of $50 — anything below that is the
      // pay-a-penny exploit class. Real Nick's tires retail $80+ even
      // budget tier, so $50 is a safe floor that blocks attacks without
      // false-rejecting legitimate orders during outages.
      const markup = await getTireMarkup();
      const sizeCleanForLookup = input.tireSize.replace(/[\/Rr\s-]/g, "");
      let expectedPriceCents: number | null = null;

      // Try cache first (populated by daily cron, no live Gateway hit)
      try {
        const { getCachedPrices } = await import("../services/dataPipelines");
        const cached = getCachedPrices(sizeCleanForLookup);
        if (cached) {
          const inputBrandUpper = input.tireBrand.toUpperCase();
          const inputModelUpper = input.tireModel.toUpperCase().replace(/^[A-Z]+\s*-\s*/, "");
          const match = cached.find(t =>
            t.brand.toUpperCase() === inputBrandUpper &&
            t.model.toUpperCase().includes(inputModelUpper)
          );
          if (match && match.wholesaleCost > 0) {
            const shopPrice = Math.ceil(match.wholesaleCost * (1 + markup / 100) * 100) / 100;
            expectedPriceCents = Math.round(shopPrice * 100);
          }
        }
      } catch (e) {
        log.warn("[placeOrder:price-derive] cache lookup failed:", e instanceof Error ? e.message : e);
      }

      // Fall through to live Gateway if cache missed
      if (expectedPriceCents === null) {
        try {
          const sizeFormattedForLookup = sizeCleanForLookup.length >= 7
            ? `${sizeCleanForLookup.slice(0, 3)}/${sizeCleanForLookup.slice(3, 5)}R${sizeCleanForLookup.slice(5)}`
            : input.tireSize;
          const rawTires = await gatewaySearchTires(sizeFormattedForLookup);
          if (rawTires) {
            const inputBrandUpper = input.tireBrand.toUpperCase();
            const inputModelUpper = input.tireModel.toUpperCase();
            const match = rawTires.find(item =>
              String(item.make || "").toUpperCase() === inputBrandUpper &&
              String(item.minor_name || "").toUpperCase().includes(inputModelUpper)
            );
            if (match) {
              const cost = pickWholesaleCost(match);
              if (cost > 0) {
                const shopPrice = Math.ceil(cost * (1 + markup / 100) * 100) / 100;
                expectedPriceCents = Math.round(shopPrice * 100);
              }
            }
          }
        } catch (e) {
          log.warn("[placeOrder:price-derive] live Gateway lookup failed:", e instanceof Error ? e.message : e);
        }
      }

      // Verdict logic is pure + unit-tested in ../lib/tire-order-guards.
      const verdict = evaluateOrderPrice(input.pricePerTireCents, expectedPriceCents);
      if (!verdict.ok) {
        if (verdict.reason === "below-expected") {
          // Tight floor · 5% below expected = reject (catches manipulated prices)
          log.error(`[placeOrder:price-mismatch] BLOCKED · client=${input.pricePerTireCents}¢ expected=${expectedPriceCents}¢ tire=${input.tireBrand}/${input.tireModel}/${input.tireSize}`);
          return { success: false, error: "Price has changed. Please refresh and try again." };
        }
        // Loose absolute floor · $50 blocks the pay-a-penny class without
        // false-rejecting during Gateway outages
        log.error(`[placeOrder:price-floor] BLOCKED · client=${input.pricePerTireCents}¢ < $50 absolute floor · tire=${input.tireBrand}/${input.tireModel}/${input.tireSize}`);
        return { success: false, error: "Invalid price. Please refresh and try again." };
      }
      if (verdict.basis === "floor") {
        log.warn(`[placeOrder:price-derive] could not derive price for ${input.tireBrand} ${input.tireModel} ${input.tireSize} · proceeding with $50 absolute floor only`);
      }

      // No service fee — everything included in tire price
      const serviceFeePerTire = 0;
      const totalAmount = input.pricePerTireCents * input.quantity;

      // Insert the tire order. TO-YYYYMMDD-NNN has only ~900 suffixes per
      // day, so a busy day WILL collide with the orderNumber UNIQUE key —
      // regenerate and retry instead of failing the customer. recordOrder
      // runs only AFTER a successful insert: the old order (record first,
      // insert second) poisoned the idempotency map when the insert threw,
      // making the customer's retry return success for a phantom order.
      let orderNumber = generateOrderNumber();
      let inserted = false;
      for (let attempt = 1; attempt <= 3 && !inserted; attempt++) {
        try {
          await d.insert(tireOrders).values({
            orderNumber,
            customerName: input.customerName,
            customerPhone: input.customerPhone,
            customerEmail: input.customerEmail || null,
            vehicleInfo: input.vehicleInfo || null,
            tireBrand: input.tireBrand,
            tireModel: input.tireModel,
            tireSize: input.tireSize,
            quantity: input.quantity,
            pricePerTire: input.pricePerTireCents,
            serviceFeePerTire,
            totalAmount,
            status: "received",
            customerNotes: input.customerNotes || null,
            // When the $50 floor was the only price guard (Gateway down +
            // cache cold), flag the order so staff verify the price before
            // fulfilling — a fabricated brand/model also lands here.
            adminNotes: verdict.basis === "floor"
              ? "PRICE UNVERIFIED at placement (Gateway + cache unavailable) — verify price before fulfilling."
              : null,
            // attribution-holds migration 0067 — nullable; blank when untagged
            utmSource: input.utmSource || null,
            utmMedium: input.utmMedium || null,
            utmCampaign: input.utmCampaign || null,
            landingPage: input.landingPage || null,
            referrer: input.referrer || null,
            sessionId: input.sessionId || null,
          });
          inserted = true;
        } catch (err) {
          if (isDuplicateKeyError(err) && attempt < 3) {
            log.warn(`[placeOrder] order number collision on ${orderNumber} (attempt ${attempt}) — regenerating`);
            orderNumber = generateOrderNumber();
            continue;
          }
          throw err;
        }
      }
      recordOrder(idemKey, orderNumber);

      // Map install preference to booking time
      const timeMap: Record<string, string> = {
        "walk-in": "no-preference",
        "drop-off-morning": "morning",
        "drop-off-afternoon": "afternoon",
        "ship": "no-preference",
      };

      // Generate ref code for installation tracking (same pattern as booking.ts)
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      let refCode = "NT-";
      for (let i = 0; i < 6; i++) refCode += chars[Math.floor(Math.random() * chars.length)];

      // Also create a booking for installation tracking
      await d.insert(bookings).values({
        name: input.customerName,
        phone: input.customerPhone,
        email: input.customerEmail || null,
        service: "Tire Order & Installation",
        vehicle: input.vehicleInfo || "Not specified",
        referenceCode: refCode,
        message: `ONLINE TIRE ORDER ${orderNumber}\n${input.quantity}x ${input.tireBrand} ${input.tireModel} (${input.tireSize})\nInstall: ${input.installPreference.replace("-", " ")}\nNick's Premium Installation Package: INCLUDED\nTotal: $${(totalAmount / 100).toFixed(2)}${input.customerNotes ? `\nNotes: ${input.customerNotes}` : ""}`,
        preferredTime: (timeMap[input.installPreference] || "no-preference") as "morning" | "afternoon" | "no-preference",
        stage: "received",
      });

      const pricePerTire = input.pricePerTireCents / 100;
      const totalDollars = totalAmount / 100;

      // Create invoice IMMEDIATELY — invoice = job is real, customer owes
      let invoiceNumber = "";
      try {
        invoiceNumber = await getNextInvoiceNumber();
        let laborRate = 115;
        try {
          const [setting] = await d.select().from(shopSettings).where(eq(shopSettings.key, "laborRate")).limit(1);
          if (setting) laborRate = parseFloat(setting.value);
        } catch (e) { log.warn("[gatewayTire:placeOrder] labor rate fetch failed, using default $115:", e); }

        // Install is FREE — the value is baked into the tire price (100%
        // markup), so the invoice carries no labor charge. Total = tires
        // + 8% Ohio sales tax. On payment, finalizeTireOrderPayment bumps
        // the invoice total to the exact amount Stripe collected (which
        // also includes the 2% card fee), so the invoice always matches
        // the cash actually taken.
        const installHours = 0.7; // mount + balance — recorded, billed at $0
        const laborCostCents = 0;
        const partsCostCents = totalAmount; // tires are "parts"
        const taxRate = 0.08;
        const taxAmountCents = Math.round(partsCostCents * taxRate);
        const grandTotalCents = laborCostCents + partsCostCents + taxAmountCents;

        await createInvoice({
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          invoiceNumber,
          totalAmount: grandTotalCents,
          partsCost: partsCostCents,
          laborCost: laborCostCents,
          taxAmount: taxAmountCents,
          serviceDescription: `Tire Order & Install — ${input.quantity}x ${input.tireBrand} ${input.tireModel} (${input.tireSize})\nOrder: ${orderNumber}`,
          vehicleInfo: input.vehicleInfo || null,
          paymentMethod: "other",
          paymentStatus: "pending",
          source: "manual",
          invoiceDate: new Date(),
        });

        // Unified event bus
        import("../services/eventBus").then(({ emit }) =>
          emit.invoiceCreated({
            invoiceNumber,
            customerName: input.customerName,
            totalAmount: grandTotalCents / 100,
            source: "tire_order",
          })
        ).catch(e => log.warn("[gatewayTire:placeOrder] event bus invoice dispatch failed:", e));

        // Sync invoice to Sheets
        syncInvoiceToSheet({
          invoiceNumber,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          vehicleInfo: input.vehicleInfo,
          serviceDescription: `Tire Install: ${input.quantity}x ${input.tireBrand} ${input.tireModel}`,
          laborHours: installHours,
          laborRate,
          laborCost: laborCostCents / 100,
          partsCost: partsCostCents / 100,
          taxAmount: taxAmountCents / 100,
          totalAmount: grandTotalCents / 100,
          paymentMethod: "other",
          paymentStatus: "pending",
          source: "tire_order",
          orderRef: orderNumber,
          notes: `Auto-created with tire order ${orderNumber}`,
        }).catch(err => log.error("[TireOrder] Invoice sheet sync error:", err));

        console.info(`[invoice:created] ${invoiceNumber} for tire order ${orderNumber} — $${(grandTotalCents / 100).toFixed(2)} (pending payment)`);

        // Link the invoice to the tire order so the admin + the online
        // payment flow (createCheckout) can resolve it later.
        await d.update(tireOrders).set({ invoiceNumber }).where(eq(tireOrders.orderNumber, orderNumber));
      } catch (err) {
        log.error("[TireOrder] Invoice creation failed:", err instanceof Error ? (err as Error).message : err);
      }

      // Sync to Google Sheets (async, don't block — a Sheets failure
      // must never erase the DB order; the DB row is the source of truth)
      syncTireOrderToSheet({
        orderNumber,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        customerEmail: input.customerEmail || null,
        vehicleInfo: input.vehicleInfo || null,
        tireBrand: input.tireBrand,
        tireModel: input.tireModel,
        tireSize: input.tireSize,
        quantity: input.quantity,
        pricePerTire,
        totalAmount: totalDollars,
        customerNotes: input.customerNotes || null,
        status: "received",
        paymentStatus: "unpaid",
        utmSource: input.utmSource,
        utmMedium: input.utmMedium,
        utmCampaign: input.utmCampaign,
        landingPage: input.landingPage,
        referrer: input.referrer,
      }).catch(err => log.error("[TireOrder] Sheet sync error:", err));

      // Send email notification to shop + CEO (async, don't block)
      notifyTireOrder({
        orderNumber,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        customerEmail: input.customerEmail || undefined,
        vehicleInfo: input.vehicleInfo || undefined,
        tireBrand: input.tireBrand,
        tireModel: input.tireModel,
        tireSize: input.tireSize,
        quantity: input.quantity,
        pricePerTire,
        totalAmount: totalDollars,
        notes: input.customerNotes || undefined,
      }).catch(err => log.error("[TireOrder] Notification error:", err));

      // Push to Auto Labor Guide (ShopDriver) — async, don't block
      import("../services/shopDriverSync").then(({ pushTireOrder }) =>
        pushTireOrder({
          orderNumber,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          vehicleInfo: input.vehicleInfo || null,
          tireBrand: input.tireBrand,
          tireModel: input.tireModel,
          tireSize: input.tireSize,
          quantity: input.quantity,
          totalAmount: totalDollars,
          installPreference: input.installPreference,
        })
      ).catch(e => log.warn("[gatewayTire:placeOrder] ShopDriver sync failed:", e));

      // Computed here (not just in the uncommon-size block below) so the
      // event payload can tell Telegram whether the richer uncommon-size
      // alert is coming — avoids double-alerting the same order.
      const normalizedSize = input.tireSize.replace(/[^0-9]/g, "");
      const isCommonSize = POPULAR_SIZES.includes(normalizedSize);

      // Unified event bus (→ NOUR OS + ShopDriver + Telegram + learning)
      import("../services/eventBus").then(({ emit }) =>
        emit.tireOrderPlaced({
          orderNumber,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          tireBrand: input.tireBrand,
          tireModel: input.tireModel,
          tireSize: input.tireSize,
          quantity: input.quantity,
          totalAmount: totalDollars,
          uncommonSize: !isCommonSize,
        })
      ).catch(e => log.warn("[gatewayTire:placeOrder] event bus tire order dispatch failed:", e));

      // ─── Smart uncommon-size detection ────────────────
      // If the tire size isn't one we commonly stock, flag it for Gateway
      // ordering (isCommonSize computed above, before the event emit)
      if (!isCommonSize) {
        import("../services/telegram").then(({ sendTelegram }) =>
          sendTelegram(
            `⚠️ UNCOMMON TIRE SIZE — Auto-order from Gateway\n\n` +
            `Order: ${orderNumber}\n` +
            `Size: ${input.tireSize} (NOT in common stock)\n` +
            `Tire: ${input.quantity}x ${input.tireBrand} ${input.tireModel}\n` +
            `Customer: ${input.customerName} | ${input.customerPhone}\n\n` +
            `🔧 This size needs to be ordered from Gateway Tire (b2b.dktire.com).\n` +
            `Log in → search "${input.tireSize}" → place order → update status to "ordered".`
          )
        ).catch(e => log.warn("[gatewayTire:placeOrder] uncommon size telegram alert failed:", e));

        // Also email the shop
        notifyTireOrder({
          orderNumber,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          customerEmail: input.customerEmail || undefined,
          vehicleInfo: input.vehicleInfo || undefined,
          tireBrand: input.tireBrand,
          tireModel: input.tireModel,
          tireSize: input.tireSize,
          quantity: input.quantity,
          pricePerTire,
          totalAmount: totalDollars,
          notes: `⚠️ UNCOMMON SIZE — ${input.tireSize} is NOT in regular stock. Order from Gateway Tire immediately.`,
        }).catch(e => log.warn("[gatewayTire:placeOrder] uncommon size email notification failed:", e));
      }

      return {
        success: true,
        orderNumber,
        invoiceNumber: invoiceNumber || undefined,
        totalAmount: totalDollars,
        uncommonSize: !isCommonSize,
      };
    }),

  // ─── PUBLIC: Start online payment (Stripe Checkout) ─
  // Customer pays the exact tire total they saw on the order page.
  // Returns a Stripe-hosted checkout URL — the client redirects to it.
  // Card data is entered on Stripe's page and never touches our server.
  createCheckout: publicProcedure
    .input(z.object({
      orderNumber: z.string().min(1),
      phone: z.string().min(7),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) return { error: "Service unavailable" };

      // Verify the order exists and belongs to this caller's phone.
      const [order] = await d.select()
        .from(tireOrders)
        .where(and(
          eq(tireOrders.orderNumber, input.orderNumber),
          eq(tireOrders.customerPhone, input.phone),
        ))
        .limit(1);

      if (!order) return { error: "Order not found. Check your order number and phone." };
      if (order.paymentStatus === "paid") return { error: "This order is already paid." };
      if (order.status === "cancelled") return { error: "This order was cancelled — call (216) 862-0005." };
      if (!order.totalAmount || order.totalAmount < 50) {
        return { error: "Order total unavailable — please call (216) 862-0005." };
      }

      const { createTireOrderCheckout, getCheckoutSessionStatus } = await import("../services/payments");

      // Reuse an existing still-open Stripe session — a double-click on
      // "Pay Now" otherwise spawns two payable sessions. Still lets a
      // customer who abandoned checkout come back and retry.
      if (order.stripeSessionId) {
        const existing = await getCheckoutSessionStatus(order.stripeSessionId);
        if (existing.status === "open" && existing.url) return { url: existing.url };
      }

      const base = process.env.VITE_SITE_URL || "https://nickstire.org";

      // Customer pays the tire total + 8% Ohio sales tax + a 2% card-
      // processing surcharge — each an itemised Stripe line item.
      const subtotal = order.totalAmount;                      // cents
      const tax = Math.round(subtotal * 0.08);
      const cardFee = Math.round((subtotal + tax) * 0.02);
      const tireLabel = `${order.quantity}x ${order.tireBrand} ${order.tireModel} (${order.tireSize}) — installed free`;

      const result = await createTireOrderCheckout({
        lineItems: [
          { name: tireLabel, amountCents: subtotal },
          { name: "Ohio sales tax (8%)", amountCents: tax },
          { name: "Card processing fee (2%)", amountCents: cardFee },
        ],
        tireOrderNumber: order.orderNumber,
        invoiceNumber: order.invoiceNumber || "",
        customerName: order.customerName,
        customerEmail: order.customerEmail || undefined,
        description: `Nick's Tire & Auto — order ${order.orderNumber}`,
        successUrl: `${base}/tires?order=${encodeURIComponent(order.orderNumber)}&paid=1`,
        cancelUrl: `${base}/tires?order=${encodeURIComponent(order.orderNumber)}&paid=0`,
      });

      if ("error" in result) return { error: result.error };

      // Record the session id for audit + idempotency (best-effort).
      await d.update(tireOrders)
        .set({ stripeSessionId: result.sessionId })
        .where(eq(tireOrders.orderNumber, order.orderNumber));

      return { url: result.url };
    }),

  // ─── PUBLIC: Confirm checkout on return (webhook fallback) ──
  // Called when the customer lands back on /tires?paid=1. Verifies the
  // Stripe Checkout Session directly and finalises the order — so a paid
  // order is never left "unpaid" if the webhook is slow or misconfigured.
  // Safe: only finalises when Stripe itself reports the session paid.
  confirmCheckout: publicProcedure
    .input(z.object({ orderNumber: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) return { ok: false };

      const [order] = await d.select()
        .from(tireOrders)
        .where(eq(tireOrders.orderNumber, input.orderNumber))
        .limit(1);

      if (!order) return { ok: false };
      if (order.paymentStatus === "paid") return { ok: true, alreadyPaid: true };
      if (!order.stripeSessionId) return { ok: false };

      const { getCheckoutSessionStatus, finalizeTireOrderPayment } = await import("../services/payments");
      const status = await getCheckoutSessionStatus(order.stripeSessionId);
      if (!status.paid) return { ok: false };

      await finalizeTireOrderPayment({
        tireOrderNumber: order.orderNumber,
        invoiceNumber: order.invoiceNumber || undefined,
        amountCents: status.amountTotalCents,
      });
      return { ok: true };
    }),

  // ─── PUBLIC: Check order status ────────────────────
  checkOrder: publicProcedure
    .input(z.object({
      orderNumber: z.string().min(1),
      phone: z.string().min(7),
    }))
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return null;

      const results = await d.select({
        orderNumber: tireOrders.orderNumber,
        status: tireOrders.status,
        tireBrand: tireOrders.tireBrand,
        tireModel: tireOrders.tireModel,
        tireSize: tireOrders.tireSize,
        quantity: tireOrders.quantity,
        totalAmount: tireOrders.totalAmount,
        paymentStatus: tireOrders.paymentStatus,
        paidAt: tireOrders.paidAt,
        expectedDelivery: tireOrders.expectedDelivery,
        installationDate: tireOrders.installationDate,
        createdAt: tireOrders.createdAt,
      })
        .from(tireOrders)
        .where(and(
          eq(tireOrders.orderNumber, input.orderNumber),
          eq(tireOrders.customerPhone, input.phone),
        ))
        .limit(1);

      if (results.length === 0) return null;

      const order = results[0];
      return {
        ...order,
        totalAmount: order.totalAmount / 100,
        statusLabel: getStatusLabel(order.status),
        statusColor: getStatusColor(order.status),
      };
    }),

  // ─── PUBLIC: Popular sizes ─────────────────────────
  popularSizes: publicProcedure.query(() => ({
    sizes: POPULAR_SIZES.map(s => ({
      raw: s,
      formatted: `${s.slice(0, 3)}/${s.slice(3, 5)}R${s.slice(5)}`,
    })),
    brands: TIRE_BRANDS,
  })),

  // ─── PUBLIC: Honest social proof for /tires page ───
  // 2026-05-23 · returns the last-7-days tire-order count + most-
  // popular size so the customer page can show real, fact-anchored
  // social proof above the tire list. Anything older than 7 days is
  // pruned to keep the signal current. Floors at 0 (empty DB ok).
  //
  // No PII surfaced — just aggregate counts + the size string.
  publicStats: publicProcedure.query(async () => {
    const d = await db();
    if (!d) return { ordersThisWeek: 0, installedThisWeek: 0, popularSize: null as string | null };
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    try {
      const [orderCount, installCount, sizeRow] = await Promise.all([
        d.select({ c: sql<number>`count(*)` })
          .from(tireOrders)
          .where(sql`${tireOrders.createdAt} >= ${sevenDaysAgo}`),
        d.select({ c: sql<number>`count(*)` })
          .from(tireOrders)
          .where(sql`${tireOrders.status} IN ('installed', 'completed') AND ${tireOrders.createdAt} >= ${sevenDaysAgo}`),
        d.select({ size: tireOrders.tireSize, c: sql<number>`count(*)` })
          .from(tireOrders)
          .where(sql`${tireOrders.createdAt} >= ${sevenDaysAgo}`)
          .groupBy(tireOrders.tireSize)
          .orderBy(sql`count(*) desc`)
          .limit(1),
      ]);
      return {
        ordersThisWeek: Number(orderCount[0]?.c || 0),
        installedThisWeek: Number(installCount[0]?.c || 0),
        popularSize: sizeRow[0]?.size || null,
      };
    } catch (err) {
      log.warn("[gatewayTire:publicStats] aggregate failed, returning zeros:", err instanceof Error ? err.message : err);
      return { ordersThisWeek: 0, installedThisWeek: 0, popularSize: null as string | null };
    }
  }),

  // ═══════════════════════════════════════════════════
  // ADMIN ENDPOINTS
  // ═══════════════════════════════════════════════════

  listOrders: adminProcedure
    .input(z.object({
      status: z.string().optional(),
      search: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return { orders: [], total: 0 };

      const conditions = [];
      if (input?.status && input.status !== "all") {
        conditions.push(eq(tireOrders.status, input.status as any));
      }
      if (input?.search) {
        conditions.push(
          sql`(${tireOrders.customerName} LIKE ${`%${input.search}%`} OR ${tireOrders.orderNumber} LIKE ${`%${input.search}%`} OR ${tireOrders.customerPhone} LIKE ${`%${input.search}%`})`
        );
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [orders, countResult] = await Promise.all([
        d.select()
          .from(tireOrders)
          .where(whereClause)
          .orderBy(desc(tireOrders.createdAt))
          .limit(input?.limit || 50)
          .offset(input?.offset || 0),
        d.select({ count: sql<number>`count(*)` })
          .from(tireOrders)
          .where(whereClause),
      ]);

      return {
        orders: orders.map((o: any) => ({
          ...o,
          pricePerTire: o.pricePerTire / 100,
          serviceFeePerTire: o.serviceFeePerTire / 100,
          totalAmount: o.totalAmount / 100,
          statusLabel: getStatusLabel(o.status),
          statusColor: getStatusColor(o.status),
        })),
        total: Number(countResult[0]?.count || 0),
      };
    }),

  getOrder: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return null;

      const results = await d.select().from(tireOrders).where(eq(tireOrders.id, input.id)).limit(1);
      if (results.length === 0) return null;

      const o = results[0];
      return {
        ...o,
        pricePerTire: o.pricePerTire / 100,
        serviceFeePerTire: o.serviceFeePerTire / 100,
        totalAmount: o.totalAmount / 100,
        statusLabel: getStatusLabel(o.status),
        statusColor: getStatusColor(o.status),
      };
    }),

  updateOrder: adminProcedure
    .input(z.object({
      id: z.number().int(),
      status: z.enum(["received", "confirmed", "ordered", "in_transit", "delivered", "scheduled", "installed", "cancelled"]).optional(),
      adminNotes: z.string().optional(),
      gatewayOrderRef: z.string().optional(),
      expectedDelivery: z.string().optional(),
      installationDate: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) return { success: false };

      // Get current order for notifications
      const [currentOrder] = await d.select().from(tireOrders).where(eq(tireOrders.id, input.id)).limit(1);
      if (!currentOrder) return { success: false };

      const updates: Record<string, any> = {};
      if (input.status) updates.status = input.status;
      if (input.adminNotes !== undefined) updates.adminNotes = input.adminNotes;
      if (input.gatewayOrderRef !== undefined) updates.gatewayOrderRef = input.gatewayOrderRef;
      if (input.expectedDelivery) updates.expectedDelivery = new Date(input.expectedDelivery);
      if (input.installationDate) updates.installationDate = new Date(input.installationDate);

      if (Object.keys(updates).length === 0) return { success: false };

      await d.update(tireOrders).set(updates).where(eq(tireOrders.id, input.id));

      // NOTE: Invoice is already created at order placement time (in placeOrder mutation).
      // Do NOT auto-create another invoice here — that would be a double invoice.

      // ─── Status change notifications ─────────────────
      if (input.status && input.status !== currentOrder.status) {
        const orderDesc = `${currentOrder.quantity}x ${currentOrder.tireBrand} ${currentOrder.tireModel} (${currentOrder.tireSize})`;

        // DELIVERED → Email shop + Telegram: tires arrived, ready to schedule
        if (input.status === "delivered") {
          notifyTireOrder({
            orderNumber: currentOrder.orderNumber,
            customerName: currentOrder.customerName,
            customerPhone: currentOrder.customerPhone,
            customerEmail: currentOrder.customerEmail || undefined,
            vehicleInfo: currentOrder.vehicleInfo || undefined,
            tireBrand: currentOrder.tireBrand,
            tireModel: currentOrder.tireModel,
            tireSize: currentOrder.tireSize,
            quantity: currentOrder.quantity,
            pricePerTire: (currentOrder.pricePerTire || 0) / 100,
            totalAmount: (currentOrder.totalAmount || 0) / 100,
            notes: `✅ TIRES DELIVERED — Ready for installation. Call customer to schedule.`,
          }).catch(e => log.warn("[gatewayTire:updateOrder] delivery email notification failed:", e));

          import("../services/telegram").then(({ sendTelegram }) =>
            sendTelegram(
              `📦 TIRES ARRIVED — ${currentOrder.orderNumber}\n\n` +
              `${orderDesc}\n` +
              `Customer: ${currentOrder.customerName} | ${currentOrder.customerPhone}\n` +
              `Vehicle: ${currentOrder.vehicleInfo || "N/A"}\n\n` +
              `⚡ Call customer to schedule installation NOW`
            )
          ).catch(e => log.warn("[gatewayTire:updateOrder] delivery telegram alert failed:", e));
        }

        // IN_TRANSIT → Telegram heads-up
        if (input.status === "in_transit") {
          import("../services/telegram").then(({ sendTelegram }) =>
            sendTelegram(
              `🚚 TIRES SHIPPING — ${currentOrder.orderNumber}\n` +
              `${orderDesc}\n` +
              `Customer: ${currentOrder.customerName}\n` +
              (input.expectedDelivery ? `ETA: ${input.expectedDelivery}` : "")
            )
          ).catch(e => log.warn("[gatewayTire:updateOrder] in-transit telegram alert failed:", e));
        }

        // INSTALLED → Telegram confirmation
        if (input.status === "installed") {
          import("../services/telegram").then(({ sendTelegram }) =>
            sendTelegram(
              `✅ INSTALLED — ${currentOrder.orderNumber}\n` +
              `${orderDesc}\n` +
              `Customer: ${currentOrder.customerName} | $${((currentOrder.totalAmount || 0) / 100).toFixed(2)}`
            )
          ).catch(e => log.warn("[gatewayTire:updateOrder] installed telegram alert failed:", e));
        }

        // CANCELLED → Telegram alert. buildCancellationAlert appends a
        // loud REFUND REQUIRED block when the customer already paid
        // online — Stripe has their money and nothing else in the
        // system surfaces that a refund is owed.
        if (input.status === "cancelled") {
          if (currentOrder.paymentStatus === "paid") {
            log.error(`[gatewayTire:updateOrder] PAID order ${currentOrder.orderNumber} cancelled — refund of $${((currentOrder.totalAmount || 0) / 100).toFixed(2)} REQUIRED via Stripe dashboard`);
          }
          import("../services/telegram").then(({ sendTelegram }) =>
            sendTelegram(buildCancellationAlert({
              orderNumber: currentOrder.orderNumber,
              customerName: currentOrder.customerName,
              customerPhone: currentOrder.customerPhone,
              quantity: currentOrder.quantity,
              tireBrand: currentOrder.tireBrand,
              tireModel: currentOrder.tireModel,
              tireSize: currentOrder.tireSize,
              totalAmount: currentOrder.totalAmount || 0,
              paymentStatus: currentOrder.paymentStatus,
              stripeSessionId: currentOrder.stripeSessionId,
            }, input.adminNotes))
          ).catch(e => log.warn("[gatewayTire:updateOrder] cancelled telegram alert failed:", e));
        }
      }

      return { success: true };
    }),

  orderStats: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return { total: 0, received: 0, confirmed: 0, ordered: 0, inTransit: 0, delivered: 0, scheduled: 0, installed: 0, cancelled: 0, totalRevenue: 0 };

    const stats = await d.select({
      status: tireOrders.status,
      count: sql<number>`count(*)`,
      revenue: sql<number>`sum(${tireOrders.totalAmount})`,
    })
      .from(tireOrders)
      .groupBy(tireOrders.status);

    const result: Record<string, number> = {};
    let totalRevenue = 0;
    let total = 0;

    for (const row of stats) {
      const key = row.status.replace("_", "");
      result[key] = Number(row.count);
      total += Number(row.count);
      if (row.status !== "cancelled") {
        totalRevenue += Number(row.revenue || 0);
      }
    }

    return {
      total,
      received: result["received"] || 0,
      confirmed: result["confirmed"] || 0,
      ordered: result["ordered"] || 0,
      inTransit: result["intransit"] || 0,
      delivered: result["delivered"] || 0,
      scheduled: result["scheduled"] || 0,
      installed: result["installed"] || 0,
      cancelled: result["cancelled"] || 0,
      totalRevenue: totalRevenue / 100,
    };
  }),

  /**
   * Cancellation money risks for the admin Tire Orders tab.
   * 2026-06-10 checkout-protection wave — two states nothing else
   * watches continuously:
   *   refundNeeded   — cancelled but PAID: Stripe holds the customer's
   *                    money and only a manual dashboard refund returns
   *                    it (no refund API exists in this codebase).
   *   staleSessions  — cancelled, unpaid, but a Stripe Checkout session
   *                    was issued: the hosted page stays payable ~24h,
   *                    so a customer can still pay for a cancelled order
   *                    (createCheckout blocks NEW sessions only). Expire
   *                    it in the Stripe dashboard to close the hole.
   */
  cancellationRisks: adminProcedure.query(async () => {
    type RiskRow = {
      id: number;
      orderNumber: string;
      customerName: string;
      customerPhone: string;
      totalAmount: number;
      paymentStatus: string;
      stripeSessionId: string | null;
      updatedAt: Date;
    };
    const d = await db();
    if (!d) return { refundNeeded: [] as RiskRow[], staleSessions: [] as RiskRow[] };
    const rows = await d.select({
      id: tireOrders.id,
      orderNumber: tireOrders.orderNumber,
      customerName: tireOrders.customerName,
      customerPhone: tireOrders.customerPhone,
      totalAmount: tireOrders.totalAmount,
      paymentStatus: tireOrders.paymentStatus,
      stripeSessionId: tireOrders.stripeSessionId,
      updatedAt: tireOrders.updatedAt,
    })
      .from(tireOrders)
      .where(and(
        eq(tireOrders.status, "cancelled"),
        sql`(${tireOrders.paymentStatus} = 'paid' OR ${tireOrders.stripeSessionId} IS NOT NULL)`,
      ))
      .orderBy(desc(tireOrders.updatedAt))
      .limit(25) as RiskRow[];
    const refundNeeded = rows
      .filter((r: RiskRow) => r.paymentStatus === "paid")
      .map((r: RiskRow) => ({ ...r, totalAmount: r.totalAmount / 100 }));
    const staleSessions = rows
      .filter((r: RiskRow) => r.paymentStatus !== "paid" && !!r.stripeSessionId)
      .map((r: RiskRow) => ({ ...r, totalAmount: r.totalAmount / 100 }));
    return { refundNeeded, staleSessions };
  }),

  status: adminProcedure.query(async () => {
    const username = process.env.GATEWAY_TIRE_USERNAME;
    const password = process.env.GATEWAY_TIRE_PASSWORD;

    if (!username || !password) {
      return {
        connected: false,
        error: "Gateway Tire credentials not configured",
        portal: GATEWAY_PORTAL_BASE,
        // surface the structured failure for the admin UI
        authFailure: { at: new Date().toISOString(), reason: "GATEWAY_TIRE_USERNAME / GATEWAY_TIRE_PASSWORD env vars not set", detail: "Set both env vars on Railway and redeploy." },
        lastLiveFetch: lastLiveFetchAt,
        lastLiveFetchSuccess,
        cachedSearches: searchCache.size,
      };
    }

    const { getGatewayToken } = await import("../services/gatewayClient");
    const token = await getGatewayToken();
    return {
      connected: !!token,
      portal: GATEWAY_PORTAL_BASE,
      accountId: username,
      error: token ? null : "Could not authenticate with Gateway Tire",
      // when token is null this carries the SPECIFIC failure reason
      // (env vars missing / wrong creds / network) so the operator
      // doesn't have to grep Railway logs to diagnose.
      authFailure: token ? null : getLastAuthFailure(),
      lastLiveFetch: lastLiveFetchAt,
      lastLiveFetchSuccess,
      cachedSearches: searchCache.size,
    };
  }),

  searchBySize: adminProcedure
    .input(z.object({
      sizeQuery: z.string().min(3).max(20),
      sortBy: z.enum(["price-low", "price-high", "brand", "inventory", "default"]).default("default"),
    }))
    .query(async ({ input }) => {
      const markup = await getTireMarkup();
      // sizeQuery may arrive cleaned ("21560R16") or formatted ("215/60R16");
      // the new D&K endpoint expects the formatted variant.
      const clean = input.sizeQuery.replace(/[\/Rr\s-]/g, "");
      const formatted = clean.length >= 7
        ? `${clean.slice(0, 3)}/${clean.slice(3, 5)}R${clean.slice(5)}`
        : input.sizeQuery;
      const rawTires = await gatewaySearchTires(formatted);

      if (rawTires && rawTires.length > 0) {
        try {
          const tires = rawTires.map((item) => {
            const cost = pickWholesaleCost(item);
            const pricing = Array.isArray(item.pricing_data) && item.pricing_data.length > 0
              ? (item.pricing_data[0] as Record<string, unknown>) : null;
            // D&K inverts the names: `cost_price` is the suggested RETAIL,
            // `selling_price` is the dealer cost (see pickWholesaleCost). The
            // admin "retail" column wants D&K's retail = cost_price.
            const retail = typeof pricing?.cost_price === "number" ? pricing.cost_price as number : 0;
            const shopPrice = Math.ceil(cost * (1 + markup / 100) * 100) / 100;
            const brandRaw = String(item.make || "");
            const modelRaw = String(item.minor_name || "").replace(/^[A-Z]+\s*-\s*/, "");
            const onHand = typeof item.on_hand === "number" ? item.on_hand : 0;
            const totalQty = typeof item.total_qty === "number" ? item.total_qty : 0;
            return {
              name: String(item.display_name || `${brandRaw} ${modelRaw}`).trim(),
              brand: brandRaw,
              model: modelRaw,
              size: String(item.invent_size || input.sizeQuery),
              partNumber: String(item.dk_part_number || ""),
              costPrice: cost,
              retailPrice: retail,
              shopPrice,
              margin: shopPrice - cost,
              marginPercent: cost > 0 ? ((shopPrice - cost) / shopPrice) * 100 : 0,
              localInventory: onHand,
              regionalInventory: totalQty,
            };
          });
          return { tires, source: "live" as const, markup };
        } catch (err) {
          log.error("[GatewayTire] Admin tire search mapping failed:", err instanceof Error ? (err as Error).message : err);
        }
      }

      return {
        tires: [] as any[],
        source: "portal" as const,
        markup,
        portalUrl: `${GATEWAY_PORTAL_BASE}/dashboard?search=${encodeURIComponent(input.sizeQuery)}`,
      };
    }),

  calculateMargin: adminProcedure
    .input(z.object({
      costPrice: z.number().min(0),
      quantity: z.number().int().min(1).default(1),
      customMarkup: z.number().min(0).max(300).optional(),
    }))
    .mutation(async ({ input }) => {
      const markup = input.customMarkup ?? await getTireMarkup();
      const tirePrice = Math.ceil(input.costPrice * (1 + markup / 100) * 100) / 100;
      const perTireTotal = tirePrice; // No separate service fee
      const totalRevenue = perTireTotal * input.quantity;
      const totalCost = input.costPrice * input.quantity;
      const totalProfit = totalRevenue - totalCost;

      return {
        perTire: { cost: input.costPrice, tirePrice, serviceFee: 0, total: perTireTotal },
        summary: { quantity: input.quantity, totalCost, totalRevenue, totalProfit, markupUsed: markup },
      };
    }),

  updateMarkup: adminProcedure
    .input(z.object({ markup: z.number().min(0).max(300) }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) return { success: false };

      const existing = await d.select().from(shopSettings).where(eq(shopSettings.key, "tireMarkup")).limit(1);
      if (existing.length > 0) {
        await d.update(shopSettings).set({ value: input.markup.toString(), updatedBy: "admin" }).where(eq(shopSettings.key, "tireMarkup"));
      } else {
        await d.insert(shopSettings).values({ key: "tireMarkup", value: input.markup.toString(), category: "pricing", label: "Tire Markup %", updatedBy: "admin" });
      }
      return { success: true, markup: input.markup };
    }),

  portalUrl: adminProcedure
    .input(z.object({ path: z.string().default("/"), search: z.string().optional() }).optional())
    .query(({ input }) => {
      let url = GATEWAY_PORTAL_BASE + (input?.path || "/");
      if (input?.search) url = `${GATEWAY_PORTAL_BASE}/dashboard?search=${encodeURIComponent(input.search)}`;
      return { url, accountId: process.env.GATEWAY_TIRE_USERNAME || "" };
    }),

  refundOrder: adminProcedure
    .input(
      z.object({
        orderId: z.number().int(),
        reason: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      if (!d) return { success: false, error: "Database unavailable" };

      // Look up order by id
      const [order] = await d.select().from(tireOrders)
        .where(eq(tireOrders.id, input.orderId)).limit(1);

      if (!order) {
        return { success: false, error: `Order #${input.orderId} not found` };
      }

      const actorEmail = ctx.user?.email ?? ctx.user?.name ?? "admin";

      const { refundTireOrderPayment } = await import("../services/payments");
      const res = await refundTireOrderPayment({
        orderNumber: order.orderNumber,
        reason: input.reason,
        actorEmail,
      });

      return res;
    }),
});

// ─── Status helpers ──────────────────────────────────
function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    received: "Order Received",
    confirmed: "Confirmed",
    ordered: "Ordered from Supplier",
    in_transit: "In Transit",
    delivered: "Delivered to Shop",
    scheduled: "Installation Scheduled",
    installed: "Installed",
    cancelled: "Cancelled",
  };
  return labels[status] || status;
}

function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    received: "yellow",
    confirmed: "blue",
    ordered: "indigo",
    in_transit: "purple",
    delivered: "cyan",
    scheduled: "green",
    installed: "emerald",
    cancelled: "red",
  };
  return colors[status] || "gray";
}
