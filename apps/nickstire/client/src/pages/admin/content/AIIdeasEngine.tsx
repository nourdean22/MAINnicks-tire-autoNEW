/**
 * AIIdeasEngine — trending topics, SEO opportunities, seasonal, competitor gaps.
 *
 * Extracted from ContentSection.tsx (1,515 lines) in the 2026-07-04
 * maintainability split — pure mechanical move, mirrors the ./today/
 * and ./customers/ extraction precedent. No behavior change.
 */
import React, { useState, lazy, Suspense, useMemo } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { toast } from "sonner";
import { Link } from "wouter";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import {
  StatCard, StatusDot, PageHeader, TabBar, formatDate, LoadingState, ErrorState,
  useUrlFilter,
} from "../shared";
import {
  Bell, CheckCircle2, ChevronRight, FileText, Loader2, Newspaper,
  Sparkles, XCircle, TrendingUp, Search, Calendar, Target, Zap,
  ArrowUpRight, Lightbulb, Tag, Trash2, Eye, EyeOff, AlertTriangle,
  ChevronDown, ChevronUp, RefreshCw, BarChart3, ShieldCheck,
  Settings, Link2, Copy, Check, ExternalLink
} from "lucide-react";

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

export function AIIdeasEngine() {
  const { data: chatFunnel, isLoading: chatLoading, isError: chatError, refetch: refetchChat } = trpc.intelligence.chatFunnel.useQuery();
  const { data: seasonal, isLoading: seasonalLoading, isError: seasonalError, refetch: refetchSeasonal } = trpc.intelligence.seasonalDemand.useQuery();
  const { data: competitor, isLoading: compLoading, isError: compError, refetch: refetchComp } = trpc.intelligence.competitorGap.useQuery();
  const { data: contentPerf, isLoading: contentLoading, isError: contentError, refetch: refetchContent } = trpc.intelligence.contentPerformance.useQuery();

  const generateArticle = trpc.contentAdmin.generateArticle.useMutation({
    onSuccess: () => toast.success("Article generated! Check Content Manager tab to review."),
    onError: (err: { message: string }) => toast.error("Generation failed: " + err.message),
  });

  const isLoading = chatLoading || seasonalLoading || compLoading || contentLoading;
  const isError = chatError || seasonalError || compError || contentError;
  const refetchAll = () => { refetchChat(); refetchSeasonal(); refetchComp(); refetchContent(); };

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
    return <LoadingState label="Loading intelligence data..." />;
  }
  if (isError) {
    return <ErrorState message="Couldn't load intelligence data" onRetry={refetchAll} />;
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
