/**
 * scripts/build-skill-registry.ts · v10.0.425
 *
 * Scans ~/.claude/skills/ + plugin skill directories · extracts each
 * skill's name, description, category, tags, source · writes a
 * structured registry to data/skills-registry.json.
 *
 * The registry powers /system/skills (a new operator surface that
 * shows what's installed + which surfaces each skill applies to).
 *
 * Output shape:
 *   {
 *     generatedAt: ISO,
 *     totalSkills: number,
 *     skills: [
 *       { name, description, category?, tags?, source?, path }
 *     ]
 *   }
 */

import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

interface SkillEntry {
  name: string;
  description: string;
  category?: string;
  tags?: string[];
  source?: string;
  risk?: string;
  path: string;
}

const SKILL_ROOTS = [
  join(homedir(), ".claude", "skills"),
  join(homedir(), ".claude", "plugins", "marketplaces", "andrej-karpathy-skills", "skills"),
  join(homedir(), ".claude", "plugins", "cache", "claude-plugins-official"),
];

function parseFrontmatter(text: string): Record<string, string | string[]> {
  // Frontmatter is wrapped in --- · ---. Parse YAML-ish lines.
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string | string[]> = {};
  let inList: string | null = null;
  let listAcc: string[] = [];
  for (const line of m[1].split("\n")) {
    if (inList) {
      const listMatch = line.match(/^\s*-\s+(.+?)\s*$/);
      if (listMatch) {
        listAcc.push(listMatch[1].replace(/^["']|["']$/g, ""));
        continue;
      } else {
        out[inList] = listAcc;
        inList = null;
        listAcc = [];
      }
    }
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const [, key, raw] = kv;
    const trimmed = raw.trim();
    if (trimmed === "" && line.endsWith(":")) {
      // Maybe followed by a list
      inList = key;
      listAcc = [];
      continue;
    }
    // Inline list "[a, b, c]"
    const inlineList = trimmed.match(/^\[(.*)\]$/);
    if (inlineList) {
      out[key] = inlineList[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      continue;
    }
    // String (quoted or bare)
    out[key] = trimmed.replace(/^["']|["']$/g, "");
  }
  if (inList) out[inList] = listAcc;
  return out;
}

function readSkill(name: string, dir: string): SkillEntry | null {
  const skillFile = join(dir, "SKILL.md");
  if (!existsSync(skillFile)) return null;
  let text: string;
  try {
    text = readFileSync(skillFile, "utf8");
  } catch {
    return null;
  }
  const fm = parseFrontmatter(text);
  // Description fallback: first non-frontmatter, non-heading paragraph.
  let description = (fm.description as string) ?? "";
  if (!description) {
    const after = text.replace(/^---[\s\S]*?---\n?/, "");
    const paragraphs = after.split(/\n\s*\n/);
    const firstReal = paragraphs.find((p) => p.trim() && !p.trim().startsWith("#"));
    description = firstReal ? firstReal.replace(/\s+/g, " ").trim().slice(0, 240) : "";
  }
  return {
    name: (fm.name as string) ?? name,
    description: description.slice(0, 400),
    category: (fm.category as string) ?? undefined,
    tags: (fm.tags as string[]) ?? undefined,
    source: (fm.source as string) ?? undefined,
    risk: (fm.risk as string) ?? undefined,
    path: dir,
  };
}

function scanRoot(root: string): SkillEntry[] {
  if (!existsSync(root)) return [];
  const entries: SkillEntry[] = [];
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    let s: ReturnType<typeof statSync>;
    try { s = statSync(full); } catch { continue; }
    if (!s.isDirectory()) continue;
    const e = readSkill(name, full);
    if (e) entries.push(e);
  }
  return entries;
}

function main() {
  console.log("=== building skill registry · v10.0.425 ===\n");
  const all: SkillEntry[] = [];
  const seen = new Set<string>();
  for (const root of SKILL_ROOTS) {
    const list = scanRoot(root);
    console.log(`  ${root.replace(homedir(), "~")} · ${list.length} skill(s)`);
    for (const s of list) {
      if (!seen.has(s.name)) {
        seen.add(s.name);
        all.push(s);
      }
    }
  }
  console.log(`\n  total unique: ${all.length}\n`);

  // Sort alphabetically for stable output
  all.sort((a, b) => a.name.localeCompare(b.name));

  // Top categories
  const byCategory = new Map<string, number>();
  for (const s of all) {
    const cat = s.category ?? "(uncategorized)";
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1);
  }
  console.log("top categories:");
  for (const [cat, count] of [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${cat.padEnd(28)} ${count}`);
  }

  // Write registry
  const dataDir = resolve(process.cwd(), "data");
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const out = {
    generatedAt: new Date().toISOString(),
    totalSkills: all.length,
    sourceRoots: SKILL_ROOTS.map((r) => r.replace(homedir(), "~")),
    skills: all,
  };
  const outPath = resolve(dataDir, "skills-registry.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nwrote ${outPath} · ${(JSON.stringify(out).length / 1024).toFixed(1)}KB`);
}

main();
