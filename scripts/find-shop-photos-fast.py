"""
Faster iCloud Photos GPS scanner using exifread (header-only, no decode).

Strategy: walk every JPG/HEIC, parse EXIF GPS from file headers without
decoding pixels. Keep anything within 200m of the shop.

Output: tmp/shop-photo-candidates.json
"""

import os
import sys
import json
import math
from pathlib import Path
import exifread

PHOTOS = Path("C:/Users/nourd/iCloudPhotos/Photos")
SHOP_LAT = 41.5525118
SHOP_LON = -81.5571875
RADIUS_METERS = 200


def dms_to_decimal(dms_ratios, ref):
    parts = [float(r.num) / float(r.den) for r in dms_ratios.values]
    deg, minutes, sec = parts[0], parts[1], parts[2]
    val = deg + minutes / 60 + sec / 3600
    return -val if ref in ("S", "W") else val


def haversine_m(lat1, lon1, lat2, lon2):
    R = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def main():
    if not PHOTOS.exists():
        print(f"[error] {PHOTOS} not found", file=sys.stderr)
        sys.exit(1)

    matches = []
    scanned = 0
    skipped_no_gps = 0

    print(f"[scan] walking {PHOTOS}", flush=True)
    for path in PHOTOS.iterdir():
        if path.name.startswith("."):
            continue
        ext = path.suffix.lower()
        if ext not in {".jpg", ".jpeg", ".heic", ".png"}:
            continue
        scanned += 1
        if scanned % 1000 == 0:
            print(f"  ... scanned {scanned}, matches={len(matches)}", flush=True)

        try:
            with open(path, "rb") as f:
                tags = exifread.process_file(f, stop_tag="GPSLongitude", details=False)
        except Exception:
            skipped_no_gps += 1
            continue

        lat_dms = tags.get("GPS GPSLatitude")
        lat_ref = tags.get("GPS GPSLatitudeRef")
        lon_dms = tags.get("GPS GPSLongitude")
        lon_ref = tags.get("GPS GPSLongitudeRef")
        if not (lat_dms and lat_ref and lon_dms and lon_ref):
            skipped_no_gps += 1
            continue

        try:
            lat = dms_to_decimal(lat_dms, str(lat_ref))
            lon = dms_to_decimal(lon_dms, str(lon_ref))
        except Exception:
            continue

        dist = haversine_m(lat, lon, SHOP_LAT, SHOP_LON)
        if dist <= RADIUS_METERS:
            dt = tags.get("EXIF DateTimeOriginal") or tags.get("Image DateTime")
            matches.append({
                "path": str(path),
                "name": path.name,
                "size_kb": path.stat().st_size // 1024,
                "lat": lat,
                "lon": lon,
                "distance_m": round(dist, 1),
                "date": str(dt) if dt else None,
            })

    out = Path(__file__).resolve().parent.parent / "tmp" / "shop-photo-candidates.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(matches, indent=2, default=str))

    print()
    print(f"[done] scanned: {scanned}")
    print(f"[done] no GPS: {skipped_no_gps}")
    print(f"[done] matches within {RADIUS_METERS}m: {len(matches)}")
    print(f"[done] manifest: {out}")
    if matches:
        print()
        print("Sample matches (first 15, sorted by distance):")
        for m in sorted(matches, key=lambda x: x["distance_m"])[:15]:
            print(f"  {m['name'][:36]:36s}  {m['size_kb']:5d}KB  {m['distance_m']:6.1f}m  {m['date']}")


if __name__ == "__main__":
    main()
