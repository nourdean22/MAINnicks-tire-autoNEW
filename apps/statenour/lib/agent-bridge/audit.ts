import crypto from "crypto";

export async function auditBridgeCall(params: {
  requestId: string;
  protocol: "mcp" | "actions";
  toolName: string;
  externalName: string;
  status: "success" | "error";
  latencyMs: number;
  inputRaw: string;
  resultSize?: number;
  riskClass: string;
  errorCode?: string;
}) {
  const { inputRaw, ...rest } = params;
  
  const inputHash = crypto.createHash("sha256").update(inputRaw).digest("hex");
  
  console.log(JSON.stringify({
    event: "agent_bridge_audit",
    timestamp: new Date().toISOString(),
    inputHash,
    ...rest
  }));
}
