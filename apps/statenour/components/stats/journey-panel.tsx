"use client";

/**
 * Journey panel — Wave-6 (2026-07-29). "Who was I becoming" — the
 * chronological lens the 06-10 audit called the 3-year moat. Four
 * sections over existing data: identity arc, XP growth, recurring
 * enemies, graduated skills. Every claim carries its time range and
 * source; not-enough-data states are honest, never dramatic.
 */

import { Panel } from "@/components/panel";
import { trpc } from "@/lib/trpc/client";

function SectionHeader({ label, since, source }: { label: string; since: string; source: string }) {
  return (
    <div className="flex items-baseline justify-between mb-1.5">
      <span className="text-[11px] uppercase tracking-[0.16em] text-fg-secondary/70">{label}</span>
      <span className="text-[9px] font-mono text-fg-secondary/40">
        {since} · {source}
      </span>
    </div>
  );
}

export function JourneyPanel() {
  const journey = trpc.system.journeyLens.useQuery();

  if (journey.isLoading) {
    return (
      <Panel>
        <div className="h-4 w-44 rounded bg-white/5 animate-pulse" />
      </Panel>
    );
  }
  if (journey.isError || !journey.data) {
    return (
      <Panel>
        <p className="text-[12px] text-zinc-400">
          Journey lens couldn&apos;t load — state UNKNOWN, not empty.
        </p>
      </Panel>
    );
  }
  const j = journey.data;

  return (
    <div className="space-y-3">
      <Panel>
        <SectionHeader label="identity arc" since={j.identity.since} source={j.identity.source} />
        {!j.identity.enoughData ? (
          <p className="text-[11px] text-zinc-500 italic">
            Not enough snapshot history yet — the arc needs two snapshots ≥ 30 days apart.
          </p>
        ) : (
          <div className="space-y-1">
            {j.identity.data.map((d) => (
              <div key={d.axis} className="flex items-center justify-between text-[12px] tabular-nums">
                <span className="text-zinc-300">{d.axis}</span>
                <span className={d.delta >= 0 ? "text-emerald-300" : "text-amber-300"}>
                  {d.from} → {d.to} ({d.delta >= 0 ? "+" : ""}
                  {d.delta})
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel>
        <SectionHeader label="xp growth" since={j.xp.since} source={j.xp.source} />
        {!j.xp.enoughData ? (
          <p className="text-[11px] text-zinc-500 italic">No XP events in either window yet.</p>
        ) : (
          <div className="flex items-center gap-4 text-[12px] tabular-nums">
            <span className="text-zinc-300">{j.xp.data.current30} XP this 30d</span>
            <span className="text-fg-secondary/60">{j.xp.data.prior30} prior 30d</span>
            <span
              className={
                j.xp.data.growthPct == null
                  ? "text-zinc-500"
                  : j.xp.data.growthPct >= 0
                    ? "text-emerald-300"
                    : "text-amber-300"
              }
            >
              {j.xp.data.growthPct == null
                ? "no prior baseline — growth % would be invented"
                : `${j.xp.data.growthPct >= 0 ? "+" : ""}${j.xp.data.growthPct}%`}
            </span>
          </div>
        )}
      </Panel>

      <Panel>
        <SectionHeader label="recurring enemies" since={j.enemies.since} source={j.enemies.source} />
        {!j.enemies.enoughData ? (
          <p className="text-[11px] text-zinc-500 italic">
            No anti-pattern has revisited twice yet — that is a good week, not missing data.
          </p>
        ) : (
          <div className="space-y-1">
            {j.enemies.data.map((e) => (
              <div key={e.name} className="flex items-center justify-between text-[12px]">
                <span className="text-zinc-300 truncate pr-3">{e.name}</span>
                <span className="text-rose-300 tabular-nums shrink-0">×{e.revisits} returns</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel>
        <SectionHeader label="graduated skills" since={j.skills.since} source={j.skills.source} />
        {!j.skills.enoughData ? (
          <p className="text-[11px] text-zinc-500 italic">
            No skill has fired 5+ times yet — graduation takes repetition.
          </p>
        ) : (
          <div className="space-y-1">
            {j.skills.data.map((s) => (
              <div key={s.name} className="flex items-center justify-between text-[12px]">
                <span className="text-zinc-300 truncate pr-3">{s.name}</span>
                <span className="text-emerald-300 tabular-nums shrink-0">
                  fired ×{s.timesFired}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
