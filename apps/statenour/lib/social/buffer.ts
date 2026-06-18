/**
 * BUFFER — schedule social posts via the Buffer Publish API.
 *
 * v6 · BATCH 4 · Apr 28. Wraps Buffer's REST API to schedule posts
 * across all connected channels (IG, FB, Twitter, LinkedIn, GBP, etc.)
 * Lets Nour stack a week of content at once instead of posting in
 * real time.
 *
 * Required env:
 *   BUFFER_ACCESS_TOKEN — OAuth token from Buffer dev settings
 *
 * Optional:
 *   BUFFER_PROFILES — comma-separated profile IDs (e.g. IG, FB).
 *     If set, all posts default to these channels. Otherwise the
 *     caller must provide profile_ids in the schedule call.
 *
 * Setup (one-time):
 *   1. Create a Buffer app at https://buffer.com/developers/apps
 *   2. Generate access token via OAuth flow OR personal access token
 *      from app settings
 *   3. Save to env. Buffer tokens don't expire by default.
 *
 * Pricing: Buffer Pro is $6-$12/mo per channel. The cost is amortized
 * — no per-call charge. Doesn't show up on the AI cost dashboard.
 *
 * IMPORTANT — SCHEDULING IS REVERSIBLE BUT POSTING IS NOT.
 * Buffer holds queued posts until the scheduled time. Nour can edit
 * or delete from Buffer's web UI. This means scheduling is safer than
 * direct publish — but the UI should still confirm before queueing.
 */

const BUFFER_API = "https://api.bufferapp.com/1";

function getKey(): string {
  const key = process.env.BUFFER_ACCESS_TOKEN?.trim() ?? "";
  if (!key) {
    throw new Error("BUFFER_ACCESS_TOKEN not set");
  }
  return key;
}

function defaultProfileIds(): string[] {
  const csv = process.env.BUFFER_PROFILES?.trim();
  if (!csv) return [];
  return csv.split(",").map((s) => s.trim()).filter(Boolean);
}

export interface BufferProfile {
  id: string;
  service: string;          // "instagram" / "facebook" / "twitter" / "googlebusiness"
  service_username: string;
  formatted_username: string;
  default: boolean;
}

/**
 * List connected profiles (channels) on this Buffer account. Used by
 * the schedule UI to show which channels are wired up + let the user
 * pick which to post to.
 */
export async function listBufferProfiles(): Promise<BufferProfile[]> {
  const key = getKey();
  const res = await fetch(`${BUFFER_API}/profiles.json`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10_000), // wave-181.92
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Buffer profiles failed (${res.status}): ${errText.slice(0, 200)}`);
  }
  return await res.json();
}

export interface ScheduleResult {
  ok: boolean;
  bufferUpdateIds: string[];
  scheduledFor?: string;
  error?: string;
}

/**
 * Schedule a post (or multiple) on Buffer. Each profile gets its own
 * queue slot — Buffer will publish at the next available slot in that
 * profile's queue OR at scheduled_at if provided.
 *
 * args:
 *   text — post text/caption
 *   imageUrl? — optional public image URL
 *   linkUrl? — optional link to attach
 *   profileIds? — array of Buffer profile IDs; defaults to BUFFER_PROFILES env
 *   scheduledAt? — ISO 8601 timestamp; defaults to "next available slot"
 *   shareNow? — if true, posts immediately instead of queueing
 */
export async function scheduleBufferPost(args: {
  text: string;
  imageUrl?: string;
  videoUrl?: string;
  linkUrl?: string;
  profileIds?: string[];
  scheduledAt?: string;
  shareNow?: boolean;
}): Promise<ScheduleResult> {
  try {
    const key = getKey();
    const profiles = (args.profileIds && args.profileIds.length > 0)
      ? args.profileIds
      : defaultProfileIds();
    if (profiles.length === 0) {
      return {
        ok: false,
        bufferUpdateIds: [],
        error: "no profile_ids provided and BUFFER_PROFILES env not set",
      };
    }

    const params = new URLSearchParams();
    params.append("text", args.text);
    for (const pid of profiles) {
      params.append("profile_ids[]", pid);
    }
    if (args.videoUrl) {
      params.append("media[video]", args.videoUrl);
      params.append("media[link]", args.videoUrl);
      if (args.imageUrl) {
        params.append("media[thumbnail]", args.imageUrl);
      }
    } else if (args.imageUrl) {
      params.append("media[photo]", args.imageUrl);
      params.append("media[link]", args.imageUrl);
    }
    if (args.linkUrl) {
      params.append("media[link]", args.linkUrl);
    }
    if (args.shareNow) {
      params.append("now", "true");
    } else if (args.scheduledAt) {
      // Buffer accepts unix timestamp (seconds since epoch)
      const epoch = Math.floor(new Date(args.scheduledAt).getTime() / 1000);
      params.append("scheduled_at", String(epoch));
    }

    const res = await fetch(`${BUFFER_API}/updates/create.json`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      signal: AbortSignal.timeout(15_000), // wave-181.92
      body: params.toString(),
    });
    if (!res.ok) {
      const errText = await res.text();
      return {
        ok: false,
        bufferUpdateIds: [],
        error: `Buffer schedule failed (${res.status}): ${errText.slice(0, 200)}`,
      };
    }
    const data = await res.json();
    if (!data.success) {
      return {
        ok: false,
        bufferUpdateIds: [],
        error: data.message ?? "Buffer responded success=false",
      };
    }

    const ids = (data.updates ?? []).map((u: { id: string }) => u.id);
    return {
      ok: true,
      bufferUpdateIds: ids,
      scheduledFor: args.scheduledAt ?? (args.shareNow ? "now" : "next slot"),
    };
  } catch (err) {
    return {
      ok: false,
      bufferUpdateIds: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Connection check — fetches /info.json. Confirms token works and
 * returns Buffer plan tier so the UI can show "you're on Buffer Pro
 * with X channels connected" or warn about quota.
 */
export async function checkBufferConnection(): Promise<{
  ok: boolean;
  email?: string;
  plan?: string;
  profileCount?: number;
  error?: string;
}> {
  try {
    const key = getKey();
    const [infoRes, profilesRes] = await Promise.all([
      fetch(`${BUFFER_API}/user.json`, { headers: { Authorization: `Bearer ${key}` } }),
      fetch(`${BUFFER_API}/profiles.json`, { headers: { Authorization: `Bearer ${key}` } }),
    ]);
    if (!infoRes.ok) {
      return { ok: false, error: `Buffer /user failed (${infoRes.status})` };
    }
    const info = await infoRes.json();
    const profiles = profilesRes.ok ? await profilesRes.json() : [];
    return {
      ok: true,
      email: info.email,
      plan: info.plan,
      profileCount: Array.isArray(profiles) ? profiles.length : 0,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
