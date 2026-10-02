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
      <div className="w-16 h-16 rounded-float bg-red-500/10 flex items-center justify-center">
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
          className="inline-flex min-h-[44px] items-center rounded-control bg-accent px-4 py-2 text-[14px] font-semibold text-[var(--text-inverse)] transition-colors duration-[var(--motion-state)] hover:bg-accent-hover"
        >
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex min-h-[44px] items-center rounded-control border border-edge-default bg-content px-4 py-2 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
