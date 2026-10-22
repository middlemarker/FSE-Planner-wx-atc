# FSE Planner

FSE Planner is a map visualization app that allows you to display all kind of information from [FSE Economy](https://www.fseconomy.net) onto a world map:

* available jobs with tons of filtering options
* available rentable planes, available user/group planes
* all FSE airports, with their landing area and corresponding MSFS airports
* all MFSF airports
* ...

It also offers a tool to find the most paying routes.

<p align="center">
	<a href="https://www.youtube.com/watch?v=MDB7AFYSqMI"><img width="300" height="169" src="https://github.com/piero-la-lune/FSE-Planner/blob/master/visual_assets/video_small.png?raw=true" alt="Overview video"></a>
</p>

## Features

<p align="center">
	<img width="600" src="https://github.com/piero-la-lune/FSE-Planner/blob/master/visual_assets/feature1.png?raw=true" alt="Display available jobs on map & apply search filters on location, length, amount, pay, direction, etc.">
</p>
<p align="center">
	<img width="600" src="https://github.com/piero-la-lune/FSE-Planner/blob/master/visual_assets/feature6.png?raw=true" alt="Route Finder: find best paying multi-hop multi-assignment route with complex on-route stops and return to home capabilities">
</p>
<p align="center">
	<img width="600" src="https://github.com/piero-la-lune/FSE-Planner/blob/master/visual_assets/feature2.png?raw=true" alt="Display airports with rentable planes & get detailed information about the available planes">
</p>
<p align="center">
	<img width="600" src="https://github.com/piero-la-lune/FSE-Planner/blob/master/visual_assets/feature3.png?raw=true" alt="Search for specific ICAO and airport name & get a link to the corresponding FSE website page">
</p>
<p align="center">
	<img width="600" src="https://github.com/piero-la-lune/FSE-Planner/blob/master/visual_assets/feature4.png?raw=true" alt="Display all FSE airports on the map & view the correspoding landing areas">
</p>
<p align="center">
	<img width="600" src="https://github.com/piero-la-lune/FSE-Planner/blob/master/visual_assets/feature5.png?raw=true" alt="Display all MSFS airports on the map & warn about non-existent or renamed airports">
</p>
<p align="center">
	<img width="600" src="https://github.com/piero-la-lune/FSE-Planner/blob/master/visual_assets/feature7.png?raw=true" alt="Display all airport with available lots to be built upon & filter out airports based on size">
</p>



## Installation

A public instance of FSE Planner is available at [https://fse-planner.piero-la-lune.fr](https://fse-planner.piero-la-lune.fr).

If you prefer, you can instead install your own instance.

### Local installation

To install your own instance of FSE Planner on your computer:

1. Download the [latest release](https://github.com/piero-la-lune/FSE-Planner/releases) from GitHub (you can also build the application from scratch, see "Developer instructions" bellow)
2. Unzip the release on your computer
3. Open `index.html` in your favorite web browser

/!\ The Route Finder will not work. This is a known issue with no workaround (see Remote installation to make it works).

### Remote (server) installation

To install your own instance of FSE Planner on a web server, execute the following steps.

1. Clone the [latest release](https://github.com/piero-la-lune/FSE-Planner/releases) on your computer or server
2. Build the app (`npm install` then `npm run build`)
3. Drop all the files from the `build` folder to your web server.


## Developer instructions

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).
In the project directory, you can run:

### `npm start`

Runs the app in the development mode.<br />
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

The page will reload if you make edits.<br />
You will also see any lint errors in the console.

### `npm run build`

Builds the app for production to the `build` folder.<br />
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.<br />
Your app is ready to be deployed!


## VATSIM and weather integration

The Layers panel now includes **VATSIM coverage** and **Weather / METAR** overlays.
The route finder has independent **Off / Prefer / Require** settings for departure,
arrival, en-route ATC, and observed airport weather. Features default to off.

VATSIM data and worldwide METAR reports are supplied by a small, separately deployed
Node service. The service has no third-party runtime dependencies and requires
Node 20 or newer. A static S3 upload alone does not deploy this service.

For local development, run the service in one terminal:

```powershell
npm.cmd run environment:server
```

In another terminal, configure the frontend and start it:

```powershell
$env:REACT_APP_ENVIRONMENT_API_URL = 'http://localhost:8787/api/environment/v1'
npm.cmd start
```

The first request loads controller data, the AWC bulk METAR cache, and versioned
airspace data. Outbound HTTPS access to VATSIM, aviationweather.gov, GitHub's API,
GitHub release assets, and raw.githubusercontent.com is required. Boundary downloads
are cached in `server/cache/airspace.json`; this generated cache is excluded from Git.
The weather layer is worldwide **reporting-station coverage**, not continuous global
cloud imagery. Zoom in to see station/category/cloud labels; click for the raw METAR,
observation time, cloud layers, ceiling, visibility, and winds.

Service configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Environment API port |
| `HOST` | `127.0.0.1` | Bind address; use `0.0.0.0` inside a container if required |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated frontend origins permitted by CORS |
| `VATSPY_REVISION` | Latest published release | Optional VATSpy tag or commit to pin |
| `REACT_APP_ENVIRONMENT_API_URL` | `/api/environment/v1` | Frontend build-time service URL |

For production, put the Node service behind HTTPS and route `/api/environment/v1/*`
to it, or set the frontend URL and the corresponding allowed origin before building.
Use one ingestion service instance, or add a shared cache before scaling to multiple
instances. `GET /api/environment/v1/health` reports each provider's cache state.
To prefetch/update geometry explicitly, run `npm.cmd run environment:airspace`.

### Coverage and weather semantics

* Each search freezes the environment snapshot and policies. Live map updates do not
  change existing result scores. **Recheck selected route** evaluates an existing
  route against current data; run a new search to discover different candidates.
* Endpoint requirements can apply to the itinerary endpoints or every takeoff and
  landing, including inserted stops. En-route percentage can apply to each leg or
  the itinerary. Empty and appended destination legs are included.
* The coverage model is a direct great-circle track densified at intervals no longer
  than 5 NM, with boundary intersections on those chords. It handles polygon holes,
  overlapping sectors, MultiPolygons, and antimeridian crossings. Full coverage is
  relative to this horizontal model; it does not verify altitude-specific ownership,
  SID/STAR/airway routing, or a controller remaining online until arrival.
* Exact dataset position matches are mapped. Broad callsign-prefix fallbacks are
  inferred, drawn dashed, and excluded from strict checks unless explicitly enabled.
  Center polygons do not automatically establish tower service. ATIS and observers
  do not count. Airport local-ID aliases must be unambiguous and airport/station
  coordinates must agree within 5 NM with the FSE airport. Historic codes are never
  blindly inferred from simulator alternatives.
* VATSIM snapshots older than 120 seconds and METAR observations older than 90 minutes
  are unknown for planning. Unknown data fails requirements. Refresh failures retain
  original source timestamps rather than making cached data appear current.
* ATC preference score is the weighted mean of departure coverage, arrival coverage,
  and covered-distance fraction; default weights are 30/30/40. Only enabled preference
  components contribute. With requirements alone, the displayed score summarizes
  the active components. Earnings remain separate. Candidate retention considers
  coverage and financial objectives, but bounded search remains heuristic.
* Weather uses the worse of ceiling and visibility to classify VFR/MVFR/IFR/LIFR.
  Missing sky/visibility information remains unknown. Cloud bases are feet AGL,
  visibility is statute miles, and winds are knots. METARs are observations, not
  forecasts for the estimated arrival time. Category colors are not worldwide legal
  flight-rule determinations.
* New overlay preferences are stored by name under `environmentLayersV1`. Existing
  positional/custom-layer storage is left intact. Planner policies use
  `environmentPolicyV1`.

### Sources and implementation references

* [VATSIM Data API](https://vatsim.dev/api/data-api/get-network-data/) and its
  [status document](https://status.vatsim.net/status.json): controller snapshots,
  cached for 30 seconds. No authentication is needed.
* [VATSpy Data Project](https://github.com/vatsimnetwork/vatspy-data-project): airport
  identities and FIR boundaries, **CC BY-SA 4.0**. The importer resolves the release
  to a commit, joins callsign prefixes to boundary IDs, and records revision,
  checksum, and attribution in the generated dataset. These normalized data retain
  their upstream terms; the application's MIT license does not replace them.
* [SimAware TRACON Project](https://github.com/vatsimnetwork/simaware-tracon-project):
  APP/DEP geometry from its published GeoJSON asset, when available. The dataset
  records the source release. Missing approach geometry is explicitly displayed;
  independently mapped airport controllers remain available.
* [NOAA Aviation Weather Center](https://aviationweather.gov/data/api/): worldwide
  bulk METAR cache, refreshed by this service every two minutes. The service is
  necessary because AWC does not permit browser CORS requests.
* [VATSIM Radar](https://github.com/VATSIM-Radar/vatsim-radar) was inspected as an
  architectural reference. Its [data-source documentation](https://docs.vatsim-radar.com/contributing/data),
  [controller processing](https://github.com/VATSIM-Radar/vatsim-radar/blob/next/app/utils/server/vatsim/update.ts),
  and [regional extension rules](https://docs.vatsim-radar.com/guide/duplicating)
  informed source separation, DEP/RMP normalization, and conservative handling of
  inferred sectors. Radar code and regional extension tables are not vendored.
  Its code license is CC BY-NC 4.0. Some geometry source files were unavailable
  during this review, so this implementation does not claim full Radar parity.

Continuous model cloud fields, TAF-at-ETA evaluation, VATGlasses altitude-aware
ownership, and regional controller extension datasets remain separate future
extensions. The implemented weather baseline is worldwide METAR/category/cloud-layer
display and observed-category preference/requirements.

### Validation and maintenance

```powershell
npm.cmd run test:environment
npm.cmd run build
```

The dependency-free Node suite exercises weather thresholds, stale/unknown behavior,
geometry gaps/holes/dateline handling, controller matching, coverage retention,
cache/CORS/HTTP behavior, and legacy route-search parity. Tests use recorded/synthetic
inputs and never contact live providers. On environments that prohibit test-process
spawning, Node 24 can run the suite in one process:

```powershell
node --test --experimental-test-isolation=none tests/*.test.mjs
```

Implementation entry points for follow-up work:

| Area | Files |
| --- | --- |
| Data service and cache | `server/index.mjs`, `server/cache.mjs`, `server/providers.mjs` |
| Weather normalization | `src/Environment/weather.mjs` |
| Controller/sector matching | `src/Environment/vatsim.mjs` |
| Geometry and route evaluation | `src/Environment/geometry.mjs`, `src/Environment/evaluate.mjs` |
| Browser polling and snapshots | `src/Environment/EnvironmentProvider.js` |
| Map overlays | `src/MapLayers/EnvironmentLayers.js`, `src/MapLayers/Route.js` |
| Search and controls | `src/Routing/routingCore.mjs`, `src/Routing/EnvironmentOptions.js` |

Keep provider fields behind the normalization adapters. Extend fixture coverage before
adding new sector matching rules. Preserve source timestamps and fail unknown strict
requirements. When changing search construction, validate every actual flown leg after
all stop/final-leg insertions. Keep the legacy-parity fixtures for disabled features;
the final-leg range regression intentionally differs from legacy behavior.

## License

FSE Planner is open source software licensed as [MIT](https://github.com/piero-la-lune/FSE-Planner/blob/master/LICENSE).
