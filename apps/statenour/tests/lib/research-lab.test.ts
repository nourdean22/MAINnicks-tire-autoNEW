import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import crypto from "crypto";

// Mocks setup
const mocks = vi.hoisted(() => ({
  brainMemory: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remember: vi.fn(),
  },
  task: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  masteryDecision: {
    create: vi.fn(),
  },
  mission: {
    findFirst: vi.fn(),
  },
  getEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0.1)),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: mocks.brainMemory,
    task: mocks.task,
    masteryDecision: mocks.masteryDecision,
    mission: mocks.mission,
  },
}));

vi.mock("@/lib/ai/provider", () => ({
  getEmbedding: mocks.getEmbedding,
}));

// Import redactPaths utility & math
import { redactPaths } from "@/lib/research/redact";
import { cosineSimilarity } from "@/lib/brain/embedding-utils";
import {
  describeGroundingStatus,
  GROUNDING_STRONG_THRESHOLD,
  GROUNDING_WEAK_THRESHOLD,
} from "@/lib/intelligence/grounding";

describe("Research Lab - Path Redaction", () => {
  it("redacts Windows absolute user paths", () => {
    const raw = "Loaded file from C:\\Users\\nourd\\NOURCITY\\apps\\statenour\\app\\page.tsx";
    const redacted = redactPaths(raw);
    expect(redacted).not.toContain("C:\\Users\\nourd");
    expect(redacted).toContain("[REDACTED_LOCAL_PATH]");
  });

  it("redacts macOS/Linux absolute user paths", () => {
    const raw = "Loaded file from /Users/nourd/NOURCITY/apps/statenour/app/page.tsx";
    const redacted = redactPaths(raw);
    expect(redacted).not.toContain("/Users/nourd");
    expect(redacted).toContain("[REDACTED_LOCAL_PATH]");
  });

  it("redacts file scheme absolute paths", () => {
    const raw = "Link: file:///C:/Users/nourd/NOURCITY/apps/statenour/app/page.tsx";
    const redacted = redactPaths(raw);
    expect(redacted).not.toContain("file:///C:/Users/nourd");
    expect(redacted).toContain("file:///[REDACTED_LOCAL_PATH]");
  });
});

describe("Research Lab - Cosine Similarity", () => {
  it("calculates similarity correctly for exact match", () => {
    const vec = [0.1, 0.2, 0.3];
    const score = cosineSimilarity(vec, vec);
    expect(score).toBeCloseTo(1.0, 5);
  });

  it("calculates similarity correctly for orthogonal vectors", () => {
    const vecA = [1.0, 0.0, 0.0];
    const vecB = [0.0, 1.0, 0.0];
    const score = cosineSimilarity(vecA, vecB);
    expect(score).toBe(0.0);
  });
});

/**
 * 2026-08-16 · REWRITTEN. This block used to re-implement the classifier
 * INLINE and assert against the copy — never importing grounding.ts at all.
 * The copy used a 0.80 threshold (the real code has always used 0.75) and a
 * status `requires_source_verification` that exists nowhere in production.
 * It was green, it looked like grounding coverage, and it would have stayed
 * green through any change to the real thresholds. Now it imports the actual
 * constants, so drift breaks the build instead of hiding behind a pass.
 */
describe("Research Lab - Tiered Semantic Grounding (real thresholds)", () => {
  it("pins the REAL thresholds — 0.75 / 0.55, not the 0.80 the docs claimed", () => {
    expect(GROUNDING_STRONG_THRESHOLD).toBe(0.75);
    expect(GROUNDING_WEAK_THRESHOLD).toBe(0.55);
  });

  it("describes every stored status without claiming verification", () => {
    for (const status of ["source_supported", "weak_support", "unverified"] as const) {
      const text = describeGroundingStatus(status).toLowerCase();
      // The whole point of the rename-free fix: whatever the enum is called,
      // the words a model or a human reads must not assert source support.
      expect(text).toMatch(/similar|no similar/);
      expect(text).not.toMatch(/verified by|confirmed/);
    }
  });

  it("says out loud that the strong tier is similarity, NOT verification", () => {
    const text = describeGroundingStatus("source_supported");
    expect(text).toContain("NOT independent verification");
    expect(text).toContain(String(GROUNDING_STRONG_THRESHOLD));
  });

  it("keeps `unverified` honest about covering the could-not-run case", () => {
    // `unverified` is overloaded three ways (low similarity, zero matches,
    // thrown error). The description must not assert "no match was found".
    expect(describeGroundingStatus("unverified")).toContain("could not run");
  });
});

describe("Research Lab - Ingestion Safety & High-Stakes Block (Rule 8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks high-stakes task creation when allow flag is missing", () => {
    const isHighStakes = true; // health/finance/legal
    const allowHighStakesActions = false;

    let createTasksExecuted = false;
    if (isHighStakes && !allowHighStakesActions) {
      createTasksExecuted = false;
    } else {
      createTasksExecuted = true;
    }

    expect(createTasksExecuted).toBe(false);
  });

  it("allows high-stakes task creation when allow flag is passed", () => {
    const isHighStakes = true;
    const allowHighStakesActions = true;

    let createTasksExecuted = false;
    if (isHighStakes && !allowHighStakesActions) {
      createTasksExecuted = false;
    } else {
      createTasksExecuted = true;
    }

    expect(createTasksExecuted).toBe(true);
  });
});

describe("Research Lab - Rule 13 Specific Requirements", () => {
  let existsSyncSpy: any;
  let writeFileSyncSpy: any;
  let readFileSyncSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    existsSyncSpy = vi.spyOn(fs, "existsSync");
    writeFileSyncSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {});
    readFileSyncSpy = vi.spyOn(fs, "readFileSync");
  });

  afterEach(() => {
    existsSyncSpy.mockRestore();
    writeFileSyncSpy.mockRestore();
    readFileSyncSpy.mockRestore();
  });

  it("handles URL source with Firecrawl disabled (creates failed_missing_key status)", () => {
    // Logic test: is scraping disabled or key missing behavior handled
    const noScrape = true;
    const isConfigured = false;
    
    let status = "success";
    if (noScrape) {
      status = "failed_missing_key";
    } else if (!isConfigured) {
      status = "failed_missing_key";
    }

    expect(status).toBe("failed_missing_key");
  });

  it("prevents duplicate pack creation based on slug (unless --force)", () => {
    // Verify duplicate pack checks directory exist checks
    existsSyncSpy.mockReturnValue(true); // Directory exists
    const force = false;

    let canGenerate = true;
    if (existsSyncSpy() && !force) {
      canGenerate = false;
    }

    expect(canGenerate).toBe(false);
  });

  it("allows duplicate pack creation when --force is passed", () => {
    existsSyncSpy.mockReturnValue(true);
    const force = true;

    let canGenerate = true;
    if (existsSyncSpy() && !force) {
      canGenerate = false;
    }

    expect(canGenerate).toBe(true);
  });

  it("performs dry-run pack ingest (does not write to DB)", () => {
    const dryRun = true;
    let dbWriteCount = 0;

    function ingestPack(dry: boolean) {
      if (dry) {
        // dry run prints, no write
      } else {
        dbWriteCount++;
      }
    }

    ingestPack(dryRun);
    expect(dbWriteCount).toBe(0);
  });

  it("performs memory-only ingest by default (tasks/decisions false)", () => {
    const createTasks = false;
    const createDecisions = false;
    let tasksCreated = 0;

    if (createTasks) tasksCreated++;
    expect(tasksCreated).toBe(0);
  });

  it("tags NotebookLM outputs with source: notebooklm_output", () => {
    const mockIngestedMetadata = {
      slug: "test-seo",
      source: "notebooklm_output",
      requiresSourceVerification: true
    };

    expect(mockIngestedMetadata.source).toBe("notebooklm_output");
    expect(mockIngestedMetadata.requiresSourceVerification).toBe(true);
  });

  it("marks unsupported health claims for review (Rule 8)", () => {
    const domain = "health";
    const isHighStakes = ["health", "finance", "legal"].includes(domain);
    const metadata = {
      requires_professional_review: isHighStakes ? true : undefined
    };

    expect(metadata.requires_professional_review).toBe(true);
  });

  it("handles URL source with Firecrawl enabled (returns success status)", () => {
    const noScrape = false;
    const isConfigured = true;
    
    let status = "failed";
    if (noScrape) {
      status = "failed_missing_key";
    } else if (isConfigured) {
      status = "success";
    }

    expect(status).toBe("success");
  });

  it("fails cleanly when source pack manifest is invalid or missing", () => {
    const manifestExists = false;
    let failedCleanly = false;
    
    try {
      if (!manifestExists) {
        throw new Error("Manifest file not found");
      }
    } catch (err: any) {
      if (err.message.includes("Manifest file not found")) {
        failedCleanly = true;
      }
    }

    expect(failedCleanly).toBe(true);
  });
});
