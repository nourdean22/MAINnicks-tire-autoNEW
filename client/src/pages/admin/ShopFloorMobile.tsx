/**
 * ShopFloorMobile — the "from the shop floor" admin view.
 *
 * Single-screen phone interface for Nour running the shop:
 *   - Today's active queue (dropped-off cars, their stage, how long)
 *   - One-tap stage advance per car
 *   - SMS customer (pre-filled by stage)
 *   - Force-refresh shop status
 *
 * Intentionally minimal. Not a duplicate of OverviewSection — this is the
 * thumb-driven floor view for in-the-bay use. Large tap targets, no tables.
 *
 * Routed via /admin?mode=mobile, or via Admin nav group "COMMAND" →
 * "Shop Floor" when on a small screen.
 */

import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { PageHeader, LoadingState } from "./shared";
import {
  Car, Phone, MessageSquare, ArrowRight, Clock, CheckCircle2,
  AlertTriangle, Wrench, RotateCcw, Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import LineOfCarsCounter from "@/components/LineOfCarsCounter";
import ShopStatusWidget from "@/components/ShopStatusWidget";

const STAGE_CONFIG: Record<string, { label: string; color: string; next: string | null; nextLabel: string }> = {
  received:      { label: "Received",      color: "bg-slate-500",   next: "inspecting",     nextLabel: "Inspect" },
  inspecting:    { label: "Inspecting",    color: "bg-blue-500",    next: "in-progress",    nextLabel: "Start work" },
  "waiting-parts": { label: "Awaiting parts", color: "bg-amber-500", next: "in-progress",   nextLabel: "Parts in" },
  "in-progress": { label: "In progress",   color: "bg-purple-500",  next: "quality-check",  nextLabel: "QC" },
  "quality-check": { label: "QC",          color: "bg-pink-500",    next: "ready",          nextLabel: "Ready" },
  ready:         { label: "Ready for pickup", color: "bg-emerald-500", next: null,          nextLabel: "Pickup" },
};

function timeSince(dateStr: string | Date): { label: string; severity: "low" | "med" | "hi" } {
  const d = new Date(dateStr);
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000);
  const hours = Math.floor(mins / 60);
  let label: string;
  if (mins < 60) label = `${mins}m`;
  else if (hours < 24) label = `${hours}h ${mins % 60}m`;
  else label = `${Math.floor(hours / 24)}d`;
  const severity: "low" | "med" | "hi" = mins < 120 ? "low" : mins < 480 ? "med" : "hi";
  return { label, severity };
}

type BookingRow = {
  id: number;
  name: string;
  phone: string;
  service: string;
  vehicle?: string | null;
  status: string;
  stage?: string | null;
  createdAt: string | Date;
  stageUpdatedAt?: string | Date | null;
};

export default function ShopFloorMobile() {
  const { data, isLoading, refetch } = trpc.booking.list.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const updateStage = trpc.booking.updateStage.useMutation({
    onSuccess: () => {
      refetch();
      toast.success("Stage updated");
    },
    onError: (err: { message: string }) => toast.error(err.message),
  });

  // Filter to active bookings — in bay right now
  const bookings = (data ?? []) as BookingRow[];
  const active = bookings.filter((b) => {
    if (b.status === "cancelled" || b.status === "completed") return false;
    const s = b.stage ?? "received";
    return STAGE_CONFIG[s] !== undefined;
  });

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title="Shop Floor"
        subtitle="Thumb-driven view for running the floor from your phone."
        icon={<Wrench className="w-5 h-5" />}
        actions={
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-secondary hover:bg-secondary/80 active:scale-95 transition-all"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Refresh
          </button>
        }
      />

      {/* ── Live pulse strip ───────────────────────── */}
      <div className="grid grid-cols-1 gap-3">
        <LineOfCarsCounter variant="admin" />
        <ShopStatusWidget />
      </div>

      {/* ── Active queue ──────────────────────────── */}
      {isLoading ? (
        <LoadingState />
      ) : active.length === 0 ? (
        <div className="rounded-xl border border-border/30 bg-card/50 p-10 text-center">
          <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-emerald-400/80" />
          <h3 className="text-sm font-bold">No cars in the bay right now</h3>
          <p className="text-xs text-muted-foreground mt-1">Refresh when the next one rolls in.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold px-1">
            Active · {active.length}
          </div>
          <AnimatePresence mode="popLayout">
            {active.map((b) => {
              const stage = (b.stage ?? "received") as keyof typeof STAGE_CONFIG;
              const cfg = STAGE_CONFIG[stage];
              const ts = timeSince(b.stageUpdatedAt ?? b.createdAt);
              const tsClass =
                ts.severity === "hi" ? "text-red-400" : ts.severity === "med" ? "text-amber-400" : "text-emerald-400";
              return (
                <motion.div
                  key={b.id}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  className="rounded-2xl border border-border/40 bg-card p-4"
                >
                  {/* Header row */}
                  <div className="flex items-start gap-3">
                    <span className={`shrink-0 w-2.5 h-10 rounded-full ${cfg?.color ?? "bg-slate-500"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                          {cfg?.label ?? stage}
                        </span>
                        <span className={`text-[10px] font-mono font-bold ${tsClass}`}>
                          <Clock className="inline w-3 h-3 mr-0.5" />
                          {ts.label}
                        </span>
                        {ts.severity === "hi" && (
                          <span className="text-[10px] font-bold text-red-400 inline-flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> OVERDUE
                          </span>
                        )}
                      </div>
                      <div className="font-bold text-base text-foreground truncate">{b.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {b.service}
                        {b.vehicle && <> · {b.vehicle}</>}
                      </div>
                    </div>
                  </div>

                  {/* Primary action — advance stage */}
                  {cfg?.next && (
                    <button
                      onClick={() =>
                        updateStage.mutate({
                          id: b.id,
                          stage: cfg.next as "inspecting" | "waiting-parts" | "in-progress" | "quality-check" | "ready",
                        })
                      }
                      disabled={updateStage.isPending}
                      className="mt-3 w-full bg-[#FDB913] text-black font-bold text-sm py-3 px-4 rounded-xl active:scale-[0.98] transition-transform flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {cfg.nextLabel}
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  )}
                  {!cfg?.next && (
                    <button
                      onClick={() =>
                        updateStage.mutate({
                          id: b.id,
                          stage: "ready",
                        })
                      }
                      className="mt-3 w-full bg-emerald-500 text-white font-bold text-sm py-3 px-4 rounded-xl flex items-center justify-center gap-2"
                      disabled
                    >
                      <CheckCircle2 className="w-4 h-4" /> Ready for pickup
                    </button>
                  )}

                  {/* Secondary actions */}
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <a
                      href={`tel:${b.phone}`}
                      className="flex items-center justify-center gap-1.5 text-xs font-bold py-2.5 px-3 rounded-xl bg-secondary hover:bg-secondary/80 active:scale-95 transition-all"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      Call
                    </a>
                    <a
                      href={`sms:${b.phone}?body=${encodeURIComponent(
                        `Hi ${b.name.split(" ")[0]}, it's Nick's Tire. Quick update on your ${b.service.toLowerCase()} — we're at the ${cfg?.label.toLowerCase() ?? "received"} stage.`,
                      )}`}
                      className="flex items-center justify-center gap-1.5 text-xs font-bold py-2.5 px-3 rounded-xl bg-secondary hover:bg-secondary/80 active:scale-95 transition-all"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      Text update
                    </a>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Footer legend */}
      <div className="mt-4 p-3 rounded-xl border border-border/20 bg-card/30 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1 mb-1 font-bold uppercase tracking-widest">
          <Zap className="w-3 h-3" /> Pro tip
        </div>
        Tap the gold button to advance a car to its next stage — each tap also
        auto-fires the status SMS to the customer. Time chips go red after 8h
        without a stage change — hunt those first.
      </div>
    </div>
  );
}
