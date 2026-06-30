import { makeTracedAiChat } from "../../traced-aichat";
import { SpecialistInput, SpecialistResponse, extractHandBack } from "../types";
import { getMarketingPersonas } from "../marketing/loader";
import { personaToSystemPrompt } from "../../personas";

const aiChat = makeTracedAiChat("specialist-marketing-director", "brain");

/**
 * Specialist sub-agent for coordinating marketing campaigns and delegating to 
 * specialized marketing personas.
 */
export async function runMarketingDirector(
  input: SpecialistInput
): Promise<SpecialistResponse> {
  const latestMessage = input.messages[input.messages.length - 1];
  const userText = latestMessage?.content || "";

  // 1. Domain Check / Hand-back
  const isMarketingQuery = /marketing|seo|aeo|copywriting|campaign|social|ad|newsletter|funnel|brand|audience|traffic|engagement/i.test(userText);
  if (!isMarketingQuery && input.messages.length > 1) {
    return {
      content: "",
      handBack: true,
      reason: "User message has drifted away from marketing topics."
    };
  }

  // 2. Select the best marketing persona
  const personas = getMarketingPersonas();
  const personaKeys = Object.keys(personas);

  const selectorPrompt = `You are a Marketing Director. Analyze the user request and select the single most appropriate specialist persona from the list below to handle the task.

Available specialist keys:
${personaKeys.map(k => `- "${k}": ${personas[k].role} — ${personas[k].goal}`).join("\n")}

Respond with ONLY the key of the selected specialist, exactly as shown in quotes, no quotes, no markdown, no other text (e.g., "marketing-email-strategist"). If none apply, respond "general".`;

  const selectionResult = await aiChat([
    { role: "system", content: selectorPrompt },
    { role: "user", content: `Select persona for: "${userText}"` }
  ], "classify");

  const selectedKey = selectionResult.content.trim().replace(/^["']|["']$/g, "");
  const selectedPersona = personas[selectedKey] || null;

  if (!selectedPersona) {
    return {
      content: "I am ready to coordinate your marketing strategy. Let me know if we should focus on email sequences, SEO, AEO, social media, or growth hacking."
    };
  }

  // 3. Delegate to the chosen specialist persona
  const systemPrompt = `${personaToSystemPrompt(selectedPersona)}

INSTRUCTIONS FOR LIVE CHAT:
- You are acting as the specialized marketing agent.
- Answer the user's request with expert authority, specific numbers, and concrete actionable workflows.
- If the user switches topics to something unrelated to marketing or your role, append "[[HANDBACK: out of domain]]" on a line by itself.`;

  const chatMessages = input.messages.slice(-6).map(m => ({ 
    role: m.role as "system" | "user" | "assistant", 
    content: m.content 
  }));

  // Ensure system prompt is at the top
  chatMessages.unshift({ role: "system", content: systemPrompt });

  const chatResult = await aiChat(chatMessages, "reason");

  const handBackResult = extractHandBack(chatResult.content);

  return {
    content: handBackResult.content,
    handBack: handBackResult.handBack,
    reason: handBackResult.reason,
    provider: chatResult.provider
  };
}
