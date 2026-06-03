/**
 * revenueFormat — pure $ formatters + dashboard data types for the Money
 * hub's Revenue tab. Extracted verbatim from RevenueSection.tsx (MOVE
 * refactor · no logic change). These close over nothing and are imported
 * back by RevenueSection + DashboardView.
 *
 * NOTE · formatDollars here is the FULL-precision `$1,234` formatter and is
 * intentionally distinct from moneyMath.formatMoneyShort (the compact
 * `$1.2K` formatter used by MoneyBrief). Do not consolidate them.
 */
import { BUSINESS } from "@shared/business";

export const MONTHLY_TARGET = BUSINESS.revenueTarget.monthly;

// formatCents / formatDollars hoisted to admin/shared/format (single
// source of truth across all admin briefs). Re-exported here for back-
// compat so existing money/ importers keep working unchanged.
export { formatCents, formatDollars } from "../shared/format";

// ─── DASHBOARD TYPES ────────────────────────────────────
export interface FunnelStage { label: string; name?: string; count: number; revenue?: number }
export interface PaymentBreakdown { method: string; amount: number }
export interface TopCustomer { name: string; phone: string | null; total: number; count: number; lastVisit: Date }
export interface ServiceItem { category: string; revenue: number; count: number; avgTicket: number }
export interface TopDay { day: string; revenue: number; jobs: number }
export interface IntelRecommendation { priority: string; type: string; text: string }
export interface AtRiskWhaleRev { name: string; totalSpent: number; daysSince: number; visits?: number; phone?: string }
export interface InvoiceItem {
  id: number;
  invoiceNumber?: string;
  invoiceDate: string;
  customerName?: string;
  customerPhone?: string;
  serviceDescription?: string;
  total: number;
  totalAmount?: number;
  partsCost?: number;
  laborCost?: number;
  taxAmount?: number;
  vehicleInfo?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  source?: string;
  algTicketId?: string | null;
}

// DashboardView receives complex tRPC query results — typed at call sites instead
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DashboardViewProps = Record<string, any>;
