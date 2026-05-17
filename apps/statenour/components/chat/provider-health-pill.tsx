"use client";

/**
 * ProviderHealthPill — tiny HUD pill in the chat header that surfaces
 * AI lane health.
 *
 * v6 · BATCH 2 · Apr 28. Silent when green. Renders only when amber or
 * red so the chat surface stays calm 99% of the time. Click → opens
 * /system/costs in a new tab for the full picture.
 *
 * Visual spec:
 *   green: hidden
 *   amber: amber-300 dot + "fallback active" or cooldown remaining
 *   red:   rose-300 dot + "AI offline"
 */

import { useProviderHealth } from "@/hooks/use-provider-health";
import { cn } from "@/lib/utils/cn";
import Link from "next/link";

interface Props {
  /** Force render even when green (used on the system-page tile). */
  alwaysShow?: boolean;
  className?: string;
}

export function ProviderHealthPill({ alwaysShow = false, className }: Props) {
  const health = useProviderHealth();
  if (!health) return null;
  if (health.tone === "green" && !alwaysShow) return null;

  const dotTone =
    health.tone === "red"
      ? "bg-rose-400 shadow-[0_0_6px_rgba(251,113,133,0.7)]"
      : health.tone === "amber"
        ? "bg-amber-400"
        : "bg-emerald-400";

  const borderTone =
    health.tone === "red"
      ? "border-rose-500/40 bg-rose-500/[0.06] text-rose-200"
      : health.tone === "amber"
        ? "border-amber-500/35 bg-amber-500/[0.05] text-amber-200"
        : "border-emerald-500/30 bg-emerald-500/[0.03] text-emerald-200";

  return (
    <Link
      href="/system/costs"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-mono transition hover:opacity-80",
        borderTone,
        className,
      )}
      title={`${health.label} — click for details`}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full animate-pulse", dotTone)} />
      <span className="uppercase tracking-wider">{health.label}</span>
    </Link>
  );
}
