/**
 * ProvenanceTag — the MEASURED / ESTIMATE / UNMEASURED word beside an admin number.
 * The label comes from `@shared/tileProvenance`; this component only draws it.
 *
 * ESTIMATE is the loud one on purpose: a modeled dollar figure is the number most
 * easily misread as money in the bank.
 */
import { PROVENANCE_MEANING, type TileProvenance } from "@shared/tileProvenance";

const TONE: Record<TileProvenance, string> = {
  MEASURED: "border-border/40 text-foreground/50",
  ESTIMATE: "border-amber-400/50 text-amber-300",
  UNMEASURED: "border-border/40 text-foreground/40 italic",
};

export function ProvenanceTag({ provenance }: { provenance: TileProvenance }) {
  return (
    <span
      data-provenance={provenance}
      title={PROVENANCE_MEANING[provenance]}
      className={`inline-block align-middle border px-1 py-px text-[9px] leading-none font-medium uppercase tracking-[0.12em] ${TONE[provenance]}`}
    >
      {provenance}
    </span>
  );
}
