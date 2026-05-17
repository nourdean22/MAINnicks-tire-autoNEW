import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

const QUERIES = [
  "I need to clean up tech debt in a 1800-line React component",
  "How do I make my UI more accessible on mobile?",
  "Audit the database schema for missing indexes",
  "Build a launch plan for a new product",
  "Analyze my sleep patterns",
  "Write a clean Python script for data extraction",
  "Make my chat replies sharper · less corporate tone",
];

async function main() {
  const { recallSkills, formatSkillsBlock } = await import("@/lib/skills/skill-recall");
  console.log("=== skill-recall smoke ===\n");
  for (const q of QUERIES) {
    const t0 = Date.now();
    const matches = await recallSkills(q, 3);
    const ms = Date.now() - t0;
    console.log(`Q: "${q}"  (${ms}ms)`);
    for (const m of matches) {
      console.log(`  ${m.similarity.toFixed(2)} · ${m.name.padEnd(40)} ${m.description.slice(0, 80)}`);
    }
    console.log("");
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
