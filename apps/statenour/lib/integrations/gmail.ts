/**
 * Gmail integration · v10.0.379
 *
 * Per /gmail-automation skill · operator's gmail (nourdean22@gmail.com)
 * is a primary work surface · this module gives Nick the ability to
 * triage inbox / draft replies / send mail.
 *
 * AUTH MODEL · refresh token stored in GMAIL_REFRESH_TOKEN env var.
 * One-time setup via OAuth playground (see docs/gmail-setup.md):
 *   1. Operator visits Google OAuth Playground · grants scopes
 *   2. Exchanges code for refresh token
 *   3. Drops refresh token into Vercel env as GMAIL_REFRESH_TOKEN
 *   4. Module is ready · access tokens auto-refreshed per call
 *
 * Why not extend NextAuth? · The login flow doesn't need Gmail scopes
 * · keeping them separate means the auth.ts blast radius stays zero
 * and the operator can revoke Gmail access without losing app login.
 *
 * SCOPES · gmail.readonly + gmail.send + gmail.modify (for draft mgmt).
 *
 * GUARDIAN · all Gmail API calls wrapped via withGuardian (v10.0.357)
 * for transient retries (auth refresh races, rate limit, network).
 */

import { withGuardian } from "@/lib/tools/guardian";

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

interface GmailMessageHeader {
  name: string;
  value: string;
}

export interface GmailThreadSummary {
  id: string;
  snippet: string;
  /** Subject from the latest message in the thread. */
  subject: string;
  /** From of the latest message. */
  from: string;
  /** Internal date of the latest message · ms since epoch. */
  internalDate: number;
  /** Number of messages in the thread. */
  messageCount: number;
  unread: boolean;
}

export interface GmailThreadFull {
  id: string;
  subject: string;
  messages: Array<{
    id: string;
    from: string;
    to: string;
    date: string;
    body: string;
    snippet: string;
  }>;
}

// ── Token management ──────────────────────────────────────────────

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

async function _refreshAccessToken(): Promise<string> {
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  const clientId = process.env.AUTH_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.AUTH_GOOGLE_CLIENT_SECRET;
  if (!refreshToken) throw new Error("GMAIL_REFRESH_TOKEN not configured · see docs/gmail-setup.md");
  if (!clientId || !clientSecret) throw new Error("AUTH_GOOGLE_CLIENT_ID/SECRET required for Gmail token refresh");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(8_000), // wave-181.92 · matches withGuardian timeoutMs · cancels socket
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err: Error & { status?: number } = new Error(
      `Gmail token refresh ${res.status}: ${body.slice(0, 200)}`,
    );
    err.status = res.status;
    throw err;
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedAccessToken = {
    token: data.access_token,
    // Refresh 60s before expiry to avoid races
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return data.access_token;
}

const refreshAccessToken = withGuardian("gmail-token", _refreshAccessToken, {
  timeoutMs: 8_000,
  maxRetries: 1,
  reliabilityOnly: true, // internal OAuth token-refresh sub-op
});

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
    return cachedAccessToken.token;
  }
  return refreshAccessToken();
}

async function gmailFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${GMAIL_API_BASE}${path}`, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(15_000), // wave-181.92
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err: Error & { status?: number } = new Error(
      `Gmail ${res.status} ${path}: ${body.slice(0, 200)}`,
    );
    err.status = res.status;
    throw err;
  }
  return res;
}

const guardedGmailFetch = withGuardian("gmail-fetch", gmailFetch, {
  timeoutMs: 12_000,
  maxRetries: 2,
  reliabilityOnly: true, // internal authed-fetch sub-op behind gmail.* tools
});

// ── Header helpers ────────────────────────────────────────────────

function findHeader(headers: GmailMessageHeader[] | undefined, name: string): string {
  if (!headers) return "";
  const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * List recent inbox threads · default last 20.
 *
 * @param query · Gmail search syntax · 'is:unread', 'from:supplier@x',
 *               'newer_than:2d', etc.
 */
export async function listInbox(args: {
  maxResults?: number;
  query?: string;
} = {}): Promise<GmailThreadSummary[]> {
  const params = new URLSearchParams({
    maxResults: String(args.maxResults ?? 20),
  });
  if (args.query) params.set("q", args.query);

  const res = await guardedGmailFetch(`/threads?${params}`);
  const data = (await res.json()) as { threads?: Array<{ id: string }> };
  const threadIds = (data.threads ?? []).map((t) => t.id);

  // Hydrate each thread with summary metadata
  const threads = await Promise.all(
    threadIds.map(async (id) => {
      try {
        const tres = await guardedGmailFetch(`/threads/${id}?format=metadata`);
        const tdata = (await tres.json()) as {
          id: string;
          snippet: string;
          messages: Array<{
            internalDate: string;
            payload?: { headers?: GmailMessageHeader[] };
            labelIds?: string[];
          }>;
        };
        const last = tdata.messages?.[tdata.messages.length - 1];
        const lastHeaders = last?.payload?.headers;
        return {
          id: tdata.id,
          snippet: tdata.snippet ?? "",
          subject: findHeader(lastHeaders, "Subject"),
          from: findHeader(lastHeaders, "From"),
          internalDate: last ? Number(last.internalDate ?? 0) : 0,
          messageCount: tdata.messages?.length ?? 0,
          unread: tdata.messages?.some((m) => m.labelIds?.includes("UNREAD")) ?? false,
        };
      } catch {
        return null;
      }
    }),
  );

  return threads.filter((t): t is GmailThreadSummary => t !== null);
}

/**
 * Get full thread · all messages decoded.
 */
export async function getThread(threadId: string): Promise<GmailThreadFull> {
  const res = await guardedGmailFetch(`/threads/${threadId}?format=full`);
  const data = (await res.json()) as {
    id: string;
    messages: Array<{
      id: string;
      snippet: string;
      internalDate: string;
      payload?: {
        headers?: GmailMessageHeader[];
        body?: { data?: string };
        parts?: Array<{ body?: { data?: string }; mimeType?: string }>;
      };
    }>;
  };

  const subject = findHeader(data.messages[0]?.payload?.headers, "Subject");
  return {
    id: data.id,
    subject,
    messages: data.messages.map((m) => {
      const headers = m.payload?.headers;
      // Try payload.body.data first; fallback to text/plain part
      let bodyData = m.payload?.body?.data ?? "";
      if (!bodyData && Array.isArray(m.payload?.parts)) {
        const textPart = m.payload!.parts.find((p) => p.mimeType === "text/plain");
        bodyData = textPart?.body?.data ?? "";
      }
      const body = bodyData ? Buffer.from(bodyData, "base64url").toString("utf8") : "";
      return {
        id: m.id,
        from: findHeader(headers, "From"),
        to: findHeader(headers, "To"),
        date: findHeader(headers, "Date"),
        body: body.slice(0, 10_000), // cap · big emails get truncated
        snippet: m.snippet ?? "",
      };
    }),
  };
}

/**
 * Create a draft reply on a thread. Returns the draft id.
 */
export async function draftReply(args: {
  threadId: string;
  body: string;
  /** Optional · subject defaults to "Re: <thread subject>" */
  subject?: string;
}): Promise<{ draftId: string; messageId: string }> {
  // Build a minimal RFC 2822 message · base64url encoded
  // Note: we don't set From · Gmail uses the authenticated user
  const subject = args.subject ?? "Re:";
  const raw = [
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    args.body,
  ].join("\r\n");
  const rawBase64 = Buffer.from(raw, "utf8").toString("base64url");

  const res = await guardedGmailFetch("/drafts", {
    method: "POST",
    body: JSON.stringify({
      message: {
        threadId: args.threadId,
        raw: rawBase64,
      },
    }),
  });
  const data = (await res.json()) as { id: string; message?: { id: string } };
  return {
    draftId: data.id,
    messageId: data.message?.id ?? "",
  };
}

/**
 * Create a new draft message. Returns the draft id.
 */
export async function createDraft(args: {
  to: string;
  subject: string;
  body: string;
}): Promise<{ draftId: string; messageId: string }> {
  // Build a RFC 2822 message with To, Subject, Content-Type, and Body
  const raw = [
    `To: ${args.to}`,
    `Subject: ${args.subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    args.body,
  ].join("\r\n");
  const rawBase64 = Buffer.from(raw, "utf8").toString("base64url");

  const res = await guardedGmailFetch("/drafts", {
    method: "POST",
    body: JSON.stringify({
      message: {
        raw: rawBase64,
      },
    }),
  });
  const data = (await res.json()) as { id: string; message?: { id: string } };
  return {
    draftId: data.id,
    messageId: data.message?.id ?? "",
  };
}

/**
 * Send an existing draft. Returns the sent message id.
 */
export async function sendDraft(draftId: string): Promise<{ messageId: string }> {
  const res = await guardedGmailFetch("/drafts/send", {
    method: "POST",
    body: JSON.stringify({ id: draftId }),
  });
  const data = (await res.json()) as { id: string };
  return { messageId: data.id };
}

export function isGmailConfigured(): boolean {
  return Boolean(
    process.env.GMAIL_REFRESH_TOKEN &&
      process.env.AUTH_GOOGLE_CLIENT_ID &&
      process.env.AUTH_GOOGLE_CLIENT_SECRET,
  );
}
