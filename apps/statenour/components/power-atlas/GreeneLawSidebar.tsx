"use client";

/**
 * <GreeneLawSidebar> · 2026-05-27 · Power Atlas Phase 1
 *
 * Renders the top 2-3 applicable Robert Greene laws for a person. Each
 * row is a collapsed chip showing law number + title + 1-sentence
 * summary; tap to expand and see the full Greene-voiced fullText.
 *
 * Input: `applicableLawTexts` from `task.personProfile` · each row is
 * `{ key: "law_N", content: JSON string }` where content parses to
 * `{ title, summary, fullText, sourceBook, number, ... }`.
 */

import { useState } from "react";

interface LawEntry {
  key: string;
  content: string;
}

interface GreeneLawSidebarProps {
  applicableLawTexts: LawEntry[];
}

interface ParsedLaw {
  key: string;
  number: number;
  title: string;
  summary: string;
  fullText: string;
  sourceBook: string;
}

function parseLaw(entry: LawEntry): ParsedLaw | null {
  try {
    const parsed = JSON.parse(entry.content) as {
      title: string;
      summary: string;
      fullText: string;
      sourceBook: string;
      number?: number;
    };
    const numMatch = entry.key.match(/law_(\d+)/);
    const number = parsed.number ?? (numMatch ? parseInt(numMatch[1], 10) : 0);
    return {
      key: entry.key,
      number,
      title: parsed.title,
      summary: parsed.summary,
      fullText: parsed.fullText,
      sourceBook: parsed.sourceBook,
    };
  } catch {
    return null;
  }
}

export default function GreeneLawSidebar({
  applicableLawTexts,
}: GreeneLawSidebarProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const laws = applicableLawTexts
    .map(parseLaw)
    .filter((l): l is ParsedLaw => l !== null)
    .sort((a, b) => a.number - b.number)
    .slice(0, 3);

  return (
    <section
      className="rounded-xl border bg-[var(--bg-raised)] p-4"
      style={{ borderColor: "rgba(255,255,255,0.06)" }}
    >
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="font-serif text-lg tracking-tight text-[var(--text-primary)]">
          Applicable laws
        </h2>
        <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] tabular-nums">
          {laws.length} of 48
        </span>
      </div>

      {laws.length === 0 ? (
        <p className="text-sm italic text-[var(--text-tertiary)]">
          No laws tagged yet. Greene laws auto-tag from observed patterns in
          Phase 3 · operator can also tag manually.
        </p>
      ) : (
        <ul className="space-y-2">
          {laws.map((law) => {
            const isOpen = expanded === law.key;
            return (
              <li
                key={law.key}
                className="rounded-lg border bg-[var(--bg-default)]/30"
                style={{ borderColor: "rgba(255,255,255,0.06)" }}
              >
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : law.key)}
                  className="w-full text-left px-3 py-2.5 hover:bg-[var(--bg-elevated)]/40 transition-colors rounded-lg"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-xs text-[var(--gold)] tabular-nums shrink-0">
                      L{law.number.toString().padStart(2, "0")}
                    </span>
                    <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                      {law.title}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--text-secondary)] leading-snug">
                    {law.summary}
                  </p>
                </button>
                {isOpen && (
                  <div
                    className="px-3 pb-3 pt-1 border-t"
                    style={{ borderColor: "rgba(255,255,255,0.04)" }}
                  >
                    <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                      {law.fullText}
                    </p>
                    <p className="mt-2 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
                      — {law.sourceBook}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
