/**
 * DrilldownDrawer — global slide-out panel that shows the rows
 * behind any KPI on the dashboard.
 *
 * Triggered globally via the `admin:open-drilldown` CustomEvent —
 * any metric card calls `dispatchEvent(new CustomEvent('admin:open-drilldown',
 * { detail: { kind: 'walk_aways' } }))` and the drawer opens, fetches,
 * and renders the rows.
 *
 * Architecture:
 *   - Single instance lives at the Admin shell top level
 *   - Event bus avoids prop-drilling
 *   - Queries trpc.adminDashboard.drilldown for normalized rows
 *   - Closes on Escape + outside click + close button
 *   - Mobile-aware: full-screen on phone, side panel on desktop
 */
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { X, Loader2, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type DrilldownKind =
  | "cars_in_shop"
  | "revenue_today"
  | "jobs_closed_today"
  | "pending_callbacks"
  | "walk_aways"
  | "fresh_leads"
  | "lapsed_vips"
  | "negative_reviews"
  | "today_bookings"
  // wave-124 — chat_sessions added because the Overview "Chat Sessions"
  // card was firing fresh_leads (wrong table) and the drawer always said
  // "Nothing to show". Now: real chat_sessions data, including which
  // converted to leads + the AI-extracted vehicle/problem summary.
  | "chat_sessions"
  // wave-125 — unified intake feed across all 5 sources (leads,
  // callbacks, chat sessions, bookings, vapi calls) in time order.
  // Operator's "what came in today" answer.
  | "intake_today";

export type DrilldownDetail = {
  kind: DrilldownKind;
  /** Optional override label/subtitle if you want to customize */
  title?: string;
};

const ADMIN_DRILLDOWN_EVENT = "admin:open-drilldown";

/**
 * Public helper — call this from any metric card to open the drawer.
 */
export function openDrilldown(detail: DrilldownDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ADMIN_DRILLDOWN_EVENT, { detail }));
}

export default function DrilldownDrawer() {
  const [activeKind, setActiveKind] = useState<DrilldownKind | null>(null);
  const [titleOverride, setTitleOverride] = useState<string | undefined>();

  // Listen for global open events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<DrilldownDetail>).detail;
      if (!detail?.kind) return;
      setActiveKind(detail.kind);
      setTitleOverride(detail.title);
    };
    window.addEventListener(ADMIN_DRILLDOWN_EVENT, handler as EventListener);
    return () => window.removeEventListener(ADMIN_DRILLDOWN_EVENT, handler as EventListener);
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!activeKind) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActiveKind(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeKind]);

  const isOpen = activeKind !== null;

  // tRPC query — only runs when drawer is open
  const { data, isLoading } = trpc.adminDashboard.drilldown.useQuery(
    activeKind ? { kind: activeKind, limit: 50 } : undefined as never,
    {
      enabled: isOpen,
      staleTime: 30_000,
    },
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
            onClick={() => setActiveKind(null)}
            aria-hidden="true"
          />
          {/* Drawer — wave-131 minimalist refresh */}
          <motion.aside
            key="drawer"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="fixed top-0 right-0 bottom-0 z-[61] w-full sm:w-[440px] bg-card border-l border-border/40 shadow-2xl flex flex-col pt-[env(safe-area-inset-top,0px)]"
            role="dialog"
            aria-modal="true"
          >
            {/* Header — refined: lighter weight, smaller title, single
                close affordance (X). No more bold text-base/cap-tracking. */}
            <div className="shrink-0 flex items-start justify-between gap-3 px-5 py-4 border-b border-border/20">
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-foreground text-[15px] tracking-tight truncate">
                  {isLoading ? "Loading…" : (titleOverride || data?.title || "Detail")}
                </h2>
                {data?.subtitle && (
                  <p className="text-foreground/50 text-[12px] mt-0.5 truncate">{data.subtitle}</p>
                )}
              </div>
              <button
                onClick={() => setActiveKind(null)}
                className="shrink-0 inline-flex items-center justify-center w-11 h-11 sm:w-8 sm:h-8 -mr-2 sm:-mr-1 text-foreground/45 hover:text-foreground hover:bg-foreground/5 rounded-md transition-colors"
                aria-label="Close drilldown"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {isLoading && (
                <div className="flex items-center justify-center py-20" role="status" aria-label="Loading">
                  <Loader2 className="w-5 h-5 animate-spin text-primary/60" aria-hidden="true" />
                </div>
              )}

              {!isLoading && data && data.rows.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
                  <p className="text-[13px] font-medium text-foreground/40">Nothing to show.</p>
                  <p className="text-[11px] text-foreground/30 mt-1">
                    No matching rows right now — that's a clean state.
                  </p>
                </div>
              )}

              {!isLoading && data && data.rows.length > 0 && (
                <div className="divide-y divide-border/10">
                  {data.rows.map((row: DrilldownRowData) => (
                    <DrilldownRow key={row.id} row={row} />
                  ))}
                </div>
              )}
            </div>

            {/* Footer — minimal: row count + Esc hint, no redundant
                CLOSE button on desktop. On mobile, we render a clear Close action button for better ergonomics. */}
            <div className="shrink-0 px-5 py-3 border-t border-border/15 bg-foreground/[0.02] flex flex-col gap-2 sm:gap-0 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-foreground/40 tracking-wide">
                  {data?.rows.length ?? 0} row{data?.rows.length === 1 ? "" : "s"} <span className="hidden sm:inline">· Esc or click outside to close</span>
                </span>
              </div>
              <button
                onClick={() => setActiveKind(null)}
                className="sm:hidden w-full min-h-[44px] py-2.5 px-4 bg-foreground/5 hover:bg-foreground/10 text-foreground text-[14px] font-medium rounded-md transition-colors mt-1"
              >
                Close
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Row renderer ────────────────────────────────────────

interface DrilldownRowData {
  id: string | number;
  primary: string;
  secondary?: string;
  meta?: string;
  value?: string;
  href?: string;
}

function DrilldownRow({ row }: { row: DrilldownRowData }) {
  return (
    <div className="px-5 py-3 hover:bg-foreground/[0.02] transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground text-[13px] truncate">{row.primary}</p>
          {row.secondary && (
            <p className="text-foreground/50 text-[11px] mt-0.5 truncate">{row.secondary}</p>
          )}
          {row.meta && (
            <p className="text-foreground/40 text-[10px] mt-1 italic line-clamp-2">{row.meta}</p>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {row.value && (
            <span className="font-mono text-[11px] text-foreground/70 whitespace-nowrap">
              {row.value}
            </span>
          )}
          {row.href && (
            <a
              href={row.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground/30 hover:text-primary transition-colors"
              aria-label="Open detail"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
