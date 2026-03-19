/**
 * Global Error Boundary — catches React render errors and provides
 * branded recovery UI with multiple recovery options.
 */
import { Component, ReactNode } from "react";
import { BUSINESS } from "@shared/business";

interface Props {
  children: ReactNode;
  /** Optional fallback component to render instead of the default error UI */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  retryCount: number;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, retryCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });

    // Log error for debugging (could be sent to an error reporting service)
    console.error("[ErrorBoundary] Caught error:", error);
    console.error("[ErrorBoundary] Component stack:", errorInfo.componentStack);
  }

  handleRetry = () => {
    this.setState((prev) => ({
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: prev.retryCount + 1,
    }));
  };

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = "/";
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const { error, retryCount } = this.state;
      const showRetry = retryCount < 3;

      return (
        <div className="min-h-screen bg-nick-dark flex items-center justify-center p-6">
          <div className="max-w-lg w-full text-center">
            {/* Logo / Brand */}
            <div className="w-14 h-14 bg-nick-yellow flex items-center justify-center mx-auto mb-6">
              <span className="font-heading font-bold text-nick-dark text-2xl">N</span>
            </div>

            {/* Error Icon */}
            <div className="w-16 h-16 mx-auto mb-6 flex items-center justify-center">
              <svg className="w-16 h-16 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>

            <h1 className="font-heading font-bold text-2xl sm:text-3xl text-foreground tracking-wider mb-3">
              SOMETHING WENT WRONG
            </h1>

            <p className="text-foreground/60 font-mono text-sm mb-8 leading-relaxed max-w-md mx-auto">
              We hit an unexpected error. This has been logged and we will look into it.
              You can try again or return to the homepage.
            </p>

            {/* Error details (collapsed by default) */}
            {error && (
              <details className="mb-8 text-left">
                <summary className="font-mono text-xs text-foreground/40 cursor-pointer hover:text-foreground/60 transition-colors">
                  Technical details
                </summary>
                <div className="mt-3 p-4 bg-background/50 border border-border/30 overflow-auto max-h-40">
                  <pre className="font-mono text-xs text-red-400/80 whitespace-pre-wrap break-words">
                    {error.message}
                  </pre>
                </div>
              </details>
            )}

            {/* Recovery Actions */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              {showRetry && (
                <button
                  onClick={this.handleRetry}
                  className="inline-flex items-center justify-center gap-2 bg-nick-yellow text-nick-dark px-6 py-3 font-heading font-bold text-sm tracking-wider uppercase hover:bg-nick-gold transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                  </svg>
                  TRY AGAIN
                </button>
              )}

              <button
                onClick={this.handleReload}
                className="inline-flex items-center justify-center gap-2 border border-foreground/30 text-foreground px-6 py-3 font-heading font-bold text-sm tracking-wider uppercase hover:border-nick-yellow hover:text-nick-yellow transition-colors"
              >
                RELOAD PAGE
              </button>

              <button
                onClick={this.handleGoHome}
                className="inline-flex items-center justify-center gap-2 border border-foreground/30 text-foreground px-6 py-3 font-heading font-bold text-sm tracking-wider uppercase hover:border-nick-yellow hover:text-nick-yellow transition-colors"
              >
                GO HOME
              </button>
            </div>

            {/* Contact fallback */}
            <p className="mt-8 text-foreground/30 font-mono text-xs">
              Need help? Call us at{" "}
              <a href={`tel:${BUSINESS.phone.raw}`} className="text-nick-yellow hover:text-nick-gold transition-colors">
                {BUSINESS.phone.display}
              </a>
            </p>

            {retryCount >= 3 && (
              <p className="mt-4 text-red-400/60 font-mono text-xs">
                Multiple retries failed. Please reload the page or try again later.
              </p>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
