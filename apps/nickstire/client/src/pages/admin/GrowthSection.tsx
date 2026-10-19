/**
 * 2026-10-19 (admin prune W1): no longer a section. Its tabs render inside
 * Website & Local (ContentSection, ?contentTab=local|qa|photos|entity|competitors);
 * Review Replies was cut. The notes below describe the tabs.
 *
 * GrowthSection — the operator surface for the GBP local-growth systems
 * (PR #50) and the social intelligence studios (PR #51).
 *
 * SAFETY MODEL: nothing here posts, sends, scrapes, or edits anything
 * outside this app. Every tab carries an explicit mode badge:
 *   READ-ONLY  — live admin queries returning booleans/status only
 *   COPY-ONLY  — content the owner copies and posts manually
 *   MANUAL     — checklists the owner works by hand on external platforms
 *   DB-ONLY    — mutations that touch our own database rows, never Google
 * The only mutations reachable from this screen are reviewReplies
 * updateDraft/approve/skip/markPosted/fetchNewReviews — all write OUR
 * rows; the actual Google reply is always pasted by the owner in the
 * GBP app, then confirmed here with "Mark posted".
 */
import { useState } from "react";
import {
  TrendingUp, Star, MessageCircleQuestion, Camera, Building2,
  Swords, Copy, Check, Loader2, AlertTriangle, CheckCircle2,
  Lock, Activity,
} from "lucide-react";
import { Panel, ErrorState } from "./shared";
import { trpc } from "@/lib/trpc";
import { GBP_QA_SEEDS } from "@/lib/gbpQaSeeds";
import {
  weeklyPhotoQueue, PHOTO_SAFETY_RULES, UPLOAD_DESTINATION,
} from "@/lib/gbpPhotoQueue";
import { CANONICAL_IDENTITY, ENTITY_PLATFORMS, ENTITY_FIX_ORDER } from "@/lib/entityConsistency";
import {
  COMPETITORS, COMPETITOR_BASELINE_DATE, WEEKLY_CHECK_FIELDS, reviewVolumeGaps,
} from "@/lib/competitorGbpMonitor";
import { RANK_KEYWORDS } from "@/lib/localRankKeywords";

type Mode = "read-only" | "copy-only" | "manual" | "db-only";
const MODE_CLS: Record<Mode, string> = {
  "read-only": "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  "copy-only": "bg-blue-500/10 text-blue-400 border-blue-500/20",
  manual: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  "db-only": "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

function ModeBadge({ mode }: { mode: Mode }) {
  return (
    <span className={`px-1.5 py-0.5 text-[9px] font-bold border rounded ${MODE_CLS[mode]}`}>
      {mode}
    </span>
  );
}

/** Copy button with in-DOM feedback (window.* dialogs are dead in the iOS PWA). */
function CopyBtn({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded border border-border/40 text-foreground/70 hover:text-foreground hover:border-primary/40 transition-colors shrink-0"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : label}
    </button>
  );
}

function Bool({ value, trueLabel, falseLabel, trueIsBad = false }: {
  value: boolean; trueLabel: string; falseLabel: string; trueIsBad?: boolean;
}) {
  const bad = trueIsBad ? value : !value;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] ${bad ? "text-red-400" : "text-emerald-400"}`}>
      {bad ? <AlertTriangle className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
      {value ? trueLabel : falseLabel}
    </span>
  );
}

/* ── Local Growth ─────────────────────────────────────────────── */

export function LocalGrowthTab() {
  const { data: armed, isLoading: armedLoading } = trpc.localGrowth.automationArmedState.useQuery();
  const { data: health, isLoading: healthLoading } = trpc.localGrowth.reviewsHealth.useQuery();

  return (
    <div className="space-y-4">
      <Panel title="Automation armed-state" icon={<Lock className="w-4 h-4" />}>
        <div className="flex items-center gap-2 mb-2"><ModeBadge mode="read-only" /><span className="text-[10px] text-foreground/40">booleans only: token values are never returned</span></div>
        {armedLoading ? <Loader2 className="w-4 h-4 animate-spin text-primary" /> : !armed ? (
          <p className="text-xs text-muted-foreground">Unavailable: check server logs.</p>
        ) : (
          <div className="space-y-1.5 text-xs">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <Bool value={armed.ig.dryRun} trueLabel="IG dry-run ON (safe)" falseLabel="IG dry-run OFF" />
              <Bool value={armed.ig.envTokenPresent} trueLabel="env token present" falseLabel="no env token" trueIsBad />
              <Bool value={armed.ig.durableTokenPresent} trueLabel="durable DB token present" falseLabel="no durable token" trueIsBad />
              <Bool value={armed.ig.igUserIdPresent} trueLabel="IG user id set" falseLabel="no IG user id" trueIsBad />
            </div>
            <p className={`font-semibold ${armed.ig.couldPostLiveNow ? "text-red-400" : "text-emerald-400"}`}>
              {armed.ig.couldPostLiveNow
                ? "ARMED: the IG autoposter COULD post live right now."
                : "DISARMED: the IG autoposter cannot post live right now."}
            </p>
            {armed.ig.tokenExpirationWarning && (
              <p className={`font-semibold flex items-start gap-1 ${
                armed.ig.tokenStatus === "expired" ? "text-red-400" : "text-amber-400"
              }`}>
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{armed.ig.tokenExpirationWarning}</span>
              </p>
            )}
            <p className="text-[11px] text-foreground/60 leading-relaxed">{armed.disarmNote}</p>
            <p className="text-[11px] text-foreground/50">
              GBP posting: direct API posting is {armed.gbp.directPostingPossible ? "possible" : "NOT possible"} (Posts API deprecated 2024): mode: {armed.gbp.mode}.
            </p>
          </div>
        )}
      </Panel>

      <Panel title="Google Reviews / Place ID health" icon={<Star className="w-4 h-4" />}>
        <div className="flex items-center gap-2 mb-2"><ModeBadge mode="read-only" /></div>
        {healthLoading ? <Loader2 className="w-4 h-4 animate-spin text-primary" /> : !health ? (
          <p className="text-xs text-muted-foreground">Unavailable: check server logs.</p>
        ) : (
          <div className="space-y-1.5 text-xs">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <Bool value={health.mapsKeyPresent} trueLabel="Maps key present" falseLabel="Maps key MISSING" />
              <Bool value={health.placesKeyPresent} trueLabel="Places key present" falseLabel="Places key missing (Maps key covers it)" />
              <Bool value={health.liveReachable} trueLabel={`live reviews reachable (${health.liveReviewCount ?? "?"} reviews)`} falseLabel="live reviews NOT reachable" />
            </div>
            {health.fallbackNote && (
              <p className="text-[11px] text-amber-400 leading-relaxed flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />{health.fallbackNote}
              </p>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Search visibility (rank tracker)" icon={<TrendingUp className="w-4 h-4" />}>
        <div className="flex items-center gap-2 mb-2"><ModeBadge mode="manual" /><span className="text-[10px] text-foreground/40">no measured ranks yet: never faked</span></div>
        <p className="text-[11px] text-foreground/60 leading-relaxed mb-2">
          {RANK_KEYWORDS.length} target keywords are defined. Ranks show only after a real
          measurement (GSC average position or a manual SERP check): the GSC env-aliasing
          fix in this stack stops Search Console syncing from silently dying when the Maps
          key changes.
        </p>
        <div className="flex flex-wrap gap-1">
          {RANK_KEYWORDS.map((k) => (
            <span key={k.keyword} className="px-1.5 py-0.5 text-[10px] bg-foreground/5 border border-border/30 rounded text-foreground/60">
              {k.keyword} <span className="text-foreground/30">· {k.group}</span>
            </span>
          ))}
        </div>
      </Panel>

      <Panel title="Next owner actions" icon={<CheckCircle2 className="w-4 h-4" />}>
        <div className="flex items-center gap-2 mb-2"><ModeBadge mode="manual" /></div>
        <ol className="list-decimal list-inside space-y-1 text-[11px] text-foreground/70">
          <li>Post the GBP Q&A seeds (next tab over): ~15 min, highest local-SEO ROI.</li>
          <li>Shoot this week's 6 photos (Photo Queue tab) and upload to GBP.</li>
          <li>Work the Entity / Brand checklist top-to-bottom (GBP first).</li>
          <li>Reply to draft reviews from the Review Replies tab, worst rating first, then Mark posted (copy → paste in GBP).</li>
          <li>Once a week: log the Competitors tab numbers against the baseline.</li>
        </ol>
      </Panel>

      <SocialPipelineHealth />
    </div>
  );
}

/* ── Social Pipeline Health ──────────────────────────────────── */

function SocialPipelineHealth() {
  const { data, isLoading, isError, refetch } = trpc.socialPipeline.status.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  if (isLoading) return (
    <Panel title="Social Pipeline Health" icon={<Activity className="w-4 h-4" />}>
      <Loader2 className="w-4 h-4 animate-spin text-primary" />
    </Panel>
  );

  // A failed read must not remove the kill-switch panel: no panel reads as "all off".
  if (isError || !data) return (
    <Panel title="Social Pipeline Health" icon={<Activity className="w-4 h-4" />}>
      <ErrorState
        message="Social pipeline status couldn't load. The kill-switch states are unknown, not off."
        onRetry={() => void refetch()}
      />
    </Panel>
  );

  const { readiness, envGates, dbFlags } = data;

  return (
    <Panel title="Social Pipeline Health" icon={<Activity className="w-4 h-4" />}>
      <div className="flex items-center gap-2 mb-3"><ModeBadge mode="read-only" /><span className="text-[10px] text-foreground/40">live status of all automation kill-switches</span></div>

      {/* Composite readiness */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
        {([
          ["IG Live Posting", readiness.igLivePosting],
          ["Reel Generation", readiness.reelPipeline],
          ["Reel Publishing", readiness.reelPublish],
          ["Reel Auto-Post", readiness.reelAutopost],
          ["GBP Posting", readiness.gbpPosting],
          ["SMS Path Open", readiness.smsPathOpen],
        ] as [string, boolean][]).map(([label, armed]) => (
          <div key={label} className={`px-2 py-1.5 rounded border text-[10px] font-semibold flex items-center gap-1.5 ${
            armed
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
              : "bg-foreground/5 text-foreground/40 border-border/20"
          }`}>
            {armed ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
            {label}
          </div>
        ))}
      </div>

      {/* Env gates */}
      <p className="text-[9px] text-foreground/40 font-semibold mb-1">Environment gates (Railway)</p>
      <div className="space-y-1 mb-3">
        {envGates.map((g) => (
          <div key={g.key} className="flex items-center gap-2 text-[10px]">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${g.armed ? "bg-emerald-400" : "bg-foreground/20"}`} />
            <span className="font-mono text-foreground/60 min-w-0 truncate">{g.key}</span>
            <span className={`ml-auto shrink-0 ${g.armed ? "text-emerald-400" : "text-foreground/30"}`}>
              {g.armed ? "ARMED" : "OFF"}
            </span>
          </div>
        ))}
      </div>

      {/* DB flags */}
      <p className="text-[9px] text-foreground/40 font-semibold mb-1">Feature flags (database)</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
        {dbFlags.map((f) => (
          <div key={f.key} className="flex items-center gap-2 text-[10px]">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${f.armed ? "bg-emerald-400" : "bg-foreground/20"}`} />
            <span className="font-mono text-foreground/60 min-w-0 truncate">{f.key}</span>
            <span className={`ml-auto shrink-0 ${f.armed ? "text-emerald-400" : "text-foreground/30"}`}>
              {f.armed ? "ON" : "OFF"}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ── GBP Q&A ──────────────────────────────────────────────────── */

export function GbpQaTab() {
  return (
    <div className="space-y-4">
      <div className="border border-purple-500/40 bg-purple-500/10 rounded p-3 text-xs text-purple-200 flex items-start gap-2">
        <MessageCircleQuestion className="w-4 h-4 shrink-0 mt-0.5 text-purple-400" />
        <span>
          <strong>Manual posting:</strong> open your Google Business Profile → Q&A,
          post the question, then answer it from the business account. Space a few
          out over days: a burst of same-minute Q&As looks manufactured. All{" "}
          {GBP_QA_SEEDS.length} pairs below are claim-safety test-enforced (no invented
          warranties, no "guaranteed", approved $25 used-tire wording only).
        </span>
      </div>
      {GBP_QA_SEEDS.map((qa) => (
        <div key={qa.question} className="bg-background/40 border border-border/30 rounded p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-1.5 py-0.5 text-[9px] font-bold border rounded bg-foreground/5 text-foreground/50 border-border/20">{qa.category}</span>
            <span className="px-1.5 py-0.5 text-[9px] font-bold border rounded bg-emerald-500/10 text-emerald-400 border-emerald-500/20">CLAIM-SAFE</span>
            <ModeBadge mode="copy-only" />
          </div>
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold text-foreground leading-relaxed">{qa.question}</p>
            <CopyBtn text={qa.question} label="Copy Q" />
          </div>
          <div className="flex items-start justify-between gap-2">
            <p className="text-[11px] text-foreground/70 leading-relaxed">{qa.answer}</p>
            <CopyBtn text={qa.answer} label="Copy A" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Photo Queue ──────────────────────────────────────────────── */

export function PhotoQueueTab() {
  // Deterministic week index (weeks since epoch) — same list all week,
  // rotates Monday-ish; the queue itself is a pure function of this number.
  const weekIndex = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const tasks = weeklyPhotoQueue(weekIndex);

  return (
    <div className="space-y-4">
      <div className="border border-purple-500/40 bg-purple-500/10 rounded p-3 text-xs text-purple-200 flex items-start gap-2">
        <Camera className="w-4 h-4 shrink-0 mt-0.5 text-purple-400" />
        <span>
          <strong>Manual upload:</strong> shoot these 6 during normal work this week,
          then upload to <strong>{UPLOAD_DESTINATION}</strong>. Nothing uploads
          automatically. Fresh weekly photos are one of the strongest free local-rank
          signals.
        </span>
      </div>
      <Panel title="Privacy + safety rules (every photo)" icon={<AlertTriangle className="w-4 h-4" />}>
        <ul className="list-disc list-inside space-y-0.5 text-[11px] text-foreground/70 mt-1">
          {PHOTO_SAFETY_RULES.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </Panel>
      <div className="space-y-3">
        {tasks.map((t, i) => (
          <div key={t.title} className="bg-background/40 border border-border/30 rounded p-3 space-y-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-foreground">{i + 1}. {t.title}</span>
              <span className="px-1.5 py-0.5 text-[9px] font-bold border rounded bg-foreground/5 text-foreground/50 border-border/20">{t.category}</span>
              <ModeBadge mode="manual" />
            </div>
            <p className="text-[11px] text-foreground/70 leading-relaxed"><span className="font-semibold text-primary">Shot:</span> {t.instructions}</p>
            <p className="text-[11px] text-foreground/50 leading-relaxed"><span className="font-semibold">Why:</span> {t.whyItHelps}</p>
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] text-foreground/60 italic">Caption: "{t.caption}"</p>
              <CopyBtn text={t.caption} label="Copy caption" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Entity / Brand ───────────────────────────────────────────── */

export function EntityTab() {
  return (
    <div className="space-y-4">
      <Panel title="Canonical identity (use EXACTLY this everywhere)" icon={<Building2 className="w-4 h-4" />}>
        <div className="flex items-center gap-2 mb-2"><ModeBadge mode="manual" /><span className="text-[10px] text-foreground/40">no external listing is ever edited from here</span></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-[11px] text-foreground/80">
          <div><span className="text-foreground/40">Name:</span> {CANONICAL_IDENTITY.name} <CopyBtn text={CANONICAL_IDENTITY.name} /></div>
          <div><span className="text-foreground/40">Phone:</span> {CANONICAL_IDENTITY.phone} <CopyBtn text={CANONICAL_IDENTITY.phone} /></div>
          <div><span className="text-foreground/40">Address:</span> {CANONICAL_IDENTITY.address} <CopyBtn text={CANONICAL_IDENTITY.address} /></div>
          <div><span className="text-foreground/40">Website:</span> {CANONICAL_IDENTITY.website} · IG: {CANONICAL_IDENTITY.instagram}</div>
        </div>
        <p className="text-[10px] text-foreground/40 mt-2">
          Fix order (highest local-SEO value first): {ENTITY_FIX_ORDER.join(" → ")}
        </p>
      </Panel>
      {ENTITY_PLATFORMS.map((p) => (
        <div key={p.platform} className="bg-background/40 border border-border/30 rounded p-3 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-foreground">{p.platform}</span>
            <span className="px-1.5 py-0.5 text-[9px] font-bold border rounded bg-foreground/5 text-foreground/50 border-border/20">{p.status.replace("_", " ")}</span>
            <span className="px-1.5 py-0.5 text-[9px] font-bold border rounded bg-purple-500/10 text-purple-400 border-purple-500/20 inline-flex items-center gap-1"><Lock className="w-2.5 h-2.5" /> OWNER MANUAL</span>
          </div>
          <p className="text-[11px] text-foreground/70"><span className="font-semibold text-primary">Check:</span> {p.checkFields.join(" · ")}</p>
          <p className="text-[11px] text-foreground/70"><span className="font-semibold text-primary">Do:</span> {p.ownerAction}</p>
          <p className="text-[11px] text-foreground/50">Access needed: {p.accessNeeded}</p>
          <p className="text-[11px] text-amber-400/90 flex items-start gap-1"><AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />{p.riskIfIgnored}</p>
        </div>
      ))}
      <p className="text-[10px] text-foreground/30 leading-relaxed">
        Statuses are hand-maintained: nothing is marked fixed until you verify it on the
        platform. Automated listing edits violate most platforms' terms, so this stays manual
        by design.
      </p>
    </div>
  );
}

/* ── Competitors ──────────────────────────────────────────────── */

export function CompetitorsTab() {
  // Live Nick's review count (if reachable) powers the honest gap math.
  // When live data isn't reachable we say so — we never fake movement.
  const { data: health } = trpc.localGrowth.reviewsHealth.useQuery();
  const nicksCount = health?.liveReachable ? health.liveReviewCount : null;
  const gaps = typeof nicksCount === "number" ? reviewVolumeGaps(nicksCount) : null;

  return (
    <div className="space-y-4">
      <div className="border border-amber-500/40 bg-amber-500/10 rounded p-3 text-xs text-amber-200 flex items-start gap-2">
        <Swords className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
        <span>
          <strong>Baseline {COMPETITOR_BASELINE_DATE} · a comparison anchor, not live data.</strong>{" "}
          Competitor numbers below were captured in the {COMPETITOR_BASELINE_DATE} audit.
          The weekly check is manual (~10 min): open each profile, log the fields, compare
          against this anchor.
        </span>
      </div>
      <Panel title={`Watch list (baseline ${COMPETITOR_BASELINE_DATE})`} icon={<Swords className="w-4 h-4" />}>
        <div className="flex items-center gap-2 mb-2"><ModeBadge mode="manual" /></div>
        <div className="space-y-2">
          {COMPETITORS.map((c) => {
            const gap = gaps?.find((g) => g.name === c.name);
            return (
              <div key={c.name} className="flex items-center justify-between gap-2 bg-background/40 border border-border/30 rounded p-2.5 flex-wrap">
                <div className="min-w-0">
                  <span className="text-xs font-semibold text-foreground">{c.name}</span>
                  {c.note && <span className="text-[10px] text-foreground/40 ml-2">{c.note}</span>}
                </div>
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="text-amber-400">{c.rating.toFixed(1)} ★</span>
                  <span className="text-foreground/60">{c.reviewCount} reviews</span>
                  {gap && gap.gap > 0 && <span className="text-red-400">{gap.gap} ahead of us</span>}
                  {gap && gap.gap <= 0 && <span className="text-emerald-400">we lead by {-gap.gap}</span>}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[10px] text-foreground/40 mt-2">
          {typeof nicksCount === "number"
            ? `Gap math uses our LIVE Google review count (${nicksCount}) vs each competitor's ${COMPETITOR_BASELINE_DATE} baseline.`
            : "Live Nick's review count unreachable right now: gap math hidden rather than faked. See Reviews health on the Local Growth tab."}
        </p>
      </Panel>
      <Panel title="Weekly check fields (log these per competitor)" icon={<CheckCircle2 className="w-4 h-4" />}>
        <ul className="list-disc list-inside space-y-0.5 text-[11px] text-foreground/70 mt-1">
          {WEEKLY_CHECK_FIELDS.map((f) => <li key={f}>{f}</li>)}
        </ul>
        <p className="text-[10px] text-foreground/40 mt-2">
          The server keeps each competitor's Google place ID only. Google's terms do not
          allow storing their ratings or review counts, so there is no automatic trend or
          alert: log the weekly fields here by hand.
        </p>
      </Panel>
    </div>
  );
}
