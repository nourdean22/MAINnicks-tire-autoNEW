#!/usr/bin/env tsx
/**
 * scripts/schema-timestamp-audit.ts · v10.0.451
 *
 * Audits prisma/schema.prisma for timestamp coverage across models.
 *
 * Categorizes each model into one of:
 *   ✓ both       · has createdAt + updatedAt (gold standard for mutable records)
 *   ⚠ created    · has createdAt only · likely event-shaped, but verify
 *   ⚠ updated    · has updatedAt only · suspicious (creation time lost)
 *   ℹ domain     · has a domain-specific *At field (pingedAt, firedAt) but
 *                  no canonical createdAt/updatedAt · event-shaped, OK
 *   ✗ none       · no DateTime field at all · investigate
 *
 * Usage:
 *   pnpm tsx scripts/schema-timestamp-audit.ts            # human report
 *   pnpm tsx scripts/schema-timestamp-audit.ts --json     # JSON for CI
 *
 * Skill provenance: postgres-best-practices + database-migration +
 * production-code-audit (top-50 always-on floor).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

interface ModelAudit {
  name: string;
  category: "both" | "created" | "updated" | "domain" | "none";
  /** All DateTime fields on the model. */
  dateTimeFields: string[];
  /** Field that semantically captures the creation moment (literal
   *  `createdAt` OR a DateTime with `@default(now())` like
   *  `generatedAt`, `firedAt`, `pingedAt`). */
  creationTimestamp: string | null;
  /** Field that semantically captures the update moment (literal
   *  `updatedAt` OR a DateTime with `@updatedAt` directive). */
  updateTimestamp: string | null;
}

function audit(schemaPath: string): ModelAudit[] {
  const schema = readFileSync(schemaPath, "utf8");
  const blocks = schema.split(/\nmodel\s+(\w+)\s*\{/).slice(1);
  const out: ModelAudit[] = [];

  for (let i = 0; i < blocks.length; i += 2) {
    const name = blocks[i];
    const body = blocks[i + 1];
    if (!body) continue;

    // Capture the body up to the matching closing brace.
    let depth = 1;
    let end = 0;
    for (let j = 0; j < body.length; j++) {
      if (body[j] === "{") depth++;
      else if (body[j] === "}") {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    const modelBody = body.slice(0, end);

    // Capture each DateTime field along with its full declaration line
    // (so we can detect `@default(now())` and `@updatedAt` directives).
    const fieldDecls = [
      ...modelBody.matchAll(/^\s*(\w+)\s+DateTime\b[^\n]*$/gm),
    ];
    const dateTimeFields = fieldDecls.map((m) => m[1]);

    let creationTimestamp: string | null = null;
    let updateTimestamp: string | null = null;

    for (const m of fieldDecls) {
      const fieldName = m[1];
      const fullDecl = m[0];
      // Creation: literal `createdAt` OR any DateTime with @default(now())
      if (fieldName === "createdAt" || /@default\(now\(\)\)/.test(fullDecl)) {
        if (!creationTimestamp) creationTimestamp = fieldName;
      }
      // Update: literal `updatedAt` OR any DateTime with @updatedAt
      if (fieldName === "updatedAt" || /@updatedAt\b/.test(fullDecl)) {
        if (!updateTimestamp) updateTimestamp = fieldName;
      }
    }

    let category: ModelAudit["category"];
    if (creationTimestamp && updateTimestamp) category = "both";
    else if (creationTimestamp) category = "created";
    else if (updateTimestamp) category = "updated";
    else if (dateTimeFields.length > 0) category = "domain";
    else category = "none";

    out.push({
      name,
      category,
      dateTimeFields,
      creationTimestamp,
      updateTimestamp,
    });
  }

  return out;
}

function summarize(results: ModelAudit[]) {
  const groups: Record<ModelAudit["category"], ModelAudit[]> = {
    both: [],
    created: [],
    updated: [],
    domain: [],
    none: [],
  };
  for (const r of results) groups[r.category].push(r);
  return groups;
}

function main() {
  const json = process.argv.includes("--json");
  const repoRoot = join(__dirname, "..");
  const schemaPath = join(repoRoot, "prisma", "schema.prisma");
  const results = audit(schemaPath);
  const groups = summarize(results);

  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          totalModels: results.length,
          counts: Object.fromEntries(
            Object.entries(groups).map(([k, v]) => [k, v.length]),
          ),
          groups,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`Schema timestamp audit · ${results.length} models scanned\n`);
  console.log(`✓ Both createdAt + updatedAt (gold standard) · ${groups.both.length}`);
  console.log(`⚠ Only createdAt (verify event-shape vs mutable) · ${groups.created.length}`);
  for (const m of groups.created) console.log(`  · ${m.name}`);
  console.log(``);
  console.log(`⚠ Only updatedAt (creation time lost) · ${groups.updated.length}`);
  for (const m of groups.updated) console.log(`  · ${m.name}`);
  console.log(``);
  console.log(`ℹ Domain-specific *At field only (event-shape, OK) · ${groups.domain.length}`);
  for (const m of groups.domain) console.log(`  · ${m.name} → ${m.dateTimeFields.join(", ")}`);
  console.log(``);
  console.log(`✗ No DateTime field at all (investigate) · ${groups.none.length}`);
  for (const m of groups.none) console.log(`  · ${m.name}`);
  console.log(``);

  // Exit non-zero if there are truly-broken models so this can power a CI check.
  if (groups.updated.length > 0 || groups.none.length > 0) {
    console.log(`✗ ${groups.updated.length + groups.none.length} model(s) need attention.`);
    process.exitCode = 1;
  } else {
    console.log(`✓ No critical findings.`);
  }
}

main();
