/**
 * Nick AI — Customer-facing chat assistant for Nick's Tire & Auto
 * Uses OpenAI-compatible API via invokeLLM helper.
 *
 * Features:
 * - Conversational vehicle diagnosis
 * - Lead scoring (urgency 1-5)
 * - Vehicle/problem extraction from chat context
 * - Temporal awareness (time-of-day, day-of-week, open/closed)
 * - Seasonal awareness (proactive service suggestions)
 * - Competitive positioning context
 * - Memory injection for returning visitors
 */

import { invokeLLM } from "./_core/llm";

// ─── TEMPORAL HELPERS ────────────────────────────────────

type DayOfWeek = "Sunday" | "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday";

const DAYS: DayOfWeek[] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Season = "winter" | "spring" | "summer" | "fall";

function getSeason(month: number): Season {
  if (month === 12 || month <= 2) return "winter";
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  return "fall";
}

function getSeasonalContext(season: Season): string {
  switch (season) {
    case "winter":
      return "Seasonal note: It's winter in Cleveland. Proactively mention winter tires, battery issues (cold kills batteries), salt/rust damage undercarriage, and heating system concerns when relevant to the conversation.";
    case "spring":
      return "Seasonal note: It's spring in Cleveland. Proactively mention pothole damage (suspension, alignment), brake inspection after winter driving, and spring maintenance checks when relevant.";
    case "summer":
      return "Seasonal note: It's summer in Cleveland. Proactively mention AC issues, cooling system checks, road trip prep packages, and tire pressure monitoring (heat affects tire pressure) when relevant.";
    case "fall":
      return "Seasonal note: It's fall in Cleveland. Proactively mention tire rotation, winterization prep, Ohio E-Check deadlines, and brake inspection before winter when relevant.";
  }
}

function getTemporalContext(now: Date): string {
  // Get ET components using Intl (reliable across Node versions)
  const etFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    hour: "numeric",
    minute: "numeric",
    hour12: true,
    month: "numeric",
  });
  const parts = etFormatter.formatToParts(now);
  const weekday = parts.find(p => p.type === "weekday")?.value as DayOfWeek;
  const hour = parseInt(parts.find(p => p.type === "hour")?.value || "12");
  const dayPeriod = parts.find(p => p.type === "dayPeriod")?.value || "AM";
  const month = parseInt(parts.find(p => p.type === "month")?.value || "1");
  // Convert 12h to 24h for logic
  const isPM = dayPeriod.toUpperCase() === "PM";
  const h24 = isPM ? (hour === 12 ? 12 : hour + 12) : (hour === 12 ? 0 : hour);

  const lines: string[] = [];
  lines.push(`Current context: ${weekday}, ${hour}${dayPeriod} ET`);

  // Closed hours check: Mon-Sat 8AM-6PM, Sun 9AM-4PM
  const isSunday = weekday === "Sunday";
  const openHour = isSunday ? 9 : 8;
  const closeHour = isSunday ? 16 : 18;
  const isClosed = h24 < openHour || h24 >= closeHour;

  if (isClosed) {
    if (h24 >= closeHour) {
      const nextDay = weekday === "Saturday" ? "Sunday at 9AM" : "tomorrow at 8AM";
      lines.push(`We're currently closed but open ${nextDay}. I can still help you figure out what's going on.`);
    } else {
      lines.push(`We're currently closed but open today at ${openHour}AM. I can still help you figure out what's going on.`);
    }
  }

  // Busy day warning
  if (weekday === "Monday" || weekday === "Saturday") {
    lines.push(`Heads up — ${weekday} is usually one of our busier days, so booking ahead is a good idea.`);
  }

  // Seasonal context
  lines.push(getSeasonalContext(getSeason(month)));

  return lines.join("\n");
}

// ─── SYSTEM PROMPT BUILDER ──────────────────────────────

export interface NickAIContext {
  /** Override current time (useful for testing). Defaults to now. */
  now?: Date;
  /** Memory context string for returning visitors. */
  memories?: string;
}

/**
 * Build the full system prompt with temporal, seasonal, competitive,
 * and memory context injected.
 */
export function buildSystemPrompt(ctx: NickAIContext = {}): string {
  const now = ctx.now ?? new Date();
  const temporal = getTemporalContext(now);
  const memoryBlock = ctx.memories
    ? `\n--- RETURNING CUSTOMER CONTEXT ---\nYou remember the following from previous conversations with this customer. Use this naturally — don't list it back to them, but reference it when relevant (e.g., "How's the Camry running?" or "Last time you mentioned brake noise").\n${ctx.memories}`
    : "";

  return `You are the AI assistant for Nick's Tire & Auto, a trusted independent auto repair and tire shop at 17625 Euclid Ave, Cleveland, OH 44112. Phone: (216) 862-0005. Hours: Mon-Sat 8AM-6PM, Sun 9AM-4PM.

Your personality:
- Direct, calm, confident, professional, knowledgeable
- Speak like a knowledgeable mechanic explaining a repair to a customer
- Never use hype, gimmicks, slang, or emojis
- Never diagnose with certainty without seeing the vehicle — always recommend bringing it in
- Always be honest about what could be wrong and what it might cost range-wise
- Keep responses concise — 2-4 sentences for simple questions, up to a paragraph for complex ones

${temporal}

Competitive positioning (use when relevant, don't force it):
- 4.9 stars with 1,700+ Google reviews — one of the highest-rated shops in Northeast Ohio
- 36-month warranty on most repairs (competitors typically offer 12 months)
- No-credit-check financing available (Acima, Snap, Koalafi, American First Finance)
- Walk-ins welcome 7 days a week — most competitors require appointments
- Bilingual service (Arabic/English) — mention only if customer communicates in Arabic
- We're not the cheapest, not the most expensive — our edge is trust, quality, and standing behind our work

Services offered:
- Tires: new/used, mounting, balancing, rotation, TPMS, flat repair
- Brakes: pads, rotors, calipers, lines, ABS diagnostics
- Diagnostics: check engine light, OBD-II, advanced computer diagnostics
- Emissions & E-Check: Ohio E-Check repair, oxygen sensors, EVAP, catalytic converters
- Oil Change: conventional and synthetic
- General Repair: suspension, steering, exhaust, cooling, belts, hoses
- Financing: Acima, Snap, Koalafi, American First Finance — no-credit-check options available

Areas served: Cleveland, Euclid, East Cleveland, South Euclid, Richmond Heights, Northeast Ohio.
${memoryBlock}
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
}

// Backward-compatible static prompt for code that doesn't pass context
const NICK_SYSTEM_PROMPT = buildSystemPrompt();

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
 *
 * @param memoryContext - Optional cross-session memories for returning visitors
 */
export async function chatWithAssistant(
  messages: Array<{ role: string; content: string }>,
  memoryContext?: string,
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

  // Build context-aware system prompt with temporal, seasonal, and memory layers
  const systemPrompt = buildSystemPrompt({
    memories: memoryContext,
  });

  try {
    const fullMessages = [
      { role: "system" as const, content: systemPrompt },
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
      } catch (err) {
        // Extraction is optional — don't fail the chat
        console.warn("[NickAI] Info extraction from chat failed:", err instanceof Error ? err.message : err);
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

/**
 * Extract memorable facts from a conversation for cross-session memory.
 * Runs as fire-and-forget after the chat response is sent.
 */
export async function extractMemories(
  messages: Array<{ role: string; content: string }>,
): Promise<Array<{ category: string; content: string; confidence: number }>> {
  // Need at least 3 exchanges (6 messages) to extract meaningful memories
  if (messages.length < 6) return [];

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a memory extraction system for an auto repair shop's AI assistant.
Analyze this conversation and extract key facts worth remembering for future visits.

Categories:
- vehicle: Vehicle make/model/year/color/mileage
- problem: Specific issues described (brake noise, check engine light, etc.)
- preference: Customer preferences (financing interest, preferred days/times, communication style)
- appointment: Scheduling details or intent
- feedback: Satisfaction signals, complaints, compliments

Rules:
- Only extract concrete, specific facts — not vague impressions
- Each memory should be a single clear statement
- Set confidence 0.5-1.0 based on how explicitly the customer stated it
- Return an empty array if nothing memorable was said
- Max 5 memories per conversation`,
        },
        {
          role: "user",
          content: `Conversation:\n${messages.slice(-12).map(m => `${m.role}: ${m.content}`).join("\n")}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "extracted_memories",
          strict: true,
          schema: {
            type: "object",
            properties: {
              memories: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    category: {
                      type: "string",
                      description: "One of: vehicle, problem, preference, appointment, feedback",
                    },
                    content: {
                      type: "string",
                      description: "The specific fact to remember",
                    },
                    confidence: {
                      type: "number",
                      description: "Confidence score 0.5-1.0",
                    },
                  },
                  required: ["category", "content", "confidence"],
                  additionalProperties: false,
                },
              },
            },
            required: ["memories"],
            additionalProperties: false,
          },
        },
      },
    });

    const raw = response.choices?.[0]?.message?.content;
    if (raw && typeof raw === "string") {
      const parsed = JSON.parse(raw);
      return (parsed.memories || []).map((m: { category: string; content: string; confidence: number }) => ({
        category: m.category,
        content: m.content,
        confidence: Math.min(1, Math.max(0.5, m.confidence)),
      }));
    }
  } catch (error) {
    console.error("[NickAI] Memory extraction failed:", error);
  }

  return [];
}
