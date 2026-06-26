import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { Loader2, Zap, AlertTriangle, CheckCircle2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { evaluateQuality, type ContentQualityScore } from "@/lib/instagram/quality";

interface StudioProps {
  onNavigate: (tab: string) => void;
}

export function Studio({ onNavigate }: StudioProps) {
  const [content, setContent] = useState("");
  const [format, setFormat] = useState<"single" | "carousel" | "reel">("single");
  const [score, setScore] = useState<Pick<ContentQualityScore, "overall" | "gate" | "reasoning"> | null>(null);

  const handleEvaluate = () => {
    // We run the client-side quality evaluation to simulate the Phase 1 scoring foundation
    // Provide some mock sub-metrics to evaluateQuality
    const mockMetrics = {
      hookStrength: content.length > 20 ? 8 : 4,
      voiceMatch: 9,
      claimSafety: content.toLowerCase().includes("cheapest") ? 5 : 9,
      saveability: 7,
      localRelevance: 8,
      novelty: 8
    };
    const result = evaluateQuality(mockMetrics);
    setScore(result);
    
    if (result.gate === "block") {
      toast.error("Quality Gate Blocked", {
        description: "Your draft failed critical checks. See warnings.",
      });
    }
  };

  const handleQueue = () => {
    if (score?.gate === "block") {
      toast.error("Cannot Queue", {
        description: "Post is currently blocked by quality gates.",
      });
      return;
    }
    
    // In a full implementation, we'd fire a mutation here
    toast.success("Added to Queue", {
      description: "Your post is pending approval.",
    });
    onNavigate("queue");
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-medium">Content Studio</h3>
        <div className="flex gap-2">
          <Button variant={format === "single" ? "default" : "outline"} onClick={() => setFormat("single")}>Single</Button>
          <Button variant={format === "carousel" ? "default" : "outline"} onClick={() => setFormat("carousel")}>Carousel</Button>
          <Button variant={format === "reel" ? "default" : "outline"} onClick={() => setFormat("reel")}>Reel</Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Drafting Station ({format})</CardTitle>
              <CardDescription>Write your caption or script here. Our AI will evaluate it.</CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea 
                placeholder="Start writing..." 
                className="min-h-[200px]"
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button variant="outline" onClick={handleEvaluate}>
                <Zap className="h-4 w-4 mr-2" />
                Evaluate Quality
              </Button>
              <Button onClick={handleQueue} disabled={score?.gate === "block"}>
                Send to Queue
              </Button>
            </CardFooter>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle>Quality Score</CardTitle>
            </CardHeader>
            <CardContent>
              {!score ? (
                <div className="text-sm text-muted-foreground">Draft your content and run evaluation to see scores.</div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">Overall Score</span>
                    <span className={`font-bold ${score.overall < 70 ? "text-red-500" : score.overall >= 90 ? "text-green-500" : "text-yellow-500"}`}>
                      {score.overall}/100
                    </span>
                  </div>
                  
                  <div>
                    <h5 className="text-sm font-medium mb-2">Warnings & Errors</h5>
                    {!score.reasoning || score.reasoning.length === 0 ? (
                      <div className="flex items-center text-sm text-green-600">
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        No warnings!
                      </div>
                    ) : (
                      <ul className="space-y-2">
                        {score.reasoning?.map((w: string, i: number) => (
                          <li key={i} className="text-sm flex items-start text-amber-600">
                            <AlertTriangle className="h-4 w-4 mr-2 mt-0.5 shrink-0" />
                            {w}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {score.gate === "block" && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Blocked</AlertTitle>
                      <AlertDescription>
                        This content violates hard constraints (e.g. claim safety, pricing). You must fix these before queueing.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
