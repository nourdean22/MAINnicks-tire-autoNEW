/**
 * Image autopost: the unattended Instagram image lane, on the operator's phone.
 *
 * Consumer of contract autopostLaneStatus v1.1 (instagramAdmin.autopostLaneStatus),
 * the background run door (instagramAdmin.startAutopostRun) and the inverted pause
 * flag (featureFlags key ig_autopost_paused). Three states, never two: a failed read
 * is "state unknown, not empty", a read with no runs is "not recorded yet", and
 * only a successful read with rows shows counts. The pause switch stays on the
 * error card whenever the server could still read the flag.
 *
 * A manual run takes minutes, longer than the gateway timeout, so the card only
 * starts it; it then polls the status while manualRun.inFlight and reads the result
 * from the newest admin row written after the start.
 *
 * Run now and Resume ask first through confirmDialog, because both can post to
 * Instagram (window.confirm is suppressed in the iOS standalone PWA). Pause is
 * one tap: it is the safe direction.
 */
import { useState } from "react";
import { AlertTriangle, ImageIcon, Loader2, RefreshCw } from "lucide-react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type LaneStatus = RouterOutputs["instagramAdmin"]["autopostLaneStatus"];
type Measured = Extract<LaneStatus, { available: true }>;
type RecentRow = Measured["recent"][number];

const PAUSE_FLAG = "ig_autopost_paused";

/** superjson sends a Date, but a string must not render "Invalid Date". */
function when(v: Date | string): string {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
  });
}

const statusWord = (s: string) => (s === "dryrun" ? "dry run" : s);

const ms = (v: Date | string) => (v instanceof Date ? v : new Date(v)).getTime();

const resultLine = (r: RecentRow) =>
  `Manual run finished: ${statusWord(r.status)}${r.igPostId ? `, post ${r.igPostId}` : ""}${r.error ? `: ${r.error}` : ""}`;

function stateChip(s: Measured): { label: string; tone: string } {
  if (s.paused === null) return { label: "Unknown", tone: "border-dashed border-muted-foreground/40 text-muted-foreground" };
  if (s.paused) return { label: "Paused", tone: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-500" };
  if (s.live === null) return { label: "Unknown", tone: "border-dashed border-muted-foreground/40 text-muted-foreground" };
  if (s.live) return { label: "Live", tone: "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-500" };
  return { label: "Dry run", tone: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400" };
}

export function ImageAutopostCard() {
  const q = trpc.instagramAdmin.autopostLaneStatus.useQuery(undefined, {
    refetchInterval: (query) => (query.state.data?.available && query.state.data.manualRun.inFlight ? 15_000 : false),
  });
  const [note, setNote] = useState<string | null>(null);
  // The run this screen started: server start time (rows after it are its result) and
  // client time (a read fetched before it still shows the pre-start state).
  const [started, setStarted] = useState<{ server: number; client: number } | null>(null);

  const run = trpc.instagramAdmin.startAutopostRun.useMutation({
    onSuccess: (r) => {
      if (r.started) {
        setStarted({ server: ms(r.startedAt), client: Date.now() });
        setNote(`Run started ${when(r.startedAt)}; the result appears in the history`);
      } else {
        setNote(`Run not started: ${r.refusal}`);
      }
    },
    onError: (err) => setNote(`The start request failed: ${err.message}. Refresh to see whether a run is in flight.`),
    onSettled: () => q.refetch(),
  });
  const toggle = trpc.featureFlags.toggle.useMutation({
    onSuccess: (r) => setNote(r.value ? "Lane paused. The cron will skip its slots." : "Lane resumed."),
    onError: (err) => setNote(`Pause switch failed: ${err.message}`),
    onSettled: () => q.refetch(),
  });

  const s = q.data;

  const onToggle = async (paused: boolean | null) => {
    if (paused === null) return;
    if (paused) {
      const ok = await confirmDialog({
        title: "Resume the image lane?",
        message: "Resuming lets the cron post to Instagram and the Facebook Page unattended at the next slot (8:07, 13:07 or 20:07 ET).",
        confirmLabel: "Resume",
        tone: "danger",
      });
      if (!ok) return;
    }
    toggle.mutate({ key: PAUSE_FLAG, value: !paused });
  };

  const pauseButton = (paused: boolean | null, disabled: boolean) => (
    <Button variant="outline" onClick={() => onToggle(paused)} disabled={disabled || paused === null} className="min-h-11 text-base">
      {paused ? "Resume lane" : "Pause lane"}
    </Button>
  );
  const pauseUnknown = <p className="text-muted-foreground">Pause state unknown until a refresh reads it.</p>;

  const noteLine = note && <p role="status" className="break-words rounded-md border border-border p-3">{note}</p>;

  if (q.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4" /> Image autopost
          </CardTitle>
          <CardDescription className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // ERROR: a failed read is not an empty lane. Never fall through to counts.
  if (q.isError || !s || !s.available) {
    // A thrown query leaves no trustworthy pause state, even if stale data is cached.
    const paused = !q.isError && s && !s.available ? s.paused : null;
    return (
      <Card className="border-amber-500/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4" /> Image autopost
          </CardTitle>
          <div className="flex items-start gap-2 text-base text-amber-700 dark:text-amber-500">
            <AlertTriangle className="mt-1 h-4 w-4 shrink-0" />
            <span>Image autopost state could not be read, state unknown, not empty</span>
          </div>
          {s && !s.available && <CardDescription className="break-words">Reason: {s.reason}</CardDescription>}
        </CardHeader>
        <CardContent className="space-y-2 text-base">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => q.refetch()} className="min-h-11 text-base">
              <RefreshCw className="mr-2 h-4 w-4" /> Retry
            </Button>
            {pauseButton(paused, toggle.isPending)}
          </div>
          {paused === null && pauseUnknown}
          {noteLine}
        </CardContent>
      </Card>
    );
  }

  const chip = stateChip(s);
  const busy = run.isPending || toggle.isPending;
  const inFlight = s.manualRun.inFlight;
  const finished =
    started !== null && !inFlight && q.dataUpdatedAt >= started.client
      ? (s.recent.find((r) => r.source === "admin" && ms(r.createdAt) >= started.server) ?? null)
      : undefined;

  const onRunNow = async () => {
    const mode =
      s.live === true
        ? "This posts to Instagram and the Facebook Page now."
        : s.live === false
          ? "This is a dry run: it generates and sends a Telegram preview, nothing is posted."
          : "Whether this posts live or dry-runs could not be read.";
    const ok = await confirmDialog({
      title: "Run a slot now?",
      message: `${mode} The lane's pause does not stop a manual run.`,
      confirmLabel: "Run it",
      tone: s.live === false ? "default" : "danger",
    });
    if (ok) run.mutate({});
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4" /> Image autopost
          </CardTitle>
          <Badge variant="outline" className={chip.tone}>{chip.label}</Badge>
        </div>
        <CardDescription>Posts images to Instagram and the Facebook Page on a schedule, with no one reviewing them first.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-base">
        {s.recent.length === 0 ? (
          <p className="text-muted-foreground">
            No autopost run recorded yet. The next slot window is 8:07, 13:07 or 20:07 ET.
          </p>
        ) : (
          <>
            <div>
              <p className="font-medium">Last 7 days</p>
              <p className="tabular-nums">
                {`${s.counts7d.posted} posted of ${s.counts7d.runs} runs (${s.counts7d.failed} failed, ${s.counts7d.aborted} aborted, ${s.counts7d.dryrun} dry runs)`}
              </p>
            </div>

            <div>
              <p className="font-medium">Last posted</p>
              {s.lastPosted ? (
                <p className="break-words">
                  {s.lastPosted.slot} slot, {when(s.lastPosted.createdAt)}
                  {s.lastPosted.igPostId && (
                    <span className="text-muted-foreground"> (post {s.lastPosted.igPostId})</span>
                  )}
                </p>
              ) : (
                <p className="text-muted-foreground">Nothing has posted in the recorded history.</p>
              )}
            </div>

            <div>
              <p className="font-medium">Today</p>
              {s.today.length === 0 ? (
                <p className="text-muted-foreground">No slot has run today yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {s.today.map((t, i) => (
                    <li key={`${t.slot}-${i}`} className="min-w-0">
                      <span className="tabular-nums">{t.slot}: {statusWord(t.status)}</span>
                      {/* 2 lines is about 80 characters at 390 px; enough to name the cause. */}
                      {t.error && <p className="line-clamp-2 break-words text-muted-foreground">{t.error}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <details className="group">
              <summary className="flex min-h-11 cursor-pointer items-center rounded-md font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                Last 20 runs
              </summary>
              <ul className="mt-1 divide-y divide-border">
                {s.recent.map((r) => (
                  <li key={r.id} className="min-w-0 py-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span>{r.slot}, {when(r.createdAt)}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {statusWord(r.status)}
                        {r.overallScore !== null && `, score ${r.overallScore.toFixed(1)}`}
                      </span>
                    </div>
                    {r.igPostId && <p className="break-all text-muted-foreground">Post {r.igPostId}</p>}
                    {r.error && <p className="line-clamp-2 break-words text-muted-foreground">{r.error}</p>}
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={onRunNow} disabled={busy || inFlight} className="min-h-11 text-base">
            {run.isPending ? "Starting a run..." : "Run a slot now"}
          </Button>
          {pauseButton(s.paused, busy)}
        </div>
        {s.paused === null && pauseUnknown}
        {inFlight && (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            <span>Run in flight since {s.manualRun.startedAt ? when(s.manualRun.startedAt) : "an unrecorded time"}</span>
          </p>
        )}
        {noteLine}
        {finished && <p role="status" className="break-words rounded-md border border-border p-3">{resultLine(finished)}</p>}
        {finished === null && (
          <p role="status" className="break-words rounded-md border border-border p-3">
            The run is no longer in flight, and no result row was recorded for it. A server restart clears the run marker; check the history.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
