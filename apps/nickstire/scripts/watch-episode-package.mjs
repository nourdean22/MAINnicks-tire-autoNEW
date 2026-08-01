/**
 * watch-episode-package.mjs · READ-ONLY
 *
 * Watches a fresh reel episode to a terminal state and prints the PUBLISH
 * PACKAGE — clips, mp4, hashtag count against the 5 cap, fabricated-stat scan,
 * CTA type, and the exact stored caption.
 *
 * The point is a single decision-ready verdict: READY FOR PUBLISH DECISION only
 * when every check passes. It never publishes; publishing is an operator action.
 *
 * SAFETY: SELECT only.
 */
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
const url = readFileSync("C:/Users/nourd/NOURCITY/apps/nickstire/.env","utf8")
  .split(/\r?\n/).find(l=>l.startsWith("DATABASE_URL="))?.slice(13).trim().replace(/^["']|["']$/g,"");
const c = await mysql.createConnection({uri:url, ssl:{rejectUnauthorized:true}});
const BASE = 1200004, DEADLINE = Date.now() + 40*60_000;
const TERM = new Set(["assembled","published","posted","failed","publish_ambiguous","discarded"]);
const et = () => new Date(Date.now()-4*3600e3).toISOString().slice(11,19);
let verdict = null;
while (Date.now() < DEADLINE && !verdict) {
  const [r] = await c.execute(
    "SELECT id,status,attempts,caption,clipUrlsJson,mp4Url,LEFT(COALESCE(error,''),90) err FROM reel_jobs WHERE id>? ORDER BY id",[BASE]);
  if (!r.length) console.log(`  ${et()} (no job yet)`);
  for (const j of r) {
    let clips=[]; try{clips=JSON.parse(j.clipUrlsJson||"[]").filter(Boolean)}catch{}
    const tags=(j.caption||"").match(/#\w+/g)||[];
    console.log(`  ${et()} #${j.id} ${String(j.status).padEnd(11)} att=${j.attempts} clips=${clips.length} tags=${tags.length}${j.err?"  ERR: "+j.err:""}`);
    if (TERM.has(j.status)) { verdict = { j, clips, tags }; break; }
  }
  if (!verdict) await new Promise(r=>setTimeout(r,60_000));
}
console.log("");
if (!verdict) { console.log("VERDICT: TIMEOUT — no episode reached a terminal state in 40m"); }
else {
  const { j, clips, tags } = verdict;
  console.log(`═══ EPISODE PACKAGE · #${j.id} ═══`);
  console.log(`status      : ${j.status}${j.err?"\nerror       : "+j.err:""}`);
  console.log(`clips       : ${clips.length}${clips[0]?" · "+String(clips[0]).split("/").pop():""}`);
  console.log(`mp4         : ${j.mp4Url?String(j.mp4Url).split("/").pop():"NONE"}`);
  console.log(`hashtags    : ${tags.length} (cap 5) ${tags.length<=5?"OK":"OVER CAP"}`);
  const fab=/\bwe\b[^.!?]{0,60}\b(see|seen|find|found|had|never|always)\b[^.!?]{0,30}\b(zero|none|\d{1,3}\s?%)/i.test(j.caption||"");
  console.log(`fabricated  : ${fab?"PRESENT — DO NOT PUBLISH":"none detected"}`);
  console.log(`cta         : ${/send this/i.test(j.caption||"")?"send":/save this/i.test(j.caption||"")?"save":"other/none"}`);
  console.log(`\ncaption:\n${j.caption||"(none)"}`);
  const ok = j.status==="assembled" && tags.length<=5 && !fab && clips.length>0 && !!j.mp4Url;
  console.log(`\nVERDICT: ${ok?"READY FOR PUBLISH DECISION":"NOT READY"}`);
}
await c.end();
