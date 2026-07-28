/**
 * Google Drive Creative Vault — the durable, operator-browsable archive layer
 * of the media architecture (registry row = canonical metadata; Drive = human
 * archive; storagePut = runtime delivery).
 *
 * Auth: reuses the OAuth client nickstire already has on prod
 * (GOOGLE_OAUTH_CLIENT_ID/SECRET — the admin-login client) with statenour's
 * proven refresh-token pattern (apps/statenour/lib/services/google-oauth.ts),
 * scope `drive.file` ONLY — the vault sees and touches nothing but files it
 * created. Refresh token lives in integration_tokens ("google_drive_vault").
 * One-time operator consent via /api/admin/drive-vault/start.
 *
 * Reliability contract:
 * - every upload is IDEMPOTENT per assetId (appProperties search first)
 * - an upload counts only after a verification GET confirms byte size — the
 *   registry's markDriveSynced re-verifies again before "synced"
 * - folder IDs are persisted (token config folderMap) — display names are
 *   never re-discovered per request
 * - resumable uploads above the multipart threshold; timeouts everywhere
 * - NEVER log tokens or config JSON
 */
import { createHash } from "crypto";
import { eq } from "drizzle-orm";
import { integrationTokens, mediaAssets } from "../../drizzle/schema";
import type { DB } from "../db";
import { createLogger } from "../lib/logger";
import { markDriveSynced } from "./mediaRegistry";

const log = createLogger("services:creative-vault");

export const DRIVE_TOKEN_ROW = "google_drive_vault";
export const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"];
export const VAULT_ROOT_NAME = "Nick's Creative OS";
/** multipart is capped ~5MB by the API; stay comfortably under */
const MULTIPART_MAX_BYTES = 4 * 1024 * 1024;

interface VaultTokenConfig {
  refreshToken: string;
  scopes: string[];
  email?: string;
  grantedAt: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
  /** persisted stable folder IDs: "root", "campaigns", "campaign:<id>", ... */
  folderMap?: Record<string, string>;
  /** CSRF state for the in-flight consent round-trip */
  pendingState?: string;
}

function getClientCreds(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clean = (v: string | undefined) => (v || "").trim();
  const clientId = clean(process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.AUTH_GOOGLE_CLIENT_ID);
  const clientSecret = clean(process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.AUTH_GOOGLE_CLIENT_SECRET);
  const origin = clean(process.env.SITE_URL) || "https://nickstire.org";
  if (!clientId || !clientSecret) {
    throw new Error("Drive vault: GOOGLE_OAUTH_CLIENT_ID/SECRET missing from env");
  }
  return { clientId, clientSecret, redirectUri: origin.replace(/\/$/, "") + "/api/oauth/drive/callback" };
}

// ───────────────────────── token plumbing (db-backed) ─────────────────────────

async function readTokenRow(database: DB): Promise<VaultTokenConfig | null> {
  const rows = await database.select().from(integrationTokens).where(eq(integrationTokens.name, DRIVE_TOKEN_ROW)).limit(1);
  if (!rows.length) return null;
  try { return JSON.parse(rows[0].configJson) as VaultTokenConfig; } catch { return null; }
}

async function writeTokenRow(database: DB, config: VaultTokenConfig, status = "healthy"): Promise<void> {
  const existing = await database.select({ name: integrationTokens.name }).from(integrationTokens).where(eq(integrationTokens.name, DRIVE_TOKEN_ROW)).limit(1);
  if (existing.length) {
    await database.update(integrationTokens).set({ configJson: JSON.stringify(config), status }).where(eq(integrationTokens.name, DRIVE_TOKEN_ROW));
  } else {
    await database.insert(integrationTokens).values({ name: DRIVE_TOKEN_ROW, configJson: JSON.stringify(config), status });
  }
}

export async function vaultConfigured(database: DB): Promise<boolean> {
  const cfg = await readTokenRow(database).catch(() => null);
  return !!cfg?.refreshToken;
}

/** Consent URL for the one-time operator grant. Mints + persists CSRF state. */
export async function beginDriveConsent(database: DB): Promise<{ authUrl: string }> {
  const { clientId, redirectUri } = getClientCreds();
  const state = createHash("sha256").update(`${Date.now()}-${Math.random()}`).digest("hex").slice(0, 32);
  const existing = (await readTokenRow(database)) ?? { refreshToken: "", scopes: [], grantedAt: "" };
  await writeTokenRow(database, { ...existing, pendingState: state }, existing.refreshToken ? "healthy" : "pending");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: DRIVE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return { authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
}

/** Callback half of the consent round-trip: verify state, exchange, store. */
export async function completeDriveConsent(database: DB, code: string, state: string): Promise<{ email?: string }> {
  const cfg = await readTokenRow(database);
  if (!cfg?.pendingState || cfg.pendingState !== state) {
    throw new Error("Drive vault: OAuth state mismatch — restart the consent flow");
  }
  const { clientId, clientSecret, redirectUri } = getClientCreds();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  if (!res.ok) throw new Error(`Drive vault: token exchange failed ${res.status}`);
  const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope?: string; id_token?: string };
  if (!data.refresh_token) {
    throw new Error("Drive vault: Google returned no refresh_token — revoke the prior grant at myaccount.google.com/permissions and retry");
  }
  let email: string | undefined;
  if (data.id_token) {
    try { email = JSON.parse(Buffer.from(data.id_token.split(".")[1], "base64").toString("utf-8")).email; } catch { /* optional */ }
  }
  await writeTokenRow(database, {
    refreshToken: data.refresh_token,
    scopes: (data.scope || "").split(" ").filter(Boolean),
    email,
    grantedAt: new Date().toISOString(),
    accessToken: data.access_token,
    accessTokenExpiresAt: Date.now() + data.expires_in * 1000,
    folderMap: cfg.folderMap,
  });
  log.info("drive vault consent stored", { maskedEmail: email ? email.replace(/^(.).*(@.*)$/, "$1***$2") : "(unknown)" });
  return { email };
}

let tokenCache: { token: string; expiresAt: number } | null = null;

/** Fresh access token via the stored refresh token (55min in-process cache). */
export async function getDriveAccessToken(database: DB): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.token;
  const cfg = await readTokenRow(database);
  if (!cfg?.refreshToken) {
    throw new Error("Drive vault not configured — operator must complete /api/admin/drive-vault/start consent");
  }
  if (cfg.accessToken && cfg.accessTokenExpiresAt && cfg.accessTokenExpiresAt > Date.now() + 60_000) {
    tokenCache = { token: cfg.accessToken, expiresAt: cfg.accessTokenExpiresAt };
    return cfg.accessToken;
  }
  const { clientId, clientSecret } = getClientCreds();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: cfg.refreshToken, grant_type: "refresh_token" }),
  });
  if (!res.ok) {
    await writeTokenRow(database, cfg, "failed").catch(() => {});
    throw new Error(`Drive vault: token refresh failed ${res.status} — re-grant may be needed`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  const expiresAt = Date.now() + data.expires_in * 1000;
  tokenCache = { token: data.access_token, expiresAt };
  await writeTokenRow(database, { ...cfg, accessToken: data.access_token, accessTokenExpiresAt: expiresAt }, "healthy").catch(() => {});
  return data.access_token;
}

/** test seam */
export function _resetTokenCache(): void { tokenCache = null; }

// ───────────────── Drive REST layer (token-parameterized, testable) ─────────────────

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";

async function driveFetch(token: string, url: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export interface DriveFileMeta { id: string; name: string; size?: string; mimeType?: string; webViewLink?: string; appProperties?: Record<string, string> }

export async function driveFindByAssetId(token: string, assetId: string): Promise<DriveFileMeta | null> {
  const q = encodeURIComponent(`appProperties has { key='assetId' and value='${assetId.replace(/'/g, "")}' } and trashed=false`);
  const res = await driveFetch(token, `${DRIVE_API}/files?q=${q}&fields=files(id,name,size,mimeType,webViewLink,appProperties)`);
  if (!res.ok) throw new Error(`Drive search failed ${res.status}`);
  const data = (await res.json()) as { files?: DriveFileMeta[] };
  return data.files?.[0] ?? null;
}

export async function driveGetFile(token: string, fileId: string): Promise<DriveFileMeta | null> {
  const res = await driveFetch(token, `${DRIVE_API}/files/${fileId}?fields=id,name,size,mimeType,webViewLink,appProperties`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Drive get failed ${res.status}`);
  return (await res.json()) as DriveFileMeta;
}

export async function driveEnsureFolder(token: string, name: string, parentId?: string): Promise<string> {
  const parentClause = parentId ? ` and '${parentId}' in parents` : "";
  const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentClause}`);
  const found = await driveFetch(token, `${DRIVE_API}/files?q=${q}&fields=files(id)`);
  if (!found.ok) throw new Error(`Drive folder search failed ${found.status}`);
  const data = (await found.json()) as { files?: Array<{ id: string }> };
  if (data.files?.length) return data.files[0].id;
  const created = await driveFetch(token, `${DRIVE_API}/files?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", ...(parentId ? { parents: [parentId] } : {}) }),
  });
  if (!created.ok) throw new Error(`Drive folder create failed ${created.status}`);
  return ((await created.json()) as { id: string }).id;
}

export interface DriveUploadResult { fileId: string; verifiedByteSize: number; viewUrl?: string; existed: boolean }

/**
 * Idempotent, verified upload. Search by appProperties.assetId first; on a
 * hit, verify and return it (repeat requests never duplicate). New uploads go
 * multipart (small) or resumable (large), then are verified with a metadata
 * GET — the returned byte size is Drive's own answer, not our assumption.
 */
export async function driveUploadBuffer(
  token: string,
  input: { assetId: string; name: string; mimeType: string; buffer: Buffer; folderId: string; appProperties?: Record<string, string> },
): Promise<DriveUploadResult> {
  const existing = await driveFindByAssetId(token, input.assetId);
  if (existing) {
    return { fileId: existing.id, verifiedByteSize: Number(existing.size ?? -1), viewUrl: existing.webViewLink, existed: true };
  }
  const metadata = {
    name: input.name,
    parents: [input.folderId],
    appProperties: { assetId: input.assetId, ...(input.appProperties ?? {}) },
  };
  let fileId: string;
  if (input.buffer.length <= MULTIPART_MAX_BYTES) {
    const boundary = `vault${Date.now().toString(36)}`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${input.mimeType}\r\n\r\n`),
      input.buffer,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const res = await driveFetch(token, `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    }, 60_000);
    if (!res.ok) throw new Error(`Drive multipart upload failed ${res.status}`);
    fileId = ((await res.json()) as { id: string }).id;
  } else {
    const init = await driveFetch(token, `${DRIVE_UPLOAD}/files?uploadType=resumable&fields=id`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": input.mimeType,
        "X-Upload-Content-Length": String(input.buffer.length),
      },
      body: JSON.stringify(metadata),
    });
    if (!init.ok) throw new Error(`Drive resumable init failed ${init.status}`);
    const location = init.headers.get("location");
    if (!location) throw new Error("Drive resumable init returned no session URI");
    const put = await fetch(location, {
      method: "PUT",
      headers: { "Content-Type": input.mimeType, "Content-Length": String(input.buffer.length) },
      body: new Uint8Array(input.buffer),
      signal: AbortSignal.timeout(180_000),
    });
    if (!put.ok) throw new Error(`Drive resumable PUT failed ${put.status}`);
    fileId = ((await put.json()) as { id: string }).id;
  }
  const verified = await driveGetFile(token, fileId);
  if (!verified) throw new Error("Drive upload verification GET found no file — refusing to report success");
  return { fileId, verifiedByteSize: Number(verified.size ?? -1), viewUrl: verified.webViewLink, existed: false };
}

// ───────────────────────── vault operations (db glue) ─────────────────────────

async function getFolderId(database: DB, key: string, create: () => Promise<string>): Promise<string> {
  const cfg = await readTokenRow(database);
  if (cfg?.folderMap?.[key]) return cfg.folderMap[key];
  const id = await create();
  if (cfg) await writeTokenRow(database, { ...cfg, folderMap: { ...(cfg.folderMap ?? {}), [key]: id } }).catch(() => {});
  return id;
}

/** Root workspace + top-level structure. Stable IDs persisted after first call. */
export async function ensureRootWorkspace(database: DB): Promise<{ rootId: string; campaignsId: string; reusableId: string }> {
  const token = await getDriveAccessToken(database);
  const rootId = await getFolderId(database, "root", () => driveEnsureFolder(token, VAULT_ROOT_NAME));
  const campaignsId = await getFolderId(database, "campaigns", () => driveEnsureFolder(token, "01 Campaigns", rootId));
  const reusableId = await getFolderId(database, "reusable", () => driveEnsureFolder(token, "02 Approved Reusable Media", rootId));
  return { rootId, campaignsId, reusableId };
}

export async function ensureCampaignWorkspace(database: DB, input: { campaignId: string; name: string; dateISO?: string }): Promise<{ folderId: string }> {
  const key = `campaign:${input.campaignId}`;
  const token = await getDriveAccessToken(database);
  const { campaignsId } = await ensureRootWorkspace(database);
  const date = (input.dateISO ?? new Date().toISOString()).slice(0, 10);
  const folderName = `${date} — ${input.name} — ${input.campaignId}`.slice(0, 120);
  const folderId = await getFolderId(database, key, () => driveEnsureFolder(token, folderName, campaignsId));
  return { folderId };
}

/**
 * Archive a REGISTERED asset: fetch its bytes, re-verify the checksum against
 * the registry (the bytes we archive must be the bytes we registered), upload
 * idempotently, then let markDriveSynced apply the byte-verification gate.
 */
export async function archiveRegisteredAsset(
  database: DB,
  assetId: string,
  opts: { folderId: string; bytes?: Buffer },
): Promise<{ ok: boolean; fileId?: string; reason?: string }> {
  const [asset] = await database.select().from(mediaAssets).where(eq(mediaAssets.id, assetId)).limit(1);
  if (!asset) return { ok: false, reason: "asset_not_found" };
  let bytes = opts.bytes ?? null;
  if (!bytes) {
    const url = asset.runtimeUrl ?? asset.originalProviderUrl;
    if (!url) return { ok: false, reason: "no_source_url" };
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return { ok: false, reason: `source_fetch_${res.status}` };
    bytes = Buffer.from(await res.arrayBuffer());
  }
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== asset.checksumSha256) {
    log.error("archive refused — bytes do not match registered checksum", { assetId, expected: asset.checksumSha256.slice(0, 12), got: checksum.slice(0, 12) });
    return { ok: false, reason: "checksum_mismatch" };
  }
  const token = await getDriveAccessToken(database);
  const ext = asset.mimeType.split("/")[1]?.split(";")[0] ?? "bin";
  const upload = await driveUploadBuffer(token, {
    assetId,
    name: `${asset.logicalKey.replace(/[^a-zA-Z0-9._-]+/g, "_")}.v${asset.version}.${ext}`,
    mimeType: asset.mimeType,
    buffer: bytes,
    folderId: opts.folderId,
    appProperties: { checksum: asset.checksumSha256, logicalKey: asset.logicalKey, version: String(asset.version) },
  });
  const synced = await markDriveSynced(database, assetId, {
    fileId: upload.fileId,
    folderId: opts.folderId,
    viewUrl: upload.viewUrl,
    verifiedByteSize: upload.verifiedByteSize,
  });
  if (!synced.ok) return { ok: false, fileId: upload.fileId, reason: synced.reason };
  return { ok: true, fileId: upload.fileId };
}

/** Machine+human campaign manifest into the campaign folder. */
export async function uploadManifest(database: DB, input: { folderId: string; name: string; manifest: unknown }): Promise<{ fileId: string }> {
  const token = await getDriveAccessToken(database);
  const buffer = Buffer.from(JSON.stringify(input.manifest, null, 2));
  const up = await driveUploadBuffer(token, {
    assetId: `manifest:${input.folderId}:${input.name}`,
    name: input.name,
    mimeType: "application/json",
    buffer,
    folderId: input.folderId,
  });
  return { fileId: up.fileId };
}

export interface VaultReconciliation {
  checked: number;
  healthy: number;
  syncedButMissingOnDrive: string[];
  sizeMismatch: string[];
  pendingBacklog: number;
}

/**
 * Reconcile registry claims against Drive reality. A row claiming "synced"
 * whose file is gone or resized gets flipped to "missing"/"failed" — the
 * registry must never keep claiming an archive that does not exist.
 */
export async function reconcileVault(database: DB, opts: { limit?: number } = {}): Promise<VaultReconciliation> {
  const token = await getDriveAccessToken(database);
  const synced = await database.select().from(mediaAssets).where(eq(mediaAssets.gdriveSyncState, "synced")).limit(opts.limit ?? 200);
  const pending = await database.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.gdriveSyncState, "pending")).limit(500);
  const report: VaultReconciliation = { checked: synced.length, healthy: 0, syncedButMissingOnDrive: [], sizeMismatch: [], pendingBacklog: pending.length };
  for (const row of synced) {
    if (!row.gdriveFileId) { report.syncedButMissingOnDrive.push(row.id); continue; }
    const meta = await driveGetFile(token, row.gdriveFileId);
    if (!meta) {
      report.syncedButMissingOnDrive.push(row.id);
      await database.update(mediaAssets).set({ gdriveSyncState: "missing" }).where(eq(mediaAssets.id, row.id)).catch(() => {});
      continue;
    }
    if (Number(meta.size ?? -1) !== row.byteSize) {
      report.sizeMismatch.push(row.id);
      await database.update(mediaAssets).set({ gdriveSyncState: "failed" }).where(eq(mediaAssets.id, row.id)).catch(() => {});
      continue;
    }
    report.healthy += 1;
  }
  if (report.syncedButMissingOnDrive.length || report.sizeMismatch.length) {
    log.error("vault reconciliation found drift", { missing: report.syncedButMissingOnDrive.length, mismatched: report.sizeMismatch.length });
  }
  return report;
}
