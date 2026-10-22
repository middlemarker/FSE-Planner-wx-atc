import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMetar, flightCategory, visibilitySM, judgeWeather, formatVisibility, formatWind, parseRawMetar } from '../src/Environment/weather.mjs';
import { normalizePolicy } from '../src/Environment/defaults.mjs';
import { legCoverage, containsPoint } from '../src/Environment/geometry.mjs';
import { normalizeVatsim, normalizeBookings, matchControllers, buildAirspace, validGeometry, formatController } from '../src/Environment/vatsim.mjs';
import { createEvaluator, retainCandidates } from '../src/Environment/evaluate.mjs';

export const NOW = Date.parse('2026-10-15T18:00:00Z');
const stamp = new Date(NOW).toISOString();
const rectangle = (west, south, east, north) => ({ type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
const sector = geometry => ({ id: 'sector', geometry, prefixes: ['AREA'], suffixes: ['CTR'], name: 'Area', source: 'fixture' });
export function environmentFixture() {
  return {
    vatsim: { schemaVersion: 1, sourceUpdatedAt: stamp, snapshotId: 'fixture', controllers: [
      { callsign: 'AAAA_TWR', facility: 'TWR' }, { callsign: 'CCCC_TWR', facility: 'TWR' }, { callsign: 'AREA_CTR', facility: 'CTR' },
    ] },
    airspace: { version: 'fixture', features: [sector(rectangle(-1, -1, 3, 1))], airports: {
      AAAA: { id: 'AAAA', lon: 0, lat: 0 }, BBBB: { id: 'BBBB', lon: 1, lat: 0 }, CCCC: { id: 'CCCC', lon: 2, lat: 0 },
    } },
    weather: { snapshotId: 'weather-fixture', observations: {} },
  };
}
export const airportsFixture = { AAAA: { c: [0, 0] }, BBBB: { c: [1, 0] }, CCCC: { c: [2, 0] } };

test('flight category threshold boundaries and worse dimension', () => {
  const v = value => ({ value, bound: 'exact' });
  for (const [height, expected] of [[499, 'LIFR'], [500, 'IFR'], [999, 'IFR'], [1000, 'MVFR'], [3000, 'MVFR'], [3001, 'VFR']]) assert.equal(flightCategory(v(10), height, true), expected);
  for (const [vis, expected] of [[0.9, 'LIFR'], [1, 'IFR'], [2.9, 'IFR'], [3, 'MVFR'], [5, 'MVFR'], [5.1, 'VFR']]) assert.equal(flightCategory(v(vis), null, true), expected);
  assert.equal(flightCategory(v(0.5), 5000, true), 'LIFR');
  assert.equal(flightCategory(v(10), null, false), 'UNKNOWN');
  assert.deepEqual(visibilitySM('1 1/2SM'), { value: 1.5, bound: 'exact' });
  assert.equal(flightCategory(visibilitySM('M1/4SM'), null, true), 'LIFR');
  assert.equal(flightCategory(visibilitySM('P6SM'), null, true), 'VFR');
});
test('METAR layers, CAVOK, missing and obscured skies', () => {
  const base = { icaoId: 'AAAA', obsTime: NOW / 1000, lat: 0, lon: 0, visib: 10 };
  const m = normalizeMetar({ ...base, clouds: [{ cover: 'FEW', base: 500 }, { cover: 'BKN', base: 2500 }, { cover: 'OVC', base: 7000 }] });
  assert.equal(m.ceilingFtAGL, 2500); assert.equal(m.category, 'MVFR');
  assert.equal(normalizeMetar({ ...base, rawOb: 'AAAA CAVOK' }).category, 'VFR');
  assert.equal(normalizeMetar(base).category, 'UNKNOWN');
  assert.equal(normalizeMetar({ ...base, rawOb: 'AAAA VV///', clouds: [{ cover: 'VV', base: null }] }).category, 'UNKNOWN');
});
test('coverage unions overlaps and excludes holes and narrow gaps', () => {
  const outer = rectangle(-1, -1, 3, 1);
  outer.coordinates.push(rectangle(0.999, -0.5, 1.001, 0.5).coordinates[0]);
  const c = legCoverage([0, 0], [2, 0], [{ geometry: outer }]);
  assert.ok(c.coveredNm < c.totalNm); assert.ok(c.longestGapNm > 0.1);
  assert.equal(containsPoint(outer, [1, 0]), false);
  const covered = legCoverage([0, 0], [2, 0], [{ geometry: rectangle(-1, -1, 3, 1) }, { geometry: rectangle(0, -1, 2, 1) }]);
  assert.ok(Math.abs(covered.coveredNm / covered.totalNm - 1) < 1e-9);
});
test('dateline, MultiPolygon and zero length', () => {
  const c = legCoverage([179, 0], [-179, 0], [{ geometry: rectangle(178, -1, -178, 1) }]);
  assert.ok(c.totalNm > 119 && c.totalNm < 121); assert.ok(Math.abs(c.coveredNm - c.totalNm) < 1e-6);
  assert.equal(containsPoint({ type: 'MultiPolygon', coordinates: [rectangle(-1, -1, 1, 1).coordinates, rectangle(5, -1, 7, 1).coordinates] }, [6, 0]), true);
  assert.equal(legCoverage([0, 0], [0, 0], []).totalNm, 0);
});
test('booking windows are UTC and controller text includes logon and booking', () => {
  const parsed = normalizeBookings([{ callsign: 'aaaa_twr', start: '2026-10-15 18:00:00', end: '2026-10-15 19:00:00' }], NOW);
  assert.equal(parsed[0].start, '2026-10-15T18:00:00.000Z'); assert.equal(parsed[0].endMs - parsed[0].startMs, 3600000);
  assert.equal(normalizeBookings([{ callsign: 'AAAA_TWR', start: 'nope', end: '2026-10-15 19:00:00' }], NOW).length, 0);
  const text = formatController({ callsign: 'AAAA_TWR', facility: 'TWR', frequency: '118.700', name: 'Tower', logonTime: stamp, online: true, bookings: parsed }, NOW);
  assert.match(text, /AAAA_TWR · TWR · 118\.700 · Tower · on since 18:00Z · booked 18:00Z–19:00Z/);
});
test('a booking limits later coverage and can cover an airport before the controller logs on', () => {
  const booked = { callsign: 'CCCC_TWR', start: stamp, end: new Date(NOW + 30 * 60000).toISOString(), startMs: NOW, endMs: NOW + 30 * 60000 };
  const ending = environmentFixture();
  ending.vatsim.bookings = [booked];
  const soon = createEvaluator(ending, airportsFixture, { arrival: 'require' }, NOW, { speed: 600 }).evaluate(['AAAA', 'CCCC']);
  const later = createEvaluator(ending, airportsFixture, { arrival: 'require' }, NOW, { speed: 60 }).evaluate(['AAAA', 'CCCC']);
  assert.equal(soon.eligible, true); assert.equal(later.eligible, false);
  assert.match(later.reasons.join(' '), /Booked controller/);
  const scheduled = environmentFixture();
  scheduled.vatsim.controllers = scheduled.vatsim.controllers.filter(c => c.callsign !== 'CCCC_TWR');
  scheduled.vatsim.bookings = [{ ...booked, end: new Date(NOW + 3 * 3600000).toISOString(), endMs: NOW + 3 * 3600000 }];
  assert.equal(createEvaluator(scheduled, airportsFixture, { arrival: 'require' }, NOW, { speed: 60 }).evaluate(['AAAA', 'CCCC']).eligible, true);
  assert.equal(createEvaluator(scheduled, airportsFixture, { arrival: 'require', predictBookings: false }, NOW, { speed: 60 }).evaluate(['AAAA', 'CCCC']).eligible, false);
  assert.equal(matchControllers(scheduled.vatsim, scheduled.airspace).airportControllers.CCCC[0].online, false);
});
test('controller normalization excludes observers, treats DEP as APP and RMP as GND', () => {
  const feed = normalizeVatsim({ general: { update_timestamp: stamp }, controllers: [
    { callsign: 'AAAA_OBS', facility: 0 }, { callsign: 'AAAA_DEP', facility: 5 }, { callsign: 'AAAA_RMP', facility: 3 }, { callsign: 'AAAA_ATIS', facility: 4 },
  ] });
  assert.deepEqual(feed.controllers.map(c => c.facility), ['APP', 'GND']);
});
test('specific sector matching wins, broad fallback is inferred', () => {
  const e = environmentFixture();
  e.vatsim.controllers = [{ callsign: 'AREA_N_CTR', facility: 'CTR' }];
  assert.equal(matchControllers(e.vatsim, e.airspace).sectors[0].confidence, 'inferred');
  e.airspace.features.push({ ...sector(rectangle(0, 0, 1, 1)), id: 'north', prefixes: ['AREA_N'] });
  const result = matchControllers(e.vatsim, e.airspace);
  assert.equal(result.sectors.length, 1); assert.equal(result.sectors[0].id, 'north');
});
test('endpoint scope excludes intermediate stops only when configured', () => {
  const env = environmentFixture();
  const policy = { departure: 'require', arrival: 'require', scope: 'endpoints' };
  assert.equal(createEvaluator(env, airportsFixture, policy, NOW).evaluate(['AAAA', 'BBBB', 'CCCC']).eligible, true);
  const every = createEvaluator(env, airportsFixture, { ...policy, scope: 'every-leg' }, NOW).evaluate(['AAAA', 'BBBB', 'CCCC']);
  assert.equal(every.eligible, false); assert.ok(every.reasons.some(r => r.includes('BBBB')));
});
test('strict requirements fail stale data; no inferred center-to-tower service', () => {
  const env = environmentFixture(); env.vatsim.controllers = [{ callsign: 'AREA_CTR', facility: 'CTR' }];
  assert.equal(createEvaluator(env, airportsFixture, { departure: 'require' }, NOW).evaluate(['AAAA', 'CCCC']).eligible, false);
  assert.equal(createEvaluator(env, airportsFixture, { enroute: 'require' }, NOW + 121000).evaluate(['AAAA', 'CCCC']).eligible, false);
});
test('strict full coverage detects holes and inferred mappings', () => {
  const env = environmentFixture(); env.airspace.features[0].geometry.coordinates.push(rectangle(0.999, -0.5, 1.001, 0.5).coordinates[0]);
  assert.equal(createEvaluator(env, airportsFixture, { enroute: 'require', minimumCoverage: 100 }, NOW).evaluate(['AAAA', 'CCCC']).eligible, false);
  env.vatsim.controllers = [{ callsign: 'AREA_X_CTR', facility: 'CTR' }];
  const p = { enroute: 'require', minimumCoverage: 80 };
  assert.equal(createEvaluator(env, airportsFixture, p, NOW).evaluate(['AAAA', 'CCCC']).eligible, false);
  assert.equal(createEvaluator(env, airportsFixture, { ...p, allowInferred: true }, NOW).evaluate(['AAAA', 'CCCC']).eligible, true);
});
test('score does not depend on pay; strict weather rejects missing reports', () => {
  const evaluate = createEvaluator(environmentFixture(), airportsFixture, { departure: 'prefer', arrival: 'prefer', enroute: 'prefer' }, NOW).evaluate;
  assert.equal(evaluate(['AAAA', 'CCCC']).coverageScore, 100);
  assert.equal(createEvaluator(environmentFixture(), airportsFixture, { weather: 'require' }, NOW).evaluate(['AAAA', 'CCCC']).eligible, false);
});
test('bounded retention keeps a low-paying covered candidate', () => {
  const evaluate = createEvaluator(environmentFixture(), airportsFixture, { arrival: 'prefer' }, NOW).evaluate;
  const routes = Array.from({ length: 20 }, (_, i) => ({ icaos: ['AAAA', 'BBBB'], pay: 1000 + i, distance: 100 }));
  const desirable = { icaos: ['AAAA', 'CCCC'], pay: 1, distance: 120 }; routes.push(desirable);
  const retained = retainCandidates(routes, 1, evaluate);
  assert.equal(retained.length, 3); assert.ok(retained.includes(desirable));
});
test('VATSpy parser joins callsign prefixes to geometry IDs', () => {
  const dat = '[Airports]\nAAAA|Example|0|0|AAA|AREA|0\n[FIRs]\nAREA|Area name|ABC|AREA';
  const airspace = buildAirspace(dat, { features: [{ properties: { id: 'AREA' }, geometry: rectangle(-1, -1, 1, 1) }] }, 'revision');
  assert.equal(airspace.airports.AAAA.localId, 'AAA'); assert.deepEqual(airspace.features[0].prefixes, ['ABC']);
});

test('malformed and unclosed geometry never enters the boundary dataset', () => {
  assert.equal(validGeometry({ type: 'Polygon', coordinates: [] }), false);
  assert.equal(validGeometry({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] }), false);
  assert.equal(validGeometry(rectangle(-1, -1, 1, 91)), false);
  assert.equal(validGeometry(rectangle(-1, -1, 1, 1)), true);
});

test('weather requirements reject stale or geographically mismatched station identities', () => {
  const env = environmentFixture();
  for (const [id, lon] of [['AAAA', 0], ['CCCC', 2]]) env.weather.observations[id] = normalizeMetar({ icaoId: id, lat: 0, lon, obsTime: NOW / 1000, rawOb: `${id} CAVOK` });
  const evaluate = time => createEvaluator(env, airportsFixture, { weather: 'require', categories: ['VFR'] }, time).evaluate(['AAAA', 'CCCC']);
  assert.equal(evaluate(NOW).eligible, true);
  assert.equal(evaluate(NOW + 91 * 60000).eligible, false);
  env.weather.observations.CCCC.lon = 20;
  assert.equal(evaluate(NOW).eligible, false);
});

test('visibility and wind text omit exact bounds and degree marks on variable wind', () => {
  assert.equal(formatVisibility({ value: 10, bound: 'exact' }), '10 SM');
  assert.equal(formatVisibility(visibilitySM('P6SM')), '6 SM or more');
  assert.equal(formatVisibility(visibilitySM('M1/4SM')), 'less than 0.25 SM');
  assert.equal(formatWind({ windDirection: 'VRB', windKt: 8, gustKt: null }), 'VRB 8 kt');
  assert.equal(formatWind({ windDirection: 270, windKt: 12, gustKt: 20 }), '270° 12 kt gusting 20');
});

test('saved category lists become or-better targets without a cloud constraint', () => {
  const legacy = normalizePolicy({ weather: 'require', categories: ['VFR', 'MVFR'] });
  assert.equal(legacy.departureWeather.category, 'MVFR');
  assert.equal(legacy.departureWeather.cover, 'any');
  assert.equal(legacy.arrivalWeather.baseFt, 0);
  const fresh = normalizePolicy({ weather: 'prefer' });
  assert.deepEqual(fresh.departureWeather, { categoryFrom: 'VFR', categoryTo: 'VFR', category: 'VFR', coverFrom: 'CLR', coverTo: 'SCT', cover: 'SCT', baseFt: 3000 });
  assert.deepEqual(fresh.arrivalWeather, fresh.departureWeather);
  const span = normalizePolicy({ sameWeatherTarget: true, departureWeather: { categoryFrom: 'IFR', categoryTo: 'LIFR', cover: 'any', baseFt: 0 } });
  assert.equal(span.departureWeather.categoryFrom, 'IFR');
  assert.equal(span.departureWeather.categoryTo, 'LIFR');
  assert.deepEqual(span.categories, ['IFR', 'LIFR']);
  const practice = normalizePolicy({ categories: ['IFR', 'LIFR'] });
  assert.equal(practice.departureWeather.categoryFrom, 'IFR');
  assert.equal(practice.departureWeather.categoryTo, 'LIFR');
});

test('clearer VFR outranks cloudy VFR, and departure and arrival targets differ', () => {
  const known = fields => ({ state: 'known', ...fields });
  const target = { category: 'VFR', cover: 'SCT', baseFt: 3000 };
  const clear = judgeWeather(known({ category: 'VFR', cloudCover: 'CLR', ceilingFtAGL: null }), target);
  const broken = judgeWeather(known({ category: 'VFR', cloudCover: 'BKN', ceilingFtAGL: 3500 }), target);
  const marginal = judgeWeather(known({ category: 'MVFR', cloudCover: 'CLR', ceilingFtAGL: null }), { category: 'any', cover: 'any', baseFt: 0 });
  assert.equal(clear.meets, true);
  assert.equal(broken.meets, false);
  assert.ok(clear.score > broken.score);
  assert.ok(marginal.meets);
  const ifrOnly = { categoryFrom: 'IFR', categoryTo: 'IFR', cover: 'any', baseFt: 0 };
  const ifr = judgeWeather(known({ category: 'IFR', cloudCover: 'OVC', ceilingFtAGL: 800 }), ifrOnly);
  const tooGood = judgeWeather(known({ category: 'VFR', cloudCover: 'CLR', ceilingFtAGL: null }), ifrOnly);
  assert.equal(ifr.meets, true);
  assert.equal(tooGood.meets, false);
  assert.ok(ifr.score > tooGood.score);
  assert.match(tooGood.reason, /VFR is better than IFR/);

  const metar = (id, clouds, visib = 10) => normalizeMetar({ icaoId: id, lat: 0, lon: id === 'AAAA' ? 0 : 2, obsTime: NOW / 1000, visib, clouds });
  const env = environmentFixture();
  env.weather.observations.AAAA = metar('AAAA', [{ cover: 'CLR' }]);
  env.weather.observations.CCCC = metar('CCCC', [{ cover: 'FEW', base: 4000 }]);
  const ranked = createEvaluator(env, airportsFixture, { weather: 'prefer' }, NOW).evaluate(['AAAA', 'CCCC']);
  const departure = ranked.observations.find(item => item.phase === 'departure');
  const arrival = ranked.observations.find(item => item.phase === 'arrival');
  assert.equal(departure.meets, true);
  assert.equal(arrival.meets, true);
  assert.equal(ranked.routeScore, ranked.weatherScore);
  assert.match(ranked.observations.map(item => `${item.phase} ${item.icao} ${item.category} ${item.cloudCover}`).join(' | '), /departure AAAA VFR CLR \| arrival CCCC VFR FEW/);

  env.weather.observations.CCCC = metar('CCCC', [{ cover: 'BKN', base: 1500 }]);
  const low = createEvaluator(env, airportsFixture, { weather: 'require', departureWeather: target, arrivalWeather: target }, NOW).evaluate(['AAAA', 'CCCC']);
  assert.equal(low.eligible, false);
  assert.match(low.reasons.join(' '), /CCCC: arrival .*ceiling 1500 ft is below 3000 ft/);

  const split = createEvaluator(env, airportsFixture, {
    weather: 'require',
    departureWeather: { category: 'VFR', cover: 'any', baseFt: 0 },
    arrivalWeather: { category: 'MVFR', cover: 'BKN', baseFt: 1000 },
  }, NOW).evaluate(['AAAA', 'CCCC']);
  assert.equal(split.eligible, true);

  const combined = createEvaluator(env, airportsFixture, { weather: 'prefer', arrival: 'prefer', departureWeather: target, arrivalWeather: { category: 'MVFR', cover: 'BKN', baseFt: 1000 } }, NOW).evaluate(['AAAA', 'CCCC']);
  const blend = combined.policy.arrivalWeight + combined.policy.weatherWeight;
  assert.ok(Math.abs(combined.routeScore - (combined.coverageScore * combined.policy.arrivalWeight + combined.weatherScore * combined.policy.weatherWeight) / blend) < 1e-9);
  const weatherLed = createEvaluator(env, airportsFixture, { weather: 'prefer', arrival: 'prefer', weatherWeight: 100, arrivalWeight: 0 }, NOW).evaluate(['AAAA', 'CCCC']);
  assert.equal(weatherLed.routeScore, weatherLed.weatherScore);
});

test('NOAA cycle text parses visibility, clouds and an exact station without coordinates', () => {
  const now = new Date(NOW);
  const jfk = normalizeMetar(parseRawMetar('KJFK 151751Z 18010G18KT 10SM FEW040 SCT250 22/10 A3012', now));
  assert.equal(jfk.stationId, 'KJFK'); assert.equal(jfk.category, 'VFR'); assert.equal(jfk.cloudCover, 'SCT'); assert.equal(jfk.ceilingFtAGL, null);
  assert.equal(jfk.windKt, 10); assert.equal(jfk.gustKt, 18); assert.equal(jfk.source, 'NOAA-cycle'); assert.equal(jfk.lat, null);
  const heathrow = normalizeMetar(parseRawMetar('EGLL 151720Z 22008KT 9999 BKN014 12/10 Q1016', now));
  assert.equal(heathrow.category, 'MVFR'); assert.equal(heathrow.ceilingFtAGL, 1400);
  const low = normalizeMetar(parseRawMetar('KAAA 151800Z 00000KT 1 1/2SM BR OVC003', now));
  assert.equal(low.category, 'LIFR'); assert.equal(low.visibility.value, 1.5);
  const staleFutureDay = normalizeMetar(parseRawMetar('KE77 222325Z AUTO 17004G12KT 6SM TS HZ SCT020 37/14 A3007', new Date('2026-10-20T14:34:12Z'), 'VATSIM'));
  assert.equal(staleFutureDay.observedAt, '2026-09-22T23:25:00.000Z');
  const env = environmentFixture();
  for (const id of ['AAAA', 'CCCC']) env.weather.observations[id] = normalizeMetar(parseRawMetar(`${id} 151750Z 00000KT CAVOK 20/10 Q1016`, now));
  assert.equal(createEvaluator(env, airportsFixture, { weather: 'require', categories: ['VFR'] }, NOW).evaluate(['AAAA', 'CCCC']).eligible, true);
});

test('scope compares per-leg minimum independently of whole-itinerary percentage', () => {
  const env = environmentFixture(); env.airspace.features[0].geometry = rectangle(-1, -1, 1.6, 1);
  const p = { enroute: 'require', minimumCoverage: 75 };
  assert.equal(createEvaluator(env, airportsFixture, p, NOW).evaluate(['AAAA', 'BBBB', 'CCCC']).eligible, false);
  assert.equal(createEvaluator(env, airportsFixture, { ...p, enrouteScope: 'itinerary' }, NOW).evaluate(['AAAA', 'BBBB', 'CCCC']).eligible, true);
});
