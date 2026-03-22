/**
 * External API caller (replaces Manus Forge WebDevService/CallApi proxy)
 * For YouTube search, etc. — calls APIs directly with appropriate API keys.
 */

export type DataApiCallOptions = {
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  pathParams?: Record<string, unknown>;
  formData?: Record<string, unknown>;
};

export async function callDataApi(
  apiId: string,
  options: DataApiCallOptions = {}
): Promise<unknown> {
  // Route to the correct direct API based on apiId
  if (apiId.startsWith("Youtube/")) {
    return callYouTubeApi(apiId, options);
  }

  console.warn(`[DataApi] Unsupported API: ${apiId}. This was previously proxied through Manus Forge.`);
  throw new Error(`Data API "${apiId}" is not supported outside Manus. Implement a direct integration.`);
}

async function callYouTubeApi(
  apiId: string,
  options: DataApiCallOptions
): Promise<unknown> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY is not configured");
  }

  const endpoint = apiId.replace("Youtube/", "");
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);

  url.searchParams.set("key", apiKey);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const response = await fetch(url.toString());

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `YouTube API request failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
    );
  }

  return response.json();
}
