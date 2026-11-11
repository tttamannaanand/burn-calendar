# Burn Calendar: Harmonizing MODIS and VIIRS Active-Fire Hot Spots

**NASA Space Apps Challenge 2026 · Challenge: Harmonization of MODIS and VIIRS Hot Spots**
*Solo entry*

## Summary
Satellites have tracked active-fire hot spots for over two decades, but the record is split between two sensors that cannot be compared directly. MODIS (2000–) sees fires at 1 km; VIIRS (2012–) sees them at 375 m and detects far more of them. A fire manager looking at "burning activity over time" sees a fake jump in 2012.

**Burn Calendar** is a web app that stitches both records into one consistent, VIIRS-equivalent history (2003–2024). For any area of interest it shows a year-by-week burning calendar, the typical fire season and its critical period, and the weeks that were unusually active. The harmonization is validated on held-out years, and the app shows those numbers next to the results.

## What the app does
- Pick a region, then click two corners on the map to choose any area of interest.
- **Calendar heatmap**: one row per year, one column per week. Toggle between activity and anomaly (z-score against that area's own seasonal baseline).
- **Seasonal climatology**: the typical weekly curve (mean ± 1 sd) with the **critical period** shaded: the weeks where typical activity is at least 50% of the seasonal peak.
- **Most unusual weeks**: the largest anomalies during fire season.
- **Full record chart**: raw MODIS versus the harmonized series, with the VIIRS-native period shaded. Viewers see the correction itself.
- **Harmonization check panel**: held-out validation scores for the selected region.

## Method
1. **Data.** NASA FIRMS standard-processing archives: MODIS (Terra + Aqua) from 2003 and VIIRS (Suomi-NPP) from 2012, through 2024. Only presumed vegetation fires are kept (`type = 0`, which drops volcanoes and static sources such as industrial flares) with nominal or high confidence.
2. **Gridding.** Hot spots are counted per 0.5° cell per week (52 weeks a year).
3. **Harmonization.** Seasonal empirical quantile mapping of MODIS counts onto the VIIRS distribution, fit on the 2012+ overlap, separately for each quarter of the year so the fire season is not averaged away by the off-season. Counts are whole numbers with many ties, so each MODIS value maps to the *mean* of the VIIRS quantiles it spans. Plain interpolation picked one end of each tie and over-counted by about 1.6× in testing. Above the training maximum the mapping scales linearly.
4. **Final series.** VIIRS where it exists (2012+), mapped MODIS before that.
5. **Calendar products** (computed in the browser): weekly climatology, z-score anomalies, critical period, unusual weeks.

## Validation
The mapping is fit on the 2012–2018 overlap and scored on the held-out 2019–2024 overlap against real VIIRS. "Total" is the ratio of summed hot spots to VIIRS (1.00× means unbiased); "weekly error" is the mean absolute error of regional weekly counts.

| Region | Raw MODIS total | Harmonized total | Weekly error (raw → harmonized) |
|---|---|---|---|
| California, USA | 0.23× | 0.88× | 1298 → 381 |
| Amazon arc, Brazil | 0.27× | 1.01× | 4645 → 811 |
| Northern Australia | 0.22× | 0.99× | 3483 → 484 |

Raw MODIS sees only about a quarter of what VIIRS sees. Harmonization removes most of that gap, and weekly error falls 3–7×.

**Alternatives we tested.** We also tried calibrating by the expected VIIRS count given the MODIS count (a conditional mean, with and without keeping zero-MODIS cells at zero), which is robust to a change in the overall distribution. It brought California's total to 0.95–0.99×, but it made California's weekly error worse (436–458 versus 381) and its weekly correlation worse (0.947 versus 0.983), over-counted quiet years, and gave no gain in the other two regions. A second attempt added a per-week intensity correction. In the 2012-2018 training years the fitted slope was essentially zero (the relationship does not depend on intensity there), so it only added a flat 7%: California moved from 0.88x to 0.92x while the Amazon arc's weekly error got slightly worse (811 to 820). That is not a convincing gain, so it was not adopted. Quantile mapping had the best weekly accuracy in all three regions, so we kept it and report its California bias openly.

Note that the production series fits the mapping on every overlap year (2012-2024), so it does see the 2020-2021 behaviour; the held-out numbers above are a pessimistic estimate for it.

**Sanity check against known events.** The most anomalous fire-season weeks in California's harmonized record are 10 Sep 2020, 5 Nov 2018 and 29 Oct 2003. These coincide with some of the state's worst fire episodes (the 2020 Labor Day-period fires, the Camp Fire, the Cedar Fire). Its busiest year is 2020. In the Amazon arc the busiest year is 2007, a recognised drought-fire year. This is a plausibility check, not a validation, since we did not compare against an independent fire-event database.

## Limitations (stated plainly)
- **California is 12% low.** The shortfall is concentrated in 2020 (0.81×) and 2021 (0.84×), when California burned about eight times more than in a typical year. We first suspected extrapolation beyond the training range, but a diagnostic ruled that out: only 3 of 124,488 held-out cell-weeks exceed the training maximum, and the bias is nearly as large inside the training range (0.89×). The more likely cause is that the MODIS-to-VIIRS relationship shifts during extreme fire years, which a mapping fit on the milder 2012–2018 years cannot capture. We did not confirm this. The other two regions are unbiased.
- **Counts only.** Fire Radiative Power (FRP) is not harmonized yet.
- **Sensor mix.** MODIS is Terra + Aqua; VIIRS is Suomi-NPP only (NOAA-20 and NOAA-21 are not used, to keep the VIIRS record consistent). The record starts in 2003 because Aqua began in mid-2002.
- **Scale.** Three test regions at 0.5° resolution, not global coverage. Cross-sensor relationships are fit per region, so they are not guaranteed to transfer elsewhere.
- **Weekly resolution.** Calendar weeks are day-of-year ÷ 7; days 365 and 366 fold into the last week.

## Next steps
Harmonize FRP; model how the MODIS/VIIRS relationship changes with fire intensity so record fire years (such as California 2020–21) are not underestimated; add NOAA-20/21; extend to global tiles served from pre-aggregated data; add independent validation against burned-area products.

## Data and tools
- NASA FIRMS (MODIS C6.1 and VIIRS S-NPP standard processing archives), https://firms.modaps.eosdis.nasa.gov
- Python (numpy, pandas) for the pipeline; plain JavaScript, Leaflet and OpenStreetMap tiles for the app. The app is a static site.

## Reproduce
See `README.md`. Real data needs a free FIRMS MAP_KEY. The repository also includes a synthetic-data generator used only for development; the app labels synthetic data with a warning banner.
