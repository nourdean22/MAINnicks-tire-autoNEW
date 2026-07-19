import { useMemo, useState } from "react";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight, Film, Image as ImageIcon,
  Layers3, Loader2, Megaphone, RefreshCw, Save, ShieldCheck, Sparkles, Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  INSTAGRAM_FORMAT_LABELS,
  INSTAGRAM_OBJECTIVES,
  INSTAGRAM_SOURCE_LABELS,
  INSTAGRAM_SOURCE_TYPES,
  type InstagramFormat,
  type InstagramObjective,
  type InstagramSourceType,
  type InstagramStudioDraft,
} from "../../../../shared/instagramStudio";
import LegacyStudio from "./Studio";
import CampaignPackageCard from "@/components/admin/CampaignPackageCard";

/**
 * Draft fields the deterministic renderer consumes. Editing any of them invalidates
 * already-rendered assets, forcing a re-render before the draft can be staged.
 *
 * `carouselSlides` was missing from this set: an operator could render a carousel,
 * then edit slide copy, and stage the PRE-EDIT images against POST-EDIT text — the
 * stored draft and quality score described one thing while the live post showed
 * another. Adding a field the renderer reads without adding it here reintroduces
 * that bug, so keep this list next to `renderInstagramStudioAssets`.
 *
 * `artDirection` is intentionally absent: the deterministic renderer never reads it
 * (server/services/instagramStudio.ts:340 takes no artDirection param). Over-listing
 * a field only wastes a re-render; under-listing one publishes the wrong visual, so
 * when in doubt add it here.
 */
const VISUAL_FIELDS: ReadonlySet<keyof InstagramStudioDraft> = new Set([
  "format",
  "headline",
  "subheadline",
  "cta",
  "carouselSlides",
]);

const STATIC_FORMATS: Array<{ id: Exclude<InstagramFormat, "reel">; icon: typeof ImageIcon; description: string }> = [
  { id: "post", icon: ImageIcon, description: "One hard-hitting idea with a clean branded visual." },
  { id: "carousel", icon: Layers3, description: "Five-slide education, proof, or comparison sequence." },
  { id: "story", icon: Sparkles, description: "Vertical 9:16 update built for immediate publishing." },
  { id: "ad", icon: Megaphone, description: "Direct-response creative with one controlled action." },
];

const OBJECTIVE_LABELS: Record<InstagramObjective, string> = {
  bookings: "Book appointments",
  calls: "Drive calls",
  walk_ins: "Drive walk-ins",
  trust: "Build trust",
  education: "Teach something useful",
  engagement: "Earn saves and shares",
  retargeting: "Retarget warm customers",
};

function gateClass(gate: string) {
  if (gate === "pass") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-400";
  if (gate === "block") return "border-red-500/40 bg-red-500/10 text-red-400";
  return "border-amber-500/40 bg-amber-500/10 text-amber-400";
}

export default function StudioV2() {
  const [showReelStudio, setShowReelStudio] = useState(false);
  const [sourceType, setSourceType] = useState<InstagramSourceType>("manual_idea");
  const [sourceRecordId, setSourceRecordId] = useState("");
  const [sourceDetail, setSourceDetail] = useState("");
  const [format, setFormat] = useState<Exclude<InstagramFormat, "reel">>("post");
  const [objective, setObjective] = useState<InstagramObjective>("bookings");
  const [direction, setDirection] = useState("");
  const [draft, setDraft] = useState<InstagramStudioDraft | null>(null);

  const generate = trpc.instagramStudio.generate.useMutation({
    onSuccess: (result) => {
      setDraft(result as InstagramStudioDraft);
      toast.success("Draft generated", { description: "Copy and quality findings are ready for review." });
    },
    onError: (error) => toast.error("Generation failed", { description: error.message }),
  });
  const evaluate = trpc.instagramStudio.evaluate.useMutation({
    onSuccess: (result) => {
      setDraft(result as InstagramStudioDraft);
      toast.success("Quality gate refreshed");
    },
    onError: (error) => toast.error("Quality check failed", { description: error.message }),
  });
  const render = trpc.instagramStudio.render.useMutation({
    onSuccess: (result) => {
      setDraft(result as InstagramStudioDraft);
      toast.success("Assets rendered", { description: `${result.imageUrls.length} permanent JPEG asset${result.imageUrls.length === 1 ? "" : "s"} ready.` });
    },
    onError: (error) => toast.error("Render failed", { description: error.message }),
  });
  const stage = trpc.instagramStudio.stage.useMutation({
    onSuccess: () => toast.success("Sent to review queue", { description: "Approve, schedule, or publish from Queue." }),
    onError: (error) => toast.error("Queue failed", { description: error.message }),
  });

  const requiresRecord = sourceType === "review" || sourceType === "declined_work";
  const canGenerate = !requiresRecord || sourceRecordId.trim().length > 0;
  const assembledCaption = useMemo(() => {
    if (!draft) return "";
    const tags = draft.hashtags.map((tag) => `#${tag}`).join(" ");
    return `${draft.caption}${tags ? `\n\n${tags}` : ""}`;
  }, [draft]);

  const patchDraft = <K extends keyof InstagramStudioDraft>(key: K, value: InstagramStudioDraft[K]) => {
    setDraft((current) => current ? { ...current, [key]: value, imageUrls: VISUAL_FIELDS.has(key) ? [] : current.imageUrls } : current);
  };

  if (showReelStudio) {
    return (
      <div className="space-y-4">
        <Button variant="outline" onClick={() => setShowReelStudio(false)}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Studio V2
        </Button>
        <LegacyStudio />
      </div>
    );
  }

  return (
    <div className="space-y-7 pb-12">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Badge variant="outline" className="mb-3 border-primary/30 text-primary">Instagram Studio V2</Badge>
          <h2 className="text-3xl font-bold tracking-tight">Create exactly what you need.</h2>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            Give the system a source, format, goal, and direct order. It produces controlled copy, scores it on the server, renders clean Nick’s Tire assets, and stages nothing until you approve the result.
          </p>
        </div>
        <Button variant="outline" onClick={() => setShowReelStudio(true)} className="h-11">
          <Film className="mr-2 h-4 w-4" /> Open Advanced Reel Studio
        </Button>
      </div>

      <CampaignPackageCard />

      <div className="grid gap-6 xl:grid-cols-[390px_minmax(0,1fr)]">
        <Card className="h-fit xl:sticky xl:top-5">
          <CardHeader>
            <CardTitle>Creative Order</CardTitle>
            <CardDescription>The system follows these controls. It does not guess your objective.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">1. Source of truth</label>
              <div className="grid grid-cols-2 gap-2">
                {INSTAGRAM_SOURCE_TYPES.map((type) => (
                  <button
                    type="button"
                    key={type}
                    onClick={() => { setSourceType(type); setDraft(null); }}
                    className={`rounded-lg border p-3 text-left text-xs transition ${sourceType === type ? "border-primary bg-primary/10 text-foreground" : "border-border/70 text-muted-foreground hover:border-primary/40"}`}
                  >
                    {INSTAGRAM_SOURCE_LABELS[type]}
                  </button>
                ))}
              </div>
            </div>

            {requiresRecord && (
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Verified database record ID</label>
                <Input value={sourceRecordId} onChange={(event) => setSourceRecordId(event.target.value)} placeholder={sourceType === "review" ? "Review ID" : "Declined work item ID"} />
                <p className="text-xs text-muted-foreground">The server blocks generation when this record cannot be verified.</p>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Context or evidence</label>
              <Textarea value={sourceDetail} onChange={(event) => setSourceDetail(event.target.value)} placeholder="What happened, what customers keep asking, what offer is active, or what the photo shows." className="min-h-24" />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">2. Format</label>
              <div className="grid grid-cols-2 gap-2">
                {STATIC_FORMATS.map(({ id, icon: Icon, description }) => (
                  <button
                    type="button"
                    key={id}
                    onClick={() => { setFormat(id); setDraft(null); }}
                    className={`rounded-xl border p-3 text-left transition ${format === id ? "border-primary bg-primary/10" : "border-border/70 hover:border-primary/40"}`}
                  >
                    <Icon className="mb-2 h-4 w-4 text-primary" />
                    <div className="text-sm font-semibold">{INSTAGRAM_FORMAT_LABELS[id]}</div>
                    <div className="mt-1 text-[11px] leading-4 text-muted-foreground">{description}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">3. Business objective</label>
              <select value={objective} onChange={(event) => setObjective(event.target.value as InstagramObjective)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                {INSTAGRAM_OBJECTIVES.map((item) => <option key={item} value={item}>{OBJECTIVE_LABELS[item]}</option>)}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">4. Your order</label>
              <Textarea value={direction} onChange={(event) => setDirection(event.target.value)} placeholder="Example: Make this blunt, useful, brake-focused, and designed to drive walk-ins today. No fake statistics. One strong visual." className="min-h-28" />
            </div>
          </CardContent>
          <CardFooter>
            <Button
              className="w-full"
              disabled={!canGenerate || generate.isPending}
              onClick={() => generate.mutate({
                source: { type: sourceType, recordId: sourceRecordId || undefined, detail: sourceDetail || undefined },
                format,
                objective,
                operatorDirection: direction || undefined,
              })}
            >
              {generate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
              {generate.isPending ? "Building draft..." : "Generate controlled draft"}
            </Button>
          </CardFooter>
        </Card>

        {!draft ? (
          <Card className="min-h-[620px] border-dashed">
            <CardContent className="flex h-full min-h-[620px] flex-col items-center justify-center px-8 text-center">
              <div className="rounded-full bg-primary/10 p-5"><Sparkles className="h-10 w-10 text-primary" /></div>
              <h3 className="mt-5 text-xl font-semibold">Ready for a real creative order</h3>
              <p className="mt-2 max-w-lg text-sm text-muted-foreground">Select the source, format, and business goal. The output will include editable copy, actual quality findings, and clean rendered media.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <Card>
              <CardHeader className="border-b">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle>{INSTAGRAM_FORMAT_LABELS[draft.format]} · {draft.topic}</CardTitle>
                    <CardDescription className="mt-1">{draft.rationale}</CardDescription>
                  </div>
                  <Badge className={gateClass(draft.quality.gate)} variant="outline">{draft.quality.gate.toUpperCase()} · {draft.quality.overall}</Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-6 pt-6 lg:grid-cols-[minmax(0,1fr)_340px]">
                <div className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2"><label className="text-xs font-bold uppercase text-muted-foreground">Visual headline</label><Input value={draft.headline} maxLength={42} onChange={(event) => patchDraft("headline", event.target.value)} /><div className="text-right text-[11px] text-muted-foreground">{draft.headline.length}/42</div></div>
                    <div className="space-y-2"><label className="text-xs font-bold uppercase text-muted-foreground">CTA</label><Input value={draft.cta} maxLength={52} onChange={(event) => patchDraft("cta", event.target.value)} /><div className="text-right text-[11px] text-muted-foreground">{draft.cta.length}/52</div></div>
                  </div>
                  <div className="space-y-2"><label className="text-xs font-bold uppercase text-muted-foreground">Visual subheadline</label><Textarea value={draft.subheadline} maxLength={90} onChange={(event) => patchDraft("subheadline", event.target.value)} className="min-h-20" /><div className="text-right text-[11px] text-muted-foreground">{draft.subheadline.length}/90</div></div>
                  <div className="space-y-2"><label className="text-xs font-bold uppercase text-muted-foreground">Caption</label><Textarea value={draft.caption} maxLength={2200} onChange={(event) => patchDraft("caption", event.target.value)} className="min-h-52 text-base leading-7" /><div className="text-right text-[11px] text-muted-foreground">{assembledCaption.length}/2200 with hashtags</div></div>
                  <div className="space-y-2"><label className="text-xs font-bold uppercase text-muted-foreground">Art direction</label><Textarea value={draft.artDirection} onChange={(event) => patchDraft("artDirection", event.target.value)} className="min-h-24" /></div>

                  {draft.format === "carousel" && (
                    <div className="space-y-3">
                      <label className="text-xs font-bold uppercase text-muted-foreground">Five-slide sequence</label>
                      {draft.carouselSlides.map((slide, index) => (
                        <div key={`${slide.role}-${index}`} className="rounded-lg border p-4">
                          <div className="mb-3 flex items-center justify-between"><Badge variant="outline">{index + 1} · {slide.role}</Badge><span className="text-xs text-muted-foreground">{slide.headline.length}/42</span></div>
                          <Input value={slide.headline} onChange={(event) => patchDraft("carouselSlides", draft.carouselSlides.map((item, itemIndex) => itemIndex === index ? { ...item, headline: event.target.value } : item))} />
                          <Textarea className="mt-2" value={slide.body} onChange={(event) => patchDraft("carouselSlides", draft.carouselSlides.map((item, itemIndex) => itemIndex === index ? { ...item, body: event.target.value } : item))} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="rounded-xl border bg-muted/20 p-4">
                    <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /><h4 className="font-semibold">Server Quality Gate</h4></div>
                    <div className="mt-4 space-y-2">
                      {draft.quality.dimensions.map((item) => (
                        <div key={item.key} className="rounded-lg border bg-background/60 p-3">
                          <div className="flex items-center justify-between text-sm"><span>{item.label}</span><span className="font-bold">{item.score}/10</span></div>
                          {item.finding && <p className="mt-1 text-xs text-muted-foreground">{item.finding}</p>}
                        </div>
                      ))}
                    </div>
                    {(draft.quality.blockers.length > 0 || draft.quality.warnings.length > 0) && (
                      <div className={`mt-4 rounded-lg border p-3 text-xs ${gateClass(draft.quality.gate)}`}>
                        {(draft.quality.blockers.length ? draft.quality.blockers : draft.quality.warnings).map((item) => <div key={item} className="flex gap-2 py-1"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{item}</div>)}
                      </div>
                    )}
                    <Button className="mt-4 w-full" variant="outline" disabled={evaluate.isPending} onClick={() => evaluate.mutate(draft)}>
                      {evaluate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />} Re-score edited draft
                    </Button>
                  </div>

                  <div className="rounded-xl border bg-muted/20 p-4">
                    <div className="flex items-center gap-2"><ImageIcon className="h-5 w-5 text-primary" /><h4 className="font-semibold">Rendered Media</h4></div>
                    {draft.imageUrls.length ? (
                      <div className={`mt-4 grid gap-3 ${draft.imageUrls.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                        {draft.imageUrls.map((url, index) => <img key={url} src={url} alt={`Rendered asset ${index + 1}`} className={`w-full rounded-lg border object-cover ${draft.format === "story" ? "aspect-[9/16]" : "aspect-[4/5]"}`} />)}
                      </div>
                    ) : <div className="mt-4 rounded-lg border border-dashed p-8 text-center text-xs text-muted-foreground">No asset rendered yet. Visual copy stays bounded so it cannot overlap or turn into garbled AI text.</div>}
                    <Button className="mt-4 w-full" disabled={render.isPending || draft.quality.gate === "block"} onClick={() => render.mutate(draft)}>
                      {render.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                      {draft.imageUrls.length ? "Re-render assets" : "Render clean assets"}
                    </Button>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="flex flex-col gap-3 border-t bg-muted/10 sm:flex-row sm:justify-between">
                <Button variant="outline" onClick={() => { setDraft(null); }}><RefreshCw className="mr-2 h-4 w-4" /> Start another concept</Button>
                <Button disabled={stage.isPending || draft.quality.gate === "block" || draft.imageUrls.length === 0} onClick={() => stage.mutate(draft)}>
                  {stage.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Send to review queue <ChevronRight className="ml-2 h-4 w-4" />
                </Button>
              </CardFooter>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
