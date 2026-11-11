# Burn Calendar: MODIS + VIIRS hot-spot harmonization (NASA Space Apps 2026)

Layout
- `pipeline/make_synthetic.py`: SYNTHETIC detections for development (no key needed). Never present as real.
- `pipeline/fetch_firms.py`: real detections from NASA FIRMS (needs a free `FIRMS_MAP_KEY`).
- `pipeline/harmonize.py`: grids to 0.5 deg x weekly, seasonal quantile mapping MODIS -> VIIRS, held-out validation, writes `docs/data/*.json`.
- `docs/`: static app (Leaflet map + calendar heatmap, seasonal climatology, critical periods, anomalies).

Run
```
python3 -m venv .venv && .venv/bin/pip install numpy pandas requests
cd pipeline
FIRMS_MAP_KEY=xxxx ../.venv/bin/python fetch_firms.py      # real data (or make_synthetic.py for a demo)
REAL_DATA=1 ../.venv/bin/python harmonize.py                # omit REAL_DATA=1 for synthetic
cd ../docs && python3 -m http.server 8765                    # open http://localhost:8765
```

Method notes
- Counts are discrete, so quantile mapping averages VIIRS quantiles over each MODIS tie range (plain interpolation biased totals ~1.6x).
- Fit on the 2012+ overlap per quarter; validated on a held-out 2019-2024 window.
- Pre-2012 = mapped MODIS; 2012+ = VIIRS native. The sensor changeover is marked on the calendar and time series.
- Known limits: counts only (FRP not yet harmonized), 0.5 deg grid, 3 test regions.
