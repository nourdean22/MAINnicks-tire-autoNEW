/**
 * Cost Estimator Router (Feature 3)
 * Provides real-time estimates for vehicle services using AI
 * and cached labor rates from shop settings.
 */
import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { invokeLLM } from "../_core/llm";
import { eq } from "drizzle-orm";
import { shopSettings } from "../../drizzle/schema";
import { sanitizeText } from "../sanitize";

const DEFAULT_LABOR_RATE = 115;

// In-memory cache: key = "year-make-model-service", value = { result, timestamp }
const estimateCache = new Map<
  string,
  { result: CostEstimateResult; timestamp: number }
>();

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// 30+ service types
const SERVICE_TYPES = [
  "Oil Change",
  "Brake Pads Front",
  "Brake Pads Rear",
  "Full Brake Job",
  "Tire Rotation",
  "Wheel Alignment",
  "Check Engine Diagnostic",
  "Battery Replacement",
  "Air Filter Replacement",
  "Cabin Air Filter",
  "Spark Plugs",
  "Tire Mount & Balance",
  "Wheel Bearing Replacement",
  "Strut Replacement",
  "Shock Absorber Replacement",
  "AC Recharge",
  "AC Compressor Replacement",
  "Alternator Replacement",
  "Starter Motor Replacement",
  "Water Pump Replacement",
  "Coolant Flush",
  "Transmission Fluid Service",
  "Tie Rod End Replacement",
  "Ball Joint Replacement",
  "CV Axle Replacement",
  "Brake Rotor Replacement",
  "Suspension Inspection",
  "Emission System Check",
  "Exhaust Manifold Repair",
  "Muffler Replacement",
  "Catalytic Converter Replacement",
  "Oxygen Sensor Replacement",
  "Mass Air Flow Sensor",
] as const;

export type ServiceType = (typeof SERVICE_TYPES)[number];

export type CostEstimateResult = {
  service: string;
  vehicle: string;
  laborHoursLow: number;
  laborHoursHigh: number;
  laborRate: number;
  laborCostLow: number;
  laborCostHigh: number;
  partsLow: number;
  partsHigh: number;
  totalLow: number;
  totalHigh: number;
  disclaimer: string;
  confidence: "high" | "medium" | "low";
};

async function getShopLaborRate(): Promise<number> {
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return DEFAULT_LABOR_RATE;
    const result = await d
      .select()
      .from(shopSettings)
      .where(eq(shopSettings.key, "laborRate"))
      .limit(1);
    return result.length > 0
      ? parseFloat(result[0].value) || DEFAULT_LABOR_RATE
      : DEFAULT_LABOR_RATE;
  } catch (err) {
    console.warn("[CostEstimator] Failed to fetch labor rate, using default:", err instanceof Error ? err.message : err);
    return DEFAULT_LABOR_RATE;
  }
}

function buildEstimatorPrompt(
  year: number,
  make: string,
  model: string,
  serviceType: string,
  laborRate: number
): string {
  return `You are an expert automotive repair cost estimator for Nick's Tire & Auto in Cleveland, Ohio.

Estimate labor hours and parts cost for this service:
- Vehicle: ${year} ${make} ${model}
- Service: ${serviceType}
- Shop Labor Rate: $${laborRate}/hour

Provide a JSON response with these exact fields:
{
  "laborHoursLow": <number>,
  "laborHoursHigh": <number>,
  "partsLow": <number>,
  "partsHigh": <number>,
  "confidence": "high" | "medium" | "low"
}

Guidelines:
- Use industry-standard labor times (Mitchell, ALLDATA standards)
- Parts prices should reflect aftermarket/OEM pricing for the specific year/make/model
- Low = aftermarket parts + best-case scenario
- High = OEM parts + worst-case scenario
- Be realistic based on the vehicle model's known complexity
- Return ONLY the JSON, no other text`;
}

async function estimateWithAI(
  year: number,
  make: string,
  model: string,
  serviceType: string,
  laborRate: number
): Promise<{
  laborHoursLow: number;
  laborHoursHigh: number;
  partsLow: number;
  partsHigh: number;
  confidence: "high" | "medium" | "low";
} | null> {
  try {
    const prompt = buildEstimatorPrompt(year, make, model, serviceType, laborRate);

    const result = await invokeLLM({
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      responseFormat: {
        type: "json_object",
      },
    });

    const content = result.choices[0]?.message.content;
    if (typeof content !== "string") {
      return null;
    }

    const parsed = JSON.parse(content);
    return {
      laborHoursLow: Math.max(0.1, parseFloat(parsed.laborHoursLow) || 0.5),
      laborHoursHigh: Math.max(0.1, parseFloat(parsed.laborHoursHigh) || 1.5),
      partsLow: Math.max(0, parseFloat(parsed.partsLow) || 0),
      partsHigh: Math.max(0, parseFloat(parsed.partsHigh) || 100),
      confidence: parsed.confidence || "medium",
    };
  } catch (err) {
    console.error("[CostEstimator] AI estimation failed:", err);
    return null;
  }
}

function getDefaultEstimate(serviceType: string): {
  laborHoursLow: number;
  laborHoursHigh: number;
  partsLow: number;
  partsHigh: number;
  confidence: "low";
} {
  // Sensible defaults for common services
  const defaults: Record<string, any> = {
    "Oil Change": { laborHoursLow: 0.3, laborHoursHigh: 0.5, partsLow: 20, partsHigh: 50 },
    "Brake Pads Front": { laborHoursLow: 0.8, laborHoursHigh: 1.2, partsLow: 100, partsHigh: 250 },
    "Brake Pads Rear": { laborHoursLow: 0.8, laborHoursHigh: 1.2, partsLow: 100, partsHigh: 250 },
    "Full Brake Job": { laborHoursLow: 2.0, laborHoursHigh: 3.5, partsLow: 300, partsHigh: 700 },
    "Tire Rotation": { laborHoursLow: 0.5, laborHoursHigh: 0.8, partsLow: 0, partsHigh: 0 },
    "Wheel Alignment": { laborHoursLow: 0.5, laborHoursHigh: 1.0, partsLow: 0, partsHigh: 50 },
    "Check Engine Diagnostic": { laborHoursLow: 0.5, laborHoursHigh: 1.0, partsLow: 0, partsHigh: 0 },
    "Battery Replacement": { laborHoursLow: 0.3, laborHoursHigh: 0.5, partsLow: 100, partsHigh: 300 },
  };

  return defaults[serviceType] || {
    laborHoursLow: 1.0,
    laborHoursHigh: 2.0,
    partsLow: 50,
    partsHigh: 200,
    confidence: "low" as const,
  };
}

export const costEstimatorRouter = router({
  estimate: publicProcedure
    .input(
      z.object({
        year: z.number().int().min(1990).max(2027),
        make: z.string().min(1).max(50),
        model: z.string().min(1).max(50),
        serviceType: z.string().min(1).max(100),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const cacheKey = `${input.year}-${input.make}-${input.model}-${input.serviceType}`;
        const cached = estimateCache.get(cacheKey);

        // Return cached result if fresh
        if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
          return cached.result;
        }

        const laborRate = await getShopLaborRate();
        const make = sanitizeText(input.make) || input.make;
        const model = sanitizeText(input.model) || input.model;
        const serviceType = sanitizeText(input.serviceType) || input.serviceType;

        // Try AI estimate first
        let aiResult = await estimateWithAI(
          input.year,
          make,
          model,
          serviceType,
          laborRate
        );

        // Fall back to defaults if AI fails
        if (!aiResult) {
          aiResult = getDefaultEstimate(serviceType);
        }

        // Calculate costs
        const laborCostLow = aiResult.laborHoursLow * laborRate;
        const laborCostHigh = aiResult.laborHoursHigh * laborRate;
        const totalLow = laborCostLow + aiResult.partsLow;
        const totalHigh = laborCostHigh + aiResult.partsHigh;

        const result: CostEstimateResult = {
          service: serviceType,
          vehicle: `${input.year} ${make} ${model}`,
          laborHoursLow: Math.round(aiResult.laborHoursLow * 10) / 10,
          laborHoursHigh: Math.round(aiResult.laborHoursHigh * 10) / 10,
          laborRate,
          laborCostLow: Math.round(laborCostLow * 100) / 100,
          laborCostHigh: Math.round(laborCostHigh * 100) / 100,
          partsLow: Math.round(aiResult.partsLow * 100) / 100,
          partsHigh: Math.round(aiResult.partsHigh * 100) / 100,
          totalLow: Math.round(totalLow * 100) / 100,
          totalHigh: Math.round(totalHigh * 100) / 100,
          disclaimer:
            "This is an estimate based on industry averages and may vary based on in-person diagnosis. Call (216) 862-0005 for a precise quote.",
          confidence: aiResult.confidence,
        };

        // Cache the result
        estimateCache.set(cacheKey, {
          result,
          timestamp: Date.now(),
        });

        // Clean up old cache entries if cache gets too large
        if (estimateCache.size > 1000) {
          const now = Date.now();
          for (const [key, value] of Array.from(estimateCache.entries())) {
            if (now - value.timestamp > CACHE_TTL_MS) {
              estimateCache.delete(key);
            }
          }
        }

        return result;
      } catch (err) {
        console.error("[CostEstimator] Estimate failed:", err);
        // Return graceful fallback
        return {
          service: input.serviceType,
          vehicle: `${input.year} ${input.make} ${input.model}`,
          laborHoursLow: 1.0,
          laborHoursHigh: 2.0,
          laborRate: DEFAULT_LABOR_RATE,
          laborCostLow: DEFAULT_LABOR_RATE * 1.0,
          laborCostHigh: DEFAULT_LABOR_RATE * 2.0,
          partsLow: 50,
          partsHigh: 200,
          totalLow: DEFAULT_LABOR_RATE * 1.0 + 50,
          totalHigh: DEFAULT_LABOR_RATE * 2.0 + 200,
          disclaimer:
            "Unable to generate estimate at this time. Please call (216) 862-0005 for a quote.",
          confidence: "low" as const,
        };
      }
    }),
});
