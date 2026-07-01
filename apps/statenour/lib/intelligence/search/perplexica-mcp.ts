import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { SearchResult, ExternalSearchProvider } from "./types";
import { logger } from "@/lib/logger";

const log = logger.withSurface("intelligence/search/perplexica");

export class PerplexicaSearchProvider implements ExternalSearchProvider {
  private client: Client | null = null;
  private transport: SSEClientTransport | null = null;
  private url: string;

  constructor() {
    // Expected to be an SSE endpoint, e.g., http://127.0.0.1:3002/sse
    this.url = process.env.PERPLEXICA_MCP_URL || "";
  }

  private async getClient(): Promise<Client> {
    if (this.client) return this.client;
    if (!this.url) {
      throw new Error("PERPLEXICA_MCP_URL is not configured. Set it to the sidecar SSE endpoint.");
    }

    try {
      this.transport = new SSEClientTransport(new URL(this.url));
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
