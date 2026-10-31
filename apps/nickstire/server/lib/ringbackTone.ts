/**
 * Hold audio for a warm transfer: US ringback (440 Hz + 480 Hz, 2 s on, 4 s off),
 * so a caller waiting on the shop hears a phone ringing, never music (Nour: "no
 * hold music"). Vapi plays `transferPlan.holdAudioUrl` to the caller while the
 * counter is dialled; the webhook router serves this at /api/webhooks/vapi/ringback.wav.
 *
 * 8 kHz mono 16-bit PCM (telephone quality), 60 s: longer than the 25 s dial plus
 * the transfer assistant's one line. Built once per process (~960 KB).
 */
const RATE = 8000;
const SECONDS = 60;
const ON_SEC = 2;
const CYCLE_SEC = 6;
/** Each tone at ~0.2 of full scale: summed peak ~0.4, well clear of clipping. */
const TONE_AMP = 0.2 * 32767;

let cached: Buffer | null = null;

export function ringbackWav(): Buffer {
  if (cached) return cached;
  const samples = RATE * SECONDS;
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(buf.length - 8, 4);
  buf.write("WAVEfmt ", 8, "ascii");
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const t = i / RATE;
    const on = t % CYCLE_SEC < ON_SEC;
    const v = on ? TONE_AMP * (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 480 * t)) : 0;
    buf.writeInt16LE(Math.round(v), 44 + i * 2);
  }
  cached = buf;
  return buf;
}
