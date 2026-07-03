/**
 * Document ingest · v10.0.515 · #10 Document Q&A
 *
 * Pipeline:
 *   buffer → parseDocument → chunk by paragraph → getEmbedding(chunk)
 *   → store in vector_embeddings with sourceType="document"
 *   → also stash a meta-row in BrainMemory(category="document_meta")
 *     so the operator can list ingested documents and the metadata
 *     index queries (filename, char count, etc.) don't need a full
 *     scan of the chunks.
 *
 * Recall path:
 *   tool searchDocuments(query) → getEmbedding(query)
 *   → knnSearch(sourceType="document", limit=5)
 *   → return top chunks with their sourceId (so the model can cite)
 *
 * Why reuse vector_embeddings instead of a dedicated `documents` table:
 *   · zero schema migration
 *   · the existing pgvector + HNSW index already runs over this table
 *   · contextual-recall already aggregates by sourceType (just add
 *     "document" to its list of considered types)
 */

import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { getEmbedding } from "@/lib/ai/provider";
import { contextualizeChunk } from "@/lib/brain/contextual-retrieval";
import { getFlag } from "@/lib/feature-flags";
import {
  isPgvectorAvailable,
  knnSearch,
  vectorLiteral,
  assertSafeVectorLiteral,
  padToVectorDim,
  VECTOR_DIM_1536,
} from "@/lib/db/pgvector";
import { parseDocument } from "@/lib/integrations/document-parser";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("services/document-ingest");

const CHUNK_TARGET_CHARS = 800;
const CHUNK_OVERLAP_CHARS = 100;
const MAX_CHUNKS_PER_DOC = 200;

export interface IngestResult {
  documentId: string;
  filename: string;
  charCount: number;
  chunkCount: number;
  format: string;
  pages: number | null;
}

export async function ingestDocument(input: {
  buffer: Buffer;
  filename: string;
  mediaType?: string;
}): Promise<IngestResult> {
  const parsed = await parseDocument(input.buffer, {
    filename: input.filename,
    mediaType: input.mediaType,
  });

  const documentId = `doc_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
  const chunks = chunkText(parsed.text);

  // Persist meta-row first so the document is "known" even if a few
  // chunks fail to embed (long-tail provider hiccups).
  await prisma.brainMemory
    .create({
      data: {
        category: "document_meta",
        key: documentId,
        content: `${input.filename} · ${parsed.format} · ${parsed.charCount} chars · ${chunks.length} chunks`,
        confidence: 0.95,
        source: "document_ingest",
        metadata: {
          documentId,
          filename: input.filename,
          mediaType: input.mediaType,
          format: parsed.format,
          charCount: parsed.charCount,
          pages: parsed.pages,
          chunkCount: chunks.length,
          ingestedAt: new Date().toISOString(),
          parserMetadata: parsed.metadata,
        } as unknown as Parameters<typeof prisma.brainMemory.create>[0]["data"]["metadata"],
      },
    })
    .catch(() => {
      /* meta-row failure is non-fatal */
    });

  // Embed + store each chunk. Sequential to avoid overwhelming the
  // embedding provider — there's no urgency on ingest latency vs
  // first recall.
  let stored = 0;
  for (let i = 0; i < chunks.length; i++) {
    try {
      // v-truth · Contextual Retrieval (NICK_CONTEXTUAL_RETRIEVAL).
      // Prepend an LLM context header before embedding so the chunk
      // carries who/when/what-doc. Embed AND store the SAME string so
      // recalled text matches its vector. Flag off -> chunk unchanged.
      const toEmbed = getFlag("NICK_CONTEXTUAL_RETRIEVAL")?.isOn
        ? await contextualizeChunk(chunks[i], {
            title: input.filename,
            source: parsed.format,
            fullDocExcerpt: parsed.text,
          })
        : chunks[i];
      const vec = await getEmbedding(toEmbed);
      if (!vec || vec.length === 0) continue;

      const created = await prisma.vectorEmbedding.create({
        data: {
          sourceType: "document",
          sourceId: `${documentId}:chunk:${i}`,
          content: JSON.stringify({
            documentId,
            filename: input.filename,
            chunkIndex: i,
            text: toEmbed,
          }),
          embedding: JSON.stringify(vec),
        },
      });
      await writeVectorColumn(created.id, vec);
      stored++;
    } catch {
      // Per-chunk failures don't abort the ingest — the document is
      // still partially queryable. The chunkCount stat reflects what
      // actually stored.
    }
  }

  return {
    documentId,
    filename: input.filename,
    charCount: parsed.charCount,
    chunkCount: stored,
    format: parsed.format,
    pages: parsed.pages,
  };
}

export interface DocumentSearchHit {
  documentId: string;
  filename: string;
  chunkIndex: number;
  text: string;
  similarity: number;
}

export async function searchDocuments(
  query: string,
  limit = 5,
): Promise<DocumentSearchHit[]> {
  if (!(await isPgvectorAvailable())) return [];
  const vec = await getEmbedding(query);
  if (!vec || vec.length === 0) return [];

  const hits = await knnSearch(vec, {
    sourceType: "document",
    limit,
    metric: "cosine",
  });
  if (!hits) return [];

  const out: DocumentSearchHit[] = [];
  for (const hit of hits) {
    try {
      const parsed = JSON.parse(hit.content) as {
        documentId: string;
        filename: string;
        chunkIndex: number;
        text: string;
      };
      out.push({
        documentId: parsed.documentId,
        filename: parsed.filename,
        chunkIndex: parsed.chunkIndex,
        text: parsed.text,
        // knnSearch with cosine returns distance ∈ [0, 2]; convert
        // to a similarity ∈ [0, 1] for the chat-side UI.
        similarity:
          1 - Math.min((hit as { distance?: number }).distance ?? 0, 1),
      });
    } catch {
      /* skip malformed rows */
    }
  }
  return out;
}

/**
 * Chunk by paragraph with character-count clamps. Preserves
 * paragraph boundaries when possible so each embedding has coherent
 * semantic content. Falls back to mid-paragraph splits for
 * monolithic documents.
 */
function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];

  const paragraphs = clean.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    if (current.length + trimmed.length + 2 <= CHUNK_TARGET_CHARS) {
      current = current ? `${current}\n\n${trimmed}` : trimmed;
      continue;
    }

    // Flush current chunk if non-empty.
    if (current) {
      chunks.push(current);
      // Add overlap to the start of the next chunk for context
      // continuity across boundaries.
      const tail = current.slice(-CHUNK_OVERLAP_CHARS);
      current = `${tail}\n\n${trimmed}`;
    } else {
      current = trimmed;
    }

    // If a single paragraph blows past the target, hard-split it.
    while (current.length > CHUNK_TARGET_CHARS * 1.5) {
      chunks.push(current.slice(0, CHUNK_TARGET_CHARS));
      current = current.slice(CHUNK_TARGET_CHARS - CHUNK_OVERLAP_CHARS);
    }

    if (chunks.length >= MAX_CHUNKS_PER_DOC) break;
  }

  if (current && chunks.length < MAX_CHUNKS_PER_DOC) {
    chunks.push(current);
  }

  return chunks;
}

async function writeVectorColumn(rowId: string, vec: number[]): Promise<void> {
  // forensic-audit MEDIUM · was writing the UNPADDED embedding into the
  // fixed-dim embedding_vec column (throws on a dim mismatch), swallowing the
  // failure with a bare catch (zero logging), and never populating
  // embedding_vec_1536 — so document Q&A recall (which reads the 1536 column)
  // found nothing and nothing explained why. Mirror the canonical writer:
  // pad + write both columns + log failures.
  if (vec.length === 0) return;
  try {
    const lit = vectorLiteral(padToVectorDim(vec, 1024));
    assertSafeVectorLiteral(lit);
    await prisma.$executeRawUnsafe(
      `UPDATE vector_embeddings SET embedding_vec = '${lit}'::vector(1024) WHERE id = $1`,
      rowId,
    );
  } catch (err) {
    log.warn("document_ingest_vec_write_failed", { rowId, error: err instanceof Error ? err.message : String(err) });
  }
  try {
    const lit1536 = vectorLiteral(padToVectorDim(vec, VECTOR_DIM_1536));
    await prisma.$executeRawUnsafe(
      `UPDATE vector_embeddings SET embedding_vec_1536 = '${lit1536}'::vector(${VECTOR_DIM_1536}) WHERE id = $1`,
      rowId,
    );
  } catch (err) {
    log.warn("document_ingest_vec1536_write_failed", { rowId, error: err instanceof Error ? err.message : String(err) });
  }
}
