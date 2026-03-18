/**
 * AI-Powered Vehicle Diagnostic Tool
 * Analyzes user-reported symptoms and returns structured diagnosis.
 * Uses the built-in LLM helper for AI inference.
 */

import { invokeLLM } from "./_core/llm";

const DIAGNOSIS_SYSTEM_PROMPT = `You are a professional automotive diagnostic system for Nick's Tire & Auto, a trusted independent auto repair shop at 17625 Euclid Ave, Cleveland, OH 44112.

Your role is to analyze vehicle symptoms reported by customers and provide a structured preliminary assessment. You must:

1. Be accurate and conservative — never overstate or understate urgency
2. Explain in plain language that a non-mechanic can understand
3. Always note that this is a preliminary assessment and in-person diagnosis is required
4. Provide realistic cost ranges for the Cleveland, Ohio area
5. Consider the vehicle year, make, model, and mileage when assessing causes
6. Rank causes by likelihood based on the specific symptoms described
7. Be direct, calm, confident, and professional — no hype or gimmicks

Urgency levels:
- low (1-2): Routine maintenance or minor issue, can wait a few weeks
- moderate (2-3): Should be addressed within 1-2 weeks
- high (3-4): Needs attention within a few days, could worsen
- critical (4-5): Safety concern, should be inspected immediately

You MUST respond with ONLY a valid JSON object matching the exact schema requested. No markdown, no explanation, just the JSON.`;

export type DiagnosisResult = {
  urgency: "low" | "moderate" | "high" | "critical";
  urgencyScore: number;
  title: string;
  summary: string;
  likelyCauses: { cause: string; explanation: string; likelihood: string }[];
  recommendedService: string;
  estimatedCostRange: string;
  safetyNote: string;
  nextSteps: string[];
};

export async function runDiagnosis(input: {
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  mileage?: string;
  symptoms: string[];
  additionalInfo?: string;
}): Promise<DiagnosisResult> {
  const vehicleStr = [input.vehicleYear, input.vehicleMake, input.vehicleModel].filter(Boolean).join(" ");
  const mileageStr = input.mileage ? `Approximate mileage: ${input.mileage}` : "";

  const userMessage = `Analyze these vehicle symptoms and provide a structured diagnosis.

Vehicle: ${vehicleStr || "Not specified"}
${mileageStr}

Reported symptoms:
${input.symptoms.map(s => `- ${s}`).join("\n")}

${input.additionalInfo ? `Additional details from the customer: ${input.additionalInfo}` : ""}

Respond with a JSON object with these exact fields:
{
  "urgency": "low" | "moderate" | "high" | "critical",
  "urgencyScore": number (1-5),
  "title": "Short diagnostic title",
  "summary": "2-3 sentence plain-language summary of the likely issue",
  "likelyCauses": [
    {"cause": "Cause name", "explanation": "Plain language explanation", "likelihood": "High" | "Medium" | "Low"}
  ],
  "recommendedService": "Service category at Nick's",
  "estimatedCostRange": "$X - $Y range",
  "safetyNote": "Safety warning if applicable, or empty string",
  "nextSteps": ["Step 1", "Step 2", "Step 3"]
}`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: DIAGNOSIS_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "vehicle_diagnosis",
          strict: true,
          schema: {
            type: "object",
            properties: {
              urgency: { type: "string", description: "low, moderate, high, or critical" },
              urgencyScore: { type: "integer", description: "1-5 urgency score" },
              title: { type: "string", description: "Short diagnostic title" },
              summary: { type: "string", description: "Plain language summary" },
              likelyCauses: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    cause: { type: "string" },
                    explanation: { type: "string" },
                    likelihood: { type: "string" },
                  },
                  required: ["cause", "explanation", "likelihood"],
                  additionalProperties: false,
                },
              },
              recommendedService: { type: "string" },
              estimatedCostRange: { type: "string" },
              safetyNote: { type: "string" },
              nextSteps: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: [
              "urgency", "urgencyScore", "title", "summary",
              "likelyCauses", "recommendedService", "estimatedCostRange",
              "safetyNote", "nextSteps",
            ],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    if (content && typeof content === "string") {
      const parsed = JSON.parse(content) as DiagnosisResult;
      // Validate urgency score range
      parsed.urgencyScore = Math.min(5, Math.max(1, parsed.urgencyScore));
      return parsed;
    }
  } catch (error) {
    console.error("[Diagnose] AI diagnosis failed:", error);
  }

  // Fallback
  return {
    urgency: "moderate",
    urgencyScore: 3,
    title: "Professional Inspection Recommended",
    summary: "Based on the symptoms you described, we recommend bringing your vehicle in for a professional diagnostic inspection. Our technicians use advanced OBD-II diagnostic equipment to pinpoint the exact cause of the issue so you only pay for what you need.",
    likelyCauses: [
      {
        cause: "Multiple potential causes",
        explanation: "The combination of symptoms you described could point to several different issues. An in-person inspection with professional diagnostic equipment will identify the exact problem.",
        likelihood: "High",
      },
    ],
    recommendedService: "Diagnostics",
    estimatedCostRange: "Call for estimate",
    safetyNote: "",
    nextSteps: [
      "Call (216) 862-0005 to schedule a diagnostic appointment",
      "Our technicians will use professional OBD-II equipment to identify the exact cause",
      "We will explain the findings and provide a detailed repair estimate before any work begins",
    ],
  };
}
