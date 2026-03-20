/**
 * Gateway Tire (Dunlap & Kyle / b2b.dktire.com) Integration Router
 * 
 * Full tire ordering system:
 * - Tire search by size with live Gateway B2B data when available
 * - Curated catalog fallback with real brand/model data
 * - Customer order placement with DB tracking
 * - Owner notification on new orders
 * - Admin order management (view, update status, notes)
 * - Margin calculator for admin pricing
 */
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import { notifyOwner } from "../_core/notification";
import { z } from "zod";
import { eq, desc, sql, and, like } from "drizzle-orm";
import { tireOrders, shopSettings, bookings, customers } from "../../drizzle/schema";

async function db() {
  const { getDb } = await import("../db");
  return getDb();
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
    // Try JSON login
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
    });

    const setCookies = res.headers.getSetCookie?.() || [];
    const cookieStr = setCookies.map(c => c.split(";")[0]).join("; ");

    if (cookieStr) {
      gatewaySession = { cookie: cookieStr, expiresAt: Date.now() + 30 * 60 * 1000 };
      return cookieStr;
    }

    // Try form-based login
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

// ─── Pricing helpers ──────────────────────────────────
async function getTireMarkup(): Promise<number> {
  const d = await db();
  if (!d) return 50;
  const result = await d.select().from(shopSettings).where(eq(shopSettings.key, "tireMarkup")).limit(1);
  return result.length > 0 ? parseFloat(result[0].value) : 50;
}

const SERVICE_FEE_PER_TIRE = 3500; // $35 mounting + balancing + disposal

// ─── Order number generator ──────────────────────────
function generateOrderNumber(): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(Math.random() * 900 + 100);
  return `TO-${dateStr}-${rand}`;
}

// ─── Curated tire catalog ─────────────────────────────
// Real brands/models available through Gateway Tire wholesale
// Prices are base wholesale costs; markup is applied on top
interface CatalogTire {
  brand: string;
  model: string;
  category: "budget" | "mid" | "premium";
  baseCost: number; // wholesale cost in dollars
  warranty: string;
  features: string[];
  speedRating: string;
  loadIndex: string;
}

function getCuratedCatalog(sizeFormatted: string): CatalogTire[] {
  return [
    {
      brand: "FORTUNE",
      model: "Perfectus FSR602",
      category: "budget",
      baseCost: 52,
      warranty: "60,000 mi",
      features: ["All-Season", "Fuel Efficient", "Quiet Ride"],
      speedRating: "H",
      loadIndex: "95",
    },
    {
      brand: "AMERICUS",
      model: "Sport HP",
      category: "budget",
      baseCost: 48,
      warranty: "50,000 mi",
      features: ["All-Season", "Performance", "Wet Traction"],
      speedRating: "H",
      loadIndex: "95",
    },
    {
      brand: "NEXEN",
      model: "N'Priz AH5",
      category: "mid",
      baseCost: 68,
      warranty: "70,000 mi",
      features: ["All-Season", "Comfort", "Long Tread Life"],
      speedRating: "H",
      loadIndex: "95",
    },
    {
      brand: "HANKOOK",
      model: "Kinergy GT H436",
      category: "mid",
      baseCost: 75,
      warranty: "70,000 mi",
      features: ["All-Season", "Grand Touring", "Low Noise"],
      speedRating: "H",
      loadIndex: "95",
    },
    {
      brand: "COOPER",
      model: "CS5 Ultra Touring",
      category: "mid",
      baseCost: 82,
      warranty: "70,000 mi",
      features: ["All-Season", "Touring", "Wear Square Indicator"],
      speedRating: "H",
      loadIndex: "95",
    },
    {
      brand: "CONTINENTAL",
      model: "TrueContact Tour",
      category: "premium",
      baseCost: 98,
      warranty: "80,000 mi",
      features: ["All-Season", "EcoPlus Technology", "Premium Comfort"],
      speedRating: "H",
      loadIndex: "95",
    },
    {
      brand: "GENERAL",
      model: "AltiMAX RT45",
      category: "mid",
      baseCost: 72,
      warranty: "65,000 mi",
      features: ["All-Season", "Replacement Tire Monitoring", "Visual Alignment Indicator"],
      speedRating: "H",
      loadIndex: "95",
    },
    {
      brand: "FIRESTONE",
      model: "Champion Fuel Fighter",
      category: "mid",
      baseCost: 78,
      warranty: "70,000 mi",
      features: ["All-Season", "Fuel Efficient", "Confident Handling"],
      speedRating: "H",
      loadIndex: "95",
    },
  ];
}

// ─── Public tire type for customer-facing UI ──────────
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

// ─── Common tire sizes ────────────────────────────────
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
  // ─── PUBLIC: Search tires ───────────────────────────
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

      // Try live Gateway Tire API first
      const res = await gatewayFetch(`/api/products/search?q=${encodeURIComponent(sizeClean)}`);

      if (res && res.ok) {
        try {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            let tires: PublicTire[] = data.map((item: any, idx: number) => {
              const cost = parseFloat(item.cost || item.price || "0");
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

            return {
              tires,
              source: "live" as const,
              serviceFee: SERVICE_FEE_PER_TIRE / 100,
              sizeFormatted,
            };
          }
        } catch { /* fall through to catalog */ }
      }

      // Curated catalog fallback
      const catalog = getCuratedCatalog(sizeFormatted);
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

      return {
        tires,
        source: "catalog" as const,
        serviceFee: SERVICE_FEE_PER_TIRE / 100,
        sizeFormatted,
      };
    }),

  // ─── PUBLIC: Place a tire order ─────────────────────
  placeOrder: publicProcedure
    .input(z.object({
      // Customer info
      customerName: z.string().min(1).max(255),
      customerPhone: z.string().min(7).max(30),
      customerEmail: z.string().email().optional(),
      vehicleInfo: z.string().max(255).optional(),
      // Tire info
      tireBrand: z.string().min(1),
      tireModel: z.string().min(1),
      tireSize: z.string().min(3),
      quantity: z.number().int().min(1).max(8).default(4),
      pricePerTireCents: z.number().int().min(0),
      // Notes
      customerNotes: z.string().max(1000).optional(),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) return { success: false, error: "Service unavailable" };

      const orderNumber = generateOrderNumber();
      const serviceFeePerTire = SERVICE_FEE_PER_TIRE;
      const totalAmount = (input.pricePerTireCents + serviceFeePerTire) * input.quantity;

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

      // Also create a booking for installation tracking
      await d.insert(bookings).values({
        name: input.customerName,
        phone: input.customerPhone,
        email: input.customerEmail || null,
        service: "Tire Order & Installation",
        vehicle: input.vehicleInfo || "Not specified",
        message: `ONLINE TIRE ORDER ${orderNumber}\n${input.quantity}x ${input.tireBrand} ${input.tireModel} (${input.tireSize})\nTotal: $${(totalAmount / 100).toFixed(2)}${input.customerNotes ? `\nNotes: ${input.customerNotes}` : ""}`,
        preferredTime: "no-preference",
        stage: "received",
      });

      // Send owner notification
      const priceEach = (input.pricePerTireCents / 100).toFixed(2);
      const totalStr = (totalAmount / 100).toFixed(2);
      try {
        await notifyOwner({
          title: `New Tire Order: ${orderNumber}`,
          content: `New online tire order received!\n\nOrder: ${orderNumber}\nCustomer: ${input.customerName}\nPhone: ${input.customerPhone}${input.customerEmail ? `\nEmail: ${input.customerEmail}` : ""}\nVehicle: ${input.vehicleInfo || "Not specified"}\n\nTires: ${input.quantity}x ${input.tireBrand} ${input.tireModel}\nSize: ${input.tireSize}\nPrice: $${priceEach}/tire + $35 install\nTotal: $${totalStr}\n\nStatus: Awaiting confirmation\nCheck admin panel for details.`,
        });
      } catch (err) {
        console.error("[TireOrder] Notification error:", err);
      }

      return {
        success: true,
        orderNumber,
        totalAmount: totalAmount / 100,
      };
    }),

  // ─── PUBLIC: Check order status ─────────────────────
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

  // ─── PUBLIC: Popular sizes ──────────────────────────
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

  // ─── ADMIN: List all tire orders ────────────────────
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
        orders: orders.map(o => ({
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

  // ─── ADMIN: Get single order ────────────────────────
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

  // ─── ADMIN: Update order status ─────────────────────
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

      const updates: Record<string, any> = {};
      if (input.status) updates.status = input.status;
      if (input.adminNotes !== undefined) updates.adminNotes = input.adminNotes;
      if (input.gatewayOrderRef !== undefined) updates.gatewayOrderRef = input.gatewayOrderRef;
      if (input.expectedDelivery) updates.expectedDelivery = new Date(input.expectedDelivery);
      if (input.installationDate) updates.installationDate = new Date(input.installationDate);

      if (Object.keys(updates).length === 0) return { success: false };

      await d.update(tireOrders).set(updates).where(eq(tireOrders.id, input.id));
      return { success: true };
    }),

  // ─── ADMIN: Order stats ─────────────────────────────
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

  // ─── ADMIN: Gateway Tire connection status ──────────
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
    };
  }),

  // ─── ADMIN: Search tires (with cost data) ──────────
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
            const tires = data.map((item: any) => {
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
        } catch { /* fall through */ }
      }

      return {
        tires: [] as any[],
        source: "portal" as const,
        markup,
        portalUrl: `${GATEWAY_BASE}/products?search=${encodeURIComponent(input.sizeQuery)}`,
      };
    }),

  // ─── ADMIN: Calculate margin ────────────────────────
  calculateMargin: adminProcedure
    .input(z.object({
      costPrice: z.number().min(0),
      quantity: z.number().int().min(1).default(1),
      customMarkup: z.number().min(0).max(200).optional(),
    }))
    .mutation(async ({ input }) => {
      const markup = input.customMarkup ?? await getTireMarkup();
      const tirePrice = Math.ceil(input.costPrice * (1 + markup / 100) * 100) / 100;
      const serviceFee = SERVICE_FEE_PER_TIRE / 100;
      const perTireTotal = tirePrice + serviceFee;
      const totalRevenue = perTireTotal * input.quantity;
      const totalCost = input.costPrice * input.quantity;
      const totalProfit = totalRevenue - totalCost;

      return {
        perTire: { cost: input.costPrice, tirePrice, serviceFee, total: perTireTotal },
        summary: { quantity: input.quantity, totalCost, totalRevenue, totalProfit, markupUsed: markup },
      };
    }),

  // ─── ADMIN: Update markup ───────────────────────────
  updateMarkup: adminProcedure
    .input(z.object({ markup: z.number().min(0).max(200) }))
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

  // ─── ADMIN: Portal URL ─────────────────────────────
  portalUrl: adminProcedure
    .input(z.object({ path: z.string().default("/"), search: z.string().optional() }).optional())
    .query(({ input }) => {
      let url = GATEWAY_BASE + (input?.path || "/");
      if (input?.search) url = `${GATEWAY_BASE}/products?search=${encodeURIComponent(input.search)}`;
      return { url, accountId: process.env.GATEWAY_TIRE_USERNAME || "" };
    }),
});

// ─── Status helpers ───────────────────────────────────
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
