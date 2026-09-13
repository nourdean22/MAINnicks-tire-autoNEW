"use client";

/**
 * MessageDiagnostics · v10.0.161 · de-cluttered meta strip
 *
 * Pre-fix the assistant bubble stacked up to 5 separate bands below
 * the message:
 *   1. ContextBlockBadges
 *   2. CitationPills        ← own row
 *   3. QualityBar           ← own row
 *   4. ActionClaimWarning   (v10.0.160)
 *   5. LaneCorrectionChip
 *   6. SmartReplies
 *
 * The user flagged this as "too cluttered." Citations + QualityBar
 * are diagnostic (informational, secondary) so they collapse onto
 * ONE shared row here. The actionable bands (ActionClaimWarning,
 * LaneCorrectionChip, SmartReplies) stay separate because they
 * carry urgency or invite a tap.
 *
 * When neither child has anything to show, this renders nothing —
 * zero footprint, no padding, no border.
 */

import { CitationPills } from "@/components/chat/citation-pills";
import { QualityBar, type QualityPayload } from "@/components/chat/quality-bar";
import { qualityHasIssue } from "@/lib/ai/chat/quality-diagnostics";

interface Citation {
  raw: string;
  category: string;
  detail?: string;
  start?: number;
  end?: number;
}

interface Props {
  citations?: Citation[];
  quality?: QualityPayload;
  onRegen?: () => void;
}

export function MessageDiagnostics({ citations, quality, onRegen }: Props) {
  const hasCitations = Array.isArray(citations) && citations.length > 0;
  const hasQualityIssue = qualityHasIssue(quality);

  if (!hasCitations && !hasQualityIssue) return null;

  // Side-by-side layout. flex-wrap means on narrow widths the strips
  // can flow to a second row gracefully; gap-x-2 keeps them visually
  // distinct. Each child still owns its own visual style — we only
  // consolidate the parent flow.
  return (
    <div className="mt-1.5 flex flex-wrap items-start gap-x-2 gap-y-1">
      {hasCitations && (
        <div className="m-0">
          <CitationPills citations={citations} />
        </div>
      )}
      {hasQualityIssue && (
        <div className="m-0 flex-1 min-w-0">
          <QualityBar payload={quality} onRegen={onRegen} />
        </div>
      )}
    </div>
  );
}
