/**
 * Cosmic Motion — 3D orrery view.
 *
 * You're riding Earth through space. See the trajectory stretching ahead,
 * shadow Earths marking yesterday and tomorrow, the Sun lighting your path,
 * the Moon nearby, Earth spinning beneath you.
 *
 * Coordinate mapping: ecliptic X→Three X, ecliptic Y→-Three Z, ecliptic Z→Three Y
 */

import * as THREE from 'three';
import { computeSceneData, type SceneData } from './engine/observer';
import { LocationService } from './sensors/location';
import { createUI } from './ui/controls';

const EARTH_R = 0.5;
const AU_TO_SCENE = 600;
const MOON_DIST = 2.5;
const SUN_DIST = 50;

function eclToThree(v: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(v[0], v[2], -v[1]);
}

export class CosmicMotionApp {
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private clock = new THREE.Clock();
  private locationService = new LocationService();
  private ui!: ReturnType<typeof createUI>;

  private earth!: THREE.Mesh;
  private atmosphere!: THREE.Mesh;
  private axisLine!: THREE.Line;
  private poleSweepGroup!: THREE.Group;
  private northSweep!: THREE.Group;
  private trajectoryMesh!: THREE.Mesh;
  private trajectoryForwardMesh!: THREE.Mesh;
  private shadowGroup!: THREE.Group;
  private sunLight!: THREE.PointLight;
  private sunSprite!: THREE.Sprite;
  private sunGlow!: THREE.Sprite;
  private moonMesh!: THREE.Mesh;
  private starfield!: THREE.Points;
  private arrowHelper!: THREE.ArrowHelper;
  private nowLabel!: THREE.Sprite;
  private sunLabel!: THREE.Sprite;
  private moonLabel!: THREE.Sprite;
  private sunBeam!: THREE.Line;
  private trajectoryGlowPast!: THREE.Mesh;
  private trajectoryGlowFuture!: THREE.Mesh;

  private data!: SceneData;
  private highlightDay = 0;       // slider-selected day offset
  private camAzimuth = 0.4;
  private camElevation = 0.45;
  private camDist = 12;
  private dragging = false;
  private lastPtr = { x: 0, y: 0 };
  private forwardDir = new THREE.Vector3(0, 0, -1);
  private needsDataUpdate = true;
  private highlightMesh!: THREE.Mesh;

  async init(container: HTMLElement): Promise<void> {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.setClearColor(0x020308);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      55, container.clientWidth / container.clientHeight, 0.01, 2000,
    );

    this.scene = new THREE.Scene();

    // Subtle ambient + hemisphere for depth
    this.scene.add(new THREE.AmbientLight(0x1a1a2e, 0.6));
    this.scene.add(new THREE.HemisphereLight(0x2244aa, 0x111122, 0.3));

    this.buildStarfield();
    this.buildEarth();
    this.buildSun();
    this.buildMoon();
    this.buildAxisLine();
    this.buildPoleSweeps();
    this.buildArrow();

    this.shadowGroup = new THREE.Group();
    this.scene.add(this.shadowGroup);

    // Minimal labels — only Sun gets a small tag, Earth speaks for itself
    this.nowLabel = this.makeLabelSprite('', '#ffffff');
    this.nowLabel.visible = false;

    this.sunLabel = this.makeLabelSprite('☉', '#ffd54f');
    this.sunLabel.scale.set(1.4, 0.7, 1);
    this.scene.add(this.sunLabel);

    // Sun direction beam
    const beamGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 0),
    ]);
    this.sunBeam = new THREE.Line(beamGeo, new THREE.LineBasicMaterial({
      color: 0xffd54f, transparent: true, opacity: 0.12,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.scene.add(this.sunBeam);

    this.moonLabel = this.makeLabelSprite('', '#b0b0b0');
    this.moonLabel.visible = false;

    // Highlight marker (for slider-selected shadow Earth)
    const hlGeo = new THREE.RingGeometry(EARTH_R * 0.5, EARTH_R * 0.7, 32);
    const hlMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.highlightMesh = new THREE.Mesh(hlGeo, hlMat);
    this.scene.add(this.highlightMesh);

    this.ui = createUI(container, {
      onTimeChange: (days) => {
        this.highlightDay = days;
        this.updateHighlight();
      },
    });

    await this.locationService.request();
    this.locationService.startWatching();

    this.bindControls(container);
    window.addEventListener('resize', () => {
      this.camera.aspect = container.clientWidth / container.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(container.clientWidth, container.clientHeight);
    });

    this.updateSceneData();
    this.animate();
  }

  // ── Build objects ──

  private buildStarfield(): void {
    const count = 8000;
    const pos = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 500 + Math.random() * 400;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);

      const temp = Math.random();
      const brightness = Math.random() < 0.95 ? 0.3 + Math.random() * 0.4 : 0.7 + Math.random() * 0.3;
      if (temp < 0.3) {
        colors[i * 3] = brightness * 0.8;
        colors[i * 3 + 1] = brightness * 0.85;
        colors[i * 3 + 2] = brightness;
      } else if (temp < 0.6) {
        colors[i * 3] = brightness;
        colors[i * 3 + 1] = brightness * 0.95;
        colors[i * 3 + 2] = brightness * 0.85;
      } else {
        colors[i * 3] = brightness;
        colors[i * 3 + 1] = brightness;
        colors[i * 3 + 2] = brightness;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 1.5, vertexColors: true, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    this.starfield = new THREE.Points(geo, mat);
    this.scene.add(this.starfield);
  }

  private buildEarth(): void {
    const geo = new THREE.SphereGeometry(EARTH_R, 64, 64);

    // Day/night shader: sunlit side shows ocean/land tones, dark side shows faint city-light emissive
    const earthMat = new THREE.ShaderMaterial({
      uniforms: {
        sunDirection: { value: new THREE.Vector3(1, 0, 0) },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 sunDirection;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        void main() {
          vec3 sunDir = normalize(sunDirection);
          float NdotL = dot(vNormal, sunDir);
          // Smooth terminator
          float dayFactor = smoothstep(-0.15, 0.25, NdotL);

          // Day side: rich ocean blue with slight specular
          vec3 dayColor = mix(
            vec3(0.04, 0.12, 0.28),   // deep ocean
            vec3(0.15, 0.45, 0.75),   // sunlit ocean
            max(0.0, NdotL)
          );

          // Night side: dark with faint warm city lights
          vec3 nightColor = vec3(0.008, 0.006, 0.015);
          // Scattered "city" dots based on position hash
          float hash = fract(sin(dot(vWorldPos.xz * 50.0, vec2(12.9898, 78.233))) * 43758.5453);
          if (hash > 0.92) {
            nightColor += vec3(0.12, 0.08, 0.02) * (hash - 0.92) * 12.0;
          }

          vec3 color = mix(nightColor, dayColor, dayFactor);
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    this.earth = new THREE.Mesh(geo, earthMat);
    this.scene.add(this.earth);

    // Fresnel atmosphere rim — glows blue at the edges, transparent face-on
    const atmoGeo = new THREE.SphereGeometry(EARTH_R * 1.06, 64, 64);
    const atmoMat = new THREE.ShaderMaterial({
      uniforms: {
        sunDirection: { value: new THREE.Vector3(1, 0, 0) },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vWorldNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vViewDir = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform vec3 sunDirection;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vWorldNormal;
        void main() {
          float fresnel = 1.0 - dot(vViewDir, vNormal);
          fresnel = pow(fresnel, 3.0);
          // Brighter on sunlit side
          float sunFacing = dot(vWorldNormal, normalize(sunDirection));
          float sunBoost = smoothstep(-0.3, 0.5, sunFacing);
          float alpha = fresnel * (0.25 + 0.55 * sunBoost);
          vec3 color = mix(vec3(0.2, 0.4, 0.9), vec3(0.4, 0.7, 1.0), sunBoost);
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    this.atmosphere = new THREE.Mesh(atmoGeo, atmoMat);
    this.scene.add(this.atmosphere);
  }

  private buildSun(): void {
    this.sunLight = new THREE.PointLight(0xfff4e0, 3, 500, 0.3);
    this.scene.add(this.sunLight);

    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,252,230,1)');
    g.addColorStop(0.1, 'rgba(255,220,100,0.9)');
    g.addColorStop(0.35, 'rgba(255,170,0,0.4)');
    g.addColorStop(1, 'rgba(255,120,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.sunSprite.scale.set(14, 14, 1);
    this.scene.add(this.sunSprite);

    const gc = document.createElement('canvas');
    gc.width = 256; gc.height = 256;
    const gctx = gc.getContext('2d')!;
    const gg = gctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gg.addColorStop(0, 'rgba(255,230,120,0.2)');
    gg.addColorStop(0.2, 'rgba(255,200,60,0.08)');
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    gctx.fillStyle = gg;
    gctx.fillRect(0, 0, 256, 256);
    this.sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(gc), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.sunGlow.scale.set(50, 50, 1);
    this.scene.add(this.sunGlow);
  }

  private buildMoon(): void {
    const geo = new THREE.SphereGeometry(EARTH_R * 0.27, 32, 32);
    const mat = new THREE.MeshPhongMaterial({
      color: 0xb8b8b8, emissive: 0x222222, emissiveIntensity: 0.15, shininess: 5,
    });
    this.moonMesh = new THREE.Mesh(geo, mat);
    this.scene.add(this.moonMesh);

    // Moon orbital path (simplified circle at MOON_DIST)
    const orbitSegments = 96;
    const orbitPts: THREE.Vector3[] = [];
    for (let i = 0; i <= orbitSegments; i++) {
      const a = (i / orbitSegments) * Math.PI * 2;
      orbitPts.push(new THREE.Vector3(
        MOON_DIST * Math.cos(a),
        0,
        MOON_DIST * Math.sin(a),
      ));
    }
    const orbitGeo = new THREE.BufferGeometry().setFromPoints(orbitPts);
    const orbitLine = new THREE.Line(orbitGeo, new THREE.LineBasicMaterial({
      color: 0x888888, transparent: true, opacity: 0.08, depthWrite: false,
    }));
    // Tilt Moon's orbit by ~5.14° (inclination to ecliptic)
    orbitLine.rotation.x = 5.14 * Math.PI / 180;
    this.scene.add(orbitLine);
  }

  private buildPoleSweeps(): void {
    this.poleSweepGroup = new THREE.Group();
    const axisLen = EARTH_R * 2.5;

    this.northSweep = this.createSweepArc(0.35, 0.9);
    this.northSweep.position.y = axisLen;
    this.poleSweepGroup.add(this.northSweep);

    this.scene.add(this.poleSweepGroup);
  }

  private createSweepArc(radius: number, brightness: number): THREE.Group {
    const group = new THREE.Group();
    const arcAngle = Math.PI * 1.6;
    const segments = 80;

    const positions = new Float32Array((segments + 1) * 3);
    const colors = new Float32Array((segments + 1) * 3);

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const angle = t * arcAngle;
      positions[i * 3] = radius * Math.cos(angle);
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = radius * Math.sin(angle);

      const fade = Math.pow(1.0 - t, 2.0) * brightness;
      colors[i * 3] = 0.31 * fade;
      colors[i * 3 + 1] = 0.76 * fade;
      colors[i * 3 + 2] = 0.97 * fade;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    group.add(new THREE.Line(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })));

    // Arrowhead cone at the leading tip (angle 0), pointing in rotation direction
    const coneGeo = new THREE.ConeGeometry(0.04, 0.14, 6);
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0x4fc3f7, transparent: true, opacity: brightness,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.set(radius, 0, 0);
    // Tangent at angle 0 in the counterclockwise direction
    const tangent = new THREE.Vector3(0, 0, -1);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    group.add(cone);

    return group;
  }

  private buildAxisLine(): void {
    const len = EARTH_R * 2.5;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -len, 0),
      new THREE.Vector3(0, len, 0),
    ]);
    const mat = new THREE.LineDashedMaterial({
      color: 0xffffff, transparent: true, opacity: 0.2,
      dashSize: 0.12, gapSize: 0.06,
    });
    this.axisLine = new THREE.Line(geo, mat);
    this.axisLine.computeLineDistances();
    this.scene.add(this.axisLine);
  }

  private buildArrow(): void {
    this.arrowHelper = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 0),
      EARTH_R * 3, 0x00e5ff, 0.2, 0.1,
    );
    this.arrowHelper.line.material = new THREE.LineBasicMaterial({
      color: 0x00e5ff, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending,
    });
    (this.arrowHelper.cone.material as THREE.MeshBasicMaterial).blending = THREE.AdditiveBlending;
    (this.arrowHelper.cone.material as THREE.MeshBasicMaterial).transparent = true;
    (this.arrowHelper.cone.material as THREE.MeshBasicMaterial).opacity = 0.4;
    this.scene.add(this.arrowHelper);
  }

  // ── Update scene from engine data ──

  private updateSceneData(): void {
    const date = new Date();
    this.data = computeSceneData(date, 10, 4);
    this.needsDataUpdate = false;

    this.forwardDir = eclToThree(this.data.velocityDir).normalize();

    // Build trajectory as tube meshes (past = purple, future = cyan)
    this.buildTrajectoryMeshes();

    // Arrow showing Earth's velocity direction
    this.arrowHelper.setDirection(this.forwardDir);

    // Shadow Earths at integer-day offsets
    this.shadowGroup.clear();
    const pts = this.data.trajectory;
    for (let d = -10; d <= 10; d++) {
      if (d === 0) continue;
      const pt = pts.find((p) => Math.abs(p.dayOffset - d) < 0.01);
      if (!pt) continue;

      const pos = eclToThree(pt.pos).multiplyScalar(AU_TO_SCENE);
      const isFuture = d > 0;
      const absD = Math.abs(d);

      const r = EARTH_R * (absD <= 3 ? 0.3 : 0.2);
      const geo = new THREE.SphereGeometry(r, 16, 16);
      const color = isFuture ? 0x00e5ff : 0x9c6dff;
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true,
        opacity: Math.max(0.05, 0.35 - absD * 0.03),
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      this.shadowGroup.add(mesh);

      // Subtle glow ring
      const ringGeo = new THREE.RingGeometry(r * 1.2, r * 1.4, 24);
      const ringMat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: Math.max(0.01, 0.06 - absD * 0.005),
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.copy(pos);
      ring.lookAt(this.camera.position);
      this.shadowGroup.add(ring);

      if (absD % 5 === 0) {
        const label = this.makeLabelSprite(
          d > 0 ? `+${d}d` : `${d}d`,
          isFuture ? '#00e5ff' : '#b388ff',
        );
        label.position.copy(pos).add(new THREE.Vector3(0, r + 0.3, 0));
        label.scale.set(1.0, 0.5, 1);
        this.shadowGroup.add(label);
      }
    }

    // Sun (correct direction, compressed distance)
    const sunPos = eclToThree(this.data.sunDir).multiplyScalar(SUN_DIST);
    this.sunLight.position.copy(sunPos);
    this.sunSprite.position.copy(sunPos);
    this.sunGlow.position.copy(sunPos);
    this.sunLabel.position.copy(sunPos).add(new THREE.Vector3(0, 5, 0));

    // Update day/night shader sun direction
    const sunDirNorm = eclToThree(this.data.sunDir).normalize();
    (this.earth.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(sunDirNorm);
    (this.atmosphere.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(sunDirNorm);

    // Sun beam from Earth toward Sun
    const beamArr = new Float32Array([
      0, 0, 0,
      sunPos.x, sunPos.y, sunPos.z,
    ]);
    this.sunBeam.geometry.setAttribute('position', new THREE.BufferAttribute(beamArr, 3));

    // Moon
    const moonPos = eclToThree(this.data.moonDir).multiplyScalar(MOON_DIST);
    this.moonMesh.position.copy(moonPos);
    this.moonLabel.position.copy(moonPos).add(new THREE.Vector3(0, EARTH_R * 0.27 + 0.35, 0));

    // Earth tilt
    const tiltAxis = eclToThree([1, 0, 0]).normalize();
    const tiltQuat = new THREE.Quaternion().setFromAxisAngle(tiltAxis, this.data.obliquity);
    this.earth.quaternion.copy(tiltQuat);
    this.atmosphere.quaternion.copy(tiltQuat);
    this.poleSweepGroup.quaternion.copy(tiltQuat);
    this.axisLine.quaternion.copy(tiltQuat);

    this.ui.update({
      speedKmS: this.data.speedKmS,
      date: new Date(),
    });
    this.updateHighlight();
  }

  private updateHighlight(): void {
    if (!this.data) return;
    const day = Math.round(this.highlightDay);
    if (day === 0 || Math.abs(this.highlightDay) < 0.3) {
      (this.highlightMesh.material as THREE.MeshBasicMaterial).opacity = 0;
      return;
    }
    const pt = this.data.trajectory.find((p) => Math.abs(p.dayOffset - day) < 0.01);
    if (!pt) {
      (this.highlightMesh.material as THREE.MeshBasicMaterial).opacity = 0;
      return;
    }
    const pos = eclToThree(pt.pos).multiplyScalar(AU_TO_SCENE);
    this.highlightMesh.position.copy(pos);
    this.highlightMesh.lookAt(this.camera.position);
    (this.highlightMesh.material as THREE.MeshBasicMaterial).opacity = 0.4;
  }

  private buildTrajectoryMeshes(): void {
    // Remove old trajectories
    if (this.trajectoryMesh) { this.scene.remove(this.trajectoryMesh); this.trajectoryMesh.geometry.dispose(); }
    if (this.trajectoryForwardMesh) { this.scene.remove(this.trajectoryForwardMesh); this.trajectoryForwardMesh.geometry.dispose(); }

    const pts = this.data.trajectory;

    // Split into past (dayOffset <= 0) and future (dayOffset >= 0) with overlap at 0
    const pastPts: THREE.Vector3[] = [];
    const futurePts: THREE.Vector3[] = [];

    for (const pt of pts) {
      const v = eclToThree(pt.pos).multiplyScalar(AU_TO_SCENE);
      if (pt.dayOffset <= 0.01) pastPts.push(v);
      if (pt.dayOffset >= -0.01) futurePts.push(v);
    }

    // Remove old glow tubes
    if (this.trajectoryGlowPast) { this.scene.remove(this.trajectoryGlowPast); this.trajectoryGlowPast.geometry.dispose(); }
    if (this.trajectoryGlowFuture) { this.scene.remove(this.trajectoryGlowFuture); this.trajectoryGlowFuture.geometry.dispose(); }

    // Past trajectory — thin, fading purple thread
    if (pastPts.length >= 2) {
      const curve = new THREE.CatmullRomCurve3(pastPts);
      const geo = new THREE.TubeGeometry(curve, pastPts.length * 4, 0.03, 6, false);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x9c6dff, transparent: true, opacity: 0.35,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      this.trajectoryMesh = new THREE.Mesh(geo, mat);
      this.scene.add(this.trajectoryMesh);

      const glowGeo = new THREE.TubeGeometry(curve, pastPts.length * 4, 0.12, 6, false);
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0x7c4dff, transparent: true, opacity: 0.04,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
      });
      this.trajectoryGlowPast = new THREE.Mesh(glowGeo, glowMat);
      this.scene.add(this.trajectoryGlowPast);
    }

    // Future trajectory — thin, brighter cyan thread
    if (futurePts.length >= 2) {
      const curve = new THREE.CatmullRomCurve3(futurePts);
      const geo = new THREE.TubeGeometry(curve, futurePts.length * 4, 0.04, 6, false);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x00e5ff, transparent: true, opacity: 0.45,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      this.trajectoryForwardMesh = new THREE.Mesh(geo, mat);
      this.scene.add(this.trajectoryForwardMesh);

      const glowGeo = new THREE.TubeGeometry(curve, futurePts.length * 4, 0.15, 6, false);
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0x00bcd4, transparent: true, opacity: 0.05,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
      });
      this.trajectoryGlowFuture = new THREE.Mesh(glowGeo, glowMat);
      this.scene.add(this.trajectoryGlowFuture);
    }
  }

  private makeLabelSprite(text: string, color: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 30px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = color;
    ctx.fillText(text, 64, 32);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    return new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false,
    }));
  }

  // ── Controls ──

  private bindControls(el: HTMLElement): void {
    el.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.cm-ui')) return;
      this.dragging = true;
      this.lastPtr = { x: e.clientX, y: e.clientY };
    });

    el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastPtr.x;
      const dy = e.clientY - this.lastPtr.y;
      this.lastPtr = { x: e.clientX, y: e.clientY };
      this.camAzimuth += dx * 0.005;
      this.camElevation = Math.max(-0.6, Math.min(1.2, this.camElevation + dy * 0.005));
    });

    const stop = () => { this.dragging = false; };
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointerleave', stop);

    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camDist = Math.max(2, Math.min(25, this.camDist + e.deltaY * 0.008));
    }, { passive: false });

    let lastPinch = 0;
    el.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (lastPinch > 0) {
          this.camDist = Math.max(2, Math.min(25, this.camDist + (lastPinch - dist) * 0.015));
        }
        lastPinch = dist;
      }
    }, { passive: false });
    el.addEventListener('touchend', () => { lastPinch = 0; });
  }

  // ── Animation loop ──

  private animate = (): void => {
    requestAnimationFrame(this.animate);

    if (this.needsDataUpdate) this.updateSceneData();

    // Earth spin animation
    const rotSpeed = (2 * Math.PI) / (23.9345 * 3600);
    const tiltAxis = eclToThree([1, 0, 0]).normalize();
    const tiltQuat = new THREE.Quaternion().setFromAxisAngle(tiltAxis, this.data.obliquity);
    const spinQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      this.data.rotationAngle + performance.now() * 0.001 * rotSpeed,
    );
    this.earth.quaternion.copy(tiltQuat).multiply(spinQuat);

    // Pole sweep chases around the north pole to show spin direction
    this.northSweep.rotation.y = performance.now() * 0.0018;

    // Camera orbit: "behind Earth looking forward along trajectory"
    const fwd = this.forwardDir;
    const worldUp = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(fwd, worldUp).normalize();
    if (right.lengthSq() < 0.001) right.set(1, 0, 0);
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();

    const az = this.camAzimuth;
    const el = this.camElevation;
    const d = this.camDist;

    // Spherical offset in the fwd/right/up frame
    const camOffset = new THREE.Vector3()
      .addScaledVector(fwd, -Math.cos(el) * Math.cos(az))
      .addScaledVector(right, Math.cos(el) * Math.sin(az))
      .addScaledVector(up, Math.sin(el))
      .normalize()
      .multiplyScalar(d);

    this.camera.position.copy(camOffset);
    this.camera.lookAt(new THREE.Vector3(0, 0, 0));

    this.renderer.render(this.scene, this.camera);
  };
}
