import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Loader2, TrendingUp, TrendingDown, Repeat } from "lucide-react";

interface LearnProps {
  onNavigate: (tab: string) => void;
}

export function Learn({ onNavigate }: LearnProps) {
  const { data: analytics, isLoading } = trpc.instagramAdmin.getAnalytics.useQuery();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-medium">Learning & Feedback</h3>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-green-500" />
                Winning Patterns
              </CardTitle>
              <CardDescription>Your best performing content from the last 30 days.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {analytics?.topPosts.map((post, i) => (
                  <div key={post.postId || i} className="p-3 border rounded-lg bg-muted/20">
                    <p className="text-sm line-clamp-2 mb-2">{post.caption}</p>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{(post.engagementRate * 100).toFixed(1)}% Engagement</span>
                      <Button variant="ghost" size="sm" className="h-6" onClick={() => onNavigate("studio")}>
                        <Repeat className="h-3 w-3 mr-1" /> Make Sequel
                      </Button>
                    </div>
                  </div>
                ))}
                {!analytics?.topPosts?.length && (
                  <div className="text-sm text-muted-foreground">No data available.</div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingDown className="h-5 w-5 text-red-500" />
                Losing Patterns
              </CardTitle>
              <CardDescription>What to avoid based on recent low performance.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="p-3 border border-red-100 rounded-lg bg-red-50/50">
                  <h4 className="font-medium text-sm text-red-800">Generic Holiday Posts</h4>
                  <p className="text-xs text-red-600 mt-1">
                    Posts without specific shop updates or faces perform 60% worse than average.
                  </p>
                </div>
                <div className="p-3 border border-red-100 rounded-lg bg-red-50/50">
                  <h4 className="font-medium text-sm text-red-800">Long text without formatting</h4>
                  <p className="text-xs text-red-600 mt-1">
                    Walls of text drop engagement by 40%. Use line breaks and emojis.
                  </p>
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <Button variant="outline" className="w-full" onClick={() => onNavigate("studio")}>
                Apply to New Post
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}
    </div>
  );
}
