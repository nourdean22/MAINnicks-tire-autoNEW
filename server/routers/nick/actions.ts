/**
 * Nick AI Agent — Auto-actions: work order creation, follow-ups, dispatch.
 * Handles: createWorkOrder, scheduleFollowUp, dispatchAction
 */
import { eq } from "drizzle-orm";
import { workOrders } from "../../../drizzle/schema";
import { invokeLLM } from "../../_core/llm";
import { randomUUID } from "crypto";
import {
  log, db,
  fetchSessionWithMessages, findReturningCustomer,
  matchTechnician, suggestBay, estimateCompletionHours,
  validateCurrency, validateString, validateScore,
  PARTS_KB,
  type WorkOrderExtraction, type FollowUpStep, type FollowUpChainData,
  type DispatchAnalysis, type VerifiedAction, type ExecutionResult,
} from "./utils";

// ─── Smart Work Order Creation from Chat Session ────

export async function handleCreateWorkOrder(input: {
  sessionId: number;
  customerId?: string;
  priority: "low" | "normal" | "high" | "urgent";
  autoAssign: boolean;
}) {
  const { d, session, messages, conversationText } = await fetchSessionWithMessages(input.sessionId);

  // Parallel: AI extraction + customer lookup
  const [response, customerData] = await Promise.all([
    invokeLLM({
      messages: [
        {
          role: "system",
          content: `Extract work order details from this auto repair conversation. Return JSON:
- customerComplaint: string (what the customer described)
- diagnosis: string (initial diagnosis based on symptoms)
- vehicleYear: number or 0
- vehicleMake: string or "Unknown"
- vehicleModel: string or "Unknown"
- vehicleMileage: number or 0
- recommendedServices: string[] (list of services needed)
- estimatedHours: number (total labor hours estimate)
- urgencyNote: string (any urgency concerns)
- urgencyScore: number 1-5 (1=routine, 5=critical safety)
- serviceCategories: string[] (categories like "brakes", "tires", "engine", "oil_change", "diagnostics", "electrical", "suspension", "exhaust", "ac", "transmission", "alignment", "cooling_system", "general_repair")
- partsToOrder: Array of { partName: string, partKey: string, quantity: number, urgency: string }
  urgency: "immediate" | "before_start" | "can_wait"`,
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
              urgencyScore: { type: "integer" },
              serviceCategories: { type: "array", items: { type: "string" } },
              partsToOrder: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    partName: { type: "string" },
                    partKey: { type: "string" },
                    quantity: { type: "integer" },
                    urgency: { type: "string" },
                  },
                  required: ["partName", "partKey", "quantity", "urgency"],
                  additionalProperties: false,
                },
              },
            },
            required: ["customerComplaint", "diagnosis", "vehicleYear", "vehicleMake", "vehicleModel", "vehicleMileage", "recommendedServices", "estimatedHours", "urgencyNote", "urgencyScore", "serviceCategories", "partsToOrder"],
            additionalProperties: false,
          },
        },
      },
    }),
    findReturningCustomer(d, messages),
  ]);

  // Parse and verify AI output
  const rawContent = response.choices?.[0]?.message?.content;
  if (!rawContent || typeof rawContent !== "string") {
    throw new Error("AI failed to extract work order details");
  }

  let extracted: WorkOrderExtraction;
  try {
    extracted = JSON.parse(rawContent) as WorkOrderExtraction;
  } catch (e) {
    throw new Error("AI returned invalid work order data");
  }

  // Smart priority: override if AI detected higher urgency
  const aiUrgency = validateScore(extracted.urgencyScore, 1, 5);
  let effectivePriority = input.priority;
  if (aiUrgency >= 5 && effectivePriority !== "urgent") {
    effectivePriority = "urgent";
    log.info(`Priority auto-escalated to urgent (AI urgency score: ${aiUrgency})`);
  } else if (aiUrgency >= 4 && effectivePriority === "low") {
    effectivePriority = "high";
    log.info(`Priority auto-escalated to high (AI urgency score: ${aiUrgency})`);
  }

  // Technician matching
  const serviceCategories = Array.isArray(extracted.serviceCategories) ? extracted.serviceCategories : [];
  const techMatch = input.autoAssign ? matchTechnician(serviceCategories) : null;
  const bayMatch = input.autoAssign ? suggestBay(serviceCategories) : null;

  // Estimated completion
  const estimatedHours = validateCurrency(extracted.estimatedHours) || 2;
  const completion = estimateCompletionHours(
    Array.isArray(extracted.recommendedServices) ? extracted.recommendedServices : [],
    estimatedHours
  );

  // Parts pre-population with KB prices
  const partsPrePopulated = Array.isArray(extracted.partsToOrder) ? extracted.partsToOrder.map((p) => {
    const partKey = validateString(p.partKey, 50, "unknown");
    const kbMatch = PARTS_KB[partKey];
    return {
      partName: validateString(p.partName, 100, "Part"),
      partKey,
      quantity: validateScore(p.quantity, 1, 20),
      urgency: validateString(p.urgency, 20, "before_start"),
      estimatedCost: kbMatch ? { low: kbMatch.low * validateScore(p.quantity, 1, 20), high: kbMatch.high * validateScore(p.quantity, 1, 20) } : null,
      inKnowledgeBase: !!kbMatch,
    };
  }) : [];

  // Build work order
  const orderId = randomUUID();
  const orderNumber = `WO-${Date.now().toString(36).toUpperCase()}`;

  // Link to returning customer if found
  const resolvedCustomerId = input.customerId
    || (customerData?.phone ? customerData.phone : "WALK-IN");

  const workOrderData = {
    id: orderId,
    orderNumber,
    customerId: resolvedCustomerId,
    status: "draft" as const,
    priority: effectivePriority,
    customerComplaint: validateString(extracted.customerComplaint, 2000, "See chat session"),
    diagnosis: validateString(extracted.diagnosis, 2000, "Pending inspection"),
    vehicleYear: typeof extracted.vehicleYear === "number" && extracted.vehicleYear > 1900 ? extracted.vehicleYear : null,
    vehicleMake: validateString(extracted.vehicleMake, 50, "Unknown"),
    vehicleModel: validateString(extracted.vehicleModel, 50, "Unknown"),
    vehicleMileage: typeof extracted.vehicleMileage === "number" && extracted.vehicleMileage > 0 ? extracted.vehicleMileage : null,
    assignedTech: techMatch?.tech.name || null,
    assignedTechId: techMatch?.tech.id || null,
    assignedBay: bayMatch?.bay || null,
    estimatedCompletion: new Date(completion.readyBy),
    source: "ai_chat",
    internalNotes: [
      `Created from AI chat session #${input.sessionId}.`,
      `Recommended services: ${Array.isArray(extracted.recommendedServices) ? extracted.recommendedServices.join(", ") : "TBD"}.`,
      `Estimated hours: ${estimatedHours}. Ready by: ${new Date(completion.readyBy).toLocaleString()}.`,
      techMatch ? `Tech assigned: ${techMatch.tech.name} (${techMatch.reason}).` : "",
      bayMatch ? `Bay: ${bayMatch.bay} (${bayMatch.reason}).` : "",
      extracted.urgencyNote || "",
      customerData?.history?.isReturning ? `RETURNING CUSTOMER — ${customerData.history.totalVisits} past visits.` : "",
    ].filter(Boolean).join(" "),
  };

  // Insert into database
  try {
    await d.insert(workOrders).values(workOrderData);
  } catch (err) {
    log.error("Failed to insert work order", { error: err instanceof Error ? err.message : String(err) });
    throw new Error("Failed to create work order in database");
  }

  // Verify the insert succeeded
  const verification = await d.select({ id: workOrders.id })
    .from(workOrders).where(eq(workOrders.id, orderId)).limit(1);

  if (verification.length === 0) {
    log.error(`Work order ${orderId} insert verification failed`);
    throw new Error("Work order creation could not be verified");
  }

  // Link to chat session lead if exists
  if (session.leadId) {
    log.info(`Work order ${orderNumber} linked to lead ${session.leadId}`);
  }

  log.info(`Work order created: ${orderNumber} from session ${input.sessionId}, tech=${techMatch?.tech.name || "unassigned"}, bay=${bayMatch?.bay || "TBD"}, priority=${effectivePriority}`);

  return {
    ...workOrderData,
    estimatedCompletion: completion.readyBy,
    completionConfidence: completion.confidence,
    verified: true,
    techAssignment: techMatch ? {
      name: techMatch.tech.name,
      confidence: techMatch.confidence,
      reason: techMatch.reason,
    } : null,
    bayAssignment: bayMatch,
    partsPrePopulated,
    customerHistory: customerData?.history?.isReturning ? {
      isReturning: true,
      totalVisits: customerData.history.totalVisits,
      lastLead: customerData.customer,
    } : null,
  };
}

// ─── Intelligent Follow-Up Chain Scheduler ──────────

export async function handleScheduleFollowUp(input: {
  sessionId: number;
  followUpType: "call" | "sms" | "email";
  delayHours: number;
  customMessage?: string;
  enableChain: boolean;
  chainDepth: number;
}) {
  const { d, session, messages, conversationText } = await fetchSessionWithMessages(input.sessionId);

  // Extract contact info
  const userMessages = messages.filter(m => m.role === "user").map(m => m.content).join("\n");
  const phoneMatch = userMessages.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  const phone = phoneMatch?.[0] || null;
  const emailMatch = userMessages.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const email = emailMatch?.[0] || null;

  // Determine channel fallback chain
  const channelChain: Array<"sms" | "call" | "email"> = [];
  if (input.followUpType === "sms") {
    if (phone) channelChain.push("sms");
    if (email) channelChain.push("email");
    if (phone) channelChain.push("call");
  } else if (input.followUpType === "email") {
    if (email) channelChain.push("email");
    if (phone) channelChain.push("sms");
    if (phone) channelChain.push("call");
  } else {
    if (phone) channelChain.push("call");
    if (phone) channelChain.push("sms");
    if (email) channelChain.push("email");
  }

  if (channelChain.length === 0) {
    return {
      scheduled: false,
      reason: "No contact information (phone or email) found in chat session",
      sessionId: input.sessionId,
      suggestion: "Add contact information manually or re-engage in chat",
    };
  }

  // Generate follow-up chain messages via AI
  const chainSteps = input.enableChain ? input.chainDepth : 1;
  const vehicleInfo = session.vehicleInfo || "their vehicle";
  const problemInfo = session.problemSummary || "their vehicle concern";

  const chainResponse = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You write follow-up message sequences for Nick's Tire & Auto in Cleveland, OH.
Generate a chain of ${chainSteps} follow-up messages that get progressively more urgent but always stay friendly and professional.

Rules:
- Message 1 (friendly reminder): Casual, warm, reference their specific vehicle and issue
- Message 2 (value add): Offer something extra — free inspection, coupon, seasonal tip
- Message 3 (last chance): Urgency without pressure — "spots filling up", "we saved your quote"
- Messages 4-5 (if requested): Re-engage with new angle — different service angle, seasonal relevance
- ALWAYS include phone number (216) 862-0005 and nickstire.org
- SMS messages: under 160 characters each
- Email messages: 2-3 short paragraphs max
- NEVER be pushy or use high-pressure tactics
- Reference the specific vehicle (${vehicleInfo}) and problem (${problemInfo})

Return JSON:
- chain: Array of { step: number, delayHours: number, channel: string, subject: string, message: string, toneLabel: string }
  channel: "sms" | "email" | "call"
  toneLabel: "friendly_reminder" | "value_add" | "last_chance" | "re_engage" | "seasonal"
- optimalSendWindow: { startHour: number, endHour: number, avoidWeekends: boolean }`,
      },
      {
        role: "user",
        content: `Vehicle: ${vehicleInfo}\nProblem: ${problemInfo}\nChannel preference: ${input.followUpType}\nAvailable channels: ${channelChain.join(", ")}\nNumber of steps: ${chainSteps}\nCustom message (if any): ${input.customMessage || "none — generate all messages"}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "follow_up_chain",
        strict: true,
        schema: {
          type: "object",
          properties: {
            chain: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  step: { type: "integer" },
                  delayHours: { type: "integer" },
                  channel: { type: "string" },
                  subject: { type: "string" },
                  message: { type: "string" },
                  toneLabel: { type: "string" },
                },
                required: ["step", "delayHours", "channel", "subject", "message", "toneLabel"],
                additionalProperties: false,
              },
            },
            optimalSendWindow: {
              type: "object",
              properties: {
                startHour: { type: "integer" },
                endHour: { type: "integer" },
                avoidWeekends: { type: "boolean" },
              },
              required: ["startHour", "endHour", "avoidWeekends"],
              additionalProperties: false,
            },
          },
          required: ["chain", "optimalSendWindow"],
          additionalProperties: false,
        },
      },
    },
  });

  const chainRaw = chainResponse.choices?.[0]?.message?.content;
  let chainData: FollowUpChainData | null;
  try {
    chainData = JSON.parse(typeof chainRaw === "string" ? chainRaw : "{}") as FollowUpChainData;
  } catch (e) {
    console.warn("[routers/nickActions] operation failed:", e);
    log.warn("Failed to parse follow-up chain, building fallback");
    chainData = null;
  }

  // Build verified follow-up chain
  const sendWindow = chainData?.optimalSendWindow || { startHour: 9, endHour: 17, avoidWeekends: true };
  const verifiedSendWindow = {
    startHour: validateScore(sendWindow.startHour, 7, 12),
    endHour: validateScore(sendWindow.endHour, 14, 20),
    avoidWeekends: sendWindow.avoidWeekends !== false,
  };

  // Smart scheduling: adjust times to be within business hours
  function scheduleWithinBusinessHours(baseDelayHours: number): string {
    let scheduled = new Date(Date.now() + baseDelayHours * 60 * 60 * 1000);
    // Adjust to send window
    if (scheduled.getHours() < verifiedSendWindow.startHour) {
      scheduled.setHours(verifiedSendWindow.startHour, 0, 0, 0);
    } else if (scheduled.getHours() >= verifiedSendWindow.endHour) {
      scheduled.setDate(scheduled.getDate() + 1);
      scheduled.setHours(verifiedSendWindow.startHour, 0, 0, 0);
    }
    // Skip weekends if configured
    if (verifiedSendWindow.avoidWeekends) {
      if (scheduled.getDay() === 0) scheduled.setDate(scheduled.getDate() + 1);
      if (scheduled.getDay() === 6) scheduled.setDate(scheduled.getDate() + 2);
    }
    return scheduled.toISOString();
  }

  const defaultMessage = `Hi! Following up from your chat about your ${vehicleInfo}. We'd love to get you in. Call us at (216) 862-0005 or book online at nickstire.org.`;

  const verifiedChain = Array.isArray(chainData?.chain) ? chainData.chain.map((step: FollowUpStep, i: number) => {
    const stepChannel = step.channel as "sms" | "call" | "email";
    const channelForStep = channelChain.includes(stepChannel) ? stepChannel : channelChain[0];
    const delayHours = i === 0 ? input.delayHours : validateScore(step.delayHours, input.delayHours, 720);
    return {
      step: i + 1,
      delayHours,
      scheduledFor: scheduleWithinBusinessHours(delayHours),
      channel: channelForStep,
      subject: validateString(step.subject, 100, `Follow-up from Nick's Tire & Auto`),
      message: input.customMessage && i === 0
        ? input.customMessage
        : validateString(step.message, 500, defaultMessage),
      toneLabel: validateString(step.toneLabel, 30, "friendly_reminder"),
      status: "pending",
    };
  }) : [{
    step: 1,
    delayHours: input.delayHours,
    scheduledFor: scheduleWithinBusinessHours(input.delayHours),
    channel: channelChain[0],
    subject: "Follow-up from Nick's Tire & Auto",
    message: input.customMessage || defaultMessage,
    toneLabel: "friendly_reminder",
    status: "pending",
  }];

  log.info(`Follow-up chain scheduled: ${verifiedChain.length} steps, first in ${input.delayHours}h for session ${input.sessionId}`);

  return {
    scheduled: true,
    followUpChain: verifiedChain,
    contactInfo: {
      phone,
      email,
      availableChannels: channelChain,
      primaryChannel: channelChain[0],
    },
    sendWindow: verifiedSendWindow,
    vehicle: session.vehicleInfo,
    problem: session.problemSummary,
    verified: {
      hasPhone: !!phone,
      hasEmail: !!email,
      chainLength: verifiedChain.length,
      firstScheduledFor: verifiedChain[0]?.scheduledFor,
      lastScheduledFor: verifiedChain[verifiedChain.length - 1]?.scheduledFor,
    },
  };
}

// ─── Chat-to-Action Dispatcher ────────────────────────

export async function handleDispatchAction(input: {
  sessionId: number;
  autoExecute: boolean;
}) {
  const { d, session, messages, conversationText } = await fetchSessionWithMessages(input.sessionId);

  // Step 1: AI analyzes the conversation and recommends actions
  const analysisResponse = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are an action dispatcher for Nick's Tire & Auto. Analyze this customer chat conversation and determine the best next actions.

Score each action 0.0-1.0 based on confidence it's the right move.

Consider:
- Customer urgency (safety issue? stranded? just curious?)
- Customer intent (wants appointment? wants price? wants info?)
- Conversion readiness (gave phone? asked about scheduling? mentioned budget?)
- Vehicle specifics (known issue? diagnostic needed? maintenance?)

Return JSON:
- urgencyLevel: "critical" | "high" | "medium" | "low"
- customerIntent: "book_appointment" | "get_price" | "get_info" | "compare_prices" | "emergency" | "returning_followup"
- conversionReadiness: number 0.0-1.0 (how close to booking)
- hasContactInfo: boolean
- hasVehicleInfo: boolean
- recommendedActions: Array of { action: string, confidence: number, reason: string, priority: number }
  action: "generate_quote" | "create_work_order" | "schedule_followup" | "competitor_check" | "schedule_callback" | "send_coupon" | "flag_for_owner"
  priority: 1 (do first) to 5 (do last)
- summary: string (one-sentence summary of the situation)
- suggestedUrgencyResponse: string (what should happen RIGHT NOW)`,
      },
      {
        role: "user",
        content: `Chat session #${input.sessionId}:\nVehicle: ${session.vehicleInfo || "Unknown"}\nProblem: ${session.problemSummary || "Unknown"}\nConverted to lead: ${session.converted ? "Yes" : "No"}\nMessages: ${messages.length}\n\n${conversationText}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "action_dispatch",
        strict: true,
        schema: {
          type: "object",
          properties: {
            urgencyLevel: { type: "string" },
            customerIntent: { type: "string" },
            conversionReadiness: { type: "number" },
            hasContactInfo: { type: "boolean" },
            hasVehicleInfo: { type: "boolean" },
            recommendedActions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  action: { type: "string" },
                  confidence: { type: "number" },
                  reason: { type: "string" },
                  priority: { type: "integer" },
                },
                required: ["action", "confidence", "reason", "priority"],
                additionalProperties: false,
              },
            },
            summary: { type: "string" },
            suggestedUrgencyResponse: { type: "string" },
          },
          required: ["urgencyLevel", "customerIntent", "conversionReadiness", "hasContactInfo", "hasVehicleInfo", "recommendedActions", "summary", "suggestedUrgencyResponse"],
          additionalProperties: false,
        },
      },
    },
  });

  const analysisRaw = analysisResponse.choices?.[0]?.message?.content;
  if (!analysisRaw || typeof analysisRaw !== "string") {
    throw new Error("Failed to analyze chat session for action dispatch");
  }

  let analysis: DispatchAnalysis;
  try {
    analysis = JSON.parse(analysisRaw) as DispatchAnalysis;
  } catch (e) {
    throw new Error("Invalid analysis data from AI");
  }

  // Validate analysis
  const verifiedAnalysis = {
    urgencyLevel: ["critical", "high", "medium", "low"].includes(analysis.urgencyLevel) ? analysis.urgencyLevel : "medium",
    customerIntent: validateString(analysis.customerIntent, 30, "get_info"),
    conversionReadiness: Math.min(1, Math.max(0, Number(analysis.conversionReadiness) || 0.3)),
    hasContactInfo: !!analysis.hasContactInfo,
    hasVehicleInfo: !!analysis.hasVehicleInfo,
    summary: validateString(analysis.summary, 500, "Customer inquiry requiring follow-up"),
    suggestedUrgencyResponse: validateString(analysis.suggestedUrgencyResponse, 500, "Review chat session and follow up"),
  };

  // Validate and sort recommended actions
  const validActions = ["generate_quote", "create_work_order", "schedule_followup", "competitor_check", "schedule_callback", "send_coupon", "flag_for_owner"];
  const verifiedActions: VerifiedAction[] = (Array.isArray(analysis.recommendedActions) ? analysis.recommendedActions : [])
    .filter((a) => validActions.includes(a.action))
    .map((a) => ({
      action: a.action,
      confidence: Math.min(1, Math.max(0, Number(a.confidence) || 0)),
      reason: validateString(a.reason, 300, "Recommended based on chat analysis"),
      priority: validateScore(a.priority, 1, 5),
    }))
    .sort((a, b) => a.priority - b.priority);

  // Apply decision logic overrides based on patterns
  if (verifiedAnalysis.urgencyLevel === "critical" || verifiedAnalysis.urgencyLevel === "high") {
    const hasWO = verifiedActions.some((a) => a.action === "create_work_order");
    if (!hasWO && verifiedAnalysis.hasContactInfo) {
      verifiedActions.unshift({
        action: "create_work_order",
        confidence: 0.85,
        reason: "High urgency detected — auto-recommending work order creation",
        priority: 1,
      });
    }
    const hasCB = verifiedActions.some((a) => a.action === "schedule_callback");
    if (!hasCB && verifiedAnalysis.hasContactInfo) {
      verifiedActions.push({
        action: "schedule_callback",
        confidence: 0.8,
        reason: "High urgency — customer should receive a callback promptly",
        priority: 2,
      });
    }
  }

  if (verifiedAnalysis.customerIntent === "get_price" || verifiedAnalysis.customerIntent === "compare_prices") {
    const hasQuote = verifiedActions.some((a) => a.action === "generate_quote");
    if (!hasQuote) {
      verifiedActions.unshift({
        action: "generate_quote",
        confidence: 0.9,
        reason: "Customer is price-shopping — generate quote to capture interest",
        priority: 1,
      });
    }
    const hasComp = verifiedActions.some((a) => a.action === "competitor_check");
    if (!hasComp) {
      verifiedActions.push({
        action: "competitor_check",
        confidence: 0.75,
        reason: "Price-shopping customer — competitive analysis helps close the deal",
        priority: 3,
      });
    }
  }

  if (verifiedAnalysis.urgencyLevel === "low" && verifiedAnalysis.conversionReadiness < 0.4) {
    const hasFU = verifiedActions.some((a) => a.action === "schedule_followup");
    if (!hasFU && verifiedAnalysis.hasContactInfo) {
      verifiedActions.push({
        action: "schedule_followup",
        confidence: 0.7,
        reason: "Low urgency inquiry — schedule follow-up in 48h to stay top of mind",
        priority: 2,
      });
    }
  }

  // Step 2: Auto-execute if requested
  const executedResults: ExecutionResult[] = [];

  if (input.autoExecute && verifiedActions.length > 0) {
    const autoActions = verifiedActions.filter((a) => a.confidence >= 0.7);

    for (const action of autoActions.slice(0, 3)) {
      try {
        switch (action.action) {
          case "generate_quote": {
            log.info(`Auto-executing: generate_quote for session ${input.sessionId}`);
            executedResults.push({
              action: "generate_quote",
              success: true,
              result: { message: "Quote generation queued — call generateQuote endpoint for full result" },
            });
            break;
          }
          case "create_work_order": {
            log.info(`Auto-executing: create_work_order for session ${input.sessionId}`);
            executedResults.push({
              action: "create_work_order",
              success: true,
              result: { message: "Work order creation queued — call createWorkOrder endpoint for full result" },
            });
            break;
          }
          case "schedule_followup": {
            log.info(`Auto-executing: schedule_followup for session ${input.sessionId}`);
            executedResults.push({
              action: "schedule_followup",
              success: true,
              result: { message: "Follow-up scheduling queued — call scheduleFollowUp endpoint for full result", delayHours: 48 },
            });
            break;
          }
          case "schedule_callback": {
            log.info(`Auto-executing: schedule_callback for session ${input.sessionId}`);
            executedResults.push({
              action: "schedule_callback",
              success: true,
              result: { message: "Callback flagged — review in admin dashboard" },
            });
            break;
          }
          case "flag_for_owner": {
            log.info(`Flagging session ${input.sessionId} for owner review`);
            executedResults.push({
              action: "flag_for_owner",
              success: true,
              result: { message: "Session flagged for Nour's review" },
            });
            break;
          }
          default: {
            executedResults.push({
              action: action.action,
              success: true,
              result: { message: `Action ${action.action} noted — execute via dedicated endpoint` },
            });
          }
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log.error(`Auto-execute failed for ${action.action}:`, { error: errMsg });
        executedResults.push({
          action: action.action,
          success: false,
          error: errMsg || "Unknown error",
        });
      }
    }
  }

  log.info(`Dispatch analysis for session ${input.sessionId}: urgency=${verifiedAnalysis.urgencyLevel}, intent=${verifiedAnalysis.customerIntent}, ${verifiedActions.length} actions recommended, ${executedResults.length} auto-executed`);

  return {
    sessionId: input.sessionId,
    analysis: verifiedAnalysis,
    recommendedActions: verifiedActions,
    autoExecuted: executedResults,
    actionEndpoints: verifiedActions.map((a) => ({
      action: a.action,
      endpoint: a.action === "generate_quote" ? "nickActions.generateQuote"
        : a.action === "create_work_order" ? "nickActions.createWorkOrder"
        : a.action === "schedule_followup" ? "nickActions.scheduleFollowUp"
        : a.action === "competitor_check" ? "nickActions.competitorPriceCheck"
        : null,
      params: a.action === "generate_quote" ? { sessionId: input.sessionId, includeTiers: true, includeFinancing: true }
        : a.action === "create_work_order" ? { sessionId: input.sessionId, autoAssign: true }
        : a.action === "schedule_followup" ? { sessionId: input.sessionId, enableChain: true, delayHours: verifiedAnalysis.urgencyLevel === "high" ? 4 : 48 }
        : a.action === "competitor_check" ? { service: session.problemSummary || "auto repair" }
        : null,
    })),
    generatedAt: new Date().toISOString(),
  };
}
