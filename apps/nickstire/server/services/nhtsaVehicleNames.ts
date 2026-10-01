/**
 * Shop vehicle names -> NHTSA vehicle names (ADR-0021 §8; Q-50 phase 2b).
 *
 * Work orders store whatever the booking text held: workOrderAutomation.ts takes
 * the second word as the make, so "Chevy", "VW" and "Land" (for Land Rover) are
 * common. NHTSA's recall and complaint APIs answer HTTP 400 for those names
 * (phase 1 live probes: `chevy silverado 2015`, `land rover range rover 2016`),
 * and the stored warranty-extension rows spell makes NHTSA's way, with and
 * without hyphens (`MERCEDES-BENZ`, `MERCEDES BENZ`).
 *
 * One table, read by both the live API lookups (vehicleData.ts) and the stored
 * warranty-extension read (nhtsaWarrantyRead.ts). Models are not aliased:
 * NHTSA's model names are narrower than shop speech (`SILVERADO 1500`), and the
 * warranty read handles that with a labelled "related" match instead.
 */
import { normalizeVehicleName } from "./nhtsaWarrantyParse";

/** §8 step 1, then spaces removed: the key every make spelling folds to. */
export function foldMake(raw: string): string {
  return normalizeVehicleName(raw).replace(/ /g, "");
}

/**
 * Folded shop spelling -> NHTSA's spelling. Only names NHTSA does not know
 * itself belong here; anything not listed passes through unchanged.
 */
const MAKE_ALIASES: Readonly<Record<string, string>> = {
  CHEVY: "CHEVROLET",
  VW: "VOLKSWAGEN",
  MERCEDES: "MERCEDES-BENZ",
  MERCEDESBENZ: "MERCEDES-BENZ",
  BENZ: "MERCEDES-BENZ",
  LANDROVER: "LAND ROVER",
};

export interface NhtsaVehicleName {
  make: string;
  model: string;
  /** True when the shop's spelling was changed; the panel says so. */
  aliased: boolean;
}

/**
 * The make and model to ask NHTSA for. "Land" + "Rover Range Rover" (the
 * second-word split) becomes "LAND ROVER" + "Range Rover".
 */
export function toNhtsaVehicleName(make: string, model: string): NhtsaVehicleName {
  const m = make.trim();
  const mod = model.trim();
  const folded = foldMake(m);
  if (folded === "LAND") {
    const rest = /^rover(?:\s+|-)(.+)$/i.exec(mod);
    if (rest) return { make: "LAND ROVER", model: rest[1].trim(), aliased: true };
  }
  const alias = MAKE_ALIASES[folded];
  if (alias) return { make: alias, model: mod, aliased: normalizeVehicleName(alias) !== normalizeVehicleName(m) };
  return { make: m, model: mod, aliased: false };
}

/**
 * Every stored `make_norm` value a make can appear as. The ingest stores only
 * §8 step 1, so `MERCEDES-BENZ` is stored as `MERCEDESBENZ` but `MERCEDES BENZ`
 * keeps its space: both sides are folded by listing both spellings, which
 * keeps the read on the (make_norm, model_year, model_norm) index.
 */
export function storedMakeSpellings(nhtsaMake: string): string[] {
  return [...new Set([
    normalizeVehicleName(nhtsaMake),
    foldMake(nhtsaMake),
    normalizeVehicleName(nhtsaMake.replace(/-/g, " ")),
  ])].filter(Boolean);
}
