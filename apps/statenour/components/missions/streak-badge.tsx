"use client";

/**
 * Streak Badge — inline fire indicator for recurring tasks.
 *
 * Shows a "🔥 N" badge next to the task title when streakCount >= 2.
 * Pure presentational — no state, no effects, just props in and
 * styled output.
 */

export interface StreakBadgeProps {
  /** Current streak count. Badge hidden when < 2. */
  streak: number | null | undefined;
}

export function StreakBadge({ streak }: StreakBadgeProps) {
  if (typeof streak !== "number" || streak < 2) return null;

  return (
    <>
      <span className="streak-badge" title={`${streak}-day streak`}>
        <span className="streak-fire" aria-hidden="true">
          🔥
        </span>
        <span className="streak-count">{streak}</span>
      </span>
      <style jsx>{`
        .streak-badge {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          padding: 1px 6px 1px 4px;
          border-radius: 9999px;
          background: rgba(245, 158, 11, 0.1);
          border: 1px solid rgba(245, 158, 11, 0.2);
          font-family: var(--font-mono, "JetBrains Mono", monospace);
          font-size: 10px;
          font-weight: 600;
          color: rgb(245, 158, 11);
          line-height: 1;
          vertical-align: middle;
          animation: streak-pop-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) both;
        }

        .streak-fire {
          font-size: 11px;
          line-height: 1;
        }

        .streak-count {
          font-variant-numeric: tabular-nums;
        }

        @keyframes streak-pop-in {
          from {
            opacity: 0;
            transform: scale(0.7);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </>
  );
}
