/**
 * scripts/audit-internal-links.ts · v10.0.417
 *
 * Scans all .tsx files for hrefs starting with `/` (internal nav)
 * and verifies the corresponding page.tsx exists. Surfaces dead
 * links so they can be redirected or removed.
 *
 * Catches the v10.0.330/309/312 cluster-merge fallout · pages were
 * deleted but consumers still link to old paths.
 *
 * Run · pnpm tsx scripts/audit-internal-links.ts
 */
import { readFile } from "node:fs/promises";
import { glob } from "glob";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const HREF_RE = /href=["']\/([^"'?#\s]*)/g;

async function main() {
  const root = process.cwd();
  const files = await glob("{app,components}/**/*.tsx", {
    ignore: ["**/node_modules/**", "**/.next/**"],
  });

  const dead: { file: string; line: number; path: string }[] = [];
  const seen = new Set<string>();

  for (const f of files) {
    const text = await readFile(resolve(root, f), "utf8");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      let m: RegExpExecArray | null;
      const re = new RegExp(HREF_RE.source, "g");
      while ((m = re.exec(lines[i])) !== null) {
        const path = `/${m[1]}`;
        if (!path.startsWith("/")) continue;
        if (path === "/" || path === "/api" || path.startsWith("/api/")) continue;
        if (path.includes("[") || path.includes("$")) continue; // skip dynamic templates
        // Check if a page.tsx exists at this path under (mastery)
        const pageRel = path === "/" ? "page.tsx" : `app/(mastery)${path}/page.tsx`;
        const pageRoot = path === "/" ? "page.tsx" : `app${path}/page.tsx`;
        if (existsSync(resolve(root, pageRel))) continue;
        if (existsSync(resolve(root, pageRoot))) continue;
        // Strip query/hash and try again
        const bare = path.split("?")[0].split("#")[0];
        const bareRel = `app/(mastery)${bare}/page.tsx`;
        const bareRoot = `app${bare}/page.tsx`;
        if (existsSync(resolve(root, bareRel))) continue;
        if (existsSync(resolve(root, bareRoot))) continue;
        if (seen.has(`${f}:${i + 1}:${path}`)) continue;
        seen.add(`${f}:${i + 1}:${path}`);
        dead.push({ file: f, line: i + 1, path });
      }
    }
  }

  if (dead.length === 0) {
    console.log("✓ no dead internal links · all pages reachable");
    return;
  }
  console.log(`✗ ${dead.length} dead internal link(s):\n`);
  const grouped = new Map<string, { file: string; line: number }[]>();
  for (const d of dead) {
    if (!grouped.has(d.path)) grouped.set(d.path, []);
    grouped.get(d.path)!.push({ file: d.file, line: d.line });
  }
  for (const [path, sites] of [...grouped.entries()].sort()) {
    console.log(`  ${path}  (${sites.length} site(s))`);
    for (const s of sites.slice(0, 3)) {
      console.log(`    · ${s.file}:${s.line}`);
    }
    if (sites.length > 3) console.log(`    · +${sites.length - 3} more`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
