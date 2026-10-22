const NASA_GIBS_ATTRIBUTION = 'NASA Global Imagery Browse Services (GIBS), part of NASA ESDIS';
const RAINVIEWER_ATTRIBUTION = 'RainViewer weather radar API';
const GIBS_TILE_MATRIX_SET = 'GoogleMapsCompatible_Level6';
const GIBS_TILE_BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const RAINVIEWER_METADATA = 'https://api.rainviewer.com/public/weather-maps.json';

const gibsTimeCache = new Map();
let rainviewerCache = null;

function timedFetch(fetchImpl, url, init = {}, timeoutMs = 8000) {
  return fetchImpl(url, { ...init, signal: init.signal || AbortSignal.timeout(timeoutMs) });
}

const WEATHER_TYPES = [
  { id: 'cloud_cover', label: 'Clouds', stack: 410, defaultLayer: 'cloud_cover_daily' },
  { id: 'ceiling', label: 'Cloud ceiling', stack: 416, defaultLayer: 'cloud_ceiling_forecast' },
  { id: 'radar', label: 'Rain radar', stack: 422, defaultLayer: 'radar_norway' },
  { id: 'precipitation', label: 'Precipitation', stack: 430, defaultLayer: 'precipitation_recent' },
];

const LAYERS = [
  {
    id: 'precipitation_recent',
    label: 'Recent precipitation',
    kind: 'recent',
    phenomenon: 'precipitation',
    defaultProvider: 'imerg',
    providerLabel: 'NASA GIBS IMERG',
    available: true,
    hasTimeline: false,
    defaultOpacity: 0.55,
    legend: 'IMERG 30-minute precipitation rate, styled by NASA GIBS',
    summary: 'Near-global recent precipitation estimate served as Web Mercator tiles.',
    source: {
      type: 'gibs',
      layer: 'IMERG_Precipitation_Rate_30min',
      product: 'IMERG Precipitation Rate 30 min',
      dataKind: 'satellite_estimate',
      units: 'visual precipitation-rate tile',
      minNativeZoom: 0,
      maxNativeZoom: 6,
      attribution: NASA_GIBS_ATTRIBUTION,
      attributionUrl: 'https://www.earthdata.nasa.gov/eosdis/science-system-description/eosdis-components/gibs',
    },
  },
  {
    id: 'cloud_cover_daily',
    label: 'Cloud cover',
    kind: 'daily_composite',
    phenomenon: 'cloud_cover',
    defaultProvider: 'gibs',
    providerLabel: 'NASA GIBS MODIS',
    available: true,
    hasTimeline: false,
    defaultOpacity: 0.55,
    legend: 'Faint white is clear sky. Deeper grey is more cloud. Provider red is about 95-100% cover.',
    summary: 'Latest complete daily cloud-fraction composite. The in-progress UTC day is skipped so unfinished satellite swaths are not shown as gaps. Zoom past the native tiles is stretched.',
    source: {
      type: 'gibs',
      layer: 'MODIS_Terra_Cloud_Fraction_Day',
      product: 'MODIS Terra Cloud Fraction Day',
      dataKind: 'satellite_estimate',
      units: 'visual cloud-fraction tile',
      timePolicy: 'complete_daily',
      colorTreatment: 'cloud-fraction-alpha',
      minNativeZoom: 0,
      maxNativeZoom: 6,
      attribution: NASA_GIBS_ATTRIBUTION,
      attributionUrl: 'https://www.earthdata.nasa.gov/eosdis/science-system-description/eosdis-components/gibs',
    },
  },
  {
    id: 'precipitation_forecast',
    label: 'Precipitation nowcast',
    kind: 'forecast',
    phenomenon: 'precipitation',
    defaultProvider: 'rainviewer',
    providerLabel: 'RainViewer',
    available: true,
    hasTimeline: true,
    defaultOpacity: 0.55,
    legend: 'Radar precipitation nowcast, styled by RainViewer',
    summary: 'Short-term radar nowcast when provider forecast frames are available. Coverage is limited to radar-covered regions.',
    source: {
      type: 'rainviewer-nowcast',
      product: 'RainViewer radar nowcast',
      dataKind: 'radar_nowcast',
      units: 'visual radar nowcast tile',
      minNativeZoom: 0,
      maxNativeZoom: 7,
      attribution: RAINVIEWER_ATTRIBUTION,
      attributionUrl: 'https://www.rainviewer.com/api.html',
    },
  },
  {
    id: 'cloud_ceiling_forecast',
    label: 'Cloud ceiling',
    kind: 'forecast',
    phenomenon: 'ceiling',
    defaultProvider: 'gfs',
    providerLabel: 'NOAA GFS',
    available: false,
    hasTimeline: true,
    defaultOpacity: 0.55,
    legend: 'Cloud ceiling height with reference stated in manifest',
    unavailableReason: 'Requires GFS ceiling field validation and height-reference labeling.',
    summary: 'Global modeled ceiling overlay planned after forecast cloud/precipitation rendering.',
  },
  {
    id: 'radar_norway',
    label: 'Rain radar',
    kind: 'recent',
    phenomenon: 'radar',
    defaultProvider: 'rainviewer',
    providerLabel: 'RainViewer',
    available: true,
    hasTimeline: true,
    defaultOpacity: 0.6,
    legend: 'Radar precipitation intensity, styled by RainViewer',
    summary: 'Optional radar composite where radar coverage exists. Coverage is not truly global.',
    source: {
      type: 'rainviewer',
      product: 'RainViewer radar composite',
      dataKind: 'radar_observation',
      units: 'visual radar tile',
      minNativeZoom: 0,
      maxNativeZoom: 7,
      attribution: RAINVIEWER_ATTRIBUTION,
      attributionUrl: 'https://www.rainviewer.com/api.html',
    },
  },
];

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

function publicLayer(layer) {
  const {
    id, label, kind, phenomenon, defaultProvider, providerLabel, available,
    hasTimeline, defaultOpacity, legend, unavailableReason, summary,
  } = layer;
  return {
    id,
    label,
    kind,
    phenomenon,
    defaultProvider,
    providerLabel,
    available,
    hasTimeline,
    defaultOpacity,
    legend,
    unavailableReason,
    summary,
  };
}

function findLayer(layerId) {
  return LAYERS.find(layer => layer.id === layerId) || null;
}

function gibsTileUrl(gibsLayer, timeToken, z, x, y) {
  return `${GIBS_TILE_BASE}/${gibsLayer}/default/${encodeURIComponent(timeToken)}/${GIBS_TILE_MATRIX_SET}/${z}/${y}/${x}.png`;
}

async function gibsActualTime(gibsLayer, fetchImpl = fetch) {
  const cacheable = fetchImpl === fetch;
  const cached = gibsTimeCache.get(gibsLayer);
  if (cacheable && cached && Date.now() - cached.checkedAt < 10 * 60 * 1000) return cached.time;
  const response = await timedFetch(fetchImpl, gibsTileUrl(gibsLayer, 'default', 2, 1, 1), { method: 'HEAD' });
  if (!response.ok) throw new Error(`GIBS tile metadata HTTP ${response.status}`);
  const time = response.headers.get('layer-time-actual') || null;
  if (cacheable) gibsTimeCache.set(gibsLayer, { time, checkedAt: Date.now() });
  return time;
}

export function completeDailyTimeToken(actualIso, now = Date.now()) {
  if (!actualIso) return null;
  const actualDate = String(actualIso).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(actualDate)) return null;
  const today = new Date(now).toISOString().slice(0, 10);
  if (actualDate < today) return actualDate;
  return new Date(Date.parse(`${actualDate}T00:00:00Z`) - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function previousDate(date) {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function dailyInterval(date) {
  const validStart = `${date}T00:00:00.000Z`;
  return {
    validStart,
    validEnd: new Date(Date.parse(validStart) + 24 * 60 * 60 * 1000 - 1000).toISOString(),
  };
}

const gibsFrameCache = new Map();

async function gibsFrame(source, fetchImpl = fetch, now = Date.now()) {
  const advertised = await gibsActualTime(source.layer, fetchImpl);
  if (source.timePolicy !== 'complete_daily') {
    return {
      timeToken: 'default',
      validStart: advertised,
      validEnd: advertised,
      timeQuality: advertised ? 'provider_tile_time_header' : 'provider_default_time',
      complete: false,
    };
  }
  const cacheable = fetchImpl === fetch;
  const cacheKey = `${source.layer}:${new Date(now).toISOString().slice(0, 10)}`;
  const cached = gibsFrameCache.get(cacheKey);
  if (cacheable && cached && Date.now() - cached.checkedAt < 10 * 60 * 1000) return cached.frame;
  let token = completeDailyTimeToken(advertised, now);
  let frame = null;
  for (let attempt = 0; token && attempt < 3; attempt += 1) {
    const probe = await timedFetch(fetchImpl, gibsTileUrl(source.layer, token, 2, 2, 1), { method: 'HEAD' });
    const length = Number(probe.headers.get('content-length') || 0);
    if (probe.ok && (!length || length > 1500)) {
      const interval = dailyInterval(token);
      frame = {
        timeToken: token,
        validStart: interval.validStart,
        validEnd: interval.validEnd,
        timeQuality: 'complete_daily_composite',
        complete: true,
      };
      break;
    }
    token = previousDate(token);
  }
  if (!frame) {
    frame = {
      timeToken: 'default',
      validStart: advertised,
      validEnd: advertised,
      timeQuality: advertised ? 'provider_tile_time_header' : 'provider_default_time',
      complete: false,
    };
  }
  if (cacheable) gibsFrameCache.set(cacheKey, { frame, checkedAt: Date.now() });
  return frame;
}

function tileTemplate(layer, sliceId) {
  return {
    urlTemplate: `/weather/layers/${layer.id}/${sliceId}/tile/{z}/{x}/{y}.png`,
    tileSize: 256,
    minNativeZoom: layer.source?.minNativeZoom ?? 0,
    maxNativeZoom: layer.source?.maxNativeZoom,
    colorTreatment: layer.source?.colorTreatment,
  };
}

function gibsWarnings(layer, frame) {
  const warnings = ['Tiles are provider-styled visual context. A light hatch marks a tile with no coverage and is not clear weather.'];
  if (layer.source?.timePolicy === 'complete_daily') {
    warnings.push(frame?.complete
      ? 'Latest complete daily composite. The in-progress UTC day is omitted so unfinished swaths are not shown as missing cloud.'
      : 'A complete daily composite was unavailable, so the in-progress day is shown and coverage can be incomplete.');
  }
  if (layer.source?.maxNativeZoom != null) {
    warnings.push(`Zoom above level ${layer.source.maxNativeZoom} is a stretched view of the native tiles.`);
  }
  return warnings;
}

async function rainviewerMetadata(fetchImpl = fetch) {
  if (rainviewerCache && Date.now() - rainviewerCache.checkedAt < 2 * 60 * 1000) return rainviewerCache.data;
  const response = await timedFetch(fetchImpl, RAINVIEWER_METADATA);
  if (!response.ok) throw new Error(`RainViewer metadata HTTP ${response.status}`);
  const data = await response.json();
  rainviewerCache = { data, checkedAt: Date.now() };
  return data;
}

function rainviewerFrames(data, mode = 'past') {
  const frames = mode === 'nowcast' ? data.radar?.nowcast || [] : data.radar?.past || [];
  return [...frames].slice(mode === 'nowcast' ? 0 : -8);
}

export function weatherLayerCatalog() {
  return {
    schemaVersion: 1,
    layers: LAYERS.map(publicLayer),
    types: WEATHER_TYPES.map(type => ({
      ...type,
      providers: LAYERS.filter(layer => layer.phenomenon === type.id).map(layer => layer.id),
    })),
    defaultLayer: LAYERS.find(layer => layer.available)?.id || null,
    generatedAt: nowIso(),
  };
}

export async function weatherLayerTimeline(layerId, { now = Date.now(), fetchImpl = fetch } = {}) {
  const layer = findLayer(layerId);
  if (!layer) return null;
  if (!layer.available) {
    return {
      schemaVersion: 1,
      layer: layer.id,
      selected: null,
      slices: [],
      unavailableReason: layer.unavailableReason,
      generatedAt: nowIso(now),
    };
  }
  if (layer.source?.type === 'rainviewer' || layer.source?.type === 'rainviewer-nowcast') {
    const metadata = await rainviewerMetadata(fetchImpl);
    const frames = rainviewerFrames(metadata, layer.source.type === 'rainviewer-nowcast' ? 'nowcast' : 'past');
    const selected = frames.at(-1)?.path?.split('/').pop() || null;
    return {
      schemaVersion: 1,
      layer: layer.id,
      selected,
      unavailableReason: frames.length ? null : 'No RainViewer nowcast frames are currently advertised by the provider.',
      slices: frames.map(frame => {
        const valid = new Date(frame.time * 1000).toISOString();
        const id = frame.path.split('/').pop();
        return {
          id,
          label: valid.slice(11, 16) + 'Z',
          valid_start: valid,
          valid_end: valid,
          model_run_time: null,
          published_at: null,
          retrieved_at: null,
          manifest_generated_at: nowIso(now),
          time_label: `${layer.source.type === 'rainviewer-nowcast' ? 'Nowcast' : 'Radar frame'} ${valid.slice(11, 16)} UTC`,
          age_label: `${layer.source.type === 'rainviewer-nowcast' ? 'Nowcast' : 'Radar'} ${valid.slice(11, 16)}Z`,
          stale: false,
          time_quality: 'provider_frame_time',
          manifest_url: `/api/environment/v1/weather/layers/${layer.id}/${id}/manifest`,
        };
      }),
      generatedAt: nowIso(now),
    };
  }
  const frame = layer.source?.type === 'gibs' ? await gibsFrame(layer.source, fetchImpl, now) : null;
  return {
    schemaVersion: 1,
    layer: layer.id,
    selected: 'latest',
    slices: [{
      id: 'latest',
      label: frame?.complete ? frame.timeToken : 'Latest',
      valid_start: frame?.validStart || null,
      valid_end: frame?.validEnd || null,
      model_run_time: null,
      published_at: null,
      retrieved_at: null,
      manifest_generated_at: nowIso(now),
      time_label: frame?.complete ? `Daily composite ${frame.timeToken} UTC` : (frame?.validStart ? `Valid ${frame.validStart}` : 'Latest provider default time'),
      age_label: frame?.complete ? frame.timeToken : (frame?.validStart ? frame.validStart.slice(11, 16) + 'Z' : 'Latest'),
      stale: null,
      time_quality: frame?.timeQuality || 'provider_default_time',
      manifest_url: `/api/environment/v1/weather/layers/${layer.id}/latest/manifest`,
    }],
    generatedAt: nowIso(now),
  };
}

export async function weatherLayerManifest(layerId, sliceId, { now = Date.now(), fetchImpl = fetch } = {}) {
  const layer = findLayer(layerId);
  if (!layer || !layer.available) return null;
  const generatedAt = nowIso(now);
  if (layer.source?.type === 'rainviewer' || layer.source?.type === 'rainviewer-nowcast') {
    const metadata = await rainviewerMetadata(fetchImpl);
    const frame = rainviewerFrames(metadata, layer.source.type === 'rainviewer-nowcast' ? 'nowcast' : 'past').find(candidate => candidate.path.endsWith(`/${sliceId}`));
    if (!frame) return null;
    const valid = new Date(frame.time * 1000).toISOString();
    return {
      schemaVersion: 1,
      layer: layer.id,
      label: layer.label,
      provider: 'RainViewer',
      provider_id: 'rainviewer',
      product: layer.source.product,
      product_version: null,
      data_kind: layer.source.dataKind,
      phenomenon: layer.phenomenon,
      valid_start: valid,
      valid_end: valid,
      model_run_time: null,
      published_at: null,
      retrieved_at: null,
      manifest_generated_at: generatedAt,
      time_label: `${layer.source.type === 'rainviewer-nowcast' ? 'Nowcast' : 'Radar frame'} ${valid}`,
      time_quality: 'provider_frame_time',
      units: layer.source.units,
      crs: 'EPSG:3857',
      bounds: [-180, -85.0511, 180, 85.0511],
      grid_registration: 'web_mercator_tile',
      height_reference: null,
      tile: tileTemplate(layer, sliceId),
      defaultOpacity: layer.defaultOpacity,
      legend: { label: layer.legend },
      warnings: ['Radar coverage is limited to regions covered by contributing radar networks. Missing radar does not mean clear weather. Tiles with no coverage are marked with a light hatch.'],
      attribution: layer.source.attribution,
      attribution_url: layer.source.attributionUrl,
      source_url: RAINVIEWER_METADATA,
      stale: false,
      source_sha256: null,
    };
  }
  if (sliceId !== 'latest') return null;
  const frame = layer.source?.type === 'gibs' ? await gibsFrame(layer.source, fetchImpl, now) : null;
  return {
    schemaVersion: 1,
    layer: layer.id,
    label: layer.label,
    provider: 'NASA',
    provider_id: 'gibs',
    product: layer.source.product,
    product_version: null,
    data_kind: layer.source.dataKind,
    phenomenon: layer.phenomenon,
    valid_start: frame?.validStart || null,
    valid_end: frame?.validEnd || null,
    model_run_time: null,
    published_at: null,
    retrieved_at: null,
    manifest_generated_at: generatedAt,
    time_label: frame?.complete ? `Daily composite ${frame.timeToken} UTC` : (frame?.validStart ? `Valid ${frame.validStart}` : 'Latest provider default time'),
    time_quality: frame?.timeQuality || 'provider_default_time',
    units: layer.source.units,
    crs: 'EPSG:3857',
    bounds: [-180, -85.0511, 180, 85.0511],
    grid_registration: 'web_mercator_tile',
    height_reference: null,
    tile: tileTemplate(layer, 'latest'),
    defaultOpacity: layer.defaultOpacity,
    legend: { label: layer.legend },
    warnings: gibsWarnings(layer, frame),
    attribution: layer.source.attribution,
    attribution_url: layer.source.attributionUrl,
    source_url: `${GIBS_TILE_BASE}/${layer.source.layer}`,
    stale: null,
    source_sha256: null,
  };
}

export function weatherLayerImageSource() {
  return null;
}

export async function weatherLayerTileSource(layerId, sliceId, z, x, y, { now = Date.now(), fetchImpl = fetch } = {}) {
  const layer = findLayer(layerId);
  if (!layer || !layer.available) return null;
  const zoom = Number(z);
  const tileX = Number(x);
  const tileY = Number(y);
  const minZoom = layer.source?.minNativeZoom ?? 0;
  const maxZoom = layer.source?.maxNativeZoom ?? zoom;
  if (!Number.isInteger(zoom) || zoom < minZoom || zoom > maxZoom) return null;
  if (!Number.isInteger(tileX) || !Number.isInteger(tileY) || tileX < 0 || tileY < 0) return null;
  if (layer.source?.type === 'gibs' && sliceId === 'latest') {
    const frame = await gibsFrame(layer.source, fetchImpl, now);
    return {
      url: gibsTileUrl(layer.source.layer, frame.timeToken, zoom, tileX, tileY),
      contentType: 'image/png',
    };
  }
  if (layer.source?.type === 'rainviewer' || layer.source?.type === 'rainviewer-nowcast') {
    if (!/^[a-zA-Z0-9_-]+$/.test(sliceId)) return null;
    return {
      url: `https://tilecache.rainviewer.com/v2/radar/${sliceId}/256/${zoom}/${tileX}/${tileY}/2/1_1.png`,
      contentType: 'image/png',
    };
  }
  return {
    url: null,
    contentType: null,
  };
}
