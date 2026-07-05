import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SearchResult, ExternalSearchProvider } from "./types";
import { logger } from "@/lib/logger";

const log = logger.withSurface("intelligence/search/perplexica");

export class PerplexicaSearchProvider implements ExternalSearchProvider {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private url: string;

  constructor() {
    // 2026-07-05 · MUST use the Streamable-HTTP endpoint (/mcp), NOT SSE
    // (/sse). The perplexica-mcp sidecar deploys via `perplexica-mcp http`
    // (apps/perplexica-mcp/Dockerfile) which serves ONLY /mcp; it can't be
    // redeployed in sse mode because the Railway service has an
    // IMAGE-type build.builder config that blocks rebuilds. The old
    // SSEClientTransport hit PERPLEXICA_MCP_URL=…:3002/sse and 404'd on
    // every call (the sidecar never returned a result since #464).
    // Aligning the CLIENT to the running http server is the fix.
    this.url = process.env.PERPLEXICA_MCP_URL || "";
  }

  /**
   * The server serves Streamable-HTTP at /mcp. PERPLEXICA_MCP_URL may still
   * carry a legacy /sse path — derive the /mcp endpoint from its origin so
   * this works regardless of the configured path (no env change required).
   */
  private mcpEndpoint(): URL {
    return new URL("/mcp", this.url);
  }

  private async getClient(): Promise<Client> {
    if (this.client) return this.client;
    if (!this.url) {
      throw new Error("PERPLEXICA_MCP_URL is not configured. Set it to the sidecar host (…:3002).");
    }

    try {
      this.transport = new StreamableHTTPClientTransport(this.mcpEndpoint());
      this.client = new Client(
        {
          name: "statenour-search-client",
          version: "1.0.0",
        },
        {
          capabilities: {},
        }
      );

      // We add a timeout for the initial connection
      const connectPromise = this.client.connect(this.transport);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Timeout connecting to Perplexica MCP")), 5000)
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

  async search(query: string, options?: Record<string, unknown>): Promise<SearchResult> {
    const startTime = Date.now();
    try {
      const client = await this.getClient();
      
      const result = await client.callTool({
        name: "searchPerplexica",
        arguments: {
          query,
          ...options,
        }
      });
      
      log.info("perplexica_search_success", { ms: Date.now() - startTime });
      return {
        query,
        results: result,
      };
    } catch (error) {
      log.error("perplexica_search_error", { 
        error: error instanceof Error ? error.message : String(error),
        ms: Date.now() - startTime 
      });
      return {
        query,
        error: error instanceof Error ? error.message : "Unknown error during search.",
      };
    }
  }
}

export const perplexicaProvider = new PerplexicaSearchProvider();
