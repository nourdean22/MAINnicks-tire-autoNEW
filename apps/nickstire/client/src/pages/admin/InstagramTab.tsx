/**
 * InstagramTab — the Instagram command center inside Growth.
 *
 * A thin operator UI over the admin-gated `instagramAdmin` router. It does
 * not own any IG logic — it surfaces engines that already ship but were
 * invisible: connection/token health, the 5-report analytics pipeline, the
 * eval-gated AI autopost runner, and (new) comment moderation.
 *
 * SAFETY: nothing here posts autonomously. The token rotator and feed sync
 * are explicit owner actions; the AI co-pilot dry-runs to Telegram unless the
 * legacy_autopost_live flag is on; comment replies are claim-safety-gated.
 *
 * Built in phases — Phase 2: Connection + Analytics (this file). Composer
 * (Phase 3) and Comment moderation (Phase 4) append their own sections.
 */
import { useState, useMemo } from "react";
import {
  Instagram, Loader2, RefreshCw, AlertTriangle, CheckCircle2, KeyRound,
  TrendingUp, TrendingDown, Minus, Clock, BarChart3, Trophy, ExternalLink,
  Wand2, Heart, MessageCircle, Send, ShieldCheck, Sparkles,
  Camera, Lock, ChevronDown, ChevronUp, Film,
} from "lucide-react";
import { Panel } from "./shared";
import IgAutopostPanel from "./settings/IgAutopostPanel";
import DraftBoardPanel from "./DraftBoardPanel";
import { trpc } from "@/lib/trpc";
import { checkReviewReply } from "@shared/reviewReplyQa";

interface CaptionEval {
  viralShape: number;
  voice: number;
  priceCompliance: number;
  novelty: number;
  noFabrication: number;
  notes: string;
}

interface IgEvalScores {
  caption: CaptionEval;
  captionWeighted: number;
  image: { proLook: number | null; skipped: boolean; note: string };
  overall: number;
  passed: boolean;
}

/* ── local mini-helpers (kept tiny so the tab stays self-contained) ── */

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

const MODE_CLS = {
  "read-only": "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  "db-only": "bg-amber-500/10 text-amber-400 border-amber-500/20",
  "copy-only": "bg-blue-500/10 text-blue-400 border-blue-500/20",
  live: "bg-pink-500/10 text-pink-400 border-pink-500/20",
} as const;

const SUBTABS = [
  { id: "inbox", label: "Inbox", Icon: MessageCircle },
  { id: "create", label: "Create", Icon: Wand2 },
  { id: "publish", label: "Publish", Icon: Send },
  { id: "logs", label: "Autopost Logs", Icon: Clock },
  { id: "analytics", label: "Analytics", Icon: BarChart3 },
  { id: "settings", label: "Settings", Icon: KeyRound },
] as const;

function ModeBadge({ mode }: { mode: keyof typeof MODE_CLS }) {
  return (
    <span className={`px-1.5 py-0.5 text-[9px] font-bold border rounded uppercase ${MODE_CLS[mode]}`}>
      {mode}
    </span>
  );
}

export default function InstagramTab() {
  const [sub, setSub] = useState<(typeof SUBTABS)[number]["id"]>("inbox");
  return (
    <div className="space-y-4">
      <div className="border border-pink-500/40 bg-pink-500/10 rounded p-3 text-xs text-pink-200 flex items-start gap-2">
        <Instagram className="w-4 h-4 shrink-0 mt-0.5 text-pink-400" />
        <span>
          <strong>Instagram command center for @nicks_tire_euclid.</strong> Everything in one place —
          reply to comments (Inbox), generate content (Create), publish custom posts (Publish), review execution logs (Autopost Logs), read performance
          (Analytics), manage the connection (Settings). Nothing here posts autonomously; every
          external action is an explicit, claim-safe owner action.
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SUBTABS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSub(s.id)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded border transition-colors ${
              sub === s.id ? "bg-primary/15 text-primary border-primary/40" : "text-foreground/50 border-border/30 hover:text-foreground/80"
            }`}
          >
            <s.Icon className="w-3.5 h-3.5" />{s.label}
          </button>
        ))}
      </div>

      <div>
        {sub === "inbox" && <CommentsPanel />}
        {sub === "create" && <CreateSection />}
        {sub === "publish" && <PublishPanel />}
        {sub === "logs" && <AutopostLogsPanel />}
        {sub === "analytics" && <AnalyticsPanel />}
        {sub === "settings" && <ConnectionPanel />}
      </div>
    </div>
  );
}

/* ── Create: AI co-pilot + content studios (folded in from Social Studios) ── */

function CreateSection() {
  const [showLegacy, setShowLegacy] = useState(false);
  return (
    <div className="space-y-4">
      <CopilotPanel />

      <Panel title="Content draft board" icon={<Sparkles className="w-4 h-4 text-primary" />}>
        <div className="border border-blue-500/40 bg-blue-500/10 rounded p-3 text-xs text-blue-200 flex items-start gap-2 mb-4">
          <Sparkles className="w-4 h-4 shrink-0 mt-0.5 text-blue-400" />
          <span>
            <strong>Editorial planner:</strong> plan, schedule, and safety-check Carousel and Reels
            drafts. All external publishing steps are manual and claim-safe.
          </span>
        </div>
        <DraftBoardPanel />
      </Panel>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <a href="/admin/ig-studio" className="block bg-card border border-border/30 rounded-lg p-4 hover:border-primary/40 transition-colors">
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
        <a href="/admin/reel-studio" className="block bg-card border border-border/30 rounded-lg p-4 hover:border-primary/40 transition-colors">
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

      <div className="border border-border/30 rounded bg-background/20 p-4">
        <button onClick={() => setShowLegacy(!showLegacy)} className="flex items-center justify-between w-full text-left">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-foreground/50" />
            <span className="text-sm font-bold text-foreground">Legacy Automation</span>
          </div>
          <span className="text-xs text-foreground/50 flex items-center gap-1">
            {showLegacy ? (<>Collapse <ChevronUp className="w-3.5 h-3.5" /></>) : (<>Expand <ChevronDown className="w-3.5 h-3.5" /></>)}
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

/* ── Connection diagnostics + token rotator ───────────────────── */

function ConnectionPanel() {
  const utils = trpc.useUtils();
  const { data: status, isLoading } = trpc.instagramAdmin.getConnectionStatus.useQuery();
  const { data: account } = trpc.instagramAdmin.getAccountInfo.useQuery();
  const [token, setToken] = useState("");
  const reconnect = trpc.instagramAdmin.reconnectToken.useMutation({
    onSuccess: () => {
      setToken("");
      utils.instagramAdmin.getConnectionStatus.invalidate();
    },
  });
  const sync = trpc.instagramAdmin.syncFeed.useMutation({
    onSuccess: () => {
      utils.instagramAdmin.getLiveFeed.invalidate();
      utils.instagramAdmin.getAnalytics.invalidate();
      utils.instagramAdmin.getAccountInfo.invalidate();
    },
  });

  return (
    <Panel title="Connection" icon={<KeyRound className="w-4 h-4" />}>
      <div className="flex items-center gap-2 mb-2">
        <ModeBadge mode="read-only" />
        <span className="text-[10px] text-foreground/40">token values are never returned to the browser</span>
      </div>

      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin text-primary" />
      ) : !status ? (
        <p className="text-xs text-muted-foreground">Unavailable — check server logs.</p>
      ) : (
        <div className="space-y-2 text-xs">
          {account && (
            <div className="flex items-center gap-2 pb-2 border-b border-border/20">
              <span className="text-sm font-bold text-foreground">@{account.username}</span>
              <span className="text-foreground/50">{account.followers.toLocaleString()} followers</span>
              <span className="text-foreground/40">· {account.posts} posts</span>
            </div>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Bool value={status.configured} trueLabel="token configured" falseLabel="no token" />
            <Bool value={status.facebookReady} trueLabel="Facebook ready" falseLabel="Facebook not ready" />
            <Bool value={status.instagramReady} trueLabel="Instagram ready" falseLabel="Instagram not ready" />
            <Bool value={status.token.present} trueLabel={`durable token stored (…${status.token.last6})`} falseLabel="no durable token" />
          </div>
          {status.error && (
            <p className="text-[11px] text-amber-400 flex items-start gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />{status.error}
            </p>
          )}
          <p className="text-[10px] text-foreground/40">
            Page ID: {status.pageId ?? "—"} · IG user ID: {status.igUserId ?? "—"}
          </p>
        </div>
      )}

      {/* One-tap token rotator */}
      <div className="mt-3 pt-3 border-t border-border/20 space-y-1.5">
        <span className="text-[10px] uppercase tracking-wider text-foreground/40 font-semibold">Rotate token</span>
        <p className="text-[10px] text-foreground/50 leading-relaxed">
          Paste a fresh short-lived user token from the Graph API Explorer
          (scopes: pages_manage_posts, instagram_content_publish, instagram_manage_comments).
          The server mints a never-expiring Page token — the token never touches this screen.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="short-lived user token"
            className="flex-1 bg-background/80 border border-border/40 rounded px-2 py-1.5 text-[11px] text-foreground/90 focus:outline-none focus:border-primary/50"
          />
          <button
            onClick={() => reconnect.mutate({ userToken: token.trim() })}
            disabled={reconnect.isPending || token.trim().length < 10}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold rounded border border-border/40 text-foreground/70 hover:text-foreground hover:border-primary/40 transition-colors disabled:opacity-50 shrink-0"
          >
            {reconnect.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <KeyRound className="w-3 h-3" />}
            Rotate
          </button>
          <button
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold rounded border border-border/40 text-foreground/70 hover:text-foreground hover:border-primary/40 transition-colors disabled:opacity-50 shrink-0"
          >
            {sync.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Sync feed
          </button>
        </div>
        {reconnect.data?.ok && <p className="text-[10px] text-emerald-400">Token rotated — connection refreshed.</p>}
        {reconnect.data && !reconnect.data.ok && (
          <p className="text-[10px] text-red-400 flex items-start gap-1">
            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />{reconnect.data.error}
          </p>
        )}
        {sync.data && (
          <p className="text-[10px] text-foreground/50">
            Synced — {sync.data.processed} processed, {sync.data.newPosts} new, {sync.data.errors} errors.
          </p>
        )}
      </div>
    </Panel>
  );
}

/* ── Content-intelligence dashboard (the 5 hidden reports) ─────── */

const TREND_ICON = {
  growing: <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />,
  declining: <TrendingDown className="w-3.5 h-3.5 text-red-400" />,
  stable: <Minus className="w-3.5 h-3.5 text-foreground/50" />,
};

function fmtHour(h: number): string {
  const period = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr} ${period}`;
}

function AnalyticsPanel() {
  const { data, isLoading } = trpc.instagramAdmin.getAnalytics.useQuery();

  if (isLoading) {
    return (
      <Panel title="Content intelligence" icon={<BarChart3 className="w-4 h-4" />}>
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      </Panel>
    );
  }

  const hasData =
    data &&
    (data.followerGrowth.currentFollowers > 0 ||
      data.topPosts.length > 0 ||
      data.engagementByType.length > 0 ||
      data.bestPostingTimes.length > 0);

  if (!hasData) {
    return (
      <Panel title="Content intelligence" icon={<BarChart3 className="w-4 h-4" />}>
        <p className="text-xs text-muted-foreground py-4 text-center">
          No analytics yet. Tap <strong>Sync feed</strong> above to pull recent posts
          and build the engagement history.
        </p>
      </Panel>
    );
  }

  const fg = data.followerGrowth;

  return (
    <Panel title="Content intelligence" icon={<BarChart3 className="w-4 h-4" />}>
      <div className="flex items-center gap-2 mb-3">
        <ModeBadge mode="read-only" />
        <span className="text-[10px] text-foreground/40">computed from synced post history — never faked</span>
      </div>

      {/* Follower growth */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-background/40 border border-border/30 rounded p-2.5">
          <div className="text-[10px] text-foreground/40 uppercase tracking-wide">Followers</div>
          <div className="text-lg font-bold text-foreground">{fg.currentFollowers.toLocaleString()}</div>
          <div className="flex items-center gap-1 text-[10px] text-foreground/50">{TREND_ICON[fg.trend]} {fg.trend}</div>
        </div>
        <div className="bg-background/40 border border-border/30 rounded p-2.5">
          <div className="text-[10px] text-foreground/40 uppercase tracking-wide">7-day</div>
          <div className={`text-lg font-bold ${fg.growthRate7d >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {fg.growthRate7d >= 0 ? "+" : ""}{fg.growthRate7d.toFixed(1)}%
          </div>
        </div>
        <div className="bg-background/40 border border-border/30 rounded p-2.5">
          <div className="text-[10px] text-foreground/40 uppercase tracking-wide">30-day</div>
          <div className={`text-lg font-bold ${fg.growthRate30d >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {fg.growthRate30d >= 0 ? "+" : ""}{fg.growthRate30d.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Best posting times */}
      {data.bestPostingTimes.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground/70 mb-1.5">
            <Clock className="w-3.5 h-3.5 text-primary" /> Best times to post
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.bestPostingTimes.slice(0, 5).map((t) => (
              <span key={`${t.dayOfWeek}-${t.hourOfDay}`} className="px-2 py-1 text-[10px] bg-background/40 border border-border/30 rounded text-foreground/70">
                {t.dayName} {fmtHour(t.hourOfDay)}
                <span className="text-foreground/40"> · {t.avgEngagement.toFixed(0)} eng</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Engagement by type */}
      {data.engagementByType.length > 0 && (
        <div className="mb-4">
          <div className="text-[11px] font-semibold text-foreground/70 mb-1.5">Engagement by content type</div>
          <div className="space-y-1">
            {data.engagementByType.map((e) => (
              <div key={e.type} className="flex items-center justify-between text-[11px] bg-background/40 border border-border/30 rounded px-2.5 py-1.5">
                <span className="font-semibold text-foreground/80">{e.type}</span>
                <span className="text-foreground/50">
                  {e.postCount} posts · {e.avgLikes.toFixed(0)} likes · {e.avgComments.toFixed(0)} comments · {e.avgEngagementRate.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top posts */}
      {data.topPosts.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground/70 mb-1.5">
            <Trophy className="w-3.5 h-3.5 text-amber-400" /> Top posts
          </div>
          <div className="space-y-1.5">
            {data.topPosts.map((p, i) => (
              <div key={p.postId} className="flex items-start gap-2 text-[11px] bg-background/40 border border-border/30 rounded p-2">
                <span className="text-foreground/30 font-bold shrink-0">#{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-foreground/70 truncate">{p.caption || <span className="italic text-foreground/40">(no caption)</span>}</p>
                  <p className="text-[10px] text-foreground/40">
                    {p.postType} · {p.likes} likes · {p.comments} comments · {p.engagementRate.toFixed(1)}% eng
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ── AI co-pilot (generate + eval — dry-run / Telegram-preview safe) ── */

const ARCHETYPES: { id: "auto" | "proof" | "anti" | "math" | "seasonal" | "question" | "process"; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "proof", label: "Proof" },
  { id: "anti", label: "Anti-promise" },
  { id: "math", label: "Math" },
  { id: "seasonal", label: "Seasonal" },
  { id: "question", label: "Q&A" },
  { id: "process", label: "Process" },
];

function scoreColor(v: number): string {
  return v >= 0.7 ? "text-emerald-400" : v >= 0.5 ? "text-amber-400" : "text-red-400";
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === "posted" ? "text-emerald-400 border-emerald-500/30"
    : status === "dryrun" ? "text-blue-400 border-blue-500/30"
    : status === "aborted" ? "text-amber-400 border-amber-500/30"
    : "text-red-400 border-red-500/30";
  return <span className={`px-1.5 py-0.5 text-[9px] font-bold border rounded uppercase ${cls}`}>{status}</span>;
}

function PhoneMockup({ username, caption, mediaUrl }: {
  username: string;
  caption?: string;
  mediaUrl?: string | null;
}) {
  const isVideo = mediaUrl?.match(/\.(mp4|mov|webm|ogg)/i) || mediaUrl?.includes("video");
  return (
    <div className="mx-auto w-full max-w-[240px] bg-black rounded-[1.4rem] border-4 border-neutral-800 overflow-hidden shadow-xl relative">
      <div className="flex items-center gap-2 px-3 py-2 bg-neutral-950">
        <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-amber-500 to-pink-500" />
        <span className="text-[11px] font-semibold text-white">{username}</span>
        <span className="ml-auto text-white/40 text-xs">···</span>
      </div>
      <div className="aspect-square bg-neutral-900 flex items-center justify-center relative">
        {mediaUrl ? (
          isVideo ? (
            <video
              src={mediaUrl}
              controls
              loop
              muted
              playsInline
              className="w-full h-full object-cover"
            />
          ) : (
            <img src={mediaUrl} alt="generated draft" className="w-full h-full object-cover" />
          )
        ) : (
          <div className="text-center text-white/30 text-[10px] px-4">
            <Instagram className="w-8 h-8 mx-auto mb-1 opacity-40" />
            No media preview available
          </div>
        )}
      </div>
      <div className="px-3 py-2 bg-neutral-950 space-y-1.5 min-h-[90px]">
        <div className="flex items-center gap-3 text-white/80">
          <Heart className="w-4 h-4" /><MessageCircle className="w-4 h-4" /><Send className="w-4 h-4" />
        </div>
        {caption ? (
          <p className="text-[10px] text-white/70 leading-relaxed max-h-24 overflow-y-auto whitespace-pre-wrap">
            <span className="font-semibold text-white">@{username} </span>{caption}
          </p>
        ) : (
          <p className="text-[10px] text-white/30 italic">No caption</p>
        )}
      </div>
    </div>
  );
}

function CopilotPanel() {
  const utils = trpc.useUtils();
  const { data: account } = trpc.instagramAdmin.getAccountInfo.useQuery();
  const { data: recent } = trpc.instagramAdmin.getRecentGenerations.useQuery({ limit: 6 });
  const [archetype, setArchetype] = useState<(typeof ARCHETYPES)[number]["id"]>("auto");
  const [selectedDraftId, setSelectedDraftId] = useState<number | null>(null);
  const generate = trpc.instagramAdmin.generatePost.useMutation({
    onSuccess: () => {
      setSelectedDraftId(null);
      utils.instagramAdmin.getRecentGenerations.invalidate();
    },
  });

  const latest = recent?.[0];
  const selectedDraft = useMemo(() => {
    if (!recent) return undefined;
    if (selectedDraftId === null) return latest;
    return recent.find((g) => g.id === selectedDraftId) || latest;
  }, [recent, selectedDraftId, latest]);

  const username = account?.username || "nicks_tire_euclid";
  const result = generate.data;
  const scores = result?.scores;

  return (
    <Panel title="AI co-pilot" icon={<Wand2 className="w-4 h-4" />}>
      <div className="flex items-center gap-2 mb-2">
        <ModeBadge mode="db-only" />
        <span className="text-[10px] text-foreground/40">
          drafts + previews to Telegram — live posting stays governed by the autopost kill-switch
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {ARCHETYPES.map((a) => (
          <button
            key={a.id}
            onClick={() => setArchetype(a.id)}
            className={`px-2 py-1 text-[10px] font-semibold rounded border transition-colors ${
              archetype === a.id
                ? "bg-primary/15 text-primary border-primary/40"
                : "text-foreground/50 border-border/30 hover:text-foreground/80"
            }`}
          >
            {a.label}
          </button>
        ))}
        <button
          onClick={() => generate.mutate(archetype === "auto" ? {} : { archetype })}
          disabled={generate.isPending}
          className="inline-flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold rounded border border-primary/40 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
        >
          {generate.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          {generate.isPending ? "Generating…" : "Generate"}
        </button>
      </div>

      {result && (
        <div className="mb-3 space-y-2">
          <div className={`rounded p-2.5 text-[11px] flex items-start gap-2 border ${
            result.status === "posted" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
            : result.status === "dryrun" ? "border-blue-500/40 bg-blue-500/10 text-blue-200"
            : result.status === "aborted" ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
            : "border-red-500/40 bg-red-500/10 text-red-200"
          }`}>
            {result.status === "aborted" || result.status === "failed"
              ? <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              : <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />}
            <span>{result.details}</span>
          </div>

          {scores && (
            <div className="bg-background/40 border border-border/30 rounded p-2.5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-foreground/70 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-primary" /> Score gate
                </span>
                <span className={`text-[11px] font-bold ${scores.passed ? "text-emerald-400" : "text-red-400"}`}>
                  {(scores.overall * 100).toFixed(0)} {scores.passed ? "· PASS" : "· BELOW GATE"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {([
                  ["Viral shape", scores.caption.viralShape],
                  ["Voice", scores.caption.voice],
                  ["Price-safe", scores.caption.priceCompliance],
                  ["Novelty", scores.caption.novelty],
                  ["No fabrication", scores.caption.noFabrication],
                ] as const).map(([label, v]) => (
                  <div key={label} className="flex items-center justify-between text-[10px]">
                    <span className="text-foreground/50">{label}</span>
                    <span className={scoreColor(v)}>{(v * 100).toFixed(0)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-foreground/50">Image</span>
                  <span className={scores.image.skipped ? "text-foreground/40" : scoreColor(scores.image.proLook ?? 0)}>
                    {scores.image.skipped ? "skipped" : (((scores.image.proLook ?? 0)) * 100).toFixed(0)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PhoneMockup
          username={username}
          caption={selectedDraft?.caption}
          mediaUrl={selectedDraft?.imageUrl}
        />
        <div>
          <div className="text-[11px] font-semibold text-foreground/70 mb-1.5">Recent drafts</div>
          {!recent?.length ? (
            <p className="text-[11px] text-foreground/40">No generations yet — pick an angle and tap Generate.</p>
          ) : (
            <div className="space-y-1.5">
              {recent.map((g) => {
                const isActive = selectedDraftId === g.id || (selectedDraftId === null && g.id === latest?.id);
                return (
                  <button
                    key={g.id}
                    onClick={() => setSelectedDraftId(g.id)}
                    className={`w-full text-left flex items-center justify-between gap-2 text-[10px] bg-background/40 border rounded px-2.5 py-1.5 transition-all hover:bg-background/60 hover:border-primary/40 ${
                      isActive ? "border-primary bg-primary/5 text-foreground" : "border-border/30 text-foreground/70"
                    }`}
                  >
                    <span className="font-semibold capitalize truncate">{g.archetype}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      {typeof g.overallScore === "number" && (
                        <span className={scoreColor(g.overallScore / 100)}>{g.overallScore}</span>
                      )}
                      <StatusPill status={g.status} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

function AutopostLogsPanel() {
  const { data: logs, isLoading, error } = trpc.instagramAdmin.getRecentGenerations.useQuery({ limit: 50 });
  const [selectedLogId, setSelectedLogId] = useState<number | null>(null);
  const { data: account } = trpc.instagramAdmin.getAccountInfo.useQuery();
  const username = account?.username || "nicks_tire_euclid";

  const selectedLog = useMemo(() => {
    if (!logs) return null;
    return logs.find((l) => l.id === selectedLogId) || logs[0] || null;
  }, [logs, selectedLogId]);

  const parsedScores = useMemo<IgEvalScores | null>(() => {
    if (!selectedLog?.evalScoresJson) return null;
    try {
      return JSON.parse(selectedLog.evalScoresJson) as IgEvalScores;
    } catch (err) {
      console.error("Failed to parse eval scores", err);
      return null;
    }
  }, [selectedLog]);

  if (isLoading) {
    return (
      <Panel title="Autopost execution logs" icon={<Clock className="w-4 h-4" />}>
        <div className="flex justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
        </div>
      </Panel>
    );
  }

  if (error) {
    return (
      <Panel title="Autopost execution logs" icon={<Clock className="w-4 h-4" />}>
        <div className="border border-red-500/40 bg-red-500/10 rounded p-3 text-xs text-red-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Error loading logs: {error.message}</span>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Autopost execution logs" icon={<Clock className="w-4 h-4" />}>
      <div className="flex items-center gap-2 mb-3">
        <ModeBadge mode="read-only" />
        <span className="text-[10px] text-foreground/40">
          durable logs of past AI-copilot generations and evaluation gates
        </span>
      </div>

      {!logs?.length ? (
        <p className="text-xs text-muted-foreground py-4 text-center">No logs found.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Left Pane: Log List (5 cols) */}
          <div className="lg:col-span-5 space-y-2 max-h-[600px] overflow-y-auto pr-1">
            <div className="text-[11px] font-semibold text-foreground/60 px-1">Recent Runs (Last 50)</div>
            <div className="space-y-1.5">
              {logs.map((logItem) => {
                const isActive = selectedLog?.id === logItem.id;
                const formattedDate = new Date(logItem.createdAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                });
                return (
                  <button
                    key={logItem.id}
                    onClick={() => setSelectedLogId(logItem.id)}
                    className={`w-full text-left p-2.5 rounded border transition-all hover:bg-background/60 flex flex-col gap-1.5 ${
                      isActive
                        ? "bg-primary/10 border-primary/50 text-foreground animate-pulse"
                        : "bg-background/20 border-border/30 text-foreground/70"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 w-full">
                      <span className="font-semibold text-xs capitalize text-foreground">
                        {logItem.archetype}
                      </span>
                      <span className="text-[9px] text-foreground/40 shrink-0">{formattedDate}</span>
                    </div>

                    <div className="flex items-center justify-between gap-2 w-full text-[10px]">
                      <div className="flex items-center gap-1.5">
                        <StatusPill status={logItem.status} />
                        <span className="px-1 py-0.2 bg-background/40 border border-border/20 rounded-[3px] text-[8px] uppercase font-medium text-foreground/50">
                          {logItem.source}
                        </span>
                      </div>
                      {typeof logItem.overallScore === "number" && (
                        <span className={`font-bold ${scoreColor(logItem.overallScore / 100)}`}>
                          Score: {logItem.overallScore}
                        </span>
                      )}
                    </div>

                    {logItem.error && (
                      <p className="text-[9px] text-red-400 line-clamp-1 italic">
                        {logItem.error}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Pane: Detailed Inspector (7 cols) */}
          <div className="lg:col-span-7 bg-background/25 border border-border/30 rounded-lg p-4 space-y-4">
            {selectedLog ? (
              <>
                <div className="flex items-start justify-between gap-3 border-b border-border/20 pb-3 flex-wrap">
                  <div>
                    <h3 className="text-sm font-bold text-foreground flex items-center gap-1.5">
                      <span className="capitalize">{selectedLog.archetype}</span> run #{selectedLog.id}
                    </h3>
                    <p className="text-[10px] text-foreground/50 mt-0.5">
                      Fired on {new Date(selectedLog.createdAt).toLocaleString()} via {selectedLog.source}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <StatusPill status={selectedLog.status} />
                    {selectedLog.overallScore !== null && (
                      <span className={`text-sm font-extrabold px-2 py-0.5 rounded border bg-background/40 ${
                        scoreColor(selectedLog.overallScore / 100)
                      }`}>
                        {selectedLog.overallScore} / 100
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Left sub-pane: Metadata & Eval breakdown */}
                  <div className="space-y-3.5">
                    <div>
                      <span className="text-[9px] uppercase tracking-wider text-foreground/40 font-semibold block mb-1">
                        Concept Key
                      </span>
                      <code className="text-[10px] bg-neutral-900 border border-border/20 px-1.5 py-0.5 rounded text-primary">
                        {selectedLog.conceptKey}
                      </code>
                    </div>

                    {selectedLog.error && (
                      <div className="border border-red-500/30 bg-red-500/5 rounded p-2.5 space-y-1">
                        <span className="text-[9px] font-bold text-red-400 block uppercase">
                          Execution Error / Notes
                        </span>
                        <p className="text-[10px] text-red-300 leading-relaxed font-mono whitespace-pre-wrap">
                          {selectedLog.error}
                        </p>
                      </div>
                    )}

                    {/* Scores Section */}
                    {parsedScores ? (
                      <div className="space-y-2 bg-neutral-900/40 border border-border/20 rounded p-3">
                        <div className="flex items-center justify-between border-b border-border/10 pb-1.5 mb-1.5">
                          <span className="text-[10px] font-bold text-foreground/80 flex items-center gap-1">
                            <ShieldCheck className="w-3.5 h-3.5 text-primary" /> Evaluation Rubric
                          </span>
                          <span className={`text-[10px] font-bold ${parsedScores.passed ? "text-emerald-400" : "text-red-400"}`}>
                            {parsedScores.passed ? "PASS" : "BELOW GATE"}
                          </span>
                        </div>

                        <div className="space-y-2">
                          {/* Caption evaluation dimensions */}
                          {([
                            ["Viral shape", parsedScores.caption.viralShape],
                            ["Voice", parsedScores.caption.voice],
                            ["Price-safe", parsedScores.caption.priceCompliance],
                            ["Novelty", parsedScores.caption.novelty],
                            ["No fabrication", parsedScores.caption.noFabrication],
                          ] as const).map(([label, score]) => (
                            <div key={label} className="space-y-0.5">
                              <div className="flex items-center justify-between text-[10px]">
                                <span className="text-foreground/50">{label}</span>
                                <span className={scoreColor(score)}>{Math.round(score * 100)}%</span>
                              </div>
                              <div className="w-full h-1 bg-border/20 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${
                                    score >= 0.7 ? "bg-emerald-500" : score >= 0.5 ? "bg-amber-500" : "bg-red-500"
                                  }`}
                                  style={{ width: `${score * 100}%` }}
                                />
                              </div>
                            </div>
                          ))}

                          {/* Image evaluation */}
                          <div className="space-y-0.5">
                            <div className="flex items-center justify-between text-[10px]">
                              <span className="text-foreground/50">Image Pro-Look</span>
                              <span className={parsedScores.image.skipped ? "text-foreground/40" : scoreColor(parsedScores.image.proLook ?? 0)}>
                                {parsedScores.image.skipped ? "skipped" : `${Math.round((parsedScores.image.proLook ?? 0) * 100)}%`}
                              </span>
                            </div>
                            <div className="w-full h-1 bg-border/20 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${
                                  parsedScores.image.skipped
                                    ? "bg-foreground/25"
                                    : (parsedScores.image.proLook ?? 0) >= 0.6
                                    ? "bg-emerald-500"
                                    : "bg-red-500"
                                }`}
                                style={{ width: `${parsedScores.image.skipped ? 0 : (parsedScores.image.proLook ?? 0) * 100}%` }}
                              />
                            </div>
                          </div>
                        </div>

                        {parsedScores.caption.notes && (
                          <div className="border-t border-border/10 pt-2 mt-2">
                            <span className="text-[8px] font-bold uppercase text-foreground/40 block mb-0.5">
                              Critic Notes
                            </span>
                            <p className="text-[10px] text-foreground/60 leading-relaxed italic">
                              "{parsedScores.caption.notes}"
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-3 text-[10px] text-foreground/40 border border-border/20 rounded bg-neutral-900/10 italic text-center">
                        No evaluation metrics saved for this run
                      </div>
                    )}

                    {/* Publish/API Info */}
                    <div className="space-y-1 text-[10px] text-foreground/50 bg-background/10 border border-border/20 rounded p-2.5 font-mono">
                      <div className="flex justify-between">
                        <span>IG Post ID:</span>
                        <span className="text-foreground/80">{selectedLog.igPostId || "—"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>FB Post ID:</span>
                        <span className="text-foreground/80">{selectedLog.fbPostId || "—"}</span>
                      </div>
                      {selectedLog.imageUrl && (
                        <div className="pt-1 mt-1 border-t border-border/15 overflow-hidden text-ellipsis whitespace-nowrap">
                          <span className="block text-[8px] text-foreground/35 uppercase">Media URL:</span>
                          <a
                            href={selectedLog.imageUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            {selectedLog.imageUrl}
                          </a>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right sub-pane: Phone Mockup Frame */}
                  <div className="flex items-center justify-center">
                    <PhoneMockup
                      username={username}
                      caption={selectedLog.caption}
                      mediaUrl={selectedLog.imageUrl}
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="h-64 flex items-center justify-center text-xs text-muted-foreground italic">
                Select a log from the list to inspect details.
              </div>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ── Comment moderation (live replies — claim-safety gated) ───── */

interface IgCommentVM { id: string; text: string; username: string; timestamp: string; likeCount: number }

function CommentModerationRow({ comment }: { comment: IgCommentVM }) {
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState(false);
  const suggest = trpc.instagramAdmin.suggestReply.useMutation({
    onSuccess: (r) => setDraft(r.draft),
  });
  const reply = trpc.instagramAdmin.postReply.useMutation({
    onSuccess: () => { setDraft(""); setConfirming(false); },
  });
  const findings = draft ? checkReviewReply(draft) : [];
  const blockers = findings.filter((f) => f.severity === "block");
  const isQuestion = comment.text.includes("?");

  return (
    <div className="bg-background/40 border border-border/30 rounded p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold text-foreground">@{comment.username || "user"}</span>
        {isQuestion && (
          <span className="px-1.5 py-0.5 text-[9px] font-bold border rounded bg-blue-500/10 text-blue-400 border-blue-500/20">QUESTION</span>
        )}
        <span className="text-[10px] text-foreground/40">{comment.likeCount} likes</span>
      </div>
      <p className="text-[11px] text-foreground/70 leading-relaxed">{comment.text}</p>

      <div className="bg-background/60 border border-border/30 rounded p-2 space-y-1.5">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Write a reply, or tap Suggest…"
          className="w-full bg-background/80 border border-border/40 rounded p-2 text-[11px] text-foreground/90 leading-relaxed focus:outline-none focus:border-primary/50"
        />
        {findings.map((f) => (
          <p key={`${f.rule}-${f.match}`} className={`text-[10px] leading-relaxed flex items-start gap-1 ${f.severity === "block" ? "text-red-400" : "text-amber-400"}`}>
            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
            <span><strong>{f.severity === "block" ? "BLOCKED" : "CHECK"}</strong> · {f.rule} ("{f.match}") — {f.fix}</span>
          </p>
        ))}
        <div className="flex items-center gap-2">
          <button
            onClick={() => suggest.mutate({ commentText: comment.text })}
            disabled={suggest.isPending}
            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded border border-border/40 text-foreground/70 hover:text-foreground hover:border-primary/40 transition-colors disabled:opacity-50"
          >
            {suggest.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Suggest
          </button>
          <button
            onClick={() => {
              if (confirming) reply.mutate({ commentId: comment.id, message: draft.trim() });
              else setConfirming(true);
            }}
            disabled={reply.isPending || !draft.trim() || blockers.length > 0}
            title={blockers.length ? "Fix the blocked wording first" : undefined}
            className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded border transition-colors disabled:opacity-50 ${
              confirming ? "bg-pink-500/20 text-pink-300 border-pink-500/50" : "text-pink-400 border-pink-500/30 hover:bg-pink-500/10"
            }`}
          >
            {reply.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            {blockers.length ? "Blocked — edit first" : confirming ? "Tap again — posts to Instagram" : "Reply (live)"}
          </button>
        </div>
        {reply.error && (
          <p className="text-[10px] text-red-400 flex items-start gap-1">
            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />{reply.error.message}
          </p>
        )}
        {reply.data?.success && <p className="text-[10px] text-emerald-400">Reply posted to Instagram.</p>}
      </div>
    </div>
  );
}

function CommentsPanel() {
  const { data: feed } = trpc.instagramAdmin.getLiveFeed.useQuery({ limit: 12 });
  const [mediaId, setMediaId] = useState<string | null>(null);
  const { data: commentsRes, isLoading } = trpc.instagramAdmin.getComments.useQuery(
    { mediaId: mediaId ?? "" },
    { enabled: !!mediaId },
  );

  // Questions first — a cheap, honest triage (no faked sentiment scoring):
  // a follower asking a question is the highest-value reply to not miss.
  const comments = [...(commentsRes?.comments ?? [])].sort(
    (a, b) => Number(b.text.includes("?")) - Number(a.text.includes("?")),
  );

  return (
    <Panel title="Comment moderation" icon={<MessageCircle className="w-4 h-4" />}>
      <div className="flex items-center gap-2 mb-2">
        <ModeBadge mode="live" />
        <span className="text-[10px] text-foreground/40">replies post to Instagram — claim-safety-gated, two-tap to confirm</span>
      </div>
      {!feed?.length ? (
        <p className="text-xs text-muted-foreground py-3">No posts in the cache yet — tap <strong>Sync feed</strong> above.</p>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-2 mb-2">
            {feed.map((p) => (
              <button
                key={p.id}
                onClick={() => setMediaId(p.id)}
                className={`shrink-0 w-16 h-16 rounded border overflow-hidden relative ${mediaId === p.id ? "border-primary" : "border-border/30"}`}
              >
                {p.thumbnailUrl || p.mediaUrl ? (
                  <img src={p.thumbnailUrl || p.mediaUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-neutral-800 flex items-center justify-center"><Instagram className="w-4 h-4 text-white/30" /></div>
                )}
                <span className="absolute bottom-0 right-0 bg-black/70 text-white text-[8px] px-1 rounded-tl flex items-center gap-0.5">
                  <MessageCircle className="w-2 h-2" />{p.comments}
                </span>
              </button>
            ))}
          </div>
          {!mediaId ? (
            <p className="text-[11px] text-foreground/40">Pick a post above to load its comments.</p>
          ) : isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : commentsRes && !commentsRes.ok ? (
            <p className="text-[11px] text-amber-400 flex items-start gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />{commentsRes.error}
            </p>
          ) : !comments.length ? (
            <p className="text-[11px] text-foreground/40">No comments on this post.</p>
          ) : (
            <div className="space-y-2">
              {comments.map((c) => <CommentModerationRow key={c.id} comment={c} />)}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function PublishPanel() {
  const [mediaType, setMediaType] = useState<"image" | "video">("image");
  const [caption, setCaption] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pubStatus, setPubStatus] = useState<{ type: "success" | "error" | null; msg: string }>({ type: null, msg: "" });

  const { data: account } = trpc.instagramAdmin.getAccountInfo.useQuery();
  const username = account?.username || "nicks_tire_euclid";

  const publishMutation = trpc.instagramAdmin.publishPost.useMutation({
    onSuccess: (data) => {
      setConfirming(false);
      setCaption("");
      setMediaUrl("");
      setPubStatus({
        type: "success",
        msg: `Successfully published custom post live to Instagram! Post ID: ${data.postId || "unknown"}`,
      });
    },
    onError: (err) => {
      setConfirming(false);
      setPubStatus({
        type: "error",
        msg: `Publish failed: ${err.message}`,
      });
    },
  });

  const isValid = caption.trim().length > 0 && mediaUrl.trim().startsWith("http");

  return (
    <Panel title="Direct Publisher" icon={<Send className="w-4 h-4" />}>
      <div className="flex items-center gap-2 mb-3">
        <ModeBadge mode="live" />
        <span className="text-[10px] text-foreground/40">
          publish custom image or video/Reel directly to @{username}
        </span>
      </div>

      {pubStatus.type && (
        <div className={`mb-4 rounded p-2.5 text-[11px] flex items-start gap-2 border ${
          pubStatus.type === "success"
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
            : "border-red-500/40 bg-red-500/10 text-red-200"
        }`}>
          {pubStatus.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span>{pubStatus.msg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Side: Form (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="space-y-2">
            <span className="text-[10px] uppercase tracking-wider text-foreground/50 font-semibold block">
              1. Media Type
            </span>
            <div className="flex bg-neutral-900 border border-border/40 rounded p-0.5 w-fit">
              <button
                type="button"
                onClick={() => {
                  setMediaType("image");
                  setConfirming(false);
                  setPubStatus({ type: null, msg: "" });
                }}
                className={`px-3 py-1.5 rounded text-xs font-bold transition-all ${
                  mediaType === "image"
                    ? "bg-primary/20 text-primary"
                    : "text-foreground/40 hover:text-foreground/60"
                }`}
              >
                Single Image
              </button>
              <button
                type="button"
                onClick={() => {
                  setMediaType("video");
                  setConfirming(false);
                  setPubStatus({ type: null, msg: "" });
                }}
                className={`px-3 py-1.5 rounded text-xs font-bold transition-all ${
                  mediaType === "video"
                    ? "bg-primary/20 text-primary"
                    : "text-foreground/40 hover:text-foreground/60"
                }`}
              >
                Video / Reel
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-foreground/50 font-semibold block">
              2. Media URL (Public HTTPS only)
            </span>
            <input
              type="url"
              placeholder={
                mediaType === "image"
                  ? "https://example.com/image.jpg"
                  : "https://example.com/video.mp4"
              }
              value={mediaUrl}
              onChange={(e) => {
                setMediaUrl(e.target.value);
                setConfirming(false);
                setPubStatus({ type: null, msg: "" });
              }}
              className="w-full bg-background/80 border border-border/40 rounded p-2 text-xs text-foreground/90 focus:outline-none focus:border-primary/50"
            />
            <p className="text-[10px] text-foreground/40 leading-normal">
              Meta fetches the media server-side. The file must be a public HTTPS URL (JPG/JPEG for images, MP4/MOV for reels).
            </p>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-[10px] uppercase tracking-wider text-foreground/50 font-semibold">
                3. Caption
              </span>
              <span className={`text-[10px] ${caption.length > 2200 ? "text-red-400 font-bold" : "text-foreground/40"}`}>
                {caption.length} / 2200
              </span>
            </div>
            <textarea
              placeholder="Write your caption here... (hashtags are recommended at the end)"
              value={caption}
              onChange={(e) => {
                setCaption(e.target.value);
                setConfirming(false);
                setPubStatus({ type: null, msg: "" });
              }}
              rows={6}
              className="w-full bg-background/80 border border-border/40 rounded p-2.5 text-xs text-foreground/95 leading-relaxed focus:outline-none focus:border-primary/50"
            />
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => {
                if (!isValid) return;
                if (confirming) {
                  publishMutation.mutate({
                    caption,
                    imageUrl: mediaType === "image" ? mediaUrl : undefined,
                    videoUrl: mediaType === "video" ? mediaUrl : undefined,
                  });
                } else {
                  setConfirming(true);
                }
              }}
              disabled={!isValid || publishMutation.isPending}
              className={`w-full py-2.5 rounded font-bold text-xs border transition-all duration-200 ${
                !isValid
                  ? "bg-neutral-800 text-neutral-500 border-neutral-700 cursor-not-allowed"
                  : publishMutation.isPending
                  ? "bg-neutral-900 border-neutral-800 text-neutral-400"
                  : confirming
                  ? "bg-pink-600 text-white border-pink-500 animate-pulse hover:bg-pink-700"
                  : "bg-primary/20 text-primary border-primary/40 hover:bg-primary/30"
              }`}
            >
              {publishMutation.isPending ? (
                <span className="flex items-center justify-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Publishing (polls up to 150s)...
                </span>
              ) : !isValid ? (
                "Fill in caption and valid URL to publish"
              ) : confirming ? (
                "Tap again to confirm - publishes live to @instagram"
              ) : (
                "Publish Live to Instagram"
              )}
            </button>
            {confirming && (
              <p className="text-[10px] text-pink-400 text-center mt-1.5 font-medium">
                Warning: This posts live to the Euclid shop Instagram feed immediately.
              </p>
            )}
          </div>
        </div>

        {/* Right Side: Live Feed Preview (5 cols) */}
        <div className="lg:col-span-5 flex flex-col items-center justify-center bg-background/20 border border-border/20 rounded-lg p-4">
          <span className="text-[10px] uppercase tracking-wider text-foreground/50 font-semibold block mb-3">
            Feed Preview
          </span>
          <PhoneMockup
            username={username}
            caption={caption}
            mediaUrl={mediaUrl || null}
          />
        </div>
      </div>
    </Panel>
  );
}

