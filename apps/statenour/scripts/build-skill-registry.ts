/**
 * scripts/build-skill-registry.ts · v10.0.425 · AG-45 merge upgrade
 *
 * Scans ~/.claude/skills/ + plugin skill directories · extracts each
 * skill's name, description, category, tags, source · writes a
 * structured registry to data/skills-registry.json.
 *
 * The registry powers /system/skills (a new operator surface that
 * shows what's installed + which surfaces each skill applies to).
 *
 * AG-45 · MODES (the maxforge lesson: never full-rebuild from a
 * drifted machine — manual/surgical entries get clobbered and other
 * machines' skills silently vanish):
 *   default        REFUSES to overwrite an existing registry · tells
 *                  you to use --merge (or --force for a true rebuild).
 *   --merge        scan + merge INTO the existing registry: new skills
 *                  appended, scanned skills refreshed, registry-only
 *                  entries (not on this machine) PRESERVED.
 *   --dry-run      with --merge · print the add/update/preserve diff,
 *                  write nothing.
 *   --force        legacy full rebuild (destructive · drops entries
 *                  not present on this machine).
 *
 * Marketplaces are discovered GENERICALLY (every dir under
 * ~/.claude/plugins/marketplaces/<name>/skills) instead of the old
 * hardcoded single marketplace. Paths are stored ~-portable.
 *
 * NOTE · this writes data/skills-registry.json only. Prod embedding
 * (scripts/embed-skills.ts) stays a separate OPERATOR-ONLY step; use
 * scripts/audit-skill-embeddings.ts to see registry↔embedding drift.
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

/** AG-45 · marketplaces discovered generically — any marketplace
 *  installed later is picked up without editing this script. */
function skillRoots(): string[] {
  const roots = [join(homedir(), ".claude", "skills")];
  const marketplaceBase = join(homedir(), ".claude", "plugins", "marketplaces");
  if (existsSync(marketplaceBase)) {
    for (const mp of readdirSync(marketplaceBase)) {
      const skillsDir = join(marketplaceBase, mp, "skills");
      try {
        if (statSync(skillsDir).isDirectory()) roots.push(skillsDir);
      } catch { /* marketplace without a skills dir */ }
    }
  }
  roots.push(join(homedir(), ".claude", "plugins", "cache", "claude-plugins-official"));
  return roots;
}

/** Store paths machine-portable; expand on read wherever needed. */
function toPortablePath(p: string): string {
  return p.replace(homedir(), "~");
}

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

function scanAll(roots: string[]): SkillEntry[] {
  const all: SkillEntry[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    const list = scanRoot(root);
    console.log(`  ${toPortablePath(root)} · ${list.length} skill(s)`);
    for (const s of list) {
      if (!seen.has(s.name)) {
        seen.add(s.name);
        all.push({ ...s, path: toPortablePath(s.path) });
      }
    }
  }
  return all;
}

function writeRegistry(outPath: string, roots: string[], skills: SkillEntry[]): void {
  skills.sort((a, b) => a.name.localeCompare(b.name));

  const byCategory = new Map<string, number>();
  for (const s of skills) {
    const cat = s.category ?? "(uncategorized)";
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1);
  }
  console.log("top categories:");
  for (const [cat, count] of [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${cat.padEnd(28)} ${count}`);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    totalSkills: skills.length,
    sourceRoots: roots.map(toPortablePath),
    skills,
  };
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nwrote ${outPath} · ${(JSON.stringify(out).length / 1024).toFixed(1)}KB`);
}

function main() {
  const args = new Set(process.argv.slice(2));
  const merge = args.has("--merge");
  const dryRun = args.has("--dry-run");
  const force = args.has("--force");

  const dataDir = resolve(process.cwd(), "data");
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const outPath = resolve(dataDir, "skills-registry.json");
  const hasExisting = existsSync(outPath);

  if (hasExisting && !merge && !force) {
    console.error(
      "refusing to overwrite an existing registry with a full rebuild.\n" +
        "  · use --merge (safe: preserves entries not on this machine)\n" +
        "  · use --merge --dry-run to preview the diff\n" +
        "  · use --force ONLY for a deliberate destructive rebuild",
    );
    process.exit(1);
  }

  console.log(`=== ${merge ? "merging" : "building"} skill registry · v10.0.425${dryRun ? " · DRY RUN" : ""} ===\n`);
  const roots = skillRoots();
  const scanned = scanAll(roots);
  console.log(`\n  scanned unique: ${scanned.length}\n`);

  if (!merge) {
    writeRegistry(outPath, roots, scanned);
    return;
  }

  // ── --merge · scan INTO the existing registry ──
  const existing: SkillEntry[] = hasExisting
    ? ((JSON.parse(readFileSync(outPath, "utf8")) as { skills?: SkillEntry[] }).skills ?? [])
    : [];
  const existingByName = new Map(existing.map((s) => [s.name, s]));
  const scannedNames = new Set(scanned.map((s) => s.name));

  const added = scanned.filter((s) => !existingByName.has(s.name));
  const updated = scanned.filter((s) => {
    const old = existingByName.get(s.name);
    return old && JSON.stringify({ ...old, path: toPortablePath(old.path) }) !== JSON.stringify(s);
  });
  // Entries in the registry but NOT on this machine — manual inserts
  // (e.g. maxforge-weekly-intel) or skills installed on another
  // machine. PRESERVED — this is the whole point of --merge.
  const preserved = existing.filter((s) => !scannedNames.has(s.name));

  console.log(`merge diff:`);
  console.log(`  + added     ${added.length}${added.length ? "  · " + added.slice(0, 8).map((s) => s.name).join(", ") + (added.length > 8 ? " …" : "") : ""}`);
  console.log(`  ~ updated   ${updated.length}${updated.length ? "  · " + updated.slice(0, 8).map((s) => s.name).join(", ") + (updated.length > 8 ? " …" : "") : ""}`);
  console.log(`  = preserved ${preserved.length} (in registry · not on this machine)${preserved.length ? "  · " + preserved.slice(0, 8).map((s) => s.name).join(", ") + (preserved.length > 8 ? " …" : "") : ""}`);

  if (dryRun) {
    console.log("\nDRY RUN · nothing written.");
    return;
  }

  const mergedSkills = [...scanned, ...preserved];
  writeRegistry(outPath, roots, mergedSkills);
  console.log(`\nreminder: new skills need embedding before recall finds them — scripts/embed-skills.ts is OPERATOR-ONLY (prod DB). Audit drift with scripts/audit-skill-embeddings.ts.`);
}

main();
