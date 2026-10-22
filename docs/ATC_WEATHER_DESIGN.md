# ATC and Weather Planning Design Notes

This workspace is not currently a git repository, so there is no local
"last commit" to diff against. This document describes the active working
tree changes made during this session, especially the ATC and weather
planner features, so another AI model or engineer can continue safely.

## Goals

- Let route search prefer or require live ATC and METAR weather without
  hiding the normal pay/distance route search workflow.
- Keep the main UI focused: common choices should be visible, tuning
  should live in small disclosure sections.
- Make weather source selection explicit. Weather can come from NOAA AWC,
  NOAA cycle text files, VATSIM METAR, or Auto mode.
- Avoid automatic weather polling. Weather updates happen on initial live
  data load, route search/recheck, or the manual update button.
- Treat VATSIM bookings as optional predicted ATC coverage. Online ATC and
  booked future ATC must be visually distinct.
- Preserve route scoring as a weighted blend of the enabled environment
  signals, while strict requirements still filter routes regardless of
  score weight.
- Keep optional raster weather map layers separate from METAR route scoring.
  See `docs/WEATHER_MAP_LAYERS_FEATURE.md` for the proposed gridded/image
  weather overlay feature.

## Key Files

- `src/Environment/defaults.mjs`
  Defines the environment policy shape, default weather target, weather
  source list, weather profiles, category/cloud range helpers, and policy
  normalization.

- `src/Environment/weather.mjs`
  Normalizes METAR records, parses raw METAR text, computes flight category,
  formats METAR display text, matches airport weather, and scores an
  observation against a weather target.

- `src/Environment/vatsim.mjs`
  Normalizes VATSIM controllers/bookings, maps controllers to airport and
  sector geometry, formats controller text, and decides whether ATC is
  available at route time.

- `src/Environment/evaluate.mjs`
  Evaluates candidate routes against ATC and weather policy. Produces
  eligibility reasons, ATC coverage score, weather score, and final route
  score.

- `src/Environment/EnvironmentProvider.js`
  Fetches live VATSIM, weather, and airspace snapshots from the local
  environment API. It has source configuration for weather, but no recurring
  polling interval.

- `src/Routing/EnvironmentOptions.js`
  User-facing ATC/weather configuration UI in the route finder.

- `src/Routing/Results.js`
  Route result list, sort controls, compact environmental exclusions, and
  click-to-map behavior for rejected airport ICAOs.

- `src/Environment/EnvironmentSummary.js`
  Compact per-route ATC/weather hints and detailed route recheck behavior.

- `src/MapLayers/EnvironmentLayers.js`
  Live map overlay for VATSIM coverage and METAR points, including hover
  tooltips and future booking hatching.

- `server/providers.mjs`
  Provider fetch/normalize functions for VATSIM, NOAA AWC, NOAA cycle text,
  VATSIM METAR, and airspace data.

- `server/index.mjs`
  Local environment API. Supports `source=auto|awc|cycles|vatsim` for
  `/api/environment/v1/weather/snapshot`.

- `tests/environment.test.mjs` and `tests/server.test.mjs`
  Behavioral coverage for weather parsing/scoring, booking coverage,
  route scoring, provider merge/source behavior, and API routing.

- `docs/WEATHER_MAP_LAYERS_FEATURE.md`
  Separate follow-up feature plan for optional map overlays such as cloud
  cover, cloud ceiling/base, recent precipitation, and forecast layers. It
  incorporates the global weather-map source and projection guidance from
  `D:\research\middlemarker\AGENTS.md`.

## Environment Policy Model

The policy is normalized by `normalizePolicy()` in `defaults.mjs`.

ATC fields:

- `departure`, `enroute`, `arrival`: each is `off`, `prefer`, or `require`.
- `service`: `tower`, `approach`, or `any`.
- `scope`: `endpoints` or `every-leg` for airport checks.
- `enrouteScope`: `each-leg` or `itinerary`.
- `minimumCoverage`: percent of track required for enroute ATC.
- `allowInferred`: whether broad inferred sector geometry can count.
- `predictBookings`: whether VATSIM bookings count as future coverage.
- `departureWeight`, `enrouteWeight`, `arrivalWeight`: score weights.

Weather fields:

- `weather`: `off`, `prefer`, or `require`.
- `weatherSource`: `auto`, `awc`, `cycles`, or `vatsim`.
- `sameWeatherTarget`: whether departure and arrival share one target.
- `departureWeather`, `arrivalWeather`: category, cloud, and ceiling target
  objects.
- `weatherWeight`: score weight.

The old `categories` list is still accepted for legacy stored policy. It is
converted into a category range and an unconstrained cloud range.

## Weather Targets

Weather target fields:

- `categoryFrom`, `categoryTo`: inclusive flight category range using
  `VFR`, `MVFR`, `IFR`, `LIFR`.
- `coverFrom`, `coverTo`: inclusive ideal cloud cover range using
  `CLR`, `FEW`, `SCT`, `BKN`, `OVC`.
- `baseFt`: minimum acceptable ceiling. `0` means any ceiling.
- `category` and `cover`: compatibility fields for older policy and tests.

The route finder UI has two layers:

- A high-level `General preference` slider from `Clear VFR` through `LIFR`.
  This writes a complete target preset.
- Advanced target controls below it:
  - flight category range,
  - ideal cloud cover range,
  - minimum ceiling,
  - optional separate arrival target.

Important: cloud cover is no longer "no worse than". It is an ideal range.
For example, a user can explicitly prefer `BKN-OVC` rather than treating
clearer weather as always better.

## Weather Scoring

`judgeWeather()` scores how closely a report matches the target:

- Category contributes 50%.
- Cloud cover range contributes 30%.
- Ceiling contributes 20%.

Observations inside the selected category range score best for category.
Observations outside the range lose score by distance from the range. The
same idea applies to cloud cover. Ceiling scores best when it is unknown
because there is no reported limiting ceiling, or when it is at/above the
target.

`require` uses the same target but filters out routes when:

- the category is outside the selected range,
- cloud cover is outside the ideal range,
- ceiling is below target,
- the report is missing/stale/ambiguous.

Because cloud cover is now a range, two reports inside the same cloud range
can tie. This is intentional.

## Weather Sources

Weather sources are selected in `EnvironmentOptions.js`, stored in
`environmentPolicyV1`, and passed to `EnvironmentProvider`.

The API endpoint is:

```text
/api/environment/v1/weather/snapshot?source=auto|awc|cycles|vatsim
```

Source behavior:

- `auto`: fetches NOAA AWC cache and NOAA cycle text, then merges them.
- `awc`: NOAA Aviation Weather Center cache only.
- `cycles`: NOAA hourly METAR cycle files only.
- `vatsim`: VATSIM METAR text feed from
  `https://metar.vatsim.net/metar.php?id=all`.

Provider notes:

- NOAA AWC records include station coordinates.
- NOAA cycle and VATSIM text reports often do not include coordinates.
- Exact ICAO station matches are still valid for route scoring even without
  coordinates.
- Map weather markers skip observations without coordinates, because Leaflet
  throws on null positions.

## METAR Date Rollover

Raw METARs only include day/hour/minute, not month/year. The parser uses the
current fetch time to infer month/year.

Bug fixed:

- A stale VATSIM line like `KE77 222325Z ...` fetched on Oct 20 was being
  interpreted as Oct 22, then shown as a future update.
- The parser now uses a 2-hour future tolerance and mutually exclusive
  month rollover checks, so far-future day groups roll back one month and do
  not immediately roll forward again.

Regression test:

- `tests/environment.test.mjs` verifies `222325Z` fetched on
  `2026-10-20T14:34:12Z` becomes `2026-09-22T23:25:00Z`.

## Weather UI

The Weather card now shows:

- Source selector: `Auto`, `AWC`, `NOAA cycles`, `VATSIM`.
- Last update time and loaded source text.
- Manual `Update weather` button.
- `Use in routes`: Ignore / Prefer / Require.
- `Weather target` disclosure section for target controls.

There is no visible automatic update cadence. The provider no longer runs a
recurring refresh timer. Live data refreshes on:

- first active live-data subscription,
- pressing update/refresh,
- starting route search,
- rechecking a route.

## ATC Planning

The ATC UI title is `ATC VATSIM Coverage`.

Visible order:

1. Departure
2. Enroute
3. Arrival

Each uses Ignore / Prefer / Require.

When any ATC part is active:

- `Predict coverage from VATSIM bookings` controls whether future bookings
  count as route-time ATC.
- `ATC matching and route coverage` holds advanced controls:
  - endpoints vs every stop,
  - tower/approach/any ATC,
  - minimum enroute track coverage,
  - per-leg vs itinerary measurement,
  - inferred sector geometry.

## VATSIM Bookings

Bookings are loaded from `https://atc-bookings.vatsim.net/api/booking` for
yesterday, today, and tomorrow.

`normalizeBookings()` drops invalid and already-finished bookings. Booking
times are UTC.

`matchControllers()` adds booked controllers as offline controller records:

- `online: false`
- `bookings: [...]`

`availableAt()` and `availableDuring()` allow booked controllers to count
only inside their booking window. Online controllers with no bookings count
now. Online controllers with bookings count inside booking windows and near
the current time.

`evaluate.mjs` respects `predictBookings`:

- When enabled, route evaluation uses bookings and route timing.
- When disabled, route evaluation uses only online controllers.

## ATC Map Visualization

`EnvironmentLayers.js` draws:

- online ATC sectors and airport markers as solid colored outlines,
- booked-only future coverage as faint gray hatched polygons with dashed
  outlines,
- airport booked-only markers as gray dashed circles.

Large sector hover:

- Sector polygons are non-interactive.
- A map-level mousemove handler uses `containsPoint()` to discover all
  sectors under the cursor.
- Tooltip opens after a short dwell and lists controllers/bookings.

This avoids Leaflet popup placement issues for huge FIR/sector polygons.

## Route Scoring

Route scoring is a weighted average of active pieces:

- departure ATC,
- enroute ATC,
- arrival ATC,
- weather.

The Ranking card explains that sliders split the route score between active
preferences. A 70% Weather / 30% ATC split means weather matters more when
sorting.

Important invariant:

- `require` filters routes even if its score weight is 0%.
- `prefer` affects sorting and candidate retention.

`routeScore` is used for "Best conditions" sorting and candidate retention.
`coverageScore` remains ATC-only for the "Best ATC coverage" sort.

## Environmental Exclusions

Rejected completed candidates are now summarized in a compact disclosure
instead of printed inline.

`Results.js` parses rejection reasons like:

```text
LKPR: arrival Booked controller is outside the estimated time
```

The ICAO is clickable:

- If it exists in FSE airport data, normal `goTo()` is used.
- If it is missing from FSE but exists in the active simulator airport file
  (`public/data/msfs.json`, `xplane.json`, or `fsx.json`), the app uses a
  GPS jump to show that location on the map.

`App.js` exposes `goToGps` through the shared `actions` object to support
this.

## Persistence

Route/environment policy is stored in localStorage key:

```text
environmentPolicyV1
```

Environment layer visibility is stored in:

```text
environmentLayersV1
```

Browser storage is per exact origin. `http://localhost:3000` and
`http://127.0.0.1:3000` do not share localStorage.

## API and Runtime Notes

Development service commands used:

```powershell
$env:HOST='127.0.0.1'; $env:PORT='8787'; node --use-system-ca server/index.mjs
$env:BROWSER='none'; $env:HOST='127.0.0.1'; $env:PORT='3000'; $env:REACT_APP_ENVIRONMENT_API_URL='http://127.0.0.1:8787/api/environment/v1'; $env:NODE_OPTIONS='--openssl-legacy-provider'; npm start
```

Do not open a browser tab automatically; use `BROWSER=none`.

## Tests and Checks

Primary test command:

```powershell
npm run test:environment
```

Targeted lint examples:

```powershell
npx eslint --no-cache src/Environment/defaults.mjs src/Environment/weather.mjs src/Routing/EnvironmentOptions.js
npx eslint --no-cache src/MapLayers/EnvironmentLayers.js src/Routing/Results.js
```

Behavior covered:

- flight category thresholds,
- METAR visibility/wind formatting,
- raw METAR parsing including VATSIM source and date rollover,
- weather station identity validation,
- weather target ranges and scoring,
- ATC controller normalization and booking windows,
- route scoring and strict requirement filtering,
- API weather source selection,
- provider outage behavior.

## Cautions for Future Changes

- Do not treat VATSIM as the only weather source. The current design allows
  VATSIM but keeps NOAA as the default/reliable source.
- Do not reintroduce recurring polling unless the UI explicitly exposes it
  again. Current behavior is manual/on-demand.
- Be careful with METAR day/month inference. Any change to `parseRawMetar()`
  should be tested with reports near month boundaries and stale VATSIM lines.
- Booked ATC is not online ATC. Keep the route policy switch and map
  visualization distinction.
- Exact ICAO weather matches without coordinates are valid for scoring, but
  not for map markers.
- Route search workers receive a normalized environment policy. If policy
  fields are renamed, keep `normalizePolicy()` backward compatible with
  localStorage.
