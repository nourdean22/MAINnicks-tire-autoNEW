import { EnhancedPromptOutput } from "./schema";

export type PromptExampleSpecimen = {
  input: string;
  isTargetedEdit: boolean;
  isNicksTire: boolean;
  expectedOutput: EnhancedPromptOutput;
};

export const PROMPT_EXAMPLES: PromptExampleSpecimen[] = [
  {
    input: "make me a login page",
    isTargetedEdit: false,
    isNicksTire: false,
    expectedOutput: {
      oneLinePurpose: "A clean, trustworthy login page with a centered form and subtle branding.",
      designSystem: {
        platform: "Web, Desktop-first",
        theme: "Light, minimal, professional",
        background: "Clean White (#ffffff)",
        surface: "Soft Gray (#f9fafb) for form card",
        primaryAccent: "Deep Blue (#2563eb) for submit button and links",
        textPrimary: "Near Black (#111827) for headings",
        textSecondary: "Medium Gray (#6b7280) for labels",
        typography: "Clean geometric sans-serif (Inter)",
        buttons: "Subtly rounded (8px), full-width on form"
      },
      pageStructure: [
        { section: "Header", description: "Minimal logo, centered" },
        { section: "Login Card", description: "Centered form card with email and password input fields, plus 'Forgot password?' link" },
        { section: "Submit Button", description: "Primary blue 'Sign In' button, full-width with a subtle hover scaling effect" },
        { section: "Footer", description: "Simple textual 'Don't have an account? Sign up' link" }
      ],
      interactionNotes: [
        "Primary action button scales up 1.02x on hover with 150ms transition",
        "Form labels slide up or fade on focus state"
      ],
      constraints: [
        "Do not include illustration panels to keep focus on input speed.",
        "Keep layout simple and responsive for screens down to 320px width."
      ],
      finalPromptMarkdown: "A clean, trustworthy login page...\n\n**DESIGN SYSTEM (REQUIRED):**\n- Platform: Web...\n- Theme: Light..."
    }
  },
  {
    input: "add a search bar",
    isTargetedEdit: true,
    isNicksTire: false,
    expectedOutput: {
      oneLinePurpose: "Add a search bar to the header navigation.",
      designSystem: {
        platform: "Web, Desktop-first",
        theme: "Light, minimal",
        background: "Clean White (#ffffff)",
        surface: "Subtle gray background (#f3f4f6) for search container",
        primaryAccent: "Blue Accent (#3b82f6) on active focus border",
        textPrimary: "Slate Gray (#0f172a)",
        textSecondary: "Light gray (#9ca3af) for placeholder text",
        typography: "System default sans-serif",
        buttons: "No button required, submit on Enter key press"
      },
      pageStructure: [
        { section: "Header Navigation Integration", description: "Add a search bar to the header navigation, positioned on the right side before the user profile avatar." }
      ],
      interactionNotes: [
        "Search container width transitions from 240px to 320px on active focus",
        "Subtle drop shadow appears under search input when focused"
      ],
      constraints: [
        "Preserve all existing header elements and styling properties.",
        "Make ONLY this change to the navigation bar layout."
      ],
      finalPromptMarkdown: "Add a search bar to the header navigation.\n\n- Position: Right side...\n- Constraints: Preserve existing elements..."
    }
  }
];
