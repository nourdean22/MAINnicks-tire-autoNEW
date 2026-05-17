/**
 * Cron fleet audit — aggregate last-7d CronJobLog by jobName,
 * sort by failure count, write a human-readable report.
 *
 * Usage:
 *   pnpm tsx scripts/cron-fleet-audit.ts
 *   pnpm tsx scripts/cron-fleet-audit.ts 14    # 14 days instead of 7
 */
import { prisma } from "../lib/prisma";
import { writeFileSync } from "node:fs";

const DAYS = Number(process.argv[2] || 7);

interface JobStats {
  jobName: string;
  runs: number;
  fails: number;
  successRate: number;
  avgDurationMs: number;
  lastError: string | null;
  lastErrorAt: Date | null;
  lastSuccessAt: Date | null;
}

(async () => {
  const cutoff = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  const rows = await prisma.cronJobLog.findMany({
    where: { createdAt: { gte: cutoff } },
    orderBy: { createdAt: "desc" },
    select: {
      jobName: true,
      status: true,
      duration: true,
      error: true,
      createdAt: true,
    },
  });

  const byJob = new Map<string, JobStats>();
  for (const r of rows) {
    let s = byJob.get(r.jobName);
    if (!s) {
      s = {
        jobName: r.jobName,
        runs: 0,
        fails: 0,
        successRate: 0,
        avgDurationMs: 0,
        lastError: null,
        lastErrorAt: null,
        lastSuccessAt: null,
      };
      byJob.set(r.jobName, s);
    }
    s.runs++;
    s.avgDurationMs = Math.round((s.avgDurationMs * (s.runs - 1) + (r.duration ?? 0)) / s.runs);
    if (r.status === "failed") {
      s.fails++;
      if (!s.lastErrorAt || r.createdAt > s.lastErrorAt) {
        s.lastError = r.error;
        s.lastErrorAt = r.createdAt;
      }
    } else if (r.status === "completed" || r.status === "success") {
      if (!s.lastSuccessAt || r.createdAt > s.lastSuccessAt) {
        s.lastSuccessAt = r.createdAt;
      }
    }
  }
  for (const s of byJob.values()) {
    s.successRate = s.runs > 0 ? (s.runs - s.fails) / s.runs : 0;
  }

  const all = [...byJob.values()].sort((a, b) => b.fails - a.fails || a.successRate - b.successRate);

  // Console summary
  console.log(`\n═══ CRON FLEET AUDIT · last ${DAYS}d · ${rows.length} runs across ${all.length} jobs ═══\n`);
  const fmt = (s: JobStats) =>
    `${s.jobName.padEnd(26)}  runs=${String(s.runs).padStart(3)}  fails=${String(s.fails).padStart(3)}  ok=${(s.successRate * 100).toFixed(0).padStart(3)}%  avg=${String(s.avgDurationMs).padStart(5)}ms`;

  const failing = all.filter((s) => s.fails > 0);
  const clean = all.filter((s) => s.fails === 0);
  if (failing.length > 0) {
    console.log("── FAILING ──");
    for (const s of failing) console.log(fmt(s));
  }
  if (clean.length > 0) {
    console.log("\n── CLEAN ──");
    for (const s of clean) console.log(fmt(s));
  }

  // Markdown report
  const date = new Date().toISOString().slice(0, 10);
  let md = `# Cron Fleet Audit · ${date}\n\n`;
  md += `Window: last **${DAYS} days** · ${rows.length} total runs across ${all.length} jobs.\n\n`;

  if (failing.length === 0) {
    md += `✅ **All crons clean.** No failures in the audit window.\n\n`;
  } else {
    md += `## Failing jobs (${failing.length})\n\n`;
    md += `| Job | Runs | Fails | Success % | Avg duration | Last error | Last error at |\n`;
    md += `|-----|------|-------|-----------|--------------|------------|----------------|\n`;
    for (const s of failing) {
      const err = (s.lastError ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 160);
      md += `| \`${s.jobName}\` | ${s.runs} | ${s.fails} | ${(s.successRate * 100).toFixed(0)}% | ${s.avgDurationMs}ms | ${err || "—"} | ${s.lastErrorAt ? s.lastErrorAt.toISOString() : "—"} |\n`;
    }
    md += `\n## Fix-spec per failing job\n\n`;
    for (const s of failing) {
      md += `### \`${s.jobName}\` (${s.fails}/${s.runs} failed · ${(s.successRate * 100).toFixed(0)}%)\n\n`;
      md += `**Last error** (\`${s.lastErrorAt?.toISOString()}\`):\n\`\`\`\n${s.lastError ?? "(no error text recorded)"}\n\`\`\`\n\n`;
      md += `- [ ] Root cause identified\n- [ ] Fix implemented\n- [ ] Verified next run succeeds\n\n`;
    }
  }

  md += `## Clean jobs (${clean.length})\n\n`;
  md += `| Job | Runs | Avg duration | Last success |\n`;
  md += `|-----|------|--------------|--------------|\n`;
  for (const s of clean) {
    md += `| \`${s.jobName}\` | ${s.runs} | ${s.avgDurationMs}ms | ${s.lastSuccessAt ? s.lastSuccessAt.toISOString() : "—"} |\n`;
  }

  const reportPath = `docs/cron-health-${date}.md`;
  writeFileSync(reportPath, md, "utf8");
  console.log(`\n✓ wrote ${reportPath}`);

  await prisma.$disconnect();
})();
