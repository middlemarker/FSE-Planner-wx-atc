fail# Optional Weather Map Layers Feature

This document turns the global weather-map research in
`D:\research\middlemarker\AGENTS.md` into an FSE Planner feature plan.
It is a design and implementation note only. It does not claim that the
weather layers are implemented yet.

## Feature Goal

Add optional map overlays for weather context beyond per-airport METAR route
scoring:

- cloud coverage,
- cloud bases or ceiling where meaningful,
- recent precipitation / rain radar,
- future weather model layers,
- source timestamp and freshness info,
- map-matched imagery with correct projection and attribution.

The route finder weather controls remain METAR-based. These map layers are
visual context layers for the map, route preview, and future timeline. They
should not silently change route scoring unless a later feature explicitly
defines that behavior.

## Product Behavior

Weather layers should live in the existing map layer panel near
`Live environment`.

Suggested top-level UI:

- `Weather layers` checkbox / section.
- Layer selector:
  - `Precipitation now`
  - `Cloud cover`
  - `Cloud ceiling`
  - `Forecast precipitation`
  - `Forecast clouds`
- Time selector:
  - latest recent layer,
  - previous recent frames,
  - future forecast steps when available.
- Source/status line:
  - provider,
  - valid time or valid interval,
  - retrieved time,
  - stale/missing warning.
- Legend:
  - units,
  - color ramp,
  - whether transparent means zero or missing.

Keep this separate from route-finder `Weather` settings. The route finder
uses METAR sources (`auto`, `awc`, `cycles`, `vatsim`) and airport targets.
Weather map layers use gridded or image products.

## Feature Design

The first implementation should optimize for trust and clarity over feature
count. Use the most reliable worldwide layer first, then expose optional
regional or alternate products only after the global layer is understandable.

Default state:

- Weather layers are off.
- Opening the panel shows a compact `Weather layers` card.
- The default selected layer is the most reliable available global layer:
  `Cloud cover forecast` from NOAA GFS if a complete GFS product exists,
  otherwise `Recent precipitation` from IMERG if available.
- The selected layer displays only one time slice at a time.
- The map status pill always shows the layer name, source, and data time.
- Time controls are hidden until the selected layer has more than one slice.

Card layout:

```text
Weather layers                         [off/on]
Layer                                  [Cloud cover forecast v]
Time                                   Valid 14:00 UTC
Source                                 NOAA GFS 06Z run · retrieved 10:21 UTC
[timeline slider, only when multiple slices exist]
[Legend] [Details]
```

The card should avoid provider jargon in the main controls. Put product
details, attribution, and exact timestamps in `Details`.

### Data Time Display

Every visible layer must show a time line next to the layer control and in
the map overlay tooltip/status:

- For recent observations or estimates:
  - `Valid 10:30-11:00 UTC`
  - `Retrieved 14:00 UTC`
  - stale warning when outside the freshness policy.
- For forecasts:
  - `Valid 14:00 UTC`
  - `Run 06Z`
  - model-run-age warning when old.
- For regional radar:
  - provider frame time,
  - region/coverage note,
  - stale warning if cache headers or metadata indicate old data.

Never show only `updated`. It is ambiguous. Use `valid`, `run`, and
`retrieved` labels.

### Time Slice Slider

Show a slider only when the selected layer has a timeline:

- Recent precipitation:
  - steps represent available recent frames.
  - default handle position is the latest acceptable frame.
  - older stale frames remain selectable but visually marked stale.
- Forecast layers:
  - steps represent forecast valid times.
  - default handle position is the nearest future/current valid time.
  - show the model run separately from the forecast valid time.
- Mixed recent plus forecast:
  - do not merge sources into one seamless slider in the first pass.
  - use tabs or grouped timeline labels: `Recent` and `Forecast`.

Timeline labels should be compact:

```text
09Z 10Z 11Z 12Z 13Z 14Z 15Z 16Z
```

The selected value should expand:

```text
Valid 14:00 UTC · GFS 06Z forecast +8h
```

### Layer Priority

Prefer global and reliable sources before regional enhancements:

1. Global forecast cloud cover: NOAA GFS `TCDC`.
2. Global forecast precipitation: NOAA GFS `APCP` or `PRATE`.
3. Global recent precipitation estimate: NASA IMERG Early.
4. Global forecast ceiling/base diagnostics: NOAA GFS ceiling first; derived
   bases only after validation.
5. Regional radar: MET Norway, clearly scoped to its region.
6. Alternate global providers: GSMaP_NRT or ECMWF only when they improve
   reliability or fill a specific gap.

Do not make regional radar the default, even if it is fresher, because it
cannot explain worldwide route context.

### Layer Control Model

Initial controls:

- `Layer`: one active weather raster at a time.
- `Opacity`: simple 0-100 slider, default 55%.
- `Time`: latest/default slice, with slider if multiple slices exist.
- `Legend`: small expandable row.
- `Details`: source, timestamps, units, attribution, stale reason.

Advanced controls, hidden by default:

- provider override when more than one source is implemented for a layer,
- units display preference where safe,
- animation/playback for future timeline,
- show missing-data mask,
- debug coastline alignment overlay.

The UI should not present every provider as a top-level choice. Most users
should choose the weather phenomenon first, not the provider.

## Recommended Source Set

Start with the two-source design from `AGENTS.md`. This should be the first
production path because it gives the most coherent worldwide story:

1. **NASA IMERG Early V07B**
   - Role: recent precipitation estimates.
   - Coverage: near global, including mainland Norway through at least 72N.
   - Timing: 30-minute products, approximately four-hour latency.
   - Initial prototype can use the transparent PNG, but production should
     use numerical products or a timestamped manifest.

2. **NOAA GFS**
   - Role: modeled clouds, cloud heights/ceiling, precipitation forecasts,
     and future timeline layers.
   - Coverage: global, including polar regions.
   - Timing: four cycles per day; 0.25 degree hourly output through 120h.
   - Default global provider for cloud and forecast map layers.

Optional later sources:

- **JAXA GSMaP_NRT** for precipitation redundancy.
- **ECMWF Open Data** as an alternate forecast model.
- **MET Norway radar** for regional Norway/Nordic precipitation, with clear
  coverage limits.
- **DWD ICON Global** only if remapping native icosahedral grids is worth the
  cost.
- **EUMETSAT EUMETView** only after product coverage and redistribution
  rights are resolved.

Avoid adding providers just to add provider count. Add one only when it
improves coverage, freshness, reliability, or a specific layer.

## Sources to Avoid as Primary Layers

Do not use these as complete global solutions:

- GSMaP_NOW for Norway: it stops at 60N/S.
- NOAA GMGSI: also stops at 60N/S.
- NOAA/CPC GPM_MERGIR: stops at 60N/S.
- IMERG Late/Final for recent weather: too delayed for the current goal.
- Daily MODIS/VIIRS mosaics: not guaranteed recent everywhere.
- Point forecast APIs queried on a dense global grid: use gridded model
  products instead.
- NASA GIBS as a "source" without evaluating the actual layer. GIBS is a
  delivery platform, not one product with one latency/coverage promise.

## Data Contract

Publish every rendered weather layer with a manifest. The browser should
consume manifests and images/tiles, not provider filenames.

Suggested manifest:

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
  "source_url": "actual provider URL",
  "source_sha256": "actual hash",
  "attribution": "provider-specific credit"
}
```

Important fields:

- `valid_start` / `valid_end`: represented weather interval.
- `model_run_time`: forecast initialization time.
- `published_at`: provider publication time when known.
- `retrieved_at`: when FSE Planner downloaded the product.
- `data_kind`: `satellite_estimate`, `radar_observation`,
  `model_forecast`, or `derived_model_field`.
- `coverage_mask`: separate mask because transparent pixels can mean either
  zero precipitation/clear sky or missing data.

Do not store a permanent `fresh: true` value. Freshness must be calculated
when displayed.

## Freshness Rules

Use UTC internally.

Recent layers:

- Default max age: four hours.
- For interval products, compute age from `valid_end`.
- Preserve `valid_start` so stricter policy can use the oldest represented
  time later.
- If the product is older than the limit, show it as stale.
- If no recent product is acceptable, show a model layer only if it is
  clearly labeled `Modeled estimate`.
- Never make a future valid time produce negative observation age.

Forecast layers:

- Display both model run time and forecast valid time.
- Warn if model run age is old. Initial threshold: 12 hours.
- A forecast valid "now" is still a forecast/model estimate, not an
  observation.

## Projection and Map Matching

FSE Planner uses Leaflet. Correct projection and alignment are required.

Rules:

1. Do not stretch EPSG:4326 images directly into Web Mercator unless they
   are explicitly intended for that projection.
2. Reproject or tile the raster correctly for the map projection.
3. Normalize longitudes:
   - 0..360 products must be reordered to -180..180 or handled with
     dateline wrapping.
4. Keep image rows north-to-south.
5. Distinguish grid point centers from pixel-area edges.
6. Remove a seam column only if it is verified as duplicate.
7. Preserve missing masks through every resampling step.
8. Validate coastline alignment visually before trusting a layer.
9. Validate finite data coverage at Norway test points, not just advertised
   bounds.

Web Mercator reaches about +/-85.0511 degrees. This covers mainland Norway
but not the poles. If the feature later claims full polar display, add a
geographic/globe/polar display option.

## Rendering Rules

Initial output format:

- Coarse global EPSG:4326 normalized grid.
- Rendered PNG overlays plus manifests.
- Tile pyramids only after the single-image overlay is correct and too slow.

Style defaults:

- Clouds: white with alpha proportional to cloud fraction.
- Precipitation: transparent for valid zero/trace values; increasing color
  with rate.
- Cloud ceiling/base: separate color scale with units in feet/metres and
  height reference visible.
- Use fixed scales across animation frames.
- Include a legend and source time.

Never use per-frame autoscaling for animation. It makes unchanged colors
mean different values in different frames.

## Physical Meaning

Precipitation:

- Rates in `kg m-2 s-1` convert to liquid-equivalent `mm/hour` by
  multiplying by 3600.
- Amounts in `kg m-2` equal liquid-equivalent mm.
- Accumulations in metres of water convert to mm by multiplying by 1000.
- Do not difference accumulations across model runs or resets.
- Missing data is not zero precipitation.
- If the source is total precipitation, do not label it liquid rain unless a
  documented phase classifier is used.

Cloud cover:

- Normalize to fraction `[0, 1]`.
- Percent sources divide by 100.
- Do not sum low/middle/high cloud fractions to produce total cloud cover.
- Use the model total-cloud field when available.

Cloud bases / ceilings:

- Cloud base, ceiling, and cloud top are different quantities.
- GFS `HGT` at cloud ceiling is geopotential height. Confirm AGL/MSL before
  labeling.
- GFS `PRES` at cloud bottom is pressure, not height.
- To derive base altitude from pressure, use same-run/same-valid-time
  model profiles and interpolate against log-pressure.
- Do not convert Pa to metres with a universal constant.

## Proposed Application Architecture

Keep the existing `server/` environment API as the browser-facing API. Add a
weather-layer subsystem behind it.

Suggested layout inside this repo:

```text
server/
  weather-layers/
    providers/
      imerg.mjs
      gfs.mjs
      gsmap.mjs
      met-radar.mjs
    ingest.mjs
    metadata.mjs
    freshness.mjs
    normalize.mjs
    render.mjs
    publish.mjs
    cache.mjs
public/
  weather/
    latest.json
    imerg/
    gfs/
src/
  MapLayers/
    WeatherRasterLayers.js
```

Provider adapter interface:

```text
discover(requestedTime, region, variables) -> candidate products
fetch(product) -> local cached source plus provenance
decode(file) -> fields/images plus metadata
validate(product) -> timing, coverage, units, completeness
render(normalizedField) -> image/mask/legend
publish(renderedLayer) -> immutable files plus latest pointer
```

The renderer must consume normalized fields, not provider-specific
filenames or GRIB short names.

## API Shape

Potential endpoints:

```text
GET /api/environment/v1/weather/layers
GET /api/environment/v1/weather/layers/:layer/latest
GET /api/environment/v1/weather/layers/:layer/timeline
GET /api/environment/v1/weather/layers/:layer/:time/manifest
```

The latest endpoint should return a manifest pointer, not raw provider data.

The browser should load the manifest, then load image/mask/legend resources
from public immutable URLs.

`/weather/layers` should return the user-facing catalog:

```json
[
  {
    "id": "cloud_cover_forecast",
    "label": "Cloud cover forecast",
    "kind": "forecast",
    "defaultProvider": "gfs",
    "hasTimeline": true,
    "defaultOpacity": 0.55,
    "legend": "0-100% cloud cover"
  }
]
```

`/weather/layers/:layer/timeline` should return ordered time slices:

```json
{
  "layer": "cloud_cover_forecast",
  "selected": "2026-10-20T14:00:00Z",
  "slices": [
    {
      "id": "2026-10-20T14:00:00Z",
      "label": "14Z",
      "valid_start": "2026-10-20T14:00:00Z",
      "valid_end": "2026-10-20T14:00:00Z",
      "model_run_time": "2026-10-20T06:00:00Z",
      "age_label": "GFS 06Z +8h",
      "stale": false,
      "manifest_url": "/weather/gfs/20261020T060000Z/cloud-cover/20261020T140000Z/manifest.json"
    }
  ]
}
```

The UI should not infer time labels from filenames. It should use the
manifest and timeline API fields.

## Layer Types

### Start With

Build these as the first optional layer set:

- `precipitation_recent`
  - Source: IMERG Early.
  - Display: mm/hour or interval accumulation.
  - Kind: satellite estimate.
  - Time control: recent-frame slider when multiple IMERG frames are cached.
  - Default slice: latest non-stale frame; if all are stale, latest stale
    frame with warning.
  - UI label: `Recent precipitation`.
  - Tooltip: value, units, valid interval, provider, stale state.

- `cloud_cover_forecast`
  - Source: GFS `TCDC`.
  - Display: percent/fraction cloud cover.
  - Kind: model forecast.
  - Time control: forecast valid-time slider.
  - Default slice: nearest current/future valid time from the newest complete
    GFS run.
  - UI label: `Cloud cover forecast`.
  - Tooltip: percent cloud cover, valid time, GFS run, provider.

- `precipitation_forecast`
  - Source: GFS `APCP` or `PRATE`.
  - Display: interval mm or mm/hour.
  - Kind: model forecast.
  - Time control: forecast valid-time slider.
  - Default slice: nearest current/future valid time.
  - UI label: `Precipitation forecast`.
  - Tooltip: amount/rate, accumulation interval, valid interval, GFS run.

- `cloud_ceiling_forecast`
  - Source: GFS cloud ceiling diagnostic.
  - Display: height with reference clearly labeled.
  - Kind: model forecast or derived model field.
  - Time control: forecast valid-time slider.
  - Default slice: nearest current/future valid time.
  - UI label: `Cloud ceiling`.
  - Tooltip: ceiling height, reference if known, valid time, GFS run.

### Later Optional Layers

Add later only after the initial global layers are useful:

- `cloud_base_forecast`
  - Source: GFS cloud-bottom pressure plus same-run vertical profiles.
  - Display: derived base height with AGL/MSL label and mask.
  - Kind: derived model field.
  - Note: implement only after interpolation and height-reference validation.

- `radar_norway`
  - Source: MET Norway radar.
  - Regional only; do not present as global coverage.
  - UI label: `Norway radar`.
  - Time control: recent radar frame slider if provider exposes available
    frames.
  - Tooltip: native radar quantity/legend, frame time, coverage warning.

- `precipitation_recent_alt`
  - Source: GSMaP_NRT.
  - Redundancy for precipitation only.
  - UI label: `Recent precipitation alternate`.
  - Time control: hourly recent-frame slider.
  - Note: useful when IMERG is delayed or unavailable.

- `satellite_cloud_image`
  - Source: EUMETSAT only after rights and coverage are confirmed.
  - Display: imagery or brightness temperature, not cloud-cover percent.
  - Regional/global status depends on the selected product.
  - Note: never treat advertised WMS bounds as proof of usable pixels.

### Layer Cards

Each layer card should resolve to the same visual structure:

```text
[checkbox] Cloud cover forecast
           NOAA GFS · Valid 14:00 UTC · Run 06Z
           [timeline slider if available]
           [opacity slider]
           [legend] [details]
```

Layer card states:

- `Ready`: current selected slice has image and manifest.
- `Stale`: image exists but freshness policy warns.
- `Loading`: fetch/render job is running or manifest is pending.
- `Unavailable`: no acceptable product or coverage for this layer.
- `Coverage limited`: regional product or incomplete mask.

Status icons should be compact. The explanation belongs in the expandable
details panel.

## UI Integration

Layer panel:

- Put map weather layers below live ATC/METAR environment controls.
- Keep toggles off by default.
- Use one active weather raster layer at a time initially to avoid visual
  clutter.
- Show a compact status:
  - layer name,
  - valid time,
  - source,
  - stale badge.
- Make details expandable:
  - attribution,
  - product/version,
  - run time,
  - retrieved time,
  - units,
  - legend.

Route list:

- Do not add raster layer values to route scoring initially.
- Route scoring remains airport METAR and VATSIM ATC based.
- Later, if raster layers inform route scoring, add an explicit policy and
  tests. Do not silently blend gridded data into current weather score.

Map:

- Weather raster overlay should be below airport markers and above basemap.
- Missing data mask should support tooltip/status distinctions.
- Clicking a weather layer should show value, units, valid time, and source
  at the clicked location when the layer is numerical.

## Cache and Publishing

Use immutable output paths:

```text
/weather/imerg/V07B/20261020T110000Z/precipitation.png
/weather/gfs/20261020T060000Z/cloud-cover/20261020T140000Z.png
```

Publish only after all referenced files are complete:

- image,
- mask,
- manifest,
- legend if separate.

Then atomically update a small latest pointer:

```text
/weather/latest.json
```

Cache key must include:

- provider,
- product version,
- model run,
- valid interval,
- variable selection,
- grid/projection,
- style version.

Do not let a palette change overwrite an old image with the same cache key.

## Validation Checklist

Geographic:

- Oslo: 59.91, 10.75
- Trondheim: 63.43, 10.40
- Tromso: 69.65, 18.96
- Honningsvag: 70.98, 25.97
- Northern coverage boundary: 72.00, 25.00
- High southern latitude: -70.00, 0.00
- Dateline: 0.00, 179.90 and 0.00, -179.90

Timing:

- Recent product just inside four-hour age.
- Recent product just outside four-hour age.
- Old file downloaded now remains old.
- Future forecast valid now still labeled model forecast.
- Missing publication/acquisition metadata does not invent timestamps.

Rendering:

- Coastline alignment.
- Dateline seam.
- North/south orientation.
- Norway coverage.
- EPSG:4326 to Web Mercator correctness.
- Missing-data mask retained through resampling.
- Provider captions/legends are not treated as map pixels.

Failure handling:

- HTTP 200 with HTML error body.
- Partial GRIB/image download.
- Invalid GRIB.
- 401/403, 429, timeout, delayed publication.
- Concurrent fetch of same product.
- Atomic latest pointer update.

## Acceptance Criteria for First Implementation

1. User can enable one optional weather raster layer from the map layer panel.
2. The layer shows source, valid time, units, and attribution.
3. The layer aligns with coastlines and airports.
4. Transparent missing data and transparent zero/clear data are distinguishable
   in metadata or tooltips.
5. A stale layer is visibly marked stale.
6. Recent precipitation works at least through mainland Norway north of 72N.
7. The implementation has tests for manifest freshness, timestamp handling,
   dateline wrapping, and missing-vs-zero handling.

## Non-Goals for the First Pass

- No paid provider.
- No account-required data in browser-side requests.
- No dense point forecast grid from point APIs.
- No claim of guaranteed four-hour latency.
- No route scoring based on raster products until a separate scoring design
  is requested.
- No commercial redistribution assumption for EUMETSAT.

## Relationship to Existing ATC/METAR Feature

Existing METAR route weather:

- operates per airport,
- uses AWC, NOAA cycle text, VATSIM METAR, or Auto,
- supports route scoring and route filtering,
- can accept exact ICAO reports with no coordinates.

Optional weather map layers:

- operate as map overlays,
- use image/grid products,
- require projection and mask handling,
- do not affect route scoring initially.

Keep these feature paths separate unless the user explicitly asks for raster
weather layers to influence route scoring.
