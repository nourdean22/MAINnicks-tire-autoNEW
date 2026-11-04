/**
 * The /people header's two truth lines (W8b, 2026-11-03): how many proposals wait for his yes, and what the people
 * engine's last run did. Split out of app/(mastery)/people/page.tsx so every state is testable.
 */
import type { EngineLine as EngineLineData } from "@/app/api/people/route";
import { relativeTime } from "@/lib/utils/datetime";

export function SuggestionsWaiting({ count }: { count: number | undefined }) {
  if (!count || count < 1) return null;
  return (
    <span className="inline-flex min-h-[44px] items-center font-mono text-[12px] tabular-nums text-amber-300">
      {`· ${count} waiting for your yes`}
    </span>
  );
}

const WORDS: Record<EngineLineData["state"], string> = {
  ok: "proposed something",
  ran: "result not recorded (old format)",
  nothing_to_propose: "nothing to propose",
  partial: "no changes yet",
  failed: "failed",
  running: "running now",
  never: "has never run",
  unknown: "unknown (couldn't read the last run)",
};

export function EngineLine({ engine }: { engine: EngineLineData | undefined }) {
  const e: EngineLineData = engine ?? { state: "unknown", at: null, reason: null };
  const failed = e.state === "failed" || e.state === "unknown";
  const when = e.at && e.state !== "running" ? ` ${relativeTime(e.at)}` : "";
  const text =
    e.state === "never" || e.state === "unknown"
      ? `Engine ${WORDS[e.state]}.`
      : `Engine ran${when}: ${WORDS[e.state]}${e.reason ? ` (${e.reason})` : ""}.`;
  return (
    <p className={failed ? "mt-2 font-mono text-[11px] text-amber-200" : "mt-2 font-mono text-[11px] text-fg-tertiary"}>
      {text}
    </p>
  );
}
