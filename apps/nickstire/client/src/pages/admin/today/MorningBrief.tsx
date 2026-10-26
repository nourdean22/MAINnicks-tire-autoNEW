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
import { gatewayState } from "@/lib/gatewayState";
import { Phone, AlertTriangle, CheckCircle2 } from "lucide-react";


interface MorningBriefProps {
  /** Number of items currently in the priority action queue */
  priorityQueueLength: number;
  /** The board's count is a lower bound (more follow-ups wait in Sales Pipeline): print "N+", as the tile does. */
  queueAtLeast?: boolean;
  /** Number of urgent leads (subset of hot leads) */
  urgentLeads: number;
  /**
   * False when a source the queue is built from failed: the counts above are unknown, not zero.
   * Optional only so the gateway-reader tests that render the brief alone keep compiling; the one
   * production caller (OverviewSection) always passes it.
   */
  queueTrustworthy?: boolean;
  /**
   * Admin UI v1 W2: Today shows only the "Now:" verdict on top ("verdict") and moves the calls and
   * gateway line into its Checks rail ("signals"). Omitted, the brief renders everything.
   */
  part?: "verdict" | "signals";
}

/** Time-of-day greeting */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Late shift";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Afternoon";
  return "Good evening";
}

export function MorningBrief({ priorityQueueLength, queueAtLeast = false, urgentLeads, queueTrustworthy = true, part }: MorningBriefProps) {
  // Existing queries that already render elsewhere · cheap to reuse
  const { data: dashStats } = trpc.adminDashboard.stats.useQuery(undefined, { staleTime: 60_000 });
  const { data: smsGw, isError: smsGwError } = trpc.sms.gatewayHealth.useQuery(undefined, { staleTime: 60_000 });
  const { data: callsData } = trpc.vapi.recentCalls.useQuery({ limit: 30 }, { staleTime: 120_000 });

  const lines = useMemo<{ icon: React.ReactNode; text: string; tone: "good" | "warn" | "info"; now?: true }[]>(() => {
    const out: { icon: React.ReactNode; text: string; tone: "good" | "warn" | "info"; now?: true }[] = [];
    const gw = gatewayState(smsGw, smsGwError);

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
      // Never two states: `smsGw` UNDEFINED (query failed or still loading)
      // used to print "F25e live", fabricated gateway liveness in the one
      // sentence the operator reads first every morning. And a vendor API
      // failure (readable:false) is unknown, not the phone going OFFLINE.
      // `online === true` stays explicit: server/adminTruth.test.ts pins it.
      parts.push(gw === "online" && smsGw?.online === true ? "F25e live" : gw === "offline" ? "F25e OFFLINE" : gw === "not_configured" ? "F25e not configured" : "F25e status unknown");
      out.push({
        icon: <Phone className="w-3.5 h-3.5 text-blue-400" />,
        text: `Last 24h: ${parts.join(" · ")}`,
        tone: gw === "online" ? "good" : gw === "checking" ? "info" : "warn",
      });
    } else if (gw === "unknown") {
      // Quiet night + unreadable gateway: say so rather than read all-clear,
      // and do not call the phone OFFLINE when nobody could ask it.
      out.push({
        icon: <Phone className="w-3.5 h-3.5 text-blue-400" />,
        text: "Last 24h: no AI calls · F25e gateway status unknown, the status read failed",
        tone: "warn",
      });
    } else if (gw === "offline" || gw === "not_configured") {
      // Quiet night + gateway down: the OFFLINE warning used to be gated
      // behind "there were calls", so the one morning the SMS gateway died
      // silently the brief read all-clear. Surface it on its own line —
      // customer texts are NOT sending until the F25e phone is back.
      out.push({
        icon: <Phone className="w-3.5 h-3.5 text-blue-400" />,
        text: "Last 24h: no AI calls · F25e SMS gateway OFFLINE, customer texts are not sending",
        tone: "warn",
      });
    }

    // Line 3 · MORNING PRIORITY
    const priorityBits: string[] = [];
    if (urgentLeads > 0) priorityBits.push(`${urgentLeads} urgent lead${urgentLeads === 1 ? "" : "s"}`);
    if (priorityQueueLength > 0) priorityBits.push(`${priorityQueueLength}${queueAtLeast ? "+" : ""} in queue`);
    if (!queueTrustworthy) {
      out.push({
        icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />,
        text: "Now: queue unknown · a source read failed",
        tone: "warn",
        now: true,
      });
    } else if (priorityBits.length > 0) {
      out.push({
        icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />,
        text: `Now: ${priorityBits.join(" · ")}`,
        tone: "warn",
        now: true,
      });
    } else {
      out.push({
        icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />,
        text: "Now: all clear · no pending actions",
        tone: "good",
        now: true,
      });
    }

    return out;
  }, [dashStats, smsGw, smsGwError, callsData, priorityQueueLength, queueAtLeast, urgentLeads, queueTrustworthy]);

  const shown = part === "verdict" ? lines.filter((l) => l.now) : part === "signals" ? lines.filter((l) => !l.now) : lines;
  if (part === "signals" && shown.length === 0) return null;
  const textTone = (tone: "good" | "warn" | "info") =>
    tone === "good" ? "text-foreground/85" : tone === "warn" ? "text-amber-300" : "text-foreground/50";

  return (
    <div className={part ? "space-y-1.5" : "bg-card border border-border/40 p-4 space-y-2.5"}>
      {part !== "signals" && (
        <div className="flex items-center justify-between">
          <span className="eyebrow">{part === "verdict" ? greeting() : `${greeting()} · daily brief`}</span>
          <span className="text-[12px] text-muted-foreground">
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
          </span>
        </div>
      )}
      <div className="space-y-1.5">
        {shown.map((line, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <span className="shrink-0">{line.icon}</span>
            {/* On the board the verdict is plain text: gold belongs to the Needs action number, and
                amber is kept for the one verdict that is a warning, the unknown queue. */}
            <span className={`${part === "verdict" ? `text-[17px] font-medium ${queueTrustworthy ? "text-foreground" : "text-amber-300"}` : `text-[12.5px] ${textTone(line.tone)}`} leading-tight`}>
              {line.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
