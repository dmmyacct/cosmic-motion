/**
 * Minimal UI — speed readout and time slider.
 */

export interface UICallbacks {
  onTimeChange: (days: number) => void;
}

export interface UIUpdateData {
  speedKmS: number;
  date: Date;
}

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

  // Bottom: time slider
  const timePanel = document.createElement('div');
  timePanel.className = 'cm-time-panel';
  timePanel.innerHTML = `
    <div class="cm-time-label">
      <span class="cm-time-past">10 days ago</span>
      <span class="cm-time-current">Now</span>
      <span class="cm-time-future">10 days ahead</span>
    </div>
    <input type="range" class="cm-time-slider" min="-10" max="10" step="0.1" value="0" />
    <div class="cm-time-value"></div>
  `;
  ui.appendChild(timePanel);

  const slider = timePanel.querySelector('.cm-time-slider') as HTMLInputElement;
  const valueEl = timePanel.querySelector('.cm-time-value')!;

  slider.addEventListener('input', () => {
    const days = parseFloat(slider.value);
    callbacks.onTimeChange(days);
    updateSliderLabel(days);
  });

  function updateSliderLabel(days: number): void {
    if (Math.abs(days) < 0.3) {
      valueEl.textContent = '';
      return;
    }
    const rounded = Math.round(days);
    const distKm = Math.abs(rounded) * 29.78 * 86400;
    const distM = distKm / 1e6;
    if (rounded > 0) {
      valueEl.textContent = `+${rounded} day${Math.abs(rounded) !== 1 ? 's' : ''} · ${distM.toFixed(1)}M km ahead`;
    } else {
      valueEl.textContent = `${rounded} day${Math.abs(rounded) !== 1 ? 's' : ''} · ${distM.toFixed(1)}M km behind`;
    }
  }

  // Hint
  const hint = document.createElement('div');
  hint.className = 'cm-hint';
  hint.textContent = 'Drag to orbit · Scroll to zoom · Slide to travel through time';
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
  };
}
