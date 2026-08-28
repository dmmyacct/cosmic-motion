/**
 * Simplified lunar position model.
 * Based on Jean Meeus "Astronomical Algorithms" Chapter 47,
 * using the principal terms from ELP2000-82B.
 * Accuracy: ~0.5° in longitude, ~0.3° in latitude, ~1000 km in distance.
 * More than sufficient for visualization.
 */

import { DEG } from './constants';

export interface LunarPosition {
  /** Geocentric ecliptic longitude (radians) */
  longitude: number;
  /** Geocentric ecliptic latitude (radians) */
  latitude: number;
  /** Distance from Earth center (km) */
  distance: number;
  /** Right ascension (radians) */
  ra: number;
  /** Declination (radians) */
  dec: number;
}

export function moonPosition(jd: number): LunarPosition {
  const T = (jd - 2451545.0) / 36525.0;
  const T2 = T * T;
  const T3 = T2 * T;
  const T4 = T3 * T;

  // Fundamental arguments (degrees)
  // Moon's mean longitude, referred to the mean equinox of date
  let Lp = 218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841.0 - T4 / 65194000.0;
  // Moon's mean anomaly
  let M = 134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699.0 - T4 / 14712000.0;
  // Sun's mean anomaly
  let Mp = 357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000.0;
  // Moon's mean elongation
  let D = 297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868.0 - T4 / 113065000.0;
  // Moon's argument of latitude
  let F = 93.2720950 + 483202.0175233 * T - 0.0036539 * T2 - T3 / 3526000.0 + T4 / 863310000.0;

  // Additional arguments
  const A1 = 119.75 + 131.849 * T;
  const A2 = 53.09 + 479264.290 * T;
  const A3 = 313.45 + 481266.484 * T;

  // Convert to radians
  Lp = Lp * DEG;
  M = M * DEG;
  Mp = Mp * DEG;
  D = D * DEG;
  F = F * DEG;
  const a1 = A1 * DEG;
  const a2 = A2 * DEG;
  const a3 = A3 * DEG;

  // Eccentricity correction
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const E2 = E * E;

  // Principal terms for longitude (Σl) and distance (Σr)
  // [D, M, Mp, F, coeff_l, coeff_r]
  const lr_terms: [number, number, number, number, number, number][] = [
    [0, 0, 1, 0, 6288774, -20905355],
    [2, 0, -1, 0, 1274027, -3699111],
    [2, 0, 0, 0, 658314, -2955968],
    [0, 0, 2, 0, 213618, -569925],
    [0, 1, 0, 0, -185116, 48888],
    [0, 0, 0, 2, -114332, -3149],
    [2, 0, -2, 0, 58793, 246158],
    [2, -1, -1, 0, 57066, -152138],
    [2, 0, 1, 0, 53322, -170733],
    [2, -1, 0, 0, 45758, -204586],
    [0, 1, -1, 0, -40923, -129620],
    [1, 0, 0, 0, -34720, 108743],
    [0, 1, 1, 0, -30383, 104755],
    [2, 0, 0, -2, 15327, 10321],
    [0, 0, 1, 2, -12528, 0],
    [0, 0, 1, -2, 10980, 79661],
    [4, 0, -1, 0, 10675, -34782],
    [0, 0, 3, 0, 10034, -23210],
    [4, 0, -2, 0, 8548, -21636],
    [2, 1, -1, 0, -7888, 24208],
    [2, 1, 0, 0, -6766, 30824],
    [1, 0, -1, 0, -5163, -8379],
    [1, 1, 0, 0, 4987, -16675],
    [2, -1, 1, 0, 4036, -12831],
    [2, 0, 2, 0, 3994, -10445],
    [4, 0, 0, 0, 3861, -11650],
    [2, 0, -3, 0, 3665, 14403],
    [0, 1, -2, 0, -2689, -7003],
    [2, 0, -1, 2, -2602, 0],
    [2, -1, -2, 0, 2390, 10056],
    [1, 0, 1, 0, -2348, 6322],
    [2, -2, 0, 0, 2236, -9884],
    [0, 1, 2, 0, -2120, 5751],
    [0, 2, 0, 0, -2069, 0],
    [2, -2, -1, 0, 2048, -4950],
    [2, 0, 1, -2, -1773, 4130],
    [2, 0, 0, 2, -1595, 0],
    [4, -1, -1, 0, 1215, -3958],
    [0, 0, 2, 2, -1110, 0],
    [3, 0, -1, 0, -892, 3258],
    [2, 1, 1, 0, -810, 2616],
    [4, -1, -2, 0, 759, -1897],
    [0, 2, -1, 0, -713, -2117],
    [2, 2, -1, 0, -700, 2354],
    [2, 1, -2, 0, 691, 0],
    [2, -1, 0, -2, 596, 0],
    [4, 0, 1, 0, 549, -1423],
    [0, 0, 4, 0, 537, -1117],
    [4, -1, 0, 0, 520, -1571],
    [1, 0, -2, 0, -487, -1739],
  ];

  // Principal terms for latitude (Σb)
  // [D, M, Mp, F, coeff_b]
  const b_terms: [number, number, number, number, number][] = [
    [0, 0, 0, 1, 5128122],
    [0, 0, 1, 1, 280602],
    [0, 0, 1, -1, 277693],
    [2, 0, 0, -1, 173237],
    [2, 0, -1, 1, 55413],
    [2, 0, -1, -1, 46271],
    [2, 0, 0, 1, 32573],
    [0, 0, 2, 1, 17198],
    [2, 0, 1, -1, 9266],
    [0, 0, 2, -1, 8822],
    [2, -1, 0, -1, 8216],
    [2, 0, -2, -1, 4324],
    [2, 0, 1, 1, 4200],
    [2, 1, 0, -1, -3359],
    [2, -1, -1, 1, 2463],
    [2, -1, 0, 1, 2211],
    [2, -1, -1, -1, 2065],
    [0, 1, -1, -1, -1870],
    [4, 0, -1, -1, 1828],
    [0, 1, 0, 1, -1794],
    [0, 0, 0, 3, -1749],
    [0, 1, -1, 1, -1565],
    [1, 0, 0, 1, -1491],
    [0, 1, 1, 1, -1475],
    [0, 1, 1, -1, -1410],
    [0, 1, 0, -1, -1344],
    [1, 0, 0, -1, -1335],
    [0, 0, 3, 1, 1107],
    [4, 0, 0, -1, 1021],
    [4, 0, -1, 1, 833],
  ];

  let Sl = 0;
  let Sr = 0;
  for (const [d, m, mp, f, cl, cr] of lr_terms) {
    const arg = d * D + m * Mp + mp * M + f * F;
    let eCorr = 1;
    if (Math.abs(m) === 1) eCorr = E;
    else if (Math.abs(m) === 2) eCorr = E2;
    Sl += cl * eCorr * Math.sin(arg);
    Sr += cr * eCorr * Math.cos(arg);
  }

  let Sb = 0;
  for (const [d, m, mp, f, cb] of b_terms) {
    const arg = d * D + m * Mp + mp * M + f * F;
    let eCorr = 1;
    if (Math.abs(m) === 1) eCorr = E;
    else if (Math.abs(m) === 2) eCorr = E2;
    Sb += cb * eCorr * Math.sin(arg);
  }

  // Additive corrections
  Sl += 3958 * Math.sin(a1) + 1962 * Math.sin(Lp - F) + 318 * Math.sin(a2);
  Sb += -2235 * Math.sin(Lp) + 382 * Math.sin(a3) + 175 * Math.sin(a1 - F)
    + 175 * Math.sin(a1 + F) + 127 * Math.sin(Lp - M) - 115 * Math.sin(Lp + M);

  const longitude = Lp + Sl / 1000000.0 * DEG;
  const latitude = Sb / 1000000.0 * DEG;
  const distance = 385000.56 + Sr / 1000.0; // km

  // Convert ecliptic to equatorial
  const obliquity = (23.4392911 - 0.0130042 * T - 1.64e-7 * T2 + 5.04e-7 * T3) * DEG;
  const cosObl = Math.cos(obliquity);
  const sinObl = Math.sin(obliquity);

  const cosLon = Math.cos(longitude);
  const sinLon = Math.sin(longitude);
  const cosLat = Math.cos(latitude);
  const sinLat = Math.sin(latitude);

  const ra = Math.atan2(sinLon * cosObl - sinLat / cosLat * sinObl, cosLon);
  const dec = Math.asin(sinLat * cosObl + cosLat * sinObl * sinLon);

  return {
    longitude: ((longitude % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI),
    latitude,
    distance,
    ra: ((ra % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI),
    dec,
  };
}
