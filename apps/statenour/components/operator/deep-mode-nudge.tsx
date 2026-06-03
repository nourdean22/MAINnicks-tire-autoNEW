"use client";

/**
 * DeepModeNudge · Phase H.2 (2026-05-18 PM)
 *
 * Non-invasive global hint. Watches the currently-focused textarea /
 * input on the page. When its value matches the reasoning classifier
 * at tier ≥ deep, surfaces a tiny floating chip near the input
 * that one-taps the operator into /reason pre-filled.
 *
 * Lives in the (mastery) layout so it monitors every page that
 * inherits the layout (chat, tasks, journal, etc). Self-hides when
 * no focused input matches OR when verdict is below the threshold.
 *
 * Why this exists · the chat page is 2k+ lines and modifying its
 * textarea directly is risky. This sits OUTSIDE the page-specific
 * components and just listens to document events · zero coupling.
 *
 * Aesthetic · gold chip · pinned bottom-right · slides in/out · only
 * appears when value ≥ 30 chars AND classifier returns deep+.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
// H.4.1 · single source of truth · classifier-core is isomorphic
// (no Node-only deps · safe in client bundle). Pre-H.4 we had
// parallel regex arrays here + server-side that drifted.
import { classifyCore } from "@/lib/ai/reasoning/classifier-core";
import type { ReasoningTier } from "@/lib/ai/reasoning/types";

/** Only surface the chip for tiers worth interrupting the operator for.
 *  Standard tier matches plenty of normal prose · the chip would feel
 *  too aggressive. We surface deep / thorough / mega only. */
function shouldNudge(tier: ReasoningTier): boolean {
  return tier === "deep" || tier === "thorough" || tier === "mega";
}

export function DeepModeNudge() {
  const router = useRouter();
  const [verdict, setVerdict] = useState<{
    tier: ReasoningTier;
    text: string;
  } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let raf = 0;
    const evaluate = () => {
      const el = document.activeElement;
      if (!el) {
        setVerdict(null);
        return;
      }
      const tag = el.tagName;
      const htmlEl = el as HTMLElement;
      // H.7.5 · accept TEXTAREA + INPUT + contentEditable elements
      // (rich text editors that don't use a textarea · operator
      // could be drafting deep thoughts there too).
      const isEditable =
        tag === "TEXTAREA" || tag === "INPUT" || htmlEl.isContentEditable;
      if (!isEditable) {
        setVerdict(null);
        return;
      }
      // H.3.1 · respect any ancestor with [data-no-deep-nudge]. This lets
      // high-noise surfaces (journal entries, quick-add bars, search
      // boxes) opt out without the nudge needing to know about them.
      // Walks up the DOM tree from the focused element to find an
      // ancestor with the attribute · zero coupling to specific pages.
      if (htmlEl.closest("[data-no-deep-nudge]")) {
        setVerdict(null);
        return;
      }
      // Input type allowlist · keep passwords/emails/numbers out
      if (tag === "INPUT") {
        const t = (htmlEl as HTMLInputElement).type;
        if (t && !["text", "search", "url", ""].includes(t)) {
          setVerdict(null);
          return;
        }
      }
      // H.7.5 · extract value · .value for inputs/textareas, textContent
      // for contentEditable. Cap at 4k chars so a massive Notion-style
      // editor doesn't blow the classifier regex pass.
      const rawValue =
        tag === "TEXTAREA" || tag === "INPUT"
          ? (htmlEl as HTMLInputElement | HTMLTextAreaElement).value
          : (htmlEl.textContent ?? "");
      const value = (rawValue ?? "").slice(0, 4000);
      // H.4.1 · use the shared classifier · same verdict the server uses
      const v = classifyCore(value);
      if (shouldNudge(v.tier)) {
        setVerdict({ tier: v.tier, text: value });
      } else {
        setVerdict(null);
      }
    };
    const onInputOrFocus = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(evaluate);
    };
    const onBlur = () => {
      // Delay so a click on the chip itself isn't lost when focus moves.
      setTimeout(() => {
        const el = document.activeElement;
        if (
          el &&
          (el.tagName === "TEXTAREA" ||
            el.tagName === "INPUT" ||
            (el as HTMLElement).isContentEditable)
        ) {
          return;
        }
        setVerdict(null);
      }, 200);
    };
    document.addEventListener("input", onInputOrFocus, true);
    document.addEventListener("focusin", onInputOrFocus, true);
    document.addEventListener("focusout", onBlur, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("input", onInputOrFocus, true);
      document.removeEventListener("focusin", onInputOrFocus, true);
      document.removeEventListener("focusout", onBlur, true);
    };
  }, []);

  if (!verdict) return null;

  return (
    <button
      type="button"
      onClick={() => {
        router.push(`/brain?tab=reason&q=${encodeURIComponent(verdict.text)}`);
      }}
      className="fixed bottom-4 right-4 z-50 inline-flex items-center gap-2 px-3 py-2 rounded-full border border-[var(--gold)]/40 bg-black/80 backdrop-blur text-[var(--gold)] text-[11px] font-mono uppercase tracking-[0.14em] shadow-lg hover:bg-[var(--gold)]/[0.1] transition"
      title={`Classifier sees this as ${verdict.tier}-tier. Click to send to Nick's reasoning engine.`}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full bg-[var(--gold)] shadow-[0_0_0_3px_rgba(253,185,19,0.25)]"
      />
      deep mode · {verdict.tier} →
    </button>
  );
}
