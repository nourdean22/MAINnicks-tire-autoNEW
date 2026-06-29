#!/usr/bin/env tsx
/**
 * scripts/record-schema-change.ts · v10.0.3 · Apr 30.
 *
 * CLI helper to record, apply, and audit schema changes.
 *
 * Run:
 *   pnpm exec tsx --env-file=.env.local scripts/record-schema-change.ts --key "v10.0.3-test" --title "..."
 */

import {
  recordSchemaChange,
  markSchemaChangeApplied,
  markSchemaChangeFailed,
  ChangeType,
  ChangeMethod,
  ChangeEnvironment,
} from "../lib/db/schema-ledger";

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const parts = arg.slice(2).split("=");
      const key = parts[0];
      let val: string | boolean = parts[1] ?? true;

      // Handle flag values
      if (val === "true") val = true;
      if (val === "false") val = false;

      // If no '=' and next argument doesn't start with '--', it is the value
      if (parts.length === 1 && i + 1 < args.length && !args[i + 1].startsWith("--")) {
        val = args[i + 1];
        i++;
      }
      parsed[key] = val;
    }
  }
  return parsed;
}

async function main() {
  const flags = parseArgs();

  const key = flags.key as string;
  if (!key) {
    console.error("❌ Error: --key is required.");
    process.exit(1);
  }

  // 1. Mark Applied Flow
  if (flags["mark-applied"]) {
    const appliedBy = (flags["applied-by"] || flags["appliedBy"]) as string | undefined;
    console.log(` Marking change '${key}' as applied...`);
    await markSchemaChangeApplied({
      changeKey: key,
      appliedBy,
    });
    console.log(`✅ Successfully marked '${key}' as applied.`);
    return;
  }

  // 2. Mark Failed Flow
  if (flags["mark-failed"]) {
    const error = flags["mark-failed"] === true ? "Unknown error" : (flags["mark-failed"] as string);
    console.log(` Marking change '${key}' as failed...`);
    await markSchemaChangeFailed(key, error);
    console.log(`❌ Marked '${key}' as failed.`);
    return;
  }

  // 3. Record Planned Flow
  const title = flags.title as string;
  const reason = flags.reason as string;
  const changeType = (flags.type || "other") as ChangeType;
  const method = (flags.method || "db_push") as ChangeMethod;
  const environment = (flags.env || flags.environment || "local") as ChangeEnvironment;
  const sqlSummary = (flags.sql || flags.sqlSummary) as string | undefined;
  const prismaDiff = (flags.diff || flags.prismaDiff) as string | undefined;
  const destructive = !!flags.destructive;
  const approvedBy = (flags.approved || flags.approvedBy) as string | undefined;
  const rollbackPlan = (flags.rollback || flags.rollbackPlan) as string | undefined;

  if (!title) {
    console.error("❌ Error: --title is required when planning a change.");
    process.exit(1);
  }
  if (!reason) {
    console.error("❌ Error: --reason is required when planning a change.");
    process.exit(1);
  }

  console.log(` Planning schema change '${key}'...`);
  const result = await recordSchemaChange({
    changeKey: key,
    title,
    reason,
    changeType,
    method,
    environment,
    sqlSummary,
    prismaDiff,
    destructive,
    approvedBy,
    rollbackPlan,
  });

  if (result.created) {
    console.log(`✅ Planned schema change recorded in ledger (ID: ${result.id})`);
  } else {
    console.log(`· Schema change '${key}' already exists in ledger (ID: ${result.id})`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Operation failed:", err.message || err);
    process.exit(1);
  });
