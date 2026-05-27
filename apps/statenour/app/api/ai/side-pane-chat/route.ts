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
    case "tasks":
      return "You're advising on the operator's daily task surface · what to focus on, what's stuck, what compounds.";
    case "goals":
      return "You're advising on the operator's 8-axis mastery + goal portfolio · pace, drift, leverage moves.";
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
- No "Great question" or "Based on the data" openers · just answer`;

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
