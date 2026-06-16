/**
 * Sync Gmail/Apple Notes → BrainMemory · 2026-06-16
 *
 * Scans linked Gmail accounts for the "label:notes" folder,
 * downloads note-based emails, and imports them into Statenour's BrainMemory.
 *
 * Run: pnpm tsx scripts/sync-gmail-notes.ts
 */

import { listMessages, getMessage } from "../lib/services/gmail-api";
import { listConfiguredAccounts } from "../lib/services/google-oauth";
import { prisma } from "../lib/prisma";
import { brainMemory } from "../lib/brain/memory-manager";
import { BRAIN_CATEGORIES } from "../lib/brain/categories";

async function main() {
  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  SYNC GMAIL / APPLE NOTES → BRAIN");
  console.log("═══════════════════════════════════════════════════════════");

  const accounts = await listConfiguredAccounts();
  if (accounts.length === 0) {
    console.error("❌ No configured Google accounts found. Link an account first.");
    process.exit(0);
  }

  let totalSynced = 0;

  for (const acct of accounts) {
    console.log(`Checking account: ${acct.email} (${acct.accountKey})...`);
    try {
      // Fetch notes modified/synced in the last 30 days
      const notesQuery = "label:notes newer_than:30d";
      const noteIds = await listMessages(notesQuery, 50, acct.accountKey);
      
      if (noteIds.length === 0) {
        console.log("  No notes found in the last 30 days.");
        continue;
      }
      
      console.log(`  Found ${noteIds.length} notes. Ingesting...`);

      for (const m of noteIds) {
        try {
          const full = await getMessage(m.id, acct.accountKey);
          const body = (full.body || full.snippet || "").trim();
          if (body.length === 0) continue;

          // Format note content
          const parts: string[] = [];
          if (full.subject) parts.push(`Subject: ${full.subject}`);
          if (full.from) parts.push(`From: ${full.from}`);
          if (full.date) parts.push(`Date: ${new Date(full.date).toISOString().slice(0, 10)}`);
          parts.push("");
          parts.push(body);

          const content = parts.join("\n");
          const key = `gmail_${full.id}`;

          // Check if memory already exists (deduplication)
          const existing = await prisma.brainMemory.findFirst({
            where: { category: BRAIN_CATEGORIES.PERSONAL_DEVELOPMENT, key },
            select: { id: true }
          });

          if (existing) {
            console.log(`  [Skip] Note "${full.subject}" already synced.`);
            continue;
          }

          console.log(`  [Syncing] "${full.subject}" (${content.length} chars)...`);
          
          await brainMemory.remember(
            BRAIN_CATEGORIES.PERSONAL_DEVELOPMENT,
            key,
            content,
            "gmail_notes_sync",
            {
              messageId: full.id,
              threadId: full.threadId,
              from: full.from,
              subject: full.subject,
              accountKey: acct.accountKey,
              accountEmail: acct.email,
              noteSource: "apple-notes-gmail"
            }
          );

          // Lock confidence to 1.0 (prevents decay)
          const record = await prisma.brainMemory.findFirst({
            where: { category: BRAIN_CATEGORIES.PERSONAL_DEVELOPMENT, key },
          });
          if (record) {
            await brainMemory.confirm(record.id);
          }

          totalSynced++;
        } catch (err) {
          console.error(`    ❌ Failed to sync note ${m.id}:`, err);
        }
      }
    } catch (err) {
      // label:notes may not exist if Apple Notes is not synced to this specific account
      console.log(`  ⚠️ Info: Could not search notes folder for ${acct.email} (label:notes might not exist): ${(err as Error).message}`);
    }
  }

  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  🎉 Sync complete: ${totalSynced} new notes synced.`);
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("❌ Notes sync failed:", err);
  process.exit(1);
});
