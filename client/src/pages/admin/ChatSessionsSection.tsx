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
  Activity, CheckCircle2, ChevronDown, ChevronRight, Clock, Loader2, MessageSquare, TrendingUp, UserCheck, XCircle
} from "lucide-react";

/** Parse messagesJson and extract a customer name if present */
function extractName(messagesJson: string): string {
  try {
    const msgs: Array<{ role: string; content: string }> = JSON.parse(messagesJson);
    const userMsgs = msgs.filter(m => m.role === "user").map(m => m.content).join("\n");
    const patterns = [
      /(?:my name is|i'm|i am|this is|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
      /^([A-Z][a-z]+)\s+here/im,
    ];
    for (const p of patterns) {
      const match = userMsgs.match(p);
      if (match?.[1]) return match[1].trim();
    }
  } catch {}
  return "Anonymous Visitor";
}

/** Parse messagesJson into message array */
function parseMessages(messagesJson: string): Array<{ role: string; content: string }> {
  try {
    return JSON.parse(messagesJson);
  } catch {
    return [];
  }
}

export default function ChatSessionsSection() {
  const { data: stats, isLoading: statsLoading } = trpc.adminDashboard.stats.useQuery();
  const { data: sessions, isLoading: sessionsLoading } = trpc.chat.sessions.useQuery();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const isLoading = statsLoading || sessionsLoading;

  if (isLoading || !stats) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

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

      {/* Chat Sessions List */}
      <div>
        <h3 className="font-bold text-sm tracking-wide text-foreground mb-4 flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary" />
          RECENT CHAT SESSIONS
        </h3>
        {(sessions ?? []).length > 0 ? (
          <div className="space-y-3">
            {(sessions ?? []).map((session: any) => {
              const isExpanded = expandedId === session.id;
              const name = extractName(session.messagesJson);
              const messages = isExpanded ? parseMessages(session.messagesJson) : [];

              return (
                <div key={session.id} className="bg-card border border-border/30">
                  {/* Session header — clickable */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : session.id)}
                    className="w-full p-4 flex items-center gap-4 text-left hover:bg-foreground/[0.02] transition-colors"
                  >
                    <div className="w-10 h-10 bg-purple-500/10 border border-purple-500/30 flex items-center justify-center shrink-0">
                      <MessageSquare className="w-5 h-5 text-purple-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-sm text-foreground tracking-wider">{name}</p>
                        {session.converted === 1 && (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5">
                            <CheckCircle2 className="w-3 h-3" /> CONVERTED
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        {session.vehicleInfo && (
                          <span className="text-[11px] text-foreground/50">{session.vehicleInfo}</span>
                        )}
                        {session.problemSummary && (
                          <span className="text-[11px] text-foreground/40 truncate max-w-[200px]">{session.problemSummary}</span>
                        )}
                      </div>
                      <p className="font-mono text-[10px] text-foreground/25 mt-1">
                        {new Date(session.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="shrink-0 text-foreground/30">
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </div>
                  </button>

                  {/* Expanded transcript */}
                  {isExpanded && messages.length > 0 && (
                    <div className="border-t border-border/20 p-4 space-y-3 max-h-[400px] overflow-y-auto">
                      {messages.filter(m => m.role === "user" || m.role === "assistant").map((msg, i) => (
                        <div
                          key={i}
                          className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[80%] px-3 py-2 text-[13px] leading-relaxed ${
                              msg.role === "user"
                                ? "bg-primary/10 border border-primary/20 text-foreground"
                                : "bg-foreground/5 border border-border/20 text-foreground/80"
                            }`}
                          >
                            <p className="font-bold text-[10px] text-foreground/40 mb-1 tracking-wider">
                              {msg.role === "user" ? "CUSTOMER" : "NICK AI"}
                            </p>
                            <p className="whitespace-pre-wrap">{msg.content}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
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
