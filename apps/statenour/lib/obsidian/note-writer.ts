/**
 * Note-writing logic for the Obsidian export bridge.
 *
 * Extracted from scripts/export-brain-to-obsidian.ts so the write/conflict
 * contract is unit-testable. The contract:
 *
 * - A note's frontmatter `hash` is the sha256 of its EOL-normalized (`\r\n`
 *   → `\n`), trimmed body. Normalizing at write time is load-bearing: the
 *   read path reconstructs the body via a `/\r?\n/` split + `\n` join, so a
 *   body hashed WITH carriage returns can never re-verify — every export
 *   then misreads its own file as a local edit and stamps a conflict copy
 *   forever (1,870 copies of one rollup before this was fixed).
 * - A stored hash matching the RAW on-disk body (pre-normalization) is also
 *   accepted as pristine — that is exactly the state legacy CR-era exports
 *   left behind, and treating it as an edit would block them from healing.
 * - An unchanged note (everything but `last_synced_at` identical) is skipped,
 *   not rewritten: the watch daemon syncs on vault file events, so a rewrite
 *   of every note per run retriggers the pipeline in a permanent loop.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const CONFLICT_SUFFIX_RE = /\.conflict-\d{14}\.md$/;

export function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "").trim();
}

export function calculateHash(str: string): string {
  return crypto.createHash("sha256").update(str, "utf-8").digest("hex");
}

/** Canonical EOL form — must mirror parseFrontmatter's `/\r?\n/` split + `\n` join. */
export function normalizeEol(str: string): string {
  return str.replace(/\r\n/g, "\n");
}

export function parseFrontmatter(fileContent: string): { metadata: Record<string, any>; content: string } {
  const result = { metadata: {} as Record<string, any>, content: fileContent };
  const normalized = fileContent.trim();
  if (!normalized.startsWith("---")) return result;

  const lines = normalized.split(/\r?\n/);
  if (lines[0] !== "---") return result;

  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      closingIndex = i;
      break;
    }
  }

  if (closingIndex === -1) return result;

  const yamlLines = lines.slice(1, closingIndex);
  const metadata: Record<string, any> = {};

  for (const line of yamlLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const rawKey = trimmed.substring(0, colonIdx).trim();
    let rawVal = trimmed.substring(colonIdx + 1).trim();

    if ((rawVal.startsWith('"') && rawVal.endsWith('"')) || (rawVal.startsWith("'") && rawVal.endsWith("'"))) {
      rawVal = rawVal.substring(1, rawVal.length - 1);
    }

    metadata[rawKey] = rawVal;
  }

  result.metadata = metadata;
  result.content = lines.slice(closingIndex + 1).join("\n");
  return result;
}

export function buildFrontmatter(metadata: Record<string, any>): string {
  let yaml = "---\n";
  for (const [key, val] of Object.entries(metadata)) {
    if (val === undefined || val === null) continue;
    if (Array.isArray(val)) {
      yaml += `${key}: [${val.map(v => typeof v === "string" ? `"${v.replace(/"/g, '\\"')}"` : v).join(", ")}]\n`;
    } else if (typeof val === "object") {
      yaml += `${key}: ${JSON.stringify(val)}\n`;
    } else if (typeof val === "string") {
      yaml += `${key}: "${val.replace(/"/g, '\\"')}"\n`;
    } else {
      yaml += `${key}: ${val}\n`;
    }
  }
  yaml += "---\n";
  return yaml;
}

export function buildNoteContent(
  metadata: Record<string, any>,
  body: string,
  now: Date = new Date(),
): { content: string; hash: string } {
  const normalizedBody = normalizeEol(body);
  const contentHash = calculateHash(normalizedBody.trim());
  const fullMetadata = {
    ...metadata,
    hash: contentHash,
    last_synced_at: now.toISOString(),
  };
  const content = buildFrontmatter(fullMetadata) + normalizedBody;
  return { content, hash: contentHash };
}

/** The body exactly as stored on disk (no EOL normalization) — for legacy-hash checks. */
export function extractRawBody(raw: string): string {
  const lines = raw.split(/(?<=\n)/);
  if (!lines.length || lines[0].trim() !== "---") return raw;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") return lines.slice(i + 1).join("");
  }
  return raw;
}

/** Drop the volatile `last_synced_at` frontmatter line so equality means "nothing real changed". */
function stripVolatile(content: string): string {
  const m = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return content;
  const cleaned = m[1]
    .split("\n")
    .filter(line => !line.trim().startsWith("last_synced_at:"))
    .join("\n");
  return `---\n${cleaned}\n---\n` + content.slice(m[0].length);
}

export type NoteWritePlan =
  | { kind: "write"; content: string; hash: string }
  | { kind: "skip"; hash: string }
  | { kind: "conflict"; content: string; hash: string };

/**
 * Decide what to do with a note: overwrite it, leave it alone (already
 * converged), or stage a conflict copy because a human edited it in Obsidian.
 */
export function planNoteWrite(
  existingRaw: string | null,
  metadata: Record<string, any>,
  body: string,
  now: Date = new Date(),
): NoteWritePlan {
  const finalMetadata = { ...metadata };

  if (existingRaw === null) {
    const fresh = buildNoteContent(finalMetadata, body, now);
    return { kind: "write", ...fresh };
  }

  const localParsed = parseFrontmatter(existingRaw);

  // Preserve review_due from the local file if present
  if (localParsed.metadata.review_due && !finalMetadata.review_due) {
    finalMetadata.review_due = localParsed.metadata.review_due;
  }

  const storedHash = localParsed.metadata.hash;
  // parseFrontmatter already EOL-normalizes, matching how hashes are now built
  const normalizedLocalHash = calculateHash(localParsed.content.trim());
  // Legacy exports hashed the body before EOL normalization — accept that too
  const legacyRawHash = calculateHash(extractRawBody(existingRaw).trim());
  const isModified = Boolean(storedHash)
    && storedHash !== normalizedLocalHash
    && storedHash !== legacyRawHash;

  const next = buildNoteContent(finalMetadata, body, now);

  if (isModified) return { kind: "conflict", ...next };

  if (stripVolatile(next.content) === stripVolatile(normalizeEol(existingRaw))) {
    return { kind: "skip", hash: next.hash };
  }

  return { kind: "write", ...next };
}

/**
 * True when the newest staged conflict copy for this note already carries the
 * same content — re-stamping it every sync cycle is what buried the vault in
 * timestamped duplicates.
 */
export function hasIdenticalNewestConflict(
  conflictDir: string,
  sanitizedTitle: string,
  newContent: string,
): boolean {
  if (!fs.existsSync(conflictDir)) return false;
  const prefix = `${sanitizedTitle}.conflict-`;
  const matches = fs.readdirSync(conflictDir)
    .filter(f => f.startsWith(prefix) && CONFLICT_SUFFIX_RE.test(f))
    .sort();
  if (matches.length === 0) return false;
  try {
    const newest = fs.readFileSync(path.join(conflictDir, matches[matches.length - 1]), "utf-8");
    return stripVolatile(normalizeEol(newest)) === stripVolatile(newContent);
  } catch {
    return false;
  }
}

/**
 * Retention: keep only the newest `keepPerNote` conflict copies per note
 * title. The 14-digit timestamp sorts lexicographically, so a plain sort is
 * chronological.
 */
export function pruneConflictDir(
  conflictDir: string,
  keepPerNote = 10,
): { deleted: number; kept: number } {
  if (!fs.existsSync(conflictDir)) return { deleted: 0, kept: 0 };

  const groups = new Map<string, string[]>();
  for (const file of fs.readdirSync(conflictDir)) {
    if (!CONFLICT_SUFFIX_RE.test(file)) continue;
    const base = file.replace(CONFLICT_SUFFIX_RE, "");
    const group = groups.get(base);
    if (group) group.push(file);
    else groups.set(base, [file]);
  }

  let deleted = 0;
  let kept = 0;
  for (const group of groups.values()) {
    group.sort();
    const excess = group.slice(0, Math.max(0, group.length - keepPerNote));
    kept += group.length - excess.length;
    for (const file of excess) {
      try {
        fs.unlinkSync(path.join(conflictDir, file));
        deleted++;
      } catch {
        kept++; // deletion raced/locked — it stays for the next run
      }
    }
  }
  return { deleted, kept };
}
