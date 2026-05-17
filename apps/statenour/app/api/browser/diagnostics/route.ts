/**
 * GET /api/browser/diagnostics — browser-agent readiness probe.
 *
 * Owner-auth. Returns a single truth table answering "can Nick drive
 * a browser right now?" — covers both the Browserbase config and the
 * Stagehand driver install. Used by the /system/ surface (future) and
 * by the chat route when deciding whether to advertise browser_* tools.
 *
 * Return shape:
 *   {
 *     browserbase: { configured, apiKey, projectId },
 *     stagehand:   { installed },
 *     ready:       boolean
 *   }
 *
 * No secrets in the response — just booleans. Mirrors /api/system/env-check.
 */
import { apiHandler } from "@/lib/utils/http";
import { getConfig, isConfigured } from "@/lib/integrations/browserbase";
import { isInstalled } from "@/lib/integrations/stagehand";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = apiHandler(
  async () => {
    const bbConfigured = isConfigured();
    const bb = getConfig();
    const shInstalled = await isInstalled();

    return {
      browserbase: {
        configured: bbConfigured,
        api_key: Boolean(bb?.apiKey),
        project_id: Boolean(bb?.projectId),
      },
      stagehand: {
        installed: shInstalled,
      },
      ready: bbConfigured && shInstalled,
      checkedAt: new Date().toISOString(),
    };
  },
  { auth: "owner" },
);
