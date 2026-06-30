/**
 * scripts/compile-marketing-agents.ts
 *
 * Scans apps/statenour/lib/ai/agents/marketing/ directory for marketing-*.md files.
 * Parses frontmatter and body, mapping them to the typed Persona format.
 * Generates apps/statenour/lib/ai/agents/marketing/registry.ts at build time.
 */

import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const MARKETING_DIR = existsSync(resolve(process.cwd(), "lib/ai/agents/marketing"))
  ? resolve(process.cwd(), "lib/ai/agents/marketing")
  : resolve(process.cwd(), "apps/statenour/lib/ai/agents/marketing");
const OUTPUT_FILE = join(MARKETING_DIR, "registry.ts");

interface Persona {
  key: string;
  role: string;
  goal: string;
  backstory: string;
  outputHint: string;
  color?: string;
  emoji?: string;
  vibe?: string;
}

function parseFrontmatter(text: string): { fm: Record<string, string>, body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { fm: {}, body: text };

  const fm: Record<string, string> = {};
  const yamlSection = m[1];
  const body = text.slice(m[0].length).trim();

  for (const line of yamlSection.split(/\r?\n/)) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const [, key, raw] = kv;
    fm[key] = raw.trim().replace(/^["']|["']$/g, "");
  }

  return { fm, body };
}

function main() {
  console.log("=== compiling marketing agents into static registry ===");

  if (!existsSync(MARKETING_DIR)) {
    console.error(`Directory not found: ${MARKETING_DIR}`);
    process.exit(1);
  }

  const files = readdirSync(MARKETING_DIR).filter(
    (f) => f.startsWith("marketing-") && f.endsWith(".md")
  );

  console.log(`Found ${files.length} marketing agent Markdown files.`);

  const registry: Record<string, Persona> = {};

  for (const file of files) {
    const key = file.replace(/\.md$/, "");
    const fullPath = join(MARKETING_DIR, file);
    const content = readFileSync(fullPath, "utf8");

    const { fm, body } = parseFrontmatter(content);

    const role = fm.name || key.replace(/^marketing-/, "").replace(/-/g, " ");
    const goal = fm.description || fm.vibe || "Execute marketing operations.";
    const backstory = body;
    const outputHint = "Deliver structured, professional marketing execution strategy or content directly mapped to your workflows. Max 400 words.";

    registry[key] = {
      key,
      role,
      goal,
      backstory,
      outputHint,
      color: fm.color,
      emoji: fm.emoji,
      vibe: fm.vibe,
    };
  }

  const tsContent = `/**
 * Generated automatically by scripts/compile-marketing-agents.ts.
 * Do not modify this file manually.
 */

export interface MarketingPersona {
  key: string;
  role: string;
  goal: string;
  backstory: string;
  outputHint: string;
  color?: string;
  emoji?: string;
  vibe?: string;
}

export const MARKETING_REGISTRY: Record<string, MarketingPersona> = ${JSON.stringify(registry, null, 2)};
`;

  writeFileSync(OUTPUT_FILE, tsContent, "utf8");
  console.log(`Wrote static registry to ${OUTPUT_FILE}`);
}

main();
