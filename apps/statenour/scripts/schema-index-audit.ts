/**
 * Schema Index Audit · v10.0.376
 *
 * Per /postgres-best-practices skill · static analysis over
 * `prisma/schema.prisma` to surface missing indexes that commonly
 * cause production slowdowns:
 *
 *   1. UNINDEXED FOREIGN KEYS · Postgres does NOT auto-index FK columns.
 *      A relation defined as `mission Mission @relation(fields: [missionId], ...)`
 *      should have `@@index([missionId])` or the FK lookup is a seq scan.
 *
 *   2. UNINDEXED createdAt / updatedAt / DateTime ORDER columns · most
 *      pages query `orderBy: { createdAt: 'desc' }` but the column has
 *      no index. Each page load does a sort over the whole table.
 *
 *   3. SOFT-DELETE COLUMNS WITHOUT INDEX · we filter `deletedAt: null`
 *      on every recall · without an index this becomes a seq scan that
 *      worsens as the table grows.
 *
 *   4. STATUS COLUMNS USED IN FILTER WITHOUT INDEX · enum/string status
 *      fields commonly filter most reads · need a compound index with
 *      the status as the first column.
 *
 * NOT covered (run separately via EXPLAIN ANALYZE on slow endpoints):
 *   · Unused indexes (write-cost waste)
 *   · Bloat detection (need pg_stat_user_indexes data)
 *   · Sequence-scan vs index-scan ratio
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface ModelDef {
  name: string;
  raw: string;
  fields: FieldDef[];
  indexes: string[][]; // each inner array = list of column names in that index
  hasUniqueOnDeletedAt: boolean;
}

interface FieldDef {
  name: string;
  type: string;
  isOptional: boolean;
  isList: boolean;
  isRelation: boolean;
  relationFields: string[]; // FK columns when this field has @relation(fields: [...])
  modifiers: string;
  raw: string;
}

interface IndexFinding {
  severity: "high" | "medium" | "low";
  model: string;
  field: string;
  reason: string;
  recommendation: string;
}

const ROOT = path.resolve(__dirname, "..");
const SCHEMA_PATH = path.join(ROOT, "prisma", "schema.prisma");

function parseSchema(content: string): ModelDef[] {
  const models: ModelDef[] = [];
  // Match each model X { ... } block
  const modelRe = /model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = modelRe.exec(content)) !== null) {
    const name = m[1];
    const body = m[2];
    const fields: FieldDef[] = [];
    const indexes: string[][] = [];

    const lines = body.split("\n");
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("//")) continue;

      // @@index([a, b, c]) or @@unique([a])
      const idxMatch = line.match(/@@(?:index|unique)\(\s*\[([^\]]+)\]/);
      if (idxMatch) {
        const cols = idxMatch[1]
          .split(",")
          .map((s) => s.trim().replace(/\(.*\)$/, "")); // strip (sort) modifiers
        indexes.push(cols);
        continue;
      }

      // Field line · `name Type modifiers`
      const fieldMatch = line.match(/^(\w+)\s+(\w+)(\??\[?\]?)\s*(.*)$/);
      if (!fieldMatch) continue;
      const [, fname, ftype, optList, modifiers] = fieldMatch;
      const isOptional = optList.includes("?");
      const isList = optList.includes("[]");
      const isRelation = /@relation/.test(modifiers);
      const fkMatch = modifiers.match(/fields:\s*\[([^\]]+)\]/);
      const relationFields = fkMatch
        ? fkMatch[1].split(",").map((s) => s.trim())
        : [];
      fields.push({
        name: fname,
        type: ftype,
        isOptional,
        isList,
        isRelation,
        relationFields,
        modifiers,
        raw: line,
      });
    }

    models.push({
      name,
      raw: m[0],
      fields,
      indexes,
      hasUniqueOnDeletedAt: false,
    });
  }
  return models;
}

function isIndexed(model: ModelDef, column: string): boolean {
  // Index covers this column if any index has it as the FIRST column
  // (Postgres can use a multi-column index for queries on the leading
  // column; queries on later columns alone don't benefit).
  return model.indexes.some((idx) => idx[0] === column);
}

function isCoveredByIndex(model: ModelDef, column: string): boolean {
  // Less strict · covered if mentioned in any index, even non-leading
  return model.indexes.some((idx) => idx.includes(column));
}

const findings: IndexFinding[] = [];

function audit(models: ModelDef[]): void {
  for (const model of models) {
    // ── 1. Unindexed foreign keys ──
    for (const field of model.fields) {
      if (field.isRelation && field.relationFields.length > 0) {
        for (const fkCol of field.relationFields) {
          if (!isIndexed(model, fkCol)) {
            findings.push({
              severity: "high",
              model: model.name,
              field: fkCol,
              reason: `FK column ${fkCol} (relation: ${field.name}) has no leading index`,
              recommendation: `Add @@index([${fkCol}]) to ${model.name} · Postgres does NOT auto-index FKs`,
            });
          }
        }
      }
    }

    // ── 2. createdAt / DateTime order columns ──
    for (const field of model.fields) {
      if (field.type === "DateTime" && (field.name === "createdAt" || field.name === "updatedAt" || field.name === "lastSeen" || field.name === "lastActiveAt")) {
        if (!isCoveredByIndex(model, field.name)) {
          findings.push({
            severity: field.name === "createdAt" ? "high" : "medium",
            model: model.name,
            field: field.name,
            reason: `${field.name} likely used for orderBy · no index`,
            recommendation: `Add @@index([${field.name}]) to ${model.name} · or compound with a filter column for sharper queries`,
          });
        }
      }
    }

    // ── 3. Soft-delete deletedAt without index ──
    const deletedAtField = model.fields.find((f) => f.name === "deletedAt");
    if (deletedAtField && !isCoveredByIndex(model, "deletedAt")) {
      findings.push({
        severity: "medium",
        model: model.name,
        field: "deletedAt",
        reason: "deletedAt soft-delete column · filtered on every recall · no index",
        recommendation: `Add a partial index: @@index([deletedAt(sort: Asc)], where: \"deletedAt IS NULL\") OR add it as a leading col in compound filters`,
      });
    }

    // ── 4. Common status columns ──
    const statusField = model.fields.find(
      (f) => (f.name === "status" || f.name === "state") && !f.isRelation,
    );
    if (statusField && !isCoveredByIndex(model, statusField.name)) {
      findings.push({
        severity: "medium",
        model: model.name,
        field: statusField.name,
        reason: `${statusField.name} column · likely filtered frequently · no index`,
        recommendation: `Add @@index([${statusField.name}]) or compound with createdAt`,
      });
    }
  }
}

async function main() {
  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  SCHEMA INDEX AUDIT · v10.0.376");
  console.log("═══════════════════════════════════════════════════════════");

  if (!fs.existsSync(SCHEMA_PATH)) {
    console.error(`❌ schema.prisma not found at ${SCHEMA_PATH}`);
    process.exit(1);
  }

  const content = fs.readFileSync(SCHEMA_PATH, "utf8");
  const models = parseSchema(content);
  console.log(`  Parsed ${models.length} models`);
  audit(models);
  console.log("");

  const bySev: Record<IndexFinding["severity"], IndexFinding[]> = {
    high: [],
    medium: [],
    low: [],
  };
  for (const f of findings) bySev[f.severity].push(f);

  for (const sev of ["high", "medium", "low"] as const) {
    const list = bySev[sev];
    if (list.length === 0) continue;
    console.log(`  ── ${sev.toUpperCase()} (${list.length}) ──`);
    // Group by model for readability
    const byModel: Record<string, IndexFinding[]> = {};
    for (const f of list) {
      (byModel[f.model] ??= []).push(f);
    }
    for (const [modelName, modelFindings] of Object.entries(byModel)) {
      console.log(`    ${modelName}`);
      for (const f of modelFindings) {
        console.log(`      · ${f.field} · ${f.reason}`);
      }
    }
    console.log("");
  }

  if (findings.length === 0) {
    console.log("  ✅ No index gaps detected.");
  } else {
    console.log(`  Total · ${findings.length} index gaps`);
    console.log("");
    console.log("  Next: prioritize HIGH gaps · those are FKs and createdAt cols");
    console.log("  on tables that production reads frequently. Each missing");
    console.log("  index = a sequential scan getting slower as data grows.");
  }
  console.log("");
}

main().catch((err) => {
  console.error("❌ Schema audit failed:", err);
  process.exit(1);
});
