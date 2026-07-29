import { useState } from "react";
import { AlertTriangle, FlaskConical, Loader2, Save, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  PATTERN_CAPTION_HIERARCHIES,
  PATTERN_DO_NOT_COPY,
  PATTERN_HOOK_TYPES,
  PATTERN_LOOP_TYPES,
  formatPatternAdaptation,
  type ReelPattern,
} from "../../../../shared/reelPatterns";
import { writeCreateHandoff, type IgView } from "./igViews";

/**
 * Pattern Lab — winning short-form STRUCTURES captured as data, never content.
 * Manual capture by design (no scraping, no URL fetching): the operator
 * watches a reference, records its mechanics, writes the Nick's-truth
 * adaptation, and "Adapt into Create" rides the existing handoff contract
 * into the same generation machinery every other source uses.
 */

const EMPTY_FORM = {
  label: "",
  sourceLabel: "",
  sourceUrl: "",
  hookType: "impossible_object" as ReelPattern["hookType"],
  totalSeconds: "18",
  beatCount: "5",
  avgShotLength: "3.5",
  firstTextAtSecond: "1",
  lens: "",
  lighting: "",
  color: "",
  motion: "",
  texture: "",
  wordsPerBeat: "6",
  placement: "upper third, clear of IG buttons",
  hierarchy: "headline_only" as ReelPattern["captionStyle"]["hierarchy"],
  musicMood: "",
  voiceover: false,
  sfx: "",
  loopType: "cause_loop" as ReelPattern["loopType"],
  shareTrigger: "",
  saveTrigger: "",
  nickAdaptation: "",
};

export default function PatternLab({ onNavigate }: { onNavigate?: (view: IgView) => void }) {
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const set = (key: keyof typeof EMPTY_FORM, value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }));

  const utils = trpc.useUtils();
  const list = trpc.instagramAdmin.listReelPatterns.useQuery();
  const save = trpc.instagramAdmin.saveReelPattern.useMutation({
    onSuccess: () => {
      toast.success("Pattern saved");
      setForm({ ...EMPTY_FORM });
      utils.instagramAdmin.listReelPatterns.invalidate();
    },
    onError: (err) => toast.error("Not saved", { description: err.message }),
  });
  const del = trpc.instagramAdmin.deleteReelPattern.useMutation({
    onSuccess: () => {
      toast.success("Pattern deleted");
      utils.instagramAdmin.listReelPatterns.invalidate();
    },
    onError: (err) => toast.error("Not deleted", { description: err.message }),
  });
  const recordUse = trpc.instagramAdmin.recordPatternUse.useMutation();

  const num = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };

  const handleSave = () => {
    save.mutate({
      label: form.label.trim(),
      sourceLabel: form.sourceLabel.trim() || undefined,
      sourceUrl: form.sourceUrl.trim() || undefined,
      hookType: form.hookType,
      pacing: {
        totalSeconds: num(form.totalSeconds),
        beatCount: num(form.beatCount),
        avgShotLength: num(form.avgShotLength),
        firstTextAtSecond: num(form.firstTextAtSecond),
      },
      visualStyle: {
        lens: form.lens.trim(),
        lighting: form.lighting.trim(),
        color: form.color.trim(),
        motion: form.motion.trim(),
        texture: form.texture.trim(),
      },
      captionStyle: {
        wordsPerBeat: num(form.wordsPerBeat),
        placement: form.placement.trim(),
        hierarchy: form.hierarchy,
      },
      audioStyle: {
        musicMood: form.musicMood.trim(),
        voiceover: form.voiceover,
        sfx: form.sfx.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 6),
      },
      loopType: form.loopType,
      shareTrigger: form.shareTrigger.trim(),
      saveTrigger: form.saveTrigger.trim(),
      nickAdaptation: form.nickAdaptation.trim(),
    });
  };

  const adapt = (pattern: ReelPattern, id: string) => {
    // Use is recorded best-effort BEFORE navigation — the durable trail feeds
    // the future pattern×outcome memory; a failed increment must not block
    // the handoff itself.
    recordUse.mutate({ id });
    writeCreateHandoff({
      sourceType: "manual_idea",
      detail: formatPatternAdaptation(pattern),
      objective: "engagement",
    });
    onNavigate?.("create");
  };

  const label = (text: string) => (
    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{text}</span>
  );

  return (
    <div className="space-y-6 pb-12">
      <div>
        <h3 className="flex items-center gap-2 text-xl font-medium"><FlaskConical className="h-5 w-5" /> Pattern Lab</h3>
        <p className="text-sm text-muted-foreground">
          Capture the STRUCTURE of a winning reel — hook, pacing, captions, loop — then adapt it into a Nick's-truth concept.
          Never copied: {PATTERN_DO_NOT_COPY.join(" · ")}.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Capture a reference pattern</CardTitle>
          <CardDescription>Manual by design — describe what you SAW; the system never fetches or scrapes the reference.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">{label("Pattern name")}<Input value={form.label} onChange={(e) => set("label", e.target.value)} placeholder='e.g. "Gremlin cause-loop, 18s"' /></div>
            <div className="space-y-1">{label("Seen at (citation only)")}<Input value={form.sourceLabel} onChange={(e) => set("sourceLabel", e.target.value)} placeholder="creator / where you saw it" /></div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              {label("Hook type")}
              <div className="flex flex-wrap gap-1.5">
                {PATTERN_HOOK_TYPES.map((h) => (
                  <button key={h} type="button" onClick={() => set("hookType", h)}
                    className={`min-h-11 rounded border px-2 text-xs transition ${form.hookType === h ? "border-primary bg-primary/10" : "border-border/70 text-muted-foreground hover:border-primary/40"}`}>
                    {h.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              {label("Loop type")}
              <div className="flex flex-wrap gap-1.5">
                {PATTERN_LOOP_TYPES.map((l) => (
                  <button key={l} type="button" onClick={() => set("loopType", l)}
                    className={`min-h-11 rounded border px-2 text-xs transition ${form.loopType === l ? "border-primary bg-primary/10" : "border-border/70 text-muted-foreground hover:border-primary/40"}`}>
                    {l.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="space-y-1">{label("Total seconds")}<Input inputMode="decimal" value={form.totalSeconds} onChange={(e) => set("totalSeconds", e.target.value)} /></div>
            <div className="space-y-1">{label("Beats")}<Input inputMode="numeric" value={form.beatCount} onChange={(e) => set("beatCount", e.target.value)} /></div>
            <div className="space-y-1">{label("Avg shot (s)")}<Input inputMode="decimal" value={form.avgShotLength} onChange={(e) => set("avgShotLength", e.target.value)} /></div>
            <div className="space-y-1">{label("First text @s")}<Input inputMode="decimal" value={form.firstTextAtSecond} onChange={(e) => set("firstTextAtSecond", e.target.value)} /></div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <div className="space-y-1">{label("Lens")}<Input value={form.lens} onChange={(e) => set("lens", e.target.value)} placeholder="macro / wide…" /></div>
            <div className="space-y-1">{label("Lighting")}<Input value={form.lighting} onChange={(e) => set("lighting", e.target.value)} placeholder="dark shop, gold…" /></div>
            <div className="space-y-1">{label("Color")}<Input value={form.color} onChange={(e) => set("color", e.target.value)} placeholder="amber on black…" /></div>
            <div className="space-y-1">{label("Motion")}<Input value={form.motion} onChange={(e) => set("motion", e.target.value)} placeholder="slow push-in…" /></div>
            <div className="space-y-1">{label("Texture")}<Input value={form.texture} onChange={(e) => set("texture", e.target.value)} placeholder="tactile, real…" /></div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="space-y-1">{label("Words per beat")}<Input inputMode="numeric" value={form.wordsPerBeat} onChange={(e) => set("wordsPerBeat", e.target.value)} /></div>
            <div className="space-y-1">{label("Caption placement")}<Input value={form.placement} onChange={(e) => set("placement", e.target.value)} /></div>
            <div className="space-y-1">
              {label("Hierarchy")}
              <div className="flex flex-wrap gap-1.5">
                {PATTERN_CAPTION_HIERARCHIES.map((h) => (
                  <button key={h} type="button" onClick={() => set("hierarchy", h)}
                    className={`min-h-11 rounded border px-2 text-xs transition ${form.hierarchy === h ? "border-primary bg-primary/10" : "border-border/70 text-muted-foreground hover:border-primary/40"}`}>
                    {h.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              {label("Voiceover?")}
              <button type="button" onClick={() => set("voiceover", !form.voiceover)}
                className={`min-h-11 w-full rounded border px-2 text-xs transition ${form.voiceover ? "border-primary bg-primary/10" : "border-border/70 text-muted-foreground"}`}>
                {form.voiceover ? "Yes — close, dry VO" : "No — captions carry it"}
              </button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">{label("Music mood")}<Input value={form.musicMood} onChange={(e) => set("musicMood", e.target.value)} placeholder="tense build / calm confident…" /></div>
            <div className="space-y-1">{label("SFX (comma-separated, max 6)")}<Input value={form.sfx} onChange={(e) => set("sfx", e.target.value)} placeholder="metal clink, air hiss" /></div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">{label("Share trigger — who sends this to whom?")}<Textarea value={form.shareTrigger} onChange={(e) => set("shareTrigger", e.target.value)} className="min-h-16" placeholder='"Send this to someone whose car pulls left"' /></div>
            <div className="space-y-1">{label("Save trigger — why keep it?")}<Textarea value={form.saveTrigger} onChange={(e) => set("saveTrigger", e.target.value)} className="min-h-16" placeholder="one reusable mechanic truth worth remembering" /></div>
          </div>

          <div className="space-y-1">
            {label("Nick adaptation (required) — the Nick's-truth version of this idea")}
            <Textarea value={form.nickAdaptation} onChange={(e) => set("nickAdaptation", e.target.value)} className="min-h-20"
              placeholder="e.g. Pothole gremlin steals a wheel weight; alignment lines bend; 'THE TIRE GETS BLAMED / BUT THE ALIGNMENT MOVED'; gremlin waits again (loop)." />
          </div>

          <Button className="min-h-11" disabled={save.isPending} onClick={handleSave}>
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save pattern
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold">Captured patterns</h4>
        {list.isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : list.isError ? (
          <Card className="border-amber-500/40 bg-amber-500/5">
            <CardContent className="flex items-start gap-2 p-4 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <span>Could not read the pattern store — this is <strong>unknown</strong>, not empty. {list.error?.message}</span>
            </CardContent>
          </Card>
        ) : (list.data?.length ?? 0) === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No patterns yet. Watch a winning reel, capture its structure above, and write the Nick version.
          </p>
        ) : (
          list.data!.map((row) => (
            <Card key={row.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{row.label}</span>
                  <Badge variant="outline">{row.hookType.replace(/_/g, " ")}</Badge>
                  <Badge variant="outline">{row.loopType.replace(/_/g, " ")}</Badge>
                  {row.timesUsed > 0 && <Badge variant="outline">used ×{row.timesUsed}</Badge>}
                </div>
                <p className="whitespace-pre-wrap rounded border bg-muted/10 p-2 text-xs leading-5 text-muted-foreground">
                  {formatPatternAdaptation(row.pattern as ReelPattern)}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" className="min-h-11" onClick={() => adapt(row.pattern as ReelPattern, row.id)}>
                    <Send className="mr-1.5 h-4 w-4" /> Adapt into Create
                  </Button>
                  {confirmDeleteId === row.id ? (
                    <>
                      <Button size="sm" variant="destructive" className="min-h-11" disabled={del.isPending}
                        onClick={() => { del.mutate({ id: row.id }); setConfirmDeleteId(null); }}>
                        Really delete
                      </Button>
                      <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setConfirmDeleteId(null)}>Keep it</Button>
                    </>
                  ) : (
                    <Button size="sm" variant="outline" className="min-h-11 text-destructive"
                      onClick={() => setConfirmDeleteId(row.id)}>
                      <Trash2 className="mr-1.5 h-4 w-4" /> Delete
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
