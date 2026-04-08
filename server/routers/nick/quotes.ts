/**
 * Nick AI Agent — Quote generation, estimation, and pricing logic.
 * Handles: generateQuote, competitorPriceCheck
 */
import { invokeLLM } from "../../_core/llm";
import {
  log, db,
  fetchSessionWithMessages, findReturningCustomer, calculateFinancing,
  validateCurrency, validateString, validateScore,
  PARTS_KB, WARRANTY_SCHEDULE, CLEVELAND_PRICING_DB,
  QUOTE_SYSTEM_PROMPT,
  type ComputedService, type PricingData, type PriceRange, type WorkOrderRow,
} from "./utils";

// ─── Generate Multi-Tier Quote from Chat Session ────

export async function handleGenerateQuote(input: {
  sessionId: number;
  includeTiers: boolean;
  includeFinancing: boolean;
  includeWarranty: boolean;
  includeHistory: boolean;
}) {
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

  let quote: Record<string, unknown>;
  try {
    quote = JSON.parse(rawContent) as Record<string, unknown>;
  } catch (e) {
    console.warn("[routers/nickActions] operation failed:", e);
    log.error("AI returned invalid JSON for quote", { preview: rawContent.slice(0, 200) });
    throw new Error("Failed to parse quote — AI returned invalid JSON");
  }

  // Validate every field
  const verifiedServices = Array.isArray(quote.services) ? (quote.services as Record<string, unknown>[]).map((s) => ({
    name: validateString(s.name, 100, "Service"),
    description: validateString(s.description, 500, "Repair service"),
    laborHours: validateCurrency(s.laborHours),
    partsCostEstimate: validateCurrency(s.partsCostEstimate),
    laborRate: validateCurrency(s.laborRate) || 85,
    category: validateString(s.category, 50, "general_repair"),
  })) : [];

  // Cross-reference parts with knowledge base
  const verifiedParts = Array.isArray(quote.partsNeeded) ? (quote.partsNeeded as Record<string, unknown>[]).map((p) => {
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

  const vehicleInfo = quote.vehicleInfo as Record<string, unknown> | undefined;
  const totalEstimateRaw = quote.totalEstimate as Record<string, unknown> | undefined;

  const verifiedQuote = {
    services: verifiedServices,
    vehicleInfo: {
      year: typeof vehicleInfo?.year === "number" ? vehicleInfo.year : null,
      make: validateString(vehicleInfo?.make, 50, "Unknown"),
      model: validateString(vehicleInfo?.model, 50, "Unknown"),
    },
    urgency: validateScore(quote.urgency, 1, 5),
    confidence: Math.min(1, Math.max(0, Number(quote.confidence) || 0.5)),
    notes: validateString(quote.notes, 1000, "Final price may vary after in-person inspection."),
    partsNeeded: verifiedParts,
    sessionId: input.sessionId,
    generatedAt: new Date().toISOString(),
  };

  // MATH VERIFICATION
  const computedServices: ComputedService[] = verifiedServices.map((s) => {
    const laborCost = s.laborHours * s.laborRate;
    return {
      ...s,
      laborCost,
      subtotal: s.partsCostEstimate + laborCost,
    };
  });

  const taxRate = 0.08; // Ohio sales tax on parts
  const totalParts = computedServices.reduce((sum: number, s) => sum + s.partsCostEstimate, 0);
  const totalLabor = computedServices.reduce((sum: number, s) => sum + s.laborCost, 0);
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
  const aiLow = validateCurrency(totalEstimateRaw?.low);
  const aiHigh = validateCurrency(totalEstimateRaw?.high);
  const usedEstimate = (aiLow > 0 && aiHigh > 0 && aiLow <= aiHigh)
    ? { low: aiLow, high: aiHigh, source: "ai" as const }
    : { ...mathVerified.totalEstimate, source: "computed" as const };

  // GOOD / BETTER / BEST TIERS
  let tiers = null;
  if (input.includeTiers && verifiedServices.length > 0) {
    tiers = {
      good: {
        label: "Essential Repair",
        description: "Addresses the primary safety/functionality concern. Most economical option.",
        services: computedServices.slice(0, 1).map((s) => s.name),
        estimate: { low: Math.round(computedServices[0].subtotal * 0.9), high: Math.round(computedServices[0].subtotal * 1.1) },
      },
      better: {
        label: "Recommended Repair",
        description: "Complete fix with all recommended services. Best value for long-term reliability.",
        services: computedServices.map((s) => s.name),
        estimate: usedEstimate,
      },
      best: {
        label: "Premium Service",
        description: "Full repair plus preventive maintenance. Maximum protection and peace of mind.",
        services: [
          ...computedServices.map((s) => s.name),
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

  // WARRANTY INFO
  let warranty = null;
  if (input.includeWarranty) {
    const categories = [...new Set(verifiedServices.map((s) => s.category))];
    warranty = categories.map((cat: string) => {
      const match = WARRANTY_SCHEDULE[cat] || WARRANTY_SCHEDULE["general_repair"];
      return { category: cat, ...match };
    });
  }

  // FINANCING BREAKDOWN
  let financing = null;
  if (input.includeFinancing && usedEstimate.high >= 100) {
    const midEstimate = Math.round((usedEstimate.low + usedEstimate.high) / 2);
    financing = calculateFinancing(midEstimate);
  }

  // HISTORY COMPARISON
  let historyComparison = null;
  if (customerData?.history && customerData.history.isReturning) {
    const pastWOs = customerData.history.workOrders || [];
    const relevantPast = pastWOs.filter((wo: WorkOrderRow) =>
      verifiedServices.some((s) =>
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
          low: Math.min(...relevantPast.map((wo: WorkOrderRow) => parseFloat(wo.total || "0")).filter((v: number) => v > 0)),
          high: Math.max(...relevantPast.map((wo: WorkOrderRow) => parseFloat(wo.total || "0")).filter((v: number) => v > 0)),
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
}

// ─── Enhanced Competitor Price Check ──────────────────

export async function handleCompetitorPriceCheck(input: {
  service: string;
  zipCode: string;
  includeSeasonalAdjustment: boolean;
  includeMarginAnalysis: boolean;
  includeChartData: boolean;
}) {
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

  let pricing: PricingData;
  try {
    pricing = JSON.parse(rawContent) as PricingData;
  } catch (e) {
    throw new Error("Invalid pricing data from AI");
  }

  const verifyRange = (range: PriceRange | undefined, label: string) => ({
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
}
