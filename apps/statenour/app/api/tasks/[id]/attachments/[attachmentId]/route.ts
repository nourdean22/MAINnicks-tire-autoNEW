/**
 * GET /api/tasks/[id]/attachments/[attachmentId] · 2026-10-29 · a task photo.
 *
 * Owner-only, the one read that loads the bytes. The browser revalidates on
 * every view (no-cache plus the sha256 ETag, so an unchanged photo is a 304 with
 * no bytes): a deleted photo, a deleted task or a signed-out device must stop
 * showing it, which a long-lived immutable cache would not.
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
    "Cache-Control": "private, no-cache",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(photo.data), { headers: { ...headers, "Content-Type": photo.mimeType } });
}, { auth: "owner" });
