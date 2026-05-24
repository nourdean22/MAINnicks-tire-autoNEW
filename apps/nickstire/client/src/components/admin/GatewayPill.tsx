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
 *
 * Refetches every 60s so transient F25e drops surface quickly.
 */
import { trpc } from "@/lib/trpc";
import { BUSINESS } from "@shared/business";

export default function GatewayPill() {
  const status = trpc.sms.status.useQuery();
  const health = trpc.sms.gatewayHealth.useQuery(undefined, { refetchInterval: 60_000 });
  const shopOnline = health.data?.online ?? false;
  const shopConfigured = status.data?.shopGateway?.configured ?? false;
  const tone = !shopConfigured ? "bg-red-400" : shopOnline ? "bg-emerald-400" : "bg-amber-400";
  const label = !shopConfigured ? "Gateway: not configured" : shopOnline ? "Live" : "Gateway offline";
  return (
    <div className="inline-flex items-center gap-2 px-2.5 py-1 bg-foreground/[0.04] border border-border/30 rounded-full text-[11px] text-foreground/60">
      <span className={`w-1.5 h-1.5 rounded-full ${tone}`} />
      <span>{label}</span>
      <span className="text-foreground/30">·</span>
      <span className="font-mono">{BUSINESS.phone.dashed}</span>
    </div>
  );
}
