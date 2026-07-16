/**
 * "What's wrong with my car?" — free symptom checker.
 *
 * This reads a customer's typed description and organizes it into possible
 * causes plus a next step. It is NOT an OBD-II scan: nothing here touches the
 * vehicle. Wording on the page and in this file must keep saying so.
 *
 * Safety and shape are enforced deterministically in ./diagnose-safety — the
 * model ranks and explains causes, it does not get the final say on whether
 * someone is safe to keep driving, and its reply is validated before use.
 */

import { invokeLLM } from "./_core/llm";
import {
  aiDiagnosisSchema,
  applySafetyFloor,
  detectRedFlags,
  type Likelihood,
  type RedFlag,
  type Urgency,
} from "./diagnose-safety";

import { createLogger } from "./lib/logger";

const log = createLogger("diagnose");

/**
 * What it costs to find out. Grounded in the shop's actual offer — free quick
 * checks, written quote before any work — instead of a dollar range the model
 * invents with no labor guide, parts feed or pricing table behind it.
 */
const COST_NOTE = "Free quick check · written quote before any work";

const DIAGNOSIS_SYSTEM_PROMPT = `You are the symptom-intake assistant for Nick's Tire & Auto, a trusted independent auto repair shop at 17625 Euclid Ave, Cleveland, OH 44112.

A customer has typed a description of what their car is doing. You have NOT scanned the vehicle and you have no diagnostic trouble codes — you only have their words. Your job is to organize what they described into the most likely possibilities and a clear next step.

You must:
1. Be accurate and conservative — never overstate or understate urgency
2. Explain in plain language a non-mechanic understands. No jargon without a plain-language gloss.
3. Be explicit that this is preliminary and an in-person inspection is what confirms it
4. Consider the vehicle year, make, model, and mileage when ranking causes
5. Rank causes by likelihood based on the specific symptoms described
6. Be direct, calm, confident, and professional — no hype, no scare tactics

NEVER do these:
- NEVER estimate prices, dollar amounts, or cost ranges. You have no pricing data. The shop quotes in writing after seeing the car.
- NEVER claim you scanned, read codes from, or connected to the vehicle.
- NEVER invent a specific part failure as a certainty. These are possibilities, not findings.

Urgency levels:
- low (1-2): Routine maintenance or minor issue, can wait a few weeks
- moderate (3): Should be addressed within 1-2 weeks
- high (4): Needs attention within a few days, could worsen
- critical (5): Safety concern, should be inspected immediately

Return between 2 and 4 likely causes when the symptoms support it. Use likelihood "high" for the most probable, "medium" and "low" for the alternatives.

You MUST respond with ONLY a valid JSON object matching the exact schema requested. No markdown, no explanation, just the JSON.`;

export type DiagnosisCause = {
  cause: string;
  explanation: string;
  likelihood: Likelihood;
};

/**
 * A real analysis the model produced and that passed runtime validation.
 * `urgency` here has already been reconciled against the red-flag floor.
 */
export type DiagnosisAnalyzed = {
  status: "ai";
  urgency: Urgency;
  urgencyScore: number;
  title: string;
  summary: string;
  likelyCauses: DiagnosisCause[];
  recommendedService: string;
  costNote: string;
  safetyNote: string;
  nextSteps: string[];
  redFlags: RedFlag[];
};

/**
 * We could NOT analyze the symptoms. Deliberately carries no title/summary/
 * urgencyScore: the old code returned a fully-formed fake diagnosis on failure,
 * so customers could not tell an AI conclusion from a silent error. Making this
 * a separate shape means the UI cannot render an error as a result even by
 * accident — there is nothing to render.
 *
 * Red flags survive here: they are matched in code, so a model outage never
 * suppresses "your brakes are gone, don't drive it".
 */
export type DiagnosisUnavailable = {
  status: "unavailable";
  reason: "ai_error" | "ai_invalid";
  redFlags: RedFlag[];
  costNote: string;
};

export type DiagnosisResult = DiagnosisAnalyzed | DiagnosisUnavailable;

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

  // Matched BEFORE the model runs, so an outage can't suppress a safety warning.
  const symptomText = [...input.symptoms, input.additionalInfo ?? ""].join("\n");
  const redFlags = detectRedFlags(symptomText);

  const redFlagBlock = redFlags.length
    ? `\nSafety screening already flagged this description as: ${redFlags
        .map((f) => f.label)
        .join(", ")}. Treat urgency as critical and do not soften it. Do not repeat the tow/stop-driving instruction — the page already shows it.\n`
    : "";

  const userMessage = `Analyze these vehicle symptoms and provide a structured, preliminary assessment.

Vehicle: ${vehicleStr || "Not specified"}
${mileageStr}

Reported symptoms:
${input.symptoms.map((s) => `- ${s}`).join("\n")}

${input.additionalInfo ? `Additional details from the customer: ${input.additionalInfo}` : ""}
${redFlagBlock}
Respond with a JSON object with these exact fields:
{
  "urgency": "low" | "moderate" | "high" | "critical",
  "urgencyScore": number (1-5),
  "title": "Short, plain-language title for what is likely going on",
  "summary": "2-3 sentence plain-language summary of the likely issue",
  "likelyCauses": [
    {"cause": "Cause name", "explanation": "Plain language explanation", "likelihood": "high" | "medium" | "low"}
  ],
  "recommendedService": "Service category at Nick's",
  "safetyNote": "Safety warning if applicable, or empty string",
  "nextSteps": ["Step 1", "Step 2", "Step 3"]
}`;

  let content: unknown;
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
              // Real enum constraints, not just prose descriptions — the
              // provider can then enforce exact values instead of us hoping.
              urgency: { type: "string", enum: ["low", "moderate", "high", "critical"] },
              urgencyScore: { type: "integer", minimum: 1, maximum: 5, description: "1-5 urgency score" },
              title: { type: "string", description: "Short plain-language title" },
              summary: { type: "string", description: "Plain language summary" },
              likelyCauses: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    cause: { type: "string" },
                    explanation: { type: "string" },
                    likelihood: { type: "string", enum: ["high", "medium", "low"] },
                  },
                  required: ["cause", "explanation", "likelihood"],
                  additionalProperties: false,
                },
              },
              recommendedService: { type: "string" },
              safetyNote: { type: "string" },
              nextSteps: { type: "array", items: { type: "string" } },
            },
            required: [
              "urgency", "urgencyScore", "title", "summary",
              "likelyCauses", "recommendedService", "safetyNote", "nextSteps",
            ],
            additionalProperties: false,
          },
        },
      },
    });

    content = response.choices?.[0]?.message?.content;
  } catch (error) {
    log.error("[Diagnose] AI call failed:", error);
    return { status: "unavailable", reason: "ai_error", redFlags, costNote: COST_NOTE };
  }

  if (typeof content !== "string" || !content.trim()) {
    log.error("[Diagnose] AI returned no content");
    return { status: "unavailable", reason: "ai_error", redFlags, costNote: COST_NOTE };
  }

  // Validated, not cast. A drifted model shape fails loudly here instead of
  // rendering `undefined`/garbage into the customer-facing result card.
  let parsed;
  try {
    parsed = aiDiagnosisSchema.parse(JSON.parse(content));
  } catch (error) {
    log.error("[Diagnose] AI reply failed validation:", error);
    return { status: "unavailable", reason: "ai_invalid", redFlags, costNote: COST_NOTE };
  }

  const { urgency, urgencyScore, safetyNote } = applySafetyFloor(parsed, redFlags);

  return {
    status: "ai",
    urgency,
    urgencyScore,
    title: parsed.title,
    summary: parsed.summary,
    likelyCauses: parsed.likelyCauses,
    recommendedService: parsed.recommendedService,
    costNote: COST_NOTE,
    safetyNote,
    nextSteps: parsed.nextSteps,
    redFlags,
  };
}
