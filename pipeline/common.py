"""Shared config for the MODIS/VIIRS hot-spot harmonization pipeline."""
import numpy as np
import pandas as pd

CELL = 0.5            # grid cell size in degrees
START_YEAR = 2003   # Terra+Aqua MODIS both operating (Aqua began mid-2002)
END_YEAR = 2024
WEEKS_PER_YEAR = 52   # day-of-year // 7, capped at 51 (days 365/366 fold into week 51)
VIIRS_START = pd.Timestamp("2012-01-20")   # first Suomi-NPP VIIRS 375 m detections

# bbox = (west, south, east, north). Test regions chosen for strong, distinct fire seasons.
REGIONS = {
    "california": dict(name="California, USA", bbox=(-124.5, 32.5, -114.0, 42.0), peak_week=33),
    "amazon_arc": dict(name="Amazon arc of deforestation, Brazil", bbox=(-62.0, -14.0, -50.0, -6.0), peak_week=35),
    "arnhem_land": dict(name="Northern Australia (Arnhem Land)", bbox=(130.0, -17.0, 138.0, -11.0), peak_week=38),
}


def week_index(dates):
    """Map datetimes to a global week index (year-START_YEAR)*52 + week-of-year."""
    d = pd.DatetimeIndex(dates)
    w = np.minimum((d.dayofyear.values - 1) // 7, WEEKS_PER_YEAR - 1)
    return (d.year.values - START_YEAR) * WEEKS_PER_YEAR + w


def n_weeks():
    return (END_YEAR - START_YEAR + 1) * WEEKS_PER_YEAR


def viirs_start_week():
    return int(week_index([VIIRS_START])[0])


def grid(bbox):
    west, south, east, north = bbox
    nx = int(round((east - west) / CELL))
    ny = int(round((north - south) / CELL))
    return west, south, nx, ny


def cell_ids(lat, lon, bbox):
    """Flat cell index for each detection; -1 if outside bbox."""
    west, south, nx, ny = grid(bbox)
    ix = np.floor((np.asarray(lon) - west) / CELL).astype(int)
    iy = np.floor((np.asarray(lat) - south) / CELL).astype(int)
    ok = (ix >= 0) & (ix < nx) & (iy >= 0) & (iy < ny)
    return np.where(ok, iy * nx + ix, -1)
