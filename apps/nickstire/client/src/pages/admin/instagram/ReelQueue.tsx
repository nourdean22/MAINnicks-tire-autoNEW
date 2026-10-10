import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Film, RefreshCw, Send, CheckCircle2, XCircle, AlertTriangle, Check, ChevronDown, ChevronUp, Eye, ShieldCheck, ShieldAlert, Ban } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Approximate Instagram UI overlap for a 9:16 reel, as fractions of the frame:
 * the top band (account row), the bottom band (caption + audio + actions), and
 * the right rail (like/comment/share stack). ADVISORY — Meta publishes no
 * official pixel contract for this chrome; these mark where captions and the
 * subject are at risk, pending a platform-spec registry entry.
 */
const REEL_SAFE = { top: 0.12, bottom: 0.22, right: 0.13 };

type DraftStatus = "needs_review" | "ready" | "scheduled" | "published" | "rejected";

/**
 * ReelQueue — the reel lifecycle, absorbed into Publish (reel-absorption wave).
 *
 * This is the faithful port of the legacy Queue's UNIQUE capability: reel
 * approve → publish with approval-integrity, the in-DOM quality-override flow,
 * and rendered-QA re-runs. The legacy Queue itself is deleted in the same
 * commit — after this, Publish is the only queue.
 *
 * Two things deliberately kept from the legacy implementation:
 *  - captionWithHashtags mirrors the server's composition (caption + blank
 *    line + tags). For reels the server is authoritative anyway
 *    (reelPublishAuthority rebuilds the approved caption), so this is the
 *    display/advisory copy — but it must still MATCH what publishes.
 *  - The override flow records against version-1 (the reviewed version,
 *    before approve bumped the row).
 *
 * Two things deliberately improved:
 *  - Publish is TWO-TAP through a payload panel (the QueueV2 pattern): the
 *    operator sees the exact video + final caption before anything
 *    irreversible fires.
 *  - Non-reel rows that exist ONLY in this legacy inventory (pre-Studio-V2
 *    statics) are not silently hidden by the reel filter — they render in a
 *    collapsible "Legacy static drafts" section, because absorbing reels must
 *    not orphan anyone's pending content.
 */
function captionWithHashtags(draft: { caption?: string | null; hashtags?: string[] | null }): string {
  const caption = (draft.caption || "").trim();
  const tags = (draft.hashtags ?? []).filter(Boolean).map((t) => (t.startsWith("#") ? t : `#${t}`));
  return tags.length ? [caption, tags.join(" ")].join("\n\n").trim() : caption;
}

export default function ReelQueue() {
  const [filter, setFilter] = useState<DraftStatus | "all">("all");
  const [showLegacyStatics, setShowLegacyStatics] = useState(false);
  /** Draft whose publish was refused by the quality gate, awaiting an operator decision. */
  const [blockedDraft, setBlockedDraft] = useState<{ id: string; version: number; reason: string; asTrial: boolean } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  /** Two-tap reject (in-DOM — window.confirm is suppressed in the installed iOS PWA). */
  const [confirmRejectId, setConfirmRejectId] = useState<string | null>(null);
  /** Two-tap publish through a panel showing the exact payload. */
  const [confirmPublishId, setConfirmPublishId] = useState<string | null>(null);
  /** Full-fidelity 9:16 review room — a reel must never be judged from the cropped card. */
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [showSafeZones, setShowSafeZones] = useState(true);
  /** Trial-reel numbers as typed (strings; empty = not entered, never zero). */
  const [trialForm, setTrialForm] = useState<Record<string, string>>({});

  /** Two-tap approve for the AUTONOMOUS lane (reel_jobs), keyed by job id. */
  const [confirmApproveJobId, setConfirmApproveJobId] = useState<number | null>(null);

  /* ── Autonomous publish queue ───────────────────────────────────────────
   * Separate from the draft cards below on purpose. These rows are read
   * straight off `reel_jobs` and show the EXACT caption bytes the cron will
   * send — not the Studio draft's composed caption. Approving the composed
   * one would fingerprint text the cron never publishes, so the approval
   * would be void the instant the gate read it. */
  const {
    data: publishQueue,
    isLoading: queueLoading,
    isError: queueIsError,
    error: queueError,
    refetch: refetchQueue,
  } = trpc.instagramAdmin.reelPublishQueue.useQuery();

  const approveReelPublish = trpc.instagramAdmin.approveReelPublish.useMutation({
    onSuccess: (res: any) => {
      toast.success("Approved for autonomous publish", {
        description: `The cron may now publish this reel until ${new Date(res.expiresAt).toLocaleString()}.`,
      });
      refetchQueue();
    },
    onError: (err) => toast.error("Approval NOT recorded", { description: err.message }),
  });

  const revokeReelPublish = trpc.instagramAdmin.revokeReelPublish.useMutation({
    onSuccess: (res: any) => {
      toast.success(res.revoked > 0 ? "Approval withdrawn" : "Nothing to withdraw", {
        description: res.revoked > 0
          ? "The cron will hold this reel again."
          : "This reel had no live approval.",
      });
      refetchQueue();
    },
    onError: (err) => toast.error("Revoke failed", { description: err.message }),
  });

  const recordTrial = trpc.instagramAdmin.recordTrialResult.useMutation({
    onSuccess: () => {
      toast.success("Trial result recorded", { description: "Durable on the draft — winner/archive decisions leave a trail." });
      refetch();
    },
    onError: (err) => toast.error("Trial result NOT recorded", { description: err.message }),
  });

  const { data: drafts, isLoading, isError, error, refetch } = trpc.instagramAdmin.getAllDrafts.useQuery();

  const publishDraft = trpc.instagramAdmin.publishPost.useMutation({
    onSuccess: (_data, vars) => {
      if (vars.trialReel) {
        toast.success("Trial Reel published", {
          description: "Instagram will test it with non-followers first. Graduation stays manual.",
        });
      } else {
        toast.success("Published Successfully!");
      }
      refetch();
    },
    onError: (err, vars) => {
      // The quality gate refuses on ADVISORY findings too — offer the recorded
      // override path instead of a dead-end error toast.
      const gateRefusal = /rendered-QA gate|quality decision|needs_review|needs_paid_repair|stale/i.test(err.message);
      if (gateRefusal && vars?.inventoryId) {
        const d = (drafts || []).find((x: any) => x.id === vars.inventoryId);
        setBlockedDraft({
          id: vars.inventoryId,
          version: d?.version ?? 0,
          reason: err.message,
          // Preserve the operator's original irreversible choice. Without this,
          // accepting an advisory hold after "Publish as Trial" retried through
          // the normal Reel path and silently lost MANUAL Trial semantics.
          asTrial: Boolean(vars.trialReel),
        });
        setOverrideReason("");
        return;
      }
      toast.error("Publishing Failed", { description: err.message });
    },
  });

  /** Re-run rendered QA against the current mp4 — the honest first move on a hold. */
  const rerunQa = trpc.contentAdmin.runRenderedQa.useMutation({
    onSuccess: (v: any) => {
      toast.success("Rendered QA re-run", {
        description: `${v?.decision ?? "done"} — ${v?.findings?.length ?? 0} finding(s) across ${v?.framesEvaluated ?? "?"} frames.`,
      });
      refetch();
    },
    onError: (err) => toast.error("QA could not run", { description: err.message }),
  });

  /** Record an operator override for ADVISORY findings, then retry the publish. */
  const createOverride = trpc.instagramAdmin.createQualityOverride.useMutation({
    onSuccess: (_d, vars) => {
      const retryAsTrial = blockedDraft?.id === vars.inventoryId && blockedDraft.asTrial;
      toast.success("Override recorded", {
        description: retryAsTrial
          ? "Findings accepted — retrying the same MANUAL Trial publish."
          : "Findings accepted — retrying the publish.",
      });
      const d = (drafts || []).find((x: any) => x.id === vars.inventoryId);
      setBlockedDraft(null);
      if (d) {
        publishDraft.mutate({
          inventoryId: d.id,
          platforms: ["instagram"],
          caption: d.publishCaption ?? captionWithHashtags(d),
          imageUrl: d.format !== "reel" ? (d.assetPack?.imageUrl || undefined) : undefined,
          videoUrl: d.format === "reel" ? (d.assetPack?.videoUrl || undefined) : undefined,
          ...(retryAsTrial ? { trialReel: { graduationStrategy: "MANUAL" as const } } : {}),
        });
      }
    },
    onError: (err) => toast.error("Override refused", { description: err.message }),
  });

  const rejectDraft = trpc.instagramAdmin.rejectDraft.useMutation({
    onSuccess: () => {
      toast.success("Draft Rejected");
      refetch();
    },
    // The server's refusals here carry an instruction ("unschedule first",
    // "resolve the ambiguity first", a version mismatch). This was the one
    // mutation on the page that dropped them (2026-10-10 audit, C2).
    onError: (err) => toast.error("Reject refused", { description: err.message }),
  });

  const approveDraft = trpc.instagramAdmin.approveDraft.useMutation({
    onSuccess: () => {
      toast.success("Reel approved successfully! Draft status is now ready.");
      refetch();
    },
    onError: (err) => {
      toast.error("Approval Failed", { description: err.message });
    },
  });

  const all = (drafts || []) as any[];
  const reels = all.filter((d) => d.format === "reel" && (filter === "all" || d.status === filter));
  const legacyStatics = all.filter((d) => d.format !== "reel");
  const reviewDraft = reviewId ? (all.find((d) => d.id === reviewId) ?? null) : null;

  const renderCard = (draft: any) => (
    <Card key={draft.id} className="flex flex-col h-full overflow-hidden">
      <div className="h-40 bg-muted/50 border-b relative flex items-center justify-center">
        {draft.format === "reel" ? (
          draft.assetPack?.videoUrl ? (
            <>
              {/* object-CONTAIN, never cover: a 9:16 frame crammed into this
                  landscape card loses its top and bottom thirds — exactly the
                  regions where captions and covers go wrong. The card is a
                  thumbnail; judgment happens in the review room. */}
              <video src={draft.assetPack.videoUrl} className="object-contain h-full w-full bg-black" controls muted playsInline />
              <Button
                size="sm"
                variant="secondary"
                className="absolute bottom-2 left-2 min-h-11 gap-1.5 bg-black/70 text-white hover:bg-black/85 border border-white/20"
                onClick={() => {
                  setReviewId(draft.id);
                  // Seed the trial form from what was recorded before — typed
                  // strings, empty for never-entered (never a fabricated 0).
                  const t = (draft.conceptBrief?.trial ?? {}) as Record<string, unknown>;
                  setTrialForm(Object.fromEntries(
                    ["views24h", "avgWatchSeconds", "shares", "saves", "comments", "follows"]
                      .map((k) => [k, typeof t[k] === "number" ? String(t[k]) : ""]),
                  ));
                }}
              >
                <Eye className="h-4 w-4" /> Review 9:16
              </Button>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">No Video Attached</span>
          )
        ) : draft.assetPack?.imageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={draft.assetPack.imageUrl} alt="Asset" className="object-cover h-full w-full" />
        ) : (
          <span className="text-sm text-muted-foreground">No Image Attached</span>
        )}
        <Badge className="absolute top-2 right-2 bg-black/70 hover:bg-black/80 capitalize">{draft.format}</Badge>
      </div>
      <CardHeader className="flex-1">
        <div className="flex justify-between items-start mb-2">
          <Badge variant={
            draft.status === "published" ? "default" :
            draft.status === "ready" ? "secondary" :
            draft.status === "rejected" ? "destructive" : "outline"
          } className="capitalize">
            {draft.status.replace("_", " ")}
          </Badge>
          {draft.qualityScore && (
            <div className="flex items-center gap-1 text-xs font-bold px-2 py-1 bg-muted rounded-full">
              {draft.qualityScore.gate === "pass" ? <CheckCircle2 className="h-3 w-3 text-green-500" /> :
               draft.qualityScore.gate === "warn" ? <AlertTriangle className="h-3 w-3 text-yellow-500" /> :
               <XCircle className="h-3 w-3 text-red-500" />}
              {draft.qualityScore.overall}
            </div>
          )}
        </div>
        {draft.conceptBrief?.productionGrammarNovelty && (
          <div className="mb-2 flex flex-wrap gap-1">
            {draft.conceptBrief.productionGrammarNovelty.isProductionTwin && <Badge variant="destructive">grammar twin</Badge>}
            {typeof draft.conceptBrief.productionGrammarNovelty.similarity === "number" && (
              <Badge variant="outline">grammar similarity {draft.conceptBrief.productionGrammarNovelty.similarity.toFixed(2)}</Badge>
            )}
          </div>
        )}
        <CardTitle className="text-base line-clamp-2">
          {draft.conceptBrief?.sourceSummary || "Generated Draft"}
        </CardTitle>
        <CardDescription className="line-clamp-3 mt-2 text-sm">
          {draft.caption || draft.conceptBrief?.hookOptions?.[0] || "No caption written."}
        </CardDescription>
      </CardHeader>
      <CardContent className="bg-muted/10 pt-4 border-t mt-auto">
        <div className="flex gap-2 w-full">
          {draft.status === "needs_review" && draft.format === "reel" ? (
            <Button
              className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold"
              disabled={approveDraft.isPending}
              onClick={() => approveDraft.mutate({ id: draft.id, expectedVersion: draft.version })}
            >
              {approveDraft.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
              Approve Reel
            </Button>
          ) : (
            <Button
              className="flex-1"
              variant="default"
              disabled={draft.status !== "ready" || publishDraft.isPending}
              onClick={() => setConfirmPublishId((current) => (current === draft.id ? null : draft.id))}
            >
              <Send className="h-4 w-4 mr-2" /> Publish…
            </Button>
          )}
          <Button
            variant="outline"
            aria-label="Reject this draft"
            className="flex-none text-destructive hover:bg-destructive/10"
            disabled={draft.status === "published" || draft.status === "rejected"}
            onClick={() => setConfirmRejectId((current) => (current === draft.id ? null : draft.id))}
          >
            <XCircle className="h-4 w-4" />
          </Button>
        </div>

        {confirmPublishId === draft.id && draft.status === "ready" && (
          <div className="mt-3 space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
            <div className="text-sm font-semibold">Publish this {draft.format} to Instagram now?</div>
            <p className="text-xs text-muted-foreground">The media above and this final caption go live exactly as shown{draft.format === "reel" ? " (the server re-verifies the approved reel bytes before posting)" : ""}:</p>
            {draft.format === "reel" && (
              <p className="text-xs text-muted-foreground">
                Trial mode tests this Reel with non-followers first, does not share it to the normal feed initially, and uses MANUAL graduation only.
              </p>
            )}
            <div className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded border bg-background/60 p-2 text-xs leading-5">{draft.publishCaption ?? captionWithHashtags(draft) ?? "(no caption)"}</div>
            {draft.publishCaptionError && <p className="text-xs text-red-400">This cannot publish yet: {draft.publishCaptionError}</p>}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirmPublishId(null)}>Cancel</Button>
              {draft.format === "reel" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={publishDraft.isPending || Boolean(draft.publishCaptionError)}
                  onClick={() => {
                    setConfirmPublishId(null);
                    publishDraft.mutate({
                      inventoryId: draft.id,
                      platforms: ["instagram"],
                      caption: draft.publishCaption ?? captionWithHashtags(draft),
                      videoUrl: draft.assetPack?.videoUrl || undefined,
                      trialReel: { graduationStrategy: "MANUAL" },
                    });
                  }}
                >
                  {publishDraft.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                  Publish as Trial
                </Button>
              )}
              <Button size="sm" disabled={publishDraft.isPending || Boolean(draft.publishCaptionError)} onClick={() => {
                setConfirmPublishId(null);
                publishDraft.mutate({
                  inventoryId: draft.id,
                  platforms: ["instagram"],
                  caption: draft.publishCaption ?? captionWithHashtags(draft),
                  imageUrl: draft.format !== "reel" ? (draft.assetPack?.imageUrl || undefined) : undefined,
                  videoUrl: draft.format === "reel" ? (draft.assetPack?.videoUrl || undefined) : undefined,
                });
              }}>{publishDraft.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />} Yes — publish now</Button>
            </div>
          </div>
        )}

        {confirmRejectId === draft.id && (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-red-500/40 bg-red-500/5 p-3">
            <span className="text-xs">Reject this draft?</span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirmRejectId(null)}>Keep it</Button>
              <Button size="sm" variant="destructive" disabled={rejectDraft.isPending} onClick={() => { rejectDraft.mutate({ id: draft.id, reason: "Manual Rejection", expectedVersion: draft.version }); setConfirmRejectId(null); }}>Reject</Button>
            </div>
          </div>
        )}

        {/* Quality-gate refusal, resolved IN THE DOM (window.confirm is dead
            in the standalone iOS PWA). */}
        {blockedDraft && blockedDraft.id === draft.id && (
          <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-none" />
              <div className="text-xs leading-relaxed">
                <p className="font-semibold text-amber-600">Quality gate held this reel</p>
                <p className="text-muted-foreground mt-1">{blockedDraft?.reason}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                disabled={rerunQa.isPending || !draft.reelJobId}
                onClick={() => draft.reelJobId && rerunQa.mutate({ jobId: Number(draft.reelJobId) })}
                title={draft.reelJobId ? "Re-evaluate the current mp4" : "No reel job linked to this draft"}
              >
                {rerunQa.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                Re-run QA
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setBlockedDraft(null)}>
                Leave it held
              </Button>
            </div>
            <div className="pt-1 space-y-2 border-t border-amber-500/20">
              <p className="text-[11px] text-muted-foreground">
                Publishing anyway records an operator override bound to this exact media.
                A hard BLOCK finding can never be overridden — only advisory ones.
              </p>
              <Input
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Why is this acceptable to publish? (required, recorded)"
                className="h-8 text-xs"
              />
              <Button
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 text-white"
                disabled={overrideReason.trim().length < 4 || createOverride.isPending || publishDraft.isPending}
                onClick={() => createOverride.mutate({
                  inventoryId: draft.id,
                  // Recorded against the reviewed version — the one BEFORE
                  // approve bumped the row.
                  assetVersion: (draft.version ?? 1) - 1,
                  findings: [{ findingId: "operator_accepted_advisory", severity: "repair" as const }],
                  operatorReason: overrideReason.trim(),
                })}
              >
                {createOverride.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Send className="h-3 w-3 mr-1" />}
                Accept findings & publish
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h3 className="text-xl font-medium flex items-center gap-2">
            <Film className="h-5 w-5" />
            Reels
          </h3>
          <p className="text-sm text-muted-foreground">Approve, quality-gate, and publish reels — the verified ReelBrief pipeline's queue.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
          {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Refresh
        </Button>
      </div>

      {/* ── AUTONOMOUS PUBLISH QUEUE ────────────────────────────────────────
          The daily cron is default-deny since #2000: it publishes nothing
          without a recorded, attributable yes bound to the exact caption bytes
          and the exact rendered asset. This is where that yes is given. The
          caption shown is read straight off `reel_jobs` — it is the literal
          text that will post, which is why it renders as preformatted bytes
          rather than prose. */}
      <Card className="border-primary/30">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4" /> Autonomous publish — approval required
              </CardTitle>
              <CardDescription className="mt-1">
                The daily cron publishes nothing without a yes recorded here. One approval covers the
                exact caption and exact video shown, for 72 hours; a re-render or a caption edit voids it.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" className="min-h-11 flex-none" onClick={() => refetchQueue()} disabled={queueLoading}>
              {queueLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* A table that cannot be read is NOT an empty queue. Migration 0112 is
              hand-applied; until it runs, every reel is held and the reason is
              invisible from the rows themselves. */}
          {publishQueue && !publishQueue.approvalsTableReadable && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
              <ShieldAlert className="mt-0.5 h-4 w-4 flex-none text-amber-500" />
              <div className="text-xs leading-relaxed">
                <p className="font-semibold text-amber-600">The approvals table cannot be read</p>
                <p className="mt-1 text-muted-foreground">
                  <code>reel_publish_approvals</code> is unreadable, so no approval can be recorded and
                  no reel can publish. Migration <code>drizzle/0112_reel_publish_approvals.sql</code> is
                  hand-applied — it likely has not been run against production TiDB yet.
                </p>
              </div>
            </div>
          )}

          {queueLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : queueIsError ? (
            /* Unknown, never "empty" — the same standard as the queue below. */
            <p className="text-sm text-muted-foreground">
              Could not read the publish queue. This is unknown, not empty. {queueError?.message}
            </p>
          ) : !publishQueue?.entries.length ? (
            <p className="text-sm text-muted-foreground">
              No assembled reels are waiting. Nothing to approve — the pipeline produces before it publishes.
            </p>
          ) : (
            <div className="space-y-4">
              {publishQueue.entries.map((entry: any) => {
                const approved = entry.approvalProblem === null;
                const vetoed = Boolean(entry.vetoReason);
                return (
                  <div key={entry.jobId} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[128px_minmax(0,1fr)]">
                    <div className="mx-auto w-32">
                      <div className="relative aspect-[9/16] w-full overflow-hidden rounded bg-black">
                        <video src={entry.videoUrl} className="absolute inset-0 h-full w-full object-contain" controls muted playsInline preload="metadata" />
                      </div>
                    </div>

                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">job {entry.jobId}</Badge>
                        {vetoed ? (
                          <Badge variant="destructive" className="gap-1"><Ban className="h-3 w-3" /> vetoed</Badge>
                        ) : approved ? (
                          <Badge className="gap-1 bg-green-600 hover:bg-green-700"><ShieldCheck className="h-3 w-3" /> approved</Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1"><ShieldAlert className="h-3 w-3" /> {entry.approvalProblem.code}</Badge>
                        )}
                        {entry.approvedPackSlug && <Badge variant="outline">{entry.approvedPackSlug}</Badge>}
                        {entry.productionGrammarNovelty?.isProductionTwin && <Badge variant="destructive">grammar twin</Badge>}
                        {typeof entry.productionGrammarNovelty?.similarity === "number" && (
                          <Badge variant="outline">grammar similarity {entry.productionGrammarNovelty.similarity.toFixed(2)}</Badge>
                        )}
                      </div>
                      {entry.productionGrammarNovelty?.collisions?.length > 0 && (
                        <p className="text-xs text-amber-500">
                          Structure overlap: {entry.productionGrammarNovelty.collisions.join(", ")}. Diagnostic only — approval still depends on the normal safety/quality gates.
                        </p>
                      )}

                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Exact caption that will publish
                        </p>
                        <pre className="mt-1 max-h-36 overflow-y-auto whitespace-pre-wrap break-words rounded border bg-muted/20 p-2 text-xs leading-5">{entry.caption}</pre>
                        <p className="mt-1 font-mono text-[10px] text-muted-foreground">sha {entry.captionSha.slice(0, 16)}…</p>
                      </div>

                      {vetoed ? (
                        <div className="rounded border border-red-500/40 bg-red-500/5 p-2 text-xs text-muted-foreground">
                          <span className="font-semibold text-red-500">Cannot be approved. </span>{entry.vetoReason}
                        </div>
                      ) : approved ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-xs text-muted-foreground">
                            Approved by {entry.approvedBy}
                            {entry.expiresAt ? ` · expires ${new Date(entry.expiresAt).toLocaleString()}` : ""}
                          </p>
                          <Button
                            size="sm" variant="outline" className="min-h-11"
                            disabled={revokeReelPublish.isPending}
                            onClick={() => revokeReelPublish.mutate({ jobId: entry.jobId })}
                          >
                            Withdraw approval
                          </Button>
                        </div>
                      ) : (
                        <>
                          <p className="text-xs text-muted-foreground">{entry.approvalProblem.reason}</p>
                          {/* Two-tap, in-DOM: window.confirm is silently
                              suppressed in the installed iOS PWA. */}
                          {confirmApproveJobId === entry.jobId ? (
                            <div className="space-y-2 rounded-lg border border-green-600/40 bg-green-600/5 p-3">
                              <p className="text-xs">
                                Approve the caption above, exactly as written, and the video shown?
                                The cron may then publish it to Instagram unattended within 72 hours.
                              </p>
                              <div className="flex justify-end gap-2">
                                <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setConfirmApproveJobId(null)}>Cancel</Button>
                                <Button
                                  size="sm" className="min-h-11 bg-green-600 text-white hover:bg-green-700"
                                  disabled={approveReelPublish.isPending}
                                  onClick={() => {
                                    setConfirmApproveJobId(null);
                                    approveReelPublish.mutate({
                                      jobId: entry.jobId,
                                      // What was ON SCREEN. The server refuses if the
                                      // live row has changed since this rendered.
                                      expectedCaptionSha: entry.captionSha,
                                      expectedVideoUrl: entry.videoUrl,
                                    });
                                  }}
                                >
                                  {approveReelPublish.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                                  Yes — approve
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Button
                              size="sm" className="min-h-11 bg-green-600 text-white hover:bg-green-700"
                              onClick={() => setConfirmApproveJobId(entry.jobId)}
                            >
                              <Check className="mr-2 h-4 w-4" /> Approve for publish…
                            </Button>
                          )}
                        </>
                      )}

                      {entry.holdReason && (
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          <span className="font-semibold">Current hold on the job: </span>{entry.holdReason}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {(["all", "needs_review", "ready", "scheduled", "published", "rejected"] as const).map((status) => (
          <Button
            key={status}
            variant={filter === status ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(status as any)}
            className="capitalize"
          >
            {status.replace("_", " ")}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : isError ? (
        /* A failed read must never render as "no reels" — unknown, not empty. */
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <h3 className="text-lg font-medium">Could not read the reel queue</h3>
            <p className="mt-1 text-sm text-muted-foreground">This is unknown, not empty. {error?.message}</p>
          </CardContent>
        </Card>
      ) : reels.length === 0 ? (
        <Card className="bg-muted/10 border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Film className="h-12 w-12 text-muted-foreground mb-4 opacity-20" />
            <h3 className="text-lg font-medium">No reels match this view</h3>
            <p className="text-sm text-muted-foreground mt-1">Generate one from Create → Open Advanced Reel Studio.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {reels.map(renderCard)}
        </div>
      )}

      {/* Pre-Studio-V2 static rows live only in THIS inventory — absorbing
          reels must not orphan them, so they stay reachable (not hidden by the
          reel filter) until they empty out naturally. */}
      {legacyStatics.length > 0 && (
        <div className="space-y-3 border-t pt-4">
          <button
            type="button"
            className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground underline"
            onClick={() => setShowLegacyStatics((v) => !v)}
          >
            {showLegacyStatics ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            Legacy static drafts ({legacyStatics.length}) — pre-Studio content still in the old inventory
          </button>
          {showLegacyStatics && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {legacyStatics.map(renderCard)}
            </div>
          )}
        </div>
      )}

      {/* ── 9:16 review room ─────────────────────────────────────────────
          Full-fidelity inspection: the frame as Instagram will show it, the
          UI-overlap zones, the exact server-authoritative caption, and the
          quality evidence — so approval is a judgment about the reel, not
          about a cropped 160px card. Publishing stays on the card's two-tap
          payload panel; this room is for LOOKING and approving. */}
      <Dialog open={reviewDraft != null} onOpenChange={(open) => { if (!open) setReviewId(null); }}>
        <DialogContent className="max-w-4xl max-h-[92dvh] overflow-y-auto">
          {reviewDraft && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <Film className="h-4 w-4" /> Reel review
                  <Badge variant="outline" className="capitalize">{String(reviewDraft.status).replace("_", " ")}</Badge>
                  {reviewDraft.qualityScore && (
                    <Badge variant={reviewDraft.qualityScore.gate === "pass" ? "secondary" : reviewDraft.qualityScore.gate === "warn" ? "outline" : "destructive"}>
                      {reviewDraft.qualityScore.gate} · {reviewDraft.qualityScore.overall}
                    </Badge>
                  )}
                </DialogTitle>
                <DialogDescription className="text-left">
                  {reviewDraft.conceptBrief?.sourceSummary || "Generated reel draft"} · v{reviewDraft.version ?? 1}
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 lg:grid-cols-[minmax(0,auto)_minmax(260px,1fr)]">
                <div className="mx-auto w-full max-w-[min(100%,calc(62dvh*9/16))]">
                  <div className="relative aspect-[9/16] w-full overflow-hidden rounded-lg bg-black">
                    {reviewDraft.assetPack?.videoUrl ? (
                      /* Sound ON is deliberate here — the card preview is muted,
                         and a reel must be reviewed with audio at least once. */
                      <video src={reviewDraft.assetPack.videoUrl} className="absolute inset-0 h-full w-full object-contain" controls playsInline />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">No video attached</div>
                    )}
                    {showSafeZones && reviewDraft.assetPack?.videoUrl && (
                      <div className="pointer-events-none absolute inset-0" aria-hidden>
                        <div className="absolute inset-x-0 top-0 border-b border-red-400/70 bg-red-500/10" style={{ height: `${REEL_SAFE.top * 100}%` }}>
                          <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[9px] font-semibold uppercase tracking-wide text-red-300">UI top</span>
                        </div>
                        <div className="absolute inset-x-0 bottom-0 border-t border-red-400/70 bg-red-500/10" style={{ height: `${REEL_SAFE.bottom * 100}%` }}>
                          <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[9px] font-semibold uppercase tracking-wide text-red-300">caption / actions</span>
                        </div>
                        <div
                          className="absolute right-0 border-l border-red-400/70 bg-red-500/10"
                          style={{ top: `${REEL_SAFE.top * 100}%`, bottom: `${REEL_SAFE.bottom * 100}%`, width: `${REEL_SAFE.right * 100}%` }}
                        >
                          <span className="absolute right-1 top-1 rounded bg-black/60 px-1 text-[9px] font-semibold uppercase tracking-wide text-red-300">rail</span>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" className="min-h-11" onClick={() => setShowSafeZones((v) => !v)}>
                      {showSafeZones ? "Hide" : "Show"} UI-overlap zones
                    </Button>
                    {reviewDraft.reelJobId && (
                      <Button size="sm" variant="outline" className="min-h-11" disabled={rerunQa.isPending}
                        onClick={() => rerunQa.mutate({ jobId: Number(reviewDraft.reelJobId) })}>
                        {rerunQa.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                        Re-run rendered QA
                      </Button>
                    )}
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    Zones are approximate Instagram chrome — keep captions and the subject inside the clear area.
                    The first frame doubles as the cover: scrub to 0:00 and judge it as the profile-grid tile.
                    Review once with sound and once muted.
                  </p>
                </div>

                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Exact publish caption</p>
                    <p className="text-[11px] text-muted-foreground">For reels the server rebuilds the approved caption at publish — this is the authoritative copy.</p>
                    <div className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded border bg-muted/20 p-2 text-xs leading-5">
                      {reviewDraft.publishCaption ?? captionWithHashtags(reviewDraft) ?? "(no caption)"}
                    </div>
                    {reviewDraft.publishCaptionError && (
                      <p className="mt-1 text-xs text-red-400">Cannot publish yet: {reviewDraft.publishCaptionError}</p>
                    )}
                  </div>
                  {reviewDraft.qualityScore?.blockers?.length > 0 && (
                    <div className="rounded border border-red-500/40 bg-red-500/5 p-2">
                      <p className="text-xs font-semibold text-red-500">Blocking findings</p>
                      <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                        {reviewDraft.qualityScore.blockers.map((b: string) => <li key={b}>· {b}</li>)}
                      </ul>
                    </div>
                  )}
                  {reviewDraft.status === "needs_review" && (
                    <Button
                      className="w-full min-h-11 bg-green-600 font-semibold text-white hover:bg-green-700"
                      disabled={approveDraft.isPending}
                      onClick={() => approveDraft.mutate({ id: reviewDraft.id, expectedVersion: reviewDraft.version })}
                    >
                      {approveDraft.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                      Approve reel
                    </Button>
                  )}
                  <div className="rounded border bg-muted/10 p-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Approval standard</p>
                    <p className="text-[11px] text-muted-foreground">Judge, don't hope. A reel is approvable only if every answer is yes:</p>
                    <ul className="mt-1 space-y-0.5 text-[11px] leading-relaxed text-muted-foreground">
                      <li>· Understandable muted?</li>
                      <li>· Would someone SEND this to a friend?</li>
                      <li>· Would someone SAVE it for later?</li>
                      <li>· Is the mechanic truth real (sourced)?</li>
                      <li>· Is the Cleveland angle specific?</li>
                      <li>· First frame visually unusual?</li>
                      <li>· Final frame loops back?</li>
                      <li>· No fake claims, prices, or urgency?</li>
                      <li>· No generated text or logos in-frame?</li>
                      <li>· Trust before selling?</li>
                    </ul>
                  </div>
                  {/* Trial publishing is wired through Meta trial_params.
                      Trial-specific 24h metrics remain manual until a verified
                      Graph ingestion surface is wired. */}
                  <div className="rounded border bg-muted/10 p-2 space-y-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Trial result · 24h (manual)</p>
                    <div className="grid grid-cols-2 gap-2">
                      {([["views24h", "Views"], ["avgWatchSeconds", "Avg watch (s)"], ["shares", "Shares"], ["saves", "Saves"], ["comments", "Comments"], ["follows", "Follows"]] as const).map(([key, label]) => (
                        <label key={key} className="space-y-0.5">
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
                          <Input
                            inputMode="numeric"
                            value={trialForm[key] ?? ""}
                            onChange={(e) => setTrialForm((f) => ({ ...f, [key]: e.target.value }))}
                            placeholder="—"
                            className="h-9 text-xs"
                          />
                        </label>
                      ))}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full min-h-11"
                      disabled={recordTrial.isPending || Object.values(trialForm).every((v) => v.trim() === "")}
                      onClick={() => {
                        const num = (k: string) => {
                          const v = (trialForm[k] ?? "").trim();
                          if (v === "") return undefined;
                          const n = Number(v);
                          return Number.isFinite(n) && n >= 0 ? (k === "avgWatchSeconds" ? n : Math.round(n)) : undefined;
                        };
                        recordTrial.mutate({
                          id: reviewDraft.id,
                          expectedVersion: reviewDraft.version ?? 1,
                          trial: {
                            postedAsTrial: true,
                            views24h: num("views24h"),
                            avgWatchSeconds: num("avgWatchSeconds"),
                            shares: num("shares"),
                            saves: num("saves"),
                            comments: num("comments"),
                            follows: num("follows"),
                          },
                        });
                      }}
                    >
                      {recordTrial.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                      Record trial result
                    </Button>
                    <p className="text-[10px] text-muted-foreground">Empty fields stay unrecorded — never written as zero.</p>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Publishing stays on the card — close this room and use Publish… to see the exact payload before anything goes live.
                  </p>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
