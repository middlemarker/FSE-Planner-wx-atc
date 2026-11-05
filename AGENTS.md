# FSE Planner weather and VATSIM fork

This folder is the working copy of [middlemarker/FSE-Planner-wx-atc](https://github.com/middlemarker/FSE-Planner-wx-atc), branch `weather-atc-layers-work`. Open this folder as the Cursor project. The parent `d:\research\middlemarker\AGENTS.md` is the 2026-10-20 source study. It describes a plan, not the code in this repository.

## Run it

Node.js 22.15 or newer is required (`--use-system-ca`). Dependencies come from `npm ci --legacy-peer-deps`.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-local.ps1
```

That starts the environment API on `127.0.0.1:8787` and the planner at `http://localhost:3000`. `local.settings.ps1` and `.env.development.local` hold the local URL and are not committed. `install.ps1` can recreate them.

The browser talks only to this API. The API calls VATSIM, NOAA METAR, GitHub airspace files, NASA GIBS, and RainViewer.

## What is already built

- `server/` serves VATSIM, METAR snapshots, VATSpy/SimAware boundaries, and weather tiles.
- Map layers: VATSIM coverage with an opacity slider, METAR markers, and simultaneous cloud, precipitation, and rain-radar layers. Precipitation draws above clouds. Each weather type has its own provider, time, and opacity.
- Clouds use the latest complete NASA GIBS daily composite, not the unfinished current UTC day. Clear sky is a faint white veil. Clouds darken toward grey. Zoom past the native tiles is stretched.
- RainViewer zoom 8 and above is a fixed "Zoom Level Not Supported" image. Radar and the precipitation nowcast stop at zoom 7 and stretch that tile.
- A weather tile is hatched only when the whole tile has no coverage. Transparent pixels inside a covered tile are clear weather or no echo, not missing data.
- Route Finder can turn ATC coverage and observed weather off, prefer them, or require them. Saved routes from 1.19.8 remain.
- The layers panel shows controls. Warnings and load failures open from an icon. Do not put source notes, timestamps, or legends back into that panel.

## Leave on the server

NOAA METAR files, VATSIM status and bookings, and the VATSpy/SimAware geometry stay on the server. GIBS and RainViewer can be called from the browser, but that move has not been made. A browser cache does not replace the shared VATSIM fetch.

Cloud ceiling from NOAA GFS is listed in the catalog and is not available yet.

## Where to read more

- `docs/ATC_WEATHER_DESIGN.md` — route-search behavior and file map. Ignore its old claim that this folder is not a git repository.
- `docs/WEATHER_MAP_LAYERS_FEATURE.md` — weather-map research and acceptance checks.
- `docs/WEATHER_SOURCE_GUIDE.md` — source ranking, units, freshness, and coverage rules from 2026-10-20. A copy also sits at `d:\research\middlemarker\AGENTS.md`.

Keep missing data distinct from clear weather. Keep estimates distinct from observations. Use UTC internally.
