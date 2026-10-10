/**
 * Action Center — everything that is stuck, held, or ambiguous, with the actions
 * its surviving artifacts actually support.
 *
 * WHY THIS TAB EXISTS
 * Three reels sat in "assembled" for up to 32 hours and nothing in the admin
 * surfaced them. The quality gates added across the closure waves correctly refuse
 * to publish unscored media — but a hold nobody can see is indistinguishable from
 * a system that quietly stopped working. HQ showed a COUNT ("3 stuck/failed jobs")
 * and no way to look at it.
 *
 * Actions come from MEASURED artifact reachability, never from status. All three
 * of those jobs had a populated mp4Url with a 404 behind it, so a status-derived
 * action list would have offered Repair and Publish on media that did not exist.
 * Every action states whether it SPENDS MONEY and whether it creates a NEW asset
 * identity, because "re-assemble" (free, from surviving clips) and "regenerate"
 * (a new paid job) look similar and are not.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Loader2, RefreshCw, AlertTriangle, Wrench, Trash2, DollarSign,
  CheckCircle2, Clock, HelpCircle, Film,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

/** Ordered most-recoverable to least, matching the server's classifier. */
const RECOVERABILITY_LABEL: Record<string, { label: string; tone: string; hint: string }> = {
  master_available: {
    label: "Ready", tone: "bg-green-500/10 text-green-600 border-green-500/30",
    hint: "The rendered video is still fetchable — normal actions apply.",
  },
  clips_available_master_missing: {
    label: "Rebuildable — free", tone: "bg-blue-500/10 text-blue-600 border-blue-500/30",
    hint: "The final video is gone but every source clip survives. Rebuilding costs nothing.",
  },
  provider_resume_available: {
    label: "Resumable", tone: "bg-blue-500/10 text-blue-600 border-blue-500/30",
    hint: "The provider still holds output you already paid for.",
  },
  brief_only: {
    label: "Media gone", tone: "bg-amber-500/10 text-amber-600 border-amber-500/30",
    hint: "Only the brief survives. Anything from here is a new paid generation.",
  },
  unrecoverable: {
    label: "Unrecoverable", tone: "bg-destructive/10 text-destructive border-destructive/30",
    hint: "Neither media nor a usable brief survives.",
  },
};

const ACTION_ICON: Record<string, typeof Wrench> = {
  publish: CheckCircle2,
  rerun_qa: RefreshCw,
  reassemble: Wrench,
  resume_generation: RefreshCw,
  regenerate_new_job: DollarSign,
  archive_unrecoverable: Trash2,
  discard: Trash2,
};

export default function ActionCenter({ onPublishStaged }: { onPublishStaged?: () => void } = {}) {
  const [busyJob, setBusyJob] = useState<number | null>(null);
  /** Reconciliation verdict for one attempt, awaiting the operator's call. */
  const [checked, setChecked] = useState<Record<string, any>>({});
  const [discarding, setDiscarding] = useState<number | null>(null);
  const [discardReason, setDiscardReason] = useState("");
  /** Job awaiting an explicit spend confirmation before regenerating. */
  const [regenerating, setRegenerating] = useState<number | null>(null);
  /** Ambiguous-publish resolution is irreversible — arm on the first tap,
   *  execute on the second (in-DOM; window.confirm is dead in the iOS PWA).
   *  These were 11px text links before: ~16px tap targets carrying
   *  opposite-outcome decisions, adjacent to each other, on a phone. */
  const [armedResolve, setArmedResolve] = useState<string | null>(null);

  /**
   * The door for a finished mp4 produced outside the pipeline (MoneyPrinter, a
   * hand-edited cut). ingestFinishedMp4 shipped with twelve tests and zero
   * importers — reachable only from its own spec — which is the P2 registered
   * on the mp4-ingest capability. This is that missing half.
   *
   * It lives on Action Center rather than in a new tab because everything here
   * is "a reel exists and needs a decision", and an ingested file arrives in
   * exactly that state: a review_ready draft that still has to pass every
   * approval and publish gate. Nothing about ingesting shortcuts them.
   */
  const [ingestOpen, setIngestOpen] = useState(false);
  const [ingestSource, setIngestSource] = useState("");
  const [ingestTopic, setIngestTopic] = useState("");
  const [ingestCaption, setIngestCaption] = useState("");
  const [ingestArmed, setIngestArmed] = useState(false);

  const attention = trpc.contentAdmin.reelJobsNeedingAttention.useQuery(undefined, {
    // Probing artifact reachability costs real HTTP calls, so do not hammer it.
    refetchInterval: 60_000,
  });
  const openAttempts = trpc.contentAdmin.openPublishAttempts.useQuery({ olderThanMinutes: 15 });
  /** Queue rows claiming "awaiting review" whose job is dead. Read-only. */
  const queueTruth = trpc.contentAdmin.queueTruthReport.useQuery(undefined, { staleTime: 120_000 });
  // The run trail. content_runs has been WRITTEN all along and read by nothing —
  // getContentRun and recentContentRuns both shipped with zero client callers, so
  // the question the whole two-state model exists to answer ("what happened to the
  // thing I asked for this morning?") had no screen that could answer it.
  const runs = trpc.contentAdmin.recentContentRuns.useQuery({ limit: 15 }, { staleTime: 60_000 });
  type RunTrailRow = NonNullable<typeof runs.data>["runs"][number];

  const applyQueueTruth = trpc.contentAdmin.applyQueueTruth.useMutation({
    onSuccess: (r: any) => {
      toast.success(`${r.updated} queue item(s) corrected`, {
        description: `${r.regenerable} of them failed for an environmental reason and can be regenerated.`,
      });
      queueTruth.refetch();
      attention.refetch();
    },
    onError: (err) => toast.error("Could not correct the queue", { description: err.message }),
  });

  const ingestMp4 = trpc.contentAdmin.ingestFinishedMp4.useMutation({
    onSuccess: (r) => {
      setIngestArmed(false);
      setIngestSource(""); setIngestTopic(""); setIngestCaption("");
      setIngestOpen(false);
      toast.success(`Ingested as ${r.inventoryId}`, {
        description: `${(r.bytes / 1_000_000).toFixed(1)} MB · reel job ${r.reelJobId}. It is a DRAFT — approve and publish it in Queue → Reels.`,
      });
      attention.refetch();
    },
    // The server's messages are passed through verbatim on purpose. Each one
    // names a specific refusal the operator can act on — the flag is off, that
    // is not an mp4, that URL expires — and "ingest failed" would hide it.
    onError: (e) => { setIngestArmed(false); toast.error("Not ingested", { description: e.message }); },
  });

  /**
   * The Publish wire (2026-07-25). This button was disabled "not wired yet"
   * since the audit — and verified live, it COULD not have worked: three
   * assembled jobs had no draft in the gate at all (the assembly writeback
   * missed silently), one had a draft that was already published. Reconcile
   * fixes whichever reality this job is in, then hands the operator to
   * Publish → Reels where approve → two-tap publish lives.
   */
  const reconcile = trpc.contentAdmin.reconcileAssembledReel.useMutation({
    onSuccess: (r) => {
      setBusyJob(null);
      attention.refetch();
      if (r.outcome === "job_marked_published") {
        toast.success("Already live", { description: "This reel's draft was published earlier — the job card is now closed." });
        return;
      }
      toast.success(r.outcome === "staged" ? "Staged for publish" : "Already in the queue", {
        description: "Approve and publish it in Queue → Reels (opening now).",
      });
      const url = new URL(window.location.href);
      url.searchParams.set("igpub", "reels");
      window.history.replaceState(window.history.state, "", url.toString());
      onPublishStaged?.();
    },
    onError: (e) => { setBusyJob(null); toast.error("Could not stage the reel", { description: e.message }); },
  });

  const reassemble = trpc.contentAdmin.reassembleReelFromClips.useMutation({
    onSuccess: (r: any) => {
      toast.success(`Reel ${r.jobId} rebuilt`, {
        description: `${r.durationSec}s from ${r.clipsUsed} surviving clips — no generation spend. It needs fresh QA before publishing.`,
      });
      attention.refetch();
    },
    onError: (err) => toast.error("Could not rebuild", { description: err.message }),
    onSettled: () => setBusyJob(null),
  });

  const rerunQa = trpc.contentAdmin.runRenderedQa.useMutation({
    onSuccess: (v: any) => {
      toast.success("Quality check re-run", {
        description: `${v?.decision ?? "done"} — ${v?.findings?.length ?? 0} finding(s) across ${v?.framesEvaluated ?? "?"} frames.`,
      });
      attention.refetch();
    },
    onError: (err) => toast.error("Quality check could not run", { description: err.message }),
    onSettled: () => setBusyJob(null),
  });

  const checkAmbiguous = trpc.contentAdmin.checkAmbiguousPublish.useMutation({
    onSuccess: (v: any) => {
      setChecked((prev) => ({ ...prev, [v.attemptId]: v }));
      if (v.status === "resolved_published") toast.success("It IS live on Instagram", { description: v.detail });
      else if (v.status === "resolved_not_published") toast.success("It never reached Instagram", { description: v.detail });
      else if (v.status === "cannot_check") toast.error("Could not check", { description: v.detail });
      else toast.warning("Needs your eyes", { description: v.detail });
    },
    onError: (err) => toast.error("Check failed", { description: err.message }),
  });

  const resolveAmbiguous = trpc.contentAdmin.resolveAmbiguousPublish.useMutation({
    onSuccess: (r: any) => {
      toast.success("Reconciled", { description: r.detail });
      attention.refetch();
      openAttempts.refetch();
    },
    onError: (err) => toast.error("Could not reconcile", { description: err.message }),
  });

  const regenerate = trpc.contentAdmin.regenerateReelFromBrief.useMutation({
    onSuccess: (r: any) => {
      toast.success(`New reel job ${r.newJobId} queued`, {
        description: `Reel ${r.supersededJobId} was closed and superseded. This is a new paid generation — it needs its own QA and approval.`,
      });
      setRegenerating(null);
      attention.refetch();
    },
    onError: (err) => toast.error("Could not regenerate", { description: err.message }),
  });

  const discardJob = trpc.contentAdmin.discardReelJob.useMutation({
    onSuccess: () => {
      toast.success("Job closed");
      setDiscarding(null);
      setDiscardReason("");
      attention.refetch();
    },
    onError: (err) => toast.error("Could not close", { description: err.message }),
  });

  // Pipeline controls (2026-10-10): run the tick now, advance one reel now.
  // Mutations only START the step on the server (generation and assembly take
  // minutes); the in-flight list is what shows it moving.
  const inFlight = trpc.contentAdmin.reelJobsInFlight.useQuery(undefined, { refetchInterval: 30_000 });
  const cronJobs = trpc.contentAdmin.listCronJobs.useQuery(undefined, { staleTime: 300_000 });
  const [advancingJob, setAdvancingJob] = useState<number | null>(null);
  const [runningJob, setRunningJob] = useState<string | null>(null);
  const [showAllJobs, setShowAllJobs] = useState(false);
  const advanceNow = trpc.contentAdmin.advanceReelJobNow.useMutation({
    onSuccess: (r) => {
      toast.success(`Reel ${r.jobId}: ${r.step} started`, { description: "Runs in the background; this list refreshes every 30 seconds." });
      setAdvancingJob(null);
      setTimeout(() => { inFlight.refetch(); attention.refetch(); }, 1500);
    },
    onError: (err) => { setAdvancingJob(null); toast.error("Could not advance", { description: err.message }); },
  });
  const runCronNow = trpc.contentAdmin.runCronJobNow.useMutation({
    onSuccess: (r) => {
      toast.success(`${r.jobName} started`, { description: "The run lands in cron_log like a scheduled one." });
      setRunningJob(null);
      setTimeout(() => { inFlight.refetch(); attention.refetch(); }, 2000);
    },
    onError: (err) => { setRunningJob(null); toast.error("Could not start the job", { description: err.message }); },
  });
  const ageMinutes = (iso: string | Date | null | undefined) => {
    const t = iso ? new Date(iso).getTime() : NaN;
    return Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 60_000)) : null;
  };
  const PRIMARY_JOBS = ["reel-pipeline", "daily-reel-post"];

  const jobs = attention.data?.jobs ?? [];
  const stuckCount = jobs.length;
  const openCount = openAttempts.data?.count ?? 0;
  const openUnknown = openAttempts.isError;

  return (
    <div className="space-y-4">
      {/* Pipeline controls. The decision on this card is "what is waiting, and do
          I wait for the tick or press it now". So the waiting reels lead, each
          with the one step it can take; the cron buttons come second. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4" />Pipeline controls</CardTitle>
          <CardDescription className="text-xs">
            Every step still runs the same gates as the scheduled tick. Pressing a button only removes the wait.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-medium">Reels in flight</p>
            {inFlight.isLoading ? (
              <p className="text-xs text-muted-foreground">Reading the queue from the database.</p>
            ) : inFlight.isError ? (
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">The queue could not be read: {inFlight.error?.message}</span>
                <Button size="sm" variant="outline" className="min-h-9" onClick={() => inFlight.refetch()}>Try again</Button>
              </div>
            ) : (inFlight.data?.length ?? 0) === 0 ? (
              <p className="text-xs text-muted-foreground">No reel is between steps. A new one appears here the moment it is enqueued.</p>
            ) : (
              <div className="space-y-2">
                {inFlight.data!.map((j) => {
                  const age = ageMinutes(j.updatedAt as unknown as string | null);
                  const busy = advancingJob === j.jobId;
                  return (
                    <div key={j.jobId} className="flex items-start justify-between gap-3 rounded-lg border border-border/60 p-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-semibold">Reel {j.jobId}</span>
                          <Badge variant="outline" className="text-[10px]">{j.status}</Badge>
                          {age != null && <span className="text-[11px] text-muted-foreground">{age} min in this state</span>}
                        </div>
                        {j.topic && <p className="text-xs text-muted-foreground truncate">{j.topic}</p>}
                        <p className="text-[11px] text-muted-foreground">
                          {j.clips}/{j.beats} clips{j.hasMp4 ? ", master cut" : ""}{j.hasRenderedQa ? ", critic verdict" : ""}{j.hasAudioQa ? ", audio verdict" : ""}
                        </p>
                        {!j.nextStep && j.refusal && <p className="text-[11px] text-muted-foreground">{j.refusal}</p>}
                      </div>
                      {j.nextStep && (
                        <Button
                          size="sm" variant="outline" className="min-h-11 flex-none text-xs"
                          disabled={busy || advanceNow.isPending}
                          onClick={() => { setAdvancingJob(j.jobId); advanceNow.mutate({ jobId: j.jobId }); }}
                        >
                          {busy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Wrench className="h-3 w-3 mr-1" />}
                          {j.nextStep === "generate" ? "Generate now" : j.nextStep === "assemble" ? "Assemble now" : "Run QA now"}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="space-y-2 border-t border-border/60 pt-3">
            <p className="text-xs font-medium">Run a scheduled job now</p>
            {cronJobs.isError ? (
              <p className="text-xs text-muted-foreground">The job list could not be read: {cronJobs.error?.message}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {PRIMARY_JOBS.map((name) => (
                  <Button
                    key={name} size="sm" variant="outline" className="min-h-11 text-xs"
                    disabled={runningJob === name || runCronNow.isPending || (cronJobs.data != null && !cronJobs.data.some((c) => c.name === name))}
                    onClick={() => { setRunningJob(name); runCronNow.mutate({ jobName: name }); }}
                  >
                    {runningJob === name ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                    {name === "reel-pipeline" ? "Run the pipeline tick" : "Run the daily post pulse"}
                  </Button>
                ))}
                <Button size="sm" variant="ghost" className="min-h-11 text-xs" onClick={() => setShowAllJobs((v) => !v)}>
                  {showAllJobs ? "Hide the other jobs" : `All jobs${cronJobs.data ? ` (${cronJobs.data.length})` : ""}`}
                </Button>
              </div>
            )}
            {showAllJobs && cronJobs.data && (
              <div className="grid gap-1 sm:grid-cols-2">
                {cronJobs.data.filter((c) => !PRIMARY_JOBS.includes(c.name)).map((c) => (
                  <div key={c.name} className="flex items-center justify-between gap-2 rounded border border-border/60 px-2 py-1">
                    <div className="min-w-0">
                      <p className="font-mono text-xs truncate">{c.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {c.intervalMin != null ? `every ${c.intervalMin} min` : "no cadence"}{c.tier ? `, ${c.tier}` : ""}{c.enabled ? "" : ", disabled"}
                      </p>
                    </div>
                    <Button
                      size="sm" variant="ghost" className="min-h-9 text-xs flex-none"
                      disabled={runningJob === c.name || runCronNow.isPending}
                      onClick={() => { setRunningJob(c.name); runCronNow.mutate({ jobName: c.name }); }}
                    >
                      {runningJob === c.name ? <Loader2 className="h-3 w-3" /> : "Run now"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* The mp4 door. Collapsed by default — this is an occasional action and
          Action Center's job is to surface what is stuck, not to lead with a
          form. Everything it produces is a DRAFT that still passes every
          approval and publish gate; the copy says so, because "ingest" reads
          like "publish" if nothing tells you otherwise. */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="text-base flex items-center gap-2"><Film className="h-4 w-4" />Bring in a finished MP4</CardTitle>
              <CardDescription>
                A MoneyPrinter render or a hand-edited cut. It lands as a review-ready draft — it does NOT publish, and it
                still passes every approval and publish gate. Requires MP4_INGEST_ENABLED.
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" className="min-h-12" onClick={() => { setIngestOpen(!ingestOpen); setIngestArmed(false); }}>
              {ingestOpen ? "Close" : "Open"}
            </Button>
          </div>
        </CardHeader>
        {ingestOpen && (
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="mp4-source">File path or public URL</label>
              <Input
                id="mp4-source"
                className="h-12"
                value={ingestSource}
                onChange={(e) => { setIngestSource(e.target.value); setIngestArmed(false); }}
                placeholder="/data/renders/winter-tires.mp4 or https://…/final.mp4"
              />
              {/* Said here rather than only in the server's rejection: a presigned
                  URL works right up until the publish gate fetches it, hours
                  later, when the operator is no longer watching. */}
              <p className="text-[11px] text-muted-foreground">
                Must be permanent. A presigned or expiring link is refused up front, not at publish time.
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="mp4-topic">Topic</label>
              <Input
                id="mp4-topic"
                className="h-12"
                value={ingestTopic}
                onChange={(e) => { setIngestTopic(e.target.value); setIngestArmed(false); }}
                placeholder="Winter tire changeover"
                maxLength={128}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="mp4-caption">Caption</label>
              <Input
                id="mp4-caption"
                className="h-12"
                value={ingestCaption}
                onChange={(e) => { setIngestCaption(e.target.value); setIngestArmed(false); }}
                placeholder="The caption this reel publishes with"
                maxLength={2200}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Two-tap, in-DOM. window.confirm is silently suppressed in the
                  operator's standalone iOS PWA, so a confirm() gate here would
                  be no gate at all. */}
              <Button
                className="min-h-12"
                variant={ingestArmed ? "default" : "outline"}
                disabled={ingestMp4.isPending || !ingestSource.trim() || !ingestTopic.trim() || !ingestCaption.trim()}
                onClick={() => {
                  if (!ingestArmed) { setIngestArmed(true); return; }
                  ingestMp4.mutate({
                    source: ingestSource.trim(),
                    topic: ingestTopic.trim(),
                    caption: ingestCaption.trim(),
                    origin: "manual",
                  });
                }}
              >
                {ingestMp4.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {ingestArmed ? "Tap again to ingest" : "Ingest as draft"}
              </Button>
              {ingestArmed && (
                <Button size="sm" variant="ghost" className="min-h-12" onClick={() => setIngestArmed(false)}>Cancel</Button>
              )}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Ambiguous publishes lead: a post that may or may not be live is the only
          thing here that can cost the business twice if acted on blindly. */}
      {/* A queue that shows dead work as reviewable is worse than an empty one:
          an empty queue prompts you to make something, a full one says the
          bottleneck is your review time. */}
      {(queueTruth.data?.misreported ?? 0) > 0 && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              {queueTruth.data!.misreported} queue item(s) say "awaiting review" but cannot publish
            </CardTitle>
            <CardDescription className="text-xs">
              Their generation job failed and no media exists, so nothing about them is reviewable.
              {queueTruth.data!.regenerable > 0 && (
                <> <strong>{queueTruth.data!.regenerable}</strong> failed for an environmental reason
                (key, quota or session) — those briefs are intact and can be regenerated.</>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {queueTruth.data!.rows.slice(0, 8).map((r: any) => (
                <div key={r.inventoryId} className="text-[11px] font-mono text-muted-foreground truncate">
                  {r.inventoryId}{r.regenerable ? " · regenerable" : ""}
                </div>
              ))}
              {queueTruth.data!.rows.length > 8 && (
                <div className="text-[11px] text-muted-foreground/70">…and {queueTruth.data!.rows.length - 8} more</div>
              )}
            </div>
            <Button
              size="sm" variant="destructive" className="text-xs"
              disabled={applyQueueTruth.isPending}
              onClick={() => applyQueueTruth.mutate({ confirm: true })}
            >
              {applyQueueTruth.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
              Mark these failed so the queue tells the truth
            </Button>
          </CardContent>
        </Card>
      )}

      {openUnknown && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Could not check for ambiguous publishes
            </CardTitle>
            <CardDescription className="text-xs">
              {openAttempts.error?.message ?? "The check failed."} Treat this as unknown, not clear —
              a publish may be open and unreconciled.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {openCount > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-amber-500" />
              {openCount} publish{openCount === 1 ? "" : "es"} may or may not be live
            </CardTitle>
            <CardDescription className="text-xs">
              An attempt was recorded but no outcome came back — the process died between Meta accepting
              the post and the database being updated. <strong>Check Instagram before retrying any of these</strong>,
              or you may post twice.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {(openAttempts.data?.attempts ?? []).map((a: any) => {
              const v = checked[a.attemptId];
              return (
                <div key={a.attemptId} className="rounded border border-amber-500/20 bg-background/40 p-2 space-y-2">
                  <div className="text-xs flex items-center gap-2 font-mono flex-wrap">
                    <Clock className="h-3 w-3 text-muted-foreground flex-none" />
                    <span>{a.kind === "scheduled_post" ? "scheduled" : "reel"} {a.jobId ?? a.scheduledPostId ?? "—"}</span>
                    <span className="text-muted-foreground">· {a.ageMinutes}m ago</span>
                    <span className="text-muted-foreground">· {(a.platforms ?? []).join(", ")}</span>
                  </div>

                  {!v ? (
                    <Button
                      size="sm" variant="outline" className="text-xs"
                      disabled={checkAmbiguous.isPending}
                      onClick={() => checkAmbiguous.mutate({ attemptId: a.attemptId, jobId: a.jobId ?? undefined })}
                    >
                      {checkAmbiguous.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <HelpCircle className="h-3 w-3 mr-1" />}
                      Ask Instagram what happened
                    </Button>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-[11px] leading-relaxed">{v.detail}</p>

                      {/* A confident verdict still needs a tap. Marking a publish
                          live is irreversible for that reel, and marking it dead
                          authorises a retry that could double-post. */}
                      {v.status === "resolved_published" && (a.jobId ?? a.scheduledPostId) && (
                        <Button
                          size="sm" className="text-xs bg-green-600 hover:bg-green-700 text-white"
                          disabled={resolveAmbiguous.isPending}
                          onClick={() => resolveAmbiguous.mutate({
                            kind: a.kind, jobId: a.jobId ?? a.scheduledPostId,
                            attemptId: a.attemptId, decision: "published", igPostId: v.igPostId,
                          })}
                        >
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Confirm it is live — do not retry
                        </Button>
                      )}

                      {v.status === "resolved_not_published" && (a.jobId ?? a.scheduledPostId) && (
                        <Button
                          size="sm" variant="outline" className="text-xs"
                          disabled={resolveAmbiguous.isPending}
                          onClick={() => resolveAmbiguous.mutate({
                            kind: a.kind, jobId: a.jobId ?? a.scheduledPostId,
                            attemptId: a.attemptId, decision: "not_published",
                          })}
                        >
                          <RefreshCw className="h-3 w-3 mr-1" /> Release it for a retry
                        </Button>
                      )}

                      {v.status === "needs_operator" && (
                        <div className="space-y-1">
                          {(v.candidates ?? []).map((c: any) => (
                            <div key={c.igPostId} className="rounded border border-border/50 p-2 space-y-1">
                              <p className="text-[11px] text-muted-foreground">{c.reasoning}</p>
                              <p className="text-[11px] font-mono break-all">{c.caption || "(no caption)"}</p>
                              <div className="flex gap-2 flex-wrap">
                                {c.permalink && (
                                  <a href={c.permalink} target="_blank" rel="noreferrer"
                                     className="text-[11px] text-primary underline">Open on Instagram</a>
                                )}
                                {(a.jobId ?? a.scheduledPostId) && (() => {
                                  const key = `${a.attemptId}:published:${c.igPostId}`;
                                  const armed = armedResolve === key;
                                  return (
                                    <Button
                                      size="sm"
                                      variant={armed ? "default" : "outline"}
                                      className="min-h-11 border-green-600/50 text-green-600"
                                      disabled={resolveAmbiguous.isPending}
                                      onClick={() => {
                                        if (!armed) { setArmedResolve(key); return; }
                                        setArmedResolve(null);
                                        resolveAmbiguous.mutate({
                                          kind: a.kind, jobId: a.jobId ?? a.scheduledPostId,
                                          attemptId: a.attemptId, decision: "published",
                                          igPostId: c.igPostId, operatorNote: "matched by operator",
                                        });
                                      }}
                                    >{armed ? "Tap again — mark it LIVE (irreversible)" : "This is the one — mark it live"}</Button>
                                  );
                                })()}
                              </div>
                            </div>
                          ))}
                          {(a.jobId ?? a.scheduledPostId) && (() => {
                            const key = `${a.attemptId}:not_published`;
                            const armed = armedResolve === key;
                            return (
                              <Button
                                size="sm"
                                variant={armed ? "destructive" : "outline"}
                                className="min-h-11"
                                disabled={resolveAmbiguous.isPending}
                                onClick={() => {
                                  if (!armed) { setArmedResolve(key); return; }
                                  setArmedResolve(null);
                                  resolveAmbiguous.mutate({
                                    kind: a.kind, jobId: a.jobId ?? a.scheduledPostId,
                                    attemptId: a.attemptId, decision: "not_published",
                                    operatorNote: "operator confirmed none of the candidates match",
                                  });
                                }}
                              >{armed ? "Tap again — confirm it never posted (irreversible)" : "None of these — it never posted"}</Button>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Film className="h-4 w-4" />
                Reels needing attention
              </CardTitle>
              <CardDescription className="text-xs">
                Jobs that are held, stuck, or mid-flight. Actions reflect what actually survives —
                a job whose video is gone will not offer to publish it.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => attention.refetch()} disabled={attention.isFetching}>
              {attention.isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {attention.isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground text-sm gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking what survived…
            </div>
          ) : attention.isError ? (
            /* UNKNOWN IS NOT ZERO. Falling through to the empty state on a failed
               query would tell the operator everything is fine at the exact moment
               the system cannot see. */
            <div className="text-center py-10 space-y-2">
              <AlertTriangle className="h-10 w-10 text-amber-500/60 mx-auto" />
              <p className="text-sm font-medium">Unable to determine system state</p>
              <p className="text-xs text-muted-foreground/80 max-w-sm mx-auto">
                {attention.error?.message ?? "The check failed."} This is NOT an all-clear —
                there may be held or stuck reels that cannot be listed right now.
              </p>
              <Button size="sm" variant="outline" onClick={() => attention.refetch()}>Try again</Button>
            </div>
          ) : stuckCount === 0 ? (
            <div className="text-center py-10 space-y-2">
              <CheckCircle2 className="h-10 w-10 text-green-500/40 mx-auto" />
              <p className="text-sm font-medium text-muted-foreground">Nothing is stuck</p>
              <p className="text-xs text-muted-foreground/70">Every reel job has either published or failed cleanly.</p>
            </div>
          ) : (
            jobs.map((job: any) => {
              const rec = RECOVERABILITY_LABEL[job.recoverability] ?? {
                label: job.recoverability, tone: "bg-muted text-muted-foreground border-border", hint: "",
              };
              const busy = busyJob === job.jobId;
              return (
                <div key={job.jobId} className="rounded-lg border border-border/60 p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-semibold">Reel {job.jobId}</span>
                        <Badge variant="outline" className="text-[10px]">{job.status}</Badge>
                        <Badge variant="outline" className={`text-[10px] ${rec.tone}`}>{rec.label}</Badge>
                        {/* "stalled 0h" on a fresh state was pure noise that
                            made healthy jobs read as stuck. Only a real wait
                            deserves the word. */}
                        {job.stalledHours != null && job.stalledHours >= 1 && (
                          <span className="text-[11px] text-muted-foreground">stalled {job.stalledHours}h</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{job.holdReason}</p>
                      {rec.hint && <p className="text-[11px] text-muted-foreground/70">{rec.hint}</p>}
                      {job.danglingUrls?.length > 0 && (
                        <p className="text-[11px] text-amber-600">
                          {job.danglingUrls.length} recorded file{job.danglingUrls.length === 1 ? "" : "s"} no longer exist
                        </p>
                      )}
                      {job.lastError && (
                        <>
                          {/* The class, once, as a label — then 160 chars spent on
                              the part that actually differs between jobs. */}
                          {job.errorClass && (
                            <p className="text-[10px] uppercase tracking-wide text-destructive/70 font-semibold">{job.errorClass.replace(/_/g, " ")}</p>
                          )}
                          {/* MEASURED: the stamp is "[CLASS] <reason> :: " and the
                              reason is a per-class constant. Two of the eleven
                              prefixes are longer than this 160-char slice on their
                              own — LOCAL_TIMEOUT_REMOTE_UNKNOWN at 176 and
                              SAFETY_POLICY_PERMANENT at 175 — so for those the
                              operator saw the boilerplate and ZERO characters of the
                              provider's actual complaint. STORAGE_OR_ASSEMBLY left
                              13 characters. Those are the classes where the detail
                              matters most: one needs the provider's wording to
                              reword the prompt, and LOCAL_TIMEOUT_REMOTE_UNKNOWN is
                              the only class flagged mayDoubleSpend.
                              Falls back to lastError so the stages that write raw,
                              unstamped text still render. */}
                          <p className="text-[11px] text-destructive/80 font-mono break-all">{String(job.lastErrorMessage ?? job.lastError).slice(0, 160)}</p>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    {(job.actions ?? []).map((a: any) => {
                      const Icon = ACTION_ICON[a.id] ?? Wrench;
                      // Only actions that are actually wired are enabled.
                      // A button that cannot do anything is worse than no button —
                      // that is the whole reason this tab exists. "publish" is
                      // wired ONLY for assembled jobs: staging an ambiguous
                      // job would arm a duplicate of a possibly-live reel, so
                      // those resolve through the candidates panel above first.
                      const wired = a.id === "reassemble" || a.id === "rerun_qa"
                        || a.id === "discard" || a.id === "archive_unrecoverable"
                        || a.id === "regenerate_new_job"
                        || (a.id === "publish" && job.status === "assembled");
                      return (
                        <Button
                          key={a.id}
                          size="sm"
                          variant={a.costsMoney ? "outline" : "secondary"}
                          disabled={!wired || busy}
                          // title= never renders on iOS touch (and never on a
                          // disabled button anywhere) — the visible suffix below
                          // carries the disabled reason; the tooltip is a
                          // desktop-only bonus.
                          title={wired ? a.detail : a.id === "publish" ? `${a.detail}\n\n(resolve the ambiguous publish above first)` : `${a.detail}\n\n(not yet available from the admin)`}
                          onClick={() => {
                            // Closing a job is terminal, so it takes a second tap
                            // with a reason. window.confirm is suppressed in the
                            // standalone iOS PWA, so the confirm lives in the DOM.
                            if (a.id === "discard" || a.id === "archive_unrecoverable") {
                              setDiscarding(job.jobId);
                              setDiscardReason("");
                              return;
                            }
                            // Spending money takes a second, explicit tap.
                            if (a.id === "regenerate_new_job") {
                              setRegenerating(job.jobId);
                              return;
                            }
                            setBusyJob(job.jobId);
                            if (a.id === "reassemble") reassemble.mutate({ jobId: job.jobId });
                            else if (a.id === "rerun_qa") rerunQa.mutate({ jobId: job.jobId });
                            else if (a.id === "publish") reconcile.mutate({ jobId: job.jobId });
                          }}
                          className="text-xs"
                        >
                          {busy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Icon className="h-3 w-3 mr-1" />}
                          {a.label}
                          {!wired && <span className="ml-1 text-[10px] opacity-70">{a.id === "publish" ? "· resolve ambiguity first" : "· not wired yet"}</span>}
                          {a.costsMoney && <DollarSign className="h-3 w-3 ml-1 text-amber-500" />}
                        </Button>
                      );
                    })}
                  </div>

                  {regenerating === job.jobId && (
                    <div className="rounded border border-amber-500/40 bg-amber-500/5 p-2 space-y-2">
                      <p className="text-[11px] leading-relaxed">
                        <strong>This spends generation budget.</strong> It starts a brand-new reel from
                        the surviving brief — different footage, a different file, its own quality check
                        and its own approval. Reel {job.jobId} will be closed and superseded.
                        It still passes the daily spend cap and the defect preflight, so it may be refused.
                      </p>
                      <div className="flex gap-2">
                        <Button
                          size="sm" className="text-xs bg-amber-600 hover:bg-amber-700 text-white"
                          disabled={regenerate.isPending}
                          onClick={() => regenerate.mutate({ jobId: job.jobId, confirmSpend: true })}
                        >
                          {regenerate.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <DollarSign className="h-3 w-3 mr-1" />}
                          Spend and regenerate
                        </Button>
                        <Button size="sm" variant="ghost" className="text-xs" onClick={() => setRegenerating(null)}>
                          Not now
                        </Button>
                      </div>
                    </div>
                  )}

                  {discarding === job.jobId && (
                    <div className="rounded border border-destructive/30 bg-destructive/5 p-2 space-y-2">
                      <p className="text-[11px] text-muted-foreground">
                        Closing reel {job.jobId} is final. It will not publish and will not be retried.
                      </p>
                      <Input
                        value={discardReason}
                        onChange={(e) => setDiscardReason(e.target.value)}
                        placeholder="Why is this being closed? (recorded)"
                        className="h-8 text-xs"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm" variant="destructive" className="text-xs"
                          disabled={discardReason.trim().length < 4 || discardJob.isPending}
                          onClick={() => discardJob.mutate({
                            jobId: job.jobId,
                            reason: discardReason.trim(),
                            mode: job.recoverability === "unrecoverable" ? "archive" : "discard",
                          })}
                        >
                          {discardJob.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Trash2 className="h-3 w-3 mr-1" />}
                          Close it
                        </Button>
                        <Button size="sm" variant="ghost" className="text-xs" onClick={() => setDiscarding(null)}>
                          Keep it
                        </Button>
                      </div>
                    </div>
                  )}

                  {(job.actions ?? []).some((a: any) => a.newAssetIdentity) && (
                    <p className="text-[11px] text-muted-foreground/70 flex items-start gap-1 pt-1">
                      <AlertTriangle className="h-3 w-3 mt-0.5 flex-none text-amber-500" />
                      Rebuilding or regenerating produces a different file, so the reel needs a fresh
                      quality check and a fresh approval before it can publish.
                    </p>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/*
        WHAT HAPPENED TO WHAT I ASKED FOR.
        Two states per run, never merged: implementationState is what was BUILT,
        operationalState is what was PROVEN in production. A run can be "built"
        and not "published" — that gap is the entire point, and collapsing it into
        one green check is what this model was created to prevent.
      */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4" /> Run trail
          </CardTitle>
          <CardDescription>
            Every "make me something" request, and how far it actually got. Built is not published.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {runs.isLoading ? (
            <p className="text-sm text-muted-foreground">Checking…</p>
          ) : runs.isError ? (
            <p className="text-sm text-amber-500">Could not read the run trail — this is unknown, not empty. {runs.error?.message}</p>
          ) : (runs.data?.runs.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">
              No content runs recorded yet. A run opens when you generate something in the Studio.
            </p>
          ) : (
            <div className="space-y-2">
              {runs.data!.runs.map((r: RunTrailRow) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs">{r.id}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.chosenFormat ?? r.requestedFormat ?? "format undecided"} · stage {r.stage}
                      {r.inventoryId ? ` · queued as ${r.inventoryId}` : " · not yet queued"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.costCents > 0 && (
                      <span className="text-xs tabular-nums text-muted-foreground">
                        ${(r.costCents / 100).toFixed(2)}
                      </span>
                    )}
                    <span className="rounded-full border px-2 py-0.5 text-[11px]">
                      built: {r.implementationState}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        r.isProvenPublished
                          ? "bg-emerald-500/15 text-emerald-500"
                          : "bg-muted text-muted-foreground"
                      }`}
                      title={r.isProvenPublished
                        ? "Proven live — a real post id was recorded"
                        : "NOT proven published. This is the half of the model that a single green check would hide."}
                    >
                      {r.isProvenPublished ? "published" : r.operationalState}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
