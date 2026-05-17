/**
 * scripts/find-skills-for-sort-filter.ts · v10.0.442
 *
 * Queries the v10.0.433 skill-recall layer to find skills relevant
 * to the sort+filter work shipped in v10.0.436-441. Each query
 * returns the top 5 matches with cosine similarity.
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

const QUERIES = [
  "build sortable filterable data tables in React",
  "performance optimization for sorting large lists",
  "accessibility for dropdowns and filter chips on mobile",
  "URL state for filters and sort persistence",
  "list virtualization for thousands of rows",
  "mobile UX patterns for sort and filter controls",
  "TanStack Table or similar data-grid frameworks",
  "design tokens for table row + chip + button consistency",
  "form validation for filter inputs",
  "search relevance ranking + cosine similarity",
];

async function main() {
  const { recallSkills } = await import("@/lib/skills/skill-recall");
  console.log("=== skills relevant to sort+filter work ===\n");

  const seen = new Set<string>();
  const composite: { name: string; description: string; bestQ: string; bestSim: number; queryHits: number }[] = [];

  for (const q of QUERIES) {
    process.stdout.write(`Q: ${q}\n`);
    const matches = await recallSkills(q, 5);
    for (const m of matches) {
      console.log(`  ${m.similarity.toFixed(2)} · ${m.name.padEnd(40)} ${m.description.slice(0, 80)}`);
      const existing = composite.find((x) => x.name === m.name);
      if (existing) {
        existing.queryHits++;
        if (m.similarity > existing.bestSim) {
          existing.bestSim = m.similarity;
          existing.bestQ = q;
        }
      } else {
        composite.push({
          name: m.name,
          description: m.description,
          bestQ: q,
          bestSim: m.similarity,
          queryHits: 1,
        });
      }
      seen.add(m.name);
    }
    console.log("");
  }

  // Top recommendations · ranked by query hits + similarity
  const ranked = composite
    .sort((a, b) => {
      if (b.queryHits !== a.queryHits) return b.queryHits - a.queryHits;
      return b.bestSim - a.bestSim;
    })
    .slice(0, 15);

  console.log("\n═══ TOP 15 SKILLS (ranked · multi-query hits + best similarity) ═══\n");
  for (const r of ranked) {
    console.log(`${r.queryHits} hits · best ${r.bestSim.toFixed(2)} on "${r.bestQ.slice(0, 50)}"`);
    console.log(`  · ${r.name}`);
    console.log(`    ${r.description.slice(0, 140)}`);
    console.log("");
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
