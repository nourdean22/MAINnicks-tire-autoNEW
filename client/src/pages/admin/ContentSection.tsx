/**
 * ContentSection — Content Manager + AI Ideas Engine
 * Tab 1: Content Manager (articles, notifications, gen log)
 * Tab 2: AI Ideas Engine (trending topics, SEO opportunities, seasonal, competitor gaps)
 */
import React, { useState } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { toast } from "sonner";
import { Link } from "wouter";
import {
  StatCard, StatusDot, PageHeader, TabBar, formatDate,
} from "./shared";
import {
  Bell, CheckCircle2, ChevronRight, FileText, Loader2, Newspaper,
  Sparkles, XCircle, TrendingUp, Search, Calendar, Target, Zap,
  ArrowUpRight, Lightbulb,
} from "lucide-react";

type ContentTab = "manager" | "ideas";

// Inferred from the tRPC AppRouter — replaces 10 `any` annotations
// (admin audit §3 follow-up; same pattern as DispatchSection cleanup).
// chatFunnel / competitorGap / contentPerformance are intentionally NOT
// aliased — those returns are loose analytics shapes; we narrow at use
// site via pickArray/pickString helpers further down (safer than `any`).
type Article = NonNullable<RouterOutputs["contentAdmin"]["allArticles"]>[number];
type Notification = NonNullable<RouterOutputs["contentAdmin"]["allNotifications"]>[number];

export default function ContentSection() {
  const [tab, setTab] = useState<ContentTab>("manager");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Content & AI"
        subtitle="Articles, notifications, GBP posts, AI ideas engine — everything customer-facing copy + automation"
        icon={<FileText className="w-5 h-5" />}
      />
      <TabBar
        tabs={[
          { id: "manager", label: "Content Manager", icon: <FileText className="w-3.5 h-3.5" /> },
          { id: "ideas", label: "AI Ideas Engine", icon: <Lightbulb className="w-3.5 h-3.5" /> },
        ]}
        activeTab={tab}
        onChange={setTab}
      />

      {tab === "manager" && <ContentManager />}
      {tab === "ideas" && <AIIdeasEngine />}
    </div>
  );
}

// ─── CONTENT MANAGER (original ContentSection content) ──────────────

function ContentManager() {
  const utils = trpc.useUtils();
  const { data: articles, isLoading: articlesLoading } = trpc.contentAdmin.allArticles.useQuery();
  const { data: notifications, isLoading: notifsLoading } = trpc.contentAdmin.allNotifications.useQuery();
  const { data: genLog } = trpc.contentAdmin.generationLog.useQuery();

  // wave-112 — was missing utils.X.invalidate() calls; PUBLISH/UNPUBLISH/
  // RESTORE / DISABLE updates left the list + stat cards stale until a
  // full page refresh. Now invalidates the relevant query on success.
  const updateArticle = trpc.contentAdmin.updateArticleStatus.useMutation({
    onSuccess: () => {
      void utils.contentAdmin.allArticles.invalidate();
      toast.success("Article updated");
    },
    onError: (err: { message: string }) => toast.error("Failed: " + err.message),
  });

  const toggleNotif = trpc.contentAdmin.toggleNotification.useMutation({
    onSuccess: () => {
      void utils.contentAdmin.allNotifications.invalidate();
      toast.success("Notification updated");
    },
    onError: (err: { message: string }) => toast.error("Failed: " + err.message),
  });

  if (articlesLoading || notifsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Content Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Articles" value={articles?.length ?? 0} icon={<FileText className="w-4 h-4" />} color="text-foreground" />
        <StatCard label="Published" value={articles?.filter((a: Article) => a.status === "published").length ?? 0} icon={<CheckCircle2 className="w-4 h-4" />} color="text-emerald-400" />
        <StatCard label="Drafts" value={articles?.filter((a: Article) => a.status === "draft").length ?? 0} icon={<Newspaper className="w-4 h-4" />} color="text-amber-400" />
        <StatCard label="AI Generations" value={genLog?.length ?? 0} icon={<Sparkles className="w-4 h-4" />} color="text-purple-400" />
      </div>

      {/* Quick Link to Full Content Manager */}
      <div className="bg-card border border-border/30 p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Sparkles className="w-5 h-5 text-primary" />
          <div>
            <p className="font-bold text-sm text-foreground tracking-wider">FULL CONTENT MANAGER</p>
            <p className="text-[12px] text-foreground/40">Generate articles, manage notifications, view generation logs</p>
          </div>
        </div>
        <Link href="/admin/content" className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 font-bold text-xs tracking-wide hover:bg-primary/90">
          OPEN <ChevronRight className="w-4 h-4" />
        </Link>
      </div>

      {/* GBP Post Generator — voice-graded one-off post for business.google.com */}
      <GBPPostGenerator />


      {/* Articles List */}
      <div>
        <h3 className="font-bold text-sm tracking-wide text-foreground mb-4 flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" />
          ARTICLES ({articles?.length ?? 0})
        </h3>
        {articles && articles.length > 0 ? (
          <div className="space-y-3">
            {articles.map((article: Article, _aIdx: number) => (
              <div key={article.id} className="stagger-in bg-card border border-border/30 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={{ animationDelay: `${_aIdx * 50}ms` }}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <StatusDot status={article.status} />
                    <h4 className="font-bold text-sm text-foreground tracking-wider truncate">{article.title}</h4>
                  </div>
                  <div className="flex items-center gap-3 text-foreground/40">
                    <span className="text-[12px]">{article.category}</span>
                    <span className="text-[12px]">{article.readTime}</span>
                    <span className="text-[12px]">{formatDate(article.createdAt)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {article.status === "draft" && (
                    <button
                      onClick={() => updateArticle.mutate({ id: article.id, status: "published" })}
                      disabled={updateArticle.isPending}
                      className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-1.5 font-bold text-[10px] tracking-wide hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3 h-3" /> PUBLISH
                    </button>
                  )}
                  {article.status === "published" && (
                    <button
                      onClick={() => updateArticle.mutate({ id: article.id, status: "draft" })}
                      disabled={updateArticle.isPending}
                      className="flex items-center gap-1.5 border border-amber-500/30 text-amber-400 px-3 py-1.5 font-bold text-[10px] tracking-wide hover:bg-amber-500/10 disabled:opacity-50"
                    >
                      UNPUBLISH
                    </button>
                  )}
                  {article.status === "rejected" && (
                    <button
                      onClick={() => updateArticle.mutate({ id: article.id, status: "draft" })}
                      disabled={updateArticle.isPending}
                      className="flex items-center gap-1.5 border border-border/30 text-foreground/50 px-3 py-1.5 font-bold text-[10px] tracking-wide hover:text-foreground disabled:opacity-50"
                    >
                      RESTORE
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 border border-border/30 bg-card">
            <FileText className="w-10 h-10 text-foreground/20 mx-auto mb-3" />
            <p className="text-[13px] text-foreground/40">No articles generated yet</p>
          </div>
        )}
      </div>

      {/* Notifications List */}
      <div>
        <h3 className="font-bold text-sm tracking-wide text-foreground mb-4 flex items-center gap-2">
          <Bell className="w-4 h-4 text-primary" />
          NOTIFICATION BAR MESSAGES ({notifications?.length ?? 0})
        </h3>
        {notifications && notifications.length > 0 ? (
          <div className="space-y-2">
            {notifications.map((notif: Notification) => (
              <div key={notif.id} className="bg-card border border-border/30 p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${notif.isActive === 1 ? "bg-emerald-400" : "bg-foreground/30"}`} />
                  <p className="text-[13px] text-foreground/70 truncate">{notif.message}</p>
                </div>
                <button
                  onClick={() => toggleNotif.mutate({ id: notif.id, isActive: notif.isActive === 1 ? 0 : 1 })}
                  disabled={toggleNotif.isPending}
                  className={`shrink-0 px-3 py-1.5 font-bold text-[10px] tracking-wide disabled:opacity-50 ${
                    notif.isActive === 1
                      ? "border border-red-500/30 text-red-400 hover:bg-red-500/10"
                      : "border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                  }`}
                >
                  {notif.isActive === 1 ? "DISABLE" : "ENABLE"}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 border border-border/30 bg-card">
            <Bell className="w-8 h-8 text-foreground/20 mx-auto mb-2" />
            <p className="text-[13px] text-foreground/40">No notification messages yet</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── GBP POST GENERATOR ───────────────────────────────────
// Voice-graded one-off post generator for business.google.com.
// GBP Posts API was deprecated by Google in 2024 — copy-paste only.
// Cron runs every Monday + first-Monday recap; this surfaces ad-hoc.

type Archetype = "proof" | "anti" | "math" | "seasonal";
type GBPPostResult = RouterOutputs["contentAdmin"]["generateGBPPost"];
type GBPHistoryRow = RouterOutputs["contentAdmin"]["gbpPostHistory"][number];

const ARCHETYPE_LABELS: Record<Archetype | "auto", string> = {
  auto: "AUTO",
  proof: "PROOF",
  anti: "ANTI",
  math: "MATH",
  seasonal: "SEASONAL",
};

function GBPPostGenerator() {
  const [result, setResult] = useState<GBPPostResult | null>(null);
  const [copied, setCopied] = useState(false);

  const utils = trpc.useUtils();
  const { data: history } = trpc.contentAdmin.gbpPostHistory.useQuery();

  const generate = trpc.contentAdmin.generateGBPPost.useMutation({
    onSuccess: (data) => {
      setResult(data);
      setCopied(false);
      // Refresh history panel so the new post shows up immediately.
      utils.contentAdmin.gbpPostHistory.invalidate();
      toast.success(`Generated ${data.archetype.toUpperCase()} post`);
    },
    onError: (err: { message: string }) => toast.error("Failed: " + err.message),
  });

  const handleCopy = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.text).then(() => {
      setCopied(true);
      toast.success("Post copied");
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => toast.error("Copy failed"));
  };

  return (
    <div className="bg-card border border-border/30 p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Target className="w-5 h-5 text-primary" />
          <div>
            <p className="font-bold text-sm text-foreground tracking-wider">GBP POST GENERATOR</p>
            <p className="text-[12px] text-foreground/40">Voice-graded post for business.google.com — copy + paste</p>
          </div>
        </div>
      </div>

      {/* Archetype buttons */}
      <div className="flex flex-wrap gap-2">
        {(["auto", "proof", "anti", "math", "seasonal"] as const).map((a) => (
          <button
            key={a}
            onClick={() => generate.mutate(a === "auto" ? undefined : { forceArchetype: a })}
            disabled={generate.isPending}
            className="flex items-center gap-1.5 border border-border/30 text-foreground/70 px-3 py-1.5 font-bold text-[10px] tracking-wide hover:bg-primary/10 hover:text-primary hover:border-primary/40 disabled:opacity-50"
          >
            {generate.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            {ARCHETYPE_LABELS[a]}
          </button>
        ))}
      </div>

      {/* Result panel */}
      {result && (
        <div className="border border-border/30 bg-background/40 p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold tracking-wider text-primary">
              ARCHETYPE: {result.archetype.toUpperCase()}
            </span>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1 font-bold text-[10px] tracking-wide hover:bg-primary/90"
            >
              {copied ? <CheckCircle2 className="w-3 h-3" /> : <FileText className="w-3 h-3" />}
              {copied ? "COPIED" : "COPY"}
            </button>
          </div>
          <pre className="whitespace-pre-wrap text-[12px] text-foreground/80 font-mono leading-relaxed">{result.text}</pre>
          <div className="text-[11px] text-foreground/50 space-y-1 border-t border-border/20 pt-2">
            <div><span className="font-bold text-foreground/70">CTA:</span> {result.callToAction}</div>
            <div className="break-all"><span className="font-bold text-foreground/70">URL:</span> {result.ctaUrl}</div>
            <div><span className="font-bold text-foreground/70">IMAGE:</span> {result.imageHint}</div>
          </div>
        </div>
      )}

      {/* Post history (last 14 — variety guard window) */}
      {history && history.length > 0 && (
        <details className="border-t border-border/20 pt-3">
          <summary className="cursor-pointer text-[11px] font-bold tracking-wider text-foreground/50 hover:text-foreground/80">
            POST HISTORY · LAST {history.length} (variety window)
          </summary>
          <div className="mt-2 space-y-1.5">
            {history.map((row: GBPHistoryRow) => {
              const date = new Date(row.postedAt);
              const dayLabel = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
              const archetypeColor =
                row.archetype === "proof" ? "text-emerald-400" :
                row.archetype === "anti" ? "text-amber-400" :
                row.archetype === "math" ? "text-blue-400" :
                "text-purple-400";
              return (
                <div key={row.id} className="flex items-center gap-3 text-[11px] py-1 border-b border-border/10">
                  <span className="text-foreground/40 w-12 shrink-0">{dayLabel}</span>
                  <span className={`font-bold tracking-wider w-16 shrink-0 ${archetypeColor}`}>{row.archetype.toUpperCase()}</span>
                  <span className="text-foreground/30 text-[10px] w-12 shrink-0">{row.source}</span>
                  <span className="text-foreground/60 truncate flex-1">{row.postBody.split("\n")[0]}</span>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}

// ─── AI IDEAS ENGINE ──────────────────────────────────────

type ImpactLevel = "high" | "medium" | "low";

interface ContentIdea {
  topic: string;
  reason: string;
  impact: ImpactLevel;
  source: string;
}

const IMPACT_COLORS: Record<ImpactLevel, string> = {
  high: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  medium: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  low: "bg-foreground/10 text-foreground/50 border-foreground/20",
};

function getMonthSeason(): string {
  const month = new Date().getMonth();
  if (month >= 2 && month <= 4) return "spring";
  if (month >= 5 && month <= 7) return "summer";
  if (month >= 8 && month <= 10) return "fall";
  return "winter";
}

const SEASONAL_TOPICS: Record<string, ContentIdea[]> = {
  spring: [
    { topic: "Spring Tire Changeover: When to Switch from Winter Tires", reason: "Peak season for tire swaps — captures search intent", impact: "high", source: "seasonal" },
    { topic: "Pothole Season: How to Check for Suspension Damage", reason: "Cleveland roads + spring thaw = pothole damage surge", impact: "high", source: "seasonal" },
    { topic: "Spring Car Maintenance Checklist for Cleveland Drivers", reason: "Seasonal maintenance list drives appointment bookings", impact: "medium", source: "seasonal" },
  ],
  summer: [
    { topic: "Road Trip Ready: Pre-Trip Vehicle Inspection Guide", reason: "Summer road trips drive pre-trip inspection demand", impact: "high", source: "seasonal" },
    { topic: "AC Not Blowing Cold? Common Causes and Fixes", reason: "AC repair searches spike June-August", impact: "high", source: "seasonal" },
    { topic: "Best All-Season Tires for Ohio Highway Driving", reason: "Tire buying peaks before summer travel season", impact: "medium", source: "seasonal" },
  ],
  fall: [
    { topic: "When to Switch to Winter Tires in Cleveland", reason: "First frost triggers winter tire search spike", impact: "high", source: "seasonal" },
    { topic: "Fall Car Care: Preparing for Ohio Winters", reason: "Preventive maintenance content captures early planners", impact: "medium", source: "seasonal" },
    { topic: "Brake Inspection Before Winter: What to Look For", reason: "Safety-focused content builds trust and bookings", impact: "medium", source: "seasonal" },
  ],
  winter: [
    { topic: "Dead Battery in the Cold? Here's What to Do", reason: "Battery failures spike below 20F — high search volume", impact: "high", source: "seasonal" },
    { topic: "Best Winter Tires for Cleveland Snow and Ice", reason: "Tire purchase intent peaks early winter", impact: "high", source: "seasonal" },
    { topic: "How to Handle a Flat Tire in Winter Safely", reason: "Emergency content drives brand trust", impact: "medium", source: "seasonal" },
  ],
};

function AIIdeasEngine() {
  const { data: chatFunnel, isLoading: chatLoading } = trpc.intelligence.chatFunnel.useQuery();
  const { data: seasonal, isLoading: seasonalLoading } = trpc.intelligence.seasonalDemand.useQuery();
  const { data: competitor, isLoading: compLoading } = trpc.intelligence.competitorGap.useQuery();
  const { data: contentPerf, isLoading: contentLoading } = trpc.intelligence.contentPerformance.useQuery();

  const generateArticle = trpc.contentAdmin.generateArticle.useMutation({
    onSuccess: () => toast.success("Article generated! Check Content Manager tab to review."),
    onError: (err: { message: string }) => toast.error("Generation failed: " + err.message),
  });

  const isLoading = chatLoading || seasonalLoading || compLoading || contentLoading;

  // Build ideas from intelligence data
  const ideas: ContentIdea[] = [];

  // The 3 intelligence procedures (chatFunnel, competitorGap, contentPerformance)
  // return loose shapes from the analytics layer — we read from any of several
  // possible property names. Using `unknown` instead of `any` here forces the
  // narrowing checks below to actually run instead of silently letting bad data
  // through (which is what the previous `as any` cast was hiding).
  const pickArray = (obj: unknown, keys: string[]): unknown[] => {
    if (!obj || typeof obj !== "object") return [];
    const o = obj as Record<string, unknown>;
    for (const k of keys) {
      if (Array.isArray(o[k])) return o[k] as unknown[];
    }
    return [];
  };
  const pickString = (item: unknown, keys: string[]): string => {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") return "";
    const o = item as Record<string, unknown>;
    for (const k of keys) {
      if (typeof o[k] === "string") return o[k] as string;
    }
    return "";
  };

  // Trending Topics — from chat FAQ pipeline
  pickArray(chatFunnel, ["topQuestions", "topTopics", "questions"]).slice(0, 3).forEach((q) => {
    const question = pickString(q, ["question", "topic", "label"]);
    if (question) {
      ideas.push({
        topic: `Answer: "${question}"`,
        reason: "Customers are asking this — article captures search + builds FAQ authority",
        impact: "high",
        source: "trending",
      });
    }
  });

  // Competitor Gaps
  pickArray(competitor, ["gaps", "opportunities", "missingTopics"]).slice(0, 3).forEach((g) => {
    const topic = pickString(g, ["topic", "keyword", "label"]);
    if (topic) {
      ideas.push({
        topic,
        reason: "Competitors rank for this — we don't. Content fills the gap.",
        impact: "high",
        source: "competitor",
      });
    }
  });

  // Content Performance — double down on what works
  pickArray(contentPerf, ["topPerformers", "bestArticles", "winners"]).slice(0, 2).forEach((c) => {
    const title = pickString(c, ["title", "topic", "label"]);
    if (title) {
      ideas.push({
        topic: `Follow-up: "${title}" — Part 2 / Deep Dive`,
        reason: "This topic already performs well. A follow-up compounds the traffic.",
        impact: "medium",
        source: "seo",
      });
    }
  });

  // Seasonal suggestions — always present
  const season = getMonthSeason();
  const seasonalIdeas = SEASONAL_TOPICS[season] || [];

  // Deduplicate: don't show seasonal ideas if intelligence already covered them
  const existingTopicLower = new Set(ideas.map(i => i.topic.toLowerCase()));
  seasonalIdeas.forEach(s => {
    if (!existingTopicLower.has(s.topic.toLowerCase())) {
      ideas.push(s);
    }
  });

  const sourceIcons: Record<string, React.ReactNode> = {
    trending: <TrendingUp className="w-3.5 h-3.5" />,
    seo: <Search className="w-3.5 h-3.5" />,
    seasonal: <Calendar className="w-3.5 h-3.5" />,
    competitor: <Target className="w-3.5 h-3.5" />,
  };

  const sourceLabels: Record<string, string> = {
    trending: "TRENDING TOPIC",
    seo: "SEO OPPORTUNITY",
    seasonal: "SEASONAL",
    competitor: "COMPETITOR GAP",
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-3 text-foreground/40 text-sm">Loading intelligence data...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Ideas"
          value={ideas.length}
          icon={<Lightbulb className="w-4 h-4" />}
          color="text-primary"
        />
        <StatCard
          label="High Impact"
          value={ideas.filter(i => i.impact === "high").length}
          icon={<Zap className="w-4 h-4" />}
          color="text-emerald-400"
        />
        <StatCard
          label="From Intelligence"
          value={ideas.filter(i => i.source !== "seasonal").length}
          icon={<TrendingUp className="w-4 h-4" />}
          color="text-blue-400"
        />
        <StatCard
          label="Seasonal"
          value={ideas.filter(i => i.source === "seasonal").length}
          icon={<Calendar className="w-4 h-4" />}
          color="text-amber-400"
        />
      </div>

      {/* Ideas Cards */}
      {ideas.length > 0 ? (
        <div className="space-y-3">
          {ideas.map((idea, idx) => (
            <div
              key={idx}
              className="stagger-in bg-card border border-border/30 p-4"
              style={{ animationDelay: `${idx * 50}ms` }}
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  {/* Source badge + impact */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="flex items-center gap-1 text-[10px] font-bold tracking-wider text-primary">
                      {sourceIcons[idea.source]} {sourceLabels[idea.source]}
                    </span>
                    <span className={`px-2 py-0.5 text-[10px] font-bold tracking-wider border ${IMPACT_COLORS[idea.impact]}`}>
                      {idea.impact.toUpperCase()} IMPACT
                    </span>
                  </div>
                  {/* Topic */}
                  <h4 className="font-bold text-sm text-foreground tracking-wider mb-1">
                    {idea.topic}
                  </h4>
                  {/* Reason */}
                  <p className="text-[12px] text-foreground/50">{idea.reason}</p>
                </div>
                {/* Generate button */}
                <button
                  onClick={() => generateArticle.mutate({ topic: idea.topic })}
                  disabled={generateArticle.isPending}
                  className="shrink-0 flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 font-bold text-[10px] tracking-wide hover:bg-primary/90 disabled:opacity-50"
                >
                  {generateArticle.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3" />
                  )}
                  GENERATE ARTICLE
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-16 border border-border/30 bg-card">
          <Lightbulb className="w-10 h-10 text-foreground/20 mx-auto mb-3" />
          <p className="text-[13px] text-foreground/40">No content ideas available yet</p>
          <p className="text-[11px] text-foreground/30 mt-1">Intelligence engines need more data to generate suggestions</p>
        </div>
      )}
    </div>
  );
}
