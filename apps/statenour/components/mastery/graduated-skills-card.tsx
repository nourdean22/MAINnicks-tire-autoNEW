"use client";

import { trpc } from "@/lib/trpc/client";
import { Award, ShieldAlert, CheckCircle2 } from "lucide-react";

export function GraduatedSkillsCard() {
  const skillsQ = trpc.operator.skills.useQuery(undefined, {
    staleTime: 60_000,
  });

  if (skillsQ.isLoading) {
    return (
      <div className="h-[210px] rounded-lg border border-white/10 bg-white/2 animate-pulse" />
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
        className="rounded-lg border border-white/10 bg-white/2 p-3.5 flex flex-col justify-between min-h-[210px]"
      >
        <div className="flex items-center justify-between border-b border-white/6 pb-2">
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">
            Graduated Skills (Repeated Victories)
          </p>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center py-4 text-center">
          <Award className="h-6 w-6 text-white/20 mb-2" />
          <p className="text-[11px] text-white/50 font-medium">No graduated skills yet.</p>
          <p className="text-[9px] text-white/30 mt-0.5">Fire skills 5+ times to earn graduation.</p>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="graduated-skills-card"
      className="rounded-lg border border-cyan-500/10 bg-cyan-500/1 p-3.5 flex flex-col justify-between min-h-[210px] space-y-3"
    >
      <div className="flex items-center justify-between border-b border-white/6 pb-2">
        <p className="text-[10px] uppercase tracking-[0.18em] text-cyan-400 font-semibold flex items-center gap-1.5">
          <CheckCircle2 className="h-3 w-3" /> Graduated Skills
        </p>
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 font-medium">
          {graduated.length} Graduated
        </span>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto max-h-[140px] scrollbar-thin pr-1">
        {graduated.map((s) => {
          const successRate = s.times_fired > 0 ? Math.round((s.times_succeeded / s.times_fired) * 100) : 100;
          return (
            <div
              key={s.trigger}
              className="flex items-center justify-between p-2 rounded bg-white/1 border border-white/3 hover:border-cyan-500/10 transition group"
            >
              <div className="min-w-0 pr-2">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-white/80 text-[11px] truncate">
                    {s.trigger}
                  </span>
                  <span className="text-[9px] uppercase tracking-wider text-cyan-400/60 font-medium">
                    {s.polarity === "avoid" ? "Avoidance" : "Action"}
                  </span>
                </div>
                <p className="text-[10px] text-white/50 truncate mt-0.5">
                  {s.action_sequence?.join(" ➔ ") || "No action sequence"}
                </p>
              </div>

              <div className="flex flex-col items-end shrink-0 gap-0.5">
                <span className="text-[10px] font-bold text-cyan-400">
                  {successRate}% SR
                </span>
                <span className="text-[9px] text-white/30">
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
