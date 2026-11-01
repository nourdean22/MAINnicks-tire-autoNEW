/**
 * The hold audio for a warm transfer is US ringback, not music (Nour: "no hold
 * music"). North American ringback is 440 Hz + 480 Hz, 2 s on, 4 s off. The file
 * is generated, so pin what a caller hears: a valid PCM WAV, ring in the first
 * two seconds, silence in the next four, ring again at six.
 */
import { describe, expect, it } from "vitest";
import { ringbackWav } from "./ringbackTone";

const wav = ringbackWav();
const RATE = wav.readUInt32LE(24);
const sample = (i: number) => wav.readInt16LE(44 + i * 2);
/** Peak absolute amplitude over [fromSec, toSec). */
function peak(fromSec: number, toSec: number): number {
  let m = 0;
  for (let i = Math.floor(fromSec * RATE); i < Math.floor(toSec * RATE); i++) m = Math.max(m, Math.abs(sample(i)));
  return m;
}

describe("ringbackWav", () => {
  it("is a mono 16-bit PCM WAV whose sizes agree with its header", () => {
    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
    expect(wav.subarray(8, 16).toString("ascii")).toBe("WAVEfmt ");
    expect(wav.readUInt16LE(20)).toBe(1); // PCM
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.subarray(36, 40).toString("ascii")).toBe("data");
    expect(wav.readUInt32LE(40)).toBe(wav.length - 44);
  });

  it("lasts at least a minute, longer than the 25 s ring plus the counter's answer", () => {
    expect(wav.readUInt32LE(40) / 2 / RATE).toBeGreaterThanOrEqual(60);
  });

  it("rings 2 s, is silent 4 s, rings again", () => {
    expect(peak(0.1, 1.9)).toBeGreaterThan(3000);
    expect(peak(2.05, 5.95)).toBe(0);
    expect(peak(6.1, 7.9)).toBeGreaterThan(3000);
  });

  it("never clips", () => {
    expect(peak(0, 60)).toBeLessThan(32767);
  });

  it("is built once and reused", () => {
    expect(ringbackWav()).toBe(wav);
  });
});
