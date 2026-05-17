"use client";

/**
 * useAdaptivePlaceholder — rotates the input placeholder based on
 * current self-model state. Replaces the static "Message Nick…"
 * with a live signal so the input itself is informational.
 *
 * Pulls from /api/brain/maturity (which already rolls up skills,
 * identity, beliefs, contradictions, ghost). Chooses the sharpest
 * axis / count and crafts a one-line nudge.
 *
 * Example rotations:
 *   "Message Nick… 3 contradictions open"
 *   "Message Nick… 2 overdue promises"
 *   "Message Nick… velocity is rising ↑"
 *   "Message Nick…" (silent default)
 */

import { useEffect, useRef, useState } from "react";

import { authedFetch } from "@/hooks/use-authed-fetch";
interface MaturityShape {
  score?: number;
  components?: {
    contradictions?: { open: number };
    skills?: { active: number; pending: number };
    identity?: { axes_filled: number };
    beliefs?: { active: number; candidates: number };
  };
}

export function useAdaptivePlaceholder(): string {
  const [placeholder, setPlaceholder] = useState("Message Nick…");
  // v10.0.116 audit fix · pin the quiet-rotation index to a single
  // value per mount so StrictMode's double-effect (dev) and any
  // remount don't swap the placeholder visibly. The random pick
  // happens once when the ref first initializes.
  const quietIdxRef = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // v7 · BATCH 2G · Apr 28 — Multi-source placeholder. Pulls in
        // priority order:
        //   1. Lead escalation (most urgent — outranks everything)
        //   2. Hallucination flags (recent — Nick made up a stat)
        //   3. Maturity contradictions / skills / beliefs (existing)
        //   4. Top-performer score reference (positive nudge)
        //   5. Industry intel headline (always-on intel)
        //   6. Quiet rotation (nothing pressing)
        const [maturityRes, intelRes, escalationsRes] = await Promise.all([
          authedFetch("/api/brain/maturity").catch(() => null),
          authedFetch("/api/intel").catch(() => null),
          authedFetch("/api/brain/escalations").catch(() => null),
        ]);

        let escalation: { content: string } | null = null;
        if (escalationsRes?.ok) {
          const ej = await escalationsRes.json().catch(() => null);
          escalation = ej?.escalation ?? null;
        }
        if (escalation && alive) {
          // Truncate aggressively so it fits in composer
          const short = escalation.content.replace(/^🔴\s*/, "").slice(0, 32);
          setPlaceholder(`🔴 ${short}…`);
          return;
        }

        // Maturity (existing logic)
        if (maturityRes?.ok) {
          const raw = (await maturityRes.json()) as { data?: { maturity?: MaturityShape } };
          const m = raw.data?.maturity;
          if (m && alive) {
            const open = m.components?.contradictions?.open ?? 0;
            const pendingSkills = m.components?.skills?.pending ?? 0;
            const pendingBeliefs = m.components?.beliefs?.candidates ?? 0;
            const score = m.score ?? 0;
            if (open > 0) {
              setPlaceholder(`Message Nick… ${open} contradiction${open > 1 ? "s" : ""}`);
              return;
            } else if (pendingSkills >= 3) {
              setPlaceholder(`Message Nick… ${pendingSkills} skills to review`);
              return;
            } else if (pendingBeliefs >= 3) {
              setPlaceholder(`Message Nick… ${pendingBeliefs} beliefs to curate`);
              return;
            } else if (score >= 75) {
              setPlaceholder(`Message Nick… maturity ${score}/100 🔥`);
              return;
            }
          }
        }

        // Intel-aware nudges (BATCH 2G upgrade)
        if (intelRes?.ok) {
          const intel = (await intelRes.json()) as {
            performers?: Array<{ score?: number; platform?: string }>;
            industry?: Array<{ title?: string; category?: string }>;
          };
          if (alive) {
            const topPerformer = intel.performers?.[0];
            const recentIndustry = intel.industry?.[0];
            if (topPerformer?.score && topPerformer.score >= 250) {
              setPlaceholder(`Message Nick… top post hit ${topPerformer.score} 🔥`);
              return;
            }
            if (recentIndustry?.title) {
              // v7.4 · Apr 29 · Trimmed 30 → 18 chars. The intel
              // headline was wrapping the textarea to 5 lines on
              // mobile, eating half the viewport.
              const truncated = recentIndustry.title.slice(0, 18);
              setPlaceholder(`Message Nick… ${truncated}…`);
              return;
            }
          }
        }

        // Quiet rotation
        const quiet = [
          "Message Nick…",
          "Message Nick… ask anything",
          "Message Nick… capture a thought",
          "Message Nick… /brain to see all",
          "Message Nick… /plan for today",
          "Message Nick… /intel for trends",
        ];
        if (quietIdxRef.current === null) {
          quietIdxRef.current = Math.floor(Math.random() * quiet.length);
        }
        if (alive) setPlaceholder(quiet[quietIdxRef.current]);
      } catch {
        // swallow — stays on default
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  return placeholder;
}
