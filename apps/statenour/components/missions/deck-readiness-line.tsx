"use client";

/**
 * deck-readiness-line.tsx — dark cockpit (§10, aviation HCI).
 *
 * Nominal + fresh renders NOTHING — quiet is the healthy signal. The
 * line speaks only on exception, and always says how old its data is
 * when it can't speak at all. Replaces the always-on governor strip
 * that printed "Readiness: 96/100" off a health log of unbounded age.
 */
import type { MissionsDeck } from "@/lib/missions/deck";

export function DeckReadinessLine({ readiness }: { readiness: MissionsDeck["readiness"] }) {
  if (readiness.state === "nominal") return null;

  const tone =
    readiness.state === "exception"
      ? "border-amber-400/30 bg-amber-400/[0.05] text-amber-200/90"
      : "border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--text-tertiary)]";

  return (
    <p
      role={readiness.state === "exception" ? "status" : undefined}
      className={`rounded-lg border px-3 py-2 font-mono text-[10.5px] uppercase tracking-wide ${tone}`}
    >
      {readiness.line}
    </p>
  );
}
