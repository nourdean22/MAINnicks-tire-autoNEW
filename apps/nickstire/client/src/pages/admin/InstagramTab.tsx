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
import { useState } from "react";
import {
  Instagram, Loader2, RefreshCw, AlertTriangle, CheckCircle2, KeyRound,
  TrendingUp, TrendingDown, Minus, Clock, BarChart3, Trophy, ExternalLink,
  Wand2, Heart, MessageCircle, Send, ShieldCheck, Sparkles,
} from "lucide-react";
import { Panel } from "./shared";
import { trpc } from "@/lib/trpc";
import { checkReviewReply } from "@shared/reviewReplyQa";

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
  live: "bg-pink-500/10 text-pink-400 border-pink-500/20",
} as const;

function ModeBadge({ mode }: { mode: keyof typeof MODE_CLS }) {
  return (
    <span className={`px-1.5 py-0.5 text-[9px] font-bold border rounded uppercase ${MODE_CLS[mode]}`}>
      {mode}
    </span>
  );
}

export default function InstagramTab() {
  return (
    <div className="space-y-4">
      <div className="border border-pink-500/40 bg-pink-500/10 rounded p-3 text-xs text-pink-200 flex items-start gap-2">
        <Instagram className="w-4 h-4 shrink-0 mt-0.5 text-pink-400" />
        <span>
          <strong>Instagram command center.</strong> Connection health, content
          analytics, and (below) the AI co-pilot + comment moderation for
          @nicks_tire_euclid. Drafting rich carousels/reels still lives in the{" "}
          <strong>Social Studios</strong> tab — this is account management + quick actions.
        </span>
      </div>
      <ConnectionPanel />
      <CommentsPanel />
      <CopilotPanel />
      <AnalyticsPanel />
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

function PhoneMockup({ username, latest }: {
  username: string;
  latest?: { caption: string; imageUrl: string | null; status: string };
}) {
  return (
    <div className="mx-auto w-full max-w-[240px] bg-black rounded-[1.4rem] border-4 border-neutral-800 overflow-hidden shadow-xl">
      <div className="flex items-center gap-2 px-3 py-2 bg-neutral-950">
        <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-amber-500 to-pink-500" />
        <span className="text-[11px] font-semibold text-white">{username}</span>
        <span className="ml-auto text-white/40 text-xs">···</span>
      </div>
      <div className="aspect-square bg-neutral-900 flex items-center justify-center">
        {latest?.imageUrl ? (
          <img src={latest.imageUrl} alt="generated draft" className="w-full h-full object-cover" />
        ) : (
          <div className="text-center text-white/30 text-[10px] px-4">
            <Instagram className="w-8 h-8 mx-auto mb-1 opacity-40" />
            Generate a draft to preview it here
          </div>
        )}
      </div>
      <div className="px-3 py-2 bg-neutral-950 space-y-1.5">
        <div className="flex items-center gap-3 text-white/80">
          <Heart className="w-4 h-4" /><MessageCircle className="w-4 h-4" /><Send className="w-4 h-4" />
        </div>
        {latest && (
          <p className="text-[10px] text-white/70 leading-relaxed max-h-24 overflow-hidden whitespace-pre-wrap">
            <span className="font-semibold text-white">{username} </span>{latest.caption}
          </p>
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
  const generate = trpc.instagramAdmin.generatePost.useMutation({
    onSuccess: () => utils.instagramAdmin.getRecentGenerations.invalidate(),
  });

  const latest = recent?.[0];
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
        <PhoneMockup username={username} latest={latest} />
        <div>
          <div className="text-[11px] font-semibold text-foreground/70 mb-1.5">Recent drafts</div>
          {!recent?.length ? (
            <p className="text-[11px] text-foreground/40">No generations yet — pick an angle and tap Generate.</p>
          ) : (
            <div className="space-y-1.5">
              {recent.map((g) => (
                <div key={g.id} className="flex items-center justify-between gap-2 text-[10px] bg-background/40 border border-border/30 rounded px-2 py-1.5">
                  <span className="font-semibold text-foreground/70 capitalize truncate">{g.archetype}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {typeof g.overallScore === "number" && (
                      <span className={scoreColor(g.overallScore / 100)}>{g.overallScore}</span>
                    )}
                    <StatusPill status={g.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
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
