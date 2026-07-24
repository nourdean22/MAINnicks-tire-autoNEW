import { useMemo } from "react";
import { AlertTriangle, BarChart, DollarSign, Loader2, RefreshCw, Sparkles, TrendingUp, Trophy } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { StatCard } from "../shared";
import { writeCreateHandoff } from "./igViews";

export default function Learn({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const analytics = trpc.instagramAdmin.getAnalytics.useQuery();
  const report = trpc.instagramAdmin.getPerformanceReport.useQuery();
  const diagnostics = trpc.instagramStudio.diagnostics.useQuery();
  // Money, not attention. Every other metric on this screen measures who LOOKED.
  const revenue = trpc.contentAdmin.contentRevenue.useQuery({ days: 90 });

  const refresh = async () => {
    await Promise.all([analytics.refetch(), report.refetch(), diagnostics.refetch(), revenue.refetch()]);
    toast.success("Live Instagram intelligence refreshed");
  };

  const money = (cents: number) =>
    `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const metrics = useMemo(() => {
    const posts = analytics.data?.topPosts ?? [];
    const scored = posts.filter((post) => Number.isFinite(post.contentScore) && post.contentScore > 0);
    const quality = scored.length ? Math.round(scored.reduce((sum, post) => sum + post.contentScore, 0) / scored.length) : null;
    const engagement = posts.length ? posts.reduce((sum, post) => sum + Number(post.engagementRate || 0), 0) / posts.length : null;
    const failed = Number(diagnostics.data?.counts?.failed ?? 0) + Number(diagnostics.data?.counts?.rejected ?? 0);
    const ready = Number(diagnostics.data?.counts?.ready ?? 0);
    // "No backlog" is a CLAIM. If the query failed there are no counts to read,
    // and printing the all-clear would tell the operator the queue is clean when
    // what actually happened is that nobody looked.
    const queueHealth = !diagnostics.data ? "Unknown" : failed > 0 ? "Attention" : ready > 0 ? "Ready" : "No backlog";
    return { quality, engagement, queueHealth };
  }, [analytics.data, diagnostics.data]);

  const themes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const post of analytics.data?.topPosts ?? []) {
      for (const theme of post.themes ?? []) {
        const clean = String(theme).trim();
        if (clean) counts.set(clean, (counts.get(clean) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [analytics.data]);

  if (analytics.isLoading || report.isLoading || diagnostics.isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  const winners = analytics.data?.topPosts ?? [];
  const recommendations = report.data?.recommendations ?? [];

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><h3 className="flex items-center gap-2 text-2xl font-bold"><TrendingUp className="h-5 w-5" /> Learn from real performance</h3><p className="mt-1 text-sm text-muted-foreground">No simulated KPIs. Empty data is shown as unavailable until Meta analytics actually populate it.</p></div>
        <Button variant="outline" size="sm" onClick={refresh}><RefreshCw className="mr-2 h-4 w-4" /> Refresh live data</Button>
      </div>

      {/*
        WHAT IT EARNED, ABOVE WHAT IT REACHED.
        Deliberately first. Everything below measures ATTENTION, and a reel with
        18,000 views and no bookings used to look identical to a carousel with 400
        views and six paid repairs.
      */}
      <Card className="border-primary/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><DollarSign className="h-5 w-5" /> What content earned · last 90 days</CardTitle>
          <CardDescription>
            Paid invoices traced back to the content run that produced the lead. Only PAID counts, and an
            invoice two runs both claim is counted for neither.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {revenue.isLoading ? (
            <p className="text-sm text-muted-foreground">Checking…</p>
          ) : revenue.isError ? (
            // NOT zero. A failed query rendered as "earned nothing" reads as a
            // verdict on the content when it is a verdict on the query.
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <span>Could not read attribution — this is <strong>unknown</strong>, not zero. {revenue.error?.message}</span>
            </div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <StatCard label="Revenue traced to content" value={money(revenue.data?.totals.verifiedRevenueCents ?? 0)} trend="neutral" icon={<DollarSign className="h-4 w-4" />} />
                <StatCard
                  label="Cost to generate"
                  // An unrecorded cost is not a free one, and the two must not
                  // print identically beside a revenue figure.
                  value={(revenue.data?.totals.generationCostCents ?? 0) === 0 && (revenue.data?.runs.length ?? 0) > 0
                    ? "Unmeasured"
                    : money(revenue.data?.totals.generationCostCents ?? 0)}
                  trend="neutral"
                  icon={<BarChart className="h-4 w-4" />}
                />
                <StatCard label="Leads with no tracking" value={String(revenue.data?.totals.unattributedLeadCount ?? 0)} trend="neutral" icon={<AlertTriangle className="h-4 w-4" />} />
              </div>

              {(revenue.data?.runs.length ?? 0) === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  No lead in this window carried a content run id, so nothing can be attributed yet. Posts
                  staged from the Studio now rewrite the shop links in their caption to carry one — this
                  fills in as those posts publish and produce leads.
                </p>
              ) : (
                <div className="space-y-2">
                  {revenue.data!.runs.slice(0, 8).map((run) => (
                    <div key={run.runId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-xs">{run.runId}</p>
                        <p className="text-xs text-muted-foreground">
                          {run.leadCount} lead{run.leadCount === 1 ? "" : "s"} · {run.uniquelyLinkedPaidInvoices} paid invoice{run.uniquelyLinkedPaidInvoices === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold tabular-nums">{money(run.verifiedRevenueCents)}</p>
                        {run.generationCostCents > 0 && (
                          <p className="text-xs text-muted-foreground tabular-nums">cost {money(run.generationCostCents)}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Stated, never implied. A number without its limits invites over-reading. */}
              <ul className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
                {(revenue.data?.limitations ?? []).map((limit) => <li key={limit}>· {limit}</li>)}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      <div className="space-y-2">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {/* Account-wide numbers first (Wave 7) — the top-5 stats are kept but
              labeled as what they are. Averaging only winners presented the
              ceiling as the baseline. */}
          <StatCard
            label={`Avg engagement · account${analytics.data?.accountAverages ? ` (n=${analytics.data.accountAverages.postCount})` : ""}`}
            value={analytics.data?.accountAverages == null
              ? "Unknown"
              : analytics.data.accountAverages.avgEngagementRate == null
                ? "No data"
                : `${analytics.data.accountAverages.avgEngagementRate.toFixed(2)}%`}
            trend="neutral" icon={<BarChart className="h-4 w-4" />}
          />
          <StatCard
            label={`Avg score · account${analytics.data?.accountAverages?.scoredCount ? ` (n=${analytics.data.accountAverages.scoredCount} scored)` : ""}`}
            value={analytics.data?.accountAverages == null
              ? "Unknown"
              : analytics.data.accountAverages.avgContentScore == null
                ? "No data"
                : String(analytics.data.accountAverages.avgContentScore)}
            trend="neutral" icon={<Sparkles className="h-4 w-4" />}
          />
          <StatCard label="Avg engagement · top 5" value={metrics.engagement == null ? "No data" : `${metrics.engagement.toFixed(2)}%`} trend="neutral" icon={<BarChart className="h-4 w-4" />} />
          <StatCard label="Studio queue" value={metrics.queueHealth} trend={metrics.queueHealth === "Attention" ? "down" : "neutral"} icon={<Trophy className="h-4 w-4" />} />
        </div>
        <p className="text-xs text-muted-foreground">
          Source: Meta analytics cache (sync via Community → Sync Feed) · window: all-time · engagement = (likes+comments)/followers at sync time.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
        <Card>
          <CardHeader><CardTitle>Top measured posts</CardTitle><CardDescription>Ordered by the analytics pipeline’s recorded engagement rate.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {analytics.isError ? (
              // "No posts are available yet" asserts a fact about Instagram. When
              // the query failed, the honest statement is that we could not ask.
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <span>Could not load measured posts — this is <strong>unknown</strong>, not empty. {analytics.error?.message}</span>
              </div>
            ) : winners.length === 0 ? (
              <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">No measured Instagram posts are available yet. Sync the feed from HQ after publishing.</div>
            ) : winners.map((winner) => (
              <div key={winner.postId} className="rounded-xl border bg-muted/20 p-4">
                <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{winner.postType}</Badge><Badge variant="outline">{winner.engagementRate.toFixed(2)}% engagement</Badge>{winner.contentScore > 0 && <Badge variant="outline">Score {winner.contentScore}</Badge>}</div>
                <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm leading-6">{winner.caption || "Caption unavailable"}</p>
                <div className="mt-3 flex gap-4 text-xs text-muted-foreground"><span>{winner.likes} likes</span><span>{winner.comments} comments</span><span>{new Date(winner.postedAt).toLocaleDateString()}</span></div>
                {/* REAL handoff (Wave 5): the winning post's type, caption
                    theme, and measured engagement ride into Create — this was
                    a bare tab switch that discarded the very evidence it sat
                    on top of. */}
                <Button className="mt-4 min-h-11" size="sm" variant="outline" onClick={() => {
                  writeCreateHandoff({
                    sourceType: "proven_post",
                    recordId: winner.postId,
                    detail: `Sequel to a measured winner (${winner.postType}, ${winner.engagementRate.toFixed(2)}% engagement${winner.contentScore > 0 ? `, score ${winner.contentScore}` : ""}). Original caption: "${(winner.caption ?? "").slice(0, 400)}". The new angle must differ from the original concept.`,
                    format: winner.postType === "carousel" ? "carousel" : "post",
                    objective: "engagement",
                  });
                  onNavigate?.("studio");
                }}><RefreshCw className="mr-2 h-4 w-4" /> Build a truthful sequel</Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Measured themes</CardTitle><CardDescription>Repeated AI tags across the highest-engagement stored posts.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {themes.length === 0 ? <p className="text-sm text-muted-foreground">Not enough tagged performance data yet.</p> : themes.map(([theme, count]) => (
                <div key={theme} className="flex items-center justify-between rounded-lg border p-3"><span className="text-sm font-medium capitalize">{theme}</span><Badge variant="outline">{count} post{count === 1 ? "" : "s"}</Badge></div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Evidence-based recommendations</CardTitle><CardDescription>Generated only from stored post types, timing, themes, follower trend, and scores.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {recommendations.length === 0 ? <p className="text-sm text-muted-foreground">No recommendation set is available.</p> : recommendations.map((item) => <div key={item} className="rounded-lg border bg-primary/5 p-3 text-sm leading-6">{item}</div>)}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
