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
import { writeCreateHandoff } from "./igViews";
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
  const delivery = trpc.instagramAdmin.getDeliveryIssues.useQuery(undefined, { refetchInterval: 120_000 });
  const reliability = trpc.instagramAdmin.getReelReliability.useQuery(undefined, { refetchInterval: 300_000 });

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
    decisionRows.push({ key: "reels", tone: "amber", label: `${reelCount} reel job${reelCount === 1 ? "" : "s"} need attention`, detail: "Held jobs of any age, plus failures active in the last 14 days — a different population from the 30-day reliability panel below, so the two numbers are not meant to reconcile.", action: "Open recovery", view: "actions" });
  }
  if (meta && meta.connected && meta.live === false) {
    decisionRows.push({ key: "meta", tone: "red", label: "Meta rejected the access token — publishing is down", detail: meta.liveError ?? undefined, action: "Open Settings", view: "settings" });
  }
  if ((rows.readyCount ?? 0) > 0) {
    decisionRows.push({ key: "ready", tone: "blue", label: `${rows.readyCount} approved draft${rows.readyCount === 1 ? "" : "s"} ready to publish or schedule`, action: "Publish", view: "publish" });
  }
  // Delivery-issue engine rows: blockers and warnings only — deliberate stops
  // (kill switches, disarmed gates) are INFO and live in Control/Settings, not
  // in the decision queue. Keys Today already renders its own way are skipped
  // so one fact never prints twice.
  {
    const DELIVERY_VIEW: Record<string, IgView> = {
      asset_hosting: "settings", meta_connection: "settings", kill_switch: "control",
      publish_gate: "settings", reconciliation: "actions", generation: "actions",
    };
    const ALREADY_RENDERED = new Set(["meta_token_rejected", "reel_jobs_need_attention"]);
    for (const issue of delivery.data?.issues ?? []) {
      if (issue.severity === "info" || ALREADY_RENDERED.has(issue.key)) continue;
      decisionRows.push({
        key: `delivery-${issue.key}`,
        tone: issue.severity === "blocker" ? "red" : "amber",
        label: issue.reason,
        detail: `Next: ${issue.nextAction}`,
        action: "Open",
        view: DELIVERY_VIEW[issue.layer] ?? "settings",
      });
    }
  }

  // EVERY contributing source counts toward "unknown", not just the two the
  // first version checked — "Nothing needs you (verified)" over an unread
  // Meta-health or reel-attention query was the exact false-green this screen
  // exists to prevent.
  const decisionsUnknown = list.isError || diagnostics.isError || !diagnosticsOk
    || health.isError || attention.isError || delivery.isError;
  const loading = list.isLoading || diagnostics.isLoading || health.isLoading || attention.isLoading || delivery.isLoading;

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
            {/*
              This button was byte-identical to the one on its left — both called
              onNavigate("create") — so a Film-icon control labelled "Reel"
              silently landed the operator on the STATIC composer with
              format="post". Two buttons, one behaviour, and the more specific
              label was the false one.

              It now declares reel intent through the existing handoff contract,
              which StudioV2 honours by opening the reel lane directly. That also
              removes the second tap ("Open Advanced Reel Studio") that every
              reel previously cost.
            */}
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => {
                writeCreateHandoff({ sourceType: "manual_idea", format: "reel" });
                onNavigate("create");
              }}
            >
              <Film className="mr-1 h-4 w-4" /> Reel
            </Button>
            <Button variant="outline" className="min-h-11" onClick={() => onNavigate("insights")}><DollarSign className="mr-1 h-4 w-4" /> What earned</Button>
          </CardContent>
        </Card>
      </div>

      {/* Wave A3: 30-day reel pipeline reliability. A render success is not a
          good reel, but a 30-day stage-rate is the difference between "the
          pipeline works" and "the pipeline works 23% of the time". */}
      <Card className={(reliability.data?.failureRate ?? 0) >= 0.5 ? "border-amber-500/40" : undefined}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Film className="h-4 w-4" /> Reel pipeline · last 30 days</CardTitle>
        </CardHeader>
        <CardContent>
          {reliability.isLoading ? (
            <p className="text-sm text-muted-foreground">Reading…</p>
          ) : reliability.isError || reliability.data?.total == null ? (
            <p className="text-xs text-amber-500">Could not read reel-job history — reliability is <strong>unknown</strong>, not healthy.</p>
          ) : reliability.data.total === 0 ? (
            <p className="text-sm text-muted-foreground">No reel jobs created in the last 30 days.</p>
          ) : (
            <div className="space-y-1">
              <p className="text-sm">
                <span className="font-semibold tabular-nums">{reliability.data.total}</span> jobs ·{" "}
                <span className="text-emerald-500 tabular-nums">{reliability.data.succeeded ?? 0} published</span> ·{" "}
                <span className="text-red-400 tabular-nums">{reliability.data.failed ?? 0} failed</span>
                {(reliability.data.ambiguous ?? 0) > 0 && <> · <span className="text-amber-500 tabular-nums">{reliability.data.ambiguous} ambiguous</span></>}
                {reliability.data.failureRate != null && <> · <span className="font-semibold tabular-nums">{Math.round(reliability.data.failureRate * 100)}% failure</span></>}
                {(reliability.data.closedFailures ?? 0) > 0 && <> · <span className="text-muted-foreground tabular-nums">{reliability.data.closedFailures} closed by you (excluded)</span></>}
              </p>
              <p className="text-xs text-muted-foreground">
                Windowed on job CREATION date, by current stage — a fixed cohort, so the rate cannot
                move just because a row was touched. Deliberately NOT the same population as
                &ldquo;needs attention&rdquo; above, which is scoped by last activity. It is also a
                trailing mean with no incident weighting: one bad day can dominate it for a month and
                then vanish on its own, so read a spike against the day it came from before acting.
                A green render is still not a good reel — sample published output monthly.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Creation brief + pipeline health — HQ's substance, folded in rather
          than duplicated. HQ's legacy tab keys are mapped to views. */}
      <HQ onNavigate={(legacyTab) => {
        const mapped: Record<string, IgView> = { studio: "create", actions: "actions", queue: "publish" };
        onNavigate(mapped[legacyTab] ?? "today");
      }} />
    </div>
  );
}
