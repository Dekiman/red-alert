import { Vector3, MathUtils } from "three";

/**
 * Basic Lat/Lng to Vector3 conversion for a sphere of given radius.
 */
export function latLngToVector3(lat: number, lng: number, radius: number) {
  const latRad = MathUtils.degToRad(lat);
  const lngRad = MathUtils.degToRad(lng);
  const cosLat = Math.cos(latRad);
  return new Vector3(
    radius * cosLat * Math.sin(lngRad),
    radius * Math.sin(latRad),
    radius * cosLat * Math.cos(lngRad)
  );
}

/**
 * Calculates a tangent basis on the surface of a sphere.
 */
export function getSurfaceTangentBasis(surfaceNormal: Vector3) {
  const referenceAxis = Math.abs(surfaceNormal.y) > 0.92 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
  const tangent = new Vector3().crossVectors(referenceAxis, surfaceNormal).normalize();
  const bitangent = new Vector3().crossVectors(surfaceNormal, tangent).normalize();
  return { tangent, bitangent };
}

/**
 * Lat/Lng to Vector3 with optional surface offsets.
 */
export function latLngToOffsetSurfaceVector3(
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

/**
 * Calculates the subsolar point (lat, lng) for a given date.
 */
export function getSubsolarPoint(date: Date) {
  const dayOfYear = Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86400000);
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;

  // Declination
  const declination = -23.44 * Math.cos(MathUtils.degToRad((360 / 365) * (dayOfYear + 10)));
  
  // Longitude (approximate subsolar longitude)
  // At 12:00 UTC, the subsolar point is roughly at 0 degrees longitude (Greenwich)
  // Earth rotates ~15 degrees per hour.
  const lng = -15 * (hour - 12);

  return { lat: declination, lng: ((lng + 180) % 360) - 180 };
}

/**
 * Calculates the approximate sublunar point (lat, lng) for a given date.
 */
export function getSublunarPoint(date: Date) {
  // Very simplified lunar cycle approximation
  const msSinceEpoch = date.getTime();
  const lunarMonthMs = 29.53059 * 24 * 60 * 60 * 1000;
  const phase = (msSinceEpoch % lunarMonthMs) / lunarMonthMs;
  
  // Moon orbits roughly on the ecliptic (with ~5 deg inclination)
  const declination = 20 * Math.sin(MathUtils.degToRad(phase * 360));
  
  // Moon longitude moves ~13.2 degrees per day relative to stars, 
  // but Earth's rotation is the dominant factor for the sublunar point.
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const moonLngOffset = phase * 360;
  const lng = -15 * (hour - 12) + moonLngOffset;

  return { lat: declination, lng: ((lng + 180) % 360) - 180 };
}

/**
 * Calculates the Earth's Y-rotation (radians) for strictly real-time accuracy.
 * At 00:00 UTC, the prime meridian is roughly opposite the sun.
 */
export function getRealTimeEarthRotation(date: Date) {
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  // Rotation is such that at 12:00 UTC, 0 longitude faces the front (Z+ in Three.js default)
  // or depends on how latLngToVector3 is mapped.
  // Our latLngToVector3 maps 0,0 to (0, 0, radius).
  // So at 12:00 UTC, rotation should be 0.
  return MathUtils.degToRad(15 * (hour - 12));
}
