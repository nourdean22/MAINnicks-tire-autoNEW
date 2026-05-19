/**
 * Google Drive API Client — headless read via the stored refresh
 * token (see lib/services/google-oauth.ts).
 *
 * Uses v3 files.list + files.export for Google Docs. Supports the
 * `drive_sources.md` registry pattern — Nour maintains a list of
 * doc IDs in his memory files, and the ingest cron walks that list
 * to pull content on a schedule.
 */

import { getAccessToken } from "@/lib/services/google-oauth";

export interface DriveDoc {
  id: string;
  title?: string;
  mimeType?: string;
  modifiedTime?: string;
  content?: string;
  viewUrl?: string;
}

/**
 * Fetch metadata for a single file.
 */
export async function getFileMetadata(fileId: string): Promise<{
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink?: string;
} | null> {
  const token = await getAccessToken();
  const fields = "id,name,mimeType,modifiedTime,webViewLink";
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=${fields}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000), // wave-181.92
    }
  );
  if (!res.ok) return null;
  return (await res.json()) as {
    id: string;
    name: string;
    mimeType: string;
    modifiedTime: string;
    webViewLink?: string;
  };
}

/**
 * Download the text content of a Drive file. For Google Docs we use
 * the export endpoint to convert to plain text. For native text/pdf
 * files we use the standard download endpoint.
 */
export async function getFileContent(fileId: string, mimeType: string): Promise<string> {
  const token = await getAccessToken();

  const isGoogleDoc = mimeType.startsWith("application/vnd.google-apps.");
  const url = isGoogleDoc
    ? `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`
    : `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000), // wave-181.92 · larger files may be slow
  });
  if (!res.ok) return "";
  return await res.text();
}

/**
 * List recently modified files in the user's drive (top N).
 */
export async function listRecentFiles(limit: number = 20): Promise<DriveDoc[]> {
  const token = await getAccessToken();
  const params = new URLSearchParams({
    pageSize: String(limit),
    orderBy: "modifiedTime desc",
    fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
    q: "mimeType contains 'google-apps.document' or mimeType = 'application/pdf'",
  });
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000), // wave-181.92
    }
  );
  if (!res.ok) return [];
  const data = (await res.json()) as {
    files?: Array<{
      id: string;
      name: string;
      mimeType: string;
      modifiedTime: string;
      webViewLink?: string;
    }>;
  };
  return (data.files || []).map((f) => ({
    id: f.id,
    title: f.name,
    mimeType: f.mimeType,
    modifiedTime: f.modifiedTime,
    viewUrl: f.webViewLink,
  }));
}
