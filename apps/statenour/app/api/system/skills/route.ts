/**
 * GET /api/system/skills · v10.0.425
 *
 * Serves the static skill registry at data/skills-registry.json.
 * Built by scripts/build-skill-registry.ts · re-run when new
 * skills are installed or removed.
 *
 * Query:
 *   ?q=<term>   · filter by name + description + tags substring
 *   ?cat=<x>    · filter by category
 *   ?limit=N    · cap results (default 50, max 500)
 *
 * Auth: requireSession.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { withTracing } from "@/lib/utils/with-tracing";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const dynamic = "force-dynamic";
export const revalidate = false;

interface SkillEntry {
  name: string;
  description: string;
  category?: string;
  tags?: string[];
  source?: string;
  risk?: string;
  path: string;
}

interface RegistryFile {
  generatedAt: string;
  totalSkills: number;
  sourceRoots: string[];
  skills: SkillEntry[];
}

let cache: { data: RegistryFile; loadedAt: number } | null = null;
const TTL_MS = 60 * 60 * 1000; // 1 hour · cheap re-read on registry rebuild

async function loadRegistry(): Promise<RegistryFile | null> {
  if (cache && Date.now() - cache.loadedAt < TTL_MS) return cache.data;
  try {
    const path = resolve(process.cwd(), "data", "skills-registry.json");
    const text = await readFile(path, "utf8");
    const data = JSON.parse(text) as RegistryFile;
    cache = { data, loadedAt: Date.now() };
    return data;
  } catch {
    return null;
  }
}

async function handler(req: NextRequest): Promise<Response> {
  // Auth: requireSession invoked below
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const cat = (url.searchParams.get("cat") ?? "").trim().toLowerCase();
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10)));
  // v10.0.428 · sort controls. Allowed values:
  //   name-asc   (default · alphabetical)
  //   name-desc
  //   category   (group by category, alpha within)
  //   risk       (safe → unknown → no risk-tag) so most-trusted first
  //   source     (alphabetical by source · official before community)
  //   tags       (most tags first · "richer" skills surface)
  //   relevance  (only meaningful with q · ranks name-match > tag-match
  //               > description-match)
  const sortKey = (url.searchParams.get("sort") ?? "name-asc").trim();

  const reg = await loadRegistry();
  if (!reg) {
    return NextResponse.json(
      {
        error: "registry not built",
        hint: "run `pnpm tsx scripts/build-skill-registry.ts` to generate data/skills-registry.json",
      },
      { status: 503 },
    );
  }

  let filtered = reg.skills;
  if (cat) {
    filtered = filtered.filter((s) => (s.category ?? "").toLowerCase() === cat);
  }
  if (q) {
    filtered = filtered.filter((s) => {
      if (s.name.toLowerCase().includes(q)) return true;
      if (s.description.toLowerCase().includes(q)) return true;
      if (s.tags?.some((t) => t.toLowerCase().includes(q))) return true;
      return false;
    });
  }

  // v10.0.428 · apply sort. Spread to avoid mutating the cached registry.
  const sorted = [...filtered];
  switch (sortKey) {
    case "name-desc":
      sorted.sort((a, b) => b.name.localeCompare(a.name));
      break;
    case "category":
      sorted.sort((a, b) => {
        const ca = (a.category ?? "zzz");
        const cb = (b.category ?? "zzz");
        if (ca !== cb) return ca.localeCompare(cb);
        return a.name.localeCompare(b.name);
      });
      break;
    case "risk": {
      // Risk priority · safe < none < unknown < (missing)
      const rank = (r?: string) => {
        if (r === "safe") return 0;
        if (r === "none") return 1;
        if (r === "unknown") return 2;
        return 3;
      };
      sorted.sort((a, b) => {
        const ra = rank(a.risk);
        const rb = rank(b.risk);
        if (ra !== rb) return ra - rb;
        return a.name.localeCompare(b.name);
      });
      break;
    }
    case "source":
      sorted.sort((a, b) => {
        const sa = a.source ?? "zzz";
        const sb = b.source ?? "zzz";
        if (sa !== sb) return sa.localeCompare(sb);
        return a.name.localeCompare(b.name);
      });
      break;
    case "tags":
      sorted.sort((a, b) => {
        const ta = a.tags?.length ?? 0;
        const tb = b.tags?.length ?? 0;
        if (ta !== tb) return tb - ta;
        return a.name.localeCompare(b.name);
      });
      break;
    case "relevance":
      if (q) {
        // Score · name-match=3, tag-match=2, description-match=1
        const score = (s: typeof sorted[number]) => {
          let n = 0;
          if (s.name.toLowerCase().includes(q)) n += 3;
          if (s.tags?.some((t) => t.toLowerCase().includes(q))) n += 2;
          if (s.description.toLowerCase().includes(q)) n += 1;
          // Bonus · name starts with q (operator probably wants it on top)
          if (s.name.toLowerCase().startsWith(q)) n += 4;
          return n;
        };
        sorted.sort((a, b) => {
          const diff = score(b) - score(a);
          if (diff !== 0) return diff;
          return a.name.localeCompare(b.name);
        });
      } else {
        sorted.sort((a, b) => a.name.localeCompare(b.name));
      }
      break;
    case "name-asc":
    default:
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
  }

  // Category facet · always computed against full corpus so the UI
  // can show category counts even after filter applied.
  const categories = new Map<string, number>();
  for (const s of reg.skills) {
    const c = s.category ?? "(uncategorized)";
    categories.set(c, (categories.get(c) ?? 0) + 1);
  }

  return NextResponse.json({
    generatedAt: reg.generatedAt,
    totalSkills: reg.totalSkills,
    sourceRoots: reg.sourceRoots,
    matchCount: sorted.length,
    sort: sortKey,
    skills: sorted.slice(0, limit),
    categories: [...categories.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count })),
  });
}

// Auth: handler above invokes requireSession on first line.
export const GET = withTracing(handler, { name: "/api/system/skills" });
