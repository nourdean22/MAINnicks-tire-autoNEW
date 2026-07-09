import fs from "fs";
import path from "path";
import { parseArgs } from "util";
import { getDbTyped } from "../server/db";
import { socialContentInventory, reelJobs } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { enqueueReelJob, type ReelJobBrief } from "../server/services/reelPipeline";
import { applyCreativeSkills } from "../server/services/skillRouter";

export async function parseMarkdown(content: string, useSkills: boolean = true) {
  // Split by ## Day or # Day
  const dayBlocks = content.split(/\n#{1,3}\s*Day\s+/i).slice(1);
  
  const results = [];
  let parsedCount = 0;
  let validCount = 0;
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const block of dayBlocks) {
    parsedCount++;
    try {
      // Extract day number and title
      const titleLineMatch = block.match(/^(\d+)\s*[-—–]\s*(.+)/);
      if (!titleLineMatch) {
        errors.push(`Could not parse day/title for block starting with: ${block.substring(0, 50)}`);
        continue;
      }
      const dayNum = parseInt(titleLineMatch[1], 10);
      const title = titleLineMatch[2].trim();

      // Extractor helper
      const extract = (prefix: string) => {
        // match `- **Prefix:** content` handling multiline until the next bullet point
        const regex = new RegExp(`-\\s*\\*\\*${prefix}:\\*\\*\\s*(Voiceover:\\s*)?([^\\n]+(?:\\n(?:(?!-\\s*\\*\\*)[^\\n]+))*)`, 'i');
        const match = block.match(regex);
        return match ? match[2].trim() : null;
      };

      const videoScript = extract("Video script") || extract("Video Script");
      const shotList = extract("Shot list") || extract("Shot List");
      const videoPrompt = extract("Video prompt") || extract("Video Prompt");
      const onScreenText = extract("On-screen text") || extract("On-Screen Text") || extract("On-screen Text");
      const caption = extract("Caption");
      const pinnedComment = extract("Pinned comment") || extract("Pinned Comment");
      const hashtagsStr = extract("Hashtags");

      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      const id = `nicks-30day-reels-day-${dayNum.toString().padStart(2, "0")}-${slug}`.substring(0, 64);

      // Validate required fields
      const missing = [];
      if (!videoScript) missing.push("Video script");
      if (!shotList) missing.push("Shot list");
      if (!videoPrompt) missing.push("Video prompt");
      if (!caption) missing.push("Caption");
      if (!hashtagsStr) missing.push("Hashtags");

      if (missing.length > 0) {
        errors.push(`Day ${dayNum} is missing required fields: ${missing.join(", ")}`);
        continue;
      }

      // Parse beats (roughly splitting by periods for simplicity)
      // We will match full sentences ending in periods as individual shots
      let rawShots = shotList!.split(/(?<=\.)\s+/).map(s => s.trim()).filter(Boolean);
      
      // If split by period didn't give enough beats, try splitting by comma if it's a comma-separated list
      if (rawShots.length < 3 && shotList!.includes(',')) {
        rawShots = shotList!.split(",").map(s => s.trim()).filter(Boolean);
      }

      // Ensure at least 3 beats
      const beatsCount = Math.max(rawShots.length, 3);
      const storyboardBeats = [];
      const promptPack = [];
      const higgsfieldPromptPack = [];

      // Offline CLI gating: bypass DB read and force based on --skills flag
      const skillPayload = await applyCreativeSkills(
        { type: "reel_ingest_beats" },
        { skill_reel_script_enabled: useSkills }
      );
      const visualSkillFragment = ("fragment" in skillPayload) ? skillPayload.fragment : "";

      for (let i = 0; i < beatsCount; i++) {
        const visual = rawShots[i] || rawShots[rawShots.length - 1] || videoPrompt;
        storyboardBeats.push({
          beatNumber: i + 1,
          visual: visual,
          onScreenText: i === 0 ? onScreenText! : undefined // Put text on first beat
        });
        
        promptPack.push({
          beatNumber: i + 1,
          prompt: `Shot: ${visual} | Context: ${videoPrompt}`
        });

        higgsfieldPromptPack.push({
          beatNumber: i + 1,
          prompt: `Shot: ${visual} | Context: ${videoPrompt}\n\n${visualSkillFragment}`.trim()
        });
      }

      if (rawShots.length < 3) {
        warnings.push(`Day ${dayNum} had fewer than 3 actual shots defined (${rawShots.length}), duplicating the last shot to meet minimum length.`);
      }

      const hashtagsArray = hashtagsStr!.split(/\s+/).map(h => h.startsWith("#") ? h : `#${h}`);
      const selectedCaption = `${caption}\n\n${pinnedComment ? `Pinned: ${pinnedComment}\n\n` : ""}${hashtagsArray.join(" ")}`;

      if (selectedCaption.length > 2200) {
        errors.push(`Day ${dayNum} caption exceeds 2200 characters.`);
        continue;
      }

      const entry = {
        day: dayNum,
        slug,
        title,
        id,
        voiceoverScript: videoScript!,
        selectedCaption,
        hashtags: hashtagsArray,
        storyboardBeats,
        promptPack,
        higgsfieldPromptPack,
        hookCategory: "Reel Hook",
        hookText: videoScript!.substring(0, Math.min(60, videoScript!.length)), // First 60 chars as hook
        bodyText: videoScript!,
      };

      results.push(entry);
      validCount++;

    } catch (e) {
      errors.push(`Error parsing a block: ${String(e)}`);
    }
  }

  return { parsed: parsedCount, valid: validCount, results, errors, warnings };
}

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
      "dry-run": { type: "boolean" },
      "validate-only": { type: "boolean" },
      "write-inventory": { type: "boolean" },
      "enqueue-jobs": { type: "boolean" },
      force: { type: "boolean" },
      day: { type: "string" },
      skills: { type: "boolean", default: true },
    },
    args: process.argv.slice(2),
  });

  const inputPath = values.input;
  if (!inputPath) {
    console.error("❌ Missing --input path");
    process.exit(1);
  }

  const fullPath = path.resolve(process.cwd(), inputPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ Source file not found: ${fullPath}`);
    console.error(`Expected location: ./reels_30_day_plan.md`);
    process.exit(1);
  }

  console.log(`\n🔍 Parsing ${fullPath}...`);
  const content = fs.readFileSync(fullPath, "utf-8");
  const parsedResult = await parseMarkdown(content, values.skills ?? true);

  let targetResults = parsedResult.results;
  if (values.day) {
    const targetDay = parseInt(values.day, 10);
    targetResults = targetResults.filter(r => r.day === targetDay);
  }

  let inventoryWouldWrite = 0;
  let jobsWouldEnqueue = 0;
  let duplicatesSkipped = 0;

  const db = (values["write-inventory"] || values["enqueue-jobs"] || values.force) && !values["dry-run"] && !values["validate-only"] 
    ? await getDbTyped() 
    : null;

  if (values["validate-only"] || values["dry-run"]) {
    // For dry run or validate only, we still want to count what *would* happen
    inventoryWouldWrite = targetResults.length;
    jobsWouldEnqueue = targetResults.length;
  }

  if (db && !values["dry-run"] && !values["validate-only"]) {
    for (const reel of targetResults) {
      // 1. Write Inventory
      if (values["write-inventory"]) {
        const existing = await db.select({ id: socialContentInventory.id }).from(socialContentInventory).where(eq(socialContentInventory.id, reel.id)).limit(1);
        if (existing.length > 0) {
          if (values.force) {
            await db.update(socialContentInventory).set({
              topic: reel.title,
              episodeNumber: reel.day,
              hookText: reel.hookText,
              bodyText: reel.bodyText,
              updatedAt: new Date()
            }).where(eq(socialContentInventory.id, reel.id));
            inventoryWouldWrite++;
          } else {
            duplicatesSkipped++;
          }
        } else {
          await db.insert(socialContentInventory).values({
            id: reel.id,
            contentType: "reel",
            platform: "both",
            topic: reel.title,
            seriesName: "30-Day Reels",
            episodeNumber: reel.day,
            hookCategory: "Educational",
            hookText: reel.hookText,
            bodyText: reel.bodyText,
            visualStyle: "faceless_cinematic",
            persona: "nick_tire_operator",
            status: "pending"
          });
          inventoryWouldWrite++;
        }
      }

      // 2. Enqueue Job
      if (values["enqueue-jobs"]) {
        const existingJob = await db.select({ id: reelJobs.id, status: reelJobs.status }).from(reelJobs).where(eq(reelJobs.briefId, reel.id)).limit(1);
        
        let shouldEnqueue = true;
        if (existingJob.length > 0) {
          const status = existingJob[0].status;
          if (status === "queued" || status === "generating" || status === "assets_ready" || status === "assembling" || status === "assembled") {
            shouldEnqueue = false; // Active or completed
            duplicatesSkipped++;
          } else if (status === "failed" && !values.force) {
            shouldEnqueue = false; // Failed but no force
            duplicatesSkipped++;
          } else if (status === "failed" && values.force) {
            // Delete old failed job so we can enqueue a fresh one
            await db.delete(reelJobs).where(eq(reelJobs.id, existingJob[0].id));
          }
        }

        if (shouldEnqueue) {
          const brief: ReelJobBrief = {
            id: reel.id,
            selectedCaption: reel.selectedCaption,
            hashtags: reel.hashtags,
            storyboardBeats: reel.storyboardBeats,
            promptPack: reel.promptPack,
            higgsfieldPromptPack: reel.higgsfieldPromptPack,
            voiceoverScript: reel.voiceoverScript
          };
          await enqueueReelJob(brief, "admin");
          jobsWouldEnqueue++;
        }
      }
    }
  }

  const output = {
    parsed: parsedResult.parsed,
    valid: parsedResult.valid,
    errors: parsedResult.errors,
    warnings: parsedResult.warnings,
    inventoryWouldWrite: inventoryWouldWrite,
    jobsWouldEnqueue: jobsWouldEnqueue,
    duplicatesSkipped: duplicatesSkipped
  };

  console.log("\n📊 Final Report:");
  console.log(JSON.stringify(output, null, 2));

  if (parsedResult.errors.length > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

// Only run main if called directly
import { fileURLToPath } from 'url';
if (import.meta.url) {
  const currentPath = fileURLToPath(import.meta.url);
  if (process.argv[1] === currentPath) {
    main().catch(e => {
      console.error("Unhandled Error:", e);
      process.exit(1);
    });
  }
}
