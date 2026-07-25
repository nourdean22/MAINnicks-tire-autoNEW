import { useMemo } from "react";
import {
  AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, DollarSign,
  Film, Loader2, Plus, ShieldAlert, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import type { InstagramStudioDraft } from "../../../../shared/instagramStudio";
import type { IgView } from "./igViews";
import { HQ } from "./HQ";

/**
 * TODAY — the command center the audit found missing. One ranked list of what
 * needs the operator's decision, what publishes today, and one-tap entry into
 * Create — composed entirely from queries that already exist (diagnostics,
 * list, pipeline health, reel attention). Every "all clear" is printed only
 * when the underlying query actually succeeded; a failed read renders as
 * UNKNOWN, never as calm.
 */
export default function Today({ onNavigate }: { onNavigate: (view: IgView) => void }) {
  const list = trpc.instagramStudio.list.useQuery({ limit: 75 }, { refetchInterval: 60_000 });
  const diagnostics = trpc.instagramStudio.diagnostics.useQuery(undefined, { refetchInterval: 60_000 });
  const health = trpc.instagramAdmin.getPipelineHealth.useQuery(undefined, { refetchInterval: 120_000 });
  const attention = trpc.contentAdmin.reelJobsNeedingAttention.useQuery(undefined, { refetchInterval: 120_000 });

  const counts: Record<string, number> = diagnostics.data?.counts ?? {};
  const diagnosticsOk = Boolean(diagnostics.data?.connected);

  const rows = useMemo(() => {
    const items = (list.data ?? []) as Array<{ id: string; status: string; scheduledAt: string | Date | null; error: string | null; draft: InstagramStudioDraft | null }>;
    const needsReview = diagnosticsOk ? (counts.pending ?? 0) : null;
    const readyCount = diagnosticsOk ? (counts.ready ?? 0) : null;
    const broken = items.filter((item) => item.status === "ambiguous" || item.status === "failed");
    const scheduled = items
      .filter((item) => item.status === "scheduled" && item.scheduledAt)
      .sort((a, b) => new Date(a.scheduledAt as string).getTime() - new Date(b.scheduledAt as string).getTime());
    return { needsReview, readyCount, broken, scheduled };
  }, [list.data, counts, diagnosticsOk]);

  const meta = health.data?.meta;
  const reelCount = attention.data?.count ?? null;

  const decisionRows: Array<{ key: string; tone: "red" | "amber" | "blue"; label: string; detail?: string; action: string; view: IgView }> = [];
  for (const item of rows.broken) {
    decisionRows.push({
      key: `broken-${item.id}`,
      tone: item.status === "ambiguous" ? "red" : "amber",
      label: item.status === "ambiguous"
        ? `"${item.draft?.topic ?? item.id}" may be LIVE — verify on Instagram before retrying`
        : `"${item.draft?.topic ?? item.id}" failed to publish`,
      detail: item.error ?? undefined,
      action: "Open",
      view: "publish",
    });
  }
  if ((rows.needsReview ?? 0) > 0) {
    decisionRows.push({ key: "review", tone: "amber", label: `${rows.needsReview} draft${rows.needsReview === 1 ? "" : "s"} waiting for your review`, action: "Review", view: "publish" });
  }
  if ((reelCount ?? 0) > 0) {
    decisionRows.push({ key: "reels", tone: "amber", label: `${reelCount} reel job${reelCount === 1 ? "" : "s"} need attention`, action: "Open recovery", view: "actions" });
  }
  if (meta && meta.connected && meta.live === false) {
    decisionRows.push({ key: "meta", tone: "red", label: "Meta rejected the access token — publishing is down", detail: meta.liveError ?? undefined, action: "Open Settings", view: "settings" });
  }
  if ((rows.readyCount ?? 0) > 0) {
    decisionRows.push({ key: "ready", tone: "blue", label: `${rows.readyCount} approved draft${rows.readyCount === 1 ? "" : "s"} ready to publish or schedule`, action: "Publish", view: "publish" });
  }

  // EVERY contributing source counts toward "unknown", not just the two the
  // first version checked — "Nothing needs you (verified)" over an unread
  // Meta-health or reel-attention query was the exact false-green this screen
  // exists to prevent.
  const decisionsUnknown = list.isError || diagnostics.isError || !diagnosticsOk
    || health.isError || attention.isError;
  const loading = list.isLoading || diagnostics.isLoading || health.isLoading || attention.isLoading;

  const toneClass = { red: "border-red-500/40 bg-red-500/5", amber: "border-amber-500/40 bg-amber-500/5", blue: "border-blue-500/40 bg-blue-500/5" } as const;

  return (
    <div className="space-y-6 pb-12">
      <Card className="border-primary/30">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg"><ShieldAlert className="h-5 w-5 text-primary" /> Needs your decision</CardTitle>
          <CardDescription>Everything below wants exactly one action from you. Empty means verified empty.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : (
            <>
              {decisionsUnknown && (
                <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <span>Some checks could not be read — this list may be <strong>incomplete</strong>, not clear.</span>
                </div>
              )}
              {decisionRows.map((row) => (
                <div key={row.key} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 ${toneClass[row.tone]}`}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-5">{row.label}</p>
                    {row.detail && <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.detail}</p>}
                  </div>
                  <Button size="sm" variant="outline" className="min-h-11" onClick={() => onNavigate(row.view)}>{row.action} <ArrowRight className="ml-1 h-3 w-3" /></Button>
                </div>
              ))}
              {decisionRows.length === 0 && !decisionsUnknown && (
                <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Nothing needs you right now — verified, not assumed.
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><CalendarClock className="h-4 w-4" /> Publishing today</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {list.isError ? (
              <p className="text-xs text-amber-500">Could not read the schedule — unknown, not empty.</p>
            ) : rows.scheduled.length === 0 ? (
              <p className="text-sm text-muted-foreground">No posts scheduled.</p>
            ) : rows.scheduled.slice(0, 3).map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.draft?.topic ?? item.id}</p>
                  <p className="text-xs text-blue-400">
                    {new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(item.scheduledAt as string))}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => onNavigate("publish")}><ArrowRight className="h-4 w-4" /></Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4" /> Quick create</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button className="min-h-11" onClick={() => onNavigate("create")}><Plus className="mr-1 h-4 w-4" /> New content</Button>
            <Button variant="outline" className="min-h-11" onClick={() => onNavigate("create")}><Film className="mr-1 h-4 w-4" /> Reel</Button>
            <Button variant="outline" className="min-h-11" onClick={() => onNavigate("insights")}><DollarSign className="mr-1 h-4 w-4" /> What earned</Button>
          </CardContent>
        </Card>
      </div>

      {/* Creation brief + pipeline health — HQ's substance, folded in rather
          than duplicated. HQ's legacy tab keys are mapped to views. */}
      <HQ onNavigate={(legacyTab) => {
        const mapped: Record<string, IgView> = { studio: "create", actions: "actions", queue: "publish" };
        onNavigate(mapped[legacyTab] ?? "today");
      }} />
    </div>
  );
}
