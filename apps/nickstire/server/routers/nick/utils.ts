/**
 * Nick AI Agent — Shared types, interfaces, helpers, and knowledge bases.
 * Used by all nick/* sub-modules.
 */

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


/**
 * Financing providers available at Nick's — operator-side quote math only.
 * Provider names, caps, minimums and credit wording must agree with
 * shared/financing.ts; `type` is only the quote-math assumption (2026-10-01: the payoff
 * lines said "90/100 days same as cash", Koalafi's cap said $10,000 against its
 * published $7,500, and Koalafi was called a soft check when Koalafi says it
 * checks credit through alternative bureaus).
 */
export const FINANCING_OPTIONS = [
  {
    provider: "Acima",
    type: "lease_to_own",
    minAmount: 100,
    maxAmount: 5000,
    termMonths: [3, 6, 12],
    approvalType: "No credit history required; uses consumer-report data",
    earlyBuyoutDiscount: "Early purchase option; deadline and savings in the lease",
    note: "Lease-to-own option. Total cost is higher if paid over full term.",
  },
  {
    provider: "Snap Finance",
    type: "lease_to_own",
    minAmount: 300,
    maxAmount: 5000,
    termMonths: [12],
    approvalType: "No credit needed per Snap; consumer-report data used",
    earlyBuyoutDiscount: "Promotional payoff terms vary by product and agreement",
    note: "Snap decides approval. Payoff window depends on the product offered.",
  },
  {
    provider: "Koalafi",
    type: "lease_to_own",
    minAmount: 200,
    maxAmount: 7500,
    termMonths: [6, 12, 18, 24],
    approvalType: "Credit check through alternative bureaus (Koalafi says no FICO impact)",
    earlyBuyoutDiscount: "Early purchase options; terms in the agreement",
    note: "Highest published cap listed here. Good for major repairs.",
  },
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
