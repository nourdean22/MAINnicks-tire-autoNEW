import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { Loader2, Zap, AlertTriangle, CheckCircle2, AlertCircle, Wand2, Image as ImageIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { evaluateQuality, type ContentQualityScore } from "@/lib/instagram/quality";
import { Input } from "@/components/ui/input";

interface StudioProps {
  onNavigate: (tab: string) => void;
}

export function Studio({ onNavigate }: StudioProps) {
  const [content, setContent] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [format, setFormat] = useState<"single" | "carousel" | "reel">("single");
  const [score, setScore] = useState<Pick<ContentQualityScore, "overall" | "gate" | "reasoning"> | null>(null);

  const generateMedia = trpc.instagramAdmin.generateMedia.useMutation({
    onSuccess: (data) => {
      setMediaUrl(data.url);
      toast.success("Media generated successfully!");
    },
    onError: (err) => {
      toast.error("Failed to generate media", { description: err.message });
    }
  });

  const publishDraft = trpc.instagramAdmin.publishManualDraft.useMutation({
    onSuccess: () => {
      toast.success("Published Successfully!", {
        description: "Your post is now live on Instagram and Facebook.",
      });
      // Clear form
      setContent("");
      setMediaUrl("");
      setScore(null);
      onNavigate("hq");
    },
    onError: (err) => {
      toast.error("Publishing Failed", { description: err.message });
    }
  });

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

  const handleGenerateMedia = () => {
    if (!content || content.length < 10) {
      toast.error("Need more context", { description: "Write at least a short caption so the AI knows what to generate." });
      return;
    }
    generateMedia.mutate({ caption: content });
  };

  const handleQueue = () => {
    if (score?.gate === "block") {
      toast.error("Cannot Publish", {
        description: "Post is currently blocked by quality gates.",
      });
      return;
    }
    
    if (!mediaUrl) {
      toast.error("Missing Media", {
        description: "Instagram requires an image. Please generate or provide media first.",
      });
      return;
    }
    
    publishDraft.mutate({ caption: content, imageUrl: mediaUrl });
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
            <CardContent className="space-y-4">
              <Textarea 
                placeholder="Start writing..." 
                className="min-h-[150px]"
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
              
              <div className="border rounded-md p-4 space-y-4 bg-muted/30">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ImageIcon className="h-5 w-5 text-muted-foreground" />
                    <h4 className="font-medium">Media Staging</h4>
                  </div>
                  <Button 
                    variant="secondary" 
                    size="sm" 
                    onClick={handleGenerateMedia}
                    disabled={generateMedia.isPending || !content}
                  >
                    {generateMedia.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Wand2 className="h-4 w-4 mr-2" />
                    )}
                    Generate Media
                  </Button>
                </div>
                
                {mediaUrl ? (
                  <div className="rounded-md overflow-hidden border bg-black/5 flex justify-center p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={mediaUrl} alt="Staged media" className="max-h-[300px] object-contain rounded" />
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-[120px] rounded-md border border-dashed text-muted-foreground text-sm">
                    No media staged. Write a caption and click Generate.
                  </div>
                )}
                
                <div className="flex gap-2">
                  <Input 
                    placeholder="Or paste an external public image URL..." 
                    value={mediaUrl}
                    onChange={(e) => setMediaUrl(e.target.value)}
                    className="text-xs"
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button variant="outline" onClick={handleEvaluate}>
                <Zap className="h-4 w-4 mr-2" />
                Evaluate Quality
              </Button>
              <Button 
                onClick={handleQueue} 
                disabled={score?.gate === "block" || publishDraft.isPending || (!mediaUrl && !publishDraft.isPending)}
                className="bg-primary"
              >
                {publishDraft.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                {publishDraft.isPending ? "Publishing..." : "Publish to Live"}
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
                        This content violates hard constraints (e.g. claim safety, pricing). You must fix these before publishing.
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
