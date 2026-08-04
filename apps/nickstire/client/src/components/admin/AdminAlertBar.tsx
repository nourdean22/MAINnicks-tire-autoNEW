/**
 * AdminAlertBar — conditional render of operational alerts at top of
 * any admin page. Per ADMIN_PHILOSOPHY.md: "the alerts bar might be
 * empty 80% of the time. That's correct. Empty alerts bar = everything's
 * fine, do whatever you came here for."
 *
 * The component returns null when alerts is empty so it collapses to
 * 0px height — no "All systems normal" filler that wastes screen space.
 *
 * Built 2026-05-07 (wave-54).
 */
import { AlertCircle, AlertTriangle, Info, X } from "lucide-react";
import { useState } from "react";

export interface AdminAlert {
  id: string;
  severity: "info" | "warn" | "crit";
  message: string;
  /** Optional CTA href */
  href?: string;
  /** Optional CTA label */
  ctaLabel?: string;
  /** Whether the user can dismiss this alert (some critical alerts shouldn't be dismissable) */
  dismissable?: boolean;
}

interface AdminAlertBarProps {
  alerts: AdminAlert[];
}

const SEVERITY_STYLES: Record<AdminAlert["severity"], {
  bg: string; ring: string; text: string; icon: typeof AlertCircle;
}> = {
  info: {
    bg: "bg-[var(--data-info-soft)]",
    ring: "ring-[var(--data-info)]/30",
    text: "text-[var(--data-info)]",
    icon: Info,
  },
  warn: {
    bg: "bg-[var(--data-warn-soft)]",
    ring: "ring-[var(--data-warn)]/30",
    text: "text-[var(--data-warn)]",
    icon: AlertTriangle,
  },
  crit: {
    bg: "bg-[var(--data-crit-soft)]",
    ring: "ring-[var(--data-crit)]/30",
    text: "text-[var(--data-crit)]",
    icon: AlertCircle,
  },
};

export default function AdminAlertBar({ alerts }: AdminAlertBarProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const visible = alerts.filter((a) => !dismissed.has(a.id));

  // Per philosophy: empty alerts bar = empty render
  if (visible.length === 0) return null;

  return (
    <div className="space-y-2 mb-4">
      {visible.map((alert) => {
        const style = SEVERITY_STYLES[alert.severity];
        const Icon = style.icon;
        return (
          <div
            key={alert.id}
            className={[
              "flex items-center gap-3 px-3 py-2.5 rounded-md ring-1",
              style.bg,
              style.ring,
              "transition-opacity duration-[var(--dur-admin-snap)]",
            ].join(" ")}
            role="alert"
            aria-live={alert.severity === "crit" ? "assertive" : "polite"}
          >
            <Icon className={`w-4 h-4 flex-shrink-0 ${style.text}`} />
            <span className={`flex-1 text-sm ${style.text} font-medium`}>
              {alert.message}
            </span>
            {alert.href && alert.ctaLabel && (
              <a
                href={alert.href}
                className={`text-xs font-bold uppercase tracking-wider hover:underline ${style.text}`}
              >
                {alert.ctaLabel}
              </a>
            )}
            {alert.dismissable !== false && (
              <button
                type="button"
                onClick={() => setDismissed(new Set([...dismissed, alert.id]))}
                /* 48x48 hit area behind a 14px glyph — p-1 gave this 22x22px, and
                   it is a top-of-page banner the operator dismisses one-handed.
                   Negative margins keep the alert row from growing. */
                className={`-my-2 -mr-1 w-12 h-12 inline-flex items-center justify-center rounded hover:bg-black/10 ${style.text}`}
                aria-label="Dismiss alert"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
