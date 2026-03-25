/**
 * Gemini AI Integration
 * - Lead scoring: Analyzes problem descriptions to assign urgency scores
 * - Vehicle diagnosis chat: Interactive assistant for customers
 * Uses the built-in LLM helper which routes through the platform.
 */

import { invokeLLM } from "./_core/llm";

const NICK_SYSTEM_PROMPT = `You are the AI assistant for Nick's Tire & Auto, a trusted independent auto repair and tire shop at 17625 Euclid Ave, Cleveland, OH 44112. Phone: (216) 862-0005. Hours: Mon-Sat 8AM-6PM, Sunday 9AM-4PM.

Your personality:
- Direct, calm, confident, professional, knowledgeable
- Speak like a knowledgeable mechanic explaining a repair to a customer
- Never use hype, gimmicks, slang, or emojis
- Never diagnose with certainty without seeing the vehicle — always recommend bringing it in
- Always be honest about what could be wrong and what it might cost range-wise

Services offered:
- Tires: new/used, mounting, balancing, rotation, TPMS, flat repair
- Brakes: pads, rotors, calipers, lines, ABS diagnostics
- Diagnostics: check engine light, OBD-II, advanced computer diagnostics
- Emissions & E-Check: Ohio E-Check repair, oxygen sensors, EVAP, catalytic converters
- Oil Change: conventional and synthetic
- General Repair: suspension, steering, exhaust, cooling, belts, hoses

Areas served: Cleveland, Euclid, East Cleveland, South Euclid, Richmond Heights, Northeast Ohio.

When a customer describes a problem:
1. Acknowledge the symptom clearly
2. Explain the most likely causes in plain language
3. Recommend the appropriate service
4. Encourage them to call (216) 862-0005 or book online
5. If they share contact info, confirm you'll have someone reach out`;

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
    console.error("[Gemini] Lead scoring failed:", error);
  }

  // Fallback
  return {
    score: 3,
    reason: "Unable to assess urgency automatically. Manual review recommended.",
    recommendedService: "General Repair",
  };
}

/**
 * Chat with the vehicle diagnosis assistant.
 * Maintains conversation context through message history.
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
  try {
    // Build the conversation with system prompt
    const fullMessages = [
      { role: "system" as const, content: NICK_SYSTEM_PROMPT },
      ...messages.map(m => ({
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

    // Try to extract vehicle/problem info from the conversation
    let extractedInfo: { vehicle?: string; problem?: string; wantsAppointment?: boolean } | undefined;
    
    if (messages.length >= 2) {
      try {
        const extractResponse = await invokeLLM({
          messages: [
            {
              role: "system",
              content: "Extract vehicle and problem information from this auto repair conversation. Return JSON.",
            },
            {
              role: "user",
              content: `Conversation:\n${messages.map(m => `${m.role}: ${m.content}`).join("\n")}`,
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
        // Extraction is optional, don't fail the chat
      }
    }

    return { reply, extractedInfo };
  } catch (error) {
    console.error("[Gemini] Chat failed:", error);
    return {
      reply: "I apologize, I'm having trouble right now. Please call us directly at (216) 862-0005 and we'll help you right away.",
    };
  }
}
