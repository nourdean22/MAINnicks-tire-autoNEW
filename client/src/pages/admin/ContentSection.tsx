/**
 * ContentSection — extracted from Admin.tsx for maintainability.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Link } from "wouter";
import { BUSINESS } from "@shared/business";
import {
  StatCard, UrgencyBadge, ActivityIcon, StatusDot,
  BOOKING_STATUS_CONFIG, LEAD_STATUS_CONFIG, TIME_LABELS, CHART_COLORS,
  type BookingStatus, type LeadStatus,
} from "./shared";
import {
  AlertTriangle, Bell, CheckCircle2, ChevronRight, Eye, FileText, Loader2, Newspaper, RefreshCw, Sparkles, XCircle
} from "lucide-react";

export default function ContentSection() {
  const { data: articles, isLoading: articlesLoading } = trpc.contentAdmin.allArticles.useQuery();
  const { data: notifications, isLoading: notifsLoading } = trpc.contentAdmin.allNotifications.useQuery();
  const { data: genLog } = trpc.contentAdmin.generationLog.useQuery();

  const updateArticle = trpc.contentAdmin.updateArticleStatus.useMutation({
    onSuccess: () => toast.success("Article updated"),
    onError: (err) => toast.error("Failed: " + err.message),
  });

  const toggleNotif = trpc.contentAdmin.toggleNotification.useMutation({
    onSuccess: () => toast.success("Notification updated"),
    onError: (err) => toast.error("Failed: " + err.message),
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

// ─── CHAT SESSIONS SECTION ──────────────────────────────

