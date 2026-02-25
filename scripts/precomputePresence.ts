import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cellToBoundary, latLngToCell } from "h3-js";

type H3Resolution = 5 | 6 | 8;
type PresenceTier = "minimal" | "low" | "moderate" | "notable" | "significant";
type SupportedKind = "synagogue" | "jcc" | "kosher";
type BBox = [number, number, number, number];

type PoiPointFeature = {
  type: "Feature";
  properties?: {
    kind?: unknown;
  };
  geometry?: {
    type?: unknown;
    coordinates?: unknown;
  };
};

type PoiCollection = {
  type?: unknown;
  features?: unknown;
};

type PresenceFeature = {
  type: "Feature";
  bbox: BBox;
  properties: {
    tier: PresenceTier;
    count: number;
    res: H3Resolution;
    cellId: string;
  };
  geometry: {
    type: "Polygon";
    coordinates: number[][][];
  };
};

type PresenceFeatureCollection = {
  type: "FeatureCollection";
  features: PresenceFeature[];
};

const INPUT_PATH = path.join(process.cwd(), "data", "pois.geojson");
const OUTPUT_DIR = path.join(process.cwd(), "data", "presence");
const RESOLUTIONS: H3Resolution[] = [5, 6, 8];
const KINDS = new Set<SupportedKind>(["synagogue", "jcc", "kosher"]);

function isSupportedKind(kind: unknown): kind is SupportedKind {
  return typeof kind === "string" && KINDS.has(kind as SupportedKind);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function tierForCount(count: number): PresenceTier {
  if (count >= 16) return "significant";
  if (count >= 8) return "notable";
  if (count >= 4) return "moderate";
  if (count >= 2) return "low";
  return "minimal";
}

function roundTo(n: number, digits: number) {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

function polygonBBox(ring: number[][]): BBox {
  let minLon = 180;
  let minLat = 90;
  let maxLon = -180;
  let maxLat = -90;

  for (const coord of ring) {
    const lon = coord[0];
    const lat = coord[1];
    if (!isFiniteNumber(lon) || !isFiniteNumber(lat)) continue;
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }

  return [minLon, minLat, maxLon, maxLat];
}

function extractPoints(raw: PoiCollection) {
  if (raw.type !== "FeatureCollection" || !Array.isArray(raw.features)) {
    throw new Error("data/pois.geojson must be a FeatureCollection");
  }

  const points: Array<{ lon: number; lat: number; kind: SupportedKind }> = [];
  for (const item of raw.features) {
    const f = item as PoiPointFeature;
    if (f?.type !== "Feature") continue;
    if (!isSupportedKind(f?.properties?.kind)) continue;
    if (f?.geometry?.type !== "Point") continue;
    if (!Array.isArray(f.geometry.coordinates) || f.geometry.coordinates.length < 2) continue;

    const lon = f.geometry.coordinates[0];
    const lat = f.geometry.coordinates[1];
    if (!isFiniteNumber(lon) || !isFiniteNumber(lat)) continue;

    points.push({ lon, lat, kind: f.properties.kind });
  }

  return points;
}

function buildResolutionFC(
  points: Array<{ lon: number; lat: number; kind: SupportedKind }>,
  res: H3Resolution,
): PresenceFeatureCollection {
  const counts = new Map<string, number>();

  for (const p of points) {
    const cellId = latLngToCell(p.lat, p.lon, res);
    counts.set(cellId, (counts.get(cellId) ?? 0) + 1);
  }

  const features: PresenceFeature[] = [];
  for (const [cellId, count] of counts.entries()) {
    const boundary = cellToBoundary(cellId, true) as Array<[number, number]>;
    if (!Array.isArray(boundary) || boundary.length < 3) continue;

    const ring = boundary.map(([lon, lat]) => [roundTo(lon, 8), roundTo(lat, 8)]);
    ring.push(ring[0]);

    features.push({
      type: "Feature",
      bbox: polygonBBox(ring),
      properties: {
        tier: tierForCount(count),
        count,
        res,
        cellId,
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
  };
}

async function main() {
  const rawText = await readFile(INPUT_PATH, "utf8");
  const rawJson = JSON.parse(rawText) as PoiCollection;
  const points = extractPoints(rawJson);

  if (points.length === 0) {
    throw new Error("No valid Point features with kind in [synagogue, jcc, kosher] were found.");
  }

  await mkdir(OUTPUT_DIR, { recursive: true });

  for (const res of RESOLUTIONS) {
    const fc = buildResolutionFC(points, res);
    const outPath = path.join(OUTPUT_DIR, `res${res}.json`);
    await writeFile(outPath, JSON.stringify(fc));

    console.log(
      `[precompute:presence] res=${res} points=${points.length} cells=${fc.features.length} -> ${outPath}`,
    );
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[precompute:presence] failed: ${message}`);
  process.exitCode = 1;
});
