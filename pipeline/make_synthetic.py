"""Generate SYNTHETIC MODIS/VIIRS-like detections so the pipeline and app can be
developed without a FIRMS key. NOT real data - never present results from this.

A latent "true burning activity" field drives both sensors, but they respond
differently (MODIS: coarser pixels, sub-linear, 2000+; VIIRS: 375 m, 2012+),
so harmonization has something real to correct.
"""
import numpy as np, pandas as pd
from common import *

rng = np.random.default_rng(42)


def smooth(a, k=3):
    for _ in range(k):
        a = (a + np.roll(a, 1, 0) + np.roll(a, -1, 0) + np.roll(a, 1, 1) + np.roll(a, -1, 1)) / 5
    return a


for rid, cfg in REGIONS.items():
    west, south, nx, ny = grid(cfg["bbox"])
    spatial = np.exp(1.6 * smooth(rng.normal(size=(ny, nx)), 3) / 0.25 * 0.25 * 4)
    spatial = (spatial / spatial.mean()).ravel()
    NW = n_weeks()
    wk = np.arange(NW) % WEEKS_PER_YEAR
    yr = np.arange(NW) // WEEKS_PER_YEAR
    season = np.exp(-0.5 * ((wk - cfg["peak_week"]) / 4.5) ** 2) + 0.01
    year_f = np.exp(rng.normal(0, 0.45, size=END_YEAR - START_YEAR + 1) + 0.02 * np.arange(END_YEAR - START_YEAR + 1))
    lam = 6.0 * spatial[:, None] * (season * year_f[yr])[None, :]          # latent activity
    lam *= np.exp(rng.normal(0, 0.25, size=lam.shape))
    sensors = {
        "modis": rng.poisson(0.35 * lam ** 0.85),
        "viirs": rng.poisson(lam),
    }
    sensors["viirs"][:, : viirs_start_week()] = 0
    for s, counts in sensors.items():
        cell, week = np.nonzero(counts)
        reps = counts[cell, week]
        cell, week = np.repeat(cell, reps), np.repeat(week, reps)
        iy, ix = cell // nx, cell % nx
        lat = south + (iy + rng.random(len(cell))) * CELL
        lon = west + (ix + rng.random(len(cell))) * CELL
        day = (START_YEAR - 1970) * 365.25 + 0  # placeholder replaced below
        y = START_YEAR + week // WEEKS_PER_YEAR
        doy = (week % WEEKS_PER_YEAR) * 7 + rng.integers(0, 7, len(week))
        date = pd.to_datetime(y.astype(str) + "-01-01") + pd.to_timedelta(doy, unit="D")
        df = pd.DataFrame(dict(date=date.strftime("%Y-%m-%d"), lat=lat.round(4), lon=lon.round(4),
                               frp=np.round(rng.lognormal(2.0, 0.9, len(cell)), 1)))
        df.to_csv(f"../data/raw/{rid}_{s}.csv.gz", index=False)
        print(rid, s, len(df), "detections")
