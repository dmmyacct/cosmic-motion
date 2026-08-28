/**
 * Renders orbital paths as thin glowing lines.
 */

import * as THREE from 'three';
import { VECTOR_COLORS } from './vectors';

export class OrbitPath {
  line: THREE.Line;
  private material: THREE.LineBasicMaterial;

  constructor(
    points: [number, number, number][],
    colorId: string,
    opacity = 0.25,
  ) {
    const color = VECTOR_COLORS[colorId] ?? 0x4fc3f7;
    this.material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(points.length * 3);

    // Scale and transform: [East, North, Up] → Three.js [x, y, z]
    // Orbit points come in equatorial, but we display relative to observer
    // For now, project them as directional arcs on the sky sphere
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      // Normalize to unit sphere and scale to display distance
      const len = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
      const scale = 300 / (len || 1);
      positions[i * 3] = p[0] * scale;
      positions[i * 3 + 1] = p[2] * scale;  // Up → Y
      positions[i * 3 + 2] = -p[1] * scale;  // North → -Z
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.line = new THREE.Line(geometry, this.material);
  }

  dispose(): void {
    this.line.geometry.dispose();
    this.material.dispose();
  }
}

export class OrbitRenderer {
  private paths: OrbitPath[] = [];
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  clear(): void {
    for (const path of this.paths) {
      this.scene.remove(path.line);
      path.dispose();
    }
    this.paths = [];
  }

  addPath(
    pointsHorizontal: [number, number, number][],
    colorId: string,
    opacity?: number,
  ): void {
    const path = new OrbitPath(pointsHorizontal, colorId, opacity);
    this.paths.push(path);
    this.scene.add(path.line);
  }

  dispose(): void {
    this.clear();
  }
}
