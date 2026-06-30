import { z } from "zod";

export const EnhancedPromptOutputSchema = z.object({
  oneLinePurpose: z.string().min(5),
  designSystem: z.object({
    platform: z.string(),
    theme: z.string(),
    background: z.string(),
    primaryAccent: z.string(),
    textPrimary: z.string(),
    textSecondary: z.string(),
    surface: z.string(),
    typography: z.string(),
    buttons: z.string(),
    cards: z.string().optional(),
    inputs: z.string().optional(),
  }),
  pageStructure: z.array(
    z.object({
      section: z.string(),
      description: z.string(),
    })
  ).min(2),
  interactionNotes: z.array(z.string()).optional(),
  constraints: z.array(z.string()).min(1),
  finalPromptMarkdown: z.string().min(50),
});

export type EnhancedPromptOutput = z.infer<typeof EnhancedPromptOutputSchema>;
