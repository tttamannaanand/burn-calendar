"""Harmonize MODIS onto the VIIRS 375 m scale and write web-ready JSON.

Method (per region):
  1. Grid detections to 0.5 deg cells x 52 weeks/year (count of hot spots).
  2. Seasonal empirical quantile mapping MODIS -> VIIRS, fit on the 2012+ overlap
     (separately for each quarter of the year, so fire-season behaviour is not
     diluted by the off-season).
  3. Harmonized series = VIIRS where it exists, otherwise mapped MODIS.
  4. Held-out validation: fit on 2012-2018 overlap, test on 2019-2024.
"""
import json, sys
import numpy as np, pandas as pd
from common import *

import os
SYNTHETIC = os.environ.get("REAL_DATA") != "1"   # set REAL_DATA=1 after fetch_firms.py
NQ = 1001
QS = np.linspace(0, 1, NQ)


def load_counts(rid, sensor):
    cfg = REGIONS[rid]
    west, south, nx, ny = grid(cfg["bbox"])
    df = pd.read_csv(f"../data/raw/{rid}_{sensor}.csv.gz", parse_dates=["date"])
    cid = cell_ids(df["lat"], df["lon"], cfg["bbox"])
    wk = week_index(df["date"])
    ok = (cid >= 0) & (wk >= 0) & (wk < n_weeks())
    out = np.zeros((nx * ny, n_weeks()))
    np.add.at(out, (cid[ok], wk[ok]), 1)
    return out


def fit_map(modis, viirs, weeks):
    """Return {quarter: (modis_quantiles, viirs_quantiles)} fit on the given weeks."""
    maps = {}
    for q in range(4):
        w = weeks[(weeks % WEEKS_PER_YEAR) // 13 == q]
        maps[q] = (np.quantile(modis[:, w], QS), np.quantile(viirs[:, w], QS))
    return maps


def apply_map(modis, maps):
    out = np.zeros_like(modis)
    wk = np.arange(modis.shape[1])
    for q, (mq, vq) in maps.items():
        w = wk[(wk % WEEKS_PER_YEAR) // 13 == q]
        out[:, w] = _qmap(modis[:, w], mq, vq)
    return out


def _qmap(x, mq, vq):
    """Quantile map with tie handling: counts are discrete, so each distinct MODIS value
    maps to the MEAN of VIIRS quantiles over its tied quantile range (np.interp on ties
    would pick one end and bias the totals). Above the training max, scale linearly."""
    u = np.unique(mq)
    mapped = np.array([vq[mq == v].mean() for v in u])
    y = np.interp(x, u, mapped)
    hi = x > u[-1]
    if hi.any() and u[-1] > 0:
        y[hi] = mapped[-1] * x[hi] / u[-1]
    return y


def scores(a, b):
    ta, tb = a.sum(0), b.sum(0)
    return dict(total_ratio=round(float(ta.sum() / tb.sum()), 3),
                weekly_mae=round(float(np.abs(ta - tb).mean()), 2),
                weekly_corr=round(float(np.corrcoef(ta, tb)[0, 1]), 3))


def triplets(m, digits=1):
    c, w = np.nonzero(m > 0.05)
    return [[int(i), int(j), round(float(m[i, j]), digits)] for i, j in zip(c, w)]


def run(rid):
    cfg = REGIONS[rid]
    west, south, nx, ny = grid(cfg["bbox"])
    modis, viirs = load_counts(rid, "modis"), load_counts(rid, "viirs")
    vs = viirs_start_week()
    overlap = np.arange(vs + 1, n_weeks())          # skip the partial first week
    split = overlap[overlap // WEEKS_PER_YEAR + START_YEAR <= 2018][-1]

    # --- held-out validation ---
    m_cv = fit_map(modis, viirs, overlap[overlap <= split])
    test = overlap[overlap > split]
    mapped_test = apply_map(modis, m_cv)[:, test]
    validation = dict(train="2012-2018", test="2019-2024",
                      raw_modis=scores(modis[:, test], viirs[:, test]),
                      harmonized=scores(mapped_test, viirs[:, test]))

    # --- production mapping on the full overlap ---
    maps = fit_map(modis, viirs, overlap)
    harm = apply_map(modis, maps)
    harm[:, vs:] = viirs[:, vs:]                     # VIIRS native from its start

    ys, xs = np.divmod(np.arange(nx * ny), nx)
    cells = [[round(south + (y + .5) * CELL, 3), round(west + (x + .5) * CELL, 3)] for y, x in zip(ys, xs)]
    out = dict(id=rid, name=cfg["name"], bbox=cfg["bbox"], cell=CELL, cells=cells,
               start_year=START_YEAR, end_year=END_YEAR, weeks_per_year=WEEKS_PER_YEAR,
               viirs_start_week=vs, validation=validation, synthetic=SYNTHETIC,
               harmonized=triplets(harm), modis_raw=triplets(modis, 0))
    json.dump(out, open(f"../docs/data/{rid}.json", "w"), separators=(",", ":"))
    print(rid, "validation:", json.dumps(validation))
    return dict(id=rid, name=cfg["name"], file=f"data/{rid}.json", bbox=cfg["bbox"])


if __name__ == "__main__":
    idx = [run(r) for r in (sys.argv[1:] or REGIONS)]
    json.dump(idx, open("../docs/data/regions.json", "w"))
