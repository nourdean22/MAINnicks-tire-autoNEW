import { AnimatePresence, motion } from "framer-motion";
import {
  CarFront,
  CheckCircle2,
  DollarSign,
  MessageSquare,
  Phone,
  Star,
  Users,
  Wrench,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import AdminErrorTelemetryBridge from "./AdminErrorTelemetryBridge";
import { useAdminSSE } from "./AdminSSEContext";

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
}

const KIND_CONFIG: Record<EventKind, { icon: React.ReactNode; className: string }> = {
  "booking.created": { icon: <CarFront className="w-3.5 h-3.5" />, className: "border-blue-400/40 bg-blue-500/10 text-blue-300" },
  "booking.stage_changed": { icon: <Wrench className="w-3.5 h-3.5" />, className: "border-purple-400/40 bg-purple-500/10 text-purple-300" },
  "invoice.created": { icon: <DollarSign className="w-3.5 h-3.5" />, className: "border-emerald-400/40 bg-emerald-500/10 text-emerald-300" },
  "lead.captured": { icon: <Users className="w-3.5 h-3.5" />, className: "border-amber-400/40 bg-amber-500/10 text-amber-300" },
  "review.new": { icon: <Star className="w-3.5 h-3.5" />, className: "border-yellow-400/40 bg-yellow-500/10 text-yellow-300" },
  "callback.created": { icon: <Phone className="w-3.5 h-3.5" />, className: "border-pink-400/40 bg-pink-500/10 text-pink-300" },
  "customer.synced": { icon: <CheckCircle2 className="w-3.5 h-3.5" />, className: "border-slate-400/40 bg-slate-500/10 text-slate-300" },
  generic: { icon: <MessageSquare className="w-3.5 h-3.5" />, className: "border-white/30 bg-white/5 text-white/70" },
};

function mapEventType(type: string): EventKind {
  if (type.startsWith("booking.")) return type.includes("stage") ? "booking.stage_changed" : "booking.created";
  if (type.startsWith("invoice.")) return "invoice.created";
  if (type.startsWith("lead.")) return "lead.captured";
  if (type.startsWith("review.")) return "review.new";
  if (type.startsWith("callback.")) return "callback.created";
  if (type.startsWith("customer.")) return "customer.synced";
  return "generic";
}

function describe(type: string, payload: Record<string, unknown>): { title: string; detail?: string } {
  switch (type) {
    case "booking.created": return { title: "New booking", detail: `${payload.name ?? "Customer"} · ${payload.service ?? "service"}` };
    case "booking.stage_changed": return { title: "Stage changed", detail: `Booking #${payload.id ?? "?"} → ${payload.stage ?? ""}` };
    case "invoice.created": return { title: "Invoice created", detail: `${payload.customerName ?? "Customer"}` };
    case "lead.captured": return { title: "New lead", detail: `${payload.name ?? "Customer"} · ${payload.source ?? "form"}` };
    case "review.new": return { title: "New review", detail: `${payload.stars ?? "?"}★ · ${payload.author ?? "anonymous"}` };
    case "callback.created": return { title: "Callback requested", detail: `${payload.name ?? "Customer"}` };
    case "customer.synced": return { title: "Customer synced", detail: `${payload.name ?? "Customer"}` };
    default: return { title: type };
  }
}

export default function ActivityPulse({ disabled = false, className = "" }: { disabled?: boolean; className?: string }) {
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const counter = useRef(0);
  const eventSource = useAdminSSE();

  useEffect(() => {
    if (disabled || !eventSource) return;
    const handler = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data) as { type?: unknown; payload?: Record<string, unknown> };
        const type = typeof parsed.type === "string" ? parsed.type : "generic";
        const text = describe(type, parsed.payload ?? {});
        const pulse = { id: `${Date.now()}-${counter.current++}`, kind: mapEventType(type), ...text };
        setPulses((current) => [pulse, ...current].slice(0, 3));
        window.setTimeout(() => setPulses((current) => current.filter((item) => item.id !== pulse.id)), 6000);
      } catch {
        // Ignore malformed SSE payloads; the stream stays alive.
      }
    };
    eventSource.addEventListener("message", handler);
    return () => eventSource.removeEventListener("message", handler);
  }, [disabled, eventSource]);

  return (
    <>
      <AdminErrorTelemetryBridge />
      {!disabled && pulses.length > 0 && (
        <div className={`fixed bottom-[calc(1rem+env(safe-area-inset-bottom,0))] right-4 z-40 flex flex-col-reverse gap-2 pointer-events-none ${className}`} aria-live="polite">
          <AnimatePresence mode="sync">
            {pulses.map((pulse) => {
              const config = KIND_CONFIG[pulse.kind];
              return (
                <motion.div
                  key={pulse.id}
                  initial={{ opacity: 0, y: 16, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -16, scale: 0.95 }}
                  transition={{ duration: 0.3 }}
                  className={`inline-flex items-start gap-2 px-3 py-2 rounded-lg border backdrop-blur-md text-xs pointer-events-auto shadow-xl ${config.className}`}
                >
                  <span className="shrink-0 mt-0.5">{config.icon}</span>
                  <div className="min-w-0"><div className="font-bold text-[11px] uppercase tracking-wider">{pulse.title}</div>{pulse.detail && <div className="opacity-80 text-[11px] mt-0.5 truncate">{pulse.detail}</div>}</div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </>
  );
}
