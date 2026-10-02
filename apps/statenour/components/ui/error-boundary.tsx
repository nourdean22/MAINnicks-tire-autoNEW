"use client";

// FRESHNESS_EXEMPT — error UI, no data fetched

/**
 * <ErrorBoundary /> — catches render-time exceptions, ships them to
 * the client-error-telemetry pipeline, and renders a recoverable
 * fallback card so a single broken component doesn't white-screen
 * the entire page.
 *
 * React doesn't support function-component error boundaries yet, so
 * this is a class component wrapping a hook-friendly fallback.
 *
 * Design decisions:
 *   · fallback is a prop for the rare page-wide custom case; default
 *     is a GlassCard-styled "this panel broke" with a retry button
 *   · every boundary trip auto-posts to /api/errors via
 *     reportClientError from client-error-telemetry.tsx — same dedupe
 *     + rate-limit pipeline as window.onerror
 *   · `name` prop labels the boundary in the telemetry payload so
 *     Nour sees "SettingsPage · SkillLibrary" instead of a raw stack
 *   · retry nukes the error state and re-renders children once; if
 *     the underlying error is persistent, it'll trip again (that's
 *     by design — loud vs silent)
 *
 * Usage:
 *   <ErrorBoundary name="HQ.SituationCard">
 *     <SituationCard />
 *   </ErrorBoundary>
 *
 * Layout-level wrapping pattern:
 *   app/(mastery)/layout.tsx wraps children in <ErrorBoundary
 *   name="mastery.root" /> so one page blowing up leaves the chrome
 *   + nav intact.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { GlassCard } from "@/components/ui/glass-card";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { reportClientError } from "@/components/ui/client-error-telemetry";

interface Props {
  children: ReactNode;
  /** Boundary label for telemetry — e.g. "HQ.SituationCard" */
  name?: string;
  /** Custom fallback component. Receives the error + a reset fn. */
  fallback?: (err: Error, reset: () => void) => ReactNode;
  /** Callback fires when an error is caught. */
  onError?: (err: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    reportClientError(error, {
      boundary: this.props.name ?? "unnamed",
      componentStack: info.componentStack ?? undefined,
    });
    this.props.onError?.(error, info);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }

    return (
      <GlassCard className="border-rose-500/30 bg-rose-500/5">
        <div className="flex items-start gap-2">
          <AlertTriangle size={14} className="text-rose-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-rose-300">
              {this.props.name ? `${this.props.name} · ` : ""}render failed
            </p>
            <p className="text-[12px] text-rose-300/80 mt-0.5 break-words">
              {error.message.slice(0, 300)}
            </p>
            <p className="text-[11px] text-rose-300/50 mt-1 font-mono">
              logged to /api/errors · check /system/logs?view=errors
            </p>
          </div>
          <button
            type="button"
            onClick={this.reset}
            className="shrink-0 text-[13px] font-medium px-2 py-1 rounded-control border border-rose-400/40 text-rose-300 hover:bg-rose-400/10 transition-colors duration-[var(--motion-state)] inline-flex items-center gap-1"
          >
            <RotateCcw size={10} />
            Retry
          </button>
        </div>
      </GlassCard>
    );
  }
}
