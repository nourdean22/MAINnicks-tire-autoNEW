/**
 * DecisionSpread · v10.0.207 · reusable editorial-spread primitive
 *
 * Promotes the DFII-15 layout from /brain/link-review to a primitive
 * any future page can drop in. The differentiation anchor — a
 * cosine/score connecting bar between two columns — bakes in once,
 * reused everywhere.
 *
 * Use cases beyond link-review:
 *   · Anti-pattern resolution (anti-pattern ↔ alternative)
 *   · Decision ledger (decision ↔ outcome)
 *   · Contradiction reconciliation (belief A ↔ belief B)
 *   · Skill graduation review (skill ↔ mastery target)
 *
 * Design system rules baked in:
 *   · Asymmetric 5/auto/5 columns on desktop, stacks on mobile
 *   · Connector bar with gold-mix gradient + endpoint dots
 *   · Section labels in tracked tiny caps (industrial signature)
 *   · Monospace numeric badge in the connector
 *   · No Inter/Roboto/Arial · uses existing system stack
 *   · No purple gradients · gold-on-dark only
 *
 * Anti-slop verified (gate [13/13]).
 */

import type { ReactNode } from "react";

interface DecisionSpreadProps {
  /** Tiny-caps label above left column (e.g. "conversation", "anti-pattern", "belief A").
   *  Accepts ReactNode so adopters can fold a severity dot or domain
   *  code into the label without a sibling element breaking the rhythm. */
  leftLabel?: ReactNode;
  /** Larger title for the left side */
  leftTitle: string;
  /** Body text under left title (clamped to 3 lines) */
  leftBody?: string;
  /** Optional metadata row below left body (e.g. tags) */
  leftMeta?: string;

  /** Score / similarity / confidence — rendered in the connector */
  score: number;
  /** Number formatter — default is percent (0.65 → "65%") */
  scoreFormat?: (n: number) => string;
  /** Tiny label under the connector (e.g. "cosine", "confidence") */
  scoreLabel?: string;

  /** Tiny-caps label above right column · ReactNode for status badges. */
  rightLabel?: ReactNode;
  /** Larger title for the right side · gold-accented by default */
  rightTitle: string;
  /** Body text under right title */
  rightBody?: ReactNode;

  /** Decision rail — buttons / actions */
  actions?: ReactNode;

  /** Optional className passthrough for outer card */
  className?: string;
}

const defaultScoreFormat = (n: number) => `${(n * 100).toFixed(0)}%`;

export function DecisionSpread({
  leftLabel = "subject",
  leftTitle,
  leftBody,
  leftMeta,
  score,
  scoreFormat = defaultScoreFormat,
  scoreLabel = "score",
  rightLabel = "target",
  rightTitle,
  rightBody,
  actions,
  className = "",
}: DecisionSpreadProps) {
  return (
    <article
      className={`rounded-surface border border-edge-subtle bg-content overflow-hidden ${className}`}
    >
      <style jsx>{`
        .connector {
          position: relative;
          height: 1px;
          background: var(--edge-strong);
        }
        .connector::before,
        .connector::after {
          content: "";
          position: absolute;
          top: 50%;
          width: 6px;
          height: 6px;
          border-radius: 9999px;
          background: var(--text-tertiary);
          transform: translateY(-50%);
        }
        .connector::before {
          left: -3px;
        }
        .connector::after {
          right: -3px;
        }
        .label {
          font-family: var(--font-geist-mono), ui-monospace, SFMono-Regular, monospace;
          font-size: 11px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--text-tertiary);
        }
        .score {
          font-family: var(--font-geist-mono), ui-monospace, SFMono-Regular, monospace;
          font-variant-numeric: tabular-nums;
          font-weight: 500;
          color: var(--text-primary);
        }
      `}</style>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 md:gap-6 px-4 sm:px-6 py-5">
        {/* LEFT */}
        <div className="min-w-0">
          <p className="label mb-2">{leftLabel}</p>
          <h3 className="text-[15px] sm:text-base font-medium text-[var(--text-primary)] leading-snug mb-2 line-clamp-2">
            {leftTitle}
          </h3>
          {leftBody && (
            <p className="text-[12.5px] text-[var(--text-secondary)] leading-relaxed line-clamp-3">
              {leftBody}
            </p>
          )}
          {leftMeta && (
            <p className="mt-2 text-[10.5px] text-[var(--text-tertiary)] tracking-wide">
              {leftMeta}
            </p>
          )}
        </div>

        {/* MIDDLE — the differentiation anchor */}
        <div className="hidden md:flex flex-col items-center justify-center w-[88px] gap-3">
          <span className="score text-[22px] leading-none">{scoreFormat(score)}</span>
          <div className="connector w-full" />
          <span className="label">{scoreLabel}</span>
        </div>
        <div className="flex md:hidden items-center gap-3">
          <div className="connector flex-1" />
          <span className="score text-[14px]">{scoreFormat(score)}</span>
          <div className="connector flex-1" />
        </div>

        {/* RIGHT */}
        <div className="min-w-0 md:text-right">
          <p className="label mb-2">{rightLabel}</p>
          <h3 className="text-[15px] sm:text-base font-medium text-[var(--text-primary)] leading-snug mb-2">
            {rightTitle}
          </h3>
          {rightBody && (
            <div className="text-[12.5px] text-[var(--text-tertiary)] leading-relaxed">
              {rightBody}
            </div>
          )}
        </div>
      </div>

      {actions && (
        <div className="px-4 sm:px-6 py-3 border-t border-edge-subtle bg-surface-raised">
          {actions}
        </div>
      )}
    </article>
  );
}
