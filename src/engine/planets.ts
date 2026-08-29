/**
 * Planet orbital elements and position computation.
 * Uses J2000.0 mean orbital elements from JPL/Standish for all 8 planets.
 * Positions are heliocentric ecliptic cartesian (AU).
 */

import { dateToTDBJD, J2000_JD } from './time';

const DEG = Math.PI / 180;

const EARTH_RADIUS_KM = 6371;
const EARTH_SCENE_R = 0.5;

export interface PlanetInfo {
  name: string;
  symbol: string;
  color: string;
  semiMajorAU: number;
  eccentricity: number;
  inclination: number;
  longPerihelion: number;
  longAscNode: number;
  meanLongJ2000: number;
  meanMotionDegDay: number;
  radiusKm: number;
  /** Proportional to real radius: radiusKm / EARTH_RADIUS_KM * 0.5 */
  sceneRadius: number;
  massKg: number;
  /** Sidereal rotation period in hours. Negative = retrograde. */
  siderealRotationHours: number;
  /** Axial obliquity in degrees (angle between spin axis and orbit normal). */
  axialTiltDeg: number;
  /**
   * Right ascension (deg) and declination (deg) of the north pole in ICRF/J2000.
   * Used to orient the spin axis in ecliptic coordinates.
   */
  poleRA: number;
  poleDec: number;
  surfaceGravityMs2: number;
  escapeVelocityKmS: number;
}

export interface PlanetPosition {
  name: string;
  helioEcliptic: [number, number, number];
  orbitAngle: number;
  distanceAU: number;
  periodDays: number;
  dayInOrbit: number;
  percentComplete: number;
  /** Orbital speed from vis-viva equation (km/s) */
  orbitalSpeedKmS: number;
  /** Perihelion distance (AU) */
  perihelionAU: number;
  /** Aphelion distance (AU) */
  aphelionAU: number;
  /** Solar irradiance relative to Earth at 1 AU (dimensionless) */
  solarIrradiance: number;
}

function sr(km: number) { return (km / EARTH_RADIUS_KM) * EARTH_SCENE_R; }

/**
 * Physical and orbital data from IAU/NASA Planetary Fact Sheets.
 * Pole RA/Dec from IAU 2015 report (ICRF/J2000 epoch).
 * Sidereal rotation negative = retrograde.
 */
export const PLANETS: PlanetInfo[] = [
  {
    name: 'Mercury', symbol: '\u263F', color: '#b5a7a7',
    semiMajorAU: 0.38710, eccentricity: 0.20564, inclination: 7.005,
    longPerihelion: 77.456, longAscNode: 48.331,
    meanLongJ2000: 252.251, meanMotionDegDay: 4.09234,
    radiusKm: 2439.7, sceneRadius: sr(2439.7),
    massKg: 3.3011e23,
    siderealRotationHours: 1407.6,
    axialTiltDeg: 0.034,
    poleRA: 281.01, poleDec: 61.42,
    surfaceGravityMs2: 3.7,
    escapeVelocityKmS: 4.25,
  },
  {
    name: 'Venus', symbol: '\u2640', color: '#e8cda0',
    semiMajorAU: 0.72334, eccentricity: 0.00677, inclination: 3.395,
    longPerihelion: 131.602, longAscNode: 76.680,
    meanLongJ2000: 181.980, meanMotionDegDay: 1.60214,
    radiusKm: 6051.8, sceneRadius: sr(6051.8),
    massKg: 4.8675e24,
    siderealRotationHours: -5832.5,
    axialTiltDeg: 177.36,
    poleRA: 272.76, poleDec: 67.16,
    surfaceGravityMs2: 8.87,
    escapeVelocityKmS: 10.36,
  },
  {
    name: 'Earth', symbol: '\u2295', color: '#4fc3f7',
    semiMajorAU: 1.00000, eccentricity: 0.01671, inclination: 0.000,
    longPerihelion: 102.938, longAscNode: 0.0,
    meanLongJ2000: 100.465, meanMotionDegDay: 0.98561,
    radiusKm: 6371, sceneRadius: sr(6371),
    massKg: 5.9722e24,
    siderealRotationHours: 23.9345,
    axialTiltDeg: 23.44,
    poleRA: 0.0, poleDec: 90.0,
    surfaceGravityMs2: 9.807,
    escapeVelocityKmS: 11.186,
  },
  {
    name: 'Mars', symbol: '\u2642', color: '#e57373',
    semiMajorAU: 1.52371, eccentricity: 0.09339, inclination: 1.850,
    longPerihelion: 336.060, longAscNode: 49.560,
    meanLongJ2000: 355.453, meanMotionDegDay: 0.52403,
    radiusKm: 3389.5, sceneRadius: sr(3389.5),
    massKg: 6.4171e23,
    siderealRotationHours: 24.6229,
    axialTiltDeg: 25.19,
    poleRA: 317.68, poleDec: 52.89,
    surfaceGravityMs2: 3.721,
    escapeVelocityKmS: 5.027,
  },
  {
    name: 'Jupiter', symbol: '\u2643', color: '#d4a574',
    semiMajorAU: 5.20289, eccentricity: 0.04839, inclination: 1.304,
    longPerihelion: 14.728, longAscNode: 100.474,
    meanLongJ2000: 34.396, meanMotionDegDay: 0.08309,
    radiusKm: 69911, sceneRadius: sr(69911),
    massKg: 1.8982e27,
    siderealRotationHours: 9.925,
    axialTiltDeg: 3.13,
    poleRA: 268.057, poleDec: 64.495,
    surfaceGravityMs2: 24.79,
    escapeVelocityKmS: 59.5,
  },
  {
    name: 'Saturn', symbol: '\u2644', color: '#f0d59e',
    semiMajorAU: 9.53668, eccentricity: 0.05386, inclination: 2.486,
    longPerihelion: 92.599, longAscNode: 113.662,
    meanLongJ2000: 49.954, meanMotionDegDay: 0.03346,
    radiusKm: 58232, sceneRadius: sr(58232),
    massKg: 5.6834e26,
    siderealRotationHours: 10.656,
    axialTiltDeg: 26.73,
    poleRA: 40.589, poleDec: 83.537,
    surfaceGravityMs2: 10.44,
    escapeVelocityKmS: 35.5,
  },
  {
    name: 'Uranus', symbol: '\u26E2', color: '#80deea',
    semiMajorAU: 19.18917, eccentricity: 0.04726, inclination: 0.773,
    longPerihelion: 170.954, longAscNode: 74.017,
    meanLongJ2000: 313.238, meanMotionDegDay: 0.01173,
    radiusKm: 25362, sceneRadius: sr(25362),
    massKg: 8.6810e25,
    siderealRotationHours: -17.24,
    axialTiltDeg: 97.77,
    poleRA: 257.311, poleDec: -15.175,
    surfaceGravityMs2: 8.87,
    escapeVelocityKmS: 21.3,
  },
  {
    name: 'Neptune', symbol: '\u2646', color: '#5c6bc0',
    semiMajorAU: 30.06992, eccentricity: 0.00859, inclination: 1.770,
    longPerihelion: 44.965, longAscNode: 131.784,
    meanLongJ2000: 304.880, meanMotionDegDay: 0.00598,
    radiusKm: 24622, sceneRadius: sr(24622),
    massKg: 1.02413e26,
    siderealRotationHours: 16.11,
    axialTiltDeg: 28.32,
    poleRA: 299.36, poleDec: 43.46,
    surfaceGravityMs2: 11.15,
    escapeVelocityKmS: 23.5,
  },
];

/**
 * Convert IAU pole RA/Dec (ICRF equatorial J2000) to ecliptic cartesian unit vector.
 * The ecliptic obliquity at J2000 is 23.4393°.
 */
export function poleToEclipticAxis(raD: number, decD: number): [number, number, number] {
  const ra = raD * DEG;
  const dec = decD * DEG;
  const eps = 23.4393 * DEG;
  const xEq = Math.cos(dec) * Math.cos(ra);
  const yEq = Math.cos(dec) * Math.sin(ra);
  const zEq = Math.sin(dec);
  const xEcl = xEq;
  const yEcl = yEq * Math.cos(eps) + zEq * Math.sin(eps);
  const zEcl = -yEq * Math.sin(eps) + zEq * Math.cos(eps);
  return [xEcl, yEcl, zEcl];
}

function solveKepler(M: number, e: number): number {
  let E = M;
  for (let i = 0; i < 15; i++) {
    const dE = (M - (E - e * Math.sin(E))) / (1 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-10) break;
  }
  return E;
}

/**
 * Compute a single planet's heliocentric ecliptic position at a given Julian Date.
 * Returns [x, y, z] in AU and distance r in AU.
 */
export function computePlanetPosAtJD(
  p: PlanetInfo, jd: number,
): { pos: [number, number, number]; r: number } {
  const d = jd - J2000_JD;
  const L = ((p.meanLongJ2000 + p.meanMotionDegDay * d) % 360 + 360) % 360;
  const M = ((L - p.longPerihelion) % 360 + 360) % 360;
  const MRad = M * DEG;

  const E = solveKepler(MRad, p.eccentricity);

  const sinV = Math.sqrt(1 - p.eccentricity * p.eccentricity) * Math.sin(E)
    / (1 - p.eccentricity * Math.cos(E));
  const cosV = (Math.cos(E) - p.eccentricity)
    / (1 - p.eccentricity * Math.cos(E));
  const v = Math.atan2(sinV, cosV);

  const r = p.semiMajorAU * (1 - p.eccentricity * Math.cos(E));

  const omega = (p.longPerihelion - p.longAscNode) * DEG;
  const Omega = p.longAscNode * DEG;
  const inc = p.inclination * DEG;

  const xOrb = r * Math.cos(v);
  const yOrb = r * Math.sin(v);

  const cosO = Math.cos(Omega), sinO = Math.sin(Omega);
  const cosW = Math.cos(omega), sinW = Math.sin(omega);
  const cosI = Math.cos(inc), sinI = Math.sin(inc);

  const x = (cosO * cosW - sinO * sinW * cosI) * xOrb
          + (-cosO * sinW - sinO * cosW * cosI) * yOrb;
  const y = (sinO * cosW + cosO * sinW * cosI) * xOrb
          + (-sinO * sinW + cosO * cosW * cosI) * yOrb;
  const z = (sinW * sinI) * xOrb + (cosW * sinI) * yOrb;

  return { pos: [x, y, z], r };
}

const GM_SUN_AU3D2 = 2.9591220828559115e-4;
const AU_KM = 149597870.7;
const SOLAR_CONST_WM2 = 1361;

export function computePlanetPositions(date: Date): PlanetPosition[] {
  const jd = dateToTDBJD(date);
  const d = jd - J2000_JD;

  return PLANETS.map(p => {
    const { pos, r } = computePlanetPosAtJD(p, jd);

    const L = ((p.meanLongJ2000 + p.meanMotionDegDay * d) % 360 + 360) % 360;
    const M = ((L - p.longPerihelion) % 360 + 360) % 360;

    const periodDays = 360 / p.meanMotionDegDay;
    const dayInOrbit = M / p.meanMotionDegDay;
    const percentComplete = (M / 360) * 100;

    const a = p.semiMajorAU;
    const e = p.eccentricity;
    const vAuDay = Math.sqrt(GM_SUN_AU3D2 * (2 / r - 1 / a));
    const orbitalSpeedKmS = vAuDay * AU_KM / 86400;
    const perihelionAU = a * (1 - e);
    const aphelionAU = a * (1 + e);
    const solarIrradiance = 1 / (r * r);

    return {
      name: p.name,
      helioEcliptic: pos,
      orbitAngle: Math.atan2(pos[1], pos[0]),
      distanceAU: r,
      periodDays,
      dayInOrbit,
      percentComplete,
      orbitalSpeedKmS,
      perihelionAU,
      aphelionAU,
      solarIrradiance,
    };
  });
}

export function computeOrbitPath(planet: PlanetInfo, steps = 200): [number, number, number][] {
  const a = planet.semiMajorAU;
  const e = planet.eccentricity;
  const omega = (planet.longPerihelion - planet.longAscNode) * DEG;
  const Omega = planet.longAscNode * DEG;
  const inc = planet.inclination * DEG;

  const cosO = Math.cos(Omega), sinO = Math.sin(Omega);
  const cosW = Math.cos(omega), sinW = Math.sin(omega);
  const cosI = Math.cos(inc), sinI = Math.sin(inc);

  const points: [number, number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const v = (i / steps) * 2 * Math.PI;
    const r = a * (1 - e * e) / (1 + e * Math.cos(v));
    const xOrb = r * Math.cos(v);
    const yOrb = r * Math.sin(v);

    const x = (cosO * cosW - sinO * sinW * cosI) * xOrb
            + (-cosO * sinW - sinO * cosW * cosI) * yOrb;
    const y = (sinO * cosW + cosO * sinW * cosI) * xOrb
            + (-sinO * sinW + cosO * cosW * cosI) * yOrb;
    const z = (sinW * sinI) * xOrb + (cosW * sinI) * yOrb;
    points.push([x, y, z]);
  }
  return points;
}
