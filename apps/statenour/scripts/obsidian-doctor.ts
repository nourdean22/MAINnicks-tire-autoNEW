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

// Parse CLI arguments
const args = process.argv.slice(2);
const strict = args.includes("--strict");
const jsonMode = args.includes("--json");

let vaultPath = process.env.OBSIDIAN_VAULT_PATH || "C:\\Users\\nourd\\OneDrive\\Documents\\Obsidian Vault";
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

// Recursive file scanner
function getFilesRecursive(dir: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      // Exclude system, backup, archive, quarantine and templates folders from strict validation
      if (
        file !== ".obsidian" &&
        file !== "node_modules" &&
        file !== ".git" &&
        file !== ".statenour-backups" &&
        file !== "40_Archive" &&
        file !== "Quarantine" &&
        file !== "Templates"
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
    finishReport();
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
      logFail(`Cockpit folder structure missing: ${folder}`);
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
    const relativeNotePath = noteFile.substring(vaultPath.Length + 1);
    
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

    // Parse Frontmatter
    const { metadata, error } = parseFrontmatter(content);
    if (error) {
      logFail(`Frontmatter syntax error: ${error}`, noteFile);
      continue;
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

  finishReport();
}

function finishReport() {
  if (jsonMode) {
    const report = {
      vaultPath,
      success: failCount === 0 && (!strict || warnCount === 0),
      stats: {
        pass: passCount,
        warn: warnCount,
        fail: failCount,
      },
      issues,
    };
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  Diagnostic Summary:`);
    console.log(`    - Passed: ${passCount}`);
    console.log(`    - Warned: ${warnCount}`);
    console.log(`    - Failed: ${failCount}`);
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
