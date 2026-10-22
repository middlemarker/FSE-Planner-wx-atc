import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { normalizeMetar, parseRawMetar } from '../src/Environment/weather.mjs';
import { normalizeVatsim, normalizeBookings, buildAirspace } from '../src/Environment/vatsim.mjs';

const headers = { 'User-Agent': 'FSE-Planner/1.19 environment integration' };
export async function getRemote(url, type = 'json') {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  if (!response.ok) {
    const error = new Error(`Provider returned HTTP ${response.status}`);
    const retry = response.headers.get('retry-after');
    error.retryAfterMs = /^\d+$/.test(retry || '') ? +retry * 1000 : Math.max(0, Date.parse(retry) - Date.now()) || 0;
    throw error;
  }
  if (response.status === 204) return type === 'json' ? [] : '';
  if (type === 'json') return response.json();
  if (type === 'text') return response.text();
  const buffer = Buffer.from(await response.arrayBuffer());
  return (buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipSync(buffer, { maxOutputLength: 50 * 1024 * 1024 }) : buffer).toString('utf8');
}

export async function loadBookings(now = new Date()) {
  const days = [-1, 0, 1].map(offset => new Date(now.getTime() + offset * 86400000).toISOString().slice(0, 10));
  const lists = await Promise.all(days.map(async date => {
    try { return await getRemote(`https://atc-bookings.vatsim.net/api/booking?date=${date}`); }
    catch { return []; }
  }));
  const byId = new Map();
  for (const list of lists) for (const row of Array.isArray(list) ? list : []) if (row?.id != null) byId.set(row.id, row);
  return normalizeBookings([...byId.values()], now.getTime());
}

export async function loadVatsim() {
  const status = await getRemote('https://status.vatsim.net/status.json');
  const endpoint = status.data?.v3?.find(s => {
    try { const u = new URL(s); return u.protocol === 'https:' && u.hostname === 'data.vatsim.net'; } catch { return false; }
  });
  if (!endpoint) throw new Error('VATSIM data endpoint unavailable');
  const snapshot = normalizeVatsim(await getRemote(endpoint));
  try { snapshot.bookings = await loadBookings(); } catch { snapshot.bookings = []; }
  return snapshot;
}

/** RFC4180 fields, including escaped quotes, quoted commas and newlines. */
export function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (quoted) throw new Error('Malformed weather CSV');
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function weatherFromCsv(text, fetchedAt = new Date().toISOString()) {
  const rows = parseCsv(text), headerIndex = rows.findIndex(r => r.includes('station_id') && r.includes('raw_text'));
  if (headerIndex < 0) throw new Error('Missing METAR cache columns');
  const header = rows[headerIndex], observations = {};
  for (const row of rows.slice(headerIndex + 1)) {
    const record = {}, clouds = [];
    for (let i = 0; i < header.length; i++) {
      if (header[i] === 'sky_cover' && row[i]) clouds.push({ cover: row[i], base: row[i + 1] });
      else record[header[i]] = row[i];
    }
    if (!record.station_id || !record.raw_text) continue;
    const obs = normalizeMetar({ ...record, clouds, wdir: record.wind_dir_degrees,
      wspd: record.wind_speed_kt, wgst: record.wind_gust_kt, vertVis: record.vert_vis_ft });
    if (!obs.observedAt || obs.lat === null || obs.lon === null || Math.abs(obs.lat) > 90 || Math.abs(obs.lon) > 180) continue;
    if (!observations[obs.stationId] || observations[obs.stationId].observedAt < obs.observedAt) observations[obs.stationId] = obs;
  }
  if (!Object.keys(observations).length) throw new Error('METAR cache contains no usable observations');
  const digest = createHash('sha256').update(text).digest('hex').slice(0, 16);
  return { schemaVersion: 1, snapshotId: `awc:${digest}`, source: 'AWC', fetchedAt,
    sourceUpdatedAt: Object.values(observations).reduce((a, b) => a > b.observedAt ? a : b.observedAt, ''), observations };
}
const WEATHER_SOURCE_NAMES = { AWC: 'NOAA Aviation Weather Center', 'NOAA-cycle': 'NOAA METAR cycles', VATSIM: 'VATSIM METAR' };

export function weatherFromMetarText(text, fetchedAt = new Date().toISOString(), now = new Date(fetchedAt), source = 'NOAA-cycle') {
  const observations = {};
  let buffer = '';
  const flush = () => {
    const record = parseRawMetar(buffer, now, source);
    buffer = '';
    if (!record?.obsTime) return;
    const observation = normalizeMetar(record);
    if (!observation.stationId || !observation.observedAt) return;
    const current = observations[observation.stationId];
    if (!current || current.observedAt < observation.observedAt) observations[observation.stationId] = observation;
  };
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^\d{4}\/\d{2}\/\d{2}/.test(trimmed)) { flush(); continue; }
    if (/^(?:METAR|SPECI|[A-Z][A-Z0-9]{3})\b/.test(trimmed) && buffer) flush();
    buffer = buffer ? `${buffer} ${trimmed}` : trimmed;
  }
  flush();
  if (!Object.keys(observations).length) throw new Error(`${WEATHER_SOURCE_NAMES[source] || 'METAR source'} contains no usable observations`);
  const digest = createHash('sha256').update(text).digest('hex').slice(0, 16);
  return { schemaVersion: 1, snapshotId: `${source.toLowerCase()}:${digest}`, source, fetchedAt,
    sourceUpdatedAt: Object.values(observations).reduce((latest, item) => latest > item.observedAt ? latest : item.observedAt, ''), observations };
}

function preferObservation(current, incoming) {
  if (!current) return incoming;
  if ((incoming.observedAt || '') !== (current.observedAt || '')) return (incoming.observedAt || '') > (current.observedAt || '') ? incoming : current;
  const incomingLocated = incoming.lat != null && incoming.lon != null;
  const currentLocated = current.lat != null && current.lon != null;
  if (incomingLocated !== currentLocated) return incomingLocated ? incoming : current;
  return incoming.source === 'AWC' && current.source !== 'AWC' ? incoming : current;
}

export function mergeWeather(parts) {
  const available = parts.filter(part => part?.observations && Object.keys(part.observations).length);
  if (!available.length) throw new Error('Weather sources unavailable');
  const observations = {};
  for (const part of available) for (const [id, observation] of Object.entries(part.observations)) observations[id] = preferObservation(observations[id], observation);
  return {
    schemaVersion: 1, snapshotId: available.map(part => part.snapshotId).join('+'), source: 'NOAA', fetchedAt: new Date().toISOString(),
    sources: available.map(part => ({ id: part.source, name: WEATHER_SOURCE_NAMES[part.source] || part.source, stations: Object.keys(part.observations).length })),
    sourceUpdatedAt: Object.values(observations).reduce((latest, item) => latest > item.observedAt ? latest : item.observedAt, ''), observations,
  };
}

export async function loadNoaaCycles(now = new Date()) {
  const hours = [0, -1].map(offset => String(new Date(now.getTime() + offset * 3600000).getUTCHours()).padStart(2, '0') + 'Z');
  const texts = [];
  for (const hour of hours) {
    try { texts.push(await getRemote(`https://tgftp.nws.noaa.gov/data/observations/metar/cycles/${hour}.TXT`, 'text')); }
    catch { /* The other hour, or the Aviation Weather Center cache, can still cover the stations. */ }
  }
  if (!texts.length) throw new Error('NOAA METAR cycles unavailable');
  return weatherFromMetarText(texts.join('\n'), now.toISOString(), now);
}

export async function loadAwcWeather() {
  return weatherFromCsv(await getRemote('https://aviationweather.gov/data/cache/metars.cache.csv.gz', 'gzip'));
}

export async function loadVatsimWeather(now = new Date()) {
  return weatherFromMetarText(await getRemote('https://metar.vatsim.net/metar.php?id=all', 'text'), now.toISOString(), now, 'VATSIM');
}

export async function loadWeather(source = 'auto') {
  if (source === 'awc') return loadAwcWeather();
  if (source === 'cycles') return loadNoaaCycles();
  if (source === 'vatsim') return loadVatsimWeather();
  const [awc, cycles] = await Promise.allSettled([
    loadAwcWeather(),
    loadNoaaCycles(),
  ]);
  const parts = [awc, cycles].flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  if (!parts.length) throw (awc.status === 'rejected' ? awc.reason : cycles.reason);
  return mergeWeather(parts);
}

export async function loadAirspace() {
  const repo = 'vatsimnetwork/vatspy-data-project';
  const release = process.env.VATSPY_REVISION ? { tag_name: process.env.VATSPY_REVISION } : await getRemote(`https://api.github.com/repos/${repo}/releases/latest`);
  const commit = await getRemote(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(release.tag_name)}`);
  if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw new Error('Invalid boundary revision');
  const base = `https://raw.githubusercontent.com/${repo}/${commit.sha}`;
  const [dat, geometry] = await Promise.all([getRemote(`${base}/VATSpy.dat`, 'text'), getRemote(`${base}/Boundaries.geojson`)]);
  let tracon = null, traconSource = null;
  try {
    const release = await getRemote('https://api.github.com/repos/vatsimnetwork/simaware-tracon-project/releases/latest');
    const asset = release.assets?.find(a => /\.(geojson|json)$/i.test(a.name) && !/schema/i.test(a.name));
    if (asset) {
      const u = new URL(asset.browser_download_url);
      if (u.protocol !== 'https:' || u.hostname !== 'github.com') throw new Error('Invalid boundary asset URL');
      tracon = await getRemote(u.href);
      traconSource = { name: 'SimAware TRACON Project', revision: release.tag_name, url: 'https://github.com/vatsimnetwork/simaware-tracon-project', license: 'See upstream community-use terms' };
    }
  } catch { /* FIR data is independently useful. Missing approach geometry remains explicit. */ }
  const result = buildAirspace(dat, geometry, commit.sha, tracon);
  if (traconSource) result.sources.push(traconSource);
  result.approachAvailable = result.features.some(f => f.source === 'SimAware');
  result.version += traconSource ? `:${traconSource.revision}` : ':no-tracon';
  result.fetchedAt = new Date().toISOString();
  result.checksum = createHash('sha256').update(JSON.stringify(result.features)).digest('hex');
  return result;
}
