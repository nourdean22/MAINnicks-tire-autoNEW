/*
 * ADMIN CONTENT MANAGEMENT — AI Content Generation & Management
 * Protected page for managing AI-generated blog articles and notification messages.
 * Allows generating, reviewing, publishing, and rejecting content.
 */

import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { useState, useMemo } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import {
  Loader2, ArrowLeft, Shield, XCircle, RefreshCw,
  FileText, Bell, Sparkles, CheckCircle2, Trash2,
  Eye, EyeOff, AlertTriangle, ChevronDown, ChevronUp,
  Zap, BarChart3
} from "lucide-react";

type ArticleStatus = "draft" | "published" | "rejected";

const ARTICLE_STATUS_CONFIG: Record<ArticleStatus, { label: string; color: string; bgColor: string }> = {
  draft: { label: "DRAFT", color: "text-amber-400", bgColor: "bg-amber-500/10 border-amber-500/30" },
  published: { label: "PUBLISHED", color: "text-emerald-400", bgColor: "bg-emerald-500/10 border-emerald-500/30" },
  rejected: { label: "REJECTED", color: "text-red-400", bgColor: "bg-red-500/10 border-red-500/30" },
};

// ─── TABS ──────────────────────────────────────────────
type Tab = "articles" | "notifications" | "generate" | "log";

export default function AdminContent() {
  const { user, loading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("articles");
  const [expandedArticle, setExpandedArticle] = useState<number | null>(null);

  // ─── AUTH GATE ───────────────────────────────────────
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <Shield className="w-12 h-12 text-primary mx-auto mb-4" />
          <h1 className="font-bold text-3xl text-foreground tracking-[-0.01em] mb-4">ADMIN ACCESS</h1>
          <p className="text-foreground/60 mb-8">Sign in with your admin account to manage content.</p>
          <a
            href={getLoginUrl()}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 font-bold text-sm tracking-wide hover:bg-primary/90 transition-colors"
          >
            SIGN IN
          </a>
        </div>
      </div>
    );
  }

  if (user.role !== "admin") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h1 className="font-bold text-3xl text-foreground tracking-[-0.01em] mb-4">ACCESS DENIED</h1>
          <p className="text-foreground/60 mb-8">Admin privileges required.</p>
          <Link href="/" className="inline-flex items-center gap-2 border-2 border-foreground/30 text-foreground px-8 py-4 font-bold text-sm tracking-wide hover:border-primary hover:text-primary transition-colors">
            <ArrowLeft className="w-4 h-4" />
            BACK TO SITE
          </Link>
        </div>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "articles", label: "ARTICLES", icon: <FileText className="w-4 h-4" /> },
    { id: "notifications", label: "NOTIFICATIONS", icon: <Bell className="w-4 h-4" /> },
    { id: "generate", label: "GENERATE", icon: <Sparkles className="w-4 h-4" /> },
    { id: "log", label: "LOG", icon: <BarChart3 className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-background/95 border-b border-border/30 sticky top-0 z-50 backdrop-blur-md">
        <div className="container flex items-center justify-between h-16">
          <div className="flex items-center gap-4">
            <Link href="/admin" className="flex items-center gap-2 text-foreground/60 hover:text-primary transition-colors">
              <ArrowLeft className="w-4 h-4" />
              <span className="text-[12px] tracking-wide hidden sm:inline">Bookings</span>
            </Link>
            <div className="h-6 w-px bg-border/30" />
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-primary flex items-center justify-center rounded-sm">
                <Sparkles className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="font-bold text-primary text-sm tracking-wider">CONTENT MANAGER</span>
            </div>
          </div>
          <span className="text-[12px] text-foreground/40">{user.name || user.email}</span>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="border-b border-border/30">
        <div className="container flex gap-0">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-6 py-4 font-bold text-xs tracking-wide transition-colors border-b-2 ${
                activeTab === tab.id
                  ? "text-primary border-primary"
                  : "text-foreground/40 border-transparent hover:text-foreground/70"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="container py-8">
        {activeTab === "articles" && <ArticlesPanel expandedArticle={expandedArticle} setExpandedArticle={setExpandedArticle} />}
        {activeTab === "notifications" && <NotificationsPanel />}
        {activeTab === "generate" && <GeneratePanel />}
        {activeTab === "log" && <LogPanel />}
      </div>
    </div>
  );
}

// ─── ARTICLES PANEL ────────────────────────────────────

function ArticlesPanel({ expandedArticle, setExpandedArticle }: { expandedArticle: number | null; setExpandedArticle: (id: number | null) => void }) {
  const { data: articles, isLoading, refetch } = trpc.contentAdmin.allArticles.useQuery();
  const [filter, setFilter] = useState<ArticleStatus | "all">("all");

  const updateStatus = trpc.contentAdmin.updateArticleStatus.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("Article status updated");
    },
    onError: (err) => toast.error(err.message),
  });

  const filtered = useMemo(() => {
    if (!articles) return [];
    if (filter === "all") return articles;
    return articles.filter((a) => a.status === filter);
  }, [articles, filter]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-bold text-2xl text-foreground tracking-wider">AI-GENERATED ARTICLES</h2>
        <button onClick={() => refetch()} className="p-2 text-foreground/50 hover:text-primary transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Filter */}
      <div className="flex gap-2 mb-6">
        {(["all", "draft", "published", "rejected"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-2 text-[12px] tracking-wide transition-colors ${
              filter === f
                ? "bg-primary text-primary-foreground"
                : "bg-card border border-border/30 text-foreground/60 hover:text-foreground"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-20 border border-border/30 bg-card">
          <FileText className="w-12 h-12 text-foreground/20 mx-auto mb-4" />
          <p className="font-bold text-xl text-foreground/40 tracking-wider">NO ARTICLES</p>
          <p className="text-foreground/30 text-[13px] mt-2">
            Use the Generate tab to create AI-powered articles.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((article) => {
            const isExpanded = expandedArticle === article.id;
            const statusConfig = ARTICLE_STATUS_CONFIG[article.status as ArticleStatus];
            let sections: { heading: string; content: string }[] = [];
            try {
              sections = JSON.parse(article.sectionsJson);
            } catch {}

            return (
              <div key={article.id} className="bg-card border border-border/30 overflow-hidden">
                {/* Article Header */}
                <div className="p-6">
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-3 mb-2">
                        <h3 className="font-bold text-lg text-foreground tracking-wider">{article.title}</h3>
                        <span className={`inline-flex items-center px-3 py-1 border text-[12px] tracking-wider ${statusConfig.color} ${statusConfig.bgColor}`}>
                          {statusConfig.label}
                        </span>
                        <span className="text-[12px] text-foreground/30 bg-background/50 px-2 py-1 border border-border/20">
                          {article.generatedBy === "ai" ? "AI GENERATED" : "MANUAL"}
                        </span>
                      </div>
                      <p className="text-foreground/60 text-sm leading-relaxed">{article.excerpt}</p>
                      <div className="flex flex-wrap gap-4 mt-3 text-xs text-foreground/40">
                        <span>{article.category}</span>
                        <span>{article.readTime}</span>
                        <span>{article.publishDate}</span>
                        <span>/{article.slug}</span>
                      </div>
                    </div>

                    <div className="flex flex-row lg:flex-col gap-2 shrink-0">
                      {article.status === "draft" && (
                        <>
                          <button
                            onClick={() => updateStatus.mutate({ id: article.id, status: "published" })}
                            disabled={updateStatus.isPending}
                            className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2.5 font-bold text-xs tracking-wide hover:bg-emerald-700 transition-colors disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            PUBLISH
                          </button>
                          <button
                            onClick={() => updateStatus.mutate({ id: article.id, status: "rejected" })}
                            disabled={updateStatus.isPending}
                            className="flex items-center gap-2 border border-red-500/30 text-red-400 px-4 py-2.5 font-bold text-xs tracking-wide hover:bg-red-500/10 transition-colors disabled:opacity-50"
                          >
                            <XCircle className="w-4 h-4" />
                            REJECT
                          </button>
                        </>
                      )}
                      {article.status === "published" && (
                        <button
                          onClick={() => updateStatus.mutate({ id: article.id, status: "draft" })}
                          disabled={updateStatus.isPending}
                          className="flex items-center gap-2 border border-amber-500/30 text-amber-400 px-4 py-2.5 font-bold text-xs tracking-wide hover:bg-amber-500/10 transition-colors disabled:opacity-50"
                        >
                          <EyeOff className="w-4 h-4" />
                          UNPUBLISH
                        </button>
                      )}
                      {article.status === "rejected" && (
                        <button
                          onClick={() => updateStatus.mutate({ id: article.id, status: "draft" })}
                          disabled={updateStatus.isPending}
                          className="flex items-center gap-2 border border-border/30 text-foreground/50 px-4 py-2.5 font-bold text-xs tracking-wide hover:text-foreground transition-colors disabled:opacity-50"
                        >
                          <RefreshCw className="w-4 h-4" />
                          RESTORE
                        </button>
                      )}
                      <button
                        onClick={() => setExpandedArticle(isExpanded ? null : article.id)}
                        className="flex items-center gap-2 border border-border/30 text-foreground/50 px-4 py-2.5 font-bold text-xs tracking-wide hover:text-foreground transition-colors"
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        {isExpanded ? "COLLAPSE" : "PREVIEW"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Expanded Preview */}
                {isExpanded && sections.length > 0 && (
                  <div className="border-t border-border/30 p-6 bg-background/30">
                    <div className="max-w-3xl space-y-6">
                      {sections.map((section, i) => (
                        <div key={i}>
                          <h4 className="font-bold text-foreground tracking-wider text-sm uppercase mb-2">{section.heading}</h4>
                          <p className="text-foreground/70 text-sm leading-relaxed">{section.content}</p>
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
  );
}

// ─── NOTIFICATIONS PANEL ───────────────────────────────

function NotificationsPanel() {
  const { data: notifications, isLoading, refetch } = trpc.contentAdmin.allNotifications.useQuery();

  const toggleActive = trpc.contentAdmin.toggleNotification.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("Notification updated");
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteNotif = trpc.contentAdmin.deleteNotification.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("Notification deleted");
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-bold text-2xl text-foreground tracking-wider">NOTIFICATION MESSAGES</h2>
        <button onClick={() => refetch()} className="p-2 text-foreground/50 hover:text-primary transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {!notifications || notifications.length === 0 ? (
        <div className="text-center py-20 border border-border/30 bg-card">
          <Bell className="w-12 h-12 text-foreground/20 mx-auto mb-4" />
          <p className="font-bold text-xl text-foreground/40 tracking-wider">NO DYNAMIC NOTIFICATIONS</p>
          <p className="text-foreground/30 text-[13px] mt-2">
            Use the Generate tab to create AI-powered notification messages.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map((notif) => (
            <div key={notif.id} className={`bg-card border p-5 flex items-center justify-between gap-4 ${notif.isActive ? "border-border/30" : "border-border/10 opacity-60"}`}>
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-1">
                  <span className={`inline-flex items-center px-2 py-0.5 text-[12px] tracking-wider ${notif.isActive ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/30" : "text-foreground/40 bg-background/50 border border-border/20"}`}>
                    {notif.isActive ? "ACTIVE" : "INACTIVE"}
                  </span>
                  <span className="text-[12px] text-foreground/30 uppercase">{notif.season}</span>
                  <span className="text-[12px] text-foreground/30">{notif.generatedBy === "ai" ? "AI" : "MANUAL"}</span>
                </div>
                <p className="text-foreground/80 text-sm">{notif.message}</p>
                {notif.ctaText && (
                  <p className="text-[12px] text-primary mt-1">{notif.ctaText} → {notif.ctaHref}</p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => toggleActive.mutate({ id: notif.id, isActive: notif.isActive ? 0 : 1 })}
                  disabled={toggleActive.isPending}
                  className="p-2 border border-border/30 text-foreground/50 hover:text-foreground transition-colors disabled:opacity-50"
                  title={notif.isActive ? "Deactivate" : "Activate"}
                >
                  {notif.isActive ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => {
                    if (confirm("Delete this notification?")) {
                      deleteNotif.mutate({ id: notif.id });
                    }
                  }}
                  disabled={deleteNotif.isPending}
                  className="p-2 border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── GENERATE PANEL ────────────────────────────────────

function GeneratePanel() {
  const [topic, setTopic] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<{ article: any; notifications: any[]; errors: string[] } | null>(null);

  const generateContent = trpc.contentAdmin.generateContent.useMutation({
    onSuccess: (data) => {
      setResult(data);
      setIsGenerating(false);
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

  return (
    <div>
      <h2 className="font-bold text-2xl text-foreground tracking-[-0.01em] mb-6">AI CONTENT GENERATOR</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Generate All */}
        <div className="bg-card border border-border/30 p-6">
          <div className="flex items-center gap-3 mb-4">
            <Sparkles className="w-6 h-6 text-primary" />
            <h3 className="font-bold text-lg text-foreground tracking-wider">GENERATE ALL</h3>
          </div>
          <p className="text-foreground/60 text-sm leading-relaxed mb-6">
            Generates one seasonal blog article and three notification bar messages based on the current season and trending auto repair topics for Cleveland.
          </p>
          <button
            onClick={handleGenerateAll}
            disabled={isGenerating}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 font-bold text-sm tracking-wide hover:bg-primary/90 transition-colors disabled:opacity-50 w-full justify-center"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                GENERATING...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                GENERATE CONTENT
              </>
            )}
          </button>
        </div>

        {/* Generate Specific Article */}
        <div className="bg-card border border-border/30 p-6">
          <div className="flex items-center gap-3 mb-4">
            <FileText className="w-6 h-6 text-primary" />
            <h3 className="font-bold text-lg text-foreground tracking-wider">CUSTOM ARTICLE</h3>
          </div>
          <p className="text-foreground/60 text-sm leading-relaxed mb-4">
            Generate a blog article on a specific topic. The AI will follow the brand voice and content structure.
          </p>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g., How to prepare your car for winter driving"
            className="w-full bg-background border border-border/50 text-foreground px-4 py-3 text-[13px] placeholder:text-foreground/30 focus:outline-none focus:border-primary/50 transition-colors mb-4"
          />
          <button
            onClick={handleGenerateArticle}
            disabled={isGenerating || !topic.trim()}
            className="flex items-center gap-2 border-2 border-primary text-primary px-6 py-3 font-bold text-sm tracking-wide hover:bg-primary/10 transition-colors disabled:opacity-50 w-full justify-center"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                GENERATING...
              </>
            ) : (
              <>
                <FileText className="w-4 h-4" />
                GENERATE ARTICLE
              </>
            )}
          </button>
        </div>
      </div>

      {/* Generation Result */}
      {result && (
        <div className="mt-8 bg-card border border-border/30 p-6">
          <h3 className="font-bold text-lg text-foreground tracking-[-0.01em] mb-4">GENERATION RESULT</h3>

          {result.article && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="font-bold text-sm text-emerald-400 tracking-wider">ARTICLE CREATED</span>
              </div>
              <p className="text-foreground/80 text-sm font-bold">{result.article.title}</p>
              <p className="text-foreground/60 text-sm mt-1">{result.article.excerpt}</p>
              <p className="text-[12px] text-foreground/30 mt-2">Status: Draft — review in the Articles tab to publish</p>
            </div>
          )}

          {result.notifications.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="font-bold text-sm text-emerald-400 tracking-wider">{result.notifications.length} NOTIFICATIONS CREATED</span>
              </div>
              {result.notifications.map((n, i) => (
                <p key={i} className="text-foreground/60 text-sm ml-6">• {n.message}</p>
              ))}
            </div>
          )}

          {result.errors.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <span className="font-bold text-sm text-red-400 tracking-wider">ERRORS</span>
              </div>
              {result.errors.map((e, i) => (
                <p key={i} className="text-red-400/80 text-sm ml-6">• {e}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── LOG PANEL ─────────────────────────────────────────

function LogPanel() {
  const { data: log, isLoading, refetch } = trpc.contentAdmin.generationLog.useQuery();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-bold text-2xl text-foreground tracking-wider">GENERATION LOG</h2>
        <button onClick={() => refetch()} className="p-2 text-foreground/50 hover:text-primary transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {!log || log.length === 0 ? (
        <div className="text-center py-20 border border-border/30 bg-card">
          <BarChart3 className="w-12 h-12 text-foreground/20 mx-auto mb-4" />
          <p className="font-bold text-xl text-foreground/40 tracking-wider">NO GENERATION HISTORY</p>
          <p className="text-foreground/30 text-[13px] mt-2">
            Content generation events will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {log.map((entry) => (
            <div key={entry.id} className="bg-card border border-border/30 p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${entry.status === "success" ? "bg-emerald-400" : "bg-red-400"}`} />
                <span className="text-[12px] text-foreground/60 uppercase tracking-wider">{entry.contentType}</span>
                {entry.prompt && (
                  <span className="text-foreground/50 text-sm truncate max-w-md">{entry.prompt}</span>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={`text-[12px] ${entry.status === "success" ? "text-emerald-400" : "text-red-400"}`}>
                  {entry.status.toUpperCase()}
                </span>
                <span className="text-[12px] text-foreground/30">
                  {new Date(entry.createdAt).toLocaleString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
