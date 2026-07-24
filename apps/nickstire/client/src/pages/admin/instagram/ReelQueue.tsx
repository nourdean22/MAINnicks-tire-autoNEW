import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Film, RefreshCw, Send, CheckCircle2, XCircle, AlertTriangle, Check, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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
  const [blockedDraft, setBlockedDraft] = useState<{ id: string; version: number; reason: string } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  /** Two-tap reject (in-DOM — window.confirm is suppressed in the installed iOS PWA). */
  const [confirmRejectId, setConfirmRejectId] = useState<string | null>(null);
  /** Two-tap publish through a panel showing the exact payload. */
  const [confirmPublishId, setConfirmPublishId] = useState<string | null>(null);

  const { data: drafts, isLoading, isError, error, refetch } = trpc.instagramAdmin.getAllDrafts.useQuery();

  const publishDraft = trpc.instagramAdmin.publishPost.useMutation({
    onSuccess: () => {
      toast.success("Published Successfully!");
      refetch();
    },
    onError: (err, vars) => {
      // The quality gate refuses on ADVISORY findings too — offer the recorded
      // override path instead of a dead-end error toast.
      const gateRefusal = /rendered-QA gate|quality decision|needs_review|needs_paid_repair|stale/i.test(err.message);
      if (gateRefusal && vars?.inventoryId) {
        const d = (drafts || []).find((x: any) => x.id === vars.inventoryId);
        setBlockedDraft({ id: vars.inventoryId, version: d?.version ?? 0, reason: err.message });
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
      toast.success("Override recorded", { description: "Findings accepted — retrying the publish." });
      const d = (drafts || []).find((x: any) => x.id === vars.inventoryId);
      setBlockedDraft(null);
      if (d) {
        publishDraft.mutate({
          inventoryId: d.id,
          platforms: ["instagram"],
          caption: captionWithHashtags(d),
          imageUrl: d.format !== "reel" ? (d.assetPack?.imageUrl || undefined) : undefined,
          videoUrl: d.format === "reel" ? (d.assetPack?.videoUrl || undefined) : undefined,
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

  const renderCard = (draft: any) => (
    <Card key={draft.id} className="flex flex-col h-full overflow-hidden">
      <div className="h-40 bg-muted/50 border-b relative flex items-center justify-center">
        {draft.format === "reel" ? (
          draft.assetPack?.videoUrl ? (
            <video src={draft.assetPack.videoUrl} className="object-cover h-full w-full" controls muted playsInline />
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
            <div className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded border bg-background/60 p-2 text-xs leading-5">{captionWithHashtags(draft) || "(no caption)"}</div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirmPublishId(null)}>Cancel</Button>
              <Button size="sm" disabled={publishDraft.isPending} onClick={() => {
                setConfirmPublishId(null);
                publishDraft.mutate({
                  inventoryId: draft.id,
                  platforms: ["instagram"],
                  caption: captionWithHashtags(draft),
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
              <Button size="sm" variant="destructive" disabled={rejectDraft.isPending} onClick={() => { rejectDraft.mutate({ id: draft.id, reason: "Manual Rejection" }); setConfirmRejectId(null); }}>Reject</Button>
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
    </div>
  );
}
