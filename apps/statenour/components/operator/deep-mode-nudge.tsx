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

type ReasoningTier = "quick" | "standard" | "deep" | "thorough" | "mega";

// Mirrors lib/ai/reasoning/classifier.ts heuristics · keep in sync.
// (We avoid importing the server module here · client-side classifier
// keeps the bundle lean.)
const DEEP_MARKERS = [
  /\bstrategy\b/i,
  /\bstrategic\b/i,
  /\bbusiness plan\b/i,
  /\binvestment\b/i,
  /\barchitect/i,
  /\bdeep think\b/i,
  /\bthink deeply\b/i,
  /\b\/deep\b/i,
  /\b@deep\b/i,
];

const THOROUGH_MARKERS = [
  /\bdue diligence\b/i,
  /\bcomprehensive\b/i,
  /\bresearch (the|this|that|all|every)\b/i,
  /\bdeep dive\b/i,
  /\bthorough/i,
  /\b\/thorough\b/i,
  /\b@thorough\b/i,
  /\b\/research\b/i,
];

const MEGA_MARKERS = [
  /\b\/mega\b/i,
  /\b@mega\b/i,
  /\bbiggest hammer\b/i,
  /\bcharizard\b/i,
];

function quickClassify(text: string): { tier: ReasoningTier; matched: boolean } {
  const t = text.trim();
  if (t.length < 30) return { tier: "quick", matched: false };
  if (MEGA_MARKERS.some((re) => re.test(t))) return { tier: "mega", matched: true };
  if (THOROUGH_MARKERS.some((re) => re.test(t))) return { tier: "thorough", matched: true };
  if (DEEP_MARKERS.some((re) => re.test(t))) return { tier: "deep", matched: true };
  // Length-based escalation when no markers
  if (t.length >= 600 || (t.match(/\?/g) ?? []).length >= 3) {
    return { tier: "deep", matched: true };
  }
  return { tier: "quick", matched: false };
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
      // Only react to textarea + input[type=text|search|null] with .value
      const tag = el.tagName;
      if (tag !== "TEXTAREA" && tag !== "INPUT") {
        setVerdict(null);
        return;
      }
      // H.3.1 · respect any ancestor with [data-no-deep-nudge]. This lets
      // high-noise surfaces (journal entries, quick-add bars, search
      // boxes) opt out without the nudge needing to know about them.
      // Walks up the DOM tree from the focused element to find an
      // ancestor with the attribute · zero coupling to specific pages.
      if ((el as HTMLElement).closest("[data-no-deep-nudge]")) {
        setVerdict(null);
        return;
      }
      const input = el as HTMLInputElement | HTMLTextAreaElement;
      if (tag === "INPUT") {
        const t = (input as HTMLInputElement).type;
        if (t && !["text", "search", "url", ""].includes(t)) {
          setVerdict(null);
          return;
        }
      }
      const value = input.value ?? "";
      const v = quickClassify(value);
      if (v.matched) {
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
        if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) return;
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
        router.push(`/reason?q=${encodeURIComponent(verdict.text)}`);
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
