/**
 * ChatSessionsSection — extracted from Admin.tsx for maintainability.
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
  Activity, Clock, Loader2, MessageSquare, TrendingUp, UserCheck
} from "lucide-react";

export default function ChatSessionsSection() {
  const { data: stats, isLoading } = trpc.adminDashboard.stats.useQuery();

  if (isLoading || !stats) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const chatActivity = stats.recentActivity.filter(a => a.type === "chat");

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Total Sessions" value={stats.chat.totalSessions} icon={<MessageSquare className="w-4 h-4" />} color="text-purple-400" />
        <StatCard label="Converted to Lead" value={stats.chat.converted} icon={<UserCheck className="w-4 h-4" />} color="text-emerald-400" />
        <StatCard label="This Week" value={stats.chat.thisWeek} icon={<TrendingUp className="w-4 h-4" />} color="text-blue-400" />
      </div>

      {/* Conversion Rate */}
      <div className="bg-card border border-border/30 p-6">
        <h3 className="font-bold text-sm tracking-wide text-foreground mb-4">CHAT CONVERSION RATE</h3>
        <div className="flex items-end gap-4">
          <span className="font-bold text-5xl text-primary">
            {stats.chat.totalSessions > 0 ? Math.round((stats.chat.converted / stats.chat.totalSessions) * 100) : 0}%
          </span>
          <span className="text-[13px] text-foreground/40 pb-2">
            {stats.chat.converted} of {stats.chat.totalSessions} sessions converted to leads
          </span>
        </div>
        <div className="mt-4 h-3 bg-background/50 overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-700"
            style={{ width: `${stats.chat.totalSessions > 0 ? (stats.chat.converted / stats.chat.totalSessions) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Recent Chat Sessions */}
      <div>
        <h3 className="font-bold text-sm tracking-wide text-foreground mb-4 flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary" />
          RECENT CHAT SESSIONS
        </h3>
        {chatActivity.length > 0 ? (
          <div className="space-y-3">
            {chatActivity.map((chat, i) => (
              <div key={i} className="bg-card border border-border/30 p-4 flex items-start gap-4">
                <div className="w-10 h-10 bg-purple-500/10 border border-purple-500/30 flex items-center justify-center shrink-0">
                  <MessageSquare className="w-5 h-5 text-purple-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-foreground tracking-wider">{chat.title}</p>
                  <p className="text-[12px] text-foreground/50 mt-1">{chat.subtitle}</p>
                  <p className="font-mono text-[10px] text-foreground/25 mt-2">
                    {new Date(chat.timestamp).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-16 border border-border/30 bg-card">
            <MessageSquare className="w-12 h-12 text-foreground/20 mx-auto mb-4" />
            <p className="font-bold text-xl text-foreground/40 tracking-wider">NO CHAT SESSIONS</p>
            <p className="text-foreground/30 text-[13px] mt-2">Customer chat sessions will appear here.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SITE HEALTH SECTION ────────────────────────────────

