/**
 * Today's "Checks" rail (admin UI v1 W2): every panel that monitors rather than asks for work, under
 * one <details>. Collapsed on phones and open from lg up, until the operator chooses; only an operator
 * toggle is remembered per device. The summary counts exactly four kinds of open item, computed by
 * OverviewSection: overdue promises (a failed promise read says "promises unknown"), exception-feed
 * rows, an integration that is not fresh, and an SMS gateway that is down or unreadable. Inspection
 * capture and the closed-loop lift panel are tools and measurements, not open items, so they are not
 * counted; a closed rail can still hold them.
 */
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

const CHECKS_STORAGE_KEY = "nicks-admin-today-checks";

function initialOpen(): boolean {
  try {
    const saved = window.localStorage.getItem(CHECKS_STORAGE_KEY);
    if (saved === "open" || saved === "closed") return saved === "open";
  } catch {
    // Storage blocked (private mode, PWA quirks): fall back to the viewport default.
  }
  return typeof window.matchMedia === "function" && window.matchMedia("(min-width: 1024px)").matches;
}

export default function ChecksRail({ status, alert, children }: { status: string; alert: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <details
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        // The toggle event also fires when a details mounts open; only a change is the operator's choice.
        if (next === open) return;
        setOpen(next);
        try {
          window.localStorage.setItem(CHECKS_STORAGE_KEY, next ? "open" : "closed");
        } catch {
          // Not remembered this time; the rail still works.
        }
      }}
      className="group border-t border-border"
    >
      <summary className="min-h-12 flex items-center gap-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        <span className="text-[15px] font-semibold">Checks</span>
        <span className={`text-[13px] ${alert ? "text-amber-300" : "text-muted-foreground"}`}>{status}</span>
        <ChevronDown aria-hidden className="ml-auto w-4 h-4 text-muted-foreground group-open:rotate-180" />
      </summary>
      <div className="space-y-4 pb-2 pt-1">{children}</div>
    </details>
  );
}
