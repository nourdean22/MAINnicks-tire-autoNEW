/**
 * ContentSection — Content Manager + AI Ideas Engine + Specials.
 * Tab 1: Content Manager (articles, notifications, gen log)
 * Tab 2: AI Ideas Engine (trending topics, SEO opportunities, seasonal, competitor gaps)
 * Tab 3: Specials (2026-05-19 Elon-cut · moved from RevenueSection · it's
 *        content management, not invoice/revenue data)
 */
import React, { useState, lazy, Suspense, useMemo } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { toast } from "sonner";
import { Link } from "wouter";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import {
  StatCard, StatusDot, PageHeader, TabBar, formatDate, LoadingState, ErrorState,
  useUrlFilter,
} from "./shared";
import {
  Bell, CheckCircle2, ChevronRight, FileText, Loader2, Newspaper,
  Sparkles, XCircle, TrendingUp, Search, Calendar, Target, Zap,
  ArrowUpRight, Lightbulb, Tag, Trash2, Eye, EyeOff, AlertTriangle,
  ChevronDown, ChevronUp, RefreshCw, BarChart3, ShieldCheck
} from "lucide-react";

const SpecialsSection = lazy(() => import("./SpecialsSection"));
const PromptEvalsPanel = lazy(() => import("./PromptEvalsPanel"));

type ContentTab = "manager" | "ideas" | "specials" | "evals";

// Inferred from the tRPC AppRouter — replaces 10 `any` annotations
// (admin audit §3 follow-up; same pattern as DispatchSection cleanup).
// chatFunnel / competitorGap / contentPerformance are intentionally NOT
// aliased — those returns are loose analytics shapes; we narrow at use
// site via pickArray/pickString helpers further down (safer than `any`).
type Article = NonNullable<RouterOutputs["contentAdmin"]["allArticles"]>[number];
type Notification = NonNullable<RouterOutputs["contentAdmin"]["allNotifications"]>[number];

const VALID_CONTENT_TABS: ContentTab[] = ["manager", "ideas", "specials", "evals"];

export default function ContentSection() {
  // 2026-05-23 · URL-persist the inner tab so deep-links + reloads land
  // on the operator's last view. Every other admin section already uses
  // useUrlFilter for inner tabs (Intelligence · Outreach · Money etc.);
  // ContentSection was the lone holdout still using bare useState.
  const [tab, setTab] = useUrlFilter<ContentTab>(
    "contentTab",
    "manager",
    {
      validate: (raw) => (VALID_CONTENT_TABS.includes(raw as ContentTab) ? (raw as ContentTab) : null),
    },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Content & AI"
        subtitle="Articles, notifications, GBP posts, AI ideas engine, specials — everything customer-facing copy + automation"
        icon={<FileText className="w-5 h-5" />}
      />
      <TabBar
        tabs={[
          { id: "manager", label: "Content Manager", icon: <FileText className="w-3.5 h-3.5" /> },
          { id: "ideas", label: "AI Ideas Engine", icon: <Lightbulb className="w-3.5 h-3.5" /> },
          { id: "specials", label: "Specials", icon: <Tag className="w-3.5 h-3.5" /> },
          { id: "evals", label: "Prompt Health", icon: <ShieldCheck className="w-3.5 h-3.5" /> },
        ]}
        activeTab={tab}
        onChange={setTab}
      />

      {tab === "manager" && <ContentManager />}
      {tab === "ideas" && <AIIdeasEngine />}
      {tab === "specials" && (
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}>
          <SpecialsSection />
        </Suspense>
      )}
      {tab === "evals" && (
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}>
          <PromptEvalsPanel />
        </Suspense>
      )}
    </div>
  );
}

// ─── CONTENT MANAGER (original ContentSection content) ──────────────

type ArticleStatus = "draft" | "published" | "rejected";

const ARTICLE_STATUS_CONFIG: Record<ArticleStatus, { label: string; color: string; bgColor: string }> = {
  draft: { label: "DRAFT", color: "text-amber-400", bgColor: "bg-amber-500/10 border-amber-500/30" },
  published: { label: "PUBLISHED", color: "text-emerald-400", bgColor: "bg-emerald-500/10 border-emerald-500/30" },
  rejected: { label: "REJECTED", color: "text-red-400", bgColor: "bg-red-500/10 border-red-500/30" },
};

type SubTab = "articles" | "notifications" | "generate" | "gbp" | "log";

function ContentManager() {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("articles");
  const [expandedArticle, setExpandedArticle] = useState<number | null>(null);
  const [filter, setFilter] = useState<ArticleStatus | "all">("all");

  // Generator states
  const [topic, setTopic] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<{ article: any; notifications: any[]; errors: string[] } | null>(null);

  const utils = trpc.useUtils();
  const { data: articles, isLoading: articlesLoading, isError: articlesError, refetch: refetchArticles } = trpc.contentAdmin.allArticles.useQuery();
  const { data: notifications, isLoading: notifsLoading, isError: notifsError, refetch: refetchNotifs } = trpc.contentAdmin.allNotifications.useQuery();
  const { data: genLog, isLoading: logLoading, refetch: refetchLog } = trpc.contentAdmin.generationLog.useQuery();

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

  const deleteNotif = trpc.contentAdmin.deleteNotification.useMutation({
    onSuccess: () => {
      void utils.contentAdmin.allNotifications.invalidate();
      toast.success("Notification deleted");
    },
    onError: (err: { message: string }) => toast.error("Failed: " + err.message),
  });

  const generateContent = trpc.contentAdmin.generateContent.useMutation({
    onSuccess: (data) => {
      setResult(data);
      setIsGenerating(false);
      void utils.contentAdmin.allArticles.invalidate();
      void utils.contentAdmin.allNotifications.invalidate();
      void utils.contentAdmin.generationLog.invalidate();
      toast.success("Content generated successfully");
    },
    onError: (err) => {
      setIsGenerating(false);
      toast.error("Generation failed: " + err.message);
    },
  });

  const generateArticle = trpc.contentAdmin.generateArticle.useMutation({
    onSuccess: (data) => {
      setResult({ article: data.article, notifications: [], errors: [] });
      setIsGenerating(false);
      void utils.contentAdmin.allArticles.invalidate();
      void utils.contentAdmin.generationLog.invalidate();
      toast.success("Article generated successfully");
    },
    onError: (err) => {
      setIsGenerating(false);
      toast.error("Generation failed: " + err.message);
    },
  });

  const handleGenerateAll = () => {
    setIsGenerating(true);
    setResult(null);
    generateContent.mutate({});
  };

  const handleGenerateArticle = () => {
    if (!topic.trim()) {
      toast.error("Enter a topic for the article");
      return;
    }
    setIsGenerating(true);
    setResult(null);
    generateArticle.mutate({ topic: topic.trim() });
  };

  const filteredArticles = useMemo<Article[]>(() => {
    if (!articles) return [];
    if (filter === "all") return articles;
    return articles.filter((a: Article) => a.status === filter);
  }, [articles, filter]);

  if (articlesLoading || notifsLoading || logLoading) {
    return <LoadingState label="Loading content manager..." />;
  }
  if (articlesError || notifsError) {
    return <ErrorState message="Couldn't load content data" onRetry={() => { refetchArticles(); refetchNotifs(); refetchLog(); }} />;
  }

  return (
    <div className="space-y-8">
      {/* Content Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Articles" value={articles?.length ?? 0} icon={<FileText className="w-4 h-4" />} color="text-foreground" />
        <StatCard label="Published" value={articles?.filter((a: Article) => a.status === "published").length ?? 0} icon={<CheckCircle2 className="w-4 h-4" />} color="text-emerald-400" />
        <StatCard label="Drafts" value={articles?.filter((a: Article) => a.status === "draft").length ?? 0} icon={<Newspaper className="w-4 h-4" />} color="text-amber-400" />
        <StatCard label="AI Generations" value={genLog?.length ?? 0} icon={<Sparkles className="w-4 h-4" />} color="text-primary" />
      </div>

      {/* Sub-tab Navigation */}
      <div className="flex border-b border-border/30 gap-4 mb-6 overflow-x-auto">
        {[
          { id: "articles", label: "Articles", icon: <FileText className="w-3.5 h-3.5" /> },
          { id: "notifications", label: "Notifications", icon: <Bell className="w-3.5 h-3.5" /> },
          { id: "generate", label: "AI Generator", icon: <Sparkles className="w-3.5 h-3.5" /> },
          { id: "gbp", label: "GBP Posts", icon: <Target className="w-3.5 h-3.5" /> },
          { id: "log", label: "Generation Log", icon: <BarChart3 className="w-3.5 h-3.5" /> },
        ].map((sub) => (
          <button
            key={sub.id}
            onClick={() => setActiveSubTab(sub.id as SubTab)}
            className={`flex items-center gap-2 pb-3 pt-1 font-bold text-xs tracking-wider border-b-2 transition-colors whitespace-nowrap ${
              activeSubTab === sub.id
                ? "text-primary border-primary"
                : "text-foreground/40 border-transparent hover:text-foreground/70"
            }`}
          >
            {sub.icon}
            {sub.label}
          </button>
        ))}
      </div>

      {/* Articles List */}
      {activeSubTab === "articles" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              {(["all", "draft", "published", "rejected"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 text-[11px] font-bold tracking-wider transition-colors ${
                    filter === f
                      ? "bg-primary text-primary-foreground"
                      : "bg-card border border-border/30 text-foreground/60 hover:text-foreground"
                  }`}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
            <button onClick={() => refetchArticles()} className="p-2 text-foreground/50 hover:text-primary transition-colors">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {filteredArticles.length === 0 ? (
            <div className="text-center py-20 border border-border/30 bg-card">
              <FileText className="w-12 h-12 text-foreground/20 mx-auto mb-4" />
              <p className="font-bold text-lg text-foreground/40 tracking-wider">NO ARTICLES</p>
              <p className="text-foreground/30 text-[12px] mt-2">
                Use the AI Generator tab to create articles.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredArticles.map((article: Article) => {
                const isExpanded = expandedArticle === article.id;
                const statusConfig = ARTICLE_STATUS_CONFIG[article.status as ArticleStatus];
                let sections: { heading: string; content: string }[] = [];
                try {
                  sections = JSON.parse(article.sectionsJson);
                } catch {}

                return (
                  <div key={article.id} className="bg-card border border-border/30 overflow-hidden">
                    <div className="p-5">
                      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <h4 className="font-bold text-sm text-foreground tracking-wider">{article.title}</h4>
                            <span className={`inline-flex items-center px-2 py-0.5 border text-[10px] tracking-wider ${statusConfig.color} ${statusConfig.bgColor}`}>
                              {statusConfig.label}
                            </span>
                            <span className="text-[10px] text-foreground/30 bg-background/50 px-2 py-0.5 border border-border/20">
                              {article.generatedBy === "ai" ? "AI GENERATED" : "MANUAL"}
                            </span>
                          </div>
                          <p className="text-foreground/60 text-xs leading-relaxed">{article.excerpt}</p>
                          <div className="flex flex-wrap gap-4 mt-3 text-[11px] text-foreground/40">
                            <span>{article.category}</span>
                            <span>{article.readTime}</span>
                            <span>{formatDate(article.createdAt)}</span>
                            <span>/{article.slug}</span>
                          </div>
                        </div>

                        <div className="flex flex-row lg:flex-col gap-2 shrink-0">
                          {article.status === "draft" && (
                            <>
                              <button
                                onClick={() => updateArticle.mutate({ id: article.id, status: "published" })}
                                disabled={updateArticle.isPending}
                                className="flex items-center justify-center gap-1.5 bg-emerald-600 text-white px-3 py-2 font-bold text-[10px] tracking-wide hover:bg-emerald-700 transition-colors disabled:opacity-50"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                PUBLISH
                              </button>
                              <button
                                onClick={() => updateArticle.mutate({ id: article.id, status: "rejected" })}
                                disabled={updateArticle.isPending}
                                className="flex items-center justify-center gap-1.5 border border-red-500/30 text-red-400 px-3 py-2 font-bold text-[10px] tracking-wide hover:bg-red-500/10 transition-colors disabled:opacity-50"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                REJECT
                              </button>
                            </>
                          )}
                          {article.status === "published" && (
                            <button
                              onClick={() => updateArticle.mutate({ id: article.id, status: "draft" })}
                              disabled={updateArticle.isPending}
                              className="flex items-center justify-center gap-1.5 border border-amber-500/30 text-amber-400 px-3 py-2 font-bold text-[10px] tracking-wide hover:bg-amber-500/10 transition-colors disabled:opacity-50"
                            >
                              <EyeOff className="w-3.5 h-3.5" />
                              UNPUBLISH
                            </button>
                          )}
                          {article.status === "rejected" && (
                            <button
                              onClick={() => updateArticle.mutate({ id: article.id, status: "draft" })}
                              disabled={updateArticle.isPending}
                              className="flex items-center justify-center gap-1.5 border border-border/30 text-foreground/50 px-3 py-2 font-bold text-[10px] tracking-wide hover:text-foreground transition-colors disabled:opacity-50"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              RESTORE
                            </button>
                          )}
                          <button
                            onClick={() => setExpandedArticle(isExpanded ? null : article.id)}
                            className="flex items-center justify-center gap-1.5 border border-border/30 text-foreground/50 px-3 py-2 font-bold text-[10px] tracking-wide hover:text-foreground transition-colors"
                          >
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            {isExpanded ? "COLLAPSE" : "PREVIEW"}
                          </button>
                        </div>
                      </div>
                    </div>

                    {isExpanded && sections.length > 0 && (
                      <div className="border-t border-border/30 p-5 bg-background/30">
                        <div className="max-w-3xl space-y-4">
                          {sections.map((section, i) => (
                            <div key={i}>
                              <h5 className="font-bold text-foreground tracking-wider text-xs uppercase mb-1">{section.heading}</h5>
                              <p className="text-foreground/70 text-xs leading-relaxed">{section.content}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Notifications List */}
      {activeSubTab === "notifications" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-sm tracking-wide text-foreground uppercase">Notification List</h4>
            <button onClick={() => refetchNotifs()} className="p-2 text-foreground/50 hover:text-primary transition-colors">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {!notifications || notifications.length === 0 ? (
            <div className="text-center py-20 border border-border/30 bg-card">
              <Bell className="w-12 h-12 text-foreground/20 mx-auto mb-4" />
              <p className="font-bold text-lg text-foreground/40 tracking-wider">NO DYNAMIC NOTIFICATIONS</p>
              <p className="text-foreground/30 text-[12px] mt-2">
                Use the AI Generator tab to create notifications.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {notifications.map((notif: Notification) => (
                <div key={notif.id} className={`bg-card border p-4 flex items-center justify-between gap-4 ${notif.isActive === 1 ? "border-border/30" : "border-border/10 opacity-60"}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`inline-flex items-center px-2 py-0.5 text-[9px] font-bold tracking-wider ${notif.isActive === 1 ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/30" : "text-foreground/40 bg-background/50 border border-border/20"}`}>
                        {notif.isActive === 1 ? "ACTIVE" : "INACTIVE"}
                      </span>
                      <span className="text-[10px] text-foreground/30 uppercase">{notif.season}</span>
                      <span className="text-[10px] text-foreground/30">{notif.generatedBy === "ai" ? "AI" : "MANUAL"}</span>
                    </div>
                    <p className="text-foreground/80 text-xs">{notif.message}</p>
                    {notif.ctaText && (
                      <p className="text-[10px] text-primary mt-1">{notif.ctaText} → {notif.ctaHref}</p>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => toggleNotif.mutate({ id: notif.id, isActive: notif.isActive === 1 ? 0 : 1 })}
                      disabled={toggleNotif.isPending}
                      className="p-1.5 border border-border/30 text-foreground/50 hover:text-foreground transition-colors disabled:opacity-50"
                      title={notif.isActive === 1 ? "Deactivate" : "Activate"}
                    >
                      {notif.isActive === 1 ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={async () => {
                        if (await confirmDialog({
                          title: "Delete notification?",
                          message: "This removes it from the rotation. Cannot be undone.",
                          confirmLabel: "Delete",
                          tone: "danger",
                        })) {
                          deleteNotif.mutate({ id: notif.id });
                        }
                      }}
                      disabled={deleteNotif.isPending}
                      className="p-1.5 border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Generate Panel */}
      {activeSubTab === "generate" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Generate All */}
            <div className="bg-card border border-border/30 p-5">
              <div className="flex items-center gap-3 mb-3">
                <Sparkles className="w-5 h-5 text-primary" />
                <h4 className="font-bold text-sm text-foreground tracking-wider uppercase">GENERATE ALL</h4>
              </div>
              <p className="text-foreground/60 text-xs leading-relaxed mb-6">
                Generates one seasonal blog article and three notification bar messages based on the current season and trending auto repair topics for Cleveland.
              </p>
              <button
                onClick={handleGenerateAll}
                disabled={isGenerating}
                className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 font-bold text-[11px] tracking-wide hover:bg-primary/90 transition-colors disabled:opacity-50 w-full justify-center"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    GENERATING...
                  </>
                ) : (
                  <>
                    <Zap className="w-3.5 h-3.5" />
                    GENERATE CONTENT
                  </>
                )}
              </button>
            </div>

            {/* Generate Specific Article */}
            <div className="bg-card border border-border/30 p-5">
              <div className="flex items-center gap-3 mb-3">
                <FileText className="w-5 h-5 text-primary" />
                <h4 className="font-bold text-sm text-foreground tracking-wider uppercase">CUSTOM ARTICLE</h4>
              </div>
              <p className="text-foreground/60 text-xs leading-relaxed mb-4">
                Generate a blog article on a specific topic. The AI will follow the brand voice and content structure.
              </p>
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g., How to prepare your car for winter driving"
                className="w-full bg-background border border-border/50 text-foreground px-3 py-2 text-[12px] placeholder:text-foreground/30 focus:outline-none focus:border-primary/50 transition-colors mb-4"
              />
              <button
                onClick={handleGenerateArticle}
                disabled={isGenerating || !topic.trim()}
                className="flex items-center gap-2 border-2 border-primary text-primary px-5 py-2.5 font-bold text-[11px] tracking-wide hover:bg-primary/10 transition-colors disabled:opacity-50 w-full justify-center"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    GENERATING...
                  </>
                ) : (
                  <>
                    <FileText className="w-3.5 h-3.5" />
                    GENERATE ARTICLE
                  </>
                )}
              </button>
            </div>
          </div>

          {result && (
            <div className="bg-card border border-border/30 p-5">
              <h4 className="font-bold text-sm text-foreground tracking-wider mb-4 uppercase">GENERATION RESULT</h4>

              {result.article && (
                <div className="mb-4">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span className="font-bold text-xs text-emerald-400 tracking-wider">ARTICLE CREATED</span>
                  </div>
                  <p className="text-foreground/80 text-xs font-bold">{result.article.title}</p>
                  <p className="text-foreground/60 text-xs mt-0.5">{result.article.excerpt}</p>
                  <p className="text-[10px] text-foreground/30 mt-1">Status: Draft — review in the Articles tab to publish</p>
                </div>
              )}

              {result.notifications && result.notifications.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span className="font-bold text-xs text-emerald-400 tracking-wider">{result.notifications.length} NOTIFICATIONS CREATED</span>
                  </div>
                  {result.notifications.map((n: any, i: number) => (
                    <p key={i} className="text-foreground/60 text-xs ml-5">• {n.message}</p>
                  ))}
                </div>
              )}

              {result.errors && result.errors.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <AlertTriangle className="w-4 h-4 text-red-400" />
                    <span className="font-bold text-xs text-red-400 tracking-wider">ERRORS</span>
                  </div>
                  {result.errors.map((e: string, i: number) => (
                    <p key={i} className="text-red-400/80 text-xs ml-5">• {e}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* GBP Post Generator */}
      {activeSubTab === "gbp" && <GBPPostGenerator />}

      {/* Generation Log */}
      {activeSubTab === "log" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-sm tracking-wide text-foreground uppercase">Generation Log</h4>
            <button onClick={() => refetchLog()} className="p-2 text-foreground/50 hover:text-primary transition-colors">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {!genLog || genLog.length === 0 ? (
            <div className="text-center py-20 border border-border/30 bg-card">
              <BarChart3 className="w-12 h-12 text-foreground/20 mx-auto mb-4" />
              <p className="font-bold text-xl text-foreground/40 tracking-wider">NO GENERATION HISTORY</p>
              <p className="text-foreground/30 text-[12px] mt-2">
                Content generation events will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {genLog.map((entry: any) => (
                <div key={entry.id} className="bg-card border border-border/30 p-3.5 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${entry.status === "success" ? "bg-emerald-400" : "bg-red-400"}`} />
                    <span className="text-[11px] font-bold text-foreground/60 uppercase tracking-wider shrink-0">{entry.contentType}</span>
                    {entry.prompt && (
                      <span className="text-foreground/50 text-xs truncate max-w-[200px] md:max-w-md">{entry.prompt}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`text-[11px] font-bold ${entry.status === "success" ? "text-emerald-400" : "text-red-400"}`}>
                      {entry.status.toUpperCase()}
                    </span>
                    <span className="text-[11px] text-foreground/30">
                      {new Date(entry.createdAt).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
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

      {/* Safety warning */}
      <div className="p-3 border border-yellow-500/30 bg-yellow-500/5 text-yellow-600 dark:text-yellow-400 text-xs rounded space-y-1">
        <p className="font-bold flex items-center gap-1">
          <AlertTriangle className="w-3.5 h-3.5" /> Google Business Profile Copy-Paste Safety Gate
        </p>
        <p>
          Generated posts are **copy-paste drafts only**. By default, generation operates in a **dry-run mode** that does not publish live. All generated content **must be manually reviewed and verified** before being pasted on <a href="https://business.google.com" target="_blank" rel="noopener noreferrer" className="underline font-bold text-primary hover:text-primary/80">business.google.com</a>. Do not blindly auto-post fabricated customer reviews or prices.
        </p>
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
              const dayLabel = formatDate(row.postedAt);
              const archetypeColor =
                row.archetype === "proof" ? "text-emerald-400" :
                row.archetype === "anti" ? "text-amber-400" :
                row.archetype === "math" ? "text-blue-400" :
                "text-primary";
              return (
                <div key={row.id} className="flex items-center gap-3 text-[11px] py-1 border-b border-border/10">
                  <span className="text-foreground/40 w-20 shrink-0">{dayLabel}</span>
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
