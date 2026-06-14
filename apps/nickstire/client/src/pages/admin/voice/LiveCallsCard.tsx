import { trpc } from "@/lib/trpc";
import { ExternalLink } from "lucide-react";
import { VAPI_LINKS } from "./format";

// ─── wave-181.67 · Live in-flight calls (Phase 4 state machine) ──
// Reads the 5-state agent flow recorded by the state-tracker shipped
// in wave-181.63. Hides itself when zero calls are in flight so quiet
// hours stay visually clean. 5-second refetch · phone-friendly.
//
// State colors picked to read at-a-glance:
//   greeted          primary · just hello, waiting for intent
//   intent_captured  blue    · agent has read shop info / customer
//   tool_called      amber   · agent is writing (booking, callback)
//   confirmed        emerald · sendConfirmationSms fired · success
export function LiveCallsCard({ onSelectCall }: { onSelectCall: (callId: string) => void }) {
  const { data, isLoading } = trpc.vapi.activeCallStates.useQuery(
    { maxAgeMinutes: 10 },
    {
      // wave-181.x Voice Phase 1 · M4 fix · was 5_000 which is 12
      // queries/minute · with 3 admin tabs open = 36/min for a
      // mostly-zero-row response. activeCallStates IS a DB hit (not
      // cached). Bumped to 15_000 · still feels live for the
      // operator. refetchIntervalInBackground stays default (false)
      // so the background tab doesn't fire either.
      refetchInterval: 15_000,
      refetchOnWindowFocus: true,
    },
  );

  // Hide entire card when nothing's in flight · operator doesn't need
  // empty-state noise on quiet hours. The state-tracker still runs
  // continuously · the card just doesn't paint zero-state.
  if (isLoading) return null;
  if (!data || data.count === 0) return null;

  const stateOrder: Array<{
    key: "greeted" | "intent_captured" | "tool_called" | "confirmed";
    label: string;
    color: string;
  }> = [
    { key: "greeted", label: "Greeted", color: "primary" },
    { key: "intent_captured", label: "Intent", color: "blue" },
    { key: "tool_called", label: "Tool", color: "amber" },
    { key: "confirmed", label: "Confirmed", color: "emerald" },
  ];

  const colorClasses: Record<string, { bg: string; text: string; ring: string }> = {
    primary: { bg: "bg-primary/10", text: "text-primary", ring: "ring-primary/30" },
    blue: { bg: "bg-blue-500/10", text: "text-blue-300", ring: "ring-blue-500/30" },
    amber: { bg: "bg-amber-500/10", text: "text-amber-300", ring: "ring-amber-500/30" },
    emerald: { bg: "bg-emerald-500/10", text: "text-emerald-300", ring: "ring-emerald-500/30" },
  };

  return (
    // wave-181.x Voice Phase 2 · `voice-live-calls` id targets the
    // VoiceBrief stuck-calls action CTA (scrollIntoView + flash).
    <div id="voice-live-calls" className="border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
          <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
            Live calls
          </span>
          <span className="text-[10px] font-mono text-primary/70">
            {data.count} in flight · last {data.windowMinutes}m
          </span>
        </div>
      </div>

      {/* Counts-by-state strip · operator sees the funnel at a glance.
       * wave-181.x Voice mobile polish · was `grid-cols-4` which gave
       * each state pill ~80px on a 375px viewport · sub-AA legibility
       * for the `text-[9px]` state labels. 2-col on phone (`grid-cols-2
       * sm:grid-cols-4`) reflows to 2×2 with breathing room · still
       * 4-up on tablet+. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        {stateOrder.map((s) => {
          const n = data.byState[s.key] ?? 0;
          const c = colorClasses[s.color];
          return (
            <div
              key={s.key}
              className={`rounded-md px-2 py-1.5 ${c.bg} ring-1 ${c.ring}`}
            >
              <div className={`text-[9px] uppercase tracking-wider ${c.text} opacity-70`}>
                {s.label}
              </div>
              <div className={`text-[18px] font-bold leading-none mt-1 ${c.text}`}>
                {n}
              </div>
            </div>
          );
        })}
      </div>

      {/* Per-call list · short trail · operator can drill in via VAPI dashboard */}
      <div className="space-y-1">
        {data.states.map((s) => {
          const c = colorClasses[
            stateOrder.find((so) => so.key === s.latestState)?.color ?? "primary"
          ];
          return (
            <div
              key={s.callId}
              role="button"
              tabIndex={0}
              onClick={() => onSelectCall(s.callId)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectCall(s.callId); } }}
              className="flex items-center gap-2 px-2 py-1.5 rounded bg-card border border-border cursor-pointer hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-colors"
              aria-label={`Open call details for ${s.callId}`}
            >
              <span className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ${c.bg} ${c.text}`}>
                {(s.latestState || "").replace("_", " ")}
              </span>
              <span className="text-[10px] font-mono text-muted-foreground flex-1 truncate">
                {s.callId.slice(0, 16)}…
              </span>
              <span className="text-[10px] font-mono text-muted-foreground">
                {s.stateAgeSeconds < 60
                  ? `${s.stateAgeSeconds}s`
                  : `${Math.floor(s.stateAgeSeconds / 60)}m`}
              </span>
              {/* 2026-05-23 · whole row now opens the in-app CallDetailsDrawer
                  (matches the main calls table behavior immediately below).
                  External link stopPropagation so the VAPI dashboard link
                  still works without ALSO triggering the drawer. */}
              <a
                href={VAPI_LINKS.callDetail(s.callId)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-muted-foreground hover:text-primary transition-colors"
                title="Open in VAPI dashboard"
                aria-label="Open in VAPI dashboard (external)"
              >
                <ExternalLink size={11} />
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}
