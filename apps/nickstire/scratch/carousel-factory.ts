/**
 * Carousel factory — burns leftover Higgsfield credits into finished IG carousel slides.
 * Reads carousels.json (8 briefs x 5 slides), generates a TEXT-FREE square image per slide
 * (nano_banana, 1 cr), burns the headline on top, banks slide1-5.png + caption.txt per carousel.
 *
 * Run from apps/nickstire:  pnpm exec tsx scratch/carousel-factory.ts [startIndex] [count]
 */
import { resolve } from "path";
import fs from "fs";
import { spawn } from "child_process";

const HF = "C:/Users/nourd/NOURCITY/node_modules/.pnpm/@higgsfield+cli@0.2.2/node_modules/@higgsfield/cli/vendor/hf.exe";
const FONT = "C\\:/Windows/Fonts/arialbd.ttf";
const OUTROOT = "C:/Users/nourd/reel-factory-out/carousels";
const BRIEFS = "C:/Users/nourd/reel-factory-out/carousels.json";
delete process.env.HIGGSFIELD_CREDENTIALS_JSON;
delete process.env.HIGGSFIELD_CREDENTIALS_PATH;

type Slide = { headline: string; imagePrompt: string };
type Carousel = { slug: string; caption: string; slides: Slide[] };

function sh(cmd: string, args: string[], timeoutMs = 180000): Promise<{ code: number; out: string }> {
  return new Promise((res) => {
    const c = spawn(cmd, args, { env: process.env });
    let out = "";
    c.stdout.on("data", (d) => (out += d.toString()));
    c.stderr.on("data", (d) => (out += d.toString()));
    const timer = setTimeout(() => { c.kill("SIGKILL"); res({ code: 124, out: out + "\n[TIMEOUT]" }); }, timeoutMs);
    c.on("close", (code) => { clearTimeout(timer); res({ code: code ?? 1, out }); });
  });
}

async function genImage(prompt: string, dest: string): Promise<void> {
  const { code, out } = await sh(HF, ["generate", "create", "nano_banana", "--prompt", prompt, "--aspect_ratio", "1:1", "--wait", "--json"]);
  if (code !== 0) throw new Error(`nano_banana failed (${code}): ${out.slice(-300)}`);
  const url = (out.match(/https?:\/\/[^"]+\.(png|jpe?g|webp)/i) || [])[0];
  if (!url) throw new Error(`no image url in: ${out.slice(-300)}`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`download ${resp.status}`);
  fs.writeFileSync(dest, Buffer.from(await resp.arrayBuffer()));
}

// Burn the headline (1-2 lines) onto the top band of the square slide.
function overlay(rawImg: string, headline: string, outPng: string): Promise<{ code: number; out: string }> {
  const lines = headline.split(/\r?\n/).map((l) => l.trim().replace(/['%\\]/g, "")).filter(Boolean).slice(0, 2);
  const fc: string[] = [
    // readable top band so any image works behind white text
    "drawbox=x=0:y=0:w=iw:h=ih*0.26:color=black@0.42:t=fill",
  ];
  const size = lines.length > 1 ? 66 : 80;
  lines.forEach((ln, i) => {
    const y = lines.length > 1 ? `(h*0.07)+(${i}*${size + 12})` : "(h*0.10)";
    fc.push(`drawtext=fontfile='${FONT}':text='${ln}':fontsize=${size}:fontcolor=white:borderw=5:bordercolor=black:box=0:x=(w-text_w)/2:y=${y}`);
  });
  // small brand chip bottom-right
  fc.push(`drawtext=fontfile='${FONT}':text='NICKS TIRE - EUCLID':fontsize=30:fontcolor=white@0.85:borderw=3:bordercolor=black:x=w-text_w-30:y=h-text_h-28`);
  return sh("ffmpeg", ["-i", rawImg, "-vf", fc.join(","), "-frames:v", "1", "-update", "1", "-y", outPng]);
}

async function main() {
  const all: Carousel[] = JSON.parse(fs.readFileSync(BRIEFS, "utf8"));
  const startIdx = Number(process.argv[2] ?? 0);
  const count = Number(process.argv[3] ?? all.length);
  fs.mkdirSync(OUTROOT, { recursive: true });
  const slice = all.slice(startIdx, startIdx + count);
  console.log(`CAROUSEL FACTORY: ${slice.length} carousels (${startIdx}..${startIdx + slice.length - 1})`);
  for (const car of slice) {
    const t0 = Date.now();
    const dir = resolve(OUTROOT, car.slug);
    const lastSlide = resolve(dir, `slide5.png`);
    if (fs.existsSync(lastSlide)) { console.log(`SKIP ${car.slug} (exists)`); continue; }
    fs.mkdirSync(dir, { recursive: true });
    try {
      for (let i = 0; i < car.slides.length; i++) {
        const raw = resolve(dir, `s${i + 1}-raw.png`);
        const slide = resolve(dir, `slide${i + 1}.png`);
        await genImage(car.slides[i].imagePrompt, raw);
        const { code, out } = await overlay(raw, car.slides[i].headline, slide);
        if (code !== 0) throw new Error(`overlay slide${i + 1} (${code}): ${out.slice(-200)}`);
        console.log(`  ${car.slug} slide${i + 1} ok (${Math.round((Date.now() - t0) / 1000)}s)`);
      }
      fs.writeFileSync(resolve(dir, "caption.txt"), car.caption);
      console.log(`DONE ${car.slug} (5 slides, ${Math.round((Date.now() - t0) / 1000)}s)`);
    } catch (e) {
      console.error(`FAILED ${car.slug}:`, (e as Error).message);
    }
  }
  console.log(`\nCAROUSEL FACTORY DONE. Output: ${OUTROOT}`);
}
main();
