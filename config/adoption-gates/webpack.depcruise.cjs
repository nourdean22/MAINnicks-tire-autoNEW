/**
 * Resolution shim for dependency-cruiser ONLY - never used by any build.
 * Carries the "@/" alias so boundary rules match resolved paths. This lives
 * in a webpack-config shape because dependency-cruiser 18's schema rejects
 * `alias` both at options level and inside enhancedResolveOptions, and the
 * tsConfig route trips TS18003 on apps/statenour/tsconfig.json in a fresh
 * CI checkout (its include lists .next/types paths that only exist after a
 * build) - all three probed 2026-08-27. __dirname keeps it cwd-independent.
 */
const path = require("path");

module.exports = {
  resolve: {
    alias: {
      "@": path.join(__dirname, "..", "..", "apps", "statenour"),
    },
  },
};
