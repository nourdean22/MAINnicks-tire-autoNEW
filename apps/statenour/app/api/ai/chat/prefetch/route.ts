import { requireSession } from "@/lib/auth-guard";
import { runChatPrefetch } from "@/lib/services/chat-prefetch";

export const maxDuration = 30;

/**
 * POST /api/ai/chat/prefetch
 *
 * Speculative warm-up endpoint the chat UI calls while the user is
 * still typing. The server warms the system-prompt cache, runs
 * predictive prefetch, and detects the likely chat mode so the real
 * /api/ai/chat call gets a head start. NEVER calls Venice.
 *
 * hooks-lib REST→tRPC slice (2026-05-22) · the warm-up logic (the
 * per-client rate-limit + draft-dedupe + prompt-cache warm + predictive
 * prefetch + tool-embedding warm) moved verbatim to
 * `lib/services/chat-prefetch.runChatPrefetch` so the legacy REST
 * consumer AND the new `chat.prefetch` tRPC mutation can't drift.
 * `useChatPrefetch` + `useIdleWarmup` now fire tRPC; this route stays
 * mounted as the coexistence / rollback path.
 *
 * Body shape: { draft: string }
 */
export async function POST(req: Request) {
  await requireSession(req);
  try {
    const body = (await req.json()) as { draft?: string };
    // The client may provide X-Prefetch-Client-Id (generated once per
    // tab in sessionStorage) so two devices typing the same draft each
    // get their own warmup.
    const clientId =
      req.headers.get("x-prefetch-client-id") ||
      req.headers.get("x-nick-client-id");
    const result = await runChatPrefetch({
      draft: body?.draft || "",
      clientId,
    });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}
