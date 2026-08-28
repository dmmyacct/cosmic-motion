/**
 * Scene data computation for the 3D orrery view.
 * Computes Earth's trajectory, body positions, rotation state.
 */

import { earthHelioEcliptic } from './vsop87';
import { moonPosition } from './lunar';
import { dateToTDBJD, dateToJD, gmst } from './time';
import {
  Vec3, vec3Sub, vec3Scale, vec3Length, vec3Normalize,
  eclipticSphericalToCartesian, eclipticVelocityToCartesian,
  obliquity, raDecToCartesian, equatorialToEcliptic,
} from './coordinates';
import { AU_KM, DEG } from './constants';

export interface ObserverLocation {
  latDeg: number;
  lonDeg: number;
  altitudeKm: number;
}

export interface TrajectoryPoint {
  /** Position relative to current Earth, ecliptic cartesian (AU) */
  pos: Vec3;
  dayOffset: number;
}

export interface SceneData {
  /** Earth's velocity direction (ecliptic cartesian, unit vector) */
  velocityDir: Vec3;
  /** Earth's orbital speed (km/s) */
  speedKmS: number;
  /** Earth's rotation axis direction (ecliptic cartesian, unit vector) */
  axisDir: Vec3;
  /** Greenwich Mean Sidereal Time (radians) — Earth's rotation angle */
  rotationAngle: number;
  /** Obliquity of the ecliptic (radians) */
  obliquity: number;
  /** Trajectory points ±N days */
  trajectory: TrajectoryPoint[];
  /** Sun direction from Earth (ecliptic cartesian, unit vector) */
  sunDir: Vec3;
  /** Sun distance (AU) */
  sunDistAU: number;
  /** Moon direction from Earth (ecliptic cartesian, unit vector) */
  moonDir: Vec3;
  /** Moon distance (km) */
  moonDistKm: number;
}

const AU_DAY_TO_KM_S = AU_KM / 86400.0;

export function computeSceneData(
  date: Date,
  daysRange: number = 10,
  stepsPerDay: number = 4,
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

  // Velocity direction and speed
  const velKmS = vec3Scale(earthVel, AU_DAY_TO_KM_S);
  const speedKmS = vec3Length(velKmS);
  const velocityDir = vec3Normalize(earthVel);

  // Earth's rotation axis in ecliptic coordinates
  // NCP in equatorial = (0, 0, 1), convert to ecliptic
  const axisDir: Vec3 = [0, Math.sin(eps), Math.cos(eps)];

  // GMST = Earth's rotation angle
  const rotationAngle = gmst(jdUTC);

  // Trajectory: positions at regular intervals
  const totalSteps = daysRange * stepsPerDay * 2;
  const trajectory: TrajectoryPoint[] = [];
  for (let i = -totalSteps / 2; i <= totalSteps / 2; i++) {
    const dayOff = (i / stepsPerDay);
    const tJD = jd + dayOff;
    const e = earthHelioEcliptic(tJD);
    const pos = eclipticSphericalToCartesian(e.L, e.B, e.R);
    trajectory.push({
      pos: vec3Sub(pos, earthPos),
      dayOffset: dayOff,
    });
  }

  // Sun direction (opposite of Earth's heliocentric position)
  const sunDir = vec3Normalize(vec3Scale(earthPos, -1));
  const sunDistAU = earth.R;

  // Moon
  const moon = moonPosition(jd);
  const moonDirEq = raDecToCartesian(moon.ra, moon.dec);
  const moonDir = equatorialToEcliptic(moonDirEq, eps);
  const moonDistKm = moon.distance;

  return {
    velocityDir, speedKmS, axisDir, rotationAngle, obliquity: eps,
    trajectory, sunDir, sunDistAU, moonDir, moonDistKm,
  };
}
