/**
 * scripts/audit-raw-sql-columns.ts
 *
 * Static scan for Prisma raw SQL (`prisma.$queryRaw` / `$queryRawUnsafe`)
 * that references camelCase columns on tables WITHOUT a corresponding
 * Prisma `@map` directive. Postgres lowercases unquoted identifiers so `created_at`
 * in raw SQL against a table whose real column is `createdAt` fails
 * with `42703: column "created_at" does not exist`.
 *
 * Workflow:
 *   1. Parse prisma/schema.prisma → for every table (snake_case name
 *      from @@map), build a set of "camelCase-kept" columns (fields
 *      with no @map directive).
 *   2. Walk every .ts under app/ and lib/ that mentions $queryRaw.
 *      Extract the SQL strings, find `FROM <table>` references, and
 *      flag any unquoted `<camelCase-col>` appearance.
 *   3. The inverse shape (audit 2026-10-10, 06-F15): a QUOTED field name
 *      ("feedbackScore") whose column is @map'ed to another name
 *      (feedback_score) also fails with 42703 — and a `.catch(() => [])`
 *      around it renders "no data" forever. Flag those too.
 *   4. Report findings. Exit 1 if any found → blocks CI.
 *
 * Run: `pnpm tsx scripts/audit-raw-sql-columns.ts`
 */

import fs from "node:fs";
import path from "node:path";

interface ModelInfo {
  modelName: string;
  tableName: string; // from @@map or fallback to modelName
  camelCaseColumns: Set<string>; // fields WITHOUT @map, in camelCase
  mappedColumns: Set<string>; // fields whose @map names a DIFFERENT column
}

export function parseSchema(schemaPath: string): Map<string, ModelInfo> {
  const raw = fs.readFileSync(schemaPath, "utf8");
  const out = new Map<string, ModelInfo>();
  const modelRegex = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let match: RegExpExecArray | null;
  while ((match = modelRegex.exec(raw)) !== null) {
    const [, modelName, body] = match;
    const mapMatch = body.match(/@@map\("([^"]+)"\)/);
    const tableName = mapMatch?.[1] ?? modelName;
    const camelCase = new Set<string>();
    const mapped = new Set<string>();
    for (const line of body.split("\n")) {
      // Skip @@ directives, comments, and empty lines.
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) continue;
      // Field lines look like: "fieldName Type ..."
      const fieldMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9]*)\s+\w/);
      if (!fieldMatch) continue;
      const fieldName = fieldMatch[1];
      const mapTo = trimmed.match(/@map\("([^"]+)"\)/)?.[1];
      const hasMap = mapTo !== undefined;
      if (mapTo && mapTo !== fieldName) mapped.add(fieldName);
      // A field is "camelCase-kept" when the name has uppercase letters
      // AND no @map directive redirects it to snake_case.
      if (!hasMap && /[A-Z]/.test(fieldName)) {
        camelCase.add(fieldName);
      }
    }
    if (camelCase.size > 0 || mapped.size > 0) {
      out.set(tableName, { modelName, tableName, camelCaseColumns: camelCase, mappedColumns: mapped });
    }
  }
  return out;
}

interface Finding {
  file: string;
  line: number;
  table: string;
  column: string;
  context: string;
}

export function scanFile(
  filePath: string,
  models: Map<string, ModelInfo>,
): Finding[] {
  const content = fs.readFileSync(filePath, "utf8");
  if (!/\$queryRaw/.test(content)) return [];

  const findings: Finding[] = [];
  const lines = content.split("\n");

  // Locate each $queryRaw block and extract the SQL body between the
  // template backticks. Not a full parser — relies on the common
  // `prisma.$queryRaw\`...\`` shape.
  const qrRegex = /\$queryRaw[^`]*`([\s\S]*?)`/g;
  let match: RegExpExecArray | null;
  while ((match = qrRegex.exec(content)) !== null) {
    const sql = match[1];
    const sqlStart = match.index;
    // Find tables referenced via FROM / JOIN / UPDATE / INSERT INTO.
    const tableRegex = /\b(?:FROM|JOIN|UPDATE|INTO)\s+"?([a-z_]+)"?/gi;
    const tablesInSql = new Set<string>();
    let tMatch: RegExpExecArray | null;
    while ((tMatch = tableRegex.exec(sql)) !== null) {
      tablesInSql.add(tMatch[1]);
    }
    for (const table of tablesInSql) {
      const info = models.get(table);
      if (!info) continue;
      for (const col of info.camelCaseColumns) {
        // Flag ONLY when the camelCase column appears UNQUOTED in the
        // SQL (the fix is to wrap it in double quotes).
        // Regex: the column name preceded by whitespace / comma / `(`
        // and NOT preceded by `"` and NOT followed by `"`.
        const colRegex = new RegExp(
          `(^|[\\s,(=<>!])${col}(?![\\"\\w])`,
          "g",
        );
        if (colRegex.test(sql)) {
          // Figure out what source line this SQL block started on.
          const before = content.slice(0, sqlStart);
          const lineNum = before.split("\n").length;
          findings.push({
            file: filePath,
            line: lineNum,
            table,
            column: col,
            context: sql.trim().split("\n").slice(0, 3).join(" ").slice(0, 160),
          });
        }
      }
      for (const col of info.mappedColumns) {
        // A quoted field name is case-preserved by Postgres, so it must be
        // the real column; for an @map'ed field it never is. An output alias
        // (`pinned_summary AS "pinnedSummary"`) is fine.
        if (new RegExp(`(?<!\\bAS\\s+)"${col}"`, "i").test(sql)) {
          const lineNum = content.slice(0, sqlStart).split("\n").length;
          findings.push({
            file: filePath,
            line: lineNum,
            table,
            column: col,
            context: sql.trim().split("\n").slice(0, 3).join(" ").slice(0, 160),
          });
        }
      }
    }
  }
  return findings;
}

export function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

async function main() {
  const root = process.cwd();
  const schemaPath = path.join(root, "prisma", "schema.prisma");
  if (!fs.existsSync(schemaPath)) {
    console.error(`schema not found at ${schemaPath}`);
    process.exit(1);
  }

  const models = parseSchema(schemaPath);
  const camelTables = [...models.keys()].sort();
  console.log(
    `🔍 raw-sql column audit · ${camelTables.length} tables with camelCase-kept columns detected in schema`,
  );
  for (const [table, info] of models) {
    console.log(
      `   ${table}: ${[...info.camelCaseColumns].sort().join(", ")}`,
    );
  }

  const targets = [
    ...walk(path.join(root, "app")),
    ...walk(path.join(root, "lib")),
  ];

  let findings: Finding[] = [];
  for (const file of targets) {
    findings = findings.concat(scanFile(file, models));
  }

  if (findings.length === 0) {
    console.log("\n✅ No unsafe raw-SQL column references found.");
    return;
  }

  console.error(
    `\n❌ ${findings.length} potential unsafe raw-SQL column reference(s):\n`,
  );
  for (const f of findings) {
    const rel = path.relative(root, f.file).replace(/\\/g, "/");
    console.error(
      `  ${rel}:${f.line}  → column "${f.column}" on table "${f.table}"`,
    );
    console.error(`    ${f.context}`);
  }
  console.error(
    `\n💡 Fix: wrap the identifier in double quotes, e.g. WHERE "createdAt" >= \$1`,
  );
  process.exit(1);
}

// Run only as a script (`tsx scripts/audit-raw-sql-columns.ts`), not on import from a test.
if (/audit-raw-sql-columns\.[cm]?[jt]s$/.test(process.argv[1] ?? "")) {
  main().catch((err) => {
    console.error("audit failed:", err);
    process.exit(1);
  });
}
