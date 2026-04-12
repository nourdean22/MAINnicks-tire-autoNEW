/**
 * Chat Tool Definitions + Executors
 * These tools give the AI chat real data access and action capabilities.
 * Venice/OpenAI-compatible function calling format.
 */

import type { Tool } from "../_core/llm";

// ─── TOOL DEFINITIONS (sent to LLM) ────────────────────

export const CHAT_TOOLS: Tool[] = [
  {
    type: "function",
    function: {
      name: "check_schedule",
      description: "Check available appointment slots for a given date. Use when customer asks about availability, scheduling, or 'can I come in' questions.",
      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description: "Date to check in YYYY-MM-DD format. Use today's date if customer says 'today' or 'now'.",
          },
        },
        required: ["date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_price_estimate",
      description: "Get a price estimate for a specific repair or service. Use when customer asks 'how much', 'what does it cost', or any pricing question.",
      parameters: {
        type: "object",
        properties: {
          service: {
            type: "string",
            description: "The service or repair needed (e.g., 'oil change', 'brake pads', 'tire rotation').",
          },
          vehicle: {
            type: "string",
            description: "Vehicle year/make/model if known (e.g., '2019 Honda Civic').",
          },
        },
        required: ["service"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_booking",
      description: "Look up an existing booking by phone number or reference code. Use when customer asks about their appointment status.",
      parameters: {
        type: "object",
        properties: {
          phone: {
            type: "string",
            description: "Customer phone number.",
          },
          referenceCode: {
            type: "string",
            description: "Booking reference code (e.g., NT-ABC123).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_customer",
      description: "Look up a customer's service history by phone number. Use when customer asks about past visits or their vehicle history.",
      parameters: {
        type: "object",
        properties: {
          phone: {
            type: "string",
            description: "Customer phone number.",
          },
        },
        required: ["phone"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_current_specials",
      description: "Get current promotions and special offers. Use when customer asks about deals, discounts, or specials.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_tire_in_stock",
      description: "Search tire inventory by size. Use when customer asks about tire availability, 'do you have my size', or mentions a tire size like '225/65R17'.",
      parameters: {
        type: "object",
        properties: {
          tireSize: {
            type: "string",
            description: "Tire size (e.g., '225/65R17', '205/55R16'). Extract from customer message.",
          },
        },
        required: ["tireSize"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "estimate_wait_time",
      description: "Estimate current wait time based on job queue. Use when customer asks 'how long will it take', 'wait time', or 'how busy are you'.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_financing",
      description: "Pre-screen financing eligibility. Use when customer asks about payment plans, financing, 'can I pay monthly', or affordability.",
      parameters: {
        type: "object",
        properties: {
          estimatedTotal: {
            type: "number",
            description: "Estimated total cost in dollars.",
          },
        },
        required: ["estimatedTotal"],
      },
    },
  },
];

// ─── TOOL EXECUTORS ─────────────────────────────────────

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "check_schedule":
      return executeCheckSchedule(args.date as string);
    case "get_price_estimate":
      return executeGetPriceEstimate(args.service as string, args.vehicle as string | undefined);
    case "lookup_booking":
      return executeLookupBooking(args.phone as string | undefined, args.referenceCode as string | undefined);
    case "lookup_customer":
      return executeLookupCustomer(args.phone as string);
    case "get_current_specials":
      return executeGetCurrentSpecials();
    case "find_tire_in_stock":
      return executeFindTireInStock(args.tireSize as string);
    case "estimate_wait_time":
      return executeEstimateWaitTime();
    case "check_financing":
      return executeCheckFinancing(args.estimatedTotal as number);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

async function executeCheckSchedule(date: string): Promise<string> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return JSON.stringify({ available: true, note: "Schedule system unavailable — call (216) 862-0005" });

    // Count bookings for the requested date
    const [rows] = await d.execute(
      sql`SELECT COUNT(*) as cnt FROM bookings WHERE preferredDate = ${date} AND status != 'cancelled'`
    );
    const bookingCount = Number((rows as Record<string, unknown>[])?.[0]?.cnt || (rows as Record<string, unknown>)?.cnt || 0);

    // Count active work orders for that day
    const [woRows] = await d.execute(
      sql`SELECT COUNT(*) as cnt FROM work_orders WHERE DATE(createdAt) = ${date} AND status NOT IN ('completed', 'cancelled')`
    );
    const woCount = Number((woRows as Record<string, unknown>[])?.[0]?.cnt || (woRows as Record<string, unknown>)?.cnt || 0);

    const totalLoad = bookingCount + woCount;
    const MAX_DAILY_CAPACITY = 12;

    // Determine availability
    const etHour = parseInt(new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }), 10);
    const isToday = date === new Date().toISOString().split("T")[0];

    let bestTimes: string[] = [];
    if (isToday) {
      if (etHour < 10) bestTimes = ["Early morning (right now)", "Before noon"];
      else if (etHour < 14) bestTimes = ["Drop off now, ready by end of day"];
      else bestTimes = ["Drop off today, ready tomorrow AM"];
    } else {
      bestTimes = ["8:00 AM (first slot)", "10:00 AM", "1:00 PM"];
    }

    return JSON.stringify({
      date,
      currentBookings: totalLoad,
      capacity: MAX_DAILY_CAPACITY,
      availability: totalLoad < MAX_DAILY_CAPACITY * 0.5 ? "wide_open" :
                    totalLoad < MAX_DAILY_CAPACITY * 0.8 ? "filling_up" : "nearly_full",
      bestTimes,
      estimatedWaitMinutes: totalLoad <= 3 ? 0 : Math.min(180, totalLoad * 30),
      note: totalLoad >= MAX_DAILY_CAPACITY
        ? "That day is pretty full — I'd recommend the next day or an early drop-off."
        : totalLoad >= MAX_DAILY_CAPACITY * 0.8
          ? "Getting busy — book soon to lock in your spot."
          : "Plenty of room — we can fit you in.",
    });
  } catch (e) {
    return JSON.stringify({ available: true, note: "Couldn't check exact schedule — but we take walk-ins Mon-Sat 8-6, Sun 9-4." });
  }
}

async function executeGetPriceEstimate(service: string, vehicle?: string): Promise<string> {
  // Service price ranges based on the shop's actual labor guide
  const PRICE_MAP: Record<string, { low: number; high: number; laborHours: number; note?: string }> = {
    "oil change": { low: 35, high: 75, laborHours: 0.3, note: "Synthetic blend standard. Full synthetic available." },
    "brake pads": { low: 150, high: 350, laborHours: 1.5, note: "Per axle. Includes inspection of rotors." },
    "brake": { low: 150, high: 350, laborHours: 1.5, note: "Per axle. Includes inspection of rotors." },
    "brakes": { low: 150, high: 350, laborHours: 1.5, note: "Per axle. Includes inspection of rotors." },
    "tire rotation": { low: 25, high: 50, laborHours: 0.3 },
    "tire": { low: 80, high: 250, laborHours: 0.7, note: "Per tire installed + balanced. Price depends on size/brand." },
    "alignment": { low: 80, high: 120, laborHours: 1.0 },
    "wheel alignment": { low: 80, high: 120, laborHours: 1.0 },
    "diagnostic": { low: 75, high: 150, laborHours: 1.0, note: "Includes code scan + visual inspection. Applied to repair if you proceed." },
    "check engine": { low: 75, high: 150, laborHours: 1.0, note: "Full diagnostic scan. Fee applied toward repair." },
    "battery": { low: 120, high: 250, laborHours: 0.5, note: "Includes battery + installation. Free battery test anytime." },
    "ac": { low: 150, high: 500, laborHours: 1.5, note: "Recharge starts at $150. Compressor replacement higher." },
    "alternator": { low: 350, high: 600, laborHours: 1.5 },
    "starter": { low: 300, high: 550, laborHours: 2.0 },
    "suspension": { low: 300, high: 800, laborHours: 2.5, note: "Depends on what's worn — struts, shocks, control arms, etc." },
    "exhaust": { low: 150, high: 500, laborHours: 1.5 },
    "transmission service": { low: 150, high: 300, laborHours: 1.0, note: "Fluid change/flush. Not a rebuild." },
    "coolant flush": { low: 100, high: 175, laborHours: 1.0 },
    "emission": { low: 200, high: 600, laborHours: 2.0, note: "Ohio E-Check repair. Depends on the code." },
    "e-check": { low: 200, high: 600, laborHours: 2.0, note: "Ohio E-Check repair. Depends on the code." },
  };

  const lower = service.toLowerCase();
  let match: { low: number; high: number; laborHours: number; note?: string } | undefined;
  for (const [key, val] of Object.entries(PRICE_MAP)) {
    if (lower.includes(key)) { match = val; break; }
  }

  if (!match) {
    return JSON.stringify({
      service,
      vehicle: vehicle || "not specified",
      estimate: "We'd need to see the vehicle for an accurate quote on this one.",
      freeInspection: true,
      note: "Drop it off or drive in — we'll inspect for free and call you with the exact cost before doing any work.",
      financing: "No-credit-check financing available (Acima, Snap Finance, Koalafi) starting at $10 down.",
    });
  }

  return JSON.stringify({
    service,
    vehicle: vehicle || "not specified",
    lowEstimate: match.low,
    highEstimate: match.high,
    estimatedLaborHours: match.laborHours,
    note: match.note || undefined,
    disclaimer: "This is a general range — exact price depends on your specific vehicle. We'll give you the exact cost before starting any work.",
    financing: "No-credit-check financing available starting at $10 down.",
    freeInspection: true,
  });
}

async function executeLookupBooking(phone?: string, referenceCode?: string): Promise<string> {
  try {
    const { getDb } = await import("../db");
    const { bookings } = await import("../../drizzle/schema");
    const { eq, desc, like } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return JSON.stringify({ error: "System unavailable — call (216) 862-0005" });

    let results;
    if (referenceCode) {
      results = await d.select().from(bookings)
        .where(eq(bookings.referenceCode, referenceCode))
        .limit(1);
    } else if (phone) {
      const digits = phone.replace(/\D/g, "").slice(-10);
      results = await d.select().from(bookings)
        .where(like(bookings.phone, `%${digits}`))
        .orderBy(desc(bookings.createdAt))
        .limit(3);
    }

    if (!results || results.length === 0) {
      return JSON.stringify({ found: false, note: "No booking found. Would you like to schedule one?" });
    }

    return JSON.stringify({
      found: true,
      bookings: results.map((b: Record<string, unknown>) => ({
        reference: b.referenceCode,
        service: b.service,
        status: b.status,
        date: b.preferredDate,
        vehicle: b.vehicle,
      })),
    });
  } catch (e) {
    return JSON.stringify({ found: false, note: "Couldn't look up your booking right now. Call (216) 862-0005." });
  }
}

async function executeLookupCustomer(phone: string): Promise<string> {
  try {
    const { getDb } = await import("../db");
    const { customers, invoices } = await import("../../drizzle/schema");
    const { sql, desc } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return JSON.stringify({ error: "System unavailable" });

    const digits = phone.replace(/\D/g, "").slice(-10);
    const found = await d.select().from(customers)
      .where(sql`REPLACE(REPLACE(REPLACE(REPLACE(${customers.phone}, '-', ''), '(', ''), ')', ''), ' ', '') LIKE ${'%' + digits}`)
      .limit(1);

    if (found.length === 0) {
      return JSON.stringify({ found: false, note: "No history on file. Are you a new customer? Welcome!" });
    }

    const c = found[0];

    // Get last 3 invoices
    const recentInvoices = await d.select({
      service: invoices.serviceDescription,
      date: invoices.invoiceDate,
      amount: invoices.totalAmount,
    }).from(invoices)
      .where(sql`REPLACE(REPLACE(REPLACE(REPLACE(${invoices.customerPhone}, '-', ''), '(', ''), ')', ''), ' ', '') LIKE ${'%' + digits}`)
      .orderBy(desc(invoices.invoiceDate))
      .limit(3);

    return JSON.stringify({
      found: true,
      name: [c.firstName, c.lastName].filter(Boolean).join(" "),
      vehicle: [c.vehicleYear, c.vehicleMake, c.vehicleModel].filter(Boolean).join(" ") || null,
      totalVisits: c.totalVisits,
      segment: c.segment,
      recentServices: recentInvoices.map((inv: { service: string | null; date: Date | null; amount: number | null }) => ({
        service: inv.service,
        date: inv.date?.toLocaleDateString("en-US") || null,
        amount: inv.amount ? `$${(inv.amount / 100).toFixed(0)}` : null,
      })),
    });
  } catch (e) {
    return JSON.stringify({ found: false, note: "Couldn't pull history right now." });
  }
}

async function executeGetCurrentSpecials(): Promise<string> {
  try {
    const { getDb } = await import("../db");
    const { sql: rawSql } = await import("drizzle-orm");
    const d = await getDb();

    // Check for active specials in the specials table
    let specials: Array<{ title: string; description: string; discount: string }> = [];
    if (d) {
      try {
        const [rows] = await d.execute(
          rawSql`SELECT title, description, discountText FROM specials WHERE active = 1 AND (expiresAt IS NULL OR expiresAt > NOW()) ORDER BY createdAt DESC LIMIT 5`
        );
        specials = (rows as Array<Record<string, unknown>>).map(r => ({
          title: String(r.title || ""),
          description: String(r.description || ""),
          discount: String(r.discountText || ""),
        }));
      } catch {
        // Table might not exist yet
      }
    }

    // Always-on offers
    const alwaysOn = [
      { title: "Free Inspection", description: "Drop in anytime — we'll inspect your vehicle for free and give you an honest quote.", discount: "Free" },
      { title: "No-Credit-Check Financing", description: "Acima, Snap Finance, Koalafi — starting at $10 down.", discount: "As low as $10 down" },
      { title: "Free Battery Test", description: "Stop by and we'll test your battery in 5 minutes, no appointment needed.", discount: "Free" },
    ];

    return JSON.stringify({
      activeSpecials: specials,
      alwaysAvailable: alwaysOn,
      note: "We also do price-matching on tires — bring us any quote and we'll beat it.",
    });
  } catch (e) {
    return JSON.stringify({
      activeSpecials: [],
      alwaysAvailable: [
        { title: "Free Inspection", discount: "Free" },
        { title: "No-Credit-Check Financing", discount: "$10 down" },
      ],
    });
  }
}

// ─── NEW TOOLS (v6) ─────────────────────────────────────

async function executeFindTireInStock(tireSize: string): Promise<string> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return JSON.stringify({ inStock: false, note: "Inventory check unavailable — call (216) 862-0005 for availability." });

    // Search tire inventory by size (normalize: remove spaces, uppercase)
    const normalized = tireSize.replace(/\s+/g, "").toUpperCase();
    const results = await d.execute(
      sql`SELECT brand, model, size, price_cents, quantity FROM tire_inventory WHERE REPLACE(UPPER(size), ' ', '') LIKE ${`%${normalized}%`} AND quantity > 0 LIMIT 5`
    );

    const tires = (results as any[]) || [];

    if (tires.length === 0) {
      return JSON.stringify({
        inStock: false,
        size: tireSize,
        note: `We don't currently have ${tireSize} in stock, but we can order it — usually arrives in 1-2 business days. Call (216) 862-0005 or drop by and we'll get you set up.`,
      });
    }

    return JSON.stringify({
      inStock: true,
      size: tireSize,
      options: tires.map((t: any) => ({
        brand: t.brand,
        model: t.model,
        size: t.size,
        price: t.price_cents ? `$${(t.price_cents / 100).toFixed(2)}` : "Call for price",
        qty: t.quantity,
      })),
      note: "Prices include mounting + balancing. Drop-off anytime — no appointment needed!",
    });
  } catch {
    return JSON.stringify({
      inStock: false,
      note: "Inventory check unavailable right now. Call (216) 862-0005 and we'll check for you!",
    });
  }
}

async function executeEstimateWaitTime(): Promise<string> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return JSON.stringify({ estimatedWait: "Unknown", note: "Call (216) 862-0005 for current wait." });

    // Count in-progress bookings today
    const today = new Date().toISOString().split("T")[0];
    const result = await d.execute(
      sql`SELECT COUNT(*) as active FROM bookings WHERE DATE(scheduled_date) = ${today} AND status IN ('in_progress', 'checked_in', 'pending')`
    );

    const activeJobs = Number((result as any[])?.[0]?.active) || 0;

    let estimate: string;
    let busy: string;
    if (activeJobs === 0) {
      estimate = "No wait — come right in!";
      busy = "quiet";
    } else if (activeJobs <= 2) {
      estimate = "About 30-45 minutes";
      busy = "normal";
    } else if (activeJobs <= 4) {
      estimate = "About 1-2 hours";
      busy = "busy";
    } else {
      estimate = "2-3 hours (very busy today)";
      busy = "very busy";
    }

    return JSON.stringify({
      estimatedWait: estimate,
      activeJobs,
      busyLevel: busy,
      note: "Drop-off available anytime — leave your car and we'll call when it's done! No appointment needed.",
    });
  } catch {
    return JSON.stringify({
      estimatedWait: "Unknown",
      note: "Call (216) 862-0005 for current wait time.",
    });
  }
}

async function executeCheckFinancing(estimatedTotal: number): Promise<string> {
  const monthlyPayments = [
    { months: 6, payment: Math.round(estimatedTotal / 6) },
    { months: 12, payment: Math.round(estimatedTotal / 12) },
    { months: 18, payment: Math.round(estimatedTotal / 18) },
  ];

  return JSON.stringify({
    eligible: true,
    estimatedTotal: `$${estimatedTotal.toFixed(0)}`,
    plans: monthlyPayments.map(p => ({
      term: `${p.months} months`,
      monthlyPayment: `$${p.payment}/mo`,
    })),
    requirements: [
      "No credit check required",
      "Just $10 down to start",
      "Bring valid ID and proof of income",
    ],
    note: "Financing available for repairs over $200. Apply in person — takes about 5 minutes. Drop by anytime!",
    provider: "In-house financing — no third-party hassle",
  });
}
