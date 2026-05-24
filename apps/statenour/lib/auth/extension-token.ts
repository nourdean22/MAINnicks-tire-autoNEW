/**
 * lib/auth/extension-token.ts · P4 · 2026-05-23.
 *
 * Personal API token issuance + validation for the Chrome extension
 * (and any future external clients). Tokens are sha256-hashed in
 * BrainMemory(category=API_TOKEN) so the raw token is only visible
 * to the operator at issue-time. Revocation is soft-delete · sets
 * BrainMemory.deletedAt.
 *
 * Storage choice (BrainMemory vs dedicated table): MVP uses the
 * existing BrainMemory table to avoid a schema migration. Upgrade to
 * a dedicated ApiToken table when scope/quota columns become real
 * requirements.
 *
 * Token shape: `sn_` + 24 chars of nanoid base62. Prefix lets the
 * operator + log grep distinguish from arbitrary strings.
 */

import { createHash, randomBytes } from "node:crypto";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("auth/extension-token");

const TOKEN_PREFIX = "sn_";
const TOKEN_BODY_LEN = 24;
const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/**
 * Generate a fresh token. Returns the RAW token (must be shown to
 * the operator immediately · never persisted in plaintext).
 */
function generateRawToken(): string {
  // 4 bytes of entropy per char · pull more than we need + slice.
  const bytes = randomBytes(TOKEN_BODY_LEN * 2);
  let out = "";
  for (let i = 0; i < TOKEN_BODY_LEN; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return TOKEN_PREFIX + out;
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export interface IssueTokenInput {
  label: string;
  scope?: string;
}

export interface IssueTokenResult {
  /** The raw token · shown ONCE · never readable from DB again. */
  token: string;
  /** Label the operator set on issuance. */
  label: string;
  /** ISO timestamp. */
  createdAt: string;
}

export async function issueToken(input: IssueTokenInput): Promise<IssueTokenResult> {
  const { prisma } = await import("@/lib/prisma");
  const raw = generateRawToken();
  const hash = hashToken(raw);
  const createdAt = new Date();

  // Key = label-derived nanoid · keep readable so operator can match
  // entries against tokens later (e.g. "chrome-laptop").
  const safeLabel = input.label.replace(/[^a-z0-9-_]/gi, "-").slice(0, 32);
  const key = `${safeLabel}_${createdAt.getTime().toString(36)}`;

  await prisma.brainMemory.create({
    data: {
      category: BRAIN_CATEGORIES.API_TOKEN,
      key,
      content: hash,
      confidence: 0,
      source: "extension-token",
      createdBy: "operator:issue",
      metadata: {
        label: input.label,
        scope: input.scope ?? "extension",
        createdAt: createdAt.toISOString(),
        lastUsedAt: null,
      },
    },
  });

  return {
    token: raw,
    label: input.label,
    createdAt: createdAt.toISOString(),
  };
}

export interface ValidatedToken {
  id: string;
  key: string;
  label: string;
  scope: string;
  createdAt: string;
}

/**
 * Validate an Authorization-header token. Returns the ValidatedToken
 * on success, null on any failure (wrong prefix · not found · revoked).
 *
 * Constant-time-ish: the sha256 hash + Prisma findFirst keeps the
 * timing variance low. Not a hardened crypto path · adequate for a
 * single-operator threat model.
 */
export async function validateToken(authHeader: string | null): Promise<ValidatedToken | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const raw = authHeader.slice("Bearer ".length).trim();
  if (!raw.startsWith(TOKEN_PREFIX)) return null;
  if (raw.length !== TOKEN_PREFIX.length + TOKEN_BODY_LEN) return null;

  const hash = hashToken(raw);

  try {
    const { prisma } = await import("@/lib/prisma");
    const row = await prisma.brainMemory.findFirst({
      where: {
        category: BRAIN_CATEGORIES.API_TOKEN,
        content: hash,
        deletedAt: null,
      },
      select: { id: true, key: true, metadata: true, createdAt: true },
    });
    if (!row) return null;

    const meta = (row.metadata ?? {}) as {
      label?: string;
      scope?: string;
      lastUsedAt?: string | null;
    };

    // Touch lastUsedAt · fire-and-forget · don't block the request.
    void prisma.brainMemory
      .update({
        where: { id: row.id },
        data: {
          metadata: { ...meta, lastUsedAt: new Date().toISOString() },
          lastSeen: new Date(),
        },
      })
      .catch(() => {});

    return {
      id: row.id,
      key: row.key,
      label: meta.label ?? row.key,
      scope: meta.scope ?? "extension",
      createdAt: row.createdAt.toISOString(),
    };
  } catch (e) {
    log.warn("validate_failed", { err: (e as Error).message?.slice(0, 200) });
    return null;
  }
}

export interface TokenListItem {
  id: string;
  label: string;
  scope: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** Last 4 chars of the key (NOT the token · the BrainMemory key)
   *  for the operator to identify which row to revoke. */
  keyHint: string;
}

export async function listTokens(): Promise<TokenListItem[]> {
  try {
    const { prisma } = await import("@/lib/prisma");
    const rows = await prisma.brainMemory.findMany({
      where: {
        category: BRAIN_CATEGORIES.API_TOKEN,
        deletedAt: null,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, key: true, metadata: true, createdAt: true },
    });
    return rows.map((r) => {
      const meta = (r.metadata ?? {}) as {
        label?: string;
        scope?: string;
        lastUsedAt?: string | null;
      };
      return {
        id: r.id,
        label: meta.label ?? r.key,
        scope: meta.scope ?? "extension",
        createdAt: r.createdAt.toISOString(),
        lastUsedAt: meta.lastUsedAt ?? null,
        keyHint: r.key.slice(-6),
      };
    });
  } catch (e) {
    log.warn("list_failed", { err: (e as Error).message?.slice(0, 200) });
    return [];
  }
}

export async function revokeToken(id: string): Promise<{ ok: boolean }> {
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.brainMemory.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  } catch (e) {
    log.warn("revoke_failed", { id, err: (e as Error).message?.slice(0, 200) });
    return { ok: false };
  }
}
