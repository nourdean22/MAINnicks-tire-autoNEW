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

export default function ActionCenter() {
  const [busyJob, setBusyJob] = useState<number | null>(null);

  const attention = trpc.contentAdmin.reelJobsNeedingAttention.useQuery(undefined, {
    // Probing artifact reachability costs real HTTP calls, so do not hammer it.
    refetchInterval: 60_000,
  });
  const openAttempts = trpc.contentAdmin.openPublishAttempts.useQuery({ olderThanMinutes: 15 });

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

  const jobs = attention.data?.jobs ?? [];
  const stuckCount = jobs.length;
  const openCount = openAttempts.data?.count ?? 0;

  return (
    <div className="space-y-4">
      {/* Ambiguous publishes lead: a post that may or may not be live is the only
          thing here that can cost the business twice if acted on blindly. */}
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
            {(openAttempts.data?.attempts ?? []).map((a: any) => (
              <div key={a.attemptId} className="text-xs flex items-center gap-2 font-mono">
                <Clock className="h-3 w-3 text-muted-foreground flex-none" />
                <span>job {a.jobId ?? "—"}</span>
                <span className="text-muted-foreground">· {a.ageMinutes}m ago</span>
                <span className="text-muted-foreground">· {(a.platforms ?? []).join(", ")}</span>
              </div>
            ))}
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
                        {job.stalledHours != null && (
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
                        <p className="text-[11px] text-destructive/80 font-mono break-all">{String(job.lastError).slice(0, 160)}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    {(job.actions ?? []).map((a: any) => {
                      const Icon = ACTION_ICON[a.id] ?? Wrench;
                      // Only the two actions that are actually wired are enabled.
                      // A button that cannot do anything is worse than no button —
                      // that is the whole reason this tab exists.
                      const wired = a.id === "reassemble" || a.id === "rerun_qa";
                      return (
                        <Button
                          key={a.id}
                          size="sm"
                          variant={a.costsMoney ? "outline" : "secondary"}
                          disabled={!wired || busy}
                          title={wired ? a.detail : `${a.detail}\n\n(not yet available from the admin)`}
                          onClick={() => {
                            setBusyJob(job.jobId);
                            if (a.id === "reassemble") reassemble.mutate({ jobId: job.jobId });
                            else if (a.id === "rerun_qa") rerunQa.mutate({ jobId: job.jobId });
                          }}
                          className="text-xs"
                        >
                          {busy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Icon className="h-3 w-3 mr-1" />}
                          {a.label}
                          {a.costsMoney && <DollarSign className="h-3 w-3 ml-1 text-amber-500" />}
                        </Button>
                      );
                    })}
                  </div>

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
    </div>
  );
}
