/**
 * AI Labor Estimator — generates detailed repair cost estimates
 * using industry-standard labor times and Nick's shop rate.
 *
 * Powered by LLM with structured JSON output.
 * Feeds into the lead capture system for conversion.
 */
import { invokeLLM } from "./_core/llm";
import { eq } from "drizzle-orm";
import { shopSettings } from "../drizzle/schema";

/** Default fallback labor rate */
const DEFAULT_LABOR_RATE = 115;

/** Fetch current labor rate from DB settings (auto-synced from ShopDriver) */
async function getShopLaborRate(): Promise<number> {
  try {
    const { getDb } = await import("./db");
    const d = await getDb();
    if (!d) return DEFAULT_LABOR_RATE;
    const result = await d.select().from(shopSettings).where(eq(shopSettings.key, "laborRate")).limit(1);
    return result.length > 0 ? parseFloat(result[0].value) || DEFAULT_LABOR_RATE : DEFAULT_LABOR_RATE;
  } catch {
    return DEFAULT_LABOR_RATE;
  }
}

function buildSystemPrompt(laborRate: number) {
  return `You are an expert automotive repair estimator for Nick's Tire & Auto in Cleveland, Ohio. Your job is to provide accurate, transparent repair cost estimates based on industry-standard labor times and real-world parts pricing.

SHOP DETAILS:
- Labor rate: $${laborRate}/hour
- Location: 17625 Euclid Ave, Cleveland, OH 44112
- Services: Full-service auto repair and tire shop

ESTIMATION RULES:
1. Use standard industry labor times (similar to Mitchell, ALLDATA, or Real-Time Labor Guide)
2. Parts prices should reflect real aftermarket/OEM pricing for the specific vehicle
3. Always provide a LOW and HIGH range — low = aftermarket parts + best case, high = OEM parts + worst case
4. Be honest — if a repair could be simple OR complex, explain both scenarios
5. Factor in the specific vehicle year/make/model for accurate estimates
6. Include shop supplies and miscellaneous fees ($5-15 typical)
7. Do NOT include tax in the estimate — note that tax is additional
8. If the repair description is vague, provide estimates for the most common causes
9. Never guarantee a price — always note that in-person diagnosis may reveal additional needs

LABOR TIME GUIDELINES (industry averages):
- Oil change: 0.3-0.5 hrs
- Brake pads (per axle): 0.8-1.5 hrs
- Brake pads + rotors (per axle): 1.2-2.0 hrs
- Tire mount & balance (4 tires): 0.8-1.2 hrs
- Check engine diagnostics: 0.5-1.0 hrs
- Oxygen sensor replacement: 0.5-1.5 hrs
- Catalytic converter: 1.0-3.0 hrs
- Struts (pair): 2.0-4.0 hrs
- Wheel alignment: 0.5-1.0 hrs
- AC recharge: 0.5-1.0 hrs
- AC compressor: 2.0-4.0 hrs
- Alternator: 1.0-2.5 hrs
- Starter: 1.0-3.0 hrs
- Water pump: 2.0-5.0 hrs
- Timing belt/chain: 3.0-8.0 hrs
- Head gasket: 6.0-15.0 hrs
- Transmission fluid service: 0.5-1.0 hrs
- Tie rod end: 0.8-1.5 hrs
- Ball joint: 1.0-2.5 hrs
- Wheel bearing: 1.0-3.0 hrs
- Exhaust manifold: 1.5-3.0 hrs
- Muffler/exhaust pipe: 0.5-2.0 hrs

Adjust labor times based on the specific vehicle — some vehicles are harder to work on than others (e.g., German cars, transverse V6 engines, AWD vehicles).

Respond ONLY with the JSON object. No explanation outside the JSON.`;
}

export type LaborEstimateResult = {
  repairTitle: string;
  vehicleDisplay: string;
  summary: string;
  lineItems: {
    description: string;
    laborHours: number;
    laborCost: number;
    partsLow: number;
    partsHigh: number;
    notes: string;
  }[];
  totalLaborHours: number;
  totalLaborCost: number;
  totalPartsLow: number;
  totalPartsHigh: number;
  shopSupplies: number;
  grandTotalLow: number;
  grandTotalHigh: number;
  timeEstimate: string;
  importantNotes: string[];
  disclaimer: string;
};

export async function generateLaborEstimate(input: {
  year: string;
  make: string;
  model: string;
  mileage?: string;
  repairDescription: string;
}): Promise<LaborEstimateResult> {
  const laborRate = await getShopLaborRate();
  const vehicleStr = `${input.year} ${input.make} ${input.model}`;
  const mileageStr = input.mileage ? `\nApproximate mileage: ${input.mileage}` : "";

  const userMessage = `Generate a detailed repair cost estimate for this vehicle and repair:

Vehicle: ${vehicleStr}${mileageStr}
Repair needed: ${input.repairDescription}

Labor rate: $${laborRate}/hour

Respond with a JSON object:
{
  "repairTitle": "Short title for the repair (e.g. 'Front Brake Pad & Rotor Replacement')",
  "vehicleDisplay": "Formatted vehicle string (e.g. '2018 Honda Civic')",
  "summary": "2-3 sentence plain-language explanation of what the repair involves and why it's needed",
  "lineItems": [
    {
      "description": "Line item description (e.g. 'Front brake pads')",
      "laborHours": 1.5,
      "laborCost": 172.50,
      "partsLow": 35,
      "partsHigh": 80,
      "notes": "Brief note about this item"
    }
  ],
  "totalLaborHours": 1.5,
  "totalLaborCost": 172.50,
  "totalPartsLow": 35,
  "totalPartsHigh": 80,
  "shopSupplies": 8,
  "grandTotalLow": 215,
  "grandTotalHigh": 261,
  "timeEstimate": "1-2 hours",
  "importantNotes": ["Note 1", "Note 2"],
  "disclaimer": "Standard disclaimer about estimates vs final pricing"
}`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: buildSystemPrompt(laborRate) },
        { role: "user", content: userMessage },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "labor_estimate",
          strict: true,
          schema: {
            type: "object",
            properties: {
              repairTitle: { type: "string" },
              vehicleDisplay: { type: "string" },
              summary: { type: "string" },
              lineItems: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    description: { type: "string" },
                    laborHours: { type: "number" },
                    laborCost: { type: "number" },
                    partsLow: { type: "number" },
                    partsHigh: { type: "number" },
                    notes: { type: "string" },
                  },
                  required: ["description", "laborHours", "laborCost", "partsLow", "partsHigh", "notes"],
                  additionalProperties: false,
                },
              },
              totalLaborHours: { type: "number" },
              totalLaborCost: { type: "number" },
              totalPartsLow: { type: "number" },
              totalPartsHigh: { type: "number" },
              shopSupplies: { type: "number" },
              grandTotalLow: { type: "number" },
              grandTotalHigh: { type: "number" },
              timeEstimate: { type: "string" },
              importantNotes: {
                type: "array",
                items: { type: "string" },
              },
              disclaimer: { type: "string" },
            },
            required: [
              "repairTitle", "vehicleDisplay", "summary", "lineItems",
              "totalLaborHours", "totalLaborCost", "totalPartsLow", "totalPartsHigh",
              "shopSupplies", "grandTotalLow", "grandTotalHigh", "timeEstimate",
              "importantNotes", "disclaimer",
            ],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    if (content && typeof content === "string") {
      const parsed = JSON.parse(content) as LaborEstimateResult;
      return parsed;
    }
  } catch (error) {
    console.error("[LaborEstimate] AI estimate failed:", error);
  }

  // Fallback
  return {
    repairTitle: "Repair Estimate",
    vehicleDisplay: `${input.year} ${input.make} ${input.model}`,
    summary: "We need to see your vehicle in person to provide an accurate estimate for this repair. Our technicians use advanced diagnostic equipment to pinpoint the exact issue and give you a fair, transparent price.",
    lineItems: [],
    totalLaborHours: 0,
    totalLaborCost: 0,
    totalPartsLow: 0,
    totalPartsHigh: 0,
    shopSupplies: 0,
    grandTotalLow: 0,
    grandTotalHigh: 0,
    timeEstimate: "Varies",
    importantNotes: [
      "This repair requires an in-person diagnostic inspection for an accurate estimate.",
      "Call (216) 862-0005 to schedule your appointment.",
    ],
    disclaimer: "All estimates are approximate and based on industry-standard labor times. Final pricing may vary based on in-person inspection findings. Tax is additional.",
  };
}
