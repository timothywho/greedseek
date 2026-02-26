"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { cellToBoundary, gridDisk, latLngToCell } from "h3-js";
import * as h3 from "h3-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapView, {
  Layer,
  NavigationControl,
  Popup,
  Source,
  type LayerProps,
  type MapRef,
} from "react-map-gl/maplibre";


import type { PresenceTier } from "@/lib/mockData";
import { PRESENCE_AREAS } from "@/lib/mockData";

type BBox = [number, number, number, number];

const COLORS = {
  background: "#2C353C",
  country: "#0E0E0E",
  countryBorder: "#2C353C",
  stateBorder: "#2E383F",
  roads: "#1F1F1F",
  rivers: "#3F5A6D",
  usLabel: "#AEB7BF",

  dotSynagogue: "#3B82F6",
  dotJcc: "#A855F7",
  dotKosher: "#F59E0B",
  dotMikveh: "#14B8A6",
  dotJewishSchool: "#22C55E",
  dotJewishCamp: "#EC4899",

  // significant
  significantRed: "#E7000B",
};

const HEX_BORDER_COLOR = "rgba(255,255,255,0.55)";
const HEX_BORDER_WIDTH_PX = 0.5;

// MUST be exactly 1.0
const HEX_COVERAGE = 1.0;

// Higher precision = better edge matching
const VTX_DECIMALS = 8;

const EMPTY_FC: any = { type: "FeatureCollection", features: [] };
const MAX_SPARSE_HEX_CELLS = 120000;

let poisDataCache: any | null = null;
let poisDataPromise: Promise<any> | null = null;

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

// GeoJSONs
const USA_GEOJSON_URL = "/data/geo/usa.geojson";
const CAN_GEOJSON_URL = "/data/geo/canada.geojson";
const MEX_GEOJSON_URL = "/data/geo/mexico.geojson";
const USA_STATES_GEOJSON_URL = "/data/geo/usa-states.geojson";
const OMT_VECTOR_SOURCE = { url: "https://tiles.openfreemap.org/planet" };

// Absolute fetch allowlist (edit here when adding approved basemap/tile providers).
const FETCH_ABSOLUTE_ALLOWLIST = ["https://tiles.openfreemap.org"];

// Fit to CONUS
const CONUS_FIT_BOUNDS: [[number, number], [number, number]] = [
  [-125.2, 24.0],
  [-66.3, 49.8],
];

const REGION_MAX_BOUNDS: [[number, number], [number, number]] = [
  [-135.0, 18.0],
  [-55.0, 57.0],
];
const DEFAULT_VIEW = { longitude: -98.5, latitude: 39.5, zoom: 3.4 };

type PoiKind =
  | "synagogue"
  | "jcc"
  | "kosher"
  | "mikveh"
  | "jewish_school"
  | "jewish_camp";
const POI_SOURCE_ID = "pois";
const POI_DOTS_LAYER_ID = "poi-dots";
const PRESENCE_HEX_FILL_LAYER_ID = "presence-hex-fill";
const PRESENCE_HEX_SELECTED_SOURCE_ID = "presence-hex-selected";
const PRESENCE_HEX_SELECTED_LAYER_ID = "presence-hex-selected-outline";
const ALL_POI_KINDS: PoiKind[] = [
  "synagogue",
  "jcc",
  "kosher",
  "mikveh",
  "jewish_school",
  "jewish_camp",
];
const KIND_LABEL: Record<string, string> = {
  synagogue: "Synagogue",
  jcc: "JCC",
  kosher: "Kosher",
  mikveh: "Mikveh",
  jewish_school: "Jewish School",
  jewish_camp: "Jewish Camp",
};
const kindLabel = (k?: string) =>
  k && KIND_LABEL[k]
    ? KIND_LABEL[k]
    : k
    ? k.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())
    : "Unknown";
const POI_KIND_LABEL: Record<PoiKind, string> = {
  synagogue: KIND_LABEL.synagogue,
  jcc: KIND_LABEL.jcc,
  kosher: KIND_LABEL.kosher,
  mikveh: KIND_LABEL.mikveh,
  jewish_school: KIND_LABEL.jewish_school,
  jewish_camp: KIND_LABEL.jewish_camp,
};
const POI_KIND_COLOR: Record<PoiKind, string> = {
  synagogue: COLORS.dotSynagogue,
  jcc: COLORS.dotJcc,
  kosher: COLORS.dotKosher,
  mikveh: COLORS.dotMikveh,
  jewish_school: COLORS.dotJewishSchool,
  jewish_camp: COLORS.dotJewishCamp,
};
const POI_ESTIMATE_WEIGHT: Record<PoiKind, number> = {
  synagogue: 250,
  jcc: 150,
  kosher: 40,
  mikveh: 80,
  jewish_school: 200,
  jewish_camp: 300,
};
const GREED_MAX_BY_RES: Record<number, number> = {
  5: 2500,
  6: 900,
  8: 300,
};
const HEX_LEVEL_BINS = [
  { min: 0, max: 19, color: "#22C55E", label: "Low" },
  { min: 20, max: 39, color: "#A3E635", label: "Moderate" },
  { min: 40, max: 59, color: "#FACC15", label: "Elevated" },
  { min: 60, max: 79, color: "#FB923C", label: "High" },
  { min: 80, max: 100, color: "#EF4444", label: "Very High" },
] as const;

function greedLevelFromEstimated(estimated: number, res: number) {
  const max = GREED_MAX_BY_RES[res] ?? 1000;
  const v = Math.round((Math.max(0, estimated) / max) * 100);
  return clamp(v, 0, 100);
}

function greedBinForLevel(level: number) {
  for (let i = HEX_LEVEL_BINS.length - 1; i >= 0; i--) {
    const bin = HEX_LEVEL_BINS[i];
    if (level >= bin.min) return bin;
  }
  return HEX_LEVEL_BINS[0];
}

const US_LABEL_POINT = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { name: "UNITED STATES" },
      geometry: { type: "Point", coordinates: [-98.5, 39.5] },
    },
  ],
} as const;

const CITY_LABEL_POINTS = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { name: "New York", kind: "city" }, geometry: { type: "Point", coordinates: [-74.006, 40.7128] } },
    { type: "Feature", properties: { name: "Los Angeles", kind: "city" }, geometry: { type: "Point", coordinates: [-118.2437, 34.0522] } },
    { type: "Feature", properties: { name: "Chicago", kind: "city" }, geometry: { type: "Point", coordinates: [-87.6298, 41.8781] } },
    { type: "Feature", properties: { name: "Houston", kind: "city" }, geometry: { type: "Point", coordinates: [-95.3698, 29.7604] } },
    { type: "Feature", properties: { name: "Phoenix", kind: "city" }, geometry: { type: "Point", coordinates: [-112.074, 33.4484] } },
    { type: "Feature", properties: { name: "Philadelphia", kind: "city" }, geometry: { type: "Point", coordinates: [-75.1652, 39.9526] } },
    { type: "Feature", properties: { name: "San Antonio", kind: "city" }, geometry: { type: "Point", coordinates: [-98.4936, 29.4241] } },
    { type: "Feature", properties: { name: "San Diego", kind: "city" }, geometry: { type: "Point", coordinates: [-117.1611, 32.7157] } },
    { type: "Feature", properties: { name: "Dallas", kind: "city" }, geometry: { type: "Point", coordinates: [-96.797, 32.7767] } },
    { type: "Feature", properties: { name: "San Jose", kind: "city" }, geometry: { type: "Point", coordinates: [-121.8863, 37.3382] } },
    { type: "Feature", properties: { name: "Miami", kind: "city" }, geometry: { type: "Point", coordinates: [-80.1918, 25.7617] } },
    { type: "Feature", properties: { name: "Atlanta", kind: "city" }, geometry: { type: "Point", coordinates: [-84.388, 33.749] } },
    { type: "Feature", properties: { name: "Seattle", kind: "city" }, geometry: { type: "Point", coordinates: [-122.3321, 47.6062] } },
    { type: "Feature", properties: { name: "Denver", kind: "city" }, geometry: { type: "Point", coordinates: [-104.9903, 39.7392] } },
    { type: "Feature", properties: { name: "Boston", kind: "city" }, geometry: { type: "Point", coordinates: [-71.0589, 42.3601] } },
    { type: "Feature", properties: { name: "Washington DC", kind: "city" }, geometry: { type: "Point", coordinates: [-77.0369, 38.9072] } },
  ],
} as const;

const TOWN_LABEL_POINTS = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { name: "Newark", kind: "town" }, geometry: { type: "Point", coordinates: [-74.1724, 40.7357] } },
    { type: "Feature", properties: { name: "Jersey City", kind: "town" }, geometry: { type: "Point", coordinates: [-74.0776, 40.7282] } },
    { type: "Feature", properties: { name: "Yonkers", kind: "town" }, geometry: { type: "Point", coordinates: [-73.8988, 40.9312] } },
    { type: "Feature", properties: { name: "White Plains", kind: "town" }, geometry: { type: "Point", coordinates: [-73.7629, 41.0330] } },
    { type: "Feature", properties: { name: "Stamford", kind: "town" }, geometry: { type: "Point", coordinates: [-73.5387, 41.0534] } },
    { type: "Feature", properties: { name: "New Haven", kind: "town" }, geometry: { type: "Point", coordinates: [-72.9279, 41.3083] } },
    { type: "Feature", properties: { name: "Providence", kind: "town" }, geometry: { type: "Point", coordinates: [-71.4128, 41.8240] } },
    { type: "Feature", properties: { name: "Worcester", kind: "town" }, geometry: { type: "Point", coordinates: [-71.8023, 42.2626] } },
    { type: "Feature", properties: { name: "Cambridge (MA)", kind: "town" }, geometry: { type: "Point", coordinates: [-71.1097, 42.3736] } },
    { type: "Feature", properties: { name: "Lowell", kind: "town" }, geometry: { type: "Point", coordinates: [-71.3162, 42.6334] } },
    { type: "Feature", properties: { name: "Albany", kind: "town" }, geometry: { type: "Point", coordinates: [-73.7562, 42.6526] } },
    { type: "Feature", properties: { name: "Syracuse", kind: "town" }, geometry: { type: "Point", coordinates: [-76.1474, 43.0481] } },
    { type: "Feature", properties: { name: "Rochester", kind: "town" }, geometry: { type: "Point", coordinates: [-77.6109, 43.1566] } },
    { type: "Feature", properties: { name: "Buffalo", kind: "town" }, geometry: { type: "Point", coordinates: [-78.8784, 42.8864] } },
    { type: "Feature", properties: { name: "Allentown", kind: "town" }, geometry: { type: "Point", coordinates: [-75.4902, 40.6023] } },
    { type: "Feature", properties: { name: "Scranton", kind: "town" }, geometry: { type: "Point", coordinates: [-75.6624, 41.4089] } },
    { type: "Feature", properties: { name: "Harrisburg", kind: "town" }, geometry: { type: "Point", coordinates: [-76.8867, 40.2732] } },
    { type: "Feature", properties: { name: "Trenton", kind: "town" }, geometry: { type: "Point", coordinates: [-74.7429, 40.2171] } },
    { type: "Feature", properties: { name: "Wilmington (DE)", kind: "town" }, geometry: { type: "Point", coordinates: [-75.5466, 39.7447] } },
    { type: "Feature", properties: { name: "Arlington (VA)", kind: "town" }, geometry: { type: "Point", coordinates: [-77.1068, 38.8816] } },
    { type: "Feature", properties: { name: "Alexandria", kind: "town" }, geometry: { type: "Point", coordinates: [-77.0469, 38.8048] } },

    { type: "Feature", properties: { name: "Charleston", kind: "town" }, geometry: { type: "Point", coordinates: [-79.9311, 32.7765] } },
    { type: "Feature", properties: { name: "Savannah", kind: "town" }, geometry: { type: "Point", coordinates: [-81.0998, 32.0809] } },
    { type: "Feature", properties: { name: "Asheville", kind: "town" }, geometry: { type: "Point", coordinates: [-82.5515, 35.5951] } },
    { type: "Feature", properties: { name: "Knoxville", kind: "town" }, geometry: { type: "Point", coordinates: [-83.9207, 35.9606] } },
    { type: "Feature", properties: { name: "Chattanooga", kind: "town" }, geometry: { type: "Point", coordinates: [-85.3097, 35.0456] } },
    { type: "Feature", properties: { name: "Birmingham", kind: "town" }, geometry: { type: "Point", coordinates: [-86.8104, 33.5186] } },
    { type: "Feature", properties: { name: "Montgomery", kind: "town" }, geometry: { type: "Point", coordinates: [-86.3000, 32.3668] } },
    { type: "Feature", properties: { name: "Huntsville", kind: "town" }, geometry: { type: "Point", coordinates: [-86.5861, 34.7304] } },
    { type: "Feature", properties: { name: "Tallahassee", kind: "town" }, geometry: { type: "Point", coordinates: [-84.2807, 30.4383] } },
    { type: "Feature", properties: { name: "Fort Lauderdale", kind: "town" }, geometry: { type: "Point", coordinates: [-80.1373, 26.1224] } },
    { type: "Feature", properties: { name: "Orlando", kind: "town" }, geometry: { type: "Point", coordinates: [-81.3792, 28.5383] } },
    { type: "Feature", properties: { name: "Tampa", kind: "town" }, geometry: { type: "Point", coordinates: [-82.4572, 27.9506] } },
    { type: "Feature", properties: { name: "St. Petersburg", kind: "town" }, geometry: { type: "Point", coordinates: [-82.6403, 27.7676] } },

    { type: "Feature", properties: { name: "Madison", kind: "town" }, geometry: { type: "Point", coordinates: [-89.4012, 43.0731] } },
    { type: "Feature", properties: { name: "Green Bay", kind: "town" }, geometry: { type: "Point", coordinates: [-88.0198, 44.5133] } },
    { type: "Feature", properties: { name: "Grand Rapids", kind: "town" }, geometry: { type: "Point", coordinates: [-85.6681, 42.9634] } },
    { type: "Feature", properties: { name: "Toledo", kind: "town" }, geometry: { type: "Point", coordinates: [-83.5552, 41.6639] } },
    { type: "Feature", properties: { name: "Fort Wayne", kind: "town" }, geometry: { type: "Point", coordinates: [-85.1394, 41.0793] } },
    { type: "Feature", properties: { name: "South Bend", kind: "town" }, geometry: { type: "Point", coordinates: [-86.2510, 41.6764] } },
    { type: "Feature", properties: { name: "Des Moines", kind: "town" }, geometry: { type: "Point", coordinates: [-93.6250, 41.5868] } },
    { type: "Feature", properties: { name: "Cedar Rapids", kind: "town" }, geometry: { type: "Point", coordinates: [-91.6704, 41.9779] } },
    { type: "Feature", properties: { name: "Fargo", kind: "town" }, geometry: { type: "Point", coordinates: [-96.7898, 46.8772] } },
    { type: "Feature", properties: { name: "Sioux Falls", kind: "town" }, geometry: { type: "Point", coordinates: [-96.7311, 43.5446] } },
    { type: "Feature", properties: { name: "Omaha", kind: "town" }, geometry: { type: "Point", coordinates: [-95.9979, 41.2565] } },
    { type: "Feature", properties: { name: "Lincoln", kind: "town" }, geometry: { type: "Point", coordinates: [-96.6852, 40.8136] } },
    { type: "Feature", properties: { name: "Wichita", kind: "town" }, geometry: { type: "Point", coordinates: [-97.3301, 37.6872] } },
    { type: "Feature", properties: { name: "Tulsa", kind: "town" }, geometry: { type: "Point", coordinates: [-95.9928, 36.1540] } },
    { type: "Feature", properties: { name: "Oklahoma City", kind: "town" }, geometry: { type: "Point", coordinates: [-97.5164, 35.4676] } },

    { type: "Feature", properties: { name: "Boise", kind: "town" }, geometry: { type: "Point", coordinates: [-116.2023, 43.6150] } },
    { type: "Feature", properties: { name: "Missoula", kind: "town" }, geometry: { type: "Point", coordinates: [-113.9966, 46.8721] } },
    { type: "Feature", properties: { name: "Billings", kind: "town" }, geometry: { type: "Point", coordinates: [-108.5007, 45.7833] } },
    { type: "Feature", properties: { name: "Cheyenne", kind: "town" }, geometry: { type: "Point", coordinates: [-104.8202, 41.1400] } },
    { type: "Feature", properties: { name: "Fort Collins", kind: "town" }, geometry: { type: "Point", coordinates: [-105.0844, 40.5853] } },
    { type: "Feature", properties: { name: "Colorado Springs", kind: "town" }, geometry: { type: "Point", coordinates: [-104.8214, 38.8339] } },
    { type: "Feature", properties: { name: "Provo", kind: "town" }, geometry: { type: "Point", coordinates: [-111.6585, 40.2338] } },
    { type: "Feature", properties: { name: "Ogden", kind: "town" }, geometry: { type: "Point", coordinates: [-111.9738, 41.2230] } },
    { type: "Feature", properties: { name: "Santa Fe", kind: "town" }, geometry: { type: "Point", coordinates: [-105.9378, 35.6870] } },
    { type: "Feature", properties: { name: "Reno", kind: "town" }, geometry: { type: "Point", coordinates: [-119.8138, 39.5296] } },

    { type: "Feature", properties: { name: "Santa Monica", kind: "town" }, geometry: { type: "Point", coordinates: [-118.4912, 34.0195] } },
    { type: "Feature", properties: { name: "Pasadena", kind: "town" }, geometry: { type: "Point", coordinates: [-118.1445, 34.1478] } },
    { type: "Feature", properties: { name: "Glendale", kind: "town" }, geometry: { type: "Point", coordinates: [-118.2551, 34.1425] } },
    { type: "Feature", properties: { name: "Long Beach", kind: "town" }, geometry: { type: "Point", coordinates: [-118.1937, 33.7701] } },
    { type: "Feature", properties: { name: "Anaheim", kind: "town" }, geometry: { type: "Point", coordinates: [-117.9143, 33.8366] } },
    { type: "Feature", properties: { name: "Irvine", kind: "town" }, geometry: { type: "Point", coordinates: [-117.8265, 33.6846] } },
    { type: "Feature", properties: { name: "Oakland", kind: "town" }, geometry: { type: "Point", coordinates: [-122.2711, 37.8044] } },
    { type: "Feature", properties: { name: "Berkeley", kind: "town" }, geometry: { type: "Point", coordinates: [-122.2730, 37.8715] } },
    { type: "Feature", properties: { name: "Fremont", kind: "town" }, geometry: { type: "Point", coordinates: [-121.9886, 37.5485] } },
    { type: "Feature", properties: { name: "Sacramento", kind: "town" }, geometry: { type: "Point", coordinates: [-121.4944, 38.5816] } },
    { type: "Feature", properties: { name: "Stockton", kind: "town" }, geometry: { type: "Point", coordinates: [-121.2908, 37.9577] } },
    { type: "Feature", properties: { name: "Modesto", kind: "town" }, geometry: { type: "Point", coordinates: [-120.9969, 37.6391] } },
    { type: "Feature", properties: { name: "Santa Rosa", kind: "town" }, geometry: { type: "Point", coordinates: [-122.7144, 38.4404] } },
    { type: "Feature", properties: { name: "Eugene", kind: "town" }, geometry: { type: "Point", coordinates: [-123.0868, 44.0521] } },
    { type: "Feature", properties: { name: "Salem", kind: "town" }, geometry: { type: "Point", coordinates: [-123.0351, 44.9429] } },
    { type: "Feature", properties: { name: "Tacoma", kind: "town" }, geometry: { type: "Point", coordinates: [-122.4443, 47.2529] } },
    { type: "Feature", properties: { name: "Spokane", kind: "town" }, geometry: { type: "Point", coordinates: [-117.4260, 47.6588] } },
    { type: "Feature", properties: { name: "Bellevue (WA)", kind: "town" }, geometry: { type: "Point", coordinates: [-122.2015, 47.6101] } },

    { type: "Feature", properties: { name: "Plano", kind: "town" }, geometry: { type: "Point", coordinates: [-96.6989, 33.0198] } },
    { type: "Feature", properties: { name: "Irving", kind: "town" }, geometry: { type: "Point", coordinates: [-96.9489, 32.8140] } },
    { type: "Feature", properties: { name: "Garland", kind: "town" }, geometry: { type: "Point", coordinates: [-96.6389, 32.9126] } },
    { type: "Feature", properties: { name: "Arlington (TX)", kind: "town" }, geometry: { type: "Point", coordinates: [-97.1081, 32.7357] } },
    { type: "Feature", properties: { name: "Lubbock", kind: "town" }, geometry: { type: "Point", coordinates: [-101.8552, 33.5779] } },
    { type: "Feature", properties: { name: "Amarillo", kind: "town" }, geometry: { type: "Point", coordinates: [-101.8313, 35.2219] } },
    { type: "Feature", properties: { name: "Corpus Christi", kind: "town" }, geometry: { type: "Point", coordinates: [-97.3964, 27.8006] } },
  ],
} as const;

/* ---------- small utils ---------- */
const R = 6378137;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function lonLatToMercator(lon: number, lat: number) {
  const x = (lon * Math.PI * R) / 180;
  const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * R;
  return { x, y };
}

function mercatorToLonLat(x: number, y: number) {
  const lon = (x * 180) / (Math.PI * R);
  const lat = (Math.atan(Math.exp(y / R)) * 360) / Math.PI - 90;
  return { lon, lat };
}

function roundTo(n: number, d: number) {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

function safeEstimateExpr(propertyName = "estimate", maxEstimate = 10000) {
  return [
    "min",
    maxEstimate,
    ["max", 0, ["to-number", ["coalesce", ["get", propertyName], ["get", "estimate"], 0], 0]],
  ] as any;
}

function readPoiValue(props: Record<string, any>, keys: string[]) {
  for (const key of keys) {
    const raw = props?.[key];
    if (raw == null) continue;
    const value = String(raw).trim();
    if (value) return value;
  }
  return "";
}

function normalizePoiKind(raw: unknown): PoiKind | null {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (!value) return null;
  if (value === "synagogue" || value === "shul") return "synagogue";
  if (
    value === "jcc" ||
    value === "jewish_community_center" ||
    value === "jewish_community_centre" ||
    value === "jewish_community_ctr" ||
    value === "jewish_community_ctr."
  ) {
    return "jcc";
  }
  if (value === "kosher" || value === "kosher_amenity") return "kosher";
  if (value === "mikveh" || value === "mikvah") return "mikveh";
  if (value === "jewish_school" || value === "school" || value === "yeshiva") {
    return "jewish_school";
  }
  if (value === "jewish_camp" || value === "camp" || value === "summer_camp") {
    return "jewish_camp";
  }
  return null;
}

function formatKindLabel(kind: string) {
  const normalized = normalizePoiKind(kind);
  if (normalized) return kindLabel(normalized);
  return kindLabel(kind || "Place");
}

function createEmptyPoiCounts(): Record<PoiKind, number> {
  return {
    synagogue: 0,
    jcc: 0,
    kosher: 0,
    mikveh: 0,
    jewish_school: 0,
    jewish_camp: 0,
  };
}

function getEstimatedFromPoiCounts(counts: Record<PoiKind, number>) {
  let total = 0;
  for (const kind of ALL_POI_KINDS) {
    total += (counts[kind] ?? 0) * (POI_ESTIMATE_WEIGHT[kind] ?? 0);
  }
  const rounded = Math.round(total);
  return isFinite(rounded) && rounded > 0 ? rounded : 0;
}

function normalizePoiCounts(raw: any): Record<PoiKind, number> {
  return {
    synagogue: Number(raw?.synagogue ?? 0) || 0,
    jcc: Number(raw?.jcc ?? 0) || 0,
    kosher: Number(raw?.kosher ?? 0) || 0,
    mikveh: Number(raw?.mikveh ?? 0) || 0,
    jewish_school: Number(raw?.jewish_school ?? 0) || 0,
    jewish_camp: Number(raw?.jewish_camp ?? 0) || 0,
  };
}

function getHexFeatureId(feature: any): string {
  const props = feature?.properties ?? {};
  const raw =
    props.h3 ??
    props.hexId ??
    props.id ??
    props.cellId ??
    feature?.id;
  if (raw == null) return "";
  return String(raw).trim();
}

function computePoisInsideHex(hexFeature: any, allPoisFC: any) {
  const poiCounts = createEmptyPoiCounts();
  const poisInside: Array<{ name: string; kind: PoiKind; osmId: string }> = [];
  const geom = hexFeature?.geometry;
  if (!geom) return { poiCounts, poisInside, estimated: 0, greedLevel: 0 };

  const features: any[] = Array.isArray(allPoisFC?.features) ? allPoisFC.features : [];
  for (const f of features) {
    const coords = f?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!isFinite(lon) || !isFinite(lat)) continue;
    if (!pointInGeoJsonPolygon([lon, lat], geom)) continue;
    const kind =
      normalizePoiKind(f?.properties?.kind) ??
      normalizePoiKind(f?.properties?.type);
    if (!kind) continue;

    poiCounts[kind] = (poiCounts[kind] ?? 0) + 1;
    poisInside.push({
      name: readPoiValue(f?.properties ?? {}, ["name"]) || "Unnamed place",
      kind,
      osmId: readPoiValue(f?.properties ?? {}, ["osm_id", "id"]),
    });
  }

  const estimated = getEstimatedFromPoiCounts(poiCounts);
  const resolution = Number(hexFeature?.properties?.resolution ?? 6);
  const greedLevel = greedLevelFromEstimated(estimated, resolution);
  return { poiCounts, poisInside, estimated, greedLevel };
}

type HexAnnotationCacheEntry = {
  poiVersion: string;
  poiCounts: Record<PoiKind, number>;
  estimated: number;
  greedLevel: number;
};

function annotateHexesWithPois(
  hexFc: any,
  poisFc: any,
  poiVersion: string,
  annotationCache: Map<string, HexAnnotationCacheEntry>
) {
  const hexFeatures: any[] = Array.isArray(hexFc?.features) ? hexFc.features : [];
  if (!hexFeatures.length) return EMPTY_FC;

  const poiFeatures: Array<{ pt: [number, number]; kind: PoiKind }> = [];
  for (const f of Array.isArray(poisFc?.features) ? poisFc.features : []) {
    const coords = f?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!isFinite(lon) || !isFinite(lat)) continue;
    const kind =
      normalizePoiKind(f?.properties?.kind) ??
      normalizePoiKind(f?.properties?.type);
    if (!kind) continue;
    poiFeatures.push({ pt: [lon, lat], kind });
  }

  const annotatedFeatures = hexFeatures.map((f) => {
    const cellId =
      String(f?.properties?.cellId ?? f?.id ?? "") ||
      JSON.stringify(f?.geometry?.coordinates?.[0]?.[0] ?? []);
    const cacheKey = `${cellId}:${poiVersion}`;
    const cached = annotationCache.get(cacheKey);

    const resolution = Number(f?.properties?.resolution ?? 6);
    let counts: Record<PoiKind, number>;
    let estimated: number;
    let greedLevel: number;
    if (cached) {
      counts = cached.poiCounts;
      estimated = cached.estimated;
      greedLevel = isFinite(Number(cached.greedLevel))
        ? Number(cached.greedLevel)
        : greedLevelFromEstimated(estimated, resolution);
    } else {
      counts = createEmptyPoiCounts();
      const geom = f?.geometry;
      if (geom) {
        for (const poi of poiFeatures) {
          if (pointInGeoJsonPolygon(poi.pt, geom)) {
            counts[poi.kind] = (counts[poi.kind] ?? 0) + 1;
          }
        }
      }
      estimated = getEstimatedFromPoiCounts(counts);
      greedLevel = greedLevelFromEstimated(estimated, resolution);
      annotationCache.set(cacheKey, {
        poiVersion,
        poiCounts: counts,
        estimated,
        greedLevel,
      });
    }

    return {
      ...f,
      properties: {
        ...(f?.properties ?? {}),
        poiCounts: counts,
        estimated,
        estimate: estimated,
        greedLevel,
      },
    };
  });

  return { type: "FeatureCollection", features: annotatedFeatures };
}

function bboxKey(b: BBox, decimals = 1) {
  const [w, s, e, n] = b;
  const f = (x: number) => x.toFixed(decimals);
  return `${f(w)},${f(s)},${f(e)},${f(n)}`;
}

function getFetchUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function isAllowedAbsoluteFetchUrl(url: string) {
  const normalized = url.toLowerCase();
  return FETCH_ABSOLUTE_ALLOWLIST.some((allowed) => {
    const prefix = allowed.toLowerCase();
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  });
}


/* ---------- point-in-polygon (mask to USA land) ---------- */
function pointInRing(pt: [number, number], ring: [number, number][]) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1];
    const xj = ring[j][0],
      yj = ring[j][1];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInGeoJsonPolygon(pt: [number, number], geom: any): boolean {
  if (!geom) return false;

  if (geom.type === "Polygon") {
    const outer = (geom.coordinates?.[0] ?? []) as [number, number][];
    if (!outer.length) return false;
    if (!pointInRing(pt, outer)) return false;
    const holes = geom.coordinates?.slice(1) ?? [];
    for (const h of holes) if (pointInRing(pt, h)) return false;
    return true;
  }

  if (geom.type === "MultiPolygon") {
    for (const poly of geom.coordinates ?? []) {
      const outer = (poly?.[0] ?? []) as [number, number][];
      if (!outer.length) continue;
      if (!pointInRing(pt, outer)) continue;

      const holes = poly?.slice(1) ?? [];
      let inHole = false;
      for (const h of holes) {
        if (pointInRing(pt, h)) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return true;
    }
  }

  return false;
}

/* ---------- Presence palette (fill stays as-is) ---------- */
const HEAT_STOPS: Array<{ tier: PresenceTier; color: string }> = [
  { tier: "minimal", color: "rgba(34,197,94,0.38)" },
  { tier: "low", color: "rgba(34,197,94,0.58)" },
  { tier: "moderate", color: "rgba(250,204,21,0.68)" },
  { tier: "notable", color: "rgba(249,115,22,0.74)" },
  { tier: "significant", color: "rgba(231,0,11,0.78)" }, // #E7000B w/ alpha
];

const TIER_ORDER: Record<PresenceTier, number> = {
  minimal: 1,
  low: 2,
  moderate: 3,
  notable: 4,
  significant: 5,
};

const ESTIMATE_BY_TIER: Record<PresenceTier, number> = {
  minimal: 50,
  low: 150,
  moderate: 500,
  notable: 1500,
  significant: 4000,
};

/* ---------- 3 discrete zoom levels (STRICT) ---------- */
type H3Resolution = 5 | 6 | 8;

const CITY_ENTER_Z = 6;
const CITY_EXIT_Z = 5; // one below enter (hysteresis)
const TOWN_ENTER_Z = 8;
const TOWN_EXIT_Z = 7; // one below enter (hysteresis)

function getHexRes(z: number): H3Resolution {
  if (z < CITY_ENTER_Z) return 5;
  if (z < TOWN_ENTER_Z) return 6;
  return 8;
}

function getHexResWithHysteresis(nextZoom: number, prevRes: H3Resolution): H3Resolution {
  if (prevRes === 8) {
    if (nextZoom < TOWN_EXIT_Z) return nextZoom >= CITY_ENTER_Z ? 6 : 5;
    return 8;
  }

  if (prevRes === 6) {
    if (nextZoom >= TOWN_ENTER_Z) return 8;
    if (nextZoom < CITY_EXIT_Z) return 5;
    return 6;
  }

  if (nextZoom >= TOWN_ENTER_Z) return 8;
  if (nextZoom >= CITY_ENTER_Z) return 6;
  return 5;
}

// These are visual size stand-ins for your H3 res 4/6/8 look
function radiusMetersForResolution(resolution: H3Resolution) {
  switch (resolution) {
    case 5:
      return 23000; // default tier size
    case 6:
      return 11000; // city size
    case 8:
      return 2200; // town size
  }
}

/* ---------- Hex grid generation (seamless) ---------- */
/**
 * IMPORTANT for puzzle look:
 * - Grid spacing MUST match vertex radius (circumradius)
 * - coverage MUST be 1.0
 * - antialias off in fill layer to avoid dark seams
 */
function makeHexRingMercator(cx: number, cy: number, radiusM: number) {
  const r = radiusM * HEX_COVERAGE; // 1.0
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

/**
 * Build hexes across PRESENCE_AREAS (your existing geometry),
 * but masked to USA land (prevents ocean spill).
 *
 * NOTE: This assumes your presence logic already works (you said it does).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildPresenceHexes(resolution: H3Resolution, radiusM: number, usaGeom?: any) {
  const stepX = Math.sqrt(3) * radiusM;
  const stepY = 1.5 * radiusM;
  const offsetX = stepX / 2;

  const cellBest = new Map<
    string,
    { cellId: string; x: number; y: number; tier: PresenceTier }
  >();

  // safety cap so we do not freeze the page
  const MAX_CELLS = 120000;
  let cells = 0;

  for (const f of PRESENCE_AREAS.features as any[]) {
    const tier = f?.properties?.tier as PresenceTier | undefined;
    if (!tier) continue;

    // bbox of the polygon
    let minLon = 180,
      minLat = 90,
      maxLon = -180,
      maxLat = -90;

    const g = f.geometry;
    const outerRings: [number, number][][] = [];

    if (g?.type === "Polygon") outerRings.push(g.coordinates?.[0] ?? []);
    if (g?.type === "MultiPolygon") {
      for (const poly of g.coordinates ?? []) outerRings.push(poly?.[0] ?? []);
    }

    for (const ring of outerRings) {
      for (const [lon, lat] of ring) {
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      }
    }

    if (!isFinite(minLon)) continue;

    // small buffer
    minLon -= 0.15;
    maxLon += 0.15;
    minLat -= 0.12;
    maxLat += 0.12;


    const a = lonLatToMercator(minLon, minLat);
    const b = lonLatToMercator(maxLon, maxLat);
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);

    const rowStart = Math.floor(minY / stepY) - 1;
    const rowEnd = Math.floor(maxY / stepY) + 1;

    for (let row = rowStart; row <= rowEnd; row++) {
      const y = row * stepY;
      const xRowOffset = row % 2 === 0 ? 0 : offsetX;

      const colStart = Math.floor((minX - xRowOffset) / stepX) - 1;
      const colEnd = Math.floor((maxX - xRowOffset) / stepX) + 1;

      for (let col = colStart; col <= colEnd; col++) {
        const x = col * stepX + xRowOffset;

        const { lon, lat } = mercatorToLonLat(x, y);
        const pt: [number, number] = [lon, lat];

        // land mask
        if (usaGeom && !pointInGeoJsonPolygon(pt, usaGeom)) continue;

        // inside this presence polygon?
        if (!pointInGeoJsonPolygon(pt, g)) continue;

        // Town tier uses stricter containment so smaller hexes cover less total area.
        if (resolution === 8) {
          const ring = makeHexRingMercator(x, y, radiusM);
          let fullyInside = true;
          for (let i = 0; i < 6; i++) {
            const v = ring[i] as [number, number];
            if (!pointInGeoJsonPolygon(v, g)) {
              fullyInside = false;
              break;
            }
            if (usaGeom && !pointInGeoJsonPolygon(v, usaGeom)) {
              fullyInside = false;
              break;
            }
          }
          if (!fullyInside) continue;
        }

        const cellId = `${resolution}:${row}:${col}`;
        const prev = cellBest.get(cellId);
        if (!prev || TIER_ORDER[tier] > TIER_ORDER[prev.tier]) {
          cellBest.set(cellId, { cellId, x, y, tier });
        }

        cells++;
        if (cells >= MAX_CELLS) break;
      }
      if (cells >= MAX_CELLS) break;
    }
    if (cells >= MAX_CELLS) break;
  }

  const features: any[] = [];
  for (const v of cellBest.values()) {
    const ring = makeHexRingMercator(v.x, v.y, radiusM);
    const estimated = ESTIMATE_BY_TIER[v.tier] ?? 0;
    features.push({
      type: "Feature",
      properties: {
        tier: v.tier,
        cellId: v.cellId,
        estimated,
        estimate: estimated,
        greedLevel: greedLevelFromEstimated(estimated, resolution),
      },
      geometry: { type: "Polygon", coordinates: [ring] },
    });
  }

  return { type: "FeatureCollection", features };
}

function tierForEstimate(estimate: number): PresenceTier {
  if (estimate >= 16) return "significant";
  if (estimate >= 8) return "notable";
  if (estimate >= 4) return "moderate";
  if (estimate >= 2) return "low";
  return "minimal";
}

function getCellAreaKm2(cell: string, resolution: H3Resolution) {
  const h3Any = h3 as any;
  const fallbackByResolution: Record<H3Resolution, number> = {
    5: 252.0,
    6: 36.0,
    8: 0.74,
  };

  if (typeof h3Any.cellArea === "function") {
    const v = Number(h3Any.cellArea(cell, "km2"));
    if (isFinite(v) && v > 0) return v;
  }
  if (typeof h3Any.cellAreaKm2 === "function") {
    const v = Number(h3Any.cellAreaKm2(cell));
    if (isFinite(v) && v > 0) return v;
  }
  if (typeof h3Any.cellAreaM2 === "function") {
    const v = Number(h3Any.cellAreaM2(cell));
    if (isFinite(v) && v > 0) return v / 1e6;
  }

  return fallbackByResolution[resolution];
}

function percentile95(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(0.95 * (sorted.length - 1));
  return sorted[idx] ?? 0;
}

function buildSparseHexesFromPois(poisFc: any, resolution: H3Resolution) {
  const features: any[] = Array.isArray(poisFc?.features) ? poisFc.features : [];
  if (!features.length) return { fc: EMPTY_FC, p95: 1 };

  const centerEstimates = new Map<string, number>();
  for (const f of features) {
    if (f?.properties?.kind !== "synagogue") continue;
    const coords = f?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!isFinite(lon) || !isFinite(lat)) continue;
    const cell = latLngToCell(lat, lon, resolution);
    centerEstimates.set(cell, (centerEstimates.get(cell) ?? 0) + 1);
  }

  if (centerEstimates.size === 0) return { fc: EMPTY_FC, p95: 1 };

  const estimates = new Map<string, number>(centerEstimates);
  for (const [cell, centerEstimate] of centerEstimates.entries()) {
    const haloEstimate = centerEstimate * 0.25;
    if (haloEstimate <= 0) continue;
    for (const neighbor of gridDisk(cell, 1)) {
      if (neighbor === cell) continue;
      const prev = estimates.get(neighbor) ?? 0;
      estimates.set(neighbor, Math.max(prev, haloEstimate));
    }
  }

  const rows: Array<{
    cell: string;
    boundary: [number, number][];
    estimate: number;
    areaKm2: number;
    density: number;
    tier: PresenceTier;
  }> = [];

  let capped = false;
  let processed = 0;
  for (const [cell, estimateRaw] of estimates.entries()) {
    if (processed >= MAX_SPARSE_HEX_CELLS) {
      capped = true;
      break;
    }
    processed++;

    const estimate = Math.max(0, Math.min(10000, estimateRaw));
    if (estimate <= 0) continue;
    const boundary = cellToBoundary(cell, true) as [number, number][];
    if (!Array.isArray(boundary) || boundary.length < 4) continue;
    const areaKm2 = getCellAreaKm2(cell, resolution);
    const densityRaw = estimate > 0 && areaKm2 > 0 ? estimate / areaKm2 : 0;
    const density = isFinite(densityRaw) && densityRaw > 0 ? densityRaw : 0;
    rows.push({
      cell,
      boundary,
      estimate,
      areaKm2,
      density,
      tier: tierForEstimate(estimate),
    });
  }

  if (capped) {
    console.warn("[MapShell] MAX_CELLS cap reached for sparse hex build", {
      resolution,
      maxCells: MAX_SPARSE_HEX_CELLS,
      candidateCells: estimates.size,
      emittedCells: rows.length,
    });
  }

  const nonzeroDensities = rows.map((r) => r.density).filter((d) => d > 0);
  let p95 = percentile95(nonzeroDensities);
  if (!isFinite(p95) || p95 <= 0) p95 = 1;

  const outFeatures: any[] = rows.map((r) => {
    const score = p95 > 0 ? clamp(r.density / p95, 0, 1) : 0;
    const greedLevel = greedLevelFromEstimated(r.estimate, resolution);
    return {
      type: "Feature",
      id: r.cell,
      properties: {
        h3: r.cell,
        hexId: r.cell,
        id: r.cell,
        cellId: r.cell,
        estimated: r.estimate,
        estimate: r.estimate,
        greedLevel,
        areaKm2: r.areaKm2,
        density: r.density,
        score,
        estimateSmoothed: r.estimate,
        tier: r.tier,
        resolution,
      },
      geometry: { type: "Polygon", coordinates: [r.boundary] },
    };
  });

  return {
    fc: { type: "FeatureCollection", features: outFeatures },
    p95,
  };
}

export default function MapShell() {
  const mapRef = useRef<MapRef | null>(null);
  const urlSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const layer = "presence" as const;

  const initialUrlState = useMemo(() => {
    if (typeof window === "undefined") {
      return {
        hasView: false,
        center: [DEFAULT_VIEW.longitude, DEFAULT_VIEW.latitude] as [number, number],
        zoom: DEFAULT_VIEW.zoom,
        placesEnabled: true,
        enabledKinds: [...ALL_POI_KINDS] as PoiKind[],
      };
    }

    const params = new URLSearchParams(window.location.search);

    const centerRaw = params.get("center");
    let hasView = false;
    let center: [number, number] = [DEFAULT_VIEW.longitude, DEFAULT_VIEW.latitude];
    if (centerRaw) {
      const [lonRaw, latRaw] = centerRaw.split(",");
      const lon = Number(lonRaw);
      const lat = Number(latRaw);
      if (isFinite(lon) && isFinite(lat)) {
        center = [lon, lat];
        hasView = true;
      }
    }

    const zoomRaw = Number(params.get("zoom"));
    const zoom = isFinite(zoomRaw) ? zoomRaw : DEFAULT_VIEW.zoom;
    if (isFinite(zoomRaw)) hasView = true;

    const showPlacesRaw = (params.get("showPlaces") ?? "").toLowerCase();
    const placesEnabled =
      showPlacesRaw === "0" || showPlacesRaw === "false" ? false : true;

    const enabledKindsRaw = params.get("enabledKinds");
    let enabledKinds = [...ALL_POI_KINDS] as PoiKind[];
    if (enabledKindsRaw) {
      const set = new Set<PoiKind>();
      for (const raw of enabledKindsRaw.split(",")) {
        const candidate = raw.trim() as PoiKind;
        if ((ALL_POI_KINDS as string[]).includes(candidate)) {
          set.add(candidate);
        }
      }
      enabledKinds = ALL_POI_KINDS.filter((k) => set.has(k));
    }

    return {
      hasView,
      center,
      zoom,
      placesEnabled,
      enabledKinds,
    };
  }, []);

  const [bbox, setBbox] = useState<BBox | null>(null);
  const [zoom, setZoom] = useState<number>(() => initialUrlState.zoom);
  const [center, setCenter] = useState<[number, number]>(() => initialUrlState.center);

  const [placesEnabled, setPlacesEnabled] = useState(initialUrlState.placesEnabled);
  const [enabledKinds, setEnabledKinds] = useState<PoiKind[]>(
    () => initialUrlState.enabledKinds
  );
  const [presenceOpen, setPresenceOpen] = useState(true);
  const [placesOpen, setPlacesOpen] = useState(true);
  const [selectedPoi, setSelectedPoi] = useState<{
    longitude: number;
    latitude: number;
    properties: Record<string, any>;
  } | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [selectedHex, setSelectedHex] = useState<{
    longitude: number;
    latitude: number;
    properties: Record<string, any>;
    geometry: any;
  } | null>(null);
  const [currentRes, setCurrentRes] = useState<H3Resolution>(
    () => getHexResWithHysteresis(zoom, getHexRes(zoom))
  );
  const isTown = currentRes === 8;
  const isCity = currentRes === 6;
  const isState = currentRes === 5;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const guardedWindow = window as typeof window & {
      __greedseekFetchGuardInstalled?: boolean;
    };
    if (guardedWindow.__greedseekFetchGuardInstalled) return;

    const originalFetch = window.fetch.bind(window);
    const guardedFetch: typeof window.fetch = (input, init) => {
      const requestUrl = getFetchUrl(input);
      if (
        /^https?:\/\//i.test(requestUrl) &&
        !isAllowedAbsoluteFetchUrl(requestUrl)
      ) {
        const message = `[FetchGuard] Blocked absolute fetch URL: ${requestUrl}`;
        console.error(message, { allowlist: FETCH_ABSOLUTE_ALLOWLIST });
        throw new Error(message);
      }
      return originalFetch(input, init);
    };

    window.fetch = guardedFetch;
    guardedWindow.__greedseekFetchGuardInstalled = true;
  }, []);

  /* --- POIs (local dataset) --- */
  const [pois, setPois] = useState<any>(() => poisDataCache ?? EMPTY_FC);
  useEffect(() => {
    let alive = true;

    if (poisDataCache) {
      return () => {
        alive = false;
      };
    }

    if (!poisDataPromise) {
      poisDataPromise = fetch("/data/pois.geojson")
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((fc) => {
          const features: any[] = Array.isArray(fc?.features) ? fc.features : [];
          const normalizedFeatures = features
            .filter((f) => f?.geometry?.type === "Point")
            .map((f) => {
              const props = { ...(f?.properties ?? {}) };
              const canonical =
                normalizePoiKind(props.kind) ??
                normalizePoiKind(props.type);
              return {
                ...f,
                properties: {
                  ...props,
                  kind: canonical ?? "",
                  kindCanonical: canonical ?? "",
                },
              };
            })
            .filter((f) => !!f?.properties?.kind);
          poisDataCache = {
            type: "FeatureCollection",
            features: normalizedFeatures,
          };
          return poisDataCache;
        })
        .catch((err) => {
          poisDataPromise = null;
          throw err;
        });
    }

    poisDataPromise
      .then((fc) => {
        if (!alive) return;
        setPois(fc);
        console.log("[MapShell][pois] loaded", fc?.features?.length ?? 0);
      })
      .catch((err) => {
        if (!alive) return;
        console.warn("[MapShell] Failed to load /data/pois.geojson:", err);
        setPois(EMPTY_FC);
      });

    return () => {
      alive = false;
    };
  }, []);
  const allPoisFC = pois;

  /* --- load USA geometry for land mask --- */
  const [usaGeomForMask, setUsaGeomForMask] = useState<any | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(USA_GEOJSON_URL)
      .then((r) => r.json())
      .then((gj) => {
        if (!alive) return;
        setUsaGeomForMask(gj?.features?.[0]?.geometry ?? null);
      })
      .catch(() => {
        if (!alive) return;
        setUsaGeomForMask(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  /* --- states --- */
  const [statesGeoJson, setStatesGeoJson] = useState<any | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(USA_STATES_GEOJSON_URL)
      .then((r) => r.json())
      .then((json) => {
        if (!alive) return;
        setStatesGeoJson(json);
      })
      .catch(() => {
        if (!alive) return;
        setStatesGeoJson(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const updateViewport = useCallback(() => {
    const m = mapRef.current;
    if (!m) return;
    const b = m.getBounds();
    const c = m.getCenter();
    const nextZoom = m.getZoom();
    setBbox([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    setCenter([c.lng, c.lat]);
    setZoom(nextZoom);
    setCurrentRes((prev) => {
      const nextRes = getHexResWithHysteresis(nextZoom, prev);
      return prev === nextRes ? prev : nextRes;
    });
  }, []);

  const updateHexResolution = useCallback(() => {
    const m = mapRef.current;
    if (!m) return;
    const nextZoom = m.getZoom();
    setZoom(nextZoom);
    setCurrentRes((prev) => {
      const nextRes = getHexResWithHysteresis(nextZoom, prev);
      return prev === nextRes ? prev : nextRes;
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (urlSyncTimerRef.current) clearTimeout(urlSyncTimerRef.current);
    urlSyncTimerRef.current = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      params.set(
        "center",
        `${center[0].toFixed(4)},${center[1].toFixed(4)}`
      );
      params.set("zoom", zoom.toFixed(2));
      params.set("showPlaces", placesEnabled ? "1" : "0");
      params.set("enabledKinds", enabledKinds.join(","));

      const nextSearch = params.toString();
      const currentSearch = window.location.search.startsWith("?")
        ? window.location.search.slice(1)
        : window.location.search;
      if (nextSearch !== currentSearch) {
        const nextUrl = `${window.location.pathname}?${nextSearch}${window.location.hash}`;
        window.history.replaceState(null, "", nextUrl);
      }
    }, 160);

    return () => {
      if (urlSyncTimerRef.current) clearTimeout(urlSyncTimerRef.current);
    };
  }, [center, zoom, placesEnabled, enabledKinds]);

  const fitToCONUS = useCallback(() => {
    const m = mapRef.current?.getMap();
    if (!m) return;
    requestAnimationFrame(() => {
      m.fitBounds(CONUS_FIT_BOUNDS as any, { padding: 50, duration: 0 });
    });
  }, []);

  /* =========================
     PRESENCE HEXES (3 levels)
     ========================= */
  const [hexFC, setHexFC] = useState<any>(EMPTY_FC);
  const hexCacheRef = useRef<Map<string, any>>(new Map());
  const hexBuildTokenRef = useRef(0);
  const hexAnnotationCacheRef = useRef<Map<string, HexAnnotationCacheEntry>>(new Map());

  useEffect(() => {
    hexCacheRef.current.clear();
  }, [usaGeomForMask, pois]);

  const poiDatasetVersion = useMemo(() => {
    const features: any[] = Array.isArray(pois?.features) ? pois.features : [];
    if (!features.length) return "pois:0";

    const sampleStep = Math.max(1, Math.floor(features.length / 64));
    let hash = 2166136261;
    for (let i = 0; i < features.length; i += sampleStep) {
      const f = features[i];
      const props = f?.properties ?? {};
      const id = String(props.osm_id ?? props.id ?? "");
      const kind = String(props.kind ?? props.type ?? "");
      const coords = Array.isArray(f?.geometry?.coordinates)
        ? `${Number(f.geometry.coordinates[0]).toFixed(3)},${Number(f.geometry.coordinates[1]).toFixed(3)}`
        : "";
      const token = `${id}|${kind}|${coords}`;
      for (let j = 0; j < token.length; j++) {
        hash ^= token.charCodeAt(j);
        hash = Math.imul(hash, 16777619);
      }
    }

    return `pois:${features.length}:${Math.abs(hash >>> 0)}`;
  }, [pois]);

  useEffect(() => {
    hexAnnotationCacheRef.current.clear();
  }, [poiDatasetVersion]);

  const synagoguePois = useMemo(() => {
    const features: any[] = Array.isArray(pois?.features) ? pois.features : [];
    return {
      type: "FeatureCollection",
      features: features.filter(
        (f) =>
          f?.properties?.kind === "synagogue" &&
          f?.geometry?.type === "Point"
      ),
    };
  }, [pois]);

  // Build active tier on idle; cache by tier key so flips stay instant.
  useEffect(() => {
    if (layer !== "presence") return;

    const synagogueCount = synagoguePois.features.length;
    const cacheKey = `sparse:${currentRes}:${synagogueCount}:${poiDatasetVersion}`;
    const cached = hexCacheRef.current.get(cacheKey);
    if (cached) {
      setHexFC(cached);
      return;
    }

    let cancelled = false;
    const token = ++hexBuildTokenRef.current;

    const run = () => {
      if (cancelled) return;

      const { fc: sparseFC, p95 } = buildSparseHexesFromPois(
        synagoguePois,
        currentRes
      );
      const nextFC = annotateHexesWithPois(
        sparseFC,
        pois,
        poiDatasetVersion,
        hexAnnotationCacheRef.current
      );
      if (cancelled || token !== hexBuildTokenRef.current) return;

      hexCacheRef.current.set(cacheKey, nextFC);
      setHexFC(nextFC);
      console.log("[MapShell][presence rebuild]", {
        zoom: Number((mapRef.current?.getMap()?.getZoom() ?? 0).toFixed(2)),
        currentRes,
        features: nextFC?.features?.length ?? 0,
        p95,
      });
    };

    const w: any = window as any;
    const handle =
      typeof w.requestIdleCallback === "function"
        ? w.requestIdleCallback(run, { timeout: 1200 })
        : window.setTimeout(run, 0);

    return () => {
      cancelled = true;
      if (typeof w.cancelIdleCallback === "function") w.cancelIdleCallback(handle);
      else clearTimeout(handle);
    };
  }, [layer, currentRes, synagoguePois, pois, poiDatasetVersion]);

  const greedLevelRaw = useMemo(
    () => [
      "min",
      100,
      ["max", 0, ["coalesce", ["to-number", ["get", "greedLevel"]], 0]],
    ] as any,
    []
  );

  // Fill layer: NO stroke, NO outline, antialias OFF (fixes seams)
  const hexFillLayer: LayerProps = useMemo(
    () => ({
      id: PRESENCE_HEX_FILL_LAYER_ID,
      type: "fill",
      source: "presence-hex",
      paint: {
        "fill-antialias": false,
        "fill-outline-color": "rgba(0,0,0,0)",
        "fill-opacity": [
          "case",
          ["<=", greedLevelRaw as any, 0] as any,
          0,
          ["step", greedLevelRaw as any, 0.16, 20, 0.22, 40, 0.3, 60, 0.42, 80, 0.56] as any,
        ] as any,
        "fill-color": [
          "case",
          ["<=", greedLevelRaw as any, 0] as any,
          "rgba(0,0,0,0)",
          [
            "step",
            greedLevelRaw as any,
            HEX_LEVEL_BINS[0].color,
            20,
            HEX_LEVEL_BINS[1].color,
            40,
            HEX_LEVEL_BINS[2].color,
            60,
            HEX_LEVEL_BINS[3].color,
            80,
            HEX_LEVEL_BINS[4].color,
          ] as any,
        ] as any,
      },
    }),
    [greedLevelRaw]
  );

  // Border layer: drawn from the same polygon source as fill, fixed at 1px.
  const hexBorderLayer: LayerProps = useMemo(
    () => ({
      id: "presence-hex-borders",
      type: "line",
      source: "presence-hex",
      layout: {
        "line-cap": "butt",
        "line-join": "bevel",
      },
      paint: {
        "line-width": HEX_BORDER_WIDTH_PX,
        "line-color": HEX_BORDER_COLOR,
        "line-opacity": [
          "case",
          ["<=", greedLevelRaw as any, 0] as any,
          0,
          0.45,
        ] as any,
        "line-blur": 0,
      },
    }),
    [greedLevelRaw]
  );

  const selectedHexBorderLayer: LayerProps = useMemo(
    () => ({
      id: PRESENCE_HEX_SELECTED_LAYER_ID,
      type: "line",
      source: PRESENCE_HEX_SELECTED_SOURCE_ID,
      layout: {
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": "#FDE047",
        "line-width": 2.5,
        "line-opacity": 0.95,
      },
    }),
    []
  );

  /* =========================
     DOTS (local dataset)
     ========================= */
  const townPlacesVisible = placesEnabled && isTown && enabledKinds.length > 0;

  const filteredPoiFeatures = useMemo(() => {
    const features: any[] = Array.isArray(pois?.features) ? pois.features : [];
    if (features.length === 0 || enabledKinds.length === 0) return [];
    const enabled = new Set(enabledKinds);
    return features.filter(
      (f) =>
        f?.geometry?.type === "Point" &&
        enabled.has(f?.properties?.kind as PoiKind)
    );
  }, [pois, enabledKinds]);

  const visiblePoisFC = useMemo(
    () => ({
      type: "FeatureCollection",
      features: filteredPoiFeatures,
    }),
    [filteredPoiFeatures]
  );

  const poiDotsLayer: LayerProps = useMemo(
    () => ({
      id: POI_DOTS_LAYER_ID,
      type: "circle",
      source: POI_SOURCE_ID,
      layout: {
        visibility: townPlacesVisible ? "visible" : "none",
      } as any,
      paint: {
        "circle-color": [
          "case",
          ["==", ["get", "kind"], "synagogue"],
          POI_KIND_COLOR.synagogue,
          ["==", ["get", "kind"], "kosher"],
          POI_KIND_COLOR.kosher,
          ["==", ["get", "kind"], "jcc"],
          POI_KIND_COLOR.jcc,
          ["==", ["get", "kind"], "mikveh"],
          POI_KIND_COLOR.mikveh,
          ["==", ["get", "kind"], "jewish_school"],
          POI_KIND_COLOR.jewish_school,
          ["==", ["get", "kind"], "jewish_camp"],
          POI_KIND_COLOR.jewish_camp,
          "#FFFFFF",
        ] as any,
        "circle-opacity": 0.85,
        "circle-stroke-color": "#FFFFFF",
        "circle-stroke-opacity": 0.95,
        "circle-stroke-width": 1.25,
        "circle-radius": 4.0,
      },
    }),
    [townPlacesVisible]
  );

  const interactiveLayerIds = useMemo(() => {
    const ids = [PRESENCE_HEX_FILL_LAYER_ID];
    if (townPlacesVisible) {
      ids.push(POI_DOTS_LAYER_ID);
    }
    return ids;
  }, [townPlacesVisible]);

  const hexFeatureById = useMemo(() => {
    const map = new Map<string, any>();
    const features: any[] = Array.isArray(hexFC?.features) ? hexFC.features : [];
    for (const f of features) {
      const id = getHexFeatureId(f);
      if (id) map.set(id, f);
    }
    return map;
  }, [hexFC]);

  const onMapClick = useCallback(
    (event: any) => {
      const features: any[] = Array.isArray(event?.features) ? event.features : [];

      const poi = features.find((f: any) => f?.layer?.id === POI_DOTS_LAYER_ID);
      if (poi) {
        const coords = poi?.geometry?.coordinates;
        if (Array.isArray(coords) && coords.length >= 2) {
          const longitude = Number(coords[0]);
          const latitude = Number(coords[1]);
          if (isFinite(longitude) && isFinite(latitude)) {
            setSelectedPoi({
              longitude,
              latitude,
              properties: (poi?.properties ?? {}) as Record<string, any>,
            });
            setSelectedHex(null);
            return;
          }
        }
      }

      const hex = features.find((f: any) => f?.layer?.id === PRESENCE_HEX_FILL_LAYER_ID);
      if (hex) {
        console.log("clicked hex props", hex?.properties ?? {});

        const longitude = Number(event?.lngLat?.lng);
        const latitude = Number(event?.lngLat?.lat);
        if (isFinite(longitude) && isFinite(latitude)) {
          const clickedHexId = getHexFeatureId(hex);
          const sourceHex = (clickedHexId && hexFeatureById.get(clickedHexId)) || null;
          const selectedFeature = sourceHex ?? {
            type: "Feature",
            properties: (hex?.properties ?? {}) as Record<string, any>,
            geometry: hex?.geometry,
            id: clickedHexId || undefined,
          };

          const nextProps = { ...(selectedFeature?.properties ?? {}) } as Record<string, any>;
          const hasPoiCountsObject =
            nextProps.poiCounts &&
            typeof nextProps.poiCounts === "object";
          const hasEstimated =
            isFinite(Number(nextProps.estimated ?? NaN)) &&
            Number(nextProps.estimated) > 0;
          const hasPoisInsideList = Array.isArray(nextProps.poisInside);
          const hasGreedLevel = isFinite(Number(nextProps.greedLevel ?? NaN));

          if (!hasPoiCountsObject || !hasEstimated || !hasPoisInsideList || !hasGreedLevel) {
            const fallback = computePoisInsideHex(selectedFeature, allPoisFC);
            nextProps.poiCounts = fallback.poiCounts;
            nextProps.estimated = fallback.estimated;
            nextProps.estimate = fallback.estimated;
            nextProps.greedLevel = fallback.greedLevel;
            nextProps.poisInside = fallback.poisInside;
            nextProps.poisInsideTotal = fallback.poisInside.length;
          }

          if (!isFinite(Number(nextProps.greedLevel ?? NaN))) {
            const resolution = Number(nextProps.resolution ?? currentRes);
            const estimated = Number(nextProps.estimated ?? nextProps.estimate ?? 0);
            nextProps.greedLevel = greedLevelFromEstimated(estimated, resolution);
          }

          const selectedHexProps = {
            ...nextProps,
            _insidePois: Array.isArray(nextProps.poisInside) ? nextProps.poisInside.slice(0, 8) : [],
            _insidePoiTotal: Number(
              nextProps.poisInsideTotal ??
              (Array.isArray(nextProps.poisInside) ? nextProps.poisInside.length : 0)
            ),
          };
          console.log("selected hex props", selectedHexProps);

          setSelectedHex({
            longitude,
            latitude,
            properties: selectedHexProps,
            geometry: selectedFeature?.geometry ?? hex?.geometry,
          });
          setSelectedPoi(null);
          return;
        }
      }

      setSelectedPoi(null);
      setSelectedHex(null);
    },
    [allPoisFC, currentRes, hexFeatureById]
  );

  const selectedHexOutlineFC = useMemo(() => {
    if (!selectedHex?.geometry) return EMPTY_FC;
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: selectedHex.geometry,
        },
      ],
    };
  }, [selectedHex]);

  useEffect(() => {
    console.log("[MapShell][pois] visibility state", {
      placesEnabled,
      enabledKinds,
      currentRes,
      isTown,
      isCity,
      isState,
    });
  }, [placesEnabled, enabledKinds, currentRes, isTown, isCity, isState]);

  /* =========================
     Map layers
     ========================= */
  const usaFill: LayerProps = useMemo(
    () => ({
      id: "usa-fill",
      type: "fill",
      source: "usa",
      paint: { "fill-color": COLORS.country, "fill-opacity": 1 },
    }),
    []
  );

  const borderLine = useCallback(
    (id: string, src: string): LayerProps => ({
      id,
      type: "line",
      source: src,
      paint: { "line-color": COLORS.countryBorder, "line-width": 1.25, "line-opacity": 1 },
    }),
    []
  );

  const stateBorders: LayerProps = useMemo(
    () => ({
      id: "state-borders",
      type: "line",
      source: "states",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": COLORS.stateBorder,
        "line-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          3,
          0.18,
          6,
          0.28,
          9,
          0.4,
          12,
          0.52,
        ] as any,
        "line-dasharray": [0.12, 2.0] as any,
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          3,
          0.45,
          6,
          0.65,
          9,
          0.9,
          12,
          1.15,
        ] as any,
      },
    }),
    []
  );

  const riversLayer: LayerProps = useMemo(
    () => ({
      id: "rivers",
      type: "line",
      source: "omt",
      "source-layer": "waterway" as any,
      minzoom: 4,
      filter: ["in", "class", "river", "canal", "stream"] as any,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": COLORS.rivers,
        "line-opacity": 0.95,
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          4,
          0.6,
          6,
          0.9,
          9,
          1.3,
          12,
          1.8,
          14,
          2.2,
        ] as any,
      },
    }),
    []
  );

  const roadsPrimaryAndHighways: LayerProps = useMemo(
    () => ({
      id: "roads-primary-highways",
      type: "line",
      source: "omt",
      "source-layer": "transportation" as any,
      minzoom: 4,
      filter: ["in", "class", "motorway", "trunk", "primary"] as any,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": COLORS.roads,
        "line-opacity": 0.9,
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          4,
          0.8,
          6,
          1.1,
          9,
          1.6,
          12,
          2.2,
          14,
          2.8,
        ] as any,
      },
    }),
    []
  );

  const roadsLocal: LayerProps = useMemo(
    () => ({
      id: "roads-local",
      type: "line",
      source: "omt",
      "source-layer": "transportation" as any,
      filter: [
        "in",
        "class",
        "secondary",
        "tertiary",
        "minor",
        "residential",
        "service",
      ] as any,
      layout: {
        "line-join": "round",
        "line-cap": "round",
        visibility: isTown ? "visible" : "none",
      },
      paint: {
        "line-color": "#FFFFFF",
        "line-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          9,
          0.35,
          10,
          0.45,
          12,
          0.55,
          14,
          0.6,
        ] as any,
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          9,
          0.45,
          10,
          0.7,
          12,
          1.0,
          14,
          1.3,
        ] as any,
      },
    }),
    [isTown]
  );

  const usLabelLayer: LayerProps = useMemo(
    () => ({
      id: "us-label",
      type: "symbol",
      source: "us-label",
      minzoom: 2.5,
      maxzoom: 7.2,
      layout: {
        "text-field": ["get", "name"] as any,
        "text-font": ["Open Sans Regular", "Noto Sans Regular"] as any,
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          2.5,
          18,
          4,
          28,
          6.5,
          42,
        ] as any,
        "text-letter-spacing": 0.18,
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": COLORS.usLabel,
        "text-halo-color": COLORS.country,
        "text-halo-width": 1.2,
        "text-halo-blur": 0.6,
        "text-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          2.5,
          0.0,
          3.0,
          0.85,
          6.6,
          0.85,
          7.2,
          0.0,
        ] as any,
      },
    }),
    []
  );

  const cityLabelLayer: LayerProps = useMemo(
    () => ({
      id: "city-label-layer",
      type: "symbol",
      source: "city-labels",
      filter: ["==", ["get", "kind"], "city"] as any,
      layout: {
        visibility: isCity ? "visible" : "none",
        "text-field": ["get", "name"] as any,
        "text-font": ["Open Sans Regular", "Noto Sans Regular"] as any,
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          5,
          11,
          8.8,
          14,
        ] as any,
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#D5DCE3",
        "text-halo-color": COLORS.country,
        "text-halo-width": 1.0,
        "text-opacity": 0.9,
      },
    }),
    [isCity]
  );

  const townLabelLayer: LayerProps = useMemo(
    () => ({
      id: "town-label-layer",
      type: "symbol",
      source: "town-labels",
      filter: ["==", ["get", "kind"], "town"] as any,
      layout: {
        visibility: isTown ? "visible" : "none",
        "text-field": ["get", "name"] as any,
        "text-font": ["Open Sans Regular", "Noto Sans Regular"] as any,
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          9,
          10,
          12,
          12,
        ] as any,
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#C8D0D8",
        "text-halo-color": COLORS.country,
        "text-halo-width": 1.0,
        "text-opacity": 0.78,
      },
    }),
    [isTown]
  );

  const selectedPoiName = selectedPoi
    ? readPoiValue(selectedPoi.properties, ["name"])
    : "";
  const selectedPoiKindLabel = selectedPoi
    ? formatKindLabel(
        readPoiValue(selectedPoi.properties, ["kind", "kindCanonical", "type"])
      )
    : "";
  const selectedPoiOsmId = selectedPoi
    ? readPoiValue(selectedPoi.properties, ["osm_id", "id"])
    : "";

  const selectedHexEstimateRaw = selectedHex
    ? Number(selectedHex.properties?.estimated ?? 0)
    : 0;
  const selectedHexEstimate =
    isFinite(selectedHexEstimateRaw) && selectedHexEstimateRaw > 0
      ? selectedHexEstimateRaw
      : 0;
  const selectedHexPoiCounts = useMemo(() => {
    const raw = (selectedHex?.properties?.poiCounts ?? {}) as Record<string, any>;
    return normalizePoiCounts(raw);
  }, [selectedHex]);
  const selectedHexNonZeroCounts = useMemo(
    () => ALL_POI_KINDS
      .map((kind) => ({ kind, count: selectedHexPoiCounts[kind] ?? 0 }))
      .filter((entry) => entry.count > 0),
    [selectedHexPoiCounts]
  );
  const selectedHexHasNoPlaces = selectedHexNonZeroCounts.length === 0;
  const selectedHexInsidePois = (selectedHex?.properties?.poisInside ??
    selectedHex?.properties?._insidePois ??
    []) as Array<{ name: string; kind: PoiKind; osmId: string }>;
  const selectedHexInsidePoisDisplay = selectedHexInsidePois.slice(0, 6);
  const selectedHexInsidePoiTotal = Number(
    selectedHex?.properties?.poisInsideTotal ??
    selectedHex?.properties?._insidePoiTotal ??
    selectedHexInsidePois.length
  );
  const selectedHexInsidePoiRemainder = Math.max(
    0,
    selectedHexInsidePoiTotal - selectedHexInsidePoisDisplay.length
  );
  const selectedHexTier = selectedHex
    ? String(selectedHex.properties?.tier ?? "").trim() || "minimal"
    : "minimal";
  const selectedHexTierLabel = kindLabel(selectedHexTier);
  const selectedHexResolutionRaw = selectedHex
    ? Number(selectedHex.properties?.resolution ?? currentRes)
    : currentRes;
  const selectedHexResolution = isFinite(selectedHexResolutionRaw)
    ? selectedHexResolutionRaw
    : currentRes;
  const selectedHexGreedLevelRaw = selectedHex
    ? Number(selectedHex.properties?.greedLevel ?? NaN)
    : NaN;
  const selectedHexGreedLevel = isFinite(selectedHexGreedLevelRaw)
    ? clamp(Math.round(selectedHexGreedLevelRaw), 0, 100)
    : greedLevelFromEstimated(selectedHexEstimate, selectedHexResolution);
  const selectedHexGreedBin = greedBinForLevel(selectedHexGreedLevel);

  return (
    <div className="h-full w-full">
      <div className="relative h-full w-full overflow-hidden" style={{ backgroundColor: COLORS.background }}>
        <MapView
        ref={mapRef}
        mapStyle={MAP_STYLE}
        style={{ width: "100%", height: "100%" }}
        initialViewState={{
          longitude: center[0],
          latitude: center[1],
          zoom: initialUrlState.zoom,
        }}
        minZoom={2.2}
        maxZoom={14}
        maxBounds={REGION_MAX_BOUNDS as any}
        renderWorldCopies={false}
        dragRotate={false}
        touchPitch={false}
        pitchWithRotate={false}
        onLoad={() => {
          setMapError(null);
          if (!initialUrlState.hasView) fitToCONUS();
          updateViewport();
          window.setTimeout(updateViewport, 0);
        }}
        onMove={updateHexResolution}
        onMoveEnd={updateViewport}
        onClick={onMapClick}
        onError={(e: any) => {
          const message = String(e?.error?.message ?? e?.error ?? e);
          setMapError(message);
          console.error("Map error", e);
        }}
        interactiveLayerIds={interactiveLayerIds}
        attributionControl={false}
      >
        <div className="absolute right-3 top-3 z-10">
          <NavigationControl visualizePitch={false} showCompass={false} />
        </div>

        {/* Neighbor countries */}
        <Source id="can" type="geojson" data={CAN_GEOJSON_URL as any}>
          <Layer {...({ id: "can-fill", type: "fill", source: "can", paint: { "fill-color": COLORS.country, "fill-opacity": 1 } } as any)} />
          <Layer {...borderLine("can-border", "can")} />
        </Source>

        <Source id="mex" type="geojson" data={MEX_GEOJSON_URL as any}>
          <Layer {...({ id: "mex-fill", type: "fill", source: "mex", paint: { "fill-color": COLORS.country, "fill-opacity": 1 } } as any)} />
          <Layer {...borderLine("mex-border", "mex")} />
        </Source>

        {/* USA fill */}
        <Source id="usa" type="geojson" data={USA_GEOJSON_URL as any}>
          <Layer {...usaFill} />
        </Source>

        {/* Rivers + roads */}
        <Source
          id="omt"
          type="vector"
          url={OMT_VECTOR_SOURCE.url}
        >
          <Layer {...riversLayer} />
          <Layer {...roadsPrimaryAndHighways} />
          <Layer {...roadsLocal} />
        </Source>

        {/* State borders */}
        {statesGeoJson && (
          <Source id="states" type="geojson" data={statesGeoJson as any}>
            <Layer {...stateBorders} />
          </Source>
        )}

        {/* USA border */}
        <Source id="usa-border-src" type="geojson" data={USA_GEOJSON_URL as any}>
          <Layer {...borderLine("usa-border", "usa-border-src")} />
        </Source>

        {/* "UNITED STATES" label */}
        <Source id="us-label" type="geojson" data={US_LABEL_POINT as any}>
          <Layer {...usLabelLayer} />
        </Source>

        {/* Presence (single active resolution; STRICT 3-level switch in getHexRes) */}
        {layer === "presence" && (
          <>
            {hexFC && (
              <Source id="presence-hex" type="geojson" data={hexFC as any}>
                <Layer {...hexFillLayer} />
                <Layer {...hexBorderLayer} />
              </Source>
            )}
            {selectedHex && (
              <Source
                id={PRESENCE_HEX_SELECTED_SOURCE_ID}
                type="geojson"
                data={selectedHexOutlineFC as any}
              >
                <Layer {...selectedHexBorderLayer} />
              </Source>
            )}
            {townPlacesVisible && (
              <Source id={POI_SOURCE_ID} type="geojson" data={visiblePoisFC as any}>
                <Layer {...poiDotsLayer} />
              </Source>
            )}
          </>
        )}

        {selectedPoi && (
          <Popup
            longitude={selectedPoi.longitude}
            latitude={selectedPoi.latitude}
            anchor="top"
            offset={12}
            closeOnClick={false}
            onClose={() => setSelectedPoi(null)}
            maxWidth="320px"
          >
            <div className="space-y-1 text-[11px] leading-4 text-[#111]">
              {selectedPoiName && <div className="font-semibold">{selectedPoiName}</div>}
              <div>
                <span className="text-[#555]">Kind:</span> {selectedPoiKindLabel}
              </div>
              {selectedPoiOsmId && (
                <div>
                  <span className="text-[#555]">OSM ID:</span> {selectedPoiOsmId}
                </div>
              )}
            </div>
          </Popup>
        )}

        {selectedHex && (
          <Popup
            longitude={selectedHex.longitude}
            latitude={selectedHex.latitude}
            anchor="top"
            offset={12}
            closeOnClick={false}
            onClose={() => setSelectedHex(null)}
            maxWidth="290px"
          >
            <div className="w-[264px] space-y-2 text-[11px] leading-4 text-[#111]">
              <div className="border-b border-black/10 pb-1">
                <div className="text-[12px] font-semibold">Greed Level Hex</div>
              </div>

              <div className="rounded-md border border-black/10 bg-black/[0.03] px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wide text-[#666]">Greed Level</div>
                <div className="mt-0.5 flex items-baseline justify-between gap-2">
                  <div className="text-[20px] font-semibold leading-none">
                    {selectedHexGreedLevel}/100
                  </div>
                  <div className="text-right text-[10px] text-[#666]">
                    <div className="font-semibold text-[#444]">{selectedHexGreedBin.label}</div>
                    <div>
                      {selectedHexGreedBin.min}-{selectedHexGreedBin.max}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-baseline gap-2">
                <div className="text-[17px] font-semibold leading-none">
                  {selectedHexEstimate.toLocaleString()}
                </div>
                <div className="text-[10px] text-[#666]">Estimated Jews</div>
              </div>

              <div className="flex items-center justify-between border-b border-black/10 pb-1 text-[10px] text-[#666]">
                <span>Tier: {selectedHexTierLabel}</span>
                <span>Res: {selectedHexResolution}</span>
              </div>

              <div className="space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-[#666]">Places</div>
                {selectedHexHasNoPlaces ? (
                  <div className="text-[#555]">No places found in this hex.</div>
                ) : (
                  <div className="space-y-0.5">
                    {selectedHexNonZeroCounts.map((entry) => (
                      <div key={entry.kind} className="flex items-center justify-between">
                        <span>{kindLabel(entry.kind)}</span>
                        <span className="font-medium">{entry.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {!selectedHexHasNoPlaces && selectedHexInsidePoisDisplay.length > 0 && (
                <div className="space-y-1 border-t border-black/10 pt-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-[#666]">POIs inside</div>
                  <ul className="list-disc space-y-1 pl-4">
                    {selectedHexInsidePoisDisplay.map((poi, idx) => (
                      <li key={`${poi.kind}-${poi.name}-${idx}`} className="text-[11px]">
                        <span className="font-semibold">{poi.name}</span>{" "}
                        <span className="rounded-full border border-black/15 bg-black/5 px-1.5 py-[1px] text-[9px] uppercase tracking-wide text-[#555]">
                          {kindLabel(poi.kind)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {selectedHexInsidePoiRemainder > 0 && (
                    <div className="text-[10px] text-[#666]">+{selectedHexInsidePoiRemainder} more</div>
                  )}
                </div>
              )}
            </div>
          </Popup>
        )}
      </MapView>

      {mapError && (
        <div className="pointer-events-none absolute right-3 top-16 z-40 max-w-[340px] rounded-md border border-red-500/40 bg-red-900/80 px-3 py-2 text-xs text-red-100 shadow-lg">
          <div className="font-semibold">Map failed to load</div>
          <div className="mt-0.5 break-words">{mapError}</div>
        </div>
      )}

      {/* Combined Presence + Places Panel */}
      <div className="pointer-events-none absolute left-4 top-4 z-30">
        <div className="pointer-events-auto w-full max-w-[264px] space-y-2 rounded-xl border border-white/10 bg-black/40 p-2.5 text-[11px] text-white/85 shadow-sm backdrop-blur">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-semibold tracking-wide text-white">Map Controls</div>
            <button
              type="button"
              className="rounded border border-white/15 bg-white/10 px-2 py-0.5 text-[10px] text-white/90 hover:bg-white/15"
              onClick={() => {
                setPlacesEnabled(true);
                setEnabledKinds([...ALL_POI_KINDS]);
                setPresenceOpen(true);
                setPlacesOpen(true);
              }}
            >
              Reset
            </button>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.03]">
            <button
              type="button"
              className="flex w-full items-center justify-between px-2 py-1.5 text-left text-[11px] font-semibold tracking-wide text-white"
              onClick={() => setPresenceOpen((v) => !v)}
            >
              <span>Greed Level</span>
              <span className="text-white/70">{presenceOpen ? "-" : "+"}</span>
            </button>
            {presenceOpen && (
              <div className="space-y-1.5 px-2 pb-2 text-[10px]">
                {HEX_LEVEL_BINS.map((bin) => (
                  <div key={`${bin.min}-${bin.max}`} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: bin.color }} />
                      <span>{bin.label}</span>
                    </div>
                    <span className="text-white/70">
                      {bin.min}-{bin.max}
                    </span>
                  </div>
                ))}
                <div className="pt-0.5 text-[10px] text-white/70">Score scale: 0-100 (green = low, red = high).</div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.03]">
            <button
              type="button"
              className="flex w-full items-center justify-between px-2 py-1.5 text-left text-[11px] font-semibold tracking-wide text-white"
              onClick={() => setPlacesOpen((v) => !v)}
            >
              <span>Places</span>
              <span className="text-white/70">{placesOpen ? "-" : "+"}</span>
            </button>
            {placesOpen && (
              <div className="space-y-1.5 px-2 pb-2">
                <label className="flex cursor-pointer items-center gap-2 text-[11px]">
                  <input
                    type="checkbox"
                    checked={placesEnabled}
                    onChange={(e) => setPlacesEnabled(e.target.checked)}
                  />
                  <span className="font-medium">Show Places</span>
                </label>
                <div className="space-y-1 text-[10px]">
                  {ALL_POI_KINDS.map((kind) => (
                    <label key={kind} className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={enabledKinds.includes(kind)}
                        onChange={(e) =>
                          setEnabledKinds((prev) => {
                            if (e.target.checked) {
                              const next = new Set(prev);
                              next.add(kind);
                              return ALL_POI_KINDS.filter((k) => next.has(k));
                            }
                            return prev.filter((k) => k !== kind);
                          })
                        }
                      />
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: POI_KIND_COLOR[kind] }}
                      />
                      <span>{POI_KIND_LABEL[kind]}</span>
                    </label>
                  ))}
                </div>
                <div className="pt-0.5 text-[10px] text-white/65">Visible at town tier only.</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="pointer-events-none absolute bottom-3 left-0 right-0 z-20 flex justify-center px-3">
        <div className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-center text-[11px] text-white/70 shadow-sm backdrop-blur">
          Greed Level is shown in broad tiers; infrastructure is aggregated and does not represent people. © OpenStreetMap contributors
        </div>
      </div>
    </div>
    </div>
  );
}











