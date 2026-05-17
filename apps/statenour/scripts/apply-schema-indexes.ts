/**
 * Apply Schema Indexes · v10.0.380
 *
 * One-shot transform script · reads prisma/schema.prisma, applies the
 * @@index([...]) declarations recommended by scripts/schema-index-audit.ts,
 * writes the updated schema back.
 *
 * Skips indexes that already exist (idempotent) · safe to re-run.
 *
 * After running:
 *   pnpm prisma format        · verify no syntax errors
 *   pnpm prisma generate      · regenerate the Prisma Client
 *   pnpm prisma db push       · apply to dev DB · or commit and let
 *                                CI/Vercel run migrate deploy
 *
 * Run: pnpm tsx scripts/apply-schema-indexes.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";

const SCHEMA_PATH = path.resolve(__dirname, "..", "prisma", "schema.prisma");

interface ModelDef {
  name: string;
  startLine: number;
  endLine: number;
  bodyLines: string[]; // includes opening { on its own line OR end with brace
  fields: FieldDef[];
  existingIndexes: string[][]; // each = list of column names
}

interface FieldDef {
  name: string;
  type: string;
  isRelation: boolean;
  relationFields: string[];
}

function parseSchema(content: string): { lines: string[]; models: ModelDef[] } {
  const lines = content.split("\n");
  const models: ModelDef[] = [];

  let inModel = false;
  let currentModel: ModelDef | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!inModel) {
      const startMatch = line.match(/^model\s+(\w+)\s*\{/);
      if (startMatch) {
        inModel = true;
        currentModel = {
          name: startMatch[1],
          startLine: i,
          endLine: -1,
          bodyLines: [line],
          fields: [],
          existingIndexes: [],
        };
      }
      continue;
    }

    currentModel!.bodyLines.push(line);

    if (trimmed === "}") {
      currentModel!.endLine = i;
      models.push(currentModel!);
      inModel = false;
      currentModel = null;
      continue;
    }

    if (!trimmed || trimmed.startsWith("//")) continue;

    // @@index([a, b]) or @@unique([a, b])
    const idxMatch = trimmed.match(/@@(?:index|unique)\(\s*\[([^\]]+)\]/);
    if (idxMatch) {
      const cols = idxMatch[1]
        .split(",")
        .map((s) => s.trim().replace(/\(.*\)$/, ""));
      currentModel!.existingIndexes.push(cols);
      continue;
    }

    // Field line
    const fieldMatch = trimmed.match(/^(\w+)\s+(\w+)(\??\[?\]?)\s*(.*)$/);
    if (!fieldMatch) continue;
    const [, fname, ftype, , modifiers] = fieldMatch;
    const isRelation = /@relation/.test(modifiers);
    const fkMatch = modifiers.match(/fields:\s*\[([^\]]+)\]/);
    const relationFields = fkMatch
      ? fkMatch[1].split(",").map((s) => s.trim())
      : [];
    currentModel!.fields.push({
      name: fname,
      type: ftype,
      isRelation,
      relationFields,
    });
  }

  return { lines, models };
}

function isCovered(model: ModelDef, cols: string[]): boolean {
  // Index covers cols if any existing index has the same leading prefix.
  return model.existingIndexes.some((idx) => {
    if (idx.length < cols.length) return false;
    return cols.every((c, i) => idx[i] === c);
  });
}

function determineNeededIndexes(model: ModelDef): string[][] {
  const needed: string[][] = [];

  // 1. FK indexes
  for (const f of model.fields) {
    if (f.isRelation && f.relationFields.length > 0) {
      for (const fk of f.relationFields) {
        if (!isCovered(model, [fk])) {
          needed.push([fk]);
        }
      }
    }
  }

  // 2. createdAt
  const hasCreatedAt = model.fields.some(
    (f) => f.name === "createdAt" && f.type === "DateTime",
  );
  if (hasCreatedAt && !isCovered(model, ["createdAt"])) {
    needed.push(["createdAt"]);
  }

  // 3. updatedAt
  const hasUpdatedAt = model.fields.some(
    (f) => f.name === "updatedAt" && f.type === "DateTime",
  );
  if (hasUpdatedAt && !isCovered(model, ["updatedAt"])) {
    needed.push(["updatedAt"]);
  }

  // 4. lastSeen / lastActiveAt
  for (const colName of ["lastSeen", "lastActiveAt"]) {
    const has = model.fields.some(
      (f) => f.name === colName && f.type === "DateTime",
    );
    if (has && !isCovered(model, [colName])) {
      needed.push([colName]);
    }
  }

  // 5. deletedAt (soft-delete)
  const hasDeletedAt = model.fields.some(
    (f) => f.name === "deletedAt" && f.type === "DateTime",
  );
  if (hasDeletedAt && !isCovered(model, ["deletedAt"])) {
    needed.push(["deletedAt"]);
  }

  // 6. status / state
  const statusField = model.fields.find(
    (f) => (f.name === "status" || f.name === "state") && !f.isRelation,
  );
  if (statusField && !isCovered(model, [statusField.name])) {
    needed.push([statusField.name]);
  }

  return needed;
}

async function main() {
  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  APPLY SCHEMA INDEXES · v10.0.380");
  console.log("═══════════════════════════════════════════════════════════");

  const content = fs.readFileSync(SCHEMA_PATH, "utf8");
  const { lines, models } = parseSchema(content);
  console.log(`  Parsed ${models.length} models`);

  let totalAdded = 0;
  const additions: Array<{ model: string; line: number; idx: string[] }> = [];

  for (const model of models) {
    const needed = determineNeededIndexes(model);
    if (needed.length === 0) continue;
    for (const cols of needed) {
      additions.push({ model: model.name, line: model.endLine, idx: cols });
      totalAdded++;
    }
  }

  console.log(`  Indexes to add: ${totalAdded}`);

  if (totalAdded === 0) {
    console.log("  ✅ Nothing to do.");
    return;
  }

  // Build a map · line index → list of @@index lines to insert BEFORE that line
  const insertions = new Map<number, string[]>();
  for (const a of additions) {
    const line = `  @@index([${a.idx.join(", ")}])`;
    if (!insertions.has(a.line)) insertions.set(a.line, []);
    insertions.get(a.line)!.push(line);
  }

  // Apply insertions in reverse order (so line numbers don't shift)
  const sortedLines = Array.from(insertions.keys()).sort((a, b) => b - a);
  for (const lineIdx of sortedLines) {
    const inserts = insertions.get(lineIdx)!;
    lines.splice(lineIdx, 0, ...inserts);
  }

  // Write back
  fs.writeFileSync(SCHEMA_PATH, lines.join("\n"), "utf8");
  console.log("");
  console.log(`  ✅ Inserted ${totalAdded} @@index declarations into schema.prisma`);
  console.log("");
  console.log("  Next steps:");
  console.log("    pnpm prisma format");
  console.log("    pnpm prisma generate");
  console.log("    pnpm prisma db push   # apply to dev DB");
  console.log("    git diff prisma/schema.prisma  # review");
  console.log("");
}

main().catch((err) => {
  console.error("❌ Apply failed:", err);
  process.exit(1);
});
