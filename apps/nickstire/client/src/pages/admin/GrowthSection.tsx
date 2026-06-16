/**
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
  TrendingUp, MapPin, Star, MessageCircleQuestion, Camera, Building2,
  Swords, Sparkles, Copy, Check, Loader2, AlertTriangle, CheckCircle2,
  ExternalLink, RefreshCw, Lock, ChevronDown, ChevronUp, Instagram,
} from "lucide-react";
import IgAutopostPanel from "./settings/IgAutopostPanel";
import DraftBoardPanel from "./DraftBoardPanel";
import InstagramTab from "./InstagramTab";
import { Section, Panel } from "./shared";
import { TabBar } from "./shared/table";
import { trpc } from "@/lib/trpc";
import { GBP_QA_SEEDS } from "@/lib/gbpQaSeeds";
import {
  weeklyPhotoQueue, PHOTO_SAFETY_RULES, UPLOAD_DESTINATION,
} from "@/lib/gbpPhotoQueue";
import { CANONICAL_IDENTITY, ENTITY_PLATFORMS, ENTITY_FIX_ORDER } from "@/lib/entityConsistency";
import { checkReviewReply } from "@shared/reviewReplyQa";
import {
  COMPETITORS, COMPETITOR_BASELINE_DATE, WEEKLY_CHECK_FIELDS, reviewVolumeGaps,
} from "@/lib/competitorGbpMonitor";
import { RANK_KEYWORDS } from "@/lib/localRankKeywords";

type GrowthTab = "local" | "reviews" | "qa" | "photos" | "entity" | "competitors" | "instagram" | "studios";

const GROWTH_TABS: { id: GrowthTab; label: string; icon: React.ReactNode }[] = [
  { id: "local", label: "Local Growth", icon: <MapPin className="w-3.5 h-3.5" /> },
  { id: "reviews", label: "Review Replies", icon: <Star className="w-3.5 h-3.5" /> },
  { id: "qa", label: "GBP Q&A", icon: <MessageCircleQuestion className="w-3.5 h-3.5" /> },
  { id: "photos", label: "Photo Queue", icon: <Camera className="w-3.5 h-3.5" /> },
  { id: "entity", label: "Entity / Brand", icon: <Building2 className="w-3.5 h-3.5" /> },
  { id: "competitors", label: "Competitors", icon: <Swords className="w-3.5 h-3.5" /> },
  { id: "instagram", label: "Instagram", icon: <Instagram className="w-3.5 h-3.5" /> },
  { id: "studios", label: "Social Studios", icon: <Sparkles className="w-3.5 h-3.5" /> },
];

type Mode = "read-only" | "copy-only" | "manual" | "db-only";
const MODE_CLS: Record<Mode, string> = {
  "read-only": "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  "copy-only": "bg-blue-500/10 text-blue-400 border-blue-500/20",
  manual: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  "db-only": "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

function ModeBadge({ mode }: { mode: Mode }) {
  return (
    <span className={`px-1.5 py-0.5 text-[9px] font-bold border rounded uppercase ${MODE_CLS[mode]}`}>
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

export default function GrowthSection() {
  const [tab, setTab] = useState<GrowthTab>("local");

  return (
    <Section
      title="Growth"
      subtitle="Local SEO + social systems. Nothing on this screen posts, sends, or edits anything outside this app — every external action is yours, labeled per card."
      icon={<TrendingUp className="w-5 h-5 text-primary" />}
    >
      <TabBar tabs={GROWTH_TABS} activeTab={tab} onChange={setTab} variant="pill" size="compact" />
      <div className="mt-4">
        {tab === "local" && <LocalGrowthTab />}
        {tab === "reviews" && <ReviewRepliesTab />}
        {tab === "qa" && <GbpQaTab />}
        {tab === "photos" && <PhotoQueueTab />}
        {tab === "entity" && <EntityTab />}
        {tab === "competitors" && <CompetitorsTab />}
        {tab === "instagram" && <InstagramTab />}
        {tab === "studios" && <StudiosTab />}
      </div>
    </Section>
  );
}

/* ── Local Growth ─────────────────────────────────────────────── */

function LocalGrowthTab() {
  const { data: armed, isLoading: armedLoading } = trpc.localGrowth.automationArmedState.useQuery();
  const { data: health, isLoading: healthLoading } = trpc.localGrowth.reviewsHealth.useQuery();

  return (
    <div className="space-y-4">
      <Panel title="Automation armed-state" icon={<Lock className="w-4 h-4" />}>
        <div className="flex items-center gap-2 mb-2"><ModeBadge mode="read-only" /><span className="text-[10px] text-foreground/40">booleans only — token values are never returned</span></div>
        {armedLoading ? <Loader2 className="w-4 h-4 animate-spin text-primary" /> : !armed ? (
          <p className="text-xs text-muted-foreground">Unavailable — check server logs.</p>
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
              GBP posting: direct API posting is {armed.gbp.directPostingPossible ? "possible" : "NOT possible"} (Posts API deprecated 2024) — mode: {armed.gbp.mode}.
            </p>
          </div>
        )}
      </Panel>

      <Panel title="Google Reviews / Place ID health" icon={<Star className="w-4 h-4" />}>
        <div className="flex items-center gap-2 mb-2"><ModeBadge mode="read-only" /></div>
        {healthLoading ? <Loader2 className="w-4 h-4 animate-spin text-primary" /> : !health ? (
          <p className="text-xs text-muted-foreground">Unavailable — check server logs.</p>
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
        <div className="flex items-center gap-2 mb-2"><ModeBadge mode="manual" /><span className="text-[10px] text-foreground/40">no measured ranks yet — never faked</span></div>
        <p className="text-[11px] text-foreground/60 leading-relaxed mb-2">
          {RANK_KEYWORDS.length} target keywords are defined. Ranks show only after a real
          measurement (GSC average position or a manual SERP check) — the GSC env-aliasing
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
          <li>Post the GBP Q&A seeds (next tab over) — ~15 min, highest local-SEO ROI.</li>
          <li>Shoot this week's 6 photos (Photo Queue tab) and upload to GBP.</li>
          <li>Work the Entity / Brand checklist top-to-bottom (GBP first).</li>
          <li>Reply to draft reviews from the Review Replies tab, worst rating first, then Mark posted (copy → paste in GBP).</li>
          <li>Once a week: log the Competitors tab numbers against the baseline.</li>
        </ol>
      </Panel>
    </div>
  );
}

/* ── Review Replies ───────────────────────────────────────────── */

type ReplyFilter = "draft" | "approved" | "skipped" | "posted" | "all";

/** Row shape from reviewReplies.list — typed locally because the router
 *  returns a union of two drizzle selects, which breaks inference. */
interface ReplyRow {
  id: number;
  reviewerName: string;
  reviewRating: number;
  reviewText: string | null;
  draftReply: string | null;
  finalReply: string | null;
  status: string;
}

function ReviewRepliesTab() {
  const [filter, setFilter] = useState<ReplyFilter>("draft");
  const utils = trpc.useUtils();
  const { data: stats } = trpc.reviewReplies.stats.useQuery();
  const { data: replies, isLoading } = trpc.reviewReplies.list.useQuery(
    filter === "all" ? { limit: 100 } : { status: filter, limit: 100 },
  );
  const invalidate = () => {
    utils.reviewReplies.list.invalidate();
    utils.reviewReplies.stats.invalidate();
  };
  const fetchNew = trpc.reviewReplies.fetchNewReviews.useMutation({ onSuccess: invalidate });
  const approve = trpc.reviewReplies.approve.useMutation({ onSuccess: invalidate });
  const skip = trpc.reviewReplies.skip.useMutation({ onSuccess: invalidate });
  const markPosted = trpc.reviewReplies.markPosted.useMutation({ onSuccess: invalidate });
  const updateDraft = trpc.reviewReplies.updateDraft.useMutation({ onSuccess: invalidate });
  const busy = approve.isPending || skip.isPending || markPosted.isPending || updateDraft.isPending;
  const mutationError = approve.error || markPosted.error || updateDraft.error;

  const oldestApprovedDays = stats?.oldestApprovedAt
    ? Math.floor((Date.now() - new Date(stats.oldestApprovedAt).getTime()) / 86_400_000)
    : null;

  return (
    <div className="space-y-4">
      <div className="border border-blue-500/40 bg-blue-500/10 rounded p-3 text-xs text-blue-200 flex items-start gap-2">
        <Star className="w-4 h-4 shrink-0 mt-0.5 text-blue-400" />
        <span>
          <strong>Copy-only — nothing here posts to Google.</strong> The full loop:
          edit the draft if needed → Approve → Copy → paste it on the review in
          the Google Business app → then come back and tap <strong>Mark posted</strong>{" "}
          so the backlog below stays honest. Every button only marks rows in our
          database. Drafts are ordered worst rating first — handle the angry ones first.
        </span>
      </div>

      {stats && stats.approved > 0 && (
        <div className="border border-amber-500/40 bg-amber-500/10 rounded p-3 text-xs text-amber-200 flex items-start gap-2">
          <RefreshCw className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
          <span>
            <strong>
              {stats.approved} approved {stats.approved === 1 ? "reply" : "replies"} not
              marked posted yet
            </strong>
            {oldestApprovedDays !== null && oldestApprovedDays >= 1 && (
              <> — oldest approved {oldestApprovedDays} {oldestApprovedDays === 1 ? "day" : "days"} ago</>
            )}
            . Next move: copy each one, paste it on the review in the Google Business
            app, then tap "Mark posted". Already replied on Google? Just tap
            "Mark posted". (Counts our DB state only — we can't see Google's side.)
          </span>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1 flex-wrap">
          {(["draft", "approved", "skipped", "posted", "all"] as ReplyFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-1 text-[10px] font-semibold rounded border transition-colors ${
                filter === f
                  ? "bg-primary/15 text-primary border-primary/40"
                  : "text-foreground/50 border-border/30 hover:text-foreground/80"
              }`}
            >
              {f.toUpperCase()}
              {stats && f !== "all" && (
                <span className="ml-1 text-foreground/40">
                  {f === "draft" ? stats.draft : f === "approved" ? stats.approved : f === "skipped" ? stats.skipped : stats.posted}
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          onClick={() => fetchNew.mutate()}
          disabled={fetchNew.isPending}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold rounded border border-border/40 text-foreground/70 hover:text-foreground hover:border-primary/40 transition-colors"
        >
          {fetchNew.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Fetch new reviews + draft replies
        </button>
      </div>
      <p className="text-[10px] text-foreground/40 -mt-2">
        "Fetch" reads Google reviews (read-only) and AI-drafts replies into OUR database.
        It posts nothing.
        {fetchNew.data && ` Last run: ${fetchNew.data.created} new draft(s) from ${fetchNew.data.total} reviews.`}
        {fetchNew.error && " Last run failed — likely a missing Google key; see Reviews health on the Local Growth tab."}
      </p>

      {mutationError && (
        <p className="text-[10px] text-red-400 leading-relaxed flex items-start gap-1">
          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />{mutationError.message}
        </p>
      )}

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      ) : !replies?.length ? (
        <p className="text-xs text-muted-foreground py-6 text-center">
          No {filter === "all" ? "" : filter + " "}replies yet. Tap "Fetch new reviews" to pull
          the latest Google reviews and generate drafts (the daily monitor also adds them).
        </p>
      ) : (
        <div className="space-y-3">
          {replies.map((r: ReplyRow) => (
            <ReplyCard
              key={r.id}
              reply={r}
              onApprove={() => approve.mutate({ id: r.id })}
              onSkip={() => skip.mutate({ id: r.id })}
              onMarkPosted={() => markPosted.mutate({ id: r.id })}
              onSaveDraft={(draftReply) => updateDraft.mutateAsync({ id: r.id, draftReply })}
              busy={busy}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReplyCard({ reply, onApprove, onSkip, onMarkPosted, onSaveDraft, busy }: {
  reply: ReplyRow;
  onApprove: () => void; onSkip: () => void; onMarkPosted: () => void;
  onSaveDraft: (text: string) => Promise<unknown>; busy: boolean;
}) {
  // iOS-PWA-safe two-tap confirm (window.confirm is suppressed in the PWA).
  const [confirming, setConfirming] = useState<"approve" | "skip" | "posted" | null>(null);
  // null = not editing; string = the in-progress edit text.
  const [editText, setEditText] = useState<string | null>(null);
  const text = reply.finalReply || reply.draftReply || "";
  const isDraft = reply.status === "draft";
  // Live claim-safety findings on whatever text would be approved.
  const findings = isDraft ? checkReviewReply(editText ?? text) : [];
  const blockers = findings.filter((f) => f.severity === "block");

  return (
    <div className="bg-background/40 border border-border/30 rounded p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold text-foreground">{reply.reviewerName}</span>
        <span className="text-[10px] text-amber-400">{"★".repeat(reply.reviewRating)}{"☆".repeat(Math.max(0, 5 - reply.reviewRating))}</span>
        <span className={`px-1.5 py-0.5 text-[9px] font-bold border rounded uppercase ${reply.status === "posted" ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" : "bg-foreground/5 text-foreground/50 border-border/20"}`}>{reply.status}</span>
      </div>
      {reply.reviewText && <p className="text-[11px] text-foreground/60 leading-relaxed">"{reply.reviewText}"</p>}
      {editText !== null ? (
        <div className="bg-background/60 border border-border/30 rounded p-2 space-y-1.5">
          <span className="text-[9px] uppercase tracking-wider text-foreground/40 font-semibold">Edit reply draft</span>
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={3}
            maxLength={500}
            className="w-full bg-background/80 border border-border/40 rounded p-2 text-[11px] text-foreground/90 leading-relaxed focus:outline-none focus:border-primary/50"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (!editText.trim()) return;
                // Close the editor only AFTER the save lands — a failed save
                // keeps the operator's typed text on screen (the error shows
                // in the banner above) instead of silently discarding it.
                onSaveDraft(editText.trim()).then(() => setEditText(null)).catch(() => {});
              }}
              disabled={busy || !editText.trim()}
              className="px-2 py-1 text-[10px] font-semibold rounded border text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 transition-colors disabled:opacity-50"
            >
              Save draft
            </button>
            <button
              onClick={() => setEditText(null)}
              className="px-2 py-1 text-[10px] font-semibold rounded border text-foreground/50 border-border/30 hover:text-foreground/80 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : text ? (
        <div className="bg-background/60 border border-border/30 rounded p-2">
          <span className="text-[9px] uppercase tracking-wider text-foreground/40 font-semibold">Reply draft</span>
          <p className="text-[11px] text-foreground/80 leading-relaxed mt-0.5">{text}</p>
        </div>
      ) : null}
      {findings.length > 0 && (
        <div className="space-y-1">
          {findings.map((f) => (
            <p key={`${f.rule}-${f.match}`} className={`text-[10px] leading-relaxed flex items-start gap-1 ${f.severity === "block" ? "text-red-400" : "text-amber-400"}`}>
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
              <span><strong>{f.severity === "block" ? "BLOCKED" : "CHECK"}</strong> · {f.rule} ("{f.match}") — {f.fix}</span>
            </p>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <CopyBtn text={text} label="Copy reply" />
        {isDraft && editText === null && (
          <>
            <button
              onClick={() => setEditText(reply.draftReply || "")}
              disabled={busy}
              className="px-2 py-1 text-[10px] font-semibold rounded border text-foreground/60 border-border/30 hover:text-foreground/90 hover:border-primary/40 transition-colors"
            >
              Edit
            </button>
            <button
              onClick={() => (confirming === "approve" ? (onApprove(), setConfirming(null)) : setConfirming("approve"))}
              disabled={busy || blockers.length > 0}
              title={blockers.length > 0 ? "Fix the blocked wording first (Edit)" : undefined}
              className={`px-2 py-1 text-[10px] font-semibold rounded border transition-colors disabled:opacity-50 ${confirming === "approve" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/50" : "text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"}`}
            >
              {blockers.length > 0 ? "Blocked — edit first" : confirming === "approve" ? "Tap again — marks DB only" : "Approve (DB only)"}
            </button>
            <button
              onClick={() => (confirming === "skip" ? (onSkip(), setConfirming(null)) : setConfirming("skip"))}
              disabled={busy}
              className={`px-2 py-1 text-[10px] font-semibold rounded border transition-colors ${confirming === "skip" ? "bg-red-500/20 text-red-300 border-red-500/50" : "text-foreground/50 border-border/30 hover:text-foreground/80"}`}
            >
              {confirming === "skip" ? "Tap again to skip" : "Skip"}
            </button>
          </>
        )}
        {reply.status === "approved" && (
          <button
            onClick={() => (confirming === "posted" ? (onMarkPosted(), setConfirming(null)) : setConfirming("posted"))}
            disabled={busy}
            className={`px-2 py-1 text-[10px] font-semibold rounded border transition-colors ${confirming === "posted" ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/50" : "text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"}`}
          >
            {confirming === "posted" ? "Tap again — confirms you pasted it" : "Mark posted (DB only)"}
          </button>
        )}
        <ModeBadge mode="db-only" />
      </div>
    </div>
  );
}

/* ── GBP Q&A ──────────────────────────────────────────────────── */

function GbpQaTab() {
  return (
    <div className="space-y-4">
      <div className="border border-purple-500/40 bg-purple-500/10 rounded p-3 text-xs text-purple-200 flex items-start gap-2">
        <MessageCircleQuestion className="w-4 h-4 shrink-0 mt-0.5 text-purple-400" />
        <span>
          <strong>Manual posting:</strong> open your Google Business Profile → Q&A,
          post the question, then answer it from the business account. Space a few
          out over days — a burst of same-minute Q&As looks manufactured. All{" "}
          {GBP_QA_SEEDS.length} pairs below are claim-safety test-enforced (no invented
          warranties, no "guaranteed", approved $25 used-tire wording only).
        </span>
      </div>
      {GBP_QA_SEEDS.map((qa) => (
        <div key={qa.question} className="bg-background/40 border border-border/30 rounded p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-1.5 py-0.5 text-[9px] font-bold border rounded uppercase bg-foreground/5 text-foreground/50 border-border/20">{qa.category}</span>
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

function PhotoQueueTab() {
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
              <span className="px-1.5 py-0.5 text-[9px] font-bold border rounded uppercase bg-foreground/5 text-foreground/50 border-border/20">{t.category}</span>
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

function EntityTab() {
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
            <span className="px-1.5 py-0.5 text-[9px] font-bold border rounded uppercase bg-foreground/5 text-foreground/50 border-border/20">{p.status.replace("_", " ")}</span>
            <span className="px-1.5 py-0.5 text-[9px] font-bold border rounded bg-purple-500/10 text-purple-400 border-purple-500/20 inline-flex items-center gap-1"><Lock className="w-2.5 h-2.5" /> OWNER MANUAL</span>
          </div>
          <p className="text-[11px] text-foreground/70"><span className="font-semibold text-primary">Check:</span> {p.checkFields.join(" · ")}</p>
          <p className="text-[11px] text-foreground/70"><span className="font-semibold text-primary">Do:</span> {p.ownerAction}</p>
          <p className="text-[11px] text-foreground/50">Access needed: {p.accessNeeded}</p>
          <p className="text-[11px] text-amber-400/90 flex items-start gap-1"><AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />{p.riskIfIgnored}</p>
        </div>
      ))}
      <p className="text-[10px] text-foreground/30 leading-relaxed">
        Statuses are hand-maintained — nothing is marked fixed until you verify it on the
        platform. Automated listing edits violate most platforms' terms, so this stays manual
        by design.
      </p>
    </div>
  );
}

/* ── Competitors ──────────────────────────────────────────────── */

function CompetitorsTab() {
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
          <strong>Baseline {COMPETITOR_BASELINE_DATE} — a comparison anchor, not live data.</strong>{" "}
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
            : "Live Nick's review count unreachable right now — gap math hidden rather than faked. See Reviews health on the Local Growth tab."}
        </p>
      </Panel>
      <Panel title="Weekly check fields (log these per competitor)" icon={<CheckCircle2 className="w-4 h-4" />}>
        <ul className="list-disc list-inside space-y-0.5 text-[11px] text-foreground/70 mt-1">
          {WEEKLY_CHECK_FIELDS.map((f) => <li key={f}>{f}</li>)}
        </ul>
        <p className="text-[10px] text-foreground/40 mt-2">
          The daily server poller also snapshots competitor counts into the database
          (competitor_snapshots) and alerts via Telegram on big moves — a trend chart from
          those snapshots is the documented next step.
        </p>
      </Panel>
    </div>
  );
}

/* ── Social Studios ───────────────────────────────────────────── */

function StudiosTab() {
  const [showLegacy, setShowLegacy] = useState(false);

  return (
    <div className="space-y-6">
      {/* 1. Content Calendar & Draft Board */}
      <Panel title="Unified Content Draft Board" icon={<Sparkles className="w-4 h-4 text-primary" />}>
        <div className="border border-blue-500/40 bg-blue-500/10 rounded p-3 text-xs text-blue-200 flex items-start gap-2 mb-4">
          <Sparkles className="w-4 h-4 shrink-0 mt-0.5 text-blue-400" />
          <span>
            <strong>Editorial Planner:</strong> Plan, schedule, and safety-check Carousel and Reels drafts. 
            All external publishing steps are manual and claim-safe.
          </span>
        </div>
        <DraftBoardPanel />
      </Panel>

      {/* 2. Studio Launch Shortcuts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <a
          href="/admin/ig-studio"
          className="block bg-card border border-border/30 rounded-lg p-4 hover:border-primary/40 transition-colors"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-sm font-bold text-foreground">IG Carousel Intelligence Studio</span>
              <ModeBadge mode="copy-only" />
            </div>
            <ExternalLink className="w-4 h-4 text-foreground/40" />
          </div>
          <p className="text-[11px] text-foreground/60 mt-1.5 leading-relaxed">
            Generate carousel concepts, slide copy, and captions for @nicks_tire_euclid —
            then post them manually from your phone.
          </p>
        </a>
        <a
          href="/admin/reel-studio"
          className="block bg-card border border-border/30 rounded-lg p-4 hover:border-primary/40 transition-colors"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Camera className="w-4 h-4 text-primary" />
              <span className="text-sm font-bold text-foreground">Faceless Reel Intelligence Studio</span>
              <ModeBadge mode="copy-only" />
            </div>
            <ExternalLink className="w-4 h-4 text-foreground/40" />
          </div>
          <p className="text-[11px] text-foreground/60 mt-1.5 leading-relaxed">
            Plan faceless reels (hooks, shot lists, captions) — generation, publishing,
            and insights stay disabled by design; you shoot and post manually.
          </p>
        </a>
      </div>

      {/* Collapsible Legacy Automation Section */}
      <div className="border border-border/30 rounded bg-background/20 p-4">
        <button
          onClick={() => setShowLegacy(!showLegacy)}
          className="flex items-center justify-between w-full text-left"
        >
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-foreground/50" />
            <span className="text-sm font-bold text-foreground">Legacy Automation</span>
          </div>
          <span className="text-xs text-foreground/50 flex items-center gap-1">
            {showLegacy ? (
              <>
                Collapse <ChevronUp className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                Expand <ChevronDown className="w-3.5 h-3.5" />
              </>
            )}
          </span>
        </button>
        {showLegacy && (
          <div className="mt-4 border-t border-border/10 pt-4">
            <IgAutopostPanel />
          </div>
        )}
      </div>
    </div>
  );
}
