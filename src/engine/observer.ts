/**
 * Scene data computation for the 3D orrery view.
 * Computes Earth's trajectory, body positions, rotation state.
 */

import { earthHelioEcliptic } from './vsop87';
import { moonPosition } from './lunar';
import { dateToTDBJD, dateToJD, gmst } from './time';
import {
  Vec3, vec3Add, vec3Sub, vec3Scale, vec3Length, vec3Normalize,
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
  /** Sun direction from Earth at this time (ecliptic cartesian, unit vector) */
  sunDir: Vec3;
  dayOffset: number;
}

export interface SceneData {
  /** Earth's velocity direction (ecliptic cartesian, unit vector) — true, including galactic */
  velocityDir: Vec3;
  /** Earth's total speed through space (km/s) — orbital + galactic */
  speedKmS: number;
  /** Earth's orbital velocity direction (ecliptic, unit vector) — heliocentric only */
  orbitalVelocityDir: Vec3;
  /** Earth's orbital speed (km/s) — heliocentric only */
  orbitalSpeedKmS: number;
  /** Earth's rotation axis direction (ecliptic cartesian, unit vector) */
  axisDir: Vec3;
  /** Greenwich Mean Sidereal Time (radians) — Earth's rotation angle */
  rotationAngle: number;
  /** Obliquity of the ecliptic (radians) */
  obliquity: number;
  /** Trajectory points ±N days (galactic drift compressed for visualization) */
  trajectory: TrajectoryPoint[];
  /** Sun direction from Earth (ecliptic cartesian, unit vector) */
  sunDir: Vec3;
  /** Sun distance (AU) */
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
// Direction: galactic (l=90°, b=0°) → equatorial RA≈318°, Dec≈+48° → ecliptic cartesian
const SOLAR_GALACTIC_SPEED_KMS = 230;
const SOLAR_GALACTIC_SPEED_AU_DAY = SOLAR_GALACTIC_SPEED_KMS * 86400 / AU_KM;
const SOLAR_GALACTIC_DIR: Vec3 = vec3Normalize([0.497, -0.115, 0.860]);
const SOLAR_VEL_AU_DAY: Vec3 = vec3Scale(SOLAR_GALACTIC_DIR, SOLAR_GALACTIC_SPEED_AU_DAY);

// Visualization compression: real galactic drift is 46 AU/year vs 1 AU orbital radius.
// At true scale the helix looks like a straight line. Compress galactic drift 8× so
// the corkscrew shape is clearly visible (pitch:radius ≈ 5.75:1 instead of 46:1).
const GALACTIC_VIS_COMPRESSION = 8;

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
  const orbitalVelKmS = vec3Scale(earthVel, AU_DAY_TO_KM_S);
  const orbitalSpeedKmS = vec3Length(orbitalVelKmS);
  const orbitalVelocityDir = vec3Normalize(earthVel);

  // True velocity = orbital + Sun's galactic motion
  const totalVel = vec3Add(earthVel, SOLAR_VEL_AU_DAY);
  const velKmS = vec3Scale(totalVel, AU_DAY_TO_KM_S);
  const speedKmS = vec3Length(velKmS);
  const velocityDir = vec3Normalize(totalVel);

  // Earth's rotation axis in ecliptic coordinates
  // NCP in equatorial = (0, 0, 1), convert to ecliptic
  const axisDir: Vec3 = [0, Math.sin(eps), Math.cos(eps)];

  // GMST = Earth's rotation angle
  const rotationAngle = gmst(jdUTC);

  // Trajectory: adaptive step sizes — fine near "now", coarser far out
  // This lets us cover ±100 years without computing millions of points
  const trajectory: TrajectoryPoint[] = [];
  const dayOffsets: number[] = [];

  // Build adaptive sample schedule — dense near "now", sparser far out
  for (let d = -daysRange; d <= daysRange;) {
    dayOffsets.push(d);
    const abs = Math.abs(d);
    if (abs < 2) d += 0.125;       // ±2 days: every 3 hours (smooth junction)
    else if (abs < 14) d += 0.5;   // ±2 weeks: every 12 hours
    else if (abs < 60) d += 1;     // ±2 months: daily
    else if (abs < 365) d += 3;    // ±1 year: every 3 days
    else if (abs < 3650) d += 10;  // ±10 years: every 10 days
    else d += 30;                  // beyond: monthly
  }
  if (dayOffsets[dayOffsets.length - 1] < daysRange) dayOffsets.push(daysRange);

  for (const dayOff of dayOffsets) {
    const tJD = jd + dayOff;
    const e = earthHelioEcliptic(tJD);
    const pos = eclipticSphericalToCartesian(e.L, e.B, e.R);
    const helioOffset = vec3Sub(pos, earthPos);
    const galacticDrift = vec3Scale(SOLAR_VEL_AU_DAY, dayOff / GALACTIC_VIS_COMPRESSION);
    trajectory.push({
      pos: vec3Add(helioOffset, galacticDrift),
      sunDir: vec3Normalize(vec3Scale(pos, -1)),
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
    velocityDir, speedKmS,
    orbitalVelocityDir, orbitalSpeedKmS,
    axisDir, rotationAngle, obliquity: eps,
    trajectory, sunDir, sunDistAU, moonDir, moonDistKm,
    solarGalacticDir: SOLAR_GALACTIC_DIR,
    solarGalacticSpeedKmS: SOLAR_GALACTIC_SPEED_KMS,
  };
}
