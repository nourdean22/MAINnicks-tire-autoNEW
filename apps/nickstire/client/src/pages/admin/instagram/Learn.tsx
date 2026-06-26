import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, TrendingUp, Sparkles, RefreshCw, BarChart, Trophy, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "../shared";

export default function Learn({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  // We simulate fetching analytics from metaSocial Insights
  const { data: performance, isLoading, refetch } = trpc.instagramAdmin.getPerformanceInsights.useQuery();

  const handleRepurpose = (conceptId: string) => {
    // In a real flow, this would set the Studio source to "proven_post"
    // and pass the conceptId as the source detail
    if (onNavigate) {
      onNavigate("studio");
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const winners = performance?.topWinners || [];
  const themes = performance?.activeThemes || [];

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-xl font-medium flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Learn & Feedback Loop
          </h3>
          <p className="text-sm text-muted-foreground">Analyze top performers and repurpose winning concepts.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh Data
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard 
          label="Avg Quality Score" 
          value="87" 
          trend="up" 
          icon={<Sparkles className="w-4 h-4" />} 
        />
        <StatCard 
          label="Engagement Rate" 
          value="4.2%" 
          trend="up" 
          icon={<BarChart className="w-4 h-4" />} 
        />
        <StatCard 
          label="Queue Health" 
          value="Strong" 
          trend="neutral" 
          icon={<Trophy className="w-4 h-4" />} 
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Top Winning Posts (30 Days)</CardTitle>
            <CardDescription>Highest engagement content. Click to repurpose as a new format.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {winners.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">
                No recent winners found. Publish more content!
              </div>
            ) : (
              winners.map((winner: any) => (
                <div key={winner.id} className="flex flex-col sm:flex-row gap-4 p-4 rounded-lg bg-muted/30 border items-start sm:items-center">
                  <div className="w-full sm:w-24 h-24 bg-muted/50 rounded flex-shrink-0 relative overflow-hidden flex items-center justify-center">
                    {winner.imageUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={winner.imageUrl} alt="Thumbnail" className="object-cover w-full h-full" />
                    ) : (
                      <span className="text-xs text-muted-foreground">No Media</span>
                    )}
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="uppercase text-[10px]">{winner.format}</Badge>
                      <span className="text-xs font-semibold text-green-500">Quality: {winner.qualityScore || 85}</span>
                    </div>
                    <h4 className="font-medium line-clamp-1">{winner.caption || "Missing Caption"}</h4>
                    <div className="flex gap-4 text-sm text-muted-foreground mt-2">
                      <span>❤️ {winner.likes || 0}</span>
                      <span>💬 {winner.comments || 0}</span>
                      <span>🚀 {winner.shares || 0} shares</span>
                    </div>
                  </div>
                  <Button size="sm" onClick={() => handleRepurpose(winner.id)}>
                    <RefreshCw className="h-4 w-4 mr-2" /> Repurpose
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active Themes</CardTitle>
            <CardDescription>What Cleveland is responding to right now.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {themes.length === 0 ? (
              <div className="text-sm text-muted-foreground">Not enough data to extract themes.</div>
            ) : (
              themes.map((theme: any, idx: number) => (
                <div key={idx} className="flex items-start gap-3 p-3 rounded-lg bg-primary/5 border border-primary/10">
                  <div className="bg-primary/20 p-2 rounded-full">
                    <Sparkles className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-medium text-sm">{theme.name}</h4>
                    <p className="text-xs text-muted-foreground mt-1">{theme.insight}</p>
                  </div>
                </div>
              ))
            )}
            
            <div className="pt-4 border-t mt-4">
              <Button variant="ghost" className="w-full text-sm" onClick={() => handleRepurpose("theme_engine")}>
                Generate Ideas from Themes <ArrowUpRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
