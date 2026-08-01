/**
 * Nick Agent Layer — Structured Action Middleware
 *
 * Nick AI suggests actions in structured JSON format.
 * This layer parses those actions and executes them against
 * the real system (Prisma, APIs, crons, memory).
 *
 * This is provider-agnostic — works with Venice, Anthropic, or any LLM.
 * No tool-calling API needed. Nick outputs JSON action blocks,
 * the agent layer executes them.
 *
 * Action Types:
 * - task.create / task.complete / task.update
 * - loop.create / loop.close
 * - commitment.create / commitment.update
 * - decision.log
 * - score.log
 * - alert.resolve
 * - memory.remember / memory.forget
 * - simulation.run
 * - person.update
 * - habit.toggle
 */

import { recordError } from "@/lib/errors/record-error";
import { feedbackLoop } from "@/lib/brain/pipeline-controller";
import {
  handleTaskCreate,
  handleTaskComplete,
  handleTaskStatus,
  handleHabitToggle,
  handleMissionPlan,
} from "@/lib/ai/agent-actions/task-actions";
import {
  handleCommitmentCreate,
  handleCommitmentUpdate,
  handleDecisionLog,
  handleAlertResolve,
} from "@/lib/ai/agent-actions/commitment-decision-actions";
import {
  handleMemoryRemember,
  handleMemoryForget,
  handleSimulationRun,
  handleMemorySearch,
} from "@/lib/ai/agent-actions/memory-actions";
import { handlePersonUpdate, handlePersonCreate } from "@/lib/ai/agent-actions/person-actions";
import {
  handleShopGetLabor,
  handleShopGetLeads,
  handleShopUpdateLead,
  handleShopGetEstimates,
  handleShopGetCustomers,
  handleShopSendSms,
  handleShopGetBookings,
  handleShopShopStatus,
  handleShopGetRevenue,
} from "@/lib/ai/agent-actions/shop-actions";
import {
  handleSystemHealth,
  handleSystemBrainStats,
  handleSystemSyncNow,
  handleSystemDeepScan,
  handleSystemClearAlerts,
  handleSystemPagePatterns,
} from "@/lib/ai/agent-actions/system-actions";
import {
  handleArsenalResearch,
  handleArsenalGmailInbox,
  handleArsenalGmailReadThread,
  handleArsenalMultiAgent,
  handleArsenalDeepResearch,
  handleArsenalPreTaskFanout,
  handleArsenalWebSearch,
  handleArsenalFindLeads,
  handleArsenalNewLeadChain,
  handleArsenalReviewResponse,
  handleArsenalCompetitorInsight,
  handleArsenalDailyBrief,
  handleArsenalGetMeetings,
  handleArsenalRunPython,
  handleArsenalBrowserCreateSession,
  handleArsenalBrowserCloseSession,
  handleArsenalBrowserNavigate,
  handleArsenalBrowserAct,
  handleArsenalBrowserExtract,
  handleArsenalBrowserObserve,
} from "@/lib/ai/agent-actions/arsenal-actions";
import {
  handleGoogleGetSchedule,
  handleGoogleProposeEvent,
  handleGmailDraftReply,
  handleGmailCreateDraft,
  handleGmailSendDraft,
  handleGoogleGetReviewStats,
  handleGoogleGetUnrespondedReviews,
  handleGoogleDraftReviewResponse,
  handleGoogleMarkReviewResponded,
} from "@/lib/ai/agent-actions/google-actions";
import {
  handleTelegramSend,
  handleCameraGetIntelligence,
  handleCameraResolveAlert,
  handleCameraGetAlerts,
  handleCameraGetPlates,
} from "@/lib/ai/agent-actions/camera-actions";

import type { AgentAction, ActionResult } from "@/lib/ai/agent-actions/types";

import { checkApprovalGate } from "@/lib/ai/runtime/approval-gate";

import { publishCockpitEvent } from "@/lib/ai/runtime/event-protocol";

// Declared in agent-actions/types.ts (the leaf contract module) and
// re-exported here so existing `from "@/lib/ai/nick-agent"` imports keep
// working. Declaring them here instead made types.ts import this file,
// which put all nine agent-action handler modules in an import cycle.
export type { AgentAction, ActionResult } from "@/lib/ai/agent-actions/types";

/**
 * Parse agent actions from Nick AI response text.
 * Nick embeds actions in ```action blocks or JSON arrays.
 */
export function parseActions(text: string): AgentAction[] {
  const actions: AgentAction[] = [];

  // Pattern 1: ```action JSON blocks
  const blockPattern = /```action\s*\n([\s\S]*?)\n```/g;
  let match;
  while ((match = blockPattern.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (Array.isArray(parsed)) actions.push(...parsed);
      else if (parsed.type) actions.push(parsed);
    } catch { /* skip malformed blocks */ }
  }

  // Pattern 2: Inline [ACTION: {...}] markers
  const inlinePattern = /\[ACTION:\s*(\{[\s\S]*?\})\]/g;
  while ((match = inlinePattern.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.type) actions.push(parsed);
    } catch { /* skip */ }
  }

  return actions;
}

/**
 * Execute a single agent action with event logging and gate checking.
 */
async function executeAction(action: AgentAction): Promise<ActionResult> {
  const { type, params } = action;
  const actionId = Math.random().toString(36).slice(2, 9);

  try {
    // Check approval gate for high-risk actions
    const gateResult = await checkApprovalGate(type, params);
    if (!gateResult.approved) {
      publishCockpitEvent({
        type: "approval.required",
        payload: {
          approvalId: gateResult.approvalId!,
          toolName: type,
          params,
          reason: "High risk action requires operator approval"
        }
      });
      return {
        action: type,
        success: false,
        error: `GATED: Operator approval required (ID: ${gateResult.approvalId})`,
        result: { approvalId: gateResult.approvalId, gated: true }
      };
    }

    publishCockpitEvent({
      type: "tool.execution_started",
      payload: { actionId, toolName: type }
    });

    const result = await executeActionWithoutTracing(action);

    if (result.success) {
      publishCockpitEvent({
        type: "tool.execution_succeeded",
        payload: { actionId, toolName: type, result: result.result }
      });
    } else {
      publishCockpitEvent({
        type: "tool.execution_failed",
        payload: { actionId, toolName: type, error: result.error || "Unknown error" }
      });
    }

    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    publishCockpitEvent({
      type: "tool.execution_failed",
      payload: { actionId, toolName: type, error: errorMsg }
    });
    return { action: type, success: false, error: errorMsg };
  }
}

/**
 * Raw action dispatcher mapping action types to domain handlers.
 */
export async function executeActionWithoutTracing(action: AgentAction): Promise<ActionResult> {
  const { type, params } = action;

  try {

    // 2026-06-02 · Structural split · the giant case-body switch was
    // decomposed into per-domain handler modules under
    // lib/ai/agent-actions/. This dispatcher delegates VERBATIM —
    // same action-type strings, same default/unknown handling, same
    // try/catch error wrapping. Each handler receives (params, type)
    // and returns the identical ActionResult the inline case produced.
    switch (type) {
      case "task.create":
      case "loop.create":
        return await handleTaskCreate(params, type);

      case "task.complete":
      case "loop.close":
        return await handleTaskComplete(params, type);

      case "task.status":
        return await handleTaskStatus(params, type);

      // ── Commitments ────────────────────────────
      case "commitment.create":
        return await handleCommitmentCreate(params, type);

      case "commitment.update":
        return await handleCommitmentUpdate(params, type);

      // ── Decisions ──────────────────────────────
      case "decision.log":
        return await handleDecisionLog(params, type);

      // ── Alerts ─────────────────────────────────
      case "alert.resolve":
        return await handleAlertResolve(params, type);

      // ── Memory ─────────────────────────────────
      case "memory.remember":
        return await handleMemoryRemember(params, type);

      case "memory.forget":
        return await handleMemoryForget(params, type);

      // ── Habits ─────────────────────────────────
      case "habit.toggle":
        return await handleHabitToggle(params, type);

      // ── Simulation ─────────────────────────────
      case "simulation.run":
        return await handleSimulationRun(params, type);

      // ── People ─────────────────────────────────
      case "person.update":
        return await handlePersonUpdate(params, type);

      case "person.create":
        return await handlePersonCreate(params, type);

      // ═══════════════════════════════════════════
      // CROSS-SYSTEM: nickstire.org actions via tRPC
      // ═══════════════════════════════════════════

      case "shop.getLabor":
        return await handleShopGetLabor(params, type);

      case "shop.getLeads":
        return await handleShopGetLeads(params, type);

      case "shop.updateLead":
        return await handleShopUpdateLead(params, type);

      case "shop.getEstimates":
        return await handleShopGetEstimates(params, type);

      case "shop.getCustomers":
        return await handleShopGetCustomers(params, type);

      case "shop.sendSms":
        return await handleShopSendSms(params, type);

      case "shop.getBookings":
        return await handleShopGetBookings(params, type);

      case "shop.shopStatus":
        return await handleShopShopStatus(params, type);

      case "shop.getRevenue":
        return await handleShopGetRevenue(params, type);

      // ── System Operator Commands (God-Mode) ──────
      case "system.health":
        return await handleSystemHealth(params, type);

      case "system.brainStats":
        return await handleSystemBrainStats(params, type);

      case "system.syncNow":
        return await handleSystemSyncNow(params, type);

      case "system.deepScan":
        return await handleSystemDeepScan(params, type);

      case "system.clearAlerts":
        return await handleSystemClearAlerts(params, type);

      case "system.pagePatterns":
        return await handleSystemPagePatterns(params, type);

      // ═══════════════════════════════════════════
      // ARSENAL: Integration chains + tools
      // ═══════════════════════════════════════════

      case "arsenal.research":
        return await handleArsenalResearch(params, type);

      case "arsenal.gmailInbox":
        return await handleArsenalGmailInbox(params, type);

      case "arsenal.gmailReadThread":
        return await handleArsenalGmailReadThread(params, type);

      case "arsenal.multiAgent":
        return await handleArsenalMultiAgent(params, type);

      case "arsenal.deepResearch":
        return await handleArsenalDeepResearch(params, type);

      case "arsenal.preTaskFanout":
        return await handleArsenalPreTaskFanout(params, type);

      case "arsenal.webSearch":
        return await handleArsenalWebSearch(params, type);

      case "arsenal.findLeads":
        return await handleArsenalFindLeads(params, type);

      case "arsenal.newLeadChain":
        return await handleArsenalNewLeadChain(params, type);

      case "arsenal.reviewResponse":
        return await handleArsenalReviewResponse(params, type);

      case "arsenal.competitorInsight":
        return await handleArsenalCompetitorInsight(params, type);

      case "arsenal.dailyBrief":
        return await handleArsenalDailyBrief(params, type);

      case "arsenal.getMeetings":
        return await handleArsenalGetMeetings(params, type);

      case "arsenal.runPython":
        return await handleArsenalRunPython(params, type);

      case "arsenal.browserCreateSession":
        return await handleArsenalBrowserCreateSession(params, type);

      case "arsenal.browserCloseSession":
        return await handleArsenalBrowserCloseSession(params, type);

      case "arsenal.browserNavigate":
        return await handleArsenalBrowserNavigate(params, type);

      case "arsenal.browserAct":
        return await handleArsenalBrowserAct(params, type);

      case "arsenal.browserExtract":
        return await handleArsenalBrowserExtract(params, type);

      case "arsenal.browserObserve":
        return await handleArsenalBrowserObserve(params, type);

      // ═══════════════════════════════════════════
      // GOOGLE INTEGRATIONS: Calendar, Gmail, Reviews
      // ═══════════════════════════════════════════

      case "google.getSchedule":
        return await handleGoogleGetSchedule(params, type);

      case "google.proposeEvent":
        return await handleGoogleProposeEvent(params, type);

      case "gmail.draftReply":
        return await handleGmailDraftReply(params, type);

      case "gmail.createDraft":
        return await handleGmailCreateDraft(params, type);

      case "gmail.sendDraft":
        return await handleGmailSendDraft(params, type);

      case "google.getReviewStats":
        return await handleGoogleGetReviewStats(params, type);

      case "google.getUnrespondedReviews":
        return await handleGoogleGetUnrespondedReviews(params, type);

      case "google.draftReviewResponse":
        return await handleGoogleDraftReviewResponse(params, type);

      case "google.markReviewResponded":
        return await handleGoogleMarkReviewResponded(params, type);

      // ═══════════════════════════════════════════
      // CAMERA: Direct camera system actions
      // ═══════════════════════════════════════════

      // ═══ MEMORY SEARCH (text-parsing fallback for Venice/Ollama) ═══
      case "memory.search":
        return await handleMemorySearch(params, type);

      // ═══ TELEGRAM PUSH ═══
      case "telegram.send":
        return await handleTelegramSend(params, type);

      // ═══ MISSION PLANNING ═══
      case "mission.plan":
        return await handleMissionPlan(params, type);

      case "camera.getIntelligence":
        return await handleCameraGetIntelligence(params, type);

      case "camera.resolveAlert":
        return await handleCameraResolveAlert(params, type);

      case "camera.getAlerts":
        return await handleCameraGetAlerts(params, type);

      case "camera.getPlates":
        return await handleCameraGetPlates(params, type);

      default:
        return { action: type, success: false, error: `Unknown action type: ${type}` };
    }
  } catch (err) {
    return { action: type, success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

// ─── Cross-System HTTP Client ────────────────────────────
// 2026-06-02 · callNickstire (+ NICKSTIRE_API / BRIDGE_KEY) moved
// VERBATIM to lib/ai/agent-actions/shop-actions.ts — the shop.*
// handlers were its only callers. No behavior change.

/**
 * Execute all parsed actions from Nick AI response.
 * Returns results for each action.
 */
export async function executeActions(actions: AgentAction[]): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  for (const action of actions.slice(0, 10)) {
    const result = await executeAction(action);
    results.push(result);

    // Circular feedback: every action feeds back into the memory system
    feedbackLoop(action.type, result.result, (JSON.stringify(action.params) ?? "{}").slice(0, 200)).catch((err) =>
      recordError("ai:agent-feedback", err, { actionType: action.type }),
    );
  }
  return results;
}

/**
 * The action catalog — tells Nick what actions are available.
 * Injected into the system prompt so Nick knows what it can DO.
 */
export const ACTION_CATALOG = `
## Nick Agent Actions — You Can DO Things, Not Just Talk

When you want to take action, embed action blocks in your response:

\`\`\`action
{ "type": "task.create", "params": { "title": "Follow up on 3 oldest leads", "priority": 1, "domain": "business", "dueDate": "2026-04-02" } }
\`\`\`

Available actions:
| Action | Params | What It Does |
|--------|--------|-------------|
| task.create | title, description?, priority(1-10)?, domain?, dueDate? | Create a task |
| task.complete | id | Mark task done |
| task.status | title | CHECK a task/habit's real status — done today? streak? last completed? Use this WHENEVER Nour asks "did I do X?", "is X done?", or "can you check?". NEVER answer that from memory — call this and report what it returns. If it returns found:false, say you don't see the task; do not assume it's done or not done. |
| loop.create | title, domain?, priority(1-5)? | Open a mental loop |
| loop.close | id | Close a loop |
| commitment.create | description, toWhom?, domain?, deadline? | Make a commitment |
| commitment.update | id, status?, notes? | Update commitment |
| decision.log | title, context?, options?, chosen?, reasoning?, stakes? | Log a decision |
| alert.resolve | id | Resolve a drift alert |
| memory.remember | category, key, content | Store a memory |
| memory.forget | id | Delete a memory |
| memory.search | query, category?, minConfidence?, limit? | Search brain memories by keyword |
| telegram.send | message, title?, urgency?(low/medium/high) | Send Nour a Telegram push notification |
| mission.plan | title, domain, priority?, successMetric?, tasks[{title, nextPhysicalAction, effort?, context?}] | Create a mission with multiple linked tasks |
| habit.toggle | habitKey (wake/exercise/business/order/shutdown) | Toggle today's habit |
| simulation.run | scenario | Run a what-if simulation |
| person.update | name, role?, relationship?, trustScore?, leverageNotes? | Update an EXISTING person (must already be in Nour's people). relationship/leverageNotes/interaction apply immediately; role + trustScore become a PENDING proposal approved on /people. Does NOT create — if the name isn't found it returns an error telling you to ask first. NEVER pass a pronoun/descriptor ("her", "the caller") as the name. |
| person.create | name, role?, relationship?, leverageNotes? | Add a NEW person to Nour's people. Use ONLY after Nour explicitly says yes to "want me to add <name>?". Requires a real proper name (never a pronoun). NEVER auto-add tire-shop callers/leads/customers — those are business contacts, not Nour's personal relationships. |

**People rule — ask before adding.** Nour's "people" are his PERSONAL relationships. Never silently add anyone. To log about someone he already has, use person.update. To add someone NEW, first ASK ("want me to add <name> to your people?") and use person.create only after he confirms. Never use a pronoun or "the caller"/"that guy" as a name, and never add tire-shop callers, leads, or customers — those live in the shop system.

### Shop Actions (cross-system — talks to nickstire.org)
| Action | Params | What It Does |
|--------|--------|-------------|
| shop.getLabor | service, year?, make?, model? | Get labor estimate from auto labor guide |
| shop.getLeads | limit? | Fetch open leads from the shop |
| shop.updateLead | id, status?, notes? | Update a lead (follow-up, close, etc) |
| shop.getEstimates | limit? | Fetch recent estimates/quotes |
| shop.getCustomers | limit?, search? | Search customer database |
| shop.sendSms | phone, message | Send SMS to a customer |
| shop.getBookings | limit? | Fetch upcoming bookings |
| shop.shopStatus | (none) | Get current shop status (open/closed, bays, queue) |
| shop.getRevenue | period? (today/week/month) | Get revenue numbers |

### Arsenal Actions (AI tools + automation chains)
| Action | Params | What It Does |
|--------|--------|-------------|
| arsenal.research | query | AI research using Grok/xAI — real-time analysis on any topic |
| arsenal.webSearch | query, recency?(day/week/month/year), allowedDomains?, blockedDomains?, tier?(sonar/sonar-pro/sonar-reasoning) | Web search via Perplexity — live internet data with citations. Use recency=day for breaking news, week for current events, month for industry shifts. Use allowedDomains=["wsj.com","bloomberg.com"] for authoritative finance, etc. tier=sonar-pro for deeper analysis. |
| arsenal.preTaskFanout | question, brainContext? | Pre-task multi-lens fan-out for HARD questions (decisions, strategy, trade-offs). Runs 3 parallel lenses (research info-needed / risk failure-modes / plan execution-sketch) and returns a composite analysis block to ground your eventual reply. Use ONLY for genuinely deep questions · costs ~3 gpt-4o-mini calls + ~2s · don't use on simple lookups. |
| arsenal.deepResearch | question | Multi-round autonomous research · plans 3-5 sub-queries, runs each via Perplexity in parallel, synthesizes a cited report (200-400 words with [N] markers + citation list). Use for due diligence, competitive analysis, lit review. ~3-5 searches + 10-15s · NOT cheap. Don't use unless the question genuinely needs cross-source synthesis. |
| arsenal.multiAgent | goal, subAgents[{name, task, outputHint?}] | Spawn N parallel sub-agents (max 8) · each tackles one focused sub-task · synthesizer composes one coherent answer. Use for tasks that decompose naturally: compare 3 competitors, audit voice across channels, draft 3 angles. ~5-8s wall time · ~$0.001-0.002/call. |
| arsenal.findLeads | titles?, locations?, industries?, limit? | Apollo.io fleet contact search — find potential customers |
| arsenal.newLeadChain | titles?, locations?, limit? | FULL CHAIN: Apollo finds leads → Grok analyzes → ClickUp task created |
| arsenal.reviewResponse | reviewerName, rating, reviewText, platform | CHAIN: Grok drafts review response → ClickUp approval task |
| arsenal.competitorInsight | competitorName, details? | CHAIN: Grok analyzes competitor → ClickUp action items |
| arsenal.dailyBrief | summary | CHAIN: Grok generates brief + tomorrow's priorities → ClickUp tasks |
| arsenal.getMeetings | limit? | Fireflies — fetch recent meeting transcripts |
| arsenal.runPython | code | Execute Python code in an isolated E2B cloud sandbox. Returns stdout, stderr, returnValue, and base64 PNG charts. |
| arsenal.browserCreateSession | keepAlive? | Create a Browserbase headless Chrome session. Returns sessionId and liveViewUrl. |
| arsenal.browserCloseSession | sessionId | Close a Browserbase session. |
| arsenal.browserNavigate | sessionId, url, waitUntil? | Navigate the browser session to a URL. |
| arsenal.browserAct | sessionId, instruction | Perform a natural-language action on the page (e.g. "click login", "type email"). |
| arsenal.browserExtract | sessionId, instruction, keys[] | Extract structured text data from the page for the list of keys provided. |
| arsenal.browserObserve | sessionId, instruction? | Find visible selectors and actionable elements on the page. |

### Google Integrations (Calendar, Gmail, Reviews)
| Action | Params | What It Does |
|--------|--------|-------------|
| google.getSchedule | daysAhead? | Fetch operator's Google Calendar schedule. |
| google.proposeEvent | title, startISO, endISO?, location?, description?, attendees[] | Schedule/propose a calendar event. Direct booking if authorized, else returns Add Event URL. |
| gmail.draftReply | threadId, body, subject? | Draft a reply in a Gmail email thread. |
| gmail.createDraft | to, subject, body | Create a new standalone Gmail draft. |
| gmail.sendDraft | draftId | Send an existing Gmail draft. |
| google.getReviewStats | (none) | Get aggregated rating stats & response counts from Google reviews. |
| google.getUnrespondedReviews | minRating?, maxRating? | List unresponded Google reviews (default ratings 1-3★). |
| google.draftReviewResponse | reviewerName, rating, reviewText, platform?, clickupListId? | Generate review response with Grok and add to ClickUp approval queue. |
| google.markReviewResponded | reviewId, responseText | Mark a review in the local database as responded. |

### Camera System (surveillance + intelligence)
| Action | Params | What It Does |
|--------|--------|-------------|
| camera.getIntelligence | (none) | Full camera intel — today's traffic, alerts, bay utilization, 7-day avg |
| camera.resolveAlert | id | Resolve a camera alert (after-hours motion, long wait, etc) |
| camera.getAlerts | limit? | Get unresolved camera alerts |
| camera.getPlates | limit? | Get recent license plate logs (IN/OUT at shop) |

### System Operator Commands (God-Mode — real system access)
| Action | Params | What It Does |
|--------|--------|-------------|
| system.health | (none) | Full system health check — DB, brain, alerts, sync status, uptime |
| system.brainStats | (none) | Brain statistics — memory count, categories, confidence, recent insights |
| system.syncNow | (none) | Trigger immediate brain cycle — cross-reference all data sources |
| system.deepScan | (none) | Comprehensive analysis — scores, loops, commitments, memories, assessment |
| system.clearAlerts | (none) | Acknowledge all pending drift alerts |
| system.pagePatterns | (none) | Analyze which pages Nour visits and blind spots |

Rules:
1. ALWAYS take action when you can. Don't just suggest — DO.
2. Create tasks for action items. Close loops when resolved.
3. Log decisions with reasoning. Remember important facts.
4. You can embed multiple action blocks in one response.
5. After taking action, briefly confirm what you did.
6. Use system.health proactively — if asked about system status, RUN the check.
7. Run system.deepScan when asked for a full assessment or "how am I doing?"
8. Run system.syncNow after major events to keep the brain synchronized.
`;
