/**
 * Signed image URLs · 2026-09-07 (program D13).
 *
 * `GET /api/images/[id]` serves generated images — and, since the photo
 * improver, the operator's own photos — by unguessable id with a public
 * cache header and no auth. That is load-bearing: chat markdown renders
 * them, /content publish previews them, and Meta must fetch the URL to post
 * it. So the fix is not "require a session" (Meta has none) but a
 * capability URL: `/api/images/<id>?exp=<unix>&sig=<hmac>`.
 *
 * Rollout is behind ONE flag so the default stays byte-identical:
 *   IMAGES_REQUIRE_SIGNATURE unset/0 → raw ids still serve; signed URLs are
 *     accepted too, and a PRESENT-but-invalid signature is refused (a
 *     tampered link never degrades to "public anyway").
 *   IMAGES_REQUIRE_SIGNATURE=1 → raw ids are refused (401); every server-side
 *     minter goes through `imagePath()` and therefore signs.
 *
 * Secret: IMAGE_URL_SECRET, falling back to AUTH_SECRET (already required
 * for sessions). No secret + flag on = 503 with a clear reason, never an
 * open door.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const IMAGE_SIGNATURE_FLAG = "IMAGES_REQUIRE_SIGNATURE";
/** Long enough for a scheduled social post to be fetched; short enough to bound a leaked link. */
export const DEFAULT_IMAGE_TTL_SECONDS = 7 * 86_400;
const SIG_HEX_CHARS = 32;

type Env = Record<string, string | undefined>;

export function imageSignatureRequired(env: Env = process.env): boolean {
  const v = env[IMAGE_SIGNATURE_FLAG];
  return v === "1" || v === "true";
}

function signingSecret(env: Env): string | null {
  return env.IMAGE_URL_SECRET || env.AUTH_SECRET || null;
}

function digest(secret: string, id: string, exp: number): string {
  return createHmac("sha256", secret).update(`${id}.${exp}`).digest("hex").slice(0, SIG_HEX_CHARS);
}

export interface SignOptions {
  ttlSeconds?: number;
  now?: number;
  env?: Env;
}

/** Always signs. Throws when no secret is configured — a minter must not silently emit a raw path when asked to sign. */
export function signImagePath(id: string, opts: SignOptions = {}): string {
  const env = opts.env ?? process.env;
  const secret = signingSecret(env);
  if (!secret) throw new Error("image signing requested but neither IMAGE_URL_SECRET nor AUTH_SECRET is set");
  const exp = Math.floor((opts.now ?? Date.now()) / 1000) + (opts.ttlSeconds ?? DEFAULT_IMAGE_TTL_SECONDS);
  return `/api/images/${encodeURIComponent(id)}?exp=${exp}&sig=${digest(secret, id, exp)}`;
}

/**
 * The one path minter. Signs when the flag is on; raw path otherwise. Every
 * server-side place that builds an image URL should call this.
 */
export function imagePath(id: string, opts: SignOptions = {}): string {
  const env = opts.env ?? process.env;
  return imageSignatureRequired(env) ? signImagePath(id, { ...opts, env }) : `/api/images/${encodeURIComponent(id)}`;
}

export type ImageAuth =
  | { ok: true; signed: boolean; expiresAt: number | null }
  | { ok: false; status: 401 | 403 | 503; reason: string };

export interface AuthorizeInput {
  id: string;
  exp: string | null | undefined;
  sig: string | null | undefined;
  now?: number;
  env?: Env;
}

/** Decide whether a request may read the image. Pure: no I/O. */
export function authorizeImageRequest(input: AuthorizeInput): ImageAuth {
  const env = input.env ?? process.env;
  const now = input.now ?? Date.now();
  const required = imageSignatureRequired(env);
  const exp = input.exp ?? null;
  const sig = input.sig ?? null;

  if (exp === null && sig === null) {
    return required
      ? { ok: false, status: 401, reason: "signature required" }
      : { ok: true, signed: false, expiresAt: null };
  }
  if (exp === null || sig === null) {
    return { ok: false, status: 403, reason: "malformed signature" };
  }
  const secret = signingSecret(env);
  if (!secret) return { ok: false, status: 503, reason: "image signing not configured" };

  const expNum = /^\d{1,12}$/.test(exp) ? Number(exp) : NaN;
  if (!Number.isFinite(expNum)) return { ok: false, status: 403, reason: "malformed signature" };
  if (expNum * 1000 <= now) return { ok: false, status: 403, reason: "link expired" };

  const expected = Buffer.from(digest(secret, input.id, expNum), "utf8");
  const presented = Buffer.from(sig, "utf8");
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return { ok: false, status: 403, reason: "bad signature" };
  }
  return { ok: true, signed: true, expiresAt: expNum * 1000 };
}

const IMAGE_ID_PATH = /^\/api\/images\/([A-Za-z0-9_-]+)$/;

/**
 * Re-mint an image URL immediately before it is handed to a third party.
 * Handles every persisted shape (review on #2195): a relative raw id, a
 * relative or ABSOLUTE signed URL (whose signature may have expired since
 * it was stored), and an absolute raw URL such as
 * `https://bdnick.info/api/images/<id>` written by an earlier publish. The
 * origin is kept; the query is replaced by a fresh signature. Anything that
 * is not an image-id path passes through, and with the flag off nothing
 * changes at all.
 */
export function ensureSignedImageUrl(url: string, opts: SignOptions = {}): string {
  const env = opts.env ?? process.env;
  if (!imageSignatureRequired(env)) return url;
  if (url.startsWith("/")) {
    const q = url.indexOf("?");
    const path = q >= 0 ? url.slice(0, q) : url;
    const m = IMAGE_ID_PATH.exec(path);
    return m ? signImagePath(m[1], { ...opts, env }) : url;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const m = IMAGE_ID_PATH.exec(parsed.pathname);
  if (!m) return url;
  return `${parsed.origin}${signImagePath(m[1], { ...opts, env })}`;
}

/** @deprecated use ensureSignedImageUrl — kept as an alias for the relative-path callers. */
export function ensureSignedImagePath(path: string, opts: SignOptions = {}): string {
  return ensureSignedImageUrl(path, opts);
}
