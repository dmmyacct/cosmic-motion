/**
 * UI — left data panel, time scrubber, playback, live mode.
 */

export type UpFrame = 'ecliptic' | 'equatorial' | 'galactic';

export interface UICallbacks {
  onTimeChange: (hours: number) => void;
  onToggleFollow: () => void;
  onToggleLocation: () => void;
  onUpFrameChange: (frame: UpFrame) => void;
  onNavigate: (bodyName: string) => void;
  onHoverBody: (bodyName: string | null) => void;
  onToggleOrbits: () => void;
  onToggleTrajectories: () => void;
  onToggleAllBeams: () => void;
  onToggleTerminators: () => void;
  onToggleFlightMode: () => void;
  onFlightHover: (hovering: boolean) => void;
}

export interface PlanetPanelData {
  name: string;
  symbol: string;
  color: string;
  distAU: number;
  orbitalSpeedKmS: number;
  perihelionAU: number;
  aphelionAU: number;
  solarIrradiance: number;
  periodDays: number;
  dayInOrbit: number;
  percentComplete: number;
  distFromEarthAU: number;
  /** Sidereal rotation period in hours. Negative = retrograde. */
  siderealRotationHours: number;
  axialTiltDeg: number;
  surfaceGravityMs2: number;
  escapeVelocityKmS: number;
  eccentricity: number;
  inclinationDeg: number;
}

export interface UIUpdateData {
  speedKmS: number;
  orbitalSpeedKmS: number;
  solarGalacticSpeedKmS: number;
  sunDistAU: number;
  moonDistKm: number;
  moonPhaseAngle: number;
  moonPhaseWaxing: boolean;
  obliquity: number;
  rotationAngle: number;
  date: Date;
  ghostDate?: Date;
  ghostSunDistAU?: number;
  ghostMoonDistKm?: number;
  earthDistTraveled?: number;
  sunDistTraveled?: number;
  planetAngles?: { name: string; angle: number }[];
  planetOrbits?: { name: string; periodDays: number; dayInOrbit: number; percentComplete: number }[];
  planetData?: PlanetPanelData[];
  earthOrbitPeriodDays?: number;
  earthOrbitPercent?: number;
  currentBody?: string;
}

const AU_KM = 149597870.7;
const C_KMS = 299792.458;
const EARTH_CIRCUMFERENCE_KM = 40075.017;
const SIDEREAL_DAY_H = 23.9345;

const MAX_HOURS = 876000; // 100 years

// Piecewise slider mapping — generous room for short timelines, compressed for long ones
// |slider %|  0─40%  → ±0 to ±24h (1 day)
// |slider %| 40─65%  → ±1d to ±30d (1 month)
// |slider %| 65─85%  → ±30d to ±365d (1 year)
// |slider %| 85─100% → ±1yr to ±100yr
const SLIDER_BANDS: Array<[number, number]> = [
  // [sliderFraction, hours]
  [0.00,       0],
  [0.40,      24],
  [0.65,     720],      // 30 days
  [0.85,    8766],      // ~1 year
  [1.00,  MAX_HOURS],
];

function sliderToHours(t: number): number {
  const sign = Math.sign(t);
  const abs = Math.abs(t);

  for (let i = 1; i < SLIDER_BANDS.length; i++) {
    const [s0, h0] = SLIDER_BANDS[i - 1];
    const [s1, h1] = SLIDER_BANDS[i];
    if (abs <= s1) {
      const frac = (abs - s0) / (s1 - s0);
      const smooth = frac * frac * (3 - 2 * frac); // smoothstep for no dead zones
      return sign * (h0 + smooth * (h1 - h0));
    }
  }
  return sign * MAX_HOURS;
}

function hoursToSlider(hours: number): number {
  const sign = Math.sign(hours);
  const abs = Math.abs(hours);

  for (let i = 1; i < SLIDER_BANDS.length; i++) {
    const [s0, h0] = SLIDER_BANDS[i - 1];
    const [s1, h1] = SLIDER_BANDS[i];
    if (abs <= h1) {
      const frac = (abs - h0) / (h1 - h0);
      // Inverse of smoothstep: solve t^2*(3-2t) = frac via Newton's method
      let t = frac;
      for (let j = 0; j < 8; j++) {
        const f = t * t * (3 - 2 * t) - frac;
        const df = 6 * t * (1 - t);
        if (Math.abs(df) < 1e-12) break;
        t -= f / df;
      }
      return sign * (s0 + t * (s1 - s0));
    }
  }
  return sign;
}

function formatOffset(hours: number): string {
  const abs = Math.abs(hours);
  const dir = hours > 0 ? 'ahead' : 'ago';
  if (abs < 1) return `${Math.round(abs * 60)} min ${dir}`;
  if (abs < 48) return `${abs.toFixed(1)} hrs ${dir}`;
  const days = abs / 24;
  if (days < 60) return `${days.toFixed(1)} days ${dir}`;
  if (days < 730) return `${(days / 30.44).toFixed(1)} months ${dir}`;
  return `${(days / 365.25).toFixed(1)} years ${dir}`;
}

function fmtDist(km: number): string {
  if (km >= 1e9) return `${(km / 1e6).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}M km`;
  if (km >= 1e6) return `${(km / 1e6).toFixed(1)}M km`;
  return `${Math.round(km).toLocaleString()} km`;
}

function fmtTravelDist(km: number): string {
  if (km >= 1e12) return `${(km / 1e9).toFixed(1)}B km`;
  if (km >= 1e9) return `${(km / 1e9).toFixed(2)}B km`;
  if (km >= 1e7) return `${(km / 1e6).toFixed(1)}M km`;
  if (km >= 1e6) return `${(km / 1e6).toFixed(2)}M km`;
  if (km >= 1e3) return `${(km / 1e3).toFixed(1)}K km`;
  return `${Math.round(km).toLocaleString()} km`;
}

function fmtLightTime(km: number): string {
  const sec = km / C_KMS;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${min}m ${s.toString().padStart(2, '0')}s`;
}

function moonPhaseName(angleRad: number, waxing: boolean): string {
  const deg = angleRad * 180 / Math.PI;
  if (deg < 5) return 'Full Moon';
  if (deg > 175) return 'New Moon';
  if (waxing) {
    if (deg > 95) return 'Waxing Crescent';
    if (deg > 85) return 'First Quarter';
    return 'Waxing Gibbous';
  } else {
    if (deg < 85) return 'Waning Gibbous';
    if (deg < 95) return 'Last Quarter';
    return 'Waning Crescent';
  }
}

function moonIllumination(angleRad: number): number {
  return (1 + Math.cos(angleRad)) / 2;
}

function moonPhaseEmoji(angleRad: number, waxing: boolean): string {
  const deg = angleRad * 180 / Math.PI;
  if (deg > 175) return '🌑';
  if (deg > 95 && waxing) return '🌒';
  if (deg >= 85 && deg <= 95 && waxing) return '🌓';
  if (deg < 85 && waxing) return '🌔';
  if (deg < 5) return '🌕';
  if (deg < 85 && !waxing) return '🌖';
  if (deg >= 85 && deg <= 95 && !waxing) return '🌗';
  return '🌘';
}

const PLAY_SPEEDS = [
  { label: '1 min/s', hoursPerSec: 1 / 60 },
  { label: '1 hr/s', hoursPerSec: 1 },
  { label: '6 hr/s', hoursPerSec: 6 },
  { label: '1 day/s', hoursPerSec: 24 },
  { label: '1 week/s', hoursPerSec: 168 },
  { label: '1 month/s', hoursPerSec: 730 },
  { label: '1 year/s', hoursPerSec: 8766 },
  { label: '10 yrs/s', hoursPerSec: 87660 },
];

export function createUI(container: HTMLElement, callbacks: UICallbacks) {
  const ui = document.createElement('div');
  ui.className = 'cm-ui';
  container.appendChild(ui);

  // ── Left data panel ──
  const panel = document.createElement('div');
  panel.className = 'cm-panel';
  panel.innerHTML = `
    <div class="cm-panel-header">
      <div class="cm-panel-mode">
        <span class="cm-live-dot"></span>
        <span class="cm-mode-label">LIVE</span>
        <span class="cm-panel-date"></span>
      </div>
      <button class="cm-panel-toggle" title="Toggle table">▾</button>
    </div>
    <div class="cm-table-wrap"></div>
  `;
  ui.appendChild(panel);

  const panelDate = panel.querySelector('.cm-panel-date')!;
  const modeDot = panel.querySelector('.cm-live-dot') as HTMLElement;
  const modeLabel = panel.querySelector('.cm-mode-label')!;
  const tableWrap = panel.querySelector('.cm-table-wrap') as HTMLElement;
  const toggleBtn = panel.querySelector('.cm-panel-toggle') as HTMLElement;

  let tableVisible = false;
  tableWrap.style.display = 'none';
  toggleBtn.textContent = '▸';
  panel.classList.add('cm-collapsed');
  toggleBtn.addEventListener('click', () => {
    tableVisible = !tableVisible;
    tableWrap.style.display = tableVisible ? '' : 'none';
    toggleBtn.textContent = tableVisible ? '▾' : '▸';
    panel.classList.toggle('cm-collapsed', !tableVisible);
  });

  tableWrap.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest('.cm-trow') as HTMLElement | null;
    if (!row) return;
    const name = row.dataset.body;
    if (name) callbacks.onNavigate(name);
  });
  tableWrap.addEventListener('mouseover', (e) => {
    const row = (e.target as HTMLElement).closest('.cm-trow') as HTMLElement | null;
    if (!row) return;
    const name = row.dataset.body;
    if (name) callbacks.onHoverBody(name);
  });
  tableWrap.addEventListener('mouseleave', () => {
    callbacks.onHoverBody(null);
  });

  // ── Bottom: time controls ──
  const timePanel = document.createElement('div');
  timePanel.className = 'cm-time-panel';
  timePanel.innerHTML = `
    <div class="cm-time-label">
      <span class="cm-time-past">− 100 yrs</span>
      <span class="cm-time-current">Now</span>
      <span class="cm-time-future">+ 100 yrs</span>
    </div>
    <input type="range" class="cm-time-slider" min="-1000" max="1000" step="1" value="0" />
    <div class="cm-time-info">
      <span class="cm-time-offset"></span>
      <span class="cm-ghost-date"></span>
    </div>
    <div class="cm-travel-dist"></div>
    <div class="cm-playback">
      <button class="cm-play-btn" title="Play/Pause">▶</button>
      <button class="cm-rev-btn" title="Reverse">◀</button>
      <button class="cm-speed-btn" title="Playback speed">1 hr/s</button>
      <button class="cm-follow-btn" title="Follow ghost">Follow</button>
      <button class="cm-loc-btn" title="My location">📍</button>
      <button class="cm-orbits-btn active" title="Toggle orbit rings">◯</button>
      <button class="cm-traj-btn active" title="Toggle trajectories">∿</button>
      <button class="cm-beams-btn" title="Show all planet beams">☀</button>
      <button class="cm-term-btn" title="Toggle terminator lines">◐</button>
      <button class="cm-up-btn" title="Reference frame up">↑ Ecl</button>
      <button class="cm-flight-btn" title="Free flight mode (V)">FLY</button>
      <button class="cm-reset-btn" title="Reset to now">↻</button>
    </div>
  `;
  ui.appendChild(timePanel);

  const slider = timePanel.querySelector('.cm-time-slider') as HTMLInputElement;
  const offsetEl = timePanel.querySelector('.cm-time-offset')!;
  const ghostDateEl = timePanel.querySelector('.cm-ghost-date')!;
  const travelDistEl = timePanel.querySelector('.cm-travel-dist') as HTMLElement;
  const playBtn = timePanel.querySelector('.cm-play-btn') as HTMLButtonElement;
  const revBtn = timePanel.querySelector('.cm-rev-btn') as HTMLButtonElement;
  const speedBtn = timePanel.querySelector('.cm-speed-btn') as HTMLButtonElement;
  const followBtn = timePanel.querySelector('.cm-follow-btn') as HTMLButtonElement;
  const locBtn = timePanel.querySelector('.cm-loc-btn') as HTMLButtonElement;
  const orbitsBtn = timePanel.querySelector('.cm-orbits-btn') as HTMLButtonElement;
  const trajBtn = timePanel.querySelector('.cm-traj-btn') as HTMLButtonElement;
  const beamsBtn = timePanel.querySelector('.cm-beams-btn') as HTMLButtonElement;
  const termBtn = timePanel.querySelector('.cm-term-btn') as HTMLButtonElement;
  const upBtn = timePanel.querySelector('.cm-up-btn') as HTMLButtonElement;
  const resetBtn = timePanel.querySelector('.cm-reset-btn') as HTMLButtonElement;

  let currentHoursOffset = 0;
  let playing = false;
  let playDirection = 1;
  let speedIndex = 1;
  let lastPlayTime = 0;
  let followingGhost = false;

  function emitChange(hours: number): void {
    currentHoursOffset = hours;
    callbacks.onTimeChange(hours);
    updateTimeDisplay(hours);
  }

  function updateTimeDisplay(hours: number): void {
    const isLive = Math.abs(hours) < 0.005;
    modeDot.className = isLive ? 'cm-live-dot live' : 'cm-live-dot';
    modeLabel.textContent = isLive ? 'LIVE' : 'TIME TRAVEL';

    if (isLive) {
      offsetEl.textContent = '';
      ghostDateEl.textContent = '';
    } else {
      offsetEl.textContent = formatOffset(hours);
      const ghostDate = new Date(Date.now() + hours * 3600_000);
      ghostDateEl.textContent = ghostDate.toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    }
  }

  slider.addEventListener('input', () => {
    emitChange(sliderToHours(parseFloat(slider.value) / 1000));
  });
  slider.addEventListener('dblclick', () => { slider.value = '0'; emitChange(0); });

  playBtn.addEventListener('click', () => {
    playDirection = 1;
    playing = !playing;
    playBtn.textContent = playing ? '⏸' : '▶';
    revBtn.classList.toggle('active', false);
    if (playing) lastPlayTime = performance.now();
  });

  revBtn.addEventListener('click', () => {
    playDirection = -1;
    playing = !playing || playDirection === 1;
    if (playing) {
      playDirection = -1;
      playBtn.textContent = '⏸';
      revBtn.classList.add('active');
      lastPlayTime = performance.now();
    } else {
      playBtn.textContent = '▶';
      revBtn.classList.remove('active');
    }
  });

  speedBtn.addEventListener('click', () => {
    speedIndex = (speedIndex + 1) % PLAY_SPEEDS.length;
    speedBtn.textContent = PLAY_SPEEDS[speedIndex].label;
  });

  followBtn.addEventListener('click', () => {
    followingGhost = !followingGhost;
    followBtn.textContent = followingGhost ? 'Unfollow' : 'Follow';
    followBtn.classList.toggle('active', followingGhost);
    callbacks.onToggleFollow();
  });

  locBtn.addEventListener('click', () => {
    locBtn.classList.toggle('active');
    callbacks.onToggleLocation();
  });

  orbitsBtn.addEventListener('click', () => {
    orbitsBtn.classList.toggle('active');
    callbacks.onToggleOrbits();
  });

  trajBtn.addEventListener('click', () => {
    trajBtn.classList.toggle('active');
    callbacks.onToggleTrajectories();
  });

  beamsBtn.addEventListener('click', () => {
    beamsBtn.classList.toggle('active');
    callbacks.onToggleAllBeams();
  });

  termBtn.addEventListener('click', () => {
    termBtn.classList.toggle('active');
    callbacks.onToggleTerminators();
  });

  const flightBtn = timePanel.querySelector('.cm-flight-btn') as HTMLButtonElement;
  flightBtn.addEventListener('click', () => {
    flightBtn.classList.toggle('active');
    callbacks.onToggleFlightMode();
  });
  flightBtn.addEventListener('mouseenter', () => callbacks.onFlightHover(true));
  flightBtn.addEventListener('mouseleave', () => callbacks.onFlightHover(false));

  const UP_FRAMES: UpFrame[] = ['ecliptic', 'equatorial', 'galactic'];
  const UP_LABELS: Record<UpFrame, string> = {
    ecliptic: '↑ Ecl',
    equatorial: '↑ Eq',
    galactic: '↑ Gal',
  };
  let upFrameIdx = 0;
  upBtn.addEventListener('click', () => {
    upFrameIdx = (upFrameIdx + 1) % UP_FRAMES.length;
    const frame = UP_FRAMES[upFrameIdx];
    upBtn.textContent = UP_LABELS[frame];
    callbacks.onUpFrameChange(frame);
  });

  resetBtn.addEventListener('click', () => {
    followingGhost = false;
    followBtn.textContent = 'Follow';
    followBtn.classList.remove('active');
    playing = false;
    playBtn.textContent = '▶';
    revBtn.classList.remove('active');
    slider.value = '0';
    emitChange(0);
  });

  // Hint
  const hint = document.createElement('div');
  hint.className = 'cm-hint';
  hint.textContent = 'Drag to orbit · Scroll to zoom · Scrub to time-travel';
  ui.appendChild(hint);
  setTimeout(() => { hint.style.opacity = '0'; }, 8000);

  // Scale note
  const scaleNote = document.createElement('div');
  scaleNote.className = 'cm-scale-note';
  scaleNote.textContent = 'Distances proportional (1 AU = 50u) · Planet sizes proportional · Sun/Moon-dist exaggerated · ±100 yr ephemeris';
  ui.appendChild(scaleNote);

  // ── Solar System Navigation Widget ──
  const NAV_PLANETS = [
    { name: 'Mercury', symbol: '\u263F', color: '#b5a7a7' },
    { name: 'Venus',   symbol: '\u2640', color: '#e8cda0' },
    { name: 'Earth',   symbol: '\u2295', color: '#4fc3f7' },
    { name: 'Mars',    symbol: '\u2642', color: '#e57373' },
    { name: 'Jupiter', symbol: '\u2643', color: '#d4a574' },
    { name: 'Saturn',  symbol: '\u2644', color: '#f0d59e' },
    { name: 'Uranus',  symbol: '\u26E2', color: '#80deea' },
    { name: 'Neptune', symbol: '\u2646', color: '#5c6bc0' },
  ];
  // sqrt-proportional ring radii based on real semi-major axes in AU
  const AU_VALUES = [0.387, 0.723, 1.0, 1.524, 5.203, 9.537, 19.189, 30.070];
  const AU_MAX = 30.070;
  const R_MIN = 8, R_MAX = 86;
  const RING_RADII = AU_VALUES.map(au =>
    R_MIN + (R_MAX - R_MIN) * Math.sqrt(au / AU_MAX));
  const svgNS = 'http://www.w3.org/2000/svg';
  let currentOrbitData: Map<string, { periodDays: number; dayInOrbit: number; percentComplete: number }> = new Map();

  const navWrapper = document.createElement('div');
  navWrapper.className = 'cm-nav-widget';
  ui.appendChild(navWrapper);

  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '-95 -95 190 190');
  svg.setAttribute('class', 'cm-nav-svg');
  navWrapper.appendChild(svg);

  const defs = document.createElementNS(svgNS, 'defs');
  svg.appendChild(defs);

  const planetDots: Map<string, SVGCircleElement> = new Map();
  const orbitGroups: Map<string, SVGGElement> = new Map();
  let activeHighlight: string | null = null;

  // Tooltip element (HTML, below SVG)
  const tooltip = document.createElement('div');
  tooltip.className = 'cm-nav-tooltip';
  tooltip.innerHTML = '<div class="cm-nav-tooltip-name"></div><div class="cm-nav-tooltip-info"></div>';
  tooltip.style.opacity = '0';
  navWrapper.appendChild(tooltip);
  const tooltipName = tooltip.querySelector('.cm-nav-tooltip-name')!;
  const tooltipInfo = tooltip.querySelector('.cm-nav-tooltip-info')!;

  function showTooltip(name: string) {
    tooltipName.textContent = name;
    const data = currentOrbitData.get(name);
    if (data) {
      const periodStr = data.periodDays >= 365
        ? `${(data.periodDays / 365.25).toFixed(1)} yr orbit`
        : `${Math.round(data.periodDays)} day orbit`;
      tooltipInfo.textContent = `${periodStr}  ·  Day ${Math.round(data.dayInOrbit).toLocaleString()}  ·  ${data.percentComplete.toFixed(1)}%`;
    } else {
      tooltipInfo.textContent = '';
    }
    tooltip.style.opacity = '1';
  }

  function hideTooltip() {
    tooltip.style.opacity = '0';
  }

  // Sun at center
  const sunCircle = document.createElementNS(svgNS, 'circle');
  sunCircle.setAttribute('cx', '0');
  sunCircle.setAttribute('cy', '0');
  sunCircle.setAttribute('r', '4');
  sunCircle.setAttribute('class', 'cm-nav-sun');
  sunCircle.style.cursor = 'pointer';
  sunCircle.addEventListener('click', () => callbacks.onNavigate('Sun'));
  sunCircle.addEventListener('mouseenter', () => {
    tooltipName.textContent = 'Sun';
    tooltipInfo.textContent = '';
    tooltip.style.opacity = '1';
    callbacks.onHoverBody('Sun');
  });
  sunCircle.addEventListener('mouseleave', () => {
    hideTooltip();
    callbacks.onHoverBody(null);
  });
  svg.appendChild(sunCircle);

  // Build orbit rings and planet dots
  for (let i = 0; i < NAV_PLANETS.length; i++) {
    const planet = NAV_PLANETS[i];
    const r = RING_RADII[i];

    const group = document.createElementNS(svgNS, 'g');
    group.setAttribute('class', 'cm-nav-orbit-group');
    group.style.cursor = 'pointer';
    orbitGroups.set(planet.name, group);

    // Hover hitarea (wider invisible ring)
    const hitRing = document.createElementNS(svgNS, 'circle');
    hitRing.setAttribute('cx', '0');
    hitRing.setAttribute('cy', '0');
    hitRing.setAttribute('r', String(r));
    hitRing.setAttribute('class', 'cm-nav-hit-ring');
    group.appendChild(hitRing);

    // Visible orbit ring
    const ring = document.createElementNS(svgNS, 'circle');
    ring.setAttribute('cx', '0');
    ring.setAttribute('cy', '0');
    ring.setAttribute('r', String(r));
    ring.setAttribute('class', 'cm-nav-orbit-ring');
    group.appendChild(ring);

    // Curved text path for planet name
    const textPathId = `nav-text-path-${i}`;
    const textR = r + 1.5;
    const textPath = document.createElementNS(svgNS, 'path');
    textPath.setAttribute('id', textPathId);
    textPath.setAttribute('d',
      `M ${-textR},0 A ${textR},${textR} 0 0 1 ${textR},0`);
    textPath.setAttribute('fill', 'none');
    defs.appendChild(textPath);

    const labelText = document.createElementNS(svgNS, 'text');
    labelText.setAttribute('class', 'cm-nav-curved-label');
    const tp = document.createElementNS(svgNS, 'textPath');
    tp.setAttribute('href', `#${textPathId}`);
    tp.setAttribute('startOffset', '50%');
    tp.setAttribute('text-anchor', 'middle');
    tp.textContent = planet.name;
    labelText.appendChild(tp);
    group.appendChild(labelText);

    // Planet dot
    const dot = document.createElementNS(svgNS, 'circle');
    const dotR = i >= 4 ? 3 : 2;
    dot.setAttribute('r', String(dotR));
    dot.setAttribute('class', 'cm-nav-planet-dot');
    dot.setAttribute('fill', planet.color);
    dot.setAttribute('cx', String(r));
    dot.setAttribute('cy', '0');
    group.appendChild(dot);
    planetDots.set(planet.name, dot);

    // Interaction
    group.addEventListener('click', () => callbacks.onNavigate(planet.name));
    group.addEventListener('mouseenter', () => {
      group.classList.add('cm-nav-hover');
      showTooltip(planet.name);
      callbacks.onHoverBody(planet.name);
    });
    group.addEventListener('mouseleave', () => {
      group.classList.remove('cm-nav-hover');
      hideTooltip();
      callbacks.onHoverBody(null);
    });

    svg.appendChild(group);
  }

  function updateNavWidget(
    angles?: { name: string; angle: number }[],
    orbits?: { name: string; periodDays: number; dayInOrbit: number; percentComplete: number }[],
    current?: string,
  ) {
    if (angles) {
      for (const { name, angle } of angles) {
        const dot = planetDots.get(name);
        if (!dot) continue;
        const idx = NAV_PLANETS.findIndex(p => p.name === name);
        if (idx < 0) continue;
        const r = RING_RADII[idx];
        dot.setAttribute('cx', String(r * Math.cos(angle)));
        dot.setAttribute('cy', String(-r * Math.sin(angle)));
      }
    }
    if (orbits) {
      for (const o of orbits) {
        currentOrbitData.set(o.name, { periodDays: o.periodDays, dayInOrbit: o.dayInOrbit, percentComplete: o.percentComplete });
      }
    }
    if (current && current !== activeHighlight) {
      if (activeHighlight) {
        orbitGroups.get(activeHighlight)?.classList.remove('cm-nav-active');
      }
      activeHighlight = current;
      orbitGroups.get(current)?.classList.add('cm-nav-active');
      sunCircle.classList.toggle('cm-nav-sun-active', current === 'Sun');
    }
  }

  return {
    update(data: UIUpdateData) {
      panelDate.textContent = data.date.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });

      // Distance traveled (visible during time travel)
      if (data.earthDistTraveled && data.earthDistTraveled > 100) {
        travelDistEl.innerHTML = `<span class="cm-travel-label">⊕ traveled</span> <span class="cm-travel-value">${fmtTravelDist(data.earthDistTraveled)}</span>`
          + `<span class="cm-travel-sep"> · </span>`
          + `<span class="cm-travel-label">☉ traveled</span> <span class="cm-travel-value">${fmtTravelDist(data.sunDistTraveled ?? 0)}</span>`;
        travelDistEl.style.display = '';
      } else {
        travelDistEl.style.display = 'none';
      }

      // Build full data table — all values as columns
      if (data.planetData) {
        const focused = data.currentBody;

        let html = `<table class="cm-data-table"><thead><tr>
          <th class="cm-th-sticky"></th>
          <th title="Distance from Sun (AU)">☉ Dist<span class="cm-th-unit">AU</span></th>
          <th title="Distance from Earth (AU)">⊕ Dist<span class="cm-th-unit">AU</span></th>
          <th title="Light travel time from Sun">Light</th>
          <th title="Orbital speed (km/s)">Speed<span class="cm-th-unit">km/s</span></th>
          <th title="Orbital period">Orbit</th>
          <th title="Orbit progress">Prog</th>
          <th title="Perihelion distance (AU)">Peri<span class="cm-th-unit">AU</span></th>
          <th title="Aphelion distance (AU)">Aph<span class="cm-th-unit">AU</span></th>
          <th title="Orbital eccentricity">Ecc</th>
          <th title="Orbital inclination (°)">Inc</th>
          <th title="Sidereal rotation period">Rot</th>
          <th title="Axial tilt (°)">Tilt</th>
          <th title="Surface gravity (m/s²)">Grav<span class="cm-th-unit">m/s²</span></th>
          <th title="Escape velocity (km/s)">Esc<span class="cm-th-unit">km/s</span></th>
          <th title="Solar irradiance (× Earth)">Irr<span class="cm-th-unit">×⊕</span></th>
        </tr></thead><tbody>`;

        // Sun row
        html += `<tr class="cm-trow${focused === 'Sun' ? ' cm-active' : ''}" data-body="Sun">
          <td class="cm-tcell-name cm-th-sticky" style="color:#ffd54f">☉ Sun</td>
          <td class="cm-tcell">—</td>
          <td class="cm-tcell">—</td>
          <td class="cm-tcell">—</td>
          <td class="cm-tcell">${data.solarGalacticSpeedKmS.toFixed(0)}</td>
          <td class="cm-tcell">—</td>
          <td class="cm-tcell">—</td>
          <td class="cm-tcell">—</td>
          <td class="cm-tcell">—</td>
          <td class="cm-tcell">—</td>
          <td class="cm-tcell">—</td>
          <td class="cm-tcell">—</td>
          <td class="cm-tcell">—</td>
          <td class="cm-tcell">274.0</td>
          <td class="cm-tcell">617.5</td>
          <td class="cm-tcell">—</td>
        </tr>`;

        for (const pd of data.planetData) {
          const isEarth = pd.name === 'Earth';
          const distAU = pd.distAU;
          const distKm = distAU * AU_KM;
          const speed = isEarth ? data.orbitalSpeedKmS : pd.orbitalSpeedKmS;
          const pct = isEarth ? (data.earthOrbitPercent ?? pd.percentComplete) : pd.percentComplete;
          const isFocused = focused === pd.name;

          const periodStr = pd.periodDays > 600
            ? `${(pd.periodDays / 365.25).toFixed(1)}y`
            : `${pd.periodDays.toFixed(0)}d`;
          const rotHrs = Math.abs(pd.siderealRotationHours);
          const rotDir = pd.siderealRotationHours < 0 ? '↺' : '↻';
          const rotStr = rotHrs > 48
            ? `${(rotHrs / 24).toFixed(0)}d${rotDir}`
            : `${rotHrs.toFixed(1)}h${rotDir}`;
          const irr = pd.solarIrradiance;
          const irradStr = irr >= 1 ? `${irr.toFixed(1)}` : `${irr.toFixed(3)}`;

          html += `<tr class="cm-trow${isFocused ? ' cm-active' : ''}" data-body="${pd.name}">
            <td class="cm-tcell-name cm-th-sticky" style="color:${pd.color}">${pd.symbol} ${pd.name}</td>
            <td class="cm-tcell">${distAU.toFixed(2)}</td>
            <td class="cm-tcell">${isEarth ? '—' : pd.distFromEarthAU.toFixed(2)}</td>
            <td class="cm-tcell">${fmtLightTime(distKm)}</td>
            <td class="cm-tcell">${speed.toFixed(1)}</td>
            <td class="cm-tcell">${periodStr}</td>
            <td class="cm-tcell">${pct.toFixed(0)}%</td>
            <td class="cm-tcell">${pd.perihelionAU.toFixed(2)}</td>
            <td class="cm-tcell">${pd.aphelionAU.toFixed(2)}</td>
            <td class="cm-tcell">${pd.eccentricity.toFixed(3)}</td>
            <td class="cm-tcell">${pd.inclinationDeg.toFixed(1)}°</td>
            <td class="cm-tcell">${rotStr}</td>
            <td class="cm-tcell">${pd.axialTiltDeg.toFixed(1)}°</td>
            <td class="cm-tcell">${pd.surfaceGravityMs2.toFixed(1)}</td>
            <td class="cm-tcell">${pd.escapeVelocityKmS.toFixed(1)}</td>
            <td class="cm-tcell">${irradStr}</td>
          </tr>`;
        }

        html += '</tbody></table>';
        tableWrap.innerHTML = html;
      }

      updateNavWidget(data.planetAngles, data.planetOrbits, data.currentBody);
    },

    updateNav(
      angles: { name: string; angle: number }[],
      orbits: { name: string; periodDays: number; dayInOrbit: number; percentComplete: number }[],
      current: string,
    ) {
      updateNavWidget(angles, orbits, current);
    },

    tickPlayback() {
      if (!playing) return;
      const now = performance.now();
      const dt = (now - lastPlayTime) / 1000;
      lastPlayTime = now;
      currentHoursOffset += playDirection * PLAY_SPEEDS[speedIndex].hoursPerSec * dt;
      currentHoursOffset = Math.max(-MAX_HOURS, Math.min(MAX_HOURS, currentHoursOffset));
      slider.value = String(hoursToSlider(currentHoursOffset) * 1000);
      callbacks.onTimeChange(currentHoursOffset);
      updateTimeDisplay(currentHoursOffset);
    },
  };
}
