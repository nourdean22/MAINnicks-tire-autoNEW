"use client";

/**
 * useAdaptivePlaceholder — rotates the input placeholder based on
 * current self-model state. Replaces the static "Message Nick…"
 * with a live signal so the input itself is informational.
 *
 * Pulls brain maturity (skills, identity, beliefs, contradictions,
 * ghost), the latest lead escalation, and automotive industry intel.
 * Chooses the sharpest axis / count and crafts a one-line nudge.
 *
 * Example rotations:
 *   "Message Nick… 3 contradictions open"
 *   "Message Nick… 2 overdue promises"
 *   "Message Nick… velocity is rising ↑"
 *   "Message Nick…" (silent default)
 *
 * Cross-domain residuals slice (2026-05-22) · migrated off the
 * `Promise.all([authedFetch ×3])` (/api/brain/maturity · /api/intel ·
 * /api/brain/escalations) onto `trpc.brain.{maturity,industryIntel,
 * escalations}`. The reads fire imperatively via `utils.*.fetch()` —
 * the placeholder is computed once on mount, not a render-time query.
 * Per the migration roadmap's TS2589 note, a `Promise.all` of multiple
 * `utils.*.fetch()` calls trips TS2589 via tuple inference, so the
 * three promises are fired into consts and `await`-ed individually.
 *
 * The pre-fix code read `raw.data?.maturity` / `intel.performers` off
 * the legacy REST envelopes — `brain.maturity` returns the maturity
 * object directly, and `industryIntel` no longer carries `performers`
 * (the /intel route dropped that field at v7), so that dead branch is
 * gone.
 */

import { useEffect, useRef, useState } from "react";

import { trpc } from "@/lib/trpc/client";

export function useAdaptivePlaceholder(): string {
  const [placeholder, setPlaceholder] = useState("Message Nick…");
  // v10.0.116 audit fix · pin the quiet-rotation index to a single
  // value per mount so StrictMode's double-effect (dev) and any
  // remount don't swap the placeholder visibly. The random pick
  // happens once when the ref first initializes.
  const quietIdxRef = useRef<number | null>(null);
  const utils = trpc.useUtils();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // v7 · BATCH 2G · Apr 28 — Multi-source placeholder. Pulls in
        // priority order:
        //   1. Lead escalation (most urgent — outranks everything)
        //   2. Maturity contradictions / skills / beliefs
        //   3. Industry intel headline (always-on intel)
        //   4. Quiet rotation (nothing pressing)
        //
        // The three reads fire as separate promises (NOT Promise.all of
        // utils.*.fetch — that trips TS2589 via tuple inference) then
        // each is awaited individually. Each is independently fail-soft.
        const maturityPromise = utils.brain.maturity
          .fetch()
          .catch(() => null);
        const intelPromise = utils.brain.industryIntel
          .fetch()
          .catch(() => null);
        const escalationsPromise = utils.brain.escalations
          .fetch()
          .catch(() => null);

        const escalationsRes = await escalationsPromise;
        const escalation = escalationsRes?.escalation ?? null;
        if (escalation && alive) {
          // Truncate aggressively so it fits in composer.
          const short = escalation.content.replace(/^🔴\s*/, "").slice(0, 32);
          setPlaceholder(`🔴 ${short}…`);
          return;
        }

        // Maturity (existing logic) · `brain.maturity` returns the
        // maturity rollup object directly.
        const m = await maturityPromise;
        if (m && alive) {
          const open = m.components?.contradictions?.open ?? 0;
          const pendingSkills = m.components?.skills?.pending ?? 0;
          const pendingBeliefs = m.components?.beliefs?.candidates ?? 0;
          const score = m.score ?? 0;
          if (open > 0) {
            setPlaceholder(
              `Message Nick… ${open} contradiction${open > 1 ? "s" : ""}`,
            );
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

        // Intel-aware nudge (BATCH 2G upgrade).
        const intel = await intelPromise;
        if (intel && alive) {
          const recentIndustry = intel.industry?.[0];
          if (recentIndustry?.title) {
            // v7.4 · Apr 29 · Trimmed 30 → 18 chars. The intel
            // headline was wrapping the textarea to 5 lines on
            // mobile, eating half the viewport.
            const truncated = recentIndustry.title.slice(0, 18);
            setPlaceholder(`Message Nick… ${truncated}…`);
            return;
          }
        }

        // Quiet rotation.
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
  }, [utils]);

  return placeholder;
}
