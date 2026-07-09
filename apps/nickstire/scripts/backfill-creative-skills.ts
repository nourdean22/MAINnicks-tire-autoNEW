import fs from "fs";
import path from "path";
import { parseArgs } from "util";
import { getDbTyped } from "../server/db";
import { socialContentInventory, reelJobs } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { applyCreativeSkills } from "../server/services/skillRouter";

const REPORTS_DIR = path.resolve(process.cwd(), "reports");
const PREVIEW_FILE = path.join(REPORTS_DIR, "backfill-skills-preview.json");
const ROLLBACK_FILE = path.join(REPORTS_DIR, "backfill-skills-rollback.json");

interface PromptPackEntry {
  beatNumber: number;
  prompt: string;
}

async function main() {
  const { values } = parseArgs({
    options: {
      write: { type: "boolean" },
    },
    args: process.argv.slice(2),
  });

  const isDryRun = !values.write;
  console.log(`\n🚀 Starting Backfill (Creative Skill Packs) - ${isDryRun ? "DRY RUN" : "LIVE WRITE"}`);

  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }

  const db = await getDbTyped();
  if (!db) {
    console.error("❌ Database connection failed");
    process.exit(1);
  }

  // Phase 1: Fetch scoped rows
  const pendingInventory = await db
    .select({ id: socialContentInventory.id, briefJson: socialContentInventory.briefJson })
    .from(socialContentInventory)
    .where(eq(socialContentInventory.status, "pending"));

  const queuedJobs = await db
    .select({ id: reelJobs.id, briefJson: reelJobs.payload })
    .from(reelJobs)
    .where(eq(reelJobs.status, "queued"));

  console.log(`Found ${pendingInventory.length} pending inventory items and ${queuedJobs.length} queued reel jobs.`);

  const skillPayload = await applyCreativeSkills({ type: "reel_ingest_beats" }, { skill_reel_script_enabled: true });
  const visualSkillFragment = ("fragment" in skillPayload) ? skillPayload.fragment : "";

  const updates: Array<{ type: "inventory" | "job"; id: string; oldJson: string; newJson: string }> = [];
  const rollbackData: Record<string, string> = {}; // id -> oldJson
  const previewDiffs: Array<{ id: string; originalHiggsfieldCount: number; newHiggsfieldCount: number }> = [];

  const processRow = (row: { id: string; briefJson: string | null }, type: "inventory" | "job") => {
    if (!row.briefJson) return;

    try {
      const brief = JSON.parse(row.briefJson);
      
      // Idempotency check
      if (brief.promptPackVersion >= 2) {
        return;
      }

      if (!brief.storyboardBeats || !Array.isArray(brief.storyboardBeats)) {
        return;
      }

      // Re-derive promptPack and higgsfieldPromptPack ONLY based on existing beats
      const promptPack: PromptPackEntry[] = [];
      const higgsfieldPromptPack: PromptPackEntry[] = [];

      for (const beat of brief.storyboardBeats) {
        const visual = beat.visual || "";
        // Original context from the beat or fallback
        const videoPrompt = beat.purpose || visual; 

        promptPack.push({
          beatNumber: beat.beatNumber,
          prompt: `Shot: ${visual} | Context: ${videoPrompt}`
        });

        higgsfieldPromptPack.push({
          beatNumber: beat.beatNumber,
          prompt: `Shot: ${visual} | Context: ${videoPrompt}\n\n${visualSkillFragment}`.trim()
        });
      }

      const originalHiggsfieldCount = brief.higgsfieldPromptPack ? brief.higgsfieldPromptPack.length : 0;

      const newBrief = {
        ...brief,
        promptPack,
        higgsfieldPromptPack,
        promptPackVersion: 2
      };

      updates.push({
        type,
        id: row.id,
        oldJson: row.briefJson,
        newJson: JSON.stringify(newBrief)
      });

      rollbackData[row.id] = row.briefJson;
      previewDiffs.push({
        id: row.id,
        originalHiggsfieldCount,
        newHiggsfieldCount: higgsfieldPromptPack.length
      });
    } catch (e) {
      console.error(`Failed to parse briefJson for ${type} ${row.id}: ${e}`);
    }
  };

  for (const item of pendingInventory) processRow(item, "inventory");
  for (const job of queuedJobs) processRow(job, "job");

  console.log(`\nPrepared ${updates.length} updates.`);

  // Write Preview
  fs.writeFileSync(PREVIEW_FILE, JSON.stringify(previewDiffs, null, 2));
  console.log(`✅ Wrote preview report to ${PREVIEW_FILE}`);

  if (isDryRun) {
    console.log("⚠️ Dry run complete. Use --write to apply updates.");
    return;
  }

  // Write Rollback
  fs.writeFileSync(ROLLBACK_FILE, JSON.stringify(rollbackData, null, 2));
  console.log(`✅ Wrote rollback payload to ${ROLLBACK_FILE}`);

  console.log("💾 Applying updates to database...");
  let applied = 0;
  for (const update of updates) {
    if (update.type === "inventory") {
      await db.update(socialContentInventory)
        .set({ briefJson: update.newJson })
        .where(eq(socialContentInventory.id, update.id));
    } else {
      await db.update(reelJobs)
        .set({ payload: update.newJson })
        .where(eq(reelJobs.id, update.id));
    }
    applied++;
  }

  console.log(`🎉 Successfully applied ${applied} updates.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
