/**
 * HTML-based labels overlaid on the 3D scene.
 * Uses CSS transforms for crisp text at any resolution.
 */

import * as THREE from 'three';

export interface LabelOptions {
  text: string;
  subtext?: string;
  color?: string;
  className?: string;
}

export class Label {
  element: HTMLDivElement;
  private _visible = true;
  position = new THREE.Vector3();

  constructor(options: LabelOptions) {
    this.element = document.createElement('div');
    this.element.className = `cm-label ${options.className ?? ''}`;
    this.element.innerHTML = `
      <span class="cm-label-text" style="color: ${options.color ?? '#fff'}">${options.text}</span>
      ${options.subtext ? `<span class="cm-label-sub">${options.subtext}</span>` : ''}
    `;
  }

  updateScreenPosition(camera: THREE.Camera, containerWidth: number, containerHeight: number): void {
    const projected = this.position.clone().project(camera);

    // Behind camera
    if (projected.z > 1) {
      this.element.style.display = 'none';
      return;
    }

    const x = (projected.x * 0.5 + 0.5) * containerWidth;
    const y = (-projected.y * 0.5 + 0.5) * containerHeight;

    // Off-screen indicator (show edge arrow later)
    if (x < -50 || x > containerWidth + 50 || y < -50 || y > containerHeight + 50) {
      this.element.style.display = 'none';
      return;
    }

    this.element.style.display = this._visible ? '' : 'none';
    this.element.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
  }

  setText(text: string, subtext?: string): void {
    const textEl = this.element.querySelector('.cm-label-text');
    const subEl = this.element.querySelector('.cm-label-sub');
    if (textEl) textEl.textContent = text;
    if (subEl && subtext !== undefined) subEl.textContent = subtext;
  }

  setVisible(v: boolean): void {
    this._visible = v;
    this.element.style.display = v ? '' : 'none';
  }

  dispose(): void {
    this.element.remove();
  }
}

export class LabelRenderer {
  private container: HTMLElement;
  private labels = new Map<string, Label>();

  constructor(container: HTMLElement) {
    this.container = container;
  }

  getOrCreate(id: string, options: LabelOptions): Label {
    let label = this.labels.get(id);
    if (!label) {
      label = new Label(options);
      this.labels.set(id, label);
      this.container.appendChild(label.element);
    }
    return label;
  }

  update(camera: THREE.Camera): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    for (const label of this.labels.values()) {
      label.updateScreenPosition(camera, w, h);
    }
  }

  remove(id: string): void {
    const label = this.labels.get(id);
    if (label) {
      label.dispose();
      this.labels.delete(id);
    }
  }

  clear(): void {
    for (const label of this.labels.values()) {
      label.dispose();
    }
    this.labels.clear();
  }

  dispose(): void {
    this.clear();
  }
}
