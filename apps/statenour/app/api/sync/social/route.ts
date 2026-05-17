import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

// POST: Receive social media post data from the social engine
export const POST = apiHandler(async (req) => {
  const data = await req.json();

  await prisma.auditEvent.create({
    data: {
      actor: "social-engine",
      eventType: "social_post_published",
      detail: "Instagram post published via social engine",
      payload: {
        theme: data.theme,
        caption_preview: typeof data.caption === "string" ? data.caption.slice(0, 200) : undefined,
        status: data.status,
        confidence: data.confidence,
        permalink: data.permalink,
        posted_at: new Date().toISOString(),
      },
    },
  });

  return { message: "Social post logged" };
}, { auth: "sync" });

// GET: Return recent social posts for AI context
export const GET = apiHandler(async () => {
  const recent = await prisma.auditEvent.findMany({
    where: { eventType: "social_post_published" },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  return {
    posts: recent.map(e => ({ ...e.payload as object, synced_at: e.createdAt })),
    count: recent.length,
  };
}, { auth: "sync" });
