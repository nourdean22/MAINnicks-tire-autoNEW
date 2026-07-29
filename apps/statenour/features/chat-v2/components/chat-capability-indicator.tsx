"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, Loader2, WifiOff } from "lucide-react";
import { capabilityBadge, type ProviderTone } from "../lib/capability-label";
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

  // 2026-07-29 · the tone used to default to "amber" while the health
  // query was still in flight — and amber's label is "fallback active",
  // so a perfectly healthy app announced a provider failure on every
  // load. Loading now travels as `undefined` and capabilityBadge()
  // decides what may be CLAIMED: cautious styling, honest words.
  const toolSummary = tools.data?.summary;
  const badge = capabilityBadge({
    connection,
    providerTone: providers.data?.overallTone as ProviderTone | undefined,
    providerErrored: providers.isError,
    toolSummary,
  });
  const degraded = badge.cautious;
  const label = badge.label;

  const Icon = connection === "offline"
    ? WifiOff
    : badge.unknown
      ? Loader2
      : degraded
        ? AlertTriangle
        : CheckCircle2;

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
      <Icon size={11} className={badge.unknown ? "animate-spin" : undefined} />
      {label}
      {toolSummary && toolSummary.down > 0 ? ` · ${toolSummary.down} down` : ""}
    </Link>
  );
}
