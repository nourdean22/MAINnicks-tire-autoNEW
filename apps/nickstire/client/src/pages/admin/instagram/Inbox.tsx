import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { MessageSquare, ArrowRight } from "lucide-react";

interface InboxProps {
  onNavigate: (tab: string) => void;
}

export function Inbox({ onNavigate }: InboxProps) {
  const { data, isLoading } = trpc.reviewReplies.getContentClusters.useQuery();
  const clusters = data?.clusters;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-medium">Community Inbox</h3>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Content Opportunities (From Reviews)</CardTitle>
            <CardDescription>We analyzed recent reviews to find topics your customers care about.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-sm text-muted-foreground">Loading insights...</div>
            ) : clusters && clusters.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {clusters.map((cluster, i) => (
                  <Card key={i} className="border bg-muted/20">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className="capitalize">{cluster.label}</Badge>
                        <span className="text-xs text-muted-foreground">{cluster.count} mentions</span>
                      </div>
                    </CardHeader>
                    <CardContent className="pb-2">
                      <p className="text-sm text-muted-foreground line-clamp-3">
                        "{cluster.sample}"
                      </p>
                    </CardContent>
                    <CardFooter>
                      <Button variant="ghost" size="sm" className="w-full justify-between" onClick={() => onNavigate("studio")}>
                        Create Post
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </CardFooter>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No prominent themes found right now.</div>
            )}
          </CardContent>
        </Card>

        {/* Traditional comments inbox would go here */}
        <Card className="md:col-span-2 opacity-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Social Comments
            </CardTitle>
            <CardDescription>Select a post to view comments (Coming Soon)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-center p-8 border border-dashed rounded text-muted-foreground">
              Direct social comments will flow here.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
