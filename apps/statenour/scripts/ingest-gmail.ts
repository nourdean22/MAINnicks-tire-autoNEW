/**
 * Ingest Gmail — read a JSON export of email messages, classify each
 * for knowledge value, and store the substantial ones as BrainMemory
 * entries so they surface in /brain + semantic search.
 *
 * Input file shape (.tmp/gmail-export.json):
 *   [
 *     {
 *       "id": "18f5c3...",
 *       "from": "Nour Dean <nourdean22@gmail.com>",
 *       "to": "somebody@example.com",
 *       "subject": "Re: Quote",
 *       "date": "2026-04-10T14:22:00Z",
 *       "body": "full text of the message",
 *       "labels": ["SENT", "IMPORTANT"]
 *     },
 *     ...
 *   ]
 *
 * The Gmail MCP can populate this file — see commit message for the
 * one-liner harvester. This script is MCP-agnostic on purpose so it
 * can also run from a saved CSV/export or from a future cron that
 * pulls via the Gmail REST API directly.
 *
 * Dedupe: uses the Gmail message ID as the memory key so re-runs are
 * idempotent.
 *
 * Skip: boilerplate notifications, marketing, 2FA codes, shipping
 * updates, anything <120 chars of body, anything auto-generated.
 *
 * Run with: npx tsx scripts/ingest-gmail.ts [path-to-json]
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

interface GmailMsg {
  id: string;
  from?: string;
  to?: string;
  subject?: string;
  date?: string;
  body?: string;
  labels?: string[];
}

/**
 * Heuristic filter — is this message worth storing as knowledge?
 * Skips automated notifications, marketing, 2FA, shipping, too-short
 * replies, etc. Keeps substantial human conversations.
 */
function isWorthIngesting(m: GmailMsg): boolean {
  const body = (m.body || "").trim();
  if (body.length < 120) return false;

  const from = (m.from || "").toLowerCase();
  const subject = (m.subject || "").toLowerCase();
  const combined = `${from} ${subject}`;

  // Automated / no-reply senders
  if (/no.?reply|noreply|do.?not.?reply|notifications?@|alerts?@|updates?@/.test(from)) return false;
  if (/automated|account security|verification|password reset|2fa|code is|confirm your/.test(combined)) return false;
  if (/shipping|tracking|delivery|package|order (confirmation|shipped|delivered)/.test(subject)) return false;

  // Marketing
  if (/newsletter|unsubscribe|promotional|discount|deals?|sale/.test(combined)) return false;

  // Calendar invites (handled separately)
  if (/invitation|calendar invite|rsvp|declined|accepted/.test(subject)) return false;

  return true;
}

/**
 * Build the display content for the brain memory. Keeps it under
 * ~2000 chars so the memory stays focused.
 */
function buildMemoryContent(m: GmailMsg): string {
  const parts: string[] = [];
  if (m.subject) parts.push(`Subject: ${m.subject}`);
  if (m.from) parts.push(`From: ${m.from.slice(0, 80)}`);
  if (m.to) parts.push(`To: ${m.to.slice(0, 80)}`);
  if (m.date) parts.push(`Date: ${m.date.slice(0, 10)}`);
  parts.push("");
  const body = (m.body || "").replace(/\n{3,}/g, "\n\n").trim();
  parts.push(body.length > 1600 ? body.slice(0, 1600) + "..." : body);
  return parts.join("\n");
}

/**
 * Determine the category for a message. Outgoing messages (from Nour)
 * go into "gmail_outgoing" — those contain decisions + commitments
 * Nour has made. Incoming substantial ones go into "gmail_thread".
 */
function deriveCategory(m: GmailMsg): string {
  const from = (m.from || "").toLowerCase();
  const isOutgoing =
    from.includes("nourdean22@gmail.com") ||
    from.includes("nour@") ||
    (m.labels || []).includes("SENT");
  return isOutgoing ? "gmail_outgoing" : "gmail_thread";
}

async function main() {
  const inputPath =
    process.argv[2] ||
    path.resolve(process.cwd(), ".tmp", "gmail-export.json");

  console.log("=== GMAIL INGEST ===\n");

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    console.error("Harvest Gmail via the MCP first, write to that path, then re-run.");
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, "utf-8");
  let messages: GmailMsg[] = [];
  try {
    messages = JSON.parse(raw);
  } catch (err) {
    console.error("Input file is not valid JSON:", (err as Error).message);
    process.exit(1);
  }
  if (!Array.isArray(messages)) {
    console.error("Input file must contain a JSON array of messages");
    process.exit(1);
  }

  console.log(`Loaded ${messages.length} messages from ${inputPath}`);

  const worthy = messages.filter(isWorthIngesting);
  console.log(`${worthy.length} worth ingesting (after filter)`);

  let stored = 0;
  let skipped = 0;
  const categoryCounts: Record<string, number> = {};

  for (const msg of worthy) {
    try {
      const category = deriveCategory(msg);
      const key = `gmail_${msg.id}`;
      const content = buildMemoryContent(msg);
      await brainMemory.remember(category, key, content, "gmail_ingest", {
        messageId: msg.id,
        from: msg.from,
        subject: msg.subject,
        date: msg.date,
      });
      stored++;
      categoryCounts[category] = (categoryCounts[category] || 0) + 1;
      if (stored % 25 === 0) {
        console.log(`  ${stored}/${worthy.length} ingested`);
      }
    } catch (err) {
      skipped++;
      console.error(`  [skip] ${msg.id}: ${(err as Error).message}`);
    }
  }

  console.log(`\n→ ${stored} stored, ${skipped} skipped`);
  for (const [cat, n] of Object.entries(categoryCounts)) {
    console.log(`  ${cat.padEnd(20)} ${n}`);
  }

  await prisma.auditEvent
    .create({
      data: {
        actor: "gmail_ingest",
        eventType: "gmail_messages_ingested",
        detail: `Ingested ${stored} Gmail messages from ${inputPath}`,
        payload: { total: messages.length, worthy: worthy.length, stored, skipped, categoryCounts },
      },
    })
    .catch(() => {});

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("GMAIL INGEST FAILED:", e);
  process.exit(1);
});
