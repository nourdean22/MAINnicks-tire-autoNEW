"""Run the Nick's corpus through Video Forge profiles and record reproducible evidence.

    python bench/run_bench.py --url $FORGE_URL --profiles ltx-2.5-distilled,wan2.2-ti2v-5b \
        --arms text,hero --hero-dir ./heroes --out bench/results/<run>.jsonl [--limit N]

Per (case, profile, arm) it records: status, error_code, wall latency, gpu_seconds,
gpu_type, model/workflow version, seed, output sha256/bytes/dims/fps/duration, and
the downloaded mp4 path. It does NOT invent quality scores: quality comes from the
existing nickstire rendered-QA pass and from blind pairwise review
(make_pairwise.py). Cost per ACCEPTED clip = sum(gpu_seconds × rate over ALL
attempts) / accepted clips, computed in summarize.py once reviews exist.

Idempotency keys are deterministic (bench-<corpus>-<case>-<profile>-<arm>), so a
crashed run resumes without paying for any render twice.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def call(url: str, secret: str, method: str, path: str, body: dict | None = None, raw: bool = False):
    payload = json.dumps(body).encode() if body is not None else b""
    ts = str(int(time.time()))
    sig = hmac.new(secret.encode(), f"{ts}.{method}.{path}.{hashlib.sha256(payload).hexdigest()}".encode(), hashlib.sha256).hexdigest()
    req = urllib.request.Request(url + path, data=payload if method == "POST" else None, method=method,
                                 headers={"x-forge-timestamp": ts, "x-forge-signature": sig, "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            data = r.read()
            return r.status, (data if raw else json.loads(data))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def shot_prompt(case: dict) -> str:
    # Same block spec nickstire's buildStructuredVideoPrompt produces; Forge-side
    # adapters are exercised by nickstire, so the bench sends the canonical form.
    blocks = [("SUBJECT", case.get("objectCharacter") or case["visual"]), ("SCENE", case["visual"]),
              ("ACTION AND CAMERA MOTION", case.get("motion", "")), ("AUDIO", case.get("audioCue", ""))]
    return "\n".join(f"{k}: {v}" for k, v in blocks if v)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=os.environ.get("FORGE_URL", "http://127.0.0.1:8787"))
    ap.add_argument("--secret", default=os.environ.get("FORGE_SECRET", ""))
    ap.add_argument("--profiles", required=True)
    ap.add_argument("--arms", default="text")
    ap.add_argument("--hero-dir", default=None)
    ap.add_argument("--corpus", default=str(Path(__file__).with_name("corpus.v1.jsonl")))
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--width", type=int, default=704)
    ap.add_argument("--height", type=int, default=1280)
    ap.add_argument("--duration", type=int, default=5)
    a = ap.parse_args()
    cases = [json.loads(l) for l in Path(a.corpus).read_text().splitlines() if l.strip()]
    if a.limit:
        cases = cases[: a.limit]
    out = Path(a.out); out.parent.mkdir(parents=True, exist_ok=True)
    clips = out.with_suffix(""); clips.mkdir(exist_ok=True)
    corpus_id = Path(a.corpus).stem
    pending = []
    for case in cases:
        for profile in a.profiles.split(","):
            for arm in a.arms.split(","):
                body = {"idempotency_key": f"bench-{corpus_id}-{case['case_id']}-{profile}-{arm}", "profile": profile, "prompt": shot_prompt(case),
                        "seed": case["seed"], "duration_seconds": a.duration, "width": a.width, "height": a.height, "fps": 24,
                        "metadata": {"bench": corpus_id, "case": case["case_id"], "arm": arm}}
                if arm == "hero":
                    hero = Path(a.hero_dir or "") / f"{case['case_id']}.png"
                    if not hero.exists():
                        continue  # no approved hero for this case: skip, never fabricate one
                    body["start_image_b64"] = base64.b64encode(hero.read_bytes()).decode()
                t0 = time.time()
                st, j = call(a.url, a.secret, "POST", "/v1/jobs", body)
                if st >= 400:
                    pending.append({"case": case, "profile": profile, "arm": arm, "submit_error": j, "t0": t0})
                else:
                    pending.append({"case": case, "profile": profile, "arm": arm, "job_id": j["job"]["id"], "t0": t0})
    with out.open("a") as fh:
        for p in pending:
            row = {"case_id": p["case"]["case_id"], "categories": p["case"]["categories"], "profile": p["profile"], "arm": p["arm"], "corpus_sha256": p["case"]["sha256"]}
            if "submit_error" in p:
                row.update(status="rejected", error=p["submit_error"])
            else:
                while True:
                    _, j = call(a.url, a.secret, "GET", f"/v1/jobs/{p['job_id']}")
                    job = j["job"]
                    if job["status"] in ("succeeded", "failed", "cancelled"):
                        break
                    time.sleep(2)
                row.update(job_id=job["id"], status=job["status"], error_code=job["error_code"], wall_s=round(time.time() - p["t0"], 2),
                           gpu_seconds=job["gpu_seconds"], gpu_type=job["gpu_type"], model_version=job["model_version"],
                           workflow_version=job["workflow_version"], seed=job["seed"], output=job["output"])
                if job["status"] == "succeeded":
                    _, blob = call(a.url, a.secret, "GET", f"/v1/jobs/{job['id']}/output", raw=True)
                    path = clips / f"{row['case_id']}__{p['profile']}__{p['arm']}.mp4"
                    path.write_bytes(blob)
                    row["clip"] = str(path)
                    row["sha_ok"] = hashlib.sha256(blob).hexdigest() == job["output"]["sha256"]
            fh.write(json.dumps(row) + "\n")
            print(row["case_id"], row["profile"], row["arm"], row["status"], row.get("gpu_seconds"))


if __name__ == "__main__":
    main()
