/**
 * Degraded Mode — Defines graceful fallback behavior when vendors are down.
 *
 * Each vendor has a degraded mode rule:
 * - What to show instead
 * - What features to disable
 * - What admin alerts to trigger
 *
 * Public-facing pages should NEVER show errors. They show fallback content
 * or "Call us" CTAs instead.
 */

export interface DegradedRule {
  vendor: string;
  /** What happens when this vendor is down */
  fallback: string;
  /** Features that still work in degraded mode */
  available: string[];
  /** Features that are disabled */
  disabled: string[];
  /** What the customer sees */
  customerMessage: string;
  /** Whether to show a banner on public pages */
  showBanner: boolean;
}

const DEGRADED_RULES: Record<string, DegradedRule> = {
  gatewayTire: {
    vendor: "Gateway Tire B2B",
    fallback: "Curated catalog with estimated pricing (8 tire models, common sizes)",
    available: ["Tire browsing", "Price estimates", "Order placement (manual fulfillment)"],
    disabled: ["Live inventory check", "Real-time pricing", "Automated Gateway ordering"],
    customerMessage: "We're showing our popular tire options. Call (216) 862-0005 for full selection and today's pricing.",
    showBanner: false,
  },
  twilio: {
    vendor: "Twilio SMS",
    fallback: "SMS notifications silently fail — booking/lead still saved to DB and Google Sheets",
    available: ["Booking creation", "Lead capture", "Email notifications", "Google Sheets sync"],
    disabled: ["SMS confirmations", "SMS follow-ups", "Review request texts", "Appointment reminders"],
    customerMessage: "", // Customer never sees this
    showBanner: false,
  },
  stripe: {
    vendor: "Stripe Payments",
    fallback: "Financing providers (Acima, Snap, Koalafi, Synchrony) remain available. Cash/check accepted in-shop.",
    available: ["Financing applications", "Invoice creation", "Cash payments"],
    disabled: ["Online card payments", "Payment status webhooks"],
    customerMessage: "Online payments temporarily unavailable. We accept cash, check, or financing through our in-shop financing partners.",
    showBanner: true,
  },
  autoLabor: {
    vendor: "Auto Labor Guide",
    fallback: "Built-in labor database with 7 categories, 65+ common jobs, and averaged labor hours",
    available: ["Labor time estimates", "Quick estimates", "Category browsing", "Job search"],
    disabled: ["Vehicle-specific labor times", "ShopDriver Elite portal sync"],
    customerMessage: "",
    showBanner: false,
  },
  googleSheets: {
    vendor: "Google Sheets CRM",
    fallback: "Data saved to database only — manual sheet sync needed when restored",
    available: ["All booking/lead/order features", "Database storage", "Email notifications"],
    disabled: ["Automatic CRM sheet sync", "Real-time sheet updates"],
    customerMessage: "",
    showBanner: false,
  },
  gmail: {
    vendor: "Gmail Notifications",
    fallback: "All data still captured — admin checks dashboard for new bookings/leads",
    available: ["All booking/lead/order features", "Database storage", "SMS notifications"],
    disabled: ["Email alerts to shop owner", "Email confirmations to customers"],
    customerMessage: "",
    showBanner: false,
  },
  nourOsBridge: {
    vendor: "NOUR OS Bridge",
    fallback: "Events queued locally — dispatched when bridge reconnects",
    available: ["All shop features", "Local event logging"],
    disabled: ["Real-time NOUR OS dashboard updates", "Cross-system event dispatch"],
    customerMessage: "",
    showBanner: false,
  },
};

/** Get the degraded rule for a vendor */
export function getDegradedRule(vendorKey: string): DegradedRule | null {
  return DEGRADED_RULES[vendorKey] || null;
}

/** Get all degraded rules */
export function getAllDegradedRules(): DegradedRule[] {
  return Object.values(DEGRADED_RULES);
}

/** Get customer-visible messages for currently degraded vendors */
export function getActiveDegradedMessages(downVendors: string[]): Array<{
  vendor: string;
  message: string;
  showBanner: boolean;
}> {
  return downVendors
    .map(key => {
      const rule = DEGRADED_RULES[key];
      if (!rule || !rule.customerMessage) return null;
      return {
        vendor: rule.vendor,
        message: rule.customerMessage,
        showBanner: rule.showBanner,
      };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);
}

/** Map vendor health result to degraded mode vendor key */
export function vendorNameToKey(vendorName: string): string | null {
  const mapping: Record<string, string> = {
    "Gateway Tire B2B": "gatewayTire",
    "Twilio SMS": "twilio",
    "Stripe Payments": "stripe",
    "Auto Labor Guide": "autoLabor",
    "Google Sheets CRM": "googleSheets",
    "Gmail Notifications": "gmail",
    "NOUR OS Bridge": "nourOsBridge",
  };
  return mapping[vendorName] || null;
}
