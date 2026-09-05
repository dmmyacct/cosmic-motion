/**
 * Scene data computation for the 3D orrery view.
 * Heliocentric frame: Sun at origin, all positions absolute heliocentric ecliptic.
 */

import { earthHelioEcliptic } from './vsop87';
import { moonPosition } from './lunar';
import { dateToTDBJD, dateToJD, gmst } from './time';
import { PLANETS, computePlanetPosAtJD } from './planets';
import {
  Vec3, vec3Add, vec3Scale, vec3Length, vec3Normalize,
  eclipticSphericalToCartesian, eclipticVelocityToCartesian,
  obliquity, raDecToCartesian, equatorialToEcliptic,
} from './coordinates';
import { AU_KM } from './constants';

export interface ObserverLocation {
  latDeg: number;
  lonDeg: number;
  altitudeKm: number;
}

export interface TrajectoryPoint {
  /** Absolute heliocentric ecliptic position (AU) */
  pos: Vec3;
  /** Distance from Sun at this time (AU) */
  sunDist: number;
  dayOffset: number;
}

export interface SceneData {
  /** Earth's heliocentric ecliptic position (AU) — absolute, not a direction */
  earthPos: Vec3;
  /** Earth's orbital velocity direction (ecliptic, unit vector) */
  orbitalVelocityDir: Vec3;
  /** Earth's orbital speed (km/s) */
  orbitalSpeedKmS: number;
  /** Earth's total speed through space (km/s) — orbital + galactic */
  speedKmS: number;
  /** Earth's velocity direction (ecliptic cartesian, unit vector) — true, including galactic */
  velocityDir: Vec3;
  /** Earth's rotation axis direction (ecliptic cartesian, unit vector) */
  axisDir: Vec3;
  /** Greenwich Mean Sidereal Time (radians) — Earth's rotation angle */
  rotationAngle: number;
  /** Obliquity of the ecliptic (radians) */
  obliquity: number;
  /** Trajectory points ±N days — absolute heliocentric positions */
  trajectory: TrajectoryPoint[];
  /** Sun distance from Earth (AU) */
  sunDistAU: number;
  /** Moon direction from Earth (ecliptic cartesian, unit vector) */
  moonDir: Vec3;
  /** Moon distance (km) */
  moonDistKm: number;
  /** Sun's direction of galactic travel (ecliptic cartesian, unit vector) */
  solarGalacticDir: Vec3;
  /** Sun's galactic speed (km/s) */
  solarGalacticSpeedKmS: number;
}

const AU_DAY_TO_KM_S = AU_KM / 86400.0;

// Sun's velocity through the galaxy (~230 km/s toward galactic rotation direction)
const SOLAR_GALACTIC_SPEED_KMS = 230;
const SOLAR_GALACTIC_SPEED_AU_DAY = SOLAR_GALACTIC_SPEED_KMS * 86400 / AU_KM;
const SOLAR_GALACTIC_DIR: Vec3 = vec3Normalize([0.497, -0.115, 0.860]);
const SOLAR_VEL_AU_DAY: Vec3 = vec3Scale(SOLAR_GALACTIC_DIR, SOLAR_GALACTIC_SPEED_AU_DAY);

export function computeSceneData(
  date: Date,
  daysRange: number = 10,
): SceneData {
  const jd = dateToTDBJD(date);
  const jdUTC = dateToJD(date);
  const eps = obliquity(jd);

  // Current Earth heliocentric ecliptic
  const earth = earthHelioEcliptic(jd);
  const earthPos = eclipticSphericalToCartesian(earth.L, earth.B, earth.R);
  const earthVel = eclipticVelocityToCartesian(
    earth.L, earth.B, earth.R,
    earth.dL, earth.dB, earth.dR,
  );

  // Orbital velocity (heliocentric)
  const orbitalSpeedKmS = vec3Length(vec3Scale(earthVel, AU_DAY_TO_KM_S));
  const orbitalVelocityDir = vec3Normalize(earthVel);

  // True velocity = orbital + Sun's galactic motion
  const totalVel = vec3Add(earthVel, SOLAR_VEL_AU_DAY);
  const speedKmS = vec3Length(vec3Scale(totalVel, AU_DAY_TO_KM_S));
  const velocityDir = vec3Normalize(totalVel);

  // Earth's rotation axis in ecliptic coordinates
  const axisDir: Vec3 = [0, Math.sin(eps), Math.cos(eps)];
  const rotationAngle = gmst(jdUTC);

  // Trajectory: absolute heliocentric positions with adaptive stepping
  // Cap at ~12° of orbital arc (Earth ~0.986°/day → max ~12.2 day steps)
  const earthMaxStep = 12 / 0.9856;
  const trajectory: TrajectoryPoint[] = [];
  const dayOffsets: number[] = [];

  for (let d = -daysRange; d <= daysRange;) {
    dayOffsets.push(d);
    const abs = Math.abs(d);
    let step: number;
    if (abs < 2) step = 0.125;
    else if (abs < 14) step = 0.5;
    else if (abs < 60) step = 1;
    else if (abs < 365) step = 3;
    else if (abs < 3650) step = 10;
    else step = 30;
    d += Math.min(step, earthMaxStep);
  }
  if (dayOffsets[dayOffsets.length - 1] < daysRange) dayOffsets.push(daysRange);

  for (const dayOff of dayOffsets) {
    const tJD = jd + dayOff;
    const e = earthHelioEcliptic(tJD);
    const pos = eclipticSphericalToCartesian(e.L, e.B, e.R);
    trajectory.push({
      pos,
      sunDist: e.R,
      dayOffset: dayOff,
    });
  }

  const sunDistAU = earth.R;

  // Moon
  const moon = moonPosition(jd);
  const moonDirEq = raDecToCartesian(moon.ra, moon.dec);
  const moonDir = equatorialToEcliptic(moonDirEq, eps);
  const moonDistKm = moon.distance;

  return {
    earthPos, velocityDir, speedKmS,
    orbitalVelocityDir, orbitalSpeedKmS,
    axisDir, rotationAngle, obliquity: eps,
    trajectory, sunDistAU, moonDir, moonDistKm,
    solarGalacticDir: SOLAR_GALACTIC_DIR,
    solarGalacticSpeedKmS: SOLAR_GALACTIC_SPEED_KMS,
  };
}

export interface PlanetTrajectory {
  name: string;
  color: string;
  points: TrajectoryPoint[];
}

/**
 * Compute trajectory arrays for all planets (excluding Earth, which uses VSOP87).
 * Uses the same adaptive time stepping as Earth's trajectory.
 * Each point is an absolute heliocentric ecliptic position in AU.
 */
export function computePlanetTrajectories(
  date: Date,
  daysRange: number,
): PlanetTrajectory[] {
  const jd = dateToTDBJD(date);

  return PLANETS.filter(p => p.name !== 'Earth').map(planet => {
    // Per-planet stepping: cap at ~12° of orbital arc so the body
    // always sits on the line (≥30 segments per orbit)
    const maxStepDays = 12 / planet.meanMotionDegDay;

    const dayOffsets: number[] = [];
    for (let d = -daysRange; d <= daysRange;) {
      dayOffsets.push(d);
      const abs = Math.abs(d);
      let step: number;
      if (abs < 2) step = 0.125;
      else if (abs < 14) step = 0.5;
      else if (abs < 60) step = 1;
      else if (abs < 365) step = 3;
      else if (abs < 3650) step = 10;
      else step = 30;
      d += Math.min(step, maxStepDays);
    }
    if (dayOffsets[dayOffsets.length - 1] < daysRange) dayOffsets.push(daysRange);

    const points: TrajectoryPoint[] = dayOffsets.map(dayOff => {
      const { pos, r } = computePlanetPosAtJD(planet, jd + dayOff);
      return { pos, sunDist: r, dayOffset: dayOff };
    });
    return { name: planet.name, color: planet.color, points };
  });
}
