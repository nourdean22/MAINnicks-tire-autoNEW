import { ABSURDITY_CONCEPTS, AbsurdityConcept } from "./absurdityConcepts";
import { generateScoredDraft, ContentAngle, Hook, PERSONAS, SocialDraft } from "./contentManufacturing";
import { createLogger } from "../lib/logger";

const log = createLogger("services:absurdityEngine");

export function getAbsurdityConcept(service: string): AbsurdityConcept {
  const cleanService = service.toLowerCase().trim();
  const matched = ABSURDITY_CONCEPTS.filter(c => {
    const cat = c.category.toLowerCase().trim();
    return cat === cleanService || cat.includes(cleanService) || cleanService.includes(cat);
  });

  const pool = matched.length > 0 ? matched : ABSURDITY_CONCEPTS;
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx];
}

export async function generateAbsurdDraft(
  topic: string,
  service: string,
  personaKey?: string,
  contentType?: "reel" | "carousel" | "post" | "story"
): Promise<SocialDraft> {
  const concept = getAbsurdityConcept(service);
  log.info(`Selected absurdity concept for service "${service}": "${concept.title}"`);

  const angle: ContentAngle = {
    angle: `Useful-Absurdity: ${concept.title}. ${concept.concept}`,
    narrativeFranchise: "Useful Absurdity",
    entertainmentPillar: "Useful Absurdity",
    description: concept.concept
  };

  const hook: Hook = {
    hookText: concept.title,
    hookCategory: "humor",
    scoreCuriosity: 85,
    scoreEmotion: 80,
    scoreLocalRelevance: 75,
    scoreAuthority: 75,
    scoreOverall: 80
  };

  const pKey = personaKey || PERSONAS[Math.floor(Math.random() * PERSONAS.length)].key;
  const cType = contentType || "reel";

  return await generateScoredDraft(topic, angle, hook, pKey, cType, "both");
}
