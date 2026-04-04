/**
 * Camera Proxy — Unified camera access for NOUR OS Command Center.
 *
 * Supports:
 * 1. V380 cameras (Cloud P2P for remote, RTSP for local LAN)
 * 2. Ring cameras (cloud API via ring_doorbell)
 * 3. Eufy cameras (WS bridge)
 * 4. Generic RTSP/MJPEG/HTTP cameras
 *
 * For V380/RTSP cameras at the shop:
 *   The shop computer runs a local RTSP-to-MJPEG proxy
 *   exposed via Cloudflare tunnel. The Command Center
 *   loads the MJPEG stream from the tunnel URL.
 *
 * Camera config stored in shopSettings as camera_{id}.
 */

import { createLogger } from "../lib/logger";
import { eq, sql } from "drizzle-orm";

const log = createLogger("camera-proxy");

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

export interface CameraConfig {
  id: string;
  name: string;
  url: string;
  type: "rtsp" | "http" | "mjpeg" | "hls" | "v380-cloud" | "ring" | "eufy";
  location?: string;
  /** V380 cloud device ID */
  v380DeviceId?: string;
  /** Ring device ID */
  ringDeviceId?: string;
  /** Eufy device serial */
  eufySerial?: string;
  /** Cloudflare tunnel URL for local proxy */
  tunnelUrl?: string;
  /** Snapshot URL (for periodic refresh) */
  snapshotUrl?: string;
}

/**
 * Get all configured cameras with their access URLs.
 */
export async function getAllCameras(): Promise<CameraConfig[]> {
  const d = await db();
  if (!d) return [];

  const { shopSettings } = await import("../../drizzle/schema");
  const rows = await d.select().from(shopSettings)
    .where(sql`${shopSettings.key} LIKE 'camera_%'`);

  return rows.map(r => {
    try {
      const data = JSON.parse(r.value);
      return {
        id: r.key.replace("camera_", ""),
        name: data.name || r.key,
        url: data.url || "",
        type: data.type || "http",
        location: data.location || "",
        v380DeviceId: data.v380DeviceId,
        ringDeviceId: data.ringDeviceId,
        eufySerial: data.eufySerial,
        tunnelUrl: data.tunnelUrl,
        snapshotUrl: data.snapshotUrl,
      };
    } catch { return null; }
  }).filter(Boolean) as CameraConfig[];
}

/**
 * Get the best viewable URL for a camera.
 * For RTSP cameras, returns the tunnel MJPEG URL if available.
 * For cloud cameras (Ring/Eufy/V380), returns the cloud stream URL.
 */
export function getViewableUrl(camera: CameraConfig): {
  embedUrl: string | null;
  fallbackUrl: string | null;
  viewMethod: "iframe" | "img" | "video" | "link";
  note: string;
} {
  // MJPEG/HTTP — directly embeddable
  if (camera.type === "mjpeg" || camera.type === "http") {
    return {
      embedUrl: camera.url,
      fallbackUrl: camera.snapshotUrl || null,
      viewMethod: "img",
      note: "Direct stream",
    };
  }

  // HLS — use video tag
  if (camera.type === "hls") {
    return {
      embedUrl: camera.url,
      fallbackUrl: null,
      viewMethod: "video",
      note: "HLS stream",
    };
  }

  // RTSP — need tunnel proxy or snapshot
  if (camera.type === "rtsp") {
    if (camera.tunnelUrl) {
      return {
        embedUrl: camera.tunnelUrl,
        fallbackUrl: camera.snapshotUrl || null,
        viewMethod: "img",
        note: "RTSP via Cloudflare tunnel proxy",
      };
    }
    return {
      embedUrl: camera.snapshotUrl || null,
      fallbackUrl: null,
      viewMethod: camera.snapshotUrl ? "img" : "link",
      note: "RTSP — open in VLC: " + camera.url,
    };
  }

  // V380 Cloud — use V380 Pro app or cloud relay
  if (camera.type === "v380-cloud") {
    return {
      embedUrl: null,
      fallbackUrl: camera.snapshotUrl || null,
      viewMethod: "link",
      note: `V380 Cloud (Device: ${camera.v380DeviceId}) — open V380 Pro app`,
    };
  }

  // Ring — cloud API snapshot
  if (camera.type === "ring") {
    return {
      embedUrl: camera.snapshotUrl || null,
      fallbackUrl: null,
      viewMethod: camera.snapshotUrl ? "img" : "link",
      note: "Ring camera — snapshots via cloud API",
    };
  }

  // Eufy — WS bridge
  if (camera.type === "eufy") {
    return {
      embedUrl: camera.snapshotUrl || null,
      fallbackUrl: null,
      viewMethod: camera.snapshotUrl ? "img" : "link",
      note: "Eufy camera — stream via WS bridge",
    };
  }

  return { embedUrl: null, fallbackUrl: null, viewMethod: "link", note: "Unknown camera type" };
}
