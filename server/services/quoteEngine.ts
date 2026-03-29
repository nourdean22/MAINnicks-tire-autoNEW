/**
 * Quote Truth Engine — Combines parts + labor into a complete quote
 * with data quality metadata so the customer sees what's real vs estimated.
 *
 * Every number carries its provenance:
 * - "live": from a vendor API (Gateway Tire, ShopDriver)
 * - "catalog": from our curated fallback database
 * - "estimated": calculated from labor guide averages
 * - "manual": entered by a technician
 */

export type DataSource = "live" | "catalog" | "estimated" | "manual";

export interface QuoteLine {
  type: "labor" | "tire" | "part";
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  source: DataSource;
  sourceDetail?: string; // e.g. "Gateway Tire B2B" or "Built-in Labor Guide"
  confidence: "high" | "medium" | "low";
  hours?: number; // for labor lines
}

export interface Quote {
  id: string;
  lines: QuoteLine[];
  subtotalCents: number;
  taxRate: number;
  taxCents: number;
  totalCents: number;
  dataQuality: {
    liveDataCount: number;
    catalogDataCount: number;
    estimatedDataCount: number;
    overallConfidence: "high" | "medium" | "low";
    warnings: string[];
  };
  createdAt: string;
  vehicleInfo?: string;
  customerName?: string;
}

/** Build data quality summary from lines */
function computeDataQuality(lines: QuoteLine[]): Quote["dataQuality"] {
  const liveDataCount = lines.filter(l => l.source === "live").length;
  const catalogDataCount = lines.filter(l => l.source === "catalog").length;
  const estimatedDataCount = lines.filter(l => l.source === "estimated").length;
  const warnings: string[] = [];

  if (estimatedDataCount > 0) {
    warnings.push(`${estimatedDataCount} line(s) use estimated pricing — verify before presenting to customer`);
  }
  if (catalogDataCount > 0 && liveDataCount === 0) {
    warnings.push("No live vendor data — prices from catalog may not reflect current availability");
  }

  const lowConfidenceCount = lines.filter(l => l.confidence === "low").length;
  const overallConfidence: "high" | "medium" | "low" =
    lowConfidenceCount > 0 ? "low"
    : estimatedDataCount > lines.length / 2 ? "medium"
    : "high";

  return { liveDataCount, catalogDataCount, estimatedDataCount, overallConfidence, warnings };
}

/** Create a quote from line items */
export function buildQuote(params: {
  lines: Omit<QuoteLine, "totalCents">[];
  taxRate?: number;
  vehicleInfo?: string;
  customerName?: string;
}): Quote {
  const { taxRate = 0.08, vehicleInfo, customerName } = params;

  const lines: QuoteLine[] = params.lines.map(l => ({
    ...l,
    totalCents: l.unitPriceCents * l.quantity,
  }));

  const subtotalCents = lines.reduce((sum, l) => sum + l.totalCents, 0);
  const taxCents = Math.round(subtotalCents * taxRate);
  const totalCents = subtotalCents + taxCents;

  return {
    id: `Q-${Date.now().toString(36).toUpperCase()}`,
    lines,
    subtotalCents,
    taxRate,
    taxCents,
    totalCents,
    dataQuality: computeDataQuality(lines),
    createdAt: new Date().toISOString(),
    vehicleInfo,
    customerName,
  };
}

/** Create a labor line from the built-in guide */
export function laborLine(params: {
  description: string;
  hours: number;
  laborRateCents: number;
  source?: DataSource;
  difficulty?: "standard" | "moderate" | "difficult";
}): Omit<QuoteLine, "totalCents"> {
  const { description, hours, laborRateCents, source = "catalog", difficulty = "standard" } = params;
  const multiplier = difficulty === "difficult" ? 1.3 : difficulty === "moderate" ? 1.15 : 1.0;
  const adjustedHours = Math.round(hours * multiplier * 10) / 10;

  return {
    type: "labor",
    description,
    quantity: 1,
    unitPriceCents: Math.round(adjustedHours * laborRateCents),
    source,
    sourceDetail: source === "live" ? "ShopDriver Elite" : "Built-in Labor Guide",
    confidence: source === "live" ? "high" : "medium",
    hours: adjustedHours,
  };
}

/** Create a tire line */
export function tireLine(params: {
  description: string;
  quantity: number;
  unitPriceCents: number;
  source: DataSource;
}): Omit<QuoteLine, "totalCents"> {
  return {
    type: "tire",
    description: params.description,
    quantity: params.quantity,
    unitPriceCents: params.unitPriceCents,
    source: params.source,
    sourceDetail: params.source === "live" ? "Gateway Tire B2B" : "Curated Catalog",
    confidence: params.source === "live" ? "high" : "medium",
  };
}

/** Create a parts line */
export function partLine(params: {
  description: string;
  quantity: number;
  unitPriceCents: number;
  source?: DataSource;
}): Omit<QuoteLine, "totalCents"> {
  return {
    type: "part",
    description: params.description,
    quantity: params.quantity,
    unitPriceCents: params.unitPriceCents,
    source: params.source || "manual",
    sourceDetail: "Manual entry",
    confidence: params.source === "manual" || !params.source ? "high" : "medium",
  };
}

/** Format a quote for display */
export function formatQuoteSummary(quote: Quote): string {
  const lines = quote.lines.map(l => {
    const total = (l.totalCents / 100).toFixed(2);
    const marker = l.source === "live" ? "" : l.source === "estimated" ? " ~" : "";
    return `  ${l.description}: $${total}${marker}`;
  });

  return [
    `Quote ${quote.id}`,
    ...lines,
    `  Subtotal: $${(quote.subtotalCents / 100).toFixed(2)}`,
    `  Tax (${(quote.taxRate * 100).toFixed(0)}%): $${(quote.taxCents / 100).toFixed(2)}`,
    `  TOTAL: $${(quote.totalCents / 100).toFixed(2)}`,
    `  Data confidence: ${quote.dataQuality.overallConfidence.toUpperCase()}`,
    ...(quote.dataQuality.warnings.length > 0 ? [`  Warnings: ${quote.dataQuality.warnings.join("; ")}`] : []),
  ].join("\n");
}
