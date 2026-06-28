import fs from "fs";
import path from "path";
import { BRAIN_CATEGORIES } from "../lib/brain/categories";
import { getObsidianEngineConfig } from "../lib/obsidian/engine-config";

// Invert the BRAIN_CATEGORIES object so we can map values back to their constant keys if needed, 
// though actually the values ARE the categories (e.g. "action_frequency").
const validCategories = Object.values(BRAIN_CATEGORIES);

function buildFrontmatter(metadata: Record<string, any>): string {
  let yaml = "---\n";
  for (const [key, val] of Object.entries(metadata)) {
    if (val === undefined || val === null) continue;
    if (Array.isArray(val)) {
      yaml += `${key}: [${val.map(v => typeof v === 'string' ? `"${v.replace(/"/g, '\\"')}"` : v).join(", ")}]\n`;
    } else if (typeof val === "object") {
      yaml += `${key}: ${JSON.stringify(val)}\n`;
    } else if (typeof val === "string") {
      yaml += `${key}: "${val.replace(/"/g, '\\"')}"\n`;
    } else {
      yaml += `${key}: ${val}\n`;
    }
  }
  yaml += "---\n";
  return yaml;
}

function processQuarantinedFiles() {
  const config = getObsidianEngineConfig();
  const quarantineDir = path.join(config.vaultPath, "Statenour", "Quarantine");
  
  if (!fs.existsSync(quarantineDir)) {
    console.log("No quarantine directory found at", quarantineDir);
    return;
  }

  const files = fs.readdirSync(quarantineDir);
  console.log(`Found ${files.length} files in quarantine.`);
  
  let fixedCount = 0;
  
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    
    const filePath = path.join(quarantineDir, file);
    const content = fs.readFileSync(filePath, "utf-8");
    
    // Check if it already has frontmatter
    if (content.trim().startsWith("---")) {
      console.log(`Skipping ${file} - already has frontmatter (might be broken, requires manual review).`);
      continue;
    }
    
    // Heuristics
    const nameNoExt = file.replace(/\.md$/, "");
    let category = "local"; // Default fallback
    
    if (nameNoExt.endsWith("_reflection")) {
      category = BRAIN_CATEGORIES.REFLECTION;
    } else {
      // Check if it matches an exact DB export name (e.g. "ACTION_FREQUENCY")
      const lowerName = nameNoExt.toLowerCase();
      // Most DB exports match the lowercase category directly
      if (validCategories.includes(lowerName as any)) {
        category = lowerName;
      }
    }
    
    console.log(`Fixing ${file} -> Category: ${category}`);
    
    const metadata = {
      title: nameNoExt,
      category: category,
      review_due: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString()
    };
    
    const newContent = buildFrontmatter(metadata) + content;
    
    // Move it up one level to Statenour so the watcher can re-ingest it
    const statenourDir = path.join(config.vaultPath, "Statenour");
    const newFilePath = path.join(statenourDir, file);
    
    fs.writeFileSync(newFilePath, newContent, "utf-8");
    fs.unlinkSync(filePath);
    fixedCount++;
  }
  
  console.log(`Successfully fixed and restored ${fixedCount} files!`);
}

processQuarantinedFiles();
