/**
 * Nick AI Agent — Chat/communication handlers: social, media, reviews, memory.
 * Handles: socialPost, socialStatus, reviewContent, sendMedia, remember, memories,
 *          cameraFeed, cameras, setCamera, shopPulse, shopDriverStatus,
 *          schedulerStatus, triggerPrerender, syncShopDriver, customerIntelligence
 */
import { eq, sql } from "drizzle-orm";
import { invokeLLM } from "../../_core/llm";
import type { ShopSetting } from "../../../drizzle/schema";
import { log, db, type CameraEntry } from "./utils";

// ─── Social Post ──────────────────────────────────────

export async function handleSocialPost(input: {
  platforms: ("facebook" | "instagram")[];
  message: string;
  imageUrl?: string;
  link?: string;
}) {
  const { socialPost } = await import("../../services/metaSocial");
  const result = await socialPost({
    platforms: input.platforms,
    message: input.message,
    imageUrl: input.imageUrl,
    link: input.link,
  });

  // Unified event bus
  import("../../services/eventBus").then(({ emit }) =>
    emit.socialPosted({
      platforms: input.platforms,
      success: result.results.every(r => r.success),
    })
  ).catch(e => console.warn("[nickActions:socialPost] event bus dispatch failed:", e));

  return result;
}

// ─── Social Status ────────────────────────────────────

export async function handleSocialStatus() {
  const { getMetaSocialStatus } = await import("../../services/metaSocial");
  return getMetaSocialStatus();
}

// ─── Customer Intelligence ────────────────────────────

export async function handleCustomerIntelligence() {
  const { analyzeCustomers } = await import("../../services/customerIntelligence");
  return analyzeCustomers();
}

// ─── Camera Feed ──────────────────────────────────────

export async function handleCameraFeed(input: { cameraId: string }) {
  const d = await db();
  if (!d) return { error: "DB unavailable", feeds: [] };

  const { shopSettings } = await import("../../../drizzle/schema");
  const result = await d.select().from(shopSettings)
    .where(sql`${shopSettings.key} LIKE 'camera_%'`);

  const cameras: CameraEntry[] = result.map((r: ShopSetting) => {
    try {
      const data = JSON.parse(r.value) as Record<string, string>;
      return { id: r.key.replace("camera_", ""), name: data.name, url: data.url, type: data.type || "http" };
    } catch (e) { console.warn("[routers/nickActions] operation failed:", e); return null; }
  }).filter((c: CameraEntry | null): c is CameraEntry => c !== null);

  const target = cameras.find((c) => c.id === input.cameraId);
  if (!target) return { error: "Camera not found", feeds: cameras };

  return {
    camera: target,
    feeds: cameras,
    streamUrl: target.url,
    note: "For RTSP cameras, use the stream URL in a video player. For HTTP cameras, embed as img src.",
  };
}

// ─── List Cameras ─────────────────────────────────────

export async function handleCameras() {
  const d = await db();
  if (!d) return [];

  const { shopSettings } = await import("../../../drizzle/schema");
  const result = await d.select().from(shopSettings)
    .where(sql`${shopSettings.key} LIKE 'camera_%'`);

  return result.map((r: ShopSetting) => {
    try {
      const data = JSON.parse(r.value) as Record<string, unknown>;
      return { id: r.key.replace("camera_", ""), ...data };
    } catch (e) { console.warn("[routers/nickActions] operation failed:", e); return null; }
  }).filter((c: Record<string, unknown> | null): c is Record<string, unknown> & { id: string } => c !== null);
}

// ─── Set Camera ───────────────────────────────────────

export async function handleSetCamera(input: {
  id: string;
  name: string;
  url: string;
  type: string;
  location?: string;
  v380DeviceId?: string;
  ringDeviceId?: string;
  eufySerial?: string;
  tunnelUrl?: string;
  snapshotUrl?: string;
}) {
  const d = await db();
  if (!d) return { success: false };

  const { shopSettings } = await import("../../../drizzle/schema");
  const key = `camera_${input.id}`;
  const value = JSON.stringify({
    name: input.name, url: input.url, type: input.type,
    location: input.location || "",
    v380DeviceId: input.v380DeviceId, ringDeviceId: input.ringDeviceId,
    eufySerial: input.eufySerial, tunnelUrl: input.tunnelUrl,
    snapshotUrl: input.snapshotUrl,
  });

  const existing = await d.select().from(shopSettings).where(eq(shopSettings.key, key)).limit(1);
  if (existing.length > 0) {
    await d.update(shopSettings).set({ value }).where(eq(shopSettings.key, key));
  } else {
    await d.insert(shopSettings).values({ key, value });
  }
  return { success: true };
}

// ─── Shop Pulse ───────────────────────────────────────

export async function handleShopPulse() {
  const { getShopPulse } = await import("../../services/nickIntelligence");
  return getShopPulse();
}

// ─── ShopDriver Status ────────────────────────────────

export async function handleShopDriverStatus() {
  const { getSyncStatus } = await import("../../services/shopDriverSync");
  return getSyncStatus();
}

// ─── Scheduler Status ─────────────────────────────────

export async function handleSchedulerStatus() {
  const { getTierStatuses } = await import("../../cron/scheduler");
  return getTierStatuses();
}

// ─── Trigger Prerender ────────────────────────────────

export function handleTriggerPrerender() {
  return {
    success: true,
    message: "Run locally: node scripts/prerender.mjs --port 3000 (against live site)",
    note: "Prerender generates static HTML for SEO bots. Run after every major content change.",
  };
}

// ─── Sync ShopDriver ──────────────────────────────────

export async function handleSyncShopDriver() {
  const { runFullMirror } = await import("../../services/shopDriverMirror");
  return runFullMirror();
}

// ─── Remember ─────────────────────────────────────────

export async function handleRemember(input: {
  type: "insight" | "lesson" | "preference" | "pattern" | "customer";
  content: string;
  source: string;
}) {
  const { remember } = await import("../../services/nickMemory");
  await remember(input);
  return { success: true };
}

// ─── Memories ─────────────────────────────────────────

export async function handleMemories(input?: {
  type?: "insight" | "lesson" | "preference" | "pattern" | "customer";
  limit?: number;
}) {
  const { recall } = await import("../../services/nickMemory");
  return recall({ type: input?.type, limit: input?.limit });
}

// ─── Send Media ───────────────────────────────────────

export async function handleSendMedia(input: {
  type: "photo" | "video" | "document" | "album";
  url?: string;
  urls?: string[];
  caption?: string;
}) {
  const { sendTelegramPhoto, sendTelegramVideo, sendTelegramDocument, sendTelegramMediaGroup } =
    await import("../../services/telegram");

  if (input.type === "photo" && input.url) {
    const ok = await sendTelegramPhoto(input.url, input.caption);
    return { success: ok };
  }
  if (input.type === "video" && input.url) {
    const ok = await sendTelegramVideo(input.url, input.caption);
    return { success: ok };
  }
  if (input.type === "document" && input.url) {
    const ok = await sendTelegramDocument(input.url, input.caption);
    return { success: ok };
  }
  if (input.type === "album" && input.urls?.length) {
    const ok = await sendTelegramMediaGroup(
      input.urls.map((u, i) => ({ type: "photo" as const, url: u, caption: i === 0 ? input.caption : undefined }))
    );
    return { success: ok };
  }
  return { success: false, error: "Invalid media type or missing URL" };
}

// ─── Review Content ───────────────────────────────────

export async function handleReviewContent(input: {
  content: string;
  contentType: "social_post" | "email" | "estimate" | "reply" | "brief" | "general";
  context?: string;
}) {
  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are Nick AI's quality control layer for Nick's Tire & Auto (Cleveland, OH).

REVIEW this ${input.contentType} for:
1. ACCURACY — Are facts, prices, hours, phone numbers correct?
   - Phone: (216) 862-0005
   - Address: 17625 Euclid Ave, Cleveland, OH 44112
   - Hours: Mon-Sat 8AM-6PM, Sun 9AM-4PM
   - Rating: 4.9 stars, 1685+ reviews
   - Walk-ins welcome, first come first serve, drop-offs encouraged
2. TONE — Does it match the brand? Direct, honest, no-nonsense, Cleveland proud, not corporate.
3. ERRORS — Grammar, spelling, broken formatting, missing info.
4. EFFECTIVENESS — Will this achieve its goal? Would a real customer respond?
5. RISKS — Anything that could look bad, offend, or create liability?

Respond with JSON:
{
  "approved": true/false,
  "score": 1-10,
  "issues": ["issue 1", "issue 2"],
  "suggestions": ["fix 1", "fix 2"],
  "correctedContent": "improved version if score < 8, otherwise null"
}`,
      },
      {
        role: "user",
        content: `Review this ${input.contentType}:\n\n${input.content}${input.context ? `\n\nContext: ${input.context}` : ""}`,
      },
    ],
    maxTokens: 800,
  });

  const raw = response.choices?.[0]?.message?.content;
  let result = { approved: false, score: 0, issues: ["Failed to parse review"], suggestions: [] as string[], correctedContent: null as string | null };
  if (raw && typeof raw === "string") {
    try {
      const cleaned = raw.replace(/```json\s*\n?/g, "").replace(/```\s*$/g, "").trim();
      result = JSON.parse(cleaned);
    } catch (e) {
      console.warn("[routers/nickActions] operation failed:", e);
      result = { approved: false, score: 0, issues: ["AI review response was not valid JSON"], suggestions: ["Re-run review"], correctedContent: null };
    }
  }

  // Feed review results back into Nick AI memory
  try {
    const { recordReviewResult } = await import("../../services/feedbackLoop");
    await recordReviewResult(input.contentType, result.score, result.issues);
  } catch (e) { console.warn("[nickActions:selfReview] feedback recording failed:", e); }

  return result;
}
