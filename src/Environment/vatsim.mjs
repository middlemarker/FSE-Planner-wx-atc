import { containsPoint, distanceNm } from './geometry.mjs';
import { isFresh, VATSIM_MAX_AGE_MS } from './defaults.mjs';

export function normalizeVatsim(feed, fetchedAt = new Date().toISOString()) {
  if (!Array.isArray(feed.controllers) || !feed.general?.update_timestamp) throw new Error('Invalid VATSIM feed');
  const facilities = Object.fromEntries((feed.facilities || []).map(f => [f.id, f.short]));
  const fallback = { 0: 'OBS', 1: 'FSS', 2: 'DEL', 3: 'GND', 4: 'TWR', 5: 'APP', 6: 'CTR' };
  const controllers = feed.controllers.filter(c => c.callsign && (facilities[c.facility] || fallback[c.facility]) !== 'OBS').map(c => ({
    callsign: c.callsign.toUpperCase(), frequency: c.frequency || null, cid: c.cid ?? null,
    name: c.name && String(c.name) !== String(c.cid) ? String(c.name) : null,
    facility: ({ DEP: 'APP', RMP: 'GND' })[c.callsign.split('_').pop()] || c.callsign.split('_').pop(),
    logonTime: c.logon_time || null, lastUpdatedAt: c.last_updated, online: true,
  })).filter(c => !c.callsign.endsWith('_ATIS') && !c.callsign.endsWith('_OBS'));
  return { schemaVersion: 1, source: 'VATSIM', sourceUpdatedAt: feed.general.update_timestamp, fetchedAt,
    snapshotId: `vatsim:${feed.general.update_timestamp}`, controllers };
}

export function parseVatspy(text) {
  let section = '';
  const airports = {}, positions = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';')) continue;
    if (line.startsWith('[')) { section = line; continue; }
    const p = line.split('|');
    if (section === '[Airports]' && p.length >= 7 && p[6] === '0') {
      airports[p[0]] = { id: p[0], name: p[1], lat: +p[2], lon: +p[3], localId: p[4], fir: p[5] };
    }
    if (section === '[FIRs]' && p.length >= 4) positions.push({ prefix: p[2] || p[0], geometryId: p[3], name: p[1] });
  }
  return { airports, positions };
}

export function buildAirspace(vatspyText, geojson, revision, tracon = null) {
  const { airports, positions } = parseVatspy(vatspyText);
  if (!Object.keys(airports).length || !positions.length || !Array.isArray(geojson.features)) throw new Error('Invalid airspace dataset');
  const features = [];
  for (const f of geojson.features) {
    const id = f.properties?.id;
    if (!id || !validGeometry(f.geometry)) continue;
    const mapped = positions.filter(p => p.geometryId === id);
    if (!mapped.length) continue;
    features.push({ id: `vatspy:${id}`, name: mapped[0].name, geometry: f.geometry,
      prefixes: [...new Set(mapped.map(p => p.prefix))], suffixes: ['CTR', 'FSS'], source: 'VATSpy' });
  }
  for (const f of tracon?.features || []) {
    if (!Array.isArray(f.properties?.prefix) || !validGeometry(f.geometry)) continue;
    features.push({ id: `simaware:${f.properties.id}`, name: f.properties.name, geometry: f.geometry,
      prefixes: f.properties.prefix, suffixes: [f.properties.suffix || 'APP'], source: 'SimAware' });
  }
  if (!features.length) throw new Error('No usable boundary mappings');
  return { schemaVersion: 1, version: revision, airports, features, aliases: {},
    sources: [{ name: 'VATSpy Data Project', url: 'https://github.com/vatsimnetwork/vatspy-data-project', license: 'CC-BY-SA-4.0', revision }] };
}

export function validGeometry(geometry) {
  const polys = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : null;
  return Array.isArray(polys) && polys.length > 0 && polys.every(poly => Array.isArray(poly) && poly.length > 0 && poly.every(ring =>
    Array.isArray(ring) && ring.length >= 4 && ring.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90) && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]));
}

export function parseBookingTime(value) {
  if (typeof value === 'number') return value;
  const text = String(value ?? '').trim();
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(' ', 'T')}Z` : text;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : NaN;
}

/** ATC Bookings times are UTC. Invalid or already-finished rows are dropped. */
export function normalizeBookings(rows, now = Date.now()) {
  if (!Array.isArray(rows)) return [];
  const bookings = [];
  for (const row of rows) {
    const startMs = parseBookingTime(row?.start), endMs = parseBookingTime(row?.end);
    if (!row?.callsign || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || endMs < now - 3600000) continue;
    bookings.push({ id: row.id ?? null, callsign: String(row.callsign).toUpperCase(), cid: row.cid ?? null, type: row.type || 'booking',
      start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(), startMs, endMs });
  }
  return bookings;
}

export function formatUtc(value, now = Date.now()) {
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return '';
  const clock = new Date(ms).toISOString().slice(11, 16);
  return new Date(ms).toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10) ? `${clock}Z` : `${new Date(ms).toISOString().slice(5, 10)} ${clock}Z`;
}

export function formatController(controller, now = Date.now()) {
  const parts = [controller.callsign, controller.facility, controller.frequency, controller.name].filter(Boolean);
  if (controller.logonTime) parts.push(`on since ${formatUtc(controller.logonTime, now)}`);
  for (const booking of [...(controller.bookings || [])].filter(b => b.endMs >= now).sort((a, b) => a.startMs - b.startMs).slice(0, 2)) {
    parts.push(`booked ${formatUtc(booking.startMs, now)}–${formatUtc(booking.endMs, now)}`);
  }
  if (controller.online === false) parts.push('not online');
  return parts.join(' · ');
}

export function availableAt(controller, at, now) {
  const windows = controller.bookings || [];
  const online = controller.online !== false;
  if (!windows.length) return online;
  if (windows.some(w => at >= w.startMs && at <= w.endMs)) return true;
  return online && Math.abs(at - now) <= 60000;
}

export function availableDuring(controller, start, end, now) {
  const windows = controller.bookings || [];
  const online = controller.online !== false;
  if (!windows.length) return online;
  if (windows.some(w => w.startMs < end && w.endMs > start)) return true;
  return online && start <= now + 60000 && end >= now - 60000;
}

export function sectorControllers(sector) {
  return sector.controllers?.length ? sector.controllers : [{ callsign: sector.callsigns?.[0], facility: sector.facility, online: true, bookings: [] }];
}

function facilityOf(callsign) {
  const suffix = callsign.split('_').pop();
  return ({ DEP: 'APP', RMP: 'GND' })[suffix] || suffix;
}

function bookingWindows(snapshot) {
  const grouped = new Map();
  const rows = snapshot?.bookings || [];
  const normalized = rows.every(b => Number.isFinite(b?.startMs) && Number.isFinite(b?.endMs)) ? rows : normalizeBookings(rows, Date.parse(snapshot?.sourceUpdatedAt) || Date.now());
  for (const booking of normalized) {
    if (!booking?.callsign || !Number.isFinite(booking.startMs)) continue;
    grouped.set(booking.callsign, [...(grouped.get(booking.callsign) || []), booking]);
  }
  return grouped;
}

export function matchControllers(snapshot, airspace) {
  const active = new Map(), airportControllers = {}, unmatched = [], seen = new Set();
  const airports = airspace?.airports || {};
  const bookings = bookingWindows(snapshot);
  const localIds = new Map();
  for (const a of Object.values(airports)) if (a.localId) localIds.set(a.localId, [...(localIds.get(a.localId) || []), a.id]);
  const consider = c => {
    if (!c.callsign || seen.has(c.callsign)) return;
    seen.add(c.callsign);
    const pieces = c.callsign.split('_'), suffix = pieces.pop(), prefix = pieces.join('_');
    let matches = (airspace?.features || []).filter(f => f.suffixes.includes(suffix) && f.prefixes.includes(prefix));
    let confidence = 'mapped';
    // Broad fallback is visible but never satisfies strict requirements unless explicitly accepted.
    if (!matches.length && pieces.length > 1) {
      matches = (airspace?.features || []).filter(f => f.suffixes.includes(suffix) && f.prefixes.includes(pieces[0]));
      confidence = 'inferred';
    }
    for (const f of matches) {
      const key = `${f.id}:${confidence}`;
      const entry = active.get(key) || { ...f, confidence, callsigns: [], controllers: [], facility: c.facility };
      entry.callsigns.push(c.callsign); entry.controllers.push(c); active.set(key, entry);
    }
    if (['DEL', 'GND', 'TWR', 'APP'].includes(c.facility)) {
      const ids = airports[pieces[0]] ? [pieces[0]] : localIds.get(pieces[0]) || [];
      if (ids.length === 1) {
        airportControllers[ids[0]] = [...(airportControllers[ids[0]] || []), c];
        return;
      }
    }
    if (!matches.length) unmatched.push(c);
  };
  for (const c of snapshot?.controllers || []) consider({ ...c, online: c.online !== false, bookings: bookings.get(c.callsign) || [] });
  for (const [callsign, windows] of bookings) consider({ callsign, facility: facilityOf(callsign), frequency: null, name: null, logonTime: null, online: false, bookings: windows });
  return { sectors: [...active.values()], airportControllers, unmatched };
}

function windowAt(controllers, at) {
  for (const c of controllers) for (const booking of c.bookings || []) if (at >= booking.startMs && at <= booking.endMs) return { callsign: c.callsign, start: booking.start, end: booking.end };
  return null;
}

export function airportCoverage(icao, coordinate, snapshot, airspace, matched, policy, phase, now, at = now) {
  if (!isFresh(snapshot?.sourceUpdatedAt, now, VATSIM_MAX_AGE_MS)) return { state: 'unknown', callsigns: [], reason: 'VATSIM snapshot missing or stale' };
  const canonical = airspace?.aliases?.[icao]?.canonicalAirportId || icao;
  const airport = airspace?.airports?.[canonical];
  // Historic FSE codes can be reused elsewhere. Require geographic agreement.
  if (!airport || distanceNm(coordinate, [airport.lon, airport.lat]) > 5) return { state: 'unknown', callsigns: [], reason: 'Airport identity unavailable or ambiguous' };
  const qualifies = c => policy.service === 'any' ? ['DEL', 'GND', 'TWR', 'APP', 'CTR', 'FSS'].includes(c.facility) : policy.service === 'tower' ? c.facility === 'TWR' : c.facility === 'APP' && (phase === 'departure' || !c.callsign.endsWith('_DEP'));
  const direct = (matched.airportControllers[canonical] || []).filter(qualifies).filter(c => availableAt(c, at, now));
  if (direct.length) return { state: 'covered', confidence: direct.some(c => c.online === false) && direct.every(c => c.online === false) ? 'booked' : 'mapped', callsigns: direct.map(c => c.callsign), booking: windowAt(direct, at), service: policy.service };
  const sectors = policy.service === 'tower' ? [] : matched.sectors.filter(s =>
    (s.confidence === 'mapped' || policy.allowInferred) && qualifies({ facility: s.facility, callsign: s.callsigns[0] }) && sectorControllers(s).some(c => availableAt(c, at, now)) && containsPoint(s.geometry, coordinate));
  if (sectors.length) return { state: 'covered', confidence: sectors.some(s => s.confidence === 'inferred') ? 'inferred' : 'mapped', callsigns: [...new Set(sectors.flatMap(s => s.callsigns))], booking: windowAt(sectors.flatMap(sectorControllers), at), service: policy.service };
  // No generic top-down inference: a center polygon does not establish tower service.
  const missedBooking = (matched.airportControllers[canonical] || []).some(c => qualifies(c) && (c.bookings || []).length > 0);
  return { state: 'uncovered', callsigns: [], booking: null, reason: missedBooking ? 'Booked controller is outside the estimated time' : 'No matched qualifying controller' };
}
