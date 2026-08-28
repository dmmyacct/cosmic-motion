/**
 * UI — speed readout, logarithmic time scrubber, and playback controls.
 */

export interface UICallbacks {
  onTimeChange: (hours: number) => void;
}

export interface UIUpdateData {
  speedKmS: number;
  date: Date;
}

/** Map slider position [-1, 1] to hours offset using exponential scaling. */
function sliderToHours(t: number): number {
  const sign = Math.sign(t);
  const abs = Math.abs(t);
  // Near center = minutes, edges = months
  // exp(abs * 7) maps [0,1] → [1, ~1097], scaled to max ~8760 hours (365 days)
  return sign * (Math.expm1(abs * 7) / Math.expm1(7)) * 8760;
}

function formatOffset(hours: number): string {
  const abs = Math.abs(hours);
  const dir = hours > 0 ? 'ahead' : 'ago';
  if (abs < 1) {
    const mins = Math.round(abs * 60);
    return `${mins} min ${dir}`;
  }
  if (abs < 48) {
    return `${abs.toFixed(1)} hrs ${dir}`;
  }
  const days = abs / 24;
  if (days < 60) {
    return `${days.toFixed(1)} days ${dir}`;
  }
  const months = days / 30.44;
  return `${months.toFixed(1)} months ${dir}`;
}

function formatGhostDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const PLAY_SPEEDS = [
  { label: '1 min/s', hoursPerSec: 1 / 60 },
  { label: '1 hr/s', hoursPerSec: 1 },
  { label: '6 hr/s', hoursPerSec: 6 },
  { label: '1 day/s', hoursPerSec: 24 },
  { label: '1 week/s', hoursPerSec: 168 },
  { label: '1 month/s', hoursPerSec: 730 },
];

export function createUI(container: HTMLElement, callbacks: UICallbacks) {
  const ui = document.createElement('div');
  ui.className = 'cm-ui';
  container.appendChild(ui);

  // Top: speed readout
  const header = document.createElement('div');
  header.className = 'cm-header';
  header.innerHTML = `
    <div class="cm-header-pre">Earth is moving through space at</div>
    <div class="cm-header-speed">29.78 <span class="cm-unit">km/s</span></div>
    <div class="cm-header-sub"><span class="cm-header-mph"></span></div>
    <div class="cm-header-date"></div>
  `;
  ui.appendChild(header);

  // Bottom: time controls
  const timePanel = document.createElement('div');
  timePanel.className = 'cm-time-panel';
  timePanel.innerHTML = `
    <div class="cm-time-label">
      <span class="cm-time-past">− 1 year</span>
      <span class="cm-time-current">Now</span>
      <span class="cm-time-future">+ 1 year</span>
    </div>
    <input type="range" class="cm-time-slider" min="-100" max="100" step="0.1" value="0" />
    <div class="cm-time-info">
      <span class="cm-time-offset"></span>
      <span class="cm-ghost-date"></span>
    </div>
    <div class="cm-playback">
      <button class="cm-play-btn" title="Play/Pause">▶</button>
      <button class="cm-rev-btn" title="Reverse">◀</button>
      <button class="cm-speed-btn" title="Playback speed">1 hr/s</button>
      <button class="cm-reset-btn" title="Reset to now">↻</button>
    </div>
  `;
  ui.appendChild(timePanel);

  const slider = timePanel.querySelector('.cm-time-slider') as HTMLInputElement;
  const offsetEl = timePanel.querySelector('.cm-time-offset')!;
  const ghostDateEl = timePanel.querySelector('.cm-ghost-date')!;
  const playBtn = timePanel.querySelector('.cm-play-btn') as HTMLButtonElement;
  const revBtn = timePanel.querySelector('.cm-rev-btn') as HTMLButtonElement;
  const speedBtn = timePanel.querySelector('.cm-speed-btn') as HTMLButtonElement;
  const resetBtn = timePanel.querySelector('.cm-reset-btn') as HTMLButtonElement;

  let currentHoursOffset = 0;
  let playing = false;
  let playDirection = 1;
  let speedIndex = 1;
  let lastPlayTime = 0;

  function emitChange(hours: number): void {
    currentHoursOffset = hours;
    callbacks.onTimeChange(hours);
    updateDisplay(hours);
  }

  function updateDisplay(hours: number): void {
    if (Math.abs(hours) < 0.005) {
      offsetEl.textContent = '';
      ghostDateEl.textContent = '';
      return;
    }
    offsetEl.textContent = formatOffset(hours);
    const ghostDate = new Date(Date.now() + hours * 3600_000);
    ghostDateEl.textContent = formatGhostDate(ghostDate);
  }

  slider.addEventListener('input', () => {
    const t = parseFloat(slider.value) / 100;
    const hours = sliderToHours(t);
    emitChange(hours);
  });

  // Double-click slider to reset
  slider.addEventListener('dblclick', () => {
    slider.value = '0';
    emitChange(0);
  });

  // Playback
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

  resetBtn.addEventListener('click', () => {
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

  return {
    update(data: UIUpdateData) {
      const speed = header.querySelector('.cm-header-speed')!;
      const mph = header.querySelector('.cm-header-mph')!;
      const dateEl = header.querySelector('.cm-header-date')!;

      const v = data.speedKmS;
      speed.innerHTML = `${v.toFixed(2)} <span class="cm-unit">km/s</span>`;

      const mphVal = v * 2236.936;
      mph.textContent = `${Math.round(mphVal).toLocaleString()} mph · ${(v / 299792.458 * 100).toFixed(4)}% the speed of light`;

      const d = data.date;
      dateEl.textContent = d.toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    },

    tickPlayback() {
      if (!playing) return;
      const now = performance.now();
      const dt = (now - lastPlayTime) / 1000;
      lastPlayTime = now;
      const hoursPerSec = PLAY_SPEEDS[speedIndex].hoursPerSec;
      currentHoursOffset += playDirection * hoursPerSec * dt;
      // Clamp to ±1 year
      currentHoursOffset = Math.max(-8760, Math.min(8760, currentHoursOffset));
      callbacks.onTimeChange(currentHoursOffset);
      updateDisplay(currentHoursOffset);
    },
  };
}
