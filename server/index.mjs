import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { createCache } from './cache.mjs';
import { loadAirspace, loadVatsim, loadWeather } from './providers.mjs';
import { weatherLayerCatalog, weatherLayerImageSource, weatherLayerManifest, weatherLayerTileSource, weatherLayerTimeline } from './weather-layers.mjs';

const WEATHER_SOURCES = new Set(['auto', 'awc', 'cycles', 'vatsim']);

function decodePathPart(value) {
  try { return decodeURIComponent(value); }
  catch { return null; }
}

export function createEnvironmentServer({ loaders = {}, allowedOrigins = [], cacheDir = null } = {}) {
  const diskLoader = (name, loader, maxAge) => async () => {
    let cached;
    if (cacheDir) try { cached = JSON.parse(await readFile(join(cacheDir, `${name}.json`), 'utf8')); } catch { /* First start. */ }
    if (cached && Date.now() - Date.parse(cached.fetchedAt) < maxAge) return cached;
    try {
      const value = await loader();
      if (cacheDir) {
        await mkdir(cacheDir, { recursive: true });
        const file = join(cacheDir, `${name}.json`);
        await writeFile(`${file}.tmp`, JSON.stringify(value)); await rename(`${file}.tmp`, file);
      }
      return value;
    } catch (error) { if (cached && name === 'airspace') return cached; throw error; }
  };
  const caches = {
    vatsim: createCache(loaders.vatsim || loadVatsim, 30000),
    weather: {
      auto: createCache(loaders.weather || (() => loadWeather('auto')), 120000),
      awc: createCache(loaders.weatherAwc || (() => loadWeather('awc')), 120000),
      cycles: createCache(loaders.weatherCycles || (() => loadWeather('cycles')), 120000),
      vatsim: createCache(loaders.weatherVatsim || (() => loadWeather('vatsim')), 120000),
    },
    airspace: createCache(diskLoader('airspace', loaders.airspace || loadAirspace, 86400000), 86400000),
  };
  const weatherLayerFetch = loaders.weatherLayerFetch || fetch;
  const paths = { '/vatsim': 'vatsim', '/boundaries': 'airspace' };
  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    res.setHeader('Vary', 'Origin, Accept-Encoding');
    if (origin && allowedOrigins.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, OPTIONS' }); return res.end(); }
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.replace(/^\/api\/environment\/v1/, '');
    try {
      let value;
      if (path === '/health') value = {
        vatsim: caches.vatsim.status(),
        weather: Object.fromEntries(Object.entries(caches.weather).map(([k, v]) => [k, v.status()])),
        airspace: caches.airspace.status(),
      };
      else if (path === '/boundaries/manifest') {
        const { version, sources, checksum, approachAvailable } = await caches.airspace.get();
        value = { version, sources, checksum, approachAvailable };
      } else if (path === '/weather/snapshot') {
        const source = url.searchParams.get('source') || 'auto';
        if (!WEATHER_SOURCES.has(source)) { res.writeHead(400); return res.end(); }
        value = await caches.weather[source].get();
      } else if (path === '/weather/layers') {
        value = weatherLayerCatalog();
      } else {
        const timelineMatch = path.match(/^\/weather\/layers\/([^/]+)\/timeline$/);
        const manifestMatch = path.match(/^\/weather\/layers\/([^/]+)\/([^/]+)\/manifest$/);
        const imageMatch = path.match(/^\/weather\/layers\/([^/]+)\/([^/]+)\/image$/);
        const tileMatch = path.match(/^\/weather\/layers\/([^/]+)\/([^/]+)\/tile\/(\d+)\/(\d+)\/(\d+)\.png$/);
        if (timelineMatch) {
          const layerId = decodePathPart(timelineMatch[1]);
          if (!layerId) { res.writeHead(400); return res.end(); }
          value = await weatherLayerTimeline(layerId, { fetchImpl: weatherLayerFetch });
          if (!value) { res.writeHead(404); return res.end(); }
        } else if (manifestMatch) {
          const layerId = decodePathPart(manifestMatch[1]);
          const sliceId = decodePathPart(manifestMatch[2]);
          if (!layerId || !sliceId) { res.writeHead(400); return res.end(); }
          value = await weatherLayerManifest(layerId, sliceId, { fetchImpl: weatherLayerFetch });
          if (!value) { res.writeHead(404); return res.end(); }
        } else if (imageMatch) {
          const layerId = decodePathPart(imageMatch[1]);
          const sliceId = decodePathPart(imageMatch[2]);
          if (!layerId || !sliceId) { res.writeHead(400); return res.end(); }
          const source = weatherLayerImageSource(layerId, sliceId);
          if (!source) { res.writeHead(404); return res.end(); }
          const upstream = await weatherLayerFetch(source.url, { signal: AbortSignal.timeout(15000) });
          if (!upstream.ok) throw new Error(`Weather layer image HTTP ${upstream.status}`);
          const contentType = upstream.headers.get('content-type') || source.contentType;
          const body = Buffer.from(await upstream.arrayBuffer());
          res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=300',
            'Content-Length': body.length,
          });
          return res.end(body);
        } else if (tileMatch) {
          const layerId = decodePathPart(tileMatch[1]);
          const sliceId = decodePathPart(tileMatch[2]);
          if (!layerId || !sliceId) { res.writeHead(400); return res.end(); }
          const source = await weatherLayerTileSource(layerId, sliceId, tileMatch[3], tileMatch[4], tileMatch[5], { fetchImpl: weatherLayerFetch });
          if (!source?.url) { res.writeHead(404); return res.end(); }
          const upstream = await weatherLayerFetch(source.url, { signal: AbortSignal.timeout(15000) });
          if (!upstream.ok) throw new Error(`Weather layer tile HTTP ${upstream.status}`);
          const contentType = upstream.headers.get('content-type') || source.contentType;
          const body = Buffer.from(await upstream.arrayBuffer());
          res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=300',
            'Content-Length': body.length,
          });
          return res.end(body);
        } else if (paths[path]) value = await caches[paths[path]].get();
        else { res.writeHead(404); return res.end(); }
      }
      const body = JSON.stringify(value);
      const etag = `"${createHash('sha256').update(body).digest('hex').slice(0, 24)}"`;
      res.setHeader('ETag', etag); res.setHeader('Cache-Control', 'no-cache');
      if (req.headers['if-none-match'] === etag) { res.writeHead(304); return res.end(); }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) { res.setHeader('Content-Encoding', 'gzip'); res.end(gzipSync(body)); }
      else res.end(body);
    } catch (error) {
      res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': '30' });
      res.end(JSON.stringify({ error: 'Environment data unavailable', detail: process.env.NODE_ENV === 'development' ? error.message : 'Try again later' }));
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const origins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000').split(',').map(s => s.trim()).filter(Boolean);
  const server = createEnvironmentServer({ allowedOrigins: origins, cacheDir: fileURLToPath(new URL('./cache', import.meta.url)) });
  server.listen(Number(process.env.PORT) || 8787, process.env.HOST || '127.0.0.1', () => console.log('Environment API listening on port', server.address().port));
}
