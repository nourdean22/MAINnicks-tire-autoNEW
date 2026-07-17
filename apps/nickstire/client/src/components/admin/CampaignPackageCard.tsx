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
import { Loader2, Sparkles, Copy, Check, Trophy, Dna } from "lucide-react";
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
                Reel wizard's context box (Manual Idea source).
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
