/**
 * ContentSection — Content Manager + AI Ideas Engine
 * Tab 1: Content Manager (articles, notifications, gen log)
 * Tab 2: AI Ideas Engine (trending topics, SEO opportunities, seasonal, competitor gaps)
 */
import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Link } from "wouter";
import {
  StatCard, StatusDot,
} from "./shared";
import {
  Bell, CheckCircle2, ChevronRight, FileText, Loader2, Newspaper,
  Sparkles, XCircle, TrendingUp, Search, Calendar, Target, Zap,
  ArrowUpRight, Lightbulb,
} from "lucide-react";

type ContentTab = "manager" | "ideas";

export default function ContentSection() {
  const [tab, setTab] = useState<ContentTab>("manager");

  return (
    <div className="space-y-6">
      {/* Tab switcher — same pattern as Revenue tabs */}
      <div className="flex items-center gap-1 border-b border-border/20 pb-0">
        {([
          { id: "manager" as const, label: "Content Manager", icon: <FileText className="w-3.5 h-3.5" /> },
          { id: "ideas" as const, label: "AI Ideas Engine", icon: <Lightbulb className="w-3.5 h-3.5" /> },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-bold tracking-wider border-b-2 transition-colors ${
              tab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-foreground/40 hover:text-foreground/60"
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "manager" && <ContentManager />}
      {tab === "ideas" && <AIIdeasEngine />}
    </div>
  );
}

// ─── CONTENT MANAGER (original ContentSection content) ──────────────

function ContentManager() {
  const { data: articles, isLoading: articlesLoading } = trpc.contentAdmin.allArticles.useQuery();
  const { data: notifications, isLoading: notifsLoading } = trpc.contentAdmin.allNotifications.useQuery();
  const { data: genLog } = trpc.contentAdmin.generationLog.useQuery();

  const updateArticle = trpc.contentAdmin.updateArticleStatus.useMutation({
    onSuccess: () => toast.success("Article updated"),
    onError: (err: any) => toast.error("Failed: " + err.message),
  });

  const toggleNotif = trpc.contentAdmin.toggleNotification.useMutation({
    onSuccess: () => toast.success("Notification updated"),
    onError: (err: any) => toast.error("Failed: " + err.message),
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
        <StatCard label="Published" value={articles?.filter((a: any) => a.status === "published").length ?? 0} icon={<CheckCircle2 className="w-4 h-4" />} color="text-emerald-400" />
        <StatCard label="Drafts" value={articles?.filter((a: any) => a.status === "draft").length ?? 0} icon={<Newspaper className="w-4 h-4" />} color="text-amber-400" />
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

      {/* Articles List */}
      <div>
        <h3 className="font-bold text-sm tracking-wide text-foreground mb-4 flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" />
          ARTICLES ({articles?.length ?? 0})
        </h3>
        {articles && articles.length > 0 ? (
          <div className="space-y-3">
            {articles.map((article: any, _aIdx: any) => (
              <div key={article.id} className="stagger-in bg-card border border-border/30 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={{ animationDelay: `${_aIdx * 50}ms` }}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <StatusDot status={article.status} />
                    <h4 className="font-bold text-sm text-foreground tracking-wider truncate">{article.title}</h4>
                  </div>
                  <div className="flex items-center gap-3 text-foreground/40">
                    <span className="text-[12px]">{article.category}</span>
                    <span className="text-[12px]">{article.readTime}</span>
                    <span className="text-[12px]">{new Date(article.createdAt).toLocaleDateString()}</span>
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
            {notifications.map((notif: any) => (
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
    onError: (err: any) => toast.error("Generation failed: " + err.message),
  });

  const isLoading = chatLoading || seasonalLoading || compLoading || contentLoading;

  // Build ideas from intelligence data
  const ideas: ContentIdea[] = [];

  // Trending Topics — from chat FAQ pipeline
  if (chatFunnel && typeof chatFunnel === "object") {
    const funnel = chatFunnel as any;
    const topics = funnel.topQuestions || funnel.topTopics || funnel.questions || [];
    if (Array.isArray(topics)) {
      topics.slice(0, 3).forEach((q: any) => {
        const question = typeof q === "string" ? q : q.question || q.topic || q.label || "";
        if (question) {
          ideas.push({
            topic: `Answer: "${question}"`,
            reason: "Customers are asking this — article captures search + builds FAQ authority",
            impact: "high",
            source: "trending",
          });
        }
      });
    }
  }

  // Competitor Gaps
  if (competitor && typeof competitor === "object") {
    const comp = competitor as any;
    const gaps = comp.gaps || comp.opportunities || comp.missingTopics || [];
    if (Array.isArray(gaps)) {
      gaps.slice(0, 3).forEach((g: any) => {
        const topic = typeof g === "string" ? g : g.topic || g.keyword || g.label || "";
        if (topic) {
          ideas.push({
            topic: topic,
            reason: "Competitors rank for this — we don't. Content fills the gap.",
            impact: "high",
            source: "competitor",
          });
        }
      });
    }
  }

  // Content Performance — double down on what works
  if (contentPerf && typeof contentPerf === "object") {
    const perf = contentPerf as any;
    const topContent = perf.topPerformers || perf.bestArticles || perf.winners || [];
    if (Array.isArray(topContent)) {
      topContent.slice(0, 2).forEach((c: any) => {
        const title = typeof c === "string" ? c : c.title || c.topic || c.label || "";
        if (title) {
          ideas.push({
            topic: `Follow-up: "${title}" — Part 2 / Deep Dive`,
            reason: "This topic already performs well. A follow-up compounds the traffic.",
            impact: "medium",
            source: "seo",
          });
        }
      });
    }
  }

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
