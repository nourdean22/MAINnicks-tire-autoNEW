import * as fs from "fs";
import * as path from "path";

export type DesignContext = {
  source: "design_md" | "app_brand" | "nickstire_brand" | "fallback";
  platformDefault: "web" | "mobile";
  colorTokens: Array<{ name: string; hex: string; role: string }>;
  typography: string[];
  componentRules: string[];
  bannedPatterns: string[];
  notes: string[];
};

export const NICKSTIRE_BRAND_CONTEXT: DesignContext = {
  source: "nickstire_brand",
  platformDefault: "web",
  colorTokens: [
    { name: "Deep Charcoal", hex: "#121212", role: "Page background" },
    { name: "Yellow Gold Accent", hex: "#e5a93b", role: "Primary buttons, callouts, and highlights" },
    { name: "Clean White", hex: "#ffffff", role: "Primary headings and body copy" },
    { name: "Muted Amber", hex: "#b5872d", role: "Secondary labels and ratings highlights" }
  ],
  typography: [
    "Bold uppercase typography for Cleveland-style service headlines",
    "Heavyweight sans-serif titles matching the raw shop look"
  ],
  componentRules: [
    "Vibrant trust indicators (ratings, warranty blocks)",
    "Cleveland trust indicators (established date, local presence)",
    "Interactive pricing boxes for tires and auto services",
    "Simple, direct schedule-appointment buttons"
  ],
  bannedPatterns: [
    "Banish stock-photo corporate designs",
    "Banish generic abstract SaaS style dashboard indicators"
  ],
  notes: [
    "Should feel direct, Cleveland-local, authentic, and trust-based",
    "Real-shop atmosphere: practical, no-nonsense grit"
  ]
};

export const GENERIC_FALLBACK_CONTEXT: DesignContext = {
  source: "fallback",
  platformDefault: "web",
  colorTokens: [
    { name: "Pure White", hex: "#ffffff", role: "Page background" },
    { name: "Indigo Blue", hex: "#4f46e5", role: "Primary interactive elements" },
    { name: "Slate Dark", hex: "#0f172a", role: "Primary text color" },
    { name: "Cool Gray", hex: "#64748b", role: "Secondary helper text" }
  ],
  typography: [
    "Clean, geometric sans-serif (such as Inter or Outfit)",
    "Subtle modern weightings for structural contrast"
  ],
  componentRules: [
    "Logical components with modern spacing constraints",
    "Pill-shaped input selectors and clean button surfaces"
  ],
  bannedPatterns: [
    "Avoid unaligned padding elements",
    "Avoid over-saturated gradients"
  ],
  notes: [
    "Clean, minimalist layout with generous whitespace"
  ]
};

export function resolveDesignContext(
  projectPath?: string | null,
  appName?: string | null
): DesignContext {
  if (projectPath) {
    const designMdPath = path.join(projectPath, "DESIGN.md");
    if (fs.existsSync(designMdPath)) {
      try {
        const content = fs.readFileSync(designMdPath, "utf-8");
        return {
          source: "design_md",
          platformDefault: "web",
          colorTokens: extractColorsFromMarkdown(content),
          typography: ["Custom typography from DESIGN.md"],
          componentRules: ["Custom component rules from DESIGN.md"],
          bannedPatterns: [],
          notes: ["Derived from local DESIGN.md context file"]
        };
      } catch {
        // Fallback on read errors
      }
    }
  }

  if (
    appName === "nickstire" ||
    appName === "statenour" ||
    (projectPath && (projectPath.includes("nickstire") || projectPath.includes("statenour")))
  ) {
    return NICKSTIRE_BRAND_CONTEXT;
  }

  return GENERIC_FALLBACK_CONTEXT;
}

function extractColorsFromMarkdown(content: string): Array<{ name: string; hex: string; role: string }> {
  const colors: Array<{ name: string; hex: string; role: string }> = [];
  const colorRegex = /(?:([a-zA-Z\s]+)\s+)?(#(?:[0-9a-fA-F]{3}){1,2})\b(?:\s+for\s+([a-zA-Z\s,]+))?/g;
  let match;
  while ((match = colorRegex.exec(content)) !== null) {
    colors.push({
      name: match[1]?.trim() || "Color Accent",
      hex: match[2],
      role: match[3]?.trim() || "branding and UI highlights"
    });
  }
  return colors.length > 0 ? colors : [
    { name: "Brand Primary", hex: "#3b82f6", role: "General highlights" }
  ];
}
