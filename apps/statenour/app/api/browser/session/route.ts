/**
 * /api/browser/session — Browserbase session lifecycle (G1 scaffold).
 *
 *   GET   → list open sessions
 *   POST  → spin up a new session, return liveViewUrl + connectUrl
 *   DELETE?id=… → close a session
 *
 * Owner-authed. Returns 501 with a structured body when env keys
 * aren't set so the UI can render a "Browserbase not configured"
 * state instead of a noisy error.
 */
import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";
import {
  createSession,
  getSession,
  listSessions,
  closeSession,
  isConfigured,
} from "@/lib/integrations/browserbase";

export const GET = apiHandler(
  async (req) => {
    if (!isConfigured()) {
      throw new ServiceError("Browserbase not configured — set BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID", 501);
    }
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (id) {
      const res = await getSession(id);
      if (!res.ok) throw new ServiceError(res.error, res.code === "not_configured" ? 501 : 502);
      return { session: res.data };
    }
    const res = await listSessions();
    if (!res.ok) throw new ServiceError(res.error, res.code === "not_configured" ? 501 : 502);
    return { sessions: res.data };
  },
  { auth: "owner" },
);

export const POST = apiHandler(
  async () => {
    if (!isConfigured()) {
      throw new ServiceError("Browserbase not configured", 501);
    }
    const res = await createSession({ keepAlive: true });
    if (!res.ok) throw new ServiceError(res.error, res.code === "not_configured" ? 501 : 502);
    return { session: res.data };
  },
  { auth: "owner" },
);

export const DELETE = apiHandler(
  async (req) => {
    if (!isConfigured()) {
      throw new ServiceError("Browserbase not configured", 501);
    }
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) throw new ServiceError("id query param required", 400);
    const res = await closeSession(id);
    if (!res.ok) throw new ServiceError(res.error, res.code === "not_configured" ? 501 : 502);
    return { closed: true, session: res.data };
  },
  { auth: "owner" },
);
