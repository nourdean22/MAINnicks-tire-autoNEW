/**
 * Image generation using OpenAI DALL-E API directly
 * (replaces Manus Forge ImageService proxy)
 */
import { storagePut } from "../storage";

export type GenerateImageOptions = {
  prompt: string;
  originalImages?: Array<{
    url?: string;
    b64Json?: string;
    mimeType?: string;
  }>;
};

export type GenerateImageResponse = {
  url?: string;
};

export async function generateImage(
  options: GenerateImageOptions
): Promise<GenerateImageResponse> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    const model = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: options.prompt }],
          },
        ],
        generationConfig: {
          responseModalities: ["IMAGE"],
        },
      }),
    });

    if (response.ok) {
      const data = (await response.json()) as any;
      const parts = data.candidates?.[0]?.content?.parts ?? [];
      let b64: string | undefined;
      let mimeType = "image/png";
      for (const p of parts) {
        if (p.inlineData?.data) {
          b64 = p.inlineData.data;
          if (p.inlineData.mimeType) mimeType = p.inlineData.mimeType;
          break;
        }
      }

      if (b64) {
        const buffer = Buffer.from(b64, "base64");
        const { url: storageUrl } = await storagePut(
          `generated/${Date.now()}.png`,
          buffer,
          mimeType
        );
        return { url: storageUrl };
      }
    }
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Neither GEMINI_API_KEY nor OPENAI_API_KEY is configured for image generation");
  }

  const baseUrl = process.env.OPENAI_BASE_URL?.replace(/\/$/, "") || "https://api.openai.com";

  const response = await fetch(`${baseUrl}/v1/images/generations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "dall-e-3",
      prompt: options.prompt,
      n: 1,
      size: "1024x1024",
      response_format: "b64_json",
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Image generation request failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
    );
  }

  const result = (await response.json()) as {
    data: Array<{ b64_json: string }>;
  };

  const base64Data = result.data[0].b64_json;
  const buffer = Buffer.from(base64Data, "base64");

  const { url } = await storagePut(
    `generated/${Date.now()}.png`,
    buffer,
    "image/png"
  );

  return { url };
}
