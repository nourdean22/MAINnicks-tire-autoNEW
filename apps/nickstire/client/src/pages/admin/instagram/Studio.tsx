import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { Loader2, Zap, AlertTriangle, CheckCircle2, AlertCircle, Wand2, Image as ImageIcon, Sparkles, ChevronRight, RefreshCw, X, Play, ShieldCheck, Film, Sliders, Tv, Check } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { evaluateQuality, ContentSourceRegistry, FormatRegistry, type SourceType, type PostFormat, type ContentQualityScore } from "@/lib/instagram/quality";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Step = "source" | "format" | "draft";

interface StudioProps {
  onNavigate?: (tab: string) => void;
}

export default function UnifiedStudio({ onNavigate }: StudioProps) {
  const [step, setStep] = useState<Step>("source");
  const [source, setSource] = useState<SourceType | null>(null);
  const [format, setFormat] = useState<PostFormat | null>(null);
  const [sourceDetail, setSourceDetail] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [content, setContent] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [score, setScore] = useState<Pick<ContentQualityScore, "overall" | "gate" | "reasoning"> | null>(null);

  // Real ReelBrief workflow state
  const [reelBrief, setReelBrief] = useState<any>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);

  const generateMedia = trpc.instagramAdmin.generateMedia.useMutation({
    onSuccess: (data) => {
      setMediaUrl(data.url);
      setMediaError(null);
      toast.success("Media generated automatically!");
    },
    onError: (err) => {
      setMediaError(err.message);
      toast.error("Failed to generate media", { description: err.message });
    }
  });

  const generateDraft = trpc.instagramAdmin.generatePostDraft.useMutation({
    onSuccess: (data: { caption: string }) => {
      setContent(data.caption);
      toast.success("Draft generated based on Source and Format.");
      handleEvaluate(data.caption); // auto evaluate
      if (!mediaUrl) {
        generateMedia.mutate({ caption: data.caption });
      }
    },
    onError: (err: any) => {
      toast.error("Failed to generate draft", { description: err.message });
    }
  });

  // ReelBrief mutations
  const generateReelBrief = trpc.contentAdmin.generateReelBrief.useMutation({
    onSuccess: (data) => {
      setReelBrief(data.brief);
      setContent(data.brief.selectedCaption);
      setScore(data.qualityScore as any);
      toast.success("Reel Brief generated successfully!");
    },
    onError: (err) => {
      if (err.message.includes("NEEDS_RESEARCH")) {
        toast.error("Research Needed", {
          description: "Grounded database evidence record not found or unverified. Please provide a valid database ID for reviews or declined work.",
        });
      } else {
        toast.error("Failed to generate Reel Brief", { description: err.message });
      }
    }
  });

  const validateReelBrief = trpc.contentAdmin.validateReelBrief.useMutation({
    onSuccess: (data) => {
      setScore(data.qualityScore as any);
      toast.success("Reel Brief re-scored successfully!");
    },
    onError: (err) => {
      toast.error("Validation failed", { description: err.message });
    }
  });

  const referenceFrames = trpc.contentAdmin.generateReelReferenceFrames.useMutation({
    onError: (err) => toast.error("Reference frame generation failed", { description: err.message }),
  });
  const selectVisualWorld = (candidate: { style: string; url: string; framePrompt: string; lockedInvariants: string } | null) => {
    setReelBrief((prev: any) =>
      prev
        ? {
            ...prev,
            visualWorld: candidate
              ? {
                  style: candidate.style,
                  heroFrameUrl: candidate.url,
                  framePrompt: candidate.framePrompt,
                  lockedInvariants: candidate.lockedInvariants,
                }
              : undefined,
          }
        : prev,
    );
  };

  const enqueueReelJob = trpc.contentAdmin.enqueueReelJob.useMutation({
    onSuccess: (data) => {
      setJobId(data.jobId);
      setJobStatus("pending");
      setJobError(null);
      toast.success(`Reel video generation enqueued! Job ID: ${data.jobId}`);
    },
    onError: (err) => {
      toast.error("Failed to enqueue video generation", { description: err.message });
    }
  });

  // Polling for Reel media job status
  const { data: polledJob } = trpc.contentAdmin.getReelJob.useQuery(
    { jobId: jobId! },
    {
      enabled: jobId !== null && jobStatus !== "completed" && jobStatus !== "failed",
      refetchInterval: 5000,
    }
  );

  useEffect(() => {
    if (polledJob) {
      setJobStatus(polledJob.status);
      if (polledJob.status === "completed" && polledJob.videoUrl) {
        setMediaUrl(polledJob.videoUrl);
        setJobId(null);
        toast.success("Reel video generated and assembled successfully!");
      } else if (polledJob.status === "failed") {
        setJobError(polledJob.error || "Unknown generation error");
        setJobId(null);
        toast.error("Reel video generation failed", { description: polledJob.error });
      }
    }
  }, [polledJob]);

  const publishDraft = trpc.instagramAdmin.stageDraft.useMutation({
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
      setReelBrief(null);
      setJobId(null);
      setJobStatus(null);
      if (onNavigate) onNavigate("queue");
    },
    onError: (err) => {
      toast.error("Queue Failed", { description: err.message });
    }
  });

  const handleEvaluate = (text: string = content) => {
    if (format === "reel") {
      if (reelBrief) {
        const editedBrief = {
          ...reelBrief,
          selectedCaption: text,
        };
        validateReelBrief.mutate({ brief: editedBrief });
      }
    } else {
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
    }
  };

  const handleSourceSelect = (t: SourceType) => {
    setSource(t);
    setStep("format");
  };

  const handleFormatSelect = (f: PostFormat) => {
    setFormat(f);
    setStep("draft");
    if (source && ContentSourceRegistry[source].requiresDetail && !sourceDetail) {
      // wait for detail
    } else {
      handleAutoGenerate(f);
    }
  };

  const handleAutoGenerate = (selectedFormat: PostFormat = format!) => {
    if (source) {
      if (selectedFormat === "reel") {
        generateReelBrief.mutate({
          topic: sourceDetail || undefined,
          sourceType: source,
          sourceId: sourceId || undefined,
          sourceDetail: sourceDetail || undefined,
        });
      } else {
        generateDraft.mutate({ 
          sourceId: source, 
          sourceDetail, 
          format: selectedFormat 
        });
      }
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
      toast.error("Missing Media", {
        description: "Instagram requires media (Image/Video). AI is working on it or you can provide one.",
      });
      return;
    }
    
    publishDraft.mutate({ 
      format: format || "single", 
      caption: content, 
      videoUrl: format === "reel" ? mediaUrl : undefined,
      imageUrl: format !== "reel" ? mediaUrl : undefined,
      sourceType: source || "manual",
      sourceDetail: sourceDetail,
      conceptBrief: format === "reel" ? reelBrief : undefined,
      // No qualityScore: the local evaluation here is a client-side heuristic;
      // the server stages manual drafts as unscored rather than persisting it.
    });
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
                <CardTitle className="text-sm">Provide Grounding & Details</CardTitle>
                <CardDescription>Ground the Reel in database records. Providing a concrete ID is required for Reviews and Declined Work.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground block">Concrete Record ID (e.g., 5-Star Review or Work Order ID)</label>
                    <Input 
                      placeholder="E.g., 104"
                      value={sourceId}
                      onChange={(e) => setSourceId(e.target.value)}
                      className="bg-background h-10"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-muted-foreground block">Operator Context / Notes (unverified)</label>
                    <Textarea 
                      placeholder={`E.g., "Customer complained about pedal pulsation..."`}
                      value={sourceDetail}
                      onChange={(e) => setSourceDetail(e.target.value)}
                      className="bg-background min-h-[60px]"
                    />
                  </div>
                </div>
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
        format === "reel" ? (
          <div className="grid gap-6 md:grid-cols-3">
            <div className="md:col-span-2 space-y-6">
              <Card className="border-primary/20 shadow-xl bg-background/50 backdrop-blur-md">
                <CardHeader className="bg-gradient-to-r from-primary/10 via-transparent to-transparent">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-xl font-bold flex items-center gap-2">
                        <Film className="h-5 w-5 text-primary" />
                        Faceless Reel Studio Dashboard
                      </CardTitle>
                      <CardDescription>
                        Source: {ContentSourceRegistry[source].label} · Grounded Cleveland auto education
                      </CardDescription>
                    </div>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => handleAutoGenerate("reel")}
                      disabled={generateReelBrief.isPending}
                      className="hover:bg-primary/5 border-primary/20"
                    >
                      {generateReelBrief.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                      Regenerate Brief
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-6 pt-4">
                  {generateReelBrief.isPending && !reelBrief ? (
                    <div className="flex flex-col items-center justify-center py-20">
                      <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
                      <p className="text-sm font-medium">Generating structured ReelBrief (server-selected model)...</p>
                      <p className="text-xs text-muted-foreground mt-1">Researching Cleveland road parameters and compiling storyboard...</p>
                    </div>
                  ) : reelBrief ? (
                    <div className="space-y-6">
                      {/* Reel Metadata */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-muted/30 p-3 rounded-lg border border-border/50 text-xs">
                        <div>
                          <span className="text-muted-foreground block">Campaign Keyword</span>
                          <span className="font-semibold capitalize text-foreground">{reelBrief.campaignKeyword || "None"}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block">Archetype</span>
                          <span className="font-semibold capitalize text-foreground">{reelBrief.archetype?.replace("_", " ") || "None"}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block">Motion Lens</span>
                          <span className="font-semibold capitalize text-foreground">{reelBrief.motionLens?.replace("_", " ") || "None"}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block">Object Character</span>
                          <span className="font-semibold capitalize text-foreground">{reelBrief.objectCharacter?.replace("_", " ") || "None"}</span>
                        </div>
                      </div>

                      {/* Storyboard Beats */}
                      <div className="space-y-4">
                        <h4 className="font-bold text-sm flex items-center gap-2 border-b pb-2">
                          <Sliders className="h-4 w-4 text-primary" />
                          Storyboard Beats & Prompt Pack ({reelBrief.storyboardBeats?.length || 0} Beats)
                        </h4>
                        <div className="space-y-3">
                          {reelBrief.storyboardBeats?.map((beat: any, idx: number) => (
                            <Card key={idx} className="bg-muted/10 border-border/60 hover:border-primary/20 transition-all">
                              <CardContent className="p-4 space-y-3">
                                <div className="flex justify-between items-center text-xs border-b pb-2 border-border/40">
                                  <span className="font-bold text-primary flex items-center gap-1.5">
                                    <span className="h-5 w-5 bg-primary/10 text-primary rounded-full flex items-center justify-center font-bold text-xs">{beat.beatNumber}</span>
                                    Beat {beat.beatNumber}
                                  </span>
                                  <Badge variant="outline" className="font-mono text-[10px]">
                                    {beat.startSecond?.toFixed(1) || "0.0"}s - {beat.endSecond?.toFixed(1) || "3.0"}s ({( (beat.endSecond || 3) - (beat.startSecond || 0) ).toFixed(1)}s)
                                  </Badge>
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                  <div className="space-y-1">
                                    <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wide block">Visual Prompt (Higgsfield/Veo)</span>                                    <Textarea
                                      className="text-xs bg-background min-h-[60px]"
                                      value={beat.visual}
                                      onChange={(e) => {
                                        const newBeats = [...reelBrief.storyboardBeats];
                                        newBeats[idx].visual = e.target.value;
                                        setReelBrief({ ...reelBrief, storyboardBeats: newBeats });
                                        setScore(null);
                                      }}
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <div>
                                      <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wide block">On-Screen Text Overlay</span>
                                      <Input
                                        className="text-xs bg-background h-8"
                                        value={beat.onScreenText}
                                        onChange={(e) => {
                                          const newBeats = [...reelBrief.storyboardBeats];
                                          newBeats[idx].onScreenText = e.target.value;
                                          setReelBrief({ ...reelBrief, storyboardBeats: newBeats });
                                          setScore(null);
                                        }}
                                      />
                                    </div>
                                    <div>
                                      <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wide block">Motion/Camera Instruction</span>
                                      <Input
                                        className="text-xs bg-background h-8"
                                        value={beat.motion}
                                        onChange={(e) => {
                                          const newBeats = [...reelBrief.storyboardBeats];
                                          newBeats[idx].motion = e.target.value;
                                          setReelBrief({ ...reelBrief, storyboardBeats: newBeats });
                                          setScore(null);
                                        }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </div>
 
                      {/* Voiceover Script */}
                      <div className="space-y-2">
                        <label className="text-xs uppercase font-bold tracking-wide text-muted-foreground block">Voiceover Script (Trained ElevenLabs AI Voice)</label>
                        <Textarea 
                          className="min-h-[80px] bg-background text-sm"
                          value={reelBrief.voiceoverScript || ""}
                          onChange={(e) => {
                            setReelBrief({ ...reelBrief, voiceoverScript: e.target.value });
                            setScore(null);
                          }}
                        />
                      </div>
 
                      {/* Caption Editor */}
                      <div className="space-y-2">
                        <label className="text-xs uppercase font-bold tracking-wide text-muted-foreground block">Final Instagram Caption</label>
                        <Textarea 
                          className="min-h-[100px] bg-background text-sm"
                          value={content}
                          onChange={(e) => {
                            setContent(e.target.value);
                            setReelBrief((prev: any) => prev ? { ...prev, selectedCaption: e.target.value } : null);
                            setScore(null);
                          }}
                        />
                      </div>

                      {/* Visual World — approved reference frame locks continuity */}
                      <div className="border rounded-xl p-5 space-y-3 bg-muted/20 border-border/80">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h4 className="font-bold text-sm flex items-center gap-2">
                              <ImageIcon className="h-4 w-4 text-primary" /> Visual World
                              {reelBrief?.visualWorld && (
                                <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary">
                                  {reelBrief.visualWorld.style} locked
                                </span>
                              )}
                            </h4>
                            <p className="text-xs text-muted-foreground">
                              Approve ONE reference frame; its invariants lock hero, environment, lighting, and palette into
                              every clip prompt. Optional — skipping keeps the standard continuity block.
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={referenceFrames.isPending || !reelBrief}
                            onClick={() =>
                              referenceFrames.mutate({
                                brief: {
                                  topic: reelBrief.topic,
                                  objectCharacter: reelBrief.objectCharacter,
                                  motionLens: reelBrief.motionLens,
                                  storyboardBeats: reelBrief.storyboardBeats ?? [],
                                },
                              })
                            }
                          >
                            {referenceFrames.isPending ? (
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                            )}
                            {referenceFrames.isPending
                              ? "Generating 3 frames..."
                              : referenceFrames.data
                                ? "Regenerate frames"
                                : "Generate 3 candidates (image credits)"}
                          </Button>
                        </div>
                        {referenceFrames.data && (
                          <div className="grid grid-cols-3 gap-2">
                            {referenceFrames.data.frames.map((f) => {
                              const selected = reelBrief?.visualWorld?.heroFrameUrl === f.url;
                              return (
                                <button
                                  key={f.style}
                                  type="button"
                                  onClick={() => selectVisualWorld(selected ? null : f)}
                                  className={`group relative overflow-hidden rounded-lg border-2 transition-colors ${
                                    selected ? "border-primary" : "border-border/40 hover:border-border"
                                  }`}
                                >
                                  <img src={f.url} alt={`${f.style} reference frame`} className="aspect-[9/16] w-full object-cover" />
                                  <span className="absolute inset-x-0 bottom-0 bg-black/70 px-1 py-0.5 text-center text-[10px] font-bold uppercase tracking-wide text-white">
                                    {selected ? "✓ " : ""}
                                    {f.style}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Media Generation Section */}
                      <div className="border rounded-xl p-5 space-y-4 bg-muted/20 relative overflow-hidden border-border/80">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                              <Tv className="h-5 w-5" />
                            </div>
                            <div>
                              <h4 className="font-bold text-sm">Background Assembly Pipeline</h4>
                              <p className="text-xs text-muted-foreground">Creates clips via the server-selected video provider (Higgsfield/Veo), overlays text, and renders audio.</p>
                            </div>
                          </div>
                          {!jobStatus && !mediaUrl && (
                            <Button 
                              variant="default" 
                              size="sm" 
                              onClick={() => {
                                setJobError(null);
                                // The generated brief carries no sourceType, but the enqueue
                                // schema requires review|declined_work|manual — without this
                                // mapping EVERY wizard reel failed enqueue with a zod error
                                // (observed live 2026-07-16). review/declined_work keep their
                                // DB-verified provenance path; every other wizard source is
                                // "manual" by definition.
                                enqueueReelJob.mutate({
                                  brief: {
                                    ...reelBrief,
                                    sourceType: source === "review" || source === "declined_work" ? source : "manual",
                                    sourceOrigin: source ?? undefined,
                                    sourceId: sourceId || undefined,
                                  },
                                });
                              }}
                              disabled={enqueueReelJob.isPending || !score || score.gate !== "pass"}
                            >
                              {enqueueReelJob.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Wand2 className="h-4 w-4 mr-2" />}
                              Generate Reel Video
                            </Button>
                          )}
                        </div>

                        {/* Polling / Generation States */}
                        {jobStatus && (
                          <div className="flex flex-col items-center justify-center p-6 border border-dashed rounded-lg bg-background/60 space-y-3">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            <div className="text-center">
                              <p className="text-sm font-semibold capitalize">Reel Media Render: {jobStatus}</p>
                              <p className="text-xs text-muted-foreground mt-1">
                                {jobStatus === "pending" && "Waiting in background worker queue..."}
                                {jobStatus === "generating" && "Generating storyboard clips via the selected video provider..."}
                                {jobStatus === "assembling" && "Concatenating scenes and overlays in local FFmpeg..."}
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Complete Media URL */}
                        {mediaUrl && (
                          <div className="space-y-3">
                            <div className="relative rounded-lg overflow-hidden border border-border/80 bg-black flex justify-center max-h-[350px]">
                              <video src={mediaUrl} controls className="max-h-[350px] w-auto" />
                              <Button 
                                size="icon" 
                                variant="destructive" 
                                className="absolute top-2 right-2 font-bold"
                                onClick={() => setMediaUrl("")}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                            <div className="flex justify-end">
                              <Button 
                                variant="outline" 
                                size="sm" 
                                onClick={() => {
                                  setMediaUrl("");
                                  setJobStatus(null);
                                  enqueueReelJob.mutate({ brief: reelBrief });
                                }}
                              >
                                <RefreshCw className="h-3 w-3 mr-1.5" /> Re-Generate Video
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* Error State */}
                        {jobError && (
                          <div className="flex flex-col items-center justify-center p-4 rounded-lg border border-red-500/20 bg-red-500/5 text-sm gap-2">
                            <div className="flex items-center gap-2 text-red-500 font-semibold">
                              <AlertCircle className="h-4 w-4" />
                              <span>Generation failed</span>
                            </div>
                            <p className="text-xs text-muted-foreground text-center">{jobError}</p>
                            <Button 
                              variant="outline" 
                              size="sm" 
                              onClick={() => {
                                setJobError(null);
                                // The generated brief carries no sourceType, but the enqueue
                                // schema requires review|declined_work|manual — without this
                                // mapping EVERY wizard reel failed enqueue with a zod error
                                // (observed live 2026-07-16). review/declined_work keep their
                                // DB-verified provenance path; every other wizard source is
                                // "manual" by definition.
                                enqueueReelJob.mutate({
                                  brief: {
                                    ...reelBrief,
                                    sourceType: source === "review" || source === "declined_work" ? source : "manual",
                                    sourceOrigin: source ?? undefined,
                                    sourceId: sourceId || undefined,
                                  },
                                });
                              }}
                            >
                              <RefreshCw className="h-3 w-3 mr-1.5" /> Retry
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-10 text-muted-foreground text-sm">
                      Please enter details and generate a draft to see the Reel Brief.
                    </div>
                  )}
                </CardContent>
                <CardFooter className="flex justify-between border-t p-4 bg-muted/20">
                  <Button variant="outline" onClick={() => handleEvaluate(content)} disabled={!reelBrief}>
                    <Zap className="h-4 w-4 mr-2" />
                    Re-Score Brief
                  </Button>
                  <Button 
                    onClick={handleQueue} 
                    disabled={!score || score.gate !== "pass" || publishDraft.isPending || (!mediaUrl && !publishDraft.isPending) || content !== reelBrief?.selectedCaption}
                    className="bg-primary text-primary-foreground font-bold shadow-lg"
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
              <Card className="sticky top-6 border-primary/10 shadow-lg bg-background/50 backdrop-blur-md">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-green-500" />
                    Quality Gate
                  </CardTitle>
                  <CardDescription>Strict 10-point scoring system enforcing brand voice and safety.</CardDescription>
                </CardHeader>
                <CardContent>
                  {!score ? (
                    reelBrief ? (
                      <div className="text-sm text-yellow-600 bg-yellow-500/10 p-4 rounded-lg border border-yellow-500/20 text-center">
                        <AlertTriangle className="h-4 w-4 inline mr-2 text-yellow-500" />
                        Edits detected. Please click <strong>Re-Score Brief</strong> to run safety and compliance gates.
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground p-4 bg-muted/30 rounded-lg text-center">
                        Drafting required to score.
                      </div>
                    )
                  ) : (
                    <div className="space-y-6">
                      <div className="flex flex-col items-center justify-center py-4 bg-muted/20 rounded-xl">
                        <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-1">Overall Score</span>
                        <span className={`text-4xl font-bold tracking-tighter ${score.overall < 75 ? "text-red-500" : "text-green-500"}`}>
                          {score.overall} / 75
                        </span>
                      </div>
                      
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h5 className="text-sm font-medium">Gate Status</h5>
                          <Badge variant={score.gate === "pass" ? "default" : "destructive"}>
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
                              <li key={i} className={`text-xs flex items-start p-2 rounded ${score.gate === "block" ? "bg-red-500/10 text-red-700" : "bg-amber-500/10 text-amber-700"}`}>
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
        ) : (
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
                        onClick={() => {
                          setMediaError(null);
                          generateMedia.mutate({ caption: content });
                        }}
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
                    ) : mediaError ? (
                      <div className="flex flex-col items-center justify-center h-[120px] rounded-md border border-dashed border-red-500/40 text-sm bg-red-500/5 gap-2 px-4">
                        <div className="flex items-center gap-2 text-red-500">
                          <AlertCircle className="h-4 w-4 shrink-0" />
                          <span className="font-medium">Media generation failed</span>
                        </div>
                        <p className="text-xs text-muted-foreground text-center line-clamp-2">{mediaError}</p>
                        <Button variant="outline" size="sm" onClick={() => { setMediaError(null); generateMedia.mutate({ caption: content }); }} disabled={!content}>
                          <RefreshCw className="h-3 w-3 mr-1" /> Retry
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
        )
      )}
    </div>
  );
}
