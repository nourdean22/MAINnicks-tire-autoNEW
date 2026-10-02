/**
 * ParentBackLink · v10.0.529.50 · Wave 4 nav upgrade
 *
 * Single-line back-link for sub-pages that lack persistent nav.
 * The orb only exposes top-level destinations (core 5 + Brain + Ops
 * + Settings) · sub-pages like /system/crons or /brain/health have
 * no built-in "back to parent" path. Operator lands on a sub-page
 * via ⌘K and has to retype the URL to get back.
 *
 * This component renders a thin, lowercase, mono-style "← system"
 * link at the top of each sub-page. Two-second perceptual win ·
 * matches the editorial-minimalist contract.
 *
 * Skills applied:
 *   · senior-frontend (Next.js Link · accessible focus)
 *   · baseline-ui (typography scale · tabular-nums · lowercase)
 *   · fixing-accessibility (aria-label · focus-visible ring)
 *   · frontend-design (DFII · gold accent on hover · ONE direction)
 */

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export interface ParentBackLinkProps {
  /** Where the link points · e.g. `/system` or `/brain` */
  href: string;
  /** Label · e.g. "system" or "brain" · lowercase per operator contract */
  label: string;
  /** Optional sub-trail · e.g. "all crons" when on /system/cron-runs/[id]/page */
  sub?: string;
}

export function ParentBackLink({ href, label, sub }: ParentBackLinkProps) {
  return (
    <Link
      href={href}
      aria-label={`back to ${label}`}
      className="inline-flex items-center gap-1.5 text-[11px] font-mono lowercase tracking-[0.12em] text-[var(--text-tertiary)] hover:text-fg focus-visible:text-fg focus-visible:outline-none transition-colors -my-1"
    >
      <ArrowLeft size={11} strokeWidth={1.75} />
      <span>{label}</span>
      {sub && (
        <>
          <span aria-hidden="true" className="text-[var(--text-tertiary)]/60">/</span>
          <span className="text-[var(--text-secondary)]">{sub}</span>
        </>
      )}
    </Link>
  );
}
