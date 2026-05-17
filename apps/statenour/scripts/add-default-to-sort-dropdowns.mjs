#!/usr/bin/env node
/**
 * scripts/add-default-to-sort-dropdowns.mjs · v10.0.442
 *
 * One-time codemod · adds defaultValue prop to every <SortDropdown>
 * mount across the app. Pulls each page's default from the
 * localStorage init block.
 */
import { readFileSync, writeFileSync } from "node:fs";

const TARGETS = [
  ["app/(mastery)/brain/wisdom/page.tsx", "WisdomSort", "hotness"],
  ["app/(mastery)/journal/page.tsx", "JournalSort", "newest"],
  ["app/(mastery)/system/skills/page.tsx", "SortKey", "name-asc"],
  ["app/(mastery)/system/crons/page.tsx", "CronSort", "name"],
  ["app/(mastery)/system/logs/page.tsx", "LogSort", "newest"],
  ["app/(mastery)/system/actions/page.tsx", "ActionSort", "newest"],
  ["app/(mastery)/system/alerts/page.tsx", "AlertSort", "newest"],
  ["app/(mastery)/system/devices/page.tsx", "DeviceSort", "name"],
  ["app/(mastery)/system/repos/page.tsx", "RepoSort", "name"],
  ["app/(mastery)/system/policies/page.tsx", "PolicySort", "name"],
  ["app/(mastery)/system/agent-traces/page.tsx", "TraceSort", "newest"],
  ["app/(mastery)/system/tools/page.tsx", "ToolSort", "name"],
  ["app/(mastery)/integrations/page.tsx", "IntegrationSort", "name"],
  ["app/(mastery)/pins/page.tsx", "PinSort", "default"],
  ["app/(mastery)/content/history/page.tsx", "ContentSort", "newest"],
  ["app/(mastery)/knowledge/page.tsx", "KnowledgeSort", "name"],
  ["app/(mastery)/system/tire-stock-requests/page.tsx", "TireSort", "newest"],
];

let modified = 0;
for (const [file, typeName, defaultValue] of TARGETS) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch { console.log(`skip · ${file}`); continue; }

  // Match: <SortDropdown<TypeName>\n<spaces>value={...}\n<spaces>onChange={...}
  // Insert: defaultValue="<defaultValue>" line after onChange.
  const re = new RegExp(
    `(<SortDropdown<${typeName}>\\s*\\n\\s+value=\\{[^}]+\\}\\s*\\n\\s+onChange=\\{[^}]+\\})\\s*\\n`,
    "g",
  );
  if (text.includes(`<SortDropdown<${typeName}>`) && !text.includes(`defaultValue="${defaultValue}"`)) {
    const before = text;
    text = text.replace(re, (match, prefix) => {
      // Determine indent · grab spaces before "value="
      const indentMatch = match.match(/^(<SortDropdown<\w+>)\s*\n(\s+)value=/);
      const indent = indentMatch ? indentMatch[2] : "          ";
      return `${prefix}\n${indent}defaultValue="${defaultValue}"\n`;
    });
    if (text !== before) {
      writeFileSync(file, text);
      console.log(`✓ ${file}`);
      modified++;
    } else {
      console.log(`  ${file} · pattern not matched`);
    }
  } else {
    console.log(`= ${file} · already has defaultValue or no SortDropdown match`);
  }
}
console.log(`\n${modified} files modified`);
