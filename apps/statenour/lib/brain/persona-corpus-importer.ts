/**
 * Persona Corpus Importer · v10.0.529.43 · Arc B F4 · Phase 3
 *
 * The original Arc B vision said: "8-axis identity overlay + 463
 * ChatGPT conversations distilled into a persona vector." Phase 1
 * shipped the 8-axis side (v529.32). Phase 2 added pre-emptive
 * anchor injection (v529.36). This Phase 3 closes the loop by
 * adding the BEHAVIORAL corpus: the operator's actual text from
 * real conversations + notes gets embedded, centroid-pooled, and
 * stored as a second anchor next to the identity snapshot.
 *
 * INPUT FORMATS · accepts any of:
 *
 *   1. ChatGPT export `conversations.json` (the array-of-conversations
 *      shape the chatgpt.com/settings/data export produces). We
 *      extract ONLY operator-authored turns (role="user") · skip
 *      the assistant replies (Nick / ChatGPT) since those aren't
 *      the operator's voice.
 *
 *   2. Plain text files (.txt · .md) · the entire file body is
 *      treated as one operator utterance.
 *
 *   3. JSON arrays of `{ role, content }` objects (chat-message
 *      shape) · matches the persisted ChatMessage format · we
 *      extract role="user" turns.
 *
 *   4. JSON arrays of raw strings · each string is one utterance.
 *
 * Operator drops files into `data/persona-corpus/` (configurable
 * via the importPersonaCorpus argument). The importer auto-detects
 * the shape per-file and falls through gracefully on parse errors
 * (logs · continues).
 *
 * STORAGE · per-utterance embeddings land in vector_embeddings with
 * sourceType="behavioral_persona" + sourceId=sha1(utterance). The
 * CENTROID lands in BrainMemory(category="behavioral_persona_vector",
 * key="current") · this is what the persona-anchor reads at chat-time.
 *
 * IDEMPOTENCY · sha1(utterance) means re-running the importer on the
 * same corpus is a no-op (the row exists, gets upserted). Adding new
 * files to the corpus adds new utterances · the centroid recomputes
 * from the full set on every run.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getEmbedding } from "@/lib/ai/provider";
import { vectorCentroid } from "@/lib/brain/embedding-utils";
import { logger as rootLogger } from "@/lib/logger";
import { logError } from "@/lib/utils/error-log";

const log = rootLogger.withSurface("brain/persona-corpus-importer");

// Skip utterances shorter than this · too little signal to matter +
// noise from accidental sub-words bloats the centroid.
const MIN_UTTERANCE_CHARS = 40;

// Cap per-utterance embed payload · the model's context is long but
// we don't want to spend on a 100KB diary entry. Truncating preserves
// the salient first-paragraph signal which usually carries the voice.
const MAX_UTTERANCE_CHARS = 1500;

// Per-run cap on utterances embedded · avoids accidentally embedding
// 50,000 messages in one shot when the operator drops the full
// 463-conversation export. Run repeatedly to ingest the rest · the
// importer is idempotent.
const MAX_PER_RUN = 2000;

// Embedding pacing · the provider can rate-limit on high-frequency
// fan-out · 50ms between calls keeps us safe without crawling.
const EMBED_DELAY_MS = 50;

// Storage namespaces · kept distinct from chat_message embeddings so
// future cleanup / re-import doesn't fight the live chat data.
const SOURCE_TYPE = "behavioral_persona" as const;
const CENTROID_CATEGORY = "behavioral_persona_vector" as const;
const CENTROID_KEY = "current" as const;

// ── Parsers · one per input shape · all return Utterance[] ──────────

export interface Utterance {
  /** Stable per-utterance id · sha1 of the content · enables idempotency. */
  id: string;
  text: string;
  /** Source file the utterance came from · audit trail. */
  source: string;
}

function makeUtteranceId(text: string): string {
  return createHash("sha1").update(`persona::${text}`).digest("hex").slice(0, 24);
}

function makeUtterance(text: string, source: string): Utterance | null {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length < MIN_UTTERANCE_CHARS) return null;
  const capped = trimmed.slice(0, MAX_UTTERANCE_CHARS);
  return { id: makeUtteranceId(capped), text: capped, source };
}

/**
 * ChatGPT export format · top-level array of conversations · each
 * conversation has a `mapping` of message-id → { message: { author,
 * content: { parts: string[] } } }. We walk every mapping entry,
 * filter to author.role === "user", and flatten content.parts.
 */
function parseChatGPTExport(json: unknown, source: string): Utterance[] {
  if (!Array.isArray(json)) return [];
  const out: Utterance[] = [];
  for (const conv of json) {
    if (!conv || typeof conv !== "object") continue;
    const mapping = (conv as { mapping?: Record<string, unknown> }).mapping;
    if (!mapping || typeof mapping !== "object") continue;
    for (const node of Object.values(mapping)) {
      if (!node || typeof node !== "object") continue;
      const msg = (node as { message?: unknown }).message;
      if (!msg || typeof msg !== "object") continue;
      const author = (msg as { author?: { role?: string } }).author;
      if (author?.role !== "user") continue;
      const content = (msg as { content?: { parts?: unknown } }).content;
      if (!content || typeof content !== "object") continue;
      const parts = (content as { parts?: unknown }).parts;
      if (!Array.isArray(parts)) continue;
      for (const part of parts) {
        if (typeof part !== "string") continue;
        const u = makeUtterance(part, source);
        if (u) out.push(u);
      }
    }
  }
  return out;
}

/**
 * Chat-message shape · `[{ role: "user", content: "..." }, ...]` ·
 * matches the persisted ChatMessage table. We filter role="user".
 */
function parseChatMessageArray(json: unknown, source: string): Utterance[] {
  if (!Array.isArray(json)) return [];
  const out: Utterance[] = [];
  for (const item of json) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: string }).role;
    const content = (item as { content?: string }).content;
    if (role && role !== "user") continue; // filter assistant turns
    if (typeof content !== "string") continue;
    const u = makeUtterance(content, source);
    if (u) out.push(u);
  }
  return out;
}

/**
 * Plain string array · each entry is one operator utterance.
 */
function parseStringArray(json: unknown, source: string): Utterance[] {
  if (!Array.isArray(json)) return [];
  const out: Utterance[] = [];
  for (const item of json) {
    if (typeof item !== "string") continue;
    const u = makeUtterance(item, source);
    if (u) out.push(u);
  }
  return out;
}

/**
 * Auto-detect JSON shape and dispatch to the right parser.
 */
function parseJsonShape(text: string, source: string): Utterance[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    logError("brain.persona-corpus-importer", err, { fn: "parseJsonShape", source });
    log.warn("json_parse_failed", { source });
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  if (parsed.length === 0) return [];

  const first = parsed[0];
  if (typeof first === "string") {
    return parseStringArray(parsed, source);
  }
  if (first && typeof first === "object") {
    // ChatGPT export has `mapping` at top level
    if ("mapping" in first || "conversation_id" in first) {
      return parseChatGPTExport(parsed, source);
    }
    // ChatMessage shape has `role` + `content`
    if ("role" in first || "content" in first) {
      return parseChatMessageArray(parsed, source);
    }
  }
  return [];
}

/**
 * Plain-text file · entire body is one utterance. Falls under
 * MIN_UTTERANCE_CHARS gating in makeUtterance.
 */
function parsePlainText(text: string, source: string): Utterance[] {
  const u = makeUtterance(text, source);
  return u ? [u] : [];
}

// ── Main importer ────────────────────────────────────────────────────

export interface ImportSummary {
  filesScanned: number;
  utterancesFound: number;
  utterancesEmbedded: number;
  utterancesSkippedExisting: number;
  centroidDimensions: number;
  centroidWritten: boolean;
  /** v10.0.529.43 · structured profile written alongside the centroid · null when analyzer fails or corpus is empty. */
  profileSummary: string | null;
  errors: string[];
}

/**
 * Walks the corpus directory · parses each file by extension · embeds
 * new utterances · rebuilds the centroid · persists.
 *
 * `dir` defaults to `data/persona-corpus/` in the repo root. Missing
 * directory returns a graceful no-op summary rather than throwing.
 */
export async function importPersonaCorpus(
  dir: string = "data/persona-corpus",
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    filesScanned: 0,
    utterancesFound: 0,
    utterancesEmbedded: 0,
    utterancesSkippedExisting: 0,
    centroidDimensions: 0,
    centroidWritten: false,
    profileSummary: null,
    errors: [],
  };

  // v10.0.529.43 · skip docs / dotfiles · these aren't operator-authored
  // utterances · including the README + .gitignore in the corpus pollutes
  // the voice profile with documentation tone.
  const IGNORED_FILES = new Set(["README.md", "readme.md", "README", ".gitignore"]);

  let files: string[];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    files = entries
      .filter((e) => e.isFile())
      .filter((e) => !IGNORED_FILES.has(e.name) && !e.name.startsWith("."))
      .map((e) => path.join(dir, e.name));
  } catch (err) {
    log.warn("corpus_dir_missing", {
      dir,
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    summary.errors.push(`corpus_dir_missing: ${dir}`);
    return summary;
  }

  // ── 1. Parse every file → flatten utterances ──
  const allUtterances: Utterance[] = [];
  for (const filePath of files) {
    summary.filesScanned += 1;
    const ext = path.extname(filePath).toLowerCase();
    let text: string;
    try {
      text = await fs.readFile(filePath, "utf-8");
    } catch (err) {
      summary.errors.push(`read_failed: ${filePath}`);
      log.warn("file_read_failed", {
        filePath,
        err: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
      continue;
    }
    const source = path.basename(filePath);
    const parsed =
      ext === ".json"
        ? parseJsonShape(text, source)
        : ext === ".txt" || ext === ".md"
          ? parsePlainText(text, source)
          : [];
    allUtterances.push(...parsed);
  }
  summary.utterancesFound = allUtterances.length;

  if (allUtterances.length === 0) {
    log.info("corpus_empty", { dir });
    return summary;
  }

  // ── 2. Dedup by id · keep first occurrence ──
  const uniq = new Map<string, Utterance>();
  for (const u of allUtterances) {
    if (!uniq.has(u.id)) uniq.set(u.id, u);
  }
  const utterances = Array.from(uniq.values()).slice(0, MAX_PER_RUN);

  // ── 3. Skip utterances already embedded ──
  const existing = await prisma.vectorEmbedding
    .findMany({
      where: {
        sourceType: SOURCE_TYPE,
        sourceId: { in: utterances.map((u) => u.id) },
      },
      select: { sourceId: true, embedding: true },
    })
    .catch((err) => {
      logError("brain.persona-corpus-importer", err, { fn: "importPersonaCorpus.findExisting" });
      return [];
    });
  const existingMap = new Map(existing.map((e) => [e.sourceId, e]));
  const toEmbed = utterances.filter((u) => !existingMap.has(u.id));
  summary.utterancesSkippedExisting = utterances.length - toEmbed.length;

  // ── 4. Embed new utterances · sequential with small delay ──
  for (const u of toEmbed) {
    try {
      const vec = await getEmbedding(u.text);
      if (vec.length === 0) {
        summary.errors.push(`embed_empty: ${u.id}`);
        continue;
      }
      await prisma.vectorEmbedding
        .create({
          data: {
            sourceType: SOURCE_TYPE,
            sourceId: u.id,
            content: u.text,
            embedding: JSON.stringify(vec),
          },
        })
        .catch((err) => {
          summary.errors.push(`vec_persist_failed: ${u.id}`);
          log.warn("vec_persist_failed", {
            id: u.id,
            err: err instanceof Error ? err.message.slice(0, 200) : String(err),
          });
        });
      summary.utterancesEmbedded += 1;
    } catch (err) {
      summary.errors.push(`embed_failed: ${u.id}`);
      log.warn("embed_failed", {
        id: u.id,
        err: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
    }
    if (EMBED_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, EMBED_DELAY_MS));
    }
  }

  // ── 5. Pull EVERY behavioral_persona embedding · recompute centroid ──
  const allRows = await prisma.vectorEmbedding
    .findMany({
      where: { sourceType: SOURCE_TYPE },
      select: { embedding: true },
    })
    .catch((): never[] => []);
  const vectors: number[][] = [];
  let parseFailCount = 0;
  for (const r of allRows) {
    try {
      const v = JSON.parse(r.embedding) as number[];
      if (Array.isArray(v) && v.length > 0) vectors.push(v);
    } catch {
      // skip malformed
      parseFailCount++;
    }
  }
  if (parseFailCount > 0) {
    logError("brain.persona-corpus-importer", new Error(`${parseFailCount} vectors failed to parse`), { fn: "importPersonaCorpus.parseEmbeddings" });
  }
  // No-vectors path · skip centroid persist · BUT fall through so
  // the text-only analyzer below still runs. Pre-fix this returned
  // early which short-circuited the operator's voice profile.
  let centroid: number[] | null = null;
  if (vectors.length === 0) {
    log.info("centroid_skipped_no_vectors", { dir });
  } else {
    centroid = vectorCentroid(vectors);
    summary.centroidDimensions = centroid.length;
  }

  // ── 6. Persist centroid as BrainMemory (when one exists) ──
  if (centroid !== null) try {
    await prisma.brainMemory.upsert({
      where: {
        category_key: {
          category: CENTROID_CATEGORY,
          key: CENTROID_KEY,
        },
      },
      create: {
        category: CENTROID_CATEGORY,
        key: CENTROID_KEY,
        content: JSON.stringify({
          vectorPreview: centroid.slice(0, 4),
          dimensions: centroid.length,
          utteranceCount: vectors.length,
          builtAt: new Date().toISOString(),
        }),
        confidence: 1.0,
        source: "persona_corpus_importer",
        metadata: {
          centroid,
          utteranceCount: vectors.length,
          dimensions: centroid.length,
          builtAt: new Date().toISOString(),
        } as unknown as Parameters<typeof prisma.brainMemory.upsert>[0]["create"]["metadata"],
      },
      update: {
        content: JSON.stringify({
          vectorPreview: centroid.slice(0, 4),
          dimensions: centroid.length,
          utteranceCount: vectors.length,
          builtAt: new Date().toISOString(),
        }),
        metadata: {
          centroid,
          utteranceCount: vectors.length,
          dimensions: centroid.length,
          builtAt: new Date().toISOString(),
        } as unknown as Parameters<typeof prisma.brainMemory.upsert>[0]["update"]["metadata"],
        lastSeen: new Date(),
      },
    });
    summary.centroidWritten = true;
  } catch (err) {
    summary.errors.push("centroid_persist_failed");
    log.warn("centroid_persist_failed", {
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
  }

  // v10.0.529.43 · run the analyzer pass right after the centroid
  // lands so the operator-readable voice profile + structured stats
  // ship in the same operation. Defensive · failure here doesn't
  // invalidate the centroid (which already persisted).
  //
  // The DB-backed analyzer reads vector_embeddings · so if the embed
  // step above failed entirely (provider out of credit · rate-limited),
  // there's nothing in the DB to analyze. Fall back to the pure-text
  // path · analyze the parsed utterances directly. The operator gets a
  // voice profile even when the vector pipeline can't complete.
  try {
    const {
      analyzePersonaCorpus,
      analyzeUtteranceTexts,
      invalidatePersonaProfileCache,
    } = await import("@/lib/brain/persona-corpus-analyzer");
    const profile = await analyzePersonaCorpus();
    if (profile) {
      summary.profileSummary = profile.summary;
      invalidatePersonaProfileCache();
    } else if (utterances.length > 0) {
      // Pure-text fallback · analyzer ran against the in-memory
      // utterances we just parsed. No embeddings required.
      const fallback = await analyzeUtteranceTexts(
        utterances.map((u) => u.text),
      );
      if (fallback) {
        summary.profileSummary = fallback.summary;
        invalidatePersonaProfileCache();
      }
    }
  } catch (err) {
    summary.errors.push("analyzer_failed");
    log.warn("analyzer_threw", {
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
  }

  log.info("import_complete", {
    files: summary.filesScanned,
    found: summary.utterancesFound,
    embedded: summary.utterancesEmbedded,
    skipped: summary.utterancesSkippedExisting,
    centroidDims: summary.centroidDimensions,
    hasProfile: !!summary.profileSummary,
  });

  return summary;
}

// ── Reader · used by persona-drift-detector + anchor builder ─────────

interface BehavioralCentroidCache {
  centroid: number[];
  utteranceCount: number;
  loadedAt: number;
}

let behavioralCache: BehavioralCentroidCache | null = null;
const BEHAVIORAL_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes · corpus rarely changes

/**
 * Load the behavioral persona centroid · returns null when no corpus
 * has been imported yet. Cached 15min in module memory · the importer
 * runs on-demand (rare), so a longer TTL is fine.
 */
export async function loadBehavioralPersonaCentroid(): Promise<
  { centroid: number[]; utteranceCount: number } | null
> {
  if (behavioralCache && Date.now() - behavioralCache.loadedAt < BEHAVIORAL_CACHE_TTL_MS) {
    return {
      centroid: behavioralCache.centroid,
      utteranceCount: behavioralCache.utteranceCount,
    };
  }
  const row = await prisma.brainMemory
    .findUnique({
      where: {
        category_key: {
          category: CENTROID_CATEGORY,
          key: CENTROID_KEY,
        },
      },
      select: { metadata: true },
    })
    .catch((err) => {
      logError("brain.persona-corpus-importer", err, { fn: "loadBehavioralPersonaCentroid.findCentroid" });
      return null;
    });
  if (!row?.metadata) return null;
  const meta = row.metadata as Record<string, unknown> | null;
  if (!meta || typeof meta !== "object") return null;
  const centroid = meta.centroid as number[] | undefined;
  const utteranceCount =
    typeof meta.utteranceCount === "number" ? meta.utteranceCount : 0;
  if (!Array.isArray(centroid) || centroid.length === 0) return null;
  behavioralCache = {
    centroid,
    utteranceCount,
    loadedAt: Date.now(),
  };
  return { centroid, utteranceCount };
}

/** Force a cache invalidation · called by the importer after a fresh run. */
export function invalidateBehavioralCache(): void {
  behavioralCache = null;
}
