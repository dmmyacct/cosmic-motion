/**
 * UI — left data panel, time scrubber, playback, live mode.
 */

export type UpFrame = 'ecliptic' | 'equatorial' | 'galactic';

export interface UICallbacks {
  onTimeChange: (hours: number) => void;
  onToggleFollow: () => void;
  onToggleLocation: () => void;
  onUpFrameChange: (frame: UpFrame) => void;
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
    <div class="cm-panel-mode">
      <span class="cm-live-dot"></span>
      <span class="cm-mode-label">LIVE</span>
      <span class="cm-panel-date"></span>
    </div>

    <div class="cm-body-section cm-sun-section">
      <div class="cm-body-header">
        <span class="cm-body-icon">☉</span> Sun
      </div>
      <div class="cm-body-stats">
        <div class="cm-stat"><span class="cm-stat-label">Galactic speed</span><span class="cm-stat-value cm-sun-galactic-speed">230 km/s</span></div>
        <div class="cm-stat"><span class="cm-stat-label">Distance</span><span class="cm-stat-value cm-sun-dist">1.000 AU</span></div>
        <div class="cm-stat"><span class="cm-stat-label"></span><span class="cm-stat-value cm-sun-dist-km">149.6M km</span></div>
        <div class="cm-stat"><span class="cm-stat-label">Light time</span><span class="cm-stat-value cm-sun-light">8m 19s</span></div>
      </div>

      <div class="cm-body-section cm-earth-section">
        <div class="cm-body-header">
          <span class="cm-body-icon cm-earth-icon">⊕</span> Earth
        </div>
        <div class="cm-body-stats">
          <div class="cm-stat"><span class="cm-stat-label">Space velocity</span><span class="cm-stat-value cm-earth-total-speed">234.6 km/s</span></div>
          <div class="cm-stat"><span class="cm-stat-label">Orbital speed</span><span class="cm-stat-value cm-earth-orbital-speed">29.78 km/s</span></div>
          <div class="cm-stat"><span class="cm-stat-label">Rotation</span><span class="cm-stat-value cm-earth-rotation-speed">1,674 km/h</span></div>
          <div class="cm-stat"><span class="cm-stat-label">Axial tilt</span><span class="cm-stat-value cm-earth-tilt">23.44°</span></div>
        </div>

        <div class="cm-body-section cm-moon-section">
          <div class="cm-body-header">
            <span class="cm-body-icon cm-moon-icon">☽</span> Moon
          </div>
          <div class="cm-body-stats">
            <div class="cm-stat"><span class="cm-stat-label">Phase</span><span class="cm-stat-value cm-moon-phase">🌕 Full Moon</span></div>
            <div class="cm-stat"><span class="cm-stat-label">Illumination</span><span class="cm-stat-value cm-moon-illum">100%</span></div>
            <div class="cm-stat"><span class="cm-stat-label">Distance</span><span class="cm-stat-value cm-moon-dist">384,400 km</span></div>
            <div class="cm-stat"><span class="cm-stat-label">Light time</span><span class="cm-stat-value cm-moon-light">1.3s</span></div>
          </div>
        </div>

      </div>
    </div>
  `;
  ui.appendChild(panel);

  // Cache DOM references
  const panelDate = panel.querySelector('.cm-panel-date')!;
  const modeDot = panel.querySelector('.cm-live-dot') as HTMLElement;
  const modeLabel = panel.querySelector('.cm-mode-label')!;
  const sunGalSpeed = panel.querySelector('.cm-sun-galactic-speed')!;
  const sunDist = panel.querySelector('.cm-sun-dist')!;
  const sunDistKm = panel.querySelector('.cm-sun-dist-km')!;
  const sunLight = panel.querySelector('.cm-sun-light')!;
  const earthTotalSpeed = panel.querySelector('.cm-earth-total-speed')!;
  const earthOrbitalSpeed = panel.querySelector('.cm-earth-orbital-speed')!;
  const earthRotSpeed = panel.querySelector('.cm-earth-rotation-speed')!;
  const earthTilt = panel.querySelector('.cm-earth-tilt')!;
  const moonPhase = panel.querySelector('.cm-moon-phase')!;
  const moonIllum = panel.querySelector('.cm-moon-illum')!;
  const moonDist = panel.querySelector('.cm-moon-dist')!;
  const moonLight = panel.querySelector('.cm-moon-light')!;

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
      <button class="cm-loc-btn active" title="My location">📍</button>
      <button class="cm-up-btn" title="Reference frame up">↑ Ecl</button>
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
  scaleNote.textContent = '±100 yr range · VSOP87/ELP2000 ephemeris · Galactic drift 8× compressed';
  ui.appendChild(scaleNote);

  return {
    update(data: UIUpdateData) {
      // Date
      panelDate.textContent = data.date.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });

      // Sun
      sunGalSpeed.textContent = `${data.solarGalacticSpeedKmS.toFixed(0)} km/s`;
      sunDist.textContent = `${data.sunDistAU.toFixed(4)} AU`;
      const sunKm = data.sunDistAU * AU_KM;
      sunDistKm.textContent = fmtDist(sunKm);
      sunLight.textContent = fmtLightTime(sunKm);

      // Earth
      earthTotalSpeed.textContent = `${data.speedKmS.toFixed(2)} km/s`;
      earthOrbitalSpeed.textContent = `${data.orbitalSpeedKmS.toFixed(2)} km/s`;
      const rotSpeedKmH = EARTH_CIRCUMFERENCE_KM / SIDEREAL_DAY_H;
      earthRotSpeed.textContent = `${Math.round(rotSpeedKmH).toLocaleString()} km/h`;
      earthTilt.textContent = `${(data.obliquity * 180 / Math.PI).toFixed(2)}°`;

      // Moon
      const phaseAngle = data.moonPhaseAngle;
      const waxing = data.moonPhaseWaxing;
      moonPhase.textContent = `${moonPhaseEmoji(phaseAngle, waxing)} ${moonPhaseName(phaseAngle, waxing)}`;
      moonIllum.textContent = `${(moonIllumination(phaseAngle) * 100).toFixed(1)}%`;
      moonDist.textContent = fmtDist(data.moonDistKm);
      moonLight.textContent = fmtLightTime(data.moonDistKm);

      // Distance traveled (visible during time travel)
      if (data.earthDistTraveled && data.earthDistTraveled > 100) {
        travelDistEl.innerHTML = `<span class="cm-travel-label">⊕ traveled</span> <span class="cm-travel-value">${fmtTravelDist(data.earthDistTraveled)}</span>`
          + `<span class="cm-travel-sep"> · </span>`
          + `<span class="cm-travel-label">☉ traveled</span> <span class="cm-travel-value">${fmtTravelDist(data.sunDistTraveled ?? 0)}</span>`;
        travelDistEl.style.display = '';
      } else {
        travelDistEl.style.display = 'none';
      }
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
