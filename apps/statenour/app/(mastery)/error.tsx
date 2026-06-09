"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export default function MasteryError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[NOUR OS] Page error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 px-4">
      <div className="w-16 h-16 rounded-2xl bg-red-500/10 flex items-center justify-center">
        <AlertTriangle className="w-7 h-7 text-red-400" strokeWidth={1.75} />
      </div>
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Something broke</h2>
        <p className="text-sm text-[var(--text-secondary)] max-w-md">
          {error.message || "An unexpected error occurred. Try again, or head back home."}
        </p>
      </div>
      {/* Two escapes: retry the failed render, OR leave for home so a
          non-recoverable error (bad deploy, missing env) isn't a retry trap. */}
      <div className="flex items-center gap-3">
        <button
          onClick={reset}
          className="px-6 py-2.5 rounded-lg bg-[var(--gold)] text-[var(--bg-void)] font-medium text-sm hover:opacity-90 transition-opacity"
        >
          Try Again
        </button>
        <Link
          href="/"
          className="px-6 py-2.5 rounded-lg border border-[var(--border-default)] text-[var(--text-secondary)] font-medium text-sm hover:text-[var(--text-primary)] hover:border-[var(--border-hover)] transition-colors"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
