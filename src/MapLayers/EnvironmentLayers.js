import React from 'react';
import L from 'leaflet';
import { Box, Typography, Checkbox, FormControlLabel, Button, IconButton, Popover, FormControl, Select, MenuItem, Slider } from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import OpacityIcon from '@mui/icons-material/Opacity';
import { ENVIRONMENT_API, useEnvironment } from '../Environment/EnvironmentProvider.js';
import { formatController, matchControllers, sectorControllers } from '../Environment/vatsim.mjs';
import { wrapLon, containsPoint } from '../Environment/geometry.mjs';
import { CATEGORY_COLORS, isFresh, VATSIM_MAX_AGE_MS, WEATHER_MAX_AGE_MS } from '../Environment/defaults.mjs';
import { formatVisibility, formatWind } from '../Environment/weather.mjs';
import { coverageHatchSegments, coverageTileSample, coverageZoomLadder, effectiveNativeZoom, isUnsupportedZoomNotice, recolorCloudFractionPixels, tileHasVisibleCoverage } from './weatherTiles.mjs';

const cloudSymbols = { CLR: '○', SKC: '○', NSC: '○', NCD: '○', FEW: '◔', SCT: '◑', BKN: '◕', OVC: '●', VV: '⊗', OVX: '⊗', UNKNOWN: '?' };
const WEATHER_TYPE_ORDER = [
  { id: 'cloud_cover', label: 'Clouds', stack: 410, defaultLayer: 'cloud_cover_daily' },
  { id: 'ceiling', label: 'Cloud ceiling', stack: 416, defaultLayer: 'cloud_ceiling_forecast' },
  { id: 'radar', label: 'Rain radar', stack: 422, defaultLayer: 'radar_norway' },
  { id: 'precipitation', label: 'Precipitation', stack: 430, defaultLayer: 'precipitation_recent' },
];
const weatherLayerDefaults = { weatherMap: false, weatherSelections: null };
function preferences() {
  try { return { vatsim: false, weather: false, ...weatherLayerDefaults, ...JSON.parse(localStorage.getItem('environmentLayersV1') || '{}') }; }
  catch { return { vatsim: false, weather: false, ...weatherLayerDefaults }; }
}
function weatherTypes(catalog) {
  const listed = catalog?.types?.length ? catalog.types : WEATHER_TYPE_ORDER;
  return listed.map(type => {
    const known = WEATHER_TYPE_ORDER.find(item => item.id === type.id);
    return { ...known, ...type, stack: type.stack ?? known?.stack ?? 430, label: type.label || known?.label || type.id };
  }).sort((a, b) => a.stack - b.stack);
}
function buildWeatherSelections(catalog, stored) {
  const selections = {};
  const layers = catalog?.layers || [];
  const legacyLayer = stored?.weatherSelections ? null : layers.find(layer => layer.id === stored?.weatherLayer);
  for (const type of weatherTypes(catalog)) {
    const providers = layers.filter(layer => layer.phenomenon === type.id);
    const previous = stored?.weatherSelections?.[type.id] || {};
    const fallback = providers.find(layer => layer.id === (type.defaultLayer || previous.provider)) || providers.find(layer => layer.available) || providers[0];
    const provider = providers.some(layer => layer.id === previous.provider) ? previous.provider : (fallback?.id || '');
    const providerLayer = providers.find(layer => layer.id === provider);
    let enabled = Boolean(previous.enabled);
    if (!stored?.weatherSelections) enabled = type.id === 'cloud_cover' || type.id === 'precipitation' || legacyLayer?.phenomenon === type.id;
    selections[type.id] = {
      enabled: enabled && Boolean(providerLayer?.available),
      provider,
      slice: previous.slice || '',
      opacity: Number.isFinite(Number(previous.opacity)) ? Number(previous.opacity) : Math.round((providerLayer?.defaultOpacity ?? 0.55) * 100),
    };
  }
  return selections;
}
function popup(lines) {
  const div = document.createElement('div');
  div.style.maxWidth = '340px';
  for (const line of lines.filter(Boolean)) { const row = document.createElement('div'); row.textContent = line; div.appendChild(row); }
  return div;
}
function utcTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(11, 16) + ' UTC';
}
function isStandingNote(text) {
  return /provider-styled|stretched view|contributing radar|latest complete daily|light hatch/i.test(text);
}
function focusedNotice(text) {
  const value = String(text || '').trim();
  if (/complete daily composite was unavailable/i.test(value)) return 'Incomplete coverage';
  if (/tile failed to load/i.test(value)) return 'Tile failed to load';
  if (/image failed to load/i.test(value)) return 'Image failed to load';
  return value.replace(/^Weather layers:\s*/i, '');
}
function utcDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}
function layerTimeText(manifest, slice) {
  if (manifest?.valid_start && manifest.valid_end && manifest.valid_start !== manifest.valid_end) return `Valid ${utcDateTime(manifest.valid_start)} to ${utcDateTime(manifest.valid_end)}`;
  if (manifest?.valid_end || manifest?.valid_start) return `Valid ${utcTime(manifest.valid_end || manifest.valid_start)}`;
  if (slice?.time_label || manifest?.time_label) return slice?.time_label || manifest.time_label;
  return 'Valid time unavailable';
}
function layerPopup(manifest, slice) {
  return popup([
    manifest?.label,
    layerTimeText(manifest, slice),
    manifest?.model_run_time ? `Run: ${utcTime(manifest.model_run_time)}` : null,
    manifest?.retrieved_at ? `Retrieved: ${utcTime(manifest.retrieved_at)}` : null,
    manifest?.manifest_generated_at ? `Manifest: ${utcTime(manifest.manifest_generated_at)}` : null,
    manifest?.provider && manifest?.product ? `${manifest.provider} · ${manifest.product}` : manifest?.provider,
    manifest?.units ? `Units: ${manifest.units}` : null,
    ...(manifest?.warnings || []),
  ]);
}
function layerImageUrl(manifest) {
  if (!manifest?.image) return null;
  return manifest.image.startsWith('/') ? `${ENVIRONMENT_API}${manifest.image}` : manifest.image;
}
function layerTileUrl(manifest) {
  const template = manifest?.tile?.urlTemplate;
  if (!template) return null;
  return template.startsWith('/') ? `${ENVIRONMENT_API}${template}` : template;
}
function tileUrlFromTemplate(template, z, x, y) {
  return template.replaceAll('{z}', String(z)).replaceAll('{x}', String(x)).replaceAll('{y}', String(y));
}
function paintNoCoverageHatch(context, coords, tileSize) {
  context.save();
  context.strokeStyle = 'rgba(58, 64, 74, 0.62)';
  context.lineWidth = 1;
  context.beginPath();
  for (const [x0, y0, x1, y1] of coverageHatchSegments(coords.x, coords.y, tileSize)) {
    context.moveTo(x0, y0);
    context.lineTo(x1, y1);
  }
  context.stroke();
  context.restore();
}
function createCoverageTileLayer(urlTemplate, options = {}) {
  const minNativeZoom = options.minNativeZoom ?? 0;
  const maxNativeZoom = options.maxNativeZoom ?? minNativeZoom;
  const tileSize = options.tileSize || 256;
  const CoverageLayer = L.GridLayer.extend({
    createTile(coords, done) {
      const tile = document.createElement('canvas');
      tile.width = tileSize;
      tile.height = tileSize;
      const context = tile.getContext('2d', { willReadFrequently: true });
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        done(error || null, tile);
      };
      const showNoCoverage = () => {
        context.clearRect(0, 0, tileSize, tileSize);
        paintNoCoverageHatch(context, coords, tileSize);
        finish(null);
      };
      const zooms = coverageZoomLadder(coords.z, minNativeZoom, maxNativeZoom);
      const paint = (index) => {
        const sample = coverageTileSample(coords, zooms[index], tileSize);
        if (!sample) {
          if (index + 1 < zooms.length) paint(index + 1);
          else showNoCoverage();
          return;
        }
        const image = new Image();
        image.onload = () => {
          context.clearRect(0, 0, tileSize, tileSize);
          context.imageSmoothingEnabled = sample.sourceSize !== tileSize;
          context.drawImage(image, sample.sourceX, sample.sourceY, sample.sourceSize, sample.sourceSize, 0, 0, tileSize, tileSize);
          try {
            const pixels = context.getImageData(0, 0, tileSize, tileSize);
            if (isUnsupportedZoomNotice(pixels.data)) {
              if (index + 1 < zooms.length) paint(index + 1);
              else showNoCoverage();
              return;
            }
            if (options.colorTreatment === 'cloud-fraction-alpha') {
              recolorCloudFractionPixels(pixels.data);
              context.putImageData(pixels, 0, 0);
            }
            if (!tileHasVisibleCoverage(pixels.data)) showNoCoverage();
            else finish(null);
          } catch {
            finish(null);
          }
        };
        image.onerror = () => {
          if (index + 1 < zooms.length) paint(index + 1);
          else showNoCoverage();
        };
        image.crossOrigin = 'anonymous';
        image.src = tileUrlFromTemplate(urlTemplate, sample.z, sample.x, sample.y);
      };
      if (!zooms.length) showNoCoverage();
      else paint(0);
      return tile;
    },
  });
  return new CoverageLayer({
    pane: options.pane,
    opacity: options.opacity,
    attribution: options.attribution,
    tileSize,
  });
}
function layerOpacity(value) {
  return Math.max(0, Math.min(1, Number(value || 55) / 100));
}
function createEquirectangularRasterLayer(imageUrl, options = {}) {
  const RasterLayer = L.GridLayer.extend({
    initialize(layerOptions) {
      L.GridLayer.prototype.initialize.call(this, layerOptions);
      this._source = null;
      this._loadSource(imageUrl);
    },
    _loadSource(url) {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        this._source = {
          width: canvas.width,
          height: canvas.height,
          data: context.getImageData(0, 0, canvas.width, canvas.height).data,
        };
        this.redraw();
      };
      image.onerror = () => options.onError?.();
      image.src = url;
    },
    createTile(coords, done) {
      const tile = document.createElement('canvas');
      const size = this.getTileSize();
      tile.width = size.x;
      tile.height = size.y;
      const context = tile.getContext('2d');
      if (!this._source) {
        setTimeout(() => done(null, tile), 0);
        return tile;
      }
      const output = context.createImageData(size.x, size.y);
      const worldSize = size.x * Math.pow(2, coords.z);
      const source = this._source;
      for (let y = 0; y < size.y; y++) {
        const worldY = coords.y * size.y + y;
        if (worldY < 0 || worldY >= worldSize) continue;
        const mercatorY = worldY / worldSize;
        const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * mercatorY))) * 180 / Math.PI;
        const sourceY = Math.max(0, Math.min(source.height - 1, Math.floor((90 - lat) / 180 * source.height)));
        for (let x = 0; x < size.x; x++) {
          const worldX = coords.x * size.x + x;
          const wrappedX = ((worldX % worldSize) + worldSize) % worldSize;
          const sourceX = Math.max(0, Math.min(source.width - 1, Math.floor(wrappedX / worldSize * source.width)));
          const sourceIndex = (sourceY * source.width + sourceX) * 4;
          const outputIndex = (y * size.x + x) * 4;
          output.data[outputIndex] = source.data[sourceIndex];
          output.data[outputIndex + 1] = source.data[sourceIndex + 1];
          output.data[outputIndex + 2] = source.data[sourceIndex + 2];
          output.data[outputIndex + 3] = source.data[sourceIndex + 3];
        }
      }
      context.putImageData(output, 0, 0);
      setTimeout(() => done(null, tile), 0);
      return tile;
    },
  });
  return new RasterLayer(options);
}
function sectorTooltipLines(sector, now) {
  const controllers = sector.controllers?.length ? sector.controllers.map(controller => formatController(controller, now)) : [sector.callsigns.join(', ')];
  const bookedOnly = sectorControllers(sector).length > 0 && sectorControllers(sector).every(controller => controller.online === false);
  const header = [sector.name, sector.facility, bookedOnly ? 'booked later' : null, sector.confidence === 'inferred' ? 'inferred' : ''].filter(Boolean).join(' · ');
  return [header, ...controllers];
}
function displayGeometry(geometry, center) {
  const polygon = rings => {
    const origin = center + wrapLon(rings[0][0][0] - center);
    return rings.map(r => {
      let previous = origin;
      return r.map(([lon, lat]) => { previous += wrapLon(lon - previous); return [previous, lat]; });
    });
  };
  return { ...geometry, coordinates: geometry.type === 'Polygon' ? polygon(geometry.coordinates) : geometry.coordinates.map(polygon) };
}
// Persist by names in a separate key: legacy positional custom-layer storage is untouched.
export default function EnvironmentLayers({ map }) {
  const [visible, setVisible] = React.useState(preferences);
  const [weatherErrorEl, setWeatherErrorEl] = React.useState(null);
  const [layerNoticeEl, setLayerNoticeEl] = React.useState(null);
  const [layerCatalog, setLayerCatalog] = React.useState(null);
  const [layerViews, setLayerViews] = React.useState({});
  const [layerError, setLayerError] = React.useState('');
  const [layerLoadingCount, setLayerLoadingCount] = React.useState(0);
  const [layerReload, setLayerReload] = React.useState(0);
  const weatherRasterRef = React.useRef(new Map());
  const live = useEnvironment(visible.vatsim || visible.weather);
  const { snapshot, now } = live;
  const airports = snapshot.airspace?.airports;
  const matched = React.useMemo(() => matchControllers(snapshot.vatsim, snapshot.airspace), [snapshot.vatsim, snapshot.airspace]);
  const fresh = isFresh(snapshot.vatsim?.sourceUpdatedAt, now, VATSIM_MAX_AGE_MS);
  const layerItems = layerCatalog?.layers || [];
  const types = React.useMemo(() => weatherTypes(layerCatalog), [layerCatalog]);
  const selections = visible.weatherSelections;
  const selectionsRef = React.useRef(selections);
  selectionsRef.current = selections;
  const enabledSignature = types.map(type => {
    const selection = selections?.[type.id];
    return selection?.enabled ? `${type.id}:${selection.provider}:${selection.slice || ''}` : '';
  }).join('|');
  const opacitySignature = types.map(type => `${type.id}:${selections?.[type.id]?.opacity ?? ''}`).join('|');
  const layerLoading = layerLoadingCount > 0;
  const updateSelection = (typeId, patch) => setVisible(current => ({
    ...current,
    weatherSelections: {
      ...current.weatherSelections,
      [typeId]: { ...current.weatherSelections?.[typeId], ...patch },
    },
  }));
  React.useEffect(() => { try { localStorage.setItem('environmentLayersV1', JSON.stringify(visible)); } catch { /* Optional preference persistence. */ } }, [visible]);
  React.useEffect(() => {
    if (!visible.weatherMap) return undefined;
    const controller = new AbortController();
    setLayerLoadingCount(count => count + 1);
    setLayerError('');
    fetch(`${ENVIRONMENT_API}/weather/layers`, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(data => setLayerCatalog(data))
      .catch(error => { if (error.name !== 'AbortError') setLayerError(`Weather layers: ${error.message}`); })
      .finally(() => setLayerLoadingCount(count => Math.max(0, count - 1)));
    return () => controller.abort();
  }, [visible.weatherMap, layerReload]);
  React.useEffect(() => {
    if (!layerCatalog) return;
    setVisible(current => {
      if (current.weatherSelections && types.every(type => current.weatherSelections[type.id])) return current;
      return { ...current, weatherSelections: buildWeatherSelections(layerCatalog, current) };
    });
  }, [layerCatalog, types]);
  React.useEffect(() => {
    const currentSelections = selectionsRef.current;
    if (!visible.weatherMap || !currentSelections) { setLayerViews({}); return undefined; }
    const controller = new AbortController();
    const jobs = types.flatMap(type => {
      const selection = currentSelections[type.id];
      if (!selection?.enabled || !selection.provider) return [];
      return [({ type, selection })];
    }).map(async ({ type, selection }) => {
      setLayerLoadingCount(count => count + 1);
      try {
        const timelineResponse = await fetch(`${ENVIRONMENT_API}/weather/layers/${encodeURIComponent(selection.provider)}/timeline`, { signal: controller.signal });
        if (!timelineResponse.ok) throw new Error(`HTTP ${timelineResponse.status}`);
        const timeline = await timelineResponse.json();
        const frames = timeline.slices || [];
        const slice = frames.some(frame => frame.id === selection.slice) ? selection.slice : (timeline.selected || frames[0]?.id || '');
        if (slice !== selection.slice) {
          setVisible(current => {
            const currentSelection = current.weatherSelections?.[type.id];
            if (!currentSelection || currentSelection.provider !== selection.provider || currentSelection.slice === slice) return current;
            return { ...current, weatherSelections: { ...current.weatherSelections, [type.id]: { ...currentSelection, slice } } };
          });
        }
        if (!slice) return { id: type.id, timeline, manifest: null, slice, error: timeline.unavailableReason || 'No time slice is available.' };
        const manifestResponse = await fetch(`${ENVIRONMENT_API}/weather/layers/${encodeURIComponent(selection.provider)}/${encodeURIComponent(slice)}/manifest`, { signal: controller.signal });
        if (!manifestResponse.ok) throw new Error(`HTTP ${manifestResponse.status}`);
        return { id: type.id, timeline, manifest: await manifestResponse.json(), slice, error: '' };
      } catch (error) {
        if (error.name === 'AbortError') return null;
        return { id: type.id, timeline: null, manifest: null, slice: selection.slice, error: error.message };
      } finally {
        setLayerLoadingCount(count => Math.max(0, count - 1));
      }
    });
    Promise.all(jobs).then(results => {
      if (controller.signal.aborted) return;
      const next = {};
      for (const result of results) if (result) next[result.id] = result;
      setLayerViews(next);
      setLayerError(results.find(result => result?.error)?.error || '');
    });
    return () => controller.abort();
  }, [visible.weatherMap, enabledSignature, layerReload, types]);
  React.useEffect(() => {
    for (const [name, z] of [['environmentSectors', 350], ['environmentWeather', 450]]) {
      if (!map.getPane(name)) map.createPane(name).style.zIndex = z;
    }
    const sectorLayer = L.layerGroup().addTo(map), weatherLayer = L.layerGroup().addTo(map);
    const sectorRenderer = L.svg({ pane: 'environmentSectors', padding: 0.2 }).addTo(map);
    const renderer = L.canvas({ pane: 'environmentWeather', padding: 0.2 });
    const coverageTip = L.tooltip({ direction: 'top', offset: [0, -14], opacity: 0.96, interactive: false });
    let timer, hoverTimer = null, hoverFrame = 0, hoverEvent = null, pendingKey = '', openKey = '', dwellLatLng = null, dragging = false, disposed = false;
    const hatchFill = () => {
      const svg = sectorRenderer._container;
      if (!svg) return '#777';
      if (!svg.querySelector('#fse-booked-atc-hatch')) {
        const ns = 'http://www.w3.org/2000/svg';
        const defs = svg.querySelector('defs') || svg.insertBefore(document.createElementNS(ns, 'defs'), svg.firstChild);
        const pattern = document.createElementNS(ns, 'pattern');
        pattern.id = 'fse-booked-atc-hatch';
        pattern.setAttribute('patternUnits', 'userSpaceOnUse');
        pattern.setAttribute('width', '8');
        pattern.setAttribute('height', '8');
        const rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('width', '8'); rect.setAttribute('height', '8'); rect.setAttribute('fill', '#777'); rect.setAttribute('fill-opacity', '0.015');
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('d', 'M-2,8 l10,-10 M0,10 l10,-10');
        path.setAttribute('stroke', '#777'); path.setAttribute('stroke-width', '1'); path.setAttribute('stroke-opacity', '0.16');
        pattern.appendChild(rect); pattern.appendChild(path); defs.appendChild(pattern);
      }
      return 'url(#fse-booked-atc-hatch)';
    };
    const hideCoverageTip = () => {
      clearTimeout(hoverTimer); hoverTimer = null; pendingKey = ''; openKey = '';
      if (map.hasLayer(coverageTip)) map.removeLayer(coverageTip);
    };
    const sectorsAt = latlng => {
      const point = [wrapLon(latlng.lng), latlng.lat];
      return matched.sectors.filter(sector => sector.geometry && containsPoint(sector.geometry, point))
        .sort((a, b) => (a.facility === 'APP' ? 0 : 1) - (b.facility === 'APP' ? 0 : 1) || (a.name || '').localeCompare(b.name || ''));
    };
    const inspectCoverage = event => {
      if (disposed || dragging || !visible.vatsim) { hideCoverageTip(); return; }
      const sectors = sectorsAt(event.latlng);
      const key = sectors.map(sector => `${sector.id}:${sector.confidence}:${sector.callsigns.join(',')}`).join('|');
      dwellLatLng = event.latlng;
      if (!key) { hideCoverageTip(); return; }
      if (key === openKey) { coverageTip.setLatLng(event.latlng); return; }
      if (key === pendingKey) return;
      clearTimeout(hoverTimer);
      pendingKey = key; openKey = '';
      if (map.hasLayer(coverageTip)) map.removeLayer(coverageTip);
      hoverTimer = setTimeout(() => {
        if (disposed || pendingKey !== key) return;
        const lines = sectors.flatMap((sector, index) => sectorTooltipLines(sector, now).map((line, lineIndex) => lineIndex === 0 && index ? `— ${line}` : line));
        coverageTip.setLatLng(dwellLatLng).setContent(popup(lines));
        if (!map.hasLayer(coverageTip)) coverageTip.addTo(map);
        openKey = key;
      }, 550);
    };
    const onCoverageMove = event => {
      hoverEvent = event;
      if (hoverFrame) return;
      hoverFrame = requestAnimationFrame(() => { hoverFrame = 0; if (hoverEvent) inspectCoverage(hoverEvent); });
    };
    const draw = () => {
      sectorLayer.clearLayers(); weatherLayer.clearLayers();
      const center = map.getCenter().lng;
      const coverageOpacity = Math.max(0, Math.min(1, Number(visible.vatsimOpacity ?? 100) / 100));
      if (visible.vatsim) for (const sector of matched.sectors) {
        if (!sector.geometry) continue;
        const feature = { type: 'Feature', properties: {}, geometry: displayGeometry(sector.geometry, center) };
        const bookedOnly = sectorControllers(sector).length > 0 && sectorControllers(sector).every(controller => controller.online === false);
        const color = !fresh || bookedOnly ? '#777' : (sector.facility === 'APP' ? '#8253ad' : '#296a9c');
        L.geoJSON(feature, { pane: 'environmentSectors', renderer: sectorRenderer, interactive: false, style: { color, fillColor: bookedOnly ? hatchFill() : color, weight: bookedOnly ? 1 : 1.5, opacity: coverageOpacity, fillOpacity: (bookedOnly ? 1 : 0.12) * coverageOpacity, dashArray: bookedOnly ? '4 6' : undefined } })
          .addTo(sectorLayer);
      }
      if (visible.vatsim) for (const [id, controllers] of Object.entries(matched.airportControllers)) {
        const airport = airports?.[id];
        if (!airport) continue;
        const lon = center + wrapLon(airport.lon - center);
        const bookedOnly = controllers.length > 0 && controllers.every(controller => controller.online === false);
        const color = !fresh || bookedOnly ? '#777' : '#067a98';
        L.circleMarker([airport.lat, lon], { renderer, radius: 9, weight: bookedOnly ? 1 : 2, color, opacity: coverageOpacity, fill: false, dashArray: bookedOnly ? '3 4' : undefined })
          .bindTooltip(popup([id, ...controllers.map(c => formatController(c, now))]))
          .bindPopup(popup([`${id} · ${airport.name || 'Airport ATC'}`, bookedOnly ? 'Booked future coverage, not online now' : null, ...controllers.map(c => formatController(c, now)), snapshot.vatsim?.sourceUpdatedAt, fresh ? 'Online at snapshot time' : 'Stale snapshot']))
          .addTo(sectorLayer);
      }
      if (visible.weather) {
        const bounds = map.getBounds().pad(0.1), cells = new Set(), zoom = map.getZoom();
        let count = 0;
        for (const obs of Object.values(snapshot.weather?.observations || {})) {
          // Hourly NOAA cycle reports identify the station but carry no coordinates. Leaflet treats a null latitude as a missing point and throws.
          if (!Number.isFinite(obs.lat) || !Number.isFinite(obs.lon)) continue;
          const lon = center + wrapLon(obs.lon - center), position = L.latLng(obs.lat, lon);
          if (!position || !bounds.contains(position)) continue;
          const pixel = map.latLngToContainerPoint(position), size = zoom < 7 ? 28 : 15;
          const cell = `${Math.floor(pixel.x / size)}:${Math.floor(pixel.y / size)}`;
          if (cells.has(cell) || count >= 2000) continue;
          cells.add(cell); count++;
          const known = isFresh(obs.observedAt, now, WEATHER_MAX_AGE_MS), category = known ? obs.category : 'UNKNOWN';
          const clouds = (obs.clouds || []).map(c => `${c.cover} ${c.baseFtAGL === null ? 'unknown base' : `${c.baseFtAGL} ft AGL`}`).join(', ');
          L.circleMarker(position, { renderer, pane: 'environmentWeather', radius: zoom >= 8 ? 6 : 4, weight: 1, color: '#fff', fillColor: CATEGORY_COLORS[category], fillOpacity: 0.95 })
            .bindTooltip(popup([`${obs.stationId} · ${category} ${cloudSymbols[obs.cloudCover] || '?'}`]), { permanent: zoom >= 9, direction: 'top' })
            .bindPopup(popup([`${obs.stationId} · ${category}${known ? '' : ' (stale)'}`, obs.observedAt,
              `${cloudSymbols[obs.cloudCover] || '?'} ${clouds || obs.cloudCover}`, `Ceiling: ${obs.skyKnown ? obs.ceilingFtAGL === null ? 'no reported ceiling' : `${obs.ceilingFtAGL} ft AGL` : 'unknown'}`,
              `Visibility: ${formatVisibility(obs.visibility)}`,
              `Wind: ${formatWind(obs)}`, obs.raw, `Source: ${obs.source === 'NOAA-cycle' ? 'NOAA METAR cycles' : 'NOAA Aviation Weather Center'}`]))
            .addTo(weatherLayer);
        }
      }
    };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(draw, 120); };
    const onDragStart = () => { dragging = true; hideCoverageTip(); };
    const onDragEnd = () => { dragging = false; };
    const container = map.getContainer();
    const onLeave = () => hideCoverageTip();
    draw();
    map.on('moveend', schedule);
    map.on('mousemove', onCoverageMove);
    map.on('dragstart', onDragStart);
    map.on('dragend', onDragEnd);
    container.addEventListener('mouseleave', onLeave);
    return () => {
      disposed = true; clearTimeout(timer); clearTimeout(hoverTimer); cancelAnimationFrame(hoverFrame); hideCoverageTip();
      map.off('moveend', schedule); map.off('mousemove', onCoverageMove); map.off('dragstart', onDragStart); map.off('dragend', onDragEnd);
      container.removeEventListener('mouseleave', onLeave);
      sectorLayer.remove(); sectorRenderer.remove(); weatherLayer.remove(); renderer.remove();
    };
  }, [map, matched, visible.vatsim, visible.vatsimOpacity, visible.weather, snapshot.weather, snapshot.vatsim, airports, fresh, now]);
  const viewSignature = types.map(type => {
    const selection = selections?.[type.id];
    const view = layerViews[type.id];
    return selection?.enabled ? `${type.id}:${selection.provider}:${view?.slice || ''}:${view?.manifest?.tile?.urlTemplate || view?.manifest?.image || ''}` : '';
  }).join('|');
  React.useEffect(() => {
    const removeAll = () => {
      weatherRasterRef.current.forEach(entry => entry.overlay.remove());
      weatherRasterRef.current.clear();
    };
    if (!visible.weatherMap || !selections) { removeAll(); return undefined; }
    const active = new Set();
    for (const type of types) {
      const selection = selections[type.id];
      const view = layerViews[type.id];
      const manifest = view?.manifest;
      if (!selection?.enabled || !manifest) continue;
      active.add(type.id);
      const signature = `${selection.provider}:${view.slice}:${manifest.tile?.urlTemplate || manifest.image || ''}`;
      const existing = weatherRasterRef.current.get(type.id);
      if (existing?.signature === signature) continue;
      existing?.overlay.remove();
      const paneName = `environmentWeatherRaster-${type.id}`;
      if (!map.getPane(paneName)) map.createPane(paneName).style.zIndex = String(type.stack);
      else map.getPane(paneName).style.zIndex = String(type.stack);
      const imageUrl = layerImageUrl(manifest);
      const tileUrl = layerTileUrl(manifest);
      if (!imageUrl && !tileUrl) continue;
      const slice = (view.timeline?.slices || []).find(item => item.id === view.slice) || null;
      const overlay = tileUrl
        ? createCoverageTileLayer(tileUrl, {
          pane: paneName,
          opacity: layerOpacity(selection.opacity),
          tileSize: manifest.tile.tileSize || 256,
          minNativeZoom: manifest.tile.minNativeZoom ?? 0,
          maxNativeZoom: effectiveNativeZoom(manifest.tile.maxNativeZoom, manifest.data_kind),
          colorTreatment: manifest.tile.colorTreatment || (manifest.layer === 'cloud_cover_daily' ? 'cloud-fraction-alpha' : undefined),
          attribution: manifest.attribution,
        }).on('tileerror', () => setLayerError('Weather layer tile failed to load from the provider.'))
        : createEquirectangularRasterLayer(imageUrl, {
          pane: paneName,
          opacity: layerOpacity(selection.opacity),
          interactive: true,
          onError: () => setLayerError('Weather layer image failed to load from the provider.'),
        });
      overlay.bindPopup(layerPopup(manifest, slice));
      overlay.addTo(map);
      weatherRasterRef.current.set(type.id, { overlay, signature });
    }
    for (const [id, entry] of weatherRasterRef.current) {
      if (!active.has(id)) { entry.overlay.remove(); weatherRasterRef.current.delete(id); }
    }
    return undefined;
  }, [map, visible.weatherMap, viewSignature, selections, types, layerViews]);
  React.useEffect(() => {
    if (!selections) return;
    for (const type of types) weatherRasterRef.current.get(type.id)?.overlay.setOpacity(layerOpacity(selections[type.id]?.opacity));
  }, [opacitySignature, selections, types]);
  const weatherNotices = [];
  if (layerError) weatherNotices.push({ severity: 'error', text: focusedNotice(layerError) });
  for (const type of types) {
    const selection = selections?.[type.id];
    if (!selection?.enabled) continue;
    const view = layerViews[type.id];
    if (view?.error) weatherNotices.push({ severity: 'error', text: `${type.label}: ${focusedNotice(view.error)}` });
    for (const warning of view?.manifest?.warnings || []) {
      if (isStandingNote(warning)) continue;
      weatherNotices.push({ severity: 'warning', text: `${type.label}: ${focusedNotice(warning)}` });
    }
  }
  const weatherNoticeSeverity = weatherNotices.some(notice => notice.severity === 'error') ? 'error' : 'warning';
  return <Box sx={{ mt: 2, borderTop: '1px solid #ddd', pt: 1 }}>
    <Typography variant="subtitle1">Live environment</Typography>
    <FormControlLabel label="VATSIM coverage" control={<Checkbox checked={visible.vatsim} onChange={e => setVisible(v => ({ ...v, vatsim: e.target.checked }))} />} />
    {visible.vatsim && <Box sx={{ px: 1 }}>
      <Slider
        size="small"
        min={10}
        max={100}
        step={5}
        value={Number(visible.vatsimOpacity ?? 100)}
        valueLabelDisplay="auto"
        valueLabelFormat={value => `${value}%`}
        onChange={(event, value) => setVisible(current => ({ ...current, vatsimOpacity: value }))}
        aria-label="VATSIM coverage opacity"
      />
    </Box>}
    <Box sx={{ display: 'flex', alignItems: 'center' }}>
      <FormControlLabel label="Weather / METAR" control={<Checkbox checked={visible.weather} onChange={e => setVisible(v => ({ ...v, weather: e.target.checked }))} />} />
      {live.errors.weather && <IconButton size="small" color="warning" aria-label="Weather problem" onClick={event => setWeatherErrorEl(event.currentTarget)}><ErrorOutlineIcon fontSize="small" /></IconButton>}
    </Box>
    <Popover open={Boolean(weatherErrorEl)} anchorEl={weatherErrorEl} onClose={() => setWeatherErrorEl(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
      <Typography variant="body2" sx={{ p: 1.5, maxWidth: 260 }}>{String(live.errors.weather || '').replace(/^weather:\s*/i, '')}</Typography>
    </Popover>
    {(visible.vatsim || visible.weather) && <Button size="small" disabled={live.loading} onClick={live.refresh}>{live.loading ? 'Updating…' : 'Refresh'}</Button>}
    <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid #eee' }}>
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        <FormControlLabel label="Weather map layers" control={<Checkbox checked={visible.weatherMap} onChange={e => setVisible(v => ({ ...v, weatherMap: e.target.checked }))} />} />
        {visible.weatherMap && <IconButton size="small" disabled={layerLoading} aria-label="Refresh weather layers" onClick={() => setLayerReload(n => n + 1)}><RefreshIcon fontSize="small" /></IconButton>}
        {weatherNotices.length > 0 && <IconButton size="small" color={weatherNoticeSeverity} aria-label="Weather layer notices" onClick={event => setLayerNoticeEl(event.currentTarget)}><ErrorOutlineIcon fontSize="small" /></IconButton>}
      </Box>
      <Popover open={Boolean(layerNoticeEl)} anchorEl={layerNoticeEl} onClose={() => setLayerNoticeEl(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
        <Box sx={{ p: 1.5, maxWidth: 260 }}>
          {weatherNotices.map((notice, index) => <Typography key={index} variant="body2" color={notice.severity === 'error' ? 'error' : 'warning'} sx={{ mb: index < weatherNotices.length - 1 ? 1 : 0 }}>{notice.text}</Typography>)}
        </Box>
      </Popover>
      {visible.weatherMap && selections && <Box sx={{ pl: 1 }}>
        {types.map(type => {
          const providers = layerItems.filter(layer => layer.phenomenon === type.id && layer.available);
          const selection = selections[type.id];
          if (!selection || !providers.length) return null;
          const providerId = providers.some(layer => layer.id === selection.provider) ? selection.provider : providers[0].id;
          const view = layerViews[type.id];
          const frames = selection.enabled && view?.timeline?.layer === providerId ? view.timeline.slices || [] : [];
          const frame = frames.find(item => item.id === (view?.slice || selection.slice)) || frames[0] || null;
          const frameIndex = Math.max(0, frames.findIndex(item => item.id === frame?.id));
          return <Box key={type.id}>
            <FormControlLabel
              label={type.label}
              control={<Checkbox checked={selection.enabled} onChange={event => updateSelection(type.id, { enabled: event.target.checked, provider: providerId })} />}
            />
            {selection.enabled && <>
              {providers.length > 1 && <FormControl fullWidth size="small" sx={{ mb: 0.5 }}>
                <Select
                  value={providerId}
                  onChange={event => updateSelection(type.id, { provider: event.target.value, slice: '' })}
                  aria-label={`${type.label} provider`}
                >
                  {providers.map(provider => <MenuItem key={provider.id} value={provider.id}>{provider.providerLabel}</MenuItem>)}
                </Select>
              </FormControl>}
              {frames.length > 1 && <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1 }}>
                <AccessTimeIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                <Slider
                  size="small"
                  min={0}
                  max={frames.length - 1}
                  step={1}
                  value={frameIndex}
                  valueLabelDisplay="auto"
                  valueLabelFormat={index => frames[index]?.label || ''}
                  onChange={(event, value) => updateSelection(type.id, { slice: frames[value]?.id || selection.slice })}
                  aria-label={`${type.label} time`}
                />
              </Box>}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1 }}>
                <OpacityIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                <Slider
                  size="small"
                  min={10}
                  max={100}
                  step={5}
                  value={Number(selection.opacity || 55)}
                  valueLabelDisplay="auto"
                  valueLabelFormat={value => `${value}%`}
                  onChange={(event, value) => updateSelection(type.id, { opacity: value })}
                  aria-label={`${type.label} opacity`}
                />
              </Box>
            </>}
          </Box>;
        })}
      </Box>}
    </Box>
  </Box>;
}
