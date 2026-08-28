/**
 * Coordinate frame transformations.
 * All transforms follow IAU conventions.
 */

import {
  OBLIQUITY_J2000, EARTH_RADIUS_EQUATORIAL_KM, EARTH_FLATTENING,
  EARTH_OMEGA, AU_KM, DEG, NGP_RA, NGP_DEC, GALACTIC_CENTER_RA,
  V_LSR_KM_S, SOLAR_PECULIAR_U, SOLAR_PECULIAR_V, SOLAR_PECULIAR_W,
} from './constants';
import { julianCenturies } from './time';

export type Vec3 = [number, number, number];

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vec3Scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

export function vec3Length(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

export function vec3Normalize(v: Vec3): Vec3 {
  const len = vec3Length(v);
  if (len === 0) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function vec3Cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function vec3Dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Convert spherical ecliptic (L, B, R) to Cartesian ecliptic (x, y, z) */
export function eclipticSphericalToCartesian(L: number, B: number, R: number): Vec3 {
  const cosB = Math.cos(B);
  return [
    R * cosB * Math.cos(L),
    R * cosB * Math.sin(L),
    R * Math.sin(B),
  ];
}

/**
 * Convert heliocentric ecliptic velocity from spherical rates to Cartesian.
 * Given position (L,B,R) and rates (dL,dB,dR), compute (vx,vy,vz) in ecliptic frame.
 */
export function eclipticVelocityToCartesian(
  L: number, B: number, R: number,
  dL: number, dB: number, dR: number,
): Vec3 {
  const cosB = Math.cos(B);
  const sinB = Math.sin(B);
  const cosL = Math.cos(L);
  const sinL = Math.sin(L);

  const vx = dR * cosB * cosL - R * dB * sinB * cosL - R * dL * cosB * sinL;
  const vy = dR * cosB * sinL - R * dB * sinB * sinL + R * dL * cosB * cosL;
  const vz = dR * sinB + R * dB * cosB;

  return [vx, vy, vz];
}

/** Ecliptic to equatorial rotation (J2000) */
export function eclipticToEquatorial(v: Vec3, obliquity?: number): Vec3 {
  const eps = obliquity ?? OBLIQUITY_J2000;
  const cosE = Math.cos(eps);
  const sinE = Math.sin(eps);
  return [
    v[0],
    v[1] * cosE - v[2] * sinE,
    v[1] * sinE + v[2] * cosE,
  ];
}

/** Equatorial to ecliptic rotation (J2000) */
export function equatorialToEcliptic(v: Vec3, obliquity?: number): Vec3 {
  const eps = obliquity ?? OBLIQUITY_J2000;
  const cosE = Math.cos(eps);
  const sinE = Math.sin(eps);
  return [
    v[0],
    v[1] * cosE + v[2] * sinE,
    -v[1] * sinE + v[2] * cosE,
  ];
}

/**
 * Equatorial J2000 to galactic Cartesian.
 * Uses IAU 1958 galactic pole / ascending node.
 */
export function equatorialToGalactic(v: Vec3): Vec3 {
  const sinDec = Math.sin(NGP_DEC);
  const cosDec = Math.cos(NGP_DEC);
  const sinRA = Math.sin(NGP_RA);
  const cosRA = Math.cos(NGP_RA);

  // Galactic center direction in equatorial
  const l_asc = GALACTIC_CENTER_RA - Math.PI / 2; // ascending node longitude

  const sinLasc = Math.sin(l_asc);
  const cosLasc = Math.cos(l_asc);

  // Rotation matrix: equatorial → galactic
  // Row 1: toward galactic center
  // Row 2: in direction of galactic rotation (l=90)
  // Row 3: toward north galactic pole
  const x1 = -Math.sin(l_asc) * sinRA - Math.cos(l_asc) * cosRA * sinDec + cosRA * cosDec;
  const y1 = Math.sin(l_asc) * cosRA - Math.cos(l_asc) * sinRA * sinDec + sinRA * cosDec;

  // Simplified IAU galactic rotation matrix
  const r00 = -0.0548755604, r01 = -0.8734370902, r02 = -0.4838350155;
  const r10 = +0.4941094279, r11 = -0.4448296300, r12 = +0.7469822445;
  const r20 = -0.8676661490, r21 = -0.1980763734, r22 = +0.4559837762;

  return [
    r00 * v[0] + r01 * v[1] + r02 * v[2],
    r10 * v[0] + r11 * v[1] + r12 * v[2],
    r20 * v[0] + r21 * v[1] + r22 * v[2],
  ];
}

/** Galactic to equatorial J2000 */
export function galacticToEquatorial(v: Vec3): Vec3 {
  // Transpose of the galactic rotation matrix
  const r00 = -0.0548755604, r01 = +0.4941094279, r02 = -0.8676661490;
  const r10 = -0.8734370902, r11 = -0.4448296300, r12 = -0.1980763734;
  const r20 = -0.4838350155, r21 = +0.7469822445, r22 = +0.4559837762;

  return [
    r00 * v[0] + r01 * v[1] + r02 * v[2],
    r10 * v[0] + r11 * v[1] + r12 * v[2],
    r20 * v[0] + r21 * v[1] + r22 * v[2],
  ];
}

/**
 * Equatorial Cartesian to horizontal (azimuth/altitude) frame.
 * Returns [East, North, Up] vector in local tangent plane.
 */
export function equatorialToHorizontal(
  v: Vec3,
  lstRad: number,
  latRad: number,
): Vec3 {
  const cosLST = Math.cos(lstRad);
  const sinLST = Math.sin(lstRad);
  const cosLat = Math.cos(latRad);
  const sinLat = Math.sin(latRad);

  // First rotate by -LST around z-axis (equatorial → hour angle frame)
  const xh = cosLST * v[0] + sinLST * v[1];
  const yh = -sinLST * v[0] + cosLST * v[1];
  const zh = v[2];

  // Then rotate by (π/2 - lat) around the y-axis to get to local horizon
  // East = -yh (hour angle y-axis is west)
  // North = -sinLat * xh + cosLat * zh
  // Up = cosLat * xh + sinLat * zh
  return [
    -yh,
    -sinLat * xh + cosLat * zh,
    cosLat * xh + sinLat * zh,
  ];
}

/**
 * Compute observer's position vector from Earth center in equatorial coords (km).
 * Uses WGS84 ellipsoid.
 */
export function observerGeocentricPosition(
  latRad: number,
  lonRad: number,
  altitudeKm: number,
): Vec3 {
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const sinLon = Math.sin(lonRad);
  const cosLon = Math.cos(lonRad);

  const e2 = 2 * EARTH_FLATTENING - EARTH_FLATTENING * EARTH_FLATTENING;
  const N = EARTH_RADIUS_EQUATORIAL_KM / Math.sqrt(1 - e2 * sinLat * sinLat);

  const x = (N + altitudeKm) * cosLat * cosLon;
  const y = (N + altitudeKm) * cosLat * sinLon;
  const z = (N * (1 - e2) + altitudeKm) * sinLat;

  return [x, y, z];
}

/**
 * Compute observer's velocity from Earth rotation in equatorial coords (km/s).
 * v = ω × r
 */
export function observerRotationVelocity(
  latRad: number,
  lonRad: number,
  altitudeKm: number,
): Vec3 {
  const pos = observerGeocentricPosition(latRad, lonRad, altitudeKm);
  // ω points along equatorial z-axis: [0, 0, EARTH_OMEGA]
  return [
    -EARTH_OMEGA * pos[1],
    EARTH_OMEGA * pos[0],
    0,
  ];
}

/**
 * Compute the Sun's velocity in the galactic frame (km/s).
 * Returns in equatorial J2000 Cartesian coordinates.
 * Combines circular LSR velocity + solar peculiar motion.
 */
export function sunGalacticVelocity(): Vec3 {
  // In galactic Cartesian: x=toward center, y=direction of rotation, z=toward NGP
  // LSR moves at V_LSR in the +y direction (direction of galactic rotation)
  // Solar peculiar motion: U=toward center (+x), V=rotation direction (+y), W=toward NGP (+z)
  const vGal: Vec3 = [
    -SOLAR_PECULIAR_U, // U is toward center, we want away from center for velocity
    V_LSR_KM_S + SOLAR_PECULIAR_V,
    SOLAR_PECULIAR_W,
  ];

  return galacticToEquatorial(vGal);
}

/**
 * Convert a direction (unit vector in equatorial) to RA/Dec.
 */
export function cartesianToRADec(v: Vec3): { ra: number; dec: number } {
  const len = vec3Length(v);
  const n = len > 0 ? vec3Scale(v, 1 / len) : v;
  const dec = Math.asin(n[2]);
  let ra = Math.atan2(n[1], n[0]);
  if (ra < 0) ra += 2 * Math.PI;
  return { ra, dec };
}

/** Convert RA/Dec to unit vector in equatorial Cartesian */
export function raDecToCartesian(ra: number, dec: number): Vec3 {
  return [
    Math.cos(dec) * Math.cos(ra),
    Math.cos(dec) * Math.sin(ra),
    Math.sin(dec),
  ];
}

/**
 * Obliquity of the ecliptic for a given JD (radians).
 * IAU 2006 precession.
 */
export function obliquity(jd: number): number {
  const T = julianCenturies(jd);
  const eps = 23.439291111 - 0.0130042 * T - 1.64e-7 * T * T + 5.04e-7 * T * T * T;
  return eps * DEG;
}
