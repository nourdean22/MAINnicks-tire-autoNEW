"use client";

import { useEffect } from "react";

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
        <span className="text-3xl">!</span>
      </div>
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Something broke</h2>
        <p className="text-sm text-[var(--nour-text-secondary)] max-w-md">
          {error.message || "An unexpected error occurred. Try again."}
        </p>
      </div>
      <button
        onClick={reset}
        className="px-6 py-2.5 rounded-lg bg-[var(--nour-gold)] text-[var(--text-primary)] font-medium text-sm hover:opacity-90 transition-opacity"
      >
        Try Again
      </button>
    </div>
  );
}
