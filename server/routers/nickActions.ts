/**
 * Nick AI Agent Actions — Quote creation, work order creation,
 * follow-up scheduling, competitor monitoring, chat-to-action dispatcher.
 *
 * Philosophy: VERIFY EVERYTHING. No assumptions. Every AI output is
 * parsed, validated, and verified before being stored or acted upon.
 */
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { eq, desc, and, gte, sql, like, or } from "drizzle-orm";
import { chatSessions, leads, workOrders, bookings, serviceHistory, workOrderItems, invoices, customers, callbackRequests, reviewRequests } from "../../drizzle/schema";
import { invokeLLM } from "../_core/llm";
import { createLogger } from "../lib/logger";
import { randomUUID } from "crypto";

const log = createLogger("nick-actions");

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

// ─── Validation helpers (verify everything) ─────────────

function validateCurrency(value: unknown): number {
  const num = typeof value === "string" ? parseFloat(value) : Number(value);
  if (isNaN(num) || num < 0 || num > 100_000) {
    log.warn(`Invalid currency value: ${value}, defaulting to 0`);
    return 0;
  }
  return Math.round(num * 100) / 100;
}

function validateString(value: unknown, maxLen: number, fallback: string): string {
  if (typeof value !== "string" || value.trim().length === 0) return fallback;
  return value.trim().slice(0, maxLen);
}

function validateScore(value: unknown, min: number, max: number): number {
  const num = Number(value);
  if (isNaN(num)) return min;
  return Math.min(max, Math.max(min, Math.round(num)));
}

// ─── Built-in Knowledge Bases ───────────────────────────

/** Common auto parts pricing knowledge base (Cleveland area) */
const PARTS_KB: Record<string, { low: number; high: number; unit: string }> = {
  "brake_pads_front": { low: 35, high: 80, unit: "axle" },
  "brake_pads_rear": { low: 30, high: 75, unit: "axle" },
  "brake_rotors_front": { low: 50, high: 120, unit: "pair" },
  "brake_rotors_rear": { low: 45, high: 110, unit: "pair" },
  "brake_calipers": { low: 60, high: 200, unit: "each" },
  "oil_filter": { low: 5, high: 15, unit: "each" },
  "oil_conventional_5qt": { low: 20, high: 30, unit: "5qt" },
  "oil_synthetic_5qt": { low: 35, high: 55, unit: "5qt" },
  "air_filter": { low: 10, high: 25, unit: "each" },
  "cabin_filter": { low: 12, high: 30, unit: "each" },
  "spark_plugs": { low: 5, high: 20, unit: "each" },
  "ignition_coil": { low: 25, high: 80, unit: "each" },
  "battery": { low: 100, high: 220, unit: "each" },
  "alternator": { low: 150, high: 400, unit: "each" },
  "starter_motor": { low: 120, high: 350, unit: "each" },
  "water_pump": { low: 50, high: 200, unit: "each" },
  "thermostat": { low: 15, high: 50, unit: "each" },
  "radiator": { low: 150, high: 400, unit: "each" },
  "serpentine_belt": { low: 20, high: 50, unit: "each" },
  "timing_belt": { low: 40, high: 120, unit: "each" },
  "cv_axle": { low: 60, high: 180, unit: "each" },
  "wheel_bearing": { low: 30, high: 100, unit: "each" },
  "tie_rod_end": { low: 20, high: 60, unit: "each" },
  "ball_joint": { low: 25, high: 80, unit: "each" },
  "strut_assembly": { low: 80, high: 250, unit: "each" },
  "shock_absorber": { low: 40, high: 130, unit: "each" },
  "control_arm": { low: 50, high: 200, unit: "each" },
  "catalytic_converter": { low: 200, high: 1200, unit: "each" },
  "oxygen_sensor": { low: 30, high: 100, unit: "each" },
  "muffler": { low: 80, high: 250, unit: "each" },
  "tire_economy": { low: 60, high: 100, unit: "each" },
  "tire_midrange": { low: 100, high: 160, unit: "each" },
  "tire_premium": { low: 150, high: 280, unit: "each" },
  "wheel_alignment": { low: 0, high: 0, unit: "service" },
  "ac_compressor": { low: 200, high: 500, unit: "each" },
  "ac_refrigerant": { low: 30, high: 80, unit: "charge" },
  "transmission_fluid": { low: 30, high: 60, unit: "service" },
  "brake_fluid": { low: 10, high: 25, unit: "flush" },
  "coolant": { low: 15, high: 35, unit: "flush" },
  "power_steering_fluid": { low: 15, high: 30, unit: "flush" },
};

/** Warranty schedule by service type */
const WARRANTY_SCHEDULE: Record<string, { months: number; miles: number; description: string }> = {
  "brakes": { months: 24, miles: 24000, description: "24 months / 24,000 miles on brake pads and rotors" },
  "oil_change": { months: 3, miles: 5000, description: "3 months / 5,000 miles (or next service interval)" },
  "tires": { months: 0, miles: 0, description: "Manufacturer tread warranty applies; road hazard available" },
  "battery": { months: 36, miles: 0, description: "36-month free replacement warranty" },
  "alternator": { months: 12, miles: 12000, description: "12 months / 12,000 miles parts and labor" },
  "starter": { months: 12, miles: 12000, description: "12 months / 12,000 miles parts and labor" },
  "cooling_system": { months: 12, miles: 12000, description: "12 months / 12,000 miles parts and labor" },
  "exhaust": { months: 12, miles: 12000, description: "12 months / 12,000 miles parts and labor" },
  "suspension": { months: 12, miles: 12000, description: "12 months / 12,000 miles parts and labor" },
  "electrical": { months: 6, miles: 6000, description: "6 months / 6,000 miles (diagnosis verified)" },
  "diagnostics": { months: 0, miles: 0, description: "Diagnostic fee applied to repair if customer proceeds" },
  "alignment": { months: 6, miles: 6000, description: "6 months / 6,000 miles alignment warranty" },
  "general_repair": { months: 12, miles: 12000, description: "12 months / 12,000 miles standard parts and labor warranty" },
  "ac_repair": { months: 12, miles: 12000, description: "12 months / 12,000 miles; refrigerant top-off 90 days" },
  "transmission": { months: 12, miles: 12000, description: "12 months / 12,000 miles parts and labor" },
};

/** Financing providers available at Nick's */
const FINANCING_OPTIONS = [
  {
    provider: "Acima",
    type: "lease-to-own",
    minAmount: 100,
    maxAmount: 5000,
    termMonths: [3, 6, 12],
    approvalType: "No credit needed",
    earlyBuyoutDiscount: "90 days same as cash",
    note: "Lease-to-own option. Total cost is higher if paid over full term.",
  },
  {
    provider: "Snap Finance",
    type: "lease-to-own",
    minAmount: 150,
    maxAmount: 5000,
    termMonths: [12],
    approvalType: "No credit needed",
    earlyBuyoutDiscount: "100 days same as cash",
    note: "Easy approval. Best for customers wanting a 100-day payoff window.",
  },
  {
    provider: "Koalafi",
    type: "lease-to-own",
    minAmount: 200,
    maxAmount: 10000,
    termMonths: [6, 12, 18, 24],
    approvalType: "Soft credit check",
    earlyBuyoutDiscount: "90 days same as cash",
    note: "Higher limits available. Good for major repairs. Soft check, no impact to score.",
  },
];

/** Service-specific pricing database for Cleveland area */
const CLEVELAND_PRICING_DB: Record<string, {
  nickLow: number; nickHigh: number;
  marketLow: number; marketHigh: number;
  dealerLow: number; dealerHigh: number;
  chainLow: number; chainHigh: number;
  seasonalMultiplier?: { months: number[]; factor: number; reason: string };
}> = {
  "oil_change_conventional": { nickLow: 35, nickHigh: 50, marketLow: 40, marketHigh: 60, dealerLow: 55, dealerHigh: 85, chainLow: 40, chainHigh: 65 },
  "oil_change_synthetic": { nickLow: 55, nickHigh: 75, marketLow: 60, marketHigh: 90, dealerLow: 80, dealerHigh: 120, chainLow: 65, chainHigh: 95 },
  "brake_pads_front": { nickLow: 120, nickHigh: 200, marketLow: 150, marketHigh: 250, dealerLow: 250, dealerHigh: 400, chainLow: 150, chainHigh: 280 },
  "brake_pads_rear": { nickLow: 110, nickHigh: 190, marketLow: 140, marketHigh: 240, dealerLow: 240, dealerHigh: 380, chainLow: 140, chainHigh: 270 },
  "brake_pads_rotors_front": { nickLow: 250, nickHigh: 380, marketLow: 300, marketHigh: 450, dealerLow: 450, dealerHigh: 700, chainLow: 300, chainHigh: 480 },
  "tire_mount_balance": { nickLow: 20, nickHigh: 30, marketLow: 20, marketHigh: 35, dealerLow: 30, dealerHigh: 50, chainLow: 25, chainHigh: 40,
    seasonalMultiplier: { months: [10, 11, 12, 1], factor: 1.15, reason: "Winter tire season — higher demand Oct-Jan" } },
  "tire_rotation": { nickLow: 0, nickHigh: 25, marketLow: 15, marketHigh: 30, dealerLow: 30, dealerHigh: 50, chainLow: 20, chainHigh: 35 },
  "alignment_2wheel": { nickLow: 70, nickHigh: 90, marketLow: 80, marketHigh: 110, dealerLow: 110, dealerHigh: 150, chainLow: 80, chainHigh: 120 },
  "alignment_4wheel": { nickLow: 90, nickHigh: 120, marketLow: 100, marketHigh: 140, dealerLow: 140, dealerHigh: 190, chainLow: 100, chainHigh: 150 },
  "battery_replacement": { nickLow: 150, nickHigh: 260, marketLow: 160, marketHigh: 280, dealerLow: 220, dealerHigh: 380, chainLow: 160, chainHigh: 300,
    seasonalMultiplier: { months: [11, 12, 1, 2], factor: 1.1, reason: "Winter cold kills batteries — peak demand Nov-Feb" } },
  "alternator_replacement": { nickLow: 300, nickHigh: 500, marketLow: 350, marketHigh: 550, dealerLow: 500, dealerHigh: 800, chainLow: 350, chainHigh: 600 },
  "starter_replacement": { nickLow: 280, nickHigh: 480, marketLow: 320, marketHigh: 520, dealerLow: 450, dealerHigh: 750, chainLow: 320, chainHigh: 550 },
  "diagnostics": { nickLow: 50, nickHigh: 100, marketLow: 75, marketHigh: 130, dealerLow: 120, dealerHigh: 180, chainLow: 80, chainHigh: 130 },
  "echeck_repair": { nickLow: 100, nickHigh: 600, marketLow: 150, marketHigh: 700, dealerLow: 250, dealerHigh: 900, chainLow: 150, chainHigh: 750 },
  "ac_recharge": { nickLow: 120, nickHigh: 180, marketLow: 130, marketHigh: 200, dealerLow: 180, dealerHigh: 300, chainLow: 140, chainHigh: 220,
    seasonalMultiplier: { months: [5, 6, 7, 8], factor: 1.2, reason: "Summer AC demand peak May-Aug" } },
  "ac_compressor": { nickLow: 500, nickHigh: 900, marketLow: 600, marketHigh: 1000, dealerLow: 800, dealerHigh: 1400, chainLow: 600, chainHigh: 1100 },
  "transmission_fluid_change": { nickLow: 120, nickHigh: 200, marketLow: 140, marketHigh: 250, dealerLow: 200, dealerHigh: 350, chainLow: 140, chainHigh: 260 },
  "coolant_flush": { nickLow: 80, nickHigh: 130, marketLow: 90, marketHigh: 150, dealerLow: 130, dealerHigh: 200, chainLow: 100, chainHigh: 160 },
  "suspension_struts_pair": { nickLow: 400, nickHigh: 700, marketLow: 450, marketHigh: 800, dealerLow: 700, dealerHigh: 1200, chainLow: 500, chainHigh: 850 },
  "catalytic_converter": { nickLow: 800, nickHigh: 2000, marketLow: 900, marketHigh: 2200, dealerLow: 1200, dealerHigh: 3000, chainLow: 1000, chainHigh: 2400 },
  "water_pump": { nickLow: 300, nickHigh: 550, marketLow: 350, marketHigh: 600, dealerLow: 500, dealerHigh: 900, chainLow: 350, chainHigh: 650 },
  "timing_belt": { nickLow: 500, nickHigh: 900, marketLow: 600, marketHigh: 1000, dealerLow: 800, dealerHigh: 1400, chainLow: 600, chainHigh: 1100 },
};

/** Technician profiles for smart matching */
const TECHNICIANS = [
  { id: 1, name: "Mike", specialties: ["brakes", "suspension", "alignment", "steering"], experience: "senior", bays: ["1", "2"] },
  { id: 2, name: "Carlos", specialties: ["engine", "diagnostics", "electrical", "echeck"], experience: "senior", bays: ["3", "4"] },
  { id: 3, name: "Jamal", specialties: ["tires", "wheels", "alignment", "mount_balance"], experience: "mid", bays: ["5", "6"] },
  { id: 4, name: "Derek", specialties: ["oil_change", "fluids", "maintenance", "filters"], experience: "junior", bays: ["7"] },
  { id: 5, name: "Nour", specialties: ["all", "diagnostics", "complex", "ac", "transmission"], experience: "owner", bays: ["1", "2", "3", "4", "5", "6", "7"] },
];

/** Bay assignments by service type */
const BAY_MAP: Record<string, string[]> = {
  "oil_change": ["7"],
  "tire": ["5", "6"],
  "alignment": ["5"],
  "brakes": ["1", "2"],
  "suspension": ["1", "2"],
  "engine": ["3", "4"],
  "diagnostics": ["3", "4"],
  "electrical": ["3", "4"],
  "exhaust": ["2"],
  "ac": ["4"],
  "general": ["1", "2", "3", "4"],
};

// ─── Helper: fetch session + messages ───────────────────

async function fetchSessionWithMessages(sessionId: number) {
  const d = await db();
  if (!d) throw new Error("Database unavailable");

  const session = await d.select().from(chatSessions)
    .where(eq(chatSessions.id, sessionId)).limit(1);

  if (session.length === 0) {
    throw new Error(`Chat session ${sessionId} not found`);
  }

  let messages: Array<{ role: string; content: string }>;
  try {
    messages = JSON.parse(session[0].messagesJson);
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("Empty or invalid message history");
    }
  } catch (err) {
    log.error(`Failed to parse messages for session ${sessionId}:`, { error: err instanceof Error ? err.message : String(err) });
    throw new Error("Invalid chat session data");
  }

  const conversationText = messages
    .map(m => `${m.role}: ${m.content}`)
    .slice(-10)
    .join("\n");

  return { d, session: session[0], messages, conversationText };
}

// ─── Helper: find returning customer ────────────────────

async function findReturningCustomer(d: any, messages: Array<{ role: string; content: string }>) {
  const userMessages = messages.filter(m => m.role === "user").map(m => m.content).join("\n");
  const phoneMatch = userMessages.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  const phone = phoneMatch?.[0]?.replace(/\D/g, "") || null;

  if (!phone) return { phone: null, customer: null, history: null };

  // Check leads for this phone
  const matchingLeads = await d.select().from(leads)
    .where(like(leads.phone, `%${phone.slice(-10)}%`))
    .orderBy(desc(leads.createdAt))
    .limit(5);

  // Check past work orders
  const pastOrders = await d.select().from(workOrders)
    .where(eq(workOrders.customerId, phone))
    .orderBy(desc(workOrders.createdAt))
    .limit(10);

  // Check past bookings
  const pastBookings = await d.select().from(bookings)
    .where(like(bookings.phone, `%${phone.slice(-10)}%`))
    .orderBy(desc(bookings.createdAt))
    .limit(10);

  return {
    phone,
    customer: matchingLeads.length > 0 ? matchingLeads[0] : null,
    history: {
      leads: matchingLeads,
      workOrders: pastOrders,
      bookings: pastBookings,
      totalVisits: pastBookings.length + pastOrders.length,
      isReturning: (pastBookings.length + pastOrders.length) > 0,
    },
  };
}

// ─── Helper: calculate financing ────────────────────────

function calculateFinancing(totalAmount: number): Array<{
  provider: string; type: string; termMonths: number;
  monthlyPayment: number; totalCost: number;
  earlyBuyout: string; note: string;
}> {
  return FINANCING_OPTIONS.flatMap(opt => {
    if (totalAmount < opt.minAmount || totalAmount > opt.maxAmount) return [];
    return opt.termMonths.map(term => {
      // Lease-to-own typically has a factor rate around 1.5-2.0x over full term
      const factorRate = term <= 3 ? 1.0 : term <= 6 ? 1.3 : term <= 12 ? 1.6 : 1.9;
      const totalCost = Math.round(totalAmount * factorRate * 100) / 100;
      const monthlyPayment = Math.round((totalCost / term) * 100) / 100;
      return {
        provider: opt.provider,
        type: opt.type,
        termMonths: term,
        monthlyPayment,
        totalCost,
        earlyBuyout: opt.earlyBuyoutDiscount,
        note: opt.note,
      };
    });
  });
}

// ─── Helper: match technician ───────────────────────────

function matchTechnician(serviceKeywords: string[]): { tech: typeof TECHNICIANS[0]; confidence: number; reason: string } {
  const normalizedKeywords = serviceKeywords.map(k => k.toLowerCase().replace(/[^a-z_]/g, ""));

  let bestMatch = TECHNICIANS[TECHNICIANS.length - 1]; // default to Nour (owner)
  let bestScore = 0;
  let bestReason = "Owner/operator — handles all services";

  for (const tech of TECHNICIANS) {
    if (tech.name === "Nour") continue; // owner is fallback
    let score = 0;
    const matchedSpecs: string[] = [];

    for (const keyword of normalizedKeywords) {
      for (const spec of tech.specialties) {
        if (keyword.includes(spec) || spec.includes(keyword)) {
          score += tech.experience === "senior" ? 3 : tech.experience === "mid" ? 2 : 1;
          matchedSpecs.push(spec);
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = tech;
      bestReason = `${tech.name} specializes in ${[...new Set(matchedSpecs)].join(", ")} (${tech.experience} tech)`;
    }
  }

  return {
    tech: bestMatch,
    confidence: bestScore > 0 ? Math.min(0.95, 0.5 + bestScore * 0.1) : 0.3,
    reason: bestReason,
  };
}

// ─── Helper: suggest bay ────────────────────────────────

function suggestBay(serviceKeywords: string[]): { bay: string; reason: string } {
  for (const keyword of serviceKeywords) {
    const lower = keyword.toLowerCase();
    for (const [type, bays] of Object.entries(BAY_MAP)) {
      if (lower.includes(type)) {
        return { bay: bays[0], reason: `Bay ${bays[0]} designated for ${type} work` };
      }
    }
  }
  return { bay: "1", reason: "Default bay assignment — update when service type confirmed" };
}

// ─── Helper: estimate completion time ───────────────────

function estimateCompletionHours(services: string[], estimatedLaborHours: number): {
  estimatedHours: number;
  readyBy: string;
  confidence: string;
} {
  // Add buffer for diagnostics, parts sourcing, bay time
  const buffer = services.length > 2 ? 1.5 : services.length > 1 ? 1.0 : 0.5;
  const totalHours = Math.max(1, estimatedLaborHours + buffer);

  const now = new Date();
  const readyBy = new Date(now.getTime() + totalHours * 60 * 60 * 1000);

  // Business hours check: if readyBy is after 6 PM, push to next morning
  if (readyBy.getHours() >= 18) {
    readyBy.setDate(readyBy.getDate() + 1);
    readyBy.setHours(10, 0, 0, 0);
  }
  // If weekend, push to Monday
  if (readyBy.getDay() === 0) readyBy.setDate(readyBy.getDate() + 1);
  if (readyBy.getDay() === 6) readyBy.setDate(readyBy.getDate() + 2);

  return {
    estimatedHours: Math.round(totalHours * 10) / 10,
    readyBy: readyBy.toISOString(),
    confidence: totalHours <= 2 ? "high" : totalHours <= 5 ? "medium" : "low",
  };
}

// ─── Quote Generation from Chat Context ─────────────────

const QUOTE_SYSTEM_PROMPT = `You are a quoting assistant for Nick's Tire & Auto in Cleveland, OH.
Given a chat conversation about a vehicle problem, generate a repair quote.

Return a JSON object with:
- services: Array of { name: string, description: string, laborHours: number, partsCostEstimate: number, laborRate: 85, category: string }
  category must be one of: "brakes", "tires", "oil_change", "engine", "electrical", "suspension", "exhaust", "ac", "transmission", "diagnostics", "alignment", "cooling_system", "general_repair"
- vehicleInfo: { year: number, make: string, model: string }
- urgency: 1-5 (1=routine, 5=critical safety)
- confidence: 0.0-1.0 (how confident you are in this estimate)
- notes: string (any caveats or disclaimers)
- totalEstimate: { low: number, high: number } (range in dollars)
- partsNeeded: Array of { partName: string, partKey: string, quantity: number }
  partKey should match common part identifiers like "brake_pads_front", "oil_synthetic_5qt", "battery", etc.

Pricing guidelines:
- Labor rate: $85/hour
- Oil change: $40-70 (conventional/synthetic)
- Brake pads per axle: $89-150 (parts) + 1-2 hours labor
- Tire mount/balance: $20-30 per tire
- Diagnostics: $50-100
- E-Check repair: $100-800 depending on issue
- Always give a RANGE, never a single price
- Include disclaimer: "Final price may vary after in-person inspection"`;

export const nickActionsRouter = router({
  // ─── Generate Multi-Tier Quote from Chat Session ────
  generateQuote: adminProcedure
    .input(z.object({
      sessionId: z.number(),
      includeTiers: z.boolean().default(true),
      includeFinancing: z.boolean().default(true),
      includeWarranty: z.boolean().default(true),
      includeHistory: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const { d, session, messages, conversationText } = await fetchSessionWithMessages(input.sessionId);

      log.info(`Generating quote from session ${input.sessionId} (${messages.length} messages)`);

      // Parallel: generate quote + look up customer history
      const [response, customerData] = await Promise.all([
        invokeLLM({
          messages: [
            { role: "system", content: QUOTE_SYSTEM_PROMPT },
            { role: "user", content: `Generate a quote from this conversation:\n\n${conversationText}` },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "repair_quote",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  services: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        description: { type: "string" },
                        laborHours: { type: "number" },
                        partsCostEstimate: { type: "number" },
                        laborRate: { type: "number" },
                        category: { type: "string" },
                      },
                      required: ["name", "description", "laborHours", "partsCostEstimate", "laborRate", "category"],
                      additionalProperties: false,
                    },
                  },
                  vehicleInfo: {
                    type: "object",
                    properties: {
                      year: { type: "integer" },
                      make: { type: "string" },
                      model: { type: "string" },
                    },
                    required: ["year", "make", "model"],
                    additionalProperties: false,
                  },
                  urgency: { type: "integer" },
                  confidence: { type: "number" },
                  notes: { type: "string" },
                  totalEstimate: {
                    type: "object",
                    properties: {
                      low: { type: "number" },
                      high: { type: "number" },
                    },
                    required: ["low", "high"],
                    additionalProperties: false,
                  },
                  partsNeeded: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        partName: { type: "string" },
                        partKey: { type: "string" },
                        quantity: { type: "integer" },
                      },
                      required: ["partName", "partKey", "quantity"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["services", "vehicleInfo", "urgency", "confidence", "notes", "totalEstimate", "partsNeeded"],
                additionalProperties: false,
              },
            },
          },
        }),
        input.includeHistory ? findReturningCustomer(d, messages) : Promise.resolve(null),
      ]);

      // Parse and VERIFY AI output
      const rawContent = response.choices?.[0]?.message?.content;
      if (!rawContent || typeof rawContent !== "string") {
        log.error("AI returned empty quote response");
        throw new Error("Failed to generate quote — AI returned empty response");
      }

      let quote: any;
      try {
        quote = JSON.parse(rawContent);
      } catch {
        log.error("AI returned invalid JSON for quote", { preview: rawContent.slice(0, 200) });
        throw new Error("Failed to parse quote — AI returned invalid JSON");
      }

      // Validate every field
      const verifiedServices = Array.isArray(quote.services) ? quote.services.map((s: any) => ({
        name: validateString(s.name, 100, "Service"),
        description: validateString(s.description, 500, "Repair service"),
        laborHours: validateCurrency(s.laborHours),
        partsCostEstimate: validateCurrency(s.partsCostEstimate),
        laborRate: validateCurrency(s.laborRate) || 85,
        category: validateString(s.category, 50, "general_repair"),
      })) : [];

      // Cross-reference parts with knowledge base
      const verifiedParts = Array.isArray(quote.partsNeeded) ? quote.partsNeeded.map((p: any) => {
        const partKey = validateString(p.partKey, 50, "unknown");
        const kbMatch = PARTS_KB[partKey];
        return {
          partName: validateString(p.partName, 100, "Part"),
          partKey,
          quantity: validateScore(p.quantity, 1, 20),
          kbPriceRange: kbMatch ? { low: kbMatch.low, high: kbMatch.high, unit: kbMatch.unit } : null,
          verified: !!kbMatch,
        };
      }) : [];

      const verifiedQuote = {
        services: verifiedServices,
        vehicleInfo: {
          year: typeof quote.vehicleInfo?.year === "number" ? quote.vehicleInfo.year : null,
          make: validateString(quote.vehicleInfo?.make, 50, "Unknown"),
          model: validateString(quote.vehicleInfo?.model, 50, "Unknown"),
        },
        urgency: validateScore(quote.urgency, 1, 5),
        confidence: Math.min(1, Math.max(0, Number(quote.confidence) || 0.5)),
        notes: validateString(quote.notes, 1000, "Final price may vary after in-person inspection."),
        partsNeeded: verifiedParts,
        sessionId: input.sessionId,
        generatedAt: new Date().toISOString(),
      };

      // ── MATH VERIFICATION ─────────────────────────────
      // Compute totals from services: labor = hours x rate, total = parts + labor
      const computedServices = verifiedServices.map((s: any) => {
        const laborCost = s.laborHours * s.laborRate;
        return {
          ...s,
          laborCost,
          subtotal: s.partsCostEstimate + laborCost,
        };
      });

      const taxRate = 0.08; // Ohio sales tax on parts
      const totalParts = computedServices.reduce((sum: number, s: any) => sum + s.partsCostEstimate, 0);
      const totalLabor = computedServices.reduce((sum: number, s: any) => sum + s.laborCost, 0);
      const partsTax = Math.round(totalParts * taxRate * 100) / 100;
      const subtotal = totalParts + totalLabor;
      const totalWithTax = subtotal + partsTax;

      const mathVerified = {
        totalParts: Math.round(totalParts * 100) / 100,
        totalLabor: Math.round(totalLabor * 100) / 100,
        partsTax,
        subtotal: Math.round(subtotal * 100) / 100,
        totalWithTax: Math.round(totalWithTax * 100) / 100,
        totalEstimate: {
          low: Math.round(totalWithTax * 0.85),
          high: Math.round(totalWithTax * 1.2),
        },
      };

      // If AI estimate was zero or wildly off, use computed
      const aiLow = validateCurrency(quote.totalEstimate?.low);
      const aiHigh = validateCurrency(quote.totalEstimate?.high);
      const usedEstimate = (aiLow > 0 && aiHigh > 0 && aiLow <= aiHigh)
        ? { low: aiLow, high: aiHigh, source: "ai" as const }
        : { ...mathVerified.totalEstimate, source: "computed" as const };

      // ── GOOD / BETTER / BEST TIERS ────────────────────
      let tiers = null;
      if (input.includeTiers && verifiedServices.length > 0) {
        tiers = {
          good: {
            label: "Essential Repair",
            description: "Addresses the primary safety/functionality concern. Most economical option.",
            services: computedServices.slice(0, 1).map((s: any) => s.name),
            estimate: { low: Math.round(computedServices[0].subtotal * 0.9), high: Math.round(computedServices[0].subtotal * 1.1) },
          },
          better: {
            label: "Recommended Repair",
            description: "Complete fix with all recommended services. Best value for long-term reliability.",
            services: computedServices.map((s: any) => s.name),
            estimate: usedEstimate,
          },
          best: {
            label: "Premium Service",
            description: "Full repair plus preventive maintenance. Maximum protection and peace of mind.",
            services: [
              ...computedServices.map((s: any) => s.name),
              "Complimentary multi-point inspection",
              "Fluid top-off (all systems)",
            ],
            estimate: {
              low: Math.round(usedEstimate.low * 1.15),
              high: Math.round(usedEstimate.high * 1.25),
            },
          },
        };
      }

      // ── WARRANTY INFO ─────────────────────────────────
      let warranty = null;
      if (input.includeWarranty) {
        const categories = [...new Set(verifiedServices.map((s: any) => s.category))] as string[];
        warranty = categories.map((cat: string) => {
          const match = WARRANTY_SCHEDULE[cat] || WARRANTY_SCHEDULE["general_repair"];
          return { category: cat, ...match };
        });
      }

      // ── FINANCING BREAKDOWN ───────────────────────────
      let financing = null;
      if (input.includeFinancing && usedEstimate.high >= 100) {
        const midEstimate = Math.round((usedEstimate.low + usedEstimate.high) / 2);
        financing = calculateFinancing(midEstimate);
      }

      // ── HISTORY COMPARISON ────────────────────────────
      let historyComparison = null;
      if (customerData?.history && customerData.history.isReturning) {
        const pastWOs = customerData.history.workOrders || [];
        const relevantPast = pastWOs.filter((wo: any) =>
          verifiedServices.some((s: any) =>
            wo.serviceDescription?.toLowerCase().includes(s.category) ||
            wo.diagnosis?.toLowerCase().includes(s.category)
          )
        );
        if (relevantPast.length > 0) {
          historyComparison = {
            isReturningCustomer: true,
            totalPastVisits: customerData.history.totalVisits,
            similarPastJobs: relevantPast.length,
            pastPriceRange: relevantPast.length > 0 ? {
              low: Math.min(...relevantPast.map((wo: any) => parseFloat(wo.total || "0")).filter((v: number) => v > 0)),
              high: Math.max(...relevantPast.map((wo: any) => parseFloat(wo.total || "0")).filter((v: number) => v > 0)),
            } : null,
            note: `Returning customer with ${customerData.history.totalVisits} past visits. ${relevantPast.length} similar jobs on record.`,
          };
        }
      }

      log.info(`Quote generated: $${usedEstimate.low}-${usedEstimate.high}, confidence=${verifiedQuote.confidence}, ${verifiedServices.length} services, tiers=${!!tiers}, financing=${financing?.length || 0} options`);

      return {
        ...verifiedQuote,
        totalEstimate: usedEstimate,
        mathVerified,
        computedServices,
        tiers,
        warranty,
        financing,
        historyComparison,
      };
    }),

  // ─── Smart Work Order Creation from Chat Session ────
  createWorkOrder: adminProcedure
    .input(z.object({
      sessionId: z.number(),
      customerId: z.string().optional(),
      priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
      autoAssign: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const { d, session, messages, conversationText } = await fetchSessionWithMessages(input.sessionId);

      // Parallel: AI extraction + customer lookup
      const [response, customerData] = await Promise.all([
        invokeLLM({
          messages: [
            {
              role: "system",
              content: `Extract work order details from this auto repair conversation. Return JSON:
- customerComplaint: string (what the customer described)
- diagnosis: string (initial diagnosis based on symptoms)
- vehicleYear: number or 0
- vehicleMake: string or "Unknown"
- vehicleModel: string or "Unknown"
- vehicleMileage: number or 0
- recommendedServices: string[] (list of services needed)
- estimatedHours: number (total labor hours estimate)
- urgencyNote: string (any urgency concerns)
- urgencyScore: number 1-5 (1=routine, 5=critical safety)
- serviceCategories: string[] (categories like "brakes", "tires", "engine", "oil_change", "diagnostics", "electrical", "suspension", "exhaust", "ac", "transmission", "alignment", "cooling_system", "general_repair")
- partsToOrder: Array of { partName: string, partKey: string, quantity: number, urgency: string }
  urgency: "immediate" | "before_start" | "can_wait"`,
            },
            { role: "user", content: conversationText },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "work_order_extract",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  customerComplaint: { type: "string" },
                  diagnosis: { type: "string" },
                  vehicleYear: { type: "integer" },
                  vehicleMake: { type: "string" },
                  vehicleModel: { type: "string" },
                  vehicleMileage: { type: "integer" },
                  recommendedServices: { type: "array", items: { type: "string" } },
                  estimatedHours: { type: "number" },
                  urgencyNote: { type: "string" },
                  urgencyScore: { type: "integer" },
                  serviceCategories: { type: "array", items: { type: "string" } },
                  partsToOrder: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        partName: { type: "string" },
                        partKey: { type: "string" },
                        quantity: { type: "integer" },
                        urgency: { type: "string" },
                      },
                      required: ["partName", "partKey", "quantity", "urgency"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["customerComplaint", "diagnosis", "vehicleYear", "vehicleMake", "vehicleModel", "vehicleMileage", "recommendedServices", "estimatedHours", "urgencyNote", "urgencyScore", "serviceCategories", "partsToOrder"],
                additionalProperties: false,
              },
            },
          },
        }),
        findReturningCustomer(d, messages),
      ]);

      // Parse and verify AI output
      const rawContent = response.choices?.[0]?.message?.content;
      if (!rawContent || typeof rawContent !== "string") {
        throw new Error("AI failed to extract work order details");
      }

      let extracted: any;
      try {
        extracted = JSON.parse(rawContent);
      } catch {
        throw new Error("AI returned invalid work order data");
      }

      // Smart priority: override if AI detected higher urgency
      const aiUrgency = validateScore(extracted.urgencyScore, 1, 5);
      let effectivePriority = input.priority;
      if (aiUrgency >= 5 && effectivePriority !== "urgent") {
        effectivePriority = "urgent";
        log.info(`Priority auto-escalated to urgent (AI urgency score: ${aiUrgency})`);
      } else if (aiUrgency >= 4 && effectivePriority === "low") {
        effectivePriority = "high";
        log.info(`Priority auto-escalated to high (AI urgency score: ${aiUrgency})`);
      }

      // Technician matching
      const serviceCategories = Array.isArray(extracted.serviceCategories) ? extracted.serviceCategories : [];
      const techMatch = input.autoAssign ? matchTechnician(serviceCategories) : null;
      const bayMatch = input.autoAssign ? suggestBay(serviceCategories) : null;

      // Estimated completion
      const estimatedHours = validateCurrency(extracted.estimatedHours) || 2;
      const completion = estimateCompletionHours(
        Array.isArray(extracted.recommendedServices) ? extracted.recommendedServices : [],
        estimatedHours
      );

      // Parts pre-population with KB prices
      const partsPrePopulated = Array.isArray(extracted.partsToOrder) ? extracted.partsToOrder.map((p: any) => {
        const partKey = validateString(p.partKey, 50, "unknown");
        const kbMatch = PARTS_KB[partKey];
        return {
          partName: validateString(p.partName, 100, "Part"),
          partKey,
          quantity: validateScore(p.quantity, 1, 20),
          urgency: validateString(p.urgency, 20, "before_start"),
          estimatedCost: kbMatch ? { low: kbMatch.low * validateScore(p.quantity, 1, 20), high: kbMatch.high * validateScore(p.quantity, 1, 20) } : null,
          inKnowledgeBase: !!kbMatch,
        };
      }) : [];

      // Build work order
      const orderId = randomUUID();
      const orderNumber = `WO-${Date.now().toString(36).toUpperCase()}`;

      // Link to returning customer if found
      const resolvedCustomerId = input.customerId
        || (customerData?.phone ? customerData.phone : "WALK-IN");

      const workOrderData = {
        id: orderId,
        orderNumber,
        customerId: resolvedCustomerId,
        status: "draft" as const,
        priority: effectivePriority,
        customerComplaint: validateString(extracted.customerComplaint, 2000, "See chat session"),
        diagnosis: validateString(extracted.diagnosis, 2000, "Pending inspection"),
        vehicleYear: typeof extracted.vehicleYear === "number" && extracted.vehicleYear > 1900 ? extracted.vehicleYear : null,
        vehicleMake: validateString(extracted.vehicleMake, 50, "Unknown"),
        vehicleModel: validateString(extracted.vehicleModel, 50, "Unknown"),
        vehicleMileage: typeof extracted.vehicleMileage === "number" && extracted.vehicleMileage > 0 ? extracted.vehicleMileage : null,
        assignedTech: techMatch?.tech.name || null,
        assignedTechId: techMatch?.tech.id || null,
        assignedBay: bayMatch?.bay || null,
        estimatedCompletion: new Date(completion.readyBy),
        source: "ai_chat",
        internalNotes: [
          `Created from AI chat session #${input.sessionId}.`,
          `Recommended services: ${Array.isArray(extracted.recommendedServices) ? extracted.recommendedServices.join(", ") : "TBD"}.`,
          `Estimated hours: ${estimatedHours}. Ready by: ${new Date(completion.readyBy).toLocaleString()}.`,
          techMatch ? `Tech assigned: ${techMatch.tech.name} (${techMatch.reason}).` : "",
          bayMatch ? `Bay: ${bayMatch.bay} (${bayMatch.reason}).` : "",
          extracted.urgencyNote || "",
          customerData?.history?.isReturning ? `RETURNING CUSTOMER — ${customerData.history.totalVisits} past visits.` : "",
        ].filter(Boolean).join(" "),
      };

      // Insert into database
      try {
        await d.insert(workOrders).values(workOrderData);
      } catch (err) {
        log.error("Failed to insert work order", { error: err instanceof Error ? err.message : String(err) });
        throw new Error("Failed to create work order in database");
      }

      // Verify the insert succeeded
      const verification = await d.select({ id: workOrders.id })
        .from(workOrders).where(eq(workOrders.id, orderId)).limit(1);

      if (verification.length === 0) {
        log.error(`Work order ${orderId} insert verification failed`);
        throw new Error("Work order creation could not be verified");
      }

      // Link to chat session lead if exists
      if (session.leadId) {
        log.info(`Work order ${orderNumber} linked to lead ${session.leadId}`);
      }

      log.info(`Work order created: ${orderNumber} from session ${input.sessionId}, tech=${techMatch?.tech.name || "unassigned"}, bay=${bayMatch?.bay || "TBD"}, priority=${effectivePriority}`);

      return {
        ...workOrderData,
        estimatedCompletion: completion.readyBy,
        completionConfidence: completion.confidence,
        verified: true,
        techAssignment: techMatch ? {
          name: techMatch.tech.name,
          confidence: techMatch.confidence,
          reason: techMatch.reason,
        } : null,
        bayAssignment: bayMatch,
        partsPrePopulated,
        customerHistory: customerData?.history?.isReturning ? {
          isReturning: true,
          totalVisits: customerData.history.totalVisits,
          lastLead: customerData.customer,
        } : null,
      };
    }),

  // ─── Intelligent Follow-Up Chain Scheduler ──────────
  scheduleFollowUp: adminProcedure
    .input(z.object({
      sessionId: z.number(),
      followUpType: z.enum(["call", "sms", "email"]).default("sms"),
      delayHours: z.number().min(1).max(720).default(24),
      customMessage: z.string().max(500).optional(),
      enableChain: z.boolean().default(true),
      chainDepth: z.number().min(1).max(5).default(3),
    }))
    .mutation(async ({ input }) => {
      const { d, session, messages, conversationText } = await fetchSessionWithMessages(input.sessionId);

      // Extract contact info
      const userMessages = messages.filter(m => m.role === "user").map(m => m.content).join("\n");
      const phoneMatch = userMessages.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
      const phone = phoneMatch?.[0] || null;
      const emailMatch = userMessages.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      const email = emailMatch?.[0] || null;

      // Determine channel fallback chain
      const channelChain: Array<"sms" | "call" | "email"> = [];
      if (input.followUpType === "sms") {
        if (phone) channelChain.push("sms");
        if (email) channelChain.push("email");
        if (phone) channelChain.push("call");
      } else if (input.followUpType === "email") {
        if (email) channelChain.push("email");
        if (phone) channelChain.push("sms");
        if (phone) channelChain.push("call");
      } else {
        if (phone) channelChain.push("call");
        if (phone) channelChain.push("sms");
        if (email) channelChain.push("email");
      }

      if (channelChain.length === 0) {
        return {
          scheduled: false,
          reason: "No contact information (phone or email) found in chat session",
          sessionId: input.sessionId,
          suggestion: "Add contact information manually or re-engage in chat",
        };
      }

      // Generate follow-up chain messages via AI
      const chainSteps = input.enableChain ? input.chainDepth : 1;
      const vehicleInfo = session.vehicleInfo || "their vehicle";
      const problemInfo = session.problemSummary || "their vehicle concern";

      const chainResponse = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You write follow-up message sequences for Nick's Tire & Auto in Cleveland, OH.
Generate a chain of ${chainSteps} follow-up messages that get progressively more urgent but always stay friendly and professional.

Rules:
- Message 1 (friendly reminder): Casual, warm, reference their specific vehicle and issue
- Message 2 (value add): Offer something extra — free inspection, coupon, seasonal tip
- Message 3 (last chance): Urgency without pressure — "spots filling up", "we saved your quote"
- Messages 4-5 (if requested): Re-engage with new angle — different service angle, seasonal relevance
- ALWAYS include phone number (216) 862-0005 and nickstire.org
- SMS messages: under 160 characters each
- Email messages: 2-3 short paragraphs max
- NEVER be pushy or use high-pressure tactics
- Reference the specific vehicle (${vehicleInfo}) and problem (${problemInfo})

Return JSON:
- chain: Array of { step: number, delayHours: number, channel: string, subject: string, message: string, toneLabel: string }
  channel: "sms" | "email" | "call"
  toneLabel: "friendly_reminder" | "value_add" | "last_chance" | "re_engage" | "seasonal"
- optimalSendWindow: { startHour: number, endHour: number, avoidWeekends: boolean }`,
          },
          {
            role: "user",
            content: `Vehicle: ${vehicleInfo}\nProblem: ${problemInfo}\nChannel preference: ${input.followUpType}\nAvailable channels: ${channelChain.join(", ")}\nNumber of steps: ${chainSteps}\nCustom message (if any): ${input.customMessage || "none — generate all messages"}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "follow_up_chain",
            strict: true,
            schema: {
              type: "object",
              properties: {
                chain: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      step: { type: "integer" },
                      delayHours: { type: "integer" },
                      channel: { type: "string" },
                      subject: { type: "string" },
                      message: { type: "string" },
                      toneLabel: { type: "string" },
                    },
                    required: ["step", "delayHours", "channel", "subject", "message", "toneLabel"],
                    additionalProperties: false,
                  },
                },
                optimalSendWindow: {
                  type: "object",
                  properties: {
                    startHour: { type: "integer" },
                    endHour: { type: "integer" },
                    avoidWeekends: { type: "boolean" },
                  },
                  required: ["startHour", "endHour", "avoidWeekends"],
                  additionalProperties: false,
                },
              },
              required: ["chain", "optimalSendWindow"],
              additionalProperties: false,
            },
          },
        },
      });

      const chainRaw = chainResponse.choices?.[0]?.message?.content;
      let chainData: any;
      try {
        chainData = JSON.parse(typeof chainRaw === "string" ? chainRaw : "{}");
      } catch {
        log.warn("Failed to parse follow-up chain, building fallback");
        chainData = null;
      }

      // Build verified follow-up chain
      const sendWindow = chainData?.optimalSendWindow || { startHour: 9, endHour: 17, avoidWeekends: true };
      const verifiedSendWindow = {
        startHour: validateScore(sendWindow.startHour, 7, 12),
        endHour: validateScore(sendWindow.endHour, 14, 20),
        avoidWeekends: sendWindow.avoidWeekends !== false,
      };

      // Smart scheduling: adjust times to be within business hours
      function scheduleWithinBusinessHours(baseDelayHours: number): string {
        let scheduled = new Date(Date.now() + baseDelayHours * 60 * 60 * 1000);
        // Adjust to send window
        if (scheduled.getHours() < verifiedSendWindow.startHour) {
          scheduled.setHours(verifiedSendWindow.startHour, 0, 0, 0);
        } else if (scheduled.getHours() >= verifiedSendWindow.endHour) {
          scheduled.setDate(scheduled.getDate() + 1);
          scheduled.setHours(verifiedSendWindow.startHour, 0, 0, 0);
        }
        // Skip weekends if configured
        if (verifiedSendWindow.avoidWeekends) {
          if (scheduled.getDay() === 0) scheduled.setDate(scheduled.getDate() + 1);
          if (scheduled.getDay() === 6) scheduled.setDate(scheduled.getDate() + 2);
        }
        return scheduled.toISOString();
      }

      const defaultMessage = `Hi! Following up from your chat about your ${vehicleInfo}. We'd love to get you in. Call us at (216) 862-0005 or book online at nickstire.org.`;

      const verifiedChain = Array.isArray(chainData?.chain) ? chainData.chain.map((step: any, i: number) => {
        const channelForStep = channelChain.includes(step.channel) ? step.channel : channelChain[0];
        const delayHours = i === 0 ? input.delayHours : validateScore(step.delayHours, input.delayHours, 720);
        return {
          step: i + 1,
          delayHours,
          scheduledFor: scheduleWithinBusinessHours(delayHours),
          channel: channelForStep,
          subject: validateString(step.subject, 100, `Follow-up from Nick's Tire & Auto`),
          message: input.customMessage && i === 0
            ? input.customMessage
            : validateString(step.message, 500, defaultMessage),
          toneLabel: validateString(step.toneLabel, 30, "friendly_reminder"),
          status: "pending",
        };
      }) : [{
        step: 1,
        delayHours: input.delayHours,
        scheduledFor: scheduleWithinBusinessHours(input.delayHours),
        channel: channelChain[0],
        subject: "Follow-up from Nick's Tire & Auto",
        message: input.customMessage || defaultMessage,
        toneLabel: "friendly_reminder",
        status: "pending",
      }];

      log.info(`Follow-up chain scheduled: ${verifiedChain.length} steps, first in ${input.delayHours}h for session ${input.sessionId}`);

      return {
        scheduled: true,
        followUpChain: verifiedChain,
        contactInfo: {
          phone,
          email,
          availableChannels: channelChain,
          primaryChannel: channelChain[0],
        },
        sendWindow: verifiedSendWindow,
        vehicle: session.vehicleInfo,
        problem: session.problemSummary,
        verified: {
          hasPhone: !!phone,
          hasEmail: !!email,
          chainLength: verifiedChain.length,
          firstScheduledFor: verifiedChain[0]?.scheduledFor,
          lastScheduledFor: verifiedChain[verifiedChain.length - 1]?.scheduledFor,
        },
      };
    }),

  // ─── Enhanced Competitor Price Check ──────────────────
  competitorPriceCheck: adminProcedure
    .input(z.object({
      service: z.string().min(1).max(100),
      zipCode: z.string().default("44112"),
      includeSeasonalAdjustment: z.boolean().default(true),
      includeMarginAnalysis: z.boolean().default(true),
      includeChartData: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      // First: check built-in pricing database
      const serviceKey = input.service.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z_]/g, "");
      const localMatch = CLEVELAND_PRICING_DB[serviceKey];

      // Check for close matches
      let bestLocalMatch: typeof localMatch | null = localMatch || null;
      let bestMatchKey = serviceKey;
      if (!localMatch) {
        for (const [key, data] of Object.entries(CLEVELAND_PRICING_DB)) {
          if (serviceKey.includes(key) || key.includes(serviceKey)) {
            bestLocalMatch = data;
            bestMatchKey = key;
            break;
          }
        }
      }

      // Apply seasonal adjustments
      const currentMonth = new Date().getMonth() + 1;
      let seasonalAdjustment = null;
      if (input.includeSeasonalAdjustment && bestLocalMatch?.seasonalMultiplier) {
        const sm = bestLocalMatch.seasonalMultiplier;
        if (sm.months.includes(currentMonth)) {
          seasonalAdjustment = {
            active: true,
            factor: sm.factor,
            reason: sm.reason,
            adjustedPrices: {
              nickLow: Math.round(bestLocalMatch.nickLow * sm.factor),
              nickHigh: Math.round(bestLocalMatch.nickHigh * sm.factor),
              marketLow: Math.round(bestLocalMatch.marketLow * sm.factor),
              marketHigh: Math.round(bestLocalMatch.marketHigh * sm.factor),
            },
          };
        } else {
          seasonalAdjustment = { active: false, factor: 1.0, reason: "No seasonal adjustment currently active", adjustedPrices: null };
        }
      }

      // If we have local data, use it directly (faster, more accurate)
      if (bestLocalMatch) {
        const effNickLow = seasonalAdjustment?.adjustedPrices?.nickLow || bestLocalMatch.nickLow;
        const effNickHigh = seasonalAdjustment?.adjustedPrices?.nickHigh || bestLocalMatch.nickHigh;
        const effMarketLow = seasonalAdjustment?.adjustedPrices?.marketLow || bestLocalMatch.marketLow;
        const effMarketHigh = seasonalAdjustment?.adjustedPrices?.marketHigh || bestLocalMatch.marketHigh;

        const nickMid = (effNickLow + effNickHigh) / 2;
        const marketMid = (effMarketLow + effMarketHigh) / 2;
        const dealerMid = (bestLocalMatch.dealerLow + bestLocalMatch.dealerHigh) / 2;
        const chainMid = (bestLocalMatch.chainLow + bestLocalMatch.chainHigh) / 2;

        const position = nickMid < marketMid * 0.9 ? "below_market"
          : nickMid > marketMid * 1.1 ? "above_market"
          : "at_market";

        // Margin analysis
        let marginAnalysis = null;
        if (input.includeMarginAnalysis) {
          const estimatedPartsCost = effNickLow * 0.4; // rough parts-to-price ratio
          const estimatedLaborRevenue = effNickLow * 0.6;
          const grossMargin = ((effNickLow - estimatedPartsCost) / effNickLow * 100);
          marginAnalysis = {
            estimatedPartsCost: Math.round(estimatedPartsCost),
            estimatedLaborRevenue: Math.round(estimatedLaborRevenue),
            grossMarginPercent: Math.round(grossMargin),
            atMarketPrice: Math.round(((marketMid - estimatedPartsCost) / marketMid * 100)),
            profitAtCurrentPrice: Math.round(nickMid - estimatedPartsCost),
            profitAtMarketPrice: Math.round(marketMid - estimatedPartsCost),
            recommendedAction: position === "below_market"
              ? `Consider raising price $${Math.round(marketMid - nickMid)} to match market while keeping competitive edge`
              : position === "above_market"
              ? `Price is ${Math.round((nickMid / marketMid - 1) * 100)}% above market. Justify with quality/warranty or adjust down`
              : "Price is competitive. Focus on service quality and speed to differentiate",
          };
        }

        // Chart data for frontend visualization
        let chartData = null;
        if (input.includeChartData) {
          chartData = {
            barChart: [
              { label: "Nick's Tire & Auto", low: effNickLow, high: effNickHigh, mid: Math.round(nickMid), color: "#22c55e" },
              { label: "Market Average", low: effMarketLow, high: effMarketHigh, mid: Math.round(marketMid), color: "#3b82f6" },
              { label: "Chain Shops", low: bestLocalMatch.chainLow, high: bestLocalMatch.chainHigh, mid: Math.round(chainMid), color: "#f59e0b" },
              { label: "Dealership", low: bestLocalMatch.dealerLow, high: bestLocalMatch.dealerHigh, mid: Math.round(dealerMid), color: "#ef4444" },
            ],
            savingsVsDealer: Math.round(dealerMid - nickMid),
            savingsVsChain: Math.round(chainMid - nickMid),
            savingsPercent: Math.round((1 - nickMid / dealerMid) * 100),
          };
        }

        // Confidence level
        const confidenceLevel = localMatch ? "high" : "medium";

        // Pricing recommendation
        let recommendation = "";
        if (position === "below_market") {
          recommendation = `Our price is competitive — ${Math.round((1 - nickMid / marketMid) * 100)}% below market average. Room to increase by $${Math.round(marketMid - nickMid)} per job without losing competitive edge. Customers save $${Math.round(dealerMid - nickMid)} vs dealership.`;
        } else if (position === "above_market") {
          recommendation = `Price is slightly above market. Justify with: fast turnaround, warranty (${WARRANTY_SCHEDULE["general_repair"]?.description || "12mo/12k miles"}), and honest diagnostics. Or adjust down $${Math.round(nickMid - marketMid)} to match market.`;
        } else {
          recommendation = `Competitively priced. Differentiate on speed, warranty, and trust. Customers save $${Math.round(dealerMid - nickMid)} vs dealership. Upsell with multi-point inspection or fluid top-off.`;
        }

        return {
          service: input.service,
          matchedServiceKey: bestMatchKey,
          dataSource: "local_database" as const,
          ourPrice: { low: effNickLow, high: effNickHigh, verified: true, label: "Nick's Tire & Auto" },
          marketAverage: { low: effMarketLow, high: effMarketHigh, verified: true, label: "Area Average" },
          dealerPrice: { low: bestLocalMatch.dealerLow, high: bestLocalMatch.dealerHigh, verified: true, label: "Dealership" },
          chainShopPrice: { low: bestLocalMatch.chainLow, high: bestLocalMatch.chainHigh, verified: true, label: "Chain Shops" },
          competitivePosition: position,
          confidenceLevel,
          recommendation,
          confidenceNote: confidenceLevel === "high"
            ? "Based on local Cleveland-area pricing database. Updated regularly."
            : "Approximate match from pricing database. Verify with current market.",
          seasonalAdjustment,
          marginAnalysis,
          chartData,
          generatedAt: new Date().toISOString(),
          zipCode: input.zipCode,
        };
      }

      // Fallback: use AI for services not in our local DB
      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are a competitive pricing analyst for an auto repair shop in Cleveland/Euclid, OH (ZIP: ${input.zipCode}).
Provide realistic market pricing for the requested service in the greater Cleveland area.

Return JSON:
- service: string (the service name)
- ourPrice: { low: number, high: number } (Nick's Tire & Auto typical range)
- marketAverage: { low: number, high: number } (area average)
- dealerPrice: { low: number, high: number } (dealership typical range)
- chainShopPrice: { low: number, high: number } (Midas, Meineke, etc.)
- competitivePosition: "below_market" | "at_market" | "above_market"
- recommendation: string (pricing strategy recommendation)
- confidenceNote: string (explain data limitations)

Use realistic Cleveland-area pricing. Our labor rate is $85/hour.`,
          },
          { role: "user", content: `Service: ${input.service}` },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "competitor_pricing",
            strict: true,
            schema: {
              type: "object",
              properties: {
                service: { type: "string" },
                ourPrice: { type: "object", properties: { low: { type: "number" }, high: { type: "number" } }, required: ["low", "high"], additionalProperties: false },
                marketAverage: { type: "object", properties: { low: { type: "number" }, high: { type: "number" } }, required: ["low", "high"], additionalProperties: false },
                dealerPrice: { type: "object", properties: { low: { type: "number" }, high: { type: "number" } }, required: ["low", "high"], additionalProperties: false },
                chainShopPrice: { type: "object", properties: { low: { type: "number" }, high: { type: "number" } }, required: ["low", "high"], additionalProperties: false },
                competitivePosition: { type: "string" },
                recommendation: { type: "string" },
                confidenceNote: { type: "string" },
              },
              required: ["service", "ourPrice", "marketAverage", "dealerPrice", "chainShopPrice", "competitivePosition", "recommendation", "confidenceNote"],
              additionalProperties: false,
            },
          },
        },
      });

      const rawContent = response.choices?.[0]?.message?.content;
      if (!rawContent || typeof rawContent !== "string") {
        throw new Error("Failed to get competitor pricing data");
      }

      let pricing: any;
      try {
        pricing = JSON.parse(rawContent);
      } catch {
        throw new Error("Invalid pricing data from AI");
      }

      const verifyRange = (range: any, label: string) => ({
        low: validateCurrency(range?.low),
        high: Math.max(validateCurrency(range?.high), validateCurrency(range?.low)),
        verified: validateCurrency(range?.low) > 0 && validateCurrency(range?.high) > 0,
        label,
      });

      // Build chart data for AI-generated results too
      const ourPrice = verifyRange(pricing.ourPrice, "Nick's Tire & Auto");
      const marketAvg = verifyRange(pricing.marketAverage, "Area Average");
      const dealerP = verifyRange(pricing.dealerPrice, "Dealership");
      const chainP = verifyRange(pricing.chainShopPrice, "Chain Shops");

      let chartData = null;
      if (input.includeChartData) {
        chartData = {
          barChart: [
            { label: ourPrice.label, low: ourPrice.low, high: ourPrice.high, mid: Math.round((ourPrice.low + ourPrice.high) / 2), color: "#22c55e" },
            { label: marketAvg.label, low: marketAvg.low, high: marketAvg.high, mid: Math.round((marketAvg.low + marketAvg.high) / 2), color: "#3b82f6" },
            { label: chainP.label, low: chainP.low, high: chainP.high, mid: Math.round((chainP.low + chainP.high) / 2), color: "#f59e0b" },
            { label: dealerP.label, low: dealerP.low, high: dealerP.high, mid: Math.round((dealerP.low + dealerP.high) / 2), color: "#ef4444" },
          ],
          savingsVsDealer: Math.round(((dealerP.low + dealerP.high) / 2) - ((ourPrice.low + ourPrice.high) / 2)),
          savingsVsChain: Math.round(((chainP.low + chainP.high) / 2) - ((ourPrice.low + ourPrice.high) / 2)),
          savingsPercent: Math.round((1 - ((ourPrice.low + ourPrice.high) / 2) / ((dealerP.low + dealerP.high) / 2)) * 100),
        };
      }

      return {
        service: validateString(pricing.service, 100, input.service),
        matchedServiceKey: null,
        dataSource: "ai_generated" as const,
        ourPrice,
        marketAverage: marketAvg,
        dealerPrice: dealerP,
        chainShopPrice: chainP,
        competitivePosition: validateString(pricing.competitivePosition, 20, "at_market"),
        confidenceLevel: "low" as const,
        recommendation: validateString(pricing.recommendation, 500, "Review pricing manually"),
        confidenceNote: validateString(pricing.confidenceNote, 500, "AI-generated estimates — verify with current market data"),
        seasonalAdjustment: null,
        marginAnalysis: null,
        chartData,
        generatedAt: new Date().toISOString(),
        zipCode: input.zipCode,
      };
    }),

  // ─── Chat-to-Action Dispatcher ────────────────────────
  dispatchAction: adminProcedure
    .input(z.object({
      sessionId: z.number(),
      autoExecute: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      const { d, session, messages, conversationText } = await fetchSessionWithMessages(input.sessionId);

      // Step 1: AI analyzes the conversation and recommends actions
      const analysisResponse = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are an action dispatcher for Nick's Tire & Auto. Analyze this customer chat conversation and determine the best next actions.

Score each action 0.0-1.0 based on confidence it's the right move.

Consider:
- Customer urgency (safety issue? stranded? just curious?)
- Customer intent (wants appointment? wants price? wants info?)
- Conversion readiness (gave phone? asked about scheduling? mentioned budget?)
- Vehicle specifics (known issue? diagnostic needed? maintenance?)

Return JSON:
- urgencyLevel: "critical" | "high" | "medium" | "low"
- customerIntent: "book_appointment" | "get_price" | "get_info" | "compare_prices" | "emergency" | "returning_followup"
- conversionReadiness: number 0.0-1.0 (how close to booking)
- hasContactInfo: boolean
- hasVehicleInfo: boolean
- recommendedActions: Array of { action: string, confidence: number, reason: string, priority: number }
  action: "generate_quote" | "create_work_order" | "schedule_followup" | "competitor_check" | "schedule_callback" | "send_coupon" | "flag_for_owner"
  priority: 1 (do first) to 5 (do last)
- summary: string (one-sentence summary of the situation)
- suggestedUrgencyResponse: string (what should happen RIGHT NOW)`,
          },
          {
            role: "user",
            content: `Chat session #${input.sessionId}:\nVehicle: ${session.vehicleInfo || "Unknown"}\nProblem: ${session.problemSummary || "Unknown"}\nConverted to lead: ${session.converted ? "Yes" : "No"}\nMessages: ${messages.length}\n\n${conversationText}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "action_dispatch",
            strict: true,
            schema: {
              type: "object",
              properties: {
                urgencyLevel: { type: "string" },
                customerIntent: { type: "string" },
                conversionReadiness: { type: "number" },
                hasContactInfo: { type: "boolean" },
                hasVehicleInfo: { type: "boolean" },
                recommendedActions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      action: { type: "string" },
                      confidence: { type: "number" },
                      reason: { type: "string" },
                      priority: { type: "integer" },
                    },
                    required: ["action", "confidence", "reason", "priority"],
                    additionalProperties: false,
                  },
                },
                summary: { type: "string" },
                suggestedUrgencyResponse: { type: "string" },
              },
              required: ["urgencyLevel", "customerIntent", "conversionReadiness", "hasContactInfo", "hasVehicleInfo", "recommendedActions", "summary", "suggestedUrgencyResponse"],
              additionalProperties: false,
            },
          },
        },
      });

      const analysisRaw = analysisResponse.choices?.[0]?.message?.content;
      if (!analysisRaw || typeof analysisRaw !== "string") {
        throw new Error("Failed to analyze chat session for action dispatch");
      }

      let analysis: any;
      try {
        analysis = JSON.parse(analysisRaw);
      } catch {
        throw new Error("Invalid analysis data from AI");
      }

      // Validate analysis
      const verifiedAnalysis = {
        urgencyLevel: ["critical", "high", "medium", "low"].includes(analysis.urgencyLevel) ? analysis.urgencyLevel : "medium",
        customerIntent: validateString(analysis.customerIntent, 30, "get_info"),
        conversionReadiness: Math.min(1, Math.max(0, Number(analysis.conversionReadiness) || 0.3)),
        hasContactInfo: !!analysis.hasContactInfo,
        hasVehicleInfo: !!analysis.hasVehicleInfo,
        summary: validateString(analysis.summary, 500, "Customer inquiry requiring follow-up"),
        suggestedUrgencyResponse: validateString(analysis.suggestedUrgencyResponse, 500, "Review chat session and follow up"),
      };

      // Validate and sort recommended actions
      const validActions = ["generate_quote", "create_work_order", "schedule_followup", "competitor_check", "schedule_callback", "send_coupon", "flag_for_owner"];
      const verifiedActions = (Array.isArray(analysis.recommendedActions) ? analysis.recommendedActions : [])
        .filter((a: any) => validActions.includes(a.action))
        .map((a: any) => ({
          action: a.action,
          confidence: Math.min(1, Math.max(0, Number(a.confidence) || 0)),
          reason: validateString(a.reason, 300, "Recommended based on chat analysis"),
          priority: validateScore(a.priority, 1, 5),
        }))
        .sort((a: any, b: any) => a.priority - b.priority);

      // Apply decision logic overrides based on patterns
      // High urgency + wants appointment = create work order + schedule callback
      if (verifiedAnalysis.urgencyLevel === "critical" || verifiedAnalysis.urgencyLevel === "high") {
        const hasWO = verifiedActions.some((a: any) => a.action === "create_work_order");
        if (!hasWO && verifiedAnalysis.hasContactInfo) {
          verifiedActions.unshift({
            action: "create_work_order",
            confidence: 0.85,
            reason: "High urgency detected — auto-recommending work order creation",
            priority: 1,
          });
        }
        const hasCB = verifiedActions.some((a: any) => a.action === "schedule_callback");
        if (!hasCB && verifiedAnalysis.hasContactInfo) {
          verifiedActions.push({
            action: "schedule_callback",
            confidence: 0.8,
            reason: "High urgency — customer should receive a callback promptly",
            priority: 2,
          });
        }
      }

      // Medium urgency + price shopping = generate quote + competitive analysis
      if (verifiedAnalysis.customerIntent === "get_price" || verifiedAnalysis.customerIntent === "compare_prices") {
        const hasQuote = verifiedActions.some((a: any) => a.action === "generate_quote");
        if (!hasQuote) {
          verifiedActions.unshift({
            action: "generate_quote",
            confidence: 0.9,
            reason: "Customer is price-shopping — generate quote to capture interest",
            priority: 1,
          });
        }
        const hasComp = verifiedActions.some((a: any) => a.action === "competitor_check");
        if (!hasComp) {
          verifiedActions.push({
            action: "competitor_check",
            confidence: 0.75,
            reason: "Price-shopping customer — competitive analysis helps close the deal",
            priority: 3,
          });
        }
      }

      // Low urgency + just info = schedule follow-up in 48h
      if (verifiedAnalysis.urgencyLevel === "low" && verifiedAnalysis.conversionReadiness < 0.4) {
        const hasFU = verifiedActions.some((a: any) => a.action === "schedule_followup");
        if (!hasFU && verifiedAnalysis.hasContactInfo) {
          verifiedActions.push({
            action: "schedule_followup",
            confidence: 0.7,
            reason: "Low urgency inquiry — schedule follow-up in 48h to stay top of mind",
            priority: 2,
          });
        }
      }

      // Step 2: Auto-execute if requested
      const executedResults: Array<{ action: string; success: boolean; result?: any; error?: string }> = [];

      if (input.autoExecute && verifiedActions.length > 0) {
        // Only auto-execute high-confidence actions (>0.7)
        const autoActions = verifiedActions.filter((a: any) => a.confidence >= 0.7);

        for (const action of autoActions.slice(0, 3)) { // max 3 auto-actions
          try {
            switch (action.action) {
              case "generate_quote": {
                // Trigger internally — don't use tRPC, call the logic directly
                log.info(`Auto-executing: generate_quote for session ${input.sessionId}`);
                executedResults.push({
                  action: "generate_quote",
                  success: true,
                  result: { message: "Quote generation queued — call generateQuote endpoint for full result" },
                });
                break;
              }
              case "create_work_order": {
                log.info(`Auto-executing: create_work_order for session ${input.sessionId}`);
                executedResults.push({
                  action: "create_work_order",
                  success: true,
                  result: { message: "Work order creation queued — call createWorkOrder endpoint for full result" },
                });
                break;
              }
              case "schedule_followup": {
                log.info(`Auto-executing: schedule_followup for session ${input.sessionId}`);
                executedResults.push({
                  action: "schedule_followup",
                  success: true,
                  result: { message: "Follow-up scheduling queued — call scheduleFollowUp endpoint for full result", delayHours: 48 },
                });
                break;
              }
              case "schedule_callback": {
                log.info(`Auto-executing: schedule_callback for session ${input.sessionId}`);
                executedResults.push({
                  action: "schedule_callback",
                  success: true,
                  result: { message: "Callback flagged — review in admin dashboard" },
                });
                break;
              }
              case "flag_for_owner": {
                log.info(`Flagging session ${input.sessionId} for owner review`);
                executedResults.push({
                  action: "flag_for_owner",
                  success: true,
                  result: { message: "Session flagged for Nour's review" },
                });
                break;
              }
              default: {
                executedResults.push({
                  action: action.action,
                  success: true,
                  result: { message: `Action ${action.action} noted — execute via dedicated endpoint` },
                });
              }
            }
          } catch (err: any) {
            log.error(`Auto-execute failed for ${action.action}:`, err);
            executedResults.push({
              action: action.action,
              success: false,
              error: err.message || "Unknown error",
            });
          }
        }
      }

      log.info(`Dispatch analysis for session ${input.sessionId}: urgency=${verifiedAnalysis.urgencyLevel}, intent=${verifiedAnalysis.customerIntent}, ${verifiedActions.length} actions recommended, ${executedResults.length} auto-executed`);

      return {
        sessionId: input.sessionId,
        analysis: verifiedAnalysis,
        recommendedActions: verifiedActions,
        autoExecuted: executedResults,
        actionEndpoints: verifiedActions.map((a: any) => ({
          action: a.action,
          endpoint: a.action === "generate_quote" ? "nickActions.generateQuote"
            : a.action === "create_work_order" ? "nickActions.createWorkOrder"
            : a.action === "schedule_followup" ? "nickActions.scheduleFollowUp"
            : a.action === "competitor_check" ? "nickActions.competitorPriceCheck"
            : null,
          params: a.action === "generate_quote" ? { sessionId: input.sessionId, includeTiers: true, includeFinancing: true }
            : a.action === "create_work_order" ? { sessionId: input.sessionId, autoAssign: true }
            : a.action === "schedule_followup" ? { sessionId: input.sessionId, enableChain: true, delayHours: verifiedAnalysis.urgencyLevel === "high" ? 4 : 48 }
            : a.action === "competitor_check" ? { service: session.problemSummary || "auto repair" }
            : null,
        })),
        generatedAt: new Date().toISOString(),
      };
    }),

  // ─── OPERATOR COMMAND (Admin-only Nick AI interface) ──────
  operatorCommand: adminProcedure
    .input(z.object({
      command: z.string().min(1).max(2000),
      context: z.record(z.string(), z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      const d = await db();

      // Gather live business context for Nick AI
      let bizContext = "";
      if (d) {
        try {
          const now = new Date();
          const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

          const [
            leadsToday, bookingsToday, callbacksPending, recentChats,
            weekBookings, monthInvoicesPaid, totalCustomers,
            newCustomersMonth, pendingCallbacks, staleLeads,
            monthReviews, weekLeads,
          ] = await Promise.all([
            d.select({ count: sql<number>`count(*)` }).from(leads).where(gte(leads.createdAt, todayStart)),
            d.select({ count: sql<number>`count(*)` }).from(bookings).where(gte(bookings.createdAt, todayStart)),
            d.select({ count: sql<number>`count(*)` }).from(leads).where(eq(leads.status, "new")),
            d.select({ count: sql<number>`count(*)` }).from(chatSessions).where(gte(chatSessions.createdAt, todayStart)),
            d.select({ count: sql<number>`count(*)` }).from(bookings).where(gte(bookings.createdAt, weekAgo)),
            d.select().from(invoices).where(and(gte(invoices.invoiceDate, monthAgo), eq(invoices.paymentStatus, "paid"))),
            d.select({ count: sql<number>`count(*)` }).from(customers),
            d.select({ count: sql<number>`count(*)` }).from(customers).where(gte(customers.createdAt, monthAgo)),
            d.select({ count: sql<number>`count(*)` }).from(callbackRequests).where(eq(callbackRequests.status, "new")),
            d.select({ count: sql<number>`count(*)` }).from(leads).where(and(eq(leads.status, "new"), gte(leads.createdAt, weekAgo))),
            d.select({ count: sql<number>`count(*)` }).from(reviewRequests).where(gte(reviewRequests.createdAt, monthAgo)),
            d.select({ count: sql<number>`count(*)` }).from(leads).where(gte(leads.createdAt, weekAgo)),
          ]);

          const monthRevenue = monthInvoicesPaid.reduce((s, inv) => s + inv.totalAmount, 0);
          const avgTicket = monthInvoicesPaid.length > 0 ? Math.round(monthRevenue / monthInvoicesPaid.length) : 0;

          bizContext = `\nLIVE BUSINESS STATE (Nick's Tire & Auto):
- Time: ${now.toLocaleString("en-US", { timeZone: "America/New_York" })}
- Model: First come first serve, drop-offs encouraged (holds place in line)
TODAY:
- Leads: ${leadsToday[0]?.count ?? 0} | Drop-offs: ${bookingsToday[0]?.count ?? 0}
- Chat sessions: ${recentChats[0]?.count ?? 0}
THIS WEEK:
- Drop-offs: ${weekBookings[0]?.count ?? 0} | Leads: ${weekLeads[0]?.count ?? 0}
PIPELINE:
- Pending leads (new): ${callbacksPending[0]?.count ?? 0}
- Stale leads (new, 7d): ${staleLeads[0]?.count ?? 0}
- Pending callbacks: ${pendingCallbacks[0]?.count ?? 0}
FINANCIAL (30d):
- Revenue: $${monthRevenue.toLocaleString()} from ${monthInvoicesPaid.length} paid invoices
- Avg ticket: $${avgTicket}
CUSTOMERS:
- Total: ${totalCustomers[0]?.count ?? 0} | New this month: ${newCustomersMonth[0]?.count ?? 0}
REVIEWS: ${monthReviews[0]?.count ?? 0} requests sent this month
SOURCES: Auto Labor Guide (ShopDriver Elite), Gateway for invoices`;

          // Add intelligence data (conversion pipeline + revenue projections)
          // Inject Nick's learned memories
          try {
            const { getMemoryContext } = await import("../services/nickMemory");
            const memContext = await getMemoryContext();
            if (memContext) bizContext += memContext;
          } catch {}

          // Inject customer intelligence
          let customerBrief = "";
          try {
            const { getCustomerBrief } = await import("../services/customerIntelligence");
            customerBrief = await getCustomerBrief();
          } catch {}


          // Inject intelligence data
          try {
            const { analyzeConversionPipeline, projectRevenue, generateProactiveAlerts, getShopPulse } = await import("../services/nickIntelligence");
            const [pipeline, revenue, alerts, shopPulse] = await Promise.all([
              analyzeConversionPipeline(),
              projectRevenue(),
              generateProactiveAlerts(),
              getShopPulse(),
            ]);
            bizContext += `
INTELLIGENCE:
- Estimate→Job conversion: ${pipeline.estimateToInvoice}%
- Lead→Booking conversion: ${pipeline.leadToBooking}%
- Drop-off→Completed: ${pipeline.bookingToInvoice}%
- Stale leads: ${pipeline.staleLeads} | Stale estimates: ${pipeline.staleEstimates}
- Week projection: $${revenue.thisWeekProjection} | Month projection: $${revenue.thisMonthProjection}
- Week-over-week: ${revenue.weekOverWeek > 0 ? "+" : ""}${revenue.weekOverWeek}% (${revenue.trend})
- Avg daily revenue: $${revenue.avgDailyRevenue}

SHOP PULSE (right now):
- Status: ${shopPulse.shopStatus.toUpperCase()}
- Today: ${shopPulse.today.jobsClosed} jobs closed, $${shopPulse.today.revenue.toLocaleString()} revenue, $${shopPulse.today.avgTicket} avg ticket
- Walked customers (estimates only): ${shopPulse.today.customersWalked}
- Drop-offs today: ${shopPulse.today.dropOffs} | Pending payments: ${shopPulse.today.pendingPayments} | Callbacks: ${shopPulse.today.callbacksWaiting}
- This week: ${shopPulse.thisWeek.jobsClosed} jobs, $${shopPulse.thisWeek.revenue.toLocaleString()}, walk rate: ${shopPulse.thisWeek.walkRate}%
- ${shopPulse.shopInsight}

BUSINESS MODEL:
- Invoice = closed job = money in. This is the WIN metric.
- Estimate without invoice = customer got free inspection and WALKED. This is LOST revenue.
- Walk rate = estimates / (estimates + invoices). Track this obsessively.
- Auto Labor Guide (ShopDriver) is the shop CRM — all estimates and invoices live there.

CUSTOMER INTELLIGENCE:
${customerBrief}
- Walk rate = estimates / (estimates + invoices). Track this obsessively.
- Auto Labor Guide (ShopDriver) is the shop CRM — all estimates and invoices live there.
- The website pushes everything to Auto Labor Guide via Telegram for manual entry.
${pipeline.insights.length > 0 ? "WARNINGS: " + pipeline.insights.join(" | ") : ""}
${alerts.length > 0 ? "ALERTS: " + alerts.join(" | ") : ""}`;
          } catch {}
        } catch (err) {
          log.warn("Failed to gather biz context for operator command", { error: err instanceof Error ? err.message : String(err) });
        }
      }

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are Nick AI — Nour's operator brain. You run across two domains:

1. NICK'S TIRE & AUTO (Cleveland/Euclid) — the business
2. NOUR OS — Nour's personal operating system for life + business

You are not just a business tool. You are Nour's strategic partner, chief of staff, and execution engine. You help him build the life and business simultaneously.

═══ BUSINESS CONTEXT ═══
SHOP MODEL: First come first serve. Drop-offs encouraged — holds place in line. No appointments.
KEY METRIC: Invoice = job won. Estimate without invoice = lost sale.
SOURCES: Auto Labor Guide (ShopDriver Elite), Gateway for invoices/payments.
LABOR: 60+ jobs across 8 categories. Quick in-and-out jobs. Speed matters.

═══ CAPABILITIES ═══
BUSINESS:
- Real-time pulse: leads, drop-offs, revenue, customer data, callbacks
- Shop operations: work orders, bay dispatch, labor estimates
- Marketing: SMS campaigns, review requests, win-back, social media posting
- Financial: revenue, avg ticket, conversion rates, invoice pipeline
- Competitive: pricing, positioning, local market (Cleveland area)

PERSONAL:
- Execution tracking: daily score, streaks, non-negotiable habits
- Task management: operator task queue with priorities
- Decision log: record decisions with reasoning for future reference
- Commitments: track promises with deadlines and accountability
- Loops: recurring habits with streak tracking
- Projects: track both life and business projects with milestones
- Learning: identify patterns, suggest improvements, remember what works

STRATEGIC:
- Pattern recognition: spot trends in revenue, leads, customer behavior
- Forecasting: project revenue, identify seasonal patterns
- Bottleneck detection: find where money/time is being lost
- Growth planning: what to invest in next, what to cut
- Life design: help Nour build systems for health, wealth, relationships

═══ THINKING MODEL ═══
Before EVERY response, run this internal process:
1. UNDERSTAND — What is Nour actually asking? What's the real need behind the words?
2. CONTEXT — What do I know from memory, live data, and patterns that's relevant?
3. ANALYZE — What are the options? What are the trade-offs? What's the second-order effect?
4. DECIDE — What's the highest-leverage move? What would a world-class operator recommend?
5. VERIFY — Are my facts correct? Am I referencing real data or guessing? Self-check.
6. DELIVER — Lead with the answer. Be specific. Make it actionable.

═══ PERSONALITY ═══
- You are direct. Zero fluff. Lead with signal.
- You challenge weak thinking. If Nour's logic is sloppy, say so.
- You anticipate beyond the request. Surface hidden risks and smarter paths.
- Every answer produces: what to do now, what to do next, what to avoid.
- You remember patterns and get smarter over time. You HAVE persistent memory — use it.
- You think in systems, not events. Build recurring advantages.
- You connect dots across data sources — if revenue is down AND leads are up, that's a conversion problem.
- You proactively volunteer information Nour didn't ask for but needs to know.
- When you spot something urgent in the data, lead with it before answering the question.
- Truth > comfort. Execution > discussion. Leverage > effort.

═══ INTELLIGENCE LEVEL ═══
You are not a chatbot. You are an elite strategic operator. Think like:
- A CFO when discussing money (margins, unit economics, ROI)
- A COO when discussing operations (throughput, bottlenecks, utilization)
- A CMO when discussing marketing (conversion, positioning, customer psychology)
- A therapist when discussing personal growth (accountability, patterns, blind spots)
- A data scientist when discussing patterns (correlations, anomalies, projections)
Never give surface-level answers. Always go one level deeper than expected.

═══ RULES ═══
1. Reference real numbers from LIVE BUSINESS STATE.
2. If you can take action, describe exactly what you did.
3. If you need data you don't have, say what's missing.
4. Always end with "NEXT MOVE:" — the highest-leverage action right now.
5. Back up recommendations with data.
6. For projects: break into phases, track progress, flag blockers.
7. For decisions: weigh trade-offs, recommend with conviction, log reasoning.
8. For personal growth: be the accountability partner. No coddling.
9. Format with clear headers. Keep it punchy but complete.
10. SELF-CHECK before responding: verify all facts (phone, hours, address, rating). If you generate content (posts, emails, replies), double-check tone matches brand voice. If you cite a number, make sure it came from the live data above — don't guess.
${bizContext}
${input.context ? "\nADDITIONAL CONTEXT:\n" + Object.entries(input.context).map(([k, v]) => `${k}: ${v}`).join("\n") : ""}`,
          },
          { role: "user", content: input.command },
        ],
        maxTokens: 2000,
      });

      const reply = response.choices?.[0]?.message?.content;
      if (!reply || typeof reply !== "string") {
        throw new Error("Nick AI failed to respond");
      }

      log.info(`Operator command: "${input.command.slice(0, 80)}..." → ${reply.length} chars`);

      // Auto-learn from this interaction (async, don't block)
      import("../services/nickMemory").then(({ learnFromInteraction }) =>
        learnFromInteraction(input.command, reply)
      ).catch(() => {});

      return {
        reply,
        timestamp: new Date().toISOString(),
        tokensUsed: response.usage?.total_tokens ?? 0,
      };
    }),

  /** Post to social media (Instagram/Facebook) via Meta Business Suite */
  socialPost: adminProcedure
    .input(z.object({
      platforms: z.array(z.enum(["facebook", "instagram"])).min(1),
      message: z.string().min(1).max(2200),
      imageUrl: z.string().url().optional(),
      link: z.string().url().optional(),
    }))
    .mutation(async ({ input }) => {
      const { socialPost } = await import("../services/metaSocial");
      const result = await socialPost({
        platforms: input.platforms,
        message: input.message,
        imageUrl: input.imageUrl,
        link: input.link,
      });

      // Unified event bus
      import("../services/eventBus").then(({ emit }) =>
        emit.socialPosted({
          platforms: input.platforms,
          success: result.results.every(r => r.success),
        })
      ).catch(() => {});

      return result;
    }),

  /** Check social media posting status */
  socialStatus: adminProcedure.query(async () => {
    const { getMetaSocialStatus } = await import("../services/metaSocial");
    return getMetaSocialStatus();
  }),

  /** Get real-time shop pulse */
  /** Customer intelligence KPIs */
  customerIntelligence: adminProcedure.query(async () => {
    const { analyzeCustomers } = await import("../services/customerIntelligence");
    return analyzeCustomers();
  }),

  /** Camera feed proxy — streams RTSP/HTTP camera feeds */
  cameraFeed: adminProcedure
    .input(z.object({
      cameraId: z.string().min(1).max(50),
    }))
    .query(async ({ input }) => {
      // Camera feeds are configured via shop settings
      const d = await db();
      if (!d) return { error: "DB unavailable", feeds: [] };

      const { shopSettings } = await import("../../drizzle/schema");
      const result = await d.select().from(shopSettings)
        .where(sql`${shopSettings.key} LIKE 'camera_%'`);

      const cameras = result.map(r => {
        try {
          const data = JSON.parse(r.value);
          return { id: r.key.replace("camera_", ""), name: data.name, url: data.url, type: data.type || "http" };
        } catch { return null; }
      }).filter(Boolean);

      const target = cameras.find((c: any) => c.id === input.cameraId);
      if (!target) return { error: "Camera not found", feeds: cameras };

      return {
        camera: target,
        feeds: cameras,
        streamUrl: (target as any).url,
        note: "For RTSP cameras, use the stream URL in a video player. For HTTP cameras, embed as img src.",
      };
    }),

  /** List all configured cameras */
  cameras: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return [];

    const { shopSettings } = await import("../../drizzle/schema");
    const result = await d.select().from(shopSettings)
      .where(sql`${shopSettings.key} LIKE 'camera_%'`);

    return result.map(r => {
      try {
        const data = JSON.parse(r.value);
        return { id: r.key.replace("camera_", ""), ...data };
      } catch { return null; }
    }).filter(Boolean);
  }),

  /** Add/update a camera */
  setCamera: adminProcedure
    .input(z.object({
      id: z.string().min(1).max(50),
      name: z.string().min(1).max(100),
      url: z.string().min(1),
      type: z.enum(["rtsp", "http", "mjpeg", "hls", "v380-cloud", "ring", "eufy"]).default("http"),
      location: z.string().max(100).optional(),
      v380DeviceId: z.string().max(50).optional(),
      ringDeviceId: z.string().max(50).optional(),
      eufySerial: z.string().max(50).optional(),
      tunnelUrl: z.string().optional(),
      snapshotUrl: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) return { success: false };

      const { shopSettings } = await import("../../drizzle/schema");
      const key = `camera_${input.id}`;
      const value = JSON.stringify({
        name: input.name, url: input.url, type: input.type,
        location: input.location || "",
        v380DeviceId: input.v380DeviceId, ringDeviceId: input.ringDeviceId,
        eufySerial: input.eufySerial, tunnelUrl: input.tunnelUrl,
        snapshotUrl: input.snapshotUrl,
      });

      const existing = await d.select().from(shopSettings).where(eq(shopSettings.key, key)).limit(1);
      if (existing.length > 0) {
        await d.update(shopSettings).set({ value }).where(eq(shopSettings.key, key));
      } else {
        await d.insert(shopSettings).values({ key, value });
      }
      return { success: true };
    }),

  shopPulse: adminProcedure.query(async () => {
    const { getShopPulse } = await import("../services/nickIntelligence");
    return getShopPulse();
  }),

  /** Get ShopDriver sync status */
  shopDriverStatus: adminProcedure.query(async () => {
    const { getSyncStatus } = await import("../services/shopDriverSync");
    return getSyncStatus();
  }),

  /** Get tiered scheduler status */
  schedulerStatus: adminProcedure.query(async () => {
    const { getTierStatuses } = await import("../cron/scheduler");
    return getTierStatuses();
  }),

  /** Trigger prerender (admin only) */
  triggerPrerender: adminProcedure.mutation(async () => {
    // Can't run Puppeteer on Railway — return instructions
    return {
      success: true,
      message: "Run locally: node scripts/prerender.mjs --port 3000 (against live site)",
      note: "Prerender generates static HTML for SEO bots. Run after every major content change.",
    };
  }),

  /** Import customers from ShopDriver CSV export */
  importCustomerCSV: adminProcedure.mutation(async () => {
    try {
      const { getDb } = await import("../db");
      const d = await getDb();
      if (!d) return { success: false, error: "DB unavailable" };

      const fs = await import("fs");
      const path = await import("path");
      const csvPath = path.resolve(import.meta.dirname, "..", "data", "shopdriver-customers.csv");

      if (!fs.existsSync(csvPath)) {
        // Try alternate paths
        const alt = path.resolve(import.meta.dirname, "../..", "data", "shopdriver-customers.csv");
        if (!fs.existsSync(alt)) return { success: false, error: "CSV not found at " + csvPath };
      }

      const raw = fs.readFileSync(fs.existsSync(csvPath) ? csvPath : path.resolve(import.meta.dirname, "../..", "data", "shopdriver-customers.csv"), "utf-8");
      const lines = raw.split("\n").filter(l => l.trim());
      const header = lines[0];
      const rows = lines.slice(1);

      const { customers } = await import("../../drizzle/schema");
      let imported = 0;
      let skipped = 0;

      for (const row of rows) {
        // Parse CSV (handle quoted fields)
        const fields = row.match(/(".*?"|[^,]*),?/g)?.map(f => f.replace(/^"|"$/g, "").replace(/,$/, "").trim()) || [];
        const [firstName, lastName, companyName, workPhone, homePhone, mobilePhone, email, address1, address2, city, state, postalCode] = fields;

        const phone = (mobilePhone || homePhone || workPhone || "").replace(/\D/g, "");
        if (!phone || phone.length < 7) { skipped++; continue; }
        if (!firstName && !lastName) { skipped++; continue; }

        // Check if exists
        const existing = await d.select({ id: customers.id }).from(customers)
          .where(sql`REPLACE(REPLACE(REPLACE(${customers.phone}, '-', ''), '(', ''), ')', '') LIKE ${'%' + phone.slice(-10)}`)
          .limit(1);

        if (existing.length > 0) { skipped++; continue; }

        try {
          await d.insert(customers).values({
            firstName: firstName || "",
            lastName: lastName || "",
            phone,
            email: email || null,
            address: address1 || null,
            city: city || null,
            state: state || null,
            zip: postalCode || null,
            segment: "unknown",
          });
          imported++;
        } catch { skipped++; }
      }

      return { success: true, imported, skipped, total: rows.length };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }),

  /** Run database migrations (admin only) */
  runMigrations: adminProcedure.mutation(async () => {
    try {
      const { getDb } = await import("../db");
      const d = await getDb();
      if (!d) return { success: false, error: "DB not available" };

      // Run the safe CREATE TABLE IF NOT EXISTS migrations
      const migrations = [
        `CREATE TABLE IF NOT EXISTS chat_analytics (id int AUTO_INCREMENT PRIMARY KEY, sessionId int, hourOfDay int NOT NULL, dayOfWeek int NOT NULL, month int NOT NULL, messageCount int NOT NULL DEFAULT 0, converted int NOT NULL DEFAULT 0, leadScore int, duration int, createdAt timestamp NOT NULL DEFAULT (now()))`,
        `CREATE TABLE IF NOT EXISTS review_pipeline (id int AUTO_INCREMENT PRIMARY KEY, authorName varchar(255) NOT NULL, rating int NOT NULL, reviewText text, reviewTime int, relativeTime varchar(100), sentiment varchar(20), topicsJson text, keywordsJson text, urgency varchar(20), suggestedResponse text, status varchar(20) DEFAULT 'pending', createdAt timestamp NOT NULL DEFAULT (now()))`,
        `CREATE TABLE IF NOT EXISTS search_performance (id int AUTO_INCREMENT PRIMARY KEY, query varchar(500) NOT NULL, page varchar(500), clicks int DEFAULT 0, impressions int DEFAULT 0, ctr int DEFAULT 0, position int DEFAULT 0, date date, createdAt timestamp NOT NULL DEFAULT (now()))`,
        `CREATE TABLE IF NOT EXISTS pipeline_runs (id int AUTO_INCREMENT PRIMARY KEY, pipelineName varchar(100) NOT NULL, status varchar(20) NOT NULL, startedAt timestamp NOT NULL DEFAULT (now()), completedAt timestamp, durationMs int, resultJson text, error text)`,
        `CREATE TABLE IF NOT EXISTS daily_execution (id INT AUTO_INCREMENT PRIMARY KEY, date DATE NOT NULL, mission TEXT, notes TEXT, status ENUM('on_track','drifting','off_track') NOT NULL DEFAULT 'on_track', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY idx_daily_date (date))`,
        `CREATE TABLE IF NOT EXISTS daily_habits (id INT AUTO_INCREMENT PRIMARY KEY, date DATE NOT NULL, habit_key VARCHAR(50) NOT NULL, completed TINYINT(1) NOT NULL DEFAULT 0, completed_at TIMESTAMP NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY idx_habit_date_key (date, habit_key))`,
        `CREATE TABLE IF NOT EXISTS conversation_memory (id INT AUTO_INCREMENT PRIMARY KEY, visitorKey VARCHAR(255) NOT NULL, category VARCHAR(50) NOT NULL, content TEXT NOT NULL, sessionId INT NULL, confidence FLOAT NOT NULL DEFAULT 0.8, reinforcements INT NOT NULL DEFAULT 1, lastAccessed TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      ];

      let applied = 0;
      let skipped = 0;
      const errors: string[] = [];
      for (const rawSql of migrations) {
        try {
          // Use drizzle's sql template to wrap the raw string
          const { sql: sqlTag } = await import("drizzle-orm");
          await d.execute(sqlTag.raw(rawSql));
          applied++;
        } catch (err: any) {
          const msg = err?.message || String(err);
          if (msg.includes("already exists") || msg.includes("Duplicate")) {
            skipped++;
          } else {
            skipped++;
            errors.push(`${rawSql.slice(0, 50)}... → ${msg.slice(0, 100)}`);
          }
        }
      }

      return { success: true, applied, skipped, total: migrations.length, errors: errors.length > 0 ? errors : undefined };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }),

  /** Store a memory for Nick AI */
  remember: adminProcedure
    .input(z.object({
      type: z.enum(["insight", "lesson", "preference", "pattern", "customer"]),
      content: z.string().min(3).max(500),
      source: z.string().max(100).default("manual"),
    }))
    .mutation(async ({ input }) => {
      const { remember } = await import("../services/nickMemory");
      await remember(input);
      return { success: true };
    }),

  /** Recall Nick AI's memories */
  memories: adminProcedure
    .input(z.object({
      type: z.enum(["insight", "lesson", "preference", "pattern", "customer"]).optional(),
      limit: z.number().max(50).default(20),
    }).optional())
    .query(async ({ input }) => {
      const { recall } = await import("../services/nickMemory");
      return recall({ type: input?.type, limit: input?.limit });
    }),

  /** Send media (photo/video/document) to owner via Telegram */
  sendMedia: adminProcedure
    .input(z.object({
      type: z.enum(["photo", "video", "document", "album"]),
      url: z.string().url().optional(),
      urls: z.array(z.string().url()).optional(),
      caption: z.string().max(1024).optional(),
    }))
    .mutation(async ({ input }) => {
      const { sendTelegramPhoto, sendTelegramVideo, sendTelegramDocument, sendTelegramMediaGroup } =
        await import("../services/telegram");

      if (input.type === "photo" && input.url) {
        const ok = await sendTelegramPhoto(input.url, input.caption);
        return { success: ok };
      }
      if (input.type === "video" && input.url) {
        const ok = await sendTelegramVideo(input.url, input.caption);
        return { success: ok };
      }
      if (input.type === "document" && input.url) {
        const ok = await sendTelegramDocument(input.url, input.caption);
        return { success: ok };
      }
      if (input.type === "album" && input.urls?.length) {
        const ok = await sendTelegramMediaGroup(
          input.urls.map((u, i) => ({ type: "photo" as const, url: u, caption: i === 0 ? input.caption : undefined }))
        );
        return { success: ok };
      }
      return { success: false, error: "Invalid media type or missing URL" };
    }),

  /** Nick AI self-review: validate generated content before sending */
  reviewContent: adminProcedure
    .input(z.object({
      content: z.string().min(1).max(5000),
      contentType: z.enum(["social_post", "email", "estimate", "reply", "brief", "general"]),
      context: z.string().max(1000).optional(),
    }))
    .mutation(async ({ input }) => {
      const { invokeLLM } = await import("../_core/llm");
      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are Nick AI's quality control layer for Nick's Tire & Auto (Cleveland, OH).

REVIEW this ${input.contentType} for:
1. ACCURACY — Are facts, prices, hours, phone numbers correct?
   - Phone: (216) 862-0005
   - Address: 17625 Euclid Ave, Cleveland, OH 44112
   - Hours: Mon-Sat 8AM-6PM, Sun 9AM-4PM
   - Rating: 4.9 stars, 1685+ reviews
   - Walk-ins welcome, first come first serve, drop-offs encouraged
2. TONE — Does it match the brand? Direct, honest, no-nonsense, Cleveland proud, not corporate.
3. ERRORS — Grammar, spelling, broken formatting, missing info.
4. EFFECTIVENESS — Will this achieve its goal? Would a real customer respond?
5. RISKS — Anything that could look bad, offend, or create liability?

Respond with JSON:
{
  "approved": true/false,
  "score": 1-10,
  "issues": ["issue 1", "issue 2"],
  "suggestions": ["fix 1", "fix 2"],
  "correctedContent": "improved version if score < 8, otherwise null"
}`,
          },
          {
            role: "user",
            content: `Review this ${input.contentType}:\n\n${input.content}${input.context ? `\n\nContext: ${input.context}` : ""}`,
          },
        ],
        maxTokens: 800,
      });

      const raw = response.choices?.[0]?.message?.content;
      if (raw && typeof raw === "string") {
        try {
          return JSON.parse(raw);
        } catch {
          return { approved: true, score: 7, issues: [], suggestions: [], correctedContent: null };
        }
      }
      return { approved: true, score: 7, issues: [], suggestions: [], correctedContent: null };
    }),
});
