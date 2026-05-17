/**
 * AdminSectionBoundary — inline error boundary for a single admin section.
 *
 * Pre-2026-05-05: any uncaught error in an admin section component
 * (a tRPC procedure throwing, a malformed response, a render bug)
 * bubbled up to the App-level ErrorBoundary in client/src/App.tsx,
 * which renders a full-page "this page broke" UI. That meant ONE
 * widget's failure took down the entire admin dashboard, including
 * the navbar and other sections.
 *
 * This component catches errors at the section level and renders a
 * compact in-place fallback so the rest of the admin keeps working.
 * The user can retry the section, the navbar/other tools stay live,
 * the audit damage is contained.
 */

import React, { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Used in the fallback message and console log so failures are attributable. */
  sectionName: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  retryKey: number;
}

class AdminSectionBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, retryKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface the section name + component stack so the bug is easy to
    // attribute. AdminSSEContext or Sentry could subscribe later.
    console.error(`[AdminSectionBoundary:${this.props.sectionName}]`, error);
    console.error(info.componentStack);
  }

  handleRetry = () => {
    // Bumping retryKey forces the children to remount and re-fire effects.
    this.setState((s) => ({ hasError: false, error: null, retryKey: s.retryKey + 1 }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[40vh] flex items-center justify-center p-8">
          <div className="max-w-md text-center">
            <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-4" />
            <h3 className="font-bold text-lg text-foreground mb-2">
              The {this.props.sectionName} section failed.
            </h3>
            <p className="text-sm text-foreground/60 mb-4">
              The rest of the admin still works. Try retrying, or pick another section from the nav.
            </p>
            {this.state.error && (
              <details className="text-left text-xs text-foreground/50 mb-4">
                <summary className="cursor-pointer">Technical details</summary>
                <pre className="mt-2 p-3 bg-card/50 border border-border/30 overflow-auto rounded">
                  {this.state.error.message}
                </pre>
              </details>
            )}
            <button
              onClick={this.handleRetry}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-bold rounded hover:opacity-90 transition-opacity"
            >
              <RefreshCw className="w-4 h-4" />
              Retry section
            </button>
          </div>
        </div>
      );
    }
    // The retryKey forces remount on retry so children's queries refire.
    return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>;
  }
}

export default AdminSectionBoundary;
