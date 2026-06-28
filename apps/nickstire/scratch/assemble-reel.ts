// Generic reel assembler. Usage: pnpm exec tsx scratch/assemble-reel.ts <reel1|reel2|reel3>
// No credits — pure ffmpeg. Expects out/<reel>/{clip1..4}.mp4 + vo.wav + music.mp3.
import { resolve } from "path";
import { spawn } from "child_process";
import fs from "fs";
import { REELS as DATA_REELS } from "./reels-data";

const REEL = process.argv[2] || "reel1";
const DIR = resolve("c:/Users/nourd/NOURCITY/apps/nickstire/scratch/out", REEL);
const OUT = resolve(DIR, `${REEL}-final.mp4`);
const FONT = "C\\:/Windows/Fonts/arialbd.ttf";

type Seg = { src: string; dur: number; cap: string; size: number };
const CONFIGS: Record<string, { vo: string; music: string; segs: Seg[] }> = {
  reel1: { vo: "vo.wav", music: "music.mp3", segs: [
    { src: "clip1.mp4", dur: 1.5, cap: "TIRES HAVE A BIRTHDAY TOO", size: 52 },
    { src: "clip2.mp4", dur: 3.0, cap: "TREAD ISNT AGE", size: 64 },
    { src: "clip3.mp4", dur: 4.0, cap: "FIND THE DOT DATE", size: 60 },
    { src: "clip4.mp4", dur: 4.0, cap: "WORTH A CHECK", size: 64 },
    { src: "clip1.mp4", dur: 2.5, cap: "DONT GUESS WE WILL TAKE A LOOK", size: 44 },
  ] },
  reel2: { vo: "vo.wav", music: "music.mp3", segs: [
    { src: "clip1.mp4", dur: 2.0, cap: "POTHOLE ON THE RECORD", size: 56 },
    { src: "clip2.mp4", dur: 4.0, cap: "BENT RIM RISK", size: 64 },
    { src: "clip3.mp4", dur: 4.0, cap: "CAR PULLING = ALIGNMENT", size: 50 },
    { src: "clip4.mp4", dur: 4.0, cap: "WORTH CHECKING", size: 64 },
    { src: "clip1.mp4", dur: 2.0, cap: "STOP BY WE WILL TAKE A LOOK", size: 46 },
  ] },
  reel3: { vo: "vo.wav", music: "music.mp3", segs: [
    { src: "clip1.mp4", dur: 1.5, cap: "THE PSI HEIST", size: 64 },
    { src: "clip2.mp4", dur: 4.0, cap: "10F COLDER = 1 PSI LOST", size: 50 },
    { src: "clip3.mp4", dur: 4.0, cap: "WHY THE LIGHT POPS ON COLD", size: 48 },
    { src: "clip4.mp4", dur: 3.0, cap: "AIR IT BACK UP", size: 64 },
    { src: "clip1.mp4", dur: 1.5, cap: "NOT SURE ON PSI - STOP BY", size: 48 },
  ] },
  reel4: { vo: "vo.wav", music: "music.mp3", segs: [
    { src: "clip1.mp4", dur: 1.5, cap: "YOUR TIRE HIDES A CANYON", size: 48 },
    { src: "clip2.mp4", dur: 3.0, cap: "THE PENNY TEST", size: 62 },
    { src: "clip3.mp4", dur: 4.0, cap: "SEE ALL HIS HEAD", size: 54 },
    { src: "clip4.mp4", dur: 4.0, cap: "TIME FOR NEW ONES", size: 56 },
    { src: "clip1.mp4", dur: 2.5, cap: "WE CHECK TREAD FREE", size: 52 },
  ] },
  reel5: { vo: "vo.wav", music: "music.mp3", segs: [
    { src: "clip1.mp4", dur: 2.0, cap: "BRAKES ON A DIET", size: 60 },
    { src: "clip2.mp4", dur: 3.0, cap: "PAD WORN THIN", size: 62 },
    { src: "clip3.mp4", dur: 4.0, cap: "METAL ON METAL NEXT", size: 50 },
    { src: "clip4.mp4", dur: 4.0, cap: "DONT WAIT ON BRAKES", size: 50 },
    { src: "clip1.mp4", dur: 2.0, cap: "FREE BRAKE CHECK", size: 56 },
  ] },
  reel6: { vo: "vo.wav", music: "music.mp3", segs: [
    { src: "clip1.mp4", dur: 2.0, cap: "THIS OIL GAVE UP", size: 58 },
    { src: "clip2.mp4", dur: 3.0, cap: "OLD OIL TURNS TO SLUDGE", size: 44 },
    { src: "clip3.mp4", dur: 4.0, cap: "FRESH IS BETTER", size: 60 },
    { src: "clip4.mp4", dur: 4.0, cap: "CHECK YOUR DIPSTICK", size: 52 },
    { src: "clip1.mp4", dur: 2.0, cap: "QUICK OIL CHANGE", size: 56 },
  ] },
  reel7: { vo: "vo.wav", music: "music.mp3", segs: [
    { src: "clip1.mp4", dur: 2.0, cap: "BATTERIES HATE COLD", size: 54 },
    { src: "clip2.mp4", dur: 3.0, cap: "COLD STEALS CRANKING POWER", size: 42 },
    { src: "clip3.mp4", dur: 4.0, cap: "DIES ON COLD MORNINGS", size: 48 },
    { src: "clip4.mp4", dur: 4.0, cap: "TEST IT FREE", size: 62 },
    { src: "clip1.mp4", dur: 2.0, cap: "BEFORE IT STRANDS YOU", size: 48 },
  ] },
  reel8: { vo: "vo.wav", music: "music.mp3", segs: [
    { src: "clip1.mp4", dur: 2.0, cap: "JUST SMEARING NOW", size: 56 },
    { src: "clip2.mp4", dur: 3.0, cap: "CRACKED RUBBER EDGE", size: 52 },
    { src: "clip3.mp4", dur: 4.0, cap: "STREAKS WHERE IT MATTERS", size: 44 },
    { src: "clip4.mp4", dur: 4.0, cap: "TWO MINUTE SWAP", size: 56 },
    { src: "clip1.mp4", dur: 2.0, cap: "WELL SORT IT", size: 62 },
  ] },
};

function build(cfg: { vo: string; music: string; segs: Seg[] }, total: number) {
  const inputs: string[] = [];
  cfg.segs.forEach((s) => inputs.push("-i", resolve(DIR, s.src)));
  inputs.push("-i", resolve(DIR, cfg.vo), "-i", resolve(DIR, cfg.music));
  const voIdx = cfg.segs.length, musIdx = cfg.segs.length + 1;
  const fc: string[] = [];
  cfg.segs.forEach((s, i) => fc.push(
    `[${i}:v]trim=0:${s.dur},setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p[v${i}]`));
  fc.push(`${cfg.segs.map((_, i) => `[v${i}]`).join("")}concat=n=${cfg.segs.length}:v=1:a=0[vc]`);
  let cum = 0, label = "vc";
  cfg.segs.forEach((s, i) => {
    const start = cum, end = cum + s.dur; cum = end;
    const next = i === cfg.segs.length - 1 ? "vout" : `d${i}`;
    const txt = s.cap.replace(/'/g, "");
    fc.push(`[${label}]drawtext=fontfile='${FONT}':text='${txt}':fontsize=${s.size}:fontcolor=white:borderw=5:bordercolor=black:box=1:boxcolor=black@0.42:boxborderw=26:x=(w-text_w)/2:y=h-h/4:enable='gte(t,${start.toFixed(2)})*lt(t,${end.toFixed(2)})'[${next}]`);
    label = next;
  });
  fc.push(`[${voIdx}:a]volume=1.15[a0]`, `[${musIdx}:a]volume=0.16[a1]`, `[a0][a1]amix=inputs=2:duration=longest:normalize=0[am]`, `[am]atrim=0:${total},asetpts=PTS-STARTPTS[aout]`);
  return [...inputs, "-filter_complex", fc.join(";"), "-map", "[vout]", "-map", "[aout]", "-r", "30", "-t", String(total),
    "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-y", OUT];
}

function main() {
  const dataReel = DATA_REELS.find((r) => r.dir === REEL);
  const cfg = CONFIGS[REEL] || (dataReel ? { vo: "vo.wav", music: "music.mp3", segs: dataReel.segs } : null);
  if (!cfg) { console.error("unknown reel:", REEL); process.exit(2); }
  const need = [...cfg.segs.map((s) => s.src), cfg.vo, cfg.music].filter((f, i, a) => a.indexOf(f) === i);
  const missing = need.filter((f) => !fs.existsSync(resolve(DIR, f)));
  if (missing.length) { console.error(`[${REEL}] MISSING:`, missing); process.exit(2); }
  const total = cfg.segs.reduce((a, s) => a + s.dur, 0);
  const args = build(cfg, total);
  const child = spawn("ffmpeg", args, { stdio: "inherit" });
  child.on("close", (code) => { console.log(code === 0 ? `\nDONE: ${OUT}` : `\nffmpeg failed: ${code}`); process.exit(code ?? 1); });
}
main();
