import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, BarChart3, Check, Copy, Download, ExternalLink, Image as ImageIcon, Loader2, Plus, RefreshCw, Save, Search, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { writeCreateHandoff, type IgView } from "./igViews";

function downloadHighlightCover(label: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#0A0A0A";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#FDB913";
  ctx.lineWidth = 34;
  ctx.beginPath();
  ctx.arc(540, 960, 350, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#FDB913";
  ctx.font = "700 106px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const words = label.toUpperCase().split(/\s+/);
  const lines = words.length <= 2 ? words : [words[0], words.slice(1).join(" ")];
  const startY = 960 - ((lines.length - 1) * 62);
  lines.forEach((line, i) => ctx.fillText(line, 540, startY + i * 124, 600));
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nicks-instagram-highlight-" + label.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".png";
    a.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}

export default function Strategy({ onNavigate }: { onNavigate: (view: IgView) => void }) {
  const slate = trpc.instagramAdmin.getActiveSlate.useQuery(undefined, { refetchInterval: 120_000 });
  const profile = trpc.instagramAdmin.getProfileMerchandising.useQuery(undefined, { staleTime: 120_000 });
  const calibration = trpc.instagramAdmin.getReelJudgeCalibration.useQuery(undefined, { staleTime: 120_000 });
  const hypotheses = trpc.instagramAdmin.getStructureHypotheses.useQuery(undefined, { staleTime: 120_000 });
  const [selected, setSelected] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!slate.data || dirty) return;
    setSelected(
      slate.data.active.configured
        ? slate.data.active.slugs.slice(slate.data.active.cursor ?? 0)
        : slate.data.recommendedSlugs,
    );
  }, [slate.data, dirty]);

  const save = trpc.instagramAdmin.saveActiveSlate.useMutation({
    onSuccess: async () => {
      toast.success("Active Reel slate saved", { description: "Production now reads this ordered remaining queue from item 1; the full approved-library cursor was not moved." });
      setDirty(false);
      await utils.instagramAdmin.getActiveSlate.invalidate();
    },
    onError: (err) => toast.error("Slate not saved", { description: err.message }),
  });
  const clear = trpc.instagramAdmin.clearActiveSlate.useMutation({
    onSuccess: async () => {
      toast.success("Active Reel slate disabled", { description: "Production resumed the full approved library at its pre-slate cursor." });
      setConfirmClear(false);
      setDirty(false);
      setSelected([]);
      await utils.instagramAdmin.getActiveSlate.invalidate();
    },
    onError: (err) => toast.error("Slate not disabled", { description: err.message }),
  });

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = slate.data?.candidates ?? [];
    if (!q) return rows;
    return rows.filter((row) => row.topic.toLowerCase().includes(q) || row.slug.toLowerCase().includes(q));
  }, [slate.data?.candidates, search]);
  const selectedRows = selected
    .map((slug) => slate.data?.candidates.find((c) => c.slug === slug))
    .filter(Boolean) as NonNullable<typeof slate.data>["candidates"];

  const move = (index: number, delta: number) => {
    const next = [...selected];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setSelected(next);
    setDirty(true);
  };
  const add = (slug: string) => {
    if (selected.includes(slug) || selected.length >= 24) return;
    setSelected([...selected, slug]);
    setDirty(true);
  };
  const remove = (slug: string) => {
    setSelected(selected.filter((s) => s !== slug));
    setDirty(true);
  };

  return (
    <div className="space-y-6 pb-12">
      <div>
        <h3 className="text-2xl font-bold">Strategy &amp; Profile</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Curate what production can pull next, inspect creative fatigue, and turn measured outcomes into explicit experiments.
        </p>
      </div>

      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle>Active Reel slate</CardTitle>
          <CardDescription>
            Ordered production input. This is an editorial queue, not a virality score; every Reel still clears the normal generation, QA, approval, claim, and publish gates.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {slate.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Building the approved-pack census…</p>
          ) : slate.isError ? (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm"><AlertTriangle className="mr-2 inline h-4 w-4 text-amber-500" /> Active slate is unknown: {slate.error?.message}</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline">{slate.data?.candidates.length ?? 0} approved packs</Badge>
                <Badge variant="outline">{selected.length} remaining</Badge>
                <Badge variant="outline">{slate.data?.realShopMediaCount ?? 0} reusable real-shop assets</Badge>
                <Badge variant={slate.data?.active.configured ? "default" : "secondary"}>
                  {slate.data?.active.configured
                    ? `Production slate configured · next #${(slate.data.active.cursor ?? 0) + 1}`
                    : "Recommended draft · save to activate"}
                </Badge>
                {slate.data?.active.malformed && <Badge variant="destructive">Saved slate malformed · production refuses it</Badge>}
              </div>
              <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
                <strong className="text-foreground">Recommendation basis:</strong> {slate.data?.rankingBasis.join(" · ")}
                <div className="mt-1"><strong className="text-foreground">Unknowns:</strong> {slate.data?.unknowns.join(" · ")}</div>
              </div>

              <div className="space-y-2">
                {selectedRows.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No packs selected. Add at least one before saving.</p>
                ) : selectedRows.map((row, index) => (
                  <div key={row.slug} className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
                    <span className="w-7 text-center text-xs font-bold text-muted-foreground">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium capitalize">{row.topic}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {row.productionTwin && <Badge variant="destructive">grammar twin</Badge>}
                        {row.noveltySimilarity != null && <Badge variant="outline">similarity {row.noveltySimilarity.toFixed(2)}</Badge>}
                        {row.publishedCount > 0 && <Badge variant="outline">published {row.publishedCount}×</Badge>}
                      </div>
                    </div>
                    <Button size="icon" variant="ghost" className="h-10 w-10" onClick={() => move(index, -1)} disabled={index === 0}><ArrowUp className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="h-10 w-10" onClick={() => move(index, 1)} disabled={index === selectedRows.length - 1}><ArrowDown className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="h-10 w-10 text-destructive" onClick={() => remove(row.slug)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => { setSelected(slate.data?.recommendedSlugs ?? []); setDirty(true); }}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Load recommended 12
                </Button>
                <Button disabled={!selected.length || save.isPending || (!dirty && slate.data?.active.configured)} onClick={() => save.mutate({ slugs: selected })}>
                  {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save active slate
                </Button>
                {slate.data?.active.configured && !confirmClear && (
                  <Button variant="ghost" className="text-muted-foreground" onClick={() => setConfirmClear(true)}>Use full approved library instead…</Button>
                )}
              </div>
              {confirmClear && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                  <p className="font-semibold">Disable the active slate?</p>
                  <p className="mt-1 text-xs text-muted-foreground">Production will return to the full approved library at its existing cursor. Existing Reel jobs, approvals, and the full-library position are untouched.</p>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="destructive" disabled={clear.isPending} onClick={() => clear.mutate()}>
                      {clear.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Disable slate
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setConfirmClear(false)}>Keep slate</Button>
                  </div>
                </div>
              )}
              <div className="space-y-2 border-t pt-4">
                <div className="relative max-w-md">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search approved packs…" />
                </div>
                <div className="max-h-[32rem] space-y-2 overflow-y-auto pr-1">
                  {candidates.map((row) => (
                    <div key={row.slug} className="flex items-start gap-3 rounded-lg border p-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium capitalize">{row.topic}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{row.reasons.join(" · ")}</p>
                        {row.collisions.length > 0 && <p className="mt-1 text-xs text-amber-500">Collides on: {row.collisions.join(", ")}</p>}
                      </div>
                      {selected.includes(row.slug) ? (
                        <Badge variant="outline"><Check className="mr-1 h-3 w-3" /> active</Badge>
                      ) : (
                        <Button size="sm" variant="outline" disabled={selected.length >= 24} onClick={() => add(row.slug)}><Plus className="mr-1 h-3 w-3" /> Add</Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Judge calibration</CardTitle>
            <CardDescription>Shadow-judge decisions joined to what published Reels actually did afterward.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {calibration.isLoading ? <p className="text-sm text-muted-foreground">Checking…</p> : calibration.isError ? (
              <p className="text-sm text-amber-500">Calibration is unknown: {calibration.error?.message}</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Judged</div><div className="text-xl font-bold">{calibration.data?.summary.judged ?? 0}</div></div>
                  <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">Would block</div><div className="text-xl font-bold">{calibration.data?.summary.wouldBlock ?? 0}</div></div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Eligible coverage: {calibration.data?.calibrationReadiness.coverageRate == null ? "unknown" : String(Math.round(calibration.data.calibrationReadiness.coverageRate * 100)) + "%"}.
                  {" "}The sample is conditioned on Reels that already cleared rendered QA; it is not a quality base rate.
                </p>
                <div className="grid gap-2 md:grid-cols-2">
                  {(["wouldBlock", "clear"] as const).map((key) => {
                    const c = calibration.data?.outcomeCohorts[key];
                    return <div key={key} className="rounded-lg border p-3 text-xs">
                      <p className="font-semibold">{key === "wouldBlock" ? "Judge would block" : "Judge clear"} · n={c?.n ?? 0}</p>
                      <p className="mt-1 text-muted-foreground">saves/reach {c?.avgSavesPerReach?.toFixed(4) ?? "n/r"} · shares/reach {c?.avgSharesPerReach?.toFixed(4) ?? "n/r"} · skip raw {c?.avgSkipRateRaw?.toFixed(4) ?? "n/r"}</p>
                    </div>;
                  })}
                </div>
                <div className={"rounded-lg border p-3 text-sm " + (calibration.data?.outcomeAlignment.status === "not_supported_by_current_outcomes" ? "border-red-500/40 bg-red-500/5" : "border-amber-500/40 bg-amber-500/5")}>
                  <ShieldCheck className="mr-2 inline h-4 w-4" />
                  <strong>{calibration.data?.outcomeAlignment.status.split("_").join(" ")}</strong>
                  <p className="mt-1 text-xs text-muted-foreground">{calibration.data?.outcomeAlignment.note}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(calibration.data?.outcomeAlignment.metrics ?? []).map((metric) => (
                      <Badge key={metric.metric} variant={metric.alignment === "contrary" ? "destructive" : "outline"}>
                        {metric.metric.replaceAll("_", " ")} · {metric.alignment.replaceAll("_", " ")}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className={"rounded-lg border p-3 text-sm " + (calibration.data?.calibrationReadiness.evidenceReadyForOperatorDecision ? "border-blue-500/40 bg-blue-500/5" : "border-amber-500/40 bg-amber-500/5")}>
                  <strong>Evidence coverage</strong>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {calibration.data?.calibrationReadiness.evidenceReadyForOperatorDecision
                      ? "Enough coverage/sample exists to REVIEW the question, but coverage is not calibration and never flips the gate by itself."
                      : "Not enough coverage/sample to review promotion yet. " + (calibration.data?.calibrationReadiness.rule ?? "")}
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Structure hypotheses</CardTitle>
            <CardDescription>Measured correlations turned into explicit priors you can test — not hidden causal rules.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {hypotheses.isLoading ? <p className="text-sm text-muted-foreground">Checking…</p> : hypotheses.isError ? (
              <p className="text-sm text-amber-500">Hypotheses are unknown: {hypotheses.error?.message}</p>
            ) : (hypotheses.data?.hypotheses.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">{hypotheses.data?.sampleCount ?? 0} measured Reels — no signal yet clears the minimum comparison sample.</p>
            ) : hypotheses.data!.hypotheses.slice(0, 6).map((h) => (
              <div key={h.family + "-" + h.signal + "-" + h.metric} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{h.metric}</Badge>
                  <Badge variant={h.direction === "beneficial_in_sample" ? "default" : "secondary"}>{h.direction.split("_").join(" ")}</Badge>
                </div>
                <p className="mt-2 text-sm">{h.statement}</p>
                <p className="mt-1 text-xs text-muted-foreground">n={h.withN} with · n={h.withoutN} without · raw delta {h.delta.toFixed(4)}</p>
                <Button className="mt-3 min-h-10" size="sm" variant="outline" onClick={() => {
                  writeCreateHandoff({
                    sourceType: "manual_idea",
                    detail: "CONTROLLED STRUCTURE PRIOR — correlation only, not causal: " + h.statement + " Build a NEW Reel concept that tests this one structure signal while keeping the mechanic truth and topic independent. Treat the result as one candidate for a controlled comparison; do not generalize from one post.",
                    format: "reel",
                    objective: "engagement",
                  });
                  onNavigate("create");
                }}><BarChart3 className="mr-2 h-4 w-4" /> Test this prior in Create</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile merchandising</CardTitle>
          <CardDescription>Measured candidates for the profile shelf. Pinning, Highlight order/covers, and bio edits remain explicit Instagram-side actions.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {profile.isLoading ? <p className="text-sm text-muted-foreground">Loading profile evidence…</p> : profile.isError ? (
            <p className="text-sm text-amber-500">Profile evidence is unknown: {profile.error?.message}</p>
          ) : (
            <>
              <div className="grid gap-3 xl:grid-cols-3">
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-semibold">Current bio evidence</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{profile.data?.bioReview.currentBio ?? "Current bio unavailable on this container."}</p>
                  {profile.data?.bioReview.currentWebsite && <p className="mt-2 text-xs text-muted-foreground">{profile.data.bioReview.currentWebsite}</p>}
                  <p className="mt-2 text-xs text-muted-foreground">{profile.data?.bioReview.note}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-semibold">Suggested conversion bio</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{profile.data?.bioReview.recommendedBio}</p>
                  <Button
                    className="mt-3 min-h-10"
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const value = profile.data?.bioReview.recommendedBio;
                      if (!value) return;
                      try {
                        await navigator.clipboard.writeText(value);
                        toast.success("Suggested bio copied");
                      } catch {
                        toast.error("Could not copy bio");
                      }
                    }}
                  >
                    <Copy className="mr-2 h-3.5 w-3.5" /> Copy bio
                  </Button>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-semibold">Conversion hierarchy to preserve</p>
                  <ol className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {(profile.data?.bioReview.hierarchy ?? []).map((item, i) => <li key={item}>{i + 1}. {item}</li>)}
                  </ol>
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold">Pin candidate pool · choose at most 3</p>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {(profile.data?.pinCandidates ?? []).map((p) => (
                    <div key={p.role} className="rounded-lg border p-3">
                      <Badge variant="outline">{p.role.split("_").join(" ")}</Badge>
                      <p className="mt-2 line-clamp-3 text-sm">{p.row.caption || "Caption unavailable"}</p>
                      <p className="mt-2 text-xs font-medium">{p.evidence}</p>
                      {p.link && (
                        <Button asChild className="mt-3 min-h-10 w-full" size="sm" variant="outline">
                          <a href={p.link} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-3.5 w-3.5" /> Open post</a>
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold">Highlight shelf plan + upload-ready covers</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  {(profile.data?.highlightPlan ?? []).map((h) => (
                    <div key={h.label} className="rounded-lg border p-3 text-center">
                      <div
                        className="mx-auto flex aspect-square w-24 items-center justify-center rounded-full border-4 bg-black px-2 text-center text-xs font-black uppercase"
                        style={{ borderColor: "#FDB913", color: "#FDB913" }}
                      >
                        {h.label}
                      </div>
                      <p className="mt-2 text-xs font-semibold">{h.label}</p>
                      <p className="mt-1 min-h-10 text-[11px] text-muted-foreground">{h.purpose}</p>
                      <Button className="mt-2 min-h-10 w-full" size="sm" variant="outline" onClick={() => downloadHighlightCover(h.label)}>
                        <Download className="mr-1 h-3 w-3" /> PNG
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold">Recent Reel cover shelf · visual review</p>
                {(profile.data?.coverReview.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground">No recent Reel media is available in the cache/fallback.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    {profile.data!.coverReview.map((post) => (
                      <div key={post.id} className="overflow-hidden rounded-lg border">
                        <a href={post.link} target="_blank" rel="noreferrer" className="block bg-black">
                          {post.mediaUrl ? (
                            post.type === "VIDEO"
                              ? <video src={post.mediaUrl} className="aspect-[9/16] h-full w-full object-cover" muted playsInline preload="metadata" />
                              : <img src={post.mediaUrl} alt="Recent Instagram cover" className="aspect-[9/16] h-full w-full object-cover" />
                          ) : <div className="flex aspect-[9/16] items-center justify-center text-muted-foreground"><ImageIcon className="h-5 w-5" /></div>}
                        </a>
                        <div className="space-y-1 p-2 text-[10px] text-muted-foreground">
                          <div>reach {post.metrics.reach ?? "n/r"}</div>
                          <div>saves {post.metrics.saved ?? "n/r"} · shares {post.metrics.shares ?? "n/r"}</div>
                          <div>skip raw {post.metrics.skipRate ?? "n/r"}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">{profile.data?.boundary}</p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
