/**
 * Fireflies.ai — Meeting transcription and AI summaries.
 * Free tier: 800 min storage, AI summaries, speaker identification.
 * Used for: customer call transcription, vendor meetings, team huddles.
 */

interface FirefliesTranscript {
  id: string;
  title: string;
  date: string;
  duration: number;
  summary?: string;
  actionItems: string[];
  speakers: string[];
  sentences: { speaker: string; text: string; startTime: number }[];
}

function getApiKey(): string {
  const key = process.env.FIREFLIES_API_KEY;
  if (!key) throw new Error("FIREFLIES_API_KEY not configured");
  return key;
}

async function firefliesQuery(query: string, variables?: Record<string, unknown>): Promise<unknown> {
  const res = await fetch("https://api.fireflies.ai/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(15_000), // wave-181.92
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "Unknown error");
    throw new Error(`Fireflies API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  if (data.errors?.length) {
    throw new Error(`Fireflies GraphQL error: ${data.errors[0].message}`);
  }

  return data.data;
}

/**
 * Get recent meeting transcripts.
 */
export async function getRecentTranscripts(limit = 10): Promise<FirefliesTranscript[]> {
  const data = (await firefliesQuery(`
    query {
      transcripts(limit: ${limit}) {
        id
        title
        date
        duration
        summary { overview action_items }
        speakers { name }
        sentences { speaker_name text start_time }
      }
    }
  `)) as { transcripts: Array<Record<string, unknown>> };

  return (data.transcripts || []).map((t) => {
    const summary = t.summary as Record<string, unknown> | null;
    const sentences = (t.sentences as Array<Record<string, unknown>> || []).slice(0, 50);

    return {
      id: String(t.id),
      title: String(t.title || "Untitled"),
      date: String(t.date),
      duration: Number(t.duration || 0),
      summary: summary?.overview ? String(summary.overview) : undefined,
      actionItems: Array.isArray(summary?.action_items) ? summary.action_items.map(String) : [],
      speakers: Array.isArray(t.speakers) ? (t.speakers as Array<Record<string, unknown>>).map((s) => String(s.name)) : [],
      sentences: sentences.map((s) => ({
        speaker: String(s.speaker_name || "Unknown"),
        text: String(s.text || ""),
        startTime: Number(s.start_time || 0),
      })),
    };
  });
}

/**
 * Get a specific transcript by ID.
 */
export async function getTranscript(transcriptId: string): Promise<FirefliesTranscript | null> {
  const data = (await firefliesQuery(`
    query($id: String!) {
      transcript(id: $id) {
        id
        title
        date
        duration
        summary { overview action_items }
        speakers { name }
        sentences { speaker_name text start_time }
      }
    }
  `, { id: transcriptId })) as { transcript: Record<string, unknown> | null };

  if (!data.transcript) return null;
  const t = data.transcript;
  const summary = t.summary as Record<string, unknown> | null;

  return {
    id: String(t.id),
    title: String(t.title || "Untitled"),
    date: String(t.date),
    duration: Number(t.duration || 0),
    summary: summary?.overview ? String(summary.overview) : undefined,
    actionItems: Array.isArray(summary?.action_items) ? summary.action_items.map(String) : [],
    speakers: Array.isArray(t.speakers) ? (t.speakers as Array<Record<string, unknown>>).map((s) => String(s.name)) : [],
    sentences: ((t.sentences as Array<Record<string, unknown>>) || []).map((s) => ({
      speaker: String(s.speaker_name || "Unknown"),
      text: String(s.text || ""),
      startTime: Number(s.start_time || 0),
    })),
  };
}
