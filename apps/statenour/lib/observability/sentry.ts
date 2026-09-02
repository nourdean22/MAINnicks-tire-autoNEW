/** Resolve Sentry configuration without allowing placeholder values to enable reporting. */
export function resolveSentryDsn(env: Record<string, string | undefined> = process.env): string | undefined {
  const candidate = (env.NEXT_PUBLIC_SENTRY_DSN ?? env.SENTRY_DSN)?.trim();
  const isPlaceholder = /[<>]/.test(candidate ?? "") || /(?:YOUR|CHANGE_ME|REPLACE_ME|example\.com|\.\.\.)/i.test(candidate ?? "");
  if (!candidate || isPlaceholder) {
    return undefined;
  }

  try {
    const parsed = new URL(candidate);
    if (!/^https?:$/.test(parsed.protocol) || !parsed.username || parsed.pathname.length < 2) {
      return undefined;
    }
    return candidate;
  } catch {
    return undefined;
  }
}
