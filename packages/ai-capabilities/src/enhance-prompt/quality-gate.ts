import { EnhancedPromptOutput } from "./schema";

export type QualityGateResult = {
  score: number;
  passed: boolean;
  missingFields: string[];
  suggestedRepairs: string[];
};

export function validateEnhancedPrompt(
  output: EnhancedPromptOutput,
  isTargetedEdit: boolean = false,
  isNicksTire: boolean = false
): QualityGateResult {
  let score = 100;
  const missingFields: string[] = [];
  const suggestedRepairs: string[] = [];

  // Check 1: One line purpose
  if (!output.oneLinePurpose || output.oneLinePurpose.length < 10) {
    score -= 10;
    missingFields.push("oneLinePurpose");
    suggestedRepairs.push("Add a descriptive one-line explanation of the screen purpose.");
  }

  // Check 2: Platform specification
  if (!output.designSystem.platform) {
    score -= 15;
    missingFields.push("designSystem.platform");
    suggestedRepairs.push("Specify target platform (Web/Mobile) and viewport layout prioritization.");
  }

  // Check 3: Colors and hex codes
  const hexRegex = /#[0-9a-fA-F]{3,6}\b/;
  const colorFields = [
    { key: "background", value: output.designSystem.background },
    { key: "primaryAccent", value: output.designSystem.primaryAccent },
    { key: "textPrimary", value: output.designSystem.textPrimary },
    { key: "textSecondary", value: output.designSystem.textSecondary },
    { key: "surface", value: output.designSystem.surface }
  ];

  for (const field of colorFields) {
    if (!field.value) {
      score -= 5;
      missingFields.push(`designSystem.${field.key}`);
      suggestedRepairs.push(`Specify a token color value for ${field.key}.`);
    } else if (!hexRegex.test(field.value)) {
      score -= 20;
      suggestedRepairs.push(`Ensure the color field '${field.key}' contains a valid #hexcode.`);
    }
  }

  // Check 4: Page structure
  if (!output.pageStructure || output.pageStructure.length < 2) {
    score -= 15;
    missingFields.push("pageStructure");
    suggestedRepairs.push("Define a list of sections/components representing the page layout structure.");
  }

  // Check 5: Avoid vague descriptors like "modern" in isolation
  const textBody = JSON.stringify(output).toLowerCase();
  if (/\bmodern\b/.test(textBody)) {
    const hasSpecifics = /\b(?:clean|minimal|whitespace|shadow|rounded|charcoal|border|grid|pill)\b/i.test(textBody);
    if (!hasSpecifics) {
      score -= 10;
      suggestedRepairs.push("Avoid using 'modern' in isolation. Pair it with visual specifics (e.g. rounded corners, whitespace).");
    }
  }

  // Check 6: Targeted edits constraints
  if (isTargetedEdit) {
    const hasPreserveConstraint = output.constraints.some((c: string) =>
      c.toLowerCase().includes("preserve") || c.toLowerCase().includes("only")
    );
    if (!hasPreserveConstraint) {
      score -= 10;
      suggestedRepairs.push("Targeted edits must include a constraint instructing the engine to preserve existing layout elements.");
    }
  }

  // Check 7: Nick's Tire brand context alignment
  if (isNicksTire) {
    const hasNicksDetails = textBody.includes("cleveland") || textBody.includes("charcoal") || textBody.includes("yellow") || textBody.includes("gold");
    if (!hasNicksDetails) {
      score -= 15;
      suggestedRepairs.push("For Nick's Tire prompts, incorporate brand colors (Charcoal, Yellow/Gold) and Cleveland local trust markers.");
    }
    const hasStockPhoto = /\b(?:stock\s+photo|corporate|futuristic)\b/i.test(textBody);
    if (hasStockPhoto && !textBody.includes("ban") && !textBody.includes("avoid")) {
      score -= 15;
      suggestedRepairs.push("For Nick's Tire prompts, explicitly ban corporate stock-photos or overly sleek futuristic styles.");
    }
  }

  const passed = score >= 85;

  return {
    score: Math.max(0, score),
    passed,
    missingFields,
    suggestedRepairs
  };
}
