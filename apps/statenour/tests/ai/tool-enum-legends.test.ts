/**
 * A CODE ENUM WITH NO LEGEND IS A SCHEMA THE MODEL CANNOT SATISFY.
 *
 * WHAT HAPPENED. Prod `tool_telemetry` recorded `createTask` failing because the
 * model answered `{"effort":"30 min"}` and `{"context":"Newsletter creation"}` —
 * free text, because "M30" and "DESK" are unguessable and neither field carried
 * a `.describe()`. `context` in particular reads as "contextual information
 * about this task" unless something says otherwise; three separate stored
 * failures put a task description or a whole journal reflection in it.
 *
 * That was fixed on 2026-09-03 — on ONE of the three call sites. `missions.ts`
 * kept two byte-identical bare copies, so `createMissionPlan` stayed broken at
 * 4 calls / 1 success (25%), its stored failure reading `{"context":"Shop
 * Operat…` — the identical shape, two months later.
 *
 * WHY A SWEEP AND NOT THREE EDITS. Same class as the SMS opt-out fix that
 * missed the outbound voice lanes: a fix applied per-SITE rather than
 * per-SHAPE leaves siblings behind, and the only thing that found the sibling
 * was sweeping after shipping. So this enumerates every AI-facing tool schema
 * mechanically. A fourth copy cannot be added quietly.
 *
 * SCOPE. Model-facing schemas only. The DB-facing validators in
 * lib/validators/tasks.ts are deliberately strict and undescribed — the model
 * is the unreliable producer, not the API.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { nourTools } from "@/lib/ai/tools";

type AnySchema = z.ZodTypeAny;

/** One leaf enum found somewhere inside a tool's input schema. */
interface EnumField {
  tool: string;
  path: string;
  values: string[];
  description: string | undefined;
}

/**
 * Walk a zod schema collecting every enum leaf with its description.
 *
 * `.describe()` applied after `.default()` lands on the OUTER wrapper, so the
 * description is collected on the way down and inherited — checking only the
 * inner ZodEnum would report a described field as undescribed.
 */
function collectEnums(
  schema: AnySchema,
  tool: string,
  path: string,
  inherited: string | undefined,
  out: EnumField[],
  depth = 0,
): void {
  if (!schema || depth > 12) return;
  const def = (schema as unknown as { _def?: Record<string, unknown> })._def;
  if (!def) return;
  const kind = (def.type ?? def.typeName) as string | undefined;
  const description =
    (schema as unknown as { description?: string }).description ?? inherited;

  switch (kind) {
    case "enum": {
      const values = ((schema as unknown as { options?: unknown[] }).options ?? []).map(String);
      out.push({ tool, path, values, description });
      return;
    }
    case "default":
    case "optional":
    case "nullable":
    case "readonly":
    case "catch": {
      collectEnums(def.innerType as AnySchema, tool, path, description, out, depth + 1);
      return;
    }
    case "array": {
      const el = (def.element ?? (schema as unknown as { element?: AnySchema }).element) as AnySchema;
      collectEnums(el, tool, `${path}[]`, undefined, out, depth + 1);
      return;
    }
    case "object": {
      const shape = (schema as unknown as { shape?: Record<string, AnySchema> }).shape ?? {};
      for (const [key, child] of Object.entries(shape)) {
        collectEnums(child, tool, path ? `${path}.${key}` : key, undefined, out, depth + 1);
      }
      return;
    }
    default:
      return;
  }
}

function allEnumFields(): EnumField[] {
  const out: EnumField[] = [];
  for (const [name, t] of Object.entries(nourTools as Record<string, unknown>)) {
    const schema = (t as { inputSchema?: AnySchema })?.inputSchema;
    if (schema) collectEnums(schema, name, "", undefined, out);
  }
  return out;
}

/**
 * An opaque CODE vocabulary: at least one value that is not a word a reader can
 * decode unaided. `M5` / `H2PLUS` are codes; `DAILY` / `BUSINESS` are English.
 * Shape-based rather than a hardcoded list, so a cryptic enum added next month
 * is covered without anyone remembering to add it here.
 *
 * ⚠ KNOWN BLIND SPOT, measured by mutating this file's own subject: this rule
 * does NOT catch `context`, which is production's WORST offender (3 of 5 stored
 * failures). Its values — DESK · PHONE · SHOP · CAR · HOME · ANYWHERE — are
 * ordinary English, so nothing about their SHAPE looks cryptic. The defect was
 * never the vocabulary; it was that the field NAME "context" reads as
 * "contextual information" and misdirects the model before it ever looks at the
 * options. A name cannot be checked mechanically, so the two rules are not
 * redundant and neither is sufficient alone:
 *   · MEASURED_FAILURE_FIELDS catches the known-bad names (incl. `context`)
 *   · isOpaqueCodeEnum extends cover to vocabularies nobody has broken YET
 * Deleting either one silently halves this file.
 */
function isOpaqueCodeEnum(values: string[]): boolean {
  return values.some((v) => /^[A-Z]+\d/.test(v));
}

/** The fields with MEASURED production failures — covered by name as well. */
const MEASURED_FAILURE_FIELDS = ["effort", "context", "loopKind"];

describe("AI-facing tool enums carry a legend", () => {
  it("POSITIVE CONTROL: the walker actually finds enums, nested ones included", () => {
    // Without this, a walker that silently returned [] would make every
    // assertion below pass while checking nothing. `createMissionPlan` nests
    // its enums two levels deep (object → array → object), which is exactly
    // the shape a naive one-level walk would miss.
    const fields = allEnumFields();
    expect(fields.length).toBeGreaterThan(20);
    const nested = fields.filter((f) => f.tool === "createMissionPlan" && f.path.includes("[]"));
    expect(
      nested.map((f) => f.path),
      "the walker must descend into tasks[] — a one-level walk would report nothing here",
    ).toEqual(expect.arrayContaining(["tasks[].effort", "tasks[].context", "tasks[].loopKind"]));
  });

  it("every OPAQUE CODE enum is described", () => {
    const undocumented = allEnumFields()
      .filter((f) => isOpaqueCodeEnum(f.values))
      .filter((f) => !f.description || f.description.trim().length === 0)
      .map((f) => `${f.tool}.${f.path} [${f.values.join("|")}]`);

    expect(
      undocumented,
      "a code enum with no legend is a schema the model cannot satisfy — add .describe() with the decoded values",
    ).toEqual([]);
  });

  it("every field with a MEASURED production failure is described", () => {
    const undocumented = allEnumFields()
      .filter((f) => MEASURED_FAILURE_FIELDS.includes(f.path.split(".").pop() ?? ""))
      .filter((f) => !f.description || f.description.trim().length === 0)
      .map((f) => `${f.tool}.${f.path}`);

    expect(
      undocumented,
      "these exact fields have stored prod failures from being sent free text",
    ).toEqual([]);
  });

  it("the legend NAMES the values, rather than just labelling the field", () => {
    // "Effort estimate" is a description and would satisfy a presence check
    // while leaving the model exactly as unable to guess M30. The legend has
    // to carry the vocabulary.
    const thin = allEnumFields()
      .filter((f) => isOpaqueCodeEnum(f.values) && f.description)
      .filter((f) => {
        const d = f.description as string;
        return !f.values.every((v) => d.includes(v));
      })
      .map((f) => `${f.tool}.${f.path}: "${f.description}"`);

    expect(thin, "the description must list every allowed value").toEqual([]);
  });

  it("the three task-shaped tools agree on the SAME legend for a shared field", () => {
    // They drifted once already: createTask was fixed 2026-09-03 and the two
    // missions.ts copies were not. Divergent wording is the early symptom.
    const byField = new Map<string, Set<string>>();
    for (const f of allEnumFields()) {
      const leaf = f.path.split(".").pop() ?? "";
      if (!MEASURED_FAILURE_FIELDS.includes(leaf)) continue;
      if (!f.description) continue;
      // loopKind legitimately differs: missions.ts allows WEEKLY, tasks.ts
      // does not, so compare only within an identical value vocabulary.
      const key = `${leaf}:${[...f.values].sort().join("|")}`;
      if (!byField.has(key)) byField.set(key, new Set());
      byField.get(key)!.add(f.description);
    }
    const drifted = [...byField.entries()]
      .filter(([, descs]) => descs.size > 1)
      .map(([key, descs]) => `${key} has ${descs.size} different legends`);

    expect(drifted, "same field, same allowed values, different legend — a copy is drifting").toEqual([]);
  });
});
