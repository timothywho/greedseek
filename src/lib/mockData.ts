import type { FeatureCollection, Feature, Point, Polygon } from "geojson";

export type LayerMode = "presence";

export type InstitutionTypeKey =
  | "synagogue"
  | "jcc"
  | "kosher"
  | "school"
  | "mikveh"
  | "camp";

export type InstitutionProps = {
  type: InstitutionTypeKey;
};

export type InstitutionFeature = Feature<Point, InstitutionProps>;

export const INSTITUTION_TYPES = [
  { key: "synagogue", label: "Synagogue", sensitive: false },
  { key: "jcc", label: "JCC", sensitive: false },
  { key: "kosher", label: "Kosher", sensitive: false },
  { key: "school", label: "School", sensitive: true },
  { key: "mikveh", label: "Mikveh", sensitive: true },
  { key: "camp", label: "Camp", sensitive: true },
] as const;

export const DEFAULT_VISIBLE_TYPES: InstitutionTypeKey[] = [
  "synagogue",
  "jcc",
  "kosher",
];

// A handful of points close together so clustering + k-anon works in dev.
export const INSTITUTIONS: FeatureCollection<Point, InstitutionProps> = {
  type: "FeatureCollection",
  features: [
    // NYC-ish cluster (>=3)
    {
      type: "Feature",
      properties: { type: "synagogue" },
      geometry: { type: "Point", coordinates: [-73.9857, 40.7484] },
    },
    {
      type: "Feature",
      properties: { type: "synagogue" },
      geometry: { type: "Point", coordinates: [-73.9862, 40.7491] },
    },
    {
      type: "Feature",
      properties: { type: "jcc" },
      geometry: { type: "Point", coordinates: [-73.9849, 40.7479] },
    },
    {
      type: "Feature",
      properties: { type: "kosher" },
      geometry: { type: "Point", coordinates: [-73.987, 40.7488] },
    },

    // LA-ish cluster (>=3)
    {
      type: "Feature",
      properties: { type: "synagogue" },
      geometry: { type: "Point", coordinates: [-118.2437, 34.0522] },
    },
    {
      type: "Feature",
      properties: { type: "jcc" },
      geometry: { type: "Point", coordinates: [-118.2443, 34.0527] },
    },
    {
      type: "Feature",
      properties: { type: "kosher" },
      geometry: { type: "Point", coordinates: [-118.2429, 34.0517] },
    },

    // Sensitive types (default OFF) — placed near NYC cluster
    {
      type: "Feature",
      properties: { type: "school" },
      geometry: { type: "Point", coordinates: [-73.9868, 40.748] },
    },
    {
      type: "Feature",
      properties: { type: "mikveh" },
      geometry: { type: "Point", coordinates: [-73.9852, 40.749] },
    },
    {
      type: "Feature",
      properties: { type: "camp" },
      geometry: { type: "Point", coordinates: [-73.9848, 40.7486] },
    },
  ],
};

export type PresenceTier =
  | "minimal"
  | "low"
  | "moderate"
  | "notable"
  | "significant";

/**
 * ✅ Slight translucency via RGBA (keep this)
 * ✅ Significant red: #E7000B
 */
export const PRESENCE_TIER_STOPS = [
  { tier: "minimal", label: "Minimal", color: "rgba(34,197,94,0.75)" },
  { tier: "low", label: "Low", color: "rgba(163,230,53,0.75)" },
  { tier: "moderate", label: "Moderate", color: "rgba(250,204,21,0.75)" },
  { tier: "notable", label: "Notable", color: "rgba(124,58,237,0.75)" },
  { tier: "significant", label: "Significant", color: "rgba(231,0,11,0.78)" }, // #E7000B
] as const;

/** ---------- Presence: realistic metro-shaped hex tiers ---------- */

function degToRad(d: number) {
  return (d * Math.PI) / 180;
}

function approxDistDeg(
  lon: number,
  lat: number,
  lon0: number,
  lat0: number,
  cosRef: number
) {
  const x = (lon - lon0) * cosRef;
  const y = lat - lat0;
  return Math.sqrt(x * x + y * y);
}

type Kernel = {
  name: string;
  center: [number, number]; // [lon, lat]
  sigmaDeg: number;
  weight: number;
};

const REF_LAT = 37.0;
const COS_REF = Math.cos(degToRad(REF_LAT));

const KERNELS: Kernel[] = [
  { name: "NYC", center: [-74.0, 40.72], sigmaDeg: 1.15, weight: 1.55 },
  { name: "LongIsland", center: [-73.1, 40.75], sigmaDeg: 0.85, weight: 0.75 },
  { name: "NorthNJ", center: [-74.2, 40.85], sigmaDeg: 0.95, weight: 0.7 },
  { name: "Philly", center: [-75.16, 39.95], sigmaDeg: 1.0, weight: 0.95 },
  { name: "DC", center: [-77.03, 38.9], sigmaDeg: 0.9, weight: 0.8 },
  { name: "Boston", center: [-71.06, 42.36], sigmaDeg: 0.85, weight: 0.7 },
  { name: "Miami", center: [-80.19, 25.76], sigmaDeg: 1.0, weight: 0.65 },
  { name: "Atlanta", center: [-84.39, 33.75], sigmaDeg: 0.95, weight: 0.55 },

  { name: "Chicago", center: [-87.63, 41.88], sigmaDeg: 1.05, weight: 0.7 },
  { name: "Detroit", center: [-83.05, 42.33], sigmaDeg: 0.85, weight: 0.45 },
  { name: "Cleveland", center: [-81.69, 41.5], sigmaDeg: 0.8, weight: 0.35 },

  { name: "LA", center: [-118.24, 34.05], sigmaDeg: 1.25, weight: 0.95 },
  { name: "SF Bay", center: [-122.42, 37.77], sigmaDeg: 1.1, weight: 0.75 },
  { name: "SanDiego", center: [-117.16, 32.72], sigmaDeg: 0.9, weight: 0.4 },
  { name: "Seattle", center: [-122.33, 47.61], sigmaDeg: 0.95, weight: 0.35 },
  { name: "Denver", center: [-104.99, 39.74], sigmaDeg: 0.9, weight: 0.3 },

  { name: "Houston", center: [-95.37, 29.76], sigmaDeg: 1.05, weight: 0.4 },
  { name: "Dallas", center: [-96.8, 32.78], sigmaDeg: 0.95, weight: 0.35 },
  { name: "Phoenix", center: [-112.07, 33.45], sigmaDeg: 0.95, weight: 0.3 },
];

/**
 * ✅ Slightly larger hexes (per your request)
 * Old was ~0.082. This is bigger like your reference.
 */
const HEX_R_LAT_DEG = 0.094;

const CONUS_WINDOW = {
  minLon: -125.2,
  maxLon: -66.3,
  minLat: 24.0,
  maxLat: 49.8,
};

function hash01(a: number, b: number) {
  let x = (a * 374761393 + b * 668265263) | 0;
  x = (x ^ (x >>> 13)) | 0;
  x = (x * 1274126177) | 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967295;
}

/**
 * ✅ Perfect tiling math (no “gap” geometry)
 * - We compute rLon from cos(lat)
 * - The grid step uses the same radii as the ring
 */
function hexRing(lon: number, lat: number, rLatDeg: number) {
  const cos = Math.max(0.25, Math.cos(degToRad(lat)));
  const rLat = rLatDeg;
  const rLon = rLatDeg / cos;

  const coords: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const angle = degToRad(60 * i - 30); // pointy-top
    coords.push([lon + rLon * Math.cos(angle), lat + rLat * Math.sin(angle)]);
  }
  coords.push(coords[0]);
  return coords;
}

function kernelValue(lon: number, lat: number) {
  let v = 0;
  for (const k of KERNELS) {
    const d = approxDistDeg(lon, lat, k.center[0], k.center[1], COS_REF);
    const s = k.sigmaDeg;
    v += k.weight * Math.exp(-(d * d) / (2 * s * s));
  }
  return v;
}

function tierFromNorm(x: number): PresenceTier | null {
  if (x < 0.075) return null;
  if (x < 0.18) return "minimal";
  if (x < 0.3) return "low";
  if (x < 0.44) return "moderate";
  if (x < 0.62) return "notable";
  return "significant";
}

function generatePresenceHexes(): FeatureCollection<
  Polygon,
  { tier: PresenceTier }
> {
  const latStep = Math.sqrt(3) * HEX_R_LAT_DEG;

  const features: Array<Feature<Polygon, { tier: PresenceTier }>> = [];

  // Pass 1: max value for normalization
  let vmax = 0;
  let row = 0;

  for (
    let lat = CONUS_WINDOW.minLat;
    lat <= CONUS_WINDOW.maxLat;
    lat += latStep, row++
  ) {
    const cos = Math.max(0.25, Math.cos(degToRad(lat)));
    const rLon = HEX_R_LAT_DEG / cos;
    const lonStep = 1.5 * rLon;
    const lonOffset = (row % 2) * (lonStep / 2);

    for (
      let lon = CONUS_WINDOW.minLon + lonOffset;
      lon <= CONUS_WINDOW.maxLon;
      lon += lonStep
    ) {
      const v = kernelValue(lon, lat);
      if (v > vmax) vmax = v;
    }
  }

  vmax = Math.max(vmax, 1e-6);

  // Pass 2: build features
  row = 0;
  for (
    let lat = CONUS_WINDOW.minLat;
    lat <= CONUS_WINDOW.maxLat;
    lat += latStep, row++
  ) {
    const cos = Math.max(0.25, Math.cos(degToRad(lat)));
    const rLon = HEX_R_LAT_DEG / cos;
    const lonStep = 1.5 * rLon;
    const lonOffset = (row % 2) * (lonStep / 2);

    let col = 0;
    for (
      let lon = CONUS_WINDOW.minLon + lonOffset;
      lon <= CONUS_WINDOW.maxLon;
      lon += lonStep, col++
    ) {
      let x = kernelValue(lon, lat) / vmax;

      // organic variation
      const n = hash01(row, col);
      x *= 0.92 + 0.16 * (n - 0.5);

      const tier = tierFromNorm(x);
      if (!tier) continue;

      // dropout for speckle
      const d = hash01(row + 999, col - 777);
      if (tier === "minimal" && d < 0.12) continue;
      if (tier === "low" && d < 0.07) continue;

      features.push({
        type: "Feature",
        properties: { tier },
        geometry: {
          type: "Polygon",
          coordinates: [hexRing(lon, lat, HEX_R_LAT_DEG)],
        },
      });

      if (features.length > 18000) break;
    }

    if (features.length > 18000) break;
  }

  return { type: "FeatureCollection", features };
}

export const PRESENCE_AREAS: FeatureCollection<
  Polygon,
  { tier: PresenceTier }
> = generatePresenceHexes();
