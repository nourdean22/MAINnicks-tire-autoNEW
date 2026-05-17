/**
 * Ingest Google Drive docs — reads a JSON export of Drive file content
 * (harvested via the Drive MCP) and stores each doc as a BrainMemory
 * entry so the full long-form knowledge corpus is searchable from
 * /brain + the AI tools.
 *
 * Input file shape (.tmp/drive-export.json):
 *   [
 *     {
 *       "id": "1Rr-AZN6...",
 *       "title": "Nick's Tire & Auto — Complete Project Knowledge Base",
 *       "mimeType": "application/vnd.google-apps.document",
 *       "modifiedTime": "2026-03-15T23:11:27.465Z",
 *       "content": "<full text body>",
 *       "viewUrl": "https://docs.google.com/document/d/..."
 *     },
 *     ...
 *   ]
 *
 * Categories — derived from title keywords so brand docs land in
 * brand_rules, knowledge-base docs land in business_context, etc:
 *   brand_rules        — "brand", "style", "voice", "tone"
 *   business_context   — "knowledge base", "project", "operations"
 *   marketing_context  — "marketing", "campaign", "strategy"
 *   revenue_playbook   — "revenue", "sales", "quotes", "pipeline"
 *   reference          — default fallback
 *
 * Dedupe: Drive file ID → memory key.
 *
 * Run with: npx tsx scripts/ingest-drive.ts [path-to-json]
 */

import * as fs from "fs";
import * as path from "path";

const envLocal = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocal)) {
  const raw = fs.readFileSync(envLocal, "utf-8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_]+)="?(.+?)"?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const envFile = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envFile)) {
  const raw = fs.readFileSync(envFile, "utf-8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_]+)="?(.+?)"?$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

import { prisma } from "@/lib/prisma";
import { brainMemory } from "@/lib/brain/memory-manager";

interface DriveDoc {
  id: string;
  title?: string;
  mimeType?: string;
  modifiedTime?: string;
  content?: string;
  viewUrl?: string;
}

function deriveCategory(doc: DriveDoc): string {
  const t = (doc.title || "").toLowerCase();
  if (/brand|style|voice|tone/.test(t)) return "brand_rules";
  if (/knowledge base|project|operations|nick's tire/.test(t)) return "business_context";
  if (/marketing|campaign|strategy|bot/.test(t)) return "marketing_context";
  if (/revenue|sales|quote|pipeline|financial/.test(t)) return "revenue_playbook";
  if (/website|audit/.test(t)) return "project_doc";
  if (/weekly|directive/.test(t)) return "project_doc";
  return "reference";
}

function buildContent(doc: DriveDoc): string {
  const parts: string[] = [];
  parts.push(`[${doc.title || "Untitled"}]`);
  if (doc.viewUrl) parts.push(`URL: ${doc.viewUrl}`);
  if (doc.modifiedTime) parts.push(`Modified: ${doc.modifiedTime.slice(0, 10)}`);
  parts.push("");
  const body = (doc.content || "").trim();
  parts.push(body.length > 4500 ? body.slice(0, 4500) + "..." : body);
  return parts.join("\n");
}

async function main() {
  const inputPath =
    process.argv[2] || path.resolve(process.cwd(), ".tmp", "drive-export.json");

  console.log("=== DRIVE INGEST ===\n");

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    console.error("Harvest Drive docs via the Drive MCP first, write to that path.");
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, "utf-8");
  let docs: DriveDoc[] = [];
  try {
    docs = JSON.parse(raw);
  } catch (err) {
    console.error("Invalid JSON:", (err as Error).message);
    process.exit(1);
  }
  if (!Array.isArray(docs)) {
    console.error("Input must be a JSON array of docs");
    process.exit(1);
  }

  console.log(`Loaded ${docs.length} docs from ${inputPath}`);

  const worthy = docs.filter(
    (d) => d.id && (d.content || "").trim().length > 50
  );
  console.log(`${worthy.length} worth ingesting (after filter)\n`);

  let stored = 0;
  let skipped = 0;
  const categoryCounts: Record<string, number> = {};

  for (const doc of worthy) {
    try {
      const category = deriveCategory(doc);
      const key = `drive_${doc.id}`;
      const content = buildContent(doc);
      await brainMemory.remember(category, key, content, "drive_ingest", {
        driveId: doc.id,
        title: doc.title,
        mimeType: doc.mimeType,
        viewUrl: doc.viewUrl,
      });
      stored++;
      categoryCounts[category] = (categoryCounts[category] || 0) + 1;
      console.log(`  ✓ [${category}] ${doc.title?.slice(0, 60) || doc.id}`);
    } catch (err) {
      skipped++;
      console.error(`  [skip] ${doc.id}: ${(err as Error).message}`);
    }
  }

  console.log(`\n→ ${stored} stored, ${skipped} skipped`);
  for (const [cat, n] of Object.entries(categoryCounts)) {
    console.log(`  ${cat.padEnd(22)} ${n}`);
  }

  await prisma.auditEvent
    .create({
      data: {
        actor: "drive_ingest",
        eventType: "drive_docs_ingested",
        detail: `Ingested ${stored} Drive docs from ${inputPath}`,
        payload: { total: docs.length, worthy: worthy.length, stored, skipped, categoryCounts },
      },
    })
    .catch(() => {});

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("DRIVE INGEST FAILED:", e);
  process.exit(1);
});
