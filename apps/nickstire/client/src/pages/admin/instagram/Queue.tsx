import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Kanban, Search, RefreshCw, Send, CheckCircle2, XCircle, AlertTriangle, Check } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type DraftStatus = "needs_review" | "ready" | "scheduled" | "published" | "rejected";

/**
 * The caption exactly as the server would build it.
 *
 * instagramStudio.publish (:539) and .schedule (:628) both compose the caption,
 * a blank line, then the hashtags. This screen sent the BARE caption — so the
 * same draft published from here lost every hashtag, while the same draft
 * published from the V2 queue kept them. One piece of content, two doors, two
 * different posts, and nothing said so.
 *
 * This screen is reachable: QueueV2.tsx:70 renders it behind a "show legacy"
 * toggle. I previously reported it as unreachable dead code and was wrong.
 *
 * Mirrored rather than re-invented — and if these ever drift again the right fix
 * is to make the server authoritative for the caption on every format, not to
 * patch a third copy.
 */
function captionWithHashtags(draft: { caption?: string | null; hashtags?: string[] | null }): string {
  const caption = (draft.caption || "").trim();
  const tags = (draft.hashtags ?? []).filter(Boolean).map((t) => (t.startsWith("#") ? t : `#${t}`));
  return tags.length ? [caption, tags.join(" ")].join("\n\n").trim() : caption;
}

export default function Queue({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<DraftStatus | "all">("all");
  /** Draft whose publish was refused by the quality gate, awaiting an operator decision. */
  const [blockedDraft, setBlockedDraft] = useState<{ id: string; version: number; reason: string } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  /** Two-tap reject (in-DOM — window.confirm is suppressed in the installed
   *  iOS PWA). One tap on an icon 8px from Publish used to reject instantly. */
  const [confirmRejectId, setConfirmRejectId] = useState<string | null>(null);

  const { data: drafts, isLoading, isError, error, refetch } = trpc.instagramAdmin.getAllDrafts.useQuery();

  const publishDraft = trpc.instagramAdmin.publishPost.useMutation({
    onSuccess: () => {
      toast.success("Published Successfully!");
      refetch();
    },
    onError: (err, vars) => {
      // The quality gate refuses on ADVISORY findings too, and until now that was
      // a dead end: an error toast and no way forward. createQualityOverride has
      // existed (session-authed) the whole time with no caller. Offer it here.
      const gateRefusal = /rendered-QA gate|quality decision|needs_review|needs_paid_repair|stale/i.test(err.message);
      if (gateRefusal && vars?.inventoryId) {
        const d = (drafts || []).find((x: any) => x.id === vars.inventoryId);
        setBlockedDraft({ id: vars.inventoryId, version: d?.version ?? 0, reason: err.message });
        setOverrideReason("");
        return;
      }
      toast.error("Publishing Failed", { description: err.message });
    }
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
          // The override RETRY is a publish, and it dropped hashtags identically.
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
    }
  });

  const approveDraft = trpc.instagramAdmin.approveDraft.useMutation({
    onSuccess: () => {
      toast.success("Reel approved successfully! Draft status is now ready.");
      refetch();
    },
    onError: (err) => {
      toast.error("Approval Failed", { description: err.message });
    }
  });

  const filteredDrafts = (drafts || []).filter((d: any) => {
    if (filter !== "all" && d.status !== filter) return false;
    if (searchQuery && !d.conceptBrief?.sourceSummary?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h3 className="text-xl font-medium flex items-center gap-2">
            <Kanban className="h-5 w-5" />
            Publishing Queue & Gates
          </h3>
          <p className="text-sm text-muted-foreground">Manage staged content, review quality gates, and publish.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
          {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Refresh
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 bg-muted/20 p-4 rounded-lg border border-border/50">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search drafts..." 
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {(["all", "needs_review", "ready", "scheduled", "published", "rejected"] as const).map(status => (
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
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : isError ? (
        /* A failed read rendered as "No drafts found" — an outage presented as an
           editorial fact. The reasonable response to an empty queue is to go make
           something, which is the worst move while the drafts you already have are
           merely unreadable. */
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <h3 className="text-lg font-medium">Could not read the queue</h3>
            <p className="mt-1 text-sm text-muted-foreground">This is unknown, not empty. {error?.message}</p>
          </CardContent>
        </Card>
      ) : filteredDrafts.length === 0 ? (
        <Card className="bg-muted/10 border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Kanban className="h-12 w-12 text-muted-foreground mb-4 opacity-20" />
            <h3 className="text-lg font-medium">No drafts found</h3>
            <p className="text-sm text-muted-foreground mt-1">Try adjusting your filters or head to the Studio to create one.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredDrafts.map((draft: any) => (
            <Card key={draft.id} className="flex flex-col h-full overflow-hidden">
              <div className="h-40 bg-muted/50 border-b relative flex items-center justify-center">
                {draft.format === "reel" ? (
                  draft.assetPack?.videoUrl ? (
                    <video src={draft.assetPack.videoUrl} className="object-cover h-full w-full" controls muted playsInline />
                  ) : (
                    <span className="text-sm text-muted-foreground">No Video Attached</span>
                  )
                ) : (
                  draft.assetPack?.imageUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={draft.assetPack.imageUrl} alt="Asset" className="object-cover h-full w-full" />
                  ) : (
                    <span className="text-sm text-muted-foreground">No Image Attached</span>
                  )
                )}
                <Badge className="absolute top-2 right-2 bg-black/70 hover:bg-black/80 capitalize">
                  {draft.format}
                </Badge>
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
                      onClick={() => publishDraft.mutate({ 
                        inventoryId: draft.id,
                        platforms: ["instagram"],
                        caption: captionWithHashtags(draft), 
                        imageUrl: draft.format !== "reel" ? (draft.assetPack?.imageUrl || undefined) : undefined,
                        videoUrl: draft.format === "reel" ? (draft.assetPack?.videoUrl || undefined) : undefined
                      })}
                    >
                      <Send className="h-4 w-4 mr-2" /> Publish
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    aria-label="Reject this draft"
                    className="flex-none text-destructive hover:bg-destructive/10"
                    disabled={draft.status === "published" || draft.status === "rejected"}
                    onClick={() => setConfirmRejectId((current) => current === draft.id ? null : draft.id)}
                  >
                    <XCircle className="h-4 w-4" />
                  </Button>
                </div>

                {confirmRejectId === draft.id && (
                  <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-red-500/40 bg-red-500/5 p-3">
                    <span className="text-xs">Reject this draft?</span>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setConfirmRejectId(null)}>Keep it</Button>
                      <Button size="sm" variant="destructive" disabled={rejectDraft.isPending} onClick={() => { rejectDraft.mutate({ id: draft.id, reason: "Manual Rejection" }); setConfirmRejectId(null); }}>Reject</Button>
                    </div>
                  </div>
                )}

                {/* Quality-gate refusal, resolved IN THE DOM. window.confirm is
                    silently suppressed in the standalone iOS PWA, so a native
                    dialog here would look like a dead button on the operator's
                    phone. */}
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
                          // The approval is recorded against the reviewed version,
                          // which is the one BEFORE approve bumped the row.
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
          ))}
        </div>
      )}
    </div>
  );
}
