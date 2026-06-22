/**
 * Local reel factory — burns remaining Higgsfield credits into finished, ready-to-post
 * tire-shop reels using the proven chain: Seedance clips (hf CLI) + Google Neural2 VO +
 * ffmpeg assembly (the recipe that shipped 3 live reels). Output: out/<slug>/<slug>.mp4 + caption.txt.
 *
 * Run from apps/nickstire:  pnpm exec tsx scratch/reel-factory.ts [startIndex] [count]
 */
import dotenv from "dotenv";
import { resolve } from "path";
import fs from "fs";
import { spawn, spawnSync } from "child_process";

dotenv.config({ path: resolve(process.cwd(), ".env") });

const HF = "C:/Users/nourd/NOURCITY/node_modules/.pnpm/@higgsfield+cli@0.2.2/node_modules/@higgsfield/cli/vendor/hf.exe";
const FONT = "C\\:/Windows/Fonts/arialbd.ttf";
const OUTROOT = "C:/Users/nourd/reel-factory-out";
delete process.env.HIGGSFIELD_CREDENTIALS_JSON;
delete process.env.HIGGSFIELD_CREDENTIALS_PATH;

type Seg = { clip: number; dur: number; cap: string; size: number };
type Reel = { slug: string; clips: string[]; segs: Seg[]; vo: string; caption: string };

// 12 evergreen tire/auto education reels — 4 cinematic clips + 5 captioned beats each.
const REELS: Reel[] = [
  { slug: "01-tire-pressure", clips: [
      "Cinematic vertical 9:16, macro of a car tire sidewall embossing in shallow focus, cold blue dawn light, slow push in, photoreal, no text",
      "Vertical 9:16, a glowing driver-door-jamb tire sticker in a dark garage, shallow depth of field, warm key light, slow dolly, photoreal, no text",
      "Vertical 9:16, frost on a car window at dawn, an amber TPMS warning light reflected softly in the side mirror, cool palette, photoreal, no text",
      "Vertical 9:16, overhead flat lay of a quality tire pressure gauge on clean concrete, morning light, shallow focus, photoreal, no text" ],
    segs: [ {clip:0,dur:1.5,cap:"THIS NUMBER IS LYING",size:60},{clip:1,dur:3.5,cap:"SIDEWALL = MAX, DOOR = TARGET",size:46},{clip:2,dur:4,cap:"COLD AIR DROPS YOUR PSI",size:50},{clip:3,dur:4,cap:"CHECK IT COLD",size:62},{clip:0,dur:2,cap:"NOT SURE? STOP BY",size:54} ],
    vo: "The big number on your tire is the maximum, not your target. Your real number lives on the driver door sticker. Cold mornings drop your pressure and pop the light. Check it cold, before you drive. Not sure on yours, stop by.",
    caption: "Sidewall = max. Door jamb = target. Check it cold.\n\nComment PRESSURE and we'll point you to your number.\nNick's Tire & Auto, 17625 Euclid Ave, Cleveland.\n\n#cleveland #euclid #tirepressure #tpms #cartips" },

  { slug: "02-tread-depth", clips: [
      "Cinematic vertical 9:16, extreme macro of worn tire tread grooves, rain droplets, dramatic side light, slow dolly, photoreal, no text",
      "Vertical 9:16, a penny held upside down inserted into a tire tread groove, shallow focus, garage light, photoreal, no text",
      "Vertical 9:16, close up of a bald smooth tire on wet pavement, water spray, moody light, slow motion feel, photoreal, no text",
      "Vertical 9:16, fresh deep-tread new tire spinning slowly on a clean stand, studio rim light, photoreal, no text" ],
    segs: [ {clip:0,dur:1.5,cap:"YOUR TIRE HIDES A CANYON",size:50},{clip:1,dur:3,cap:"THE PENNY TEST",size:64},{clip:2,dur:4,cap:"SEE ALL HIS HEAD? TREAD IS GONE",size:42},{clip:3,dur:4,cap:"TIME FOR NEW ONES",size:56},{clip:0,dur:2,cap:"WE CHECK TREAD FREE",size:54} ],
    vo: "Your tire is hiding a canyon. Stick a penny in the groove, Lincoln's head pointing down. If you can see all of his head, the tread is gone. That's your traction in the rain. We check tread for free.",
    caption: "The penny test takes ten seconds and tells you everything.\n\nFree tread check anytime.\nNick's Tire & Auto, Euclid.\n\n#cleveland #euclid #tiretread #pennytest #cartips" },

  { slug: "03-brake-pads", clips: [
      "Cinematic vertical 9:16, macro of a thin worn brake pad next to a brake rotor, garage shadows, dramatic light, slow dolly, photoreal, no text",
      "Vertical 9:16, close up of a brake caliper and rotor on a lifted car, sparks of light, shallow focus, photoreal, no text",
      "Vertical 9:16, a scored grooved metal brake rotor surface, harsh raking light, slow pan, photoreal, no text",
      "Vertical 9:16, a fresh clean brake pad and shiny new rotor on a workbench, soft studio light, photoreal, no text" ],
    segs: [ {clip:0,dur:2,cap:"BRAKES ON A DIET",size:60},{clip:1,dur:3,cap:"PAD WORN THIN",size:62},{clip:2,dur:4,cap:"METAL ON METAL NEXT",size:50},{clip:3,dur:4,cap:"DONT WAIT ON BRAKES",size:50},{clip:0,dur:2,cap:"FREE BRAKE CHECK",size:56} ],
    vo: "Your brakes are on a diet. Once the pad gets this thin, you're one drive from metal on metal, and that gets loud and expensive fast. Don't wait on brakes. A free check tells you exactly how much is left.",
    caption: "That squeal is a warning. Metal on metal is a bill.\n\nFree brake check, no appointment.\nNick's Tire & Auto, Euclid.\n\n#cleveland #euclid #brakes #carcare #cartips" },

  { slug: "04-alignment", clips: [
      "Cinematic vertical 9:16, a steering wheel held straight while a car drifts on an empty road, motion blur edges, dawn light, photoreal, no text",
      "Vertical 9:16, close up of uneven tire wear, one shoulder worn smooth, raking light, slow dolly, photoreal, no text",
      "Vertical 9:16, alignment rack laser lines on a tire in a clean shop, green laser glow, photoreal, no text",
      "Vertical 9:16, a car driving straight and steady down a tree-lined road at dawn, smooth tracking shot, photoreal, no text" ],
    segs: [ {clip:0,dur:2,cap:"CAR PULLING TO ONE SIDE?",size:48},{clip:1,dur:3,cap:"TIRES WEARING UNEVEN",size:50},{clip:2,dur:4,cap:"THAT IS ALIGNMENT",size:58},{clip:3,dur:4,cap:"STRAIGHT AGAIN",size:62},{clip:0,dur:2,cap:"WE WILL CHECK IT",size:54} ],
    vo: "If your car pulls to one side or the wheel sits crooked, that's alignment talking. It also chews one edge of your tires bald. A quick check straightens it out and saves the rubber. Stop by, we'll take a look.",
    caption: "Pulling or crooked wheel? It's eating your tires.\n\nWe'll check your alignment, just stop by.\nNick's Tire & Auto, Euclid.\n\n#cleveland #euclid #wheelalignment #cartips" },

  { slug: "05-winter-battery", clips: [
      "Cinematic vertical 9:16, frost covering a car hood at dawn, breath fog, cold blue light, slow push in, photoreal, no text",
      "Vertical 9:16, close up of a car battery terminal with light corrosion in a cold garage, shallow focus, photoreal, no text",
      "Vertical 9:16, a dashboard at dawn with a slow weak engine crank feeling, dim warm dash glow, photoreal, no text",
      "Vertical 9:16, a technician clamping a battery tester to a clean battery, blue tester light, photoreal, no text" ],
    segs: [ {clip:0,dur:2,cap:"BATTERIES HATE COLD",size:56},{clip:1,dur:3,cap:"COLD STEALS CRANKING POWER",size:42},{clip:2,dur:4,cap:"DIES ON COLD MORNINGS",size:48},{clip:3,dur:4,cap:"TEST IT FREE",size:62},{clip:0,dur:2,cap:"BEFORE IT STRANDS YOU",size:48} ],
    vo: "Your battery hates Cleveland winters. Cold can cut its cranking power by a third, which is why it dies the first freezing morning. A free test now beats a no-start in a parking lot later.",
    caption: "Cold mornings are when weak batteries quit.\n\nFree battery test before the deep freeze.\nNick's Tire & Auto, Euclid.\n\n#cleveland #euclid #carbattery #wintercar #cartips" },

  { slug: "06-oil-sludge", clips: [
      "Cinematic vertical 9:16, dark dirty engine oil dripping off a dipstick, black sludge, dramatic side light, slow motion, photoreal, no text",
      "Vertical 9:16, thick black sludge inside an engine valve cover, harsh light, slow pan, photoreal, no text",
      "Vertical 9:16, clean golden fresh oil pouring into an engine, warm light, slow motion stream, photoreal, no text",
      "Vertical 9:16, a hand pulling a clean dipstick showing honey-colored oil, garage light, photoreal, no text" ],
    segs: [ {clip:0,dur:2,cap:"THIS OIL GAVE UP",size:58},{clip:1,dur:3,cap:"OLD OIL TURNS TO SLUDGE",size:44},{clip:2,dur:4,cap:"FRESH IS CHEAP INSURANCE",size:44},{clip:3,dur:4,cap:"CHECK YOUR DIPSTICK",size:52},{clip:0,dur:2,cap:"QUICK OIL CHANGE",size:56} ],
    vo: "This oil gave up weeks ago. Old oil turns to sludge and grinds your engine from the inside. Fresh oil is the cheapest insurance your car will ever get. Pull your dipstick, and if it's black, come see us.",
    caption: "Old oil = sludge = an engine that wears itself out.\n\nQuick oil change, in and out.\nNick's Tire & Auto, Euclid.\n\n#cleveland #euclid #oilchange #enginecare #cartips" },

  { slug: "07-wiper-blades", clips: [
      "Cinematic vertical 9:16, a windshield wiper smearing rain across glass at night, streaky headlights, moody, photoreal, no text",
      "Vertical 9:16, extreme macro of a cracked split rubber wiper blade edge, raking light, slow dolly, photoreal, no text",
      "Vertical 9:16, blurry rain-streaked view through a windshield of city lights, bokeh, photoreal, no text",
      "Vertical 9:16, a hand clicking a fresh new wiper blade onto a wiper arm, clean light, photoreal, no text" ],
    segs: [ {clip:0,dur:2,cap:"JUST SMEARING NOW",size:56},{clip:1,dur:3,cap:"CRACKED RUBBER EDGE",size:52},{clip:2,dur:4,cap:"STREAKS WHERE IT MATTERS",size:44},{clip:3,dur:4,cap:"TWO MINUTE SWAP",size:56},{clip:0,dur:2,cap:"WELL SORT IT",size:62} ],
    vo: "Your wipers are just smearing now. When the rubber edge cracks, it streaks right where you need to see. They're a two minute swap. Don't wait for a downpour to find out.",
    caption: "Smearing wipers fail exactly when you need them.\n\nTwo minute swap, we'll sort it.\nNick's Tire & Auto, Euclid.\n\n#cleveland #euclid #wiperblades #rainysafety #cartips" },

  { slug: "08-tire-age", clips: [
      "Cinematic vertical 9:16, macro of a tire sidewall DOT date oval stamp, raking light, slow dolly, photoreal, no text",
      "Vertical 9:16, close up of fine cracks in aged tire rubber sidewall, dry rot texture, harsh light, photoreal, no text",
      "Vertical 9:16, an old tire on a parked classic car in a dusty garage, warm light beams, photoreal, no text",
      "Vertical 9:16, a fresh new tire with deep flexible rubber spinning on a stand, studio light, photoreal, no text" ],
    segs: [ {clip:0,dur:2,cap:"TIRES HAVE A BIRTHDAY",size:54},{clip:1,dur:3,cap:"OLD RUBBER CRACKS",size:56},{clip:2,dur:4,cap:"TREAD CAN LOOK FINE",size:52},{clip:3,dur:4,cap:"AGE STILL MATTERS",size:54},{clip:0,dur:2,cap:"WORTH A LOOK",size:60} ],
    vo: "Tires have a birthday too. That little oval stamp is the week and year it was born. Plenty of tread, but six year old rubber cracks and lets go. Worth a look before a long drive.",
    caption: "Find the DOT date. Old rubber fails even with tread.\n\nWe'll read your tire's age, free.\nNick's Tire & Auto, Euclid.\n\n#cleveland #euclid #tiresafety #dryrot #cartips" },

  { slug: "09-tpms-cold", clips: [
      "Cinematic vertical 9:16, an amber tire-pressure dashboard light glowing in a dark car at dawn, shallow focus, photoreal, no text",
      "Vertical 9:16, frost and cold air around a car tire on a freezing morning, blue light, slow dolly, photoreal, no text",
      "Vertical 9:16, sun rising warming a car in a driveway, golden hour, slow timelapse feel, photoreal, no text",
      "Vertical 9:16, a tire being topped up with air at a clean shop, hose and gauge, warm light, photoreal, no text" ],
    segs: [ {clip:0,dur:1.5,cap:"LIGHT ON THIS MORNING?",size:50},{clip:1,dur:3.5,cap:"COLD AIR SHRINKS, PSI DROPS",size:42},{clip:2,dur:4,cap:"WARMS UP, LIGHT GOES OFF",size:46},{clip:3,dur:3,cap:"JUST TOP IT OFF",size:58},{clip:0,dur:2,cap:"WE CAN CHECK IT",size:56} ],
    vo: "Light pops on cold, off by noon? That's not a glitch. Cold air shrinks and your pressure drops, so the light comes on. Sun warms the tire and it clears. Top it back off and you're set.",
    caption: "Morning TPMS light that quits by noon is just cold air.\n\nWe'll set your pressure right.\nNick's Tire & Auto, Euclid.\n\n#cleveland #euclid #tpms #tirepressure #cartips" },

  { slug: "10-pothole-rim", clips: [
      "Cinematic vertical 9:16, a car wheel hitting a deep pothole on a wet street, splash, dramatic slow motion, photoreal, no text",
      "Vertical 9:16, macro of a slightly bent dented alloy wheel rim edge, raking light, slow dolly, photoreal, no text",
      "Vertical 9:16, a steering wheel vibrating subtly at speed, motion blur, dawn light, photoreal, no text",
      "Vertical 9:16, a wheel being checked on a balancing machine in a clean shop, blue light, photoreal, no text" ],
    segs: [ {clip:0,dur:2,cap:"POTHOLE ON THE RECORD",size:54},{clip:1,dur:3,cap:"BENT RIM RISK",size:62},{clip:2,dur:4,cap:"SHAKE OR PULL AFTER?",size:48},{clip:3,dur:4,cap:"WORTH CHECKING",size:60},{clip:0,dur:2,cap:"STOP BY",size:64} ],
    vo: "We got the pothole on the record. A big hit goes straight for the rim. If the wheel shakes or pulls after, that's a bent rim or knocked alignment. Worth getting it looked at before it eats a tire.",
    caption: "Hit a bad pothole? Shake or pull means get it checked.\n\nWe'll take a look, just stop by.\nNick's Tire & Auto, Euclid.\n\n#cleveland #euclid #pothole #bentrim #cartips" },

  { slug: "11-rotation", clips: [
      "Cinematic vertical 9:16, four car tires lined up showing different wear, garage light, slow pan, photoreal, no text",
      "Vertical 9:16, close up of a front tire worn more than a rear tire, raking light, shallow focus, photoreal, no text",
      "Vertical 9:16, a tire being moved and mounted in a clean shop, motion, warm light, photoreal, no text",
      "Vertical 9:16, four evenly worn matching tires on a car driving smoothly at dawn, tracking shot, photoreal, no text" ],
    segs: [ {clip:0,dur:2,cap:"NOT ALL TIRES WEAR EVEN",size:46},{clip:1,dur:3,cap:"FRONTS GO FASTER",size:56},{clip:2,dur:4,cap:"ROTATE TO EVEN IT OUT",size:48},{clip:3,dur:4,cap:"MORE MILES, ALL FOUR",size:50},{clip:0,dur:2,cap:"QUICK ROTATION",size:58} ],
    vo: "Your front tires wear faster than the rears, so without rotation two go bald early. A quick rotation evens the wear and stretches every tire's life. Easy win, big savings over time.",
    caption: "Rotate and all four tires last longer. Easy savings.\n\nQuick rotation while you wait.\nNick's Tire & Auto, Euclid.\n\n#cleveland #euclid #tirerotation #cartips #savemoney" },

  { slug: "12-curb-alignment", clips: [
      "Cinematic vertical 9:16, a car tire scraping hard against a curb, slow motion, dramatic light, photoreal, no text",
      "Vertical 9:16, close up of a wheel turned at an angle near a curb, dusk light, shallow focus, photoreal, no text",
      "Vertical 9:16, a steering wheel slightly off center while driving straight, motion blur, photoreal, no text",
      "Vertical 9:16, green alignment laser lines on a wheel in a clean shop, photoreal, no text" ],
    segs: [ {clip:0,dur:2,cap:"CLIPPED A CURB?",size:58},{clip:1,dur:3,cap:"IT CAN KNOCK ALIGNMENT",size:48},{clip:2,dur:4,cap:"WHEEL SITS OFF CENTER",size:48},{clip:3,dur:4,cap:"A CHECK SETS IT RIGHT",size:48},{clip:0,dur:2,cap:"WE WILL LOOK",size:60} ],
    vo: "Clipped a curb harder than you meant to? That little hit can knock your alignment off. Tell-tale sign is the wheel sitting off center while you drive straight. A quick check sets it right before your tires pay for it.",
    caption: "A hard curb hit can throw your alignment off.\n\nWheel off center? We'll check it.\nNick's Tire & Auto, Euclid.\n\n#cleveland #euclid #wheelalignment #curbcheck #cartips" },

  // ─── Nonstop Nick · NICE — satisfying faceless install (brand value) ───
  { slug: "13-fast-install", clips: [
      "Cinematic vertical 9:16, a worn bald car tire being lifted away in a clean auto shop, dramatic side light, slow motion, photoreal, no people faces, no text",
      "Vertical 9:16, a tire mounting machine seating a fresh black tire onto an alloy wheel, rubber flexing, satisfying, shallow focus, warm shop light, photoreal, no text",
      "Vertical 9:16, macro of a wheel balancing machine spinning a tire, a small grey wheel weight clipped to the rim, precise, cool light, photoreal, no text",
      "Vertical 9:16, a freshly mounted glossy new tire rolling across a clean polished shop floor, motion blur, golden light, photoreal, no text" ],
    segs: [ {clip:0,dur:2,cap:"OLD AND BALD? GONE",size:56},{clip:1,dur:4,cap:"MOUNTED FRESH",size:64},{clip:2,dur:4,cap:"BALANCED TO THE GRAM",size:50},{clip:3,dur:3,cap:"UNDER 20 MINUTES",size:60},{clip:0,dur:2,cap:"WALK IN, ROLL OUT",size:56} ],
    vo: "Old and bald comes right off. A fresh tire goes on the machine and seats up clean. Then we balance it to the gram, so your ride stays smooth at speed. New rubber, balanced and rolling, usually in under twenty minutes. Walk in any day and roll out right.",
    caption: "Bald in, balanced out — usually under 20 minutes.\n\nNo appointment, 7 days a week.\nComment TIRES and we'll get you rolling.\nNick's Tire & Auto, 17625 Euclid Ave, Cleveland.\n\n#cleveland #euclid #newtires #tireshop #cartips" },

  // ─── Nonstop Nick · USEFULLY ABSURD — the slow-leak bubble test ───
  { slug: "14-slow-leak", clips: [
      "Cinematic vertical 9:16, extreme macro of a black car tire submerged in a clear water tank, one thin stream of tiny silver bubbles rising from a hidden puncture, dramatic backlight, photoreal, no text",
      "Vertical 9:16, macro of a small nail head barely visible buried in a wet black tire tread, water droplets, shallow focus, moody light, photoreal, no text",
      "Vertical 9:16, macro of a corroded alloy wheel rim edge with chalky white corrosion where it meets the tire bead, cool light, shallow focus, photoreal, no text",
      "Vertical 9:16, extreme macro of a tire valve stem with a single soap bubble swelling at its tip, dark background, dramatic light, photoreal, no text" ],
    segs: [ {clip:0,dur:2,cap:"YOUR TIRE IS GASLIGHTING YOU",size:42},{clip:1,dur:3.5,cap:"A NAIL HIDES IN THE TREAD",size:46},{clip:2,dur:3.5,cap:"OR CORROSION ON THE RIM",size:48},{clip:3,dur:3.5,cap:"OR A SNEAKY VALVE LEAK",size:48},{clip:0,dur:2.5,cap:"WE FIND THE BUBBLE",size:58} ],
    vo: "Keep adding air and it keeps going soft? Your tire is hiding a secret. Drop it in the tank and the truth bubbles right up. Could be a nail buried in the tread, corrosion creeping on the rim, or a tired old valve. We find the leak before it leaves you on the shoulder.",
    caption: "If your tire keeps going soft, it's hiding a slow leak.\n\nA nail, a corroded rim, or a worn valve — we find the bubble.\nComment LEAK and stop by.\nNick's Tire & Auto, Euclid.\n\n#cleveland #euclid #slowleak #tirerepair #cartips" },
];

function sh(cmd: string, args: string[], timeoutMs = 240000): Promise<{ code: number; out: string }> {
  return new Promise((res) => {
    const c = spawn(cmd, args, { env: process.env });
    let out = "";
    c.stdout.on("data", (d) => (out += d.toString()));
    c.stderr.on("data", (d) => (out += d.toString()));
    const timer = setTimeout(() => { c.kill("SIGKILL"); res({ code: 124, out: out + "\n[TIMEOUT]" }); }, timeoutMs);
    c.on("close", (code) => { clearTimeout(timer); res({ code: code ?? 1, out }); });
  });
}

async function genClip(prompt: string, dest: string): Promise<void> {
  const { code, out } = await sh(HF, ["generate", "create", "seedance1_5", "--prompt", prompt, "--aspect_ratio", "9:16", "--duration", "4", "--resolution", "1080p", "--wait", "--json"]);
  if (code !== 0) throw new Error(`seedance failed (${code}): ${out.slice(-300)}`);
  const url = (out.match(/https?:\/\/[^"]+\.(mp4|mov|webm)/) || [])[0];
  if (!url) throw new Error(`no clip url in: ${out.slice(-300)}`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`download ${resp.status}`);
  fs.writeFileSync(dest, Buffer.from(await resp.arrayBuffer()));
}

async function genVO(text: string, dest: string): Promise<void> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "").replace(/\\n/g, "\n").replace(/^"|"$/g, "");
  const { google } = await import("googleapis");
  const jwt = new google.auth.JWT({ email, key, scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const { token } = await jwt.getAccessToken();
  const r = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input: { text }, voice: { languageCode: "en-US", name: "en-US-Neural2-J" }, audioConfig: { audioEncoding: "LINEAR16", speakingRate: 0.97, pitch: -1.5 } }),
  });
  if (!r.ok) throw new Error(`tts ${r.status}: ${(await r.text()).slice(0, 200)}`);
  fs.writeFileSync(dest, Buffer.from(((await r.json()) as { audioContent: string }).audioContent, "base64"));
}

function assemble(reel: Reel, dir: string, outPath: string): Promise<{ code: number; out: string }> {
  const total = reel.segs.reduce((a, s) => a + s.dur, 0);
  const inputs: string[] = [];
  reel.clips.forEach((_, i) => inputs.push("-i", resolve(dir, `clip${i}.mp4`)));
  inputs.push("-i", resolve(dir, "vo.wav"));
  const voIdx = reel.clips.length;
  const fc: string[] = [];
  reel.segs.forEach((s, i) => fc.push(`[${s.clip}:v]trim=0:${s.dur},setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p[v${i}]`));
  fc.push(`${reel.segs.map((_, i) => `[v${i}]`).join("")}concat=n=${reel.segs.length}:v=1:a=0[vc]`);
  let cum = 0, label = "vc";
  reel.segs.forEach((s, i) => {
    const start = cum, end = cum + s.dur; cum = end;
    const next = i === reel.segs.length - 1 ? "vout" : `d${i}`;
    const txt = s.cap.replace(/['%\\]/g, "");
    fc.push(`[${label}]drawtext=fontfile='${FONT}':text='${txt}':fontsize=${s.size}:fontcolor=white:borderw=5:bordercolor=black:box=1:boxcolor=black@0.42:boxborderw=26:x=(w-text_w)/2:y=h-h/4:enable='gte(t,${start.toFixed(2)})*lt(t,${end.toFixed(2)})'[${next}]`);
    label = next;
  });
  fc.push(`[${voIdx}:a]volume=1.25,atrim=0:${total},asetpts=PTS-STARTPTS[aout]`);
  const args = [...inputs, "-filter_complex", fc.join(";"), "-map", "[vout]", "-map", "[aout]", "-r", "30", "-t", String(total), "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-y", outPath];
  return sh("ffmpeg", args, 180000);
}

async function main() {
  const startIdx = Number(process.argv[2] ?? 0);
  const count = Number(process.argv[3] ?? REELS.length);
  fs.mkdirSync(OUTROOT, { recursive: true });
  const slice = REELS.slice(startIdx, startIdx + count);
  console.log(`FACTORY: building ${slice.length} reels (${startIdx}..${startIdx + slice.length - 1})`);
  for (const reel of slice) {
    const t0 = Date.now();
    const dir = resolve(OUTROOT, reel.slug);
    const finalOut = resolve(dir, `${reel.slug}.mp4`);
    if (fs.existsSync(finalOut)) { console.log(`SKIP ${reel.slug} (exists)`); continue; }
    fs.mkdirSync(dir, { recursive: true });
    try {
      console.log(`\n[${reel.slug}] generating ${reel.clips.length} clips...`);
      for (let i = 0; i < reel.clips.length; i++) {
        const clipPath = resolve(dir, `clip${i}.mp4`);
        // Resume after a transient fetch failure: skip clips already rendered
        // (a valid clip is >1MB; a partial/corrupt one is regenerated).
        if (fs.existsSync(clipPath) && fs.statSync(clipPath).size > 1_000_000) {
          console.log(`  clip${i} exists, skip`);
          continue;
        }
        await genClip(reel.clips[i], clipPath);
        console.log(`  clip${i} ok (${Math.round((Date.now() - t0) / 1000)}s)`);
      }
      console.log(`[${reel.slug}] voiceover...`);
      await genVO(reel.vo, resolve(dir, "vo.wav"));
      console.log(`[${reel.slug}] assembling...`);
      const { code, out } = await assemble(reel, dir, finalOut);
      if (code !== 0) throw new Error(`ffmpeg ${code}: ${out.slice(-300)}`);
      fs.writeFileSync(resolve(dir, "caption.txt"), reel.caption);
      console.log(`DONE ${reel.slug} -> ${finalOut} (${Math.round((Date.now() - t0) / 1000)}s, ${(fs.statSync(finalOut).size / 1e6).toFixed(1)}MB)`);
    } catch (e) {
      console.error(`FAILED ${reel.slug}:`, (e as Error).message);
    }
  }
  console.log(`\nFACTORY DONE. Output: ${OUTROOT}`);
}
main();
