import { spawn } from "child_process";
import fs from "fs";

async function run() {
  const fg = `[0:v]trim=0:3,setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,zoompan=z='min(pzoom+0.000667,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30,setsar=1,format=yuv420p[v0];[v0]concat=n=1:v=1:a=0[vc];[vc]drawtext=fontfile='font.ttf':text='DONT LET THE POTHOLE GREMLIN GET YOU':fontsize=44:fontcolor=0xFDB913:borderw=6:bordercolor=black:box=1:boxcolor=black@0.6:boxborderw=28:x=(w-text_w)/2:y=h*0.62:enable='gte(t,12.00)*lt(t,14.00)'[d4];[d4]drawtext=fontfile='font.ttf':text='SAVE THIS POST | DM US "POTHOLE"':fontsize=44:fontcolor=0xFDB913:borderw=6:bordercolor=black:box=1:boxcolor=black@0.6:boxborderw=28:x=(w-text_w)/2:y=h*0.62:enable='gte(t,17.00)*lt(t,19.00)'[vcap];[vcap]tpad=stop_mode=clone:stop_duration=3[vpad];[vpad]drawtext=fontfile='font.ttf':text='SAVE THIS':fontsize=72:fontcolor=0xFDB913:borderw=6:bordercolor=black:box=1:boxcolor=black@0.6:boxborderw=28:x=(w-text_w)/2:y=h*0.12:enable='gte(t,19.00)'[vout];[1:a]aresample=48000,volume=1.15,asplit=2[vo_mix][vo_key];[2:a]aresample=48000,volume=0.6[mus_raw];[mus_raw][vo_key]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[mus_duck];[vo_mix][mus_duck]amix=inputs=2:duration=longest:normalize=0[am];[am]atrim=0:22,asetpts=PTS-STARTPTS,apad=whole_dur=22,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]`;
  
  fs.writeFileSync("font.ttf", "");

  const args = [
    "-y", 
    "-f", "lavfi", "-i", "color=c=black:s=1080x1920:d=3", 
    "-f", "lavfi", "-i", "aevalsrc=0:d=3", 
    "-f", "lavfi", "-i", "aevalsrc=0:d=3", 
    "-filter_complex", fg, 
    "-map", "[vout]", "-map", "[aout]", 
    "out.mp4"
  ];
  const p = spawn("ffmpeg", args);
  p.stderr.on("data", (d) => process.stdout.write(String(d)));
  p.on("close", (c) => console.log("exited with", c));
}
run();
