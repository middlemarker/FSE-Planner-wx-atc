import assert from 'node:assert/strict';
import test from 'node:test';
import { layerProductTime, shortUpdated } from '../src/MapLayers/layerTime.mjs';

const now = Date.parse('2026-11-05T17:40:00Z');

test('same-day updates show the UTC clock', () => {
  assert.equal(shortUpdated('2026-11-05T14:32:00Z', now), '14:32Z');
  assert.equal(shortUpdated('not-a-time', now), '');
});

test('older updates show the month and day', () => {
  assert.equal(shortUpdated('2026-11-04T23:10:00Z', now), '11-04');
});

test('a daily weather product shows its date and a radar frame shows its clock', () => {
  const daily = {
    slice: 'latest',
    manifest: { valid_start: '2026-11-04T00:00:00.000Z', valid_end: '2026-11-04T23:59:59.000Z' },
  };
  const radar = {
    slice: 'frame',
    timeline: { slices: [{ id: 'frame', valid_start: '2026-11-05T17:20:00Z', valid_end: '2026-11-05T17:20:00Z' }] },
  };
  assert.equal(layerProductTime(daily, now), '11-04');
  assert.equal(layerProductTime(radar, now), '17:20Z');
  assert.equal(layerProductTime(null, now), '');
});
