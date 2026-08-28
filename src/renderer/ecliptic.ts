/**
 * Ecliptic plane visualization.
 * Shows the plane of Earth's orbit as a tilted ring and subtle fill.
 */

import * as THREE from 'three';
import { OBLIQUITY_J2000 } from '../engine/constants';

export function createEclipticPlane(scene: THREE.Scene): THREE.Group {
  const group = new THREE.Group();
  const radius = 350;
  const segments = 120;

  // Ecliptic circle
  const pts: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    pts.push(
      Math.cos(angle) * radius,
      0,
      Math.sin(angle) * radius,
    );
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));

  const mat = new THREE.LineBasicMaterial({
    color: 0xffd740,
    transparent: true,
    opacity: 0.1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const ring = new THREE.Line(geo, mat);
  group.add(ring);

  // "ECLIPTIC PLANE" label
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(255, 215, 64, 0.25)';
  ctx.font = '500 14px -apple-system, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('E C L I P T I C   P L A N E', 128, 16);

  const tex = new THREE.CanvasTexture(canvas);
  const spriteMat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.position.set(radius * 0.7, 5, 0);
  sprite.scale.set(60, 8, 1);
  group.add(sprite);

  // Tilt the ecliptic plane by the obliquity (relative to equatorial/horizon)
  // The ecliptic is tilted ~23.4° relative to the equator
  group.rotation.x = OBLIQUITY_J2000;

  scene.add(group);
  return group;
}
