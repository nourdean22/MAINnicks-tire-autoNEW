// @vitest-environment jsdom
/**
 * 2026-10-30 · dictation's free browser lane.
 *
 * Prod probe: every server STT lane was down (OpenAI 401, HF 402, no GROQ_API_KEY), so the composer
 * mic failed on every device. Where the browser has speech recognition (desktop Chrome, Android),
 * dictation now uses it and never touches the server. iOS is excluded: a home-screen web app detects
 * webkitSpeechRecognition but it never returns text, so the recorder + server lane stays there.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const { toastError, toastPlain } = vi.hoisted(() => ({ toastError: vi.fn(), toastPlain: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(toastPlain, { error: toastError, warning: vi.fn() }) }));

import { useVoiceInput } from "@/hooks/use-voice-input";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;

/** Minimal renderHook: the repo has no @testing-library/react. */
function renderHook<T>(hook: () => T): { result: { current: T } } {
  const result = { current: undefined as unknown as T };
  function Probe() {
    result.current = hook();
    return null;
  }
  const host = document.createElement("div");
  root = createRoot(host);
  act(() => root!.render(React.createElement(Probe)));
  return { result };
}

class FakeSpeech {
  static last: FakeSpeech | null = null;
  lang = "";
  interimResults = true;
  continuous = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  abort = vi.fn();
  stop = vi.fn(() => this.onend?.());
  constructor() {
    FakeSpeech.last = this;
  }
  say(text: string) {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });
  }
}

const getUserMedia = vi.fn(async () => {
  throw new Error("denied");
});
const realUa = navigator.userAgent;

function setUa(ua: string) {
  Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });
}

beforeEach(() => {
  FakeSpeech.last = null;
  toastError.mockClear();
  toastPlain.mockClear();
  getUserMedia.mockClear();
  (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = FakeSpeech;
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  setUa(realUa);
});

describe("useVoiceInput browser speech lane", () => {
  it("desktop: dictates through the browser, hands the final text over, never opens the recorder", async () => {
    setUa("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36");
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput(onTranscript, vi.fn()));

    await act(async () => { await result.current.startRecording(); });
    expect(FakeSpeech.last?.start).toHaveBeenCalled();
    expect(result.current.isRecording).toBe(true);

    act(() => { FakeSpeech.last!.say("check the shop numbers"); });
    act(() => { result.current.stopRecording(); });

    expect(onTranscript).toHaveBeenCalledWith("check the shop numbers");
    expect(result.current.isRecording).toBe(false);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("CONTROL iPhone: skips browser speech and takes the recorder + server lane", async () => {
    setUa("Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148");
    const { result } = renderHook(() => useVoiceInput(vi.fn(), vi.fn()));

    await act(async () => { await result.current.startRecording(); });
    expect(FakeSpeech.last).toBeNull();
    expect(getUserMedia).toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Microphone unavailable — check permissions");
  });

  it("a denied browser mic says so", async () => {
    setUa("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0");
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput(onTranscript, vi.fn()));
    await act(async () => { await result.current.startRecording(); });

    act(() => { FakeSpeech.last!.onerror?.({ error: "not-allowed" }); });
    expect(toastError).toHaveBeenCalledWith("Microphone unavailable. Check permissions");
    act(() => { result.current.stopRecording(); });
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it("heard nothing: says so instead of turning off without a word", async () => {
    setUa("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0");
    const { result } = renderHook(() => useVoiceInput(vi.fn(), vi.fn()));
    await act(async () => { await result.current.startRecording(); });

    act(() => { FakeSpeech.last!.onerror?.({ error: "no-speech" }); });
    expect(toastError).not.toHaveBeenCalled();
    act(() => { FakeSpeech.last!.onend?.(); });
    expect(toastPlain).toHaveBeenCalledWith("Didn't catch anything. Try again", { id: "stt-nothing" });
  });
});

describe("useVoiceInput recorder lane while the iPhone mic prompt is open", () => {
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";

  it("a stop during the prompt cancels the start: the granted mic is released, nothing records", async () => {
    setUa(IPHONE);
    // Working audio APIs, so without the cancel this start WOULD record (jsdom has neither).
    const recorders: unknown[] = [];
    vi.stubGlobal("AudioContext", class {
      createMediaStreamSource() { return { connect() {} }; }
      createAnalyser() { return { fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 8, getByteFrequencyData() {} }; }
      close() { return Promise.resolve(); }
    });
    vi.stubGlobal("MediaRecorder", class {
      static isTypeSupported() { return true; }
      mimeType = "audio/mp4";
      state = "inactive";
      ondataavailable: unknown = null;
      onstop: unknown = null;
      constructor() { recorders.push(this); }
      start() { this.state = "recording"; }
      stop() { this.state = "inactive"; }
    });
    const trackStop = vi.fn();
    let grant!: (s: unknown) => void;
    getUserMedia.mockImplementationOnce(() => new Promise((r) => { grant = r; }) as never);
    const { result } = renderHook(() => useVoiceInput(vi.fn(), vi.fn()));

    let started!: Promise<boolean>;
    act(() => { started = result.current.startRecording(); });
    act(() => { result.current.stopRecording(); });
    await act(async () => { grant({ getTracks: () => [{ stop: trackStop }] }); });

    expect(await started).toBe(false);
    expect(trackStop).toHaveBeenCalled();
    expect(recorders).toHaveLength(0);
    expect(result.current.isRecording).toBe(false);
    vi.unstubAllGlobals();
  });

  it("a second tap during the prompt does not open a second recorder", async () => {
    setUa(IPHONE);
    getUserMedia.mockImplementationOnce(() => new Promise(() => {}) as never);
    const { result } = renderHook(() => useVoiceInput(vi.fn(), vi.fn()));

    act(() => { void result.current.startRecording(); });
    let second!: boolean;
    await act(async () => { second = await result.current.startRecording(); });

    expect(second).toBe(false);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});
