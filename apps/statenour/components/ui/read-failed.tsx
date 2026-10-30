"use client";

/**
 * ReadFailed · a failed read, said plainly, with a Retry that refetches the query (2026-10-29 sync
 * audit, finding 4). The pull gesture calls router.refresh(), which does not refetch client tRPC
 * reads, so "Pull to refresh" pointed at nothing that worked. Same button as Home's (home-console.tsx).
 */
import type { ReactNode } from "react";

export function ReadFailed({ children, onRetry }: { children: ReactNode; onRetry: () => void }) {
  return (
    <div role="alert" className="border-l-2 border-rose-500/60 py-1 pl-4">
      <p className="text-[13px] leading-relaxed text-rose-300/90">{children}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex min-h-[44px] items-center rounded-control border border-edge-default px-4 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg"
      >
        Retry
      </button>
    </div>
  );
}
