import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";

export const dynamic = "force-dynamic";

// Slug used as the public path segment in /api/short/<code>.
const CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * GET /api/short
 * Owner-gated list of all short links (with click counts), newest first.
 * NOTE: the public per-code redirector lives at /api/short/[code]; this
 * collection route is session-authenticated (middleware only whitelists
 * `/api/short/`, and apiHandler enforces `auth:"owner"` regardless).
 */
export const GET = apiHandler(
  async () => {
    const links = await prisma.shortLink.findMany({ orderBy: { createdAt: "desc" } });
    return { links };
  },
  { auth: "owner" }
);

/**
 * POST /api/short
 * Owner-gated short-link creation. Body: { code, url, source?, medium?, campaign? }.
 */
export const POST = apiHandler(
  async (req) => {
    let body: { code?: string; url?: string; source?: string; medium?: string; campaign?: string };
    try {
      body = await req.json();
    } catch {
      throw new ServiceError("Invalid JSON body", 400);
    }

    const code = body.code?.trim();
    const url = body.url?.trim();

    if (!code || !CODE_RE.test(code)) {
      throw new ServiceError("Code must be 1–64 characters: letters, numbers, dashes or underscores.", 400);
    }
    if (!url) {
      throw new ServiceError("Destination URL is required.", 400);
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("non-http protocol");
      }
    } catch {
      throw new ServiceError("Destination must be a valid http(s) URL.", 400);
    }

    try {
      const link = await prisma.shortLink.create({
        data: {
          id: code,
          url,
          source: body.source?.trim() || null,
          medium: body.medium?.trim() || null,
          campaign: body.campaign?.trim() || null,
        },
      });
      return { link };
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        throw new ServiceError("That short code already exists.", 409);
      }
      throw err;
    }
  },
  { auth: "owner" }
);

/**
 * DELETE /api/short?code=<code>
 * Owner-gated delete. LinkClick rows cascade (onDelete: Cascade in schema).
 */
export const DELETE = apiHandler(
  async (req) => {
    const code = new URL(req.url).searchParams.get("code")?.trim();
    if (!code) {
      throw new ServiceError("code is required", 400);
    }
    try {
      await prisma.shortLink.delete({ where: { id: code } });
    } catch (err) {
      if ((err as { code?: string }).code === "P2025") {
        throw new ServiceError("Short link not found.", 404);
      }
      throw err;
    }
    return { ok: true };
  },
  { auth: "owner" }
);
