/**
 * NoShowRiskSection — upcoming bookings ranked by skip-risk with one-click
 * confirmation SMS. Serves Pillar 3 (HAPPY WAIT): fewer no-shows = fewer
 * empty bays = cars get in and out, which feeds Pillar 1 (LINE OF CARS).
 */

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { PageHeader, LoadingState } from "./shared";
import {
  AlertTriangle, Phone, Send, Clock, User, Car, Check, Edit2, X,
  Sparkles, TrendingUp, TrendingDown,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const BAND_CONFIG = {
  critical: { label: "CRITICAL", color: "text-red-400", bgColor: "bg-red-500/10 border-red-500/40", ring: "ring-red-500/30" },
  high:     { label: "HIGH",     color: "text-orange-400", bgColor: "bg-orange-500/10 border-orange-500/40", ring: "ring-orange-500/30" },
  medium:   { label: "MEDIUM",   color: "text-amber-400", bgColor: "bg-amber-500/10 border-amber-500/30", ring: "ring-amber-500/20" },
  low:      { label: "LOW",      color: "text-emerald-400", bgColor: "bg-emerald-500/10 border-emerald-500/30", ring: "ring-emerald-500/20" },
} as const;

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "No date set";
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dateStr;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function daysUntil(dateStr: string | null): string {
  if (!dateStr) return "";
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const target = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const days = Math.floor((target.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return "TODAY";
  if (days === 1) return "Tomorrow";
  if (days < 0) return `${Math.abs(days)}d ago`;
  return `${days}d out`;
}

export default function NoShowRiskSection() {
  const [limit, setLimit] = useState(50);
  const { data, isLoading, refetch } = trpc.noShow.listAtRisk.useQuery({ limit });
  const { data: stats } = trpc.noShow.stats.useQuery({ days: 30 });
  const sendMutation = trpc.noShow.sendConfirmation.useMutation();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editedBody, setEditedBody] = useState("");
  const [sentMap, setSentMap] = useState<Record<number, boolean>>({});
  // wave-143 — per-row pending state. Was using sendMutation.isPending
  // which disabled EVERY row's Send button while any one SMS was in
  // flight. On a phone with latency, tapping Send on row 1 froze the
  // whole list. Now: only the row being sent is disabled.
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());

  async function handleSend(bookingId: number, phone: string, body: string) {
    setPendingIds((s) => new Set(s).add(bookingId));
    try {
      const result = await sendMutation.mutateAsync({ bookingId, phone, body });
      if (result.success) {
        toast.success("Confirmation SMS sent");
        setSentMap((m) => ({ ...m, [bookingId]: true }));
      } else {
        toast.error(`Send failed: ${result.error ?? "unknown"}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send failed");
    } finally {
      setPendingIds((s) => {
        const next = new Set(s);
        next.delete(bookingId);
        return next;
      });
    }
  }

  const statsBadge = stats
    ? {
        label: `${Math.round((stats.cancelRate || 0) * 100)}% cancel rate · ${stats.totalBookings} total · ${stats.trend}`,
        variant:
          stats.trend === "improving"
            ? ("success" as const)
            : stats.trend === "worsening"
            ? ("danger" as const)
            : ("neutral" as const),
      }
    : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="No-Show Risk"
        subtitle="Upcoming bookings ranked by skip risk. Send a confirmation before they ghost."
        icon={<AlertTriangle className="w-5 h-5" />}
        badge={statsBadge}
        actions={
          <>
            <button
              onClick={() => refetch()}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-secondary hover:bg-secondary/80 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Re-score
            </button>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="text-xs px-3 py-1.5 rounded-lg bg-secondary border border-border/30"
            >
              <option value={25}>Top 25</option>
              <option value={50}>Top 50</option>
              <option value={100}>Top 100</option>
            </select>
          </>
        }
      />

      {/* ── Stats strip ───────────────────────────── */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border border-border/30 bg-card/50 p-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">30d cancel rate</div>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="font-mono font-black text-2xl text-foreground">
                {Math.round((stats.cancelRate || 0) * 100)}%
              </span>
              {stats.trend === "improving" && <TrendingDown className="w-4 h-4 text-emerald-400" />}
              {stats.trend === "worsening" && <TrendingUp className="w-4 h-4 text-red-400" />}
            </div>
          </div>
          <div className="rounded-xl border border-border/30 bg-card/50 p-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Completion rate</div>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="font-mono font-black text-2xl text-emerald-400">
                {Math.round((stats.completionRate || 0) * 100)}%
              </span>
            </div>
          </div>
          <div className="rounded-xl border border-border/30 bg-card/50 p-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">At Risk Now</div>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="font-mono font-black text-2xl text-red-400">
                {(data?.summary.critical ?? 0) + (data?.summary.high ?? 0)}
              </span>
              <span className="text-xs text-muted-foreground">critical + high</span>
            </div>
          </div>
          <div className="rounded-xl border border-border/30 bg-card/50 p-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">30d bookings</div>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="font-mono font-black text-2xl text-foreground">{stats.totalBookings}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── List ───────────────────────────────────── */}
      {isLoading ? (
        <LoadingState />
      ) : !data || data.bookings.length === 0 ? (
        <div className="rounded-xl border border-border/30 bg-card/50 p-10 text-center">
          <Check className="w-8 h-8 mx-auto mb-3 text-emerald-400/80" />
          <h3 className="text-sm font-bold">No upcoming bookings</h3>
          <p className="text-xs text-muted-foreground mt-1">
            No scoreable bookings in the window. Come back after new bookings land.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          <AnimatePresence mode="popLayout">
            {data.bookings.map((b) => {
              const cfg = BAND_CONFIG[b.riskBand];
              const isEditing = editingId === b.bookingId;
              const isSent = sentMap[b.bookingId];
              return (
                <motion.div
                  key={b.bookingId}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.25 }}
                  className={`rounded-xl border ${cfg.bgColor} p-4 ${isSent ? "opacity-50" : ""} ${
                    b.riskBand === "critical" ? `ring-2 ${cfg.ring}` : ""
                  }`}
                >
                  {/* Top row — identity + risk */}
                  <div className="flex items-start gap-3 flex-wrap">
                    <div className={`shrink-0 font-mono font-black text-2xl ${cfg.color} w-14 text-center`}>
                      {b.riskScore}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold tracking-wider ${cfg.color}`}>
                          {cfg.label}
                        </span>
                        {b.alreadyConfirmed && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold tracking-wider text-emerald-400 bg-emerald-500/10">
                            <Check className="w-3 h-3" /> CONFIRMED
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground tracking-widest uppercase">
                          {b.preferredTime}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm font-bold text-foreground truncate">{b.customerName}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground flex-wrap">
                        <a href={`tel:${b.customerPhone}`} className="flex items-center gap-1 hover:text-foreground transition-colors">
                          <Phone className="w-3 h-3" />
                          {b.customerPhone}
                        </a>
                        <span className="flex items-center gap-1">
                          <Car className="w-3 h-3" /> {b.service}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {formatDate(b.preferredDate)}{" "}
                          <span className={`ml-1 font-mono font-bold ${b.preferredDate && b.preferredDate.length > 0 ? "" : ""}`}>
                            {daysUntil(b.preferredDate)}
                          </span>
                        </span>
                      </div>
                    </div>
                    {isSent && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
                        <Check className="w-3 h-3" /> SENT
                      </span>
                    )}
                  </div>

                  {/* Recommended action + signals */}
                  <div className="mt-3 rounded-lg bg-black/20 border border-white/5 p-3">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                      Recommended action
                    </div>
                    <div className="text-xs text-foreground/90">{b.recommendedAction}</div>

                    <details className="mt-2">
                      <summary className="text-[10px] uppercase tracking-widest text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none">
                        Signal breakdown ({b.signals.length})
                      </summary>
                      <ul className="mt-2 space-y-1 text-[11px]">
                        {b.signals.map((s, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="font-mono text-muted-foreground/70 shrink-0 w-8 text-right">
                              {s.value}
                            </span>
                            <span className="text-muted-foreground shrink-0 w-24">{s.label}</span>
                            <span className="text-foreground/70 flex-1">{s.reason}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </div>

                  {/* SMS body (editable) */}
                  {isEditing ? (
                    <textarea
                      value={editedBody}
                      onChange={(e) => setEditedBody(e.target.value)}
                      className="w-full mt-3 bg-secondary/50 border border-border/30 rounded-lg p-2 text-xs text-foreground resize-none"
                      rows={4}
                      maxLength={1600}
                    />
                  ) : (
                    <p className="mt-3 text-xs text-foreground/80 leading-relaxed px-3 py-2 rounded-lg bg-black/20 border border-white/5">
                      {b.suggestedSms}
                    </p>
                  )}

                  {/* Actions */}
                  <div className="mt-3 flex items-center gap-2">
                    {isEditing ? (
                      <>
                        <button
                          onClick={() => {
                            handleSend(b.bookingId, b.customerPhone, editedBody);
                            setEditingId(null);
                          }}
                          disabled={sendMutation.isPending}
                          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold py-2 px-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                        >
                          <Send className="w-3.5 h-3.5" /> Send edited
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="p-2 rounded-lg bg-secondary hover:bg-secondary/80 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleSend(b.bookingId, b.customerPhone, b.suggestedSms)}
                          disabled={pendingIds.has(b.bookingId) || isSent || b.alreadyConfirmed}
                          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold py-2 px-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                        >
                          <Send className="w-3.5 h-3.5" /> {pendingIds.has(b.bookingId) ? "Sending…" : "Send confirmation"}
                        </button>
                        <button
                          onClick={() => {
                            setEditingId(b.bookingId);
                            setEditedBody(b.suggestedSms);
                          }}
                          className="p-2 rounded-lg bg-secondary hover:bg-secondary/80 transition-colors"
                          aria-label="Edit SMS"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
