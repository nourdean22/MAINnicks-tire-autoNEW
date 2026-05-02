"""Single-threaded GPS scan — fast since exifread is header-only."""
import os, json, math, time
from pathlib import Path
import exifread

PHOTOS = Path("C:/Users/nourd/iCloudPhotos/Photos")
SHOP_LAT, SHOP_LON, RADIUS = 41.5525118, -81.5571875, 200


def dms(d, ref):
    parts = [float(r.num) / float(r.den) for r in d.values]
    v = parts[0] + parts[1] / 60 + parts[2] / 3600
    return -v if ref in ("S", "W") else v


def haver(la1, lo1, la2, lo2):
    R = 6371000
    p1, p2 = math.radians(la1), math.radians(la2)
    dp = math.radians(la2 - la1)
    dl = math.radians(lo2 - lo1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


start = time.time()
candidates = [
    e for e in os.scandir(PHOTOS)
    if e.is_file()
    and not e.name.startswith(".")
    and os.path.splitext(e.name)[1].lower() in {".jpg", ".jpeg", ".heic"}
]
print(f"[scan] {len(candidates)} files", flush=True)

matches = []
for i, e in enumerate(candidates):
    if i % 2000 == 0:
        print(f"  {i}/{len(candidates)}", flush=True)
    try:
        with open(e.path, "rb") as f:
            t = exifread.process_file(f, stop_tag="GPSLongitude", details=False)
        if not t.get("GPS GPSLatitude"):
            continue
        lat = dms(t["GPS GPSLatitude"], str(t.get("GPS GPSLatitudeRef", "N")))
        lon = dms(t["GPS GPSLongitude"], str(t.get("GPS GPSLongitudeRef", "W")))
        d = haver(lat, lon, SHOP_LAT, SHOP_LON)
        if d <= RADIUS:
            matches.append({
                "name": e.name,
                "path": e.path,
                "size_kb": e.stat().st_size // 1024,
                "lat": lat,
                "lon": lon,
                "distance_m": round(d, 1),
                "date": str(t.get("EXIF DateTimeOriginal") or t.get("Image DateTime") or ""),
            })
    except Exception:
        continue

elapsed = time.time() - start
print(f"[done] {elapsed:.1f}s, {len(matches)} matches")
out = Path("tmp/shop-photo-candidates.json")
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(matches, indent=2))
print("Top 20 matches by distance:")
for m in sorted(matches, key=lambda x: x["distance_m"])[:20]:
    print(f"  {m['name'][:36]:36s} {m['size_kb']:5d}KB  {m['distance_m']:6.1f}m  {m['date'][:20]}")
