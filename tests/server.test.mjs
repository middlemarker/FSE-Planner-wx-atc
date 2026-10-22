import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createCache } from '../server/cache.mjs';
import { weatherFromCsv, weatherFromMetarText, mergeWeather, parseCsv } from '../server/providers.mjs';
import { createEnvironmentServer } from '../server/index.mjs';
import { completeDailyTimeToken, weatherLayerCatalog, weatherLayerImageSource, weatherLayerManifest, weatherLayerTileSource, weatherLayerTimeline } from '../server/weather-layers.mjs';
import { cloudFractionPercent, coverageHatchSegments, coverageTileSample, coverageZoomLadder, effectiveNativeZoom, isUnsupportedZoomNotice, recolorCloudFractionPixels, tileHasVisibleCoverage } from '../src/MapLayers/weatherTiles.mjs';

function weatherLayerFetchStub(url, init = {}) {
  if (String(url).includes('gibs.earthdata.nasa.gov')) return Promise.resolve(new Response('', {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'layer-time-actual': '2026-10-20T14:00:00Z',
    },
  }));
  if (String(url).includes('api.rainviewer.com')) return Promise.resolve(Response.json({
    host: 'https://tilecache.rainviewer.com',
    radar: {
      past: [{ time: 1792575600, path: '/v2/radar/testframe' }],
      nowcast: [{ time: 1792576200, path: '/v2/radar/futureframe' }],
    },
  }));
  if (String(url).includes('tilecache.rainviewer.com')) return Promise.resolve(new Response('', { status: 200, headers: { 'content-type': 'image/png' } }));
  return fetch(url, init);
}

test('cache coalesces readers and retains original timestamps during outage', async () => {
  let calls = 0, now = 100, fail = false;
  const cache = createCache(async () => { calls++; if (fail) throw new Error('outage'); return { sourceUpdatedAt: 'original' }; }, 30, { now: () => now, retryMs: 10 });
  const values = await Promise.all([cache.get(), cache.get(), cache.get()]);
  assert.equal(calls, 1); assert.equal(values[0], values[1]);
  now = 140; fail = true;
  assert.equal((await cache.get()).sourceUpdatedAt, 'original');
  await cache.get(); assert.equal(calls, 2);
  now = 151; fail = false; await cache.get(); assert.equal(calls, 3);
});
test('first failure backs off and synchronous failures can recover', async () => {
  let now = 0, fail = true, calls = 0;
  const cache = createCache(() => { calls++; if (fail) throw new Error('unavailable'); return 42; }, 30, { now: () => now, retryMs: 10 });
  await assert.rejects(cache.get()); await assert.rejects(cache.get()); assert.equal(calls, 1);
  now = 11; fail = false; assert.equal(await cache.get(), 42);
});
test('METAR CSV handles metadata, repeated cloud columns, quotes and newer observations', () => {
  const header = 'raw_text,station_id,observation_time,latitude,longitude,visibility_statute_mi,sky_cover,cloud_base_ft_agl,sky_cover,cloud_base_ft_agl,wind_speed_kt';
  const text = 'metadata\n' + header + '\n"AAAA, report",AAAA,2026-10-15T18:00:00Z,0,0,10,FEW,500,BKN,2500,5\nAAAA older,AAAA,2026-10-15T17:00:00Z,0,0,10,CLR,,,,0\n';
  const obs = weatherFromCsv(text).observations.AAAA;
  assert.equal(obs.raw, 'AAAA, report'); assert.equal(obs.category, 'MVFR'); assert.equal(obs.ceilingFtAGL, 2500); assert.equal(obs.windKt, 5);
  assert.deepEqual(parseCsv('"hello\nworld","a""b"\r\n'), [['hello\nworld', 'a"b']]);
  assert.throws(() => weatherFromCsv('unexpected response'));
});
test('NOAA cycle text fills a station and loses to a newer located report', () => {
  const cycle = weatherFromMetarText('2026/10/15 18:00\nAAAA 151700Z 00000KT CAVOK 20/10 Q1016\n', '2026-10-15T18:00:00Z');
  assert.equal(cycle.observations.AAAA.source, 'NOAA-cycle'); assert.equal(cycle.observations.AAAA.category, 'VFR'); assert.equal(cycle.observations.AAAA.lat, null);
  const vatsim = weatherFromMetarText('BBBB 151700Z 00000KT CAVOK 20/10 Q1016\n', '2026-10-15T18:00:00Z', new Date('2026-10-15T18:00:00Z'), 'VATSIM');
  assert.equal(vatsim.observations.BBBB.source, 'VATSIM');
  const awc = weatherFromCsv('raw_text,station_id,observation_time,latitude,longitude,visibility_statute_mi,sky_cover,cloud_base_ft_agl\nAAAA 151800Z,AAAA,2026-10-15T18:00:00Z,1,1,2,BKN,900\n');
  const merged = mergeWeather([cycle, awc]);
  assert.equal(merged.observations.AAAA.source, 'AWC'); assert.equal(merged.observations.AAAA.category, 'IFR');
  assert.deepEqual(merged.sources.map(source => source.id), ['NOAA-cycle', 'AWC']);
  const olderLocated = mergeWeather([awc, weatherFromMetarText('AAAA 151900Z 00000KT CAVOK 20/10 Q1016\n', '2026-10-15T19:00:00Z')]);
  assert.equal(olderLocated.observations.AAAA.source, 'NOAA-cycle'); assert.equal(olderLocated.observations.AAAA.category, 'VFR');
});
test('HTTP service CORS, gzip decoding, conditional cache and unavailable response', async t => {
  const server = createEnvironmentServer({ allowedOrigins: ['http://localhost:3000'], loaders: {
    vatsim: async () => ({ schemaVersion: 1, snapshotId: 'fixed', controllers: [] }),
    weather: async () => { throw new Error('weather down'); },
    weatherAwc: async () => ({ schemaVersion: 1, snapshotId: 'awc-only', observations: {} }),
    weatherCycles: async () => ({ schemaVersion: 1, snapshotId: 'cycles-only', observations: {} }),
    weatherVatsim: async () => ({ schemaVersion: 1, snapshotId: 'vatsim-only', observations: {} }),
    weatherLayerFetch: weatherLayerFetchStub,
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/environment/v1`;
  const response = await fetch(base + '/vatsim', { headers: { Origin: 'http://localhost:3000' } });
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:3000');
  assert.equal((await response.json()).snapshotId, 'fixed');
  const cached = await fetch(base + '/vatsim', { headers: { 'If-None-Match': response.headers.get('etag') } });
  assert.equal(cached.status, 304);
  assert.equal((await fetch(base + '/weather/snapshot')).status, 503);
  assert.equal((await (await fetch(base + '/weather/snapshot?source=awc')).json()).snapshotId, 'awc-only');
  assert.equal((await (await fetch(base + '/weather/snapshot?source=cycles')).json()).snapshotId, 'cycles-only');
  assert.equal((await (await fetch(base + '/weather/snapshot?source=vatsim')).json()).snapshotId, 'vatsim-only');
  assert.equal((await fetch(base + '/weather/snapshot?source=bad')).status, 400);
  const layers = await (await fetch(base + '/weather/layers')).json();
  assert.equal(layers.defaultLayer, 'precipitation_recent');
  const timeline = await (await fetch(base + '/weather/layers/precipitation_recent/timeline')).json();
  assert.equal(timeline.selected, 'latest');
  const manifest = await (await fetch(base + '/weather/layers/precipitation_recent/latest/manifest')).json();
  assert.deepEqual(manifest.bounds, [-180, -85.0511, 180, 85.0511]);
  assert.ok(manifest.tile.urlTemplate.includes('/tile/{z}/{x}/{y}.png'));
  assert.equal((await fetch(base + '/weather/layers/cloud_cover_daily/latest/manifest')).status, 200);
  const forecastTimeline = await (await fetch(base + '/weather/layers/precipitation_forecast/timeline')).json();
  assert.equal(forecastTimeline.selected, 'futureframe');
  assert.equal((await fetch(base + '/weather/layers/precipitation_forecast/futureframe/manifest')).status, 200);
  assert.equal((await fetch(base + '/weather/layers/cloud_cover_daily/latest/image')).status, 404);
  assert.equal((await fetch(base + '/weather/layers/nope/timeline')).status, 404);
  assert.equal((await fetch(base + '/proxy?url=http://example.com')).status, 404);
  assert.equal((await fetch(base + '/vatsim', { method: 'POST' })).status, 405);
});

test('weather layer catalog exposes honest availability and tile metadata', async () => {
  const catalog = weatherLayerCatalog();
  assert.equal(catalog.defaultLayer, 'precipitation_recent');
  const precipitation = catalog.types.find(type => type.id === 'precipitation');
  const clouds = catalog.types.find(type => type.id === 'cloud_cover');
  assert.ok(precipitation.stack > clouds.stack);
  assert.deepEqual(precipitation.providers, ['precipitation_recent', 'precipitation_forecast']);
  assert.equal(catalog.layers.find(layer => layer.id === 'cloud_cover_daily').available, true);
  assert.equal(catalog.layers.find(layer => layer.id === 'precipitation_forecast').available, true);
  const timeline = await weatherLayerTimeline('precipitation_recent', { now: Date.parse('2026-10-20T14:00:00Z'), fetchImpl: weatherLayerFetchStub });
  assert.match(timeline.slices[0].time_quality, /provider_/);
  const manifest = await weatherLayerManifest('precipitation_recent', 'latest', { now: Date.parse('2026-10-20T14:00:00Z'), fetchImpl: weatherLayerFetchStub });
  assert.equal(manifest.retrieved_at, null);
  assert.equal(manifest.manifest_generated_at, '2026-10-20T14:00:00.000Z');
  assert.equal(manifest.stale, null);
  assert.equal(manifest.tile.urlTemplate, '/weather/layers/precipitation_recent/latest/tile/{z}/{x}/{y}.png');
  assert.equal(weatherLayerImageSource('precipitation_recent', 'latest'), null);
  assert.match((await weatherLayerTileSource('precipitation_recent', 'latest', 2, 1, 1, { fetchImpl: weatherLayerFetchStub })).url, /IMERG_Precipitation_Rate_30min\/default\/default\//);
  const forecastTimeline = await weatherLayerTimeline('precipitation_forecast', { fetchImpl: weatherLayerFetchStub });
  assert.equal(forecastTimeline.selected, 'futureframe');
  const forecast = await weatherLayerManifest('precipitation_forecast', 'futureframe', { fetchImpl: weatherLayerFetchStub });
  assert.equal(forecast.data_kind, 'radar_nowcast');
  assert.equal(forecast.tile.maxNativeZoom, 7);
  const radar = await weatherLayerManifest('radar_norway', 'testframe', { fetchImpl: weatherLayerFetchStub });
  assert.equal(radar.tile.maxNativeZoom, 7);
  assert.match((await weatherLayerTileSource('radar_norway', 'testframe', 7, 66, 40, { fetchImpl: weatherLayerFetchStub })).url, /\/256\/7\/66\/40\/2\/1_1\.png$/);
  assert.equal(await weatherLayerTileSource('radar_norway', 'testframe', 8, 132, 80, { fetchImpl: weatherLayerFetchStub }), null);
  assert.equal(effectiveNativeZoom(10, 'radar_observation'), 7);
  assert.deepEqual(coverageZoomLadder(12, 0, 7), [7, 6, 5]);
  const stretchedRadar = coverageTileSample({ z: 9, x: 264, y: 160 }, 7);
  assert.equal(stretchedRadar.z, 7);
  assert.equal(stretchedRadar.sourceSize, 64);
  const notice = new Uint8ClampedArray(256 * 256 * 4);
  for (let index = 0; index < 12000; index += 1) {
    const offset = index * 4;
    notice[offset + 3] = 140;
  }
  assert.equal(isUnsupportedZoomNotice(notice), true);
  assert.equal(isUnsupportedZoomNotice(Uint8ClampedArray.of(0, 80, 220, 255, 0, 0, 0, 0)), false);
  assert.equal(weatherLayerImageSource('cloud_cover_daily', 'latest'), null);
});

test('cloud cover uses the latest complete day and stretches outside native zoom', async () => {
  const now = Date.parse('2026-10-22T08:00:00Z');
  assert.equal(completeDailyTimeToken('2026-10-22T00:00:00Z', now), '2026-10-21');
  assert.equal(completeDailyTimeToken('2026-10-20T00:00:00Z', now), '2026-10-20');
  const fetchImpl = (url) => {
    const date = String(url).match(/\/(\d{4}-\d{2}-\d{2})\//)?.[1];
    const length = date === '2026-10-21' ? '155' : '20000';
    return Promise.resolve(new Response('', { status: 200, headers: { 'content-length': length, 'layer-time-actual': '2026-10-22T00:00:00Z' } }));
  };
  const manifest = await weatherLayerManifest('cloud_cover_daily', 'latest', { now, fetchImpl });
  assert.equal(manifest.time_quality, 'complete_daily_composite');
  assert.equal(manifest.valid_start, '2026-10-20T00:00:00.000Z');
  assert.equal(manifest.valid_end, '2026-10-20T23:59:59.000Z');
  assert.equal(manifest.tile.minNativeZoom, 0);
  assert.equal(manifest.tile.maxNativeZoom, 6);
  const source = await weatherLayerTileSource('cloud_cover_daily', 'latest', '6', '32', '22', { now, fetchImpl });
  assert.match(source.url, /MODIS_Terra_Cloud_Fraction_Day\/default\/2026-10-20\/GoogleMapsCompatible_Level6\/6\/22\/32\.png/);
  assert.equal(await weatherLayerTileSource('cloud_cover_daily', 'latest', 8, 128, 88, { now, fetchImpl }), null);
  const native = coverageTileSample({ z: 6, x: 32, y: 22 }, 6);
  assert.equal(native.x, 32);
  assert.equal(native.y, 22);
  assert.equal(native.sourceSize, 256);
  const stretched = coverageTileSample({ z: 8, x: 129, y: 89 }, 6);
  assert.deepEqual(stretched, { z: 6, x: 32, y: 22, sourceX: 64, sourceY: 64, sourceSize: 64 });
  assert.deepEqual(coverageZoomLadder(8, 0, 6), [6, 5, 4]);
  assert.equal(coverageTileSample({ z: 8, x: 0, y: -1 }, 6), null);
  assert.equal(cloudFractionPercent(102, 0, 119), 0);
  assert.equal(cloudFractionPercent(255, 0, 5), 100);
  const pixels = Uint8ClampedArray.of(102, 0, 119, 255, 255, 0, 5, 255, 0, 220, 0, 255, 0, 0, 0, 0);
  recolorCloudFractionPixels(pixels);
  assert.deepEqual(Array.from(pixels), [255, 255, 255, 96, 36, 38, 42, 255, 146, 147, 149, 176, 0, 0, 0, 0]);
  assert.equal(tileHasVisibleCoverage(Uint8ClampedArray.of(0, 0, 0, 0, 0, 0, 0, 4)), false);
  assert.equal(tileHasVisibleCoverage(Uint8ClampedArray.of(255, 255, 255, 96)), true);
  const left = coverageHatchSegments(0, 0, 256, 40);
  const right = coverageHatchSegments(1, 0, 256, 40);
  assert.ok(left.some(([, y0, x1]) => y0 === 280 && x1 === 280));
  assert.ok(right.some(([, y0, x1]) => y0 === 24 && x1 === 24));
});
