import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { runSearch } from '../src/Routing/routingCore.mjs';
import { distanceNm } from '../src/Environment/geometry.mjs';

// Both legacy and extracted implementations receive the SAME deterministic geometry adapter.
const geo = {
  getDistance: (a, b) => distanceNm(a, b) * 1852,
  convertDistance: meters => meters / 1852,
  getRhumbLineBearing: (a, b) => b[0] >= a[0] ? 90 : 270,
};
function input({ stops = 0, to = null, loop = false, empty = false } = {}) {
  const src = {};
  for (const [id, x] of [['AAAA', 0], ['BBBB', 1], ['CCCC', 2], ['DDDD', 2.2]]) src[id] = { c: [x, 0], r: [] };
  function job(a, b, pay = 100) {
    src[a].j ||= new Map();
    src[a].j.set(b, { distance: Math.round(distanceNm(src[a].c, src[b].c)), direction: geo.getRhumbLineBearing(src[a].c, src[b].c), cargos: { TripOnly: [{ from: a, to: b, pax: 1, kg: 77, pay, id: a + b }], VIP: [] } });
    src[b].r.push(a);
  }
  job('AAAA', 'BBBB'); job('BBBB', 'CCCC');
  if (stops) job('AAAA', 'CCCC', 300);
  if (loop) job('CCCC', 'AAAA');
  return { src, fromIcao: empty ? 'DDDD' : 'AAAA', toIcao: loop ? 'AAAA' : to, heading: false, maxHops: 5, maxBadLegs: 3,
    options: { range: 1000, speed: 120, gph: 10, maxKg: 1500, maxPax: 4, maxCargo: 600, minPaxLoad: 0, minCargoLoad: 0, maxStops: stops, maxEmptyLeg: 20, model: 'test', resultLimit: 0 } };
}
function legacy(data) {
  let results;
  const source = readFileSync(new URL('./fixtures/routing-legacy.txt', import.meta.url), 'utf8').replace(/^import[^\n]*\n/, '');
  const context = vm.createContext({ ...geo, postMessage: v => { if (v.status === 'finished') results = v.results; } });
  vm.runInContext(source, context); context.onmessage({ data });
  return JSON.parse(JSON.stringify(results));
}
for (const [name, options] of [['direct', {}], ['inserted stops', { stops: 1 }], ['loop', { loop: true }], ['forced destination', { to: 'DDDD' }], ['empty reposition', { empty: true, loop: true }]]) {
  test(`extracted search preserves disabled behavior: ${name}`, () => {
    const fixture = input(options);
    const expected = legacy(structuredClone(fixture));
    const result = runSearch(structuredClone(fixture), { geo });
    assert.deepEqual(JSON.parse(JSON.stringify(result.results)), expected);
  });
}
test('worker final validation rejects missing strict coverage including inserted stops', () => {
  const data = input({ stops: 1 }); data.environmentPolicy = { arrival: 'require', scope: 'every-leg' };
  const result = runSearch(data, { geo });
  assert.equal(result.results.length, 0); assert.ok(Object.keys(result.rejected).length > 0);
});
test('every emitted leg respects aircraft range, including final completion', () => {
  const data = input({ to: 'DDDD', stops: 1 }); data.options.range = 65;
  const result = runSearch(data, { geo });
  assert.ok(result.results.length);
  for (const r of result.results) for (let i = 1; i < r.icaos.length; i++) assert.ok(Math.round(distanceNm(data.src[r.icaos[i - 1]].c, data.src[r.icaos[i]].c)) <= 65);
});

test('regression: original search appended a destination leg beyond aircraft range', () => {
  const data = input();
  data.src = {};
  for (const [id, x] of [['AAAA', 0], ['BBBB', 1], ['CCCC', 2], ['DDDD', 3], ['EEEE', 4.1], ['FFFF', 6]]) data.src[id] = { c: [x, 0], r: [] };
  const ids = ['AAAA', 'BBBB', 'CCCC', 'DDDD', 'EEEE'];
  for (let i = 1; i < ids.length; i++) {
    const from = ids[i - 1], to = ids[i];
    data.src[from].j = new Map([[to, { distance: Math.round(distanceNm(data.src[from].c, data.src[to].c)), direction: 90, cargos: { TripOnly: [{ from, to, pax: 1, kg: 77, pay: 100 }], VIP: [] } }]]);
    data.src[to].r.push(from);
  }
  data.toIcao = 'FFFF'; data.maxHops = 6; data.options.range = 70; data.options.maxEmptyLeg = 0;
  const old = legacy(structuredClone(data));
  assert.ok(old.some(r => r.icaos.at(-1) === 'FFFF'));
  assert.equal(runSearch(structuredClone(data), { geo }).results.length, 0);
});
