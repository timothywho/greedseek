import type { PresenceTier } from "@/lib/mockData";

export type H3Resolution = 5 | 6 | 8;
export type BBox = [number, number, number, number];

type Point = [number, number];

const R = 6378137;
const HEX_COVERAGE = 1.0;
const VTX_DECIMALS = 8;

type CellBucket = {
  row: number;
  col: number;
  count: number;
};

type HexFeature = {
  type: "Feature";
  properties: {
    tier: PresenceTier;
    cellId: string;
    count: number;
  };
  geometry: {
    type: "Polygon";
    coordinates: [Array<[number, number]>];
  };
};

export type HexFeatureCollection = {
  type: "FeatureCollection";
  features: HexFeature[];
};

type OverpassElement = {
  lon?: number;
  lat?: number;
  center?: {
    lon?: number;
    lat?: number;
  };
};

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function lonLatToMercator(lon: number, lat: number) {
  const x = (lon * Math.PI * R) / 180;
  const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * R;
  return { x, y };
}

export function mercatorToLonLat(x: number, y: number) {
  const lon = (x * 180) / (Math.PI * R);
  const lat = (Math.atan(Math.exp(y / R)) * 360) / Math.PI - 90;
  return { lon, lat };
}

function roundTo(n: number, d: number) {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

export function radiusMetersForResolution(resolution: H3Resolution) {
  switch (resolution) {
    case 5:
      return 23000;
    case 6:
      return 11000;
    case 8:
      return 2200;
  }
}

export function makeHexRingMercator(cx: number, cy: number, radiusM: number) {
  const r = radiusM * HEX_COVERAGE;
  const pts: [number, number][] = [];

  for (let k = 0; k < 6; k++) {
    const ang = ((30 + 60 * k) * Math.PI) / 180; // flat-top
    const x = cx + r * Math.cos(ang);
    const y = cy + r * Math.sin(ang);
    const { lon, lat } = mercatorToLonLat(x, y);
    pts.push([roundTo(lon, VTX_DECIMALS), roundTo(lat, VTX_DECIMALS)]);
  }

  pts.push(pts[0]);
  return pts;
}

function tierForCount(count: number): PresenceTier {
  if (count >= 16) return "significant";
  if (count >= 8) return "notable";
  if (count >= 4) return "moderate";
  if (count >= 2) return "low";
  return "minimal";
}

function minCountForResolution(resolution: H3Resolution) {
  if (resolution === 8) return 2;
  if (resolution === 6) return 2;
  return 1;
}

export function overpassElementsToPoints(elements: unknown[]): Point[] {
  const points: Point[] = [];

  for (const rawElement of elements) {
    const el = rawElement as OverpassElement;
    const lon =
      typeof el?.lon === "number"
        ? el.lon
        : typeof el?.center?.lon === "number"
          ? el.center.lon
          : null;
    const lat =
      typeof el?.lat === "number"
        ? el.lat
        : typeof el?.center?.lat === "number"
          ? el.center.lat
          : null;

    if (lon == null || lat == null) continue;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    points.push([lon, lat]);
  }

  return points;
}

export function aggregatePointsToHexFC(points: Point[], resolution: H3Resolution) {
  const radiusM = radiusMetersForResolution(resolution);
  const stepX = Math.sqrt(3) * radiusM;
  const stepY = 1.5 * radiusM;
  const offsetX = stepX / 2;

  const cells = new Map<string, CellBucket>();

  for (const [lon, lat] of points) {
    const { x, y } = lonLatToMercator(lon, lat);
    const row = Math.round(y / stepY);
    const xRowOffset = row % 2 === 0 ? 0 : offsetX;
    const col = Math.round((x - xRowOffset) / stepX);
    const cellId = `${resolution}:${row}:${col}`;

    const prev = cells.get(cellId);
    if (prev) {
      prev.count += 1;
    } else {
      cells.set(cellId, { row, col, count: 1 });
    }
  }

  const minCount = minCountForResolution(resolution);
  const features: HexFeature[] = [];

  for (const [cellId, cell] of cells.entries()) {
    if (cell.count < minCount) continue;

    const xRowOffset = cell.row % 2 === 0 ? 0 : offsetX;
    const cx = cell.col * stepX + xRowOffset;
    const cy = cell.row * stepY;
    const ring = makeHexRingMercator(cx, cy, radiusM);
    const tier = tierForCount(cell.count);

    features.push({
      type: "Feature",
      properties: {
        tier,
        cellId,
        count: cell.count,
      },
      geometry: {
        type: "Polygon",
        coordinates: [ring],
      },
    });
  }

  return {
    type: "FeatureCollection",
    features,
  } as HexFeatureCollection;
}
