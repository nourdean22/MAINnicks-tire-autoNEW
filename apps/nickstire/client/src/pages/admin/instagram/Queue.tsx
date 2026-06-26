import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle } from "lucide-react";

interface QueueProps {
  onNavigate: (tab: string) => void;
}

export function Queue({ onNavigate }: QueueProps) {
  // In a full implementation, we'd fetch drafts from trpc that have status "draft" or "pending"
  const pendingPosts = [
    {
      id: "draft-1",
      content: "New Goodyear Assurance tires in stock! Starting at $120. Come get them today before we run out.",
      format: "single",
      score: { overall: 85, gate: "pass", reasoning: [] }
    },
    {
      id: "draft-2",
      content: "We guarantee the absolute cheapest prices in Ohio for all brake repairs!",
      format: "reel",
      score: { 
        overall: 40, 
        gate: "block", 
        reasoning: ["Claim safety violation: 'cheapest prices in Ohio' cannot be proven."] 
      }
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-medium">Publishing Queue</h3>
      </div>

      <div className="grid gap-4">
        {pendingPosts.length === 0 ? (
          <div className="text-center p-8 border rounded-lg bg-muted/50">
            <p className="text-muted-foreground">No posts in the queue.</p>
            <Button variant="link" onClick={() => onNavigate("studio")}>Go to Studio</Button>
          </div>
        ) : (
          pendingPosts.map(post => (
            <Card key={post.id} className={post.score.gate === "block" ? "border-red-200" : ""}>
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      Draft ({post.format})
                      {post.score.gate === "pass" ? (
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Ready</Badge>
                      ) : (
                        <Badge variant="destructive">Blocked</Badge>
                      )}
                    </CardTitle>
                    <CardDescription>Score: {post.score.overall}/100</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm border p-3 rounded bg-muted/30">{post.content}</p>
                {post.score.reasoning.length > 0 && (
                  <div className="mt-3 text-sm text-red-600 bg-red-50 p-2 rounded flex items-start gap-2">
                    <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <ul className="list-disc pl-4">
                      {post.score.reasoning.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}
              </CardContent>
              <CardFooter className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => onNavigate("studio")}>Edit in Studio</Button>
                <Button disabled={post.score.gate === "block"}>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Approve & Schedule
                </Button>
              </CardFooter>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
