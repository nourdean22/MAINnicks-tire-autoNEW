import React from "react";
import { describe, it, expect } from "vitest";
import {
  renderToPng,
  validateEvidence,
  type RenderOptions,
} from "../index";
import { ReviewCard } from "../templates/review-card";
import { ServiceWarning } from "../templates/service-warning";
import { GooglePost } from "../templates/google-post";

describe("Social Assets — Evidence Validation Guardrails", () => {
  it("should reject assets missing sourceIds", () => {
    const options: RenderOptions = {
      width: 1080,
      height: 1080,
      templateName: "review-card",
      metadata: {
        sourceIds: [],
        evidenceSummary: "Real brake inspection proof",
      },
    };
    expect(() => validateEvidence(options)).toThrow(/all generated assets must contain sourceIds/i);
  });

  it("should reject fake or placeholder author names", () => {
    const options: RenderOptions = {
      width: 1080,
      height: 1080,
      templateName: "review-card",
      metadata: {
        sourceIds: ["rev_123"],
        evidenceSummary: "Real customer brake repair testimonial",
        authorName: "John Doe",
        testimonialText: "They did an excellent job on my brakes!",
      },
    };
    expect(() => validateEvidence(options)).toThrow(/fake or placeholder author name detected/i);
  });

  it("should reject placeholder text/lorem ipsum in testimonials", () => {
    const options: RenderOptions = {
      width: 1080,
      height: 1080,
      templateName: "review-card",
      metadata: {
        sourceIds: ["rev_123"],
        evidenceSummary: "Real customer brake repair testimonial",
        authorName: "Nour Dean",
        testimonialText: "Lorem ipsum dolor sit amet...",
      },
    };
    expect(() => validateEvidence(options)).toThrow(/contains banned placeholder text/i);
  });

  it("should pass validation for clean, grounded evidence inputs", () => {
    const options: RenderOptions = {
      width: 1080,
      height: 1080,
      templateName: "review-card",
      metadata: {
        sourceIds: ["rev_987"],
        evidenceSummary: "Verified brake repair testimonial",
        authorName: "Marcus Vance",
        testimonialText: "Great pricing and fast service. Brake pads replaced in 30 minutes.",
      },
    };
    expect(() => validateEvidence(options)).not.toThrow();
  });
});

describe("Social Assets — Rendering Engine Pipeline", () => {
  it("should render a ReviewCard to a PNG buffer with correct metadata sidecar", async () => {
    const options: RenderOptions = {
      width: 1080,
      height: 1080,
      templateName: "review-card",
      metadata: {
        sourceIds: ["rev_987"],
        evidenceSummary: "Verified brake repair testimonial",
        authorName: "Marcus Vance",
        testimonialText: "Great pricing and fast service. Brake pads replaced in 30 minutes.",
      },
    };

    const element = (
      <ReviewCard
        author={options.metadata.authorName!}
        text={options.metadata.testimonialText!}
        rating={5}
        date="2 days ago"
        source="Google Reviews"
      />
    );

    const result = await renderToPng(element, options);
    expect(result.png).toBeInstanceOf(Buffer);
    expect(result.png.length).toBeGreaterThan(0);
    expect(result.metadata.templateName).toBe("review-card");
    expect(result.metadata.contentHash).toBeTypeOf("string");
    expect(result.metadata.contentHash.length).toBe(64); // SHA-256 length
  });

  it("should render a ServiceWarning to a PNG buffer with custom critical colors", async () => {
    const options: RenderOptions = {
      width: 1080,
      height: 1080,
      templateName: "service-warning",
      metadata: {
        sourceIds: ["inv_432"],
        evidenceSummary: "Cleveland road diagnostics and winter pothole alerts",
      },
    };

    const element = (
      <ServiceWarning
        title="Brake Squeal Advisory"
        subtitle="3 signs your brake pads need immediate inspection"
        items={[
          "Squealing or metallic scraping noise when braking",
          "Brake pedal feels soft or spongy when pressed",
          "Vehicle pulls to one side during stopping",
        ]}
        criticalLevel="high"
      />
    );

    const result = await renderToPng(element, options);
    expect(result.png).toBeInstanceOf(Buffer);
    expect(result.png.length).toBeGreaterThan(0);
    expect(result.metadata.templateName).toBe("service-warning");
  });

  it("should render a GooglePost landscape promo graphic", async () => {
    const options: RenderOptions = {
      width: 1200,
      height: 900,
      templateName: "google-post",
      metadata: {
        sourceIds: ["promo_99"],
        evidenceSummary: "Standard winter tire discount promo campaign",
      },
    };

    const element = (
      <GooglePost
        badge="Special Offer"
        title="$100 Off Winter Tires"
        details="Get $100 off when you purchase a set of 4 winter tires with professional installation. Limited availability."
        promoCode="WINTER100"
        expiry="Expires Dec 31, 2026"
      />
    );

    const result = await renderToPng(element, options);
    expect(result.png).toBeInstanceOf(Buffer);
    expect(result.png.length).toBeGreaterThan(0);
    expect(result.metadata.templateName).toBe("google-post");
    expect(result.metadata.dimensions).toEqual({ width: 1200, height: 900 });
  });
});
