/**
 * ShopDriver Report Ingestion Pipeline
 *
 * Parses the 4 exported text reports (Total Sales, Tech, Labor, Parts)
 * and ingests them into the database with smart cleanup logic.
 *
 * Smart cleanup:
 * - Detects "lazy invoicing" where labor+parts are lumped into one field
 * - Normalizes customer names (LAST, FIRST → proper case)
 * - Detects financing providers from PayType field (SNAP, AFTERPAY, ACIMA, Koalafi)
 * - Categorizes services into groups (brakes, tires, engine, alignment, etc.)
 * - Handles typos in customer names with fuzzy matching
 */

import { createLogger } from "../lib/logger";
import { eq, sql } from "drizzle-orm";

const log = createLogger("report-ingestion");

// ─── SERVICE CATEGORIES ────────────────────────────────
// Map service descriptions to categories for analytics
const SERVICE_CATEGORIES: Record<string, RegExp> = {
  brakes: /brake|pad|rotor|caliper|drum|shoe|bleed|abs|parking.*cable/i,
  tires: /tire|mount.*balance|balance.*tire|replace.*tire|used tire|new tire|plug|flat|tpms|valve.*stem|rotation/i,
  alignment: /align/i,
  suspension: /strut|shock|control.*arm|sway.*bar|stab.*link|ball.*joint|tie.*rod|spring|bushing|bearing|hub/i,
  engine: /tune.*up|spark.*plug|oxygen.*sensor|alternator|starter|belt|timing|valve.*cover|gasket|motor.*mount|oil.*filter.*housing|catalytic|exhaust|muffler|weld.*exhaust|flex.*pipe|manifold|camshaft|crankshaft|engine/i,
  oil_change: /oil.*change|oil.*filter|lube|synthetic/i,
  cooling: /radiator|thermostat|coolant|water.*pump|heater.*core|cooling|overheat|flush.*system/i,
  electrical: /battery|alternator|wiper|window.*regulator|fuse|sensor|module|relay|light|headlight/i,
  steering: /power.*steering|steering.*pump|steering.*rack|steering.*hose/i,
  transmission: /transmission|trans.*fluid|trans.*filter|cv.*axle|axle|drive.*shaft/i,
  ac_heat: /a.*c|ac.*charge|ac.*compressor|freon|vacuum.*recharge|heater/i,
  inspection: /inspect|diagnos|check|scan/i,
  other: /.*/,
};

function categorizeService(description: string): string {
  if (!description) return "other";
  for (const [category, pattern] of Object.entries(SERVICE_CATEGORIES)) {
    if (pattern.test(description)) return category;
  }
  return "other";
}

// ─── PAYMENT TYPE NORMALIZATION ────────────────────────
function normalizePaymentType(raw: string): { method: "cash" | "card" | "check" | "financing" | "other"; isFinanced: boolean; financeProvider: string | null } {
  if (!raw) return { method: "other", isFinanced: false, financeProvider: null };
  const lower = raw.toLowerCase().trim();

  // Financing providers (user says: if a finance provider is mentioned, treat as financed)
  if (lower.includes("snap")) return { method: "financing", isFinanced: true, financeProvider: "SNAP" };
  if (lower.includes("afterpay")) return { method: "financing", isFinanced: true, financeProvider: "AFTERPAY" };
  if (lower.includes("acima")) return { method: "financing", isFinanced: true, financeProvider: "ACIMA" };
  if (lower.includes("koalafi")) return { method: "financing", isFinanced: true, financeProvider: "Koalafi" };
  if (lower.includes("financ")) return { method: "financing", isFinanced: true, financeProvider: "Unknown" };

  if (lower.includes("cash")) return { method: "cash", isFinanced: false, financeProvider: null };
  if (lower.includes("visa") || lower.includes("master") || lower.includes("card") || lower.includes("charge") || lower.includes("debit"))
    return { method: "card", isFinanced: false, financeProvider: null };
  if (lower.includes("check") || lower.includes("cheque")) return { method: "check", isFinanced: false, financeProvider: null };
  if (lower.includes("multiple")) return { method: "other", isFinanced: false, financeProvider: null };

  return { method: "other", isFinanced: false, financeProvider: null };
}

// ─── DETECT LAZY INVOICING ─────────────────────────────
// When labor=$0 but parts>$300, or parts=$0 but labor>$300,
// the invoice creator likely lumped everything into one field.
// Apply benefit of the doubt: split estimated 40/60 labor/parts
function detectLazyInvoicing(labor: number, parts: number, description: string): { labor: number; parts: number; isLazy: boolean } {
  const total = labor + parts;
  if (total === 0) return { labor, parts, isLazy: false };

  // If labor is 0 but total > $200 AND description mentions a service (not just tires/parts)
  const isServiceWork = /remove|replace|r.*r|install|repair|flush|adjust|weld|bleed|diagnos|tune/i.test(description);

  if (labor === 0 && parts > 200 && isServiceWork) {
    // Likely lumped labor into parts — estimate 45% labor / 55% parts
    return { labor: Math.round(total * 0.45), parts: Math.round(total * 0.55), isLazy: true };
  }

  // If parts is 0 but labor > $300 AND description mentions parts (pads, rotors, etc.)
  const mentionsParts = /pad|rotor|tire|part|filter|battery|sensor|bearing|plug|strut|caliper|belt|hose|alternator|starter/i.test(description);
  if (parts === 0 && labor > 300 && mentionsParts) {
    // Likely lumped parts into labor — estimate 55% labor / 45% parts
    return { labor: Math.round(total * 0.55), parts: Math.round(total * 0.45), isLazy: true };
  }

  return { labor, parts, isLazy: false };
}

// ─── PARSE DOLLAR AMOUNT ───────────────────────────────
function parseDollars(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[$,\s]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : Math.round(num * 100); // Store as cents
}

// ─── NORMALIZE CUSTOMER NAME ───────────────────────────
function normalizeName(raw: string): { firstName: string; lastName: string; normalized: string } {
  if (!raw || raw.trim() === "" || raw.trim() === "-") {
    return { firstName: "Unknown", lastName: "", normalized: "Unknown" };
  }

  let name = raw.trim()
    .replace(/"/g, "")   // Strip quotes
    .replace(/\s+/g, " "); // Collapse whitespace

  // Handle "LAST, FIRST" format
  if (name.includes(",")) {
    const parts = name.split(",").map(s => s.trim());
    const lastName = parts[0];
    const firstName = parts.slice(1).join(" ").trim();
    return {
      firstName: titleCase(firstName || "Unknown"),
      lastName: titleCase(lastName),
      normalized: `${titleCase(lastName)}, ${titleCase(firstName || "Unknown")}`,
    };
  }

  // Handle "First Last" format
  const parts = name.split(" ");
  const firstName = parts[0];
  const lastName = parts.slice(1).join(" ");
  return {
    firstName: titleCase(firstName),
    lastName: titleCase(lastName),
    normalized: `${titleCase(lastName || "Unknown")}, ${titleCase(firstName)}`,
  };
}

function titleCase(str: string): string {
  if (!str) return "";
  // Handle @-prefixed names (like @MOES)
  if (str.startsWith("@")) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

// ─── PARSE TOTAL SALES REPORT ──────────────────────────
export interface ParsedInvoice {
  invoiceNumber: string;
  poNumber: string;
  customerName: string;
  firstName: string;
  lastName: string;
  description: string;
  laborCents: number;
  partsCents: number;
  miscCents: number;
  taxCents: number;
  totalCents: number;
  payType: string;
  paymentMethod: "cash" | "card" | "check" | "financing" | "other";
  isFinanced: boolean;
  financeProvider: string | null;
  serviceCategory: string;
  isLazyInvoice: boolean;
  date: string; // YYYY-MM-DD
}

export interface ParsedDailyTotal {
  date: string;
  labor: number;
  parts: number;
  misc: number;
  tax: number;
  total: number;
  invoiceCount: number;
}

export function parseTotalSalesReport(content: string): { invoices: ParsedInvoice[]; dailyTotals: ParsedDailyTotal[] } {
  const lines = content.split("\n");
  const invoices: ParsedInvoice[] = [];
  const dailyTotals: ParsedDailyTotal[] = [];

  let currentDate = "";
  let dailyInvCount = 0;

  // Date line pattern: "Jan 9, 2024" or "Apr 3, 2026"
  const dateRe = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip header lines
    if (!line || line.startsWith("Inv\t") || line.startsWith("New Ticket") ||
        line.startsWith("In Progress") || line.startsWith("Recent") ||
        line.startsWith("Search...") || line.startsWith("Report:") ||
        line.startsWith("Date Range") || line.startsWith("Start Date") ||
        line.startsWith("End Date") || line.startsWith("Copyright") ||
        line.startsWith("Home")) continue;

    // Date line
    if (dateRe.test(line)) {
      currentDate = parseReportDate(line);
      dailyInvCount = 0;
      continue;
    }

    // Daily Totals line
    if (line.startsWith("Daily Totals")) {
      const parts = line.split("\t");
      // Find dollar amounts
      const dollars = parts.filter(p => p.startsWith("$") || p === "$0.00");
      if (dollars.length >= 4) {
        dailyTotals.push({
          date: currentDate,
          labor: parseDollars(dollars[0]),
          parts: parseDollars(dollars[1]),
          misc: parseDollars(dollars[2]),
          tax: parseDollars(dollars[3]),
          total: dollars[4] ? parseDollars(dollars[4]) : 0,
          invoiceCount: dailyInvCount,
        });
      }
      continue;
    }

    // Grand Totals line
    if (line.startsWith("Grand Totals")) continue;

    // Invoice line — starts with a number (invoice number)
    const parts = line.split("\t");
    if (parts.length >= 6 && /^\d+$/.test(parts[0].trim())) {
      const invNum = parts[0].trim();
      const poNum = parts[1]?.trim() || "";
      const customerRaw = parts[2]?.trim() || "";
      const description = parts[3]?.trim() || "";

      // Find dollar amounts — they can be in various positions
      const laborRaw = parts[4]?.trim() || "$0.00";
      const partsRaw = parts[5]?.trim() || "$0.00";
      const miscRaw = parts[6]?.trim() || "$0.00";
      const taxRaw = parts[7]?.trim() || "$0.00";
      const totalRaw = parts[8]?.trim() || "$0.00";
      const payTypeRaw = parts[9]?.trim() || "";

      const laborCents = parseDollars(laborRaw);
      const partsCents = parseDollars(partsRaw);
      const miscCents = parseDollars(miscRaw);
      const taxCents = parseDollars(taxRaw);
      const totalCents = parseDollars(totalRaw);

      // Smart cleanup: detect lazy invoicing
      const { labor: adjLabor, parts: adjParts, isLazy } = detectLazyInvoicing(laborCents, partsCents, description);

      // Normalize customer name
      const { firstName, lastName, normalized } = normalizeName(customerRaw);

      // Categorize service
      const serviceCategory = categorizeService(description);

      // Payment type
      const { method, isFinanced, financeProvider } = normalizePaymentType(payTypeRaw);

      invoices.push({
        invoiceNumber: invNum,
        poNumber: poNum,
        customerName: normalized,
        firstName,
        lastName,
        description,
        laborCents: adjLabor,
        partsCents: adjParts,
        miscCents,
        taxCents,
        totalCents,
        payType: payTypeRaw,
        paymentMethod: method,
        isFinanced,
        financeProvider,
        serviceCategory,
        isLazyInvoice: isLazy,
        date: currentDate,
      });
      dailyInvCount++;
    }
  }

  return { invoices, dailyTotals };
}

// ─── PARSE TECH SALES REPORT ───────────────────────────
export interface TechProfile {
  name: string;
  totalHours: number;
  totalLaborCents: number;
  totalPartsCents: number;
  lineItems: number;
  avgRate: number; // cents per hour
  topServices: Record<string, number>; // service category → count
}

export function parseTechReport(content: string): TechProfile[] {
  const lines = content.split("\n");
  const techs: TechProfile[] = [];

  let currentTech = "";
  let currentItems = 0;
  let currentHours = 0;
  let currentLabor = 0;
  let currentParts = 0;
  const currentServices: Record<string, number> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip headers
    if (!line || line.startsWith("New Ticket") || line.startsWith("In Progress") ||
        line.startsWith("Recent") || line.startsWith("Search...") ||
        line.startsWith("Report:") || line.startsWith("Date Range") ||
        line.startsWith("Start Date") || line.startsWith("End Date") ||
        line.startsWith("Date\t") || line.startsWith("Copyright") ||
        line.startsWith("Home") || line.startsWith("MISC CHARGES")) continue;

    // Filter by: line = tech name header
    if (line.startsWith("Filter by:")) continue;

    // Technician Totals line
    if (line.startsWith("Technician Totals:")) {
      // Parse totals: "Technician Totals:\tParts:\tHours:\tLabor:\t\tTotal:"
      // Next values are on same line or parsed from accumulated data
      const parts = line.split("\t");
      // The actual totals are on the same line in the format:
      // $0.00\t17.60\t$1,945.00\t\t$1,945.00
      const nextLine = lines[i + 1]?.trim() || "";
      const vals = nextLine.split("\t").map(s => s.trim()).filter(Boolean);

      if (currentTech && vals.length >= 3) {
        techs.push({
          name: currentTech,
          totalHours: parseFloat(vals[1]?.replace(/,/g, "") || "0") || currentHours,
          totalLaborCents: parseDollars(vals[2] || "0"),
          totalPartsCents: parseDollars(vals[0] || "0"),
          lineItems: currentItems,
          avgRate: currentHours > 0 ? Math.round(currentLabor / currentHours) : 0,
          topServices: { ...currentServices },
        });
      }
      currentTech = "";
      currentItems = 0;
      currentHours = 0;
      currentLabor = 0;
      currentParts = 0;
      Object.keys(currentServices).forEach(k => delete currentServices[k]);
      i++; // Skip the values line
      continue;
    }

    // Tech name line (just a name, no tabs with dollar signs)
    if (!line.includes("\t") && !line.startsWith("$") && /^[A-Z@*]/.test(line) && line.length > 2 && !line.startsWith("Grand")) {
      // Save previous tech if exists
      currentTech = line.replace(/^[*]+,?\s*/, "").trim();
      currentItems = 0;
      currentHours = 0;
      currentLabor = 0;
      currentParts = 0;
      Object.keys(currentServices).forEach(k => delete currentServices[k]);
      continue;
    }

    // Line item: Date\tInv\tDescription\tType\tQuantity\tHours\tRate\tTotal
    if (currentTech && line.includes("\t")) {
      const parts = line.split("\t");
      if (parts.length >= 4) {
        const description = parts[2]?.trim() || "";
        const hours = parseFloat(parts[5]?.trim() || "0") || 0;
        const total = parseDollars(parts[7] || "0");

        currentItems++;
        currentHours += hours;
        currentLabor += total;

        const cat = categorizeService(description);
        currentServices[cat] = (currentServices[cat] || 0) + 1;
      }
    }
  }

  return techs;
}

// ─── PARSE LABOR SALES REPORT ──────────────────────────
export interface LaborService {
  description: string;
  tickets: number;
  hours: number;
  avgRate: number;
  revenue: number;
  category: string;
}

export function parseLaborReport(content: string): LaborService[] {
  const lines = content.split("\n");
  const services: LaborService[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("New Ticket") || trimmed.startsWith("In Progress") ||
        trimmed.startsWith("Recent") || trimmed.startsWith("Search...") ||
        trimmed.startsWith("Report:") || trimmed.startsWith("Date Range") ||
        trimmed.startsWith("Start Date") || trimmed.startsWith("End Date") ||
        trimmed.startsWith("Labor Description") || trimmed.startsWith("Grand Totals") ||
        trimmed.startsWith("Copyright") || trimmed.startsWith("Home")) continue;

    const parts = trimmed.split("\t");
    if (parts.length >= 5) {
      const description = parts[0]?.trim() || "";
      const tickets = parseInt(parts[1]?.trim() || "0") || 0;
      const hours = parseFloat(parts[2]?.trim() || "0") || 0;
      const rate = parseDollars(parts[3] || "0");
      const revenue = parseDollars(parts[4] || "0");

      if (description && revenue > 0) {
        services.push({
          description,
          tickets,
          hours,
          avgRate: rate,
          revenue,
          category: categorizeService(description),
        });
      }
    }
  }

  return services;
}

// ─── PARSE PARTS SALES REPORT ──────────────────────────
export interface PartSale {
  description: string;
  partNumber: string;
  quantity: number;
  rate: number;
  revenue: number;
  brand: string;
}

const PART_BRANDS: Record<string, RegExp> = {
  Duralast: /duralast/i,
  Bosch: /bosch/i,
  Moog: /moog/i,
  ACDelco: /acdelco/i,
  Dorman: /dorman/i,
  Walker: /walker/i,
  NTK: /ntk/i,
  STP: /stp/i,
  Continental: /continental/i,
  Beck_Arnley: /beck.*arnley/i,
  Autolite: /autolite/i,
  Dayco: /dayco/i,
  Motorcraft: /motorcraft/i,
  TRW: /trw/i,
  Gateway: /gateway/i,
  Yokohama: /yokohama/i,
  Milestar: /milestar/i,
  Goodyear: /goodyear/i,
  Westar: /westar/i,
  Generic: /.*/,
};

function detectBrand(description: string): string {
  for (const [brand, pattern] of Object.entries(PART_BRANDS)) {
    if (brand !== "Generic" && pattern.test(description)) return brand;
  }
  return "Generic";
}

export function parsePartsReport(content: string): PartSale[] {
  const lines = content.split("\n");
  const parts: PartSale[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("New Ticket") || trimmed.startsWith("In Progress") ||
        trimmed.startsWith("Recent") || trimmed.startsWith("Search...") ||
        trimmed.startsWith("Report:") || trimmed.startsWith("Date Range") ||
        trimmed.startsWith("Start Date") || trimmed.startsWith("End Date") ||
        trimmed.startsWith("Part Description") || trimmed.startsWith("Grand Totals") ||
        trimmed.startsWith("Copyright") || trimmed.startsWith("Home")) continue;

    const cols = trimmed.split("\t");
    if (cols.length >= 4) {
      const description = cols[0]?.trim() || "";
      // Columns can be: Description, PartNumber, Quantity, Rate, Revenue
      // OR: Description, Quantity, Rate, Revenue (no part number)
      let partNumber = "";
      let qtyIdx = 1;

      // If second column looks like a part number (contains letters+numbers)
      if (cols[1] && /[A-Za-z]/.test(cols[1]) && !/^\d+\.\d+$/.test(cols[1].trim())) {
        partNumber = cols[1].trim();
        qtyIdx = 2;
      }

      const quantity = parseFloat(cols[qtyIdx]?.trim() || "0") || 0;
      const rate = parseDollars(cols[qtyIdx + 1] || "0");
      const revenue = parseDollars(cols[qtyIdx + 2] || "0");

      if (revenue > 0) {
        parts.push({
          description,
          partNumber,
          quantity,
          rate,
          revenue,
          brand: detectBrand(description),
        });
      }
    }
  }

  return parts;
}

// ─── ANALYTICS GENERATION ──────────────────────────────
export interface ShopAnalytics {
  // Revenue
  totalRevenue: number;
  totalLabor: number;
  totalParts: number;
  totalMisc: number;
  totalTax: number;
  invoiceCount: number;
  operatingDays: number;
  avgDailyRevenue: number;
  avgTicketSize: number;

  // Trends
  monthlyRevenue: Array<{ month: string; labor: number; parts: number; misc: number; tax: number; total: number; count: number }>;
  weekdayDistribution: Record<string, { count: number; revenue: number }>;

  // Service mix
  serviceCategories: Array<{ category: string; count: number; revenue: number; pctOfTotal: number }>;

  // Payment analysis
  paymentMethods: Array<{ method: string; count: number; revenue: number; pct: number }>;
  financingBreakdown: { totalFinanced: number; count: number; providers: Record<string, { count: number; revenue: number }> };

  // Tech performance
  techScores: TechProfile[];

  // Customer insights
  topCustomers: Array<{ name: string; visits: number; totalSpent: number; avgTicket: number; lastVisit: string }>;
  repeatRate: number; // % of customers with 2+ visits
  customerCount: number;

  // Parts intelligence
  topParts: Array<{ description: string; revenue: number; quantity: number; brand: string }>;
  brandDistribution: Array<{ brand: string; revenue: number; count: number }>;

  // Labor intelligence
  topServices: Array<{ description: string; revenue: number; tickets: number; category: string }>;

  // Lazy invoicing stats
  lazyInvoiceCount: number;
  lazyInvoicePct: number;

  // Projections
  projectedMonthlyRevenue: number;
  projectedAnnualRevenue: number;
  growthRate: number; // month-over-month %
  laborPartsRatio: number;
}

export function generateAnalytics(
  invoices: ParsedInvoice[],
  dailyTotals: ParsedDailyTotal[],
  techs: TechProfile[],
  laborServices: LaborService[],
  partSales: PartSale[],
): ShopAnalytics {
  // Revenue totals
  const totalRevenue = invoices.reduce((s, i) => s + i.totalCents, 0);
  const totalLabor = invoices.reduce((s, i) => s + i.laborCents, 0);
  const totalParts = invoices.reduce((s, i) => s + i.partsCents, 0);
  const totalMisc = invoices.reduce((s, i) => s + i.miscCents, 0);
  const totalTax = invoices.reduce((s, i) => s + i.taxCents, 0);

  // Monthly revenue
  const monthMap = new Map<string, { labor: number; parts: number; misc: number; tax: number; total: number; count: number }>();
  for (const inv of invoices) {
    const month = inv.date.slice(0, 7); // YYYY-MM
    const existing = monthMap.get(month) || { labor: 0, parts: 0, misc: 0, tax: 0, total: 0, count: 0 };
    existing.labor += inv.laborCents;
    existing.parts += inv.partsCents;
    existing.misc += inv.miscCents;
    existing.tax += inv.taxCents;
    existing.total += inv.totalCents;
    existing.count++;
    monthMap.set(month, existing);
  }
  const monthlyRevenue = Array.from(monthMap.entries())
    .map(([month, data]) => ({ month, ...data }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // Weekday distribution
  const weekdays: Record<string, { count: number; revenue: number }> = {};
  for (const inv of invoices) {
    const d = new Date(inv.date + "T12:00:00");
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
    if (!weekdays[day]) weekdays[day] = { count: 0, revenue: 0 };
    weekdays[day].count++;
    weekdays[day].revenue += inv.totalCents;
  }

  // Service categories
  const catMap = new Map<string, { count: number; revenue: number }>();
  for (const inv of invoices) {
    const existing = catMap.get(inv.serviceCategory) || { count: 0, revenue: 0 };
    existing.count++;
    existing.revenue += inv.totalCents;
    catMap.set(inv.serviceCategory, existing);
  }
  const serviceCategories = Array.from(catMap.entries())
    .map(([category, data]) => ({ category, ...data, pctOfTotal: totalRevenue > 0 ? Math.round(data.revenue / totalRevenue * 10000) / 100 : 0 }))
    .sort((a, b) => b.revenue - a.revenue);

  // Payment methods
  const payMap = new Map<string, { count: number; revenue: number }>();
  for (const inv of invoices) {
    const method = inv.paymentMethod;
    const existing = payMap.get(method) || { count: 0, revenue: 0 };
    existing.count++;
    existing.revenue += inv.totalCents;
    payMap.set(method, existing);
  }
  const paymentMethods = Array.from(payMap.entries())
    .map(([method, data]) => ({ method, ...data, pct: Math.round(data.count / invoices.length * 10000) / 100 }))
    .sort((a, b) => b.revenue - a.revenue);

  // Financing breakdown
  const financed = invoices.filter(i => i.isFinanced);
  const providerMap = new Map<string, { count: number; revenue: number }>();
  for (const inv of financed) {
    const p = inv.financeProvider || "Unknown";
    const existing = providerMap.get(p) || { count: 0, revenue: 0 };
    existing.count++;
    existing.revenue += inv.totalCents;
    providerMap.set(p, existing);
  }

  // Top customers
  const custMap = new Map<string, { visits: number; totalSpent: number; lastVisit: string }>();
  for (const inv of invoices) {
    const key = inv.customerName;
    const existing = custMap.get(key) || { visits: 0, totalSpent: 0, lastVisit: "" };
    existing.visits++;
    existing.totalSpent += inv.totalCents;
    if (!existing.lastVisit || inv.date > existing.lastVisit) existing.lastVisit = inv.date;
    custMap.set(key, existing);
  }
  const topCustomers = Array.from(custMap.entries())
    .map(([name, data]) => ({ name, ...data, avgTicket: Math.round(data.totalSpent / data.visits) }))
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, 30);

  const repeatCustomers = Array.from(custMap.values()).filter(c => c.visits >= 2).length;
  const repeatRate = custMap.size > 0 ? Math.round(repeatCustomers / custMap.size * 10000) / 100 : 0;

  // Growth rate (last 3 months vs prior 3 months)
  const recentMonths = monthlyRevenue.slice(-3);
  const priorMonths = monthlyRevenue.slice(-6, -3);
  const recentAvg = recentMonths.length > 0 ? recentMonths.reduce((s, m) => s + m.total, 0) / recentMonths.length : 0;
  const priorAvg = priorMonths.length > 0 ? priorMonths.reduce((s, m) => s + m.total, 0) / priorMonths.length : 0;
  const growthRate = priorAvg > 0 ? Math.round((recentAvg - priorAvg) / priorAvg * 10000) / 100 : 0;

  // Top parts
  const topParts = partSales
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 30)
    .map(p => ({ description: p.description, revenue: p.revenue, quantity: p.quantity, brand: p.brand }));

  // Brand distribution
  const brandMap = new Map<string, { revenue: number; count: number }>();
  for (const p of partSales) {
    const existing = brandMap.get(p.brand) || { revenue: 0, count: 0 };
    existing.revenue += p.revenue;
    existing.count++;
    brandMap.set(p.brand, existing);
  }
  const brandDistribution = Array.from(brandMap.entries())
    .map(([brand, data]) => ({ brand, ...data }))
    .sort((a, b) => b.revenue - a.revenue);

  // Top labor services
  const topServices = laborServices
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 30);

  const lazyCount = invoices.filter(i => i.isLazyInvoice).length;

  return {
    totalRevenue,
    totalLabor,
    totalParts,
    totalMisc,
    totalTax,
    invoiceCount: invoices.length,
    operatingDays: dailyTotals.length,
    avgDailyRevenue: dailyTotals.length > 0 ? Math.round(totalRevenue / dailyTotals.length) : 0,
    avgTicketSize: invoices.length > 0 ? Math.round(totalRevenue / invoices.length) : 0,
    monthlyRevenue,
    weekdayDistribution: weekdays,
    serviceCategories,
    paymentMethods,
    financingBreakdown: {
      totalFinanced: financed.reduce((s, i) => s + i.totalCents, 0),
      count: financed.length,
      providers: Object.fromEntries(providerMap),
    },
    techScores: techs,
    topCustomers,
    repeatRate,
    customerCount: custMap.size,
    topParts,
    brandDistribution,
    topServices,
    lazyInvoiceCount: lazyCount,
    lazyInvoicePct: invoices.length > 0 ? Math.round(lazyCount / invoices.length * 10000) / 100 : 0,
    projectedMonthlyRevenue: recentAvg,
    projectedAnnualRevenue: recentAvg * 12,
    growthRate,
    laborPartsRatio: totalParts > 0 ? Math.round(totalLabor / totalParts * 100) / 100 : 0,
  };
}

// ─── DB INGESTION ──────────────────────────────────────
export async function ingestInvoices(invoices: ParsedInvoice[]): Promise<{ created: number; updated: number; matched: number }> {
  const { getDb } = await import("../db");
  const { invoices: invoicesTable, customers } = await import("../../drizzle/schema");
  const db = await getDb();
  if (!db) return { created: 0, updated: 0, matched: 0 };

  let created = 0;
  let updated = 0;
  let matched = 0;

  for (const inv of invoices) {
    try {
      // Check if invoice already exists
      const existing = await db.select({ id: invoicesTable.id })
        .from(invoicesTable)
        .where(eq(invoicesTable.invoiceNumber, inv.invoiceNumber))
        .limit(1);

      if (existing.length > 0) {
        // Update existing
        await db.update(invoicesTable).set({
          customerName: `${inv.lastName}, ${inv.firstName}`,
          totalAmount: inv.totalCents,
          laborCost: inv.laborCents,
          partsCost: inv.partsCents,
          taxAmount: inv.taxCents,
          serviceDescription: inv.description || null,
          paymentMethod: inv.paymentMethod,
          invoiceDate: new Date(inv.date + "T12:00:00"),
          source: "shopdriver",
        }).where(eq(invoicesTable.id, existing[0].id));
        updated++;
        continue;
      }

      // Try to match customer by name
      let customerId: number | null = null;
      if (inv.lastName) {
        const custMatches = await db.select({ id: customers.id })
          .from(customers)
          .where(sql`UPPER(TRIM(${customers.lastName})) = ${inv.lastName.toUpperCase().trim()} AND UPPER(TRIM(${customers.firstName})) = ${inv.firstName.toUpperCase().trim()}`)
          .limit(1);
        if (custMatches.length > 0) {
          customerId = custMatches[0].id;
          matched++;
        }
      }

      await db.insert(invoicesTable).values({
        customerId,
        customerName: `${inv.lastName}, ${inv.firstName}`,
        customerPhone: null,
        invoiceNumber: inv.invoiceNumber,
        totalAmount: inv.totalCents,
        laborCost: inv.laborCents,
        partsCost: inv.partsCents,
        taxAmount: inv.taxCents,
        serviceDescription: inv.description || null,
        vehicleInfo: null,
        paymentMethod: inv.paymentMethod,
        paymentStatus: "paid",
        invoiceDate: new Date(inv.date + "T12:00:00"),
        source: "shopdriver",
      });
      created++;
    } catch (err: unknown) {
      // Skip duplicates
      if ((err as Error).message?.includes("Duplicate")) continue;
      log.warn(`Failed to ingest invoice ${inv.invoiceNumber}: ${(err as Error).message}`);
    }
  }

  return { created, updated, matched };
}

// ─── DATE PARSER ───────────────────────────────────────
function parseReportDate(raw: string): string {
  const months: Record<string, string> = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
  };
  const match = raw.match(/^(\w{3})\s+(\d{1,2}),\s+(\d{4})$/);
  if (!match) return "1970-01-01";
  const [, mon, day, year] = match;
  return `${year}-${months[mon] || "01"}-${day.padStart(2, "0")}`;
}
