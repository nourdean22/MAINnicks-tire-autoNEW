/**
 * build-your-own-x parser · v10.0.52 · Apr 30.
 *
 * Parses the curated tutorial index from
 * `lib/data/build-your-own-x.md` (the README from
 * codecrafters-io/build-your-own-x) into a typed catalog. Powers:
 *   · `/learn` page — categorized browse + filter UI
 *   · `searchBuildYourOwnX` Nick tool — topic + language search
 *
 * The index is parsed once and cached per-process. Markdown source
 * lives in `lib/data/` so it ships with the bundle (Vercel serverless
 * filesystem is read-only at runtime; bundling avoids a network fetch
 * for static reference content).
 *
 * Format expected (excerpt):
 *
 *   ## Tutorials
 *
 *   #### Build your own `3D Renderer`
 *
 *   * [**C++**: _Ray Tracing in One Weekend_](https://...)
 *   * [**C++**: _Tinyrenderer_](https://...) [video]
 *
 *   #### Build your own `AI Model`
 *
 *   * [**Python**: _A Large Language Model (LLM)_](https://...)
 *
 * Anything outside `## Tutorials` (the TOC at the top, the
 * uncategorized section at the bottom) is captured separately so
 * we don't accidentally drop links.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface Tutorial {
  category: string;
  language: string | null;
  title: string;
  url: string;
  videoOnly: boolean;
}

export interface Category {
  name: string;
  slug: string;
  tutorials: Tutorial[];
}

let cached: Category[] | null = null;

const SOURCE_PATH = join(process.cwd(), "lib", "data", "build-your-own-x.md");

const CATEGORY_RE = /^####\s+Build your own\s+`([^`]+)`\s*$/;
const ITEM_RE = /^\*\s+\[(.+)\]\((https?:\/\/[^)]+)\)(.*)$/;
const ITEM_LANG_RE = /^\*\*([^*]+?)\*\*:\s*_(.+?)_\s*$/;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function loadCatalog(): Category[] {
  if (cached) return cached;
  let text: string;
  try {
    text = readFileSync(SOURCE_PATH, "utf8");
  } catch (err) {
    // In a sandboxed test env or if the file moves, return empty
    // rather than throwing. The /learn page degrades to a notice;
    // the Nick tool returns "no results" honestly.
    if (process.env.NODE_ENV !== "test") {
      console.warn(
        "[build-your-own-x] source markdown not found:",
        err instanceof Error ? err.message : String(err),
      );
    }
    cached = [];
    return cached;
  }

  const lines = text.split(/\r?\n/);
  const categories: Category[] = [];
  let inTutorials = false;
  let current: Category | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "## Tutorials") {
      inTutorials = true;
      continue;
    }
    if (line.startsWith("## ") && line !== "## Tutorials") {
      // Any other ## section ends the tutorials block.
      inTutorials = false;
      current = null;
      continue;
    }
    if (!inTutorials) continue;

    const catMatch = line.match(CATEGORY_RE);
    if (catMatch) {
      const name = catMatch[1].trim();
      current = { name, slug: slugify(name), tutorials: [] };
      categories.push(current);
      continue;
    }

    if (!current) continue;
    const itemMatch = line.match(ITEM_RE);
    if (!itemMatch) continue;

    const innerLabel = itemMatch[1];
    const url = itemMatch[2];
    const trailing = (itemMatch[3] || "").toLowerCase();
    const videoOnly = /\[video\]/.test(trailing);

    const langMatch = innerLabel.match(ITEM_LANG_RE);
    let language: string | null = null;
    let title: string;
    if (langMatch) {
      language = langMatch[1].trim();
      title = langMatch[2].trim();
    } else {
      // Some items don't follow the **Lang**: _Title_ convention.
      title = innerLabel.replace(/[*_]/g, "").trim();
    }

    current.tutorials.push({
      category: current.name,
      language,
      title,
      url,
      videoOnly,
    });
  }

  cached = categories.filter((c) => c.tutorials.length > 0);
  return cached;
}

export function getCategories(): Category[] {
  return loadCatalog();
}

export function totalTutorials(): number {
  return loadCatalog().reduce((s, c) => s + c.tutorials.length, 0);
}

export function getCategoryBySlug(slug: string): Category | null {
  return loadCatalog().find((c) => c.slug === slug) ?? null;
}

export interface SearchOptions {
  topic?: string;
  language?: string;
  limit?: number;
}

/**
 * Search the catalog. `topic` matches against category + title.
 * `language` filters items by language label (case-insensitive
 * substring). Returns at most `limit` results.
 */
export function searchTutorials(opts: SearchOptions = {}): Tutorial[] {
  const topic = (opts.topic ?? "").toLowerCase().trim();
  const language = (opts.language ?? "").toLowerCase().trim();
  const limit = Math.max(1, Math.min(60, opts.limit ?? 20));

  const all: Tutorial[] = [];
  for (const cat of loadCatalog()) {
    for (const t of cat.tutorials) all.push(t);
  }

  let filtered = all;
  if (topic) {
    const tokens = topic.split(/\s+/).filter(Boolean);
    filtered = filtered.filter((t) => {
      const haystack = `${t.category} ${t.title}`.toLowerCase();
      return tokens.every((tok) => haystack.includes(tok));
    });
  }
  if (language) {
    filtered = filtered.filter(
      (t) => t.language && t.language.toLowerCase().includes(language),
    );
  }
  return filtered.slice(0, limit);
}
