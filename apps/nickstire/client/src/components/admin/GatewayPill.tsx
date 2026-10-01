/**
 * GatewayPill — Compact F25e shop gateway status pill.
 *
 * Hoisted out of SmsSection.tsx in Outreach Hub Phase 2 so the same
 * primitive renders on every Outreach tab (Messages, Campaigns,
 * Follow-Ups, Reviews, Win-Back, Performance) — not just Messages.
 * The operator now sees gateway state regardless of which surface
 * they're using to send.
 *
 * States:
 *   - not configured → red dot, "Gateway: not configured"
 *   - configured + online → emerald dot, "Live"
 *   - configured + offline → amber dot, "Gateway offline"
 *   - status read failed   → grey dot, "Gateway status unknown" (Q-23 phase 9)
 *   - first read in flight → grey dot, "Checking gateway…"
 *
 * The state comes from lib/gatewayState, the rule every gateway reader shares
 * (Q-23 phase 12). A failed background refetch keeps the last good read.
 *
 * Refetches every 60s so transient F25e drops surface quickly.
 */
import { trpc } from "@/lib/trpc";
import { gatewayState } from "@/lib/gatewayState";
import { BUSINESS } from "@shared/business";

export default function GatewayPill() {
  const status = trpc.sms.status.useQuery();
  const health = trpc.sms.gatewayHealth.useQuery(undefined, { refetchInterval: 60_000 });
  const state = gatewayState(health.data, health.isError);
  // "Not configured" only when a read said so. Both reads check the same env
  // vars; `?? false` here used to call a still-loading status "not configured".
  const notConfigured = status.data?.shopGateway?.configured === false || state === "not_configured";
  const tone = notConfigured
    ? "bg-red-400"
    : state === "online"
      ? "bg-emerald-400"
      : state === "offline"
        ? "bg-amber-400"
        : "bg-foreground/30";
  const label = notConfigured
    ? "Gateway: not configured"
    : state === "online"
      ? "Live"
      : state === "offline"
        ? "Gateway offline"
        : state === "checking"
          ? "Checking gateway…"
          : "Gateway status unknown";
  return (
    <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-foreground/[0.04] border border-border/30 rounded-full text-[11px] text-foreground/60">
      <span className={`w-1.5 h-1.5 rounded-full ${tone}`} />
      <span>{label}</span>
      <span className="text-foreground/30">·</span>
      <span className="font-mono">{BUSINESS.phone.dashed}</span>
    </div>
  );
}
