/**
 * Bright star catalog — ~150 brightest stars from Hipparcos.
 * J2000.0 equatorial coordinates (RA in hours, Dec in degrees), V magnitude.
 * Color temperature mapped from B-V index for visual rendering.
 */

export interface StarEntry {
  name: string;
  ra: number;   // hours
  dec: number;  // degrees
  mag: number;  // apparent magnitude
  bv: number;   // B-V color index
}

// Brightest stars visible to naked eye, J2000.0 epoch
export const BRIGHT_STARS: StarEntry[] = [
  { name: 'Sirius',        ra: 6.7525, dec: -16.7161, mag: -1.46, bv: 0.00 },
  { name: 'Canopus',       ra: 6.3992, dec: -52.6957, mag: -0.74, bv: 0.15 },
  { name: 'Arcturus',      ra: 14.2612, dec: 19.1824, mag: -0.05, bv: 1.23 },
  { name: 'Vega',          ra: 18.6156, dec: 38.7837, mag: 0.03, bv: 0.00 },
  { name: 'Capella',       ra: 5.2783, dec: 45.9980, mag: 0.08, bv: 0.80 },
  { name: 'Rigel',         ra: 5.2423, dec: -8.2017, mag: 0.13, bv: -0.03 },
  { name: 'Procyon',       ra: 7.6553, dec: 5.2250, mag: 0.34, bv: 0.42 },
  { name: 'Achernar',      ra: 1.6286, dec: -57.2367, mag: 0.46, bv: -0.16 },
  { name: 'Betelgeuse',    ra: 5.9195, dec: 7.4070, mag: 0.50, bv: 1.85 },
  { name: 'Hadar',         ra: 14.0637, dec: -60.3730, mag: 0.61, bv: -0.23 },
  { name: 'Altair',        ra: 19.8464, dec: 8.8683, mag: 0.77, bv: 0.22 },
  { name: 'Acrux',         ra: 12.4433, dec: -63.0990, mag: 0.77, bv: -0.24 },
  { name: 'Aldebaran',     ra: 4.5987, dec: 16.5093, mag: 0.85, bv: 1.54 },
  { name: 'Antares',       ra: 16.4901, dec: -26.4320, mag: 0.96, bv: 1.83 },
  { name: 'Spica',         ra: 13.4199, dec: -11.1614, mag: 0.97, bv: -0.23 },
  { name: 'Pollux',        ra: 7.7553, dec: 28.0262, mag: 1.14, bv: 1.00 },
  { name: 'Fomalhaut',     ra: 22.9607, dec: -29.6222, mag: 1.16, bv: 0.09 },
  { name: 'Deneb',         ra: 20.6905, dec: 45.2803, mag: 1.25, bv: 0.09 },
  { name: 'Mimosa',        ra: 12.7953, dec: -59.6886, mag: 1.25, bv: -0.23 },
  { name: 'Regulus',       ra: 10.1395, dec: 11.9672, mag: 1.35, bv: -0.11 },
  { name: 'Adhara',        ra: 6.9771, dec: -28.9722, mag: 1.50, bv: -0.21 },
  { name: 'Castor',        ra: 7.5767, dec: 31.8886, mag: 1.58, bv: 0.04 },
  { name: 'Gacrux',        ra: 12.5194, dec: -57.1132, mag: 1.63, bv: 1.59 },
  { name: 'Shaula',        ra: 17.5602, dec: -37.1038, mag: 1.63, bv: -0.22 },
  { name: 'Bellatrix',     ra: 5.4188, dec: 6.3497, mag: 1.64, bv: -0.22 },
  { name: 'Elnath',        ra: 5.4382, dec: 28.6075, mag: 1.65, bv: -0.13 },
  { name: 'Miaplacidus',   ra: 9.2200, dec: -69.7172, mag: 1.68, bv: 0.00 },
  { name: 'Alnilam',       ra: 5.6036, dec: -1.2019, mag: 1.69, bv: -0.19 },
  { name: 'Alnitak',       ra: 5.6794, dec: -1.9425, mag: 1.77, bv: -0.21 },
  { name: 'Alnair',        ra: 22.1372, dec: -46.9611, mag: 1.74, bv: -0.07 },
  { name: 'Alioth',        ra: 12.9005, dec: 55.9598, mag: 1.77, bv: -0.02 },
  { name: 'Dubhe',         ra: 11.0621, dec: 61.7509, mag: 1.79, bv: 1.07 },
  { name: 'Mirfak',        ra: 3.4054, dec: 49.8612, mag: 1.80, bv: 0.48 },
  { name: 'Wezen',         ra: 7.1398, dec: -26.3933, mag: 1.84, bv: 0.67 },
  { name: 'Sargas',        ra: 17.6215, dec: -42.9978, mag: 1.87, bv: 0.40 },
  { name: 'Kaus Australis', ra: 18.4029, dec: -34.3847, mag: 1.85, bv: -0.03 },
  { name: 'Avior',         ra: 8.3753, dec: -59.5095, mag: 1.86, bv: 1.18 },
  { name: 'Alkaid',        ra: 13.7923, dec: 49.3133, mag: 1.86, bv: -0.19 },
  { name: 'Menkalinan',    ra: 5.9953, dec: 44.9474, mag: 1.90, bv: 0.08 },
  { name: 'Atria',         ra: 16.8113, dec: -69.0277, mag: 1.92, bv: 1.44 },
  { name: 'Alhena',        ra: 6.6285, dec: 16.3993, mag: 1.93, bv: 0.00 },
  { name: 'Peacock',       ra: 20.4275, dec: -56.7352, mag: 1.94, bv: -0.20 },
  { name: 'Alsephina',     ra: 8.1587, dec: -47.3367, mag: 1.96, bv: -0.11 },
  { name: 'Mirzam',        ra: 6.3786, dec: -17.9559, mag: 1.98, bv: -0.24 },
  { name: 'Alphard',       ra: 9.4598, dec: -8.6586, mag: 1.98, bv: 1.44 },
  { name: 'Polaris',       ra: 2.5302, dec: 89.2641, mag: 1.98, bv: 0.60 },
  { name: 'Hamal',         ra: 2.1196, dec: 23.4624, mag: 2.00, bv: 1.15 },
  { name: 'Diphda',        ra: 0.7265, dec: -17.9866, mag: 2.02, bv: 1.02 },
  { name: 'Nunki',         ra: 18.9211, dec: -26.2967, mag: 2.02, bv: -0.13 },
  { name: 'Menkent',       ra: 14.1114, dec: -36.3700, mag: 2.06, bv: 1.01 },
  { name: 'Alpheratz',     ra: 0.1398, dec: 29.0905, mag: 2.06, bv: -0.11 },
  { name: 'Saiph',         ra: 5.7954, dec: -9.6697, mag: 2.09, bv: -0.18 },
  { name: 'Mirach',        ra: 1.1622, dec: 35.6205, mag: 2.06, bv: 1.58 },
  { name: 'Kochab',        ra: 14.8451, dec: 74.1555, mag: 2.08, bv: 1.47 },
  { name: 'Rasalhague',    ra: 17.5822, dec: 12.5600, mag: 2.08, bv: 0.15 },
  { name: 'Algol',         ra: 3.1362, dec: 40.9557, mag: 2.12, bv: -0.05 },
  { name: 'Almach',        ra: 2.0650, dec: 42.3298, mag: 2.16, bv: 1.37 },
  { name: 'Denebola',      ra: 11.8177, dec: 14.5721, mag: 2.14, bv: 0.09 },
  { name: 'Tiaki',         ra: 22.7117, dec: -46.8847, mag: 2.17, bv: 1.02 },
  { name: 'Naos',          ra: 8.0596, dec: -40.0035, mag: 2.25, bv: -0.27 },
  { name: 'Sadr',          ra: 20.3704, dec: 40.2567, mag: 2.20, bv: 0.68 },
  { name: 'Schedar',       ra: 0.6751, dec: 56.5374, mag: 2.23, bv: 1.17 },
  { name: 'Aspidiske',     ra: 9.2840, dec: -59.2753, mag: 2.25, bv: 0.18 },
  { name: 'Alphecca',      ra: 15.5781, dec: 26.7147, mag: 2.23, bv: 0.03 },
  { name: 'Mintaka',       ra: 5.5334, dec: -0.2991, mag: 2.23, bv: -0.21 },
  { name: 'Caph',          ra: 0.1525, dec: 59.1500, mag: 2.27, bv: 0.34 },
  { name: 'Izar',          ra: 14.7498, dec: 27.0741, mag: 2.37, bv: 0.97 },
  { name: 'Dschubba',      ra: 16.0055, dec: -22.6217, mag: 2.32, bv: -0.12 },
  { name: 'Enif',          ra: 21.7364, dec: 9.8750, mag: 2.39, bv: 1.52 },
  { name: 'Etamin',        ra: 17.9433, dec: 51.4890, mag: 2.23, bv: 1.52 },
  { name: 'Phecda',        ra: 11.8968, dec: 53.6948, mag: 2.44, bv: 0.04 },
  { name: 'Scheat',        ra: 23.0629, dec: 28.0828, mag: 2.42, bv: 1.67 },
  { name: 'Markab',        ra: 23.0793, dec: 15.2053, mag: 2.49, bv: -0.04 },
  { name: 'Alderamin',     ra: 21.3096, dec: 62.5857, mag: 2.51, bv: 0.22 },
  { name: 'Sabik',         ra: 17.1726, dec: -15.7250, mag: 2.43, bv: 0.06 },
  { name: 'Algedi',        ra: 20.2941, dec: -12.5076, mag: 2.87, bv: 0.84 },
];

/**
 * Convert B-V color index to RGB.
 * Attempt to match real stellar colors.
 */
export function bvToRGB(bv: number): [number, number, number] {
  // Clamp
  const t = Math.max(-0.4, Math.min(2.0, bv));

  let r: number, g: number, b: number;

  if (t < 0) {
    // Hot blue-white stars
    r = 0.62 + t * 0.3;
    g = 0.72 + t * 0.2;
    b = 1.0;
  } else if (t < 0.4) {
    // White to yellow-white
    r = 0.83 + t * 0.42;
    g = 0.87 + t * 0.15;
    b = 1.0 - t * 0.6;
  } else if (t < 0.8) {
    // Yellow
    r = 1.0;
    g = 0.95 - (t - 0.4) * 0.45;
    b = 0.76 - (t - 0.4) * 0.9;
  } else if (t < 1.4) {
    // Orange
    r = 1.0;
    g = 0.75 - (t - 0.8) * 0.55;
    b = 0.4 - (t - 0.8) * 0.45;
  } else {
    // Red
    r = 1.0;
    g = 0.42 - (t - 1.4) * 0.3;
    b = 0.1;
  }

  return [Math.max(0, Math.min(1, r)), Math.max(0, Math.min(1, g)), Math.max(0, Math.min(1, b))];
}
