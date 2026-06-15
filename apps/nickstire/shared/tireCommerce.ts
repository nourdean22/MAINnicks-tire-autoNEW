export type TireConfidenceGrade = "high" | "medium" | "low";

export type TireRiskFlag =
  | "uncommon_size"
  | "missing_email"
  | "unpaid_balance"
  | "unconfirmed_availability"
  | "missing_gateway_reference"
  | "manual_supplier_order_required"
  | "fitment_needs_confirmation"
  | "high_quantity"
  | "cancelled_or_unavailable"
  | "ready_for_install"
  | "invoice_pending"
  | "payment_pending";

export type TireNextAction =
  | "confirm_availability"
  | "call_customer"
  | "confirm_fitment"
  | "order_from_gateway"
  | "await_delivery"
  | "schedule_install"
  | "mark_ready_for_install"
  | "collect_payment"
  | "verify_invoice"
  | "close_order"
  | "cancel_or_refund";

interface TireOrderLike {
  status: string;
  paymentStatus: string;
  tireBrand: string;
  tireModel: string;
  tireSize: string;
  quantity: number;
  customerPhone: string;
  customerEmail?: string | null;
  vehicleInfo?: string | null;
  gatewayOrderRef?: string | null;
  invoiceNumber?: string | null;
  customerNotes?: string | null;
  createdAt?: string | Date | null;
}

const POPULAR_SIZES = [
  "2055516", "2156016", "2156017", "2257017", "2356518",
  "2457016", "2657017", "2657018", "2756020", "3157017",
  "1956515", "2155517", "2256017", "2356517", "2457517",
];

const CURATED_BRANDS = [
  "FORTUNE", "AMERICUS", "NEXEN", "HANKOOK", "COOPER", "CONTINENTAL", "GENERAL", "FIRESTONE",
];

export function getQuoteConfidence(order: TireOrderLike): {
  grade: TireConfidenceGrade;
  score: number;
  explanation: string;
} {
  if (order.status === "cancelled") {
    return { grade: "low", score: 0, explanation: "Order has been cancelled." };
  }

  // High confidence: supplier PO exists or status is confirmed/fulfilled
  if (order.gatewayOrderRef || ["ordered", "in_transit", "delivered", "scheduled", "installed"].includes(order.status)) {
    return {
      grade: "high",
      score: 95,
      explanation: "Live verified order with supplier reference or confirmed booking.",
    };
  }

  const cleanSize = order.tireSize.replace(/[^0-9]/g, "");
  const isCommon = POPULAR_SIZES.includes(cleanSize);
  const isCuratedBrand = CURATED_BRANDS.includes(order.tireBrand.toUpperCase());

  // Low confidence: Catalog fallback brand + uncommon size + unconfirmed status
  if (!isCommon && !isCuratedBrand && order.status === "received") {
    return {
      grade: "low",
      score: 30,
      explanation: "Curated catalog fallback. Uncommon size and brand from non-live inventory.",
    };
  }

  if (!isCommon && order.status === "received") {
    return {
      grade: "low",
      score: 45,
      explanation: "Fallback catalog match. Uncommon size, unconfirmed availability.",
    };
  }

  // Medium confidence: common size or curated brand, but unconfirmed status
  return {
    grade: "medium",
    score: 75,
    explanation: "Cached quote for popular size or curated brand. Awaiting supplier confirm.",
  };
}

export function getRiskFlags(order: TireOrderLike): TireRiskFlag[] {
  const flags: TireRiskFlag[] = [];

  if (order.status === "cancelled") {
    flags.push("cancelled_or_unavailable");
    return flags;
  }

  const cleanSize = order.tireSize.replace(/[^0-9]/g, "");
  const isCommon = POPULAR_SIZES.includes(cleanSize);

  // 1. Uncommon size
  if (!isCommon) {
    flags.push("uncommon_size");
  }

  // 2. Missing email
  if (!order.customerEmail || !order.customerEmail.includes("@")) {
    flags.push("missing_email");
  }

  // 3. Unpaid balance (removed: payment is done via separate register)

  // 4. Unconfirmed availability
  if (order.status === "received") {
    flags.push("unconfirmed_availability");
  }

  // 5. Missing gateway reference
  if (!order.gatewayOrderRef && ["confirmed", "ordered"].includes(order.status)) {
    flags.push("missing_gateway_reference");
  }

  // 6. Manual supplier order required
  if (!isCommon && order.status === "received") {
    flags.push("manual_supplier_order_required");
  }

  // 7. Fitment needs confirmation
  if (
    !order.vehicleInfo ||
    order.vehicleInfo.trim() === "" ||
    order.vehicleInfo.toLowerCase() === "not specified" ||
    order.vehicleInfo.toLowerCase() === "unknown"
  ) {
    flags.push("fitment_needs_confirmation");
  }

  // 8. High quantity
  if (order.quantity > 4) {
    flags.push("high_quantity");
  }

  // 9. Ready for install
  if (["delivered", "scheduled"].includes(order.status)) {
    flags.push("ready_for_install");
  }

  // 10. Invoice pending
  if (!order.invoiceNumber) {
    flags.push("invoice_pending");
  }

  // 11. Payment pending (removed: payment is done via separate register)

  return flags;
}

export function getNextAction(order: TireOrderLike): {
  action: TireNextAction;
  priority: "urgent" | "high" | "normal" | "low";
  label: string;
  reason: string;
  staffInstruction: string;
} {
  if (order.status === "cancelled") {
    return {
      action: "cancel_or_refund",
      priority: "low",
      label: "Closed / Cancelled",
      reason: "Order has been cancelled.",
      staffInstruction: "Reconcile invoices and process refund if payment was collected.",
    };
  }

  const cleanSize = order.tireSize.replace(/[^0-9]/g, "");
  const isCommon = POPULAR_SIZES.includes(cleanSize);
  const flags = getRiskFlags(order);

  if (order.status === "received") {
    if (flags.includes("fitment_needs_confirmation")) {
      return {
        action: "confirm_fitment",
        priority: "high",
        label: "Confirm Fitment",
        reason: "Customer notes or vehicle data is unclear.",
        staffInstruction: "Call customer to verify vehicle year/make/model and fitment.",
      };
    }
    return {
      action: "confirm_availability",
      priority: "high",
      label: "Confirm Availability",
      reason: "New order request submitted.",
      staffInstruction: "Verify stock in D&K/Gateway, then call customer to confirm price and schedule.",
    };
  }

  if (order.status === "confirmed") {
    if (!order.gatewayOrderRef) {
      return {
        action: "order_from_gateway",
        priority: "high",
        label: "Order from Supplier",
        reason: "Tires unstocked or need ordering from Gateway.",
        staffInstruction: "Log in to Gateway (b2b.dktire.com), place order, and enter PO Reference.",
      };
    }
    return {
      action: "order_from_gateway",
      priority: "normal",
      label: "Submit Order Reference",
      reason: "Availability confirmed but PO reference unsubmitted.",
      staffInstruction: "Save the Gateway PO reference and bump status to 'ordered'.",
    };
  }

  if (order.status === "ordered") {
    return {
      action: "await_delivery",
      priority: "normal",
      label: "Await Supplier Delivery",
      reason: "Tires ordered from Gateway.",
      staffInstruction: "Wait for delivery truck. Track via Gateway portal if delayed.",
    };
  }

  if (order.status === "in_transit") {
    return {
      action: "await_delivery",
      priority: "normal",
      label: "Track Package",
      reason: "Tires are en route to the shop.",
      staffInstruction: "Confirm arrival of delivery and check off parts.",
    };
  }

  if (order.status === "delivered") {
    return {
      action: "schedule_install",
      priority: "high",
      label: "Schedule Installation",
      reason: "Tires arrived at shop.",
      staffInstruction: "Call customer to book installation appointment.",
    };
  }

  if (order.status === "scheduled") {
    return {
      action: "mark_ready_for_install",
      priority: "normal",
      label: "Mark Ready for Install",
      reason: "Appointment set.",
      staffInstruction: "Confirm bays are prepped and tires are set aside for the vehicle.",
    };
  }

  if (order.status === "installed") {
    if (!order.invoiceNumber) {
      return {
        action: "verify_invoice",
        priority: "high",
        label: "Create Invoice",
        reason: "Tires installed but no invoice number linked.",
        staffInstruction: "Verify invoice is created in ShopDriver and link it to the order.",
      };
    }
    return {
      action: "close_order",
      priority: "low",
      label: "Close Order File",
      reason: "Fulfillment complete.",
      staffInstruction: "Reconcile Sheets and close out order folder.",
    };
  }

  return {
    action: "call_customer",
    priority: "normal",
    label: "Review Order State",
    reason: "Order has entered an unhandled state.",
    staffInstruction: "Call customer or check with supervisor to verify next steps.",
  };
}

export function getFulfillmentTimeline(order: TireOrderLike): Array<{
  key: string;
  label: string;
  status: "complete" | "current" | "pending" | "blocked";
  reason?: string;
}> {
  const steps = [
    { key: "received", label: "Request Received" },
    { key: "confirmed", label: "Availability Confirmed" },
    { key: "ordered", label: "Supplier Ordered" },
    { key: "delivered", label: "Received at Shop" },
    { key: "scheduled", label: "Install Scheduled" },
    { key: "installed", label: "Tires Installed" },
  ];

  const statusOrder = ["received", "confirmed", "ordered", "in_transit", "delivered", "scheduled", "installed"];
  const currentIdx = statusOrder.indexOf(order.status);

  if (order.status === "cancelled") {
    return steps.map((s) => ({
      key: s.key,
      label: s.label,
      status: "blocked" as const,
      reason: "Order has been cancelled.",
    }));
  }

  return steps.map((s, idx) => {
    // Determine mapping index for timeline keys
    const timelineIndex = ["received", "confirmed", "ordered", "delivered", "scheduled", "installed"].indexOf(s.key);
    
    // Status is complete if current state is past this step
    let statusVal: "complete" | "current" | "pending" | "blocked" = "pending";

    if (order.status === "in_transit" && s.key === "ordered") {
      statusVal = "complete";
    } else if (order.status === "in_transit" && s.key === "delivered") {
      statusVal = "current";
    } else if (currentIdx >= 0 && timelineIndex < currentIdx && statusOrder[currentIdx] !== "in_transit") {
      statusVal = "complete";
    } else if (s.key === order.status) {
      statusVal = "current";
    }

    // Special block condition: fitment needs verification before confirming
    if (s.key === "confirmed" && order.status === "received" && (!order.vehicleInfo || order.vehicleInfo.toLowerCase() === "not specified")) {
      statusVal = "blocked";
      return {
        key: s.key,
        label: s.label,
        status: statusVal,
        reason: "Fitment needs verification",
      };
    }

    // Special block condition: supplier order missing PO ref
    if (s.key === "ordered" && order.status === "confirmed" && !order.gatewayOrderRef) {
      statusVal = "blocked";
      return {
        key: s.key,
        label: s.label,
        status: statusVal,
        reason: "Awaiting supplier PO number",
      };
    }

    return {
      key: s.key,
      label: s.label,
      status: statusVal,
    };
  });
}
