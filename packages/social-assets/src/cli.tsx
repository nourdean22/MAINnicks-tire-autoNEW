import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToPng, type RenderOptions } from "./index";
import { ReviewCard } from "./templates/review-card";
import { ServiceWarning } from "./templates/service-warning";
import { GooglePost } from "./templates/google-post";

function parseArgs() {
  const args = process.argv.slice(2);
  const flags: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const val = args[i + 1];
      if (val && !val.startsWith("--")) {
        flags[key] = val;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }

  return flags;
}

async function main() {
  const flags = parseArgs();

  const template = flags.template;
  if (!template) {
    console.error("Error: --template <name> is required.");
    console.log("Available templates: review-card, service-warning, google-post");
    process.exit(1);
  }

  const width = parseInt(flags.width || "1080", 10);
  const height = parseInt(flags.height || "1080", 10);
  const outPath = flags.out || "output.png";

  let element: React.ReactElement;
  let renderOptions: RenderOptions;

  if (template === "review-card") {
    const author = flags.author || "Marcus Vance";
    const text = flags.text || "Default review text goes here.";
    const rating = parseInt(flags.rating || "5", 10);
    const date = flags.date || "Verified Review";
    const source = flags.source || "Google Business Profile";

    renderOptions = {
      width,
      height,
      templateName: "review-card",
      metadata: {
        sourceIds: ["cli_manual_gen"],
        evidenceSummary: `CLI generated review card for ${author}`,
        authorName: author,
        testimonialText: text,
      },
    };

    element = (
      <ReviewCard
        author={author}
        text={text}
        rating={rating}
        date={date}
        source={source}
      />
    );
  } else if (template === "service-warning") {
    const title = flags.title || "Safety Warning";
    const subtitle = flags.subtitle || "Inspect your vehicle regularly";
    const itemsRaw = flags.items || "Squealing noise,Spongy pedal,Pulls to side";
    const items = itemsRaw.split(",").map((i) => i.trim());
    const critical = (flags.critical || "medium") as "low" | "medium" | "high";
    const cta = flags.cta || "Book Inspections • Nick's Tire & Auto";

    renderOptions = {
      width,
      height,
      templateName: "service-warning",
      metadata: {
        sourceIds: ["cli_manual_gen"],
        evidenceSummary: `CLI generated service warning: ${title}`,
      },
    };

    element = (
      <ServiceWarning
        title={title}
        subtitle={subtitle}
        items={items}
        criticalLevel={critical}
        cta={cta}
      />
    );
  } else if (template === "google-post") {
    const badge = flags.badge || "Offer";
    const title = flags.title || "$100 Off Tires";
    const details = flags.details || "Details about this special local shop promotion.";
    const promoCode = flags.promoCode || "TIRE100";
    const expiry = flags.expiry || "Expires soon";

    // Google post defaults to landscape 1200x900
    const gbpWidth = parseInt(flags.width || "1200", 10);
    const gbpHeight = parseInt(flags.height || "900", 10);

    renderOptions = {
      width: gbpWidth,
      height: gbpHeight,
      templateName: "google-post",
      metadata: {
        sourceIds: ["cli_manual_gen"],
        evidenceSummary: `CLI generated google post: ${title}`,
      },
    };

    element = (
      <GooglePost
        badge={badge}
        title={title}
        details={details}
        promoCode={promoCode}
        expiry={expiry}
      />
    );
  } else {
    console.error(`Error: Unknown template type "${template}"`);
    process.exit(1);
  }

  try {
    console.log(`[CLI] Rendering template "${template}" to ${outPath}...`);
    const result = await renderToPng(element, renderOptions);

    // Save PNG file
    const absoluteOutPath = path.resolve(outPath);
    fs.writeFileSync(absoluteOutPath, result.png);
    console.log(`[CLI] PNG file written successfully to: ${absoluteOutPath}`);

    // Save metadata sidecar
    const metadataPath = `${absoluteOutPath}.metadata.json`;
    fs.writeFileSync(metadataPath, JSON.stringify(result.metadata, null, 2), "utf8");
    console.log(`[CLI] Metadata sidecar written successfully to: ${metadataPath}`);
  } catch (error) {
    console.error("[CLI] Generation failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
