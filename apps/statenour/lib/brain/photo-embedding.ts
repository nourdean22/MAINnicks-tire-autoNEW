/**
 * Photo embedding pipeline · v10.0.92 · 2026-05-02.
 *
 * Multi-modal brain. Given a photo URL or base64, runs qwen3-vl
 * for a structured description, embeds the description, stores in
 * vector_embeddings (sourceType=photo) so KNN search can find
 * "photos like this one" or "photos matching this query".
 *
 * Composes:
 *   · Vision: lib/ai/vision-input.ts (existing) — describeImage
 *   · Embedding: lib/ai/provider.ts:getEmbedding
 *   · Storage: vector_embeddings with sourceType='photo'
 *
 * Idempotent — same photoId reuses the existing embedding row.
 *
 * Use case: snap a photo of a tire wear pattern → KNN against past
 * photos surfaces "you saw the same wear pattern on this customer
 * 4 months ago". Vision-driven memory.
 */

import { prisma } from "@/lib/prisma";
import { getEmbedding } from "@/lib/ai/provider";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("brain/photo-embedding");

export interface PhotoEmbedReport {
  photoId: string;
  description: string;
  embedded: boolean;
  reused: boolean;
  embeddingDim: number;
  ms: number;
}

interface AiResponse {
  content: string;
  provider?: string;
  model?: string;
}
interface DescribeImageFn {
  (imageUrl: string, prompt?: string): Promise<AiResponse>;
}

/**
 * Embed a photo by URL. Photo identity = photoId (caller-supplied
 * unique key, e.g., S3 object key + sha256). Returns the embedded
 * description so the caller can surface it inline.
 */
export async function embedPhoto(opts: {
  photoId: string;
  imageUrl: string;
  describePrompt?: string;
  /** Override description if caller already has one (skip vision call). */
  description?: string;
}): Promise<PhotoEmbedReport> {
  const t0 = Date.now();

  // Idempotency check
  const existing = await prisma.vectorEmbedding
    .findFirst({
      where: { sourceType: "photo", sourceId: opts.photoId },
      select: { id: true, content: true },
    })
    .catch(() => null);

  if (existing) {
    return {
      photoId: opts.photoId,
      description: existing.content,
      embedded: false,
      reused: true,
      embeddingDim: 0,
      ms: Date.now() - t0,
    };
  }

  // 1. Get description (vision call OR caller-supplied)
  let description = opts.description;
  if (!description) {
    try {
      const vis = await import("@/lib/ai/vision-input");
      const fn = (vis as { describeImage?: DescribeImageFn }).describeImage;
      if (typeof fn === "function") {
        const resp = await fn(
          opts.imageUrl,
          opts.describePrompt ??
            "Describe this image in 2-3 sentences. Focus on objects, colors, condition, notable details. No interpretation, just description.",
        );
        description = resp?.content ?? "";
      }
    } catch (err) {
      log.warn("vision_call_failed", {
        photoId: opts.photoId,
        err: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
    }
  }

  if (!description || description.length < 10) {
    return {
      photoId: opts.photoId,
      description: description ?? "",
      embedded: false,
      reused: false,
      embeddingDim: 0,
      ms: Date.now() - t0,
    };
  }

  // 2. Embed
  const vec = await getEmbedding(description).catch(() => [] as number[]);
  if (vec.length === 0) {
    log.warn("embed_failed", { photoId: opts.photoId });
    return {
      photoId: opts.photoId,
      description,
      embedded: false,
      reused: false,
      embeddingDim: 0,
      ms: Date.now() - t0,
    };
  }

  // 3. Persist
  await prisma.vectorEmbedding
    .create({
      data: {
        sourceType: "photo",
        sourceId: opts.photoId,
        content: description.slice(0, 2000),
        embedding: JSON.stringify(vec),
      },
    })
    .catch((err) => {
      log.warn("create_failed", {
        photoId: opts.photoId,
        err: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
    });

  return {
    photoId: opts.photoId,
    description,
    embedded: true,
    reused: false,
    embeddingDim: vec.length,
    ms: Date.now() - t0,
  };
}

/**
 * KNN search across photo embeddings. Given a text query, returns
 * the photoIds whose descriptions are most semantically similar.
 */
export async function searchPhotos(opts: {
  query: string;
  limit?: number;
}): Promise<
  Array<{
    photoId: string;
    description: string;
    distance: number;
  }>
> {
  const limit = Math.max(1, Math.min(opts.limit ?? 10, 50));
  const emb = await getEmbedding(opts.query).catch(() => [] as number[]);
  if (emb.length === 0) return [];

  // Use embedding_vec_1536 if column populated; fallback to
  // legacy JSON cosine via lib/brain/embedding-utils if not
  const TARGET_DIM = 1536;
  const padded =
    emb.length === TARGET_DIM
      ? emb
      : emb.length < TARGET_DIM
        ? [...emb, ...new Array(TARGET_DIM - emb.length).fill(0)]
        : emb.slice(0, TARGET_DIM);
  // v10.0.109 audit fix · same hardening as memory-recall.ts:
  // (1) reject any non-finite element before serializing,
  // (2) bind the vector literal as a positional param so even if
  //     a malformed value sneaks through Postgres rejects the cast
  //     instead of executing arbitrary SQL.
  for (let i = 0; i < padded.length; i++) {
    if (!Number.isFinite(padded[i])) {
      return [];
    }
  }
  const vecLit = `[${padded.join(",")}]`;

  const rows = await prisma
    .$queryRawUnsafe<
      Array<{
        source_id: string;
        content: string;
        distance: number;
      }>
    >(
      `SELECT "sourceId"::text AS source_id,
              substring(content, 1, 280)::text AS content,
              (embedding_vec_1536 <=> $1::vector(${TARGET_DIM})) AS distance
       FROM vector_embeddings
       WHERE "sourceType" = 'photo'
         AND embedding_vec_1536 IS NOT NULL
       ORDER BY embedding_vec_1536 <=> $1::vector(${TARGET_DIM})
       LIMIT ${limit}`,
      vecLit,
    )
    .catch(() => []);

  return rows.map((r) => ({
    photoId: r.source_id,
    description: r.content,
    distance: r.distance,
  }));
}
