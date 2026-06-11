import type { Express } from "express";
import express from "express";
import { timingSafeEqual } from "crypto";
import { createLogger } from "../lib/logger";

const serverLog = createLogger("server");

// ─── PWA Push Notification Subscription ──────────────────
// Extracted verbatim from server/_core/index.ts. /api/push/subscribe is
// semi-public: anyone can register a subscription, but the isAdmin flag
// is only honored when the request carries a valid admin API key — that
// inline timingSafeEqual check is preserved verbatim (NOT replaced with
// requireAdminApiKey route middleware, which would gate the whole route).
export function registerPushRoutes(app: Express): void {
  app.post("/api/push/subscribe", express.json(), async (req, res) => {
    try {
      const { endpoint, keys, isAdmin, customerId } = req.body;
      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        res.status(400).json({ error: "Missing subscription data" });
        return;
      }

      // v1.7 audit fix · pre-fix any anonymous caller could POST
      // { isAdmin: true, ... } and create an admin-flagged push
      // subscription, then receive admin push notifications. Now
      // isAdmin=true requires an admin API key on the request.
      let isAdminVerified = false;
      if (isAdmin) {
        const auth = req.headers.authorization;
        const expected = process.env.ADMIN_API_KEY;
        if (expected && typeof auth === "string") {
          const expectedFull = `Bearer ${expected}`;
          if (auth.length === expectedFull.length &&
              timingSafeEqual(Buffer.from(auth), Buffer.from(expectedFull))) {
            isAdminVerified = true;
          }
        }
        if (!isAdminVerified) {
          res.status(401).json({ error: "isAdmin requires admin API key" });
          return;
        }
      }

      const { getDb } = await import("../db");
      const { pushSubscriptions } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const { nanoid } = await import("nanoid");
      const db = await getDb();
      if (!db) { res.status(503).json({ error: "DB unavailable" }); return; }

      // Upsert — don't duplicate endpoints
      const existing = await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).limit(1);
      if (existing.length > 0) {
        await db.update(pushSubscriptions).set({ p256dh: keys.p256dh, auth: keys.auth }).where(eq(pushSubscriptions.id, existing[0].id));
        res.json({ success: true, action: "updated" });
      } else {
        let cleanCustomerId: number | null = null;
        if (customerId !== undefined && customerId !== null) {
          const parsed = Number(customerId);
          if (Number.isInteger(parsed) && parsed > 0 && Number.isFinite(parsed)) {
            cleanCustomerId = parsed;
          }
        }

        await db.insert(pushSubscriptions).values({
          id: nanoid(),
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
          isAdmin: isAdminVerified,
          customerId: cleanCustomerId
        });
        res.json({ success: true, action: "created" });
      }
    } catch (err) {
      serverLog.warn("[push:subscribe] failed", { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: "Subscription failed" });
    }
  });

  app.get("/api/push/vapid-key", (_req, res) => {
    const key = process.env.VAPID_PUBLIC_KEY;
    if (!key) { res.status(503).json({ error: "Push not configured" }); return; }
    res.json({ publicKey: key });
  });
}
