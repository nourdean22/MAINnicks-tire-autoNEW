/**
 * POST /api/ai/chat/documents · v10.0.515 · #10 Document Q&A
 *
 * Multipart upload endpoint. Operator drops a PDF / DOCX / XLSX /
 * txt / md file; this route parses it, chunks it, embeds each chunk,
 * and writes them to vector_embeddings (sourceType="document"). On
 * success returns { documentId, filename, charCount, chunkCount }
 * which the chat composer attaches to the next message.
 *
 * Limits:
 *   · max upload size: 20MB (enforced via Content-Length check)
 *   · max chunks per document: 200 (in document-ingest.ts)
 *   · max output text: 1MB (in document-parser.ts)
 *
 * GET returns the list of ingested documents (BrainMemory rows with
 * category="document_meta") so the operator can audit what's stored.
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { checkAiRateLimit } from "@/lib/rate-limit";
import { ingestDocument } from "@/lib/services/document-ingest";
import { prisma } from "@/lib/prisma";
import { sanitizeError } from "@/lib/utils/sanitize-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // v10.0.529.3 D-1 fix · upload + parse + chunk + embed is the most
  // expensive single call in the AI surface (Venice embeddings + Neon
  // bulk insert). 10/min/IP keeps a runaway uploader from exhausting
  // embedding quota or filling vector_embeddings with garbage.
  const limit = checkAiRateLimit(req);
  if (limit) return limit;

  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `Upload too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024}MB)` },
      { status: 413 },
    );
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "file required (multipart/form-data)" }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `File too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024}MB)` },
        { status: 413 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await ingestDocument({
      buffer,
      filename: file.name,
      mediaType: file.type || undefined,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = sanitizeError(err);
    return NextResponse.json(
      { error: "ingest failed", detail: message.slice(0, 500) },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10), 1),
    200,
  );

  const docs = await prisma.brainMemory.findMany({
    where: { category: "document_meta", deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      key: true,
      content: true,
      metadata: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    ok: true,
    count: docs.length,
    documents: docs.map((d) => ({
      documentId: d.key,
      summary: d.content,
      metadata: d.metadata,
      ingestedAt: d.createdAt.toISOString(),
    })),
  });
}
