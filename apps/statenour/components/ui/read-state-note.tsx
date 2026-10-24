"use client";

/**
 * <ReadStateNote />: what a data block says about a read that failed, is paused, or left old data
 * on screen (truth sweep 2026-10-23; lib/query-state.ts). It names the cause and the next action.
 * A failure offers a 44px Retry, which reads "Retrying" and disables while the retry runs; `stale`
 * renders ABOVE data the caller keeps drawing; offline needs no Retry, the read runs when the
 * connection returns. `ready` and `loading` render nothing here: the caller owns its own skeleton
 * and its own data, so it can pass the state unconditionally.
 */
import { errorCopy, offlineCopy, staleCopy, type ReadState } from "@/lib/query-state";
import { cn } from "@/lib/utils";

function RetryButton({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      disabled={retrying}
      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center font-medium text-fg underline-offset-4 transition-colors duration-[var(--motion-state)] hover:underline disabled:opacity-60"
    >
      {retrying ? "Retrying" : "Retry"}
    </button>
  );
}

export function ReadStateNote({
  state,
  label,
  onRetry,
  retrying = false,
  message,
  className,
}: {
  state: ReadState;
  label: string;
  onRetry?: () => void;
  /** A Retry is in flight (lib/query-state isRetrying): the button disables and reads "Retrying". */
  retrying?: boolean;
  /** Replaces the default error or stale sentence when the caller knows more (for example "2 of 3 feeds"). */
  message?: string;
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
  const stale = state === "stale";
  return (
    <div
      role={stale ? "status" : "alert"}
      data-read-state={stale ? "stale" : "error"}
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]",
        stale ? "text-amber-300" : "text-red-300",
        className,
      )}
    >
      <p>{message ?? (stale ? staleCopy(label) : errorCopy(label))}</p>
      {onRetry && <RetryButton onRetry={onRetry} retrying={retrying} />}
    </div>
  );
}
