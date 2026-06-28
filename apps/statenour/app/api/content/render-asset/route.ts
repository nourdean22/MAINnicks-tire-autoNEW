import { NextResponse } from "next/server";
import React from "react";
import { prisma } from "@/lib/prisma";
import {
  renderToPng,
  ReviewCard,
  ServiceWarning,
  GooglePost,
} from "@nour/social-assets";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing id parameter" }, { status: 400 });
  }

  try {
    const item = await prisma.socialPublishQueue.findUnique({
      where: { id, deletedAt: null },
    });

    if (!item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    const metadata = (item.sourceMetadata ?? {}) as Record<string, any>;
    const templateName = metadata.templateName || "review-card";

    // 1080x1080 standard square post dimensions
    const width = 1080;
    const height = 1080;

    let element: React.ReactNode;
    let renderOpts: any;

    if (templateName === "review-card" || metadata.author || metadata.rating) {
      const authorName = metadata.authorName || metadata.author || "Valued Customer";
      const testimonialText = metadata.testimonialText || metadata.text || item.content;
      
      element = React.createElement(ReviewCard, {
        author: authorName,
        text: testimonialText,
        rating: metadata.rating ? Number(metadata.rating) : 5,
        date: metadata.date || "Verified Review",
        source: metadata.source || "Google Business Profile",
      });

      renderOpts = {
        width,
        height,
        templateName: "review-card",
        metadata: {
          sourceIds: metadata.sourceIds || [id],
          evidenceSummary: metadata.evidenceSummary || "Customer testimonial proof card",
          authorName,
          testimonialText,
        },
      };
    } else if (templateName === "service-warning" || metadata.warningTitle || metadata.items) {
      const title = metadata.warningTitle || metadata.title || "Service Advisory";
      const subtitle = metadata.subtitle || "Nick's Tire & Auto Professional Guidance";
      const items = Array.isArray(metadata.items) ? metadata.items : [item.content];
      const criticalLevel = metadata.criticalLevel || "medium";

      element = React.createElement(ServiceWarning, {
        title,
        subtitle,
        items,
        criticalLevel: criticalLevel as "low" | "medium" | "high",
        cta: metadata.cta || "Schedule Service • Nick's Tire & Auto",
      });

      renderOpts = {
        width,
        height,
        templateName: "service-warning",
        metadata: {
          sourceIds: metadata.sourceIds || [id],
          evidenceSummary: metadata.evidenceSummary || `Diagnostic safety warning: ${title}`,
        },
      };
    } else {
      // Default to GooglePost
      const badge = metadata.badge || "Announcement";
      const title = metadata.title || "Nick's Tire & Auto";
      const details = item.content || metadata.details || "Visit our shop for professional tire and auto repair services.";

      element = React.createElement(GooglePost, {
        badge,
        title,
        details,
        promoCode: metadata.promoCode,
        expiry: metadata.expiry,
      });

      renderOpts = {
        width,
        height,
        templateName: "google-post",
        metadata: {
          sourceIds: metadata.sourceIds || [id],
          evidenceSummary: metadata.evidenceSummary || `Shop announcement: ${title}`,
        },
      };
    }

    const { png } = await renderToPng(element as any, renderOpts);

    return new Response(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    console.error("Failed to render social asset:", err);
    return NextResponse.json(
      {
        error: "Failed to render asset",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
