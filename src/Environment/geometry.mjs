const RAD = Math.PI / 180;
export const wrapLon = lon => ((lon + 180) % 360 + 360) % 360 - 180;
const near = (lon, origin) => origin + wrapLon(lon - origin);
export function distanceNm(a, b) {
  const dlat = (b[1] - a[1]) * RAD, dlon = (b[0] - a[0]) * RAD;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dlon / 2) ** 2;
  return 3440.065 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, h))));
}
export function greatCircle(a, b, stepNm = 5) {
  const total = distanceNm(a, b), steps = Math.max(1, Math.ceil(total / stepNm));
  const vector = p => [Math.cos(p[1] * RAD) * Math.cos(p[0] * RAD), Math.cos(p[1] * RAD) * Math.sin(p[0] * RAD), Math.sin(p[1] * RAD)];
  const u = vector(a), v = vector(b), angle = total / 3440.065, sine = Math.sin(angle);
  // Near-antipodal paths have no unique direct track; leave these unevaluable.
  if (angle > Math.PI - 1e-6) return null;
  return Array.from({ length: steps + 1 }, (_, i) => {
    if (i === 0) return [wrapLon(a[0]), a[1]];
    if (i === steps) return [wrapLon(b[0]), b[1]];
    if (angle < 1e-10) return [wrapLon(a[0]), a[1]];
    const t = i / steps, x = u.map((n, k) => (n * Math.sin((1 - t) * angle) + v[k] * Math.sin(t * angle)) / sine);
    return [Math.atan2(x[1], x[0]) / RAD, Math.atan2(x[2], Math.hypot(x[0], x[1])) / RAD];
  });
}
function ringAt(ring, origin) {
  if (!ring.length) return [];
  const result = [[near(ring[0][0], origin), ring[0][1]]];
  for (let i = 1; i < ring.length; i++) result.push([near(ring[i][0], result[i - 1][0]), ring[i][1]]);
  const center = result.reduce((s, p) => s + p[0], 0) / result.length;
  const shift = Math.round((origin - center) / 360) * 360;
  return result.map(p => [p[0] + shift, p[1]]);
}
const polygons = geometry => geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
const prepared = new WeakMap();
function geometryPolygons(geometry) {
  if (!prepared.has(geometry)) prepared.set(geometry, polygons(geometry).map(poly => {
    const rings = poly.map(r => ringAt(r, poly[0][0][0]));
    const bounds = rings[0].reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
    return { rings, bounds };
  }));
  return prepared.get(geometry);
}
function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    const cross = (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0]);
    if (Math.abs(cross) < 1e-10 && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1])) return true;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function containsPoint(geometry, point) {
  return polygons(geometry).some(poly => inRing(point, ringAt(poly[0], point[0])) && !poly.slice(1).some(r => inRing(point, ringAt(r, point[0]))));
}
function crossing(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const cross = (u, v) => u[0] * v[1] - u[1] * v[0];
  const denom = cross(r, s);
  if (Math.abs(denom) < 1e-14) return null;
  const q = [c[0] - a[0], c[1] - a[1]], t = cross(q, s) / denom, u = cross(q, r) / denom;
  return t > 0 && t < 1 && u >= 0 && u <= 1 ? t : null;
}

/** Intersect every densified chord with polygon rings; never infer full coverage from point sampling. */
export function legCoverage(a, b, sectors) {
  const path = greatCircle(a, b);
  if (!path) return { totalNm: distanceNm(a, b), coveredNm: 0, longestGapNm: distanceNm(a, b), unknown: true, segments: [] };
  const segments = [];
  let totalNm = 0, coveredNm = 0, gap = 0, longestGapNm = 0;
  for (let n = 1; n < path.length; n++) {
    const start = path[n - 1], end = [near(path[n][0], start[0]), path[n][1]];
    const cuts = [0, 1], candidates = [];
    for (const sector of sectors) {
      const relevant = [];
      for (const { rings, bounds } of geometryPolygons(sector.geometry)) {
        const shift = Math.round((start[0] - (bounds[0] + bounds[2]) / 2) / 360) * 360;
        if (bounds[2] + shift < Math.min(start[0], end[0]) || bounds[0] + shift > Math.max(start[0], end[0]) || bounds[3] < Math.min(start[1], end[1]) || bounds[1] > Math.max(start[1], end[1])) continue;
        relevant.push(shift ? rings.map(r => r.map(p => [p[0] + shift, p[1]])) : rings);
      }
      if (!relevant.length) continue;
      candidates.push({ sector, polys: relevant });
      for (const poly of relevant) for (const ring of poly) for (let i = 1; i < ring.length; i++) {
        const t = crossing(start, end, ring[i - 1], ring[i]);
        if (t !== null) cuts.push(t);
      }
    }
    cuts.sort((x, y) => x - y);
    const at = t => [start[0] + t * (end[0] - start[0]), start[1] + t * (end[1] - start[1])];
    for (let i = 1; i < cuts.length; i++) {
      if (cuts[i] - cuts[i - 1] < 1e-12) continue;
      const mid = at((cuts[i] + cuts[i - 1]) / 2);
      const matches = candidates.filter(({ polys }) => polys.some(poly => inRing(mid, poly[0]) && !poly.slice(1).some(r => inRing(mid, r))));
      const from = at(cuts[i - 1]), to = at(cuts[i]), length = distanceNm(from, to), covered = matches.length > 0;
      totalNm += length;
      if (covered) { coveredNm += length; gap = 0; } else { gap += length; longestGapNm = Math.max(longestGapNm, gap); }
      segments.push({ from, to, covered, callsigns: [...new Set(matches.flatMap(m => m.sector.callsigns || []))] });
    }
  }
  return { totalNm, coveredNm, longestGapNm, unknown: false, segments };
}
