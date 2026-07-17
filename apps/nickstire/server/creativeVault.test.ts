/**
 * Creative Vault — Drive REST layer + consent + archive-refusal units.
 * Network fully mocked; the db-glued end-to-end (real uploads, reconcile)
 * runs in the M4 acceptance trajectory after the operator's consent grant.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetTokenCache,
  archiveRegisteredAsset,
  beginDriveConsent,
  completeDriveConsent,
  driveUploadBuffer,
} from "./services/creativeVault";
import { mediaAssets, integrationTokens } from "../drizzle/schema";
import type { DB } from "./db";

const realFetch = globalThis.fetch;
const envKeys = ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "SITE_URL"] as const;
const envBackup: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of envKeys) envBackup[k] = process.env[k];
  process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
  process.env.SITE_URL = "https://nickstire.org";
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of envKeys) {
    if (envBackup[k] === undefined) delete process.env[k];
    else process.env[k] = envBackup[k];
  }
  _resetTokenCache();
  vi.restoreAllMocks();
});

/** In-memory db standing in for integration_tokens (+ optional mediaAssets row). */
function fakeDb(opts: { asset?: Record<string, unknown> } = {}) {
  const tokenRows = new Map<string, { name: string; configJson: string; status: string }>();
  const db = {
    select: (..._cols: unknown[]) => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: () => {
            if (table === integrationTokens) return Promise.resolve([...tokenRows.values()]);
            if (table === mediaAssets) return Promise.resolve(opts.asset ? [opts.asset] : []);
            return Promise.resolve([]);
          },
        }),
      }),
    }),
    insert: () => ({ values: (v: { name: string; configJson: string; status?: string }) => { tokenRows.set(v.name, { name: v.name, configJson: v.configJson, status: v.status ?? "healthy" }); return Promise.resolve(); } }),
    update: () => ({ set: (v: { configJson?: string; status?: string }) => ({ where: () => { const row = [...tokenRows.values()][0]; if (row) tokenRows.set(row.name, { ...row, ...(v.configJson ? { configJson: v.configJson } : {}), ...(v.status ? { status: v.status } : {}) }); return Promise.resolve(); } }) }),
    _tokenRows: tokenRows,
  };
  return db as unknown as DB & { _tokenRows: Map<string, { name: string; configJson: string; status: string }> };
}

const jsonRes = (body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) =>
  new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });

describe("driveUploadBuffer", () => {
  it("is idempotent per assetId — an existing file short-circuits with no upload", async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return jsonRes({ files: [{ id: "f_exist", name: "x", size: "10", webViewLink: "https://drive/x" }] });
    }) as typeof fetch;
    const res = await driveUploadBuffer("tok", { assetId: "ma_1", name: "a.mp4", mimeType: "video/mp4", buffer: Buffer.from("0123456789"), folderId: "d1" });
    expect(res).toMatchObject({ fileId: "f_exist", existed: true, verifiedByteSize: 10 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/files?q=");
  });

  it("small buffer -> multipart upload, then Drive's own metadata verifies the size", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method });
      if (u.includes("/files?q=")) return jsonRes({ files: [] });
      if (u.includes("uploadType=multipart")) return jsonRes({ id: "f_new" });
      if (u.includes("/files/f_new")) return jsonRes({ id: "f_new", name: "a.mp4", size: "5", webViewLink: "https://drive/new" });
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;
    const res = await driveUploadBuffer("tok", { assetId: "ma_2", name: "a.mp4", mimeType: "video/mp4", buffer: Buffer.from("hello"), folderId: "d1" });
    expect(res).toMatchObject({ fileId: "f_new", existed: false, verifiedByteSize: 5, viewUrl: "https://drive/new" });
    expect(calls.some((c) => c.url.includes("uploadType=multipart"))).toBe(true);
  });

  it("large buffer -> resumable init + PUT with declared content length", async () => {
    const big = Buffer.alloc(5 * 1024 * 1024, 7);
    let initHeaders: Record<string, string> = {};
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/files?q=")) return jsonRes({ files: [] });
      if (u.includes("uploadType=resumable")) {
        initHeaders = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
        return jsonRes({}, { headers: { location: "https://upload.session/xyz" } });
      }
      if (u === "https://upload.session/xyz") return jsonRes({ id: "f_big" });
      if (u.includes("/files/f_big")) return jsonRes({ id: "f_big", size: String(big.length) });
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;
    const res = await driveUploadBuffer("tok", { assetId: "ma_3", name: "b.mp4", mimeType: "video/mp4", buffer: big, folderId: "d1" });
    expect(res).toMatchObject({ fileId: "f_big", verifiedByteSize: big.length });
    expect(initHeaders["X-Upload-Content-Length"]).toBe(String(big.length));
  });

  it("refuses to report success when the verification GET finds no file", async () => {
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/files?q=")) return jsonRes({ files: [] });
      if (u.includes("uploadType=multipart")) return jsonRes({ id: "f_ghost" });
      if (u.includes("/files/f_ghost")) return new Response("", { status: 404 });
      throw new Error(`unexpected fetch ${u}`);
    }) as typeof fetch;
    await expect(
      driveUploadBuffer("tok", { assetId: "ma_4", name: "c.jpg", mimeType: "image/jpeg", buffer: Buffer.from("x"), folderId: "d1" }),
    ).rejects.toThrow(/refusing to report success/);
  });
});

describe("consent round-trip", () => {
  it("beginDriveConsent mints a drive.file-scoped URL and persists CSRF state", async () => {
    const db = fakeDb();
    const { authUrl } = await beginDriveConsent(db);
    expect(authUrl).toContain("accounts.google.com");
    expect(authUrl).toContain(encodeURIComponent("https://www.googleapis.com/auth/drive.file"));
    expect(authUrl).toContain("access_type=offline");
    const stored = JSON.parse(db._tokenRows.get("google_drive_vault")!.configJson);
    expect(authUrl).toContain(`state=${stored.pendingState}`);
  });

  it("completeDriveConsent rejects a state mismatch before any token exchange", async () => {
    const db = fakeDb();
    await beginDriveConsent(db);
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    await expect(completeDriveConsent(db, "code123", "wrong-state")).rejects.toThrow(/state mismatch/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("archiveRegisteredAsset", () => {
  it("refuses when the bytes do not hash to the registered checksum", async () => {
    const db = fakeDb({
      asset: {
        id: "ma_9", logicalKey: "reel:1:master", version: 1, mimeType: "video/mp4",
        checksumSha256: "a".repeat(64), byteSize: 4, runtimeUrl: "https://x/y.mp4",
      },
    });
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const res = await archiveRegisteredAsset(db, "ma_9", { folderId: "d1", bytes: Buffer.from("evil") });
    expect(res).toEqual({ ok: false, reason: "checksum_mismatch" });
    expect(fetchSpy).not.toHaveBeenCalled(); // refused before any Drive/network work
  });
});
