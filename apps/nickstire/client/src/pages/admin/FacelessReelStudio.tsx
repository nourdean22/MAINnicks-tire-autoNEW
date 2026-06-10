/**
 * Faceless Reel Intelligence Studio — admin-only planning surface.
 *
 * Preview-first, draft-first, source-grounded, safety-gated. V1 makes ZERO
 * external calls: no Instagram/Facebook posting, no Higgsfield, no ffmpeg
 * execution, no LLM calls. The Studio renders briefs, scores them against
 * the 75-point score gate, and produces copy-paste production packs.
 *
 * NOT yet wired into App.tsx / shared/routes.ts / admin nav — those files are
 * being edited by the IG Carousel Studio session and PRs #47/#49. Wiring is
 * a deliberate follow-up (see docs/faceless-reel-intelligence-studio.md).
 */
import { useMemo, useState } from "react";
import {
  SAMPLE_REEL_BRIEFS,
} from "@/lib/facelessReelStudioSamples";
import {
  STUDIO_BRAND,
  DISABLED_REASON,
  FACT_BUCKETS,
  REEL_ARCHETYPES,
  MOTION_LENSES,
  OBJECT_CHARACTERS,
  buildHiggsfieldReelPromptPack,
  buildFfmpegChecklist,
  buildInstagramPublishChecklist,
  buildArchiveChecklist,
  calculateReelQualityScore,
  runSafetyChecks,
  scoreReelConcept,
  canPublish,
  canGenerateVideo,
  canAssembleMp4,
  canReadInsights,
  type ReelBrief,
  type ReelStudioMode,
  type ChecklistItem,
} from "@/lib/facelessReelStudio";
import { buildFacelessReelSystemPrompt } from "@/lib/facelessReelStudioPrompt";

const MODE_LABELS: Record<ReelStudioMode, string> = {
  draft: "Draft Only",
  asset_prep: "Asset Prep",
  publish_prep: "Publish Prep",
};

function formatStoryboard(brief: ReelBrief): string {
  return brief.storyboardBeats
    .map(
      (b) =>
        `BEAT ${b.beatNumber} [${b.startSecond}s-${b.endSecond}s]\nVISUAL: ${b.visual}\nMOTION: ${b.motion}\nTEXT: ${b.onScreenText}\nPURPOSE: ${b.purpose}\nAUDIO: ${b.audioCue}\nSAFE ZONE: ${b.safeZoneNotes}`,
    )
    .join("\n\n");
}

function formatChecklist(items: ChecklistItem[]): string {
  return items
    .map((i) => `[${i.ok === true ? "x" : i.ok === false ? "BLOCKED" : " "}] ${i.label} — ${i.detail}`)
    .join("\n");
}

function CopyButton({ label, getText, onCopied }: { label: string; getText: () => string; onCopied: (msg: string) => void }) {
  return (
    <button
      type="button"
      className="text-[11px] font-semibold px-2.5 py-1.5 rounded border border-border/40 text-foreground/80 hover:border-primary/60 hover:text-foreground"
      onClick={() => {
        // iOS-PWA-safe: in-DOM feedback only, never window.alert.
        navigator.clipboard
          .writeText(getText())
          .then(() => onCopied(`${label} copied`))
          .catch(() => onCopied("Copy failed — select and copy manually"));
      }}
    >
      {label}
    </button>
  );
}

function DisabledButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      disabled
      title={DISABLED_REASON}
      className="text-[11px] font-semibold px-2.5 py-1.5 rounded border border-border/20 text-foreground/30 cursor-not-allowed"
    >
      {label} · disabled
    </button>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border/30 p-5">
      <h3 className="font-bold text-sm tracking-wide text-foreground mb-3">{title}</h3>
      {children}
    </div>
  );
}

function ChecklistBlock({ items }: { items: ChecklistItem[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((i) => (
        <li key={i.label} className="flex items-start gap-2 text-[12px]">
          <span
            className={`mt-0.5 shrink-0 w-3.5 h-3.5 rounded-sm border text-[9px] leading-3 text-center ${
              i.ok === true
                ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
                : i.ok === false
                  ? "bg-red-500/15 border-red-500/40 text-red-400"
                  : "border-border/40 text-foreground/30"
            }`}
          >
            {i.ok === true ? "ok" : i.ok === false ? "!" : ""}
          </span>
          <span className="text-foreground/80">{i.label}</span>
          <span className="ml-auto text-foreground/45 text-right">{i.detail}</span>
        </li>
      ))}
    </ul>
  );
}

export default function FacelessReelStudio() {
  const [briefIndex, setBriefIndex] = useState(0);
  const [mode, setMode] = useState<ReelStudioMode>("draft");
  const [toast, setToast] = useState<string | null>(null);

  const brief = SAMPLE_REEL_BRIEFS[briefIndex];
  const gate = useMemo(() => calculateReelQualityScore(brief), [brief]);
  const safety = useMemo(() => runSafetyChecks(brief), [brief]);
  const promptPack = useMemo(() => buildHiggsfieldReelPromptPack(brief), [brief]);
  const ffmpegItems = useMemo(() => buildFfmpegChecklist(brief), [brief]);
  const publishItems = useMemo(() => buildInstagramPublishChecklist(brief), [brief]);
  const archiveItems = useMemo(() => buildArchiveChecklist(brief), [brief]);
  const winner = brief.concepts.find((c) => c.id === brief.winningConceptId) ?? null;

  const copied = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  };

  const masterPrompt = () =>
    buildFacelessReelSystemPrompt({
      mode,
      factBucket: brief.factBucket,
      archetype: brief.archetype,
      motionLens: brief.motionLens,
      objectCharacter: brief.objectCharacter,
      avoidRecentTopics: brief.avoidedForRepetition ? [brief.avoidedForRepetition] : [],
    });

  return (
    <div className="space-y-4 max-w-5xl">
      {/* 1 · Header */}
      <div className="bg-card border border-border/30 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-bold text-base tracking-wide text-foreground">FACELESS REEL INTELLIGENCE STUDIO</h2>
          <span className="text-[10px] font-semibold tracking-wider px-2 py-0.5 rounded bg-amber-500/10 text-amber-400">
            PREVIEW-FIRST · V1
          </span>
        </div>
        <p className="text-[12px] text-foreground/55 mt-1.5">
          Plan, score, and prep cinematic faceless educational Reels for {STUDIO_BRAND.handle}. No external posting or
          video generation in this PR.
        </p>
        <div className="flex flex-wrap gap-1.5 mt-3">
          {(Object.keys(MODE_LABELS) as ReelStudioMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded border ${
                mode === m
                  ? "border-primary/60 text-foreground bg-primary/10"
                  : "border-border/30 text-foreground/50 hover:text-foreground/80"
              }`}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
          <span className="ml-auto" />
          {SAMPLE_REEL_BRIEFS.map((b, i) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setBriefIndex(i)}
              className={`text-[11px] px-2.5 py-1 rounded border ${
                i === briefIndex ? "border-primary/60 text-foreground bg-primary/10" : "border-border/30 text-foreground/50"
              }`}
            >
              SAMPLE {i + 1} · {b.campaignKeyword}
            </button>
          ))}
        </div>
        {toast && (
          <div className="mt-2 text-[12px] text-emerald-400 border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-1.5 inline-block rounded">
            {toast}
          </div>
        )}
      </div>

      {/* 2 · Reel Brief */}
      <SectionCard title="REEL BRIEF">
        {brief.isSample && (
          <p className="text-[11px] font-semibold text-amber-400 mb-2">
            SAMPLE DATA — seed brief for UI demonstration; nothing here was posted.
          </p>
        )}
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[12px]">
          {(
            [
              ["Topic", brief.topic],
              ["Mechanic truth", brief.mechanicTruth],
              ["Driver confusion", brief.driverConfusion],
              ["Cleveland angle", brief.clevelandAngle],
              ["Fact bucket", FACT_BUCKETS[brief.factBucket].label],
              ["Campaign keyword", brief.campaignKeyword],
              ["Archetype", REEL_ARCHETYPES[brief.archetype].label],
              ["Motion lens", MOTION_LENSES[brief.motionLens].label],
              ["Object character", OBJECT_CHARACTERS[brief.objectCharacter].label],
              ["Useful absurdity", brief.usefulAbsurdity],
              ["Save/share reason", winner?.saveShareReason ?? "—"],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="flex flex-col">
              <dt className="text-foreground/45">{k}</dt>
              <dd className="text-foreground/85">{v}</dd>
            </div>
          ))}
        </dl>
      </SectionCard>

      {/* 3 · Research / Source Notes */}
      <SectionCard title="RESEARCH / SOURCE NOTES">
        <ul className="space-y-2">
          {brief.sourceNotes.map((s) => (
            <li key={s.label} className="text-[12px] flex items-start gap-2">
              <span
                className={`shrink-0 text-[9px] font-semibold tracking-wider px-1.5 py-0.5 rounded ${
                  s.kind === "proof" ? "bg-emerald-500/10 text-emerald-400" : "bg-sky-500/10 text-sky-400"
                }`}
              >
                {s.kind === "proof" ? "PROOF" : "PAIN POINT"}
              </span>
              <span>
                <span className="text-foreground/85">{s.label}</span>
                <span className="text-foreground/45"> — supports: {s.supports}</span>
              </span>
            </li>
          ))}
        </ul>
        {brief.sourceNotes.filter((s) => s.kind === "proof").length === 0 && (
          <p className="text-[12px] text-red-400 mt-2">Needs a PROOF source before this brief can pass the gate.</p>
        )}
      </SectionCard>

      {/* 4 · Concept Scoreboard */}
      <SectionCard title="CONCEPT SCOREBOARD">
        <div className="space-y-2.5">
          {brief.concepts.map((c) => {
            const s = scoreReelConcept(c);
            const isWinner = c.id === brief.winningConceptId;
            return (
              <div key={c.id} className={`border p-3 ${isWinner ? "border-primary/50 bg-primary/5" : "border-border/25"}`}>
                <div className="flex flex-wrap items-center gap-2 text-[12px]">
                  <span className="font-semibold text-foreground/90">{c.hook}</span>
                  {isWinner && (
                    <span className="text-[9px] font-semibold tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                      WINNER
                    </span>
                  )}
                  <span className={`ml-auto font-semibold ${s.passing ? "text-emerald-400" : "text-foreground/50"}`}>
                    {s.total}/{s.max}
                  </span>
                </div>
                <p className="text-[11px] text-foreground/55 mt-1">
                  {FACT_BUCKETS[c.factBucket].label} · {REEL_ARCHETYPES[c.archetype].label} · {MOTION_LENSES[c.motionLens].label} ·{" "}
                  {OBJECT_CHARACTERS[c.objectCharacter].label}
                </p>
                <p className="text-[11px] text-foreground/55 mt-1">
                  <span className="text-foreground/40">Saveable:</span> {c.saveShareReason} ·{" "}
                  <span className="text-foreground/40">Boostable:</span> {c.captionAngle} ·{" "}
                  <span className="text-foreground/40">Risk:</span> {c.rejectionRisk}
                </p>
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* 5 · Storyboard Builder */}
      <SectionCard title="STORYBOARD (4-6 BEATS)">
        <div className="space-y-2">
          {brief.storyboardBeats.map((b) => (
            <div key={b.beatNumber} className="border border-border/25 p-3 text-[12px]">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">BEAT {b.beatNumber}</span>
                <span className="text-foreground/45">
                  {b.startSecond}s – {b.endSecond}s
                </span>
                <span className="ml-auto text-[10px] text-foreground/40">{b.purpose}</span>
              </div>
              <p className="text-foreground/80 mt-1">{b.visual}</p>
              <p className="text-foreground/55 mt-0.5">Motion: {b.motion}</p>
              <p className="text-foreground/85 mt-0.5 font-medium">Text: “{b.onScreenText}”</p>
              <p className="text-foreground/45 mt-0.5">
                Audio: {b.audioCue} · Safe zone: {b.safeZoneNotes}
              </p>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* 6 · Higgsfield Prompt Pack */}
      <SectionCard title="HIGGSFIELD PROMPT PACK">
        <div className="space-y-2">
          {promptPack.map((p) => (
            <div key={p.beatNumber} className="border border-border/25 p-3">
              <div className="flex items-center gap-2 text-[12px]">
                <span className="font-semibold text-foreground">Beat {p.beatNumber}</span>
                <span className="text-[10px] text-foreground/40">{p.styleKit}</span>
                <span className="ml-auto">
                  <CopyButton label="Copy prompt" getText={() => `${p.prompt}\n\nNEGATIVE: ${p.negativePrompt}`} onCopied={copied} />
                </span>
              </div>
              <pre className="text-[11px] text-foreground/70 whitespace-pre-wrap mt-2">{p.prompt}</pre>
              <p className="text-[11px] text-foreground/45 mt-1">Negative: {p.negativePrompt}</p>
              <p className="text-[11px] text-foreground/45">Safe zone: {p.safeZoneGuidance}</p>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* 7 · Assembly Plan */}
      <SectionCard title="ASSEMBLY PLAN (FFMPEG — PLAN ONLY, NEVER EXECUTED HERE)">
        <ChecklistBlock items={ffmpegItems} />
        <p className="text-[12px] text-foreground/55 mt-3">{brief.ffmpegAssemblyNotes}</p>
      </SectionCard>

      {/* 8 · Caption Studio */}
      <SectionCard title="CAPTION STUDIO">
        <p className="text-[11px] text-foreground/45 mb-2">7 hook options — ASCII-safe; IG strips exotic glyphs.</p>
        <ul className="list-disc pl-5 space-y-1 text-[12px] text-foreground/75">
          {brief.captionHooks.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
        <div className="border border-border/25 p-3 mt-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-foreground/70">SELECTED CAPTION</span>
            <span className="ml-auto">
              <CopyButton label="Copy Caption" getText={() => `${brief.selectedCaption}\n\n${brief.hashtags.join(" ")}`} onCopied={copied} />
            </span>
          </div>
          <pre className="text-[12px] text-foreground/80 whitespace-pre-wrap mt-2">{brief.selectedCaption}</pre>
          <p className="text-[11px] text-foreground/50 mt-2">{brief.hashtags.join(" ")}</p>
        </div>
      </SectionCard>

      {/* 9 · Score Gate */}
      <SectionCard title={`SCORE GATE — ${gate.score}/${gate.max} (min ${gate.min})`}>
        <p className={`text-[12px] font-semibold mb-2 ${gate.passing ? "text-emerald-400" : "text-red-400"}`}>
          {gate.passing ? "PASSING" : "NOT PASSING"} · safety findings: {safety.findings.length} (
          {safety.findings.filter((f) => f.severity === "block").length} blocking)
        </p>
        <ChecklistBlock
          items={gate.parts.map((p) => ({ label: p.label, ok: p.ok, detail: `${p.points}/${p.max} — ${p.detail}` }))}
        />
        {safety.findings.length > 0 && (
          <div className="mt-3 space-y-1">
            {safety.findings.map((f, i) => (
              <p key={i} className={`text-[11px] ${f.severity === "block" ? "text-red-400" : "text-amber-400"}`}>
                [{f.severity.toUpperCase()}] {f.rule} in {f.where}: “{f.match}” — {f.fix}
              </p>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Content memory placeholder */}
      <SectionCard title="CONTENT MEMORY (REPETITION CHECK)">
        <p className="text-[12px] text-foreground/55">
          Content log integration not wired yet — paste your recent reels/content log here manually and check: recent
          topic · fact · hook · archetype · motion lens · object character · campaign keyword · CTA · same-day
          carousel/static overlap.
        </p>
        <p className="text-[12px] text-foreground/70 mt-2">
          Avoided this run: <span className="text-foreground/85">{brief.avoidedForRepetition || "—"}</span>
        </p>
      </SectionCard>

      {/* 10 · Operator Actions */}
      <SectionCard title="OPERATOR ACTIONS">
        <div className="flex flex-wrap gap-1.5">
          <CopyButton label="Copy Master Reel Prompt" getText={masterPrompt} onCopied={copied} />
          <CopyButton
            label="Copy Higgsfield Prompt Pack"
            getText={() => promptPack.map((p) => `BEAT ${p.beatNumber}\n${p.prompt}\nNEGATIVE: ${p.negativePrompt}`).join("\n\n")}
            onCopied={copied}
          />
          <CopyButton label="Copy Storyboard" getText={() => formatStoryboard(brief)} onCopied={copied} />
          <CopyButton label="Copy Publish Checklist" getText={() => formatChecklist(publishItems)} onCopied={copied} />
          <CopyButton label="Copy Archive Checklist" getText={() => formatChecklist(archiveItems)} onCopied={copied} />
        </div>
        <div className="flex flex-wrap gap-1.5 mt-3">
          <DisabledButton label={`Generate Video (${canGenerateVideo().ok ? "on" : "off"})`} />
          <DisabledButton label={`Assemble MP4 (${canAssembleMp4().ok ? "on" : "off"})`} />
          <DisabledButton label={`Publish Reel (${canPublish().ok ? "on" : "off"})`} />
          <DisabledButton label={`Read Reel Insights (${canReadInsights().ok ? "on" : "off"})`} />
        </div>
        <p className="text-[11px] text-foreground/40 mt-2">{DISABLED_REASON}</p>
        <div className="mt-4 border-t border-border/20 pt-3">
          <p className="text-[11px] text-foreground/45 font-semibold mb-1.5">MANUAL PUBLISH CHECKLIST</p>
          <ChecklistBlock items={publishItems} />
        </div>
        <div className="mt-4 border-t border-border/20 pt-3">
          <p className="text-[11px] text-foreground/45 font-semibold mb-1.5">ARCHIVE / LOG CHECKLIST</p>
          <ChecklistBlock items={archiveItems} />
        </div>
      </SectionCard>
    </div>
  );
}
