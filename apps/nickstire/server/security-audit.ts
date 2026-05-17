/**
 * Security Middleware for Nick's Tire & Auto
 * Detects XSS, SQL injection, and path traversal attacks.
 * Includes brute force protection with temporary IP bans.
 */

import type { Request, Response, NextFunction } from "express";
import { createLogger } from "./lib/logger";

const log = createLogger("security");

// ─── Patterns ──────────────────────────────────────────
const XSS_PATTERNS = [
  /<script/i, /javascript:/i, /onerror\s*=/i, /onload\s*=/i,
  /<img\s+src\s*=/i, /<svg\s+onload/i, /eval\s*\(/i, /on\w+\s*=/i,
];

const SQLI_PATTERNS = [
  /union\s+select/i, /or\s+1\s*=\s*1/i, /drop\s+table/i,
  /;\s*delete\s/i, /1['"];\s*--/i, /waitfor\s+delay/i,
  /'\s*or\s*'.*'\s*=\s*'/i, /--\s*$/,
];

const PATH_TRAVERSAL_PATTERNS = [
  /\.\.\//g, /\.\.%2f/gi, /\.\.%5c/gi, /%00/g,
];

// ─── Whitelist ─────────────────────────────────────────
const WHITELIST = ["/api/health", "/api/ready"];
const WHITELIST_PREFIX = ["/api/webhooks/"];

function isWhitelisted(path: string): boolean {
  if (WHITELIST.includes(path)) return true;
  return WHITELIST_PREFIX.some((p) => path.startsWith(p));
}

// ─── Brute Force Tracking ──────────────────────────────
interface BlockRecord {
  count: number;
  firstSeen: number;
  bannedUntil: number;
}

const blockMap = new Map<string, BlockRecord>();
const BLOCK_WINDOW = 5 * 60 * 1000; // 5 minutes
const BLOCK_THRESHOLD = 10;
const BAN_DURATION = 30 * 60 * 1000; // 30 minutes

// Cleanup old entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of blockMap) {
    if (now > record.bannedUntil && now - record.firstSeen > BLOCK_WINDOW) {
      blockMap.delete(ip);
    }
  }
}, 10 * 60 * 1000);

function recordBlock(ip: string): void {
  const now = Date.now();
  const record = blockMap.get(ip);
  if (record) {
    if (now - record.firstSeen > BLOCK_WINDOW) {
      // Reset window
      record.count = 1;
      record.firstSeen = now;
    } else {
      record.count++;
      if (record.count >= BLOCK_THRESHOLD) {
        record.bannedUntil = now + BAN_DURATION;
        log.warn("[Security] IP temp-banned for excessive blocked requests", { ip });
      }
    }
  } else {
    blockMap.set(ip, { count: 1, firstSeen: now, bannedUntil: 0 });
  }
}

function isBanned(ip: string): boolean {
  const record = blockMap.get(ip);
  return !!record && record.bannedUntil > Date.now();
}

// ─── Scanning ──────────────────────────────────────────
function scanValue(value: unknown, depth = 0): string | null {
  if (depth > 10) return null; // Prevent stack overflow from deeply nested payloads
  if (typeof value !== "string") {
    if (typeof value === "object" && value !== null) {
      for (const v of Object.values(value)) {
        const result = scanValue(v, depth + 1);
        if (result) return result;
      }
    }
    return null;
  }

  for (const pattern of XSS_PATTERNS) {
    if (pattern.test(value)) return "xss";
  }
  for (const pattern of SQLI_PATTERNS) {
    if (pattern.test(value)) return "sqli";
  }
  for (const pattern of PATH_TRAVERSAL_PATTERNS) {
    if (pattern.test(value)) return "path_traversal";
  }
  return null;
}

/** Express middleware that blocks malicious requests. */
export function securityScan() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isWhitelisted(req.path)) return next();

    const ip = req.ip || req.socket.remoteAddress || "unknown";

    // Check if IP is temp-banned
    if (isBanned(ip)) {
      return res.status(403).json({ error: "Request blocked" });
    }

    // Scan URL path
    const pathThreat = scanValue(req.path);
    if (pathThreat) {
      recordBlock(ip);
      log.warn("[Security] Blocked request — path", { ip, path: req.path, threat: pathThreat });
      return res.status(403).json({ error: "Request blocked" });
    }

    // Scan query params
    if (Object.keys(req.query).length > 0) {
      const queryThreat = scanValue(req.query);
      if (queryThreat) {
        recordBlock(ip);
        log.warn("[Security] Blocked request — query", { ip, path: req.path, threat: queryThreat });
        return res.status(403).json({ error: "Request blocked" });
      }
    }

    // Scan body (only if parsed as object)
    if (req.body && typeof req.body === "object") {
      const bodyThreat = scanValue(req.body);
      if (bodyThreat) {
        recordBlock(ip);
        log.warn("[Security] Blocked request — body", { ip, path: req.path, threat: bodyThreat });
        return res.status(403).json({ error: "Request blocked" });
      }
    }

    next();
  };
}

/** Get security stats for admin dashboard. */
export function getSecurityStats() {
  let blocked = 0;
  let banned = 0;
  const now = Date.now();
  for (const record of blockMap.values()) {
    blocked += record.count;
    if (record.bannedUntil > now) banned++;
  }
  return { blockedRequests: blocked, bannedIPs: banned, trackedIPs: blockMap.size };
}
