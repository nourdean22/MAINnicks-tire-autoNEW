import { createLogger } from "../lib/logger";

const log = createLogger("services:dkClient");

/**
 * Mock D&K stock lookup service client.
 * Strictly local, sandboxed, and mock-only. Bypasses actual network requests to live D&K gateways.
 */
export class DkClient {
  /**
   * Determine simulated stock status based on D&K keys presence and part number.
   * If credentials are empty, degrades gracefully to returning 'call_for_availability'.
   */
  static getStockStatus(partNumber: string): "in_stock" | "call_for_availability" {
    const username = process.env.GATEWAY_TIRE_USERNAME;
    const password = process.env.GATEWAY_TIRE_PASSWORD;
    const shipTo = process.env.GATEWAY_TIRE_SHIP_TO;

    if (!username || !password || !shipTo) {
      log.warn("[dkClient] missing D&K environment keys, defaulting to call_for_availability");
      return "call_for_availability";
    }

    try {
      log.info(`[dkClient] performing mock stock lookup for part: ${partNumber}`);
      if (!partNumber) {
        return "in_stock";
      }
      
      // Pure local determinism for mock behavior
      const charCodeSum = partNumber.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
      return charCodeSum % 3 === 0 ? "call_for_availability" : "in_stock";
    } catch (err) {
      log.error("[dkClient] mock stock check error, returning fallback", err);
      return "call_for_availability";
    }
  }
}
