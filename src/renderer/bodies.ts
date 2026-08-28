/**
 * Renders celestial body markers (Sun, Moon, Earth) as sprites with labels.
 */

import * as THREE from 'three';

export interface BodyMarkerOptions {
  color: number;
  size: number;
  glowSize: number;
  label: string;
}

const BODY_DISTANCE = 200; // distance in scene units to place markers

export class BodyMarker {
  group: THREE.Group;
  private sprite: THREE.Sprite;
  private glow: THREE.Sprite;
  private targetDir = new THREE.Vector3(0, 1, 0);
  private currentDir = new THREE.Vector3(0, 1, 0);

  constructor(options: BodyMarkerOptions) {
    this.group = new THREE.Group();

    // Core dot
    const dotCanvas = document.createElement('canvas');
    dotCanvas.width = 64;
    dotCanvas.height = 64;
    const dotCtx = dotCanvas.getContext('2d')!;
    const c = new THREE.Color(options.color);
    dotCtx.beginPath();
    dotCtx.arc(32, 32, 16, 0, Math.PI * 2);
    dotCtx.fillStyle = `rgb(${c.r * 255 | 0}, ${c.g * 255 | 0}, ${c.b * 255 | 0})`;
    dotCtx.fill();

    // Soft edge
    const gradient = dotCtx.createRadialGradient(32, 32, 12, 32, 32, 30);
    gradient.addColorStop(0, `rgba(${c.r * 255 | 0}, ${c.g * 255 | 0}, ${c.b * 255 | 0}, 0.8)`);
    gradient.addColorStop(1, `rgba(${c.r * 255 | 0}, ${c.g * 255 | 0}, ${c.b * 255 | 0}, 0)`);
    dotCtx.beginPath();
    dotCtx.arc(32, 32, 30, 0, Math.PI * 2);
    dotCtx.fillStyle = gradient;
    dotCtx.fill();

    const dotTex = new THREE.CanvasTexture(dotCanvas);
    const dotMat = new THREE.SpriteMaterial({
      map: dotTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.sprite = new THREE.Sprite(dotMat);
    this.sprite.scale.set(options.size, options.size, 1);
    this.group.add(this.sprite);

    // Outer glow
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = 128;
    glowCanvas.height = 128;
    const glowCtx = glowCanvas.getContext('2d')!;
    const glowGrad = glowCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
    glowGrad.addColorStop(0, `rgba(${c.r * 255 | 0}, ${c.g * 255 | 0}, ${c.b * 255 | 0}, 0.3)`);
    glowGrad.addColorStop(0.5, `rgba(${c.r * 255 | 0}, ${c.g * 255 | 0}, ${c.b * 255 | 0}, 0.08)`);
    glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
    glowCtx.fillStyle = glowGrad;
    glowCtx.fillRect(0, 0, 128, 128);

    const glowTex = new THREE.CanvasTexture(glowCanvas);
    const glowMat = new THREE.SpriteMaterial({
      map: glowTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.glow = new THREE.Sprite(glowMat);
    this.glow.scale.set(options.glowSize, options.glowSize, 1);
    this.group.add(this.glow);
  }

  setDirection(dir: [number, number, number], instant = false): void {
    this.targetDir.set(dir[0], dir[2], -dir[1]).normalize();
    if (instant) {
      this.currentDir.copy(this.targetDir);
      this.group.position.copy(this.targetDir.clone().multiplyScalar(BODY_DISTANCE));
    }
  }

  update(dt: number): void {
    this.currentDir.lerp(this.targetDir, Math.min(1, dt * 6));
    this.currentDir.normalize();
    this.group.position.copy(this.currentDir.clone().multiplyScalar(BODY_DISTANCE));
  }

  dispose(): void {
    this.sprite.material.dispose();
    (this.sprite.material as THREE.SpriteMaterial).map?.dispose();
    this.glow.material.dispose();
    (this.glow.material as THREE.SpriteMaterial).map?.dispose();
  }
}
