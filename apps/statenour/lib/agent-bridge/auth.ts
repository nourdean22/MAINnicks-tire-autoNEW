import { createHash, timingSafeEqual } from "node:crypto";

// Hash both sides to fixed length so the comparison is constant-time and
// never branches on secret length — a plain !== leaks match-prefix timing.
function secretsMatch(candidate: string, secret: string): boolean {
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

export function assertBridgeAuth(req: Request) {
  if (process.env.AGENT_BRIDGE_ENABLED !== "true") {
    throw new Error("Agent Bridge is disabled.");
  }

  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }

  const token = authHeader.split(" ")[1];
  const secret = process.env.AGENT_BRIDGE_SECRET_TOKEN;

  if (!secret) {
    throw new Error("Server configuration error: AGENT_BRIDGE_SECRET_TOKEN is missing. Failing closed.");
  }

  if (!token || !secretsMatch(token, secret)) {
    throw new Error("Forbidden");
  }
}
