"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { capabilityBadge, capabilityWord, type ProviderTone } from "../lib/capability-label";
import { trpc } from "@/lib/trpc/client";
import { useChatUiStore } from "../stores/chat-ui-store";

/**
 * UI v3 W3b: a 10px dot and one word, in place of the bordered pill. The three honest states of
 * capabilityBadge (checking / unknown / measured) stay: the full label is the link's accessible
 * name and a visually hidden span, the word (Ready / Checking / Unknown / Degraded / Offline)
 * shows at md and up, and the dot's shape carries the state next to its colour (filled for a
 * measured state, a ring for unknown, a spinner only while a read is in flight). Still a Link to
 * /system/health.
 */
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
    toolsErrored: tools.isError,
  });
  const label = `${badge.label}${toolSummary && toolSummary.down > 0 ? ` · ${toolSummary.down} down` : ""}`;
  const word = capabilityWord(badge);
  const dot = badge.unknown
    ? "border-2 border-amber-400"
    : badge.cautious
      ? "bg-amber-400"
      : "bg-emerald-400";

  return (
    <Link
      href="/system/health"
      title="Open provider and capability health"
      aria-label={`${label} (capability health)`}
      className="inline-flex min-h-11 items-center gap-2 rounded-control px-1.5 text-[12px] text-fg-secondary transition-colors duration-[var(--motion-state)] hover:text-fg"
    >
      {/* Only a read still in flight spins (09-F14): a failed read is static. */}
      {badge.checking ? (
        <Loader2 size={10} aria-hidden className="animate-spin text-fg-tertiary" />
      ) : (
        <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
      )}
      <span className="sr-only">{label}</span>
      <span aria-hidden className="hidden md:inline">{word}</span>
    </Link>
  );
}
