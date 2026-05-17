#!/usr/bin/env tsx
/**
 * scripts/import-persona-corpus.ts · v10.0.529.43
 *
 * One-shot importer for the operator's persona corpus. Reads files
 * from `data/persona-corpus/` (or a path passed via --dir), embeds
 * each operator-authored utterance, and rebuilds the behavioral-
 * persona centroid stored in BrainMemory.
 *
 * Usage:
 *   pnpm tsx scripts/import-persona-corpus.ts
 *   pnpm tsx scripts/import-persona-corpus.ts --dir /custom/path
 *
 * Idempotent · safe to re-run · existing utterances skip re-embed.
 * See data/persona-corpus/README.md for accepted file formats.
 */

import { importPersonaCorpus } from "@/lib/brain/persona-corpus-importer";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let dir = "data/persona-corpus";
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--dir" || args[i] === "-d") && args[i + 1]) {
      dir = args[i + 1]!;
      i += 1;
    }
  }

  console.log(`📥 importing persona corpus from: ${dir}`);
  const t0 = Date.now();
  const summary = await importPersonaCorpus(dir);
  const durationMs = Date.now() - t0;

  console.log("");
  console.log(`✅ import complete · ${durationMs}ms`);
  console.log(`   files scanned:           ${summary.filesScanned}`);
  console.log(`   utterances found:        ${summary.utterancesFound}`);
  console.log(`   newly embedded:          ${summary.utterancesEmbedded}`);
  console.log(`   skipped (already done):  ${summary.utterancesSkippedExisting}`);
  console.log(
    `   centroid dimensions:     ${summary.centroidDimensions}${summary.centroidWritten ? " · WRITTEN" : ""}`,
  );
  if (summary.errors.length > 0) {
    console.log(`   errors (${summary.errors.length}):`);
    for (const e of summary.errors.slice(0, 10)) {
      console.log(`     - ${e}`);
    }
    if (summary.errors.length > 10) {
      console.log(`     ... and ${summary.errors.length - 10} more`);
    }
  }
  console.log("");

  if (summary.profileSummary) {
    console.log("");
    console.log("📊 voice profile:");
    console.log("");
    // Indent for readability · the summary is one paragraph
    const wrapped = summary.profileSummary
      .replace(/(.{1,90})(\s|$)/g, "$1\n   ")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    for (const line of wrapped) {
      console.log(`   ${line}`);
    }
    console.log("");
  }

  if (summary.centroidWritten) {
    console.log(
      "💡 The behavioral persona centroid + voice profile are now available\n" +
        "   to getPersonaAnchorPrompt(). Next chat turn picks them up after\n" +
        "   the 15-min cache TTL · or restart the dev server.",
    );
  }
  process.exit(summary.centroidWritten ? 0 : summary.utterancesFound === 0 ? 0 : 1);
}

void main().catch((err) => {
  console.error("❌ importer crashed:", err);
  process.exit(1);
});
