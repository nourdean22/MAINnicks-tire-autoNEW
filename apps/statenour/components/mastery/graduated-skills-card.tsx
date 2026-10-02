"use client";

import { trpc } from "@/lib/trpc/client";
import { Award, ShieldAlert, CheckCircle2 } from "lucide-react";

export function GraduatedSkillsCard() {
  const skillsQ = trpc.operator.skills.useQuery(undefined, {
    staleTime: 60_000,
  });

  if (skillsQ.isLoading) {
    return (
      <div className="h-[210px] rounded-surface border border-edge-subtle bg-content animate-pulse" />
    );
  }

  if (skillsQ.isError) {
    return null; // Self-hide on error per house rules
  }

  const activeSkills = skillsQ.data?.active ?? [];
  const graduated = [...activeSkills]
    .filter((s) => s.times_fired >= 5 || s.graduated)
    .sort((a, b) => b.times_fired - a.times_fired)
    .slice(0, 3);

  if (graduated.length === 0) {
    return (
      <section
        aria-label="graduated-skills-card"
        className="rounded-surface border border-edge-subtle bg-content p-3.5 flex flex-col justify-between min-h-[210px]"
      >
        <div className="flex items-center justify-between border-b border-edge-subtle pb-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
            Graduated Skills (Repeated Victories)
          </p>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center py-4 text-center">
          <Award className="h-6 w-6 text-fg-tertiary mb-2" />
          <p className="text-[12px] text-fg-secondary font-medium">No graduated skills yet.</p>
          <p className="text-[11px] text-fg-tertiary mt-0.5">Fire skills 5+ times to earn graduation.</p>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="graduated-skills-card"
      className="rounded-surface border border-edge-subtle bg-content p-3.5 flex flex-col justify-between min-h-[210px] space-y-3"
    >
      <div className="flex items-center justify-between border-b border-edge-subtle pb-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-cyan-400 flex items-center gap-1.5">
          <CheckCircle2 className="h-3 w-3" /> Graduated Skills
        </p>
        <span className="text-[11px] px-1.5 py-0.5 rounded-micro bg-cyan-500/10 text-cyan-400 font-medium">
          {graduated.length} Graduated
        </span>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto max-h-[140px] scrollbar-thin pr-1">
        {graduated.map((s) => {
          const successRate = s.times_fired > 0 ? Math.round((s.times_succeeded / s.times_fired) * 100) : 100;
          return (
            <div
              key={s.trigger}
              className="flex items-center justify-between p-2 rounded-control bg-surface-interactive border border-edge-subtle hover:border-edge-strong transition-colors duration-[var(--motion-state)] group"
            >
              <div className="min-w-0 pr-2">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-fg text-[12px] truncate">
                    {s.trigger}
                  </span>
                  <span className="font-mono text-[11px] text-cyan-400/80">
                    {s.polarity === "avoid" ? "Avoidance" : "Action"}
                  </span>
                </div>
                <p className="text-[11px] text-fg-tertiary truncate mt-0.5">
                  {s.action_sequence?.join(" ➔ ") || "No action sequence"}
                </p>
              </div>

              <div className="flex flex-col items-end shrink-0 gap-0.5">
                <span className="text-[11px] font-semibold tabular-nums text-cyan-400">
                  {successRate}% SR
                </span>
                <span className="text-[11px] text-fg-tertiary">
                  {s.times_fired} reps
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
