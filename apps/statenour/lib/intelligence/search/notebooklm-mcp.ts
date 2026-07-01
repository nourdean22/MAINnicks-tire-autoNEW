import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { logger } from "@/lib/logger";

const log = logger.withSurface("intelligence/search/notebooklm");

export interface NotebookLMResult {
  tool: string;
  results?: unknown;
  error?: string;
}

const NOTEBOOK_ALIASES: Record<string, string> = {
  "statenour-intel": process.env.NOTEBOOKLM_ID_INTEL || "dummy-intel-id",
  "competitor-research": process.env.NOTEBOOKLM_ID_COMPETITOR || "dummy-competitor-id",
  "financial-models": process.env.NOTEBOOKLM_ID_FINANCE || "dummy-finance-id",
};

export class NotebookLMProvider {
  private client: Client | null = null;
  private transport: SSEClientTransport | null = null;
  private url: string;

  constructor() {
    // Expected to be an SSE endpoint, e.g., http://127.0.0.1:3003/sse
    this.url = process.env.NOTEBOOKLM_MCP_URL || "";
  }

  private async getClient(): Promise<Client> {
    if (this.client) return this.client;
    if (!this.url) {
      throw new Error("NOTEBOOKLM_MCP_URL is not configured. Set it to the sidecar SSE endpoint.");
    }

    try {
      this.transport = new SSEClientTransport(new URL(this.url));
      this.client = new Client(
        {
          name: "statenour-notebooklm-client",
          version: "1.0.0",
        },
        {
          capabilities: {},
        }
      );

      // We add a timeout for the initial connection
      const connectPromise = this.client.connect(this.transport);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Timeout connecting to NotebookLM MCP")), 5000)
      );
      
      await Promise.race([connectPromise, timeoutPromise]);
      return this.client;
    } catch (error) {
      // Clear client on connection error so we retry on next call
      this.client = null;
      this.transport = null;
      throw error;
    }
  }

  async call(toolName: string, args?: Record<string, unknown>, notebookAlias?: string): Promise<NotebookLMResult> {
    const startTime = Date.now();
    try {
      const client = await this.getClient();
      
      const finalArgs = { ...(args || {}) };
      if (notebookAlias && NOTEBOOK_ALIASES[notebookAlias]) {
        finalArgs.notebook_id = NOTEBOOK_ALIASES[notebookAlias];
      }
      
      const result = await client.callTool({
        name: toolName,
        arguments: finalArgs
      });
      
      log.info("notebooklm_tool_success", { toolName, ms: Date.now() - startTime });
      return {
        tool: toolName,
        results: result,
      };
    } catch (error) {
      log.error("notebooklm_tool_error", { 
        toolName,
        error: error instanceof Error ? error.message : String(error),
        ms: Date.now() - startTime 
      });
      return {
        tool: toolName,
        error: error instanceof Error ? error.message : "Unknown error during NotebookLM tool call.",
      };
    }
  }

  /**
   * Dedicated health check method.
   * Tests connection and ensures MCP is responsive.
   */
  async health(): Promise<{ status: "connected" | "disconnected" | "error"; message?: string }> {
    try {
      if (!this.url) return { status: "disconnected", message: "NOTEBOOKLM_MCP_URL not set" };
      await this.getClient();
      // Optional: if the server exposes a specific health check tool, we could call it here.
      // E.g., await this.call("get_health");
      return { status: "connected" };
    } catch (error) {
      return { 
        status: "error", 
        message: error instanceof Error ? error.message : "Connection failed" 
      };
    }
  }
}

export const notebookLMProvider = new NotebookLMProvider();
