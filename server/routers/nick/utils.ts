/**
 * Nick AI Agent — Shared types, interfaces, helpers, and knowledge bases.
 * Used by all nick/* sub-modules.
 */
import { eq, desc, like } from "drizzle-orm";
import { chatSessions, leads, workOrders, bookings, customers } from "../../../drizzle/schema";
import { createLogger } from "../../lib/logger";

export const log = createLogger("nick-actions");

// ─── Local type aliases for AI-parsed JSON and DB results ──

/** AI-parsed quote service item */
export interface QuoteService {
  name: string;
  description: string;
  laborHours: number;
  partsCostEstimate: number;
  laborRate: number;
  category: string;
}

/** Computed service with derived costs */
export interface ComputedService extends QuoteService {
  laborCost: number;
  subtotal: number;
}

/** AI-parsed part item */
export interface QuotePart {
  partName: string;
  partKey: string;
  quantity: number;
}

/** AI-parsed work order extraction */
export interface WorkOrderExtraction {
  customerComplaint: string;
  diagnosis: string;
  vehicleYear: number;
  vehicleMake: string;
  vehicleModel: string;
  vehicleMileage: number;
  recommendedServices: string[];
  estimatedHours: number;
  urgencyNote: string;
  urgencyScore: number;
  serviceCategories: string[];
  partsToOrder: Array<{ partName: string; partKey: string; quantity: number; urgency: string }>;
}

/** AI-parsed follow-up chain step */
export interface FollowUpStep {
  step: number;
  delayHours: number;
  channel: string;
  subject: string;
  message: string;
  toneLabel: string;
}

/** AI-parsed follow-up chain data */
export interface FollowUpChainData {
  chain: FollowUpStep[];
  optimalSendWindow: { startHour: number; endHour: number; avoidWeekends: boolean };
}

/** AI-parsed pricing data */
export interface PricingData {
  service: string;
  ourPrice: { low: number; high: number };
  marketAverage: { low: number; high: number };
  dealerPrice: { low: number; high: number };
  chainShopPrice: { low: number; high: number };
  competitivePosition: string;
  recommendation: string;
  confidenceNote: string;
}

/** AI-parsed action dispatch analysis */
export interface DispatchAnalysis {
  urgencyLevel: string;
  customerIntent: string;
  conversionReadiness: number;
  hasContactInfo: boolean;
  hasVehicleInfo: boolean;
  recommendedActions: Array<{ action: string; confidence: number; reason: string; priority: number }>;
  summary: string;
  suggestedUrgencyResponse: string;
}

/** Verified action item */
export interface VerifiedAction {
  action: string;
  confidence: number;
  reason: string;
  priority: number;
}

/** Execution result for auto-dispatched actions */
export interface ExecutionResult {
  action: string;
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
}

/** Camera parsed from shop settings */
export interface CameraEntry {
  id: string;
  name: string;
  url: string;
  type: string;
}

/** Price range with label for verification */
export interface PriceRange {
  low: number;
  high: number;
}

/** Work order row from DB (subset used in this file) */
export interface WorkOrderRow {
  id: string;
  total: string | null;
  serviceDescription: string | null;
  diagnosis: string | null;
  createdAt: Date;
  [key: string]: unknown;
}

export async function db() {
  const { getDb } = await import("../../db");
  return getDb();
}

// ─── Validation helpers (verify everything) ─────────────

export function validateCurrency(value: unknown): number {
  const num = typeof value === "string" ? parseFloat(value) : Number(value);
  if (isNaN(num) || num < 0 || num > 100_000) {
    log.warn(`Invalid currency value: ${value}, defaulting to 0`);
    return 0;
  }
  return Math.round(num * 100) / 100;
}

export function validateString(value: unknown, maxLen: number, fallback: string): string {
  if (typeof value !== "string" || value.trim().length === 0) return fallback;
  return value.trim().slice(0, maxLen);
}

export function validateScore(value: unknown, min: number, max: number): number {
  const num = Number(value);
  if (isNaN(num)) return min;
  return Math.min(max, Math.max(min, Math.round(num)));
}

// ─── Built-in Knowledge Bases ───────────────────────────

/** Common auto parts pricing knowledge base (Cleveland area) */
export const PARTS_KB: Record<string, { low: number; high: number; unit: string }> = {
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
export const WARRANTY_SCHEDULE: Record<string, { months: number; miles: number; description: string }> = {
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
export const FINANCING_OPTIONS = [
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
export const CLEVELAND_PRICING_DB: Record<string, {
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
export const TECHNICIANS = [
  { id: 1, name: "Mike", specialties: ["brakes", "suspension", "alignment", "steering"], experience: "senior", bays: ["1", "2"] },
  { id: 2, name: "Carlos", specialties: ["engine", "diagnostics", "electrical", "echeck"], experience: "senior", bays: ["3", "4"] },
  { id: 3, name: "Jamal", specialties: ["tires", "wheels", "alignment", "mount_balance"], experience: "mid", bays: ["5", "6"] },
  { id: 4, name: "Derek", specialties: ["oil_change", "fluids", "maintenance", "filters"], experience: "junior", bays: ["7"] },
  { id: 5, name: "Nour", specialties: ["all", "diagnostics", "complex", "ac", "transmission"], experience: "owner", bays: ["1", "2", "3", "4", "5", "6", "7"] },
];

/** Bay assignments by service type */
export const BAY_MAP: Record<string, string[]> = {
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

export async function fetchSessionWithMessages(sessionId: number) {
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

export async function findReturningCustomer(d: NonNullable<Awaited<ReturnType<typeof db>>>, messages: Array<{ role: string; content: string }>) {
  const userMessages = messages.filter(m => m.role === "user").map(m => m.content).join("\n");
  const phoneMatch = userMessages.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  const phone = phoneMatch?.[0]?.replace(/\D/g, "") || null;

  if (!phone) return { phone: null, customer: null, history: null };

  // Check leads for this phone
  const matchingLeads = await d.select().from(leads)
    .where(like(leads.phone, `%${phone.slice(-10)}%`))
    .orderBy(desc(leads.createdAt))
    .limit(5);

  // Check past work orders (customerId is a UUID, not a phone -- look up customer first)
  let pastOrders: WorkOrderRow[] = [];
  try {
    const phoneNorm = phone.slice(-10);
    const [cust] = await d.select({ id: customers.id }).from(customers)
      .where(like(customers.phone, `%${phoneNorm}%`)).limit(1);
    if (cust) {
      pastOrders = await d.select().from(workOrders)
        .where(eq(workOrders.customerId, String(cust.id)))
        .orderBy(desc(workOrders.createdAt))
        .limit(10);
    }
  } catch (e) { console.warn("[nickActions:createQuote] past work order lookup failed:", e); }

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

export function calculateFinancing(totalAmount: number): Array<{
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

export function matchTechnician(serviceKeywords: string[]): { tech: typeof TECHNICIANS[0]; confidence: number; reason: string } {
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

export function suggestBay(serviceKeywords: string[]): { bay: string; reason: string } {
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

export function estimateCompletionHours(services: string[], estimatedLaborHours: number): {
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

/** Quote system prompt constant */
export const QUOTE_SYSTEM_PROMPT = `You are a quoting assistant for Nick's Tire & Auto in Cleveland, OH.
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
