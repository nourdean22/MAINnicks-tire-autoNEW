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
import { Loader2, Sparkles, Copy, Check, Trophy, Dna, Clapperboard, Send, LayoutGrid } from "lucide-react";
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
  const [proofHandles, setProofHandles] = useState<string[]>([]);

  const evidenceOptions = trpc.contentAdmin.listEvidenceOptions.useQuery(undefined, { staleTime: 60_000 });
  // Server accepts at most 8 proofHandles — selecting a 9th must be
  // impossible here, not a zod error after the tournament button.
  const MAX_PROOF_HANDLES = 8;
  const toggleProof = (handle: string) =>
    setProofHandles((prev) =>
      prev.includes(handle)
        ? prev.filter((h) => h !== handle)
        : prev.length >= MAX_PROOF_HANDLES
          ? prev
          : [...prev, handle],
    );

  const tournament = trpc.contentAdmin.runConceptTournament.useMutation({
    onError: (e) => toast.error("Campaign generation failed", { description: e.message }),
    onSuccess: () => {
      // A new campaign invalidates every per-campaign mutation state — the
      // enqueue reset was missing in #811, leaving the button dead (and
      // showing a false "Enqueued") for every campaign after the first.
      reelDraft.reset();
      enqueue.reset();
      carouselDraft.reset();
      saveCarousel.reset();
    },
  });
  const reelDraft = trpc.contentAdmin.draftReelFromGenome.useMutation({
    onError: (e) => toast.error("Reel draft failed", { description: e.message }),
  });
  const enqueue = trpc.contentAdmin.enqueueReelJob.useMutation({
    onSuccess: () => toast.success("Reel render enqueued", { description: "Review it in the Queue when it reaches review-ready." }),
    onError: (e) => toast.error("Enqueue failed", { description: e.message }),
  });
  const carouselDraft = trpc.contentAdmin.draftCarouselFromGenome.useMutation({
    onError: (e) => toast.error("Carousel draft failed", { description: e.message }),
  });
  const saveCarousel = trpc.contentAdmin.saveCarouselDraft.useMutation({
    onSuccess: () => toast.success("Carousel saved to Draft Board", { description: "Open the Drafts tab to render slides and publish." }),
    onError: (e) => toast.error("Draft save failed", { description: e.message }),
  });
  const draftAndSaveCarousel = async (genome: unknown) => {
    const res = await carouselDraft.mutateAsync({ genome });
    await saveCarousel.mutateAsync({ id: res.brief.id, topic: res.brief.topic, brief: res.brief });
  };
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
        {(evidenceOptions.data?.length ?? 0) > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Attach real evidence (verified before use) — {proofHandles.length}/{MAX_PROOF_HANDLES}
            </p>
            <div className="flex max-h-36 flex-col gap-1 overflow-y-auto">
              {evidenceOptions.data?.map((o) => (
                <button
                  key={o.handle}
                  type="button"
                  onClick={() => toggleProof(o.handle)}
                  className={`rounded-md border px-2 py-1 text-left text-xs transition-colors ${
                    proofHandles.includes(o.handle)
                      ? "border-primary/60 bg-primary/10"
                      : "border-border/40 hover:border-border"
                  }`}
                >
                  {proofHandles.includes(o.handle) ? "✓ " : ""}
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <Button
          disabled={ask.trim().length < 8 || tournament.isPending}
          onClick={() =>
            tournament.mutate({
              campaignAsk: ask.trim(),
              objective,
              generateGenome: true,
              proofHandles: proofHandles.length ? proofHandles : undefined,
            })
          }
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
                    onClick={() => {
                      enqueue.reset();
                      reelDraft.mutate({ genome: result.genome });
                    }}
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
                    {!reelDraft.data.qualityScore.passing && reelDraft.data.qualityScore.reasoning.length > 0 && (
                      <ul className="space-y-0.5 text-xs text-destructive">
                        {reelDraft.data.qualityScore.reasoning.map((r) => (
                          <li key={r}>• {r}</li>
                        ))}
                      </ul>
                    )}
                    {reelDraft.data.evidence?.rejected.length > 0 && (
                      <p className="text-xs text-amber-500">
                        {reelDraft.data.evidence.rejected.length} evidence handle(s) could not be verified and were NOT
                        attached: {reelDraft.data.evidence.rejected.join(", ")}
                      </p>
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
                            genomeId: result.genomeId ?? null,
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

            {result.genome && (
              <div className="space-y-3 rounded-lg border border-border/40 bg-muted/20 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <LayoutGrid className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold">Carousel Director</span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={carouselDraft.isPending || saveCarousel.isPending}
                    onClick={() => void draftAndSaveCarousel(result.genome)}
                  >
                    {carouselDraft.isPending || saveCarousel.isPending ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {carouselDraft.isPending
                      ? "Drafting 5-slide brief..."
                      : saveCarousel.isPending
                        ? "Saving to Draft Board..."
                        : carouselDraft.data
                          ? "Redraft carousel"
                          : "Draft carousel to Draft Board"}
                  </Button>
                </div>
                {carouselDraft.data && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={carouselDraft.data.boostScore.passing ? "default" : "destructive"}>
                        {carouselDraft.data.boostScore.score}/75 {carouselDraft.data.boostScore.passing ? "PASS" : "BELOW GATE"}
                      </Badge>
                      <Badge variant="outline">{carouselDraft.data.brief.slides.length} slides</Badge>
                      <Badge variant="outline">DM "{carouselDraft.data.brief.campaignKeyword}"</Badge>
                    </div>
                    <p className="text-sm">{carouselDraft.data.brief.topic}</p>
                    {!carouselDraft.data.boostScore.passing && (
                      <ul className="space-y-0.5 text-xs text-destructive">
                        {carouselDraft.data.boostScore.parts.filter((p) => !p.ok).map((p) => (
                          <li key={p.label}>• {p.detail}</li>
                        ))}
                      </ul>
                    )}
                    {carouselDraft.data.evidence?.rejected.length > 0 && (
                      <p className="text-xs text-amber-500">
                        {carouselDraft.data.evidence.rejected.length} evidence handle(s) could not be verified and were
                        NOT attached: {carouselDraft.data.evidence.rejected.join(", ")}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {saveCarousel.isSuccess
                        ? "Saved — open the Drafts tab to render slides and publish."
                        : "Saving to Draft Board..."}
                    </p>
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
