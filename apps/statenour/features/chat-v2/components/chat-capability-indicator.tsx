"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, WifiOff } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { useChatUiStore } from "../stores/chat-ui-store";

export function ChatCapabilityIndicator() {
  const connection = useChatUiStore((state) => state.connection);
  const providers = trpc.system.providerHealth.useQuery(undefined, {
    refetchInterval: 60_000,
    retry: 1,
  });
  const tools = trpc.system.toolsHealth.useQuery(undefined, {
    refetchInterval: 60_000,
    retry: 1,
  });

  const providerTone = providers.data?.overallTone ?? (providers.isError ? "red" : "amber");
  const toolSummary = tools.data?.summary;
  const degraded = connection !== "online" || providerTone !== "green" || Boolean(toolSummary && (toolSummary.degraded > 0 || toolSummary.down > 0));
  const label = connection === "offline"
    ? "chat offline"
    : providerTone === "red"
      ? "AI offline"
      : providerTone === "amber"
        ? "fallback active"
        : toolSummary
          ? `${toolSummary.totalTools} tools ready`
          : "checking capabilities";

  const Icon = connection === "offline" ? WifiOff : degraded ? AlertTriangle : CheckCircle2;

  return (
    <Link
      href="/system/costs"
      title="Open provider, cost, and capability health"
      className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 font-mono text-[9px] uppercase tracking-wider transition ${
        degraded
          ? "border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15"
          : "border-emerald-500/25 bg-emerald-500/[0.07] text-emerald-300 hover:bg-emerald-500/10"
      }`}
    >
      <Icon size={11} />
      {label}
      {toolSummary && toolSummary.down > 0 ? ` · ${toolSummary.down} down` : ""}
    </Link>
  );
}
