// Sample a native Web Mercator tile so map zooms outside the provider pyramid
// still draw a continuous, approximate picture of that tile.
export function coverageTileSample(coords, zoom, tileSize = 256) {
  const factor = 2 ** (coords.z - zoom);
  if (!Number.isInteger(factor) || factor < 1) return null;
  const world = 2 ** zoom;
  const nativeX = Math.floor(coords.x / factor);
  const nativeY = Math.floor(coords.y / factor);
  if (nativeY < 0 || nativeY >= world) return null;
  const localX = ((coords.x % factor) + factor) % factor;
  const localY = ((coords.y % factor) + factor) % factor;
  return {
    z: zoom,
    x: ((nativeX % world) + world) % world,
    y: nativeY,
    sourceX: localX * (tileSize / factor),
    sourceY: localY * (tileSize / factor),
    sourceSize: tileSize / factor,
  };
}

// Finest native zoom first, then a few coarser zooms if that tile is missing.
export function coverageZoomLadder(mapZoom, minNativeZoom = 0, maxNativeZoom = mapZoom) {
  const start = Math.max(minNativeZoom, Math.min(maxNativeZoom, mapZoom));
  const zooms = [];
  for (let zoom = start; zoom >= minNativeZoom && zooms.length < 3; zoom -= 1) zooms.push(zoom);
  return zooms;
}

// NASA GIBS MODIS cloud-fraction ramp, percent 0 through 100.
// 0% is purple. Bright red is about 95-100%, not clear sky.
const CLOUD_FRACTION_STOPS = [
  [102, 0, 119, 0], [102, 1, 119, 1], [102, 2, 119, 2], [102, 3, 119, 3], [102, 4, 119, 4], [102, 5, 119, 5],
  [183, 15, 141, 6], [183, 16, 141, 7], [183, 17, 141, 8], [183, 18, 141, 9], [183, 19, 141, 10], [183, 20, 141, 11],
  [0, 0, 100, 12], [0, 1, 100, 13], [0, 2, 100, 14], [0, 3, 100, 15], [0, 4, 100, 16], [0, 5, 100, 17], [0, 6, 100, 18],
  [0, 0, 170, 19], [0, 1, 170, 20], [0, 2, 170, 21], [0, 3, 170, 22], [0, 4, 170, 23], [0, 5, 170, 24],
  [0, 0, 255, 25], [0, 1, 255, 26], [0, 2, 255, 27], [0, 3, 255, 28], [0, 4, 255, 29], [0, 5, 255, 30],
  [0, 136, 238, 31], [1, 136, 238, 32], [2, 136, 238, 33], [3, 136, 238, 34], [4, 136, 238, 35], [5, 136, 238, 36], [6, 136, 238, 37],
  [0, 80, 0, 38], [1, 80, 0, 39], [2, 80, 0, 40], [3, 80, 0, 41], [4, 80, 0, 42], [5, 80, 0, 43],
  [0, 136, 0, 44], [1, 136, 0, 45], [2, 136, 0, 46], [3, 136, 0, 47], [4, 136, 0, 48], [5, 136, 0, 49],
  [0, 220, 0, 50], [1, 220, 0, 51], [2, 220, 0, 52], [3, 220, 0, 53], [4, 220, 0, 54], [5, 220, 0, 55], [6, 220, 0, 56],
  [255, 255, 0, 57], [255, 255, 1, 58], [255, 255, 2, 59], [255, 255, 3, 60], [255, 255, 4, 61], [255, 255, 5, 62],
  [240, 190, 64, 63], [240, 190, 65, 64], [240, 190, 66, 65], [240, 190, 67, 66], [240, 190, 68, 67], [240, 190, 69, 68],
  [187, 136, 0, 69], [187, 136, 1, 70], [187, 136, 2, 71], [187, 136, 3, 72], [187, 136, 4, 73], [187, 136, 5, 74], [187, 136, 6, 75],
  [122, 90, 3, 76], [122, 90, 4, 77], [122, 90, 5, 78], [122, 90, 6, 79], [122, 90, 7, 80], [122, 90, 8, 81],
  [110, 0, 0, 82], [110, 0, 1, 83], [110, 0, 2, 84], [110, 0, 3, 85], [110, 0, 4, 86], [110, 0, 5, 87],
  [170, 0, 0, 88], [170, 0, 1, 89], [170, 0, 2, 90], [170, 0, 3, 91], [170, 0, 4, 92], [170, 0, 5, 93], [170, 0, 6, 94],
  [255, 0, 0, 95], [255, 0, 1, 96], [255, 0, 2, 97], [255, 0, 3, 98], [255, 0, 4, 99], [255, 0, 5, 100],
];

const CLOUD_FRACTION_EXACT = new Map(CLOUD_FRACTION_STOPS.map(([r, g, b, percent]) => [(r << 16) | (g << 8) | b, percent]));
let cloudFractionLut = null;

function nearestCloudFraction(r, g, b) {
  if (!cloudFractionLut) {
    cloudFractionLut = new Uint8Array(32 * 32 * 32);
    for (let rq = 0; rq < 32; rq += 1) {
      for (let gq = 0; gq < 32; gq += 1) {
        for (let bq = 0; bq < 32; bq += 1) {
          const rr = rq * 8 + 4;
          const gg = gq * 8 + 4;
          const bb = bq * 8 + 4;
          let best = 0;
          let bestDistance = Infinity;
          for (const [pr, pg, pb, percent] of CLOUD_FRACTION_STOPS) {
            const distance = (rr - pr) ** 2 + (gg - pg) ** 2 + (bb - pb) ** 2;
            if (distance < bestDistance) {
              bestDistance = distance;
              best = percent;
            }
          }
          cloudFractionLut[(rq << 10) | (gq << 5) | bq] = best;
        }
      }
    }
  }
  return cloudFractionLut[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)];
}

export function cloudFractionPercent(r, g, b) {
  return CLOUD_FRACTION_EXACT.get((r << 16) | (g << 8) | b) ?? nearestCloudFraction(r, g, b);
}

// Bright basemaps need the scale inverted: clear sky is a faint white veil so the
// layer stays visible, and cloud cover deepens toward dark grey.
const CLEAR_SKY = [255, 255, 255, 96];
const CLOUD_COVER = [36, 38, 42, 255];

// RainViewer answers zoom 8 and above with one fixed "Zoom Level Not Supported" tile.
export const RAINVIEWER_MAX_NATIVE_ZOOM = 7;

export function effectiveNativeZoom(advertised, dataKind) {
  const cap = dataKind === 'radar_observation' || dataKind === 'radar_nowcast' ? RAINVIEWER_MAX_NATIVE_ZOOM : advertised;
  if (advertised == null) return cap ?? null;
  if (cap == null) return advertised;
  return Math.min(advertised, cap);
}

// The notice is a black plaque and light text. Radar echoes use the provider color scale.
export function isUnsupportedZoomNotice(pixels) {
  let visible = 0;
  let plaque = 0;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] <= 8) continue;
    visible += 1;
    if (pixels[index - 3] < 48 && pixels[index - 2] < 48 && pixels[index - 1] < 48) plaque += 1;
  }
  return visible >= 1000 && plaque / visible >= 0.7;
}

export function tileHasVisibleCoverage(pixels, alphaFloor = 8) {
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] > alphaFloor) return true;
  }
  return false;
}

// Diagonal marks stay aligned across neighboring tiles.
export function coverageHatchSegments(tileX, tileY, tileSize = 256, spacing = 48) {
  const originX = tileX * tileSize;
  const originY = tileY * tileSize;
  const segments = [];
  const last = originX + originY + tileSize * 2;
  for (let sum = Math.ceil((originX + originY) / spacing) * spacing; sum < last; sum += spacing) {
    const local = sum - originX - originY;
    segments.push([0, local, local, 0]);
  }
  return segments;
}

export function recolorCloudFractionPixels(pixels) {
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] === 0) continue;
    const cover = cloudFractionPercent(pixels[index], pixels[index + 1], pixels[index + 2]) / 100;
    const sourceAlpha = pixels[index + 3] / 255;
    pixels[index] = Math.round(CLEAR_SKY[0] + (CLOUD_COVER[0] - CLEAR_SKY[0]) * cover);
    pixels[index + 1] = Math.round(CLEAR_SKY[1] + (CLOUD_COVER[1] - CLEAR_SKY[1]) * cover);
    pixels[index + 2] = Math.round(CLEAR_SKY[2] + (CLOUD_COVER[2] - CLEAR_SKY[2]) * cover);
    pixels[index + 3] = Math.round((CLEAR_SKY[3] + (CLOUD_COVER[3] - CLEAR_SKY[3]) * cover) * sourceAlpha);
  }
}
