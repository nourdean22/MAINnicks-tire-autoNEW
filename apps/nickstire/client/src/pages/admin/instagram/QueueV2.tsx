import { useMemo, useState } from "react";
import {
  AlertTriangle, CalendarClock, CheckCircle2, Clock3, Edit3, ExternalLink,
  Image as ImageIcon, Loader2, RefreshCw, Send, ShieldCheck, Trash2, X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import type { InstagramStudioDraft } from "../../../../shared/instagramStudio";
import LegacyQueue from "./Queue";

type QueueStatus = "all" | "needs_review" | "ready" | "scheduled" | "published" | "rejected";

function badgeClass(status: string) {
  if (status === "ready" || status === "published") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-400";
  if (status === "rejected" || status === "failed") return "border-red-500/40 bg-red-500/10 text-red-400";
  if (status === "scheduled") return "border-blue-500/40 bg-blue-500/10 text-blue-400";
  return "border-amber-500/40 bg-amber-500/10 text-amber-400";
}

export default function QueueV2() {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<QueueStatus>("all");
  const [search, setSearch] = useState("");
  const [showLegacy, setShowLegacy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<InstagramStudioDraft | null>(null);
  const [scheduleById, setScheduleById] = useState<Record<string, string>>({});
  const [rejectReasonById, setRejectReasonById] = useState<Record<string, string>>({});

  const list = trpc.instagramStudio.list.useQuery({ limit: 75 }, { refetchInterval: 30_000 });
  const diagnostics = trpc.instagramStudio.diagnostics.useQuery(undefined, { refetchInterval: 60_000 });
  const invalidate = async () => {
    await Promise.all([utils.instagramStudio.list.invalidate(), utils.instagramStudio.diagnostics.invalidate()]);
  };
  const approve = trpc.instagramStudio.approve.useMutation({ onSuccess: async () => { await invalidate(); toast.success("Draft approved"); }, onError: (e) => toast.error("Approval failed", { description: e.message }) });
  const publish = trpc.instagramStudio.publish.useMutation({ onSuccess: async () => { await invalidate(); toast.success("Published to Instagram"); }, onError: (e) => toast.error("Publish failed", { description: e.message }) });
  const schedule = trpc.instagramStudio.schedule.useMutation({ onSuccess: async () => { await invalidate(); toast.success("Post scheduled"); }, onError: (e) => toast.error("Scheduling failed", { description: e.message }) });
  const reject = trpc.instagramStudio.reject.useMutation({ onSuccess: async () => { await invalidate(); toast.success("Draft rejected"); }, onError: (e) => toast.error("Reject failed", { description: e.message }) });
  const rerender = trpc.instagramStudio.render.useMutation({
    onSuccess: (result) => {
      setEditDraft(result as InstagramStudioDraft);
      toast.success("Edited visual re-rendered");
    },
    onError: (e) => toast.error("Re-render failed", { description: e.message }),
  });
  const update = trpc.instagramStudio.update.useMutation({
    onSuccess: async () => {
      await invalidate();
      setEditingId(null);
      setEditDraft(null);
      toast.success("Draft saved and returned to review");
    },
    onError: (e) => toast.error("Save failed", { description: e.message }),
  });

  const counts: Record<string, number> = diagnostics.data?.counts ?? {};
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (list.data ?? []).filter((item) => {
      if (status !== "all" && item.status !== status) return false;
      if (!q || !item.draft) return !q;
      const draft = item.draft as InstagramStudioDraft;
      return [draft.topic, draft.caption, draft.headline, draft.source.type, draft.format].join(" ").toLowerCase().includes(q);
    });
  }, [list.data, search, status]);

  if (showLegacy) {
    return <div className="space-y-4"><Button variant="outline" onClick={() => setShowLegacy(false)}><X className="mr-2 h-4 w-4" /> Close legacy/Reel queue</Button><LegacyQueue /></div>;
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><h3 className="text-2xl font-bold">Publishing Queue</h3><p className="mt-1 text-sm text-muted-foreground">Review the exact media and copy, then approve, schedule, or publish. Nothing leaves the app without an explicit action.</p></div>
        <div className="flex gap-2"><Button variant="outline" onClick={() => setShowLegacy(true)}>Reels & legacy drafts</Button><Button variant="outline" onClick={() => Promise.all([list.refetch(), diagnostics.refetch()])} disabled={list.isFetching}><RefreshCw className={`mr-2 h-4 w-4 ${list.isFetching ? "animate-spin" : ""}`} /> Refresh</Button></div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[["Needs review", counts.pending ?? 0], ["Ready", counts.ready ?? 0], ["Scheduled", counts.scheduled ?? 0], ["Published", counts.published ?? 0]].map(([label, value]) => (
          <Card key={String(label)}><CardContent className="p-4"><div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-bold">{value}</div></CardContent></Card>
        ))}
      </div>

      <Card><CardContent className="flex flex-col gap-3 p-4 lg:flex-row"><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search topic, caption, source, or format..." className="lg:max-w-md" /><div className="flex flex-wrap gap-2">{(["all", "needs_review", "ready", "scheduled", "published", "rejected"] as QueueStatus[]).map((item) => <Button key={item} size="sm" variant={status === item ? "default" : "outline"} onClick={() => setStatus(item)} className="capitalize">{item.replace("_", " ")}</Button>)}</div></CardContent></Card>

      {list.isLoading ? <div className="flex min-h-80 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div> : rows.length === 0 ? <Card className="border-dashed"><CardContent className="py-20 text-center text-muted-foreground">No Studio V2 drafts match this view.</CardContent></Card> : (
        <div className="grid gap-5 xl:grid-cols-2">
          {rows.map((item) => {
            if (!item.draft) return null;
            const draft = item.draft as InstagramStudioDraft;
            const activeEdit = editingId === item.id ? editDraft : null;
            const canSchedule = draft.format !== "story" && draft.format !== "reel";
            return (
              <Card key={item.id} className="overflow-hidden">
                <CardHeader className="border-b bg-muted/10"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap gap-2"><Badge variant="outline" className={badgeClass(item.status)}>{item.status.replace("_", " ")}</Badge><Badge variant="outline">{draft.format}</Badge><Badge variant="outline">Score {draft.quality.overall}</Badge></div><CardTitle className="mt-3 text-lg">{draft.topic}</CardTitle><CardDescription>{draft.source.type.replaceAll("_", " ")} · {draft.objective.replaceAll("_", " ")}</CardDescription></div>{draft.quality.gate === "block" ? <AlertTriangle className="h-5 w-5 text-red-400" /> : <ShieldCheck className="h-5 w-5 text-emerald-400" />}</div></CardHeader>
                <CardContent className="space-y-4 p-5">
                  <div className={`grid gap-2 ${draft.imageUrls.length > 1 ? "grid-cols-3" : "grid-cols-1"}`}>{draft.imageUrls.map((url, index) => <a href={url} target="_blank" rel="noreferrer" key={url} className="group relative block overflow-hidden rounded-lg border bg-black"><img src={url} alt={`Asset ${index + 1}`} className={`w-full object-cover transition group-hover:scale-[1.02] ${draft.format === "story" ? "aspect-[9/16] max-h-80 object-contain" : "aspect-square"}`} /><ExternalLink className="absolute right-2 top-2 h-4 w-4 text-white drop-shadow" /></a>)}</div>

                  {activeEdit ? (
                    <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
                      <div className="space-y-1"><label className="text-xs font-semibold">Headline</label><Input value={activeEdit.headline} onChange={(event) => setEditDraft({ ...activeEdit, headline: event.target.value, imageUrls: [] })} /></div>
                      <div className="space-y-1"><label className="text-xs font-semibold">Subheadline</label><Textarea value={activeEdit.subheadline} onChange={(event) => setEditDraft({ ...activeEdit, subheadline: event.target.value, imageUrls: [] })} /></div>
                      <div className="space-y-1"><label className="text-xs font-semibold">Caption</label><Textarea className="min-h-40" value={activeEdit.caption} onChange={(event) => setEditDraft({ ...activeEdit, caption: event.target.value })} /></div>
                      {activeEdit.imageUrls.length === 0 && <Button className="w-full" variant="outline" disabled={rerender.isPending} onClick={() => rerender.mutate(activeEdit)}>{rerender.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageIcon className="mr-2 h-4 w-4" />} Re-render edited visual</Button>}
                      <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => { setEditingId(null); setEditDraft(null); }}>Cancel</Button><Button disabled={update.isPending || activeEdit.imageUrls.length === 0} onClick={() => update.mutate({ id: item.id, expectedVersion: item.version, draft: activeEdit })}>{update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save</Button></div>
                    </div>
                  ) : <div className="rounded-lg border bg-muted/10 p-4"><div className="font-semibold leading-6">{draft.headline}</div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{draft.caption}</p>{draft.hashtags.length > 0 && <p className="mt-3 text-xs text-primary">{draft.hashtags.map((tag) => `#${tag}`).join(" ")}</p>}</div>}

                  {item.status === "ready" && canSchedule && <div className="rounded-lg border p-3"><label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Schedule</label><div className="mt-2 flex gap-2"><Input type="datetime-local" value={scheduleById[item.id] ?? ""} onChange={(event) => setScheduleById((current) => ({ ...current, [item.id]: event.target.value }))} /><Button variant="outline" disabled={!scheduleById[item.id] || schedule.isPending} onClick={() => schedule.mutate({ id: item.id, scheduledAt: new Date(scheduleById[item.id]).toISOString() })}><CalendarClock className="h-4 w-4" /></Button></div></div>}
                  {item.status === "needs_review" && <div className="rounded-lg border p-3"><label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reject reason</label><div className="mt-2 flex gap-2"><Input value={rejectReasonById[item.id] ?? ""} onChange={(event) => setRejectReasonById((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="What must change?" /><Button variant="destructive" disabled={(rejectReasonById[item.id] ?? "").trim().length < 2 || reject.isPending} onClick={() => reject.mutate({ id: item.id, reason: rejectReasonById[item.id] })}><Trash2 className="h-4 w-4" /></Button></div></div>}
                  {item.status === "scheduled" && item.scheduledAt && <div className="flex items-center gap-2 text-sm text-blue-400"><Clock3 className="h-4 w-4" /> Scheduled for {new Date(item.scheduledAt).toLocaleString()}</div>}
                  {item.error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{item.error}</div>}
                </CardContent>
                <CardFooter className="flex flex-wrap justify-end gap-2 border-t bg-muted/10 p-4">{item.status !== "published" && item.status !== "scheduled" && !activeEdit && <Button variant="outline" onClick={() => { setEditingId(item.id); setEditDraft(draft); }}><Edit3 className="mr-2 h-4 w-4" /> Edit</Button>}{item.status === "needs_review" && <Button disabled={approve.isPending} onClick={() => approve.mutate({ id: item.id, expectedVersion: item.version })}><CheckCircle2 className="mr-2 h-4 w-4" /> Approve</Button>}{item.status === "ready" && <Button disabled={publish.isPending} onClick={() => publish.mutate({ id: item.id })}>{publish.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />} Publish now</Button>}</CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
