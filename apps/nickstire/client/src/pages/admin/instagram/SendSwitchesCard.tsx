/**
 * Send switches: the five send_pause_<lane> flags that stop unattended calls and texts, on the
 * operator's phone.
 *
 * Consumer of contract sendSwitchesStatus v1 (instagramAdmin.sendSwitchesStatus) and the existing
 * featureFlags.toggle. TRUE = paused. Three chip states, never two: a switch the server could not
 * read (paused null or readable false), a lane missing from the response and a failed query are all
 * Unknown, in words, and never Live. Pause stays available on an Unknown lane. Pause is one tap
 * (the safe direction); Resume asks first through confirmDialog with the flagPolicy copy, because
 * window.confirm is suppressed in the iOS standalone PWA. A toggle error is shown under its row
 * and never moves the chip: only a refetched read does.
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import { confirmationCopy } from "@shared/flagPolicy";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// heldQueued is the additive v1.1 field (texts held by the pause): number, null = unknown, absent = lane without a queue.
type LaneEntry = RouterOutputs["instagramAdmin"]["sendSwitchesStatus"]["lanes"][number] & { heldQueued?: number | null };

/** The server caches a switch for 5 s, so a read right after a toggle can still be the old value. */
const REREAD_MS = 6000;

// The five lanes are fixed, so their fail class is kept here too (server SEND_PAUSE_LANES): a failed
// query or a lane missing from the response must still say whether a failed read holds that lane.
const LANES = [
  { lane: "voice_outbound", label: "Outbound calls", failClass: "closed" },
  { lane: "customer_confirmations", label: "Order confirmations", failClass: "open" },
  { lane: "declined_recovery", label: "Declined-work follow-ups", failClass: "closed" },
  { lane: "weather_sms", label: "Weather texts", failClass: "closed" },
  { lane: "missed_call_recovery", label: "Missed-call texts", failClass: "closed" },
] as const;

const TONE = {
  Live: "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-500",
  Paused: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-500",
  Unknown: "border-dashed border-muted-foreground/40 text-muted-foreground",
} as const;

type ChipState = keyof typeof TONE;

function chipState(e: LaneEntry | undefined): ChipState {
  if (!e || e.paused === null || !e.readable) return "Unknown";
  return e.paused ? "Paused" : "Live";
}

const envLine = (e: LaneEntry | undefined) => (e?.envArmed === true ? "env armed" : e?.envArmed === false ? "env off" : "env unknown");

function unknownNote(failClass: "closed" | "open"): string {
  const base = "This switch could not be read, state unknown.";
  return failClass === "closed"
    ? `${base} A failed read holds this lane's automatic sends until it reads.`
    : `${base} A failed read does not hold this lane, so confirmations keep sending.`;
}

const QUEUE_LINE = "Texts queued before or during the pause send on resume.";

function resumeNote(e: LaneEntry | undefined): string {
  if (e?.heldQueued === undefined) return QUEUE_LINE;
  if (e.heldQueued === null) return `${QUEUE_LINE} Check first: queued count unknown.`;
  return `${QUEUE_LINE} ${e.heldQueued} queued ${e.heldQueued === 1 ? "text" : "texts"} will send now.`;
}

type RowProps = { lane: string; label: string; failClass: "closed" | "open"; entry: LaneEntry | undefined; onSettled: () => void };

function LaneRow({ lane, label, failClass, entry, onSettled }: RowProps) {
  const flag = `send_pause_${lane}`;
  const [error, setError] = useState<string | null>(null);
  const toggle = trpc.featureFlags.toggle.useMutation({
    onSuccess: () => setError(null),
    onError: (err, vars) => setError(`${vars.value ? "Pause" : "Resume"} failed: ${err.message}`),
    onSettled,
  });

  const state = chipState(entry);
  const paused = state === "Paused";

  const onClick = async () => {
    if (paused) {
      const copy = confirmationCopy(flag, false);
      const message = `${copy.message} ${resumeNote(entry)}`;
      const ok = await confirmDialog({ ...copy, message, tone: "danger" });
      if (!ok) return;
    }
    toggle.mutate({ key: flag, value: !paused });
  };

  return (
    <li className="flex min-w-0 flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{label}</span>
        <Badge variant="outline" className={TONE[state]}>{state}</Badge>
      </div>
      <p className="text-muted-foreground">{envLine(entry)}</p>
      {state === "Unknown" && <p className="break-words text-muted-foreground">{unknownNote(entry?.failClass ?? failClass)}</p>}
      {error && <p role="alert" className="break-words rounded-md border border-border p-3">{error}</p>}
      <Button
        variant="outline"
        aria-label={`${paused ? "Resume" : "Pause"} ${label}`}
        onClick={onClick}
        disabled={toggle.isPending}
        className="min-h-12 w-full text-base sm:w-auto sm:self-start"
      >
        {paused ? "Resume" : "Pause"}
      </Button>
    </li>
  );
}

export function SendSwitchesCard() {
  const q = trpc.instagramAdmin.sendSwitchesStatus.useQuery();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Read again now, and once more after the server's cache window. The chip only ever follows a read.
  const reread = () => {
    q.refetch();
    timers.current.push(setTimeout(() => q.refetch(), REREAD_MS));
  };

  if (q.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Send switches</CardTitle>
          <CardDescription className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // A thrown query leaves no trustworthy state, even if stale data is cached: every row reads as Unknown.
  const lanes = q.isError ? [] : q.data?.lanes ?? [];
  const entries = LANES.map((l) => ({ ...l, entry: lanes.find((x) => x.lane === l.lane) }));
  const anyUnknown = entries.some((e) => chipState(e.entry) === "Unknown");

  return (
    <Card className={anyUnknown ? "border-amber-500/40" : undefined}>
      <CardHeader className="pb-3">
        <CardTitle>Send switches</CardTitle>
        {q.isError || !q.data ? (
          <div className="flex items-start gap-2 text-base text-amber-700 dark:text-amber-500">
            <AlertTriangle className="mt-1 h-4 w-4 shrink-0" />
            <span>Send switch state could not be read, state unknown</span>
          </div>
        ) : null}
        <CardDescription>Pause or resume each automatic send lane. A paused lane skips its next send.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-base">
        <ul className="divide-y divide-border">
          {entries.map((e) => (
            <LaneRow key={e.lane} lane={e.lane} label={e.label} failClass={e.failClass} entry={e.entry} onSettled={reread} />
          ))}
        </ul>
        {anyUnknown && (
          <Button variant="outline" onClick={() => q.refetch()} className="min-h-12 w-full text-base sm:w-auto">
            <RefreshCw className="mr-2 h-4 w-4" /> Retry
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
