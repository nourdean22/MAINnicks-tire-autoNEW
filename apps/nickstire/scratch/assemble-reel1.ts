// Assemble Reel 1 from generated assets. No credits — pure ffmpeg. Safe to re-run/iterate.
import { resolve } from "path";
import { spawn } from "child_process";
import fs from "fs";

const DIR = resolve("c:/Users/nourd/NOURCITY/apps/nickstire/scratch/out/reel1");
const OUT = resolve(DIR, "reel1-final.mp4");
const FONT = "C\\:/Windows/Fonts/arialbd.ttf"; // colon escaped for ffmpeg filtergraph

// beat = source clip + on-screen duration + burned caption (ASCII only, no apostrophes)
const SEGS = [
  { src: "clip1.mp4", dur: 1.5, cap: "TIRES HAVE A BIRTHDAY TOO", size: 52 },
  { src: "clip2.mp4", dur: 3.0, cap: "TREAD ISNT AGE", size: 64 },
  { src: "clip3.mp4", dur: 4.0, cap: "FIND THE DOT DATE", size: 60 },
  { src: "clip4.mp4", dur: 4.0, cap: "WORTH A CHECK", size: 64 },
  { src: "clip1.mp4", dur: 2.5, cap: "DONT GUESS - WE WILL TAKE A LOOK", size: 44 },
];

function build() {
  const inputs: string[] = [];
  SEGS.forEach((s) => inputs.push("-i", resolve(DIR, s.src)));
  inputs.push("-i", resolve(DIR, "vo.wav"));
  inputs.push("-i", resolve(DIR, "music.mp3"));
  const voIdx = SEGS.length;
  const musIdx = SEGS.length + 1;

  const fc: string[] = [];
  // normalize + trim each segment
  SEGS.forEach((s, i) => {
    fc.push(
      `[${i}:v]trim=0:${s.dur},setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p[v${i}]`
    );
  });
  fc.push(`${SEGS.map((_, i) => `[v${i}]`).join("")}concat=n=${SEGS.length}:v=1:a=0[vc]`);

  // burned captions per beat, chained
  let cum = 0;
  let label = "vc";
  SEGS.forEach((s, i) => {
    const start = cum, end = cum + s.dur;
    cum = end;
    const next = i === SEGS.length - 1 ? "vout" : `d${i}`;
    const txt = s.cap.replace(/'/g, "");
    fc.push(
      `[${label}]drawtext=fontfile='${FONT}':text='${txt}':fontsize=${s.size}:fontcolor=white:borderw=5:bordercolor=black:box=1:boxcolor=black@0.42:boxborderw=26:x=(w-text_w)/2:y=h-h/4:enable='between(t,${start.toFixed(2)},${end.toFixed(2)})'[${next}]`
    );
    label = next;
  });

  // audio: VO over ducked music, trimmed to 15s
  fc.push(`[${voIdx}:a]volume=1.15[a0]`);
  fc.push(`[${musIdx}:a]volume=0.16[a1]`);
  fc.push(`[a0][a1]amix=inputs=2:duration=longest:normalize=0[am]`);
  fc.push(`[am]atrim=0:15,asetpts=PTS-STARTPTS[aout]`);

  return [
    ...inputs,
    "-filter_complex", fc.join(";"),
    "-map", "[vout]", "-map", "[aout]",
    "-r", "30", "-t", "15",
    "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart", "-y", OUT,
  ];
}

function main() {
  const missing = [...SEGS.map((s) => s.src), "vo.wav", "music.mp3"].filter((f) => !fs.existsSync(resolve(DIR, f)));
  if (missing.length) { console.error("MISSING assets:", missing); process.exit(2); }
  const args = build();
  console.log("ffmpeg", args.join(" "));
  const child = spawn("ffmpeg", args, { stdio: "inherit" });
  child.on("close", (code) => {
    if (code === 0) console.log("\nDONE:", OUT);
    else console.error("\nffmpeg failed:", code);
    process.exit(code ?? 1);
  });
}

main();
