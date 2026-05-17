import fs from "fs";
import path from "path";

const NOUR_OS_ROOT = path.resolve(process.cwd(), "../..");

const KNOWLEDGE_DIRS = [
  { category: "Context", path: "knowledge/context" },
  { category: "Decisions", path: "knowledge/processed/decisions" },
  { category: "Commitments", path: "knowledge/processed/commitments" },
  { category: "Lessons", path: "knowledge/processed/lessons" },
  { category: "Patterns", path: "knowledge/processed/patterns" },
  { category: "Mastery", path: "mastery" },
  { category: "Mastery Patterns", path: "mastery/patterns" },
  { category: "Mastery Decisions", path: "mastery/decisions" },
  { category: "Mastery Accountability", path: "mastery/accountability" },
  { category: "Mastery Wisdom", path: "mastery/wisdom" },
  { category: "Mastery Financial", path: "mastery/financial" },
  { category: "Mastery Physical", path: "mastery/physical" },
  { category: "Mastery Mental", path: "mastery/mental" },
  { category: "Mastery Relationships", path: "mastery/relationships" },
  { category: "Mastery Strategy", path: "mastery/strategy" },
  { category: "Mastery Trajectory", path: "mastery/trajectory" },
  { category: "Business", path: "business/follow-ups" },
  { category: "Business SOPs", path: "business/sops" },
  { category: "Vault", path: "brain/50_vault" },
  { category: "Reports", path: "brain/60_reports" },
];

export interface KnowledgeFile {
  name: string;
  path: string;
  relativePath: string;
  category: string;
  size: number;
  modified: string;
}

export function listKnowledgeFiles(): KnowledgeFile[] {
  const files: KnowledgeFile[] = [];

  for (const dir of KNOWLEDGE_DIRS) {
    const fullPath = path.join(NOUR_OS_ROOT, dir.path);
    if (!fs.existsSync(fullPath)) continue;

    const entries = fs.readdirSync(fullPath).filter((f) => f.endsWith(".md"));
    for (const entry of entries) {
      const filePath = path.join(fullPath, entry);
      const stat = fs.statSync(filePath);
      files.push({
        name: entry.replace(".md", ""),
        path: filePath,
        relativePath: path.join(dir.path, entry).replace(/\\/g, "/"),
        category: dir.category,
        size: stat.size,
        modified: stat.mtime.toISOString().split("T")[0],
      });
    }
  }

  return files.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

export function readKnowledgeFile(relativePath: string): string | null {
  const fullPath = path.resolve(NOUR_OS_ROOT, relativePath);
  // Prevent path traversal — resolved path must stay within knowledge root
  if (!fullPath.startsWith(path.resolve(NOUR_OS_ROOT))) return null;
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, "utf-8");
}

export function searchKnowledge(query: string): Array<{ file: KnowledgeFile; matches: string[] }> {
  const files = listKnowledgeFiles();
  const results: Array<{ file: KnowledgeFile; matches: string[] }> = [];
  const queryLower = query.toLowerCase();

  for (const file of files) {
    const content = fs.readFileSync(file.path, "utf-8");
    const lines = content.split("\n");
    const matches: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(queryLower)) {
        // Include context: line before, matched line, line after
        const start = Math.max(0, i - 1);
        const end = Math.min(lines.length - 1, i + 1);
        matches.push(lines.slice(start, end + 1).join("\n").trim());
      }
    }

    if (matches.length > 0) {
      results.push({ file, matches: matches.slice(0, 5) }); // max 5 matches per file
    }
  }

  return results.sort((a, b) => b.matches.length - a.matches.length);
}
