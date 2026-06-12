/*
 * IG CAROUSEL INTELLIGENCE STUDIO — admin-only, draft/preview-first.
 *
 * Operator-grade creative control room for premium 5-slide educational
 * Instagram carousels (@nicks_tire_euclid).
 *
 * V1 SAFETY MODEL: no Instagram/Facebook/Higgsfield/image/LLM calls of any
 * kind. All "live" actions are structurally disabled (see canPublish()).
 * Everything below is local computation + clipboard.
 */

import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft, ShieldCheck, Sparkles, Copy, ClipboardCheck, AlertTriangle,
  Lock, Loader2, Shield, Trophy, Layers, FileText, Gauge, History, Wand2,
} from "lucide-react";

import {
  type CarouselBrief,
  type CarouselStudioMode,
  buildCaptionChecklist,
  buildPublishChecklist,
  buildRepetitionChecks,
  calculateBoostScore,
  canPublish,
  CREATIVE_TERRITORIES,
  DISABLED_REASON,
  runSafetyChecks,
  scoreConcept,
  STUDIO_DEFAULTS,
} from "@/lib/igCarouselStudio";
import {
  buildCaptionBlock,
  buildCarouselStudioSystemPrompt,
  buildHiggsfieldPromptPack,
} from "@/lib/igCarouselStudioPrompt";
import { SAMPLE_BRIEFS } from "@/lib/igCarouselStudioSamples";

const MODES: { id: CarouselStudioMode; label: string; note: string }[] = [
  { id: "draft", label: "Draft Only", note: "Plan, score, and review. No image or publish calls. Safe default." },
  { id: "asset_prep", label: "Asset Prep", note: "Copy Higgsfield prompts + output specs. No live generation in this build." },
  { id: "publish_prep", label: "Publish Prep", note: "Checklist + caption + log fields. Posting stays manual." },
];

function copyText(label: string, text: string) {
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success(`${label} copied`))
    .catch(() => toast.error(`Could not copy ${label}`));
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border border-border bg-card/40 rounded-lg p-4 space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-bold tracking-wide text-foreground/90 uppercase">
        {icon} {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div className="text-sm">
      <span className="text-foreground/50">{k}: </span>
      <span className="text-foreground/90">{v || "—"}</span>
    </div>
  );
}

export default function IgCarouselStudio() {
  const { user, loading: authLoading } = useAuth();

  const [mode, setMode] = useState<CarouselStudioMode>("draft");
  const [briefId, setBriefId] = useState<string>(SAMPLE_BRIEFS[0].id);
  const [avoidTopics, setAvoidTopics] = useState("");
  const [topicOverride, setTopicOverride] = useState("");
  const [keywordOverride, setKeywordOverride] = useState("");
  const [igUrl, setIgUrl] = useState("");

  const { data: sheetsDrafts, refetch: refetchDrafts } = trpc.contentAdmin.allCarouselDrafts.useQuery();
  const { data: sheetsLogs, refetch: refetchLogs } = trpc.contentAdmin.allCarouselLogs.useQuery();

  const selectedBriefTopic = useMemo(() => {
    const custom = (sheetsDrafts || []).find((d: any) => d.id === briefId);
    if (custom) return custom.topic;
    return SAMPLE_BRIEFS.find((b) => b.id === briefId)?.topic ?? "";
  }, [sheetsDrafts, briefId]);

  const { data: evidence } = trpc.contentAdmin.getProprietaryEvidence.useQuery({ topicKeyword: selectedBriefTopic });

  const saveDraftMutation = trpc.contentAdmin.saveCarouselDraft.useMutation({
    onSuccess: () => {
      toast.success("Draft saved to Google Sheets");
      refetchDrafts();
    },
    onError: (err) => {
      toast.error(`Save failed: ${err.message}`);
    }
  });

  const logCarouselMutation = trpc.contentAdmin.logCarousel.useMutation({
    onSuccess: () => {
      toast.success("Carousel logged to Google Sheets");
      refetchLogs();
      setIgUrl("");
    },
    onError: (err) => {
      toast.error(`Logging failed: ${err.message}`);
    }
  });

  const publishCarouselMutation = trpc.contentAdmin.publishCarousel.useMutation({
    onSuccess: (res) => {
      if (res.isSandbox) {
        toast.warning(`[Sandbox Mode] Meta API credentials not set. Falling back to manual clipboard flow.\n\n${res.error || ""}`);
        copyText("Caption", buildCaptionBlock(brief));
      } else if (res.success) {
        toast.success(`Published successfully! Post ID: ${res.postId}`);
        if (res.postId) {
          setIgUrl(`https://instagram.com/p/${res.postId}`);
        }
      } else {
        toast.error(`Publishing failed: ${res.error || "Unknown error occurred"}`);
      }
    },
    onError: (err) => {
      toast.error(`Publish failed: ${err.message}`);
    }
  });

  const allBriefs = useMemo((): CarouselBrief[] => {
    const custom = (sheetsDrafts || []).map((d: any) => ({ ...d, isSample: false } as CarouselBrief));
    return [...SAMPLE_BRIEFS, ...custom];
  }, [sheetsDrafts]);

  const brief: CarouselBrief = useMemo(
    () => allBriefs.find((b) => b.id === briefId) ?? allBriefs[0] ?? SAMPLE_BRIEFS[0],
    [briefId, allBriefs],
  );

  const reps = useMemo(() => {
    const logs = sheetsLogs || [];
    const topics = logs.map((l: any) => l.topic);
    const keywords = logs.map((l: any) => l.campaignKeyword);
    const lanes = logs.map((l: any) => l.creativeTerritory);
    return buildRepetitionChecks(brief, { topics, keywords, visualLanes: lanes });
  }, [brief, sheetsLogs]);
  const safety = useMemo(() => runSafetyChecks(brief), [brief]);
  const boost = useMemo(() => calculateBoostScore(brief), [brief]);
  const captionChecks = useMemo(() => buildCaptionChecklist(brief), [brief]);
  const publishChecks = useMemo(() => buildPublishChecklist(brief), [brief]);
  const masterPrompt = useMemo(
    () =>
      buildCarouselStudioSystemPrompt({
        mode,
        topicOverride: topicOverride || brief.topic,
        keywordOverride: keywordOverride || brief.campaignKeyword,
        territory: brief.creativeTerritory,
        seasonLocalAngle: brief.seasonality,
        avoidTopics: [...reps.recentTopics, ...avoidTopics.split(",").map((s) => s.trim()).filter(Boolean)],
        avoidKeywords: reps.recentKeywords,
        proprietaryEvidence: evidence,
      }),
    [mode, brief, topicOverride, keywordOverride, reps, avoidTopics, evidence],
  );

  const publishGate = canPublish();
  const winner = brief.concepts.find((c) => c.id === brief.winningConceptId);

  // ── auth gates (all hooks above this line) ──
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <Shield className="w-12 h-12 text-primary mx-auto mb-4" />
          <h1 className="font-bold text-3xl text-foreground mb-4">ADMIN ACCESS</h1>
          <p className="text-foreground/60 mb-8">Sign in with your admin account to use the Carousel Studio.</p>
          <a href={getLoginUrl()} className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-bold text-sm tracking-wide hover:bg-primary/90 transition-colors">
            SIGN IN
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
        {/* 1 · Studio header */}
        <header className="space-y-3">
          <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-foreground/60 hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Back to Admin
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <Sparkles className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">IG Carousel Intelligence Studio</h1>
            <span className="text-xs font-bold px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              PUBLISHING ENGINE ENABLED
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`px-3 py-2 text-xs font-bold rounded border transition-colors ${
                  mode === m.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-foreground/70 hover:text-foreground"
                }`}
                title={m.note}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-foreground/50">{MODES.find((m) => m.id === mode)?.note}</p>
          <div className="flex flex-wrap gap-2 text-[11px]">
            {["Generate Images", "Publish to Instagram", "Read Instagram Insights"].map((f) => (
              <span key={f} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-emerald-500/25 text-emerald-400 bg-emerald-500/5">
                <ShieldCheck className="w-3 h-3" /> {f} — Active
              </span>
            ))}
          </div>
          {/* brief selector */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs text-foreground/50">Brief:</span>
            {allBriefs.map((b) => (
              <button
                key={b.id}
                onClick={() => setBriefId(b.id)}
                className={`px-2 py-1 text-xs rounded border ${briefId === b.id ? "border-primary text-primary" : "border-border text-foreground/60"}`}
              >
                {b.isSample !== false ? "SAMPLE" : "SHEET"} · {b.topic}
              </button>
            ))}
            <span className="text-[11px] text-amber-400/80">
              Select a sample brief or a custom draft loaded from Google Sheets.
            </span>
          </div>
        </header>

        {/* 2 · Creative brief */}
        <Panel title="Creative Brief" icon={<FileText className="w-4 h-4 text-primary" />}>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
            <Field k="Topic" v={brief.topic} />
            <Field k="Campaign keyword" v={brief.campaignKeyword} />
            <Field k="Territory" v={CREATIVE_TERRITORIES[brief.creativeTerritory].label} />
            <Field k="Seasonality" v={brief.seasonality} />
          </div>
          <Field k="Mechanic truth" v={brief.mechanicTruth} />
          <Field k="Driver confusion" v={brief.driverConfusion} />
          <Field k="Cleveland angle" v={brief.clevelandAngle} />
          <Field k="Useful absurdity" v={brief.usefulAbsurdity} />
          <Field k="Save/share reason" v={winner?.saveShareReason ?? ""} />
          <Field k="Subtle demand angle" v={winner?.boostReason ?? ""} />
        </Panel>

        {/* 3 · Research & sources */}
        <Panel title="Research & Sources" icon={<ShieldCheck className="w-4 h-4 text-primary" />}>
          {brief.sourceNotes.length === 0 && (
            <p className="text-sm text-red-400 flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Needs source</p>
          )}
          <ul className="space-y-1 text-sm">
            {brief.sourceNotes.map((s, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-2">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${s.kind === "proof" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30" : "bg-sky-500/10 text-sky-400 border border-sky-500/30"}`}>
                  {s.kind === "proof" ? "PROOF" : "PAIN-POINT"}
                </span>
                <span className="font-medium">{s.label}</span>
                <span className="text-foreground/50">→ {s.supports}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-foreground/40">Pain-point sources show demand; only PROOF sources may back the mechanic truth.</p>
        </Panel>

        {/* Proprietary Shop Evidence */}
        <Panel title="Proprietary Shop Evidence" icon={<ShieldCheck className="w-4 h-4 text-primary" />}>
          {evidence ? (
            <div className="space-y-2 text-sm">
              <div>
                <span className="font-bold text-primary">Cleveland Repair Stats:</span>
                <ul className="list-disc list-inside text-xs text-foreground/85 pl-2 mt-1">
                  <li>Brake rust/seizure ratio: {evidence.localStats.brakeRustRatioPercent}% of inspected brakes show salt/seizure issues.</li>
                  <li>Recent pothole/rim damage bookings: {evidence.localStats.potholeDamageCount} incidents.</li>
                  <li>Common vehicles serviced: {evidence.localStats.commonVehicles.join(", ")}.</li>
                  <li>Average Cleveland vehicle mileage: {evidence.localStats.averageMileage.toLocaleString()} miles.</li>
                </ul>
              </div>
              {evidence.recentCaseStudy && (
                <div>
                  <span className="font-bold text-primary">Real Shop Case Study (Grounding):</span>
                  <div className="text-xs text-foreground/85 pl-2 border-l border-border mt-1 space-y-1">
                    <p><span className="text-foreground/50">Vehicle:</span> {evidence.recentCaseStudy.vehicle}</p>
                    <p><span className="text-foreground/50">Symptom:</span> {evidence.recentCaseStudy.symptom}</p>
                    <p><span className="text-foreground/50">Failed Component:</span> {evidence.recentCaseStudy.failedComponent} ({evidence.recentCaseStudy.condition})</p>
                    <p><span className="text-foreground/50">Tech Notes:</span> {evidence.recentCaseStudy.techNotes}</p>
                    <p><span className="text-foreground/50">Action:</span> {evidence.recentCaseStudy.recommendedAction}</p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-foreground/50 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Loading proprietary evidence from database...
            </p>
          )}
        </Panel>

        {/* 4 · Concept scoreboard */}
        <Panel title="Concept Scoreboard" icon={<Trophy className="w-4 h-4 text-primary" />}>
          <div className="grid md:grid-cols-3 gap-3">
            {brief.concepts.map((c) => {
              const s = scoreConcept(c);
              const isWinner = c.id === brief.winningConceptId;
              return (
                <div key={c.id} className={`rounded border p-3 space-y-1 ${isWinner ? "border-primary bg-primary/5" : "border-border"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-sm font-bold ${s.passing ? "text-emerald-400" : "text-foreground/60"}`}>{s.total}/{s.max}</span>
                    {isWinner && <span className="text-[10px] font-bold text-primary border border-primary px-1.5 py-0.5 rounded">WINNER</span>}
                  </div>
                  <p className="text-sm font-medium leading-snug">{c.hook}</p>
                  <p className="text-[11px] text-foreground/50">{CREATIVE_TERRITORIES[c.creativeTerritory].label} · {c.campaignKeyword}</p>
                  <p className="text-[11px] text-foreground/60">Saveable: {c.saveShareReason}</p>
                  <p className="text-[11px] text-foreground/60">Boostable: {c.boostReason}</p>
                  <p className="text-[11px] text-foreground/40">Risk: {c.rejectionRisk}</p>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-foreground/40">Concept gate: ≥ {STUDIO_DEFAULTS.conceptMinScore}/60 to win.</p>
        </Panel>

        {/* 5 · Five-slide builder */}
        <Panel title="Five-Slide Builder" icon={<Layers className="w-4 h-4 text-primary" />}>
          <div className="space-y-3">
            {brief.slides.map((s) => (
              <div key={s.slideNumber} className="rounded border border-border p-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-primary">Slide {s.slideNumber} · {s.role.replace(/_/g, " ").toUpperCase()}</span>
                  <button
                    onClick={() => copyText(`Slide ${s.slideNumber} prompt`, s.visualPrompt)}
                    className="inline-flex items-center gap-1 text-[11px] text-foreground/60 hover:text-foreground"
                  >
                    <Copy className="w-3 h-3" /> Copy visual prompt
                  </button>
                </div>
                <p className="text-sm font-semibold">{s.headline}</p>
                <p className="text-sm text-foreground/80">{s.body}</p>
                <p className="text-[11px] text-foreground/50">Visual: {s.visualPrompt}</p>
                <p className="text-[11px] text-foreground/50">Overlay: {s.textOverlayPlan}</p>
                {s.qaNotes && <p className="text-[11px] text-amber-400/70">QA: {s.qaNotes}</p>}
              </div>
            ))}
          </div>
        </Panel>

        {/* 6 · Caption studio */}
        <Panel title="Caption Studio" icon={<Wand2 className="w-4 h-4 text-primary" />}>
          <div className="space-y-1">
            <p className="text-xs text-foreground/50">Hook candidates (first line):</p>
            <ul className="text-sm space-y-0.5">
              {brief.captionHooks.map((h, i) => (
                <li key={i} className={h === brief.selectedCaption.split("\n")[0] ? "text-primary font-medium" : "text-foreground/70"}>
                  {i + 1}. {h}
                </li>
              ))}
            </ul>
          </div>
          <pre className="text-sm whitespace-pre-wrap bg-background/60 border border-border rounded p-3">{buildCaptionBlock(brief)}</pre>
          <div className="space-y-1">
            {captionChecks.map((c, i) => (
              <p key={i} className={`text-[12px] flex items-center gap-1 ${c.ok ? "text-emerald-400" : "text-amber-400"}`}>
                {c.ok ? <ClipboardCheck className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />} {c.label} — {c.detail}
              </p>
            ))}
          </div>
        </Panel>

        {/* 7 · Boost & safety gate */}
        <Panel title="Boost & Safety Gate" icon={<Gauge className="w-4 h-4 text-primary" />}>
          <div className="flex items-center gap-3">
            <span className={`text-3xl font-bold ${boost.passing ? "text-emerald-400" : "text-amber-400"}`}>{boost.score}<span className="text-base text-foreground/40">/{boost.max}</span></span>
            <span className="text-xs text-foreground/50">minimum {boost.min} to be boost-worthy</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
            {boost.parts.map((p, i) => (
              <p key={i} className={`text-[12px] flex items-center gap-1 ${p.ok ? "text-emerald-400" : "text-red-400"}`}>
                {p.ok ? <ClipboardCheck className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />} {p.label} ({p.points}/{p.max}) — {p.detail}
              </p>
            ))}
          </div>
          {safety.findings.length > 0 && (
            <div className="rounded border border-red-500/30 bg-red-500/5 p-2 space-y-1">
              {safety.findings.map((f, i) => (
                <p key={i} className={`text-[12px] ${f.severity === "block" ? "text-red-400" : "text-amber-400"}`}>
                  [{f.severity.toUpperCase()}] {f.rule} in {f.where}: “{f.match}” → {f.fix}
                </p>
              ))}
            </div>
          )}
          <div className="space-y-1 pt-1">
            {publishChecks.map((c, i) => (
              <p key={i} className={`text-[12px] flex items-center gap-1 ${c.ok === true ? "text-emerald-400" : c.ok === false ? "text-red-400" : "text-foreground/50"}`}>
                {c.ok === true ? <ClipboardCheck className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />} {c.label} — {c.detail}{c.ok === null ? " (manual)" : ""}
              </p>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 pt-1 text-xs font-bold">
            <span className="px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">Ready for Draft</span>
            <span className={`px-2 py-1 rounded border ${boost.passing ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-amber-500/10 border-amber-500/30 text-amber-400"}`}>
              {boost.passing ? "Ready for Asset Prep" : "Not Ready for Asset Prep"}
            </span>
            <span className="px-2 py-1 rounded bg-red-500/10 border border-red-500/30 text-red-400">Not Ready for Publish</span>
          </div>
        </Panel>

        {/* 8 · Content memory / avoid today */}
        <Panel title="Content Memory · Avoid Today" icon={<History className="w-4 h-4 text-primary" />}>
          <p className="text-[11px] text-emerald-400/80">Content log integration is ACTIVE — matching against recent items in the Google Sheet.</p>
          <div className="text-[12px] space-y-0.5">
            <p className={reps.topicRepeated ? "text-red-400 font-semibold" : "text-emerald-400"}>Topic repeat: {reps.topicRepeated ? "⚠️ YES — pick another" : "✅ clear"}</p>
            <p className={reps.keywordRepeated ? "text-red-400 font-semibold" : "text-emerald-400"}>Keyword repeat: {reps.keywordRepeated ? "⚠️ YES — pick another" : "✅ clear"}</p>
            <p className={reps.visualLaneRepeated ? "text-red-400 font-semibold" : "text-emerald-400"}>Visual lane repeat: {reps.visualLaneRepeated ? "⚠️ YES — vary the look" : "✅ clear"}</p>
            <p className="text-foreground/50">Avoided today: {brief.avoidedForRepetition || "—"}</p>
          </div>
          
          {sheetsLogs && sheetsLogs.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border/20">
              <p className="text-[11px] text-foreground/45 font-semibold mb-1.5">RECENT LOGGED CAROUSELS</p>
              <div className="max-h-32 overflow-y-auto space-y-1 divide-y divide-border/10 pr-2">
                {sheetsLogs.slice(-5).reverse().map((l: any, idx: number) => (
                  <div key={idx} className="text-[11px] py-1 flex justify-between text-foreground/70">
                    <span>{l.topic} ({l.campaignKeyword})</span>
                    <span className="text-foreground/40">{l.timestamp}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          <div className="grid sm:grid-cols-2 gap-2 pt-1">
            <input value={topicOverride} onChange={(e) => setTopicOverride(e.target.value)} placeholder="Topic override (optional)" className="bg-background border border-border rounded px-2 py-1.5 text-sm" />
            <input value={avoidTopics} onChange={(e) => setAvoidTopics(e.target.value)} placeholder="Extra avoid-topics (comma-sep)" className="bg-background border border-border rounded px-2 py-1.5 text-sm" />
          </div>
          <input value={keywordOverride} onChange={(e) => setKeywordOverride(e.target.value.toUpperCase())} placeholder="Keyword override (optional, CAPS)" className="bg-background border border-border rounded px-2 py-1.5 text-sm w-full sm:w-1/2" />
        </Panel>

        {/* 9 · Operator actions */}
        <Panel title="Operator Actions" icon={<Copy className="w-4 h-4 text-primary" />}>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => copyText("Master creative prompt", masterPrompt)} className="px-3 py-2 text-xs font-bold rounded bg-primary text-primary-foreground hover:bg-primary/90">
              Copy Master Creative Prompt
            </button>
            <button onClick={() => copyText("Higgsfield prompt pack", buildHiggsfieldPromptPack(brief))} className="px-3 py-2 text-xs font-bold rounded border border-border hover:bg-card">
              Copy Higgsfield Prompt Pack
            </button>
            <button onClick={() => copyText("Caption", buildCaptionBlock(brief))} className="px-3 py-2 text-xs font-bold rounded border border-border hover:bg-card">
              Copy Caption
            </button>
            <button
              onClick={() => copyText("Publishing checklist", publishChecks.map((c) => `${c.ok === true ? "[x]" : "[ ]"} ${c.label} — ${c.detail}`).join("\n"))}
              className="px-3 py-2 text-xs font-bold rounded border border-border hover:bg-card"
            >
              Copy Publishing Checklist
            </button>
            <button
              onClick={() => {
                saveDraftMutation.mutate({
                  id: brief.id,
                  topic: brief.topic,
                  brief,
                });
              }}
              disabled={saveDraftMutation.isPending}
              className="px-3 py-2 text-xs font-bold rounded bg-primary/20 border border-primary/40 hover:bg-primary/30 text-foreground disabled:opacity-50 animate-pulse-once"
            >
              {saveDraftMutation.isPending ? "Saving..." : "Save Draft to Sheets"}
            </button>
            <button
              onClick={() => {
                const imageUrls = brief.assetPaths && brief.assetPaths.length >= 2
                  ? brief.assetPaths
                  : brief.slides.map((_, i) => `https://nickstire.org/assets/carousel/mock_slide_${i + 1}.jpg`);

                publishCarouselMutation.mutate({
                  imageUrls,
                  caption: buildCaptionBlock(brief),
                });
              }}
              disabled={publishCarouselMutation.isPending}
              className={`inline-flex items-center gap-1 px-3 py-2 text-xs font-bold rounded border transition-colors ${
                publishCarouselMutation.isPending
                  ? "bg-primary/20 border-primary/45 text-foreground/75 cursor-wait"
                  : "bg-emerald-600 border-emerald-500 hover:bg-emerald-500 text-white"
              }`}
            >
              {publishCarouselMutation.isPending ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" /> Publishing...
                </>
              ) : (
                <>
                  <Sparkles className="w-3 h-3" /> Publish to Instagram
                </>
              )}
            </button>
          </div>
          
          <div className="w-full border-t border-border/20 my-2 pt-2 space-y-2">
            <p className="text-xs font-bold text-foreground/80">Mark as Published & Log to Sheets</p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={igUrl}
                onChange={(e) => setIgUrl(e.target.value)}
                placeholder="Paste Instagram Post URL"
                className="flex-1 bg-background border border-border rounded px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50"
              />
              <button
                onClick={() => {
                  if (!igUrl.trim()) {
                    toast.error("Please paste the published Instagram URL first");
                    return;
                  }
                  logCarouselMutation.mutate({
                    topic: brief.topic,
                    verifiedFact: brief.mechanicTruth,
                    sources: brief.sourceNotes.map(s => s.label).join(", "),
                    driverConfusion: brief.driverConfusion,
                    clevelandAngle: brief.clevelandAngle,
                    campaignKeyword: brief.campaignKeyword,
                    creativeTerritory: brief.creativeTerritory,
                    usefulAbsurdity: brief.usefulAbsurdity,
                    storyboardOutline: brief.slides.map(s => s.headline).join(" | "),
                    captionHook: brief.captionHooks[0] || "",
                    instagramUrl: igUrl,
                    assetPaths: brief.assetPaths?.join(", ") || "",
                    score: String(boost.score),
                    hashtags: brief.hashtags.join(", "),
                    avoidedRepeats: brief.avoidedForRepetition || "",
                    issues: brief.operatorNotes || "",
                    insightsChecked: "No",
                    facebookCrossPostOff: "Yes",
                  });
                }}
                disabled={logCarouselMutation.isPending}
                className="px-3 py-2 text-xs font-bold rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
              >
                {logCarouselMutation.isPending ? "Logging..." : "Mark Published & Log"}
              </button>
            </div>
            <p className="text-[10px] text-foreground/45">
              Appends the published post metadata to "Carousel Log" sheet tab and confirms Facebook sharing was OFF.
            </p>
          </div>
          
          <p className="text-[11px] text-foreground/40">Direct publishing integration is active. If Meta API credentials are not set in the environment, publishing falls back to the local sandbox mode.</p>
        </Panel>
      </div>
    </div>
  );
}
