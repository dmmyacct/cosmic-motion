/**
 * Renders motion vectors as luminous 3D arrows with glow.
 * Each vector is a cone + cylinder + glow sprite.
 */

import * as THREE from 'three';

export interface VectorColors {
  [key: string]: number;
}

export const VECTOR_COLORS: VectorColors = {
  primary: 0x00e5ff,    // cyan — YOUR MOTION
  combined: 0x00e5ff,
  rotation: 0x4fc3f7,   // light blue
  orbit: 0x2979ff,      // deep blue
  barycenter: 0x7c4dff,  // purple
  galactic: 0xffd740,   // gold
  sun: 0xffab00,        // amber
  moon: 0xcfd8dc,       // silver
  acceleration: 0xff4081, // magenta
};

const ARROW_LENGTH = 80;
const SHAFT_RADIUS = 0.5;
const TIP_RADIUS = 1.8;
const TIP_LENGTH = 6;

export class VectorArrow {
  group: THREE.Group;
  private shaft: THREE.Mesh;
  private tip: THREE.Mesh;
  private glow: THREE.Sprite;
  private _color: number;
  private _visible = true;
  private targetQuaternion = new THREE.Quaternion();
  private currentQuaternion = new THREE.Quaternion();

  constructor(color: number = 0x00e5ff) {
    this._color = color;
    this.group = new THREE.Group();

    // Shaft
    const shaftGeo = new THREE.CylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS * 0.6, ARROW_LENGTH - TIP_LENGTH, 12);
    shaftGeo.translate(0, (ARROW_LENGTH - TIP_LENGTH) / 2, 0);
    const shaftMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
    });
    this.shaft = new THREE.Mesh(shaftGeo, shaftMat);

    // Shaft glow (wider, transparent cylinder for beam effect)
    const shaftGlowGeo = new THREE.CylinderGeometry(SHAFT_RADIUS * 4, SHAFT_RADIUS * 2, ARROW_LENGTH - TIP_LENGTH, 12);
    shaftGlowGeo.translate(0, (ARROW_LENGTH - TIP_LENGTH) / 2, 0);
    const shaftGlowMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.06,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const shaftGlow = new THREE.Mesh(shaftGlowGeo, shaftGlowMat);
    this.group.add(shaftGlow);
    this.group.add(this.shaft);

    // Tip (cone)
    const tipGeo = new THREE.ConeGeometry(TIP_RADIUS, TIP_LENGTH, 12);
    tipGeo.translate(0, ARROW_LENGTH - TIP_LENGTH / 2, 0);
    const tipMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
    });
    this.tip = new THREE.Mesh(tipGeo, tipMat);
    this.group.add(this.tip);

    // Glow sprite at tip
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    const c = new THREE.Color(color);
    gradient.addColorStop(0, `rgba(${c.r * 255 | 0}, ${c.g * 255 | 0}, ${c.b * 255 | 0}, 0.8)`);
    gradient.addColorStop(0.3, `rgba(${c.r * 255 | 0}, ${c.g * 255 | 0}, ${c.b * 255 | 0}, 0.35)`);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);

    const spriteTex = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({
      map: spriteTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.glow = new THREE.Sprite(spriteMat);
    this.glow.position.set(0, ARROW_LENGTH, 0);
    this.glow.scale.set(14, 14, 1);
    this.group.add(this.glow);
  }

  /**
   * Point the arrow toward a direction vector [East, North, Up].
   * The arrow's default direction is +Y, so we rotate to match.
   */
  setDirection(dir: [number, number, number], instant = false): void {
    const d = new THREE.Vector3(dir[0], dir[2], -dir[1]).normalize();
    if (d.length() < 0.001) return;

    const up = new THREE.Vector3(0, 1, 0);
    this.targetQuaternion.setFromUnitVectors(up, d);

    if (instant) {
      this.currentQuaternion.copy(this.targetQuaternion);
      this.group.quaternion.copy(this.targetQuaternion);
    }
  }

  update(dt: number): void {
    this.currentQuaternion.slerp(this.targetQuaternion, Math.min(1, dt * 8));
    this.group.quaternion.copy(this.currentQuaternion);
  }

  setVisible(v: boolean): void {
    this._visible = v;
    this.group.visible = v;
  }

  dispose(): void {
    this.shaft.geometry.dispose();
    (this.shaft.material as THREE.Material).dispose();
    this.tip.geometry.dispose();
    (this.tip.material as THREE.Material).dispose();
    this.glow.material.dispose();
    (this.glow.material as THREE.SpriteMaterial).map?.dispose();
  }
}

/**
 * Manages all vector arrows in the scene.
 */
export class VectorRenderer {
  private arrows = new Map<string, VectorArrow>();
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  getOrCreate(id: string, colorId: string): VectorArrow {
    let arrow = this.arrows.get(id);
    if (!arrow) {
      const color = VECTOR_COLORS[colorId] ?? 0x00e5ff;
      arrow = new VectorArrow(color);
      this.arrows.set(id, arrow);
      this.scene.add(arrow.group);
    }
    return arrow;
  }

  hideAll(): void {
    for (const arrow of this.arrows.values()) {
      arrow.setVisible(false);
    }
  }

  update(dt: number): void {
    for (const arrow of this.arrows.values()) {
      arrow.update(dt);
    }
  }

  dispose(): void {
    for (const arrow of this.arrows.values()) {
      this.scene.remove(arrow.group);
      arrow.dispose();
    }
    this.arrows.clear();
  }
}
