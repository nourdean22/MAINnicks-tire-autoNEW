/**
 * Task photo routes (2026-10-29): the upload and the image read are both
 * owner-only, the read is private-cached by sha256, and a guard failure in
 * the service comes back as its status, not a 500.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { ServiceError } from "@/lib/utils/service-error";

const svc = vi.hoisted(() => ({
  addTaskAttachment: vi.fn(),
  readTaskAttachmentImage: vi.fn(),
}));
vi.mock("@/lib/services/task-attachments", () => svc);
vi.mock("@/lib/prisma", () => ({ prisma: {}, resetQueryCount: vi.fn(), getQueryCount: vi.fn(() => 0) }));

import { POST } from "@/app/api/tasks/[id]/attachments/route";
import { GET } from "@/app/api/tasks/[id]/attachments/[attachmentId]/route";
import { requireSession } from "@/lib/auth-guard";

const upload = (form: FormData) =>
  POST(new NextRequest("https://x.test/api/tasks/t1/attachments", { method: "POST", body: form }), {
    params: Promise.resolve({ id: "t1" }),
  });
const image = (headers: Record<string, string> = {}) =>
  GET(new NextRequest("https://x.test/api/tasks/t1/attachments/a1", { headers }), {
    params: Promise.resolve({ id: "t1", attachmentId: "a1" }),
  });
const photoForm = () => {
  const form = new FormData();
  form.append("photo", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" }), "p.jpg");
  form.append("width", "1600");
  form.append("height", "1200");
  return form;
};

beforeEach(() => vi.clearAllMocks());

describe("POST /api/tasks/[id]/attachments", () => {
  it("401 without a session, and the service is never reached", async () => {
    vi.mocked(requireSession).mockRejectedValueOnce(new ServiceError("Unauthorized", 401));
    const res = await upload(photoForm());
    expect(res.status).toBe(401);
    expect(svc.addTaskAttachment).not.toHaveBeenCalled();
  });

  it("hands the bytes and pixel size to the service", async () => {
    svc.addTaskAttachment.mockResolvedValue({ attachment: { id: "a1" }, created: true });
    const res = await upload(photoForm());
    expect(res.status).toBe(200);
    const arg = svc.addTaskAttachment.mock.calls[0][0];
    expect(arg).toMatchObject({ taskId: "t1", width: 1600, height: 1200 });
    expect(Array.from(arg.bytes as Uint8Array)).toEqual([0xff, 0xd8, 0xff, 0xe0]);
  });

  it("a missing photo field is 400; a service refusal keeps its status", async () => {
    expect((await upload(new FormData())).status).toBe(400);
    svc.addTaskAttachment.mockRejectedValue(new ServiceError("too big", 413));
    expect((await upload(photoForm())).status).toBe(413);
  });
});

describe("GET /api/tasks/[id]/attachments/[attachmentId]", () => {
  it("401 without a session, before any read", async () => {
    vi.mocked(requireSession).mockRejectedValueOnce(new ServiceError("Unauthorized", 401));
    const res = await image();
    expect(res.status).toBe(401);
    expect(svc.readTaskAttachmentImage).not.toHaveBeenCalled();
  });

  it("serves the bytes with their mime, a private immutable cache and a sha256 ETag", async () => {
    svc.readTaskAttachmentImage.mockResolvedValue({ data: Buffer.from([1, 2, 3]), mimeType: "image/webp", sha256: "abc" });
    const res = await image();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(res.headers.get("etag")).toBe('"abc"');
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([1, 2, 3]);
    expect(svc.readTaskAttachmentImage).toHaveBeenCalledWith("t1", "a1");
  });

  it("304 on a matching If-None-Match, 404 on a missing photo", async () => {
    svc.readTaskAttachmentImage.mockResolvedValue({ data: Buffer.from([1]), mimeType: "image/jpeg", sha256: "abc" });
    expect((await image({ "if-none-match": '"abc"' })).status).toBe(304);
    svc.readTaskAttachmentImage.mockResolvedValue(null);
    expect((await image()).status).toBe(404);
  });
});
