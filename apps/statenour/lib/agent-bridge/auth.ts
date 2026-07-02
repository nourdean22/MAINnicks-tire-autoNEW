export function assertBridgeAuth(req: Request) {
  if (process.env.AGENT_BRIDGE_ENABLED !== "true" && process.env.MCP_ENABLED !== "true") {
    throw new Error("Agent Bridge is disabled.");
  }
  
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }
  
  const token = authHeader.split(" ")[1];
  // Support both token names during migration
  const secret = process.env.AGENT_BRIDGE_SECRET_TOKEN || process.env.MCP_SECRET_TOKEN;
  
  if (!secret) {
    throw new Error("Server configuration error: AGENT_BRIDGE_SECRET_TOKEN is missing. Failing closed.");
  }
  
  if (token !== secret) {
    throw new Error("Forbidden");
  }
}
