import type { Page } from "@playwright/test";

/**
 * Collect runtime errors that belong to us, not to third parties.
 *
 * Always counted: uncaught page errors, and console errors that mention a tRPC
 * client error or a first-party /api/ or /trpc/ path.
 * With `origin`, also counted: any console error whose source script is served
 * from that origin. That catches a panel that crashed into a React error boundary,
 * which logs from the app bundle without naming any /api/ path.
 */
export function collectFirstPartyErrors(page: Page, opts: { origin?: string } = {}): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    const fromOrigin = !!opts.origin && m.location().url.startsWith(opts.origin);
    if (/TRPCClientError|\/api\/|\/trpc\//.test(text) || fromOrigin) errors.push("console: " + text);
  });
  return errors;
}
