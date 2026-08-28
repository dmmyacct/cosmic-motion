/**
 * Horizon reference grid and cardinal direction markers.
 * Provides spatial grounding in the 3D scene.
 */

import * as THREE from 'three';

export function createHorizonGrid(scene: THREE.Scene): THREE.Group {
  const group = new THREE.Group();

  // Horizon circle
  const horizonGeo = new THREE.BufferGeometry();
  const horizonPts: number[] = [];
  const segments = 128;
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    horizonPts.push(
      Math.cos(angle) * 400,
      0,
      Math.sin(angle) * 400,
    );
  }
  horizonGeo.setAttribute('position', new THREE.Float32BufferAttribute(horizonPts, 3));
  const horizonMat = new THREE.LineBasicMaterial({
    color: 0x4fc3f7,
    transparent: true,
    opacity: 0.08,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  group.add(new THREE.Line(horizonGeo, horizonMat));

  // Cardinal direction lines
  const cardinals = [
    { dir: [0, 0, -1], label: 'N' },  // North = -Z in Three.js
    { dir: [1, 0, 0], label: 'E' },
    { dir: [0, 0, 1], label: 'S' },
    { dir: [-1, 0, 0], label: 'W' },
  ];

  for (const c of cardinals) {
    // Subtle line from center to horizon
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      c.dir[0] * 400, 0, c.dir[2] * 400,
    ], 3));
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x4fc3f7,
      transparent: true,
      opacity: 0.04,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    group.add(new THREE.Line(lineGeo, lineMat));

    // Cardinal label sprite
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(79, 195, 247, 0.4)';
    ctx.font = '600 28px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(c.label, 32, 32);

    const tex = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.set(c.dir[0] * 420, 5, c.dir[2] * 420);
    sprite.scale.set(15, 15, 1);
    group.add(sprite);
  }

  // Altitude circles (30° and 60°)
  for (const alt of [30, 60]) {
    const r = 400 * Math.cos(alt * Math.PI / 180);
    const y = 400 * Math.sin(alt * Math.PI / 180);
    const altGeo = new THREE.BufferGeometry();
    const altPts: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      altPts.push(
        Math.cos(angle) * r,
        y,
        Math.sin(angle) * r,
      );
    }
    altGeo.setAttribute('position', new THREE.Float32BufferAttribute(altPts, 3));
    const altMat = new THREE.LineBasicMaterial({
      color: 0x4fc3f7,
      transparent: true,
      opacity: 0.03,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    group.add(new THREE.Line(altGeo, altMat));
  }

  scene.add(group);
  return group;
}
