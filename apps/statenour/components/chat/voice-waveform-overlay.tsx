"use client";

/**
 * VoiceWaveformOverlay — the 9-bar bouncing wave that overlays the
 * composer textarea when the mic is recording or in continuous mode.
 *
 * Extracted from app/(mastery)/chat/page.tsx (Wave 83) · ~33 LOC of
 * self-contained presentation. The parent passes `audioLevel`
 * (0-1) and the visual mode; this component renders the symmetric
 * 9-bar envelope with the amplitude-scaled glow.
 *
 * Apr 27 · WAVEFORM-POLISH — 9 bars (was 5) for a fuller wave
 * reading. Symmetric envelope so middle bars dance higher than the
 * edges. Bars get a subtle red glow that scales with amplitude.
 */
export function VoiceWaveformOverlay({
  audioLevel,
  mode,
}: {
  audioLevel: number;
  mode: "recording" | "continuous";
}) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center gap-1.5 px-3.5 rounded-overlay bg-red-500/5 border border-red-500/40 pointer-events-none">
      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-red-400 mr-2 inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-red-400 pulse-live" />
        {mode === "continuous" ? "listening" : "recording"}
      </span>
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => {
        const phase = (i - 4) * 0.12;
        const h = Math.max(
          0.16,
          Math.min(1, audioLevel * (1 - Math.abs(phase))),
        );
        return (
          <span
            key={i}
            className="w-[3px] rounded-full bg-red-400 transition-[height,box-shadow] duration-75"
            style={{
              height: `${8 + h * 24}px`,
              boxShadow:
                audioLevel > 0.4
                  ? `0 0 6px rgba(248,113,113,${0.3 + h * 0.4})`
                  : undefined,
            }}
          />
        );
      })}
    </div>
  );
}
