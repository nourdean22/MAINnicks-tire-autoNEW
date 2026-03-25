/**
 * Client-side Error Tracker for Nick's Tire & Auto
 * Captures unhandled errors, React render errors, and breadcrumbs.
 * Reports to /api/track-error endpoint.
 */

interface Breadcrumb {
  type: "navigation" | "click" | "form" | "error" | "custom";
  message: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

interface ErrorReport {
  message: string;
  stack?: string;
  url: string;
  userAgent: string;
  breadcrumbs: Breadcrumb[];
  timestamp: number;
  componentStack?: string;
}

const MAX_BREADCRUMBS = 20;
const breadcrumbs: Breadcrumb[] = [];
let installed = false;

/** Add a breadcrumb to the ring buffer. */
export function addBreadcrumb(
  type: Breadcrumb["type"],
  message: string,
  data?: Record<string, unknown>
): void {
  breadcrumbs.push({ type, message, data, timestamp: Date.now() });
  if (breadcrumbs.length > MAX_BREADCRUMBS) {
    breadcrumbs.shift();
  }
}

/** Report an error to the server. */
export function captureError(
  error: Error | string,
  context?: { componentStack?: string }
): void {
  const report: ErrorReport = {
    message: typeof error === "string" ? error : error.message,
    stack: typeof error === "string" ? undefined : error.stack,
    url: window.location.href,
    userAgent: navigator.userAgent,
    breadcrumbs: [...breadcrumbs],
    timestamp: Date.now(),
    componentStack: context?.componentStack,
  };

  // Fire and forget — don't let error reporting cause more errors
  try {
    fetch("/api/track-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    }).catch(() => {});
  } catch {
    // Silently fail
  }
}

/** Install global error handlers. Call once on app init. */
export function installErrorHandlers(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  // Unhandled JS errors
  window.addEventListener("error", (event) => {
    addBreadcrumb("error", event.message);
    captureError(event.error || event.message);
  });

  // Unhandled promise rejections
  window.addEventListener("unhandledrejection", (event) => {
    const msg =
      event.reason instanceof Error
        ? event.reason.message
        : String(event.reason);
    addBreadcrumb("error", `Unhandled rejection: ${msg}`);
    captureError(
      event.reason instanceof Error ? event.reason : new Error(msg)
    );
  });

  // Track navigation breadcrumbs
  const originalPushState = history.pushState.bind(history);
  history.pushState = (...args) => {
    addBreadcrumb("navigation", `Navigate to ${args[2]}`);
    return originalPushState(...args);
  };

  // Track click breadcrumbs on elements with data-track attribute
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target as HTMLElement;
      const trackLabel =
        target.closest("[data-track]")?.getAttribute("data-track") ||
        target.closest("button")?.textContent?.trim().slice(0, 50) ||
        target.closest("a")?.getAttribute("href");
      if (trackLabel) {
        addBreadcrumb("click", trackLabel);
      }
    },
    { capture: true }
  );
}
