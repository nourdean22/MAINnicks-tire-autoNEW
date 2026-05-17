import { buildSystemPrompt } from "@/lib/ai/system-prompt";
import { getCachedPrompt, setCachedPrompt } from "@/lib/ai/system-prompt-cache";
import { getActiveProviderInfo } from "@/lib/ai/provider";
import { detectChatMode } from "@/lib/ai/chat-mode";
import { prefetchIntents } from "@/lib/ai/predictive-prefetch";
import { requireSession } from "@/lib/auth-guard";
import {
  warmToolEmbeddings,
  isToolEmbeddingCacheWarm,
} from "@/lib/ai/tool-embeddings";

export const maxDuration = 30;

// Server-side rate limit — the client hook already rate-limits to 2s
// but that's client-trust. This guards the lambda from a stuck or
// malicious tab hammering the endpoint.
const RATE_LIMIT_WINDOW_MS = 1_500;
const DUPE_WINDOW_MS = 2_500;
const recentFires = new Map<string, number>();
const recentDrafts = new Map<string, number>();

function shouldRateLimit(key: string): boolean {
  const now = Date.now();
  const last = recentFires.get(key) || 0;
  if (now - last < RATE_LIMIT_WINDOW_MS) return true;
  recentFires.set(key, now);
  // GC old entries
  if (recentFires.size > 200) {
    for (const [k, t] of recentFires.entries()) {
      if (now - t > 10 * RATE_LIMIT_WINDOW_MS) recentFires.delete(k);
    }
  }
  return false;
}

function isDuplicateDraft(draftHash: string): boolean {
  const now = Date.now();
  const last = recentDrafts.get(draftHash) || 0;
  if (now - last < DUPE_WINDOW_MS) return true;
  recentDrafts.set(draftHash, now);
  if (recentDrafts.size > 500) {
    for (const [k, t] of recentDrafts.entries()) {
      if (now - t > 10 * DUPE_WINDOW_MS) recentDrafts.delete(k);
    }
  }
  return false;
}

function hashDraft(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return String(h);
}

/**
 * POST /api/ai/chat/prefetch
 *
 * Speculative warm-up endpoint the chat UI calls while the user is
 * still typing. The client debounces keystrokes (300ms) and fires
 * this with the current draft text. The server:
 *
 *   1. Warms the system prompt cache if it's not already warm
 *   2. Runs predictive prefetch based on the draft (populates any
 *      downstream DB query caches + serializes the result shape)
 *   3. Detects the likely chat mode so the client can show a status
 *      indicator ("Checking data..." for standard, "Thinking..." for
 *      deep)
 *
 * By the time the user actually hits send, the prompt cache is warm
 * and the Prisma query pages are in memory, so the real /api/ai/chat
 * call gets a head start.
 *
 * This endpoint does NOT call Venice — it's pure warmup. Worst-case
 * latency is a few hundred ms of DB queries the real request would
 * have done anyway.
 *
 * Body shape: { draft: string }
 */
export async function POST(req: Request) {
  await requireSession(req);
  try {
    const body = (await req.json()) as { draft?: string };
    const draft = (body?.draft || "").trim();

    if (draft.length < 3) {
      return Response.json({ ok: true, warmed: false, reason: "too_short" });
    }

    // Rate limit — Apr 20 fix. Client may provide X-Prefetch-Client-Id
    // (generated once per tab in sessionStorage). Falls back to IP+UA.
    // Previously two Nours on same WiFi (desktop + phone) with the
    // same browser UA cancelled each other out. Client-id fixes that.
    const clientId =
      req.headers.get("x-prefetch-client-id") ||
      req.headers.get("x-nick-client-id");
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const ua = req.headers.get("user-agent")?.slice(0, 64) || "unknown";
    const rateKey = clientId ? `cid::${clientId}` : `ipua::${ip}::${ua}`;
    if (shouldRateLimit(rateKey)) {
      return Response.json({ ok: true, warmed: false, reason: "rate_limited" });
    }

    // Draft dedupe — keyed by (clientId | ipua) + draft hash. Two
    // different devices typing the same draft each get their own
    // warmup; one device re-firing the same draft within 2.5s gets
    // the dedupe short-circuit.
    const draftHash = hashDraft(draft);
    const dupeKey = `${rateKey}::${draftHash}`;
    if (isDuplicateDraft(dupeKey)) {
      return Response.json({ ok: true, warmed: false, reason: "duplicate_draft" });
    }

    const { provider } = getActiveProviderInfo();
    const t0 = Date.now();

    // Warm the system prompt cache if cold. Prefetch always builds the
    // full-tier prompt so the user's first real message — whatever tier
    // it ends up being — at worst pays for the lighter tier-specific
    // build, never the full one. Apr 26 cache key includes tier so the
    // "full" entry won't accidentally serve a "core" request.
    const cached = getCachedPrompt(provider, "full");
    let promptWarmed = !!cached;
    if (!cached) {
      try {
        const prompt = await buildSystemPrompt();
        setCachedPrompt(provider, "full", prompt);
        promptWarmed = true;
      } catch {
        promptWarmed = false;
      }
    }

    // Detect the likely mode from the draft (even partial input gives
    // decent signal: "what's my" → standard, "hey" → quick)
    const mode = detectChatMode(draft, 0);

    // Run predictive prefetch for standard/deep mode only. The results
    // are thrown away — we're just warming Prisma's query plan cache
    // and letting Vercel's lambda load any imports needed for the real
    // request.
    let prefetchHits = 0;
    if (draft.length >= 8) {
      try {
        const results = await prefetchIntents(draft);
        prefetchHits = results.length;
      } catch {}
    }

    // Kick off tool embedding warm-up in the background (no await).
    // By the time Nour finishes typing, the semantic tool pruning
    // cache should be hot for the real /api/ai/chat request.
    if (!isToolEmbeddingCacheWarm()) {
      warmToolEmbeddings().catch(() => {});
    }

    return Response.json({
      ok: true,
      warmed: promptWarmed,
      mode,
      prefetchHits,
      toolEmbeddings: isToolEmbeddingCacheWarm() ? "warm" : "warming",
      durationMs: Date.now() - t0,
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
