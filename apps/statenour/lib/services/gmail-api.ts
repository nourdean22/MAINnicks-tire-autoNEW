/**
 * Gmail API Client — headless Gmail read access via the stored
 * refresh token (see lib/services/google-oauth.ts).
 *
 * Only needs list + read. We don't send email from here — the
 * purpose is to pull substantial inbox/sent content into BrainMemory
 * so Nick has context across weeks of communication.
 */

import { getAccessToken } from "@/lib/services/google-oauth";

export interface GmailMessage {
  id: string;
  threadId: string;
  from?: string;
  to?: string;
  subject?: string;
  date?: string;
  snippet?: string;
  body?: string;
  labels?: string[];
}

/**
 * Search Gmail with the standard query syntax.
 * @example listMessages("in:sent newer_than:30d", 40)
 */
export async function listMessages(
  query: string,
  maxResults: number = 40,
  accountKey: string = "primary",
): Promise<Array<{ id: string; threadId: string }>> {
  const token = await getAccessToken(accountKey);
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000), // wave-181.92 follow-up
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail list failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as {
    messages?: Array<{ id: string; threadId: string }>;
  };
  return data.messages || [];
}

/**
 * Fetch a single message with headers + parsed body.
 */
export async function getMessage(
  messageId: string,
  accountKey: string = "primary",
): Promise<GmailMessage> {
  const token = await getAccessToken(accountKey);
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000), // wave-181.92 follow-up
  });
  if (!res.ok) {
    throw new Error(`Gmail get failed: ${res.status}`);
  }
  const data = (await res.json()) as {
    id: string;
    threadId: string;
    snippet?: string;
    labelIds?: string[];
    payload?: {
      headers?: Array<{ name: string; value: string }>;
      body?: { data?: string; size?: number };
      parts?: Array<{
        mimeType?: string;
        body?: { data?: string };
        parts?: unknown[];
      }>;
    };
    internalDate?: string;
  };

  const headers: Record<string, string> = {};
  for (const h of data.payload?.headers || []) {
    headers[h.name.toLowerCase()] = h.value;
  }

  return {
    id: data.id,
    threadId: data.threadId,
    from: headers.from,
    to: headers.to,
    subject: headers.subject,
    date: headers.date,
    snippet: data.snippet,
    body: extractBody(data.payload),
    labels: data.labelIds,
  };
}

/**
 * Walk a Gmail message payload tree and pull out the best plaintext
 * body. Falls back to HTML stripping if no text/plain part.
 */
function extractBody(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as {
    mimeType?: string;
    body?: { data?: string };
    parts?: unknown[];
  };

  // Direct text part
  if (p.mimeType === "text/plain" && p.body?.data) {
    return decodeBase64Url(p.body.data);
  }

  // Walk parts recursively, prefer text/plain
  if (Array.isArray(p.parts)) {
    for (const part of p.parts) {
      const body = extractBody(part);
      if (body) return body;
    }
  }

  // HTML fallback — strip tags
  if (p.mimeType === "text/html" && p.body?.data) {
    const raw = decodeBase64Url(p.body.data);
    return raw
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
  }

  return "";
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}
