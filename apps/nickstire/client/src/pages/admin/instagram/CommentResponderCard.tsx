/**
 * Comment responder: the unattended public replies to reel comments, on the operator's phone.
 *
 * Consumer of contract commentResponderStatus v1 (instagramAdmin.commentResponderStatus)
 * and the inverted pause flag (featureFlags key reel_comment_responder_paused). Three
 * states, never two: a failed read is "state unknown, not empty", a read with no audit
 * rows is "not recorded yet", and only a read with rows shows counts. The pause switch
 * stays on the error card whenever the server could still read the flag.
 *
 * There is no run-now button: the responder has no manual door, it runs on its pulse.
 * Resume asks first through confirmDialog, because it lets the responder post in public
 * (window.confirm is suppressed in the iOS standalone PWA). Pause is one tap: it is the
 * safe direction. The audit rows carry only our reply text, never the customer's comment.
 */
import { useState } from "react";
import { AlertTriangle, Loader2, MessageCircle, RefreshCw } from "lucide-react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import { confirmationCopy } from "@shared/flagPolicy";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ResponderStatus = RouterOutputs["instagramAdmin"]["commentResponderStatus"];
type Measured = Extract<ResponderStatus, { available: true }>;

const PAUSE_FLAG = "reel_comment_responder_paused";

/** superjson sends a Date, but a string must not render "Invalid Date". */
function when(v: Date | string): string {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
  });
}

const DECISION_WORD: Record<string, string> = { POSTED: "posted", FAILED: "failed", DRY_RUN: "dry run" };
const decisionWord = (d: string) => DECISION_WORD[d] ?? d;

const MUTED = "border-dashed border-muted-foreground/40 text-muted-foreground";
const AMBER = "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-500";
const GREEN = "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-500";
const BLUE = "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400";

function chips(s: Measured): Array<{ label: string; tone: string }> {
  const out = [
    s.enabled ? { label: "Enabled", tone: "border-border text-foreground" } : { label: "Disabled", tone: MUTED },
    s.live ? { label: "Live", tone: GREEN } : { label: "Dry run", tone: BLUE },
  ];
  if (s.paused === true) out.push({ label: "Paused", tone: AMBER });
  if (s.paused === null) out.push({ label: "Unknown", tone: MUTED });
  return out;
}

const Title = () => (
  <CardTitle className="flex items-center gap-2">
    <MessageCircle className="h-4 w-4" /> Comment responder
  </CardTitle>
);

export function CommentResponderCard() {
  const q = trpc.instagramAdmin.commentResponderStatus.useQuery();
  const [note, setNote] = useState<string | null>(null);

  const toggle = trpc.featureFlags.toggle.useMutation({
    onSuccess: (r) => setNote(r.value ? "Replies paused. The next pulse will skip." : "Replies resumed."),
    onError: (err) => setNote(`Pause switch failed: ${err.message}`),
    onSettled: () => q.refetch(),
  });

  const s = q.data;

  const onToggle = async (paused: boolean | null) => {
    if (paused === null) return;
    if (paused) {
      const ok = await confirmDialog({ ...confirmationCopy(PAUSE_FLAG, false), tone: "danger" });
      if (!ok) return;
    }
    toggle.mutate({ key: PAUSE_FLAG, value: !paused });
  };

  const pauseButton = (paused: boolean | null) => (
    <Button
      variant="outline"
      onClick={() => onToggle(paused)}
      disabled={toggle.isPending || paused === null}
      className="min-h-12 text-base"
    >
      {paused ? "Resume replies" : "Pause replies"}
    </Button>
  );
  const pauseUnknown = <p className="text-muted-foreground">Pause state unknown until a refresh reads it.</p>;
  const noteLine = note && <p role="status" className="break-words rounded-md border border-border p-3">{note}</p>;

  if (q.isLoading) {
    return (
      <Card>
        <CardHeader>
          <Title />
          <CardDescription className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // ERROR: a failed read is not an idle responder. Never fall through to counts.
  if (q.isError || !s || !s.available) {
    // A thrown query leaves no trustworthy pause state, even if stale data is cached.
    const paused = !q.isError && s && !s.available ? s.paused : null;
    return (
      <Card className="border-amber-500/40">
        <CardHeader>
          <Title />
          <div className="flex items-start gap-2 text-base text-amber-700 dark:text-amber-500">
            <AlertTriangle className="mt-1 h-4 w-4 shrink-0" />
            <span>Comment responder state could not be read, state unknown, not empty</span>
          </div>
          {s && !s.available && <CardDescription className="break-words">Reason: {s.reason}</CardDescription>}
        </CardHeader>
        <CardContent className="space-y-2 text-base">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => q.refetch()} className="min-h-12 text-base">
              <RefreshCw className="mr-2 h-4 w-4" /> Retry
            </Button>
            {pauseButton(paused)}
          </div>
          {paused === null && pauseUnknown}
          {noteLine}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Title />
          <div className="flex flex-wrap gap-1.5">
            {chips(s).map((c) => (
              <Badge key={c.label} variant="outline" className={c.tone}>{c.label}</Badge>
            ))}
          </div>
        </div>
        <CardDescription>Posts public replies to comments on recent reels, with no one reviewing them first.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-base">
        <div>
          <p className="font-medium">Last run</p>
          {s.lastRun ? (
            <>
              <p className="tabular-nums">{when(s.lastRun.startedAt)}, {s.lastRun.status}</p>
              {/* 3 lines is about 120 characters at 390 px: the run summary or the skip reason. */}
              <p className="line-clamp-3 break-words text-muted-foreground">{s.lastRun.details}</p>
            </>
          ) : (
            <p className="text-muted-foreground">No run recorded yet.</p>
          )}
        </div>

        {s.recentReplies.length === 0 ? (
          <p className="text-muted-foreground">
            No reply attempt recorded yet. The first one appears after the responder answers a comment on a recent reel.
          </p>
        ) : (
          <>
            <div>
              <p className="font-medium">Last 7 days</p>
              <p className="tabular-nums">
                {`${s.counts7d.posted} posted, ${s.counts7d.failed} failed, ${s.counts7d.dryRun} dry runs in 7 days`}
              </p>
            </div>

            <details className="group">
              <summary className="flex min-h-12 cursor-pointer items-center rounded-md font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                Last 20 reply attempts
              </summary>
              <ul className="mt-1 divide-y divide-border">
                {s.recentReplies.map((r) => (
                  <li key={r.id} className="min-w-0 py-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="tabular-nums">{decisionWord(r.decision)}, {when(r.occurredAt)}</span>
                      {r.tone && <span className="text-muted-foreground">{r.tone} tone</span>}
                    </div>
                    {/* 2 lines is about 80 characters at 390 px; enough to recognize the reply. */}
                    {r.replyText && <p className="line-clamp-2 break-words">{r.replyText}</p>}
                    {r.error && <p className="line-clamp-2 break-words text-muted-foreground">{r.error}</p>}
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">{pauseButton(s.paused)}</div>
        {s.paused === null && pauseUnknown}
        {noteLine}
      </CardContent>
    </Card>
  );
}
