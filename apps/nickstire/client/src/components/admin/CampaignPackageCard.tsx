/**
 * Campaign Package generator — Genome Wave 1, slice 4 (the Studio surface).
 *
 * One button runs the full creative core shipped in #809: four role-diverse
 * concept pitches → anonymized field → INDEPENDENT judge → claim-safe winner
 * → campaign genome (persisted to creative memory) → format seeds. The
 * operator gets one judged campaign idea with ready-to-use starting points
 * for the reel wizard, the carousel studio, and the photo prompt path —
 * copy buttons, not retyping.
 */
import { useState } from "react";
import { Loader2, Sparkles, Copy, Check, Trophy, Dna, Clapperboard, Send } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { CAMPAIGN_OBJECTIVES } from "@/lib/creativeGenome";
import { CREATIVE_TERRITORIES } from "@/lib/igCarouselStudio";

function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        toast.success(`${label} copied`);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-400" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
      {label}
    </Button>
  );
}

export default function CampaignPackageCard() {
  const [ask, setAsk] = useState("");
  const [objective, setObjective] = useState<string>("save");

  const tournament = trpc.contentAdmin.runConceptTournament.useMutation({
    onError: (e) => toast.error("Campaign generation failed", { description: e.message }),
    onSuccess: () => reelDraft.reset(),
  });
  const reelDraft = trpc.contentAdmin.draftReelFromGenome.useMutation({
    onError: (e) => toast.error("Reel draft failed", { description: e.message }),
  });
  const enqueue = trpc.contentAdmin.enqueueReelJob.useMutation({
    onSuccess: () => toast.success("Reel render enqueued", { description: "Review it in the Queue when it reaches review-ready." }),
    onError: (e) => toast.error("Enqueue failed", { description: e.message }),
  });
  const result = tournament.data;
  const territoryLabel = result?.genome
    ? CREATIVE_TERRITORIES[result.genome.creativeTerritory]?.label ?? result.genome.creativeTerritory
    : null;

  return (
    <Card className="border-primary/25">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Dna className="h-5 w-5 text-primary" /> Campaign Package
        </CardTitle>
        <CardDescription>
          Four creative directors pitch, an independent judge picks, claim safety gates, creative memory
          steers away from what you already posted — one judged campaign with ready-to-paste seeds.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          maxLength={600}
          placeholder={'E.g., "First hard freeze is coming - drivers ignore the battery until it dies in the driveway. Make them check it this week."'}
        />
        <div className="flex flex-wrap items-center gap-2">
          {CAMPAIGN_OBJECTIVES.map((o) => (
            <Button
              key={o}
              size="sm"
              variant={objective === o ? "default" : "outline"}
              onClick={() => setObjective(o)}
              className="capitalize"
            >
              {o.replace("_", " ")}
            </Button>
          ))}
        </div>
        <Button
          disabled={ask.trim().length < 8 || tournament.isPending}
          onClick={() => tournament.mutate({ campaignAsk: ask.trim(), objective, generateGenome: true })}
        >
          {tournament.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
          {tournament.isPending ? "Running tournament (5 model calls)..." : "Generate Campaign Package"}
        </Button>

        {result && (
          <div className="space-y-4 border-t border-border/40 pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <Trophy className="h-4 w-4 text-primary" />
              <span className="font-bold">{result.winner.title}</span>
              {territoryLabel && <Badge variant="outline">{territoryLabel}</Badge>}
              <Badge variant="outline">{result.concepts.length} concepts judged</Badge>
              <Badge variant="outline">{result.scores.filter((s) => s.rejected).length} rejected</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{result.winner.hook}</p>
            {result.genome && (
              <p className="text-sm">
                <span className="font-semibold">Shared metaphor:</span> {result.genome.visualMetaphor}
              </p>
            )}
            <p className="text-xs text-muted-foreground">{result.judgeReasoning}</p>
            {result.genome && (
              <div className="flex flex-wrap gap-2">
                <CopyButton label="Reel seed" value={result.seeds?.reel ? `${result.seeds.reel.topic}` : ""} />
                <CopyButton label="Carousel seed" value={result.seeds?.carousel ? result.seeds.carousel.topic : ""} />
                <CopyButton label="Photo prompt" value={result.seeds?.photo ?? ""} />
              </div>
            )}
            {result.seeds?.reel && (
              <p className="text-xs text-muted-foreground">
                Reel suggestion: {result.seeds.reel.archetype} · {result.seeds.reel.motionLens} — paste the seed into the
                Reel wizard's context box (Manual Idea source), or draft directly below.
              </p>
            )}

            {result.genome && (
              <div className="space-y-3 rounded-lg border border-border/40 bg-muted/20 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Clapperboard className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold">Reel Director</span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={reelDraft.isPending}
                    onClick={() => reelDraft.mutate({ genome: result.genome })}
                  >
                    {reelDraft.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                    {reelDraft.isPending ? "Drafting full brief..." : reelDraft.data ? "Redraft" : "Draft reel brief"}
                  </Button>
                </div>
                {reelDraft.data && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={reelDraft.data.qualityScore.passing ? "default" : "destructive"}>
                        {reelDraft.data.qualityScore.overall}/75 {reelDraft.data.qualityScore.passing ? "PASS" : "BELOW GATE"}
                      </Badge>
                      <Badge variant="outline">{reelDraft.data.brief.storyboardBeats?.length ?? 0} beats</Badge>
                      <Badge variant="outline">DM "{reelDraft.data.brief.campaignKeyword}"</Badge>
                      <Badge variant="outline">{reelDraft.data.brief.motionLens}</Badge>
                    </div>
                    <p className="text-sm">{reelDraft.data.brief.topic}</p>
                    {reelDraft.data.brief.voiceoverScript && (
                      <p className="text-xs text-muted-foreground">VO: {reelDraft.data.brief.voiceoverScript}</p>
                    )}
                    <Button
                      size="sm"
                      disabled={enqueue.isPending || enqueue.isSuccess || !reelDraft.data.qualityScore.passing}
                      onClick={() => {
                        const b = reelDraft.data.brief;
                        enqueue.mutate({
                          brief: {
                            ...b,
                            sourceType: "manual" as const,
                            sourceOrigin: "campaign_package",
                          },
                        });
                      }}
                    >
                      {enqueue.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
                      {enqueue.isSuccess ? "Enqueued — review in Queue" : "Enqueue render (uses provider credits)"}
                    </Button>
                    {!reelDraft.data.qualityScore.passing && (
                      <p className="text-xs text-destructive">
                        Below the 70/75 gate — redraft, or refine in the Advanced Reel Studio instead.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
