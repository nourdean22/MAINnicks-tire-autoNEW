/**
 * POST /api/ai/side-pane-chat
 *
 * Streaming multi-turn endpoint for the NickSidePane multi-turn chat
 * surface (Phase 5 FULL · /tasks v2.2 redesign · 2026-05-26).
 *
 * Sibling of /api/ai/page-insight (single-shot Q&A). This route accepts
 * a full message history + a new user turn, streams Nick's response as
 * the next turn. Stateless server-side · the client owns the thread
 * state (and persists per-page via localStorage).
 *
 * Why a parallel endpoint instead of extending page-insight:
 *   - Isolated risk · existing PageNick callers stay byte-identical
 *   - Different cadence · multi-turn calls maintain context across
 *     turns · single-shot is fire-and-forget
 *   - Different prompt shape · multi-turn injects prior assistant
 *     turns as actual `assistant` messages (cache-aware), single-shot
 *     stuffs context into the system block
 *
 * The system prompt + page-data + lens + operator-state injection
 * mirrors page-insight so Nick's voice + frameworks + state-awareness
 * stay consistent across both surfaces.
 *
 * Auth: same as page-insight (requireSession + checkAiRateLimit).
 */

import { streamText } from "ai";
import { requireSession } from "@/lib/auth-guard";
import { checkAiRateLimit } from "@/lib/rate-limit";
import { getActiveProviderInfo, getModel } from "@/lib/ai/provider";
import { buildSystemPrompt } from "@/lib/ai/system-prompt";
import { getCachedPrompt, setCachedPrompt } from "@/lib/ai/system-prompt-cache";
import { buildPageData } from "@/lib/ai/page-data";
import { mintTraceId, recordTrace } from "@/lib/ai/agent-trace";
import { recordError } from "@/lib/errors/record-error";

export const maxDuration = 60;

/** Page-specific framing · inlined from page-insight's local helper.
 *  Kept here so the two surfaces can diverge their framings independently
 *  if multi-turn needs different scaffolding from single-shot. */
function describeFraming(page: string): string {
  switch (page) {
    // 2026-07-16 · the /missions page mounts page="missions" — it hit the
    // generic default here while buildPageData had no case at all, so the
    // pane got neither framing nor data on the operator's primary surface.
    case "missions":
      return (
        "You're advising on the operator's mission board — the surface he executes from daily. " +
        "The data block lists each active mission with its open count, completions this week, stall age, deadline, and top next action. " +
        "Answer at MISSION level first (which one to push, which is stalling, what compounds), then name the single specific task to start. " +
        "A mission marked STALLED or OVERDUE outranks a comfortable one — say so plainly."
      );
    case "tasks":
      return "You're advising on the operator's daily task surface · what to focus on, what's stuck, what compounds.";
    case "goals":
      // MASTERY_COACHING_LENS · 2026-05-30. /stats mounts NickSidePane with
      // page="goals" — this is the operator's character-sheet + goal surface,
      // so COACH it (identity-mirror + loss-aversion), don't give generic
      // advice. Cap-safe: this framing lands in the route's LOCAL
      // enrichedSystem (appended after the cached base prompt), never the 60K
      // main system prompt.
      return (
        "You're COACHING the operator's mastery character sheet (33 stats / 4 branches · RPG levels) + goal portfolio. " +
        "Mirror identity, don't motivate: speak to him as the man who already levels up — 'you're someone who closes the gap', not 'you should'. " +
        "Lead with the loss-aversion edge — name the level or streak at risk and the single highest-leverage rep that protects it (the 'next rep' the board surfaces). " +
        "Then the goal furthest behind pace. Numbers and the one move, never a pep talk."
      );
    case "journal":
      return "You're advising on the operator's reflective writing surface · patterns, threads, blind spots.";
    case "brain":
      return "You're advising on the operator's brain memory + identity layer · what's known, what's forming.";
    case "scoreboard":
      return "You're advising on the operator's business + operator-state numbers · KPIs, anomalies, what to act on.";
    default:
      return `You're advising on the operator's ${page} surface.`;
  }
}

/** JSON stringify with safe truncation for prompt-budget control. */
function safeStringify(data: unknown, maxChars = 8000): string {
  try {
    const json = JSON.stringify(data, null, 2);
    if (json.length <= maxChars) return json;
    return `${json.slice(0, maxChars)}\n... [truncated · ${json.length - maxChars} more chars]`;
  } catch {
    return "(unserializable)";
  }
}

interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: Request) {
  await requireSession(req);
  const limit = checkAiRateLimit(req);
  if (limit) return limit;

  try {
    const body = (await req.json()) as {
      page?: string;
      focus?: string;
      data?: unknown;
      messages?: IncomingMessage[];
    };

    if (!body.page) {
      return Response.json({ error: "page required" }, { status: 400 });
    }
    const history = (body.messages ?? []).filter(
      (m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"),
    );
    if (history.length === 0) {
      return Response.json({ error: "messages required (at least 1 user turn)" }, { status: 400 });
    }
    // Cap history to last 12 turns to bound prompt size · rest gets
    // implicit context via system prompt's page framing. Operator who
    // wants a fresh thread can hit the Clear button.
    const recentHistory = history.slice(-12);

    const { provider, modelId } = getActiveProviderInfo();
    void modelId;

    // Build the system prompt with Nick's identity (cached) + page
    // framing + page data + optional lens + operator-state injection.
    // Same shape as page-insight so the two surfaces produce consistent
    // voice when operator switches between them.
    let systemPrompt = getCachedPrompt(provider, "full");
    if (!systemPrompt) {
      try {
        systemPrompt = await buildSystemPrompt();
        setCachedPrompt(provider, "full", systemPrompt);
      } catch {
        systemPrompt = `You are Nick, Nour's Chief of Staff. Today is ${new Date().toISOString().slice(0, 10)}. Respond with data-first analysis, one concrete action, no fluff.`;
      }
    }

    const framing = describeFraming(body.page);
    let dataBlock: string;
    if (body.data !== undefined && body.data !== null) {
      dataBlock = safeStringify(body.data);
    } else {
      const serverData = await buildPageData(body.page).catch(() => "");
      dataBlock = serverData || "(no structured data available)";
    }

    // Strategic Frameworks lens block (same as page-insight).
    let lensBlock = "";
    try {
      const { composeStrategicLensBlock, pickFrameworks } = await import("@/lib/ai/strategic-frameworks");
      const { recordLensFire } = await import("@/lib/ai/strategic-frameworks/record-lens-fire");
      const lensInput = `${body.page} · ${body.focus ?? ""} · ${dataBlock}`.slice(0, 1200);
      lensBlock = composeStrategicLensBlock(lensInput);
      if (lensBlock) {
        const matches = pickFrameworks(lensInput);
        recordLensFire({
          surface: "side-pane-chat",
          matches,
          lensBlockLength: lensBlock.length,
          metadata: { page: body.page },
        });
      }
    } catch {
      /* best-effort · lens injection failures shouldn't break the call */
    }

    // Operator-state injection · only when confidence > 0.
    let stateBlock = "";
    try {
      const { currentOperatorState, formatOperatorStateBlock } = await import(
        "@/lib/services/operator-state"
      );
      const snap = await currentOperatorState();
      if (snap.confidence > 0) stateBlock = formatOperatorStateBlock(snap);
    } catch {
      /* best-effort */
    }

    const enrichedSystem = `${systemPrompt}${lensBlock ? `\n\n${lensBlock}` : ""}${stateBlock ? `\n\n${stateBlock}` : ""}

# SIDE PANE CHAT MODE — ${body.page}
${framing}

## Current page data:
\`\`\`json
${dataBlock}
\`\`\`

${body.focus ? `## Focus: ${body.focus}\n` : ""}

Rules for this conversation:
- Multi-turn · use prior assistant turns as context · don't restart each reply
- Operator-grade tone · direct · numbers > adjectives · one action per reply
- Keep each reply under 180 words unless operator asks for depth
- No "Great question" or "Based on the data" openers · just answer

## CRITICAL · READ-ONLY · NO ACTIONS POSSIBLE
This side pane is a READ-ONLY analysis surface. You have ZERO tools enabled here ·
no createTask · no addTasksToProject · no DB writes · no API calls · no SMS · no email ·
NO ACTIONS WHATSOEVER. The operator's surface is in front of them · they own all writes.

When the operator asks you to CREATE / ADD / UPDATE / DELETE / SEND anything:
- NEVER claim you did it. NEVER say "I've added", "I've created", "I've sent", "Done", "Updated".
- That phrasing is a LIE here · you literally cannot. The trust cost is enormous.
- Instead · draft the concrete next-action wording + tell the operator EXACTLY where to
  tap to execute it themselves. Examples:
    · "Tap '+ NEW MISSION' top-left then enter: 'Nick's Tire hiring · yard signs'"
    · "Open the mission → tap '+ task' → paste this title: '<exact title>'"
    · "Open /missions/{missionId} → tap edit pencil on the task row to mark DONE"

Your job in this pane is ADVISORY · surface the move + the operator decides + the operator acts.
If the operator says "do it" / "add them" / "go ahead" · respond with the precise tap-path,
not a fabricated confirmation.`;

    const model = getModel("reason");
    const traceId = mintTraceId();
    const startedAt = Date.now();
    const inputChars = recentHistory.reduce((acc, m) => acc + m.content.length, 0);

    const result = streamText({
      model,
      messages: [
        {
          role: "system",
          content: enrichedSystem,
          providerOptions: {
            anthropic: { cacheControl: { type: "ephemeral" } },
          },
        },
        ...recentHistory.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      ],
      maxOutputTokens: 500,
      onFinish: async ({ text }) => {
        if (!text || text.trim().length === 0) {
          recordError(
            "chat:stream",
            new Error(`side-pane-chat empty for page=${body.page}`),
            { page: body.page },
          );
        }
        void recordTrace(
          {
            traceId,
            source: "chat",
            label: "side-pane-chat",
            provider,
            model: modelId,
            inputChars,
            metadata: {
              page: body.page,
              turnCount: recentHistory.length,
              focus: body.focus ?? null,
            },
          },
          {
            durationMs: Date.now() - startedAt,
            outputChars: text?.length ?? 0,
          },
        );
      },
    });

    return result.toTextStreamResponse();
  } catch (err) {
    recordError("api:unknown", err, { route: "ai/side-pane-chat" });
    return Response.json({ error: "side-pane chat failed" }, { status: 500 });
  }
}
