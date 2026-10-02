"use client";

/**
 * TodaysPrompt · Wave AP · 2026-05-28.
 *
 * Sam-Altman frame for /journal · "the one question worth answering
 * today." Pre-this-fix the journal opened onto a blank composer · the
 * operator had to invent what to reflect on. Sam would say: the prompt
 * is the lever · give the operator a curated question + 1-tap to write.
 *
 * Deterministic per-day rotation · same rotation HomeOneTapMoves uses
 * for the home page journal slot · so home + journal stay coherent. The
 * operator sees the SAME prompt on both surfaces · "best move now" on
 * home → "open composer + answer" on journal.
 *
 * The prompt set is intentionally short + operator-grade · no generic
 * gratitude prompts · each one earns its slot by asking a question
 * that compounds (decision audit · honest stall · 60-min next move).
 *
 * CTA · "answer now" 1-tap auto-focuses the ReflectComposer (we use a
 * custom DOM event that ReflectComposer can listen for · zero-coupling
 * across components).
 */

import { useState, useEffect } from "react";
import { NotebookPen } from "lucide-react";

const PROMPTS = [
  "What compounded today · or what stalled?",
  "Who showed up for me this week · who'd I leave hanging?",
  "What did Nick get right yesterday · what'd he miss?",
  "What's the smallest thing I could ship today?",
  "What am I avoiding · and why?",
  "If I could only work on ONE thing this quarter, what would it be?",
  "What did I learn that changes my plan?",
  "Where am I being lied to (by myself or by my data)?",
  "What's the 10x version of what I'm working on?",
  "What's the move I'd make if I knew nobody was watching?",
];

export function TodaysPrompt() {
  const [today, setToday] = useState<string | null>(null);

  // Render-after-mount so the prompt is stable across SSR/CSR (no
  // hydration mismatch on the date-derived index).
  useEffect(() => {
    setToday(new Date().toISOString().slice(0, 10));
  }, []);

  if (!today) return null;

  // Deterministic-per-day rotation · same algorithm as home-moves's
  // journal_prompt slot so /home and /journal show the same prompt.
  const seedHash = today
    .split("")
    .reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const idx = seedHash % PROMPTS.length;
  const prompt = PROMPTS[idx];

  const focusComposer = () => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("nour:journal-focus-composer"));
    // Also try to scroll the composer into view (it lives below the
    // prompt) · scrollIntoView on the named target is a graceful fall-
    // back when the event listener isn't wired (matches the
    // ReflectComposer's `id="journal-reflect-composer"`).
    const el = document.getElementById("journal-reflect-composer");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section
      aria-label="today's reflection prompt"
      className="rounded-surface border border-edge-subtle bg-content p-5"
    >
      <div className="flex items-center gap-2 mb-3">
        <NotebookPen
          size={11}
          className="text-fg-tertiary"
          strokeWidth={1.75}
        />
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
          today's prompt
        </p>
      </div>
      <p className="text-[18px] font-medium text-fg leading-snug italic">
        {prompt}
      </p>
      <div className="mt-5 flex items-center justify-between gap-3">
        <p className="text-[11px] text-fg-tertiary">
          3-5 sentences · ship it · no editing
        </p>
        <button
          type="button"
          onClick={focusComposer}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-control border border-edge-default px-4 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg"
        >
          Answer now
        </button>
      </div>
    </section>
  );
}
