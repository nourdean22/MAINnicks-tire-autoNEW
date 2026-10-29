/**
 * GET /api/tasks/[id]/attachments/[attachmentId] · 2026-10-29 · a task photo.
 *
 * Owner-only, the one read that loads the bytes. A photo row never changes
 * after insert (same id, same sha256), so the browser may keep it forever,
 * privately.
 */
import { readTaskAttachmentImage } from "@/lib/services/task-attachments";
import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req, { params }) => {
  const { id, attachmentId } = await params!;
  const photo = await readTaskAttachmentImage(id, attachmentId);
  if (!photo) throw new ServiceError("Photo not found.", 404);
  const etag = `"${photo.sha256}"`;
  const headers = {
    "Cache-Control": "private, max-age=31536000, immutable",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(photo.data), { headers: { ...headers, "Content-Type": photo.mimeType } });
}, { auth: "owner" });
