#!/usr/bin/env tsx
/**
 * One-time backfill of v10.0.1 + v10.0.2 schema changes into the
 * SchemaChangeLedger. Idempotent — recordSchemaChange() returns the
 * existing row if changeKey already used.
 *
 * Run: DATABASE_URL=... pnpm exec tsx scripts/_backfill-schema-ledger.ts
 */

import {
  recordSchemaChange,
  markSchemaChangeApplied,
} from "@/lib/db/schema-ledger";

async function backfill() {
  // v10.0.1 — BrainBusEvent table
  const e1 = await recordSchemaChange({
    changeKey: "v10.0.1-add-brain-bus-events",
    title: "Add BrainBusEvent table for durable brain-bus replay",
    reason:
      "Closes at-most-once gap on LISTEN/NOTIFY. Round 1 Agent D Q5 documented this as accepted limitation; v10 removes it.",
    changeType: "add_table",
    method: "db_push",
    environment: "production",
    sqlSummary:
      "CREATE TABLE brain_bus_events + 2 indexes (status,available_at) and (topic,created_at)",
    destructive: false,
  });
  if (e1.created) {
    await markSchemaChangeApplied({
      changeKey: "v10.0.1-add-brain-bus-events",
      appliedBy: "operator",
    });
    console.log("✓ v10.0.1-add-brain-bus-events recorded + applied");
  } else {
    console.log("· v10.0.1-add-brain-bus-events already in ledger");
  }

  // v10.0.8 — AgentTrace
  const e3 = await recordSchemaChange({
    changeKey: "v10.0.8-add-agent-trace",
    title: "Add AgentTrace table for AI/agent call standardization",
    reason:
      "v10 Track E.5 closes the assessment gap 'Observability needs agent trace standardization.' Every AI call now flows through wrapTrace() with shared traceId for chaining (chat → tool → brain → audit). Powers cost attribution + 'why did NICK do X?' debugging.",
    changeType: "add_table",
    method: "db_push",
    environment: "production",
    sqlSummary:
      "CREATE TABLE agent_traces + 4 indexes (traceId,startedAt) (source,createdAt) (provider,createdAt) (errorClass,createdAt)",
    destructive: false,
  });
  if (e3.created) {
    await markSchemaChangeApplied({
      changeKey: "v10.0.8-add-agent-trace",
      appliedBy: "operator",
    });
    console.log("✓ v10.0.8-add-agent-trace recorded + applied");
  } else {
    console.log("· v10.0.8-add-agent-trace already in ledger");
  }

  // v10.0.2 — SchemaChangeLedger table itself
  const e2 = await recordSchemaChange({
    changeKey: "v10.0.2-add-schema-change-ledger",
    title: "Add SchemaChangeLedger table for migration audit trail",
    reason:
      "Closes migration-history gap. db_push has no SQL audit trail by default. v10 Track B.4 policy enforces one ledger row per schema change going forward.",
    changeType: "add_table",
    method: "db_push",
    environment: "production",
    sqlSummary:
      "CREATE TABLE schema_change_ledger + 2 indexes (status,created_at) and (environment,applied_at)",
    destructive: false,
  });
  if (e2.created) {
    await markSchemaChangeApplied({
      changeKey: "v10.0.2-add-schema-change-ledger",
      appliedBy: "operator",
    });
    console.log("✓ v10.0.2-add-schema-change-ledger recorded + applied");
  } else {
    console.log("· v10.0.2-add-schema-change-ledger already in ledger");
  }
}

backfill()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("backfill failed:", e);
    process.exit(1);
  });
