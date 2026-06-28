"use client";

/**
 * useRealtimeVoice · v10.0.359
 *
 * Speech-to-speech Nick via OpenAI Realtime API + WebRTC. Per the
 * /voice-agents skill · sub-500ms latency, semantic VAD, native
 * barge-in, emotion preserved.
 *
 * FLOW
 *   1. Client requests an ephemeral session token from
 *      /api/realtime/session (server holds the real OPENAI_API_KEY)
 *   2. Browser opens a WebRTC peer connection to the OpenAI realtime
 *      endpoint, authenticating with the ephemeral token
 *   3. Audio flows bidirectionally · mic → OpenAI → speaker
 *   4. Data channel carries text events (transcripts, function calls)
 *
 * Returned API:
 *   start()        · request mic, mint token, open peer connection
 *   stop()         · close all connections, release mic
 *   isConnected    · boolean · WebRTC negotiated successfully
 *   isUserSpeaking · boolean · semantic VAD says user is talking
 *   isAgentSpeaking · boolean · agent audio currently playing
 *   transcript     · live transcript as it arrives
 *   error          · any error string from session establishment
 *
 * Auth via cookie · same as the rest of statenour-os.
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface RealtimeSession {
  client_secret: { value: string; expires_at: number };
  id?: string;
  model?: string;
}

interface UseRealtimeVoiceOpts {
  /** Optional brain context string (passed in instructions) */
  brainContext?: string;
  /** Voice id · default "alloy" */
  voice?: string;
  // v10.0.529.96 · Wave 40 · operator anchors mirror the text-chat
  // OPERATOR CONTEXT block · "snooze that" via voice resolves the same
  // way as text. Hook just forwards to the session POST · the server
  // builds the instructions block.
  operatorContext?: {
    contextRoute?: string;
    lastTaskId?: string;
    lastGoalId?: string;
    lastJournalEntryId?: string;
    lastDecisionId?: string;
    lastPinId?: string;
    lastReflectionId?: string;
    lastMissionId?: string;
  };
}

export function useRealtimeVoice(opts: UseRealtimeVoiceOpts = {}) {
  const { voice = "alloy", brainContext, operatorContext } = opts;

  const [isConnected, setIsConnected] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  const [transcript, setTranscript] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const handleEventRef = useRef<((event: { type?: string; [k: string]: unknown }) => void) | null>(null);
  const operatorContextRef = useRef(operatorContext);

  useEffect(() => {
    operatorContextRef.current = operatorContext;
  }, [operatorContext]);

  const stop = useCallback(() => {
    try { dcRef.current?.close(); } catch {}
    dcRef.current = null;
    try { peerRef.current?.close(); } catch {}
    peerRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch {} });
    micStreamRef.current = null;
    if (audioElRef.current) {
      try { audioElRef.current.srcObject = null; } catch {}
    }
    setIsConnected(false);
    setIsUserSpeaking(false);
    setIsAgentSpeaking(false);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      // 1. Mint ephemeral session
      const tokenRes = await fetch("/api/realtime/session", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voice: voice,
          brainContext: brainContext,
          // Wave 40 · forward operator anchors so the spoken response
          // can naturally reference "this task" / "that decision" etc.
          operatorContext: operatorContextRef.current,
        }),
      });
      if (!tokenRes.ok) {
        const j = await tokenRes.json().catch(() => ({} as { error?: string }));
        throw new Error(j.error ?? `mint failed (${tokenRes.status})`);
      }
      const session = (await tokenRes.json()) as RealtimeSession;
      const ephemeralKey = session.client_secret?.value;
      if (!ephemeralKey) throw new Error("no client_secret in session response");

      // 2. Get mic
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      micStreamRef.current = stream;

      // 3. Set up peer connection
      const pc = new RTCPeerConnection();
      peerRef.current = pc;

      // Audio output → element so it plays through speakers
      pc.ontrack = (event) => {
        if (audioElRef.current) {
          audioElRef.current.srcObject = event.streams[0];
        }
      };

      // Microphone track → peer
      stream.getAudioTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      // 4. Data channel for text events
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.addEventListener("message", (e) => {
        try {
          const event = JSON.parse(e.data);
          handleEventRef.current?.(event);
        } catch {
          // Non-JSON event, ignore
        }
      });

      // 5. Create offer + post to OpenAI realtime endpoint
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const realtimeRes = await fetch(
        `https://api.openai.com/v1/realtime?model=${encodeURIComponent(session.model ?? "gpt-4o-realtime-preview-2024-12-17")}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ephemeralKey}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp ?? "",
        },
      );
      if (!realtimeRes.ok) {
        const txt = await realtimeRes.text().catch(() => "");
        throw new Error(`realtime SDP exchange ${realtimeRes.status}: ${txt.slice(0, 200)}`);
      }
      const answerSdp = await realtimeRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      setIsConnected(true);
    } catch (err) {
      setError((err as Error).message);
      stop();
    }
  }, [voice, brainContext, stop]);

  // v10.0.529.100 · Wave 44 · function-call argument accumulator.
  // The Realtime API streams tool-call arguments in deltas · we buffer
  // by call_id and execute on the `.done` event.
  const fnArgsBufferRef = useRef<Map<string, { name: string; args: string }>>(new Map());


  // Handle incoming realtime events (transcripts, VAD, function calls)
  const handleRealtimeEvent = useCallback((event: { type?: string; [k: string]: unknown }) => {
    const type = event.type;
    if (!type) return;
    // VAD events
    if (type === "input_audio_buffer.speech_started") {
      setIsUserSpeaking(true);
    } else if (type === "input_audio_buffer.speech_stopped") {
      setIsUserSpeaking(false);
    }
    // Agent speech events
    if (type === "response.audio.delta") {
      setIsAgentSpeaking(true);
    } else if (type === "response.audio.done" || type === "response.done") {
      setIsAgentSpeaking(false);
    }
    // Transcript
    if (type === "conversation.item.input_audio_transcription.completed") {
      const t = (event as { transcript?: string }).transcript ?? "";
      if (t) setTranscript((prev) => prev ? `${prev}\n${t}` : t);
    }
    if (type === "response.audio_transcript.delta") {
      const delta = (event as { delta?: string }).delta ?? "";
      if (delta) setTranscript((prev) => prev + delta);
    }

    // v10.0.529.100 · Wave 44 · tool-call wire-up.
    // The Realtime data channel emits:
    //   response.output_item.added · with type="function_call" + name + call_id
    //   response.function_call_arguments.delta · streaming arg chunks
    //   response.function_call_arguments.done · final arg string
    // We accumulate by call_id and dispatch on .done.
    if (type === "response.output_item.added") {
      const item = (event as { item?: { type?: string; name?: string; call_id?: string } }).item;
      if (item?.type === "function_call" && item.call_id && item.name) {
        fnArgsBufferRef.current.set(item.call_id, { name: item.name, args: "" });
      }
    }
    if (type === "response.function_call_arguments.delta") {
      const e = event as { call_id?: string; delta?: string };
      if (e.call_id && e.delta) {
        const buf = fnArgsBufferRef.current.get(e.call_id);
        if (buf) {
          buf.args += e.delta;
        }
      }
    }
    if (type === "response.function_call_arguments.done") {
      const e = event as { call_id?: string; arguments?: string; name?: string };
      const callId = e.call_id;
      if (!callId) return;
      const buf = fnArgsBufferRef.current.get(callId);
      // Prefer the final `arguments` field from the .done event when
      // present · falls back to the delta-accumulated buffer.
      const rawArgs = e.arguments ?? buf?.args ?? "";
      const name = e.name ?? buf?.name ?? "";
      fnArgsBufferRef.current.delete(callId);
      if (!name) return;
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
      } catch {
        // Malformed JSON · pass empty args so the server can error cleanly
      }
      // Fire-and-forget tool dispatch · response is fed back to the
      // session as a function_call_output so the agent can speak about
      // the result.
      void (async () => {
        try {
          const res = await fetch("/api/realtime/tool-call", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, arguments: parsedArgs, callId }),
          });
          const body = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: string; error?: string };
          const output = body.ok
            ? body.result ?? "Tool completed."
            : `Tool failed: ${body.error ?? `HTTP ${res.status}`}`;
          // Send function_call_output back to the Realtime session +
          // prompt a new response so the agent speaks the outcome.
          const dc = dcRef.current;
          if (dc && dc.readyState === "open") {
            dc.send(
              JSON.stringify({
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id: callId,
                  output,
                },
              }),
            );
            dc.send(JSON.stringify({ type: "response.create" }));
          }
        } catch (err) {
          // Network failure · still try to inform the agent so it doesn't
          // hang waiting for the tool result.
          const dc = dcRef.current;
          if (dc && dc.readyState === "open") {
            dc.send(
              JSON.stringify({
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id: callId,
                  output: `Tool dispatch failed: ${(err as Error).message}`,
                },
              }),
            );
            dc.send(JSON.stringify({ type: "response.create" }));
          }
        }
      })();
    }
  }, []);

  useEffect(() => {
    handleEventRef.current = handleRealtimeEvent;
  }, [handleRealtimeEvent]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stop();
  }, [stop]);

  return {
    start,
    stop,
    isConnected,
    isUserSpeaking,
    isAgentSpeaking,
    transcript,
    error,
    /** Mount this <audio> element somewhere in the tree to hear Nick. */
    audioElRef,
  };
}
