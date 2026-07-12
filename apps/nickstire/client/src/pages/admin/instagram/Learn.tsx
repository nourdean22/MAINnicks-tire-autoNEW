import { useMemo } from "react";
import { BarChart, Loader2, RefreshCw, Sparkles, TrendingUp, Trophy } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { StatCard } from "../shared";

export default function Learn({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const analytics = trpc.instagramAdmin.getAnalytics.useQuery();
  const report = trpc.instagramAdmin.getPerformanceReport.useQuery();
  const diagnostics = trpc.instagramStudio.diagnostics.useQuery();

  const refresh = async () => {
    await Promise.all([analytics.refetch(), report.refetch(), diagnostics.refetch()]);
    toast.success("Live Instagram intelligence refreshed");
  };

  const metrics = useMemo(() => {
    const posts = analytics.data?.topPosts ?? [];
    const scored = posts.filter((post) => Number.isFinite(post.contentScore) && post.contentScore > 0);
    const quality = scored.length ? Math.round(scored.reduce((sum, post) => sum + post.contentScore, 0) / scored.length) : null;
    const engagement = posts.length ? posts.reduce((sum, post) => sum + Number(post.engagementRate || 0), 0) / posts.length : null;
    const failed = Number(diagnostics.data?.counts?.failed ?? 0) + Number(diagnostics.data?.counts?.rejected ?? 0);
    const ready = Number(diagnostics.data?.counts?.ready ?? 0);
    const queueHealth = failed > 0 ? "Attention" : ready > 0 ? "Ready" : "No backlog";
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

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Avg content score" value={metrics.quality == null ? "No data" : String(metrics.quality)} trend="neutral" icon={<Sparkles className="h-4 w-4" />} />
        <StatCard label="Avg engagement" value={metrics.engagement == null ? "No data" : `${metrics.engagement.toFixed(2)}%`} trend="neutral" icon={<BarChart className="h-4 w-4" />} />
        <StatCard label="Studio queue" value={metrics.queueHealth} trend={metrics.queueHealth === "Attention" ? "down" : "neutral"} icon={<Trophy className="h-4 w-4" />} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
        <Card>
          <CardHeader><CardTitle>Top measured posts</CardTitle><CardDescription>Ordered by the analytics pipeline’s recorded engagement rate.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {winners.length === 0 ? (
              <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">No measured Instagram posts are available yet. Sync the feed from HQ after publishing.</div>
            ) : winners.map((winner) => (
              <div key={winner.postId} className="rounded-xl border bg-muted/20 p-4">
                <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{winner.postType}</Badge><Badge variant="outline">{winner.engagementRate.toFixed(2)}% engagement</Badge>{winner.contentScore > 0 && <Badge variant="outline">Score {winner.contentScore}</Badge>}</div>
                <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm leading-6">{winner.caption || "Caption unavailable"}</p>
                <div className="mt-3 flex gap-4 text-xs text-muted-foreground"><span>{winner.likes} likes</span><span>{winner.comments} comments</span><span>{new Date(winner.postedAt).toLocaleDateString()}</span></div>
                <Button className="mt-4" size="sm" variant="outline" onClick={() => onNavigate?.("studio")}><RefreshCw className="mr-2 h-4 w-4" /> Build a truthful sequel</Button>
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
