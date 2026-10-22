import { isFresh, WEATHER_MAX_AGE_MS, CATEGORY_ORDER, CLOUD_ORDER, categorySpan, cloudSpan } from './defaults.mjs';

const number = v => v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null;

export function visibilitySM(value) {
  if (value == null || value === '') return null;
  const text = String(value).replace(/SM$/, '').trim();
  const match = text.match(/^([PM<>]?)(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?$/);
  if (match) return { value: +match[2] + (match[3] ? +match[3] / +match[4] : 0), bound: /[P>]/.test(match[1]) ? 'above' : /[M<]/.test(match[1]) ? 'below' : 'exact' };
  const fraction = text.match(/^([PM<>]?)(\d+)\/(\d+)$/);
  if (fraction && +fraction[3]) return { value: +fraction[2] / +fraction[3], bound: /[M<]/.test(fraction[1]) ? 'below' : /[P>]/.test(fraction[1]) ? 'above' : 'exact' };
  const plus = text.match(/^(\d+(?:\.\d+)?)\+$/);
  return plus ? { value: +plus[1], bound: 'above' } : null;
}

const COVER_RANK = { CLR: 0, SKC: 0, NSC: 0, NCD: 0, FEW: 1, SCT: 2, BKN: 3, OVC: 4, VV: 5, OVX: 5 };
const CATEGORY_RANK = { VFR: 0, MVFR: 1, IFR: 2, LIFR: 3 };

export function formatVisibility(visibility) {
  if (!visibility || !Number.isFinite(visibility.value)) return 'unknown';
  const digits = visibility.value < 1 ? 2 : 1;
  const amount = visibility.value.toFixed(digits).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  if (visibility.bound === 'above') return `${amount} SM or more`;
  if (visibility.bound === 'below') return `less than ${amount} SM`;
  return `${amount} SM`;
}

export function formatWind(observation) {
  if (!observation || (observation.windKt == null && (observation.windDirection == null || observation.windDirection === ''))) return 'unknown';
  const direction = observation.windDirection == null || observation.windDirection === '' ? '?' : observation.windDirection === 'VRB' ? 'VRB' : `${observation.windDirection}°`;
  const gust = observation.gustKt == null ? '' : ` gusting ${observation.gustKt}`;
  return `${direction} ${observation.windKt ?? '?'} kt${gust}`;
}

export function formatSky(observation) {
  if (!observation || observation.state !== 'known') return 'unknown';
  const cover = observation.cloudCover && observation.cloudCover !== 'UNKNOWN' ? ` ${observation.cloudCover}` : '';
  const base = observation.ceilingFtAGL == null ? '' : ` ${observation.ceilingFtAGL} ft`;
  return `${observation.category}${cover}${base}`;
}

/** Score is how closely the report matches the selected category, cloud and ceiling targets. */
export function judgeWeather(observation, target) {
  if (!observation || observation.state !== 'known') return { meets: false, score: 0, reason: observation?.reason || 'weather unavailable' };
  const reasons = [];
  const [best, worst] = categorySpan(target);
  const rank = CATEGORY_RANK[observation.category];
  const categoryOk = rank != null && rank >= best && rank <= worst;
  if (!categoryOk) reasons.push(rank != null && rank < best ? `${observation.category} is better than ${CATEGORY_ORDER[best]}` : `${observation.category} is below ${CATEGORY_ORDER[worst]}`);
  const coverRank = COVER_RANK[observation.cloudCover] ?? 6;
  const [coverFrom, coverTo] = cloudSpan(target);
  const coverOk = coverRank >= coverFrom && coverRank <= coverTo;
  if (!coverOk) reasons.push(coverRank < coverFrom ? `${observation.cloudCover} is clearer than ${CLOUD_ORDER[coverFrom]}` : `${observation.cloudCover} is cloudier than ${CLOUD_ORDER[coverTo]}`);
  const ceiling = observation.ceilingFtAGL;
  const baseOk = !target.baseFt || ceiling == null || ceiling >= target.baseFt;
  if (!baseOk) reasons.push(`ceiling ${ceiling} ft is below ${target.baseFt} ft`);
  const categoryDistance = rank == null ? 4 : rank < best ? best - rank : rank > worst ? rank - worst : 0;
  const categoryScore = Math.max(0, 100 - categoryDistance * 35);
  const coverDistance = coverRank < coverFrom ? coverFrom - coverRank : coverRank > coverTo ? coverRank - coverTo : 0;
  const coverScore = Math.max(0, 100 - coverDistance * 25);
  const baseScore = !target.baseFt || ceiling == null ? 100 : Math.round(Math.min(100, 100 * ceiling / target.baseFt));
  const score = Math.max(0, Math.round(0.5 * categoryScore + 0.3 * coverScore + 0.2 * baseScore));
  return { meets: reasons.length === 0, score, reason: reasons.join('; ') || null };
}

export function flightCategory(visibility, ceilingFt, skyKnown) {
  if (!visibility || !skyKnown) return 'UNKNOWN';
  const v = visibility.value;
  // Upper bounds do not establish a category except when every possibility is LIFR.
  if (visibility.bound === 'below') return v <= 1 ? 'LIFR' : 'UNKNOWN';
  if (visibility.bound === 'above' && v < 5) return 'UNKNOWN';
  const vc = v < 1 ? 3 : v < 3 ? 2 : (v <= 5 && !(v === 5 && visibility.bound === 'above')) ? 1 : 0;
  const cc = ceilingFt === null ? 0 : ceilingFt < 500 ? 3 : ceilingFt < 1000 ? 2 : ceilingFt <= 3000 ? 1 : 0;
  return ['VFR', 'MVFR', 'IFR', 'LIFR'][Math.max(vc, cc)];
}

/** AWC structured JSON -> unit-explicit observation. CSV ingestion uses the same adapter. */
export function normalizeMetar(record) {
  const raw = record.rawOb || record.raw_text || '';
  const clouds = (record.clouds || []).map(c => ({ cover: c.cover, baseFtAGL: number(c.base) }));
  const cavok = /\bCAVOK\b/.test(raw);
  const clear = cavok || /\b(SKC|CLR|NSC|NCD)\b/.test(raw) || clouds.some(c => ['SKC', 'CLR', 'NSC', 'NCD'].includes(c.cover));
  const ceilings = clouds.filter(c => ['BKN', 'OVC', 'VV', 'OVX'].includes(c.cover));
  if (number(record.vertVis) !== null && !ceilings.some(c => c.cover === 'VV')) {
    const vv = { cover: 'VV', baseFtAGL: number(record.vertVis) };
    clouds.push(vv); ceilings.push(vv);
  }
  const unknownCeiling = ceilings.some(c => c.baseFtAGL === null) || /\bVV\/\/\//.test(raw);
  const skyKnown = !unknownCeiling && (clear || clouds.some(c => ['FEW', 'SCT', 'BKN', 'OVC', 'VV', 'OVX'].includes(c.cover)));
  const ceilingFtAGL = ceilings.length && !unknownCeiling ? Math.min(...ceilings.map(c => c.baseFtAGL)) : null;
  const visibility = cavok ? { value: 10000 / 1609.344, bound: 'above' } : visibilitySM(record.visib ?? record.visibility_statute_mi);
  const time = record.obsTime ?? record.observation_time;
  const date = typeof time === 'number' ? new Date(time * 1000) : new Date(time);
  return {
    stationId: record.icaoId || record.station_id,
    lat: number(record.lat ?? record.latitude), lon: number(record.lon ?? record.longitude),
    observedAt: Number.isFinite(+date) ? date.toISOString() : null,
    raw, visibility, clouds, ceilingFtAGL, skyKnown,
    category: flightCategory(visibility, ceilingFtAGL, skyKnown),
    cloudCover: unknownCeiling ? 'UNKNOWN' : clouds.length ? clouds.reduce((a, b) => {
      const order = ['SKC', 'CLR', 'NSC', 'NCD', 'FEW', 'SCT', 'BKN', 'OVC', 'VV', 'OVX'];
      return order.indexOf(a.cover) >= order.indexOf(b.cover) ? a : b;
    }).cover : clear ? 'CLR' : 'UNKNOWN',
    windDirection: record.wdir === 'VRB' ? 'VRB' : number(record.wdir),
    windKt: number(record.wspd), gustKt: number(record.wgst), source: record.source || 'AWC',
  };
}

const RAW_TIME = /^(\d{2})(\d{2})(\d{2})Z$/;
const RAW_WIND = /^(VRB|\d{3})(\d{2,3})(G(\d{2,3}))?(KT|MPS)$/;
const RAW_CLOUD = /^(FEW|SCT|BKN|OVC|VV|SKC|CLR|NSC|NCD|OVX)(\d{3}|\/\/\/)?$/;
const RAW_STOP = new Set(['RMK', 'TEMPO', 'BECMG', 'NOSIG', 'TX', 'TN']);
const RAW_FUTURE_TOLERANCE_MS = 2 * 3600000;

/** One coded METAR or SPECI, as published by NOAA's hourly cycle files. */
export function parseRawMetar(raw, now = new Date(), source = 'NOAA-cycle') {
  const text = String(raw || '').replace(/\s+/g, ' ').trim().replace(/^(METAR|SPECI)\s+(?:COR\s+)?/, '');
  const tokens = text.split(' ').filter(Boolean);
  if (!/^[A-Z][A-Z0-9]{3}$/.test(tokens[0] || '')) return null;
  let index = 1;
  let observedAt = null;
  const time = (tokens[index] || '').match(RAW_TIME);
  if (time) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), +time[1], +time[2], +time[3]));
    if (date.getTime() - now.getTime() > RAW_FUTURE_TOLERANCE_MS) date.setUTCMonth(date.getUTCMonth() - 1);
    else if (now.getTime() - date.getTime() > 27 * 86400000) date.setUTCMonth(date.getUTCMonth() + 1);
    observedAt = date;
    index += 1;
  }
  if (tokens[index] === 'AUTO' || tokens[index] === 'COR') index += 1;
  let wdir, wspd, wgst;
  const wind = (tokens[index] || '').match(RAW_WIND);
  if (wind) {
    const factor = wind[5] === 'MPS' ? 1.94384 : 1;
    wdir = wind[1] === 'VRB' ? 'VRB' : wind[1];
    wspd = Math.round(+wind[2] * factor);
    wgst = wind[4] == null ? null : Math.round(+wind[4] * factor);
    index += 1;
  }
  if (/^\d{3}V\d{3}$/.test(tokens[index] || '')) index += 1;
  let visib = null;
  const pair = `${tokens[index] || ''} ${tokens[index + 1] || ''}`;
  if (/^\d+ \d+\/\d+SM$/.test(pair)) { visib = pair; index += 2; }
  else if (/^(?:[PM]?\d+(?:\.\d+)?|[PM]?\d+\/\d+)SM$/.test(tokens[index] || '')) { visib = tokens[index]; index += 1; }
  else if (/^\d{4}$/.test(tokens[index] || '')) {
    const meters = +tokens[index];
    visib = meters >= 9999 ? '6+' : String(Math.round(meters / 1609.344 * 100) / 100);
    index += 1;
  }
  const clouds = [];
  for (; index < tokens.length && !RAW_STOP.has(tokens[index]); index += 1) {
    if (/^R\d{2}/.test(tokens[index])) continue;
    const cloud = tokens[index].match(RAW_CLOUD);
    if (!cloud) continue;
    clouds.push({ cover: cloud[1], base: cloud[2] && cloud[2] !== '///' ? String(+cloud[2] * 100) : null });
  }
  return { icaoId: tokens[0], rawOb: text, obsTime: observedAt ? Math.floor(observedAt.getTime() / 1000) : null, visib, wdir, wspd, wgst, clouds, source };
}

export function weatherForAirport(icao, snapshot, aliases = {}, now = Date.now()) {
  const stationId = aliases[icao]?.weatherStationId || icao;
  const observation = snapshot?.observations?.[stationId];
  if (!observation) return { state: 'unknown', reason: 'Weather observation missing', stationId };
  const fresh = isFresh(observation.observedAt, now, WEATHER_MAX_AGE_MS);
  return { ...observation, state: fresh && observation.category !== 'UNKNOWN' ? 'known' : 'unknown',
    reason: fresh ? (observation.category === 'UNKNOWN' ? 'Incomplete weather observation' : null) : 'Weather observation stale',
    matchType: stationId === icao ? 'exact' : 'explicit-alias' };
}
