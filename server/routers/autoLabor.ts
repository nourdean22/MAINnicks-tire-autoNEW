/**
 * Auto Labor Guide / ShopDriver Elite Integration Router
 * 
 * Provides server-side proxy to ShopDriver Elite for:
 * - Labor time lookups by vehicle + job
 * - Recent invoice sync
 * - Customer data sync
 * - Vehicle database access
 */
import { adminProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { eq } from "drizzle-orm";

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

const SHOPDRIVER_BASE = "https://secure.autolaborexperts.com";
const SHOPDRIVER_API = "https://8DD0FCE9-80F9-4A9E-B0C3-CF76825AD9B7.autolaborexperts.com";

// Session management for ShopDriver — JWT token auth
let shopDriverSession: { token: string; expiresAt: number } | null = null;

/** Authenticate with ShopDriver Elite via GUID API endpoint */
async function getShopDriverSession(): Promise<string | null> {
  if (shopDriverSession && Date.now() < shopDriverSession.expiresAt) {
    return shopDriverSession.token;
  }

  const username = process.env.AUTO_LABOR_USERNAME;
  const password = process.env.AUTO_LABOR_PASSWORD;

  if (!username || !password) {
    console.error("[ShopDriver] Missing credentials");
    return null;
  }

  try {
    const res = await fetch(`${SHOPDRIVER_API}/api/account/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin": SHOPDRIVER_BASE,
        "Referer": `${SHOPDRIVER_BASE}/`,
      },
      body: JSON.stringify({
        login: username,
        password,
        ipAddress: "",
        location: "",
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      console.error(`[ShopDriver] Login failed: HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();

    // Extract JWT token — try common shapes
    const token = data.token || data.jwt || data.accessToken || data.access_token ||
      data.data?.token || data.data?.jwt || data.data?.accessToken ||
      data.result?.token || data.result?.jwt;

    if (token && typeof token === "string") {
      shopDriverSession = {
        token,
        expiresAt: Date.now() + 3 * 60 * 1000,
      };
      return token;
    }

    // Check for cookies as fallback
    const cookies = res.headers.getSetCookie?.() || [];
    const cookieStr = cookies.map(c => c.split(";")[0]).join("; ");
    if (cookieStr) {
      shopDriverSession = {
        token: `cookie:${cookieStr}`,
        expiresAt: Date.now() + 3 * 60 * 1000,
      };
      return `cookie:${cookieStr}`;
    }

    console.error("[ShopDriver] Login OK but no token found", Object.keys(data));
    return null;
  } catch (err) {
    console.error("[ShopDriver] Auth error:", err);
    return null;
  }
}

// ─── Vehicle database (built-in for offline labor time reference) ───

/** Common repair categories with typical labor times */
const LABOR_CATEGORIES: Record<string, { name: string; jobs: { name: string; minHours: number; maxHours: number; avgHours: number; notes: string }[] }> = {
  brakes: {
    name: "Brakes",
    jobs: [
      { name: "Front Brake Pads (both sides)", minHours: 0.5, maxHours: 1.5, avgHours: 1.0, notes: "Includes inspection of rotors and calipers" },
      { name: "Rear Brake Pads (both sides)", minHours: 0.5, maxHours: 1.5, avgHours: 1.0, notes: "Drum brakes may take longer" },
      { name: "Front Brake Rotors (both sides)", minHours: 1.0, maxHours: 2.0, avgHours: 1.5, notes: "Includes pad replacement" },
      { name: "Rear Brake Rotors (both sides)", minHours: 1.0, maxHours: 2.0, avgHours: 1.5, notes: "Includes pad replacement" },
      { name: "Brake Caliper Replacement (one)", minHours: 1.0, maxHours: 2.5, avgHours: 1.5, notes: "Includes bleeding brake system" },
      { name: "Brake Line Replacement", minHours: 1.0, maxHours: 3.0, avgHours: 2.0, notes: "Depends on line location and routing" },
      { name: "Brake Fluid Flush", minHours: 0.5, maxHours: 1.0, avgHours: 0.7, notes: "Full system bleed" },
      { name: "ABS Module Replacement", minHours: 1.5, maxHours: 3.0, avgHours: 2.0, notes: "May require programming" },
    ],
  },
  engine: {
    name: "Engine",
    jobs: [
      { name: "Spark Plugs (4-cylinder)", minHours: 0.5, maxHours: 1.5, avgHours: 1.0, notes: "V6/V8 may take 2-3 hours" },
      { name: "Spark Plugs (V6)", minHours: 1.0, maxHours: 3.0, avgHours: 2.0, notes: "Rear bank access varies" },
      { name: "Ignition Coil (one)", minHours: 0.3, maxHours: 1.0, avgHours: 0.5, notes: "COP systems are faster" },
      { name: "Timing Belt Replacement", minHours: 3.0, maxHours: 6.0, avgHours: 4.5, notes: "Include water pump if accessible" },
      { name: "Timing Chain Replacement", minHours: 4.0, maxHours: 8.0, avgHours: 6.0, notes: "Major engine work" },
      { name: "Head Gasket Replacement", minHours: 6.0, maxHours: 12.0, avgHours: 8.0, notes: "Includes head machining check" },
      { name: "Valve Cover Gasket", minHours: 0.5, maxHours: 3.0, avgHours: 1.5, notes: "V6 rear bank takes longer" },
      { name: "Oil Pan Gasket", minHours: 2.0, maxHours: 5.0, avgHours: 3.0, notes: "Subframe removal may be needed" },
      { name: "Water Pump Replacement", minHours: 1.5, maxHours: 4.0, avgHours: 2.5, notes: "Timing-driven pumps take longer" },
      { name: "Thermostat Replacement", minHours: 0.5, maxHours: 2.0, avgHours: 1.0, notes: "Location varies by vehicle" },
    ],
  },
  electrical: {
    name: "Electrical / Diagnostics",
    jobs: [
      { name: "Check Engine Light Diagnosis", minHours: 0.5, maxHours: 1.5, avgHours: 1.0, notes: "OBD-II scan + pinpoint testing" },
      { name: "Alternator Replacement", minHours: 1.0, maxHours: 2.5, avgHours: 1.5, notes: "Belt routing varies" },
      { name: "Starter Replacement", minHours: 1.0, maxHours: 3.0, avgHours: 2.0, notes: "Access can be difficult" },
      { name: "Battery Replacement", minHours: 0.3, maxHours: 1.0, avgHours: 0.5, notes: "Some require coding" },
      { name: "Oxygen Sensor (one)", minHours: 0.5, maxHours: 1.5, avgHours: 0.8, notes: "Upstream vs downstream" },
      { name: "Catalytic Converter", minHours: 1.0, maxHours: 3.0, avgHours: 2.0, notes: "Bolt-on vs welded" },
      { name: "EVAP System Repair", minHours: 1.0, maxHours: 3.0, avgHours: 1.5, notes: "Smoke test included" },
      { name: "Mass Air Flow Sensor", minHours: 0.3, maxHours: 0.5, avgHours: 0.3, notes: "Usually quick replacement" },
    ],
  },
  suspension: {
    name: "Suspension / Steering",
    jobs: [
      { name: "Strut Assembly (one side)", minHours: 1.0, maxHours: 2.0, avgHours: 1.5, notes: "Quick-strut vs spring compression" },
      { name: "Struts (both front)", minHours: 2.0, maxHours: 3.5, avgHours: 2.5, notes: "Alignment needed after" },
      { name: "Control Arm (one)", minHours: 1.0, maxHours: 2.5, avgHours: 1.5, notes: "Ball joint may be integrated" },
      { name: "Ball Joint (one)", minHours: 1.0, maxHours: 2.5, avgHours: 1.5, notes: "Press-in vs bolt-on" },
      { name: "Tie Rod End (one)", minHours: 0.5, maxHours: 1.5, avgHours: 1.0, notes: "Alignment needed after" },
      { name: "Wheel Bearing (one)", minHours: 1.0, maxHours: 3.0, avgHours: 2.0, notes: "Hub assembly vs press-in" },
      { name: "Sway Bar Link (one)", minHours: 0.3, maxHours: 1.0, avgHours: 0.5, notes: "Usually straightforward" },
      { name: "Power Steering Pump", minHours: 1.5, maxHours: 3.0, avgHours: 2.0, notes: "Includes fluid flush" },
      { name: "Wheel Alignment", minHours: 0.5, maxHours: 1.5, avgHours: 1.0, notes: "4-wheel alignment" },
    ],
  },
  cooling: {
    name: "Cooling / AC",
    jobs: [
      { name: "Radiator Replacement", minHours: 1.5, maxHours: 3.0, avgHours: 2.0, notes: "Includes coolant flush" },
      { name: "Radiator Hose (upper or lower)", minHours: 0.5, maxHours: 1.5, avgHours: 0.8, notes: "Lower hose usually harder" },
      { name: "Coolant Flush", minHours: 0.5, maxHours: 1.0, avgHours: 0.7, notes: "Full system drain and fill" },
      { name: "AC Recharge (R-134a)", minHours: 0.5, maxHours: 1.0, avgHours: 0.7, notes: "Includes leak check" },
      { name: "AC Compressor Replacement", minHours: 2.0, maxHours: 4.0, avgHours: 3.0, notes: "Includes evacuate and recharge" },
      { name: "AC Condenser Replacement", minHours: 1.5, maxHours: 3.0, avgHours: 2.0, notes: "Front bumper removal may be needed" },
      { name: "Heater Core Replacement", minHours: 4.0, maxHours: 10.0, avgHours: 6.0, notes: "Dashboard removal usually required" },
    ],
  },
  exhaust: {
    name: "Exhaust / Emissions",
    jobs: [
      { name: "Muffler Replacement", minHours: 0.5, maxHours: 2.0, avgHours: 1.0, notes: "Bolt-on vs welded" },
      { name: "Exhaust Pipe Section", minHours: 0.5, maxHours: 2.0, avgHours: 1.0, notes: "Rust can complicate" },
      { name: "Catalytic Converter", minHours: 1.0, maxHours: 3.0, avgHours: 2.0, notes: "OEM vs aftermarket" },
      { name: "Exhaust Manifold", minHours: 1.5, maxHours: 4.0, avgHours: 2.5, notes: "Broken studs are common" },
      { name: "EGR Valve Replacement", minHours: 0.5, maxHours: 2.0, avgHours: 1.0, notes: "Cleaning may be sufficient" },
      { name: "Ohio E-Check Repair", minHours: 1.0, maxHours: 4.0, avgHours: 2.0, notes: "Diagnosis + repair + drive cycle" },
    ],
  },
  maintenance: {
    name: "Maintenance",
    jobs: [
      { name: "Oil Change (Conventional)", minHours: 0.3, maxHours: 0.5, avgHours: 0.3, notes: "Includes filter" },
      { name: "Oil Change (Synthetic)", minHours: 0.3, maxHours: 0.5, avgHours: 0.3, notes: "Includes filter" },
      { name: "Transmission Fluid Change", minHours: 0.5, maxHours: 1.5, avgHours: 1.0, notes: "Drain and fill vs flush" },
      { name: "Serpentine Belt", minHours: 0.3, maxHours: 1.5, avgHours: 0.7, notes: "Tensioner access varies" },
      { name: "Air Filter Replacement", minHours: 0.1, maxHours: 0.3, avgHours: 0.2, notes: "Quick service" },
      { name: "Cabin Air Filter", minHours: 0.1, maxHours: 0.5, avgHours: 0.2, notes: "Location varies" },
      { name: "Fuel Filter Replacement", minHours: 0.5, maxHours: 1.5, avgHours: 0.8, notes: "In-tank filters take longer" },
      { name: "PCV Valve Replacement", minHours: 0.2, maxHours: 0.5, avgHours: 0.3, notes: "Usually quick" },
    ],
  },
  tires: {
    name: "Tires",
    jobs: [
      { name: "Tire Mount & Balance (4)", minHours: 0.5, maxHours: 1.0, avgHours: 0.7, notes: "Per set of 4" },
      { name: "Tire Rotation", minHours: 0.3, maxHours: 0.5, avgHours: 0.3, notes: "5-tire rotation if full-size spare" },
      { name: "Flat Repair (plug/patch)", minHours: 0.3, maxHours: 0.5, avgHours: 0.3, notes: "Internal patch preferred" },
      { name: "TPMS Sensor (one)", minHours: 0.3, maxHours: 0.5, avgHours: 0.3, notes: "Includes reprogram" },
      { name: "TPMS Sensor (all 4)", minHours: 0.5, maxHours: 1.0, avgHours: 0.7, notes: "Includes reprogram" },
    ],
  },
};

// ─── Freshness & session tracking ─────────────────────
let lastShopDriverAuthAt: string | null = null;
let lastShopDriverAuthSuccess = false;
let laborLookupCount = 0;

export const autoLaborRouter = router({
  /** Check ShopDriver Elite connection status */
  status: adminProcedure.query(async () => {
    const username = process.env.AUTO_LABOR_USERNAME;
    const password = process.env.AUTO_LABOR_PASSWORD;

    if (!username || !password) {
      return {
        connected: false,
        error: "Auto Labor Guide credentials not configured",
        portal: SHOPDRIVER_BASE,
        usingFallback: true,
        fallbackCategories: Object.keys(LABOR_CATEGORIES).length,
        fallbackJobs: Object.values(LABOR_CATEGORIES).reduce((sum, cat) => sum + cat.jobs.length, 0),
      };
    }

    const session = await getShopDriverSession();
    lastShopDriverAuthAt = new Date().toISOString();
    lastShopDriverAuthSuccess = !!session;

    return {
      connected: !!session,
      portal: SHOPDRIVER_BASE,
      accountId: username,
      error: session ? null : "Could not authenticate — using built-in labor guide",
      usingFallback: !session,
      fallbackCategories: Object.keys(LABOR_CATEGORIES).length,
      fallbackJobs: Object.values(LABOR_CATEGORIES).reduce((sum, cat) => sum + cat.jobs.length, 0),
      lastAuthCheck: lastShopDriverAuthAt,
      totalLookups: laborLookupCount,
    };
  }),

  /** Get all labor categories */
  categories: adminProcedure.query(() => {
    return Object.entries(LABOR_CATEGORIES).map(([key, cat]) => ({
      id: key,
      name: cat.name,
      jobCount: cat.jobs.length,
    }));
  }),

  /** Get jobs for a specific category */
  jobsByCategory: adminProcedure
    .input(z.object({ categoryId: z.string() }))
    .query(({ input }) => {
      const cat = LABOR_CATEGORIES[input.categoryId];
      if (!cat) return { category: null, jobs: [] };
      return {
        category: cat.name,
        jobs: cat.jobs,
      };
    }),

  /** Search all jobs across categories */
  searchJobs: adminProcedure
    .input(z.object({ query: z.string().min(2) }))
    .query(({ input }) => {
      laborLookupCount++;
      const q = input.query.toLowerCase();
      const results: Array<{
        categoryId: string;
        categoryName: string;
        job: typeof LABOR_CATEGORIES.brakes.jobs[0];
      }> = [];

      for (const [catId, cat] of Object.entries(LABOR_CATEGORIES)) {
        for (const job of cat.jobs) {
          if (
            job.name.toLowerCase().includes(q) ||
            job.notes.toLowerCase().includes(q) ||
            cat.name.toLowerCase().includes(q)
          ) {
            results.push({
              categoryId: catId,
              categoryName: cat.name,
              job,
            });
          }
        }
      }

      return { results, query: input.query };
    }),

  /** Calculate labor cost for a job */
  calculateLabor: adminProcedure
    .input(z.object({
      jobName: z.string(),
      hours: z.number().min(0),
      laborRate: z.number().min(0).optional(),
      difficulty: z.enum(["standard", "moderate", "difficult"]).default("standard"),
    }))
    .mutation(async ({ input }) => {
      // Get labor rate from settings if not provided
      let rate = input.laborRate;
      if (!rate) {
        const d = await db();
        if (d) {
          const { shopSettings: ss } = await import("../../drizzle/schema");
          const result = await d.select().from(ss).where(eq(ss.key, "laborRate")).limit(1);
          rate = result.length > 0 ? parseFloat(result[0].value) : 115;
        } else {
          rate = 115;
        }
      }

      // Apply difficulty multiplier
      const difficultyMultiplier = input.difficulty === "difficult" ? 1.3 : input.difficulty === "moderate" ? 1.15 : 1.0;
      const adjustedHours = Math.round(input.hours * difficultyMultiplier * 10) / 10;
      const laborCost = Math.round(adjustedHours * rate * 100) / 100;

      return {
        jobName: input.jobName,
        baseHours: input.hours,
        adjustedHours,
        difficulty: input.difficulty,
        difficultyMultiplier,
        laborRate: rate,
        laborCost,
      };
    }),

  /** Get the ShopDriver portal URL */
  portalUrl: adminProcedure
    .input(z.object({ path: z.string().default("/") }).optional())
    .query(({ input }) => {
      return {
        url: SHOPDRIVER_BASE + (input?.path || "/"),
        accountId: process.env.AUTO_LABOR_USERNAME || "",
      };
    }),

  /** Quick estimate — combine labor + common parts pricing */
  quickEstimate: adminProcedure
    .input(z.object({
      jobs: z.array(z.object({
        name: z.string(),
        hours: z.number(),
        partsCost: z.number().default(0),
      })),
      difficulty: z.enum(["standard", "moderate", "difficult"]).default("standard"),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      let rate = 115;
      if (d) {
        const { shopSettings: ss } = await import("../../drizzle/schema");
        const result = await d.select().from(ss).where(eq(ss.key, "laborRate")).limit(1);
        rate = result.length > 0 ? parseFloat(result[0].value) : 115;
      }

      const diffMult = input.difficulty === "difficult" ? 1.3 : input.difficulty === "moderate" ? 1.15 : 1.0;

      const lineItems = input.jobs.map(job => {
        const adjHours = Math.round(job.hours * diffMult * 10) / 10;
        const laborCost = Math.round(adjHours * rate * 100) / 100;
        return {
          name: job.name,
          hours: adjHours,
          laborCost,
          partsCost: job.partsCost,
          total: laborCost + job.partsCost,
        };
      });

      const totalLabor = lineItems.reduce((s, i) => s + i.laborCost, 0);
      const totalParts = lineItems.reduce((s, i) => s + i.partsCost, 0);
      const totalHours = lineItems.reduce((s, i) => s + i.hours, 0);

      return {
        lineItems,
        summary: {
          totalHours,
          totalLabor,
          totalParts,
          subtotal: totalLabor + totalParts,
          laborRate: rate,
          difficulty: input.difficulty,
        },
      };
    }),
});


