import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { logger } from "@/lib/logger";

const log = logger.withSurface("intelligence/search/notebooklm");

export interface NotebookLMResult {
  tool: string;
  results?: unknown;
  error?: string;
}

export type NotebookAlias = "statenour-intel" | "competitor-research" | "financial-models";

const NOTEBOOK_ALIASES: Record<NotebookAlias, string | undefined> = {
  "statenour-intel": process.env.NOTEBOOKLM_ID_INTEL,
  "competitor-research": process.env.NOTEBOOKLM_ID_COMPETITOR,
  "financial-models": process.env.NOTEBOOKLM_ID_FINANCE,
};

function resolveNotebookId(alias: NotebookAlias): string {
  const notebookId = NOTEBOOK_ALIASES[alias];
  if (!notebookId) {
    throw new Error(
      `NotebookLM alias "${alias}" is not configured. Set ${
        alias === "statenour-intel"
          ? "NOTEBOOKLM_ID_INTEL"
          : alias === "competitor-research"
            ? "NOTEBOOKLM_ID_COMPETITOR"
            : "NOTEBOOKLM_ID_FINANCE"
      } on the Statenour service.`,
    );
  }
  return notebookId;
}

export class NotebookLMProvider {
  private client: Client | null = null;
  private transport: SSEClientTransport | null = null;
  private readonly url: string;

  constructor() {
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
        },
      );

      const connectPromise = this.client.connect(this.transport);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout connecting to NotebookLM MCP")), 5000),
      );

      await Promise.race([connectPromise, timeoutPromise]);
      return this.client;
    } catch (error) {
      this.client = null;
      this.transport = null;
      throw error;
    }
  }

  async call(
    toolName: string,
    args?: Record<string, unknown>,
    notebookAlias?: NotebookAlias,
  ): Promise<NotebookLMResult> {
    const startTime = Date.now();
    try {
      const client = await this.getClient();
      const finalArgs = { ...(args || {}) };

      if (notebookAlias) {
        finalArgs.notebook_id = resolveNotebookId(notebookAlias);
      }

      const result = await client.callTool({
        name: toolName,
        arguments: finalArgs,
      });

      log.info("notebooklm_tool_success", {
        toolName,
        notebookAlias,
        ms: Date.now() - startTime,
      });
      return {
        tool: toolName,
        results: result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error during NotebookLM tool call.";
      log.error("notebooklm_tool_error", {
        toolName,
        notebookAlias,
        error: message,
        ms: Date.now() - startTime,
      });
      return {
        tool: toolName,
        error: message,
      };
    }
  }

  /**
   * Confirms only that the configured MCP sidecar accepts a connection.
   * It does not prove a specific notebook alias exists or that Google auth is fresh.
   */
  async health(): Promise<{
    status: "connected" | "disconnected" | "error";
    message?: string;
  }> {
    try {
      if (!this.url) {
        return { status: "disconnected", message: "NOTEBOOKLM_MCP_URL not set" };
      }
      await this.getClient();
      return { status: "connected", message: "NotebookLM MCP sidecar connected" };
    } catch (error) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : "Connection failed",
      };
    }
  }
}

export const notebookLMProvider = new NotebookLMProvider();
