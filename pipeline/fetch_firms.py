"""Download REAL detections from NASA FIRMS for the configured regions.

Get a free MAP_KEY at https://firms.modaps.eosdis.nasa.gov/api/map_key/ and run:
    FIRMS_MAP_KEY=xxxx python fetch_firms.py [region_id ...]

Uses the area API (max 5 days per request, 5000 requests / 10 min). Standard-processing
archives: MODIS_SP (2000-) and VIIRS_SNPP_SP (2012-). Output matches make_synthetic.py,
so harmonize.py runs unchanged. Resumable: finished (region, sensor) files are skipped.
"""
import io, os, sys, time
import pandas as pd, requests
from common import *

KEY = os.environ.get("FIRMS_MAP_KEY")
SOURCES = {"modis": ("MODIS_SP", "2003-01-01"), "viirs": ("VIIRS_SNPP_SP", "2012-01-20")}
URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{src}/{bbox}/5/{date}"


def fetch(region, sensor):
    out = f"../data/raw/{region}_{sensor}.csv.gz"
    if os.path.exists(out):
        print("skip", out); return
    src, first = SOURCES[sensor]
    bbox = ",".join(str(v) for v in REGIONS[region]["bbox"])
    parts = []
    for d in pd.date_range(first, f"{END_YEAR}-12-31", freq="5D"):
        for attempt in range(8):
            try:
                r = requests.get(URL.format(key=KEY, src=src, bbox=bbox, date=d.strftime("%Y-%m-%d")), timeout=90)
                if r.ok and not r.text.startswith(("Invalid", "You have exceeded")):
                    break
                err = r.text[:200]
            except requests.RequestException as e:   # timeouts / dropped connections: retry
                err = repr(e)[:200]
            time.sleep(min(60, 5 * (attempt + 1)))
        else:
            sys.exit(f"FIRMS request failed for {region} {sensor} {d.date()}: {err}")
        if len(parts) % 100 == 0:
            print(f"  {region} {sensor}: {d.date()} ({len(parts)} chunks)", flush=True)
        if r.text.strip():
            parts.append(pd.read_csv(io.StringIO(r.text)))
        time.sleep(0.15)
    df = pd.concat(parts, ignore_index=True)
    df = df.rename(columns={"latitude": "lat", "longitude": "lon", "acq_date": "date"})
    df = df[df["date"] <= f"{END_YEAR}-12-31"]
    # keep plausible fire detections only (nominal/high confidence)
    if "confidence" in df:
        c = df["confidence"].astype(str)
        df = df[c.isin(["n", "h", "nominal", "high"]) | pd.to_numeric(c, errors="coerce").ge(30)]
    if "type" in df:   # 0 = presumed vegetation fire; drop volcano / static land source / offshore
        df = df[df["type"] == 0]
    df[["date", "lat", "lon", "frp"]].to_csv(out, index=False)
    print("wrote", out, len(df))


if __name__ == "__main__":
    if not KEY:
        sys.exit("Set FIRMS_MAP_KEY first (see docstring).")
    for rid in (sys.argv[1:] or REGIONS):
        for s in SOURCES:
            fetch(rid, s)
