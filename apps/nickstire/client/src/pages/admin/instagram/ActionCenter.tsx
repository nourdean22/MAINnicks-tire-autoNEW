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

export default function ActionCenter() {
  const [busyJob, setBusyJob] = useState<number | null>(null);
  /** Reconciliation verdict for one attempt, awaiting the operator's call. */
  const [checked, setChecked] = useState<Record<string, any>>({});
  const [discarding, setDiscarding] = useState<number | null>(null);
  const [discardReason, setDiscardReason] = useState("");

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

  const discardJob = trpc.contentAdmin.discardReelJob.useMutation({
    onSuccess: () => {
      toast.success("Job closed");
      setDiscarding(null);
      setDiscardReason("");
      attention.refetch();
    },
    onError: (err) => toast.error("Could not close", { description: err.message }),
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
            {(openAttempts.data?.attempts ?? []).map((a: any) => {
              const v = checked[a.attemptId];
              return (
                <div key={a.attemptId} className="rounded border border-amber-500/20 bg-background/40 p-2 space-y-2">
                  <div className="text-xs flex items-center gap-2 font-mono flex-wrap">
                    <Clock className="h-3 w-3 text-muted-foreground flex-none" />
                    <span>job {a.jobId ?? "—"}</span>
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
                      {v.status === "resolved_published" && a.jobId && (
                        <Button
                          size="sm" className="text-xs bg-green-600 hover:bg-green-700 text-white"
                          disabled={resolveAmbiguous.isPending}
                          onClick={() => resolveAmbiguous.mutate({
                            jobId: a.jobId, attemptId: a.attemptId, decision: "published", igPostId: v.igPostId,
                          })}
                        >
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Confirm it is live — do not retry
                        </Button>
                      )}

                      {v.status === "resolved_not_published" && a.jobId && (
                        <Button
                          size="sm" variant="outline" className="text-xs"
                          disabled={resolveAmbiguous.isPending}
                          onClick={() => resolveAmbiguous.mutate({
                            jobId: a.jobId, attemptId: a.attemptId, decision: "not_published",
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
                                {a.jobId && (
                                  <button
                                    className="text-[11px] text-green-600 underline"
                                    disabled={resolveAmbiguous.isPending}
                                    onClick={() => resolveAmbiguous.mutate({
                                      jobId: a.jobId, attemptId: a.attemptId, decision: "published",
                                      igPostId: c.igPostId, operatorNote: "matched by operator",
                                    })}
                                  >This is the one — mark it live</button>
                                )}
                              </div>
                            </div>
                          ))}
                          {a.jobId && (
                            <button
                              className="text-[11px] text-muted-foreground underline"
                              disabled={resolveAmbiguous.isPending}
                              onClick={() => resolveAmbiguous.mutate({
                                jobId: a.jobId, attemptId: a.attemptId, decision: "not_published",
                                operatorNote: "operator confirmed none of the candidates match",
                              })}
                            >None of these — it never posted</button>
                          )}
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
                      const wired = a.id === "reassemble" || a.id === "rerun_qa"
                        || a.id === "discard" || a.id === "archive_unrecoverable";
                      return (
                        <Button
                          key={a.id}
                          size="sm"
                          variant={a.costsMoney ? "outline" : "secondary"}
                          disabled={!wired || busy}
                          title={wired ? a.detail : `${a.detail}\n\n(not yet available from the admin)`}
                          onClick={() => {
                            // Closing a job is terminal, so it takes a second tap
                            // with a reason. window.confirm is suppressed in the
                            // standalone iOS PWA, so the confirm lives in the DOM.
                            if (a.id === "discard" || a.id === "archive_unrecoverable") {
                              setDiscarding(job.jobId);
                              setDiscardReason("");
                              return;
                            }
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
    </div>
  );
}
