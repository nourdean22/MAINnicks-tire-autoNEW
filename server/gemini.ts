/**
 * Nick AI — Customer-facing chat assistant for Nick's Tire & Auto
 * Uses OpenAI-compatible API via invokeLLM helper.
 *
 * Features:
 * - Conversational vehicle diagnosis
 * - Lead scoring (urgency 1-5)
 * - Vehicle/problem extraction from chat context
 */

import { invokeLLM } from "./_core/llm";

const NICK_SYSTEM_PROMPT = `You are the AI assistant for Nick's Tire & Auto, a trusted independent auto repair and tire shop at 17625 Euclid Ave, Cleveland, OH 44112. Phone: (216) 862-0005. Hours: Mon-Sat 8AM-6PM, Sun 9AM-4PM.

Your personality:
- Direct, calm, confident, professional, knowledgeable
- Speak like a knowledgeable mechanic explaining a repair to a customer
- Never use hype, gimmicks, slang, or emojis
- Never diagnose with certainty without seeing the vehicle — always recommend bringing it in
- Always be honest about what could be wrong and what it might cost range-wise
- Keep responses concise — 2-4 sentences for simple questions, up to a paragraph for complex ones

Services offered:
- Tires: new/used, mounting, balancing, rotation, TPMS, flat repair
- Brakes: pads, rotors, calipers, lines, ABS diagnostics
- Diagnostics: check engine light, OBD-II, advanced computer diagnostics
- Emissions & E-Check: Ohio E-Check repair, oxygen sensors, EVAP, catalytic converters
- Oil Change: conventional and synthetic
- General Repair: suspension, steering, exhaust, cooling, belts, hoses
- Financing: Acima, Snap, Koalafi, American First Finance — no-credit-check options available

Areas served: Cleveland, Euclid, East Cleveland, South Euclid, Richmond Heights, Northeast Ohio.

When a customer describes a problem:
1. Acknowledge the symptom clearly
2. Explain the most likely causes in plain language
3. Give a rough cost range when possible (be honest)
4. Recommend the appropriate service
5. Encourage them to call (216) 862-0005 or book online at nickstire.org
6. If they share contact info, confirm you'll have someone reach out

When a customer seems ready to book:
- Direct them to the booking form at nickstire.org or ask them to call (216) 862-0005
- Ask what day/time works best for them
- Mention we offer free estimates on most services`;

// Max messages to keep in session context (prevents unbounded growth)
const MAX_SESSION_MESSAGES = 20;

/**
 * Score a lead's urgency based on their problem description.
 * Returns a score from 1-5 and a reason.
 */
export async function scoreLead(problem: string, vehicle?: string): Promise<{
  score: number;
  reason: string;
  recommendedService: string;
}> {
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are an auto repair urgency scoring system for Nick's Tire & Auto in Cleveland, OH.
Analyze the customer's problem and return a JSON object with:
- score: 1-5 integer (1=routine maintenance, 2=should schedule soon, 3=needs attention this week, 4=urgent safety concern, 5=critical/dangerous)
- reason: One sentence explaining the urgency level
- recommendedService: The most relevant service category (Tires, Brakes, Diagnostics, Emissions & E-Check, Oil Change, General Repair)

Scoring guidelines:
- Brake noise/failure, steering problems, tire blowouts = 4-5
- Check engine light, overheating, transmission issues = 3-4
- Failed E-Check, AC problems, minor vibrations = 2-3
- Oil change, tire rotation, general maintenance = 1-2`,
        },
        {
          role: "user",
          content: `Vehicle: ${vehicle || "Not specified"}\nProblem: ${problem}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "lead_score",
          strict: true,
          schema: {
            type: "object",
            properties: {
              score: { type: "integer", description: "Urgency score 1-5" },
              reason: { type: "string", description: "One sentence reason" },
              recommendedService: { type: "string", description: "Service category" },
            },
            required: ["score", "reason", "recommendedService"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    if (content && typeof content === 'string') {
      const parsed = JSON.parse(content);
      return {
        score: Math.min(5, Math.max(1, parsed.score)),
        reason: parsed.reason,
        recommendedService: parsed.recommendedService,
      };
    }
  } catch (error) {
    console.error("[NickAI] Lead scoring failed:", error);
  }

  return {
    score: 3,
    reason: "Unable to assess urgency automatically. Manual review recommended.",
    recommendedService: "General Repair",
  };
}

/**
 * Chat with the vehicle diagnosis assistant.
 * Maintains conversation context through message history.
 * Extraction only runs after 4+ messages (when enough context exists).
 */
export async function chatWithAssistant(
  messages: Array<{ role: string; content: string }>,
): Promise<{
  reply: string;
  extractedInfo?: {
    vehicle?: string;
    problem?: string;
    wantsAppointment?: boolean;
  };
}> {
  // Trim to last N messages to prevent unbounded context growth
  const recentMessages = messages.slice(-MAX_SESSION_MESSAGES);

  try {
    const fullMessages = [
      { role: "system" as const, content: NICK_SYSTEM_PROMPT },
      ...recentMessages.map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    const response = await invokeLLM({
      messages: fullMessages,
    });

    const rawReply = response.choices?.[0]?.message?.content;
    const reply: string = (typeof rawReply === 'string' ? rawReply : '') ||
      "I apologize, I'm having trouble right now. Please call us directly at (216) 862-0005 and we'll help you right away.";

    // Only extract info after enough conversation context (4+ messages = 2+ exchanges)
    // This saves an LLM call on the first few messages where there's nothing to extract
    let extractedInfo: { vehicle?: string; problem?: string; wantsAppointment?: boolean } | undefined;

    if (recentMessages.length >= 4) {
      try {
        const extractResponse = await invokeLLM({
          messages: [
            {
              role: "system",
              content: "Extract vehicle and problem information from this auto repair conversation. Return JSON. Be concise.",
            },
            {
              role: "user",
              content: `Conversation:\n${recentMessages.slice(-6).map(m => `${m.role}: ${m.content}`).join("\n")}`,
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "extracted_info",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  vehicle: { type: "string", description: "Vehicle make/model/year if mentioned, or empty string" },
                  problem: { type: "string", description: "Summary of the problem described, or empty string" },
                  wantsAppointment: { type: "boolean", description: "Whether the customer wants to schedule an appointment" },
                },
                required: ["vehicle", "problem", "wantsAppointment"],
                additionalProperties: false,
              },
            },
          },
        });

        const extractContent = extractResponse.choices?.[0]?.message?.content;
        if (extractContent && typeof extractContent === 'string') {
          const parsed = JSON.parse(extractContent);
          extractedInfo = {
            vehicle: parsed.vehicle || undefined,
            problem: parsed.problem || undefined,
            wantsAppointment: parsed.wantsAppointment,
          };
        }
      } catch {
        // Extraction is optional — don't fail the chat
      }
    }

    return { reply, extractedInfo };
  } catch (error) {
    console.error("[NickAI] Chat failed:", error);
    return {
      reply: "I apologize, I'm having trouble right now. Please call us directly at (216) 862-0005 and we'll help you right away.",
    };
  }
}
