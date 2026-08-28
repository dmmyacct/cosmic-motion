/**
 * Cosmic Motion — Entry point.
 * "Where are we actually going right now?"
 */

import './ui/styles.css';
import { CosmicMotionApp } from './app';

const container = document.getElementById('app')!;

function init() {
  const splash = document.createElement('div');
  splash.className = 'cm-splash';
  splash.innerHTML = `
    <div class="cm-splash-inner">
      <div class="cm-splash-title">Cosmic Motion</div>
      <div class="cm-splash-sub">
        See Earth's path through space.<br>
        Where you've been. Where you're going.
      </div>
      <button class="cm-splash-enter">Enter</button>
    </div>
  `;
  container.appendChild(splash);

  const app = new CosmicMotionApp();

  splash.querySelector('.cm-splash-enter')!.addEventListener('click', async () => {
    splash.classList.add('cm-hidden');
    setTimeout(() => splash.remove(), 800);
    await app.init(container);
  });
}

init();
