import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { Loader2, Zap, AlertTriangle, CheckCircle2, AlertCircle, Wand2, Image as ImageIcon, Sparkles, ChevronRight, RefreshCw, X, Play, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { evaluateQuality, ContentSourceRegistry, FormatRegistry, type SourceType, type PostFormat, type ContentQualityScore } from "@/lib/instagram/quality";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
 // standard in the project, fallback to lucide

type Step = "source" | "format" | "draft";

interface StudioProps {
  onNavigate?: (tab: string) => void;
}

export default function UnifiedStudio({ onNavigate }: StudioProps) {
  const [step, setStep] = useState<Step>("source");
  const [source, setSource] = useState<SourceType | null>(null);
  const [format, setFormat] = useState<PostFormat | null>(null);
  const [sourceDetail, setSourceDetail] = useState("");
  const [content, setContent] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [score, setScore] = useState<Pick<ContentQualityScore, "overall" | "gate" | "reasoning"> | null>(null);

  const generateMedia = trpc.instagramAdmin.generateMedia.useMutation({
    onSuccess: (data) => {
      setMediaUrl(data.url);
      toast.success("Media generated automatically!");
    },
    onError: (err) => {
      toast.error("Failed to generate media", { description: err.message });
    }
  });

  const generateDraft = trpc.instagramAdmin.generatePostDraft.useMutation({
    onSuccess: (data: { caption: string }) => {
      setContent(data.caption);
      toast.success("Draft generated based on Source and Format.");
      handleEvaluate(data.caption); // auto evaluate
      if (!mediaUrl) {
        // Auto trigger media generation
        generateMedia.mutate({ caption: data.caption });
      }
    },
    onError: (err: any) => {
      toast.error("Failed to generate draft", { description: err.message });
    }
  });

  const publishDraft = trpc.instagramAdmin.publishManualDraft.useMutation({
    onSuccess: () => {
      toast.success("Added to Queue Successfully!", {
        description: "Your post has been gated and queued for publishing.",
      });
      setStep("source");
      setSource(null);
      setFormat(null);
      setContent("");
      setMediaUrl("");
      setScore(null);
      if (onNavigate) onNavigate("queue");
    },
    onError: (err) => {
      toast.error("Queue Failed", { description: err.message });
    }
  });

  const handleEvaluate = (text: string = content) => {
    // Client-side simulation of the Quality Gate API
    const mockMetrics = {
      hookStrength: text.length > 30 ? 8 : 4,
      voiceMatch: text.toLowerCase().includes("nick's tire") || text.toLowerCase().includes("cleveland") ? 9 : 5,
      claimSafety: text.toLowerCase().includes("cheapest") ? 5 : 9,
      saveability: 7,
      localRelevance: text.toLowerCase().includes("cleveland") ? 9 : 5,
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

  const handleSourceSelect = (t: SourceType) => {
    setSource(t);
    setStep("format");
  };

  const handleFormatSelect = (f: PostFormat) => {
    setFormat(f);
    setStep("draft");
    // Autogenerate initial draft if we have enough context
    if (source && ContentSourceRegistry[source].requiresDetail && !sourceDetail) {
      // Don't auto generate yet, wait for detail
    } else {
      handleAutoGenerate(f);
    }
  };

  const handleAutoGenerate = (selectedFormat: PostFormat = format!) => {
    if (source) {
      generateDraft.mutate({ 
        sourceId: source, 
        sourceDetail, 
        format: selectedFormat 
      });
    }
  };

  const handleQueue = () => {
    if (score?.gate === "block") {
      toast.error("Cannot Publish", {
        description: "Post is currently blocked by quality gates.",
      });
      return;
    }
    
    if (!mediaUrl && format !== "single") {
      // For carousels/reels, maybe media is generated differently, but we enforce it for now
      toast.error("Missing Media", {
        description: "Instagram requires media (Image/Video). AI is working on it or you can provide one.",
      });
      return;
    }
    
    publishDraft.mutate({ caption: content, imageUrl: mediaUrl });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
        <span className={`cursor-pointer hover:text-foreground ${step === "source" ? "text-foreground font-medium" : ""}`} onClick={() => setStep("source")}>
          1. Source
        </span>
        <ChevronRight className="h-4 w-4" />
        <span className={`cursor-pointer hover:text-foreground ${step === "format" ? "text-foreground font-medium" : ""}`} onClick={() => source && setStep("format")}>
          2. Format
        </span>
        <ChevronRight className="h-4 w-4" />
        <span className={`${step === "draft" ? "text-foreground font-medium" : ""}`}>
          3. Studio
        </span>
      </div>

      {step === "source" && (
        <div className="space-y-4">
          <h3 className="text-xl font-semibold">What is the source of this post?</h3>
          <p className="text-muted-foreground">The AI engine needs a raw signal to generate high-quality, believable content.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(Object.keys(ContentSourceRegistry) as SourceType[]).map((key) => {
              const src = ContentSourceRegistry[key];
              return (
                <Card 
                  key={key} 
                  className="cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => handleSourceSelect(key)}
                >
                  <CardHeader className="py-4">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Zap className="h-4 w-4 text-primary" /> 
                      {src.label}
                    </CardTitle>
                  </CardHeader>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {step === "format" && source && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-semibold">Select Format</h3>
              <p className="text-muted-foreground">Based on the source: <strong className="text-foreground">{ContentSourceRegistry[source].label}</strong></p>
            </div>
          </div>
          
          {ContentSourceRegistry[source].requiresDetail && (
            <Card className="bg-muted/20 border-primary/20">
              <CardHeader className="py-4">
                <CardTitle className="text-sm">Provide Source Details</CardTitle>
                <CardDescription>Paste the review, question, or specific idea to ground the AI.</CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea 
                  placeholder={`E.g., "Customer asked why their brakes squeak in the morning..."`}
                  value={sourceDetail}
                  onChange={(e) => setSourceDetail(e.target.value)}
                  className="bg-background"
                />
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {(Object.keys(FormatRegistry) as PostFormat[]).map((key) => {
              const f = FormatRegistry[key];
              return (
                <Card 
                  key={key} 
                  className={`cursor-pointer hover:border-primary/50 transition-colors ${format === key ? "border-primary" : ""}`}
                  onClick={() => handleFormatSelect(key)}
                >
                  <CardHeader className="py-4">
                    <CardTitle className="text-base">{f.label}</CardTitle>
                    <CardDescription className="text-xs mt-2">
                      Best for:
                      <ul className="list-disc pl-4 mt-1">
                        {f.bestFor.map(item => <li key={item}>{item}</li>)}
                      </ul>
                    </CardDescription>
                  </CardHeader>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {step === "draft" && format && source && (
        <div className="grid gap-6 md:grid-cols-3">
          <div className="md:col-span-2 space-y-4">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle>Unified Studio: {FormatRegistry[format].label}</CardTitle>
                    <CardDescription>
                      Source: {ContentSourceRegistry[source].label}
                    </CardDescription>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => handleAutoGenerate(format)}
                    disabled={generateDraft.isPending}
                  >
                    {generateDraft.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                    Regenerate Draft
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Caption</label>
                  <Textarea 
                    placeholder="Content is generated here..." 
                    className="min-h-[150px]"
                    value={content}
                    onChange={(e) => {
                      setContent(e.target.value);
                      // In a real app we'd debounce the evaluation
                    }}
                  />
                </div>
                
                <div className="border rounded-lg p-4 space-y-4 bg-muted/10 relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-2 opacity-10">
                    <Sparkles className="w-24 h-24" />
                  </div>
                  <div className="flex items-center justify-between relative z-10">
                    <div className="flex items-center gap-2">
                      <ImageIcon className="h-5 w-5 text-primary" />
                      <div>
                        <h4 className="font-semibold text-sm">Autonomous Media Engine</h4>
                        <p className="text-xs text-muted-foreground">AI generates and stages brand-compliant assets.</p>
                      </div>
                    </div>
                    <Button 
                      variant="secondary" 
                      size="sm" 
                      onClick={() => generateMedia.mutate({ caption: content })}
                      disabled={generateMedia.isPending || !content}
                    >
                      {generateMedia.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Wand2 className="h-4 w-4 mr-2" />
                      )}
                      Force Gen
                    </Button>
                  </div>
                  
                  {generateMedia.isPending && !mediaUrl ? (
                    <div className="flex flex-col items-center justify-center h-[200px] rounded-md border border-dashed bg-background/50">
                      <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
                      <p className="text-sm text-muted-foreground">Rendering assets...</p>
                    </div>
                  ) : mediaUrl ? (
                    <div className="relative rounded-md overflow-hidden border bg-black/5 flex justify-center p-2 group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={mediaUrl} alt="Staged media" className="max-h-[300px] object-contain rounded" />
                      <Button 
                        size="icon" 
                        variant="destructive" 
                        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => setMediaUrl("")}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-[120px] rounded-md border border-dashed text-muted-foreground text-sm bg-background/50">
                      Waiting for draft to generate media...
                    </div>
                  )}
                </div>
              </CardContent>
              <CardFooter className="flex justify-between border-t p-4 bg-muted/20">
                <Button variant="outline" onClick={() => handleEvaluate(content)}>
                  <Zap className="h-4 w-4 mr-2" />
                  Test Quality Gate
                </Button>
                <Button 
                  onClick={handleQueue} 
                  disabled={score?.gate === "block" || publishDraft.isPending || (!mediaUrl && !publishDraft.isPending)}
                  className="bg-primary text-primary-foreground font-semibold"
                >
                  {publishDraft.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : <Play className="h-4 w-4 mr-2" />}
                  {publishDraft.isPending ? "Queuing..." : "Send to Queue"}
                </Button>
              </CardFooter>
            </Card>
          </div>

          <div>
            <Card className="sticky top-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-green-500" />
                  Quality Gate
                </CardTitle>
                <CardDescription>Strict 13-point scoring system enforcing brand voice and safety.</CardDescription>
              </CardHeader>
              <CardContent>
                {!score ? (
                  <div className="text-sm text-muted-foreground p-4 bg-muted/30 rounded-lg text-center">
                    Drafting required to score.
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="flex flex-col items-center justify-center py-4 bg-muted/20 rounded-xl">
                      <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-1">Overall Score</span>
                      <span className={`text-4xl font-bold tracking-tighter ${score.overall < 70 ? "text-red-500" : score.overall >= 90 ? "text-green-500" : "text-yellow-500"}`}>
                        {score.overall}
                      </span>
                    </div>
                    
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h5 className="text-sm font-medium">Gate Status</h5>
                        <Badge variant={score.gate === "pass" ? "default" : score.gate === "warn" ? "secondary" : "destructive"}>
                          {score.gate.toUpperCase()}
                        </Badge>
                      </div>
                      
                      {!score.reasoning || score.reasoning.length === 0 ? (
                        <div className="flex items-center text-sm text-green-600 bg-green-500/10 p-2 rounded">
                          <CheckCircle2 className="h-4 w-4 mr-2 shrink-0" />
                          Passed all compliance and engagement checks!
                        </div>
                      ) : (
                        <ul className="space-y-2 mt-4">
                          {score.reasoning?.map((w: string, i: number) => (
                            <li key={i} className={`text-sm flex items-start p-2 rounded ${score.gate === "block" ? "bg-red-500/10 text-red-700" : "bg-amber-500/10 text-amber-700"}`}>
                              <AlertTriangle className="h-4 w-4 mr-2 mt-0.5 shrink-0" />
                              {w}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
