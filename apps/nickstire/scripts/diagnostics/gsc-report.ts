import dotenv from "dotenv";
import { resolve } from "path";
import fs from "fs";
import { getGscReport, getGscDbReport } from "../../server/pipelines/gsc-data";

// The populated .env lives at the monorepo root, not apps/nickstire/
// (which has no .env) — same resolution the inspect-vapi-* scripts use.
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const pos = (n: number) => n.toFixed(1);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let days = 90;
  const daysIdx = args.indexOf("--days");
  if (daysIdx !== -1 && args[daysIdx + 1]) {
    const parsed = parseInt(args[daysIdx + 1], 10);
    if (!isNaN(parsed) && parsed > 0) {
      days = parsed;
    }
  }

  // GSC data lags ~1 day; end the window there and span N days back.
  const end = new Date(Date.now() - 1 * 86400000);
  const start = new Date(end.getTime() - days * 86400000);
  const range = {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };

  let source = "Live Google Search Console API";
  let r;
  try {
    r = await getGscReport(range);
  } catch (e) {
    console.warn(
      `\n[Notice: GSC Live API failed or unconfigured, falling back to local database]:`,
      e instanceof Error ? e.message : e,
    );
    source = "Local Database Cache (TiDB/MySQL)";
    r = await getGscDbReport(range);
  }

  console.log(
    `\n=== GSC · nickstire.org · ${range.startDate} -> ${range.endDate} (${days} days) ===`,
  );
  console.log(`Source: ${source}\n`);
  console.log(
    `Clicks ${r.summary.clicks}  ·  Impressions ${r.summary.impressions}  ·  ` +
      `CTR ${pct(r.summary.ctr)}  ·  Avg position ${pos(r.summary.position)}\n`,
  );

  console.log(`Top queries (${r.topQueries.length}):`);
  for (const q of r.topQueries) {
    console.log(
      `  ${String(q.clicks).padStart(4)}c ${String(q.impressions).padStart(7)}i  ` +
        `${pct(q.ctr).padStart(6)}  pos ${pos(q.position).padStart(5)}  ${q.key}`,
    );
  }

  console.log(`\nTop pages (${r.topPages.length}):`);
  for (const p of r.topPages) {
    console.log(
      `  ${String(p.clicks).padStart(4)}c ${String(p.impressions).padStart(7)}i  ` +
        `${pct(p.ctr).padStart(6)}  pos ${pos(p.position).padStart(5)}  ${p.key}`,
    );
  }
  console.log("");

  const markdownContent = `# Google Search Console Performance Report
- **Property:** \`https://nickstire.org/\`
- **Period:** ${range.startDate} to ${range.endDate} (${days} days)
- **Data Source:** ${source}

## Summary Metrics
- **Total Clicks:** ${r.summary.clicks.toLocaleString()}
- **Total Impressions:** ${r.summary.impressions.toLocaleString()}
- **Average CTR:** ${pct(r.summary.ctr)}
- **Average Position:** ${pos(r.summary.position)}

## Top Queries (Top ${r.topQueries.length})
| Query | Clicks | Impressions | CTR | Position |
| :--- | :---: | :---: | :---: | :---: |
${r.topQueries.map((q) => `| ${q.key} | ${q.clicks.toLocaleString()} | ${q.impressions.toLocaleString()} | ${pct(q.ctr)} | ${pos(q.position)} |`).join("\n")}

## Top Pages (Top ${r.topPages.length})
| Page | Clicks | Impressions | CTR | Position |
| :--- | :---: | :---: | :---: | :---: |
${r.topPages.map((p) => `| ${p.key || "/"} | ${p.clicks.toLocaleString()} | ${p.impressions.toLocaleString()} | ${pct(p.ctr)} | ${pos(p.position)} |`).join("\n")}

---
*Report generated on ${new Date().toLocaleString()}*
`;

  const reportPath = resolve(process.cwd(), "gsc-performance-report.md");
  await fs.promises.writeFile(reportPath, markdownContent, "utf8");
  console.log(`Markdown report written to: ${reportPath}`);
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
