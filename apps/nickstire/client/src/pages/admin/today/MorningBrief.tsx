/**
 * MorningBrief — wave-181.x · Today page Phase 2.
 *
 * The "what happened while I was asleep" header. Operator wakes up, opens
 * /admin (lands on Today), reads 3 lines → knows what overnight delivered
 * and where to look first.
 *
 * COMPOSITION (3 signal lines, each <120 chars)
 *   1. Yesterday's CLOSE: revenue + invoice count + best signal
 *      "Yesterday: $1,720 · 4 invoices · top: brake job $487"
 *   2. OVERNIGHT signal: AI call activity + gateway state
 *      "Overnight: Nick handled 3 calls · 1 booked · 2 lost · F25e online"
 *   3. MORNING priority: most-urgent item OR "all clear"
 *      "Now: 2 urgent leads · 1 callback overdue 4h+ · 7 SEO bleeders"
 *
 * DEGRADATION
 *   · No yesterday data → "Quiet start" line
 *   · No overnight activity → skip line entirely
 *   · No priorities → "all clear" green line
 *
 * NO NEW SERVER WORK · all data composes from existing tRPC queries.
 *
 * COOL FEATURES STOLEN FROM SKILLS
 *   · morning-brief / daily-briefing · 3-line auto-summary structure
 *   · clarity-gate · only render when there's real signal to convey
 *   · observability-engineer · gateway state inline (not buried in Settings)
 */
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Phone, AlertTriangle, CheckCircle2 } from "lucide-react";


interface MorningBriefProps {
  /** Number of items currently in the priority action queue */
  priorityQueueLength: number;
  /** Number of urgent leads (subset of hot leads) */
  urgentLeads: number;
}

/** Time-of-day greeting */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Late shift";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Afternoon";
  return "Good evening";
}

export function MorningBrief({ priorityQueueLength, urgentLeads }: MorningBriefProps) {
  // Existing queries that already render elsewhere · cheap to reuse
  const { data: dashStats } = trpc.adminDashboard.stats.useQuery(undefined, { staleTime: 60_000 });
  const { data: smsGw } = trpc.sms.gatewayHealth.useQuery(undefined, { staleTime: 60_000 });
  const { data: callsData } = trpc.vapi.recentCalls.useQuery({ limit: 30 }, { staleTime: 120_000 });

  const lines = useMemo<{ icon: React.ReactNode; text: string; tone: "good" | "warn" | "info" }[]>(() => {
    const out: { icon: React.ReactNode; text: string; tone: "good" | "warn" | "info" }[] = [];

    // Line 1 · THIS WEEK'S CLOSE
    // adminDashboard.stats doesn't expose yesterday-specific numbers ·
    // use week-to-date as the operator's "what closed since I last
    // looked" anchor (covers Monday-morning use case too).


    // Line 2 · OVERNIGHT SIGNAL (last 24h VAPI calls)
    const calls = callsData?.calls ?? [];
    const now = Date.now();
    const ovr = calls.filter((c) => {
      const t = c.startedAt ? new Date(c.startedAt).getTime() : 0;
      return t && now - t <= 24 * 60 * 60 * 1000;
    });
    if (ovr.length > 0) {
      const booked = ovr.filter((c) => c.structuredData?.outcome === "booked").length;
      const lost = ovr.filter((c) => c.structuredData?.outcome === "lost").length;
      const escalated = ovr.filter((c) => c.structuredData?.outcome === "escalated").length;
      const parts: string[] = [`Nick handled ${ovr.length} call${ovr.length === 1 ? "" : "s"}`];
      if (booked > 0) parts.push(`${booked} booked`);
      if (lost > 0) parts.push(`${lost} lost`);
      if (escalated > 0) parts.push(`${escalated} escalated`);
      // Three states, never two: `smsGw` UNDEFINED (query failed or still
      // loading) used to print "F25e live" — fabricated gateway liveness in
      // the one sentence the operator reads first every morning.
      const gwState = smsGw?.online === false ? "F25e OFFLINE" : smsGw?.online === true ? "F25e live" : "F25e status unknown";
      parts.push(gwState);
      out.push({
        icon: <Phone className="w-3.5 h-3.5 text-blue-400" />,
        text: `Last 24h: ${parts.join(" · ")}`,
        tone: smsGw?.online === false ? "warn" : "good",
      });
    } else if (smsGw?.online === false) {
      // Quiet night + gateway down: the OFFLINE warning used to be gated
      // behind "there were calls", so the one morning the SMS gateway died
      // silently the brief read all-clear. Surface it on its own line —
      // customer texts are NOT sending until the F25e phone is back.
      out.push({
        icon: <Phone className="w-3.5 h-3.5 text-blue-400" />,
        text: "Last 24h: no AI calls · F25e SMS gateway OFFLINE — customer texts are not sending",
        tone: "warn",
      });
    }

    // Line 3 · MORNING PRIORITY
    const priorityBits: string[] = [];
    if (urgentLeads > 0) priorityBits.push(`${urgentLeads} urgent lead${urgentLeads === 1 ? "" : "s"}`);
    if (priorityQueueLength > 0) priorityBits.push(`${priorityQueueLength} in queue`);
    if (priorityBits.length > 0) {
      out.push({
        icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />,
        text: `Now: ${priorityBits.join(" · ")}`,
        tone: "warn",
      });
    } else {
      out.push({
        icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />,
        text: "Now: all clear · no pending actions",
        tone: "good",
      });
    }

    return out;
  }, [dashStats, smsGw, callsData, priorityQueueLength, urgentLeads]);

  return (
    <div className="bg-card border border-border/40 p-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold tracking-[0.18em] uppercase text-foreground/45">
            {greeting()} · daily brief
          </span>
        </div>
        <span className="text-[10px] tracking-wider text-foreground/30">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
        </span>
      </div>
      <div className="space-y-1.5">
        {lines.map((line, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <span className="shrink-0">{line.icon}</span>
            <span
              className={`text-[12.5px] leading-tight ${
                line.tone === "good"
                  ? "text-foreground/85"
                  : line.tone === "warn"
                    ? "text-amber-300"
                    : "text-foreground/50"
              }`}
            >
              {line.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
