/**
 * DVI measurements — the structured vocabulary behind a technician's finding.
 *
 * Before 2026-10-07 an inspection item carried one condition colour, free
 * text and one photo. "Pads at 3 mm" lived in `notes` where nothing could read
 * it back, grade it, or compare it with the after-repair number. This module
 * is the ONE place that names the metrics a tech can record, the unit each is
 * recorded in, the positions it can be recorded at, and the shop guidance that
 * turns a number into green / yellow / red.
 *
 * Grading is SHOP GUIDANCE, not a legal statement: the thresholds below are
 * the common industry replace-soon bands, and the technician's own condition
 * choice always wins over the suggestion (the UI pre-selects, it never locks).
 *
 * Storage: `inspection_items.measurementsJson` (migration 0143) holds an array
 * of `InspectionMeasurement`; `verificationMeasurementsJson` holds the same
 * shape recorded AFTER the approved work, which is what proves the repair.
 */
import { z } from "zod";

type InspectionCategory = "brakes" | "tires" | "engine" | "suspension" | "electrical" | "fluids" | "body" | "other";
export type Grade = "green" | "yellow" | "red";

/** Same vocabulary as tire registrations (shared/tireTin.ts). */
const TIRE_POSITIONS = ["LF", "RF", "LR", "RR", "LRI", "RRI", "SPARE"] as const;
/** Pads and rotors are usually measured per axle; per corner when it matters. */
const BRAKE_POSITIONS = ["front", "rear", "LF", "RF", "LR", "RR"] as const;
const FLUID_NAMES = ["engine oil", "coolant", "brake fluid", "transmission fluid", "power steering", "washer fluid"] as const;
const FLUID_CONDITIONS = ["good", "fair", "replace"] as const;

export type MeasurementMetric =
  | "tread_depth_32nds"
  | "tire_pressure_psi"
  | "brake_pad_mm"
  | "rotor_thickness_mm"
  | "battery_voltage"
  | "battery_cca"
  | "fluid_condition";

export interface InspectionMeasurement {
  metric: MeasurementMetric;
  /** A number for every metric except fluid_condition, which is one of FLUID_CONDITIONS. */
  value: number | string;
  /** Tire or brake position, or the fluid's name. Optional for battery metrics. */
  position?: string;
  /** Reference the grade needs: rotor minimum thickness in mm, or the battery's rated CCA. */
  spec?: number;
}

interface MeasurementSpec {
  metric: MeasurementMetric;
  label: string;
  unit: string;
  kind: "number" | "choice";
  min: number;
  max: number;
  step: number;
  positions?: readonly string[];
  choices?: readonly string[];
  /** Label for `spec` when the grade needs a reference value. */
  specLabel?: string;
  /** Categories whose capture form offers this metric. */
  categories: readonly InspectionCategory[];
}

export const MEASUREMENT_SPECS: Record<MeasurementMetric, MeasurementSpec> = {
  tread_depth_32nds: { metric: "tread_depth_32nds", label: "Tread depth", unit: "/32\"", kind: "number", min: 0, max: 20, step: 1, positions: TIRE_POSITIONS, categories: ["tires"] },
  tire_pressure_psi: { metric: "tire_pressure_psi", label: "Tire pressure", unit: "psi", kind: "number", min: 0, max: 120, step: 1, positions: TIRE_POSITIONS, categories: ["tires"] },
  brake_pad_mm: { metric: "brake_pad_mm", label: "Pad thickness", unit: "mm", kind: "number", min: 0, max: 20, step: 0.5, positions: BRAKE_POSITIONS, categories: ["brakes"] },
  rotor_thickness_mm: { metric: "rotor_thickness_mm", label: "Rotor thickness", unit: "mm", kind: "number", min: 0, max: 60, step: 0.1, positions: BRAKE_POSITIONS, specLabel: "Minimum spec (mm)", categories: ["brakes"] },
  battery_voltage: { metric: "battery_voltage", label: "Battery voltage", unit: "V", kind: "number", min: 0, max: 20, step: 0.1, categories: ["electrical", "engine"] },
  battery_cca: { metric: "battery_cca", label: "Battery CCA", unit: "CCA", kind: "number", min: 0, max: 2000, step: 10, specLabel: "Rated CCA", categories: ["electrical", "engine"] },
  fluid_condition: { metric: "fluid_condition", label: "Fluid condition", unit: "", kind: "choice", min: 0, max: 0, step: 0, positions: FLUID_NAMES, choices: FLUID_CONDITIONS, categories: ["fluids", "engine"] },
};

const MEASUREMENT_METRICS = Object.keys(MEASUREMENT_SPECS) as MeasurementMetric[];

export function metricsForCategory(category: string): MeasurementSpec[] {
  return MEASUREMENT_METRICS.map((m) => MEASUREMENT_SPECS[m]).filter((s) => (s.categories as readonly string[]).includes(category));
}

/**
 * Shop guidance bands. `null` means the metric cannot be graded on its own
 * (pressure depends on the door placard; rotor and CCA need their spec).
 *
 *   tread   >= 6/32 good · 3–5/32 monitor · <= 2/32 replace (2/32 is the common legal minimum)
 *   pads    >= 7 mm good · 4–6 mm monitor · <= 3 mm replace
 *   rotor   margin over minimum spec: > 1 mm good · 0–1 mm monitor · at or under spec replace
 *   voltage resting >= 12.4 V good · 12.0–12.39 V monitor · < 12.0 V replace or test under load
 *   CCA     >= 80% of rated good · 60–79% monitor · < 60% replace
 *   fluid   good / fair / replace map straight to green / yellow / red
 */
export function gradeMeasurement(m: InspectionMeasurement): Grade | null {
  switch (m.metric) {
    case "tread_depth_32nds": {
      const v = num(m.value);
      if (v === null) return null;
      return v >= 6 ? "green" : v >= 3 ? "yellow" : "red";
    }
    case "brake_pad_mm": {
      const v = num(m.value);
      if (v === null) return null;
      return v >= 7 ? "green" : v >= 4 ? "yellow" : "red";
    }
    case "rotor_thickness_mm": {
      const v = num(m.value);
      if (v === null || typeof m.spec !== "number") return null;
      const margin = v - m.spec;
      return margin > 1 ? "green" : margin > 0 ? "yellow" : "red";
    }
    case "battery_voltage": {
      const v = num(m.value);
      if (v === null) return null;
      return v >= 12.4 ? "green" : v >= 12.0 ? "yellow" : "red";
    }
    case "battery_cca": {
      const v = num(m.value);
      if (v === null || typeof m.spec !== "number" || m.spec <= 0) return null;
      const pct = v / m.spec;
      return pct >= 0.8 ? "green" : pct >= 0.6 ? "yellow" : "red";
    }
    case "fluid_condition":
      return m.value === "good" ? "green" : m.value === "fair" ? "yellow" : m.value === "replace" ? "red" : null;
    case "tire_pressure_psi":
      return null;
    default:
      return null;
  }
}

const GRADE_RANK: Record<Grade, number> = { green: 0, yellow: 1, red: 2 };

/** Worst grade among the gradable measurements, or null when none can be graded. */
export function suggestCondition(measurements: readonly InspectionMeasurement[]): Grade | null {
  let worst: Grade | null = null;
  for (const m of measurements) {
    const g = gradeMeasurement(m);
    if (g && (worst === null || GRADE_RANK[g] > GRADE_RANK[worst])) worst = g;
  }
  return worst;
}

/** "LF 4/32"" · "Pads front 3 mm" · "Rotor LF 22.1 mm (min 22)" · "Battery 12.1 V" · "Coolant: replace" */
export function formatMeasurement(m: InspectionMeasurement): string {
  const spec = MEASUREMENT_SPECS[m.metric];
  if (!spec) return String(m.value);
  const pos = m.position ? `${m.position} ` : "";
  switch (m.metric) {
    case "tread_depth_32nds":
      return `${pos}${m.value}/32"`;
    case "tire_pressure_psi":
      return `${pos}${m.value} psi`;
    case "brake_pad_mm":
      return `Pads ${pos}${m.value} mm`;
    case "rotor_thickness_mm":
      return `Rotor ${pos}${m.value} mm${typeof m.spec === "number" ? ` (min ${m.spec})` : ""}`;
    case "battery_voltage":
      return `Battery ${m.value} V`;
    case "battery_cca":
      return `Battery ${m.value} CCA${typeof m.spec === "number" ? ` of ${m.spec} rated` : ""}`;
    case "fluid_condition": {
      const name = m.position ? m.position.charAt(0).toUpperCase() + m.position.slice(1) : "Fluid";
      return `${name}: ${m.value}`;
    }
    default:
      return `${pos}${m.value} ${spec.unit}`.trim();
  }
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

const inspectionMeasurementSchema = z
  .object({
    metric: z.enum(MEASUREMENT_METRICS as [MeasurementMetric, ...MeasurementMetric[]]),
    value: z.union([z.number(), z.string().max(40)]),
    position: z.string().max(40).optional(),
    spec: z.number().finite().optional(),
  })
  .superRefine((m, ctx) => {
    const spec = MEASUREMENT_SPECS[m.metric];
    if (spec.kind === "number") {
      if (typeof m.value !== "number" || !Number.isFinite(m.value)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: `${spec.label} must be a number in ${spec.unit}` });
      } else if (m.value < spec.min || m.value > spec.max) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: `${spec.label} must be between ${spec.min} and ${spec.max} ${spec.unit}` });
      }
    } else if (!spec.choices || !spec.choices.includes(String(m.value))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: `${spec.label} must be one of ${spec.choices?.join(", ")}` });
    }
  });

export const MAX_ITEM_MEASUREMENTS = 24;
export const MAX_ITEM_PHOTOS = 8;

export const inspectionMeasurementsSchema = z.array(inspectionMeasurementSchema).max(MAX_ITEM_MEASUREMENTS);
export const photoUrlListSchema = z.array(z.string().url().max(1000)).max(MAX_ITEM_PHOTOS);

/**
 * Tolerant read of a JSON column. A row written by a client that predates
 * this module, or a hand edit, must render as "no measurements", never as a
 * crash on the customer's page. Entries that fail the schema are dropped.
 */
export function normalizeMeasurements(raw: unknown): InspectionMeasurement[] {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const out: InspectionMeasurement[] = [];
  for (const entry of parsed) {
    const r = inspectionMeasurementSchema.safeParse(entry);
    if (r.success) out.push(r.data);
  }
  return out;
}

/** All photos for an item: the JSON list when present, else the legacy single URL. */
export function normalizePhotoUrls(primary: string | null | undefined, listRaw: unknown): string[] {
  let parsed: unknown = listRaw;
  if (typeof listRaw === "string") {
    try {
      parsed = JSON.parse(listRaw);
    } catch {
      parsed = null;
    }
  }
  const list = Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === "string" && u.length > 0 && u.length <= 1000) : [];
  if (list.length > 0) return list.slice(0, MAX_ITEM_PHOTOS);
  return primary ? [primary] : [];
}
