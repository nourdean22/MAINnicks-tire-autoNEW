import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import type { ReactNode } from "react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load local bundled fonts
const fontRegularPath = path.join(__dirname, "fonts", "Inter-Regular.ttf");
const fontBoldPath = path.join(__dirname, "fonts", "Outfit-Bold.ttf");

if (!fs.existsSync(fontRegularPath) || !fs.existsSync(fontBoldPath)) {
  throw new Error(`Fonts missing from bundle directory: ${path.join(__dirname, "fonts")}`);
}

const fontRegular = fs.readFileSync(fontRegularPath);
const fontBold = fs.readFileSync(fontBoldPath);

export interface RenderOptions {
  width: number;
  height: number;
  templateName: string;
  metadata: {
    sourceIds: string[];
    evidenceSummary: string;
    authorName?: string;
    testimonialText?: string;
  };
}

export interface AssetMetadata {
  templateName: string;
  sourceIds: string[];
  evidenceSummary: string;
  generatedAt: string;
  dimensions: { width: number; height: number };
  contentHash: string;
}

/**
 * Validates the metadata to prevent fake testimonials and placeholders.
 */
export function validateEvidence(options: RenderOptions): void {
  const { metadata } = options;

  if (!metadata.sourceIds || metadata.sourceIds.length === 0) {
    throw new Error(
      `[Validation Failed] All generated assets must contain sourceIds. Direct marketing claims without tracking identifiers are forbidden.`
    );
  }

  if (!metadata.evidenceSummary || metadata.evidenceSummary.trim().length < 5) {
    throw new Error(
      `[Validation Failed] A descriptive evidence summary is required to ground the asset.`
    );
  }

  // Author Name validation (No fake names)
  if (metadata.authorName) {
    const name = metadata.authorName.trim().toLowerCase();
    const bannedPatterns = [/john\s*doe/i, /test\s*user/i, /placeholder/i, /mock/i, /^xyz$/i, /lorem/i];
    for (const pattern of bannedPatterns) {
      if (pattern.test(name)) {
        throw new Error(
          `[Validation Failed] Fake or placeholder author name detected: "${metadata.authorName}". Assets must represent real customer testimonials.`
        );
      }
    }
  }

  // Testimonial Text validation (No placeholder text)
  if (metadata.testimonialText) {
    const text = metadata.testimonialText.trim().toLowerCase();
    const bannedPatterns = [/lorem\s*ipsum/i, /placeholder/i, /mock\s*testimonial/i, /^test$/i];
    for (const pattern of bannedPatterns) {
      if (pattern.test(text)) {
        throw new Error(
          `[Validation Failed] Testimonial contains banned placeholder text or lorem ipsum patterns.`
        );
      }
    }
  }
}

/**
 * Converts a React element tree into a high-density PNG buffer.
 */
export async function renderToPng(
  element: ReactNode,
  options: RenderOptions
): Promise<{ png: Buffer; metadata: AssetMetadata }> {
  // 1. Guardrail validation
  validateEvidence(options);

  // 2. Satori JSX -> SVG conversion
  const svg = await satori(element, {
    width: options.width,
    height: options.height,
    fonts: [
      {
        name: "Inter",
        data: fontRegular,
        weight: 400,
        style: "normal",
      },
      {
        name: "Outfit",
        data: fontBold,
        weight: 700,
        style: "normal",
      },
    ],
  });

  // 3. Resvg SVG -> PNG conversion
  const resvg = new Resvg(svg, {
    fitTo: {
      mode: "width",
      value: options.width,
    },
  });

  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();

  // 4. Compute content hash and package sidecar metadata
  const sha256 = crypto.createHash("sha256");
  sha256.update(pngBuffer);
  const contentHash = sha256.digest("hex");

  const assetMetadata: AssetMetadata = {
    templateName: options.templateName,
    sourceIds: options.metadata.sourceIds,
    evidenceSummary: options.metadata.evidenceSummary,
    generatedAt: new Date().toISOString(),
    dimensions: { width: options.width, height: options.height },
    contentHash,
  };

  return {
    png: pngBuffer,
    metadata: assetMetadata,
  };
}
