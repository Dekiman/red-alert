import {
  AdditiveBlending,
  AmbientLight,
  BackSide,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineLoop,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  Object3D,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Raycaster,
  Scene,
  ShaderMaterial,
  ShapeUtils,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { feature as topojsonFeature, mesh as topojsonMesh } from "topojson-client";
import { getExplicitNewsCoordinates, usesPublisherCountryFallback } from "./news-event-location.js";
import { normalizeLocationText } from "./text-utils.js";
import type {
  AlertPayload,
  InferredPolygonStatePayload,
  NewsEventPayload,
  SystemMessagePayload
} from "./contracts.js";

const ALERT_GLOBE_RADIUS = 1.2;
const ALERT_GLOBE_CAMERA_RESET_DISTANCE = 3.65;
const ALERT_GLOBE_CAMERA_MIN_DISTANCE = 1.26;
const ALERT_GLOBE_CAMERA_MAX_DISTANCE = 7.2;
const ALERT_GLOBE_RENDER_RETRY_MS = 3000;
const ALERT_GLOBE_SIREN_DURATION_MS = 60_000;
const ALERT_GLOBE_UNSAFE_AUTO_CLEAR_MS = 15 * 60_000;
const ALERT_GLOBE_SAFE_FADE_DURATION_MS = 5 * 60_000;
const ALERT_GLOBE_NEWS_RECENCY_HOURS = 72;
const NEWS_REPLAY_APPEAR_GLOW_MS = 1200;
const WORLD_BOUNDARY_ALTITUDE = 0.014;
const SUN_MARKER_BASE_SCALE = 0.24;
const SUN_MARKER_SELECTED_SCALE = 0.36;
const SUN_MARKER_SURFACE_OFFSET = 0.5;
const DETAIL_BOUNDARY_ALTITUDE = WORLD_BOUNDARY_ALTITUDE + 0.0006;
const DETAIL_BOUNDARY_ADM1_DISTANCE_RATIO = 0.58;
const DETAIL_BOUNDARY_ADM2_DISTANCE_RATIO = 0.34;
const DETAIL_BOUNDARY_COUNTRY_THRESHOLD = 0.42;
const BOUNDARY_DETAIL_RETRY_COOLDOWN_MS = 5000;
const COUNTRY_LABEL_ALTITUDE = WORLD_BOUNDARY_ALTITUDE + 0.004;
const LOCALITY_POLYGON_ALTITUDE = 0.014;
const LOCALITY_POLYGON_MAX_SEGMENT_DEGREES = 0.05;
const LOCALITY_TRACE_ALTITUDE = LOCALITY_POLYGON_ALTITUDE;
const ALERT_POLYGON_FILL_ALTITUDE = LOCALITY_POLYGON_ALTITUDE;
const ALERT_POLYGON_OUTLINE_ALTITUDE = LOCALITY_POLYGON_ALTITUDE;
const ALERT_MARKER_ALTITUDE = 0.032;
const NEWS_MARKER_ALTITUDE = 0.014;
const NEWS_MARKER_FACING_BLEND_START = -0.94;
const NEWS_MARKER_FACING_BLEND_END = 0.18;
const NEWS_MARKER_BACKSIDE_OPACITY = 0.14;
const NEWS_MARKER_BACKSIDE_SCALE_FACTOR = 0.68;
const NEWS_MARKER_BACKSIDE_HALO_FACTOR = 0.22;
const NEWS_MARKER_CORE_RENDER_ORDER = 4;
const NEWS_MARKER_HALO_RENDER_ORDER = 3;
const NEWS_MARKER_CLUSTER_BASE_OFFSET = 0.018;
const NEWS_MARKER_CLUSTER_RING_STEP = 0.008;
const LOCALITIES_MAP_API_URL = "/api/localities-map";
const WORLD_TOPOLOGY_URL = "/assets/world-countries-50m.json";
const BOUNDARY_DETAIL_API_URL = "/api/boundary-details";

const COUNTRY_POSITION_OVERRIDES: Record<string, { lat: number; lng: number }> = {
  "United States": { lat: 39.6, lng: -98.6 }
};

const COUNTRY_TEXT_ALIAS_OVERRIDES: Record<string, string> = {
  "u s": "United States",
  us: "United States",
  america: "United States",
  "u k": "United Kingdom",
  uk: "United Kingdom",
  britain: "United Kingdom",
  "u a e": "United Arab Emirates",
  uae: "United Arab Emirates"
};

const STAGE = {
  PRE_ALERT: "pre_alert",
  ACTIVE_SIREN: "active_siren",
  POST_SIREN_UNSAFE: "post_siren_unsafe",
  SAFE_FADE: "safe_fade"
} as const;

const STAGE_STYLE = {
  [STAGE.PRE_ALERT]: {
    color: "#ffdd57",
    coreScale: 0.078,
    haloScale: 0.15,
    opacity: 0.92,
    pulseSpeed: 2.1
  },
  [STAGE.ACTIVE_SIREN]: {
    color: "#ff5837",
    coreScale: 0.11,
    haloScale: 0.22,
    opacity: 1,
    pulseSpeed: 3.2
  },
  [STAGE.POST_SIREN_UNSAFE]: {
    color: "#ff9a3d",
    coreScale: 0.086,
    haloScale: 0.16,
    opacity: 0.95,
    pulseSpeed: 1.85
  },
  [STAGE.SAFE_FADE]: {
    color: "#72d47d",
    coreScale: 0.074,
    haloScale: 0.13,
    opacity: 0.82,
    pulseSpeed: 1.2
  }
} as const;

const NEWS_CATEGORY_COLORS: Record<string, string> = {
  conflict: "#d95c47",
  missile: "#ff7043",
  strike: "#e85f5f",
  disaster: "#f3b54a",
  earthquake: "#d6c271",
  wildfire: "#ff8c42",
  flood: "#72b5a4",
  weather: "#7fb1bd",
  volcano: "#d06737"
};

const SAFE_PATTERNS = [
  "incident ended",
  "all clear",
  "safe to go out",
  "can leave shelter",
  "return to routine",
  "ניתן לצאת",
  "אפשר לצאת",
  "האירוע הסתיים",
  "חזרה לשגרה"
];

const PRE_ALERT_PATTERNS = [
  "in the next few minutes",
  "alerts are expected",
  "siren might go off",
  "be prepared",
  "stay near shelter",
  "בדקות הקרובות",
  "ייתכנו אזעקות",
  "סמיכות למרחב מוגן",
  "אין צורך להיכנס למרחב מוגן"
];

type GlobeElements = {
  globeContainer: HTMLDivElement | null;
  alertMapStatus: HTMLSpanElement | null;
  mapZoomInButton: HTMLButtonElement | null;
  mapZoomOutButton: HTMLButtonElement | null;
  mapZoomResetButton: HTMLButtonElement | null;
  onSelectionChanged?: (selection: GlobeSelection | null) => void;
};

export type GlobeSelection =
  | {
      kind: "news";
      newsEvent: NewsEventPayload;
    }
  | {
      kind: "celestial";
      id: "sun" | "moon";
      title: string;
      summary: string;
    };

type GeoPoint = [number, number];

type GeoCoordinates = {
  lat: number;
  lng: number;
};

type LocalityMapPayload = {
  localities?: Array<{
    id?: number;
    key?: string;
    he?: string;
    en?: string;
    lat?: number;
    lng?: number;
    polygon?: GeoPoint[];
  }>;
};

type LocalityMeta = {
  id: number;
  lat: number;
  lng: number;
  displayName: string;
  polygon: GeoPoint[];
};

type AlertStageState = {
  stage: string;
  alertStartedAtMs: number;
  stageStartedAtMs: number;
  sirenEndsAtMs: number | null;
  safeRequestedAtMs: number | null;
  safeFadeEndsAtMs: number | null;
};

type GlobeMarker = {
  container: Group;
  core: Sprite;
  halo: Sprite;
  phase: number;
};

type NewsMarkerRecord = {
  marker: GlobeMarker;
  newsEvent: NewsEventPayload;
  surfaceOffsetX: number;
  surfaceOffsetY: number;
  replayPulseStartedAtMs: number | null;
};

type AlertOverlay = {
  container: Group;
  marker: GlobeMarker;
  fillMesh: Mesh | null;
  outline: LineLoop | null;
  hasPolygon: boolean;
};

type CountryLabelRecord = {
  countryName: string;
  sprite: Sprite;
  surfaceNormal: Vector3;
  centroidLat: number;
  centroidLng: number;
  baseScale: number;
  aspectRatio: number;
  importance: number;
};

type BoundaryDetailPayload = {
  ok?: boolean;
  source?: string;
  countryName?: string;
  matchedBoundaryName?: string;
  boundaryISO?: string;
  level?: "ADM1" | "ADM2" | string;
  featureCollection?: {
    type?: string;
    features?: Array<{
      geometry?: {
        type?: string;
        coordinates?: any;
      };
    }>;
  } | null;
};

type ResolvedNewsMarkerCoordinates = {
  newsEvent: NewsEventPayload;
  markerCoordinates: GeoCoordinates;
};

function clampNumber(value: number, minValue: number, maxValue: number) {
  return Math.min(Math.max(value, minValue), maxValue);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeLongitude(longitude: number) {
  let nextLongitude = longitude;
  while (nextLongitude <= -180) {
    nextLongitude += 360;
  }
  while (nextLongitude > 180) {
    nextLongitude -= 360;
  }
  return nextLongitude;
}

function normalizeDegrees(value: number) {
  let nextValue = value % 360;
  if (nextValue < 0) {
    nextValue += 360;
  }
  return nextValue;
}

function sineDegrees(value: number) {
  return Math.sin(MathUtils.degToRad(value));
}

function cosineDegrees(value: number) {
  return Math.cos(MathUtils.degToRad(value));
}

function tangentDegrees(value: number) {
  return Math.tan(MathUtils.degToRad(value));
}

function toJulianDay(nowMs: number) {
  return nowMs / 86_400_000 + 2_440_587.5;
}

function toJulianCenturies(julianDay: number) {
  return (julianDay - 2_451_545) / 36_525;
}

function getGreenwichMeanSiderealTimeDegrees(julianDay: number) {
  const julianCenturies = toJulianCenturies(julianDay);
  return normalizeDegrees(
    280.46061837 +
      360.98564736629 * (julianDay - 2_451_545) +
      0.000387933 * julianCenturies * julianCenturies -
      (julianCenturies * julianCenturies * julianCenturies) / 38_710_000
  );
}

function latLngToVector3(lat: number, lng: number, radius: number) {
  const latRad = MathUtils.degToRad(lat);
  const lngRad = MathUtils.degToRad(lng);
  const cosLat = Math.cos(latRad);
  return new Vector3(
    radius * cosLat * Math.sin(lngRad),
    radius * Math.sin(latRad),
    radius * cosLat * Math.cos(lngRad)
  );
}

function getSurfaceTangentBasis(surfaceNormal: Vector3) {
  const referenceAxis = Math.abs(surfaceNormal.y) > 0.92 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
  const tangent = new Vector3().crossVectors(referenceAxis, surfaceNormal).normalize();
  const bitangent = new Vector3().crossVectors(surfaceNormal, tangent).normalize();
  return { tangent, bitangent };
}

function latLngToOffsetSurfaceVector3(
  lat: number,
  lng: number,
  radius: number,
  surfaceOffsetX = 0,
  surfaceOffsetY = 0
) {
  const position = latLngToVector3(lat, lng, radius);
  if (surfaceOffsetX === 0 && surfaceOffsetY === 0) {
    return position;
  }

  const surfaceNormal = position.clone().normalize();
  const { tangent, bitangent } = getSurfaceTangentBasis(surfaceNormal);

  return position
    .addScaledVector(tangent, surfaceOffsetX)
    .addScaledVector(bitangent, surfaceOffsetY)
    .normalize()
    .multiplyScalar(radius);
}

function getGreatCircleDistanceDegrees(latA: number, lngA: number, latB: number, lngB: number) {
  const pointA = latLngToVector3(latA, lngA, 1).normalize();
  const pointB = latLngToVector3(latB, lngB, 1).normalize();
  return MathUtils.radToDeg(pointA.angleTo(pointB));
}

function getNewsMarkerCoordinateKey(coordinates: GeoCoordinates) {
  return `${coordinates.lat.toFixed(6)}:${coordinates.lng.toFixed(6)}`;
}

function compareNewsEventsByTimestampAscending(left: NewsEventPayload, right: NewsEventPayload) {
  const leftTimestamp = String(left.updatedAtIso ?? left.createdAtIso ?? "");
  const rightTimestamp = String(right.updatedAtIso ?? right.createdAtIso ?? "");
  if (leftTimestamp !== rightTimestamp) {
    return leftTimestamp.localeCompare(rightTimestamp);
  }

  return String(left.eventId ?? "").localeCompare(String(right.eventId ?? ""));
}

function getClusteredNewsMarkerSurfaceOffset(index: number) {
  if (index <= 0) {
    return { x: 0, y: 0 };
  }

  let remaining = index - 1;
  let ring = 1;
  while (remaining >= ring * 6) {
    remaining -= ring * 6;
    ring += 1;
  }

  const slots = ring * 6;
  const angle = (remaining / slots) * Math.PI * 2 + (ring % 2 === 0 ? Math.PI / slots : 0);
  const radius = NEWS_MARKER_CLUSTER_BASE_OFFSET + (ring - 1) * NEWS_MARKER_CLUSTER_RING_STEP;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius
  };
}

function buildNewsMarkerSurfaceOffsets(resolvedNewsMarkers: ResolvedNewsMarkerCoordinates[]) {
  const offsets = new Map<string, { x: number; y: number }>();
  const markersByCoordinateKey = new Map<string, ResolvedNewsMarkerCoordinates[]>();

  for (const resolvedNewsMarker of resolvedNewsMarkers) {
    const key = getNewsMarkerCoordinateKey(resolvedNewsMarker.markerCoordinates);
    const group = markersByCoordinateKey.get(key) ?? [];
    group.push(resolvedNewsMarker);
    markersByCoordinateKey.set(key, group);
  }

  for (const group of markersByCoordinateKey.values()) {
    const orderedGroup = [...group].sort((left, right) =>
      compareNewsEventsByTimestampAscending(left.newsEvent, right.newsEvent)
    );
    orderedGroup.forEach((resolvedNewsMarker, index) => {
      offsets.set(resolvedNewsMarker.newsEvent.eventId, getClusteredNewsMarkerSurfaceOffset(index));
    });
  }

  return offsets;
}

function isObjectTreeVisible(object: Object3D | null) {
  let current: Object3D | null = object;
  while (current) {
    if (!current.visible) {
      return false;
    }
    current = current.parent;
  }
  return true;
}

function createSoftMarkerTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("failed to create marker texture");
  }

  const gradient = context.createRadialGradient(64, 64, 8, 64, 64, 60);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.32, "rgba(255,255,255,0.92)");
  gradient.addColorStop(0.6, "rgba(255,255,255,0.28)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function createSolidCircleTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("failed to create circle texture");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.beginPath();
  context.arc(64, 64, 24, 0, Math.PI * 2);
  context.fillStyle = "#ffffff";
  context.fill();

  context.beginPath();
  context.arc(64, 64, 24, 0, Math.PI * 2);
  context.lineWidth = 7;
  context.strokeStyle = "rgba(14, 10, 8, 0.88)";
  context.stroke();

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function createRingTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("failed to create ring texture");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.beginPath();
  context.arc(64, 64, 34, 0, Math.PI * 2);
  context.lineWidth = 8;
  context.strokeStyle = "#ffffff";
  context.stroke();

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function createCelestialDotTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("failed to create celestial dot texture");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  const glowGradient = context.createRadialGradient(64, 64, 10, 64, 64, 46);
  glowGradient.addColorStop(0, "rgba(255, 255, 255, 0.95)");
  glowGradient.addColorStop(0.48, "rgba(255, 255, 255, 0.36)");
  glowGradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.beginPath();
  context.arc(64, 64, 46, 0, Math.PI * 2);
  context.fillStyle = glowGradient;
  context.fill();
  context.beginPath();
  context.arc(64, 64, 35, 0, Math.PI * 2);
  context.lineWidth = 6;
  context.strokeStyle = "rgba(18, 12, 7, 0.9)";
  context.stroke();
  context.beginPath();
  context.arc(64, 64, 29, 0, Math.PI * 2);
  context.fillStyle = "#ffffff";
  context.fill();
  context.beginPath();
  context.arc(64, 64, 29, 0, Math.PI * 2);
  context.lineWidth = 3;
  context.strokeStyle = "rgba(255, 255, 255, 0.95)";
  context.stroke();

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function createCelestialRingTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("failed to create celestial ring texture");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.beginPath();
  context.arc(64, 64, 27, 0, Math.PI * 2);
  context.lineWidth = 7;
  context.strokeStyle = "rgba(18, 12, 7, 0.82)";
  context.stroke();
  context.beginPath();
  context.arc(64, 64, 21, 0, Math.PI * 2);
  context.lineWidth = 4;
  context.strokeStyle = "#ffffff";
  context.stroke();

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function createCountryLabelTexture(label: string) {
  const fontSize = 42;
  const paddingX = 26;
  const paddingY = 16;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("failed to create country label texture");
  }

  context.font = `600 ${fontSize}px "Trebuchet MS", "Gill Sans", sans-serif`;
  const measuredWidth = Math.ceil(context.measureText(label).width);
  canvas.width = Math.max(96, measuredWidth + paddingX * 2);
  canvas.height = Math.max(56, fontSize + paddingY * 2);

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = `600 ${fontSize}px "Trebuchet MS", "Gill Sans", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.lineWidth = 12;
  context.strokeStyle = "rgba(11, 8, 6, 0.84)";
  context.strokeText(label, canvas.width / 2, canvas.height / 2 + 2);
  context.fillStyle = "#f3e4cd";
  context.fillText(label, canvas.width / 2, canvas.height / 2 + 2);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return {
    texture,
    aspectRatio: canvas.width / canvas.height
  };
}

function getDisplayCountryLabel(countryName: string) {
  const normalized = countryName.trim();
  if (normalized === "Palestine" || normalized === "State of Palestine") {
    return "Judea and Samaria";
  }
  if (normalized === "United States of America") {
    return "United States";
  }
  return normalized;
}

function getCountryAnchorLatLng(countryName: string, fallbackLat: number, fallbackLng: number): GeoCoordinates {
  const normalizedCountryName = getDisplayCountryLabel(countryName);
  const override = COUNTRY_POSITION_OVERRIDES[normalizedCountryName];
  if (override) {
    return override;
  }
  return {
    lat: fallbackLat,
    lng: fallbackLng
  };
}

function getCountryLookupCandidates(countryText: unknown) {
  const value = String(countryText ?? "").trim();
  if (!value) {
    return [] as string[];
  }

  const candidates = new Set<string>();
  const addCandidate = (candidateValue: string) => {
    const normalizedCandidate = normalizeAlias(getDisplayCountryLabel(candidateValue));
    if (normalizedCandidate) {
      candidates.add(normalizedCandidate);
    }
  };

  addCandidate(value);
  for (const part of value.split(/[|,]/)) {
    addCandidate(part.trim());
  }

  return Array.from(candidates);
}

function sanitizeGeoRing(rawPolygon: unknown) {
  if (!Array.isArray(rawPolygon)) {
    return [] as GeoPoint[];
  }

  const ring: GeoPoint[] = [];
  for (const point of rawPolygon) {
    const latitude = Number(point?.[0]);
    const longitude = Number(point?.[1]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      continue;
    }

    const normalizedPoint: GeoPoint = [latitude, normalizeLongitude(longitude)];
    const previousPoint = ring[ring.length - 1];
    if (
      previousPoint &&
      Math.abs(previousPoint[0] - normalizedPoint[0]) < 0.000001 &&
      Math.abs(previousPoint[1] - normalizedPoint[1]) < 0.000001
    ) {
      continue;
    }
    ring.push(normalizedPoint);
  }

  if (ring.length >= 2) {
    const firstPoint = ring[0];
    const lastPoint = ring[ring.length - 1];
    if (
      Math.abs(firstPoint[0] - lastPoint[0]) < 0.000001 &&
      Math.abs(firstPoint[1] - lastPoint[1]) < 0.000001
    ) {
      ring.pop();
    }
  }

  return ring.length >= 3 ? ring : [];
}

function interpolateGeoRingPoint(start: GeoPoint, end: GeoPoint, ratio: number): GeoPoint {
  const startVector = latLngToVector3(start[0], start[1], 1).normalize();
  const endVector = latLngToVector3(end[0], end[1], 1).normalize();
  const angle = startVector.angleTo(endVector);
  if (angle <= 0.000001) {
    return [...start];
  }

  const sinAngle = Math.sin(angle);
  const startWeight = Math.sin((1 - ratio) * angle) / sinAngle;
  const endWeight = Math.sin(ratio * angle) / sinAngle;
  const surfacePoint = startVector
    .clone()
    .multiplyScalar(startWeight)
    .addScaledVector(endVector, endWeight)
    .normalize();
  const interpolated = vector3ToLatLng(surfacePoint);
  return [interpolated.lat, interpolated.lng];
}

function densifyGeoRing(ring: GeoPoint[], maxSegmentDegrees: number) {
  if (ring.length < 3) {
    return ring;
  }

  const densified: GeoPoint[] = [];
  for (let index = 0; index < ring.length; index += 1) {
    const startPoint = ring[index];
    const endPoint = ring[(index + 1) % ring.length];
    densified.push(startPoint);

    const segmentDegrees = getGreatCircleDistanceDegrees(startPoint[0], startPoint[1], endPoint[0], endPoint[1]);
    const segments = Math.min(6, Math.max(1, Math.ceil(segmentDegrees / maxSegmentDegrees)));
    for (let step = 1; step < segments; step += 1) {
      densified.push(interpolateGeoRingPoint(startPoint, endPoint, step / segments));
    }
  }

  return sanitizeGeoRing(densified);
}

function splitLineAtDateBoundary(coordinates: number[][]) {
  const segments: number[][][] = [];
  let currentSegment: number[][] = [];

  for (const coordinate of coordinates) {
    const longitude = Number(coordinate?.[0]);
    const latitude = Number(coordinate?.[1]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      continue;
    }

    const normalizedLongitude = normalizeLongitude(longitude);
    const lastCoordinate = currentSegment[currentSegment.length - 1];
    if (lastCoordinate && Math.abs(normalizedLongitude - lastCoordinate[0]) > 180) {
      if (currentSegment.length >= 2) {
        segments.push(currentSegment);
      }
      currentSegment = [];
    }

    currentSegment.push([normalizedLongitude, latitude]);
  }

  if (currentSegment.length >= 2) {
    segments.push(currentSegment);
  }

  return segments;
}

function buildLineFromCoordinates(coordinates: number[][], radius: number, material: LineBasicMaterial) {
  const positions: number[] = [];
  for (const coordinate of coordinates) {
    const longitude = Number(coordinate?.[0]);
    const latitude = Number(coordinate?.[1]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      continue;
    }
    const point = latLngToVector3(latitude, longitude, radius);
    positions.push(point.x, point.y, point.z);
  }

  if (positions.length < 6) {
    return null;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  return new Line(geometry, material);
}

function buildLoopFromCoordinates(coordinates: number[][], radius: number, material: LineBasicMaterial) {
  const normalizedCoordinates = [...coordinates];
  if (normalizedCoordinates.length >= 2) {
    const first = normalizedCoordinates[0];
    const last = normalizedCoordinates[normalizedCoordinates.length - 1];
    if (
      Math.abs(Number(first?.[0]) - Number(last?.[0])) < 0.000001 &&
      Math.abs(Number(first?.[1]) - Number(last?.[1])) < 0.000001
    ) {
      normalizedCoordinates.pop();
    }
  }

  const positions: number[] = [];
  for (const coordinate of normalizedCoordinates) {
    const longitude = Number(coordinate?.[0]);
    const latitude = Number(coordinate?.[1]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      continue;
    }
    const point = latLngToVector3(latitude, longitude, radius);
    positions.push(point.x, point.y, point.z);
  }

  if (positions.length < 9) {
    return null;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  return new LineLoop(geometry, material);
}

function addPolylineCoordinatesToGroup(
  group: Group,
  coordinatesCollection: number[][][],
  radius: number,
  material: LineBasicMaterial
) {
  for (const borderLine of coordinatesCollection) {
    for (const segment of splitLineAtDateBoundary(borderLine)) {
      const line = buildLineFromCoordinates(segment, radius, material);
      if (line) {
        line.renderOrder = 4;
        group.add(line);
      }
    }
  }
}

function addRingCoordinatesToGroup(group: Group, ringCoordinates: number[][], radius: number, material: LineBasicMaterial) {
  const normalizedRing = ringCoordinates
    .map((coordinate) => [normalizeLongitude(Number(coordinate?.[0])), Number(coordinate?.[1])])
    .filter((coordinate) => Number.isFinite(coordinate[0]) && Number.isFinite(coordinate[1]));

  if (normalizedRing.length < 4) {
    return;
  }

  const segments = splitLineAtDateBoundary(normalizedRing);
  if (segments.length <= 1) {
    const loop = buildLoopFromCoordinates(normalizedRing, radius, material);
    if (loop) {
      loop.renderOrder = 4;
      group.add(loop);
    }
    return;
  }

  for (const segment of segments) {
    const line = buildLineFromCoordinates(segment, radius, material);
    if (line) {
      line.renderOrder = 4;
      group.add(line);
    }
  }
}

function extractCountryRings(topology: any, objectKey: string) {
  const collection = topojsonFeature(topology, topology.objects[objectKey]) as {
    type?: string;
    features?: Array<{ geometry?: { type?: string; coordinates?: any } }>;
  };
  const rings: number[][][] = [];

  for (const feature of collection.features ?? []) {
    const geometry = feature.geometry;
    if (!geometry) {
      continue;
    }

    if (geometry.type === "Polygon") {
      for (const ring of geometry.coordinates ?? []) {
        if (Array.isArray(ring)) {
          rings.push(ring);
        }
      }
      continue;
    }

    if (geometry.type === "MultiPolygon") {
      for (const polygon of geometry.coordinates ?? []) {
        for (const ring of polygon ?? []) {
          if (Array.isArray(ring)) {
            rings.push(ring);
          }
        }
      }
    }
  }

  return rings;
}

function getGeometryCentroid(geometry: any) {
  let x = 0;
  let y = 0;
  let z = 0;
  let pointCount = 0;

  function visitCoordinates(candidate: unknown) {
    if (!Array.isArray(candidate)) {
      return;
    }

    if (
      candidate.length >= 2 &&
      typeof candidate[0] !== "object" &&
      typeof candidate[1] !== "object"
    ) {
      const longitude = Number(candidate[0]);
      const latitude = Number(candidate[1]);
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        return;
      }

      const latitudeRadians = MathUtils.degToRad(latitude);
      const longitudeRadians = MathUtils.degToRad(longitude);
      const cosLatitude = Math.cos(latitudeRadians);
      x += cosLatitude * Math.cos(longitudeRadians);
      y += cosLatitude * Math.sin(longitudeRadians);
      z += Math.sin(latitudeRadians);
      pointCount += 1;
      return;
    }

    for (const child of candidate) {
      visitCoordinates(child);
    }
  }

  visitCoordinates(geometry?.coordinates);
  if (pointCount === 0) {
    return null;
  }

  const averageX = x / pointCount;
  const averageY = y / pointCount;
  const averageZ = z / pointCount;
  const hypotenuse = Math.sqrt(averageX * averageX + averageY * averageY);

  return {
    lat: MathUtils.radToDeg(Math.atan2(averageZ, hypotenuse)),
    lng: MathUtils.radToDeg(Math.atan2(averageY, averageX)),
    pointCount
  };
}

function buildWorldBoundaryGroup(topology: any, radius: number) {
  const group = new Group();
  const objectKey =
    topology?.objects?.countries != null
      ? "countries"
      : Object.keys(topology?.objects ?? {}).find((key) => typeof topology?.objects?.[key] === "object");

  if (!objectKey) {
    return group;
  }

  const coastlineMaterial = new LineBasicMaterial({
    color: new Color("#f5dcb8"),
    transparent: true,
    opacity: 0.46,
    depthWrite: false
  });
  const borderAccentMaterial = new LineBasicMaterial({
    color: new Color("#fff0d7"),
    transparent: true,
    opacity: 0.18,
    depthWrite: false
  });

  for (const ring of extractCountryRings(topology, objectKey)) {
    addRingCoordinatesToGroup(group, ring, radius, coastlineMaterial);
  }

  const interiorBorders = topojsonMesh(
    topology,
    topology.objects[objectKey],
    (left, right) => left !== right
  ) as { coordinates?: number[][][] };

  addPolylineCoordinatesToGroup(group, interiorBorders?.coordinates ?? [], radius, borderAccentMaterial);

  return group;
}

function addGeoJsonBoundaryGeometryToGroup(
  group: Group,
  geometry: { type?: string; coordinates?: any } | null | undefined,
  radius: number,
  material: LineBasicMaterial
) {
  if (!geometry) {
    return;
  }

  if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates ?? []) {
      if (Array.isArray(ring)) {
        addRingCoordinatesToGroup(group, ring, radius, material);
      }
    }
    return;
  }

  if (geometry.type === "MultiPolygon") {
    for (const polygon of geometry.coordinates ?? []) {
      for (const ring of polygon ?? []) {
        if (Array.isArray(ring)) {
          addRingCoordinatesToGroup(group, ring, radius, material);
        }
      }
    }
  }
}

function buildBoundaryDetailGroup(payload: BoundaryDetailPayload, radius: number) {
  const group = new Group();
  const level = String(payload.level ?? "").toUpperCase();
  const material = new LineBasicMaterial({
    color: new Color(level === "ADM2" ? "#bfb59c" : "#ead8b8"),
    transparent: true,
    opacity: level === "ADM2" ? 0.18 : 0.32,
    depthWrite: false
  });

  for (const feature of payload.featureCollection?.features ?? []) {
    addGeoJsonBoundaryGeometryToGroup(group, feature?.geometry, radius, material);
  }

  for (const child of group.children) {
    child.renderOrder = 5;
  }

  return group;
}

function vector3ToLatLng(vector: Vector3) {
  const normalized = vector.clone().normalize();
  const latitude = MathUtils.radToDeg(
    Math.atan2(normalized.y, Math.sqrt(normalized.x * normalized.x + normalized.z * normalized.z))
  );
  const longitude = MathUtils.radToDeg(Math.atan2(normalized.x, normalized.z));
  return {
    lat: latitude,
    lng: normalizeLongitude(longitude)
  };
}

function buildSphericalPolygonGeometryFromWorldRing(ringCoordinates: number[][], radius: number, altitude: number) {
  const normalizedRing = ringCoordinates
    .map((coordinate) => [normalizeLongitude(Number(coordinate?.[0])), Number(coordinate?.[1])] as const)
    .filter((coordinate) => Number.isFinite(coordinate[0]) && Number.isFinite(coordinate[1]));

  if (normalizedRing.length < 4) {
    return null;
  }

  const contourCoordinates = [...normalizedRing];
  const first = contourCoordinates[0];
  const last = contourCoordinates[contourCoordinates.length - 1];
  if (
    first &&
    last &&
    Math.abs(first[0] - last[0]) < 0.000001 &&
    Math.abs(first[1] - last[1]) < 0.000001
  ) {
    contourCoordinates.pop();
  }

  if (contourCoordinates.length < 3) {
    return null;
  }

  const anchorLongitude = contourCoordinates[0][0];
  const unwrappedCoordinates = contourCoordinates.map(([longitude, latitude]) => {
    let nextLongitude = longitude;
    while (nextLongitude - anchorLongitude > 180) {
      nextLongitude -= 360;
    }
    while (nextLongitude - anchorLongitude < -180) {
      nextLongitude += 360;
    }
    return [nextLongitude, latitude] as const;
  });

  const surfacePoints = unwrappedCoordinates.map(([longitude, latitude]) =>
    latLngToVector3(latitude, longitude, radius + altitude)
  );

  const up = new Vector3();
  for (const point of surfacePoints) {
    up.add(point.clone().normalize());
  }
  if (up.lengthSq() === 0) {
    return null;
  }
  up.normalize();

  const reference = Math.abs(up.y) > 0.92 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  const tangent = new Vector3().crossVectors(reference, up).normalize();
  const bitangent = new Vector3().crossVectors(up, tangent).normalize();

  const contour = surfacePoints.map((point) => new Vector2(point.dot(tangent), point.dot(bitangent)));
  if (ShapeUtils.area(contour) < 0) {
    contour.reverse();
    surfacePoints.reverse();
  }

  let triangles: number[][];
  try {
    triangles = ShapeUtils.triangulateShape(contour, []);
  } catch {
    return null;
  }

  if (triangles.length === 0) {
    return null;
  }

  const positions: number[] = [];
  for (const triangle of triangles) {
    for (const vertexIndex of triangle) {
      const vertex = surfacePoints[vertexIndex];
      positions.push(vertex.x, vertex.y, vertex.z);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function buildCountryLabelRecords(topology: any, radius: number, textures: CanvasTexture[]) {
  const objectKey =
    topology?.objects?.countries != null
      ? "countries"
      : Object.keys(topology?.objects ?? {}).find((key) => typeof topology?.objects?.[key] === "object");
  if (!objectKey) {
    return [] as CountryLabelRecord[];
  }

  const collection = topojsonFeature(topology, topology.objects[objectKey]) as {
    features?: Array<{ properties?: { name?: string }; geometry?: any }>;
  };

  const records: CountryLabelRecord[] = [];
  for (const feature of collection.features ?? []) {
    const countryName = getDisplayCountryLabel(String(feature?.properties?.name ?? "").trim());
    if (!countryName || countryName === "Antarctica") {
      continue;
    }

    const centroid = getGeometryCentroid(feature?.geometry);
    if (!centroid || centroid.lat < -74) {
      continue;
    }
    const anchorLatLng = getCountryAnchorLatLng(countryName, centroid.lat, centroid.lng);

    const { texture, aspectRatio } = createCountryLabelTexture(countryName);
    const sprite = new Sprite(
      new SpriteMaterial({
        map: texture,
        transparent: true,
        opacity: 0,
        sizeAttenuation: true,
        depthWrite: false,
        depthTest: true,
        alphaTest: 0.08
      })
    );

    const baseScale = clampNumber(0.042 + Math.sqrt(centroid.pointCount) * 0.0017, 0.048, 0.112);
    const position = latLngToVector3(anchorLatLng.lat, anchorLatLng.lng, radius);
    sprite.position.copy(position);
    sprite.scale.set(baseScale * aspectRatio, baseScale, 1);
    sprite.renderOrder = 4;

    textures.push(texture);
    records.push({
      countryName,
      sprite,
      surfaceNormal: position.clone().normalize(),
      centroidLat: anchorLatLng.lat,
      centroidLng: anchorLatLng.lng,
      baseScale,
      aspectRatio,
      importance: centroid.pointCount
    });
  }

  return records;
}

function buildLocalityTraceGroup(localities: Iterable<LocalityMeta>, radius: number) {
  const group = new Group();
  const material = new LineBasicMaterial({
    color: new Color("#8c7860"),
    transparent: true,
    opacity: 0.18,
    depthWrite: false
  });

  for (const locality of localities) {
    const geometry = buildPolygonOutlineGeometry(locality.polygon, radius, LOCALITY_TRACE_ALTITUDE);
    if (!geometry) {
      continue;
    }
    const outline = new LineLoop(geometry, material);
    outline.renderOrder = 3;
    group.add(outline);
  }

  return group;
}

function buildGraticuleGroup(radius: number) {
  const group = new Group();
  const material = new LineBasicMaterial({
    color: new Color("#6d6254"),
    transparent: true,
    opacity: 0.1,
    depthWrite: false
  });

  for (let latitude = -75; latitude <= 75; latitude += 15) {
    const coordinates: number[][] = [];
    for (let longitude = -180; longitude <= 180; longitude += 3) {
      coordinates.push([longitude, latitude]);
    }
    const line = buildLineFromCoordinates(coordinates, radius, material);
    if (line) {
      group.add(line);
    }
  }

  for (let longitude = -165; longitude <= 180; longitude += 15) {
    const coordinates: number[][] = [];
    for (let latitude = -88; latitude <= 88; latitude += 3) {
      coordinates.push([longitude, latitude]);
    }
    const line = buildLineFromCoordinates(coordinates, radius, material);
    if (line) {
      group.add(line);
    }
  }

  return group;
}

function buildStarfield() {
  const geometry = new BufferGeometry();
  const positions: number[] = [];
  for (let index = 0; index < 1800; index += 1) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(MathUtils.randFloatSpread(2));
    const radius = MathUtils.randFloat(7.5, 11.5);
    positions.push(
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(theta)
    );
  }

  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  const material = new PointsMaterial({
    color: new Color("#ecdcc9"),
    size: 0.026,
    transparent: true,
    opacity: 0.68,
    depthWrite: false
  });
  return new Points(geometry, material);
}

function buildPolygonOutlineGeometry(ring: GeoPoint[], radius: number, altitude: number) {
  const sanitizedRing = sanitizeGeoRing(ring);
  if (sanitizedRing.length < 3) {
    return null;
  }

  const positions: number[] = [];
  for (const [latitude, longitude] of sanitizedRing) {
    const point = latLngToVector3(latitude, longitude, radius + altitude);
    positions.push(point.x, point.y, point.z);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  return geometry;
}

function buildSphericalPolygonGeometry(ring: GeoPoint[], radius: number, altitude: number) {
  const sanitizedRing = sanitizeGeoRing(ring);
  if (sanitizedRing.length < 3) {
    return null;
  }

  const surfacePoints = sanitizedRing.map(([latitude, longitude]) =>
    latLngToVector3(latitude, longitude, radius + altitude)
  );

  const up = new Vector3();
  for (const point of surfacePoints) {
    up.add(point.clone().normalize());
  }
  if (up.lengthSq() === 0) {
    return null;
  }
  up.normalize();

  const reference = Math.abs(up.y) > 0.92 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  const tangent = new Vector3().crossVectors(reference, up).normalize();
  const bitangent = new Vector3().crossVectors(up, tangent).normalize();

  const contour = surfacePoints.map((point) => new Vector2(point.dot(tangent), point.dot(bitangent)));
  if (ShapeUtils.area(contour) < 0) {
    contour.reverse();
    surfacePoints.reverse();
  }

  let triangles: number[][];
  try {
    triangles = ShapeUtils.triangulateShape(contour, []);
  } catch {
    return null;
  }

  if (triangles.length === 0) {
    return null;
  }

  const positions: number[] = [];
  for (const triangle of triangles) {
    for (const vertexIndex of triangle) {
      const vertex = surfacePoints[vertexIndex];
      positions.push(vertex.x, vertex.y, vertex.z);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function normalizeAlias(value: unknown) {
  return normalizeLocationText(value);
}

function classifySystemMessageKind(systemMessage: SystemMessagePayload | unknown) {
  const payload = systemMessage as Partial<SystemMessagePayload> | null;
  const hint = String(
    payload?.kind ?? payload?.instruction ?? payload?.instructionType ?? ""
  ).toLowerCase();

  if (hint.includes("safe") || hint.includes("all_clear") || hint.includes("incident_end")) {
    return "safe_to_go_out";
  }
  if (hint.includes("pre") || hint.includes("prepare") || hint.includes("early_warning")) {
    return "pre_alert";
  }

  const textParts = [
    ...(Array.isArray(payload?.textParts) ? payload.textParts : []),
    payload?.title ?? "",
    payload?.body ?? ""
  ]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" | ")
    .toLowerCase();

  if (SAFE_PATTERNS.some((pattern) => textParts.includes(pattern))) {
    return "safe_to_go_out";
  }
  if (PRE_ALERT_PATTERNS.some((pattern) => textParts.includes(pattern))) {
    return "pre_alert";
  }
  return "other";
}

function disposeMaterial(material: unknown) {
  if (Array.isArray(material)) {
    material.forEach((part) => disposeMaterial(part));
    return;
  }
  if (material && typeof material === "object" && "dispose" in material && typeof material.dispose === "function") {
    material.dispose();
  }
}

function disposeObjectTree(object: { traverse: (callback: (candidate: any) => void) => void }) {
  object.traverse((candidate) => {
    candidate.geometry?.dispose?.();
    disposeMaterial(candidate.material);
  });
}

function clearGroup(group: Group) {
  for (const child of [...group.children]) {
    group.remove(child);
    disposeObjectTree(child);
  }
}

function getSolarDirection(nowMs: number) {
  const julianDay = toJulianDay(nowMs);
  const julianCenturies = toJulianCenturies(julianDay);
  const meanLongitude = normalizeDegrees(
    280.46646 + 36_000.76983 * julianCenturies + 0.0003032 * julianCenturies * julianCenturies
  );
  const meanAnomaly = normalizeDegrees(
    357.52911 + 35_999.05029 * julianCenturies - 0.0001537 * julianCenturies * julianCenturies
  );
  const equationOfCenter =
    (1.914602 - 0.004817 * julianCenturies - 0.000014 * julianCenturies * julianCenturies) *
      sineDegrees(meanAnomaly) +
    (0.019993 - 0.000101 * julianCenturies) * sineDegrees(2 * meanAnomaly) +
    0.000289 * sineDegrees(3 * meanAnomaly);
  const trueLongitude = meanLongitude + equationOfCenter;
  const omega = 125.04 - 1_934.136 * julianCenturies;
  const apparentLongitude = trueLongitude - 0.00569 - 0.00478 * sineDegrees(omega);
  const meanObliquity =
    23 +
    (26 + (21.448 - 46.815 * julianCenturies - 0.00059 * julianCenturies * julianCenturies + 0.001813 * julianCenturies * julianCenturies * julianCenturies) / 60) / 60;
  const trueObliquity = meanObliquity + 0.00256 * cosineDegrees(omega);
  const rightAscension = MathUtils.radToDeg(
    Math.atan2(
      cosineDegrees(trueObliquity) * sineDegrees(apparentLongitude),
      cosineDegrees(apparentLongitude)
    )
  );
  const declination = MathUtils.radToDeg(
    Math.asin(sineDegrees(trueObliquity) * sineDegrees(apparentLongitude))
  );
  const greenwichSiderealTime = getGreenwichMeanSiderealTimeDegrees(julianDay);
  const subsolarLongitude = normalizeLongitude(rightAscension - greenwichSiderealTime);
  return latLngToVector3(declination, subsolarLongitude, 1).normalize();
}

function getMoonDirection(nowMs: number) {
  const julianDay = toJulianDay(nowMs);
  const daysSinceJ2000 = julianDay - 2_451_545;
  const meanLongitude = normalizeDegrees(218.316 + 13.176396 * daysSinceJ2000);
  const meanAnomaly = normalizeDegrees(134.963 + 13.064993 * daysSinceJ2000);
  const meanElongation = normalizeDegrees(297.85 + 12.190749 * daysSinceJ2000);
  const argumentOfLatitude = normalizeDegrees(93.272 + 13.22935 * daysSinceJ2000);
  const solarMeanAnomaly = normalizeDegrees(357.529 + 0.98560028 * daysSinceJ2000);

  const eclipticLongitude =
    meanLongitude +
    6.289 * sineDegrees(meanAnomaly) +
    1.274 * sineDegrees(2 * meanElongation - meanAnomaly) +
    0.658 * sineDegrees(2 * meanElongation) +
    0.214 * sineDegrees(2 * meanAnomaly) -
    0.186 * sineDegrees(solarMeanAnomaly);
  const eclipticLatitude =
    5.128 * sineDegrees(argumentOfLatitude) +
    0.28 * sineDegrees(meanAnomaly + argumentOfLatitude) +
    0.277 * sineDegrees(meanAnomaly - argumentOfLatitude) +
    0.173 * sineDegrees(2 * meanElongation - argumentOfLatitude);
  const obliquity = 23.439 - 0.00000036 * daysSinceJ2000;

  const rightAscension = MathUtils.radToDeg(
    Math.atan2(
      sineDegrees(eclipticLongitude) * cosineDegrees(obliquity) -
        tangentDegrees(eclipticLatitude) * sineDegrees(obliquity),
      cosineDegrees(eclipticLongitude)
    )
  );
  const declination = MathUtils.radToDeg(
    Math.asin(
      sineDegrees(eclipticLatitude) * cosineDegrees(obliquity) +
        cosineDegrees(eclipticLatitude) * sineDegrees(obliquity) * sineDegrees(eclipticLongitude)
    )
  );
  const greenwichSiderealTime = getGreenwichMeanSiderealTimeDegrees(julianDay);
  const sublunarLongitude = normalizeLongitude(rightAscension - greenwichSiderealTime);

  return latLngToVector3(declination, sublunarLongitude, 1).normalize();
}

function createSunHighlightMaterial() {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
    uniforms: {
      sunDirection: { value: new Vector3(1, 0, 0) },
      highlightColor: { value: new Color("#f2c98d") },
      twilightColor: { value: new Color("#c78b52") },
      highlightStrength: { value: 1 }
    },
    vertexShader: `
      varying vec3 vSurfaceNormal;

      void main() {
        vSurfaceNormal = normalize(normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 sunDirection;
      uniform vec3 highlightColor;
      uniform vec3 twilightColor;
      uniform float highlightStrength;
      varying vec3 vSurfaceNormal;

      void main() {
        float sunAmount = dot(normalize(vSurfaceNormal), normalize(sunDirection));
        float daylight = max(sunAmount, 0.0);
        float diffuse = pow(daylight, 0.82);
        float core = pow(daylight, 2.5);
        float twilight = smoothstep(-0.18, 0.03, sunAmount) * (1.0 - smoothstep(0.0, 0.14, sunAmount));
        float alpha = (diffuse * 0.16 + core * 0.08 + twilight * 0.035) * highlightStrength;
        if (alpha <= 0.001) {
          discard;
        }
        vec3 color = mix(twilightColor, highlightColor, smoothstep(-0.02, 0.32, sunAmount));
        gl_FragColor = vec4(color, alpha);
      }
    `
  });
}

export function createAlertMapController(elements: GlobeElements) {
  const {
    globeContainer,
    alertMapStatus,
    mapZoomInButton,
    mapZoomOutButton,
    mapZoomResetButton,
    onSelectionChanged
  } = elements;

  const localityState = new Map<number, AlertStageState>();
  const localityLookup = new Map<number, LocalityMeta>();
  const localityAliasLookup = new Map<string, number[]>();
  let localityAliasKeys: string[] = [];
  let pendingNewsEvents: NewsEventPayload[] = [];
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let replayNowMs: number | null = null;
  let newsEventsLoaded = false;
  let selectedNewsEventId: string | null = null;
  let selectedCelestialId: "sun" | "moon" | null = null;
  let pointerDownPosition: { x: number; y: number } | null = null;
  let canvasInteractionsBound = false;

  const markerTexture = createSoftMarkerTexture();
  const solidMarkerTexture = createSolidCircleTexture();
  const ringMarkerTexture = createRingTexture();
  const celestialDotTexture = createCelestialDotTexture();
  const celestialRingTexture = createCelestialRingTexture();
  const scene = new Scene();
  const camera = new PerspectiveCamera(34, 1, 0.01, 100);
  camera.position.set(0, 0.2, ALERT_GLOBE_CAMERA_RESET_DISTANCE);
  const raycaster = new Raycaster();
  const pointerNdc = new Vector2();

  const renderer = new WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "high-performance"
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;

  const globeRoot = new Group();
  globeRoot.rotation.y = MathUtils.degToRad(-34);
  globeRoot.rotation.x = MathUtils.degToRad(-11);

  const alertOverlayGroup = new Group();
  const newsMarkerGroup = new Group();
  const worldLineGroup = new Group();
  const detailBoundaryGroup = new Group();
  const worldLabelGroup = new Group();
  const localityTraceGroup = new Group();
  const graticuleGroup = buildGraticuleGroup(ALERT_GLOBE_RADIUS + 0.002);
  const starfield = buildStarfield();
  const globeMesh = new Mesh(
    new SphereGeometry(ALERT_GLOBE_RADIUS, 112, 112),
    new MeshPhongMaterial({
      color: new Color("#122739"),
      emissive: new Color("#09131c"),
      shininess: 10,
      specular: new Color("#3b3329")
    })
  );
  const sunHighlightMesh = new Mesh(
    new SphereGeometry(ALERT_GLOBE_RADIUS + WORLD_BOUNDARY_ALTITUDE + 0.002, 112, 112),
    createSunHighlightMaterial()
  );
  const sunIndicator = new Sprite(
    new SpriteMaterial({
      map: celestialDotTexture,
      color: new Color("#ffd83d"),
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      depthTest: false
    })
  );
  const moonIndicator = new Sprite(
    new SpriteMaterial({
      map: celestialRingTexture,
      color: new Color("#cbd8ee"),
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      depthTest: false
    })
  );
  sunIndicator.userData.selectionType = "celestial";
  sunIndicator.userData.celestialId = "sun";
  moonIndicator.userData.selectionType = "celestial";
  moonIndicator.userData.celestialId = "moon";
  const atmosphereInner = new Mesh(
    new SphereGeometry(ALERT_GLOBE_RADIUS * 1.04, 72, 72),
    new MeshBasicMaterial({
      color: new Color("#f0a86c"),
      transparent: true,
      opacity: 0.08,
      side: BackSide
    })
  );
  const atmosphereOuter = new Mesh(
    new SphereGeometry(ALERT_GLOBE_RADIUS * 1.085, 72, 72),
    new MeshBasicMaterial({
      color: new Color("#ffcf9b"),
      transparent: true,
      opacity: 0.035,
      side: BackSide
    })
  );

  const alertOverlays = new Map<number, AlertOverlay>();
  const newsMarkers = new Map<string, NewsMarkerRecord>();
  const countryLabelRecords: CountryLabelRecord[] = [];
  const countryMarkerAnchors = new Map<string, GeoCoordinates>();
  const countryTextAliasToAnchorKey = new Map<string, string>();
  const boundaryDetailPayloadCache = new Map<string, BoundaryDetailPayload>();
  const boundaryDetailRetryAfterByKey = new Map<string, number>();
  const countryLabelTextures: CanvasTexture[] = [];
  const eventDisposers: Array<() => void> = [];
  let resizeObserver: ResizeObserver | null = null;
  let controls: OrbitControls | null = null;
  let worldDataLoaded = false;
  let localitiesReady = false;
  let displayedBoundaryDetailKey: string | null = null;
  let pendingBoundaryDetailKey: string | null = null;
  let desiredBoundaryDetailKey: string | null = null;
  let countryTextAliasKeys: string[] = [];

  const baseLight = new AmbientLight("#78879a", 0.28);
  const moonLight = new DirectionalLight("#8ca9d7", 0.12);
  moonLight.position.set(-3.6, -0.4, -4.3);
  sunHighlightMesh.renderOrder = 2;
  sunIndicator.renderOrder = 5;
  moonIndicator.renderOrder = 5;
  sunIndicator.scale.setScalar(SUN_MARKER_BASE_SCALE);
  moonIndicator.scale.setScalar(0.145);

  globeRoot.add(globeMesh);
  globeRoot.add(sunHighlightMesh);
  globeRoot.add(sunIndicator);
  globeRoot.add(moonIndicator);
  globeRoot.add(atmosphereInner);
  globeRoot.add(atmosphereOuter);
  globeRoot.add(worldLineGroup);
  globeRoot.add(detailBoundaryGroup);
  globeRoot.add(worldLabelGroup);
  globeRoot.add(graticuleGroup);
  globeRoot.add(localityTraceGroup);
  globeRoot.add(alertOverlayGroup);
  globeRoot.add(newsMarkerGroup);

  scene.add(globeRoot);
  scene.add(starfield);
  scene.add(baseLight);
  scene.add(moonLight);

  function setStatus(text: string) {
    if (alertMapStatus) {
      alertMapStatus.textContent = text;
    }
  }

  function getMapNowMs() {
    return Number.isFinite(replayNowMs) ? Number(replayNowMs) : Date.now();
  }

  function updateCelestialLighting(nowMs: number) {
    const sunDirection = getSolarDirection(nowMs);
    const moonDirection = getMoonDirection(nowMs);
    const sunHighlightMaterial = sunHighlightMesh.material as ShaderMaterial;
    const sunDirectionUniform = sunHighlightMaterial.uniforms.sunDirection.value as Vector3;
    sunDirectionUniform.copy(sunDirection);
    sunIndicator.position.copy(sunDirection).multiplyScalar(ALERT_GLOBE_RADIUS + SUN_MARKER_SURFACE_OFFSET);
    moonIndicator.position.copy(moonDirection).multiplyScalar(ALERT_GLOBE_RADIUS + 0.3);
    sunIndicator.scale.setScalar(selectedCelestialId === "sun" ? SUN_MARKER_SELECTED_SCALE : SUN_MARKER_BASE_SCALE);
    moonIndicator.scale.setScalar(selectedCelestialId === "moon" ? 0.175 : 0.145);
    (sunIndicator.material as SpriteMaterial).opacity = selectedCelestialId === "sun" ? 1 : 0.92;
    (moonIndicator.material as SpriteMaterial).opacity = selectedCelestialId === "moon" ? 1 : 0.92;
    moonLight.position.copy(moonDirection.clone().multiplyScalar(5.8));
  }

  function resizeRenderer() {
    if (!globeContainer) {
      return;
    }
    const width = globeContainer.clientWidth;
    const height = globeContainer.clientHeight;
    if (width <= 0 || height <= 0) {
      return;
    }
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function attachRenderer() {
    if (!globeContainer) {
      setStatus("Globe container unavailable");
      return false;
    }

    if (!renderer.domElement.isConnected) {
      globeContainer.replaceChildren(renderer.domElement);
    }

    if (!controls) {
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enablePan = false;
      controls.enableDamping = false;
      controls.enableZoom = false;
      controls.rotateSpeed = 0.12;
      controls.zoomSpeed = 0.34;
      controls.autoRotate = false;
      controls.minDistance = ALERT_GLOBE_CAMERA_MIN_DISTANCE;
      controls.maxDistance = ALERT_GLOBE_CAMERA_MAX_DISTANCE;
    }

    updateControlSensitivity();
    resizeRenderer();
    return true;
  }

  function scheduleRetry() {
    if (retryTimer) {
      return;
    }
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void loadRuntimeData();
    }, ALERT_GLOBE_RENDER_RETRY_MS);
  }

  function appendAlias(aliasValue: unknown, localityId: number) {
    const normalizedAlias = normalizeAlias(aliasValue);
    if (!normalizedAlias) {
      return;
    }

    const existing = localityAliasLookup.get(normalizedAlias) ?? [];
    if (!existing.includes(localityId)) {
      existing.push(localityId);
      localityAliasLookup.set(normalizedAlias, existing);
    }
  }

  function buildLocalityLookup(payload: LocalityMapPayload) {
    localityLookup.clear();
    localityAliasLookup.clear();

    for (const locality of payload.localities ?? []) {
      const localityId = Number(locality?.id);
      const latitude = Number(locality?.lat);
      const longitude = Number(locality?.lng);
      if (!Number.isFinite(localityId) || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        continue;
      }

      const sanitizedPolygon = sanitizeGeoRing(locality?.polygon);
      const alignedPolygon = densifyGeoRing(sanitizedPolygon, LOCALITY_POLYGON_MAX_SEGMENT_DEGREES);

      localityLookup.set(localityId, {
        id: localityId,
        lat: latitude,
        lng: longitude,
        displayName: String(locality?.en ?? locality?.he ?? locality?.key ?? localityId),
        polygon: alignedPolygon
      });

      appendAlias(locality?.key, localityId);
      appendAlias(locality?.he, localityId);
      appendAlias(locality?.en, localityId);
    }

    localityAliasKeys = Array.from(localityAliasLookup.keys())
      .filter((alias) => alias.length >= 5)
      .sort((left, right) => right.length - left.length);
  }

  function clearLocalityLookup() {
    localityLookup.clear();
    localityAliasLookup.clear();
    localityAliasKeys = [];
  }

  function findLocalityIdsForLocation(locationText: unknown) {
    const normalizedLocation = normalizeAlias(locationText);
    if (!normalizedLocation) {
      return [];
    }

    const directMatch = localityAliasLookup.get(normalizedLocation);
    if (Array.isArray(directMatch) && directMatch.length > 0) {
      return directMatch;
    }

    const matches = new Set<number>();
    for (const alias of localityAliasKeys) {
      if (!normalizedLocation.includes(alias) && !alias.includes(normalizedLocation)) {
        continue;
      }
      const localityIds = localityAliasLookup.get(alias) ?? [];
      for (const localityId of localityIds) {
        matches.add(localityId);
      }
      if (matches.size >= 40) {
        break;
      }
    }

    return Array.from(matches);
  }

  function getAlertLocalityIds(alert: Partial<AlertPayload> | unknown) {
    const payload = alert as Partial<AlertPayload> | null;
    const resolved = new Set<number>();

    for (const localityIdRaw of Array.isArray(payload?.locationIds) ? payload.locationIds : []) {
      const localityId = Number(localityIdRaw);
      if (Number.isFinite(localityId)) {
        resolved.add(localityId);
      }
    }

    if (resolved.size === 0) {
      for (const locationText of Array.isArray(payload?.locations) ? payload.locations : []) {
        for (const localityId of findLocalityIdsForLocation(locationText)) {
          resolved.add(localityId);
        }
      }
    }

    return resolved;
  }

  function transitionLocalityToPreAlert(localityId: number, eventTimeMs: number) {
    const current = localityState.get(localityId);
    if (current?.stage === STAGE.ACTIVE_SIREN || current?.stage === STAGE.POST_SIREN_UNSAFE) {
      return false;
    }

    localityState.set(localityId, {
      stage: STAGE.PRE_ALERT,
      alertStartedAtMs: eventTimeMs,
      stageStartedAtMs: eventTimeMs,
      sirenEndsAtMs: null,
      safeRequestedAtMs: null,
      safeFadeEndsAtMs: null
    });
    return true;
  }

  function transitionLocalityToActiveSiren(localityId: number, activationStartMs: number) {
    localityState.set(localityId, {
      stage: STAGE.ACTIVE_SIREN,
      alertStartedAtMs: activationStartMs,
      stageStartedAtMs: activationStartMs,
      sirenEndsAtMs: activationStartMs + ALERT_GLOBE_SIREN_DURATION_MS,
      safeRequestedAtMs: null,
      safeFadeEndsAtMs: null
    });
  }

  function transitionLocalityToPostSirenUnsafe(localityId: number, eventTimeMs: number, alertStartedAtMs: number) {
    localityState.set(localityId, {
      stage: STAGE.POST_SIREN_UNSAFE,
      alertStartedAtMs,
      stageStartedAtMs: eventTimeMs,
      sirenEndsAtMs: null,
      safeRequestedAtMs: null,
      safeFadeEndsAtMs: null
    });
  }

  function transitionLocalityToSafeFade(localityId: number, eventTimeMs: number) {
    const current = localityState.get(localityId);
    localityState.set(localityId, {
      stage: STAGE.SAFE_FADE,
      alertStartedAtMs: current?.alertStartedAtMs ?? eventTimeMs,
      stageStartedAtMs: eventTimeMs,
      sirenEndsAtMs: null,
      safeRequestedAtMs: null,
      safeFadeEndsAtMs: eventTimeMs + ALERT_GLOBE_SAFE_FADE_DURATION_MS
    });
  }

  function requestLocalitySafe(localityId: number, eventTimeMs: number) {
    const current = localityState.get(localityId);
    if (current?.stage === STAGE.ACTIVE_SIREN) {
      localityState.set(localityId, {
        ...current,
        safeRequestedAtMs: eventTimeMs
      });
      return;
    }
    transitionLocalityToSafeFade(localityId, eventTimeMs);
  }

  function createMarker(color: string, coreScale: number, haloScale: number) {
    const group = new Group();
    const core = new Sprite(
      new SpriteMaterial({
        map: solidMarkerTexture,
        color: new Color(color),
        transparent: true,
        opacity: 1,
        depthWrite: false,
        depthTest: true,
        alphaTest: 0.28
      })
    );
    const halo = new Sprite(
      new SpriteMaterial({
        map: ringMarkerTexture,
        color: new Color(color),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: true,
        alphaTest: 0.08
      })
    );

    core.scale.setScalar(coreScale);
    halo.scale.setScalar(haloScale);
    halo.visible = false;
    group.add(halo);
    group.add(core);

    return {
      container: group,
      core,
      halo,
      phase: Math.random() * Math.PI * 2
    } satisfies GlobeMarker;
  }

  function createNewsMarker(color: string, coreScale: number, eventId: string) {
    const group = new Group();
    const core = new Sprite(
      new SpriteMaterial({
        map: solidMarkerTexture,
        color: new Color(color),
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        depthTest: false,
        alphaTest: 0.28
      })
    );
    const halo = new Sprite(
      new SpriteMaterial({
        map: ringMarkerTexture,
        color: new Color(color),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        alphaTest: 0.08
      })
    );

    core.scale.setScalar(coreScale);
    halo.scale.setScalar(coreScale * 1.42);
    core.userData.newsEventId = eventId;
    halo.userData.newsEventId = eventId;
    core.renderOrder = NEWS_MARKER_CORE_RENDER_ORDER;
    halo.renderOrder = NEWS_MARKER_HALO_RENDER_ORDER;
    halo.visible = false;
    group.add(halo);
    group.add(core);

    return {
      container: group,
      core,
      halo,
      phase: Math.random() * Math.PI * 2
    } satisfies GlobeMarker;
  }

  function setMarkerPosition(
    marker: GlobeMarker,
    lat: number,
    lng: number,
    altitude = ALERT_MARKER_ALTITUDE,
    surfaceOffsetX = 0,
    surfaceOffsetY = 0
  ) {
    const position = latLngToOffsetSurfaceVector3(
      lat,
      lng,
      ALERT_GLOBE_RADIUS + altitude,
      surfaceOffsetX,
      surfaceOffsetY
    );
    marker.container.position.copy(position);
  }

  function resolveNewsMarkerCoordinates(newsEvent: NewsEventPayload): GeoCoordinates | null {
    const explicitCoordinates = getExplicitNewsCoordinates(newsEvent);
    if (explicitCoordinates) {
      return explicitCoordinates;
    }

    if (usesPublisherCountryFallback(newsEvent)) {
      return inferCountryAnchorFromNewsText([newsEvent.title, newsEvent.summary].filter(Boolean).join(" | "));
    }

    for (const lookupCandidate of [
      ...getCountryLookupCandidates(newsEvent.country),
      ...getCountryLookupCandidates(newsEvent.region),
      ...getCountryLookupCandidates(newsEvent.locationName)
    ]) {
      const anchor = countryMarkerAnchors.get(lookupCandidate);
      if (anchor) {
        return anchor;
      }
    }

    return inferCountryAnchorFromNewsText([newsEvent.title, newsEvent.summary].filter(Boolean).join(" | "));
  }

  function getCameraDistance() {
    return controls ? camera.position.distanceTo(controls.target) : camera.position.length();
  }

  function getCameraDistanceRatio() {
    if (!controls) {
      return 1;
    }
    const distance = getCameraDistance();
    return clampNumber(
      (distance - controls.minDistance) / Math.max(controls.maxDistance - controls.minDistance, 0.001),
      0,
      1
    );
  }

  function getNewsMarkerZoomScale() {
    const distanceRatio = clampNumber(getCameraDistance() / ALERT_GLOBE_CAMERA_RESET_DISTANCE, 0.34, 1.85);
    if (distanceRatio >= 1) {
      return clampNumber(0.88 + (distanceRatio - 1) * 0.54, 0.88, 1.34);
    }
    return clampNumber(0.18 + Math.pow(distanceRatio, 1.2) * 0.62, 0.18, 0.88);
  }

  function getNewsMarkerRingScaleMultiplier(isSelected: boolean) {
    const distanceRatio = getCameraDistance() / ALERT_GLOBE_CAMERA_RESET_DISTANCE;
    const closeRangeCompression = clampNumber(Math.pow(distanceRatio, 0.42), 0.64, 1);
    return (isSelected ? 1.38 : 1.14) * closeRangeCompression;
  }

  function updateControlSensitivity() {
    if (!controls) {
      return;
    }

    const ratio = getCameraDistanceRatio();
    const distance = Math.max(getCameraDistance(), ALERT_GLOBE_RADIUS + 0.04);
    const fovRadians = MathUtils.degToRad(camera.fov);
    const surfaceClearance = Math.max(distance - ALERT_GLOBE_RADIUS, 0.04);
    const cursorMatchedRotateSpeed =
      (surfaceClearance * Math.tan(fovRadians * 0.5)) / (Math.PI * ALERT_GLOBE_RADIUS);

    controls.rotateSpeed = clampNumber(cursorMatchedRotateSpeed, 0.012, 0.22);
    controls.zoomSpeed = 0.26 + Math.pow(ratio, 1.15) * 0.18;
  }

  function emitSelection(selection: GlobeSelection | null) {
    onSelectionChanged?.(selection);
  }

  function selectNewsEvent(eventId: string | null) {
    if (!eventId) {
      selectedNewsEventId = null;
      selectedCelestialId = null;
      emitSelection(null);
      return;
    }

    const record = newsMarkers.get(eventId);
    if (!record) {
      selectedNewsEventId = null;
      selectedCelestialId = null;
      emitSelection(null);
      return;
    }

    selectedNewsEventId = eventId;
    selectedCelestialId = null;
    emitSelection({
      kind: "news",
      newsEvent: record.newsEvent
    });
  }

  function selectCelestial(id: "sun" | "moon" | null) {
    if (!id) {
      selectedNewsEventId = null;
      selectedCelestialId = null;
      emitSelection(null);
      return;
    }

    selectedNewsEventId = null;
    selectedCelestialId = id;
    emitSelection({
      kind: "celestial",
      id,
      title: id === "sun" ? "Sun" : "Moon",
      summary:
        id === "sun"
          ? "Current subsolar position marker on the globe."
          : "Current sublunar position marker on the globe."
    });
  }

  function createAlertOverlay(locality: LocalityMeta) {
    const container = new Group();
    let fillMesh: Mesh | null = null;
    let outline: LineLoop | null = null;

    const polygonGeometry = buildSphericalPolygonGeometry(
      locality.polygon,
      ALERT_GLOBE_RADIUS,
      ALERT_POLYGON_FILL_ALTITUDE
    );
    if (polygonGeometry) {
      fillMesh = new Mesh(
        polygonGeometry,
        new MeshBasicMaterial({
          color: new Color("#ff5837"),
          transparent: true,
          opacity: 0.28,
          side: DoubleSide,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1
        })
      );
      fillMesh.renderOrder = 5;
      container.add(fillMesh);
    }

    const outlineGeometry = buildPolygonOutlineGeometry(
      locality.polygon,
      ALERT_GLOBE_RADIUS,
      ALERT_POLYGON_OUTLINE_ALTITUDE
    );
    if (outlineGeometry) {
      outline = new LineLoop(
        outlineGeometry,
        new LineBasicMaterial({
          color: new Color("#ffb876"),
          transparent: true,
          opacity: 0.56,
          depthWrite: false
        })
      );
      outline.renderOrder = 6;
      container.add(outline);
    }

    const hasPolygon = fillMesh != null || outline != null;
    const marker = createMarker("#ff5837", 0.066, 0.11);
    if (!hasPolygon) {
      setMarkerPosition(marker, locality.lat, locality.lng, ALERT_MARKER_ALTITUDE);
      container.add(marker.container);
    }

    return {
      container,
      marker,
      fillMesh,
      outline,
      hasPolygon
    } satisfies AlertOverlay;
  }

  function ensureAlertOverlay(localityId: number, locality: LocalityMeta) {
    let overlay = alertOverlays.get(localityId);
    if (!overlay) {
      overlay = createAlertOverlay(locality);
      alertOverlayGroup.add(overlay.container);
      alertOverlays.set(localityId, overlay);
    }
    if (!overlay.hasPolygon) {
      setMarkerPosition(overlay.marker, locality.lat, locality.lng, ALERT_MARKER_ALTITUDE);
    }
    return overlay;
  }

  function getAlertStageVisuals(stageState: AlertStageState, nowMs: number) {
    const stage = stageState.stage in STAGE_STYLE ? (stageState.stage as keyof typeof STAGE_STYLE) : STAGE.ACTIVE_SIREN;
    const base = STAGE_STYLE[stage];

    if (stage === STAGE.SAFE_FADE) {
      const remainingMs = Math.max(0, (stageState.safeFadeEndsAtMs ?? nowMs) - nowMs);
      const ratio = clampNumber(remainingMs / ALERT_GLOBE_SAFE_FADE_DURATION_MS, 0, 1);
      return {
        color: base.color,
        coreScale: base.coreScale,
        haloScale: base.haloScale,
        opacity: base.opacity * ratio,
        pulseSpeed: base.pulseSpeed,
        pulseAmount: 0.14
      };
    }

    return {
      color: base.color,
      coreScale: base.coreScale,
      haloScale: base.haloScale,
      opacity: base.opacity,
      pulseSpeed: base.pulseSpeed,
      pulseAmount: stage === STAGE.ACTIVE_SIREN ? 0.08 : stage === STAGE.POST_SIREN_UNSAFE ? 0.05 : 0.03
    };
  }

  function removeAlertOverlay(localityId: number) {
    const overlay = alertOverlays.get(localityId);
    if (!overlay) {
      return;
    }
    alertOverlayGroup.remove(overlay.container);
    disposeObjectTree(overlay.container);
    alertOverlays.delete(localityId);
  }

  function resolveSystemMessageLocalityIds(systemMessage: Partial<SystemMessagePayload>) {
    const resolved = new Set<number>();

    for (const localityIdRaw of Array.isArray(systemMessage.locationIds) ? systemMessage.locationIds : []) {
      const localityId = Number(localityIdRaw);
      if (Number.isFinite(localityId)) {
        resolved.add(localityId);
      }
    }

    for (const locationName of Array.isArray(systemMessage.locationNames) ? systemMessage.locationNames : []) {
      for (const localityId of findLocalityIdsForLocation(locationName)) {
        resolved.add(localityId);
      }
    }

    if (resolved.size === 0) {
      const freeText = [
        ...(Array.isArray(systemMessage.textParts) ? systemMessage.textParts : []),
        systemMessage.title ?? "",
        systemMessage.body ?? ""
      ]
        .map((part) => normalizeAlias(part))
        .filter(Boolean) as string[];

      for (const textPart of freeText) {
        for (const alias of localityAliasKeys) {
          if (!textPart.includes(alias)) {
            continue;
          }
          const localityIds = localityAliasLookup.get(alias) ?? [];
          for (const localityId of localityIds) {
            resolved.add(localityId);
          }
          if (resolved.size >= 80) {
            break;
          }
        }
      }
    }

    return resolved;
  }

  function getNewsMarkerColor(newsEvent: NewsEventPayload) {
    const category = String(newsEvent.category ?? "").toLowerCase();
    if (category && NEWS_CATEGORY_COLORS[category]) {
      return NEWS_CATEGORY_COLORS[category];
    }

    const severity = clampNumber(Number(newsEvent.severity ?? 0), 0, 10);
    if (severity >= 7) {
      return "#d85d4b";
    }
    if (severity >= 4) {
      return "#d8a454";
    }
    return "#78c3b2";
  }

  function getNewsMarkerScale(newsEvent: NewsEventPayload) {
    const severity = clampNumber(Number(newsEvent.severity ?? 1), 0, 10);
    return 0.021 + severity * 0.0028;
  }

  function removeNewsMarker(eventId: string) {
    const record = newsMarkers.get(eventId);
    if (!record) {
      return;
    }
    newsMarkerGroup.remove(record.marker.container);
    disposeObjectTree(record.marker.container);
    newsMarkers.delete(eventId);
    if (selectedNewsEventId === eventId) {
      selectedNewsEventId = null;
      emitSelection(null);
    }
  }

  function syncNewsMarkers() {
    if (!newsEventsLoaded) {
      return;
    }

    const resolvedNewsMarkers = pendingNewsEvents
      .map((newsEvent) => {
        const markerCoordinates = resolveNewsMarkerCoordinates(newsEvent);
        if (!markerCoordinates) {
          return null;
        }

        return {
          newsEvent,
          markerCoordinates
        } satisfies ResolvedNewsMarkerCoordinates;
      })
      .filter((resolvedNewsMarker): resolvedNewsMarker is ResolvedNewsMarkerCoordinates => resolvedNewsMarker != null)
      .sort((left, right) =>
        String(right.newsEvent.updatedAtIso ?? right.newsEvent.createdAtIso ?? "").localeCompare(
          String(left.newsEvent.updatedAtIso ?? left.newsEvent.createdAtIso ?? "")
        )
      );
    const markerOffsets = buildNewsMarkerSurfaceOffsets(resolvedNewsMarkers);

    const nextIds = new Set(resolvedNewsMarkers.map((resolvedNewsMarker) => resolvedNewsMarker.newsEvent.eventId));
    for (const existingId of Array.from(newsMarkers.keys())) {
      if (!nextIds.has(existingId)) {
        removeNewsMarker(existingId);
      }
    }

    resolvedNewsMarkers.forEach(({ newsEvent, markerCoordinates }, index) => {
      const color = getNewsMarkerColor(newsEvent);
      const scale = getNewsMarkerScale(newsEvent);
      const markerOffset = markerOffsets.get(newsEvent.eventId) ?? { x: 0, y: 0 };
      let record = newsMarkers.get(newsEvent.eventId);
      if (!record) {
        const marker = createNewsMarker(color, scale, newsEvent.eventId);
        record = {
          marker,
          newsEvent,
          surfaceOffsetX: 0,
          surfaceOffsetY: 0,
          replayPulseStartedAtMs: replayNowMs != null ? Date.now() : null
        };
        newsMarkers.set(newsEvent.eventId, record);
        newsMarkerGroup.add(marker.container);
      }

      record.newsEvent = newsEvent;
      record.surfaceOffsetX = markerOffset.x;
      record.surfaceOffsetY = markerOffset.y;
      setMarkerPosition(
        record.marker,
        markerCoordinates.lat,
        markerCoordinates.lng,
        NEWS_MARKER_ALTITUDE,
        record.surfaceOffsetX,
        record.surfaceOffsetY
      );
      const coreMaterial = record.marker.core.material as SpriteMaterial;
      const haloMaterial = record.marker.halo.material as SpriteMaterial;
      coreMaterial.color.set(color);
      haloMaterial.color.set(color);
      const recencyRenderOffset = (resolvedNewsMarkers.length - index) * 0.001;
      record.marker.core.renderOrder = NEWS_MARKER_CORE_RENDER_ORDER + recencyRenderOffset;
      record.marker.halo.renderOrder = NEWS_MARKER_HALO_RENDER_ORDER + recencyRenderOffset;
      const isSelected = selectedNewsEventId === newsEvent.eventId;
      const zoomScale = getNewsMarkerZoomScale();
      coreMaterial.opacity = isSelected ? 1 : 0.9;
      haloMaterial.opacity = isSelected ? 0.58 : 0;
      record.marker.halo.visible = isSelected;
      record.marker.core.scale.setScalar(scale * zoomScale * (isSelected ? 1.12 : 1));
      record.marker.halo.scale.setScalar(scale * zoomScale * getNewsMarkerRingScaleMultiplier(isSelected));
    });

    if (selectedNewsEventId && !newsMarkers.has(selectedNewsEventId)) {
      selectedNewsEventId = null;
      if (!selectedCelestialId) {
        emitSelection(null);
      }
    } else if (selectedNewsEventId) {
      const selectedRecord = newsMarkers.get(selectedNewsEventId);
      emitSelection(
        selectedRecord
          ? {
              kind: "news",
              newsEvent: selectedRecord.newsEvent
            }
          : null
      );
    }
  }

  function resetCountryLabels() {
    clearGroup(worldLabelGroup);
    countryLabelRecords.length = 0;
    countryMarkerAnchors.clear();
    countryTextAliasToAnchorKey.clear();
    countryTextAliasKeys = [];
    for (const texture of countryLabelTextures.splice(0, countryLabelTextures.length)) {
      texture.dispose();
    }
  }

  function registerCountryTextAlias(aliasValue: unknown, anchorKey: string) {
    const normalizedAlias = normalizeAlias(aliasValue);
    if (!normalizedAlias || !countryMarkerAnchors.has(anchorKey)) {
      return;
    }

    countryTextAliasToAnchorKey.set(normalizedAlias, anchorKey);
  }

  function rebuildCountryTextAliasKeys() {
    countryTextAliasKeys = Array.from(countryTextAliasToAnchorKey.keys())
      .filter((alias) => alias.length >= 3)
      .sort((left, right) => right.length - left.length);
  }

  function registerCountryTextAliasesForAnchor(countryName: string) {
    const anchorKey = normalizeAlias(countryName);
    if (!anchorKey) {
      return;
    }

    registerCountryTextAlias(countryName, anchorKey);
    for (const [alias, canonicalCountry] of Object.entries(COUNTRY_TEXT_ALIAS_OVERRIDES)) {
      if (normalizeAlias(canonicalCountry) === anchorKey) {
        registerCountryTextAlias(alias, anchorKey);
      }
    }
  }

  function inferCountryAnchorFromNewsText(text: unknown) {
    const normalizedText = normalizeAlias(text);
    if (!normalizedText) {
      return null;
    }

    const paddedText = ` ${normalizedText} `;
    let bestAnchorKey: string | null = null;
    let bestMatchIndex = Number.POSITIVE_INFINITY;
    let bestMatchLength = -1;

    for (const alias of countryTextAliasKeys) {
      const aliasToken = ` ${alias} `;
      const matchIndex = paddedText.indexOf(aliasToken);
      if (matchIndex === -1) {
        continue;
      }

      if (matchIndex < bestMatchIndex || (matchIndex === bestMatchIndex && alias.length > bestMatchLength)) {
        bestAnchorKey = countryTextAliasToAnchorKey.get(alias) ?? null;
        bestMatchIndex = matchIndex;
        bestMatchLength = alias.length;
      }
    }

    return bestAnchorKey ? countryMarkerAnchors.get(bestAnchorKey) ?? null : null;
  }

  function updateCountryLabels() {
    if (countryLabelRecords.length === 0) {
      return;
    }

    const cameraDirectionLocal = globeRoot.worldToLocal(camera.position.clone()).normalize();
    const cameraDistance = getCameraDistance();
    const distanceRatio = getCameraDistanceRatio();
    const importanceFloor =
      distanceRatio >= 0.72 ? 180 : distanceRatio >= 0.56 ? 96 : distanceRatio >= 0.4 ? 40 : 0;
    const scaleMultiplier = clampNumber(
      0.32 * Math.pow(cameraDistance / ALERT_GLOBE_CAMERA_RESET_DISTANCE, 1.9),
      0.05,
      1
    );

    for (const labelRecord of countryLabelRecords) {
      const facing = labelRecord.surfaceNormal.dot(cameraDirectionLocal);
      const isVisible = facing > 0.12 && labelRecord.importance >= importanceFloor;
      labelRecord.sprite.visible = isVisible;
      if (!isVisible) {
        continue;
      }

      const material = labelRecord.sprite.material as SpriteMaterial;
      material.opacity = clampNumber((facing - 0.12) / 0.42, 0.24, 0.9);
      const scale = labelRecord.baseScale * scaleMultiplier;
      labelRecord.sprite.scale.set(scale * labelRecord.aspectRatio, scale, 1);
    }
  }

  function clearBoundaryDetailLayer() {
    clearGroup(detailBoundaryGroup);
    displayedBoundaryDetailKey = null;
  }

  function getDesiredBoundaryDetailLevel() {
    const distanceRatio = getCameraDistanceRatio();
    if (distanceRatio <= DETAIL_BOUNDARY_ADM2_DISTANCE_RATIO) {
      return "ADM2" as const;
    }
    if (distanceRatio <= DETAIL_BOUNDARY_ADM1_DISTANCE_RATIO) {
      return "ADM1" as const;
    }
    return null;
  }

  function getFocusedCountryRecord() {
    if (countryLabelRecords.length === 0) {
      return null;
    }

    const cameraDirectionLocal = globeRoot.worldToLocal(camera.position.clone()).normalize();
    const centerLatLng = vector3ToLatLng(cameraDirectionLocal);
    let bestMatch: CountryLabelRecord | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const record of countryLabelRecords) {
      const facing = record.surfaceNormal.dot(cameraDirectionLocal);
      if (facing < DETAIL_BOUNDARY_COUNTRY_THRESHOLD) {
        continue;
      }

      const distance = getGreatCircleDistanceDegrees(
        centerLatLng.lat,
        centerLatLng.lng,
        record.centroidLat,
        record.centroidLng
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        bestMatch = record;
      }
    }

    return bestMatch;
  }

  async function fetchBoundaryDetailPayload(countryName: string, level: "ADM1" | "ADM2", key: string) {
    try {
      const requestUrl = new URL(BOUNDARY_DETAIL_API_URL, window.location.origin);
      requestUrl.searchParams.set("countryName", countryName);
      requestUrl.searchParams.set("level", level);

      const response = await fetch(requestUrl, {
        cache: "no-store"
      });
      if (!response.ok) {
        boundaryDetailPayloadCache.delete(key);
        boundaryDetailRetryAfterByKey.set(key, Date.now() + BOUNDARY_DETAIL_RETRY_COOLDOWN_MS);
        if (desiredBoundaryDetailKey === key) {
          pendingBoundaryDetailKey = null;
          clearBoundaryDetailLayer();
        }
        return;
      }

      const payload = (await response.json()) as BoundaryDetailPayload;
      boundaryDetailRetryAfterByKey.delete(key);
      boundaryDetailPayloadCache.set(key, payload);
      if (desiredBoundaryDetailKey !== key) {
        return;
      }

      clearBoundaryDetailLayer();
      detailBoundaryGroup.add(buildBoundaryDetailGroup(payload, ALERT_GLOBE_RADIUS + DETAIL_BOUNDARY_ALTITUDE));
      displayedBoundaryDetailKey = key;
    } catch {
      boundaryDetailPayloadCache.delete(key);
      boundaryDetailRetryAfterByKey.set(key, Date.now() + BOUNDARY_DETAIL_RETRY_COOLDOWN_MS);
      if (desiredBoundaryDetailKey === key) {
        clearBoundaryDetailLayer();
      }
    } finally {
      if (pendingBoundaryDetailKey === key) {
        pendingBoundaryDetailKey = null;
      }
    }
  }

  function syncBoundaryDetailLayer() {
    if (!worldDataLoaded) {
      clearBoundaryDetailLayer();
      desiredBoundaryDetailKey = null;
      pendingBoundaryDetailKey = null;
      return;
    }

    const level = getDesiredBoundaryDetailLevel();
    const focusedCountry = level ? getFocusedCountryRecord() : null;
    const nextKey = focusedCountry ? `${level}:${normalizeAlias(focusedCountry.countryName)}` : null;
    desiredBoundaryDetailKey = nextKey;

    if (!nextKey || !focusedCountry || !level) {
      pendingBoundaryDetailKey = null;
      clearBoundaryDetailLayer();
      return;
    }

    if (displayedBoundaryDetailKey === nextKey || pendingBoundaryDetailKey === nextKey) {
      return;
    }

    clearBoundaryDetailLayer();
    const cachedPayload = boundaryDetailPayloadCache.get(nextKey);
    if (cachedPayload) {
      detailBoundaryGroup.add(buildBoundaryDetailGroup(cachedPayload, ALERT_GLOBE_RADIUS + DETAIL_BOUNDARY_ALTITUDE));
      displayedBoundaryDetailKey = nextKey;
      return;
    }

    const retryAfterMs = boundaryDetailRetryAfterByKey.get(nextKey);
    if (Number.isFinite(retryAfterMs) && Number(retryAfterMs) > Date.now()) {
      return;
    }
    if (Number.isFinite(retryAfterMs)) {
      boundaryDetailRetryAfterByKey.delete(nextKey);
    }

    pendingBoundaryDetailKey = nextKey;
    void fetchBoundaryDetailPayload(focusedCountry.countryName, level, nextKey);
  }

  async function loadRuntimeData() {
    const [localityResult, worldResult] = await Promise.allSettled([
      fetch(LOCALITIES_MAP_API_URL, { cache: "no-store" }),
      fetch(WORLD_TOPOLOGY_URL, { cache: "force-cache" })
    ]);

    let shouldRetry = false;

    if (localityResult.status === "fulfilled") {
      try {
        if (!localityResult.value.ok) {
          throw new Error(`localities map HTTP ${localityResult.value.status}`);
        }

        const localitiesPayload = (await localityResult.value.json()) as LocalityMapPayload;
        buildLocalityLookup(localitiesPayload);
        localitiesReady = localityLookup.size > 0;
        clearGroup(localityTraceGroup);
        if (localitiesReady) {
          localityTraceGroup.add(buildLocalityTraceGroup(localityLookup.values(), ALERT_GLOBE_RADIUS));
        } else {
          shouldRetry = true;
          console.warn("localities map returned no usable localities");
        }
      } catch (error) {
        shouldRetry = true;
        if (!localitiesReady) {
          clearLocalityLookup();
          clearGroup(localityTraceGroup);
        }
        console.warn("localities map load failed", error);
      }
    } else {
      shouldRetry = true;
      if (!localitiesReady) {
        clearLocalityLookup();
        clearGroup(localityTraceGroup);
      }
      console.warn("localities map request failed", localityResult.reason);
    }

    if (worldResult.status === "fulfilled") {
      try {
        if (!worldResult.value.ok) {
          throw new Error(`world topology HTTP ${worldResult.value.status}`);
        }

        const topology = await worldResult.value.json();
        clearGroup(worldLineGroup);
        clearBoundaryDetailLayer();
        resetCountryLabels();
        worldLineGroup.add(buildWorldBoundaryGroup(topology, ALERT_GLOBE_RADIUS + WORLD_BOUNDARY_ALTITUDE));
        for (const labelRecord of buildCountryLabelRecords(
          topology,
          ALERT_GLOBE_RADIUS + COUNTRY_LABEL_ALTITUDE,
          countryLabelTextures
        )) {
          countryLabelRecords.push(labelRecord);
          const anchorKey = normalizeAlias(labelRecord.countryName);
          countryMarkerAnchors.set(anchorKey, {
            lat: labelRecord.centroidLat,
            lng: labelRecord.centroidLng
          });
          registerCountryTextAliasesForAnchor(labelRecord.countryName);
          worldLabelGroup.add(labelRecord.sprite);
        }
        rebuildCountryTextAliasKeys();
        worldDataLoaded = true;
      } catch (error) {
        shouldRetry = true;
        if (!worldDataLoaded) {
          clearGroup(worldLineGroup);
          clearBoundaryDetailLayer();
          resetCountryLabels();
        }
        console.warn("world topology load failed", error);
      }
    } else {
      shouldRetry = true;
      if (!worldDataLoaded) {
        clearGroup(worldLineGroup);
        clearBoundaryDetailLayer();
        resetCountryLabels();
      }
      console.warn("world topology request failed", worldResult.reason);
    }

    newsEventsLoaded = true;
    syncNewsMarkers();
    updateVisuals();
    if (shouldRetry && (!worldDataLoaded || !localitiesReady)) {
      scheduleRetry();
    }
  }

  function zoomBy(multiplier: number) {
    if (!controls) {
      return;
    }

    const offset = camera.position.clone().sub(controls.target);
    const nextDistance = clampNumber(offset.length() / multiplier, controls.minDistance, controls.maxDistance);
    offset.setLength(nextDistance);
    camera.position.copy(controls.target).add(offset);
    updateControlSensitivity();
    controls.update();
  }

  function zoomFromScroll(deltaY: number) {
    if (!controls || deltaY === 0) {
      return;
    }

    const ratio = getCameraDistanceRatio();
    const baseMultiplier = 1.12 + Math.pow(ratio, 1.45) * 0.24;
    const deltaPower = clampNumber(Math.abs(deltaY) / 120, 0.45, 1.8);
    const multiplier = Math.pow(baseMultiplier, deltaPower);
    zoomBy(deltaY < 0 ? multiplier : 1 / multiplier);
  }

  function bindButton(button: HTMLButtonElement | null, handler: () => void) {
    if (!button) {
      return;
    }
    button.addEventListener("click", handler);
    eventDisposers.push(() => button.removeEventListener("click", handler));
  }

  function getSelectionAtPointer(clientX: number, clientY: number): { kind: "news"; id: string } | { kind: "celestial"; id: "sun" | "moon" } | null {
    const canvas = renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);

    const intersections = raycaster.intersectObjects(
      [sunIndicator, moonIndicator, ...newsMarkerGroup.children],
      true
    );
    for (const intersection of intersections) {
      if (!isObjectTreeVisible(intersection.object)) {
        continue;
      }

      const selectionType = String(intersection.object.userData?.selectionType ?? "").trim();
      if (selectionType === "celestial") {
        const celestialId = String(intersection.object.userData?.celestialId ?? "").trim();
        if (celestialId === "sun" || celestialId === "moon") {
          return {
            kind: "celestial" as const,
            id: celestialId
          };
        }
      }

      const eventId = String(intersection.object.userData?.newsEventId ?? "").trim();
      if (eventId) {
        return {
          kind: "news" as const,
          id: eventId
        };
      }
    }

    return null;
  }

  function bindCanvasInteractions() {
    if (canvasInteractionsBound) {
      return;
    }
    canvasInteractionsBound = true;

    const canvas = renderer.domElement;
    canvas.style.cursor = "grab";

    const handlePointerDown = (event: PointerEvent) => {
      pointerDownPosition = { x: event.clientX, y: event.clientY };
      canvas.style.cursor = "grabbing";
    };

    const handlePointerUp = (event: PointerEvent) => {
      const pointerStart = pointerDownPosition;
      pointerDownPosition = null;
      if (!pointerStart) {
        canvas.style.cursor = "grab";
        return;
      }

      const movement = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
      if (movement > 6) {
        canvas.style.cursor = "grab";
        return;
      }

      const selection = getSelectionAtPointer(event.clientX, event.clientY);
      if (!selection) {
        selectCelestial(null);
      } else if (selection.kind === "celestial") {
        selectCelestial(selection.id);
      } else {
        selectNewsEvent(selection.id);
      }
      syncNewsMarkers();
      updateVisuals();
      canvas.style.cursor = selection ? "pointer" : "grab";
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (pointerDownPosition) {
        return;
      }
      const selection = getSelectionAtPointer(event.clientX, event.clientY);
      canvas.style.cursor = selection ? "pointer" : "grab";
    };

    const handlePointerReset = () => {
      pointerDownPosition = null;
      canvas.style.cursor = "grab";
    };

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomFromScroll(event.deltaY);
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerleave", handlePointerReset);
    canvas.addEventListener("pointercancel", handlePointerReset);
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    eventDisposers.push(() => canvas.removeEventListener("pointerdown", handlePointerDown));
    eventDisposers.push(() => canvas.removeEventListener("pointerup", handlePointerUp));
    eventDisposers.push(() => canvas.removeEventListener("pointermove", handlePointerMove));
    eventDisposers.push(() => canvas.removeEventListener("pointerleave", handlePointerReset));
    eventDisposers.push(() => canvas.removeEventListener("pointercancel", handlePointerReset));
    eventDisposers.push(() => canvas.removeEventListener("wheel", handleWheel));
  }

  function clearNewsSelection() {
    if (selectedNewsEventId == null && selectedCelestialId == null) {
      emitSelection(null);
      return;
    }
    selectedNewsEventId = null;
    selectedCelestialId = null;
    emitSelection(null);
    syncNewsMarkers();
    updateVisuals();
  }

  function initInteractions() {
    bindButton(mapZoomInButton, () => zoomBy(1.12));
    bindButton(mapZoomOutButton, () => zoomBy(1 / 1.12));
    bindButton(mapZoomResetButton, () => {
      camera.position.set(0, 0.2, ALERT_GLOBE_CAMERA_RESET_DISTANCE);
      controls?.reset();
      updateControlSensitivity();
    });
  }

  function init() {
    if (!attachRenderer()) {
      return;
    }

    bindCanvasInteractions();

    if (!resizeObserver && globeContainer) {
      resizeObserver = new ResizeObserver(() => resizeRenderer());
      resizeObserver.observe(globeContainer);
    }

    updateCelestialLighting(getMapNowMs());
    void loadRuntimeData();

    renderer.setAnimationLoop(() => {
      const nowMs = getMapNowMs();
      const elapsed = nowMs / 1000;
      updateCelestialLighting(nowMs);
      const cameraDirectionLocal = globeRoot.worldToLocal(camera.position.clone()).normalize();

      for (const [localityId, overlay] of alertOverlays.entries()) {
        const state = localityState.get(localityId);
        const locality = localityLookup.get(localityId);
        if (!state || !locality) {
          removeAlertOverlay(localityId);
          continue;
        }

        const visuals = getAlertStageVisuals(state, nowMs);
        const pulse = 1 + Math.sin(elapsed * visuals.pulseSpeed + overlay.marker.phase) * visuals.pulseAmount;
        const fillPulse = 0.985 + Math.sin(elapsed * visuals.pulseSpeed * 0.66 + overlay.marker.phase) * 0.015;

        if (!overlay.hasPolygon) {
          const coreMaterial = overlay.marker.core.material as SpriteMaterial;
          const haloMaterial = overlay.marker.halo.material as SpriteMaterial;
          coreMaterial.color.set(visuals.color);
          coreMaterial.opacity = visuals.opacity;
          haloMaterial.opacity = 0;
          overlay.marker.halo.visible = false;
          overlay.marker.core.scale.setScalar(visuals.coreScale * 0.82 * pulse);
          setMarkerPosition(overlay.marker, locality.lat, locality.lng, ALERT_MARKER_ALTITUDE);
        }

        if (overlay.fillMesh) {
          const fillMaterial = overlay.fillMesh.material as MeshBasicMaterial;
          fillMaterial.color.set(visuals.color);
          fillMaterial.opacity =
            visuals.opacity *
            (state.stage === STAGE.ACTIVE_SIREN
              ? 0.34
              : state.stage === STAGE.POST_SIREN_UNSAFE
                ? 0.24
                : state.stage === STAGE.PRE_ALERT
                  ? 0.16
                  : 0.14) *
            fillPulse;
        }

        if (overlay.outline) {
          const outlineMaterial = overlay.outline.material as LineBasicMaterial;
          outlineMaterial.color.set(visuals.color);
          outlineMaterial.opacity =
            visuals.opacity *
            (state.stage === STAGE.ACTIVE_SIREN ? 0.96 : state.stage === STAGE.POST_SIREN_UNSAFE ? 0.72 : 0.58);
        }
      }

      for (const [eventId, record] of newsMarkers.entries()) {
        const { marker, newsEvent } = record;
        if (!newsEvent) {
          removeNewsMarker(eventId);
          continue;
        }
        const markerCoordinates = resolveNewsMarkerCoordinates(newsEvent);
        if (!markerCoordinates) {
          removeNewsMarker(eventId);
          continue;
        }

        const scale = getNewsMarkerScale(newsEvent);
        const recencySource = newsEvent.updatedAtIso ?? newsEvent.createdAtIso;
        const ageHours = recencySource ? Math.max(0, (getMapNowMs() - new Date(recencySource).getTime()) / 3_600_000) : 0;
        const freshness = clampNumber(1 - ageHours / ALERT_GLOBE_NEWS_RECENCY_HOURS, 0.25, 1);
        const coreMaterial = marker.core.material as SpriteMaterial;
        const haloMaterial = marker.halo.material as SpriteMaterial;
        const isSelected = selectedNewsEventId === eventId;
        const zoomScale = getNewsMarkerZoomScale();
        const replayPulseProgress =
          record.replayPulseStartedAtMs == null
            ? 0
            : clampNumber(1 - (Date.now() - record.replayPulseStartedAtMs) / NEWS_REPLAY_APPEAR_GLOW_MS, 0, 1);
        if (record.replayPulseStartedAtMs != null && replayPulseProgress <= 0) {
          record.replayPulseStartedAtMs = null;
        }
        const replayPulseOpacity = Math.pow(replayPulseProgress, 1.4) * 0.16;
        const replayPulseScaleMultiplier = 1.22 + replayPulseProgress * 0.55;
        setMarkerPosition(
          marker,
          markerCoordinates.lat,
          markerCoordinates.lng,
          NEWS_MARKER_ALTITUDE,
          record.surfaceOffsetX,
          record.surfaceOffsetY
        );
        const markerDistance = Math.max(marker.container.position.length(), 0.0001);
        const facingDot = marker.container.position.dot(cameraDirectionLocal) / markerDistance;
        const facingBlend = clampNumber(
          MathUtils.smoothstep(facingDot, NEWS_MARKER_FACING_BLEND_START, NEWS_MARKER_FACING_BLEND_END),
          0,
          1
        );
        const baseOpacity = MathUtils.lerp(
          NEWS_MARKER_BACKSIDE_OPACITY + freshness * 0.08,
          0.62 + freshness * 0.26,
          facingBlend
        );
        const haloFacingFactor = MathUtils.lerp(NEWS_MARKER_BACKSIDE_HALO_FACTOR, 1, facingBlend);
        const scaleFacingFactor = MathUtils.lerp(NEWS_MARKER_BACKSIDE_SCALE_FACTOR, 1, facingBlend);

        marker.container.visible = true;
        coreMaterial.opacity = clampNumber(baseOpacity + (isSelected ? 0.12 : 0), 0, 0.98);
        haloMaterial.opacity = Math.max((isSelected ? 0.34 : 0) * haloFacingFactor, replayPulseOpacity * haloFacingFactor);
        marker.halo.visible = haloMaterial.opacity > 0.01;
        marker.core.scale.setScalar(scale * zoomScale * scaleFacingFactor * (isSelected ? 1.12 : 1));
        marker.halo.scale.setScalar(
          scale *
            zoomScale *
            Math.max(getNewsMarkerRingScaleMultiplier(isSelected), replayPulseScaleMultiplier) *
            MathUtils.lerp(0.84, 1, facingBlend)
        );
      }

      updateCountryLabels();
      syncBoundaryDetailLayer();
      updateControlSensitivity();
      controls?.update();
      renderer.render(scene, camera);
    });
  }

  function updateVisuals() {
    const nowMs = getMapNowMs();
    const activeOverlayIds = new Set<number>();
    const counts = {
      preAlert: 0,
      activeSiren: 0,
      postSirenUnsafe: 0,
      safeFade: 0
    };

    for (const [localityId, stateRaw] of Array.from(localityState.entries())) {
      let state = stateRaw;

      if (
        state.stage === STAGE.ACTIVE_SIREN &&
        Number.isFinite(state.sirenEndsAtMs) &&
        nowMs >= Number(state.sirenEndsAtMs)
      ) {
        if (Number.isFinite(state.safeRequestedAtMs)) {
          transitionLocalityToSafeFade(localityId, nowMs);
        } else {
          transitionLocalityToPostSirenUnsafe(
            localityId,
            Number(state.sirenEndsAtMs),
            state.alertStartedAtMs
          );
        }
        state = localityState.get(localityId) ?? state;
      }

      if (
        (state.stage === STAGE.ACTIVE_SIREN || state.stage === STAGE.POST_SIREN_UNSAFE) &&
        nowMs >= state.alertStartedAtMs + ALERT_GLOBE_UNSAFE_AUTO_CLEAR_MS
      ) {
        localityState.delete(localityId);
        removeAlertOverlay(localityId);
        continue;
      }

      if (
        state.stage === STAGE.SAFE_FADE &&
        Number.isFinite(state.safeFadeEndsAtMs) &&
        nowMs >= Number(state.safeFadeEndsAtMs)
      ) {
        localityState.delete(localityId);
        removeAlertOverlay(localityId);
        continue;
      }

      const locality = localityLookup.get(localityId);
      if (!locality) {
        if (localitiesReady) {
          localityState.delete(localityId);
        }
        continue;
      }

      const overlay = ensureAlertOverlay(localityId, locality);
      overlay.container.visible = true;
      activeOverlayIds.add(localityId);

      if (state.stage === STAGE.PRE_ALERT) {
        counts.preAlert += 1;
      } else if (state.stage === STAGE.ACTIVE_SIREN) {
        counts.activeSiren += 1;
      } else if (state.stage === STAGE.POST_SIREN_UNSAFE) {
        counts.postSirenUnsafe += 1;
      } else if (state.stage === STAGE.SAFE_FADE) {
        counts.safeFade += 1;
      }
    }

    for (const localityId of Array.from(alertOverlays.keys())) {
      if (!activeOverlayIds.has(localityId)) {
        removeAlertOverlay(localityId);
      }
    }

    const visibleNewsCount = newsMarkers.size;
    const highlightedCount = counts.preAlert + counts.activeSiren + counts.postSirenUnsafe + counts.safeFade;

    if (!worldDataLoaded && !localitiesReady) {
      setStatus("Loading globe data...");
      return;
    }

    if (!worldDataLoaded) {
      setStatus(`World boundaries unavailable\nAlerts ${highlightedCount}\nNews ${visibleNewsCount}`);
      return;
    }

    if (!localitiesReady) {
      setStatus(`World boundaries ready\nLocalities unavailable\nNews ${visibleNewsCount}`);
      return;
    }

    // if (highlightedCount === 0) {
    //   setStatus(`Manual orbit\nNews ${visibleNewsCount}`);
    //   return;
    // }

    setStatus(
      `Siren ${counts.activeSiren}\nPre-alert ${counts.preAlert}\nUnsafe ${counts.postSirenUnsafe}\nSafe ${counts.safeFade}\nNews ${visibleNewsCount}`
    );
  }

  function resetState() {
    localityState.clear();
    for (const localityId of Array.from(alertOverlays.keys())) {
      removeAlertOverlay(localityId);
    }
    updateVisuals();
  }

  function activateFromAlert(alert: unknown) {
    const payload = alert as Partial<AlertPayload> | null;
    const hasLocations = Array.isArray(payload?.locations) && payload.locations.length > 0;
    const hasLocationIds = Array.isArray(payload?.locationIds) && payload.locationIds.length > 0;
    if (!payload || (!hasLocations && !hasLocationIds)) {
      return;
    }

    const localityIds = getAlertLocalityIds(payload);
    if (localityIds.size === 0) {
      return;
    }

    const nowMs = Date.now();
    const sourceTimeMs = new Date(payload.alertTimestampIso ?? payload.receivedAtIso ?? Date.now()).getTime();
    const activationStartMs = Number.isFinite(sourceTimeMs) ? Math.min(nowMs, sourceTimeMs) : nowMs;
    const elapsedMs = Math.max(0, nowMs - activationStartMs);
    if (elapsedMs >= ALERT_GLOBE_UNSAFE_AUTO_CLEAR_MS) {
      return;
    }

    for (const localityId of localityIds) {
      if (elapsedMs >= ALERT_GLOBE_SIREN_DURATION_MS) {
        transitionLocalityToPostSirenUnsafe(
          localityId,
          activationStartMs + ALERT_GLOBE_SIREN_DURATION_MS,
          activationStartMs
        );
        continue;
      }
      transitionLocalityToActiveSiren(localityId, activationStartMs);
    }
    updateVisuals();
  }

  function applyInferredStates(states: unknown) {
    if (!Array.isArray(states) || states.length === 0) {
      return;
    }

    for (const stateRaw of states as InferredPolygonStatePayload[]) {
      const localityId = Number(stateRaw?.localityId);
      if (!Number.isFinite(localityId)) {
        continue;
      }

      const stage = String(stateRaw?.stage ?? "").toLowerCase();
      const stageStartedAtUnix = Number(stateRaw?.stageStartedAtUnix);
      const latestAlertTimestampUnix = Number(stateRaw?.latestAlertTimestampUnix);
      const baseUnix = Number.isFinite(stageStartedAtUnix)
        ? stageStartedAtUnix
        : Number.isFinite(latestAlertTimestampUnix)
          ? latestAlertTimestampUnix
          : Math.floor(Date.now() / 1000);
      const eventTimeMs = baseUnix * 1000;
      const alertStartedAtMs = Number.isFinite(latestAlertTimestampUnix) ? latestAlertTimestampUnix * 1000 : eventTimeMs;
      if (getMapNowMs() >= alertStartedAtMs + ALERT_GLOBE_UNSAFE_AUTO_CLEAR_MS) {
        continue;
      }

      if (stage === STAGE.ACTIVE_SIREN) {
        transitionLocalityToActiveSiren(localityId, alertStartedAtMs);
        continue;
      }

      if (stage === STAGE.POST_SIREN_UNSAFE) {
        transitionLocalityToPostSirenUnsafe(localityId, eventTimeMs, alertStartedAtMs);
      }
    }

    updateVisuals();
  }

  function setNewsEvents(newsEvents: NewsEventPayload[]) {
    pendingNewsEvents = Array.isArray(newsEvents) ? [...newsEvents] : [];
    syncNewsMarkers();
    updateVisuals();
  }

  function setReplayTimeUnix(unixSeconds: number) {
    const numericUnix = Number(unixSeconds);
    if (!Number.isFinite(numericUnix)) {
      return;
    }
    replayNowMs = Math.floor(numericUnix * 1000);
    updateVisuals();
  }

  function clearReplayTime() {
    if (replayNowMs == null) {
      return;
    }
    replayNowMs = null;
    updateVisuals();
  }

  function handleSystemMessage(systemMessage: unknown) {
    const payload = systemMessage as Partial<SystemMessagePayload> | null;
    if (!payload || typeof payload !== "object") {
      return;
    }

    const kind = classifySystemMessageKind(payload);
    if (kind === "other") {
      return;
    }

    const localityIds = resolveSystemMessageLocalityIds(payload);
    const eventTimeMs = Date.now();

    if (kind === "pre_alert") {
      let touched = false;
      for (const localityId of localityIds) {
        touched = transitionLocalityToPreAlert(localityId, eventTimeMs) || touched;
      }
      if (touched) {
        updateVisuals();
      }
      return;
    }

    if (kind === "safe_to_go_out") {
      const targets = localityIds.size > 0 ? localityIds : new Set(localityState.keys());
      for (const localityId of targets) {
        requestLocalitySafe(localityId, eventTimeMs);
      }
      updateVisuals();
    }
  }

  function destroy() {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }

    resizeObserver?.disconnect();
    resizeObserver = null;

    for (const dispose of eventDisposers.splice(0, eventDisposers.length)) {
      dispose();
    }

    controls?.dispose();
    controls = null;
    clearBoundaryDetailLayer();
    resetCountryLabels();

    renderer.setAnimationLoop(null);
    renderer.dispose();

    scene.traverse((object) => {
      const candidate = object as { geometry?: { dispose?: () => void }; material?: unknown };
      candidate.geometry?.dispose?.();
      disposeMaterial(candidate.material);
    });

    markerTexture.dispose();
    solidMarkerTexture.dispose();
    ringMarkerTexture.dispose();
    celestialDotTexture.dispose();
    celestialRingTexture.dispose();
    emitSelection(null);
    if (globeContainer && renderer.domElement.parentElement === globeContainer) {
      globeContainer.replaceChildren();
    }
  }

  return {
    initInteractions,
    init,
    updateVisuals,
    resetState,
    activateFromAlert,
    applyInferredStates,
    setNewsEvents,
    clearNewsSelection,
    setReplayTimeUnix,
    clearReplayTime,
    handleSystemMessage,
    destroy
  };
}
