/**
 * Word-timed captions on the Google voice (deep scout 2026-10-17 #2).
 *
 * The Google request goes to v1beta1 with enableTimePointing:["SSML_MARK"] and a
 * <mark name="w{i}"/> before every word; the response's timepoints become the
 * existing VoiceAlignment shape, so generateAssSubtitles (the ElevenLabs caption
 * path) is reused unchanged. Empty or missing timepoints (Chirp 3 HD may ignore
 * marks) mean no alignment: today's beat captions, never a throw.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("googleapis", () => ({
  google: { auth: { JWT: class { async getAccessToken() { return { token: "test-token" }; } } } },
}));

import {
  googleTtsRequest,
  buildReelSsml,
  alignmentFromTimepoints,
  wavDurationSec,
  generateVoiceover,
  generateAssSubtitles,
} from "./services/reelVoice";

/** A LINEAR16 WAV: 44-byte header, 24 kHz mono 16-bit (byteRate 48000), `sec` seconds of silence. */
function wav(sec: number): Buffer {
  const data = Math.round(48000 * sec);
  const b = Buffer.alloc(44 + data);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(36 + data, 4);
  b.write("WAVE", 8, "ascii");
  b.write("fmt ", 12, "ascii");
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(24000, 24);
  b.writeUInt32LE(48000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36, "ascii");
  b.writeUInt32LE(data, 40);
  return b;
}

const SCRIPT = "Check the tread. Air up today.";
/** Recorded v1beta1 response shape (SynthesizeSpeechResponse: audioContent, timepoints[{markName,timeSeconds}], audioConfig). */
const TIMEPOINTS = [
  { markName: "w0", timeSeconds: 0.25 },
  { markName: "w1", timeSeconds: 0.5 },
  { markName: "w2", timeSeconds: 0.75 },
  { markName: "w3", timeSeconds: 1.5 },
  { markName: "w4", timeSeconds: 1.75 },
  { markName: "w5", timeSeconds: 2 },
];

describe("googleTtsRequest asks for word timepoints", () => {
  it("targets v1beta1 with enableTimePointing SSML_MARK and one mark per word", () => {
    const { url, body } = googleTtsRequest(SCRIPT, {} as NodeJS.ProcessEnv);
    expect(url).toBe("https://texttospeech.googleapis.com/v1beta1/text:synthesize");
    expect(body.enableTimePointing).toEqual(["SSML_MARK"]);
    const ssml = (body.input as { ssml: string }).ssml;
    expect(ssml.match(/<mark name="w\d+"\/>/g)).toHaveLength(6);
    expect(ssml).toContain('<mark name="w0"/>Check');
    expect(ssml).toContain('<mark name="w5"/>today.');
  });

  it("the marks change nothing spoken: strip them and the SSML is today's, pauses and emphasis included", () => {
    const ssml = (googleTtsRequest(SCRIPT, {} as NodeJS.ProcessEnv).body.input as { ssml: string }).ssml;
    expect(ssml.replace(/<mark name="w\d+"\/>/g, "")).toBe(buildReelSsml(SCRIPT));
  });

  it("timed:false is exactly the old v1 request (the fallback shape)", () => {
    const { url, body } = googleTtsRequest(SCRIPT, {} as NodeJS.ProcessEnv, { timed: false });
    expect(url).toBe("https://texttospeech.googleapis.com/v1/text:synthesize");
    expect(body).toEqual({
      input: { ssml: buildReelSsml(SCRIPT) },
      voice: { languageCode: "en-US", name: "en-US-Neural2-J" },
      audioConfig: { audioEncoding: "LINEAR16", speakingRate: 0.97, pitch: -1.5 },
    });
  });
});

describe("alignmentFromTimepoints", () => {
  it("word boundaries match the marks; the last word ends at the audio end", () => {
    // Binary-exact times: formatAssTime floors centiseconds, so 0.61 would print .60 (pre-existing, not this change).
    const a = alignmentFromTimepoints(SCRIPT, TIMEPOINTS, 2.25);
    expect(a).toBeDefined();
    const ass = generateAssSubtitles(a!);
    const times = [...ass.matchAll(/^Dialogue: 0,([^,]+),([^,]+),/gm)].map((m) => [m[1], m[2]]);
    expect(times).toEqual([
      ["0:00:00.25", "0:00:00.50"],
      ["0:00:00.50", "0:00:00.75"],
      ["0:00:00.75", "0:00:01.50"],
      ["0:00:01.50", "0:00:01.75"],
      ["0:00:01.75", "0:00:02.00"],
      ["0:00:02.00", "0:00:02.25"],
    ]);
    expect(ass).toContain("Check");
    expect(ass).toContain("today.");
  });

  it("empty, missing or partial timepoints are no alignment (beat captions), never a throw", () => {
    expect(alignmentFromTimepoints(SCRIPT, [], 2)).toBeUndefined();
    expect(alignmentFromTimepoints(SCRIPT, undefined, 2)).toBeUndefined();
    expect(alignmentFromTimepoints(SCRIPT, TIMEPOINTS.slice(0, 5), 2)).toBeUndefined();
    expect(alignmentFromTimepoints(SCRIPT, [{ markName: "w0", timeSeconds: Number.NaN }, ...TIMEPOINTS.slice(1)], 2)).toBeUndefined();
  });

  it("an unknown audio end still gives the last word a short, positive span", () => {
    const a = alignmentFromTimepoints(SCRIPT, TIMEPOINTS, null)!;
    const last = a.characterEndTimesSeconds[a.characterEndTimesSeconds.length - 1];
    expect(last).toBeGreaterThan(2);
  });

  it("wavDurationSec reads the LINEAR16 header; non-WAV is null", () => {
    expect(wavDurationSec(wav(1.5))).toBeCloseTo(1.5, 3);
    expect(wavDurationSec(Buffer.from("not a wav"))).toBeNull();
  });
});

describe("generateVoiceover on Google carries the alignment to the caption writer", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function googleEnv() {
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "svc@x");
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", "k");
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    vi.stubEnv("REEL_VO_OPTIONAL", "");
    vi.stubEnv("REEL_VO_PROVIDER", "");
  }
  const ok = (j: unknown) => ({ ok: true, status: 200, json: async () => j, text: async () => "" });

  it("timepoints -> alignment on a google VoiceAudio", async () => {
    googleEnv();
    const fetchMock = vi.fn(async () => ok({ audioContent: wav(2.3).toString("base64"), timepoints: TIMEPOINTS }));
    vi.stubGlobal("fetch", fetchMock);
    const vo = await generateVoiceover(SCRIPT);
    expect(vo?.provider).toBe("google");
    expect(vo?.ext).toBe("wav");
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain("/v1beta1/");
    expect(vo?.alignment).toBeDefined();
    expect(vo!.alignment!.characterStartTimesSeconds[0]).toBe(0.25);
  });

  it("empty timepoints (Chirp ignoring marks) -> audio, no alignment", async () => {
    googleEnv();
    vi.stubGlobal("fetch", vi.fn(async () => ok({ audioContent: wav(1).toString("base64"), timepoints: [] })));
    const vo = await generateVoiceover(SCRIPT);
    expect(vo?.provider).toBe("google");
    expect(vo?.buf.length).toBeGreaterThan(44);
    expect(vo?.alignment).toBeUndefined();
  });

  it("no timepoints field at all -> audio, no alignment", async () => {
    googleEnv();
    vi.stubGlobal("fetch", vi.fn(async () => ok({ audioContent: wav(1).toString("base64") })));
    const vo = await generateVoiceover(SCRIPT);
    expect(vo?.alignment).toBeUndefined();
    expect(vo?.buf.length).toBeGreaterThan(44);
  });

  it("a 400 on the timed request resends today's plain v1 request once", async () => {
    googleEnv();
    const fetchMock = vi.fn(async (url: unknown) =>
      String(url).includes("/v1beta1/")
        ? { ok: false, status: 400, text: async () => "mark not supported", json: async () => ({}) }
        : ok({ audioContent: wav(1).toString("base64") }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const vo = await generateVoiceover(SCRIPT);
    expect(vo?.provider).toBe("google");
    expect(vo?.alignment).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = fetchMock.mock.calls[1] as unknown[];
    expect(String(second[0])).toBe("https://texttospeech.googleapis.com/v1/text:synthesize");
    expect(JSON.parse(String((second[1] as { body: string }).body)).enableTimePointing).toBeUndefined();
  });
});
