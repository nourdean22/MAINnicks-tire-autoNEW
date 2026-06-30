import { MARKETING_REGISTRY } from "./registry";
import { Persona } from "../../personas";

/**
 * Loads the compiled marketing personas and maps them to the standard Persona interface.
 */
export function getMarketingPersonas(): Record<string, Persona> {
  const personas: Record<string, Persona> = {};
  for (const [key, p] of Object.entries(MARKETING_REGISTRY)) {
    personas[key] = {
      key: p.key,
      role: p.role,
      goal: p.goal,
      backstory: p.backstory,
      outputHint: p.outputHint,
    };
  }
  return personas;
}
