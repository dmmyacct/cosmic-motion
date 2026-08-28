/**
 * Astronomical time computations.
 * Handles Julian Date, centuries from J2000, sidereal time, and ΔT.
 */

export const J2000_JD = 2451545.0;
export const JD_UNIX_EPOCH = 2440587.5;
export const SECONDS_PER_DAY = 86400;

/** Convert a JS Date to Julian Date */
export function dateToJD(date: Date): number {
  return date.getTime() / (SECONDS_PER_DAY * 1000) + JD_UNIX_EPOCH;
}

/** Julian centuries from J2000.0 */
export function julianCenturies(jd: number): number {
  return (jd - J2000_JD) / 36525.0;
}

/** Julian millennia from J2000.0 (used by VSOP87) */
export function julianMillennia(jd: number): number {
  return (jd - J2000_JD) / 365250.0;
}

/**
 * ΔT approximation (TDB - UTC) in seconds.
 * Polynomial fit valid roughly 2000-2100.
 */
export function deltaT(year: number): number {
  const t = year - 2000;
  return 62.92 + 0.32217 * t + 0.005589 * t * t;
}

/** Year (fractional) from a JS Date */
export function dateToYear(date: Date): number {
  const y = date.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  const end = Date.UTC(y + 1, 0, 1);
  return y + (date.getTime() - start) / (end - start);
}

/** Convert UTC Date to TDB Julian Date */
export function dateToTDBJD(date: Date): number {
  const jd = dateToJD(date);
  const year = dateToYear(date);
  const dt = deltaT(year);
  return jd + dt / SECONDS_PER_DAY;
}

/**
 * Greenwich Mean Sidereal Time (radians).
 * IAU 1982 model with 2000-era correction.
 */
export function gmst(jd: number): number {
  const T = julianCenturies(jd);
  // In seconds of time
  let theta = 280.46061837
    + 360.98564736629 * (jd - J2000_JD)
    + 0.000387933 * T * T
    - T * T * T / 38710000.0;
  // Normalize to 0-360 degrees then convert to radians
  theta = ((theta % 360) + 360) % 360;
  return theta * Math.PI / 180;
}

/** Local Mean Sidereal Time (radians) given longitude in radians */
export function lmst(jd: number, lonRad: number): number {
  return gmst(jd) + lonRad;
}

/** Create a Date offset by a number of seconds from a base date */
export function offsetDate(base: Date, seconds: number): Date {
  return new Date(base.getTime() + seconds * 1000);
}
