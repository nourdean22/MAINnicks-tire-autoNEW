/**
 * POST /api/tasks/[id]/attachments · 2026-10-29 · add a photo to a task.
 *
 * multipart/form-data: `photo` (Blob, already resized and re-encoded by the
 * client), optional `width` / `height`. Plain fetch, not tRPC: a Blob cannot
 * ride the JSON batch link (same carve-out as /api/ai/transcribe). The size
 * cap and the format check live in the service, which trusts nothing sent here.
 */
import { addTaskAttachment } from "@/lib/services/task-attachments";
import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";

export const dynamic = "force-dynamic";

export const POST = apiHandler(async (req, { params }) => {
  const { id } = await params!;
  let photo: FormDataEntryValue | null;
  let form: FormData;
  try {
    form = await req.formData();
    photo = form.get("photo");
  } catch {
    throw new ServiceError("Expected multipart form data with a photo.", 400);
  }
  if (!(photo instanceof Blob)) throw new ServiceError("Missing photo.", 400);
  const bytes = new Uint8Array(await photo.arrayBuffer());
  return addTaskAttachment({
    taskId: id,
    bytes,
    width: Number(form.get("width")) || undefined,
    height: Number(form.get("height")) || undefined,
  });
}, { auth: "owner" });
