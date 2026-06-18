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
import { useState, useMemo, useEffect, useRef } from "react";
import {
  Instagram, Loader2, RefreshCw, AlertTriangle, CheckCircle2, KeyRound, Settings2,
  TrendingUp, TrendingDown, Minus, Clock, BarChart3, Trophy, ExternalLink,
  Wand2, Heart, MessageCircle, Send, ShieldCheck, Sparkles,
  Camera, Lock, ChevronDown, ChevronUp, Film,
  Grid, List, Play, Pause, Volume2, VolumeX, X,
  Image, Search, SlidersHorizontal, ArrowUpDown, Star,
} from "lucide-react";
import { toast } from "sonner";
import { Panel } from "./shared";
import IgAutopostPanel from "./settings/IgAutopostPanel";
import DraftBoardPanel from "./DraftBoardPanel";
import { trpc } from "@/lib/trpc";
import { checkReviewReply } from "@shared/reviewReplyQa";
import { classifyComment, COMMENT_KIND_BADGE } from "@/lib/commentTriage";

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
  { id: "feed", label: "Feed Explorer", Icon: Film },
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

/** Always-on one-glance social health — bridges IG connection, AI provider
 *  health (the dead-fallback trap), autopost failures, and the Google-review
 *  reply backlog. Pure aggregation of existing procs; no new backend. */
function SocialHealthStrip() {
  const { data: status } = trpc.instagramAdmin.getConnectionStatus.useQuery();
  const { data: health } = trpc.instagramAdmin.getProviderHealth.useQuery();
  const { data: reviewStats } = trpc.reviewReplies.stats.useQuery();
  if (!status && !health) return null;

  const autopostFails = health?.autopost.recentFailures ?? 0;
  const reviewsToPost = reviewStats?.approved ?? 0;
  const items = [
    { ok: !!status?.instagramReady, label: status?.instagramReady ? "IG connected" : "IG not connected" },
    {
      ok: !!health?.text.configured && !health?.text.openaiFallback,
      label: health?.text.openaiFallback ? "LLM on dead OpenAI fallback" : `Text: ${health?.text.provider ?? "?"}`,
    },
    { ok: !!health?.image.configured, label: `Image: ${health?.image.provider ?? "?"}` },
    { ok: autopostFails === 0, label: autopostFails > 0 ? `${autopostFails} autopost fails` : "Autopost OK" },
    { ok: reviewsToPost === 0, label: reviewsToPost > 0 ? `${reviewsToPost} reviews to post` : "Reviews clear" },
  ];
  const allOk = items.every((i) => i.ok);

  return (
    <div className={`rounded border p-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] ${allOk ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
      <span className="font-semibold text-foreground/70 flex items-center gap-1">
        <ShieldCheck className="w-3.5 h-3.5" /> Social health
      </span>
      {items.map((i, idx) => (
        <span key={idx} className={`inline-flex items-center gap-1 ${i.ok ? "text-emerald-400" : "text-amber-400"}`}>
          {i.ok ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}{i.label}
        </span>
      ))}
    </div>
  );
}

export default function InstagramTab() {
  const [sub, setSub] = useState<(typeof SUBTABS)[number]["id"]>("feed");
  const [activeModalPost, setActiveModalPost] = useState<any | null>(null);
  const [seedConcept, setSeedConcept] = useState<string | null>(null);

  const repurpose = (caption: string) => {
    setSeedConcept(`Rework this proven post for a fresh angle: ${(caption || "").slice(0, 280)}`);
    setActiveModalPost(null);
    setSub("create");
  };

  return (
    <div className="space-y-4">
      <div className="border border-pink-500/40 bg-pink-500/10 rounded p-3 text-xs text-pink-200 flex items-start gap-2">
        <Instagram className="w-4 h-4 shrink-0 mt-0.5 text-pink-400" />
        <span>
          <strong>Instagram command center for @nicks_tire_euclid.</strong> Everything in one place —
          explore the feed (Feed Explorer), reply to comments (Inbox), generate content (Create), publish custom posts (Publish), review execution logs (Autopost Logs), read performance
          (Analytics), manage the connection (Settings). Nothing here posts autonomously; every
          external action is an explicit, claim-safe owner action.
        </span>
      </div>

      <SocialHealthStrip />

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
        {sub === "feed" && (
          <FeedExplorerPanel
            activeModalPost={activeModalPost}
            setActiveModalPost={setActiveModalPost}
            onRepurpose={repurpose}
          />
        )}
        {sub === "inbox" && <CommentsPanel />}
        {sub === "create" && <CreateSection seedConcept={seedConcept} onSeedConsumed={() => setSeedConcept(null)} onSeed={setSeedConcept} />}
        {sub === "publish" && (
          <PublishPanel
            setSub={setSub}
            setActiveModalPost={setActiveModalPost}
          />
        )}
        {sub === "logs" && <AutopostLogsPanel />}
        {sub === "analytics" && <AnalyticsPanel />}
        {sub === "settings" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ConnectionPanel />
            <MetaConfigPanel />
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Create: AI co-pilot + content studios (folded in from Social Studios) ── */

/** Cross-promote: turn a strong Google review into an IG post draft by seeding
 *  the co-pilot. Paraphrase-only instruction + the eval gate keep it honest. */
function ReviewToPost({ onSeed }: { onSeed: (concept: string) => void }) {
  const { data: reviews } = trpc.reviewReplies.list.useQuery({ limit: 50 });
  const positives = ((reviews ?? []) as Array<{ id: number; reviewRating: number | null; reviewText: string | null }>)
    .filter((r) => (r.reviewRating ?? 0) >= 4 && !!r.reviewText && r.reviewText.length > 20)
    .slice(0, 4);
  if (!positives.length) return null;
  return (
    <Panel title="Turn a 5★ review into a post" icon={<Sparkles className="w-4 h-4 text-amber-400" />}>
      <p className="text-[10px] text-foreground/40 mb-2">
        Cross-promote your best Google reviews to Instagram — the co-pilot paraphrases the sentiment
        (no fabrication, eval-gated).
      </p>
      <div className="space-y-2">
        {positives.map((r) => (
          <div key={r.id} className="flex items-start justify-between gap-2 bg-background/40 border border-border/30 rounded p-2">
            <div className="min-w-0">
              <div className="text-[10px] text-amber-400">{"★".repeat(r.reviewRating ?? 5)}</div>
              <p className="text-[11px] text-foreground/70 line-clamp-2 italic">"{r.reviewText}"</p>
            </div>
            <button
              onClick={() =>
                onSeed(
                  `Turn this happy customer's Google review into an Instagram post — paraphrase the sentiment, do NOT fabricate or quote verbatim: "${(r.reviewText || "").slice(0, 240)}"`,
                )
              }
              className="shrink-0 inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded border border-primary/40 text-primary hover:bg-primary/10 transition-colors"
            >
              <Wand2 className="w-3 h-3" /> Use
            </button>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function CreateSection({ seedConcept, onSeedConsumed, onSeed }: { seedConcept?: string | null; onSeedConsumed?: () => void; onSeed: (concept: string) => void }) {
  const [showLegacy, setShowLegacy] = useState(false);
  return (
    <div className="space-y-4">
      <CopilotPanel seedConcept={seedConcept} onSeedConsumed={onSeedConsumed} />
      <ReviewToPost onSeed={onSeed} />

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
  const { data: health } = trpc.instagramAdmin.getProviderHealth.useQuery();

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

      {/* AI provider health — surfaces the root cause of silent generation
          failures (no Gemini key -> dead OpenAI fallback) + autopost run health */}
      {health && (
        <div className="mt-3 pt-3 border-t border-border/20 space-y-1.5">
          <span className="text-[10px] uppercase tracking-wider text-foreground/40 font-semibold">AI provider health</span>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <Bool value={health.text.configured} trueLabel={`Text: ${health.text.provider}`} falseLabel="Text: no LLM key" />
            <Bool value={health.image.configured} trueLabel={`Image: ${health.image.provider}`} falseLabel={`Image: ${health.image.provider} key missing`} />
            {health.autopost.recentRuns > 0 && health.autopost.recentFailures === 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                <CheckCircle2 className="w-3 h-3" />all {health.autopost.recentRuns} recent runs OK
              </span>
            )}
          </div>
          {health.text.openaiFallback && (
            <p className="text-[10px] text-amber-400 flex items-start gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
              No GEMINI_API_KEY set — text generation is falling back to OpenAI, which is often out of quota (the silent cause of FAILED posts). Set GEMINI_API_KEY in Railway to fix.
            </p>
          )}
          {health.autopost.recentFailures > 0 && (
            <p className="text-[10px] text-red-400 flex items-start gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
              <span>
                {health.autopost.recentFailures}/{health.autopost.recentRuns} recent autopost runs failed
                {health.autopost.lastError ? ` — last error: ${health.autopost.lastError.slice(0, 140)}` : ""}
              </span>
            </p>
          )}
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

function MetaConfigPanel() {
  const utils = trpc.useUtils();
  const { data: config, isLoading } = trpc.instagramAdmin.getMetaConfig.useQuery();
  const [appId, setAppId] = useState("");
  const [pageId, setPageId] = useState("");
  const [igUserId, setIgUserId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [imageProvider, setImageProvider] = useState<"openai" | "gemini" | "higgsfield">("openai");
  const [higgsfieldJson, setHiggsfieldJson] = useState("");

  useEffect(() => {
    if (config) {
      setAppId(config.appId);
      setPageId(config.pageId);
      setIgUserId(config.igUserId);
      setImageProvider(config.imageProvider as any || "openai");
      setAppSecret("");
      setHiggsfieldJson("");
    }
  }, [config]);

  const update = trpc.instagramAdmin.updateMetaConfig.useMutation({
    onSuccess: () => {
      toast.success("Social manager settings updated successfully");
      setAppSecret("");
      setHiggsfieldJson("");
      utils.instagramAdmin.getConnectionStatus.invalidate();
      utils.instagramAdmin.getMetaConfig.invalidate();
    },
    onError: (err) => {
      toast.error("Failed to update settings: " + err.message);
    },
  });

  // Reel/Higgsfield creds health — lazy (the CLI probe takes ~1-15s), triggered
  // by the operator. Detects creds that are SET but STALE (the silent failure
  // mode that quietly kills reel + autopost image generation).
  const higgsfieldHealth = trpc.instagramAdmin.getHiggsfieldHealth.useQuery(undefined, { enabled: false });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!appId.trim() || !pageId.trim() || !igUserId.trim()) {
      toast.error("App ID, Page ID, and Instagram User ID are required");
      return;
    }
    update.mutate({
      appId: appId.trim(),
      pageId: pageId.trim(),
      igUserId: igUserId.trim(),
      appSecret: appSecret.trim() || undefined,
      imageProvider,
      higgsfieldCredentialsJson: higgsfieldJson.trim() || undefined,
    });
  };

  if (isLoading) {
    return (
      <Panel title="Social Media Manager Config" icon={<Settings2 className="w-4 h-4 text-pink-400" />}>
        <div className="flex justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Social Media Manager Config" icon={<Settings2 className="w-4 h-4 text-pink-400" />}>
      <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-foreground/50 font-semibold block">
              Meta App ID
            </label>
            <input
              type="text"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              className="w-full bg-background/80 border border-border/40 rounded px-2.5 py-1.5 focus:outline-none focus:border-primary/50 text-foreground"
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-foreground/50 font-semibold block">
              Meta App Secret
            </label>
            <input
              type="password"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              placeholder={config?.hasSecret ? "•••••••••••• (saved)" : "Enter app secret"}
              className="w-full bg-background/80 border border-border/40 rounded px-2.5 py-1.5 focus:outline-none focus:border-primary/50 text-foreground"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-foreground/50 font-semibold block">
              Facebook Page ID
            </label>
            <input
              type="text"
              value={pageId}
              onChange={(e) => setPageId(e.target.value)}
              className="w-full bg-background/80 border border-border/40 rounded px-2.5 py-1.5 focus:outline-none focus:border-primary/50 text-foreground"
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-foreground/50 font-semibold block">
              Instagram Business ID
            </label>
            <input
              type="text"
              value={igUserId}
              onChange={(e) => setIgUserId(e.target.value)}
              className="w-full bg-background/80 border border-border/40 rounded px-2.5 py-1.5 focus:outline-none focus:border-primary/50 text-foreground"
              required
            />
          </div>
        </div>

        <div className="space-y-1.5 pt-1.5 border-t border-border/20">
          <label className="text-[10px] uppercase tracking-wider text-foreground/50 font-semibold block">
            AI Image Generator Provider
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(["openai", "gemini", "higgsfield"] as const).map((prov) => {
              const labelMap = { openai: "DALL-E 3 (OpenAI)", gemini: "Gemini Image", higgsfield: "Higgsfield CLI" };
              const isSelected = imageProvider === prov;
              return (
                <button
                  key={prov}
                  type="button"
                  onClick={() => setImageProvider(prov)}
                  className={`py-1.5 text-[10px] font-bold border rounded transition-all cursor-pointer ${
                    isSelected
                      ? "bg-primary/15 text-primary border-primary/40 shadow-sm"
                      : "text-foreground/50 border-border/30 hover:text-foreground/75 hover:bg-neutral-900/10"
                  }`}
                >
                  {labelMap[prov]}
                </button>
              );
            })}
          </div>
        </div>

        {imageProvider === "higgsfield" && (
          <div className="space-y-1 pt-1 animate-fadeIn">
            <label className="text-[10px] uppercase tracking-wider text-foreground/50 font-semibold block">
              Higgsfield Credentials JSON
            </label>
            <textarea
              value={higgsfieldJson}
              onChange={(e) => setHiggsfieldJson(e.target.value)}
              rows={3}
              placeholder={
                config?.hasHiggsfieldCreds
                  ? "(Credentials JSON is saved. Enter a new JSON payload here only to override.)"
                  : '{"api_key": "...", "private_key": "..."}'
              }
              className="w-full bg-background/80 border border-border/40 rounded px-2.5 py-1.5 focus:outline-none focus:border-primary/50 text-foreground font-mono text-[10px] leading-relaxed"
            />
          </div>
        )}

        <div className="space-y-1 pt-2 border-t border-border/30">
          <div className="flex items-center justify-between">
            <label className="text-[10px] uppercase tracking-wider text-foreground/50 font-semibold">Reel engine (Higgsfield)</label>
            <button
              type="button"
              onClick={() => higgsfieldHealth.refetch()}
              disabled={higgsfieldHealth.isFetching}
              className="text-[10px] px-2 py-1 rounded border border-border/40 hover:bg-card disabled:opacity-50 inline-flex items-center gap-1 cursor-pointer"
            >
              {higgsfieldHealth.isFetching ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Check health
            </button>
          </div>
          {higgsfieldHealth.data && (
            <p className={`text-[10px] ${higgsfieldHealth.data.credsValid ? "text-green-400" : "text-red-400"}`}>
              {higgsfieldHealth.data.credsValid
                ? `✓ Creds valid${higgsfieldHealth.data.balanceCredits != null ? ` · ~${higgsfieldHealth.data.balanceCredits.toLocaleString()} credits` : ""}`
                : "⚠ Creds STALE or unreachable — reel + autopost generation will fail. Refresh via `hf auth login` then redeploy."}
            </p>
          )}
        </div>

        <div className="pt-2">
          <button
            type="submit"
            disabled={update.isPending}
            className="w-full py-2 bg-primary/20 hover:bg-primary/30 text-primary border border-primary/45 rounded font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-1.5 hover:scale-[1.01] active:scale-95 cursor-pointer"
          >
            {update.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save Settings Override
          </button>
        </div>
      </form>
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
  const [showReport, setShowReport] = useState(false);
  const { data: report, isLoading: reportLoading, refetch: refetchReport } = trpc.instagramAdmin.getPerformanceReport.useQuery(undefined, {
    enabled: showReport,
  });

  const formattedReport = useMemo(() => {
    if (!report) return "";
    const lines = [
      "=== INSTAGRAM PERFORMANCE RECOMMENDATIONS ===",
      ...report.recommendations.map((rec, i) => `${i + 1}. ${rec}`),
      "",
      "=== ENGAGEMENT BY POST TYPE ===",
      ...report.engagementByType.map(
        (e) => `- ${e.type}: ${e.postCount} posts, avg ${e.avgLikes} likes, ${e.avgComments} comments, engagement rate ${e.avgEngagementRate.toFixed(2)}%`
      ),
      "",
      "=== BEST TIMES TO POST ===",
      ...report.bestTimes.map(
        (t) => `- ${t.dayName} at ${fmtHour(t.hourOfDay)} (avg ${t.avgEngagement.toFixed(1)} engagement)`
      ),
    ];
    return lines.join("\n");
  }, [report]);

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
        <div className="mb-4">
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

      {/* Narrative Performance Report */}
      <div className="mt-6 border-t border-border/20 pt-4">
        <button
          onClick={() => {
            setShowReport(!showReport);
            if (!report) refetchReport();
          }}
          className="w-full flex items-center justify-between bg-neutral-900/30 hover:bg-neutral-900/50 border border-border/25 rounded-lg p-4 transition-all"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <div className="text-left">
              <span className="text-sm font-bold text-foreground block">AI Narrative Performance Analysis</span>
              <span className="text-[10px] text-foreground/40">Evaluate copy vectors, hook styles, and content conversions</span>
            </div>
          </div>
          <span className="text-xs text-foreground/50 flex items-center gap-1 font-bold">
            {showReport ? "Collapse" : "Generate Analysis"}
            {showReport ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </span>
        </button>

        {showReport && (
          <div className="mt-3 bg-neutral-900/20 border border-border/30 rounded-lg p-4 space-y-3 font-sans">
            {reportLoading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                <span className="text-xs text-foreground/40">Analyzing post engagement data...</span>
              </div>
            ) : report ? (
              <div className="space-y-3">
                <div className="text-xs leading-relaxed text-foreground/80 whitespace-pre-wrap font-mono p-3 bg-black/40 border border-border/20 rounded-lg max-h-[400px] overflow-y-auto">
                  {formattedReport}
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(formattedReport);
                      toast.success("Analysis copied to clipboard");
                    }}
                    className="px-2.5 py-1.5 text-[10px] font-semibold border border-border/40 rounded text-foreground/70 hover:text-foreground hover:border-primary/40 transition-colors"
                  >
                    Copy Report
                  </button>
                  <button
                    onClick={() => refetchReport()}
                    className="px-2.5 py-1.5 text-[10px] font-semibold border border-border/40 rounded text-foreground/70 hover:text-foreground hover:border-primary/40 transition-colors"
                  >
                    Recalculate
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic text-center py-6">Could not generate analysis report.</p>
            )}
          </div>
        )}
      </div>
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
        <div className="w-6 h-6 rounded-full bg-linear-to-tr from-amber-500 to-pink-500" />
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

/** One-tap Cleveland-seasonal steering presets for the co-pilot. Themes only —
 *  the eval gate still enforces claim-safety/price-compliance on the output. */
const SEASONAL_PRESETS: { label: string; concept: string }[] = [
  { label: "Road salt", concept: "Cleveland road-salt season — undercarriage rust/corrosion inspection and rustproofing" },
  { label: "Pothole season", concept: "Post-thaw pothole season on Cleveland streets — alignment and tire/wheel damage checks" },
  { label: "First hot day", concept: "First 90-degree day — AC and cooling-system checks before the heat" },
  { label: "Winter prep", concept: "Before the first Cleveland snow — winter tires, battery test, tread checks" },
  { label: "Oil change", concept: "Oil change special — quick, no appointment needed" },
];

function CopilotPanel({ seedConcept, onSeedConsumed }: { seedConcept?: string | null; onSeedConsumed?: () => void }) {
  const utils = trpc.useUtils();
  const { data: account } = trpc.instagramAdmin.getAccountInfo.useQuery();
  const { data: recent } = trpc.instagramAdmin.getRecentGenerations.useQuery({ limit: 6 });
  const [archetype, setArchetype] = useState<(typeof ARCHETYPES)[number]["id"]>("auto");
  const [customConcept, setCustomConcept] = useState("");
  // Seeded from "Repurpose" on a feed post — fill the steering box once, then clear.
  useEffect(() => {
    if (seedConcept) {
      setCustomConcept(seedConcept);
      onSeedConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedConcept]);
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

      <div className="space-y-2 mb-4 bg-background/25 border border-border/20 rounded p-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-foreground/50 font-semibold">
            Custom Steering (Mood / Theme / Idea)
          </span>
          <span className={`px-1.5 py-0.2 text-[8px] font-bold border rounded uppercase ${
            customConcept.trim() ? "bg-primary/10 text-primary border-primary/20" : "bg-neutral-800 text-foreground/40 border-border/10"
          }`}>
            {customConcept.trim() ? "Custom Mode" : "Auto Mode"}
          </span>
        </div>
        <input
          type="text"
          value={customConcept}
          onChange={(e) => setCustomConcept(e.target.value)}
          placeholder="E.g. Write a post about East Side potholes, dark catalog style, warn about winter alignments"
          className="w-full bg-background border border-border/45 rounded px-2.5 py-1.5 text-xs text-foreground placeholder-foreground/30 focus:outline-none focus:border-primary/50"
        />
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {SEASONAL_PRESETS.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => setCustomConcept(s.concept)}
              className="px-2 py-0.5 text-[10px] rounded-full border border-border/30 text-foreground/60 hover:text-foreground hover:border-primary/40 transition-colors"
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-foreground/40 leading-normal">
          If filled, the AI co-pilot will build the copy hook and visual prompts directly around this theme, overriding default template Signal generation.
        </p>
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
          onClick={() => generate.mutate({
            archetype: archetype === "auto" ? undefined : archetype,
            customConcept: customConcept.trim() || undefined,
          })}
          disabled={generate.isPending}
          className="inline-flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold rounded border border-primary/40 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50 cursor-pointer"
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
                    className={`w-full text-left flex flex-col gap-1 text-[10px] bg-background/40 border rounded px-2.5 py-1.5 transition-all hover:bg-background/60 hover:border-primary/40 ${
                      isActive ? "border-primary bg-primary/5 text-foreground" : "border-border/30 text-foreground/70"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 w-full">
                      <span className="font-semibold capitalize truncate">{g.archetype}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {typeof g.overallScore === "number" && (
                          <span className={scoreColor(g.overallScore / 100)}>{g.overallScore}</span>
                        )}
                        <StatusPill status={g.status} />
                      </div>
                    </div>
                    {g.error && (g.status === "failed" || g.status === "aborted") && (
                      <p className="text-[9px] text-red-400 italic line-clamp-2 w-full">{g.error}</p>
                    )}
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

interface IgCommentVM { id: string; text: string; username: string; timestamp: string; likeCount: number; replyCount: number; replied: boolean }

/** Claim-safe quick-reply starters for the Inbox — filled into the draft, then
 *  still run through the claim-safety gate before sending. No prices/guarantees/
 *  wait-times (the "We're on it" one is for service-recovery on complaints). */
const SAVED_REPLIES: { label: string; text: string }[] = [
  { label: "Thanks", text: "Thanks for the love — we appreciate you!" },
  { label: "Pull up", text: "Come pull up, we'll take good care of you." },
  { label: "Call us", text: "Give us a call at (216) 862-0005 and we'll get you sorted." },
  { label: "Send size", text: "Send us your tire size and we'll check what we've got." },
  { label: "We're on it", text: "Appreciate you flagging this — we want to make it right. Please give us a call so we can help." },
];

function CommentModerationRow({ comment }: { comment: IgCommentVM }) {
  const [draft, setDraft] = useState("");
  const [tone, setTone] = useState<"warm" | "professional" | "witty" | "promo">("warm");
  const [confirming, setConfirming] = useState(false);
  const suggest = trpc.instagramAdmin.suggestReply.useMutation({
    onSuccess: (r) => setDraft(r.draft),
  });
  const reply = trpc.instagramAdmin.postReply.useMutation({
    onSuccess: () => { setDraft(""); setConfirming(false); },
  });
  const findings = draft ? checkReviewReply(draft) : [];
  const blockers = findings.filter((f) => f.severity === "block");
  const badge = COMMENT_KIND_BADGE[classifyComment(comment.text).kind];

  return (
    <div className="bg-background/40 border border-border/30 rounded p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold text-foreground">@{comment.username || "user"}</span>
        {badge && (
          <span className={`px-1.5 py-0.5 text-[9px] font-bold border rounded ${badge.className}`}>{badge.label}</span>
        )}
        {comment.replied && (
          <span className="px-1.5 py-0.5 text-[9px] font-bold border rounded bg-emerald-500/10 text-emerald-400 border-emerald-500/20">✓ REPLIED</span>
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
        <div className="flex flex-wrap gap-1.5">
          {SAVED_REPLIES.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => setDraft(s.text)}
              className="px-2 py-0.5 text-[9px] rounded-full border border-border/30 text-foreground/55 hover:text-foreground hover:border-primary/40 transition-colors"
            >
              {s.label}
            </button>
          ))}
        </div>
        {findings.map((f) => (
          <p key={`${f.rule}-${f.match}`} className={`text-[10px] leading-relaxed flex items-start gap-1 ${f.severity === "block" ? "text-red-400" : "text-amber-400"}`}>
            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
            <span><strong>{f.severity === "block" ? "BLOCKED" : "CHECK"}</strong> · {f.rule} ("{f.match}") — {f.fix}</span>
          </p>
        ))}
        <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
          <div className="flex items-center gap-2">
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value as any)}
              className="bg-neutral-900 border border-border/40 text-foreground text-[10px] font-medium px-2 py-1 rounded focus:outline-none focus:border-primary/50 cursor-pointer"
            >
              <option value="warm">😊 Warm Tone</option>
              <option value="professional">💼 Professional</option>
              <option value="witty">⚡ Witty & Wry</option>
              <option value="promo">🏷️ Promotional</option>
            </select>
            <button
              onClick={() => suggest.mutate({ commentText: comment.text, tone })}
              disabled={suggest.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold rounded border border-border/40 bg-neutral-900/40 text-foreground/80 hover:text-foreground hover:border-primary/45 transition-all disabled:opacity-50"
            >
              {suggest.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-pink-400" />}
              Suggest
            </button>
          </div>
          <button
            onClick={() => {
              if (confirming) reply.mutate({ commentId: comment.id, message: draft.trim() });
              else setConfirming(true);
            }}
            disabled={reply.isPending || !draft.trim() || blockers.length > 0}
            title={blockers.length ? "Fix the blocked wording first" : undefined}
            className={`inline-flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold rounded border transition-all disabled:opacity-50 ${
              confirming ? "bg-pink-600 text-white border-pink-500 animate-pulse" : "text-pink-450 border-pink-500/30 hover:bg-pink-500/10"
            }`}
          >
            {reply.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
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

function VideoPlayer({ src, poster }: { src: string; poster?: string }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch((err) => console.log("Video play blocked:", err));
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    const nextMuted = !videoRef.current.muted;
    videoRef.current.muted = nextMuted;
    setIsMuted(nextMuted);
  };

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.play().then(() => {
            setIsPlaying(true);
          }).catch(() => {});
        } else {
          el.pause();
          setIsPlaying(false);
        }
      },
      { threshold: 0.5 }
    );

    observer.observe(el);
    return () => {
      observer.unobserve(el);
    };
  }, []);

  return (
    <div className="relative w-full max-h-[500px] bg-black flex items-center justify-center group rounded-lg overflow-hidden">
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        loop
        muted
        playsInline
        onClick={togglePlay}
        className="w-full max-h-[500px] object-cover cursor-pointer"
      />
      
      {!isPlaying && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/20">
          <button
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
            className="pointer-events-auto p-4 bg-black/60 hover:bg-black/80 rounded-full text-white backdrop-blur-sm transition-all transform scale-100 hover:scale-110"
          >
            <Play className="w-6 h-6 fill-white" />
          </button>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 to-transparent p-3 flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
        <button
          onClick={(e) => {
            e.stopPropagation();
            togglePlay();
          }}
          className="p-1.5 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors pointer-events-auto"
        >
          {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleMute();
          }}
          className="p-1.5 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors pointer-events-auto"
        >
          {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

function FeedPostCard({ post, username }: { post: any; username: string }) {
  const [showComments, setShowComments] = useState(false);
  const [isCaptionExpanded, setIsCaptionExpanded] = useState(false);

  const { data: commentsRes, isLoading: commentsLoading } = trpc.instagramAdmin.getComments.useQuery(
    { mediaId: post.id },
    { enabled: showComments },
  );

  const comments = commentsRes?.comments ?? [];

  return (
    <div className="bg-card border border-border/30 rounded-xl overflow-hidden shadow-sm hover:border-border/60 transition-all">
      <div className="flex items-center gap-3 p-3 bg-neutral-900/10 border-b border-border/10">
        <div className="w-8 h-8 rounded-full bg-linear-to-tr from-amber-500 via-red-500 to-pink-500 p-0.5 flex items-center justify-center">
          <div className="w-full h-full rounded-full bg-background flex items-center justify-center text-[10px] font-bold">
            IG
          </div>
        </div>
        <div>
          <span className="text-xs font-extrabold text-foreground block">@{username}</span>
          <span className="text-[9px] text-foreground/40 font-mono">{new Date(post.posted).toLocaleDateString()}</span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 text-[8px] font-bold border rounded uppercase bg-neutral-800 text-foreground/60 border-border/20">
            {post.type}
          </span>
          <a
            href={post.link}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 hover:text-primary transition-colors text-foreground/60"
            title="View on Instagram"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      <div className="bg-neutral-950 flex items-center justify-center overflow-hidden">
        {post.type === "VIDEO" && post.mediaUrl ? (
          <VideoPlayer src={post.mediaUrl} poster={post.thumbnailUrl} />
        ) : post.mediaUrl ? (
          <img src={post.mediaUrl} alt="" className="w-full max-h-[600px] object-contain" />
        ) : (
          <div className="w-full h-64 bg-neutral-900 flex items-center justify-center">
            <Instagram className="w-12 h-12 text-white/20" />
          </div>
        )}
      </div>

      <div className="p-4 space-y-2.5">
        <div className="flex items-center gap-4 text-xs font-bold text-foreground/75">
          <span className="flex items-center gap-1">
            <Heart className="w-4 h-4 text-pink-500 fill-pink-500/10" />
            {post.likes} likes
          </span>
          <button
            onClick={() => setShowComments(!showComments)}
            className="flex items-center gap-1 hover:text-primary"
          >
            <MessageCircle className="w-4 h-4 text-primary" />
            {post.comments} comments
          </button>
        </div>

        {post.caption && (
          <div className="text-xs leading-relaxed text-foreground/85">
            <span className="font-extrabold mr-1.5 text-foreground">@{username}</span>
            <span className="whitespace-pre-wrap">
              {isCaptionExpanded ? post.caption : `${post.caption.slice(0, 160)}${post.caption.length > 160 ? "..." : ""}`}
            </span>
            {post.caption.length > 160 && (
              <button
                onClick={() => setIsCaptionExpanded(!isCaptionExpanded)}
                className="text-primary hover:underline font-bold text-[10px] ml-1.5 focus:outline-none"
              >
                {isCaptionExpanded ? "Show less" : "Read more"}
              </button>
            )}
          </div>
        )}
      </div>

      {showComments && (
        <div className="border-t border-border/15 bg-neutral-900/10 p-3 space-y-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-foreground/50 flex justify-between items-center mb-1">
            <span>Comments</span>
          </div>
          
          {commentsLoading ? (
            <div className="py-6 text-center text-xs text-foreground/40 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-primary" /> Loading comments...
            </div>
          ) : comments.length === 0 ? (
            <div className="py-4 text-center text-xs text-foreground/30 italic">No comments on this post yet.</div>
          ) : (
            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
              {comments.map((c: any) => (
                <CommentModerationRow key={c.id} comment={c} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReelCommentsList({ mediaId }: { mediaId: string }) {
  const { data: commentsRes, isLoading } = trpc.instagramAdmin.getComments.useQuery({ mediaId });
  const comments = commentsRes?.comments ?? [];

  if (isLoading) {
    return (
      <div className="py-8 text-center text-xs text-white/40 flex items-center justify-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-primary" /> Loading comments...
      </div>
    );
  }

  if (commentsRes && !commentsRes.ok) {
    return (
      <p className="text-[10px] text-amber-400 py-4 text-center">
        {commentsRes.error}
      </p>
    );
  }

  if (comments.length === 0) {
    return (
      <p className="text-[10px] text-white/40 py-8 text-center italic">
        No comments yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {comments.map((c: any) => (
        <CommentModerationRow key={c.id} comment={c} />
      ))}
    </div>
  );
}

function ReelCard({ 
  post, 
  username, 
  isMuted, 
  onMuteToggle 
}: { 
  post: any; 
  username: string; 
  isMuted: boolean; 
  onMuteToggle: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [isCaptionExpanded, setIsCaptionExpanded] = useState(false);

  const isVideo = post.type === "VIDEO" || post.mediaUrl?.includes("video") || post.mediaUrl?.endsWith(".mp4");

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !isVideo) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.play().then(() => {
            setIsPlaying(true);
          }).catch((err) => console.log("Reel autoplay blocked:", err));
        } else {
          el.pause();
          setIsPlaying(false);
        }
      },
      { threshold: 0.6 }
    );

    observer.observe(el);
    return () => {
      observer.unobserve(el);
    };
  }, [isVideo]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
    }
  }, [isMuted]);

  const handleVideoTap = () => {
    if (!videoRef.current || !isVideo) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch(() => {});
    }
  };

  return (
    <div className="w-full h-full snap-start relative bg-neutral-950 flex flex-col justify-between scroll-snap-align-start shrink-0">
      <div className="absolute inset-0 z-0 flex items-center justify-center" onClick={handleVideoTap}>
        {isVideo ? (
          <video
            ref={videoRef}
            src={post.mediaUrl}
            poster={post.thumbnailUrl}
            loop
            muted={isMuted}
            playsInline
            className="w-full h-full object-cover cursor-pointer"
          />
        ) : (
          <img 
            src={post.thumbnailUrl || post.mediaUrl} 
            alt="" 
            className="w-full h-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-linear-to-b from-black/20 via-transparent to-black/75 pointer-events-none" />
      </div>

      <div className="absolute top-3 inset-x-3 z-10 flex items-center justify-between pointer-events-none">
        <span className="px-2 py-0.5 bg-black/40 backdrop-blur-md rounded text-[9px] font-bold text-white/90 border border-white/10 uppercase tracking-wider">
          {post.type}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMuteToggle();
          }}
          className="pointer-events-auto p-1.5 bg-black/40 backdrop-blur-md rounded-full text-white border border-white/10 hover:bg-black/60 transition-colors"
        >
          {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
        </button>
      </div>

      <div className="absolute right-3 bottom-16 z-10 flex flex-col items-center gap-4 text-white">
        <div className="w-8 h-8 rounded-full border border-white/20 bg-linear-to-tr from-amber-500 to-pink-500 p-0.5 shadow-lg">
          <div className="w-full h-full rounded-full bg-black flex items-center justify-center text-[9px] font-black uppercase text-pink-400">
            NT
          </div>
        </div>

        <button className="flex flex-col items-center gap-0.5 group">
          <div className="p-2 bg-black/40 backdrop-blur-md rounded-full border border-white/10 group-hover:bg-black/60 transition-all">
            <Heart className="w-4 h-4 fill-white" />
          </div>
          <span className="text-[10px] font-bold tracking-wider text-white shadow-sm drop-shadow">{post.likes}</span>
        </button>

        <button 
          onClick={(e) => {
            e.stopPropagation();
            setShowComments(true);
          }}
          className="flex flex-col items-center gap-0.5 group"
        >
          <div className="p-2 bg-black/40 backdrop-blur-md rounded-full border border-white/10 group-hover:bg-black/60 transition-all">
            <MessageCircle className="w-4 h-4 fill-white/10" />
          </div>
          <span className="text-[10px] font-bold tracking-wider text-white shadow-sm drop-shadow">{post.comments}</span>
        </button>

        <a 
          href={post.link} 
          target="_blank" 
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="p-2 bg-black/40 backdrop-blur-md rounded-full border border-white/10 hover:bg-black/60 transition-all text-white"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>

      <div className="absolute left-3 bottom-3 right-14 z-10 text-white space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold">@{username}</span>
          <span className="text-[9px] text-white/60 font-mono">
            {new Date(post.posted).toLocaleDateString()}
          </span>
        </div>
        {post.caption && (
          <div className="text-[11px] leading-snug max-h-20 overflow-y-auto text-white/90 drop-shadow pr-1">
            <span className="whitespace-pre-wrap">
              {isCaptionExpanded ? post.caption : `${post.caption.slice(0, 80)}${post.caption.length > 80 ? "..." : ""}`}
            </span>
            {post.caption.length > 80 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsCaptionExpanded(!isCaptionExpanded);
                }}
                className="text-pink-400 hover:underline font-bold text-[9px] ml-1 focus:outline-none"
              >
                {isCaptionExpanded ? "less" : "more"}
              </button>
            )}
          </div>
        )}
      </div>

      {!isPlaying && isVideo && (
        <div className="absolute inset-0 flex items-center justify-center z-5 bg-black/10 pointer-events-none">
          <div className="p-3 bg-black/50 rounded-full text-white backdrop-blur-sm">
            <Play className="w-6 h-6 fill-white" />
          </div>
        </div>
      )}

      {showComments && (
        <div 
          className="absolute inset-0 z-30 bg-black/50 backdrop-blur-[2px] flex flex-col justify-end"
          onClick={(e) => {
            e.stopPropagation();
            setShowComments(false);
          }}
        >
          <div 
            className="w-full bg-neutral-950 border-t border-white/10 rounded-t-2xl p-4 flex flex-col h-[75%] select-text"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2">
              <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1">
                <MessageCircle className="w-3.5 h-3.5" /> Comments ({post.comments})
              </span>
              <button 
                onClick={() => setShowComments(false)}
                className="p-1 hover:bg-neutral-800 rounded text-white/50 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto pr-1">
              <ReelCommentsList mediaId={post.id} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReelsFeedExplorer({ feed, username }: { feed: any[]; username: string }) {
  const [isMuted, setIsMuted] = useState(true);

  return (
    <div className="relative w-full max-w-[340px] aspect-9/16 bg-black rounded-4xl border-8 border-neutral-800 overflow-hidden shadow-2xl mx-auto flex flex-col">
      <div 
        className="flex-1 overflow-y-auto snap-y snap-mandatory h-full w-full scrollbar-none"
        style={{ scrollSnapType: "y mandatory", scrollbarWidth: "none" }}
      >
        {feed.map((post) => (
          <ReelCard 
            key={post.id} 
            post={post} 
            username={username} 
            isMuted={isMuted} 
            onMuteToggle={() => setIsMuted(!isMuted)} 
          />
        ))}
      </div>
    </div>
  );
}

function FeedExplorerPanel({
  activeModalPost,
  setActiveModalPost,
  onRepurpose,
}: {
  activeModalPost: any | null;
  setActiveModalPost: (post: any) => void;
  onRepurpose: (caption: string) => void;
}) {
  const [layout, setLayout] = useState<"grid" | "scroll" | "reels">("scroll");
  const { data: feed, isLoading, refetch } = trpc.instagramAdmin.getLiveFeed.useQuery({ limit: 30 });
  const { data: account } = trpc.instagramAdmin.getAccountInfo.useQuery();
  const username = account?.username || "nicks_tire_euclid";

  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"ALL" | "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM">("ALL");
  const [sortBy, setSortBy] = useState<"posted" | "likes" | "comments">("posted");

  const sync = trpc.instagramAdmin.syncFeed.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("Feed synced with Instagram");
    },
    onError: (err) => {
      toast.error("Failed to sync feed: " + err.message);
    }
  });

  const filteredFeed = useMemo(() => {
    if (!feed) return [];
    return feed
      .filter((post) => {
        const matchesSearch = searchQuery
          ? post.caption?.toLowerCase().includes(searchQuery.toLowerCase())
          : true;
        const matchesType = filterType === "ALL" ? true : post.type === filterType;
        return matchesSearch && matchesType;
      })
      .sort((a, b) => {
        if (sortBy === "likes") return b.likes - a.likes;
        if (sortBy === "comments") return b.comments - a.comments;
        return new Date(b.posted).getTime() - new Date(a.posted).getTime();
      });
  }, [feed, searchQuery, filterType, sortBy]);

  // Top performers by engagement, derived from the synced feed (honest — only
  // shown when posts actually have engagement; no dependency on the analytics
  // table, which is empty until a sync has built history).
  const winners = useMemo(() => {
    if (!feed) return [];
    return [...feed]
      .filter((p) => (p.likes ?? 0) + (p.comments ?? 0) > 0)
      .sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments))
      .slice(0, 5);
  }, [feed]);

  // Hashtags mined from the feed, ranked by the engagement of the posts they
  // appear on — the shop's own proven tags, one tap to filter by.
  const topHashtags = useMemo(() => {
    if (!feed) return [];
    const counts = new Map<string, number>();
    for (const p of feed) {
      const tags = (p.caption || "").match(/#[\p{L}\p{N}_]+/gu) || [];
      for (const tag of tags) {
        const t = tag.toLowerCase();
        counts.set(t, (counts.get(t) || 0) + (p.likes ?? 0) + (p.comments ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tag]) => tag);
  }, [feed]);

  if (isLoading) {
    return (
      <Panel title="Instagram Feed Explorer" icon={<Film className="w-4 h-4 text-pink-400" />}>
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="text-xs text-foreground/50">Loading feed from cache...</span>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Instagram Feed Explorer" icon={<Film className="w-4 h-4 text-pink-400" />}>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ModeBadge mode="read-only" />
          <span className="text-[10px] text-foreground/40">
            synced feed for @{username}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex bg-neutral-900 border border-border/40 rounded p-0.5">
            <button
              onClick={() => setLayout("grid")}
              className={`p-1.5 rounded text-xs font-bold transition-all ${
                layout === "grid" ? "bg-primary/20 text-primary" : "text-foreground/40 hover:text-foreground/60"
              }`}
              title="Grid View"
            >
              <Grid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setLayout("scroll")}
              className={`p-1.5 rounded text-xs font-bold transition-all ${
                layout === "scroll" ? "bg-primary/20 text-primary" : "text-foreground/40 hover:text-foreground/60"
              }`}
              title="Scroll View"
            >
              <List className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setLayout("reels")}
              className={`p-1.5 rounded text-xs font-bold transition-all ${
                layout === "reels" ? "bg-primary/20 text-primary" : "text-foreground/40 hover:text-foreground/60"
              }`}
              title="Reels View"
            >
              <Film className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold rounded border border-border/40 text-foreground/70 hover:text-foreground hover:border-primary/40 transition-colors disabled:opacity-50"
          >
            {sync.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Sync
          </button>
        </div>
      </div>

      {/* Modern Search & Filtering Bar */}
      <div className="flex flex-col md:flex-row gap-3 mb-4 p-3 bg-neutral-900/10 border border-border/20 rounded-lg">
        {/* Search */}
        <div className="flex-1 relative">
          <Search className="w-4 h-4 text-foreground/40 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search post captions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-background border border-border/40 rounded pl-9 pr-3 py-1.5 text-xs text-foreground placeholder-foreground/30 focus:outline-none focus:border-primary/50"
          />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-1 text-[11px] text-foreground/50">
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Filter:</span>
          </div>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as any)}
            className="bg-neutral-900 border border-border/40 text-foreground text-xs px-2.5 py-1.5 rounded focus:outline-none focus:border-primary/50 cursor-pointer"
          >
            <option value="ALL">🖼️ All Media</option>
            <option value="IMAGE">📷 Images</option>
            <option value="VIDEO">🎥 Videos/Reels</option>
            <option value="CAROUSEL_ALBUM">📚 Carousels</option>
          </select>

          <div className="flex items-center gap-1 text-[11px] text-foreground/50">
            <ArrowUpDown className="w-3.5 h-3.5" />
            <span>Sort:</span>
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="bg-neutral-900 border border-border/40 text-foreground text-xs px-2.5 py-1.5 rounded focus:outline-none focus:border-primary/50 cursor-pointer"
          >
            <option value="posted">📅 Date Fired</option>
            <option value="likes">❤️ Likes Count</option>
            <option value="comments">💬 Comments Count</option>
          </select>
        </div>
      </div>

      {winners.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground/70 mb-1.5">
            <Trophy className="w-3.5 h-3.5 text-amber-400" /> Your winners
            <span className="text-[10px] text-foreground/40 font-normal">— most engagement in the synced feed</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {winners.map((p) => (
              <button
                key={p.id}
                onClick={() => setActiveModalPost(p)}
                title={`${p.likes} likes · ${p.comments} comments`}
                className="shrink-0 w-16 h-16 rounded border border-amber-500/30 overflow-hidden relative hover:border-amber-400/60 transition-all"
              >
                {p.thumbnailUrl || p.mediaUrl ? (
                  <img src={p.thumbnailUrl || p.mediaUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-neutral-800 flex items-center justify-center"><Instagram className="w-4 h-4 text-white/30" /></div>
                )}
                <span className="absolute bottom-0 inset-x-0 bg-black/70 text-white text-[8px] px-1 py-0.5 flex items-center justify-center gap-0.5 font-bold">
                  <Heart className="w-2 h-2" />{p.likes}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {topHashtags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          <span className="text-[10px] text-foreground/40">Top tags:</span>
          {topHashtags.map((tag) => (
            <button
              key={tag}
              onClick={() => setSearchQuery(searchQuery.toLowerCase() === tag ? "" : tag)}
              className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors ${
                searchQuery.toLowerCase() === tag
                  ? "bg-primary/15 text-primary border-primary/40"
                  : "border-border/30 text-foreground/55 hover:text-foreground hover:border-primary/40"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {!filteredFeed.length ? (
        <div className="text-center py-20 border border-border/30 bg-card rounded-lg space-y-3">
          <Instagram className="w-12 h-12 text-foreground/20 mx-auto" />
          <p className="font-bold text-base text-foreground/40 tracking-wider">NO MATCHING POSTS FOUND</p>
          <p className="text-foreground/30 text-xs max-w-sm mx-auto leading-relaxed">
            {feed?.length 
              ? "Try adjusting your search query or media filters above." 
              : "Sync your feed above to fetch and cache the latest posts and reels from Meta."}
          </p>
        </div>
      ) : layout === "grid" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {filteredFeed.map((post) => (
            <div
              key={post.id}
              onClick={() => setActiveModalPost(post)}
              className="relative aspect-square bg-neutral-950 rounded-lg overflow-hidden border border-border/20 hover:border-primary/40 transition-all cursor-pointer group"
            >
              {post.thumbnailUrl || post.mediaUrl ? (
                <img src={post.thumbnailUrl || post.mediaUrl} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-neutral-900">
                  <Instagram className="w-8 h-8 text-white/10" />
                </div>
              )}
              <div className="absolute top-2 right-2 p-1 bg-black/60 rounded backdrop-blur-sm text-white">
                {post.type === "VIDEO" ? <Film className="w-3 h-3" /> : post.type === "CAROUSEL_ALBUM" ? <Image className="w-3 h-3" /> : <Camera className="w-3 h-3" />}
              </div>
              <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 flex items-center justify-center gap-4 text-white font-bold text-xs transition-opacity duration-200">
                <span className="flex items-center gap-1"><Heart className="w-3.5 h-3.5 fill-white" /> {post.likes}</span>
                <span className="flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5" /> {post.comments}</span>
              </div>
            </div>
          ))}
        </div>
      ) : layout === "reels" ? (
        <ReelsFeedExplorer feed={filteredFeed} username={username} />
      ) : (
        <div className="max-w-xl mx-auto space-y-6">
          {filteredFeed.map((post) => (
            <FeedPostCard key={post.id} post={post} username={username} />
          ))}
        </div>
      )}

      {activeModalPost && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto"
          onClick={() => setActiveModalPost(null)}
        >
          <div
            className="bg-background border border-border/30 rounded-xl overflow-hidden shadow-2xl max-w-4xl w-full flex flex-col md:flex-row max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="md:w-3/5 bg-black flex items-center justify-center min-h-[300px]">
              {activeModalPost.type === "VIDEO" && activeModalPost.mediaUrl ? (
                <VideoPlayer src={activeModalPost.mediaUrl} poster={activeModalPost.thumbnailUrl} />
              ) : activeModalPost.mediaUrl ? (
                <img src={activeModalPost.mediaUrl} alt="" className="w-full max-h-[80vh] object-contain" />
              ) : (
                <div className="w-full h-64 flex items-center justify-center">
                  <Instagram className="w-16 h-16 text-white/10" />
                </div>
              )}
            </div>
            
            <div className="md:w-2/5 flex flex-col max-h-[90vh]">
              <div className="flex items-center justify-between p-3 border-b border-border/10 bg-neutral-900/10">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-extrabold">@{username}</span>
                  <span className="text-[10px] text-foreground/40 font-mono">
                    {new Date(activeModalPost.posted).toLocaleDateString()}
                  </span>
                </div>
                <button
                  onClick={() => setActiveModalPost(null)}
                  className="p-1 hover:bg-neutral-800 rounded transition-colors text-foreground/50 hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {activeModalPost.caption && (
                  <div className="text-xs leading-relaxed border-b border-border/10 pb-3">
                    <span className="font-extrabold mr-1.5">@{username}</span>
                    <span className="whitespace-pre-wrap">{activeModalPost.caption}</span>
                  </div>
                )}

                <div className="flex items-center gap-4 text-xs font-bold text-foreground/75">
                  <span className="flex items-center gap-1"><Heart className="w-4 h-4 text-pink-500 fill-pink-500/10" /> {activeModalPost.likes} likes</span>
                  <span className="flex items-center gap-1"><MessageCircle className="w-4 h-4 text-primary" /> {activeModalPost.comments} comments</span>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => onRepurpose(activeModalPost.caption || "")}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded border border-primary/40 text-primary hover:bg-primary/10 transition-colors"
                  >
                    <Wand2 className="w-3.5 h-3.5" /> Repurpose in Create
                  </button>
                  {activeModalPost.link && (
                    <a
                      href={activeModalPost.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded border border-border/40 text-foreground/70 hover:text-foreground hover:border-primary/40 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> Open on Instagram
                    </a>
                  )}
                </div>

                <div className="space-y-3">
                  <ModalCommentsList mediaId={activeModalPost.id} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

function ModalCommentsList({ mediaId }: { mediaId: string }) {
  const { data: commentsRes, isLoading } = trpc.instagramAdmin.getComments.useQuery({ mediaId });
  const comments = commentsRes?.comments ?? [];

  if (isLoading) {
    return (
      <div className="py-8 text-center text-xs text-foreground/40 flex items-center justify-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-primary" /> Loading comments...
      </div>
    );
  }

  if (comments.length === 0) {
    return <div className="py-6 text-center text-xs text-foreground/30 italic">No comments on this post yet.</div>;
  }

  return (
    <div className="space-y-3">
      {comments.map((comment: any) => (
        <CommentModerationRow key={comment.id} comment={comment} />
      ))}
    </div>
  );
}

/** Tiny copy-to-clipboard button (in-DOM feedback; window.* dialogs are dead in the PWA). */
function InlineCopy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
      className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded border border-border/40 text-foreground/70 hover:text-foreground hover:border-primary/40 transition-colors shrink-0"
    >
      {copied ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Sparkles className="w-3 h-3" />}
      {copied ? "Copied" : "Copy draft"}
    </button>
  );
}

/** Unified-inbox section: Google reviews awaiting a reply, worst-rating first,
 *  shown beside IG comments so one screen covers both channels. Copy-only — the
 *  full approve/post workflow stays in the Review Replies tab; the AI draft is
 *  claim-safety-checked here so the operator sees blockers before pasting. */
function ReviewInboxSection() {
  const { data: drafts } = trpc.reviewReplies.list.useQuery({ status: "draft", limit: 20 });
  const rows = ((drafts ?? []) as Array<{ id: number; reviewerName: string; reviewRating: number; reviewText: string | null; draftReply: string | null }>)
    .sort((a, b) => (a.reviewRating ?? 5) - (b.reviewRating ?? 5));
  if (!rows.length) return null;
  return (
    <div className="mb-4 border border-amber-500/30 bg-amber-500/5 rounded p-3 space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground/70 flex-wrap">
        <Star className="w-3.5 h-3.5 text-amber-400" /> Google reviews awaiting a reply ({rows.length})
        <span className="text-[10px] text-foreground/40 font-normal">— worst first · copy the draft, paste in Google Business</span>
      </div>
      {rows.slice(0, 5).map((r) => {
        const blockers = r.draftReply ? checkReviewReply(r.draftReply).filter((f) => f.severity === "block") : [];
        return (
          <div key={r.id} className="bg-background/40 border border-border/30 rounded p-2 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-amber-400">{"★".repeat(r.reviewRating ?? 5)}{"☆".repeat(Math.max(0, 5 - (r.reviewRating ?? 5)))}</span>
              <span className="text-[11px] font-bold text-foreground/80">{r.reviewerName}</span>
            </div>
            {r.reviewText && <p className="text-[11px] text-foreground/60 italic line-clamp-2">"{r.reviewText}"</p>}
            {r.draftReply && (
              <div className="flex items-start justify-between gap-2">
                <p className="text-[11px] text-foreground/80 leading-relaxed">{r.draftReply}</p>
                <InlineCopy text={r.draftReply} />
              </div>
            )}
            {blockers.length > 0 && (
              <p className="text-[10px] text-red-400 flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                Edit before posting: {blockers.map((f) => f.rule).join(", ")}
              </p>
            )}
          </div>
        );
      })}
      {rows.length > 5 && <p className="text-[10px] text-foreground/40">+{rows.length - 5} more in the Review Replies tab.</p>}
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

  const selectedPost = useMemo(() => {
    return feed?.find(p => p.id === mediaId);
  }, [feed, mediaId]);

  const comments = useMemo(() => {
    // Unanswered first; then triage order (complaints + questions on top, spam
    // last). Comments we've already replied to sink to the bottom.
    return [...(commentsRes?.comments ?? [])].sort((a, b) => {
      if (!!a.replied !== !!b.replied) return a.replied ? 1 : -1;
      return classifyComment(b.text).priority - classifyComment(a.text).priority;
    });
  }, [commentsRes]);

  const { data: account } = trpc.instagramAdmin.getAccountInfo.useQuery();
  const username = account?.username || "nicks_tire_euclid";

  return (
    <Panel title="Unified inbox — comments + reviews" icon={<MessageCircle className="w-4 h-4 text-pink-400" />}>
      <div className="flex items-center gap-2 mb-2">
        <ModeBadge mode="live" />
        <span className="text-[10px] text-foreground/40">IG replies post live (claim-safety-gated, two-tap); Google review drafts are copy-only</span>
      </div>

      <ReviewInboxSection />
      {!feed?.length ? (
        <p className="text-xs text-muted-foreground py-3">No posts in the cache yet — tap <strong>Sync feed</strong> above.</p>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-2 mb-3">
            {feed.map((p) => (
              <button
                key={p.id}
                onClick={() => setMediaId(p.id)}
                className={`shrink-0 w-16 h-16 rounded border overflow-hidden relative transition-all ${
                  mediaId === p.id ? "border-primary ring-2 ring-primary/20 scale-95" : "border-border/30 opacity-70 hover:opacity-100"
                }`}
              >
                {p.thumbnailUrl || p.mediaUrl ? (
                  <img src={p.thumbnailUrl || p.mediaUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-neutral-800 flex items-center justify-center"><Instagram className="w-4 h-4 text-white/30" /></div>
                )}
                <span className="absolute bottom-0 right-0 bg-black/70 text-white text-[8px] px-1 rounded-tl flex items-center gap-0.5 font-bold">
                  <MessageCircle className="w-2 h-2" />{p.comments}
                </span>
              </button>
            ))}
          </div>

          {!mediaId ? (
            <p className="text-[11px] text-foreground/40 text-center py-10 bg-background/5 rounded-lg border border-dashed border-border/20">
              Pick a post above to load its comments.
            </p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
              <div className="lg:col-span-4 space-y-3 bg-neutral-900/10 border border-border/25 rounded-lg p-3">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Active Post Context</div>
                {selectedPost && (
                  <div className="space-y-3">
                    <div className="rounded overflow-hidden bg-black flex items-center justify-center">
                      {selectedPost.type === "VIDEO" && selectedPost.mediaUrl ? (
                        <VideoPlayer src={selectedPost.mediaUrl} poster={selectedPost.thumbnailUrl} />
                      ) : selectedPost.mediaUrl ? (
                        <img src={selectedPost.mediaUrl} alt="" className="w-full max-h-[300px] object-contain" />
                      ) : (
                        <div className="w-full h-40 bg-neutral-900 flex items-center justify-center">
                          <Instagram className="w-10 h-10 text-white/10" />
                        </div>
                      )}
                    </div>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between text-[10px] text-foreground/50">
                        <span className="font-semibold text-foreground/70">Type: {selectedPost.type}</span>
                        <span>{new Date(selectedPost.posted).toLocaleDateString()}</span>
                      </div>
                      <p className="text-[11px] text-foreground/75 italic line-clamp-4">
                        {selectedPost.caption || "(no caption)"}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="lg:col-span-8 space-y-3">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold flex items-center justify-between">
                  <span>Follower Comments</span>
                  {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />}
                </div>

                {isLoading ? (
                  <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
                ) : commentsRes && !commentsRes.ok ? (
                  <p className="text-[11px] text-amber-400 flex items-start gap-1">
                    <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />{commentsRes.error}
                  </p>
                ) : !comments.length ? (
                  <p className="text-[11px] text-foreground/40 italic text-center py-8 bg-background/5 border border-border/10 rounded-lg">
                    No comments on this post yet.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {comments.map((c) => (
                      <CommentModerationRow key={c.id} comment={c} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

/** Next future occurrence of a (dayOfWeek 0-6, hour) in local time. */
function nextOccurrence(dayOfWeek: number, hour: number): Date {
  const now = new Date();
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  let days = (dayOfWeek - now.getDay() + 7) % 7;
  if (days === 0 && d.getTime() <= now.getTime()) days = 7;
  d.setDate(d.getDate() + days);
  return d;
}

/** Format a Date as a datetime-local input value (local time). */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function PublishPanel({
  setSub,
  setActiveModalPost,
}: {
  setSub: (sub: any) => void;
  setActiveModalPost: (post: any) => void;
}) {
  const [platforms, setPlatforms] = useState<("facebook" | "instagram")[]>(["instagram"]);
  const [mediaType, setMediaType] = useState<"image" | "video" | "carousel">("image");
  const [caption, setCaption] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [carouselUrls, setCarouselUrls] = useState("");
  const [imgPrompt, setImgPrompt] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pubStatus, setPubStatus] = useState<{ type: "success" | "error" | null; msg: string }>({ type: null, msg: "" });

  const utils = trpc.useUtils();
  const { data: status } = trpc.instagramAdmin.getConnectionStatus.useQuery();
  const { data: account } = trpc.instagramAdmin.getAccountInfo.useQuery();
  const username = account?.username || "nicks_tire_euclid";

  const sync = trpc.instagramAdmin.syncFeed.useMutation({
    onSuccess: () => {
      utils.instagramAdmin.getLiveFeed.invalidate();
      utils.instagramAdmin.getLiveFeed.fetch({ limit: 30 }).then((feedPosts) => {
        const posts = feedPosts || [];
        const matched = posts.find(
          (p: any) =>
            p.id === publishMutation.data?.postId ||
            (p.caption && p.caption.includes(caption.slice(0, 30)))
        ) || posts[0];

        if (matched) {
          setSub("feed");
          setActiveModalPost(matched);
        } else {
          setSub("feed");
        }
      });
    },
    onError: (err) => {
      toast.error("Publish succeeded but feed sync failed: " + err.message);
      setSub("feed");
    }
  });

  const publishMutation = trpc.instagramAdmin.publishPost.useMutation({
    onSuccess: () => {
      setConfirming(false);
      setCaption("");
      setMediaUrl("");
      setCarouselUrls("");
      setPubStatus({
        type: "success",
        msg: `Successfully published post! Syncing feed in background...`,
      });
      toast.success("Published! Syncing live feed...");
      sync.mutate();
    },
    onError: (err) => {
      setConfirming(false);
      setPubStatus({
        type: "error",
        msg: `Publish failed: ${err.message}`,
      });
    },
  });

  const regenImage = trpc.instagramAdmin.regenerateImage.useMutation({
    onSuccess: (r) => {
      if (r.ok) {
        setMediaUrl(r.url);
        setPubStatus({ type: null, msg: "" });
      }
    },
  });

  const { data: scheduledQueueRaw } = trpc.instagramAdmin.listScheduled.useQuery({ limit: 25 });
  const queue = (scheduledQueueRaw ?? []) as Array<{
    id: number; status: string; scheduledAt: string | Date; platforms: string[]; caption: string; error: string | null;
  }>;
  const schedule = trpc.instagramAdmin.schedulePost.useMutation({
    onSuccess: () => {
      setScheduledAt("");
      setCaption("");
      setMediaUrl("");
      setCarouselUrls("");
      setPubStatus({ type: "success", msg: "Scheduled — the queue will publish it at the set time." });
      utils.instagramAdmin.listScheduled.invalidate();
    },
    onError: (err) => setPubStatus({ type: "error", msg: `Schedule failed: ${err.message}` }),
  });
  const cancelSchedule = trpc.instagramAdmin.cancelScheduled.useMutation({
    onSuccess: () => utils.instagramAdmin.listScheduled.invalidate(),
  });
  const { data: analytics } = trpc.instagramAdmin.getAnalytics.useQuery();
  const bestTime = analytics?.bestPostingTimes?.[0];

  const carouselList = carouselUrls.split(/[\n,]/).map((s) => s.trim()).filter((s) => s.startsWith("http"));
  const isValid =
    platforms.length > 0 &&
    caption.trim().length > 0 &&
    (!platforms.includes("instagram") ||
      (mediaType === "carousel"
        ? carouselList.length >= 2 && carouselList.length <= 10
        : mediaUrl.trim().startsWith("http")));

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
          {/* Target Platforms */}
          <div className="space-y-2 bg-neutral-900/10 border border-border/20 rounded p-3">
            <span className="text-[10px] uppercase tracking-wider text-foreground/50 font-semibold block">
              0. Target Platforms
            </span>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-xs font-semibold text-foreground/80 cursor-pointer">
                <input
                  type="checkbox"
                  checked={platforms.includes("instagram")}
                  disabled={status && !status.instagramReady}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setPlatforms([...platforms, "instagram"]);
                    } else {
                      setPlatforms(platforms.filter((p) => p !== "instagram"));
                    }
                  }}
                  className="rounded border-border/40 text-primary focus:ring-0 focus:ring-offset-0 bg-background/80 w-3.5 h-3.5 cursor-pointer"
                />
                <span>Instagram {status && !status.instagramReady && <span className="text-[10px] text-amber-500 font-normal">(Not Ready)</span>}</span>
              </label>
              <label className="flex items-center gap-2 text-xs font-semibold text-foreground/80 cursor-pointer">
                <input
                  type="checkbox"
                  checked={platforms.includes("facebook")}
                  disabled={status && !status.facebookReady}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setPlatforms([...platforms, "facebook"]);
                    } else {
                      setPlatforms(platforms.filter((p) => p !== "facebook"));
                    }
                  }}
                  className="rounded border-border/40 text-primary focus:ring-0 focus:ring-offset-0 bg-background/80 w-3.5 h-3.5 cursor-pointer"
                />
                <span>Facebook Page {status && !status.facebookReady && <span className="text-[10px] text-amber-500 font-normal">(Not Ready)</span>}</span>
              </label>
            </div>
          </div>

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
              <button
                type="button"
                onClick={() => {
                  setMediaType("carousel");
                  setConfirming(false);
                  setPubStatus({ type: null, msg: "" });
                }}
                className={`px-3 py-1.5 rounded text-xs font-bold transition-all ${
                  mediaType === "carousel"
                    ? "bg-primary/20 text-primary"
                    : "text-foreground/40 hover:text-foreground/60"
                }`}
              >
                Carousel
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-foreground/50 font-semibold block">
              2. Media URL (Public HTTPS only)
            </span>
            {mediaType === "carousel" ? (
              <>
                <textarea
                  placeholder={"https://example.com/slide1.jpg\nhttps://example.com/slide2.jpg\n…(2–10 public HTTPS image URLs, one per line)"}
                  value={carouselUrls}
                  onChange={(e) => {
                    setCarouselUrls(e.target.value);
                    setConfirming(false);
                    setPubStatus({ type: null, msg: "" });
                  }}
                  rows={4}
                  className="w-full bg-background/80 border border-border/40 rounded p-2 text-xs text-foreground/90 focus:outline-none focus:border-primary/50"
                />
                <p className="text-[10px] text-foreground/40 leading-normal">
                  2–10 public HTTPS image URLs, one per line. {carouselList.length} valid URL{carouselList.length === 1 ? "" : "s"} detected.
                </p>
              </>
            ) : (
              <>
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
                {mediaType === "image" && (
                  <div className="flex items-center gap-2 pt-1.5">
                    <input
                      type="text"
                      value={imgPrompt}
                      onChange={(e) => setImgPrompt(e.target.value)}
                      placeholder="…or describe an image and generate one with AI"
                      className="flex-1 bg-background/80 border border-border/40 rounded p-2 text-xs text-foreground/90 focus:outline-none focus:border-primary/50"
                    />
                    <button
                      type="button"
                      onClick={() => regenImage.mutate({ prompt: imgPrompt.trim() })}
                      disabled={regenImage.isPending || imgPrompt.trim().length < 3}
                      className="inline-flex items-center gap-1.5 px-2.5 py-2 text-[10px] font-semibold rounded border border-border/40 text-foreground/70 hover:text-foreground hover:border-primary/40 transition-colors disabled:opacity-50 shrink-0"
                    >
                      {regenImage.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-pink-400" />}
                      Generate
                    </button>
                  </div>
                )}
                {regenImage.data && !regenImage.data.ok && (
                  <p className="text-[10px] text-red-400 flex items-start gap-1">
                    <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />{regenImage.data.error}
                  </p>
                )}
              </>
            )}
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
              className="w-full bg-background/80 border border-border/45 rounded p-2.5 text-xs text-foreground/95 leading-relaxed focus:outline-none focus:border-primary/50"
            />
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => {
                if (!isValid) return;
                if (confirming) {
                  publishMutation.mutate({
                    platforms,
                    caption,
                    imageUrl: mediaType === "image" ? mediaUrl : undefined,
                    videoUrl: mediaType === "video" ? mediaUrl : undefined,
                    imageUrls: mediaType === "carousel" ? carouselList : undefined,
                  });
                } else {
                  setConfirming(true);
                }
              }}
              disabled={!isValid || publishMutation.isPending || sync.isPending}
              className={`w-full py-2.5 rounded font-bold text-xs border transition-all duration-200 cursor-pointer ${
                !isValid
                  ? "bg-neutral-800 text-neutral-500 border-neutral-700 cursor-not-allowed"
                  : publishMutation.isPending || sync.isPending
                  ? "bg-neutral-900 border-neutral-800 text-neutral-400 cursor-wait"
                  : confirming
                  ? "bg-pink-600 text-white border-pink-500 animate-pulse hover:bg-pink-700"
                  : "bg-primary/20 text-primary border-primary/40 hover:bg-primary/30"
              }`}
            >
              {publishMutation.isPending || sync.isPending ? (
                <span className="flex items-center justify-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> {publishMutation.isPending ? "Publishing (polls up to 150s)..." : "Synchronizing feed..."}
                </span>
              ) : !isValid ? (
                "Select platform, caption and URL to publish"
              ) : confirming ? (
                `Tap again to confirm - posts live to @${platforms.join(" & @")}`
              ) : (
                "Publish Live"
              )}
            </button>
            {confirming && (
              <p className="text-[10px] text-pink-400 text-center mt-1.5 font-medium">
                Warning: This posts live immediately.
              </p>
            )}
          </div>

          {/* Schedule for later */}
          <div className="space-y-1.5 bg-neutral-900/10 border border-border/20 rounded p-3">
            <span className="text-[10px] uppercase tracking-wider text-foreground/50 font-semibold block">
              Or schedule for later
            </span>
            <div className="flex items-center gap-2">
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="flex-1 bg-background/80 border border-border/40 rounded px-2 py-1.5 text-xs text-foreground/90 focus:outline-none focus:border-primary/50"
              />
              <button
                type="button"
                onClick={() => {
                  if (!isValid || !scheduledAt) return;
                  schedule.mutate({
                    platforms,
                    caption,
                    imageUrl: mediaType === "image" ? mediaUrl : undefined,
                    videoUrl: mediaType === "video" ? mediaUrl : undefined,
                    imageUrls: mediaType === "carousel" ? carouselList : undefined,
                    scheduledAt: new Date(scheduledAt).toISOString(),
                  });
                }}
                disabled={!isValid || !scheduledAt || schedule.isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold rounded border border-border/40 text-foreground/70 hover:text-foreground hover:border-primary/40 transition-colors disabled:opacity-50 shrink-0"
              >
                {schedule.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Clock className="w-3.5 h-3.5" />}
                Schedule
              </button>
            </div>
            <p className="text-[10px] text-foreground/40">Publishes automatically at the set time (your local time). Needs the same media + caption as a live post.</p>
            {bestTime && (
              <button
                type="button"
                onClick={() => setScheduledAt(toLocalInput(nextOccurrence(bestTime.dayOfWeek, bestTime.hourOfDay)))}
                className="text-[10px] text-primary hover:underline"
              >
                ✨ Use your best time — {bestTime.dayName} {bestTime.hourOfDay % 12 === 0 ? 12 : bestTime.hourOfDay % 12}{bestTime.hourOfDay >= 12 ? "pm" : "am"}
              </button>
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

      {queue.length > 0 && (
        <div className="mt-4 border-t border-border/20 pt-3 space-y-2">
          <span className="text-[10px] uppercase tracking-wider text-foreground/50 font-semibold">Scheduled queue</span>
          {queue.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 bg-background/40 border border-border/30 rounded p-2 text-[11px]">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-1.5 py-0.5 text-[9px] font-bold border rounded uppercase ${
                    s.status === "pending" ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                      : s.status === "posted" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      : s.status === "failed" ? "bg-red-500/10 text-red-400 border-red-500/20"
                      : "bg-foreground/5 text-foreground/40 border-border/20"
                  }`}>{s.status}</span>
                  <span className="text-foreground/50">{new Date(s.scheduledAt).toLocaleString()}</span>
                  <span className="text-foreground/30">· {(s.platforms ?? []).join(", ")}</span>
                </div>
                <p className="text-foreground/60 truncate mt-0.5">{s.caption}</p>
                {s.error && <p className="text-[10px] text-red-400 truncate">{s.error}</p>}
              </div>
              {s.status === "pending" && (
                <button
                  onClick={() => cancelSchedule.mutate({ id: s.id })}
                  disabled={cancelSchedule.isPending}
                  className="shrink-0 px-2 py-1 text-[10px] font-semibold rounded border border-border/30 text-foreground/50 hover:text-red-400 hover:border-red-500/40 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

