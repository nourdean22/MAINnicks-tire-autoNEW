/**
 * OutreachBrief — wave-181.x Outreach Hub Phase 2.
 *
 * Mirror of CustomersBrief / MorningBrief pattern · 3-line auto-
 * narrative that lands above the tab bar on the Outreach hub so the
 * operator's first eye-grab is "what's queued + live + needs action"
 * rather than "what are these 6 tabs."
 *
 * COMPOSITION (3 signal lines, each <120 chars)
 *   1. QUEUE: review requests pending + active campaigns + scheduled sends
 *   2. LIVE: today's send count + gateway state (color-toned)
 *   3. ACTION: dry-run declined-recovery banner (highest leverage idle $)
 *      OR a "queue is clear" green tone when nothing waiting
 *
 * DEGRADATION
 *   · All queries loading            → short shimmer line
 *   · Zero queue + recovery live     → green "all clear" tone
 *   · Recovery DRY-RUN + $0          → action line hidden (no real signal)
 *
 * NO NEW SERVER WORK · composes from existing queries already on the
 * hub:  reviewRequests.stats · campaigns.stats · shopdriver.declined-
 * RecoveryStatus · sms.gatewayHealth.
 *
 * COOL FEATURES STOLEN FROM SKILLS
 *   · morning-brief / daily-briefing  · 3-line summary header
 *   · clarity-gate                    · skip lines when no real signal
 *   · gates-leverage                  · surface the idle-$ blocker LOUDLY
 *   · kpi-dashboard-design            · subtitle + emerald/amber tone
 *
 * CLARITY-GATE DECISIONS (resolved before coding)
 *   · Loading state → render a short shimmer line · not full skeleton
 *   · GatewayPill rendered separately in the hub header → don't duplicate
 *   · Recovery banner takes priority over scheduled-due CTA · idle $ is
 *     a higher-leverage signal than "a few sends are due now"
 *   · Action line stays HIDDEN when there's no real signal · empty
 *     "all clear" is OK but only if we know enough to say it confidently
 */
import { trpc } from "@/lib/trpc";
import { MessageSquare, Activity, AlertTriangle, ArrowRight, Send } from "lucide-react";

interface OutreachBriefProps {
  /** Click handler for the recovery CTA · jumps the operator to the Settings → shopdriver tab. */
  onRecoveryAction: () => void;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Late shift";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Afternoon";
  return "Good evening";
}

export function OutreachBrief({ onRecoveryAction }: OutreachBriefProps) {
  const { data: reviewStats } = trpc.reviewRequests.stats.useQuery(undefined, { staleTime: 60_000 });
  const { data: campaignStats } = trpc.campaigns.stats.useQuery(undefined, { staleTime: 60_000 });
  const { data: recovery } = trpc.shopdriver.declinedRecoveryStatus.useQuery(undefined, { staleTime: 60_000 });
  const { data: gw } = trpc.sms.gatewayHealth.useQuery(undefined, { staleTime: 60_000 });

  const reviewsPending = reviewStats?.pending ?? 0;
  const activeCampaigns = campaignStats?.activeCampaigns ?? 0;
  const totalCampaigns = campaignStats?.totalCampaigns ?? 0;
  const totalSentReviews = reviewStats?.sent ?? 0;
  const totalSentCampaigns = campaignStats?.totalSent ?? 0;
  const gwOnline = gw?.online ?? false;

  const recoveryDryRun = recovery?.dryRun ?? false;
  // `?? 0` here is what let a DB outage read as "nothing to recover". The
  // server now returns null for unknown, so keep it null and branch on it —
  // coalescing to 0 immediately throws that distinction away again.
  const recoveryUnknown = recovery?.recoverableDollars == null;
  const recoveryDollars = recovery?.recoverableDollars ?? 0;
  const recoveryCount = recovery?.eligible ?? 0;

  // Clarity-gate · loading state · don't render fake numbers.
  // wave-181.x bug-fix · agent code-review caught `&&` vs `||` here.
  // `&&` would hide the shimmer the moment the fastest query (gateway)
  // resolved, leaking a false-zero "no scheduled work" line during
  // initial page load. All three signal-bearing queries must resolve
  // before we trust Line 1 + Line 3 · `gw` is cosmetic and excluded.
  if (!reviewStats || !campaignStats || !recovery) {
    return (
      <div className="bg-card border border-border/40 p-4">
        <div className="text-[11px] font-bold tracking-[0.18em] uppercase text-foreground/30 animate-pulse">
          Loading outreach state…
        </div>
      </div>
    );
  }

  // Compose Line 1 fragments — only show what's > 0 (clarity-gate)
  const queueParts: string[] = [];
  if (reviewsPending > 0) queueParts.push(`${reviewsPending} review request${reviewsPending === 1 ? "" : "s"} pending`);
  if (activeCampaigns > 0) queueParts.push(`${activeCampaigns} campaign${activeCampaigns === 1 ? "" : "s"} active`);
  if (queueParts.length === 0) queueParts.push("no scheduled work right now");

  const totalSentLifetime = totalSentReviews + totalSentCampaigns;

  // Action line · top priority is dry-run declined-recovery with $ idle
  const showRecoveryBanner = !recoveryUnknown && recoveryDryRun && recoveryDollars >= 100;
  // Surfaced separately so an unreadable recovery status is VISIBLE rather than
  // silently collapsing the banner (which reads as "no work waiting").
  const showRecoveryUnknown = recoveryUnknown;

  return (
    <div className="bg-card border border-border/40 p-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold tracking-[0.18em] uppercase text-foreground/45">
          {greeting()} · outreach brief
        </span>
        <span className="text-[10px] tracking-wider text-foreground/30">
          {totalCampaigns.toLocaleString()} campaigns lifetime
        </span>
      </div>
      <div className="space-y-1.5">
        {/* Line 1 · queue */}
        <div className="flex items-center gap-2.5">
          <MessageSquare className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <span className="text-[12.5px] text-foreground/85 leading-tight">
            Queue · {queueParts.join(" · ")}
          </span>
        </div>

        {/* Line 2 · live · gateway + lifetime send count */}
        <div className="flex items-center gap-2.5">
          <Activity className={`w-3.5 h-3.5 shrink-0 ${gwOnline ? "text-emerald-400" : "text-amber-400"}`} />
          <span className="text-[12.5px] text-foreground/85 leading-tight">
            Live · F25e shop gateway {gwOnline ? "online" : "offline (Twilio fallback active)"}
            {totalSentLifetime > 0 ? ` · ${totalSentLifetime.toLocaleString()} customer touches sent lifetime` : ""}
          </span>
        </div>

        {/* Unknown is NOT clear. Before this, an unreadable recovery status made
            the action banner vanish, and the brief read "no scheduled work right
            now" — the same thing it says when there genuinely is none. */}
        {showRecoveryUnknown && (
          <div className="flex items-center gap-2.5 -mx-2 px-2 py-1">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400/70 shrink-0" />
            <span className="text-[12.5px] text-amber-200/70 leading-tight">
              Recovery status unavailable — could not read declined estimates. This is not "nothing to recover".
            </span>
          </div>
        )}

        {/* Line 3 · action · only render when there's real signal */}
        {showRecoveryBanner ? (
          <button
            type="button"
            onClick={onRecoveryAction}
            className="flex items-center gap-2.5 w-full text-left hover:bg-amber-500/[0.04] -mx-2 px-2 py-1 rounded transition-colors group"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-[12.5px] text-amber-300 leading-tight flex-1">
              Action · <span className="font-semibold">${recoveryDollars.toLocaleString()}</span> in walked-away estimates idle ({recoveryCount} customers) · declined-recovery cron is DRY-RUN · one Railway env flag away from live
            </span>
            <span className="text-[10px] text-amber-400/60 tracking-wider group-hover:text-amber-400 transition-colors whitespace-nowrap">
              SEE STATUS <ArrowRight className="w-3 h-3 inline-block -mt-0.5" />
            </span>
          </button>
        ) : !recoveryDryRun && recoveryCount > 0 ? (
          <div className="flex items-center gap-2.5">
            <Send className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="text-[12.5px] text-foreground/85 leading-tight">
              Action · declined-recovery cron LIVE · {recoveryCount} customer{recoveryCount === 1 ? "" : "s"} in active sequence
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
