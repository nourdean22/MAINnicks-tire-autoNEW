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
import { Panel, ErrorState, LoadingState } from "./shared";
import { timeAgoShort } from "./shared/format";
import { navigateToAdminUrl } from "./shared/navigation";
import { trpc } from "@/lib/trpc";
import { GBP_REVIEW_URL } from "@shared/const";
import { GBP_QA_SEEDS } from "@/lib/gbpQaSeeds";
import {
  weeklyPhotoQueue, PHOTO_SAFETY_RULES, UPLOAD_DESTINATION,
} from "@/lib/gbpPhotoQueue";
import { CANONICAL_IDENTITY, ENTITY_PLATFORMS, ENTITY_FIX_ORDER } from "@/lib/entityConsistency";
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
function CopyBtn({ text, label = "Copy", className = "" }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded border border-border/40 text-foreground/70 hover:text-foreground hover:border-primary/40 transition-colors shrink-0 ${className}`}
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
              <Bool value={health.liveReachable} trueLabel={`live reviews reachable (${health.liveReviewCount?.toLocaleString("en-US") ?? "?"} reviews)`} falseLabel="live reviews NOT reachable" />
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
          <li>Reply on Google (Business Profile reviews), worst rating first.</li>
          <li>Open the Competitors tab: live Google numbers and one action.</li>
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

type RecentReviews = { count: number; newestAt: string | null; oldestAt: string | null };

const REVIEWS_HREF = "/admin?tab=campaigns&outreachTab=reviews";
const fmtCount = (n: number) => n.toLocaleString("en-US");

/** Days the newest reviews span: shown only as "N in D days", never as a bare rate. */
function paceDays(r: RecentReviews): number | null {
  if (r.count < 2 || !r.newestAt || !r.oldestAt) return null;
  const ms = Date.parse(r.newestAt) - Date.parse(r.oldestAt);
  if (!Number.isFinite(ms)) return null;
  return Math.max(1, Math.ceil(ms / 86_400_000));
}

const stripPeriod = (m: string) => m.replace(/\.+$/, "");
const SNAPSHOT_FAILURE_COPY: Record<"unconfigured" | "denied" | "error", (message: string) => string> = {
  unconfigured: () =>
    "Google Places key is not set on the server. Competitor numbers are UNMEASURED, not zero. Add GOOGLE_PLACES_API_KEY (or GOOGLE_MAPS_API_KEY) in Railway.",
  denied: (m) =>
    `Google rejected the Places key (${stripPeriod(m)}). Fix the key or its API restriction in Google Cloud; nothing to do on the phone.`,
  error: (m) => `Google read failed: ${stripPeriod(m)}.`,
};

export function CompetitorsTab() {
  // Read live on open (server holds it 60 min in memory). Google's terms allow storing
  // place_id only, so nothing here is cached or kept in the browser either.
  const { data, isLoading, isError, refetch } = trpc.localGrowth.competitorSnapshot.useQuery();
  const retry = () => void refetch();

  if (isLoading) return <LoadingState label="Reading Google..." />;
  if (isError || !data) {
    return <ErrorState message="Competitor numbers couldn't load: unknown, not zero." onRetry={retry} />;
  }
  if (!data.ok) return <ErrorState message={SNAPSHOT_FAILURE_COPY[data.reason](data.message)} onRetry={retry} />;

  const { nicks, competitors, unresolved, rank } = data;
  const ownPace = nicks ? paceDays(nicks.recent) : null;
  const groups = ([["local", "Local independents"], ["chain", "Chains"]] as const)
    .map(([group, label]) => ({
      label,
      rows: competitors.filter((c) => c.group === group).sort((a, b) => b.reviewCount - a.reviewCount),
    }))
    .filter((g) => g.rows.length > 0);
  const nearestAhead = nicks
    ? competitors
        .filter((c) => c.reviewCount > nicks.reviewCount)
        .sort((a, b) => a.reviewCount - b.reviewCount)[0]
    : undefined;

  return (
    <div className="space-y-4">
      <div className="bg-background/40 border border-border/30 rounded p-3 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <ModeBadge mode="read-only" />
          <span className="text-xs font-semibold text-foreground">
            {/* min(): a server clock ahead of the phone would print a negative age */}
            Live from Google · read {timeAgoShort(Math.min(Date.parse(data.fetchedAt), Date.now()))} · refreshes hourly
          </span>
        </div>
        <p className="text-[10px] text-foreground/50">Ratings and review counts: Google, read live. Nothing is stored.</p>
      </div>

      <Panel title="Where we stand" icon={<Star className="w-4 h-4" />}>
        <div data-testid="where-we-stand" className="space-y-1">
          {nicks ? (
            <>
              <div className="flex items-baseline gap-x-2 gap-y-1 flex-wrap">
                <span className="text-3xl font-bold text-foreground tabular-nums">{fmtCount(nicks.reviewCount)}</span>
                <span className="text-xs text-foreground/60">reviews</span>
                <span className="text-lg font-semibold text-amber-400 tabular-nums ml-2">{nicks.rating.toFixed(1)}</span>
                <span className="text-xs text-amber-400">★</span>
              </div>
              {rank && (
                <p className="text-[11px] text-foreground/70">
                  {`#${rank.byRating} of ${rank.of} by rating · #${rank.byVolume} of ${rank.of} by review count`}
                </p>
              )}
              {ownPace !== null && (
                <p className="text-[11px] text-foreground/50">{`${nicks.recent.count} newest reviews in ${ownPace} days`}</p>
              )}
            </>
          ) : (
            <p className="text-xs text-amber-400">Our own listing could not be read: rank is UNMEASURED.</p>
          )}
        </div>
      </Panel>

      <Panel title="Watch list" icon={<Swords className="w-4 h-4" />}>
        {groups.length === 0 ? (
          <p className="text-[11px] text-foreground/50">No tracked shop could be read from Google this time.</p>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <div key={g.label}>
                <p className="text-[10px] font-semibold text-foreground/50 mb-1">{g.label}</p>
                <ul className="space-y-1.5">
                  {g.rows.map((c) => {
                    const gap = nicks ? c.reviewCount - nicks.reviewCount : null;
                    const pace = paceDays(c.recent);
                    return (
                      <li
                        key={c.placeId}
                        data-competitor-row
                        className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 bg-background/40 border border-border/30 rounded p-2.5 text-[11px]"
                      >
                        <span className="text-xs font-semibold text-foreground min-w-0 break-words">{c.name}</span>
                        <span className="text-amber-400 tabular-nums">{`${c.rating.toFixed(1)} ★`}</span>
                        <span className="text-foreground/70 tabular-nums">{`${fmtCount(c.reviewCount)} reviews`}</span>
                        {gap !== null && gap > 0 && <span className="text-red-400">{`${fmtCount(gap)} ahead of us`}</span>}
                        {gap !== null && gap < 0 && <span className="text-emerald-400">{`we lead by ${fmtCount(-gap)}`}</span>}
                        {gap === 0 && <span className="text-foreground/60">level with us</span>}
                        {pace !== null && <span className="text-foreground/40">{`${c.recent.count} newest in ${pace} d`}</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
        {unresolved > 0 && (
          <p className="text-[10px] text-foreground/40 mt-2">
            {`${unresolved} tracked ${unresolved === 1 ? "shop" : "shops"} could not be read from Google this time (the server log names them).`}
          </p>
        )}
      </Panel>

      <Panel title="One action" icon={<TrendingUp className="w-4 h-4" />}>
        <p className="text-xs text-foreground/80">Review volume is the gap most worth closing.</p>
        {nicks && nearestAhead && (
          <p className="text-[11px] text-foreground/60 mt-1">
            {`Nearest ahead by volume: ${nearestAhead.name}, ${fmtCount(nearestAhead.reviewCount - nicks.reviewCount)} more reviews.`}
          </p>
        )}
        <a
          href={REVIEWS_HREF}
          onClick={(e) => {
            if (navigateToAdminUrl(e, REVIEWS_HREF, "campaigns")) e.preventDefault();
          }}
          className="mt-3 flex w-full sm:inline-flex sm:w-auto min-h-12 items-center justify-center px-4 rounded bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Ask recent customers for a review
        </a>
        <div className="mt-2">
          <CopyBtn text={GBP_REVIEW_URL} label="Copy our review link" className="min-h-12" />
        </div>
      </Panel>
    </div>
  );
}
