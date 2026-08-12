/**
 * NICK VNEXT · JIT section gate (2026-08-12) — the evidence-mandated
 * successor to the rejected bare compact cut.
 *
 * The prompt A/Bs answered both directions: the census hit-list
 * sections (ACTIVE AGENDA · Behavioral patterns · Processing intake,
 * ~9.2K chars) EARN their tokens on context-grounded turns (the bigger
 * run reversed to incumbent 4-1-9 exactly on memory/comms/decision
 * asks) and DON'T on casual + content turns (the only cases compact
 * ever won). So: drop them exactly there, keep them everywhere else.
 *
 * Pure post-assembly transform on the trimmer's own `\n## ` boundary —
 * the same mechanical splitter the A/B used, so what ships is what was
 * measured. The content trigger is deliberately SOCIAL-content only
 * (instagram/carousel/reel/caption...), NOT the generic
 * detectContentIntentSync: that detector also flags customer-comms
 * drafts, and the A/B's comms-1 (SMS draft) went to the FULL prompt —
 * only the social-content cases ever favored the cut. Unknown / empty
 * messages keep everything (fail-open toward context).
 * Kill-switch: NICK_JIT_SECTIONS=0.
 */
import { detectQueryShape } from "@/lib/ai/query-shape";

const SOCIAL_CONTENT_RE =
  /\b(instagram|carousel|reels?|tiktok|social (post|content)|content (plan|calendar|strategy)|captions?|hashtags?|ig post)\b/i;

export const JIT_SECTION_PREFIXES = [
  "## ACTIVE AGENDA ITEMS",
  "## Behavioral patterns",
  "## Processing intake",
] as const;

export interface JitGateResult {
  prompt: string;
  dropped: string[];
  reason: "casual" | "content" | null;
}

export function applyJitSectionGate(
  prompt: string,
  userMessage: string | null | undefined,
): JitGateResult {
  if (process.env.NICK_JIT_SECTIONS === "0") return { prompt, dropped: [], reason: null };
  const msg = (userMessage ?? "").trim();
  if (!msg) return { prompt, dropped: [], reason: null };

  const casual = detectQueryShape(msg).shape === "casual";
  const content = !casual && SOCIAL_CONTENT_RE.test(msg);
  if (!casual && !content) return { prompt, dropped: [], reason: null };

  const parts = prompt.split(/\n(?=## )/g);
  const dropped: string[] = [];
  const kept = parts.filter((p) => {
    const hit = JIT_SECTION_PREFIXES.find((prefix) => p.startsWith(prefix));
    if (hit) {
      dropped.push(hit);
      return false;
    }
    return true;
  });
  if (dropped.length === 0) return { prompt, dropped: [], reason: null };
  return { prompt: kept.join("\n"), dropped, reason: casual ? "casual" : "content" };
}
