# Global weather map: agent implementation guide

Last researched: **2026-10-20**.

The weather and VATSIM features have since been built in this repository. Read `AGENTS.md` for the current behavior. This file remains the source study: requirements, provider ranking, units, and freshness rules.

This file records the user's requirements, evaluated data sources, and an implementation plan for a basic worldwide weather map.

## 1. Objective and agreed requirements

Build weather-map layers from freely usable weather data, preferably open government data and open-source processing tools.

The user accepts:

- Ready-made images or tiles.
- Coarse numerical grids that can be rendered into images.
- GRIB/GRIB2, NOAA model data, and similar weather-model outputs.
- Approximately four hours of delay for recent weather, replacing the original one-hour requirement.

Required capabilities:

1. Worldwide coverage, including nearly all of mainland Norway. Validate through at least **72°N**; a product ending at 60°N is insufficient.
2. Recent precipitation and cloud information.
3. Future predictions.
4. Cloud-base or ceiling information where meaningfully available.
5. Clear source attribution, timestamps, units, and distinctions between estimates and observations.
6. Direct sample links and an understandable path from source data to map imagery.

Prefer pole-to-pole model coverage. Do not interpret the Norway requirement as permission to implement a Norway-only application.

The user has requested this document, not deployment, paid subscriptions, account registration, or a running scheduled service.

## 2. Recommended architecture and source ranking

Use **IMERG Early V07B for recent precipitation** and **NOAA GFS for modeled cloud layers, cloud heights, and future weather**. Add regional observations when useful.

There is no verified single source here that simultaneously provides worldwide fresh observations of rain, cloud cover, cloud bases, and forecasts with a guaranteed four-hour maximum delay.

| Priority | Source | Recommended role | Geographic coverage | Timing and qualification |
|---|---|---|---|---|
| 1 | NASA IMERG Early V07B | Recent precipitation estimates; initial image-overlay prototype | All latitudes except a few cells very near the poles | 30-minute intervals; approximately four-hour latency, not a guaranteed maximum |
| 2 | NOAA GFS | Primary global forecast; modeled cloud coverage and height fields | Global, including Norway and polar regions | Four model cycles/day; hourly output in the 0.25° product through 120 hours, then three-hourly through 384 hours |
| 3 | JAXA GSMaP_NRT v8/v9 | Alternative recent precipitation estimates | 90°S–90°N according to current product table | Hourly intervals; nominal four-hour latency |
| 4 | ECMWF Open Data | Alternative global model for clouds, precipitation, wind, temperature | Global, regular 0.25° grid | Main 00/12 UTC runs extend 15 days; initially three-hourly |
| 5 | MET Norway radar | Fresher regional precipitation overlay | Norwegian/Nordic radar areas, with coverage gaps | Recent radar products; inspect frame timestamp and radar status |
| Optional | DWD ICON Global | Additional forecast provider | Global | Main 00/12 UTC forecasts extend 180 hours; native grid requires remapping |
| Conditional | EUMETSAT EUMETView | Satellite cloud imagery, especially Europe/Norway | Depends on selected satellite/layer; a full-world bounding box is not proof of populated coverage | Product-specific delivery delay and licensing; verify both |

Sources: [IMERG Early](https://gpm.nasa.gov/taxonomy/term/1357), [GFS](https://www.emc.ncep.noaa.gov/emc/pages/numerical_forecast_systems/gfs.php), [GSMaP comparison](https://sharaku.eorc.jaxa.jp/GSMaP/faq/GSMaP_faq06.html), [ECMWF](https://www.ecmwf.int/en/forecasts/datasets/open-data), [MET Norway radar](https://api.met.no/weatherapi/radar/2.0/documentation).

### Options that do not meet the complete requirement

- **GSMaP_NOW** stops at 60°N/60°S. It is useful at lower latitudes but does not cover most of Norway. Do not confuse it with **GSMaP_NRT v8/v9**.
- **NOAA GMGSI** also stops at 60°N/60°S. Its name includes “global,” but it cannot be the sole worldwide cloud layer for this task.
- **NOAA/CPC merged infrared GPM_MERGIR** stops at 60°N/60°S; the NASA archive also documents a delivery delay. It is not a solution for northern Norway.
- **IMERG Late/Final** are too delayed for the recent-weather requirement. Select Early explicitly.
- **Daily MODIS/VIIRS mosaics** do not establish that every location was observed in the last four hours. Polar-orbiting swaths need per-pixel or per-granule acquisition times and a coverage mask.
- **Open-Meteo/MET Norway point forecasts** are convenient for a few coordinates, but gridded model files are preferable to querying a dense worldwide lattice of points.
- **NASA GIBS** is an imagery delivery platform, not a single dataset with one latency or coverage guarantee. Evaluate the actual layer.

Do not add another provider merely to increase the number of integrations.

## 3. Freshness: mandatory distinctions

Store and expose these times separately:

| Field | Meaning |
|---|---|
| `valid_start` / `valid_end` | Weather interval represented by the product |
| `model_run_time` | Model initialization time, if applicable |
| `published_at` | Provider publication time, only when known |
| `retrieved_at` | When this application downloaded the product |
| `observation_time` or acquisition-time range | Actual sensor acquisition time, when available |

“Half-hourly” describes temporal spacing or an averaging interval. It does **not** mean delivery within 30 minutes.

“Latest” means the newest available product. It does **not** prove that the product is current.

A forecast valid at 14:00 may have been produced from a 06:00 model run. It is an estimate for 14:00, not an observation from 14:00.

### Four-hour policy

- Default `max_recent_product_age` to four hours.
- For interval products, calculate displayed product age from `valid_end` and show the interval. Preserve `valid_start` so a stricter policy can use the oldest represented time.
- If actual acquisition timestamps exist, preserve them separately. A merged or extrapolated product's valid time does not prove that every source observation is that recent.
- Accept a recent layer only when its timestamp and coverage are known.
- If older than the limit, mark it stale. Do not silently reset its age when downloading again.
- With no acceptable recent precipitation product, use the model forecast valid for the requested time and label it **“Modeled estimate.”**
- If there is no suitable model either, show the last available layer with its age or show “No current data”; do not display missing pixels as clear weather.
- Apply a separate model-run-age policy. Proposed initial warning threshold: 12 hours. This is an implementation default, not a user requirement or provider guarantee.
- A forecast's future valid time must never produce a negative “observation age.”

IMERG Early is documented with a four-hour minimum/nominal latency. A strict four-hour cutoff may reject it frequently, particularly when publication, image rendering, or transport adds delay. Preserve the user's threshold; expose fallback behavior rather than promising uninterrupted compliance.

Use UTC internally. Display local time only at the presentation layer, with the timezone visible.

## 4. Sources, access, and samples

### 4.1 NASA IMERG Early V07B

**Use for:** recent precipitation estimates, including liquid-equivalent precipitation from rain and snow.

**Resolution:** 0.1°; 30-minute intervals. NASA reports coverage at all latitudes except a few cells very near the poles. Coverage does not imply equal accuracy everywhere.

**Direct images:**

- [Transparent precipitation PNG, 3600 × 1800](https://svs.gsfc.nasa.gov/vis/a000000/a004200/a004285/imergert_alpha.now.png)
- [Timestamp image](https://svs.gsfc.nasa.gov/vis/a000000/a004200/a004285/imergert_dates.now.png)
- [Composite preview](https://svs.gsfc.nasa.gov/vis/a000000/a004200/a004285/imergert_1080p.now.png)
- [Asset listing and credit](https://svs.gsfc.nasa.gov/4285/)

**Numerical access:**

- [Early GIS/GeoTIFF directory](https://jsimpsonhttps.pps.eosdis.nasa.gov/imerg/gis/early/)
- [IMERG product documentation](https://gpm.nasa.gov/data/imerg)
- [PPS registration](https://registration.pps.eosdis.nasa.gov/)

Implementation rules:

1. Use the transparent PNG for a quick visual prototype.
2. Treat that PNG as a visualization, not a numerical raster from which to infer exact rainfall.
3. Inspect alignment and extent against coastlines before mapping it. A 2:1 image alone is not proof of its georeferencing.
4. For production timestamp checks and custom styles, prefer numerical products with machine-readable metadata.
5. Read acquisition/valid time from the source filename and metadata; a PNG HTTP `Last-Modified` timestamp is publication/cache metadata, not proof of weather time.
6. Do not automate timestamp OCR as the primary production timestamp source.
7. Respect units and scale factors from the exact selected product. NASA's GIS page describes scaling for its accumulation files; do not apply that convention to every HDF/NetCDF precipitation-rate variable.
8. Preserve fill values and quality information. Missing does not mean zero precipitation.
9. If showing “rain” rather than all precipitation, use the documented phase information and label any classification as an estimate. Do not simply relabel total precipitation as liquid rain.
10. Store numerical download credentials outside source control. Never place credentials in public frontend requests, URLs, logs, or generated manifests.

The independently updated `*.now.png` and date image are not an atomic dataset. Fetching both does not guarantee matching frames during an update. Prefer timestamped assets where available or publish a numerical-derived image and manifest together.

### 4.2 NOAA GFS

**Use for:** forecast clouds, precipitation, wind, temperature; modeled current conditions and height diagnostics.

**Access:**

- [Current runs](https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod/)
- [0.25° hourly GRIB filter](https://nomads.ncep.noaa.gov/gribfilter.php?ds=gfs_0p25_1hr)
- [Field inventory example](https://www.nco.ncep.noaa.gov/pmb/products/gfs/gfs.t00z.pgrb2.0p25.f003.shtml)
- [GFS output documentation](https://www.nco.ncep.noaa.gov/pmb/products/gfs/)

**Dated sample, verified by HTTP HEAD on 2026-10-20:**

[0.5° +3-hour GRIB2, approximately 154 MB](https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod/gfs.20261020/00/atmos/gfs.t00z.pgrb2.0p50.f003)

This is a many-variable sample, not the recommended production download size. It represents 2026-10-20 03:00 UTC, not a permanent “current weather” endpoint. It expires from the rolling server.

General path:

```text
https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod/
  gfs.YYYYMMDD/HH/atmos/gfs.tHHz.pgrb2.0p25.fFFF
```

Join the path without spaces or line breaks. `HH` is the cycle and `FFF` is forecast lead time.

| Desired layer | NOAA inventory identifier | Level / interpretation |
|---|---|---|
| Total cloud coverage | `TCDC` | Entire atmosphere; distinguish instantaneous from time-averaged messages |
| Low clouds | `LCDC` | Low cloud layer |
| Middle clouds | `MCDC` | Middle cloud layer |
| High clouds | `HCDC` | High cloud layer |
| Precipitation accumulation | `APCP` | Surface; interval from message metadata |
| Precipitation rate | `PRATE` | Surface; inspect instantaneous/average time semantics |
| Cloud ceiling | `HGT` | Cloud ceiling |
| Cloud-base pressure | `PRES` | Low/middle/high cloud bottom level |
| Wind | `UGRD`, `VGRD` | Select the requested height, normally 10 m |
| Temperature | `TMP` | Select 2 m above ground for surface weather |

Inventory identifiers and ecCodes/cfgrib short names may differ. Inspect GRIB metadata instead of assuming that an inventory name is the xarray variable name.

Download strategy:

1. Discover available cycles; do not assume that the newest nominal cycle is already published.
2. Select the newest cycle containing all required fields and forecast steps for the requested batch.
3. Fetch selected variables/levels through the GRIB filter initially.
4. For larger sustained workloads, use the file inventory/index and HTTP byte ranges against a supported source. Validate range responses and complete GRIB message boundaries.
5. Cache by provider, run, lead time, variable selection, and source grid.
6. If a cycle is incomplete, retain a complete older run; do not construct a supposedly coherent animation from unrelated cycles without recording the transitions.
7. Use 0.25° hourly output for hourly forecast animation; downsample afterward. Do not assume coarser distributions have the same time-step availability.

### 4.3 JAXA GSMaP_NRT

- [Interactive sample / PNG export](https://sharaku.eorc.jaxa.jp/GSMaP/)
- [Product comparison](https://sharaku.eorc.jaxa.jp/GSMaP/faq/GSMaP_faq06.html)
- [User guide](https://sharaku.eorc.jaxa.jp/GSMaP/guide.html)
- [Registration](https://sharaku.eorc.jaxa.jp/GSMaP/registration.html)

Use a documented **NRT v8 or v9** product with 90°S–90°N coverage. The current comparison table lists approximately four-hour latency. v9 NRT appears in the table from 2026-10-19; verify its operational state and format before selecting it by default.

Some older overview pages and formats describe 60°S–60°N. Confirm the actual downloaded product's grid, version, and valid mask rather than copying an old array shape.

Raw access requires registration. Do not invent an unauthenticated raw-file sample URL. The interactive map is a preview, not proof that all current numerical versions have identical map coverage.

GSMaP_NOW can supplement low latitudes, but must never silently replace NRT across Norway.

### 4.4 ECMWF Open Data

- [Product fields, resolution, and schedules](https://www.ecmwf.int/en/forecasts/datasets/open-data)
- [Current files](https://data.ecmwf.int/forecasts/)
- [Official Python downloader](https://github.com/ecmwf/ecmwf-opendata)
- [Dated +3-hour GRIB2 sample, approximately 144 MB](https://data.ecmwf.int/forecasts/20261020/00z/ifs/0p25/oper/20261020000000-3h-oper-fc.grib2)

The dated sample was confirmed by HTTP HEAD on 2026-10-20 and will expire.

Useful parameters include `tcc`, `tp`, `tprate`, `ptype`, `10u`, `10v`, and `2t`, subject to the current catalog and selected model.

Do not assume cloud-base height is present in the free subset. It was not verified in this investigation.

The 0.25° output grid is the published dataset resolution; do not present it as the native model resolution.

The official downloader supports retrieving selected parameters. Prefer it over downloading every variable in the sample file.

### 4.5 DWD ICON Global

- [Global variable directories](https://opendata.dwd.de/weather/nwp/icon/grib/00/)
- [Total cloud cover directory](https://opendata.dwd.de/weather/nwp/icon/grib/00/clct/)
- [Dated total-cloud sample, approximately 4.1 MB](https://opendata.dwd.de/weather/nwp/icon/grib/00/clct/icon_global_icosahedral_single-level_2026102000_003_CLCT.grib2.bz2)

The sample was confirmed by HTTP HEAD on 2026-10-20 and will expire.

Decompress bzip2, decode GRIB2, and remap the native icosahedral grid using the matching grid description. Do not reshape the native one-dimensional cell array into a rectangular image.

Validate variable definitions against DWD's model documentation. Convective cloud-base height is not a substitute for all-cloud base height.

This integration is optional; implement it only if it adds a needed capability or provider redundancy.

### 4.6 MET Norway radar

- [Latest Norway PNG](https://api.met.no/weatherapi/radar/2.0/reflectivity.png?area=norway)
- [Available Norway frames](https://api.met.no/weatherapi/radar/2.0/available.json?type=reflectivity&area=norway&content=image)
- [Radar documentation](https://api.met.no/weatherapi/radar/2.0/documentation)
- [Separate two-hour point Nowcast API](https://api.met.no/weatherapi/nowcast/2.0/documentation)

The Norway PNG endpoint returned a frame dated 2026-10-20 14:35 UTC when checked around 14:42 UTC.

Use an identifying User-Agent and respect cache headers and MET Norway's traffic rules. Determine available areas and valid data coverage through metadata; regional names alone are not guarantees of coverage.

The PNG's pixels must be aligned using the provider's projection/geographic metadata. Do not stretch the image over a guessed rectangle.

Reflectivity is not automatically rainfall in mm/hour. Keep its native legend unless implementing a documented conversion.

### 4.7 EUMETSAT EUMETView cloud imagery

- [WMS capabilities](https://view.eumetsat.int/geoserver/wms?service=WMS&request=GetCapabilities)
- [Norway/Europe infrared sample PNG](https://view.eumetsat.int/geoserver/wms?service=WMS&version=1.1.1&request=GetMap&layers=msg_fes%3Air108&styles=&srs=EPSG%3A4326&bbox=-15,50,40,73&width=1000&height=600&format=image%2Fpng)
- [Data access documentation](https://user.eumetsat.int/data-access?l=en)
- [Terms](https://www.eumetsat.int/about-us/terms-use)

Observed during this investigation:

| Layer | Advertised time spacing | Latest advertised time at roughly 14:42 UTC on 2026-10-20 |
|---|---|---|
| `msg_fes:ir108` | 15 minutes | 11:45 UTC, approximately three hours old |
| `mumi:worldcloudmap_ir108` | Three hours | 09:00 UTC, more than five hours old |

These are checks from one moment, not promised delivery schedules.

The Norway sample returned a PNG successfully, but no per-pixel completeness or quality audit was performed. Validate usable data at the northern test locations.

WMS 1.1.1 with EPSG:4326 uses longitude/latitude BBOX order in this sample. Do not copy that order blindly into WMS 1.3.0, which uses latitude/longitude for EPSG:4326.

Infrared brightness temperature is not directly cloud-cover percentage, cloud opacity, or cloud-base altitude. Preserve the scientific meaning of the layer and its legend.

Do not treat a layer advertised with world-size bounds as proof of actual polar coverage.

Free viewing does not establish unrestricted redistribution or commercial rights. Do not enable this source in a commercial production pipeline until the selected product's data policy has been resolved.

## 5. Proposed implementation layout

Use existing project conventions if implementing in an established repository. For a new Python service:

```text
weather-map/
  AGENTS.md
  pyproject.toml
  config/weather.yaml
  src/weather_map/
    providers/
      base.py
      imerg.py
      gfs.py
      gsmap.py
      ecmwf.py
      met_radar.py
    ingest.py
    metadata.py
    freshness.py
    normalize.py
    regrid.py
    render.py
    publish.py
  tests/
    fixtures/
  data/                  # ignored, local cache
    raw/
    normalized/
  public/weather/        # generated immutable images + manifests
```

Suggested tools:

- HTTP client: `requests` or the project's existing client.
- GRIB: ecCodes with `cfgrib` and `xarray`.
- Arrays: NumPy.
- Raster I/O/reprojection: GDAL or Rasterio.
- PNG output: Pillow.
- NetCDF/HDF readers appropriate to the selected NASA/JAXA product.
- Browser map: existing framework; render image overlays initially, tile pyramids only if needed.

Pin compatible dependency versions after a working installation. On Windows, verify the native ecCodes/GDAL components as well as Python packages.

Official references: [cfgrib](https://github.com/ecmwf/cfgrib), [ecCodes Python](https://github.com/ecmwf/eccodes-python), [ECMWF downloader](https://github.com/ecmwf/ecmwf-opendata), [GDAL](https://gdal.org/), [Rasterio](https://rasterio.readthedocs.io/).

## 6. Provider interface and data contract

Each provider adapter should implement:

```text
discover(requested_time, region, variables) -> candidate products
fetch(product) -> cached source file plus provenance
decode(file) -> numerical fields or provider image plus metadata
validate(product) -> timing, coverage, units, completeness
```

The renderer must consume normalized fields, not provider-specific filenames or short-name assumptions.

Example manifest schema; values below are illustrative, not a live dataset:

```json
{
  "schema_version": 1,
  "layer": "precipitation_rate",
  "provider": "NASA",
  "product": "IMERG Early",
  "product_version": "V07B",
  "data_kind": "satellite_estimate",
  "valid_start": "2026-10-20T10:30:00Z",
  "valid_end": "2026-10-20T11:00:00Z",
  "model_run_time": null,
  "published_at": null,
  "retrieved_at": "2026-10-20T14:00:00Z",
  "units": "mm h-1",
  "crs": "EPSG:4326",
  "bounds": [-180, -90, 180, 90],
  "grid_registration": "pixel_area",
  "height_reference": null,
  "coverage_mask": "precipitation_20261020T110000Z.mask.png",
  "image": "precipitation_20261020T110000Z.png",
  "style_version": "precip-v1",
  "source_url": "REPLACE_WITH_ACTUAL_SOURCE",
  "source_sha256": "REPLACE_WITH_ACTUAL_HASH",
  "attribution": "REPLACE_WITH_PRODUCT_SPECIFIC_CREDIT"
}
```

Use `data_kind` values such as `radar_observation`, `satellite_estimate`, `model_forecast`, or `derived_model_field`. A forecast valid at the current time remains `model_forecast`.

Record the actual output bounds and grid registration. They must not be hard-coded from this illustrative manifest.

Compute freshness when serving or displaying the manifest; a stored `fresh: true` would itself become stale.

## 7. Downloading and decoding GRIB

### Reference: build a small GFS cloud request

The following is an implementation sketch using the documented filter interface. It has not been executed end to end in this workspace. Confirm current query names against the live form and discover an available run before execution.

```python
from datetime import datetime, timezone
from pathlib import Path
import requests

def download_total_cloud(run: datetime, lead: int, output: Path) -> Path:
    if run.tzinfo is None:
        raise ValueError("run must be timezone-aware")
    run = run.astimezone(timezone.utc)
    if run.hour not in (0, 6, 12, 18) or run.minute or run.second:
        raise ValueError("select a published GFS cycle")
    if not (0 <= lead <= 384) or (lead > 120 and lead % 3):
        raise ValueError("invalid forecast lead")

    params = {
        "file": f"gfs.t{run:%H}z.pgrb2.0p25.f{lead:03d}",
        "dir": f"/gfs.{run:%Y%m%d}/{run:%H}/atmos",
        "var_TCDC": "on",
        "lev_entire_atmosphere": "on",
    }
    url = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.name + ".part")
    try:
        with requests.get(
            url, params=params, stream=True, timeout=(15, 120)
        ) as response:
            response.raise_for_status()
            size = 0
            with temporary.open("wb") as sink:
                for chunk in response.iter_content(1024 * 1024):
                    if not chunk:
                        continue
                    size += len(chunk)
                    if size > 64 * 1024 * 1024:
                        raise ValueError("unexpected size for cloud-only selection")
                    sink.write(chunk)
        with temporary.open("rb") as source:
            if source.read(4) != b"GRIB":
                raise ValueError("response was not GRIB")
        # Production: decode and validate all required messages before publishing.
        temporary.replace(output)
        return output
    finally:
        if temporary.exists():
            temporary.unlink()
```

Production additions:

- Unique temporary paths and a per-cache-key lock to avoid concurrent writers.
- Bounded retries for timeouts/429/5xx, with jitter and `Retry-After`.
- No repeated retries for invalid query syntax, missing permissions, or unavailable credentials.
- A controlled fallback to an older complete run for missing products.
- Conditional GETs for reusable endpoints.
- Source URL, response validators, size, and hash saved in provenance.
- GRIB decoding before promoting a source object as complete; magic bytes alone are insufficient.
- Follow NOMADS guidance to pause between requests; do not run unbounded parallel downloads.

### Reference: inspect before selecting variables

```python
import cfgrib

datasets = cfgrib.open_datasets(
    "total_cloud.grib2",
    backend_kwargs={"indexpath": ""}
)
for dataset in datasets:
    for name, field in dataset.data_vars.items():
        print(name, field.dims, field.attrs)
```

GRIB files can contain incompatible vertical levels and step types. Use separate datasets or explicit `filter_by_keys` after inspecting messages.

For every selected field, verify:

- Parameter identity and units.
- `typeOfLevel` and level.
- Instantaneous, averaged, or accumulated time semantics.
- Run time, lead time, and valid time.
- Grid shape, scanning order, coordinates, and missing-value mask.

An instantaneous TCDC field and a three-hour-average TCDC field are not duplicates to discard arbitrarily.

## 8. Normalization and physical meaning

### Precipitation

Choose a canonical display unit of **mm/hour** for rates and **mm** for interval accumulation.

- A rate in kg m-2 s-1 converts to liquid-equivalent mm/hour by multiplying by 3600.
- An amount in kg m-2 is numerically equivalent to liquid-equivalent mm.
- An accumulation in metres of water converts to mm by multiplying by 1000.
- Read actual units first; never choose conversions solely from a variable name.
- For cumulative accumulation from one run, difference compatible steps to obtain interval amounts, then divide by interval duration for mean rate.
- Some products already contain interval accumulations. Do not difference them again.
- Never difference across model runs, accumulation resets, or incompatible interval definitions.
- Diagnose negative increments; clip only documented numerical roundoff, not resets or corrupt data.
- Do not assume step zero contains precipitation for the interval immediately before initialization.

Recent IMERG estimates and future GFS rain may disagree at their transition. Preserve the source boundary and avoid implying that a visual blend improves meteorological accuracy.

### Cloud cover

Normalize coverage to a fraction in [0, 1] based on metadata:

- If the source uses percent, divide by 100.
- If it uses fraction, leave it unchanged.
- Preserve missing cells before applying clipping.
- Low, middle, and high clouds overlap vertically. Do not sum their fractions to create total cloud cover.
- Use the model's total-cloud field when available.

### Cloud bases, ceilings, and tops

These are different quantities:

- Cloud cover: fraction of area/sky occupied by clouds.
- Cloud base: bottom of a cloud layer.
- Ceiling: a specific ceiling diagnostic, not necessarily the lowest base of any cloud.
- Cloud top: upper boundary; satellite infrared imagery primarily relates to emitting surfaces/cloud tops.

GFS `HGT` at cloud ceiling is reported as geopotential height. Confirm the height reference from authoritative product metadata before labeling it AGL or MSL.

GFS `PRES` at cloud bottom is pressure, not height. To derive base altitude:

1. Use geopotential-height profiles and pressure levels from the same model run, valid time, and grid.
2. Mask pressure levels below local terrain and missing profile points.
3. Interpolate height against log-pressure where valid levels bracket the base pressure.
4. For AGL, subtract consistent model terrain height from the derived MSL height.
5. Do not extrapolate unbracketed profiles silently.
6. Label the result as a derived model estimate and retain its mask.

Do not convert Pa to metres with a universal constant. Do not substitute a surface temperature/dewpoint lifting-condensation-level approximation without explicitly describing its different meaning.

## 9. Reprojection and rendering

Initial target: a coarse global EPSG:4326 numerical grid, approximately 0.5° or 1°, plus PNG overlays. Preserve the original grid and metadata in the cache.

Processing order:

```text
Discover -> fetch -> verify -> decode -> normalize units/time
  -> regrid with mask -> render -> publish immutable image + manifest
```

Rules:

1. Detect and normalize longitudes, commonly 0–360 versus -180–180.
2. Reorder coordinates and values together.
3. Remove a duplicated seam column only when verified to be a duplicate.
4. Make output image rows north-to-south.
5. Distinguish grid-point coordinates from pixel-area edges. GFS may include pole nodes; do not infer image bounds from array dimensions alone.
6. Use mask-aware area/conservative averaging when coarsening precipitation amounts. Do not average nodata into valid values.
7. Area-average or use a documented interpolation for cloud fractions; nearest-neighbor for categorical fields/masks.
8. Keep dateline wrapping seamless.
9. An EPSG:4326 image must be correctly reprojected for Web Mercator. Do not stretch it into Mercator.
10. Web Mercator reaches approximately ±85.0511°, sufficient for mainland Norway but not the poles. Keep a geographic/globe/polar display option if full polar display is required.

Style defaults, subject to user preference:

- Clouds: white, alpha proportional to cloud fraction, with adjustable overall opacity.
- Precipitation: transparent for valid zero/trace values; increasing color/intensity for higher rates.
- Heights: a separate color scale, labeled in metres with its AGL/MSL reference.
- Include a legend and source time.
- Preserve a separate coverage mask: both clear weather and missing data may be transparent visually, but they must remain distinguishable in metadata and tooltips.

An initial precipitation scale could use 0.1, 0.5, 1, 2, 5, 10, and 20 mm/hour. These are display choices, not validated hazard thresholds.

Use fixed scales across animation frames. Per-frame autoscaling makes unchanged colors represent different weather intensities.

## 10. Publishing, caching, and refresh

Suggested starting policy; implement as configuration, not hard-coded provider promises:

| Source | Discovery/check interval | Download behavior |
|---|---|---|
| IMERG | 15–30 minutes | Fetch only new products; honor HTTP cache directives |
| GFS | Approximately 30 minutes, with backoff when unchanged | Fetch new complete cycles and only required fields/lead times |
| GSMaP_NRT | 30–60 minutes | Fetch new hourly products |
| ECMWF/ICON | Around expected cycles with backoff | Fetch new complete products |
| MET radar | Provider cache headers | Avoid repeat downloads before expiry |
| EUMETView | Layer time dimension and cache headers | Fetch explicitly selected timestamped frames |

The user has not requested creating an automation; these are runtime design recommendations.

Use immutable output paths, for example:

```text
/weather/gfs/20261020T060000Z/cloud-cover/20261020T140000Z.png
/weather/imerg/V07B/20261020T110000Z/precipitation.png
```

Publish a manifest only after all referenced objects are complete. Update the small latest-manifest pointer atomically.

Cache keys must include source/product version, run, valid interval, selected variables, grid, and style version. Reprocessing or a palette change must not collide with old cached imagery.

Proposed local retention: 48 hours of recent observation imagery and at least two complete model cycles. Adjust to storage limits; keep manifests and source provenance for diagnosis. Rolling upstream directories are not permanent archives.

Expose a provider-neutral manifest endpoint and static images or tiles. The browser should not poll credentialed upstream services independently for every user.

## 11. Licensing and attribution

“Open data,” “free API,” “open-source software,” and “free redistribution” are separate questions.

| Provider | Practical requirement |
|---|---|
| NOAA/NWS | Generally public-domain data, subject to stated exceptions and no implied endorsement |
| NASA IMERG | Follow NASA product citation guidance; credit NASA Scientific Visualization Studio for the supplied rendered PNG |
| JAXA GSMaP | Free use including commercial use within the research-data terms; attribution and registration for raw access |
| ECMWF | CC BY 4.0 for the open data; retain attribution and license information |
| DWD | CC BY 4.0 for applicable open spatial data, with source acknowledgment |
| MET Norway | CC BY 4.0 attribution plus API identification/caching rules |
| EUMETSAT | Product-specific data policy; do not infer unrestricted rights from public WMS access |

References:

- [NOAA usage terms](https://www.weather.gov/disclaimer)
- [NASA GPM data policy](https://gpm.nasa.gov/data/policy)
- [NASA visualization credit](https://svs.gsfc.nasa.gov/4285/)
- [JAXA registration and reuse terms](https://sharaku.eorc.jaxa.jp/GSMaP/registration.html)
- [ECMWF open-data policy and access](https://www.ecmwf.int/en/forecasts/datasets/open-data)
- [DWD legal notice](https://www.dwd.de/EN/service/legal_notice/legal_notice_node.html)
- [MET Norway license](https://docs.api.met.no/doc/License)
- [MET Norway API terms](https://docs.api.met.no/doc/TermsOfService)
- [EUMETSAT terms](https://www.eumetsat.int/about-us/terms-use)

Keep attribution visible in the map and in downloadable artifact metadata. Check applicable terms when implementing; this document records research, not a permanent license guarantee.

## 12. Acceptance criteria and meaningful validation

### Geographic coverage

Validate actual finite pixels/masks, not only advertised bounds, at:

| Location | Approximate latitude, longitude |
|---|---|
| Oslo | 59.91, 10.75 |
| Trondheim | 63.43, 10.40 |
| Tromsø | 69.65, 18.96 |
| Honningsvåg | 70.98, 25.97 |
| Northern coverage boundary | 72.00, 25.00 |
| High southern latitude | -70.00, 0.00 |
| Dateline, both sides | 0.00, 179.90 and 0.00, -179.90 |

A 60°N cutoff must fail the primary-source acceptance check.

### Timing and provenance

- Test a recent product just inside and just outside four hours of age.
- Test an old file downloaded now; it must remain old.
- Test an incomplete newest model cycle and fallback to a complete previous cycle.
- Verify that an old-run forecast valid now is labeled modeled.
- Test missing publication/acquisition metadata without inventing timestamps.
- Confirm that layers with different valid times retain their individual timestamps.

### Scientific transformations

- Unit conversions for rate and accumulation.
- Accumulation differencing across compatible intervals and rejection of resets/run changes.
- Correct separation of instantaneous versus averaged GRIB messages.
- Percent versus fractional cloud cover.
- Missing versus zero precipitation.
- Cloud-ceiling reference and cloud-base pressure conversion.
- Snow/total-precipitation wording where the selected data is not liquid-rain-only.

### Rendering

- Coastline alignment, orientation, dateline seam, and Norway coverage.
- Correct reprojection between EPSG:4326 and EPSG:3857.
- Stable legends over time.
- Missing-data mask retained through resampling.
- No provider image caption/legend mistakenly included as geographic pixels.

### Failure handling

- Upstream HTML error returned with HTTP 200.
- Partial or invalid GRIB/image files.
- HTTP 401/403, 429, timeouts, and delayed publication.
- Concurrent fetch of the same object.
- Atomic manifest/image update.
- Stale observation fallback clearly labeled modeled, without changing the requested timestamp.

For a documentation-only change, do not claim that these application tests passed. Run them when the implementation exists.

## 13. Implementation milestones

1. **Prototype:** display IMERG transparent precipitation imagery with source timestamp; inspect Norway alignment; support stale-state labeling.
2. **Forecast foundation:** ingest selected GFS fields, decode units/intervals, and render total-cloud and precipitation layers.
3. **Timeline:** add recent-history and hourly forecast navigation, retaining provider/run/valid time.
4. **Numerical observations:** replace or augment the NASA preview PNG with correctly georeferenced numerical IMERG data.
5. **Height diagnostics:** add modeled ceiling first; add pressure-derived bases only after validating profiles and vertical reference.
6. **Resilience:** add source discovery, atomic publication, bounded retry, cache retention, and observable freshness.
7. **Optional additions:** MET Norway radar, GSMaP_NRT redundancy, ECMWF, ICON, or licensed EUMETSAT imagery.

Begin with the two-source IMERG + GFS design. Expand only when a specific coverage, data-quality, or reliability requirement warrants it.

## 14. Verification record and unresolved items

Verified during the research conversation on 2026-10-20:

- GFS, ECMWF, and DWD dated sample URLs existed and returned HTTP 200 to HEAD.
- MET Norway sample returned a PNG with a recent timestamp.
- EUMETView Norway request returned PNG, and the advertised latest times were read from WMS capabilities.
- NASA publishes a 3600 × 1800 transparent IMERG visualization and a separate timestamp image.
- NASA documents near-global V07B coverage and four-hour Early latency.
- JAXA's comparison distinguishes 60°N/S NOW coverage from 90°N/S NRT v8/v9 coverage.

Not established by this work:

- An operational application or an end-to-end execution of the code sketch.
- Guaranteed maximum latency or continuous service availability.
- Per-pixel completeness, accuracy, and geographic alignment of the sample images.
- The free ECMWF subset containing a suitable cloud-base-height field.
- EUMETSAT product-specific commercial redistribution permission.
- Numerical ingestion credentials for NASA/JAXA.
- Exact display framework, hosting, forecast horizon, user traffic, or storage budget.

Use reasonable implementation defaults for reversible choices. Do not claim these unresolved properties are already verified.
