import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

/**
 * Board view over the unified Publish read-model (Wave 6). Lanes are
 * LIFECYCLE; "Attention" is a COMPUTED lane (health !== healthy), not a
 * status anyone writes — an item can sit in Scheduled and in Attention at
 * once, which is exactly the truth the single-status queue could not tell.
 */
const LANES: Array<{ key: string; title: string; match: (item: BoardItem) => boolean }> = [
  { key: "attention", title: "Attention", match: (item) => item.health !== "healthy" },
  { key: "draft", title: "Drafts", match: (item) => item.lifecycle === "draft" && item.health === "healthy" },
  { key: "needs_review", title: "Needs review", match: (item) => item.lifecycle === "needs_review" && item.health === "healthy" },
  { key: "ready", title: "Approved", match: (item) => item.lifecycle === "ready" && item.health === "healthy" },
  { key: "scheduled", title: "Scheduled", match: (item) => item.lifecycle === "scheduled" && item.health === "healthy" },
  { key: "published", title: "Published", match: (item) => item.lifecycle === "published" && item.health === "healthy" },
];

type BoardItem = {
  id: string;
  version: number;
  lifecycle: string;
  health: string;
  scheduledAt: string | Date | null;
  publishedAt: string | Date | null;
  error: string | null;
  draft: { topic: string; format: string; imageUrls: string[]; quality: { overall: number } } | null;
};

function healthBadge(item: BoardItem) {
  if (item.health === "ambiguous") return { text: "MAY BE LIVE", className: "border-red-500/40 bg-red-500/10 text-red-400" };
  if (item.health === "stalled") return { text: "STALLED", className: "border-amber-500/40 bg-amber-500/10 text-amber-400" };
  if (item.health === "attention") return { text: "FAILED", className: "border-red-500/40 bg-red-500/10 text-red-400" };
  return null;
}

const et = (value: string | Date) => new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
}).format(new Date(value));

export default function PublishBoard() {
  const utils = trpc.useUtils();
  const board = trpc.instagramStudio.board.useQuery({ limit: 100 }, { refetchInterval: 45_000 });
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [rescheduleAt, setRescheduleAt] = useState("");

  const invalidate = async () => {
    await Promise.all([utils.instagramStudio.board.invalidate(), utils.instagramStudio.list.invalidate(), utils.instagramStudio.diagnostics.invalidate()]);
  };
  const cancelSchedule = trpc.instagramStudio.cancelSchedule.useMutation({
    onSuccess: async () => { await invalidate(); toast.success("Unscheduled — back in Approved"); },
    onError: (e) => toast.error("Cancel failed", { description: e.message }),
  });
  const reschedule = trpc.instagramStudio.reschedule.useMutation({
    onSuccess: async () => { await invalidate(); setRescheduleId(null); setRescheduleAt(""); toast.success("Rescheduled"); },
    onError: (e) => toast.error("Reschedule failed", { description: e.message }),
  });
  const resolveAmbiguous = trpc.instagramStudio.resolveAmbiguous.useMutation({
    onSuccess: async (result) => { await invalidate(); toast.success(result.status === "published" ? "Marked as live" : "Returned to Approved"); },
    onError: (e) => toast.error("Resolve failed", { description: e.message }),
  });

  const lanes = useMemo(() => {
    const items = (board.data ?? []) as BoardItem[];
    return LANES.map((lane) => ({ ...lane, items: items.filter(lane.match) }));
  }, [board.data]);

  if (board.isLoading) return <div className="flex min-h-60 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (board.isError) {
    return (
      <Card className="border-amber-500/40 bg-amber-500/5"><CardContent className="py-16 text-center text-sm">
        <strong>Could not read the board.</strong>
        <div className="mt-1 text-muted-foreground">This is unknown, not empty. {board.error?.message}</div>
      </CardContent></Card>
    );
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {lanes.map((lane) => (
        <div key={lane.key} className="w-72 shrink-0 space-y-3">
          <div className="flex items-center justify-between px-1">
            <h4 className={`text-sm font-bold uppercase tracking-wide ${lane.key === "attention" && lane.items.length > 0 ? "text-red-400" : "text-muted-foreground"}`}>{lane.title}</h4>
            <Badge variant="outline">{lane.items.length}</Badge>
          </div>
          {lane.items.length === 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
              {lane.key === "attention" ? "Nothing needs intervention — verified." : "Empty"}
            </div>
          ) : lane.items.map((item) => {
            const badge = healthBadge(item);
            return (
              <Card key={`${lane.key}-${item.id}`} className="overflow-hidden">
                {item.draft?.imageUrls[0] && <img src={item.draft.imageUrls[0]} alt="" className="aspect-[4/5] max-h-36 w-full object-cover" />}
                <CardContent className="space-y-2 p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px]">{item.draft?.format}</Badge>
                    {item.draft && <Badge variant="outline" className="text-[10px]">Score {item.draft.quality.overall}</Badge>}
                    {badge && <Badge variant="outline" className={`text-[10px] ${badge.className}`}>{badge.text}</Badge>}
                  </div>
                  <p className="line-clamp-2 text-sm font-medium leading-5">{item.draft?.topic}</p>
                  {item.scheduledAt && <p className="text-xs text-blue-400"><CalendarClock className="mr-1 inline h-3 w-3" />{et(item.scheduledAt)}</p>}
                  {item.error && <p className="line-clamp-3 rounded border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-300">{item.error}</p>}

                  {item.health === "ambiguous" && (
                    <div className="space-y-1.5 border-t pt-2">
                      <p className="text-[11px] text-muted-foreground">Check the Instagram account, then tell the system what reality is:</p>
                      <div className="flex flex-col gap-1.5">
                        <Button size="sm" variant="outline" className="min-h-11 border-emerald-500/40 text-emerald-500" disabled={resolveAmbiguous.isPending}
                          onClick={() => resolveAmbiguous.mutate({ id: item.id, decision: "published" })}>
                          <CheckCircle2 className="mr-1 h-3 w-3" /> It IS live — mark published
                        </Button>
                        <Button size="sm" variant="outline" className="min-h-11" disabled={resolveAmbiguous.isPending}
                          onClick={() => resolveAmbiguous.mutate({ id: item.id, decision: "not_published" })}>
                          It never posted — return to Approved
                        </Button>
                      </div>
                    </div>
                  )}

                  {item.lifecycle === "scheduled" && item.health === "healthy" && (
                    <div className="space-y-1.5 border-t pt-2">
                      {rescheduleId === item.id ? (
                        <div className="space-y-1.5">
                          <input type="datetime-local" className="h-10 w-full rounded-md border border-input bg-background px-2 text-xs" value={rescheduleAt} onChange={(e) => setRescheduleAt(e.target.value)} />
                          <div className="flex gap-1.5">
                            <Button size="sm" className="min-h-10 flex-1" disabled={!rescheduleAt || reschedule.isPending}
                              onClick={() => reschedule.mutate({ id: item.id, scheduledAt: new Date(rescheduleAt).toISOString() })}>Move</Button>
                            <Button size="sm" variant="ghost" className="min-h-10" onClick={() => { setRescheduleId(null); setRescheduleAt(""); }}>Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-1.5">
                          <Button size="sm" variant="outline" className="min-h-10 flex-1" onClick={() => setRescheduleId(item.id)}><RefreshCw className="mr-1 h-3 w-3" /> Reschedule</Button>
                          <Button size="sm" variant="outline" className="min-h-10 flex-1" disabled={cancelSchedule.isPending}
                            onClick={() => cancelSchedule.mutate({ id: item.id })}>Unschedule</Button>
                        </div>
                      )}
                    </div>
                  )}

                  {item.health === "stalled" && item.lifecycle === "scheduled" && (
                    <div className="space-y-1.5 border-t pt-2">
                      <p className="flex items-start gap-1 text-[11px] text-amber-500"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> Marked scheduled but NO pending publish exists to fire it.</p>
                      <Button size="sm" variant="outline" className="min-h-10 w-full" disabled={cancelSchedule.isPending}
                        onClick={() => cancelSchedule.mutate({ id: item.id })}>Rescue — return to Approved</Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ))}
    </div>
  );
}
