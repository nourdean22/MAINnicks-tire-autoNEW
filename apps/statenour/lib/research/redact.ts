import path from "path";

const monorepoRoot = path.resolve(process.cwd(), "..", "..");

/**
 * Redacts absolute local file system paths from text payloads.
 * Replaces paths containing user directories or project root with [REDACTED_LOCAL_PATH].
 */
export function redactPaths(text: string | null | undefined): string {
  if (!text) return "";
  
  const normalizedRoot = monorepoRoot.replace(/\\/g, "/");
  const escapedRoot = monorepoRoot.replace(/\\/g, "\\\\");

  let redacted = text;

  // Redact project monorepo root paths
  redacted = redacted.replace(new RegExp(normalizedRoot, "gi"), "[REDACTED_LOCAL_PATH]");
  redacted = redacted.replace(new RegExp(escapedRoot, "gi"), "[REDACTED_LOCAL_PATH]");
  redacted = redacted.replace(new RegExp(monorepoRoot, "gi"), "[REDACTED_LOCAL_PATH]");

  // Redact general User profiles paths (Windows/Linux/macOS)
  redacted = redacted.replace(/file:\/\/\/[a-zA-Z]:\/Users\/[a-zA-Z0-9_-]+/gi, "file:///[REDACTED_LOCAL_PATH]");
  redacted = redacted.replace(/[a-zA-Z]:\\Users\\[a-zA-Z0-9_-]+/gi, "[REDACTED_LOCAL_PATH]");
  redacted = redacted.replace(/\/Users\/[a-zA-Z0-9_-]+/gi, "/[REDACTED_LOCAL_PATH]");
  redacted = redacted.replace(/\/home\/[a-zA-Z0-9_-]+/gi, "/[REDACTED_LOCAL_PATH]");

  return redacted;
}
