import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

type TunnelMode = "named" | "quick" | "none";

interface TunnelStatus {
  active: boolean;
  url: string | null;
  mode: TunnelMode;
}

const URL_FILE = join(homedir(), ".cloudflared", "tunnel-url.txt");

/**
 * Detect tunnel mode from URL pattern.
 *
 * - *.trycloudflare.com  -> quick tunnel
 * - dev.nickstire.org    -> named tunnel
 * - anything else        -> none
 */
function detectMode(url: string): TunnelMode {
  if (/\.trycloudflare\.com/i.test(url)) return "quick";
  if (/dev\.nickstire\.org/i.test(url)) return "named";
  return "none";
}

/**
 * Parse the tunnel-url.txt key=value file into a record.
 *
 * Format:
 *   mode=quick
 *   url=https://abc-123.trycloudflare.com
 *   started=2026-03-28 14:00:00
 */
function parseUrlFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

/**
 * Get the current Cloudflare tunnel status.
 *
 * Resolution order:
 * 1. `TUNNEL_URL` environment variable (highest priority)
 * 2. `~/.cloudflared/tunnel-url.txt` file
 * 3. Falls back to `{ active: false, url: null, mode: "none" }`
 */
export async function getTunnelStatus(): Promise<TunnelStatus> {
  const inactive: TunnelStatus = { active: false, url: null, mode: "none" };

  // 1. Check environment variable
  const envUrl = process.env.TUNNEL_URL;
  if (envUrl) {
    const mode = detectMode(envUrl);
    return {
      active: true,
      url: envUrl,
      mode: mode === "none" ? "quick" : mode, // env var is presumably active
    };
  }

  // 2. Read URL file
  try {
    const content = await readFile(URL_FILE, "utf-8");
    const data = parseUrlFile(content);

    const url = data.url;
    if (!url || url === "pending" || url === "") return inactive;

    // If file explicitly says mode=none or has a "stopped" key, tunnel is down
    if (data.mode === "none" || data.stopped) return inactive;

    const mode = data.mode === "named" || data.mode === "quick"
      ? (data.mode as TunnelMode)
      : detectMode(url);

    return {
      active: true,
      url,
      mode,
    };
  } catch (e) { /* Tunnel status file doesn't exist or can't be read — expected */
    console.warn("[lib/tunnel-status] tunnel status read failed:", e);
    return inactive;
  }
}

/**
 * Convenience: get just the tunnel URL or null.
 */
export async function getTunnelUrl(): Promise<string | null> {
  const status = await getTunnelStatus();
  return status.url;
}
