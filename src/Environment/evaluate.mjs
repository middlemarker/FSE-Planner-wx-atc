import { normalizePolicy, isFresh, VATSIM_MAX_AGE_MS } from './defaults.mjs';
import { airportCoverage, availableAt, availableDuring, matchControllers, sectorControllers } from './vatsim.mjs';
import { legCoverage, distanceNm } from './geometry.mjs';
import { weatherForAirport, judgeWeather } from './weather.mjs';

const SM_PER_NM = 1.150779448;

/** One evaluator per immutable search snapshot. Memoization never spans snapshots. */
export function createEvaluator(environment, src, inputPolicy, now = Date.now(), options = {}) {
  const speed = Number(options.speed) > 0 ? Number(options.speed) : 0;
  const policy = normalizePolicy(inputPolicy), { vatsim, weather, airspace } = environment || {};
  const planningVatsim = policy.predictBookings ? vatsim : vatsim && { ...vatsim, bookings: [] };
  const matched = matchControllers(planningVatsim, airspace);
  const fresh = isFresh(vatsim?.sourceUpdatedAt, now, VATSIM_MAX_AGE_MS);
  const sectors = matched.sectors.filter(s => (s.confidence === 'mapped' || policy.allowInferred) && ['APP', 'CTR', 'FSS'].includes(s.facility));
  const timed = policy.predictBookings && (vatsim?.bookings || []).length > 0;
  const legCache = new Map(), airportCache = new Map(), weatherCache = new Map();
  const coordinate = icao => src[icao]?.c || (src[icao] ? [src[icao].lon, src[icao].lat] : null);
  const hoursBetween = (from, to, legSpeed) => {
    const a = coordinate(from), b = coordinate(to);
    return legSpeed && a && b ? distanceNm(a, b) * SM_PER_NM / legSpeed : 0;
  };
  const endpoint = (icao, phase, at = now) => {
    const key = `${icao}:${phase}:${Math.round(at / 60000)}`;
    if (!airportCache.has(key)) airportCache.set(key, coordinate(icao) ? airportCoverage(icao, coordinate(icao), vatsim, airspace, matched, policy, phase, now, at) : { state: 'unknown', callsigns: [], reason: 'Airport coordinates missing' });
    return airportCache.get(key);
  };
  const observation = icao => {
    if (!weatherCache.has(icao)) {
      let item = weatherForAirport(icao, weather, airspace?.aliases, now);
      const located = item.lat !== null && item.lon !== null;
      const identityOk = item.matchType === 'exact' || (located && coordinate(icao) && distanceNm(coordinate(icao), [item.lon, item.lat]) <= 5);
      if (item.state === 'known' && (!coordinate(icao) || !identityOk || (located && distanceNm(coordinate(icao), [item.lon, item.lat]) > 5))) item = { ...item, state: 'unknown', reason: 'Weather station identity ambiguous' };
      weatherCache.set(icao, item);
    }
    return weatherCache.get(icao);
  };
  const leg = (from, to, departAt = now, legSpeed = speed) => {
    const key = timed ? `${from}:${to}:${Math.round(departAt / 60000)}:${legSpeed}` : `${from}:${to}`;
    if (!legCache.has(key)) {
      const a = coordinate(from), b = coordinate(to);
      const durationMs = hoursBetween(from, to, legSpeed) * 3600000;
      const active = sectors.filter(s => sectorControllers(s).some(c => durationMs > 0 ? availableDuring(c, departAt, departAt + durationMs, now) : availableAt(c, departAt, now)));
      const usable = fresh && airspace?.features?.length && a && b;
      const value = usable ? legCoverage(a, b, active) : { totalNm: a && b ? distanceNm(a, b) : 0, coveredNm: 0, longestGapNm: 0, unknown: true, segments: [] };
      legCache.set(key, value);
      // Bound memo memory for broad searches; evaluations remain deterministic.
      if (legCache.size > 10000) legCache.delete(legCache.keys().next().value);
    }
    return legCache.get(key);
  };
  function evaluate(icaos, { partial = false, details = false, speed: speedOverride = null } = {}) {
    const reasons = [], legs = [], departures = [], arrivals = [], observations = [];
    const legSpeed = Number(speedOverride) > 0 ? Number(speedOverride) : speed;
    if (icaos.length < 2) return { eligible: false, coverageScore: 0, weatherScore: 0, routeScore: 0, reasons: ['Route has no legs'] };
    const times = [now];
    for (let i = 1; i < icaos.length; i++) times.push(times[i - 1] + hoursBetween(icaos[i - 1], icaos[i], legSpeed) * 3600000);
    const depPoints = policy.scope === 'every-leg' ? icaos.slice(0, -1).map((icao, i) => ({ icao, at: times[i] })) : [{ icao: icaos[0], at: times[0] }];
    const arrPoints = policy.scope === 'every-leg' ? icaos.slice(1).map((icao, i) => ({ icao, at: times[i + 1] })) : [{ icao: icaos[icaos.length - 1], at: times[times.length - 1] }];
    for (const [phase, points, list] of [['departure', depPoints, departures], ['arrival', arrPoints, arrivals]]) {
      if (policy[phase] === 'off') continue;
      for (const point of points) {
        const value = { icao: point.icao, at: new Date(point.at).toISOString(), ...endpoint(point.icao, phase, point.at) }; list.push(value);
        if (!partial && policy[phase] === 'require' && value.state !== 'covered') reasons.push(`${point.icao}: ${phase} ${value.reason || 'coverage unavailable'}`);
      }
    }
    let totalNm = 0, coveredNm = 0, longestGapNm = 0, unknown = false;
    if (policy.enroute !== 'off' || details) for (let i = 1; i < icaos.length; i++) {
      const value = leg(icaos[i - 1], icaos[i], times[i - 1], legSpeed);
      totalNm += value.totalNm; coveredNm += value.coveredNm; unknown ||= value.unknown;
      longestGapNm = Math.max(longestGapNm, value.longestGapNm);
      const ratio = value.totalNm > 0 ? value.coveredNm / value.totalNm : 0;
      if (!partial && policy.enroute === 'require' && policy.enrouteScope === 'each-leg' && (value.unknown || ratio + 1e-9 < policy.minimumCoverage / 100)) reasons.push(`${icaos[i - 1]} → ${icaos[i]}: en-route coverage ${value.unknown ? 'unknown' : 'below minimum'}`);
      legs.push({ from: icaos[i - 1], to: icaos[i], ...value, segments: details ? value.segments : undefined });
    }
    const fraction = totalNm > 0 ? coveredNm / totalNm : 0;
    if (!partial && policy.enroute === 'require' && policy.enrouteScope === 'itinerary' && (unknown || fraction + 1e-9 < policy.minimumCoverage / 100)) reasons.push('Itinerary en-route coverage unknown or below minimum');
    if (policy.weather !== 'off') for (const [phase, points] of [['departure', depPoints], ['arrival', arrPoints]]) {
      for (const point of points) {
        const observed = observation(point.icao);
        const judged = judgeWeather(observed, policy[`${phase}Weather`]);
        observations.push({ icao: point.icao, phase, ...observed, meets: judged.meets, score: judged.score, targetReason: judged.reason });
        if (!partial && policy.weather === 'require' && !judged.meets) reasons.push(`${point.icao}: ${phase} ${judged.reason}`);
      }
    }
    const average = list => list.length ? list.filter(v => v.state === 'covered').length / list.length : 0;
    const components = { departure: average(departures), arrival: average(arrivals), enroute: fraction };
    let numerator = 0, denominator = 0, utility = 0, utilityWeight = 0;
    for (const key of ['departure', 'arrival', 'enroute']) if (policy[key] === 'prefer') {
      numerator += components[key] * policy[`${key}Weight`]; denominator += policy[`${key}Weight`];
    }
    for (const key of ['departure', 'arrival', 'enroute']) if (policy[key] !== 'off') {
      const weight = policy[`${key}Weight`] || 1;
      utility += components[key] * weight; utilityWeight += weight;
    }
    const coverageScore = denominator ? 100 * numerator / denominator : utilityWeight ? 100 * utility / utilityWeight : 0;
    const weatherScore = observations.length ? observations.reduce((sum, item) => sum + item.score, 0) / observations.length : 0;
    const pieces = [];
    if (policy.departure !== 'off') pieces.push({ score: components.departure * 100, weight: policy.departureWeight });
    if (policy.arrival !== 'off') pieces.push({ score: components.arrival * 100, weight: policy.arrivalWeight });
    if (policy.enroute !== 'off') pieces.push({ score: unknown ? 0 : fraction * 100, weight: policy.enrouteWeight });
    if (policy.weather !== 'off') pieces.push({ score: weatherScore, weight: policy.weatherWeight });
    const weightSum = pieces.reduce((sum, piece) => sum + piece.weight, 0);
    const routeScore = !pieces.length ? 0 : weightSum > 0
      ? pieces.reduce((sum, piece) => sum + piece.score * piece.weight, 0) / weightSum
      : pieces.reduce((sum, piece) => sum + piece.score, 0) / pieces.length;
    return { eligible: !reasons.length, reasons, coverageScore, weatherScore, routeScore,
      candidateUtility: routeScore,
      departures, arrivals, observations, legs, totalNm, coveredNm, fraction, longestGapNm, unknown,
      snapshotTime: vatsim?.sourceUpdatedAt || null, evaluatedAt: new Date(now).toISOString(),
      snapshotId: vatsim?.snapshotId || null, weatherSnapshotId: weather?.snapshotId || null,
      boundaryVersion: airspace?.version || null, policy };
  }
  return { evaluate, leg, endpoint, observation, matched };
}

export const compareCoverage = (a, b) => (b.environment?.coverageScore || 0) - (a.environment?.coverageScore || 0) || b.payTime - a.payTime || a.icaos.join('-').localeCompare(b.icaos.join('-'));
export const compareConditions = (a, b) => (b.environment?.routeScore || 0) - (a.environment?.routeScore || 0) || b.payTime - a.payTime || a.icaos.join('-').localeCompare(b.icaos.join('-'));

/** Bounded union: coverage gets half the budget; financial objectives share the remainder. */
export function retainCandidates(routes, limit, evaluate) {
  const budget = Math.max(1, limit * 3);
  if (routes.length <= budget) return routes;
  const score = new Map(routes.map(r => { const e = evaluate(r.icaos, { partial: true }); return [r, e.routeScore]; }));
  const groups = [
    [...routes].sort((a, b) => score.get(b) - score.get(a) || b.pay - a.pay),
    [...routes].sort((a, b) => b.pay - a.pay),
    [...routes].sort((a, b) => b.pay / Math.max(1, b.distance) - a.pay / Math.max(1, a.distance)),
    [...routes].sort((a, b) => b.pay / b.icaos.length - a.pay / a.icaos.length),
  ];
  const chosen = new Set(groups[0].slice(0, Math.ceil(budget / 2)));
  for (let i = 0; chosen.size < budget && i < routes.length; i++) for (const group of groups.slice(1)) {
    if (chosen.size < budget && group[i]) chosen.add(group[i]);
  }
  return [...chosen];
}
