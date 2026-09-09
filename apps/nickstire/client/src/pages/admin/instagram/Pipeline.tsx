/**
 * Pipeline — is the reel machine ok, and what is it about to post?
 *
 * WHY THIS VIEW EXISTS
 * Every number on this screen was reachable before and none of it was on a
 * screen. On 2026-09-09 the questions that decide whether this account posts at
 * all were answered by running ad-hoc SQL against production, one probe at a
 * time: is anything scheduled for tomorrow, how many finished reels are waiting,
 * which openings actually held viewers, what does a published reel cost, and are
 * the lanes that do the work still running.
 *
 * Two of those answers overturned things the operator believed. Thirty-two
 * finished reels looked like idle inventory and were in fact a scheduled queue
 * with no gaps for four weeks. And saves - the metric this account had been
 * judged on all year - are not a Reels ranking input at all, while skip rate,
 * which is one, had been collected since migration 0108 and never read.
 *
 * SO THE SCHEDULE STRIP COMES FIRST. The single most useful fact here is the
 * first day with nothing to post, because that is the day the account goes
 * quiet. It is a date, not a count, and a count cannot express it.
 *
 * READ-ONLY. Nothing here publishes, generates or spends; it is safe to leave
 * open and refresh.
 */
import { trpc } from "@/lib/trpc";
import {
  Loader2, CalendarDays, AlertTriangle, Activity, DollarSign,
  Eye, CheckCircle2, RefreshCw,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** Skip rate is a percentage where LOWER is better. Banded against this
 *  account's own measured corpus mean (66.4% on 2026-09-09), not against a
 *  published benchmark - no first-party benchmark for this exists. */
function skipTone(pct: number | null): string {
  if (pct === null) return "bg-muted text-muted-foreground border-border";
  if (pct < 55) return "bg-green-500/10 text-green-600 border-green-500/30";
  if (pct < 70) return "bg-amber-500/10 text-amber-600 border-amber-500/30";
  return "bg-red-500/10 text-red-600 border-red-500/30";
}

function dayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
}

export function Pipeline() {
  const q = trpc.instagramAdmin.reelPipelineHealth.useQuery({ windowDays: 30 });

  if (q.isLoading) {
    return (
      <div className="flex items-center gap-2 py-12 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Reading the pipeline…</span>
      </div>
    );
  }

  const d = q.data;

  // A dashboard that cannot read must SAY so. Rendering zeros here would look
  // exactly like a healthy-but-empty pipeline, which is the failure mode this
  // whole surface exists to end.
  if (!d || !d.available) {
    return (
      <Card className="border-amber-500/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="h-4 w-4" /> Pipeline state is UNKNOWN
          </CardTitle>
          <CardDescription>
            This is not "nothing is scheduled" — the read itself did not complete, so nothing below
            can be trusted. {d?.reason ? `Reason: ${d.reason}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => q.refetch()} className="min-h-11">
            <RefreshCw className="mr-2 h-4 w-4" /> Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  const laneTrouble = d.lanes.filter((l) => l.failed > 0);

  return (
    <div className="space-y-4">
      {/* ── 1. THE SCHEDULE. The first gap is the headline. ────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4" /> What posts next
              </CardTitle>
              <CardDescription>
                One reel a day. {d.daysCovered} of the next 30 days have a finished reel waiting.
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => q.refetch()} className="min-h-11">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {d.firstGap ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>
                <span className="font-medium text-amber-700 dark:text-amber-500">
                  Nothing scheduled for {d.firstGap}.
                </span>{" "}
                That is the day the account goes quiet unless the generator fills it.
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/10 p-3 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>Every one of the next 30 days has a reel ready.</span>
            </div>
          )}

          <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
            {d.schedule.map((day) => (
              <div
                key={day.date}
                title={`${day.date}${day.jobId ? ` · job ${day.jobId} · ${day.status}` : " · nothing scheduled"}`}
                className={[
                  "rounded border px-1 py-1.5 text-center text-[11px] leading-tight",
                  day.gap
                    ? "border-dashed border-muted-foreground/40 bg-muted/40 text-muted-foreground"
                    : day.status === "posted" || day.status === "published"
                      ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-500"
                      : "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400",
                ].join(" ")}
              >
                <div className="font-medium tabular-nums">{dayLabel(day.date)}</div>
                <div className="truncate opacity-80">{day.gap ? "—" : day.status === "assembled" ? "ready" : day.status}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── 2. HOOKS. Instagram's own measurement of the first 3 seconds. ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4" /> How the openings performed
          </CardTitle>
          <CardDescription>
            Instagram reports how many viewers leave inside three seconds, and watching less than
            three seconds is a named input to how Reels are ranked. Lower is better.
            {d.hooks.meanSkipPct !== null && (
              <> Across {d.hooks.sampleSize} published reels the average is{" "}
              <span className="font-medium text-foreground tabular-nums">{d.hooks.meanSkipPct}%</span>.</>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {d.hooks.sampleSize === 0 ? (
            <p className="text-sm text-muted-foreground">
              No published reel has a skip rate yet. This fills in once Instagram reports on a post.
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Held viewers
                </p>
                <ul className="space-y-2">
                  {d.hooks.best.map((h) => (
                    <li key={`${h.postId}-b`} className="flex items-start gap-2 text-sm">
                      <Badge variant="outline" className={`${skipTone(h.skipPct)} shrink-0 tabular-nums`}>
                        {h.skipPct?.toFixed(1)}%
                      </Badge>
                      <span className="min-w-0 flex-1 break-words">{h.hook ?? <em className="text-muted-foreground">brief unreadable</em>}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Lost viewers
                </p>
                <ul className="space-y-2">
                  {d.hooks.worst.map((h) => (
                    <li key={`${h.postId}-w`} className="flex items-start gap-2 text-sm">
                      <Badge variant="outline" className={`${skipTone(h.skipPct)} shrink-0 tabular-nums`}>
                        {h.skipPct?.toFixed(1)}%
                      </Badge>
                      <span className="min-w-0 flex-1 break-words">{h.hook ?? <em className="text-muted-foreground">brief unreadable</em>}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── 3. QUEUE + COST, side by side. ────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4" /> Queue
            </CardTitle>
            <CardDescription>Every reel job, by state.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {d.queue.map((row) => (
                <li key={row.status} className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{row.status}</span>
                  <span className="font-medium tabular-nums">{row.count}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-4 w-4" /> Cost per published reel
            </CardTitle>
            <CardDescription>
              All generation spend in the last {d.economics.windowDays} days over the reels that
              actually published — failures included, because they were paid for too.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tabular-nums">
              {d.economics.costPerPublishedUsd === null
                ? "—"
                : `$${d.economics.costPerPublishedUsd.toFixed(2)}`}
            </div>
            <p className="mt-1 text-sm text-muted-foreground tabular-nums">
              ${d.economics.estimatedSpendUsd.toFixed(2)} spent · {d.economics.posted} published
            </p>
            {d.economics.costPerPublishedUsd === null && (
              <p className="mt-2 text-sm text-amber-600">
                Nothing published in this window, so there is no denominator — not a cost of zero.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── 4. LANES. Is the machinery running at all? ───────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            {laneTrouble.length ? (
              <AlertTriangle className="h-4 w-4 text-amber-600" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            )}
            Lanes, last 7 days
          </CardTitle>
          <CardDescription>
            The three scheduled jobs that generate, assemble and publish. A lane that stops is a
            lane nothing announces.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {d.lanes.map((lane) => (
              <li key={lane.name} className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{lane.name}</span>
                  {lane.runs === 0 ? (
                    <Badge variant="outline" className="border-muted-foreground/40 text-muted-foreground">
                      no runs recorded
                    </Badge>
                  ) : lane.failed > 0 ? (
                    <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600 tabular-nums">
                      {lane.failed} failed of {lane.runs}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-green-500/30 bg-green-500/10 text-green-600 tabular-nums">
                      {lane.runs} clean
                    </Badge>
                  )}
                </div>
                {lane.lastDetail && (
                  <p className="break-words text-xs text-muted-foreground">{lane.lastDetail.slice(0, 160)}</p>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <p className="px-1 text-xs text-muted-foreground">
        Read-only. Nothing on this screen publishes, generates or spends.
      </p>
    </div>
  );
}
