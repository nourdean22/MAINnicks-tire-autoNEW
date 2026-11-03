"use client";

/**
 * Home's journal line and the lead's mission/goal detail (W7, map gap 6): Home reads the journal and the
 * missions behind the next move. Both come from the one brief (operator.brief); "unknown" is a failed read
 * and says so, null is a measured nothing and renders nothing.
 */
import Link from "next/link";

import { GoalPeopleLine } from "@/components/goals/goal-people-line";
import type { JournalLine, LeadContext } from "@/lib/home/operator-brief";

export function leadContextDetail(ctx: LeadContext | null | "unknown" | undefined): string | null {
  if (ctx === "unknown") return "Mission and goal couldn't load";
  if (!ctx) return null;
  const parts = [ctx.mission && `Mission: ${ctx.mission.title}`, ctx.goal && `Goal: ${ctx.goal.title}`].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export function JournalLineView({ line }: { line: JournalLine | null | "unknown" | undefined }) {
  if (line === "unknown") {
    return (
      <p role="status" className="mt-6 text-[13px] text-amber-300">
        Journal unknown, couldn&apos;t load
      </p>
    );
  }
  if (!line) return null;
  return (
    <section aria-label="Latest journal entry" className="mt-6 border-l-2 border-edge-default pl-4">
      <Link href="/journal" className="block min-h-11 py-1">
        <span className="text-[13px] text-fg-secondary">Journal</span>
        <span className="mt-0.5 block text-[15px] leading-snug text-fg">{line.excerpt}</span>
      </Link>
      {line.people === null ? (
        <p role="status" className="text-[11px] text-fg-tertiary">
          People on this entry couldn&apos;t load.
        </p>
      ) : (
        <GoalPeopleLine people={line.people} />
      )}
    </section>
  );
}
