"use client";

/**
 * SelfCritiqueCard · Wave X.f (2026-05-24) · activation.
 *
 * Surfaces the bottom-decile assistant replies that the nightly
 * `self-critique` cron flagged for the operator to review. Pre-fix
 * the cron wrote `BrainMemory(category="reply_to_improve")` every
 * night but nothing on /brain rendered the list — the quality
 * feedback loop was dark to the operator.
 *
 * Reads · `GET /api/brain/memories?category=reply_to_improve&limit=5`.
 * Returns memory rows with `content` (human-readable score summary)
 * + `metadata.{messageId, conversationId, score}`. The card silent-
 * hides when zero rows exist (a clean week is silence, not an empty
 * state · per the /brain editorial design language).
 *
 * Each row shows the composite score + content preview, links to
 * /chat?conv=<id> so a tap takes the operator directly to the
 * flagged conversation thread.
 */

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/utils/api-fetch";
import Link from "next/link";
import { GlassCard } from "@/components/ui/glass-card";

interface CritiqueMemory {
  id: string;
  content: string;
  confidence: number;
  metadata: {
    messageId?: string;
    conversationId?: string;
    score?: {
      composite: number;
      specificity?: number;
      cliche?: number;
      antiNour?: number;
      length?: number;
    };
  } | null;
  createdAt: string;
}

export function SelfCritiqueCard() {
  const [rows, setRows] = useState<CritiqueMemory[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // /api/brain/memories is apiHandler-wrapped, so res.json() is the
        // ENVELOPE. The old cast said CritiqueMemory[]; Array.isArray(envelope)
        // is false, the guard fell through to [], and this panel rendered
        // NOTHING on a 200. A cast is an assertion, not a check — nothing failed.
        const data = await apiFetch<CritiqueMemory[]>(
          "/api/brain/memories?category=reply_to_improve&limit=5",
        );
        if (!cancelled) setRows(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Silent-when-empty · clean weeks render nothing per the /brain
  // editorial design language.
  if (rows === null || rows.length === 0) return null;

  return (
    <GlassCard className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary">
          Nick flagged for review
        </div>
        <div className="text-[11px] text-[var(--text-tertiary)] tabular-nums">
          {rows.length}
        </div>
      </div>
      <ul className="space-y-2">
        {rows.map((row) => {
          const score = row.metadata?.score?.composite;
          const convId = row.metadata?.conversationId;
          const preview = row.content.replace(/^Reply scored \d+\/100[^\n]*\n?Preview:\s*/i, "");
          const href = convId ? `/chat?conv=${convId}` : "/chat";
          return (
            <li key={row.id}>
              <Link
                href={href}
                className="block min-h-[44px] py-2 px-2 -mx-2 rounded-control hover:bg-surface-hover transition-colors"
              >
                <div className="flex items-baseline gap-2">
                  {typeof score === "number" && (
                    <span className="text-[11px] tabular-nums shrink-0 text-amber-400">
                      {score}/100
                    </span>
                  )}
                  <span className="text-[12px] text-[var(--text-secondary)] line-clamp-2">
                    {preview.slice(0, 180)}
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </GlassCard>
  );
}
