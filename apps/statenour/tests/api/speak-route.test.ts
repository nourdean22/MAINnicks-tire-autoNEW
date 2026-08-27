import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The edge adapter is a network protocol — mock the module entirely.
const edgeCtorSpy = vi.fn();
let edgeStreamImpl: () => AsyncGenerator<{ type: string; data?: Uint8Array }>;
vi.mock("edge-tts-universal", () => ({
  Communicate: class {
    constructor(text: string, opts: unknown) {
      edgeCtorSpy(text, opts);
    }
    stream() {
      return edgeStreamImpl();
    }
  },
}));

import { POST } from "@/app/api/ai/speak/route";

function speakReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/ai/speak", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // unique IP per test run so the 60/min rate limit never collides
      "x-forwarded-for": `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    },
    body: JSON.stringify(body),
  });
}

function okOpenAiFetch(): typeof fetch {
  return vi.fn(async () =>
    new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 }),
  ) as unknown as typeof fetch;
}

async function* edgeAudio(): AsyncGenerator<{ type: string; data?: Uint8Array }> {
  yield { type: "audio", data: new Uint8Array([9, 9]) };
  yield { type: "SentenceBoundary" };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  edgeCtorSpy.mockReset();
  edgeStreamImpl = () => {
    throw new Error("edge stream not stubbed for this test");
  };
  vi.stubEnv("OPENAI_API_KEY", "test-key");
});

describe("POST /api/ai/speak", () => {
  it("synthesizes via openai by default and reports the engine honestly", async () => {
    const fetchMock = okOpenAiFetch();
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(speakReq({ text: "Hello operator." }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("x-tts-engine")).toBe("openai");
    expect(edgeCtorSpy).not.toHaveBeenCalled();
    const sent = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(sent[0])).toContain("api.openai.com/v1/audio/speech");
    expect(JSON.parse((sent[1] as RequestInit).body as string).model).toBe("gpt-4o-mini-tts");
  });

  it("falls back to edge when openai fails — and the header tells the truth", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 503 })));
    edgeStreamImpl = edgeAudio;
    const res = await POST(speakReq({ text: "Fallback please." }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-tts-engine")).toBe("edge");
  });

  it("honors an explicit engine=edge request", async () => {
    const fetchMock = okOpenAiFetch();
    vi.stubGlobal("fetch", fetchMock);
    edgeStreamImpl = edgeAudio;
    const res = await POST(speakReq({ text: "Edge first.", engine: "edge" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-tts-engine")).toBe("edge");
    expect(fetchMock).not.toHaveBeenCalled(); // openai never touched
  });

  it("502s with per-adapter diagnostics when BOTH adapters fail — no silent success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 500 })));
    edgeStreamImpl = async function* (): AsyncGenerator<never> {
      throw new Error("ws refused");
    };
    const res = await POST(speakReq({ text: "Doomed." }));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { detail: string[] };
    expect(body.detail.join(" ")).toContain("openai");
    expect(body.detail.join(" ")).toContain("edge");
  });

  it("rejects missing and oversized text", async () => {
    vi.stubGlobal("fetch", okOpenAiFetch());
    expect((await POST(speakReq({}))).status).toBe(400);
    expect((await POST(speakReq({ text: "x".repeat(1501) }))).status).toBe(400);
    // positive control: a normal segment passes
    expect((await POST(speakReq({ text: "Fine." }))).status).toBe(200);
  });
});
