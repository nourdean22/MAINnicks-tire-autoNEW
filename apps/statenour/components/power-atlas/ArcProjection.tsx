"use client";

/**
 * <ArcProjection> · 2026-05-27 · Power Atlas Phase 2
 *
 * Renders the cached 5-year arc projection (do_nothing / double_effort
 * / blow_up + Greene-voiced recommendation) for a person, with an
 * operator-driven "project" / "re-project" button that fires the
 * `projectArc` mutation. The mutation caches the output to
 * PersonProfile.lastArcPlan so the panel can show last-cached on
 * subsequent visits without re-billing the AI.
 *
 * No emojis. Serif heading. Italic recommendation pull-quote. Quiet
 * motion — opacity-50 while pending.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";

interface CachedProjection {
  do_nothing?: string;
  double_effort?: string;
  blow_up?: string;
  recommendation?: string;
  projectedAt?: string;
}

interface ArcProjectionProps {
  personId: string;
  initialProjection: unknown;
}

function parseProjection(raw: unknown): CachedProjection | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as CachedProjection;
}

export default function ArcProjection({
  personId,
  initialProjection,
}: ArcProjectionProps) {
  const [projection, setProjection] = useState<CachedProjection | null>(
    parseProjection(initialProjection),
  );
  const mutation = trpc.task.projectArc.useMutation();

  return (
    <section
      className="rounded-surface border border-edge-subtle bg-content p-4"
    >
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="text-[17px] font-semibold text-fg">
          5-year arc
        </h2>
        <button
          type="button"
          onClick={async () => {
            const r = await mutation.mutateAsync({ personId });
            if (r.projection) {
              setProjection(r.projection as CachedProjection);
            }
          }}
          disabled={mutation.isPending}
          className="text-[13px] font-medium text-amber-300/80 hover:text-amber-300 disabled:opacity-50"
        >
          {mutation.isPending
            ? "projecting…"
            : projection
              ? "Re-project"
              : "Project"}
        </button>
      </div>
      {projection ? (
        <div className="space-y-3 text-xs text-fg-secondary">
          {projection.do_nothing && (
            <p>
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary mr-2">
                do nothing →
              </span>
              {projection.do_nothing}
            </p>
          )}
          {projection.double_effort && (
            <p>
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary mr-2">
                2× effort →
              </span>
              {projection.double_effort}
            </p>
          )}
          {projection.blow_up && (
            <p>
              <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary mr-2">
                sever →
              </span>
              {projection.blow_up}
            </p>
          )}
          {projection.recommendation && (
            <p
              className="border-t border-edge-subtle pt-3 italic text-fg"
            >
              &ldquo;{projection.recommendation}&rdquo;
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-fg-tertiary">
          No projection cached. Hit project to generate a Greene-flavored
          5-year arc with do-nothing / 2× / sever scenarios.
        </p>
      )}
    </section>
  );
}
