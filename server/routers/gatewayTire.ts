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
import { notifyTireOrder, notifyInvoiceCreated } from "../email-notify";
import { getNextInvoiceNumber, createInvoice } from "../db";
import { syncInvoiceToSheet } from "../sheets-sync";
import { z } from "zod";
import { eq, desc, sql, and } from "drizzle-orm";
import { tireOrders, shopSettings, bookings } from "../../drizzle/schema";

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

/** Auto-create an invoice when a tire order is marked as installed */
async function autoCreateInvoiceFromTireOrder(d: ReturnType<typeof import("drizzle-orm/mysql2").drizzle>, orderId: number): Promise<void> {
  const [order] = await d.select().from(tireOrders).where(eq(tireOrders.id, orderId)).limit(1);
  if (!order) return;

  const invoiceNumber = await getNextInvoiceNumber();

  // Get labor rate from shop settings
  let laborRate = 115;
  try {
    const [setting] = await d.select().from(shopSettings).where(eq(shopSettings.key, "laborRate")).limit(1);
    if (setting) laborRate = parseFloat(setting.value);
  } catch (err) {
    console.error("[GatewayTire] Failed to fetch labor rate, using default:", err instanceof Error ? (err as Error).message : err);
  }

  // Tire installation labor: 0.7 hours for mount + balance (from Auto Labor Guide)
  const installHours = 0.7;
  const laborCost = Math.round(installHours * laborRate * 100); // cents
  const partsCost = order.totalAmount; // tire cost is the "parts" cost
  // Ohio sales tax: parts/materials only, NOT labor
  const taxRate = 0.08;
  const taxAmount = Math.round(partsCost * taxRate);
  const totalAmount = laborCost + partsCost + taxAmount;

  await createInvoice({
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    invoiceNumber,
    totalAmount,
    partsCost,
    laborCost,
    taxAmount,
    serviceDescription: `Tire Order & Installation — ${order.quantity}x ${order.tireBrand} ${order.tireModel} (${order.tireSize})`,
    vehicleInfo: order.vehicleInfo || null,
    paymentMethod: "card",
    paymentStatus: "pending",
    source: "manual",
    invoiceDate: new Date(),
  });

  // Sync to Google Sheets
  await syncInvoiceToSheet({
    invoiceNumber,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    vehicleInfo: order.vehicleInfo,
    serviceDescription: `Tire Install: ${order.quantity}x ${order.tireBrand} ${order.tireModel}`,
    laborHours: installHours,
    laborRate,
    laborCost: laborCost / 100,
    partsCost: partsCost / 100,
    taxAmount: taxAmount / 100,
    totalAmount: totalAmount / 100,
    paymentMethod: "card",
    paymentStatus: "pending",
    source: "tire_order",
    orderRef: order.orderNumber,
    notes: `Auto-generated from tire order ${order.orderNumber}`,
  });

  // Notify CEO about the auto-generated invoice
  notifyInvoiceCreated({
    invoiceNumber,
    customerName: order.customerName,
    totalAmount: totalAmount / 100,
    source: "tire_order",
    serviceDescription: `Tire Install: ${order.quantity}x ${order.tireBrand} ${order.tireModel}`,
  }).catch(e => console.warn("[gatewayTire:autoInvoice] invoice email notification failed:", e));

  // Notify admin — synced to dashboard
  import("../services/telegram").then(({ sendTelegram }) =>
    sendTelegram(
      `🧾 TIRE INVOICE — SYNCED TO ADMIN\n\n` +
      `Invoice: ${invoiceNumber}\n` +
      `Order: ${order.orderNumber}\n` +
      `Customer: ${order.customerName} | ${order.customerPhone}\n` +
      `Vehicle: ${order.vehicleInfo || "N/A"}\n` +
      `Tires: ${order.quantity}x ${order.tireBrand} ${order.tireModel} (${order.tireSize})\n` +
      `Labor: $${(laborCost / 100).toFixed(2)} (${installHours}h @ $${laborRate}/hr)\n` +
      `Parts: $${(partsCost / 100).toFixed(2)}\n` +
      `Tax: $${(taxAmount / 100).toFixed(2)}\n` +
      `Total: $${(totalAmount / 100).toFixed(2)}\n\n` +
      `⚡ Create this invoice in ShopDriver NOW`
    )
  ).catch(e => console.warn("[gatewayTire:autoInvoice] telegram invoice alert failed:", e));

  // Unified event bus
  import("../services/eventBus").then(({ emit }) =>
    emit.invoiceCreated({
      invoiceNumber,
      customerName: order.customerName,
      totalAmount: totalAmount / 100,
      source: "tire_order",
    })
  ).catch(e => console.warn("[gatewayTire:autoInvoice] event bus invoice dispatch failed:", e));

  console.info(`[invoice:created] ${invoiceNumber} for tire order ${order.orderNumber} — $${(totalAmount / 100).toFixed(2)}`);
}

// ─── Gateway Tire B2B Session ─────────────────────────
let gatewaySession: { cookie: string; expiresAt: number } | null = null;
const GATEWAY_BASE = "https://b2b.dktire.com";

async function getGatewaySession(): Promise<string | null> {
  if (gatewaySession && Date.now() < gatewaySession.expiresAt) {
    return gatewaySession.cookie;
  }

  const username = process.env.GATEWAY_TIRE_USERNAME;
  const password = process.env.GATEWAY_TIRE_PASSWORD;
  if (!username || !password) return null;

  try {
    const res = await fetch(`${GATEWAY_BASE}/auth-signin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin": GATEWAY_BASE,
        "Referer": `${GATEWAY_BASE}/auth-signin`,
      },
      body: JSON.stringify({ username, password }),
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });

    const setCookies = res.headers.getSetCookie?.() || [];
    const cookieStr = setCookies.map(c => c.split(";")[0]).join("; ");

    if (cookieStr) {
      gatewaySession = { cookie: cookieStr, expiresAt: Date.now() + 30 * 60 * 1000 };
      return cookieStr;
    }

    const formRes = await fetch(`${GATEWAY_BASE}/auth-signin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin": GATEWAY_BASE,
        "Referer": `${GATEWAY_BASE}/auth-signin`,
      },
      body: `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });

    const formCookies = formRes.headers.getSetCookie?.() || [];
    const formCookieStr = formCookies.map(c => c.split(";")[0]).join("; ");

    if (formCookieStr) {
      gatewaySession = { cookie: formCookieStr, expiresAt: Date.now() + 30 * 60 * 1000 };
      return formCookieStr;
    }

    return null;
  } catch (err) {
    console.error("[GatewayTire] Auth error:", err);
    return null;
  }
}

async function gatewayFetch(path: string, options: RequestInit = {}): Promise<Response | null> {
  const cookie = await getGatewaySession();
  if (!cookie) return null;

  try {
    return await fetch(`${GATEWAY_BASE}${path}`, {
      ...options,
      headers: {
        "Cookie": cookie,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json, text/html, */*",
        ...options.headers,
      },
    });
  } catch (err) {
    console.error("[GatewayTire] Fetch error:", err);
    return null;
  }
}

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
const recentOrderKeys = new Map<string, { orderNumber: string; at: number }>();
const IDEMPOTENCY_WINDOW = 5 * 60 * 1000; // 5 minutes

function getIdempotencyKey(input: { customerPhone: string; tireBrand: string; tireModel: string; tireSize: string; quantity: number }): string {
  return `${input.customerPhone}|${input.tireBrand}|${input.tireModel}|${input.tireSize}|${input.quantity}`;
}

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

// ─── Order number generator ──────────────────────────
function generateOrderNumber(): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(Math.random() * 900) + 100;
  return `TO-${dateStr}-${rand}`;
}

// ─── Google Sheets sync ──────────────────────────────
async function syncOrderToGoogleSheet(order: {
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  vehicleInfo: string | null;
  tireBrand: string;
  tireModel: string;
  tireSize: string;
  quantity: number;
  pricePerTire: number;
  totalAmount: number;
  customerNotes: string | null;
  status: string;
}) {
  try {
    const fs = await import("fs");
    const configContent = fs.readFileSync("/home/ubuntu/.gdrive-rclone.ini", "utf-8");
    const tokenJson = configContent.split("token = ")[1]?.trim();
    if (!tokenJson) return;
    const tokenData = JSON.parse(tokenJson);
    const accessToken = tokenData.access_token;
    const sheetId = process.env.GOOGLE_SHEETS_CRM_ID;
    if (!sheetId) return;

    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

    const row = [
      order.orderNumber,
      dateStr,
      order.status.charAt(0).toUpperCase() + order.status.slice(1),
      order.customerName,
      order.customerPhone,
      order.customerEmail || "",
      order.vehicleInfo || "",
      order.tireBrand,
      order.tireModel,
      order.tireSize,
      order.quantity.toString(),
      `$${order.pricePerTire.toFixed(2)}`,
      "$0.00 (Included)",
      `$${order.totalAmount.toFixed(2)}`,
      order.customerNotes || "",
      "", // Gateway Ref - filled later
      "", // Expected Delivery
      "", // Installation Date
    ];

    const body = JSON.stringify({
      values: [row],
    });

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Tire%20Orders!A:R:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body,
    });

    if (resp.ok) {
      console.info(`[tireorder:sheets] Synced ${order.orderNumber} to Google Sheets`);
    } else {
      console.error(`[TireOrder] Google Sheets sync failed:`, resp.status, await resp.text());
    }
  } catch (err) {
    console.error("[TireOrder] Google Sheets sync error:", err);
  }
}

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
          let tires: PublicTire[] = pipelineCached.map((item, idx) => {
            const shopPrice = Math.ceil(item.wholesaleCost * (1 + markup / 100) * 100) / 100;
            const pricePerTireCents = Math.round(shopPrice * 100);
            const cat = item.wholesaleCost < 60 ? "budget" : item.wholesaleCost < 90 ? "mid" : "premium";
            return {
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
            };
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
      } catch (e) { console.warn("[gatewayTire:search] pipeline cache lookup failed, falling through to live:", e); }

      // Try live Gateway Tire API
      const res = await gatewayFetch(`/api/products/search?q=${encodeURIComponent(sizeClean)}`);

      if (res && res.ok) {
        try {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            let tires: PublicTire[] = data.map((item: any, idx: number) => {
              const cost = parseFloat(item.cost || item.price || "0");
              // 100% markup: customer pays 2× wholesale
              const shopPrice = Math.ceil(cost * (1 + markup / 100) * 100) / 100;
              const pricePerTireCents = Math.round(shopPrice * 100);
              const cat = cost < 60 ? "budget" : cost < 90 ? "mid" : "premium";
              return {
                id: `gw-${idx}-${item.partNumber || sizeClean}`,
                name: `${item.brand || ""} ${item.model || item.name || ""}`.trim(),
                brand: (item.brand || "").toUpperCase(),
                model: item.model || item.name || "",
                size: item.size || sizeFormatted,
                category: cat as "budget" | "mid" | "premium",
                shopPrice,
                pricePerTireCents,
                warranty: item.warranty || "",
                features: [],
                speedRating: item.speedRating || "",
                loadIndex: item.loadRating || "",
                inStock: (item.localQty || item.localOnHand || "0") !== "0",
                estimatedDelivery: (item.localQty || item.localOnHand || "0") !== "0" ? "Same day" : "1-2 business days",
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
          }
        } catch (err) {
          console.error("[GatewayTire] Live tire search failed, falling through to catalog:", err instanceof Error ? (err as Error).message : err);
        }
      }

      // Curated catalog fallback
      const catalog = getCuratedCatalog();
      let tires: PublicTire[] = catalog.map((item, idx) => {
        const shopPrice = Math.ceil(item.baseCost * (1 + markup / 100) * 100) / 100;
        const pricePerTireCents = Math.round(shopPrice * 100);
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
          inStock: true,
          estimatedDelivery: "1-2 business days",
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
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) return { success: false, error: "Service unavailable" };

      // Idempotency check — prevent duplicate orders within 5 minutes
      const idemKey = getIdempotencyKey(input);
      const existingOrder = checkDuplicateOrder(idemKey);
      if (existingOrder) {
        console.info(`[tireorder:dedup] Duplicate blocked — existing order ${existingOrder}`);
        return { success: true, orderNumber: existingOrder, totalAmount: 0, duplicate: true };
      }

      const orderNumber = generateOrderNumber();
      recordOrder(idemKey, orderNumber);
      // No service fee — everything included in tire price
      const serviceFeePerTire = 0;
      const totalAmount = input.pricePerTireCents * input.quantity;

      // Insert the tire order
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
      });

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
        } catch (e) { console.warn("[gatewayTire:placeOrder] labor rate fetch failed, using default $115:", e); }

        const installHours = 0.7; // Mount + balance from Auto Labor Guide
        const laborCostCents = Math.round(installHours * laborRate * 100);
        const partsCostCents = totalAmount; // tires are "parts"
        // Ohio sales tax: parts/materials only, NOT labor
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
        ).catch(e => console.warn("[gatewayTire:placeOrder] event bus invoice dispatch failed:", e));

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
        }).catch(err => console.error("[TireOrder] Invoice sheet sync error:", err));

        console.info(`[invoice:created] ${invoiceNumber} for tire order ${orderNumber} — $${(grandTotalCents / 100).toFixed(2)} (pending payment)`);
      } catch (err) {
        console.error("[TireOrder] Invoice creation failed:", err instanceof Error ? (err as Error).message : err);
      }

      // Sync to Google Sheets (async, don't block)
      syncOrderToGoogleSheet({
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
      }).catch(err => console.error("[TireOrder] Sheet sync error:", err));

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
      }).catch(err => console.error("[TireOrder] Notification error:", err));

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
      ).catch(e => console.warn("[gatewayTire:placeOrder] ShopDriver sync failed:", e));

      // Unified event bus (→ NOUR OS + ShopDriver + Telegram + learning)
      import("../services/eventBus").then(({ emit }) =>
        emit.tireOrderPlaced({
          orderNumber,
          customerName: input.customerName,
          tireBrand: input.tireBrand,
          tireModel: input.tireModel,
          quantity: input.quantity,
          totalAmount: totalDollars,
        })
      ).catch(e => console.warn("[gatewayTire:placeOrder] event bus tire order dispatch failed:", e));

      // ─── Smart uncommon-size detection ────────────────
      // If the tire size isn't one we commonly stock, flag it for Gateway ordering
      const normalizedSize = input.tireSize.replace(/[^0-9]/g, "");
      const isCommonSize = POPULAR_SIZES.includes(normalizedSize);
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
        ).catch(e => console.warn("[gatewayTire:placeOrder] uncommon size telegram alert failed:", e));

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
        }).catch(e => console.warn("[gatewayTire:placeOrder] uncommon size email notification failed:", e));
      }

      return {
        success: true,
        orderNumber,
        invoiceNumber: invoiceNumber || undefined,
        totalAmount: totalDollars,
        uncommonSize: !isCommonSize,
      };
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
          }).catch(e => console.warn("[gatewayTire:updateOrder] delivery email notification failed:", e));

          import("../services/telegram").then(({ sendTelegram }) =>
            sendTelegram(
              `📦 TIRES ARRIVED — ${currentOrder.orderNumber}\n\n` +
              `${orderDesc}\n` +
              `Customer: ${currentOrder.customerName} | ${currentOrder.customerPhone}\n` +
              `Vehicle: ${currentOrder.vehicleInfo || "N/A"}\n\n` +
              `⚡ Call customer to schedule installation NOW`
            )
          ).catch(e => console.warn("[gatewayTire:updateOrder] delivery telegram alert failed:", e));
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
          ).catch(e => console.warn("[gatewayTire:updateOrder] in-transit telegram alert failed:", e));
        }

        // INSTALLED → Telegram confirmation
        if (input.status === "installed") {
          import("../services/telegram").then(({ sendTelegram }) =>
            sendTelegram(
              `✅ INSTALLED — ${currentOrder.orderNumber}\n` +
              `${orderDesc}\n` +
              `Customer: ${currentOrder.customerName} | $${((currentOrder.totalAmount || 0) / 100).toFixed(2)}`
            )
          ).catch(e => console.warn("[gatewayTire:updateOrder] installed telegram alert failed:", e));
        }

        // CANCELLED → Telegram alert
        if (input.status === "cancelled") {
          import("../services/telegram").then(({ sendTelegram }) =>
            sendTelegram(
              `❌ ORDER CANCELLED — ${currentOrder.orderNumber}\n` +
              `${orderDesc}\n` +
              `Customer: ${currentOrder.customerName} | ${currentOrder.customerPhone}\n` +
              (input.adminNotes ? `Reason: ${input.adminNotes}` : "")
            )
          ).catch(e => console.warn("[gatewayTire:updateOrder] cancelled telegram alert failed:", e));
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

  status: adminProcedure.query(async () => {
    const username = process.env.GATEWAY_TIRE_USERNAME;
    const password = process.env.GATEWAY_TIRE_PASSWORD;

    if (!username || !password) {
      return { connected: false, error: "Gateway Tire credentials not configured", portal: GATEWAY_BASE };
    }

    const session = await getGatewaySession();
    return {
      connected: !!session,
      portal: GATEWAY_BASE,
      accountId: username,
      error: session ? null : "Could not authenticate with Gateway Tire",
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
      const res = await gatewayFetch(`/api/products/search?q=${encodeURIComponent(input.sizeQuery)}`);

      if (res && res.ok) {
        try {
          const data = await res.json();
          if (Array.isArray(data)) {
            const tires = data.map((item: Record<string, any>) => {
              const cost = parseFloat(item.cost || item.price || "0");
              const retail = parseFloat(item.retail || item.msrp || "0");
              const shopPrice = Math.ceil(cost * (1 + markup / 100) * 100) / 100;
              return {
                name: `${item.brand || ""} ${item.model || item.name || ""}`.trim(),
                brand: item.brand || "",
                model: item.model || "",
                size: item.size || input.sizeQuery,
                partNumber: item.partNumber || item.sku || "",
                costPrice: cost,
                retailPrice: retail,
                shopPrice,
                margin: shopPrice - cost,
                marginPercent: cost > 0 ? ((shopPrice - cost) / shopPrice) * 100 : 0,
                localInventory: item.localQty || item.localOnHand || "N/A",
                regionalInventory: item.regionalQty || item.regionalOnHand || "N/A",
              };
            });
            return { tires, source: "live" as const, markup };
          }
        } catch (err) {
          console.error("[GatewayTire] Admin tire search failed:", err instanceof Error ? (err as Error).message : err);
        }
      }

      return {
        tires: [] as any[],
        source: "portal" as const,
        markup,
        portalUrl: `${GATEWAY_BASE}/products?search=${encodeURIComponent(input.sizeQuery)}`,
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
      let url = GATEWAY_BASE + (input?.path || "/");
      if (input?.search) url = `${GATEWAY_BASE}/products?search=${encodeURIComponent(input.search)}`;
      return { url, accountId: process.env.GATEWAY_TIRE_USERNAME || "" };
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
