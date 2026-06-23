#!/usr/bin/env tsx
// Record 20260623000000_add_social_publish_queue in SchemaChangeLedger
//
// Run: pnpm tsx scripts/record-social-publish-queue.ts

import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import {
  recordSchemaChange,
  markSchemaChangeApplied,
} from "@/lib/db/schema-ledger";

async function main() {
  const changeKey = "20260623000000_add_social_publish_queue";
  
  const result = await recordSchemaChange({
    changeKey,
    title: "Add social_publish_queue table for Phase 3 Social Intelligence Engine",
    reason: "Creates the unified Command Center Queue table to schedule and synchronize social media assets between Statenour and Nick's Tire.",
    changeType: "add_table",
    method: "migrate",
    environment: "production",
    sqlSummary: "CREATE TABLE social_publish_queue + 4 indexes (status,scheduled_for), (mission_id), (created_at), (deleted_at) + foreign key to Mission",
    destructive: false,
  });

  if (result.created) {
    await markSchemaChangeApplied({
      changeKey,
      appliedBy: "operator",
    });
    console.log(`✓ ${changeKey} recorded + applied in SchemaChangeLedger`);
  } else {
    console.log(`· ${changeKey} already in SchemaChangeLedger`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Recording failed:", e);
    process.exit(1);
  });
