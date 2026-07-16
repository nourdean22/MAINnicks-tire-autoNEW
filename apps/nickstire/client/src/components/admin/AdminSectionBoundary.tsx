import { AlertTriangle, RefreshCw } from "lucide-react";
import React, { Component, type ReactNode } from "react";
import { recordAdminClientError } from "@/lib/adminClientTelemetry";

interface Props {
  children: ReactNode;
  sectionName: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorReference: string | null;
  retryKey: number;
}

class AdminSectionBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    error: null,
    errorReference: null,
    retryKey: 0,
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const record = recordAdminClientError({
      sectionName: this.props.sectionName,
      error,
      componentStack: info.componentStack ?? undefined,
    });
    this.setState({ errorReference: record.reference });
    console.error(`[AdminSectionBoundary:${this.props.sectionName}:${record.reference}]`, error);
  }

  handleRetry = () => {
    this.setState((state) => ({
      hasError: false,
      error: null,
      errorReference: null,
      retryKey: state.retryKey + 1,
    }));
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
            <p className="text-sm text-foreground/60 mb-3">
              The rest of the admin still works. Retry this section or choose another area from the navigation.
            </p>
            {this.state.errorReference && (
              <p className="text-xs font-mono text-amber-300 mb-4">
                Reference: {this.state.errorReference}
              </p>
            )}
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

    return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>;
  }
}

export default AdminSectionBoundary;
