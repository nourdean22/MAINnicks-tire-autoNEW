/**
 * ActivityPulse — live "what just happened" toast stream for admin.
 *
 * Listens to the existing /api/admin/events SSE stream (already wired
 * in Admin.tsx for query invalidation) and surfaces the latest N events
 * as animated toasts that fade in, pulse, and fade out. 6-second dwell,
 * max 3 visible at a time.
 *
 * Serves Pillar 1 (LINE OF CARS): "a live sense that the shop is
 * moving." Nour glances at admin and feels the momentum.
 */

import { useEffect, useRef, useState } from "react";
import { useAdminSSE } from "./AdminSSEContext";
import { motion, AnimatePresence } from "framer-motion";
import {
  CarFront, MessageSquare, DollarSign, Star, Phone, Users,
  CheckCircle2, Wrench,
} from "lucide-react";

type EventKind =
  | "booking.created"
  | "booking.stage_changed"
  | "invoice.created"
  | "lead.captured"
  | "review.new"
  | "callback.created"
  | "customer.synced"
  | "generic";

interface Pulse {
  id: string;
  kind: EventKind;
  title: string;
  detail?: string;
  timestamp: number;
}

const KIND_CONFIG: Record<EventKind, { icon: React.ReactNode; color: string }> = {
  "booking.created":       { icon: <CarFront className="w-3.5 h-3.5" />, color: "border-blue-400/40 bg-blue-500/10 text-blue-300" },
  "booking.stage_changed": { icon: <Wrench className="w-3.5 h-3.5" />, color: "border-purple-400/40 bg-purple-500/10 text-purple-300" },
  "invoice.created":       { icon: <DollarSign className="w-3.5 h-3.5" />, color: "border-emerald-400/40 bg-emerald-500/10 text-emerald-300" },
  "lead.captured":         { icon: <Users className="w-3.5 h-3.5" />, color: "border-amber-400/40 bg-amber-500/10 text-amber-300" },
  "review.new":            { icon: <Star className="w-3.5 h-3.5" />, color: "border-yellow-400/40 bg-yellow-500/10 text-yellow-300" },
  "callback.created":      { icon: <Phone className="w-3.5 h-3.5" />, color: "border-pink-400/40 bg-pink-500/10 text-pink-300" },
  "customer.synced":       { icon: <CheckCircle2 className="w-3.5 h-3.5" />, color: "border-slate-400/40 bg-slate-500/10 text-slate-300" },
  generic:                 { icon: <MessageSquare className="w-3.5 h-3.5" />, color: "border-white/30 bg-white/5 text-white/70" },
};

const MAX_VISIBLE = 3;
const DWELL_MS = 6000;

function mapEventType(evType: string): EventKind {
  if (evType.startsWith("booking.")) {
    if (evType.includes("stage")) return "booking.stage_changed";
    return "booking.created";
  }
  if (evType.startsWith("invoice.")) return "invoice.created";
  if (evType.startsWith("lead.")) return "lead.captured";
  if (evType.startsWith("review.")) return "review.new";
  if (evType.startsWith("callback.")) return "callback.created";
  if (evType.startsWith("customer.")) return "customer.synced";
  if (evType !== "generic") {
    console.warn("[ActivityPulse] unmapped event type:", evType);
  }
  return "generic";
}

function buildTitle(evType: string, payload?: Record<string, unknown>): {
  title: string;
  detail?: string;
} {
  const p = payload ?? {};
  switch (evType) {
    case "booking.created":
      return { title: "New booking", detail: `${p.name ?? "Customer"} · ${p.service ?? "service"}` };
    case "booking.stage_changed":
      return { title: "Stage changed", detail: `Booking #${p.id ?? "?"} → ${p.stage ?? ""}` };
    case "invoice.created":
      return {
        title: "Invoice created",
        detail: `${p.customerName ?? "?"} · $${typeof p.totalAmount === "number" ? (p.totalAmount as number).toFixed(0) : "?"}`,
      };
    case "lead.captured":
      return { title: "New lead", detail: `${p.name ?? "?"} · ${p.source ?? "form"}` };
    case "review.new":
      return { title: "New review", detail: `${p.stars ?? "?"}★ · ${p.author ?? "anon"}` };
    case "callback.created":
      return { title: "Callback requested", detail: `${p.name ?? "?"} · ${p.phone ?? ""}` };
    case "customer.synced":
      return { title: "Customer synced", detail: `${p.name ?? "?"} from ${p.source ?? "source"}` };
    default:
      return { title: evType };
  }
}

interface Props {
  /** Hide the stream (e.g. on sections that already show a live feed) */
  disabled?: boolean;
  className?: string;
}

export default function ActivityPulse({ disabled = false, className = "" }: Props) {
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const idCounter = useRef(0);

  // v1.7 audit follow-up · consumes the SHARED EventSource owned by
  // AdminSSEProvider. Pre-fix this component opened its own
  // EventSource("/api/admin/events"), giving every admin page TWO
  // SSE connections to the same endpoint. Now both Admin's listeners
  // and these pulse listeners ride a single connection.
  const es = useAdminSSE();

  useEffect(() => {
    if (disabled || !es) return;

    function pushPulse(p: Omit<Pulse, "id" | "timestamp">) {
      const pulse: Pulse = {
        ...p,
        id: `${Date.now()}-${idCounter.current++}`,
        timestamp: Date.now(),
      };
      setPulses((prev) => [pulse, ...prev].slice(0, MAX_VISIBLE));
      // Auto-dismiss
      setTimeout(() => {
        setPulses((prev) => prev.filter((x) => x.id !== pulse.id));
      }, DWELL_MS);
    }

    const messageHandler = (ev: MessageEvent) => {
      try {
        const parsed = JSON.parse(ev.data);
        const evType = typeof parsed.type === "string" ? parsed.type : "generic";
        const kind = mapEventType(evType);
        const { title, detail } = buildTitle(evType, parsed.payload ?? parsed);
        pushPulse({ kind, title, detail });
      } catch {
        // Malformed event; skip silently
      }
    };

    es.addEventListener("message", messageHandler);

    return () => {
      es.removeEventListener("message", messageHandler);
    };
  }, [disabled, es]);

  if (disabled || pulses.length === 0) return null;

  return (
    <div
      className={`fixed bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] right-4 z-40 flex flex-col-reverse gap-2 pointer-events-none ${className}`}
      aria-live="polite"
    >
      <AnimatePresence mode="sync">
        {pulses.map((p) => {
          const cfg = KIND_CONFIG[p.kind];
          return (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 16, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16, scale: 0.95 }}
              transition={{ duration: 0.3 }}
              className={`inline-flex items-start gap-2 px-3 py-2 rounded-lg border backdrop-blur-md text-xs pointer-events-auto shadow-xl ${cfg.color}`}
            >
              <span className="shrink-0 mt-0.5">{cfg.icon}</span>
              <div className="min-w-0">
                <div className="font-bold text-[11px] uppercase tracking-wider">{p.title}</div>
                {p.detail && <div className="opacity-80 text-[11px] mt-0.5 truncate">{p.detail}</div>}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
