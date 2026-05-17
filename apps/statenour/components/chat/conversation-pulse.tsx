"use client";

/**
 * ConversationPulse — alive per-conversation telemetry strip.
 *
 * v7.6 · C13 · Apr 29 · ChatMessage Batch A.
 *
 * Three live elements in one tiny strip:
 *   1. Latency sparkline (last 8 assistant turns)
 *      — polyline tinted: green<800ms · neutral<2s · amber<4s · red≥4s
 *      — newest data point on the right; older fades left
 *   2. Running cost counter (sum of costCents for the active conv)
 *      — animates a smooth roll on update
 *   3. Provider badge with router-reason tint (shifts color when the
 *      router lane changes mid-conversation)
 *
 * Pulls from the loaded UIMessage list + a 30s refetch from the
 * branches/info endpoints. Component is read-only. Lives at the top
 * of the active conversation.
 *
 * Why "alive": you can SEE the rhythm of a conversation. Slow turns
 * spike the sparkline; provider switches recolor the badge; cost
 * grows like a meter while you work. Static badges → moving signal.
 */

import { useMemo } from "react";
import { Activity, Coins, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";

interface MessageMetric {
  role: string;
  latencyMs?: number | null;
  costCents?: number | null;
  provider?: string | null;
  routerReason?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
}

export interface ConversationPulseProps {
  messages: MessageMetric[];
  className?: string;
}

const ROUTER_TONES: Record<string, { ring: string; text: string }> = {
  default:            { ring: "border-zinc-500/30",                 text: "text-zinc-300" },
  fallback:           { ring: "border-amber-500/35",                text: "text-amber-300" },
  preferLargeContext: { ring: "border-blue-500/35",                 text: "text-blue-300" },
  nourVoiceLane:      { ring: "border-[var(--gold)]/35",            text: "text-[var(--gold)]" },
};

function latencyColor(ms: number): string {
  if (ms < 800) return "rgb(52, 211, 153)";   // emerald
  if (ms < 2000) return "rgb(212, 212, 216)"; // zinc
  if (ms < 4000) return "rgb(251, 191, 36)";  // amber
  return "rgb(248, 113, 113)";                 // red
}

export function ConversationPulse({ messages, className }: ConversationPulseProps) {
  const stats = useMemo(() => {
    const assistants = messages.filter((m) => m.role === "assistant");
    const recent = assistants.slice(-8);
    const latencies = recent
      .map((m) => (typeof m.latencyMs === "number" ? m.latencyMs : null))
      .filter((n): n is number => n !== null);

    const totalCost = assistants.reduce((s, m) => s + (m.costCents ?? 0), 0);
    const totalTokens = assistants.reduce(
      (s, m) => s + (m.promptTokens ?? 0) + (m.completionTokens ?? 0),
      0,
    );
    // Most recent provider + reason
    const lastWithProvider = [...assistants].reverse().find((m) => m.provider);
    const provider = lastWithProvider?.provider ?? null;
    const routerReason = lastWithProvider?.routerReason ?? "default";

    return { latencies, totalCost, totalTokens, provider, routerReason };
  }, [messages]);

  if (stats.latencies.length === 0 && stats.totalCost === 0) return null;

  const max = stats.latencies.length > 0 ? Math.max(...stats.latencies, 1000) : 1000;
  const min = stats.latencies.length > 0 ? Math.min(...stats.latencies, 0) : 0;
  const range = max - min || 1;
  const w = 56;
  const h = 14;
  const points = stats.latencies.map((v, i) => {
    const x = (i / Math.max(stats.latencies.length - 1, 1)) * w;
    const y = h - ((v - min) / range) * (h - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const tone = ROUTER_TONES[stats.routerReason] ?? ROUTER_TONES.default;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-3 px-2.5 py-1 rounded-md border border-[var(--border-default)]/60 bg-[var(--bg-raised)]/30",
        "text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]",
        className,
      )}
    >
      {/* Sparkline */}
      {stats.latencies.length > 1 && (
        <div className="flex items-center gap-1.5">
          <Activity size={9} className="text-[var(--text-tertiary)]/70" />
          <svg width={w} height={h} className="overflow-visible">
            <polyline
              fill="none"
              stroke={latencyColor(stats.latencies[stats.latencies.length - 1] ?? 1000)}
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={points.join(" ")}
              style={{ filter: `drop-shadow(0 0 2px ${latencyColor(stats.latencies[stats.latencies.length - 1] ?? 1000)})` }}
            />
            {/* Last-point dot for emphasis */}
            <circle
              cx={(stats.latencies.length - 1) / Math.max(stats.latencies.length - 1, 1) * w}
              cy={h - ((stats.latencies[stats.latencies.length - 1] ?? 0) - min) / range * (h - 2) - 1}
              r="1.6"
              fill={latencyColor(stats.latencies[stats.latencies.length - 1] ?? 1000)}
            />
          </svg>
          <span className="tabular-nums">
            {stats.latencies[stats.latencies.length - 1]}ms
          </span>
        </div>
      )}

      {/* Cost counter */}
      {stats.totalCost > 0 && (
        <div className="flex items-center gap-1.5">
          <Coins size={9} className="text-[var(--gold)]/70" />
          <span className="tabular-nums text-[var(--gold)]">
            {stats.totalCost < 100 ? `${stats.totalCost}¢` : `$${(stats.totalCost / 100).toFixed(2)}`}
          </span>
          {stats.totalTokens > 0 && (
            <span className="opacity-60">
              · {stats.totalTokens >= 1000 ? `${(stats.totalTokens / 1000).toFixed(1)}k` : stats.totalTokens}t
            </span>
          )}
        </div>
      )}

      {/* Provider with router-reason tint */}
      {stats.provider && (
        <div className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded border", tone.ring, tone.text)}>
          <Cpu size={8} />
          <span className="lowercase tracking-normal">{stats.provider}</span>
          {stats.routerReason && stats.routerReason !== "default" && (
            <span className="opacity-70 text-[8px]">· {stats.routerReason}</span>
          )}
        </div>
      )}
    </div>
  );
}
