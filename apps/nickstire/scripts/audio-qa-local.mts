/** LOCAL ONLY: run the repo's audio QA on a downloaded master. No database, no network. */
const path = await import("path");
const dir = "C:/Users/nourd/NattyNour/nicks-tire/node_modules/.pnpm/@remotion+compositor-win32-x64-msvc@4.0.486/node_modules/@remotion/compositor-win32-x64-msvc";
process.env.FFMPEG_PATH ||= path.join(dir, "ffmpeg.exe");
process.env.FFPROBE_PATH ||= path.join(dir, "ffprobe.exe");
const file = process.argv[2];
if (!file) { console.error("usage: audio-qa-local.mts <mp4>"); process.exit(2); }
const { runAudioQa } = await import("../server/services/audioQa");
const r = await runAudioQa(file);
console.log(JSON.stringify(r, null, 1));
process.exit(0);
