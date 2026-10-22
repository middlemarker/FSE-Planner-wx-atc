export const CATEGORY_ORDER = ['VFR', 'MVFR', 'IFR', 'LIFR'];
export const CLOUD_ORDER = ['CLR', 'FEW', 'SCT', 'BKN', 'OVC'];
export const DEFAULT_WEATHER_TARGET = Object.freeze({ categoryFrom: 'VFR', categoryTo: 'VFR', category: 'VFR', coverFrom: 'CLR', coverTo: 'SCT', cover: 'SCT', baseFt: 3000 });
export const WEATHER_COVERS = [
  { id: 'CLR', label: 'Clear' },
  { id: 'FEW', label: 'Few' },
  { id: 'SCT', label: 'Scattered' },
  { id: 'BKN', label: 'Broken' },
  { id: 'OVC', label: 'Overcast' },
];
export const WEATHER_BASES = [
  { id: 0, label: 'Any ceiling' },
  { id: 1000, label: 'At least 1,000 ft' },
  { id: 3000, label: 'At least 3,000 ft' },
  { id: 5000, label: 'At least 5,000 ft' },
  { id: 10000, label: 'At least 10,000 ft' },
];
export const WEATHER_PRESETS = [
  { label: 'VFR', ...DEFAULT_WEATHER_TARGET },
  { label: 'VFR clear', categoryFrom: 'VFR', categoryTo: 'VFR', category: 'VFR', coverFrom: 'CLR', coverTo: 'FEW', cover: 'FEW', baseFt: 5000 },
  { label: 'MVFR+', categoryFrom: 'VFR', categoryTo: 'MVFR', category: 'MVFR', coverFrom: 'CLR', coverTo: 'BKN', cover: 'BKN', baseFt: 1000 },
];
export const WEATHER_PROFILES = [
  { label: 'Clear VFR', categoryFrom: 'VFR', categoryTo: 'VFR', category: 'VFR', coverFrom: 'CLR', coverTo: 'FEW', cover: 'FEW', baseFt: 5000 },
  { label: 'VFR', ...DEFAULT_WEATHER_TARGET },
  { label: 'MVFR', categoryFrom: 'MVFR', categoryTo: 'MVFR', category: 'MVFR', coverFrom: 'SCT', coverTo: 'BKN', cover: 'BKN', baseFt: 1000 },
  { label: 'IFR', categoryFrom: 'IFR', categoryTo: 'IFR', category: 'IFR', coverFrom: 'BKN', coverTo: 'OVC', cover: 'OVC', baseFt: 0 },
  { label: 'LIFR', categoryFrom: 'LIFR', categoryTo: 'LIFR', category: 'LIFR', coverFrom: 'OVC', coverTo: 'OVC', cover: 'OVC', baseFt: 0 },
];
export const WEATHER_SOURCES = [
  { id: 'auto', label: 'Auto', hint: 'AWC plus NOAA cycle backup' },
  { id: 'awc', label: 'AWC', hint: 'NOAA Aviation Weather Center' },
  { id: 'cycles', label: 'NOAA cycles', hint: 'Hourly METAR cycle files' },
  { id: 'vatsim', label: 'VATSIM', hint: 'VATSIM METAR feed' },
];
export const DEFAULT_POLICY = Object.freeze({
  departure: 'off', arrival: 'off', enroute: 'off',
  service: 'tower', scope: 'endpoints', enrouteScope: 'each-leg',
  minimumCoverage: 80, allowInferred: false, predictBookings: true,
  departureWeight: 30, arrivalWeight: 30, enrouteWeight: 40, weatherWeight: 50,
  weather: 'off', weatherSource: 'auto', refreshIntervalSec: 0, categories: ['VFR', 'MVFR'], sameWeatherTarget: true,
  departureWeather: DEFAULT_WEATHER_TARGET, arrivalWeather: DEFAULT_WEATHER_TARGET,
});

export const VATSIM_MAX_AGE_MS = 120000;
export const WEATHER_MAX_AGE_MS = 90 * 60000;
export const CATEGORY_COLORS = { VFR: '#16813c', MVFR: '#2469cf', IFR: '#c62828', LIFR: '#b217a3', UNKNOWN: '#777' };
export const activePolicy = p => ['departure', 'arrival', 'enroute', 'weather'].some(k => p?.[k] && p[k] !== 'off');
export const atcActive = p => ['departure', 'arrival', 'enroute'].some(k => p?.[k] && p[k] !== 'off');
export const prefersCoverage = p => ['departure', 'arrival', 'enroute'].some(k => p?.[k] === 'prefer');
export const prefersConditions = p => prefersCoverage(p) || p?.weather === 'prefer';
export function categorySpan(target) {
  const toId = target?.categoryTo || (target?.category === 'any' ? 'LIFR' : target?.category);
  let from = CATEGORY_ORDER.indexOf(target?.categoryFrom);
  let to = CATEGORY_ORDER.indexOf(toId);
  if (from < 0) from = 0;
  if (to < 0) to = from;
  if (from > to) [from, to] = [to, from];
  return [from, to];
}
export function cloudSpan(target) {
  const fromId = target?.coverFrom || 'CLR';
  const toId = target?.coverTo || (target?.cover === 'any' ? 'OVC' : target?.cover);
  let from = CLOUD_ORDER.indexOf(fromId);
  let to = CLOUD_ORDER.indexOf(toId);
  if (from < 0) from = 0;
  if (to < 0) to = from;
  if (from > to) [from, to] = [to, from];
  return [from, to];
}
function normalizeWeatherTarget(value) {
  const fallback = DEFAULT_WEATHER_TARGET;
  const [from, to] = categorySpan(value);
  const [coverFrom, coverTo] = cloudSpan(value);
  const cover = CLOUD_ORDER[coverFrom] === 'CLR' && CLOUD_ORDER[coverTo] === 'OVC' ? 'any' : CLOUD_ORDER[coverTo];
  const base = Number(value?.baseFt);
  const baseFt = WEATHER_BASES.some(item => item.id === base) ? base : fallback.baseFt;
  return {
    categoryFrom: CATEGORY_ORDER[from], categoryTo: CATEGORY_ORDER[to],
    category: from === 0 && to === CATEGORY_ORDER.length - 1 ? 'any' : CATEGORY_ORDER[to],
    coverFrom: CLOUD_ORDER[coverFrom], coverTo: CLOUD_ORDER[coverTo], cover, baseFt,
  };
}
function legacyWeatherTarget(categories) {
  const selected = CATEGORY_ORDER.filter(category => categories.includes(category));
  const categoryFrom = selected[0] || 'VFR';
  const categoryTo = selected[selected.length - 1] || categoryFrom;
  return { categoryFrom, categoryTo, coverFrom: 'CLR', coverTo: 'OVC', cover: 'any', baseFt: 0 };
}
export function isFresh(timestamp, now, maxAge) {
  const age = now - Date.parse(timestamp);
  return Number.isFinite(age) && age >= -60000 && age <= maxAge;
}
export function normalizePolicy(value = {}) {
  const p = { ...DEFAULT_POLICY, ...value };
  for (const k of ['departure', 'arrival', 'enroute', 'weather']) {
    if (!['off', 'prefer', 'require'].includes(p[k])) p[k] = 'off';
  }
  if (!['tower', 'approach', 'any'].includes(p.service)) p.service = 'tower';
  if (!['endpoints', 'every-leg'].includes(p.scope)) p.scope = 'endpoints';
  if (!['each-leg', 'itinerary'].includes(p.enrouteScope)) p.enrouteScope = 'each-leg';
  p.allowInferred = p.allowInferred === true;
  p.predictBookings = p.predictBookings !== false;
  if (!WEATHER_SOURCES.some(source => source.id === p.weatherSource)) p.weatherSource = 'auto';
  p.refreshIntervalSec = 0;
  p.minimumCoverage = Math.max(0, Math.min(100, Number.isFinite(+p.minimumCoverage) ? +p.minimumCoverage : 80));
  for (const k of ['departureWeight', 'arrivalWeight', 'enrouteWeight', 'weatherWeight']) p[k] = Math.max(0, Math.min(100, Number.isFinite(+p[k]) ? +p[k] : DEFAULT_POLICY[k]));
  const legacyCategories = Array.isArray(value.categories) ? value.categories.filter(c => CATEGORY_ORDER.includes(c)) : null;
  if (!value.departureWeather && !value.arrivalWeather && legacyCategories) {
    const legacy = normalizeWeatherTarget(legacyWeatherTarget(legacyCategories));
    p.departureWeather = legacy;
    p.arrivalWeather = { ...legacy };
  } else {
    p.departureWeather = normalizeWeatherTarget(value.departureWeather || p.departureWeather);
    p.arrivalWeather = normalizeWeatherTarget(value.arrivalWeather || p.arrivalWeather);
  }
  const sameFields = ['categoryFrom', 'categoryTo', 'coverFrom', 'coverTo', 'baseFt'].every(key => p.departureWeather[key] === p.arrivalWeather[key]);
  p.sameWeatherTarget = value.sameWeatherTarget == null ? sameFields : value.sameWeatherTarget === true;
  if (p.sameWeatherTarget) p.arrivalWeather = { ...p.departureWeather };
  const allowed = new Set();
  for (const target of [p.departureWeather, p.arrivalWeather]) {
    const [from, to] = categorySpan(target);
    CATEGORY_ORDER.slice(from, to + 1).forEach(category => allowed.add(category));
  }
  p.categories = [...allowed];
  return p;
}
