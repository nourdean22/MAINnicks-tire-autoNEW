"use client";

/**
 * <ReadStateNote />: what a data block says in place of its data when the read failed or is paused
 * (truth sweep 2026-10-23; lib/query-state.ts). It names the cause and the next action. A failure
 * offers a 44px Retry; offline needs none, the read runs when the connection returns. `ready` and
 * `loading` render nothing here: the caller owns its own skeleton and its own data.
 */
import { errorCopy, offlineCopy, type ReadState } from "@/lib/query-state";
import { cn } from "@/lib/utils";

export function ReadStateNote({
  state,
  label,
  onRetry,
  className,
}: {
  state: ReadState;
  label: string;
  onRetry?: () => void;
  className?: string;
}) {
  if (state === "ready" || state === "loading") return null;
  if (state === "offline") {
    return (
      <p role="status" data-read-state="offline" className={cn("text-[13px] text-amber-300", className)}>
        {offlineCopy(label)}
      </p>
    );
  }
  return (
    <div
      role="alert"
      data-read-state="error"
      className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-red-300", className)}
    >
      <p>{errorCopy(label)}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-[44px] items-center font-medium text-fg underline-offset-4 transition-colors duration-[var(--motion-state)] hover:underline"
        >
          Retry
        </button>
      )}
    </div>
  );
}
