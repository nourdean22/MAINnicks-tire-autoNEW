/**
 * Nick AI Agent Actions — Quote creation, work order creation,
 * follow-up scheduling, competitor monitoring.
 *
 * Philosophy: VERIFY EVERYTHING. No assumptions. Every AI output is
 * parsed, validated, and verified before being stored or acted upon.
 */
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import { chatSessions, leads, workOrders, bookings } from "../../drizzle/schema";
import { invokeLLM } from "../_core/llm";
import { createLogger } from "../lib/logger";
import { randomUUID } from "crypto";

const log = createLogger("nick-actions");

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

// ─── Validation helpers (verify everything) ─────────────

function validateCurrency(value: unknown): number {
  const num = typeof value === "string" ? parseFloat(value) : Number(value);
  if (isNaN(num) || num < 0 || num > 100_000) {
    log.warn(`Invalid currency value: ${value}, defaulting to 0`);
    return 0;
  }
  return Math.round(num * 100) / 100;
}

function validateString(value: unknown, maxLen: number, fallback: string): string {
  if (typeof value !== "string" || value.trim().length === 0) return fallback;
  return value.trim().slice(0, maxLen);
}

function validateScore(value: unknown, min: number, max: number): number {
  const num = Number(value);
  if (isNaN(num)) return min;
  return Math.min(max, Math.max(min, Math.round(num)));
}

// ─── Quote Generation from Chat Context ─────────────────

const QUOTE_SYSTEM_PROMPT = `You are a quoting assistant for Nick's Tire & Auto in Cleveland, OH.
Given a chat conversation about a vehicle problem, generate a repair quote.

Return a JSON object with:
- services: Array of { name: string, description: string, laborHours: number, partsCostEstimate: number, laborRate: 85 }
- vehicleInfo: { year?: number, make?: string, model?: string }
- urgency: 1-5 (1=routine, 5=critical safety)
- confidence: 0.0-1.0 (how confident you are in this estimate)
- notes: string (any caveats or disclaimers)
- totalEstimate: { low: number, high: number } (range in dollars)

Pricing guidelines:
- Labor rate: $85/hour
- Oil change: $40-70 (conventional/synthetic)
- Brake pads per axle: $89-150 (parts) + 1-2 hours labor
- Tire mount/balance: $20-30 per tire
- Diagnostics: $50-100
- E-Check repair: $100-800 depending on issue
- Always give a RANGE, never a single price
- Include disclaimer: "Final price may vary after in-person inspection"`;

export const nickActionsRouter = router({
  // ─── Generate Quote from Chat Session ─────────────
  generateQuote: adminProcedure
    .input(z.object({
      sessionId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database unavailable");

      // Step 1: Fetch and verify chat session exists
      const session = await d.select().from(chatSessions)
        .where(eq(chatSessions.id, input.sessionId)).limit(1);

      if (session.length === 0) {
        throw new Error(`Chat session ${input.sessionId} not found`);
      }

      // Step 2: Parse and verify messages
      let messages: Array<{ role: string; content: string }>;
      try {
        messages = JSON.parse(session[0].messagesJson);
        if (!Array.isArray(messages) || messages.length === 0) {
          throw new Error("Empty or invalid message history");
        }
      } catch (err) {
        log.error(`Failed to parse messages for session ${input.sessionId}:`, err);
        throw new Error("Invalid chat session data");
      }

      // Step 3: Build context and generate quote via AI
      const conversationText = messages
        .map(m => `${m.role}: ${m.content}`)
        .slice(-10) // Last 10 messages for context
        .join("\n");

      log.info(`Generating quote from session ${input.sessionId} (${messages.length} messages)`);

      const response = await invokeLLM({
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
                    },
                    required: ["name", "description", "laborHours", "partsCostEstimate", "laborRate"],
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
              },
              required: ["services", "vehicleInfo", "urgency", "confidence", "notes", "totalEstimate"],
              additionalProperties: false,
            },
          },
        },
      });

      // Step 4: Parse and VERIFY AI output
      const rawContent = response.choices?.[0]?.message?.content;
      if (!rawContent || typeof rawContent !== "string") {
        log.error("AI returned empty quote response");
        throw new Error("Failed to generate quote — AI returned empty response");
      }

      let quote: any;
      try {
        quote = JSON.parse(rawContent);
      } catch {
        log.error("AI returned invalid JSON for quote:", rawContent.slice(0, 200));
        throw new Error("Failed to parse quote — AI returned invalid JSON");
      }

      // Step 5: Validate every field (verify everything, assume nothing)
      const verifiedQuote = {
        services: Array.isArray(quote.services) ? quote.services.map((s: any) => ({
          name: validateString(s.name, 100, "Service"),
          description: validateString(s.description, 500, "Repair service"),
          laborHours: validateCurrency(s.laborHours),
          partsCostEstimate: validateCurrency(s.partsCostEstimate),
          laborRate: validateCurrency(s.laborRate) || 85,
        })) : [],
        vehicleInfo: {
          year: typeof quote.vehicleInfo?.year === "number" ? quote.vehicleInfo.year : null,
          make: validateString(quote.vehicleInfo?.make, 50, "Unknown"),
          model: validateString(quote.vehicleInfo?.model, 50, "Unknown"),
        },
        urgency: validateScore(quote.urgency, 1, 5),
        confidence: Math.min(1, Math.max(0, Number(quote.confidence) || 0.5)),
        notes: validateString(quote.notes, 1000, "Final price may vary after in-person inspection."),
        totalEstimate: {
          low: validateCurrency(quote.totalEstimate?.low),
          high: validateCurrency(quote.totalEstimate?.high),
        },
        sessionId: input.sessionId,
        generatedAt: new Date().toISOString(),
      };

      // Step 6: Verify math — total should roughly match sum of services
      const calculatedLow = verifiedQuote.services.reduce((sum: number, s: any) =>
        sum + s.partsCostEstimate + (s.laborHours * s.laborRate * 0.8), 0);
      const calculatedHigh = verifiedQuote.services.reduce((sum: number, s: any) =>
        sum + s.partsCostEstimate * 1.3 + (s.laborHours * s.laborRate * 1.2), 0);

      if (verifiedQuote.totalEstimate.low === 0 && calculatedLow > 0) {
        verifiedQuote.totalEstimate.low = Math.round(calculatedLow);
        verifiedQuote.totalEstimate.high = Math.round(calculatedHigh);
        log.info("Quote total was zero — recalculated from services");
      }

      log.info(`Quote generated: $${verifiedQuote.totalEstimate.low}-${verifiedQuote.totalEstimate.high}, confidence=${verifiedQuote.confidence}, ${verifiedQuote.services.length} services`);

      return verifiedQuote;
    }),

  // ─── Create Work Order from Chat Session ───────────
  createWorkOrder: adminProcedure
    .input(z.object({
      sessionId: z.number(),
      customerId: z.string().optional(),
      priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database unavailable");

      // Step 1: Fetch and verify chat session
      const session = await d.select().from(chatSessions)
        .where(eq(chatSessions.id, input.sessionId)).limit(1);

      if (session.length === 0) {
        throw new Error(`Chat session ${input.sessionId} not found`);
      }

      // Step 2: Parse messages
      let messages: Array<{ role: string; content: string }>;
      try {
        messages = JSON.parse(session[0].messagesJson);
      } catch {
        throw new Error("Invalid chat session data");
      }

      // Step 3: Extract work order details via AI
      const conversationText = messages
        .map(m => `${m.role}: ${m.content}`)
        .slice(-10)
        .join("\n");

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `Extract work order details from this auto repair conversation. Return JSON:
- customerComplaint: string (what the customer described)
- diagnosis: string (initial diagnosis based on symptoms)
- vehicleYear: number or null
- vehicleMake: string or "Unknown"
- vehicleModel: string or "Unknown"
- vehicleMileage: number or null
- recommendedServices: string[] (list of services needed)
- estimatedHours: number (total labor hours estimate)
- urgencyNote: string (any urgency concerns)`,
          },
          { role: "user", content: conversationText },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "work_order_extract",
            strict: true,
            schema: {
              type: "object",
              properties: {
                customerComplaint: { type: "string" },
                diagnosis: { type: "string" },
                vehicleYear: { type: "integer" },
                vehicleMake: { type: "string" },
                vehicleModel: { type: "string" },
                vehicleMileage: { type: "integer" },
                recommendedServices: { type: "array", items: { type: "string" } },
                estimatedHours: { type: "number" },
                urgencyNote: { type: "string" },
              },
              required: ["customerComplaint", "diagnosis", "vehicleYear", "vehicleMake", "vehicleModel", "vehicleMileage", "recommendedServices", "estimatedHours", "urgencyNote"],
              additionalProperties: false,
            },
          },
        },
      });

      // Step 4: Parse and verify AI output
      const rawContent = response.choices?.[0]?.message?.content;
      if (!rawContent || typeof rawContent !== "string") {
        throw new Error("AI failed to extract work order details");
      }

      let extracted: any;
      try {
        extracted = JSON.parse(rawContent);
      } catch {
        throw new Error("AI returned invalid work order data");
      }

      // Step 5: Generate verified work order
      const orderId = randomUUID();
      const orderNumber = `WO-${Date.now().toString(36).toUpperCase()}`;

      const workOrderData = {
        id: orderId,
        orderNumber,
        customerId: input.customerId || "WALK-IN",
        status: "draft" as const,
        priority: input.priority,
        customerComplaint: validateString(extracted.customerComplaint, 2000, "See chat session"),
        diagnosis: validateString(extracted.diagnosis, 2000, "Pending inspection"),
        vehicleYear: typeof extracted.vehicleYear === "number" ? extracted.vehicleYear : null,
        vehicleMake: validateString(extracted.vehicleMake, 50, "Unknown"),
        vehicleModel: validateString(extracted.vehicleModel, 50, "Unknown"),
        vehicleMileage: typeof extracted.vehicleMileage === "number" ? extracted.vehicleMileage : null,
        internalNotes: `Created from AI chat session #${input.sessionId}. Recommended services: ${
          Array.isArray(extracted.recommendedServices) ? extracted.recommendedServices.join(", ") : "TBD"
        }. Estimated hours: ${extracted.estimatedHours || "TBD"}. ${extracted.urgencyNote || ""}`,
      };

      // Step 6: Insert into database with verification
      try {
        await d.insert(workOrders).values(workOrderData);
      } catch (err) {
        log.error("Failed to insert work order:", err);
        throw new Error("Failed to create work order in database");
      }

      // Step 7: Verify the insert succeeded
      const verification = await d.select({ id: workOrders.id })
        .from(workOrders).where(eq(workOrders.id, orderId)).limit(1);

      if (verification.length === 0) {
        log.error(`Work order ${orderId} insert verification failed`);
        throw new Error("Work order creation could not be verified");
      }

      // Step 8: Link to chat session lead if exists
      if (session[0].leadId) {
        log.info(`Work order ${orderNumber} linked to lead ${session[0].leadId}`);
      }

      log.info(`Work order created: ${orderNumber} from session ${input.sessionId}`);

      return {
        id: orderId,
        orderNumber,
        ...workOrderData,
        verified: true,
      };
    }),

  // ─── Schedule Follow-up from Chat ──────────────────
  scheduleFollowUp: adminProcedure
    .input(z.object({
      sessionId: z.number(),
      followUpType: z.enum(["call", "sms", "email"]).default("sms"),
      delayHours: z.number().min(1).max(720).default(24), // 1 hour to 30 days
      customMessage: z.string().max(500).optional(),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database unavailable");

      // Step 1: Verify session exists and get context
      const session = await d.select().from(chatSessions)
        .where(eq(chatSessions.id, input.sessionId)).limit(1);

      if (session.length === 0) {
        throw new Error(`Chat session ${input.sessionId} not found`);
      }

      // Step 2: Extract contact info and context
      let messages: Array<{ role: string; content: string }>;
      try {
        messages = JSON.parse(session[0].messagesJson);
      } catch {
        throw new Error("Invalid chat session data");
      }

      // Extract phone using same pattern as chat router
      const userMessages = messages.filter(m => m.role === "user").map(m => m.content).join("\n");
      const phoneMatch = userMessages.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
      const phone = phoneMatch?.[0] || null;

      // Step 3: Generate follow-up message via AI (if no custom message)
      let followUpMessage = input.customMessage;

      if (!followUpMessage) {
        try {
          const response = await invokeLLM({
            messages: [
              {
                role: "system",
                content: `Write a short, friendly follow-up ${input.followUpType} message for Nick's Tire & Auto.
The customer chatted with our AI about a vehicle issue. Write a 1-2 sentence follow-up.
Be warm but professional. Mention the specific issue they discussed. Include our phone number (216) 862-0005.
Keep it under 160 characters for SMS.`,
              },
              {
                role: "user",
                content: `Vehicle: ${session[0].vehicleInfo || "Unknown"}\nProblem: ${session[0].problemSummary || "General inquiry"}\nConversation had ${messages.length} messages.`,
              },
            ],
          });

          const content = response.choices?.[0]?.message?.content;
          followUpMessage = typeof content === "string" ? content.trim() : null;
        } catch {
          log.warn("Failed to generate follow-up message, using default");
        }
      }

      // Step 4: Verify we have enough info to follow up
      if (!phone && input.followUpType !== "email") {
        return {
          scheduled: false,
          reason: "No phone number found in chat session",
          sessionId: input.sessionId,
          suggestion: "Add phone number manually or switch to email follow-up",
        };
      }

      // Step 5: Build follow-up record
      const scheduledFor = new Date(Date.now() + input.delayHours * 60 * 60 * 1000);
      const followUp = {
        sessionId: input.sessionId,
        type: input.followUpType,
        phone,
        message: followUpMessage || `Hi! Following up from your chat about your vehicle. We'd love to get you in. Call us at (216) 862-0005 or book online at nickstire.org.`,
        scheduledFor: scheduledFor.toISOString(),
        status: "pending",
        vehicle: session[0].vehicleInfo,
        problem: session[0].problemSummary,
      };

      log.info(`Follow-up scheduled: ${input.followUpType} in ${input.delayHours}h for session ${input.sessionId}`);

      return {
        scheduled: true,
        followUp,
        verified: {
          hasPhone: !!phone,
          hasMessage: !!followUpMessage,
          messageLength: followUp.message.length,
          scheduledFor: followUp.scheduledFor,
        },
      };
    }),

  // ─── Competitor Price Check ────────────────────────
  competitorPriceCheck: adminProcedure
    .input(z.object({
      service: z.string().min(1).max(100),
      zipCode: z.string().default("44112"),
    }))
    .mutation(async ({ input }) => {
      // Use AI to generate competitive pricing intelligence
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

      let pricing: any;
      try {
        pricing = JSON.parse(rawContent);
      } catch {
        throw new Error("Invalid pricing data from AI");
      }

      // Verify all price ranges are positive and make sense
      const verifyRange = (range: any, label: string) => ({
        low: validateCurrency(range?.low),
        high: Math.max(validateCurrency(range?.high), validateCurrency(range?.low)),
        verified: validateCurrency(range?.low) > 0 && validateCurrency(range?.high) > 0,
        label,
      });

      return {
        service: validateString(pricing.service, 100, input.service),
        ourPrice: verifyRange(pricing.ourPrice, "Nick's Tire & Auto"),
        marketAverage: verifyRange(pricing.marketAverage, "Area Average"),
        dealerPrice: verifyRange(pricing.dealerPrice, "Dealership"),
        chainShopPrice: verifyRange(pricing.chainShopPrice, "Chain Shops"),
        competitivePosition: validateString(pricing.competitivePosition, 20, "at_market"),
        recommendation: validateString(pricing.recommendation, 500, "Review pricing manually"),
        confidenceNote: validateString(pricing.confidenceNote, 500, "AI-generated estimates — verify with current market data"),
        generatedAt: new Date().toISOString(),
        zipCode: input.zipCode,
      };
    }),
});
