/**
 * Obsidian Vault Doctor Script — Statenour OS
 *
 * Verifies folder structures, plugin installation, configurations,
 * dashboard fences, note templates, and validates all markdown note
 * frontmatter metadata recursively for categorization and sync safety.
 *
 * Run: pnpm --filter @statenour/web exec tsx scripts/obsidian-doctor.ts
 */

import fs from "fs";
import path from "path";
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { KNOWN_BRAIN_CATEGORIES } from "../lib/brain/categories";
import { getObsidianEngineConfig, writeEngineStatus, readEngineStatus } from "../lib/obsidian/engine-config";
import { dirHasIgnoreMarker } from "../lib/obsidian/ignore";
import { ObsidianEngineStatus, EngineIssue, QuarantinedFileInfo } from "../lib/obsidian/types";

const TOKEN_PATTERNS = [
  { name: "GitHub Personal Access Token", regex: /ghp_[a-zA-Z0-9]{36,}/i },
  { name: "GitHub Fine-Grained Token", regex: /github_pat_[a-zA-Z0-9_]{80,}/i },
  { name: "Anthropic API Key", regex: /sk-ant-[a-zA-Z0-9-_]{40,}/i },
  { name: "OpenRouter API Key", regex: /sk-or-v1-[a-zA-Z0-9]{40,}/i },
  { name: "Stripe API Key", regex: /sk_(live|test)_[a-zA-Z0-9]{24,}/i },
  { name: "Bearer Token", regex: /bearer\s+[a-zA-Z0-9_\-\.]{30,}/i }
];

// Parse CLI arguments
const args = process.argv.slice(2);
const strict = args.includes("--strict");
const jsonMode = args.includes("--json");
const fixMode = args.includes("--fix");
const noStatusWrite = args.includes("--no-status-write");


const engineConfig = getObsidianEngineConfig();
let vaultPath = engineConfig.vaultPath;
const vaultIdx = args.indexOf("--vault");
if (vaultIdx !== -1 && vaultIdx + 1 < args.length) {
  vaultPath = args[vaultIdx + 1];
}

interface Issue {
  file?: string;
  type: "FAIL" | "WARN";
  message: string;
}

const issues: Issue[] = [];
let passCount = 0;
let warnCount = 0;
let failCount = 0;

function logPass(message: string) {
  passCount++;
  if (!jsonMode) {
    console.log(`  ✅ [PASS] ${message}`);
  }
}

function logWarn(message: string, file?: string) {
  warnCount++;
  issues.push({ file, type: "WARN", message });
  if (!jsonMode) {
    console.log(`  ⚠️  [WARN] ${file ? `(${path.basename(file)}) ` : ""}${message}`);
  }
}

function logFail(message: string, file?: string) {
  failCount++;
  issues.push({ file, type: "FAIL", message });
  if (!jsonMode) {
    console.log(`  ❌ [FAIL] ${file ? `(${path.basename(file)}) ` : ""}${message}`);
  }
}

// Helper to parse YAML frontmatter
function parseFrontmatter(fileContent: string): { metadata: Record<string, any>; error?: string } {
  const result = { metadata: {} as Record<string, any> };
  const normalized = fileContent.trim();
  if (!normalized.startsWith("---")) return result;

  const lines = normalized.split(/\r?\n/);
  if (lines[0] !== "---") return result;

  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      closingIndex = i;
      break;
    }
  }

  if (closingIndex === -1) {
    return { metadata: {}, error: "Missing closing '---' for YAML frontmatter" };
  }

  const yamlLines = lines.slice(1, closingIndex);
  const metadata: Record<string, any> = {};

  for (const line of yamlLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) {
      return { metadata: {}, error: `Malformed YAML line (missing colon): "${line}"` };
    }

    const rawKey = trimmed.substring(0, colonIdx).trim();
    let rawVal = trimmed.substring(colonIdx + 1).trim();

    // Strip comments
    let commentIdx = -1;
    let inDoubleQuote = false;
    let inSingleQuote = false;
    for (let charIdx = 0; charIdx < rawVal.length; charIdx++) {
      const char = rawVal[charIdx];
      if (char === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
      } else if (char === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
      } else if (char === '#' && !inDoubleQuote && !inSingleQuote) {
        commentIdx = charIdx;
        break;
      }
    }
    if (commentIdx !== -1) {
      rawVal = rawVal.substring(0, commentIdx).trim();
    }

    if ((rawVal.startsWith('"') && rawVal.endsWith('"')) || (rawVal.startsWith("'") && rawVal.endsWith("'"))) {
      rawVal = rawVal.substring(1, rawVal.length - 1);
    }

    let value: any = rawVal;
    if (rawVal === "true") {
      value = true;
    } else if (rawVal === "false") {
      value = false;
    } else if (!isNaN(Number(rawVal)) && rawVal !== "") {
      value = Number(rawVal);
    } else if (rawVal.startsWith("[") && rawVal.endsWith("]")) {
      // Parse array
      try {
        value = rawVal
          .substring(1, rawVal.length - 1)
          .split(",")
          .map((t) => t.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);
      } catch (err) {
        return { metadata: {}, error: `Malformed YAML array in key "${rawKey}": ${rawVal}` };
      }
    }

    metadata[rawKey] = value;
  }

  return { metadata };
}

function fixNoteFrontmatter(content: string): string | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("---")) return null;

  const lines = content.split(/\r?\n/);
  if (lines[0] !== "---") return null;

  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      closingIndex = i;
      break;
    }
  }
  if (closingIndex === -1) return null;

  const yamlLines = lines.slice(1, closingIndex);
  const bodyLines = lines.slice(closingIndex + 1);

  let hasStatus = false;
  let statusVal: string | null = null;
  let hasReviewDue = false;
  let hasSource = false;
  let hasUpdatedAt = false;
  let modified = false;

  const newYamlLines = yamlLines.map((line) => {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) return line;

    const colonIdx = trimmedLine.indexOf(":");
    if (colonIdx === -1) return line;

    const key = trimmedLine.substring(0, colonIdx).trim();
    let val = trimmedLine.substring(colonIdx + 1).trim();
    const strippedVal = val.replace(/^['"]|['"]$/g, "");

    if (key === "status") {
      hasStatus = true;
      statusVal = strippedVal.toLowerCase();
      const lowerVal = strippedVal.toLowerCase();
      if (strippedVal !== lowerVal) {
        modified = true;
        const needsQuotes = val.startsWith('"') || val.startsWith("'");
        const quoteChar = val[0];
        const replacementVal = needsQuotes ? `${quoteChar}${lowerVal}${quoteChar}` : lowerVal;
        return line.replace(val, replacementVal);
      }
    }
    if (key === "review_due") {
      hasReviewDue = true;
    }
    if (key === "source") {
      hasSource = true;
      const lowerVal = strippedVal.toLowerCase();
      if (lowerVal !== "obsidian" && lowerVal !== "statenour") {
        modified = true;
        const needsQuotes = val.startsWith('"') || val.startsWith("'");
        const quoteChar = val[0];
        const replacementVal = needsQuotes ? `${quoteChar}obsidian${quoteChar}` : "obsidian";
        return line.replace(val, replacementVal);
      }
    }
    if (key === "updated_at") {
      hasUpdatedAt = true;
    }
    return line;
  });

  if (!hasSource) {
    newYamlLines.push("source: obsidian");
    modified = true;
  }
  if (!hasUpdatedAt) {
    newYamlLines.push(`updated_at: ${new Date().toISOString()}`);
    modified = true;
  }
  if (statusVal === "active" && !hasReviewDue) {
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const defaultReviewDue = nextWeek.toISOString().slice(0, 10);
    newYamlLines.push(`review_due: ${defaultReviewDue}`);
    modified = true;
  }

  if (!modified) return null;

  return ["---", ...newYamlLines, "---", ...bodyLines].join("\n");
}


// Recursive file scanner
function getFilesRecursive(dir: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  // Self-declared non-inbox folders (`.statenour-ignore` marker) are exempt
  // from validation AND from --fix's frontmatter rewriting — machine exports
  // like the graphify digests must never be mutated by the doctor.
  if (dirHasIgnoreMarker(dir)) return results;

  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      // Exclude system, backup, archive, quarantine, templates, and exported Statenour folders from strict validation
      if (
        file !== ".obsidian" &&
        file !== "node_modules" &&
        file !== ".git" &&
        file !== ".statenour-backups" &&
        file !== "40_Archive" &&
        file !== "Quarantine" &&
        file !== "Templates" &&
        file !== "Statenour"
      ) {
        results = results.concat(getFilesRecursive(filePath));
      }
    } else if (file.endsWith(".md") && file !== "README.md") {
      results.push(filePath);
    }
  }
  return results;
}

async function main() {
  if (!jsonMode) {
    console.log("");
    console.log("═══════════════════════════════════════════════════════════");
    console.log("  STATENOUR ↔ OBSIDIAN COCKPIT DOCTOR DIAGNOSTIC");
    console.log("═══════════════════════════════════════════════════════════");
  }

  // 0. Env Checks (Phase 10.5)
  if (!process.env.OBSIDIAN_VAULT_PATH) {
    logWarn(`OBSIDIAN_VAULT_PATH is not set in environment. Falling back to default Windows path: ${vaultPath}`);
  }
  if (!process.env.OBSIDIAN_REST_TOKEN) {
    logWarn(`OBSIDIAN_REST_TOKEN is not set in environment. Optional REST API access will not be enabled.`);
  }

  // 1. Vault Directory Check
  if (!fs.existsSync(vaultPath)) {
    logFail(`Vault directory not found at: ${vaultPath}`);
    await finishReport();
    return;
  }
  logPass(`Vault directory exists: ${vaultPath}`);

  // 2. .obsidian Check
  const obsidianDir = path.join(vaultPath, ".obsidian");
  if (!fs.existsSync(obsidianDir)) {
    logFail(`.obsidian folder not found inside vault.`);
  } else {
    logPass(`.obsidian folder exists.`);
  }

  // 3. Plugin Folder Checks
  const requiredPlugins = [
    "dataview",
    "templater-obsidian",
    "obsidian-spaced-repetition",
    "quickadd",
    "obsidian-local-rest-api",
  ];
  const pluginsDir = path.join(obsidianDir, "plugins");

  for (const p of requiredPlugins) {
    const pPath = path.join(pluginsDir, p);
    if (!fs.existsSync(pPath)) {
      logFail(`Plugin directory missing: .obsidian/plugins/${p}`);
    } else {
      const manifestExists = fs.existsSync(path.join(pPath, "manifest.json"));
      const mainExists = fs.existsSync(path.join(pPath, "main.js"));
      if (!manifestExists || !mainExists) {
        logFail(`Plugin ${p} is missing required files (main.js or manifest.json).`);
      } else {
        logPass(`Plugin files validated: ${p}`);
      }
    }
  }

  // 4. Enabled Plugins Check
  const communityPluginsFile = path.join(obsidianDir, "community-plugins.json");
  if (!fs.existsSync(communityPluginsFile)) {
    logFail(`community-plugins.json missing in .obsidian/`);
  } else {
    try {
      const enabledList: string[] = JSON.parse(fs.readFileSync(communityPluginsFile, "utf-8"));
      for (const p of requiredPlugins) {
        if (!enabledList.includes(p)) {
          logFail(`Plugin is installed but NOT enabled in community-plugins.json: ${p}`);
        } else {
          logPass(`Plugin is enabled: ${p}`);
        }
      }
    } catch {
      logFail(`Failed to parse community-plugins.json as valid JSON.`);
    }
  }

  // 5. Folder Structure Checks
  const requiredFolders = [
    "00_HQ",
    "01_Inbox",
    "10_Statenour",
    "10_Statenour/Missions",
    "10_Statenour/Goals",
    "10_Statenour/Reflections",
    "20_Operator_Rules",
    "30_Projects",
    "40_Archive",
    "Statenour/Templates",
    "Statenour/Quarantine",
  ];

  for (const folder of requiredFolders) {
    const fPath = path.join(vaultPath, folder);
    if (!fs.existsSync(fPath)) {
      if (fixMode) {
        try {
          fs.mkdirSync(fPath, { recursive: true });
          logPass(`Fixed: Created cockpit folder structure: ${folder}`);
        } catch (err) {
          logFail(`Failed to create cockpit folder structure ${folder}: ${err}`);
        }
      } else {
        logFail(`Cockpit folder structure missing: ${folder}`);
      }
    } else {
      logPass(`Cockpit folder exists: ${folder}`);
    }
  }

  // 6. Required Files Check
  const hqFile = path.join(vaultPath, "HQ.md");
  if (!fs.existsSync(hqFile)) {
    logFail(`HQ.md cockpit dashboard file is missing.`);
  } else {
    // Check HQ.md markdown Dataview fences (Phase 5.5)
    try {
      const hqContent = fs.readFileSync(hqFile, "utf-8");
      const fenceMatches = hqContent.match(/```dataview/g) || [];
      const closingMatches = hqContent.match(/```/g) || [];
      // Fences are valid if we have equal matching or closed fences
      if (closingMatches.length < fenceMatches.length * 2) {
        logFail(`HQ.md appears to contain unclosed markdown code fences.`);
      } else {
        logPass(`HQ.md dashboard fences validated.`);
      }
    } catch {
      logFail(`Failed to read HQ.md file.`);
    }
  }

  const templatesDir = path.join(vaultPath, "Statenour", "Templates");
  const requiredTemplates = [
    "Cockpit Note Template.md",
    "Mission Template.md",
    "Decision Template.md",
    "Rule Template.md",
    "Daily Capture Template.md",
  ];

  for (const t of requiredTemplates) {
    const tPath = path.join(templatesDir, t);
    if (!fs.existsSync(tPath)) {
      logFail(`Required note template missing: Statenour/Templates/${t}`);
    } else {
      logPass(`Required template exists: ${t}`);
    }
  }

  // 7. Frontmatter & Note Checks
  if (!jsonMode) {
    console.log(`\nScanning note files recursively for metadata anomalies...`);
  }

  const noteFiles = getFilesRecursive(vaultPath);
  const seenStatenourIds: Record<string, string[]> = {};
  const seenTitlesInFolders: Record<string, string[]> = {};

  for (const noteFile of noteFiles) {
    const relativeNotePath = noteFile.substring(vaultPath.length + 1);
    
    // Check unreadable/placeholder files (OneDrive safety)
    let content = "";
    try {
      content = fs.readFileSync(noteFile, "utf-8");
      if (content.length === 0) {
        logWarn(`Note is empty.`, noteFile);
        continue;
      }
    } catch (readErr) {
      logFail(`Unreadable/offline file detected (OneDrive placeholder issue?): ${relativeNotePath}`, noteFile);
      continue;
    }

    // Scan for token patterns
    for (const pattern of TOKEN_PATTERNS) {
      if (pattern.regex.test(content)) {
        logWarn(`Potential secret detected (${pattern.name}). Avoid storing access keys in notes.`, noteFile);
      }
    }

    // Parse Frontmatter
    let { metadata, error } = parseFrontmatter(content);
    if (error) {
      logFail(`Frontmatter syntax error: ${error}`, noteFile);
      continue;
    }

    if (fixMode) {
      const fixedContent = fixNoteFrontmatter(content);
      if (fixedContent !== null && fixedContent !== content) {
        try {
          fs.writeFileSync(noteFile, fixedContent, "utf-8");
          content = fixedContent;
          const reParsed = parseFrontmatter(content);
          metadata = reParsed.metadata;
          logPass(`Fixed frontmatter in-place (normalized status, source, or updated_at) for ${path.basename(noteFile)}.`);
        } catch (writeErr) {
          logFail(`Failed to write fixed frontmatter: ${writeErr}`, noteFile);
        }
      }
    }

    const category = metadata.category;
    const status = metadata.status;
    const syncDirection = metadata.sync_direction;
    const reviewDue = metadata.review_due;
    const statenourId = metadata.statenour_id;
    const title = String(metadata.title || path.basename(noteFile, ".md"));

    // Title duplicate validation within folder (Phase 8.5)
    const folderPath = path.dirname(noteFile);
    if (!seenTitlesInFolders[folderPath]) {
      seenTitlesInFolders[folderPath] = [];
    }
    if (seenTitlesInFolders[folderPath].includes(title.toLowerCase())) {
      logWarn(`Duplicate note title "${title}" detected in folder: ${path.basename(folderPath)}`, noteFile);
    } else {
      seenTitlesInFolders[folderPath].push(title.toLowerCase());
    }

    // sync_direction check
    if (syncDirection) {
      const dirLower = syncDirection.toLowerCase();
      if (dirLower !== "bidirectional" && dirLower !== "obsidian_to_statenour" && dirLower !== "none") {
        logFail(`Invalid sync_direction value: "${syncDirection}"`, noteFile);
      }
    }

    // Category validation
    if (!category) {
      // Allow dashboard notes to have sync_direction: none without a category
      if (syncDirection === "none") {
        // Safe
      } else {
        logWarn(`Missing 'category' property. Note will route to personal_development or quarantine.`, noteFile);
      }
    } else {
      if (!KNOWN_BRAIN_CATEGORIES.has(category)) {
        logWarn(`Category "${category}" is not in the Statenour BRAIN_CATEGORIES registry.`, noteFile);
      }
    }

    // Bidirectional ID validation (Phase 8.5)
    if (syncDirection === "bidirectional") {
      if (!statenourId) {
        logWarn(`Note has sync_direction: "bidirectional" but is missing its "statenour_id".`, noteFile);
      }
    }

    // Track duplicate statenour_id
    if (statenourId) {
      if (!seenStatenourIds[statenourId]) {
        seenStatenourIds[statenourId] = [];
      }
      seenStatenourIds[statenourId].push(noteFile);
    }

    // Active review_due check
    if (status === "active") {
      if (!reviewDue) {
        logWarn(`Active note is missing required 'review_due' metadata.`, noteFile);
      }
    }

    // Warn on sync_direction: none outside dashboards/templates (Phase 8.5)
    if (syncDirection === "none") {
      const parentDir = path.basename(path.dirname(noteFile));
      const filename = path.basename(noteFile);
      if (parentDir !== "Templates" && filename !== "HQ.md") {
        logWarn(`Note has sync_direction: "none" but resides outside HQ dashboard/templates folder.`, noteFile);
      }
    }
  }

  // Check duplicate statenour_id (Phase 8.5)
  for (const [id, files] of Object.entries(seenStatenourIds)) {
    if (files.length > 1) {
      logFail(`Duplicate statenour_id "${id}" detected across multiple notes:\n` + files.map(f => `        - ${f}`).join("\n"));
    }
  }

  await finishReport(noteFiles);
}

function getSuggestedFix(message: string): string | undefined {
  if (message.includes("missing required 'review_due'")) {
    return "Add 'review_due: YYYY-MM-DD' to the YAML frontmatter.";
  }
  if (message.includes("missing 'category'")) {
    return "Add 'category: <category>' (e.g. planning, physical, business, discipline, spiritual, or ai_config) to the frontmatter.";
  }
  if (message.includes("missing its \"statenour_id\"")) {
    return "Statenour ID will be assigned on next export, or add 'statenour_id: <id>' if it already exists in the database.";
  }
  if (message.includes("Duplicate note title")) {
    return "Rename the note to ensure unique filenames within the folder.";
  }
  if (message.includes("Invalid sync_direction")) {
    return "Set sync_direction to 'bidirectional', 'obsidian_to_statenour', or 'none'.";
  }
  return undefined;
}

async function finishReport(noteFilesList: string[] = []) {
  const quarantinedFiles: QuarantinedFileInfo[] = [];
  const quarantineDir = path.join(vaultPath, "Statenour", "Quarantine");
  if (fs.existsSync(quarantineDir)) {
    try {
      const qFiles = fs.readdirSync(quarantineDir).filter(f => f.endsWith(".md") || f.endsWith(".txt"));
      for (const qFile of qFiles) {
        quarantinedFiles.push({
          filename: qFile,
          relativePath: path.join("Statenour", "Quarantine", qFile),
          reason: "Missing category frontmatter property or failing metadata validation.",
          detected_at: new Date().toISOString(),
          suggested_fix: "Add valid YAML frontmatter containing 'category: <category>' to this note and move it back to 01_Inbox/ or 10_Statenour/."
        });
      }
    } catch {}
  }

  if (!noStatusWrite) {
    try {
      const existingStatus = readEngineStatus();
      const hasFailures = failCount > 0;
      const hasWarnings = warnCount > 0;
      const health = hasFailures ? "error" : (hasWarnings ? "degraded" : "healthy");

      const statusPayload: ObsidianEngineStatus = {
        health,
        lastRunAt: new Date().toISOString(),
        lastDoctorRunAt: new Date().toISOString(),
        lastIngestRunAt: existingStatus ? existingStatus.lastIngestRunAt : null,
        lastExportRunAt: existingStatus ? existingStatus.lastExportRunAt : null,
        stats: {
          totalNotes: noteFilesList.length,
          processed: noteFilesList.length,
          synced: existingStatus ? existingStatus.stats.synced : 0,
          skipped: existingStatus ? existingStatus.stats.skipped : 0,
          failed: failCount,
          quarantined: quarantinedFiles.length,
          warnings: warnCount,
          failures: failCount,
        },
        issues: issues.map(issue => ({
          type: issue.type,
          message: issue.message,
          file: issue.file ? path.relative(vaultPath, issue.file) : undefined,
          detected_at: new Date().toISOString(),
          suggested_fix: getSuggestedFix(issue.message)
        })),
        quarantinedFiles,
        config: {
          vaultPath,
          icloudShortcutsPath: engineConfig.icloudShortcutsPath,
          syncMode: engineConfig.syncMode,
          restUrl: engineConfig.restUrl
        }
      };

      await writeEngineStatus(statusPayload);
    } catch (writeErr) {
      if (!jsonMode) {
        console.error("  ⚠️ Failed to write engine status file:", writeErr);
      }
    }
  }

  if (jsonMode) {
    const report = {
      vaultPath,
      success: failCount === 0 && (!strict || warnCount === 0),
      stats: {
        pass: passCount,
        warn: warnCount,
        fail: failCount,
        quarantined: quarantinedFiles.length,
      },
      issues,
      quarantinedFiles,
    };
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  Diagnostic Summary:`);
    console.log(`    - Passed: ${passCount}`);
    console.log(`    - Warned: ${warnCount}`);
    console.log(`    - Failed: ${failCount}`);
    console.log(`    - Quarantined: ${quarantinedFiles.length}`);
    console.log("═══════════════════════════════════════════════════════════");

    if (failCount > 0) {
      console.log(`\n  ❌ HEALTH CHECK FAILED: Please resolve the FAIL issues listed above.`);
      process.exit(1);
    } else if (strict && warnCount > 0) {
      console.log(`\n  ❌ HEALTH CHECK FAILED (strict mode): Resolved warnings required.`);
      process.exit(1);
    } else {
      console.log(`\n  🎉 HEALTH CHECK PASSED! Vault is fully operational.`);
      process.exit(0);
    }
  }
}

main().catch((err) => {
  console.error("❌ Doctor script crashed:", err);
  process.exit(1);
});
