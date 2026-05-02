"""
Multiprocess GPS scan of iCloud Photos.

Skips PNG (no EXIF), uses exifread (header-only), parallelizes
across CPU cores. 8 workers × ~80ms/file = ~3 min for 15K JPG/HEIC.
"""

import os
import sys
import json
import math
import warnings
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# Silence exifread's PNG warning
warnings.filterwarnings("ignore")

PHOTOS = Path("C:/Users/nourd/iCloudPhotos/Photos")
SHOP_LAT = 41.5525118
SHOP_LON = -81.5571875
RADIUS_METERS = 200


def haversine_m(lat1, lon1, lat2, lon2):
    R = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def dms_to_decimal(dms_ratios, ref):
    parts = [float(r.num) / float(r.den) for r in dms_ratios.values]
    deg, minutes, sec = parts[0], parts[1], parts[2]
    val = deg + minutes / 60 + sec / 3600
    return -val if ref in ("S", "W") else val


def check_file(path_str):
    """Worker: returns dict if photo has GPS within radius, else None."""
    import exifread  # imported per-worker
    path = Path(path_str)
    try:
        with open(path, "rb") as f:
            tags = exifread.process_file(f, stop_tag="GPSLongitude", details=False)
    except Exception:
        return None

    lat_dms = tags.get("GPS GPSLatitude")
    lat_ref = tags.get("GPS GPSLatitudeRef")
    lon_dms = tags.get("GPS GPSLongitude")
    lon_ref = tags.get("GPS GPSLongitudeRef")
    if not (lat_dms and lat_ref and lon_dms and lon_ref):
        return None

    try:
        lat = dms_to_decimal(lat_dms, str(lat_ref))
        lon = dms_to_decimal(lon_dms, str(lon_ref))
    except Exception:
        return None

    dist = haversine_m(lat, lon, SHOP_LAT, SHOP_LON)
    if dist > RADIUS_METERS:
        return None

    dt = tags.get("EXIF DateTimeOriginal") or tags.get("Image DateTime")
    return {
        "path": str(path),
        "name": path.name,
        "size_kb": path.stat().st_size // 1024,
        "lat": lat,
        "lon": lon,
        "distance_m": round(dist, 1),
        "date": str(dt) if dt else None,
    }


def main():
    if not PHOTOS.exists():
        print(f"[error] {PHOTOS} not found", file=sys.stderr)
        sys.exit(1)

    print(f"[scan] enumerating {PHOTOS}", flush=True)
    candidates = []
    for entry in os.scandir(PHOTOS):
        if entry.name.startswith("."):
            continue
        if not entry.is_file():
            continue
        ext = os.path.splitext(entry.name)[1].lower()
        if ext not in {".jpg", ".jpeg", ".heic"}:
            continue
        candidates.append(entry.path)
    total = len(candidates)
    print(f"[scan] {total} JPG/HEIC files to check", flush=True)

    matches = []
    completed = 0
    # Threads (not processes) — exifread is I/O bound, threads release the
    # GIL during file reads so we get real parallelism without the slow
    # Windows process-spawn overhead.
    with ThreadPoolExecutor(max_workers=16) as ex:
        futures = {ex.submit(check_file, p): p for p in candidates}
        for fut in as_completed(futures):
            completed += 1
            if completed % 1000 == 0:
                print(f"  ... {completed}/{total} checked, matches={len(matches)}", flush=True)
            res = fut.result()
            if res:
                matches.append(res)

    out = Path(__file__).resolve().parent.parent / "tmp" / "shop-photo-candidates.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(matches, indent=2, default=str))

    print()
    print(f"[done] checked: {completed}")
    print(f"[done] matches within {RADIUS_METERS}m: {len(matches)}")
    print(f"[done] manifest: {out}")
    if matches:
        print()
        print("Top 20 matches by distance:")
        for m in sorted(matches, key=lambda x: x["distance_m"])[:20]:
            print(f"  {m['name'][:36]:36s}  {m['size_kb']:5d}KB  {m['distance_m']:6.1f}m  {m['date']}")


if __name__ == "__main__":
    main()
