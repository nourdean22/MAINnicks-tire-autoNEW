"use client";

/**
 * /system/eval-results · v10.0.x · drill-down for the EVAL PASS RATE
 * tile on /system/cockpit. The page was always intended (per the v524
 * commit on the API + the v526 commit on the tile that links here) but
 * was never built. Surfaced 2026-05-17 during the Railway-migration
 * coherency audit when the cockpit tile turned out to be a dead link.
 *
 * Renders the existing <EvalRegressionCard> component in a full-page
 * shell — same data, same controls, just framed by <PageHeader> so the
 * URL is bookmarkable + deep-linkable from elsewhere in the OS.
 *
 * Editorial-minimalist · matches the layout pattern from
 * /system/quality (Suspense + PageHeader + mx-auto max-w-5xl).
 */

import { PageHeader } from "@/components/layout/ui";
import { EvalRegressionCard } from "@/components/system/eval-regression-card";

export default function EvalResultsPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-5 px-3 py-4 sm:px-4 sm:py-6">
      <PageHeader
        parentHref="/system"
        parentLabel="system"
        eyebrow="NOUR OS · System"
        title="Eval results"
        description="Nightly regression-runner reports · pass rate trend · failure category drill-down. Backed by /api/system/eval-results."
      />

      <EvalRegressionCard />
    </div>
  );
}
