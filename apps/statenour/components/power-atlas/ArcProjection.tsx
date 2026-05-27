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
      className="rounded-xl border bg-[var(--bg-raised)] p-4"
      style={{ borderColor: "rgba(255,255,255,0.06)" }}
    >
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="font-serif text-lg tracking-tight text-[var(--text-primary)]">
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
          className="text-[10px] uppercase tracking-wider text-amber-300/80 hover:text-amber-300 disabled:opacity-50"
        >
          {mutation.isPending
            ? "projecting…"
            : projection
              ? "re-project"
              : "project"}
        </button>
      </div>
      {projection ? (
        <div className="space-y-3 text-xs text-[var(--text-secondary)]">
          {projection.do_nothing && (
            <p>
              <span className="text-[var(--text-tertiary)] uppercase text-[10px] tracking-wider mr-2">
                do nothing →
              </span>
              {projection.do_nothing}
            </p>
          )}
          {projection.double_effort && (
            <p>
              <span className="text-[var(--text-tertiary)] uppercase text-[10px] tracking-wider mr-2">
                2× effort →
              </span>
              {projection.double_effort}
            </p>
          )}
          {projection.blow_up && (
            <p>
              <span className="text-[var(--text-tertiary)] uppercase text-[10px] tracking-wider mr-2">
                sever →
              </span>
              {projection.blow_up}
            </p>
          )}
          {projection.recommendation && (
            <p
              className="border-t pt-3 italic text-[var(--text-primary)]"
              style={{ borderColor: "rgba(255,255,255,0.06)" }}
            >
              &ldquo;{projection.recommendation}&rdquo;
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-[var(--text-tertiary)]">
          No projection cached. Hit project to generate a Greene-flavored
          5-year arc with do-nothing / 2× / sever scenarios.
        </p>
      )}
    </section>
  );
}
