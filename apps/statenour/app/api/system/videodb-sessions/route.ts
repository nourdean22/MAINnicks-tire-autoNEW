/**
 * Operator Session Capture (VideoDB) · v10.0.525
 *
 * POST /api/system/videodb-sessions
 *   · Operator submits a session recording (file URL or multipart file).
 *   · Server kicks off upload + spoken-word index + scene index in
 *     VideoDB, persists a BrainMemory row keyed by sessionId, and
 *     returns { sessionId, videoId, status }.
 *
 * GET  /api/system/videodb-sessions?q=...
 *   · Searches across the operator's captured sessions.
 *   · Returns top 5 hits with { sessionId, videoId, timestamp, snippet,
 *     similarity }.
 *   · GET (no q) lists recent sessions instead.
 *
 * Owner-gated via requireSession (same surface as the document upload
 * route). Missing VIDEO_DB_API_KEY surfaces 503 with code=missing_api_key
 * so the operator knows to set it before retrying.
 *
 * Storage: each session metadata row lives in BrainMemory:
 *   · category = "videodb_session"
 *   · key      = sessionId (cuid)
 *   · content  = human-readable title / note
 *   · metadata = { videoId, streamUrl, scenePrompt, capturedAt, source }
 *
 * The actual transcript + scene description live in VideoDB (the
 * authoritative store · we don't duplicate). Search hits the VideoDB
 * search endpoint per video.
 */

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { requireSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  uploadVideo,
  indexSpokenWords,
  indexScenes,
  searchVideo,
  isError,
} from "@/lib/integrations/videodb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500MB for screen recordings
const DEFAULT_SCENE_PROMPT =
  "Describe what is on screen · UI text, application name, key actions, code visible.";

const SESSION_CATEGORY = "videodb_session";

interface SessionMetadata {
  videoId: string;
  streamUrl?: string;
  scenePrompt?: string;
  capturedAt?: string;
  source?: "url" | "upload";
  spokenIndexStatus?: string;
  sceneIndexStatus?: string;
  notes?: string;
}

// ── POST · submit a recording ────────────────────────────────────────

export async function POST(req: Request) {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: `Upload too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024}MB)`,
      },
      { status: 413 },
    );
  }

  let videoSource: { url: string } | { file: File; filename: string } | null =
    null;
  let scenePrompt = DEFAULT_SCENE_PROMPT;
  let notes: string | undefined;
  let capturedAt: string | undefined;

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!file || !(file instanceof File)) {
        return NextResponse.json(
          { error: "file required (multipart/form-data)" },
          { status: 400 },
        );
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json(
          {
            error: `File too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024}MB)`,
          },
          { status: 413 },
        );
      }
      const promptField = form.get("scenePrompt");
      if (typeof promptField === "string" && promptField.trim().length > 0) {
        scenePrompt = promptField.trim().slice(0, 500);
      }
      const notesField = form.get("notes");
      if (typeof notesField === "string") {
        notes = notesField.trim().slice(0, 500);
      }
      const capturedAtField = form.get("capturedAt");
      if (typeof capturedAtField === "string") {
        capturedAt = capturedAtField;
      }
      videoSource = { file, filename: file.name };
    } else {
      const body = (await req.json().catch(() => null)) as {
        url?: string;
        scenePrompt?: string;
        notes?: string;
        capturedAt?: string;
      } | null;
      if (!body || !body.url) {
        return NextResponse.json(
          {
            error:
              "request body must be { url: string } JSON or multipart/form-data with a 'file' field",
          },
          { status: 400 },
        );
      }
      videoSource = { url: body.url };
      if (body.scenePrompt) scenePrompt = body.scenePrompt.slice(0, 500);
      if (body.notes) notes = body.notes.slice(0, 500);
      if (body.capturedAt) capturedAt = body.capturedAt;
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: "bad request",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }

  const uploadResult = await uploadVideo(videoSource);
  if (isError(uploadResult)) {
    const status = uploadResult.code === "missing_api_key" ? 503 : 502;
    return NextResponse.json(
      { error: uploadResult.error, code: uploadResult.code },
      { status },
    );
  }

  // Kick off both indexes · don't block on either succeeding.
  const [spokenResult, sceneResult] = await Promise.all([
    indexSpokenWords(uploadResult.videoId),
    indexScenes(uploadResult.videoId, scenePrompt),
  ]);

  const sessionId = randomUUID();
  const metadata: SessionMetadata = {
    videoId: uploadResult.videoId,
    streamUrl: uploadResult.streamUrl,
    scenePrompt,
    capturedAt: capturedAt ?? new Date().toISOString(),
    source: "url" in videoSource ? "url" : "upload",
    spokenIndexStatus: isError(spokenResult)
      ? `error:${spokenResult.code}`
      : (spokenResult.status ?? "kicked_off"),
    sceneIndexStatus: isError(sceneResult)
      ? `error:${sceneResult.code}`
      : (sceneResult.status ?? "kicked_off"),
    notes,
  };

  const metadataJson = metadata as unknown as Prisma.InputJsonValue;
  await prisma.brainMemory.upsert({
    where: {
      category_key: { category: SESSION_CATEGORY, key: sessionId },
    },
    create: {
      category: SESSION_CATEGORY,
      key: sessionId,
      content: notes ?? `Session captured ${metadata.capturedAt}`,
      confidence: 1,
      source: "operator",
      createdBy: "user",
      metadata: metadataJson,
    },
    update: {
      content: notes ?? `Session captured ${metadata.capturedAt}`,
      metadata: metadataJson,
    },
  });

  return NextResponse.json({
    ok: true,
    sessionId,
    videoId: uploadResult.videoId,
    status: {
      spokenIndex: metadata.spokenIndexStatus,
      sceneIndex: metadata.sceneIndexStatus,
    },
    streamUrl: uploadResult.streamUrl,
  });
}

// ── GET · search or list sessions ────────────────────────────────────

export async function GET(req: Request) {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const limitParam = parseInt(url.searchParams.get("limit") ?? "5", 10);
  const limit = Math.min(Math.max(limitParam, 1), 20);

  // List mode · no query
  if (query.length === 0) {
    const sessions = await prisma.brainMemory.findMany({
      where: { category: SESSION_CATEGORY, deletedAt: null },
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
      mode: "list",
      count: sessions.length,
      sessions: sessions.map((s) => ({
        sessionId: s.key,
        title: s.content,
        metadata: s.metadata,
        capturedAt: s.createdAt.toISOString(),
      })),
    });
  }

  // Search mode · fan out across all sessions, collect top hits
  const sessions = await prisma.brainMemory.findMany({
    where: { category: SESSION_CATEGORY, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 30, // cap fan-out · most recent first
    select: { key: true, metadata: true, createdAt: true, content: true },
  });

  if (sessions.length === 0) {
    return NextResponse.json({
      ok: true,
      mode: "search",
      query,
      count: 0,
      hits: [],
    });
  }

  type HitOut = {
    sessionId: string;
    videoId: string;
    capturedAt: string;
    timestamp: number;
    snippet: string;
    similarity: number;
    source: "spoken_word" | "scene" | "unknown";
    title: string;
  };

  const allHits: HitOut[] = [];
  let missingKeyHit = false;

  await Promise.all(
    sessions.map(async (s) => {
      const meta = (s.metadata ?? {}) as Partial<SessionMetadata>;
      const videoId = meta.videoId;
      if (!videoId) return;
      const result = await searchVideo(videoId, query, {
        indexType: "semantic",
        limit: 3,
      });
      if (isError(result)) {
        if (result.code === "missing_api_key") missingKeyHit = true;
        return;
      }
      for (const h of result.hits) {
        allHits.push({
          sessionId: s.key,
          videoId,
          capturedAt: s.createdAt.toISOString(),
          timestamp: h.start,
          snippet: h.snippet.slice(0, 400),
          similarity: h.similarity,
          source: h.source,
          title: s.content,
        });
      }
    }),
  );

  if (missingKeyHit && allHits.length === 0) {
    return NextResponse.json(
      {
        error: "VIDEO_DB_API_KEY not set",
        code: "missing_api_key",
      },
      { status: 503 },
    );
  }

  allHits.sort((a, b) => b.similarity - a.similarity);
  const top = allHits.slice(0, limit);

  return NextResponse.json({
    ok: true,
    mode: "search",
    query,
    count: top.length,
    hits: top,
  });
}
