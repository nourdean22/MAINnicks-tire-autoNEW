"use client";

/**
 * app/global-error.tsx · 2026-09-02
 *
 * Root error boundary for the App Router. It replaces the root layout when
 * rendering fails above every nested `error.tsx`, so it must render its own
 * <html>/<body> and cannot rely on globals.css. Without this file a root
 * render crash reaches nobody: Sentry's Next.js integration documents it as
 * the required capture point for that class of error.
 *
 * Styling is inline and deliberately spare — dark ground, system sans, one
 * action — the operator-grade identity, not a vendor error page.
 */
import { useEffect } from "react";
import { reportGlobalError } from "@/lib/observability/report-global-error";
import { reloadOnceForDeploySkew } from "@/lib/observability/deploy-skew";

function sessionStore(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // A tab left open across a deploy (Q-35): one reload picks up the current
    // build. Anything else, or a repeat, is reported as before.
    if (reloadOnceForDeploySkew(error, sessionStore(), () => window.location.reload())) return;
    reportGlobalError(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0a0a0b",
          color: "#e6e6e6",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
        }}
      >
        <main style={{ maxWidth: 480, padding: "2rem" }}>
          <p style={{ fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8a8a8a", margin: 0 }}>
            NOUR OS
          </p>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0.5rem 0 0.75rem" }}>The root render failed.</h1>
          <p style={{ margin: 0, lineHeight: 1.5, color: "#b5b5b5" }}>
            The error has been reported. Reload keeps your session; if it repeats, the digest below is what to
            quote.
          </p>
          {error.digest ? (
            <p style={{ marginTop: "0.75rem", fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#8a8a8a" }}>
              digest {error.digest}
            </p>
          ) : null}
          <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.75rem" }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                background: "#e6e6e6",
                color: "#0a0a0b",
                border: 0,
                borderRadius: 6,
                padding: "0.6rem 1rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            {/* A HARD navigation on purpose: this boundary replaces the root
                layout, so next/link's router context is exactly what may be
                broken. eslint's no-html-link-for-pages assumes a healthy tree. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" style={{ color: "#e6e6e6", alignSelf: "center" }}>
              Home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
