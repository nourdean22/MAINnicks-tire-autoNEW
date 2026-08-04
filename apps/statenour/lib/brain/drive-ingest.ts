/**
 * Drive Ingest Pipeline — shared engine used by both the cron job
 * (/api/cron/ingest-drive) and the manual trigger (/api/drive/sync).
 *
 * Previously this logic lived inline inside the cron route. Extracted
 * so the Settings "Sync Now" button and the `syncDriveMemory` tool
 * can re-run the same pipeline without duplicating code.
 *
 * Flow:
 *   1. Check Google OAuth is configured (skip gracefully if not)
 *   2. List the N most recently modified Drive files
 *   3. Filter out noise (receipts, numeric filenames, etc.)
 *   4. For each worth-ingesting file:
 *        - Fetch metadata + content
 *        - Derive category from filename heuristics
 *        - Upsert into brain_memory with source marker
 *        - Trigger embedding storage (async, non-blocking)
 *   5. Log an audit event summarizing the run
 */

import { prisma } from "@/lib/prisma";
import { brainMemory } from "@/lib/brain/memory-manager";
import {
  listRecentFiles,
  getFileMetadata,
  getFileContent,
  type DriveDoc,
} from "@/lib/services/drive-api";
import { probeGoogleOauthConfigured } from "@/lib/services/google-oauth";
import { recordError } from "@/lib/errors/record-error";

export interface DriveIngestOptions {
  /** How many recent files to consider. Default 25. */
  limit?: number;
  /** Source marker written to brainMemory.source for the ingested rows. */
  source?: "drive_cron" | "drive_manual_sync";
  /** Actor name for audit log — "cron", "nick_tool_call", "user_sync", etc. */
  actor?: string;
}

export interface DriveIngestResult {
  ok: boolean;
  skipped?: boolean;
  /**
   * True when we could not ASK whether OAuth is configured — the integration
   * table was unreadable. NOT a statement about the Google grant.
   *
   * Callers with a human watching (the manual sync route, the operator router)
   * can keep degrading on this; the CRON must not, because a skip is filed as a
   * successful run and an outage would be invisible.
   */
  probeFailed?: boolean;
  reason?: string;
  stored: number;
  skippedCount: number;
  categoryCounts: Record<string, number>;
  errors: string[];
  durationMs: number;
  hint?: string;
}

export async function runDriveIngest(
  opts: DriveIngestOptions = {}
): Promise<DriveIngestResult> {
  const limit = opts.limit ?? 25;
  const source = opts.source ?? "drive_cron";
  const actor = opts.actor ?? "drive_ingest";

  const t0 = Date.now();

  // probeGoogleOauthConfigured, not isGoogleOauthConfigured: the boolean form
  // collapses "no refresh token stored" and "the integration table could not be
  // read" into the same false, so a DB blip was reported as a CONFIGURATION
  // problem and filed as a successful skip. Same defect #1348 fixed one level
  // up in getGoogleOauthStatus.
  const probe = await probeGoogleOauthConfigured();
  if (probe.probeFailed) {
    return {
      ok: false,
      skipped: true,
      probeFailed: true,
      reason: "google_oauth_status_unreadable",
      stored: 0,
      skippedCount: 0,
      categoryCounts: {},
      errors: [],
      durationMs: Date.now() - t0,
      hint: `${probe.reason} Do NOT re-grant — the Google token is not implicated.`,
    };
  }
  if (!probe.configured) {
    return {
      ok: false,
      skipped: true,
      reason: "google_oauth_not_configured",
      stored: 0,
      skippedCount: 0,
      categoryCounts: {},
      errors: [],
      durationMs: Date.now() - t0,
      hint: "Visit /api/oauth/google-data/start to grant Drive read access.",
    };
  }

  let stored = 0;
  let skippedCount = 0;
  const categoryCounts: Record<string, number> = {};
  const errors: string[] = [];

  try {
    const files = await listRecentFiles(limit);

    for (const file of files) {
      try {
        if (!isWorthIngesting(file)) {
          skippedCount++;
          continue;
        }

        const meta = await getFileMetadata(file.id);
        if (!meta) {
          skippedCount++;
          continue;
        }

        const rawContent = await getFileContent(
          file.id,
          file.mimeType || "application/vnd.google-apps.document"
        );
        const content = rawContent.replace(/\u0000/g, "");
        if (content.trim().length < 100) {
          skippedCount++;
          continue;
        }

        const category = deriveCategory(file);
        const key = `drive_${file.id}`;
        const display = buildContent({
          ...file,
          content,
          viewUrl: meta.webViewLink,
        });

        await brainMemory.remember(category, key, display, source, {
          driveId: file.id,
          title: file.title,
          mimeType: file.mimeType,
          viewUrl: meta.webViewLink,
          modifiedTime: meta.modifiedTime,
        });

        stored++;
        categoryCounts[category] = (categoryCounts[category] || 0) + 1;
      } catch (err) {
        const msg = (err as Error).message;
        errors.push(`${file.id}: ${msg}`);
        recordError("chat:post-process", err, {
          stage: "drive-ingest-file",
          driveId: file.id,
        });
      }
    }
  } catch (err) {
    recordError("chat:post-process", err, { stage: "drive-ingest-list" });
    await prisma.auditEvent
      .create({
        data: {
          actor,
          eventType: "drive_ingest_failed",
          detail: (err as Error).message,
          payload: { error: (err as Error).message },
        },
      })
      .catch(() => {});
    return {
      ok: false,
      stored,
      skippedCount,
      categoryCounts,
      errors: [...errors, `list_failed: ${(err as Error).message}`],
      durationMs: Date.now() - t0,
    };
  }

  const durationMs = Date.now() - t0;

  await prisma.auditEvent
    .create({
      data: {
        actor,
        eventType: "drive_docs_ingested",
        detail: `Ingested ${stored} Drive docs (${skippedCount} skipped) via ${actor}`,
        payload: { stored, skipped: skippedCount, categoryCounts, errors, durationMs },
      },
    })
    .catch(() => {});

  return {
    ok: true,
    stored,
    skippedCount,
    categoryCounts,
    errors,
    durationMs,
    hint:
      stored === 0
        ? "No new files needed ingest — cold memory is already up to date."
        : `${stored} docs now searchable via searchColdMemory tool.`,
  };
}

// ── Heuristics copied from the original cron route ──

function isWorthIngesting(doc: DriveDoc): boolean {
  if (!doc.title) return false;
  const title = doc.title.toLowerCase();
  if (/^untitled|^new document|^copy of|^receipt|^invoice /.test(title)) return false;
  if (/^\d{4,}/.test(title)) return false;
  return true;
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
