// Astronomical constants (IAU 2012 / IERS)

export const AU_KM = 149597870.7;
export const AU_M = AU_KM * 1000;

export const EARTH_RADIUS_KM = 6371.0;
export const EARTH_RADIUS_EQUATORIAL_KM = 6378.137;
export const EARTH_FLATTENING = 1 / 298.257223563;

export const MOON_DISTANCE_KM = 384400;
export const SUN_DISTANCE_AU = 1.0;

// Earth's rotation rate (rad/s) — one sidereal day
export const EARTH_OMEGA = 7.2921150e-5;

// Obliquity of ecliptic at J2000.0 (radians)
export const OBLIQUITY_J2000 = 23.439291111 * Math.PI / 180;

// Speed of light (km/s)
export const C_KM_S = 299792.458;

// Gravitational parameter of Sun (km^3/s^2)
export const GM_SUN = 1.32712440018e11;

// Solar galactic motion
// Circular velocity of LSR around galactic center
export const V_LSR_KM_S = 220;
// Solar peculiar motion relative to LSR (U, V, W in km/s — Schönrich et al. 2010)
export const SOLAR_PECULIAR_U = 11.1; // toward galactic center
export const SOLAR_PECULIAR_V = 12.24; // in direction of galactic rotation
export const SOLAR_PECULIAR_W = 7.25; // toward north galactic pole

// Solar apex in equatorial coordinates (J2000)
// RA ≈ 18h28m, Dec ≈ +30° (direction of Sun's peculiar motion)
export const SOLAR_APEX_RA = (18 + 28 / 60) * 15 * Math.PI / 180;
export const SOLAR_APEX_DEC = 30 * Math.PI / 180;

// Galactic center direction in equatorial J2000
export const GALACTIC_CENTER_RA = (17 + 45.6 / 60) * 15 * Math.PI / 180;
export const GALACTIC_CENTER_DEC = -28.94 * Math.PI / 180;

// North galactic pole in equatorial J2000
export const NGP_RA = (12 + 51.4 / 60) * 15 * Math.PI / 180;
export const NGP_DEC = 27.13 * Math.PI / 180;

// Galactic longitude of ascending node of galactic plane on equator
export const GALACTIC_L_ASCEND = 32.93 * Math.PI / 180;

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const TWO_PI = 2 * Math.PI;
export const HALF_PI = Math.PI / 2;
