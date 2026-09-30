#!/usr/bin/env node
/**
 * NOUR ChatGPT-plan bridge — dependency-free (Node >= 22 built-ins only).
 *
 * Independent implementation of the public "Sign in with ChatGPT" plan-usage
 * protocol: OAuth 2.0 Authorization Code + PKCE (S256) + state + nonce against
 * auth.openai.com, OIDC ID-token validation via JWKS, then Bearer calls to the
 * account's plan model catalog and the Responses API (store=false, stream=true).
 * No OpenAI SDK or DevKit code is used or vendored.
 *
 * Commands (one JSON request on stdin, one JSON object on stdout):
 *   node chatgpt-plan-bridge.mjs probe     {}                                -> lane health
 *   node chatgpt-plan-bridge.mjs status    (alias of probe)
 *   node chatgpt-plan-bridge.mjs signin    {"openBrowser":true,"timeoutSeconds":300}
 *   node chatgpt-plan-bridge.mjs models    {}
 *   node chatgpt-plan-bridge.mjs chat      {"input":"...","timeoutMs":150000}
 *   node chatgpt-plan-bridge.mjs --self-test
 *
 * Invariants:
 *   - Never reads OPENAI_API_KEY or any paid API key. The only bearer ever sent
 *     is the plan access token obtained through user-consented sign-in, and
 *     there is no fallback to metered API billing under any condition.
 *   - Credentials are persisted only DPAPI(CurrentUser)-encrypted (Windows).
 *     Other platforms fail closed with SECURE_STORE_UNAVAILABLE.
 *   - Tokens, ID-token claims and email are never written to stdout/stderr.
 *
 * Environment:
 *   NOUR_CHATGPT_PLAN_MODEL      optional model id; must be listed in the plan catalog
 *   NOUR_CHATGPT_PLAN_STATE_DIR  optional state directory override
 */

import { spawn } from "node:child_process";
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign as cryptoSign,
  timingSafeEqual,
  verify as cryptoVerify,
} from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const AUTHORIZE_URL = "https://auth.openai.com/api/accounts/authorize";
const TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token";
const DISCOVERY_URL = "https://auth.openai.com/.well-known/openid-configuration";
const JWKS_URL = "https://auth.openai.com/.well-known/jwks.json";
const ISSUER_HOST = "auth.openai.com";
const API_BASE = "https://api.openai.com/v1";
const RESOURCE = "https://api.openai.com/v1";
const INITIAL_CLIENT_ID = "dynamic_agent_client";
// Match OpenAI's reference client validation: issued IDs are opaque, bounded,
// URL-safe identifiers. Never assume today's "oaiapp_" prefix is permanent.
const ISSUED_CLIENT_ID_RE = /^(?!dynamic_agent_client$)[A-Za-z0-9_-]{1,200}$/;
const SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "resource.invoke",
  "chatgpt.tokens.use.direct",
];
const PLAN_SCOPE = "chatgpt.tokens.use.direct";
const AGENT_NAME_HINT = "NattyNour";
const DPAPI_ENTROPY = "nour-chatgpt-plan-bridge-v1";

const REFRESH_SKEW_MS = 120_000;
const PROBE_CACHE_TTL_MS = 120_000;
const CATALOG_REUSE_MS = 600_000;
const QUOTA_BACKOFF_MS = 15 * 60_000;
const MAX_STDIN_BYTES = 4 * 1024 * 1024;
const MAX_INPUT_CHARS = 400_000;
const MAX_STREAM_BYTES = 16 * 1024 * 1024;
const MAX_SSE_LINE_CHARS = 4 * 1024 * 1024;
const NON_CHAT_MODEL_RE =
  /(codex|embed|tts|whisper|transcri|audio|speech|image|dall-e|realtime|moderation|sora|computer-use)/i;
const SECRET_ENV_KEYS = [
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "CODEX_ACCESS_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "RUNNER_SHARED_SECRET",
];

class BridgeError extends Error {
  constructor(code, detail = "") {
    super(code);
    this.name = "BridgeError";
    this.code = code;
    this.detail = detail;
  }
}

function asBridgeError(err) {
  if (err instanceof BridgeError) return err;
  // Unknown errors are reduced to their class name so no request material,
  // header or token can leak through an exception message.
  return new BridgeError("INTERNAL_ERROR", String((err && err.name) || "Error").slice(0, 40));
}

function safeToken(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().slice(0, 64);
  return /^[A-Za-z0-9_.:-]+$/.test(trimmed) ? trimmed : "";
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a), "utf8");
  const right = Buffer.from(String(b), "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function clampInt(value, low, high, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(low, Math.min(high, Math.trunc(n)));
}

function isQuotaCode(code) {
  return /quota|usage_limit|limit_reached|credits|plan_limit/i.test(code || "");
}

// ---------------------------------------------------------------------------
// State directory, atomic persistence, locking
// ---------------------------------------------------------------------------

function defaultStateDir(env) {
  if (env.NOUR_CHATGPT_PLAN_STATE_DIR) return path.resolve(env.NOUR_CHATGPT_PLAN_STATE_DIR);
  if (process.platform === "win32") {
    const base = env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "StateNour", "chatgpt-plan");
  }
  return path.join(os.homedir(), ".local", "state", "nour", "chatgpt-plan");
}

const statePath = (ctx, name) => path.join(ctx.stateDir, name);

async function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  const fd = fs.openSync(tmp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, text, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      // Windows can transiently refuse a replace while another process reads.
      if (attempt >= 8 || !["EPERM", "EACCES", "EBUSY"].includes(err.code)) {
        try { fs.unlinkSync(tmp); } catch {}
        throw new BridgeError("STATE_WRITE_FAILED", String(err.code || "rename"));
      }
      await delay(40 * (attempt + 1));
    }
  }
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

async function withCredentialLock(ctx, fn, { timeoutMs = 30_000, staleMs = 90_000 } = {}) {
  fs.mkdirSync(ctx.stateDir, { recursive: true });
  const lock = statePath(ctx, "credentials.lock");
  const deadline = Date.now() + timeoutMs;
  let fd = null;
  while (fd === null) {
    try {
      fd = fs.openSync(lock, "wx");
      fs.writeSync(fd, String(process.pid));
    } catch (err) {
      if (err.code !== "EEXIST") throw new BridgeError("CREDENTIAL_LOCK_FAILED", String(err.code || ""));
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > staleMs) {
          fs.unlinkSync(lock);
          continue;
        }
      } catch {}
      if (Date.now() > deadline) throw new BridgeError("CREDENTIAL_LOCK_TIMEOUT");
      await delay(120 + Math.floor(Math.random() * 120));
    }
  }
  try {
    return await fn();
  } finally {
    try { fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(lock); } catch {}
  }
}

// ---------------------------------------------------------------------------
// Secure store (Windows DPAPI CurrentUser via a narrowly scoped PowerShell child)
// ---------------------------------------------------------------------------

function childEnvWithoutSecrets() {
  const env = { ...process.env };
  for (const key of SECRET_ENV_KEYS) delete env[key];
  return env;
}

function runDpapi(operation, input) {
  if (operation !== "Protect" && operation !== "Unprotect") {
    return Promise.reject(new BridgeError("INTERNAL_ERROR", "dpapi-op"));
  }
  // The script is fixed; secrets travel only over stdin/stdout as base64 and
  // never appear in argv, environment or logs.
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Security",
    `$entropy = [Text.Encoding]::UTF8.GetBytes('${DPAPI_ENTROPY}')`,
    "$data = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())",
    `$out = [Security.Cryptography.ProtectedData]::${operation}($data, $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)`,
    "[Console]::Out.Write([Convert]::ToBase64String($out))",
  ].join("; ");
  const exe = path.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(
        exe,
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
        { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: childEnvWithoutSecrets() },
      );
    } catch {
      reject(new BridgeError("SECURE_STORE_FAILED", "spawn"));
      return;
    }
    const out = [];
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      reject(new BridgeError("SECURE_STORE_FAILED", "timeout"));
    }, 20_000);
    child.stdout.on("data", chunk => out.push(chunk));
    child.stderr.on("data", () => {});
    child.on("error", () => {
      clearTimeout(timer);
      reject(new BridgeError("SECURE_STORE_FAILED", "spawn"));
    });
    child.on("close", code => {
      clearTimeout(timer);
      const text = Buffer.concat(out).toString("ascii").trim();
      if (code === 0 && /^[A-Za-z0-9+/=]+$/.test(text)) resolve(text);
      else reject(new BridgeError("SECURE_STORE_FAILED", `exit=${code}`));
    });
    child.stdin.end(Buffer.from(input).toString("base64"));
  });
}

function dpapiCodec() {
  if (process.platform !== "win32") return null;
  return {
    name: "dpapi-currentuser",
    protect: buf => runDpapi("Protect", buf),
    unprotect: async sealed => Buffer.from(await runDpapi("Unprotect", Buffer.from(sealed, "base64")), "base64"),
  };
}

function requireCodec(ctx) {
  if (!ctx.codec) throw new BridgeError("SECURE_STORE_UNAVAILABLE", "DPAPI is required; refusing plaintext credentials");
  return ctx.codec;
}

async function saveCredentials(ctx, creds) {
  const codec = requireCodec(ctx);
  const plaintext = Buffer.from(JSON.stringify({ v: 1, ...creds }), "utf8");
  let sealed;
  try {
    sealed = await codec.protect(plaintext);
  } finally {
    plaintext.fill(0);
  }
  await atomicWrite(statePath(ctx, "credentials.dpapi"), JSON.stringify({ v: 1, codec: codec.name, data: sealed }));
}

async function loadCredentials(ctx) {
  let raw;
  try {
    raw = fs.readFileSync(statePath(ctx, "credentials.dpapi"), "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw new BridgeError("CREDENTIAL_STORE_UNREADABLE");
  }
  const codec = requireCodec(ctx);
  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    throw new BridgeError("CREDENTIAL_STORE_CORRUPT");
  }
  if (!envelope || envelope.codec !== codec.name || typeof envelope.data !== "string") {
    throw new BridgeError("CREDENTIAL_STORE_CORRUPT");
  }
  const buf = await codec.unprotect(envelope.data);
  let creds;
  try {
    creds = JSON.parse(buf.toString("utf8"));
  } catch {
    throw new BridgeError("CREDENTIAL_STORE_CORRUPT");
  } finally {
    buf.fill(0);
  }
  if (
    !creds ||
    typeof creds.accessToken !== "string" ||
    typeof creds.clientId !== "string" ||
    !Number.isFinite(creds.expiresAt) ||
    !Array.isArray(creds.scopes)
  ) {
    throw new BridgeError("CREDENTIAL_STORE_CORRUPT");
  }
  return creds;
}

function loadHost(ctx) {
  const host = readJsonFile(statePath(ctx, "host.json"));
  if (!host || typeof host.extAgentHostId !== "string") return null;
  // OpenAI requires URI-form host identifiers. Migrate the early local draft's
  // bare UUID in memory so the same host identity is preserved rather than
  // silently creating a new host registration.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(host.extAgentHostId)) {
    host.extAgentHostId = `urn:uuid:${host.extAgentHostId.toLowerCase()}`;
  }
  if (!/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(host.extAgentHostId)) {
    return null;
  }
  if (host.clientId && !ISSUED_CLIENT_ID_RE.test(host.clientId)) host.clientId = null;
  return host;
}

async function ensureHost(ctx) {
  const existing = loadHost(ctx);
  if (existing) return existing;
  const host = { v: 1, extAgentHostId: `urn:uuid:${randomUUID()}`, clientId: null, createdAt: new Date(ctx.now()).toISOString() };
  await atomicWrite(statePath(ctx, "host.json"), JSON.stringify(host, null, 2));
  return host;
}

function readQuotaMarker(ctx) {
  const marker = readJsonFile(statePath(ctx, "quota.json"));
  const until = Number(marker && marker.exhaustedUntil);
  return Number.isFinite(until) && until > ctx.now() ? { exhausted: true, until } : { exhausted: false, until: 0 };
}

async function markQuotaExhausted(ctx) {
  try {
    await atomicWrite(statePath(ctx, "quota.json"), JSON.stringify({ v: 1, exhaustedUntil: ctx.now() + QUOTA_BACKOFF_MS }));
    fs.rmSync(statePath(ctx, "probe-cache.json"), { force: true });
  } catch {}
}

function clearQuotaMarker(ctx) {
  try { fs.rmSync(statePath(ctx, "quota.json"), { force: true }); } catch {}
}

// ---------------------------------------------------------------------------
// HTTP helpers and upstream error mapping (safe codes only)
// ---------------------------------------------------------------------------

function networkError(err) {
  const name = err && err.name;
  if (name === "TimeoutError" || name === "AbortError") return new BridgeError("TIMEOUT");
  return new BridgeError("NETWORK_ERROR");
}

async function readJsonSafe(res) {
  try {
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

async function httpJson(ctx, url, init, timeoutMs) {
  let res;
  try {
    res = await ctx.fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw networkError(err);
  }
  return { status: res.status, ok: res.ok, body: await readJsonSafe(res) };
}

function upstreamError(status, body, context) {
  const err = body && typeof body === "object" ? body.error : null;
  const code =
    (err && typeof err === "object" && (safeToken(err.code) || safeToken(err.type))) ||
    safeToken(typeof err === "string" ? err : "");
  const detail = `upstream=${status}${code ? ` code=${code}` : ""}`;
  if (status === 401) return new BridgeError("AUTH_REJECTED", detail);
  if (status === 403) return new BridgeError("PLAN_ACCESS_FORBIDDEN", detail);
  if (status === 429) return new BridgeError(isQuotaCode(code) ? "QUOTA_EXHAUSTED" : "RATE_LIMITED", detail);
  if (status >= 500) return new BridgeError("UPSTREAM_UNAVAILABLE", detail);
  if (context === "responses" && (status === 404 || /model/i.test(code))) {
    return new BridgeError("MODEL_NOT_AVAILABLE", detail);
  }
  return new BridgeError("REQUEST_REJECTED", detail);
}

// ---------------------------------------------------------------------------
// OAuth: PKCE, authorize URL, token endpoint, scopes, ID-token validation
// ---------------------------------------------------------------------------

function pkceChallenge(verifier) {
  return b64url(createHash("sha256").update(verifier, "ascii").digest());
}

function createPkce() {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: pkceChallenge(verifier) };
}

function buildAuthorizeUrl({ clientId, redirectUri, codeChallenge, state, nonce, hostId }) {
  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}\/auth\/callback$/.test(redirectUri)) {
    throw new BridgeError("REDIRECT_URI_INVALID");
  }
  const url = new URL(AUTHORIZE_URL);
  const p = url.searchParams;
  p.set("response_type", "code");
  p.set("client_id", clientId);
  p.set("redirect_uri", redirectUri);
  p.set("scope", SCOPES.join(" "));
  p.set("code_challenge", codeChallenge);
  p.set("code_challenge_method", "S256");
  p.set("state", state);
  p.set("nonce", nonce);
  p.set("resource", RESOURCE);
  p.set("ext_agent_host_id", hostId);
  // The name hint is only meaningful for the initial dynamic registration.
  if (clientId === INITIAL_CLIENT_ID) p.set("agent_name_hint", AGENT_NAME_HINT);
  return url.toString();
}

async function tokenRequest(ctx, params) {
  const { status, ok, body } = await httpJson(
    ctx,
    TOKEN_URL,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(params).toString(),
    },
    30_000,
  );
  if (!ok) {
    const code = safeToken(body && body.error);
    if (code === "invalid_grant") throw new BridgeError("REAUTH_REQUIRED", "token endpoint rejected grant");
    if (code === "invalid_client" || code === "unauthorized_client") throw new BridgeError("CLIENT_REJECTED", `code=${code}`);
    if (code === "invalid_scope") throw new BridgeError("SCOPE_NOT_GRANTED", "token endpoint rejected scope");
    throw new BridgeError("TOKEN_ENDPOINT_ERROR", `upstream=${status}${code ? ` code=${code}` : ""}`);
  }
  if (!body || typeof body.access_token !== "string" || !body.access_token) {
    throw new BridgeError("TOKEN_RESPONSE_INVALID");
  }
  if (typeof body.token_type !== "string" || body.token_type.toLowerCase() !== "bearer") {
    throw new BridgeError("TOKEN_RESPONSE_INVALID", "token_type");
  }
  if (typeof body.expires_in !== "number" || !Number.isFinite(body.expires_in) || body.expires_in <= 0) {
    throw new BridgeError("TOKEN_RESPONSE_INVALID", "expires_in");
  }
  return body;
}

function decodeJwtPart(part) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

function grantedScopes(tokenResponse, previousScopes) {
  if (typeof tokenResponse.scope === "string" && tokenResponse.scope.trim()) {
    return { scopes: tokenResponse.scope.trim().split(/\s+/), source: "token_response" };
  }
  // Match OpenAI's reference contract: initial authorization must explicitly
  // confirm granted scopes in the token response. Refresh may omit scope when
  // the previous grant is unchanged, so only that path may reuse saved scopes.
  if (Array.isArray(previousScopes)) return { scopes: previousScopes, source: "previous_grant" };
  return { scopes: [], source: "missing" };
}

// OpenAI's SIWC reference runtime currently accepts RS256 ID tokens. Keep the
// verifier on the same narrow algorithm allow-list instead of broadening trust.
const JWS_ALGS = {
  RS256: { kty: "RSA", hash: "sha256", key: k => k },
};

function verifyIdToken(idToken, { jwks, issuer, clientId, nonce, nowMs, skewSec = 5 }) {
  if (typeof idToken !== "string") throw new BridgeError("ID_TOKEN_INVALID");
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new BridgeError("ID_TOKEN_INVALID");
  let header;
  let claims;
  try {
    header = decodeJwtPart(parts[0]);
    claims = decodeJwtPart(parts[1]);
  } catch {
    throw new BridgeError("ID_TOKEN_INVALID");
  }
  const spec = JWS_ALGS[header && header.alg];
  if (!spec) throw new BridgeError("ID_TOKEN_ALG_REJECTED");
  const keys = (Array.isArray(jwks && jwks.keys) ? jwks.keys : []).filter(
    k =>
      k &&
      k.kty === spec.kty &&
      (!header.kid || k.kid === header.kid) &&
      (!k.use || k.use === "sig") &&
      (!k.alg || k.alg === header.alg),
  );
  if (!keys.length) throw new BridgeError("ID_TOKEN_KEY_NOT_FOUND");
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`, "ascii");
  const signature = Buffer.from(parts[2], "base64url");
  const verified = keys.some(jwk => {
    try {
      return cryptoVerify(spec.hash, signed, spec.key(createPublicKey({ key: jwk, format: "jwk" })), signature);
    } catch {
      return false;
    }
  });
  if (!verified) throw new BridgeError("ID_TOKEN_SIGNATURE_INVALID");
  const now = Math.floor(nowMs / 1000);
  if (claims.iss !== issuer) throw new BridgeError("ID_TOKEN_ISSUER_MISMATCH");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) throw new BridgeError("ID_TOKEN_AUDIENCE_MISMATCH");
  if (
    (claims.azp !== undefined && claims.azp !== clientId) ||
    (aud.length > 1 && claims.azp !== clientId)
  ) {
    throw new BridgeError("ID_TOKEN_AUDIENCE_MISMATCH", "azp");
  }
  if (typeof claims.exp !== "number" || claims.exp + skewSec < now) throw new BridgeError("ID_TOKEN_EXPIRED");
  if (typeof claims.iat !== "number") throw new BridgeError("ID_TOKEN_IAT_MISSING");
  if (typeof claims.nbf === "number" && claims.nbf - skewSec > now) throw new BridgeError("ID_TOKEN_NOT_YET_VALID");
  if (claims.iat - skewSec > now) throw new BridgeError("ID_TOKEN_NOT_YET_VALID");
  if (typeof claims.nonce !== "string" || !constantTimeEqual(claims.nonce, nonce)) {
    throw new BridgeError("ID_TOKEN_NONCE_MISMATCH");
  }
  if (typeof claims.sub !== "string" || !claims.sub) throw new BridgeError("ID_TOKEN_SUBJECT_MISSING");
  return { sub: claims.sub };
}

async function fetchDiscovery(ctx) {
  const { ok, body } = await httpJson(ctx, DISCOVERY_URL, { headers: { accept: "application/json" } }, 15_000);
  if (!ok || !body || typeof body.issuer !== "string") throw new BridgeError("DISCOVERY_UNAVAILABLE");
  let issuerUrl;
  try {
    issuerUrl = new URL(body.issuer);
  } catch {
    throw new BridgeError("DISCOVERY_MISMATCH", "issuer");
  }
  if (issuerUrl.protocol !== "https:" || issuerUrl.hostname !== ISSUER_HOST) {
    throw new BridgeError("DISCOVERY_MISMATCH", "issuer");
  }
  // The signing keys are pinned: a discovery document pointing elsewhere is
  // treated as tampering rather than followed.
  if (body.jwks_uri && body.jwks_uri !== JWKS_URL) throw new BridgeError("DISCOVERY_MISMATCH", "jwks_uri");
  return { issuer: body.issuer };
}

// ---------------------------------------------------------------------------
// Credentials: load, rotate-refresh under lock, authed API calls
// ---------------------------------------------------------------------------

function hasPlanScope(creds) {
  return Array.isArray(creds.scopes) && creds.scopes.includes(PLAN_SCOPE);
}

async function getValidCredentials(ctx, { forceRefresh = false, rejectedAccessToken = null } = {}) {
  const creds = await loadCredentials(ctx);
  if (!creds) throw new BridgeError("NOT_SIGNED_IN");
  if (!hasPlanScope(creds)) throw new BridgeError("SCOPE_NOT_GRANTED", `${PLAN_SCOPE} not granted`);
  if (!forceRefresh && creds.expiresAt - ctx.now() > REFRESH_SKEW_MS) return creds;

  // Refresh tokens rotate: two processes refreshing with the same token can
  // invalidate the grant family, so refresh is serialized and re-checked.
  return await withCredentialLock(ctx, async () => {
    const current = await loadCredentials(ctx);
    if (!current) throw new BridgeError("NOT_SIGNED_IN");
    if (!forceRefresh && current.expiresAt - ctx.now() > REFRESH_SKEW_MS) return current;
    if (forceRefresh && rejectedAccessToken && current.accessToken !== rejectedAccessToken) return current;
    if (typeof current.refreshToken !== "string" || !current.refreshToken) {
      throw new BridgeError("REAUTH_REQUIRED", "no refresh credential");
    }
    const tok = await tokenRequest(ctx, {
      grant_type: "refresh_token",
      refresh_token: current.refreshToken,
      client_id: current.clientId,
      resource: RESOURCE,
    });
    const { scopes, source } = grantedScopes(tok, current.scopes);
    const next = {
      ...current,
      accessToken: tok.access_token,
      refreshToken: typeof tok.refresh_token === "string" && tok.refresh_token ? tok.refresh_token : current.refreshToken,
      expiresAt: ctx.now() + tok.expires_in * 1000,
      scopes,
      scopeSource: source,
      refreshedAt: new Date(ctx.now()).toISOString(),
    };
    await saveCredentials(ctx, next);
    if (!hasPlanScope(next)) throw new BridgeError("SCOPE_NOT_GRANTED", `${PLAN_SCOPE} not granted`);
    return next;
  });
}

async function authedFetch(ctx, pathname, init, signal) {
  let creds = await getValidCredentials(ctx);
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await ctx.fetch(API_BASE + pathname, {
        ...init,
        headers: { ...(init.headers || {}), authorization: `Bearer ${creds.accessToken}` },
        redirect: "error",
        signal,
      });
    } catch (err) {
      throw networkError(err);
    }
    if (res.status === 401 && attempt === 0) {
      try { await res.body?.cancel(); } catch {}
      creds = await getValidCredentials(ctx, { forceRefresh: true, rejectedAccessToken: creds.accessToken });
      continue;
    }
    return res;
  }
  throw new BridgeError("AUTH_REJECTED");
}

// ---------------------------------------------------------------------------
// Plan model catalog and dynamic selection
// ---------------------------------------------------------------------------

async function fetchPlanCatalog(ctx, signal) {
  const res = await authedFetch(ctx, "/models", { method: "GET", headers: { accept: "application/json" } }, signal);
  const body = await readJsonSafe(res);
  if (!res.ok) throw upstreamError(res.status, body, "models");
  const records = body && Array.isArray(body.models)
    ? body.models
    : body && Array.isArray(body.data)
      ? body.data
      : null;
  if (!records) throw new BridgeError("MODEL_CATALOG_INVALID");
  const listed = records
    .filter(m => {
      const id = typeof m?.slug === "string" ? m.slug : m?.id;
      return m && typeof id === "string" && id && m.visibility === "list";
    })
    .map(m => {
      const id = typeof m.slug === "string" ? m.slug : m.id;
      return {
        id: id.slice(0, 200),
        displayName: String(m.display_name || m.name || id).slice(0, 200),
      };
    });
  if (!listed.length) throw new BridgeError("NO_PLAN_MODELS");
  return listed;
}

function selectPlanModel(catalog, preferred) {
  const wanted = typeof preferred === "string" ? preferred.trim() : "";
  if (wanted) {
    if (catalog.some(m => m.id === wanted)) return wanted;
    // An explicit choice that the account does not list is never silently
    // swapped for another model.
    throw new BridgeError("MODEL_NOT_IN_PLAN_CATALOG", "configured model is not listed for this account");
  }
  const chat = catalog.filter(m => !NON_CHAT_MODEL_RE.test(m.id));
  if (!chat.length) throw new BridgeError("NO_PLAN_MODELS", "no chat-capable listed models");
  // Preserve OpenAI's account-specific catalog order, but prefer a full model
  // over mini/nano when both are visible for this profile.
  return (chat.find(m => !/(^|[-_.])(mini|nano|lite|small)([-_.]|$)/i.test(m.id)) || chat[0]).id;
}

function credentialStamp(ctx) {
  try {
    return fs.statSync(statePath(ctx, "credentials.dpapi")).mtimeMs;
  } catch {
    return null;
  }
}

function readProbeCache(ctx, maxAgeMs) {
  const cache = readJsonFile(statePath(ctx, "probe-cache.json"));
  if (!cache || cache.v !== 1) return null;
  if (ctx.now() - Number(cache.at) > maxAgeMs) return null;
  if (cache.credentialStamp !== credentialStamp(ctx)) return null;
  if (cache.preferredModel !== (ctx.env.NOUR_CHATGPT_PLAN_MODEL || "")) return null;
  return cache;
}

async function writeProbeCache(ctx, result, catalog) {
  try {
    await atomicWrite(
      statePath(ctx, "probe-cache.json"),
      JSON.stringify({
        v: 1,
        at: ctx.now(),
        credentialStamp: credentialStamp(ctx),
        preferredModel: ctx.env.NOUR_CHATGPT_PLAN_MODEL || "",
        result,
        catalog,
      }),
    );
  } catch {}
}

async function planCatalog(ctx, signal) {
  const cached = readProbeCache(ctx, CATALOG_REUSE_MS);
  if (cached && Array.isArray(cached.catalog) && cached.catalog.length) return cached.catalog;
  return await fetchPlanCatalog(ctx, signal);
}

// ---------------------------------------------------------------------------
// Responses API streaming parser
// ---------------------------------------------------------------------------

function createSseParser(onEvent) {
  let buffer = "";
  let eventName = "";
  let data = [];
  const dispatch = () => {
    if (data.length) onEvent(eventName || "message", data.join("\n"));
    eventName = "";
    data = [];
  };
  const line = raw => {
    if (raw === "") return dispatch();
    if (raw.startsWith(":")) return;
    const colon = raw.indexOf(":");
    const field = colon === -1 ? raw : raw.slice(0, colon);
    let value = colon === -1 ? "" : raw.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") eventName = value;
    else if (field === "data") data.push(value);
  };
  return {
    push(text) {
      buffer += text;
      for (;;) {
        const lf = buffer.indexOf("\n");
        const cr = buffer.indexOf("\r");
        if (cr !== -1 && (lf === -1 || cr < lf)) {
          if (cr === buffer.length - 1) break; // CRLF may be split across chunks
          line(buffer.slice(0, cr));
          buffer = buffer.slice(cr + (buffer[cr + 1] === "\n" ? 2 : 1));
          continue;
        }
        if (lf === -1) break;
        line(buffer.slice(0, lf));
        buffer = buffer.slice(lf + 1);
      }
      if (buffer.length > MAX_SSE_LINE_CHARS) throw new BridgeError("STREAM_LINE_TOO_LARGE");
    },
    end() {
      if (buffer.endsWith("\r")) buffer = buffer.slice(0, -1);
      if (buffer) line(buffer);
      buffer = "";
      dispatch();
    },
  };
}

function collectSourceUrls(value, target, depth = 0) {
  if (depth > 8 || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) collectSourceUrls(item, target, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (key === "url" && typeof item === "string" && /^https?:\/\//i.test(item)) {
      target.add(item.slice(0, 4096));
    } else {
      collectSourceUrls(item, target, depth + 1);
    }
  }
}

function extractOutputText(response) {
  if (!response || typeof response !== "object") return "";
  if (typeof response.output_text === "string") return response.output_text;
  const chunks = [];
  for (const item of Array.isArray(response.output) ? response.output : []) {
    const pieces = [];
    for (const part of Array.isArray(item && item.content) ? item.content : []) {
      if (part && part.type === "output_text" && typeof part.text === "string") pieces.push(part.text);
    }
    if (pieces.length) chunks.push(pieces.join(""));
  }
  return chunks.join("\n\n");
}

function createResponsesCollector() {
  const parts = new Map();
  const sources = new Set();
  let refusal = "";
  let model = null;
  let status = null;
  let failure = "";
  let incompleteReason = "";
  let finalResponse = null;
  let malformed = 0;
  const part = ev => {
    const o = Number(ev.output_index) || 0;
    const c = Number(ev.content_index) || 0;
    const key = `${o}:${c}`;
    if (!parts.has(key)) parts.set(key, { o, c, text: "" });
    return parts.get(key);
  };
  return {
    handle(eventName, data) {
      if (data === "[DONE]") return;
      let ev;
      try {
        ev = JSON.parse(data);
      } catch {
        malformed++;
        return;
      }
      if (!ev || typeof ev !== "object") return;
      collectSourceUrls(ev, sources);
      const type = typeof ev.type === "string" ? ev.type : eventName;
      const response = ev.response && typeof ev.response === "object" ? ev.response : null;
      if (response && typeof response.model === "string") model = response.model.slice(0, 200);
      switch (type) {
        case "response.output_text.delta":
          if (typeof ev.delta === "string") part(ev).text += ev.delta;
          break;
        case "response.output_text.done":
          // The done event carries the authoritative full text for the part.
          if (typeof ev.text === "string") part(ev).text = ev.text;
          break;
        case "response.refusal.delta":
          if (typeof ev.delta === "string") refusal += ev.delta;
          break;
        case "response.refusal.done":
          if (typeof ev.refusal === "string") refusal = ev.refusal;
          break;
        case "response.completed":
          status = "completed";
          finalResponse = response;
          break;
        case "response.incomplete":
          status = "incomplete";
          finalResponse = response;
          incompleteReason = safeToken(response && response.incomplete_details && response.incomplete_details.reason) || "unknown";
          break;
        case "response.failed": {
          const e = response && response.error;
          status = "failed";
          failure = (e && (safeToken(e.code) || safeToken(e.type))) || "response_failed";
          break;
        }
        case "error": {
          const e = ev.error && typeof ev.error === "object" ? ev.error : ev;
          status = "failed";
          failure = safeToken(e.code) || safeToken(e.type) || "stream_error";
          break;
        }
        default:
          break;
      }
    },
    result() {
      const byItem = new Map();
      for (const p of [...parts.values()].sort((a, b) => a.o - b.o || a.c - b.c)) {
        byItem.set(p.o, (byItem.get(p.o) || "") + p.text);
      }
      let text = [...byItem.values()].filter(Boolean).join("\n\n");
      if (!text && finalResponse) text = extractOutputText(finalResponse);
      if (status === "failed") {
        const code = isQuotaCode(failure) ? "QUOTA_EXHAUSTED" : /rate_limit/i.test(failure) ? "RATE_LIMITED" : "RESPONSE_FAILED";
        return { errorCode: code, detail: `code=${failure}` };
      }
      if (status === null) {
        // A stream that ends without a terminal event is not a trustworthy answer.
        return { errorCode: "STREAM_TRUNCATED", detail: `partialChars=${text.length} malformed=${malformed}` };
      }
      if (!text.trim()) {
        if (refusal.trim()) {
          return { text: refusal, model, refusal: true, incomplete: null, sources: [...sources] };
        }
        return {
          errorCode: status === "incomplete" ? "RESPONSE_INCOMPLETE" : "EMPTY_RESPONSE",
          detail: incompleteReason ? `reason=${incompleteReason}` : "",
        };
      }
      return {
        text,
        model,
        refusal: false,
        incomplete: status === "incomplete" ? incompleteReason : null,
        sources: [...sources],
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function authLabel(code) {
  if (code === "NOT_SIGNED_IN") return "not signed in";
  if (["REAUTH_REQUIRED", "AUTH_REJECTED", "CLIENT_REJECTED"].includes(code)) return "reauth required";
  if (["SCOPE_NOT_GRANTED", "PLAN_ACCESS_FORBIDDEN"].includes(code)) return "plan scope not granted";
  if (code === "SECURE_STORE_UNAVAILABLE" || code === "SECURE_STORE_FAILED") return "secure store unavailable";
  return "chatgpt-plan";
}

async function probe(ctx) {
  if (credentialStamp(ctx) === null) {
    return {
      status: "ok",
      health: "unavailable",
      quota: "unknown",
      auth: "not signed in",
      detail: "sign in with: node chatgpt-plan-bridge.mjs signin",
      model: null,
      models: [],
    };
  }
  let out;
  const cached = readProbeCache(ctx, PROBE_CACHE_TTL_MS);
  if (cached && cached.result) {
    out = cached.result;
  } else {
    try {
      const catalog = await fetchPlanCatalog(ctx, AbortSignal.timeout(20_000));
      const model = selectPlanModel(catalog, ctx.env.NOUR_CHATGPT_PLAN_MODEL);
      out = {
        health: "ready",
        quota: "unknown",
        auth: "chatgpt-plan",
        detail: `plan catalog lists ${catalog.length} models; paid API keys never used`,
        model,
        models: catalog.map(m => m.id).slice(0, 50),
      };
      await writeProbeCache(ctx, out, catalog);
    } catch (err) {
      const e = asBridgeError(err);
      out = {
        health: "unavailable",
        quota: e.code === "QUOTA_EXHAUSTED" ? "exhausted" : "unknown",
        auth: authLabel(e.code),
        detail: `${e.code}${e.detail ? `: ${e.detail}` : ""}`.slice(0, 160),
        model: null,
        models: [],
        errorCode: e.code,
      };
    }
  }
  const quota = readQuotaMarker(ctx);
  if (quota.exhausted && out.health === "ready") {
    out = {
      ...out,
      health: "degraded",
      quota: "exhausted",
      detail: `plan usage limit reported; backing off until ${new Date(quota.until).toISOString()}`,
    };
  }
  return { status: "ok", ...out };
}

async function modelsCommand(ctx) {
  const catalog = await fetchPlanCatalog(ctx, AbortSignal.timeout(20_000));
  let selected = null;
  let selectionError = null;
  try {
    selected = selectPlanModel(catalog, ctx.env.NOUR_CHATGPT_PLAN_MODEL);
  } catch (err) {
    selectionError = asBridgeError(err).code;
  }
  return { status: "ok", models: catalog.map(m => m.id), selected, selectionError };
}

function buildResponsesInput(req) {
  const instructions = typeof req.instructions === "string" ? req.instructions : "";
  if (typeof req.input === "string" && req.input.trim()) {
    if (req.input.length + instructions.length > MAX_INPUT_CHARS) throw new BridgeError("INPUT_TOO_LARGE");
    return {
      input: [{ role: "user", content: req.input }],
      instructions,
    };
  }
  if (Array.isArray(req.messages)) {
    const system = [];
    const items = [];
    for (const m of req.messages) {
      if (!m || typeof m.content !== "string" || !m.content) continue;
      if (m.role === "system" || m.role === "developer") system.push(m.content);
      else items.push({ role: m.role === "assistant" ? "assistant" : "user", content: m.content });
    }
    const joined = [instructions, ...system].filter(Boolean).join("\n\n");
    const size = items.reduce((n, i) => n + i.content.length, joined.length);
    if (!items.length) throw new BridgeError("INPUT_INVALID");
    if (size > MAX_INPUT_CHARS) throw new BridgeError("INPUT_TOO_LARGE");
    return { input: items, instructions: joined };
  }
  throw new BridgeError("INPUT_INVALID");
}

async function chat(ctx, req) {
  const { input, instructions } = buildResponsesInput(req);
  const signal = AbortSignal.timeout(clampInt(req.timeoutMs, 10_000, 600_000, 150_000));
  try {
    const catalog = await planCatalog(ctx, signal);
    const model = selectPlanModel(catalog, req.model || ctx.env.NOUR_CHATGPT_PLAN_MODEL);
    const body = { model, input, store: false, stream: true };
    if (instructions) body.instructions = instructions;
    if (req.webSearch === true) {
      body.tools = [{ type: "web_search" }];
      // Research calls require retrieval; do not allow the model to answer
      // from memory while merely having a search tool available.
      body.tool_choice = "required";
    }
    // ChatGPT plan sharing currently rejects max_output_tokens and other
    // ordinary metered-API tuning fields. Keep this route spec-minimal.

    const res = await authedFetch(
      ctx,
      "/responses",
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify(body),
      },
      signal,
    );
    if (!res.ok) {
      const err = upstreamError(res.status, await readJsonSafe(res), "responses");
      if (err.code === "MODEL_NOT_AVAILABLE") fs.rmSync(statePath(ctx, "probe-cache.json"), { force: true });
      throw err;
    }
    const collector = createResponsesCollector();
    if (!/text\/event-stream/i.test(res.headers.get("content-type") || "")) {
      // Tolerate a non-streamed JSON body by treating it as the final event.
      const json = await readJsonSafe(res);
      collector.handle("response.completed", JSON.stringify({ type: "response.completed", response: json }));
    } else {
      const parser = createSseParser((event, data) => collector.handle(event, data));
      const decoder = new TextDecoder("utf-8");
      let bytes = 0;
      try {
        for await (const chunk of res.body) {
          bytes += chunk.byteLength;
          if (bytes > MAX_STREAM_BYTES) throw new BridgeError("STREAM_TOO_LARGE");
          parser.push(decoder.decode(chunk, { stream: true }));
        }
      } catch (err) {
        if (err instanceof BridgeError) throw err;
        throw networkError(err);
      }
      parser.push(decoder.decode());
      parser.end();
    }
    const outcome = collector.result();
    if (outcome.errorCode) throw new BridgeError(outcome.errorCode, outcome.detail);
    clearQuotaMarker(ctx);
    return {
      status: "completed",
      text: outcome.text,
      model: outcome.model || model,
      incomplete: outcome.incomplete,
      refusal: outcome.refusal,
      sources: outcome.sources || [],
    };
  } catch (err) {
    const e = asBridgeError(err);
    if (e.code === "QUOTA_EXHAUSTED") await markQuotaExhausted(ctx);
    throw e;
  }
}

function startCallbackServer({ port, state, timeoutMs }) {
  return new Promise((resolveStart, rejectStart) => {
    let settle;
    const result = new Promise((res, rej) => {
      settle = { res, rej };
    });
    result.catch(() => {});
    let done = false;
    let timer = null;
    const server = http.createServer((req, res) => {
      let url;
      try {
        url = new URL(req.url, "http://127.0.0.1");
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }
      if (req.method !== "GET" || url.pathname !== "/auth/callback") {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("Not found");
        return;
      }
      if (done) {
        res.writeHead(409, { "content-type": "text/plain" });
        res.end("Sign-in already handled.");
        return;
      }
      const finish = (status, message, outcome) => {
        done = true;
        clearTimeout(timer);
        res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(`<!doctype html><meta charset="utf-8"><title>NOUR ChatGPT sign-in</title><p>${message}</p>`);
        server.close();
        outcome();
      };
      const p = url.searchParams;
      if (!constantTimeEqual(p.get("state") || "", state)) {
        return finish(400, "Sign-in rejected (state mismatch). Start sign-in again.", () =>
          settle.rej(new BridgeError("STATE_MISMATCH")));
      }
      if (p.get("error")) {
        return finish(400, "Sign-in was not completed. You can close this tab.", () =>
          settle.rej(new BridgeError("OAUTH_DENIED", `error=${safeToken(p.get("error"))}`)));
      }
      const code = p.get("code");
      if (!code || code.length > 4096) {
        return finish(400, "Sign-in response was incomplete.", () => settle.rej(new BridgeError("AUTH_CODE_MISSING")));
      }
      const clientId = p.get("client_id");
      if (clientId && !ISSUED_CLIENT_ID_RE.test(clientId)) {
        return finish(400, "Sign-in response was invalid.", () => settle.rej(new BridgeError("CLIENT_ID_INVALID")));
      }
      return finish(200, "Sign-in complete. You can close this tab and return to NattyNour.", () =>
        settle.res({ code, clientId: clientId || null }));
    });
    server.on("error", () => rejectStart(new BridgeError("CALLBACK_LISTEN_FAILED")));
    server.listen(port, "127.0.0.1", () => {
      timer = setTimeout(() => {
        if (done) return;
        done = true;
        server.close();
        settle.rej(new BridgeError("SIGNIN_TIMEOUT"));
      }, timeoutMs);
      resolveStart({
        port: server.address().port,
        result,
        close: () => {
          done = true;
          clearTimeout(timer);
          server.close();
        },
      });
    });
  });
}

function openSystemBrowser(url) {
  const [cmd, args] =
    process.platform === "win32"
      ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => {});
    child.unref();
  } catch {}
}

async function signin(ctx, req) {
  requireCodec(ctx);
  const discovery = await fetchDiscovery(ctx);
  const host = await ensureHost(ctx);
  const authorizeClientId = host.clientId || INITIAL_CLIENT_ID;
  const pkce = createPkce();
  const state = b64url(randomBytes(32));
  const nonce = b64url(randomBytes(32));
  const callbackPort = req.callbackPort ? clampInt(req.callbackPort, 1024, 65535, 0) : 0;
  const callback = await startCallbackServer({
    port: callbackPort,
    state,
    timeoutMs: clampInt(req.timeoutSeconds, 30, 900, 300) * 1000,
  });
  let issued;
  let redirectUri;
  try {
    redirectUri = `http://127.0.0.1:${callback.port}/auth/callback`;
    const url = buildAuthorizeUrl({
      clientId: authorizeClientId,
      redirectUri,
      codeChallenge: pkce.challenge,
      state,
      nonce,
      hostId: host.extAgentHostId,
    });
    // The authorize URL carries only one-time public values (state, nonce,
    // PKCE challenge); it is safe to show so the user can open it manually.
    ctx.log(`Open this URL to sign in with ChatGPT:\n${url}`);
    if (req.openBrowser !== false) ctx.openBrowser(url);
    issued = await callback.result;
  } finally {
    callback.close();
  }

  const clientId = issued.clientId || (authorizeClientId !== INITIAL_CLIENT_ID ? authorizeClientId : null);
  if (!clientId) throw new BridgeError("CLIENT_ID_MISSING", "callback did not return an issued client id");
  const tok = await tokenRequest(ctx, {
    grant_type: "authorization_code",
    code: issued.code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: pkce.verifier,
    resource: RESOURCE,
  });
  if (typeof tok.id_token !== "string") throw new BridgeError("ID_TOKEN_MISSING");
  const jwks = await httpJson(ctx, JWKS_URL, { headers: { accept: "application/json" } }, 15_000);
  if (!jwks.ok || !jwks.body) throw new BridgeError("JWKS_UNAVAILABLE");
  verifyIdToken(tok.id_token, { jwks: jwks.body, issuer: discovery.issuer, clientId, nonce, nowMs: ctx.now() });

  // Registration succeeded; keep the issued client id so later sign-ins reuse
  // it (and never resend the initial-registration name hint).
  await atomicWrite(
    statePath(ctx, "host.json"),
    JSON.stringify({ ...host, clientId, registeredAt: host.registeredAt || new Date(ctx.now()).toISOString() }, null, 2),
  );
  const { scopes, source } = grantedScopes(tok, null);
  if (!scopes.includes(PLAN_SCOPE)) throw new BridgeError("SCOPE_NOT_GRANTED", `${PLAN_SCOPE} not granted`);
  const refreshToken = typeof tok.refresh_token === "string" ? tok.refresh_token : "";
  if (scopes.includes("offline_access") && !refreshToken) {
    throw new BridgeError("TOKEN_RESPONSE_INVALID", "refresh_token");
  }
  await saveCredentials(ctx, {
    clientId,
    accessToken: tok.access_token,
    refreshToken,
    expiresAt: ctx.now() + tok.expires_in * 1000,
    scopes,
    scopeSource: source,
    obtainedAt: new Date(ctx.now()).toISOString(),
  });
  fs.rmSync(statePath(ctx, "probe-cache.json"), { force: true });
  clearQuotaMarker(ctx);
  const health = await probe(ctx);
  return { ...health, status: "completed", signedIn: true };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function createContext() {
  return {
    env: process.env,
    fetch: globalThis.fetch,
    codec: dpapiCodec(),
    stateDir: defaultStateDir(process.env),
    now: () => Date.now(),
    log: message => process.stderr.write(`${message}\n`),
    openBrowser: openSystemBrowser,
  };
}

async function readStdinJson() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_STDIN_BYTES) throw new BridgeError("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "").trim();
  if (!text) return {};
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new BridgeError("REQUEST_INVALID");
  return parsed;
}

function emit(payload, exitCode) {
  process.stdout.write(`${JSON.stringify(payload)}\n`, () => process.exit(exitCode));
}

async function runCommand(ctx, command, request) {
  switch (command) {
    case "probe":
    case "status":
      return await probe(ctx);
    case "signin":
      return await signin(ctx, request);
    case "models":
      return await modelsCommand(ctx);
    case "chat":
      return await chat(ctx, request);
    default:
      throw new BridgeError("UNKNOWN_COMMAND");
  }
}

async function main(argv) {
  const command = argv[2] || "";
  if (command === "--self-test") {
    const report = await runSelfTest();
    return emit(report, report.status === "ok" ? 0 : 1);
  }
  let request;
  try {
    request = await readStdinJson();
  } catch (err) {
    const e = err instanceof BridgeError ? err : new BridgeError("REQUEST_INVALID");
    return emit({ status: "failed", errorCode: e.code }, 2);
  }
  try {
    return emit(await runCommand(createContext(), command, request), 0);
  } catch (err) {
    const e = asBridgeError(err);
    const out = { status: "failed", errorCode: e.code };
    if (e.detail) out.detail = String(e.detail).slice(0, 200);
    return emit(out, 3);
  }
}

// ---------------------------------------------------------------------------
// Self-test (no network, no live OAuth; mocked fetch and a test-only codec)
// ---------------------------------------------------------------------------

async function runSelfTest() {
  const realFetch = globalThis.fetch;
  const results = [];
  const enc = new TextEncoder();
  const testCodec = {
    name: "self-test-xor",
    protect: async buf => Buffer.from(Buffer.from(buf).map(b => b ^ 0x5a)).toString("base64"),
    unprotect: async sealed => Buffer.from(Buffer.from(sealed, "base64").map(b => b ^ 0x5a)),
  };
  const jsonRes = (status, obj) =>
    new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
  const sseRes = chunks =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const c of chunks) controller.enqueue(typeof c === "string" ? enc.encode(c) : c);
          controller.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  const sse = (type, obj) => `event: ${type}\ndata: ${JSON.stringify({ type, ...obj })}\n\n`;
  const assert = (cond, message) => {
    if (!cond) throw new Error(message);
  };
  const expectCode = async (promise, code) => {
    try {
      await promise;
    } catch (err) {
      assert(err instanceof BridgeError && err.code === code, `expected ${code}, got ${err && (err.code || err.message)}`);
      return;
    }
    throw new Error(`expected ${code}, got success`);
  };
  const catalogBody = {
    models: [
      { slug: "plan-embed-x", display_name: "Embed X", visibility: "list" },
      { slug: "plan-hidden-y", display_name: "Hidden Y", visibility: "hidden" },
      { slug: "plan-chat-mini", display_name: "Chat Mini", visibility: "list" },
      { slug: "plan-chat-large", display_name: "Chat Large", visibility: "list" },
    ],
  };
  const makeCtx = (dir, fetchImpl, env = {}) => ({
    env,
    fetch: fetchImpl,
    codec: testCodec,
    stateDir: dir,
    now: () => Date.now(),
    log: () => {},
    openBrowser: () => {},
  });
  const seed = async (ctx, overrides = {}) =>
    saveCredentials(ctx, {
      clientId: "oaiapp_selftest",
      accessToken: "at-old-SECRET",
      refreshToken: "rt-old-SECRET",
      expiresAt: Date.now() + 3_600_000,
      scopes: SCOPES.slice(),
      scopeSource: "token_response",
      ...overrides,
    });
  const signJwt = (privateKey, kid, claims, alg = "RS256") => {
    const header = b64url(JSON.stringify({ alg, kid, typ: "JWT" }));
    const payload = b64url(JSON.stringify(claims));
    const sig = cryptoSign("sha256", Buffer.from(`${header}.${payload}`), privateKey);
    return `${header}.${payload}.${b64url(sig)}`;
  };

  const tests = {
    "pkce S256 matches RFC 7636 appendix B": async () => {
      assert(
        pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk") === "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        "challenge mismatch",
      );
    },
    "host identity uses urn:uuid and legacy uuid is migrated": async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nour-plan-"));
      try {
        const ctx = makeCtx(dir, async () => jsonRes(500, {}));
        const created = await ensureHost(ctx);
        assert(
          /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            created.extAgentHostId,
          ),
          created.extAgentHostId,
        );
        await atomicWrite(
          statePath(ctx, "host.json"),
          JSON.stringify({
            v: 1,
            extAgentHostId: "123e4567-e89b-42d3-a456-426614174000",
            clientId: null,
          }),
        );
        const migrated = loadHost(ctx);
        assert(
          migrated?.extAgentHostId === "urn:uuid:123e4567-e89b-42d3-a456-426614174000",
          "legacy host id migrated",
        );
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    "initial missing scope evidence fails closed": async () => {
      const absent = grantedScopes({ access_token: "opaque-token" }, null);
      assert(absent.scopes.length === 0 && absent.source === "missing", JSON.stringify(absent));
      const refreshed = grantedScopes(
        { access_token: "opaque-token" },
        ["openid", PLAN_SCOPE],
      );
      assert(refreshed.scopes.includes(PLAN_SCOPE) && refreshed.source === "previous_grant", JSON.stringify(refreshed));
    },
    "authorize url carries required protocol params": async () => {
      const first = new URL(buildAuthorizeUrl({
        clientId: INITIAL_CLIENT_ID,
        redirectUri: "http://127.0.0.1:5555/auth/callback",
        codeChallenge: "c",
        state: "s",
        nonce: "n",
        hostId: "urn:uuid:123e4567-e89b-42d3-a456-426614174000",
      }));
      const p = first.searchParams;
      assert(first.origin + first.pathname === AUTHORIZE_URL, "endpoint");
      assert(p.get("scope") === SCOPES.join(" ") && p.get("scope").includes(PLAN_SCOPE), "scope");
      assert(p.get("code_challenge_method") === "S256" && p.get("resource") === RESOURCE, "pkce/resource");
      assert(
        p.get("agent_name_hint") === AGENT_NAME_HINT &&
          p.get("ext_agent_host_id") === "urn:uuid:123e4567-e89b-42d3-a456-426614174000",
        "hints",
      );
      assert(!p.has("client_secret"), "no client secret");
      const again = new URL(buildAuthorizeUrl({
        clientId: "oaiapp_issued",
        redirectUri: "http://127.0.0.1:5555/auth/callback",
        codeChallenge: "c",
        state: "s",
        nonce: "n",
        hostId: "urn:uuid:123e4567-e89b-42d3-a456-426614174000",
      }));
      assert(!again.searchParams.has("agent_name_hint"), "name hint only on initial registration");
      let threw = false;
      try {
        buildAuthorizeUrl({ clientId: "x", redirectUri: "http://localhost:1/auth/callback", codeChallenge: "c", state: "s", nonce: "n", hostId: "h" });
      } catch {
        threw = true;
      }
      assert(threw, "non-127.0.0.1 redirect must be rejected");
    },
    "sse parser handles split CRLF, comments and split UTF-8": async () => {
      const events = [];
      const parser = createSseParser((e, d) => events.push([e, d]));
      const decoder = new TextDecoder("utf-8");
      const bytes = enc.encode(': keepalive\r\nevent: a\r\ndata: {"x":"é✓"}\r\n\r\ndata: [DONE]\n\n');
      for (let i = 0; i < bytes.length; i += 3) parser.push(decoder.decode(bytes.slice(i, i + 3), { stream: true }));
      parser.push(decoder.decode());
      parser.end();
      assert(events.length === 2 && events[0][0] === "a" && JSON.parse(events[0][1]).x === "é✓", JSON.stringify(events));
      assert(events[1][1] === "[DONE]", "done marker");
    },
    "collector joins deltas and prefers done text": async () => {
      const c = createResponsesCollector();
      c.handle("m", JSON.stringify({ type: "response.created", response: { model: "plan-chat-large" } }));
      c.handle("m", JSON.stringify({ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "Hel" }));
      c.handle("m", "{not json");
      c.handle("m", JSON.stringify({ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "lo" }));
      c.handle("m", JSON.stringify({ type: "response.output_text.delta", output_index: 1, content_index: 0, delta: "Second" }));
      c.handle("m", JSON.stringify({
        type: "response.output_text.done",
        output_index: 1,
        content_index: 0,
        text: "Second item",
        annotations: [{ type: "url_citation", url: "https://example.com/source" }],
      }));
      c.handle("m", JSON.stringify({ type: "response.completed", response: { model: "plan-chat-large" } }));
      const r = c.result();
      assert(r.text === "Hello\n\nSecond item" && r.model === "plan-chat-large", JSON.stringify(r));
      assert(r.sources.includes("https://example.com/source"), "citation URL preserved");
    },
    "collector fails closed on quota, truncation and empty output": async () => {
      const quota = createResponsesCollector();
      quota.handle("m", JSON.stringify({ type: "response.failed", response: { error: { code: "usage_limit_reached" } } }));
      assert(quota.result().errorCode === "QUOTA_EXHAUSTED", "quota");
      const trunc = createResponsesCollector();
      trunc.handle("m", JSON.stringify({ type: "response.output_text.delta", delta: "partial" }));
      assert(trunc.result().errorCode === "STREAM_TRUNCATED", "truncated");
      const empty = createResponsesCollector();
      empty.handle("m", JSON.stringify({ type: "response.completed", response: { output: [] } }));
      assert(empty.result().errorCode === "EMPTY_RESPONSE", "empty");
      const fallback = createResponsesCollector();
      fallback.handle("m", JSON.stringify({
        type: "response.completed",
        response: { output: [{ content: [{ type: "output_text", text: "from final" }] }] },
      }));
      assert(fallback.result().text === "from final", "final fallback");
    },
    "id token validation enforces signature, iss, aud, exp, nonce, sub": async () => {
      const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "RS256" };
      const jwks = { keys: [jwk] };
      const now = Date.now();
      const base = {
        iss: "https://auth.openai.com",
        aud: "oaiapp_selftest",
        exp: Math.floor(now / 1000) + 600,
        iat: Math.floor(now / 1000),
        nonce: "nonce-1",
        sub: "user-1",
      };
      const opts = { jwks, issuer: "https://auth.openai.com", clientId: "oaiapp_selftest", nonce: "nonce-1", nowMs: now };
      assert(verifyIdToken(signJwt(privateKey, "k1", base), opts).sub === "user-1", "valid token");
      const bad = async (claims, code, mutate) => {
        let token = signJwt(privateKey, "k1", { ...base, ...claims });
        if (mutate) token = mutate(token);
        await expectCode((async () => verifyIdToken(token, opts))(), code);
      };
      await bad({ nonce: "other" }, "ID_TOKEN_NONCE_MISMATCH");
      await bad({ aud: "oaiapp_other" }, "ID_TOKEN_AUDIENCE_MISMATCH");
      await bad({ iss: "https://evil.example" }, "ID_TOKEN_ISSUER_MISMATCH");
      await bad({ exp: Math.floor(now / 1000) - 3600 }, "ID_TOKEN_EXPIRED");
      await bad({ sub: "" }, "ID_TOKEN_SUBJECT_MISSING");
      await bad({}, "ID_TOKEN_SIGNATURE_INVALID", t => {
        const [h, , s] = t.split(".");
        return `${h}.${b64url(JSON.stringify({ ...base, sub: "attacker" }))}.${s}`;
      });
      await bad({}, "ID_TOKEN_ALG_REJECTED", t => {
        const [, p] = t.split(".");
        return `${b64url(JSON.stringify({ alg: "none" }))}.${p}.`;
      });
    },
    "model selection keeps visibility=list and fails closed on unknown preference": async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nour-plan-"));
      try {
        const ctx = makeCtx(dir, async url => {
          assert(url === `${API_BASE}/models`, "catalog url");
          return jsonRes(200, catalogBody);
        });
        await seed(ctx);
        const catalog = await fetchPlanCatalog(ctx, AbortSignal.timeout(5000));
        assert(!catalog.some(m => m.id === "plan-hidden-y"), "hidden models dropped");
        assert(selectPlanModel(catalog, "") === "plan-chat-large", "dynamic selection");
        assert(selectPlanModel(catalog, "plan-chat-mini") === "plan-chat-mini", "env preference honoured");
        await expectCode((async () => selectPlanModel(catalog, "not-listed"))(), "MODEL_NOT_IN_PLAN_CATALOG");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    "chat refreshes rotating credentials and streams store=false": async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nour-plan-"));
      const saved = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = "fake-paid-api-key-should-never-be-used";
      try {
        const calls = [];
        const ctx = makeCtx(dir, async (url, init = {}) => {
          const auth = (init.headers && init.headers.authorization) || "";
          calls.push({ url, auth, body: init.body });
          assert(!String(auth).includes("fake-paid-api-key"), "paid key must never be sent");
          if (url === TOKEN_URL) {
            const form = new URLSearchParams(init.body);
            assert(form.get("grant_type") === "refresh_token" && form.get("refresh_token") === "rt-old-SECRET", "refresh grant");
            assert(!form.has("client_secret"), "no client secret");
            return jsonRes(200, {
              access_token: "at-new-SECRET",
              refresh_token: "rt-new-SECRET",
              expires_in: 3600,
              token_type: "Bearer",
              scope: SCOPES.join(" "),
            });
          }
          if (url === `${API_BASE}/models`) return jsonRes(200, catalogBody);
          if (url === `${API_BASE}/responses`) {
            const body = JSON.parse(init.body);
            assert(body.store === false && body.stream === true && body.model === "plan-chat-large", "responses body");
            assert(
              Array.isArray(body.input) &&
                body.input[0]?.role === "user" &&
                body.input[0]?.content === "Say PLAN_OK",
              "responses input must be an array",
            );
            assert(body.tools?.[0]?.type === "web_search", "native web search requested");
            assert(body.tool_choice === "required", "research search must be required");
            assert(!("max_output_tokens" in body), "plan-sharing unsupported tuning fields must be omitted");
            assert(auth === "Bearer at-new-SECRET", "uses refreshed plan token");
            return sseRes([
              sse("response.created", { response: { model: "plan-chat-large" } }),
              sse("response.output_text.delta", { output_index: 0, content_index: 0, delta: "PLAN_" }),
              sse("response.output_text.delta", { output_index: 0, content_index: 0, delta: "OK" }),
              sse("response.completed", {
                response: {
                  model: "plan-chat-large",
                  output: [{
                    content: [{
                      type: "output_text",
                      text: "PLAN_OK",
                      annotations: [{ type: "url_citation", url: "https://example.com/evidence" }],
                    }],
                  }],
                },
              }),
            ]);
          }
          throw new Error(`unexpected url ${url}`);
        });
        await seed(ctx, { expiresAt: Date.now() - 1000 });
        const out = await chat(ctx, {
          input: "Say PLAN_OK",
          timeoutMs: 10_000,
          webSearch: true,
          maxOutputTokens: 9999,
        });
        assert(out.status === "completed" && out.text === "PLAN_OK", JSON.stringify(out));
        assert(out.sources.includes("https://example.com/evidence"), "web citation preserved");
        const stored = await loadCredentials(ctx);
        assert(stored.refreshToken === "rt-new-SECRET" && stored.accessToken === "at-new-SECRET", "rotation persisted");
        const onDisk = fs.readFileSync(statePath(ctx, "credentials.dpapi"), "utf8");
        assert(!onDisk.includes("SECRET"), "credentials must not be stored in plaintext");
        assert(calls[0].url === TOKEN_URL, "refresh happens before API use");
      } finally {
        if (saved === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = saved;
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    "not signed in fails closed without any network or paid key": async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nour-plan-"));
      const saved = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = "fake-paid-api-key-should-never-be-used";
      try {
        let called = 0;
        const ctx = makeCtx(dir, async () => {
          called++;
          return jsonRes(200, {});
        });
        await expectCode(chat(ctx, { input: "hello there" }), "NOT_SIGNED_IN");
        const p = await probe(ctx);
        assert(p.health === "unavailable" && p.auth === "not signed in", JSON.stringify(p));
        assert(called === 0, "no network calls when signed out");
      } finally {
        if (saved === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = saved;
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    "missing plan scope fails closed before any API call": async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nour-plan-"));
      try {
        let called = 0;
        const ctx = makeCtx(dir, async () => {
          called++;
          return jsonRes(200, catalogBody);
        });
        await seed(ctx, { scopes: ["openid", "offline_access"] });
        await expectCode(chat(ctx, { input: "hello there" }), "SCOPE_NOT_GRANTED");
        const p = await probe(ctx);
        assert(p.health === "unavailable" && p.auth === "plan scope not granted", JSON.stringify(p));
        assert(called === 0, "no API call without the plan scope");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    "401 triggers one refresh then fails closed": async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nour-plan-"));
      try {
        let refreshes = 0;
        const ctx = makeCtx(dir, async url => {
          if (url === TOKEN_URL) {
            refreshes++;
            return jsonRes(200, { access_token: `at-${refreshes}`, refresh_token: `rt-${refreshes}`, expires_in: 3600, token_type: "Bearer", scope: SCOPES.join(" ") });
          }
          return jsonRes(401, { error: { code: "invalid_token" } });
        });
        await seed(ctx);
        await expectCode(chat(ctx, { input: "hello there" }), "AUTH_REJECTED");
        assert(refreshes === 1, `expected one refresh, got ${refreshes}`);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    "quota exhaustion is surfaced to probe": async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nour-plan-"));
      try {
        const ctx = makeCtx(dir, async url => {
          if (url === `${API_BASE}/models`) return jsonRes(200, catalogBody);
          return jsonRes(429, { error: { code: "usage_limit_reached" } });
        });
        await seed(ctx);
        await expectCode(chat(ctx, { input: "hello there" }), "QUOTA_EXHAUSTED");
        const p = await probe(ctx);
        assert(p.quota === "exhausted" && p.health === "degraded", JSON.stringify(p));
        assert(!JSON.stringify(p).includes("SECRET"), "probe never includes credentials");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    "signin runs PKCE + callback + ID-token checks without live OAuth": async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nour-plan-"));
      try {
        const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
        const jwk = { ...publicKey.export({ format: "jwk" }), kid: "kid-a", use: "sig" };
        let authorize = null;
        const ctx = makeCtx(dir, async (url, init = {}) => {
          if (url === DISCOVERY_URL) return jsonRes(200, { issuer: "https://auth.openai.com", jwks_uri: JWKS_URL });
          if (url === JWKS_URL) return jsonRes(200, { keys: [jwk] });
          if (url === `${API_BASE}/models`) return jsonRes(200, catalogBody);
          if (url === TOKEN_URL) {
            const form = new URLSearchParams(init.body);
            assert(form.get("grant_type") === "authorization_code" && form.get("code") === "code-xyz", "code grant");
            assert(form.get("client_id") === "oaiapp_issued123", "issued client id used for exchange");
            assert(pkceChallenge(form.get("code_verifier")) === authorize.get("code_challenge"), "pkce verifier");
            assert(form.get("redirect_uri") === authorize.get("redirect_uri"), "redirect uri");
            return jsonRes(200, {
              access_token: "at-signin-SECRET",
              refresh_token: "rt-signin-SECRET",
              expires_in: 3600,
              token_type: "Bearer",
              scope: SCOPES.join(" "),
              id_token: signJwt(privateKey, "kid-a", {
                iss: "https://auth.openai.com",
                aud: "oaiapp_issued123",
                exp: Math.floor(Date.now() / 1000) + 600,
                iat: Math.floor(Date.now() / 1000),
                nonce: authorize.get("nonce"),
                sub: "user-signin",
              }),
            });
          }
          throw new Error(`unexpected url ${url}`);
        });
        ctx.openBrowser = url => {
          authorize = new URL(url).searchParams;
          const cb = new URL(authorize.get("redirect_uri"));
          assert(cb.hostname === "127.0.0.1" && cb.pathname === "/auth/callback", "loopback callback");
          cb.searchParams.set("code", "code-xyz");
          cb.searchParams.set("state", authorize.get("state"));
          cb.searchParams.set("client_id", "oaiapp_issued123");
          setTimeout(() => realFetch(cb).catch(() => {}), 10);
        };
        const out = await signin(ctx, { timeoutSeconds: 30 });
        assert(out.status === "completed" && out.health === "ready" && out.model === "plan-chat-large", JSON.stringify(out));
        assert(authorize.get("client_id") === INITIAL_CLIENT_ID && authorize.get("agent_name_hint") === AGENT_NAME_HINT, "initial registration");
        const host = JSON.parse(fs.readFileSync(statePath(ctx, "host.json"), "utf8"));
        assert(host.clientId === "oaiapp_issued123" && host.extAgentHostId === authorize.get("ext_agent_host_id"), "host persisted");
        assert(!JSON.stringify(host).includes("SECRET") && !JSON.stringify(out).includes("SECRET"), "no secrets in host/probe");
        assert(!JSON.stringify(out).includes("user-signin"), "no subject/PII in output");
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    "callback rejects forged state": async () => {
      const cb = await startCallbackServer({ port: 0, state: "expected-state", timeoutMs: 10_000 });
      const hit = realFetch(`http://127.0.0.1:${cb.port}/auth/callback?code=c&state=forged`).then(r => r.status);
      await expectCode(cb.result, "STATE_MISMATCH");
      assert((await hit) === 400, "forged state answered 400");
    },
  };
  if (process.platform === "win32") {
    tests["dpapi current-user round trip"] = async () => {
      const codec = dpapiCodec();
      const sealed = await codec.protect(Buffer.from("dpapi-selftest-value", "utf8"));
      assert(!Buffer.from(sealed, "base64").toString("latin1").includes("dpapi-selftest-value"), "sealed");
      assert((await codec.unprotect(sealed)).toString("utf8") === "dpapi-selftest-value", "round trip");
    };
  }

  for (const [name, fn] of Object.entries(tests)) {
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (err) {
      results.push({ name, ok: false, error: String((err && (err.code || err.message)) || err).slice(0, 300) });
    }
  }
  const failed = results.filter(r => !r.ok);
  return { status: failed.length ? "failed" : "ok", passed: results.length - failed.length, failed };
}

main(process.argv).catch(err => {
  const e = asBridgeError(err);
  emit({ status: "failed", errorCode: e.code }, 3);
});
