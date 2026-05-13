/**
 * ReEngagementSection — dormant-revenue rescue.
 *
 * Surfaces customers whose service is due based on invoice history:
 *   - 3-month oil change coming up
 *   - 18-month brake inspection overdue
 *   - 3-year old tires — tread check
 *   - 1-year alignment recheck
 *   - etc.
 *
 * One click: review → send the suggested SMS. Reviewer-in-the-loop by default
 * (no auto-fire cron until the feature flag flips).
 */

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { PageHeader, LoadingState, SectionInsightStrip } from "./shared";
import {
  RotateCcw, Send, Phone, User, Clock, AlertTriangle,
  CheckCircle2, Calendar, Edit2, X, Sparkles,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const URGENCY_CONFIG = {
  overdue: { label: "OVERDUE", color: "text-red-400", bgColor: "bg-red-500/10 border-red-500/30", icon: AlertTriangle },
  due:     { label: "DUE",     color: "text-amber-400", bgColor: "bg-amber-500/10 border-amber-500/30", icon: Clock },
  soon:    { label: "SOON",    color: "text-blue-400", bgColor: "bg-blue-500/10 border-blue-500/30", icon: Calendar },
  ok:      { label: "OK",      color: "text-emerald-400", bgColor: "bg-emerald-500/10 border-emerald-500/30", icon: CheckCircle2 },
} as const;

function daysAgoLabel(days: number): string {
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round((days / 365) * 10) / 10}y ago`;
}

export default function ReEngagementSection() {
  const [limit, setLimit] = useState(50);
  const { data, isLoading, refetch } = trpc.reEngagement.listDue.useQuery({ limit });
  const sendMutation = trpc.reEngagement.sendSuggestion.useMutation();

  const [editingPhone, setEditingPhone] = useState<string | null>(null);
  const [editedCopy, setEditedCopy] = useState("");
  const [sentMap, setSentMap] = useState<Record<string, boolean>>({});

  async function handleSend(phone: string, body: string, reason: string) {
    try {
      const result = await sendMutation.mutateAsync({ phone, body, reason });
      if (result.success) {
        toast.success("SMS sent");
        setSentMap((m) => ({ ...m, [phone]: true }));
      } else {
        toast.error(`Send failed: ${result.error ?? "unknown"}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send failed");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Re-engagement"
        subtitle="Customers whose next service is due, derived from invoice history. Review, then send."
        icon={<RotateCcw className="w-5 h-5" />}
        badge={
          data
            ? {
                label: `${data.summary.overdue} overdue · ${data.summary.due} due · ${data.summary.soon} soon`,
                variant: data.summary.overdue > 0 ? "danger" : data.summary.due > 0 ? "warning" : "neutral",
              }
            : undefined
        }
        actions={
          <>
            <button
              onClick={() => refetch()}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-secondary hover:bg-secondary/80 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Re-scan
            </button>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="text-xs px-3 py-1.5 rounded-lg bg-secondary border border-border/30"
            >
              <option value={25}>Top 25</option>
              <option value={50}>Top 50</option>
              <option value={100}>Top 100</option>
              <option value={250}>Top 250</option>
            </select>
          </>
        }
      />
      {/* wave-110 — reEngagement absorbed into campaigns; insight strip uses campaigns key */}
      <SectionInsightStrip section="campaigns" />

      {isLoading ? (
        <LoadingState />
      ) : !data || data.suggestions.length === 0 ? (
        <div className="rounded-xl border border-border/30 bg-card/50 p-10 text-center">
          <CheckCircle2 className="w-8 h-8 mx-auto mb-3 text-emerald-400/80" />
          <h3 className="text-sm font-bold text-foreground">No service-due customers right now</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
            Either we've re-engaged everyone recently or no invoices have aged enough.
            Check back in a few days, or raise the limit.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <AnimatePresence mode="popLayout">
            {data.suggestions.map((s, idx) => {
              const cfg = URGENCY_CONFIG[s.urgency];
              const Icon = cfg.icon;
              const isEditing = editingPhone === s.customerPhone;
              const isSent = sentMap[s.customerPhone];
              return (
                <motion.div
                  key={`${s.customerPhone}-${s.category}-${idx}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.25 }}
                  className={`rounded-xl border bg-card/50 p-4 ${isSent ? "opacity-50" : ""} ${cfg.bgColor}`}
                >
                  {/* Header */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium tracking-[0.12em] ${cfg.color}`}
                        >
                          <Icon className="w-3 h-3" />
                          {cfg.label}
                        </span>
                        <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                          {s.category}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <User className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-sm font-bold text-foreground truncate">
                          {s.customerName || "Unknown"}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                        <a
                          href={`tel:${s.customerPhone}`}
                          className="flex items-center gap-1 hover:text-foreground transition-colors"
                        >
                          <Phone className="w-3 h-3" />
                          {s.customerPhone}
                        </a>
                        <span>· last service {daysAgoLabel(s.daysSinceLast)}</span>
                      </div>
                    </div>
                    {isSent && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
                        <CheckCircle2 className="w-3 h-3" /> SENT
                      </span>
                    )}
                  </div>

                  {/* SMS copy (editable) */}
                  {isEditing ? (
                    <textarea
                      value={editedCopy}
                      onChange={(e) => setEditedCopy(e.target.value)}
                      className="w-full bg-secondary/50 border border-border/30 rounded-lg p-2 text-xs text-foreground resize-none"
                      rows={4}
                      maxLength={1600}
                    />
                  ) : (
                    <p className="text-xs text-foreground/80 leading-relaxed px-3 py-2 rounded-lg bg-black/20 border border-white/5">
                      {s.suggestedSmsCopy}
                    </p>
                  )}

                  {/* Actions */}
                  <div className="mt-3 flex items-center gap-2">
                    {isEditing ? (
                      <>
                        <button
                          onClick={() => {
                            handleSend(s.customerPhone, editedCopy, `${s.category}-custom`);
                            setEditingPhone(null);
                          }}
                          disabled={sendMutation.isPending}
                          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold py-2 px-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                        >
                          <Send className="w-3.5 h-3.5" />
                          Send edited
                        </button>
                        <button
                          onClick={() => setEditingPhone(null)}
                          className="p-2 rounded-lg bg-secondary hover:bg-secondary/80 transition-colors"
                          aria-label="Cancel edit"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => handleSend(s.customerPhone, s.suggestedSmsCopy, s.category)}
                          disabled={sendMutation.isPending || isSent}
                          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold py-2 px-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                        >
                          <Send className="w-3.5 h-3.5" />
                          Send as-is
                        </button>
                        <button
                          onClick={() => {
                            setEditingPhone(s.customerPhone);
                            setEditedCopy(s.suggestedSmsCopy);
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
