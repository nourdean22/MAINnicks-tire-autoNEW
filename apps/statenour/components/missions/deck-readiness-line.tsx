"use client";

/**
 * deck-readiness-line.tsx — dark cockpit (§10, aviation HCI).
 *
 * Nominal + fresh renders NOTHING — quiet is the healthy signal. The
 * line speaks only on exception, and always says how old its data is
 * when it can't speak at all. Replaces the always-on governor strip
 * that printed "Readiness: 96/100" off a health log of unbounded age.
 *
 * 2026-09-16 · Visible Transformation: a ruled line, not a pill.
 */
import type { MissionsDeck } from "@/lib/missions/deck";

export function DeckReadinessLine({ readiness }: { readiness: MissionsDeck["readiness"] }) {
  if (readiness.state === "nominal") return null;

  const tone =
    readiness.state === "exception"
      ? "border-amber-400/70 text-amber-200/90"
      : "border-edge text-fg-tertiary";

  return (
    <p
      role={readiness.state === "exception" ? "status" : undefined}
      className={`border-l-2 py-1 pl-4 font-mono text-[12px] uppercase tracking-[0.14em] ${tone}`}
    >
      {readiness.line}
    </p>
  );
}
