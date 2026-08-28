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
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { computeSceneData, type SceneData } from './engine/observer';
import { moonPosition } from './engine/lunar';
import { raDecToCartesian, equatorialToEcliptic, obliquity } from './engine/coordinates';
import { dateToJD } from './engine/time';
import { BRIGHT_STARS, bvToRGB } from './engine/stars';
import { LocationService } from './sensors/location';
import { createUI, type UpFrame } from './ui/controls';

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
  private clouds!: THREE.Mesh;
  private atmosphere!: THREE.Mesh;
  private axisLine!: THREE.Line;
  private poleSweepGroup!: THREE.Group;
  private northSweep!: THREE.Group;
  private trajectoryMesh!: THREE.Mesh;
  private trajectoryForwardMesh!: THREE.Mesh;
  private ghostGroup!: THREE.Group;
  private ghostEarth!: THREE.Mesh;
  private ghostClouds!: THREE.Mesh;
  private ghostAtmo!: THREE.Mesh;
  private ghostMoon!: THREE.Mesh;
  private ghostAxisLine!: THREE.Line;
  private ghostSweep!: THREE.Group;
  private ghostSunBeam!: THREE.Line;
  private ghostSunSprite!: THREE.Sprite;
  private ghostSunGlow!: THREE.Sprite;
  private ghostSunLabel!: THREE.Sprite;
  private ghostSunDistLabel!: THREE.Sprite;
  private ghostMoonDistLabel!: THREE.Sprite;
  private ghostLabel!: THREE.Sprite;
  private earthTravelLabel!: THREE.Sprite;
  private sunTravelLabel!: THREE.Sprite;
  private sunLight!: THREE.PointLight;
  private sunSprite!: THREE.Sprite;
  private sunGlow!: THREE.Sprite;
  private moonMesh!: THREE.Mesh;
  private starfield!: THREE.Points;
  private arrowHelper!: THREE.ArrowHelper;
  private sunLabel!: THREE.Sprite;
  private sunBeam!: THREE.Line;
  private sunDistLabel!: THREE.Sprite;
  private moonDistLabel!: THREE.Sprite;
  private moonOrbitLine!: THREE.Line;
  private orbitalRing!: THREE.Line;
  private locMarker!: THREE.Group;
  private locDot!: THREE.Mesh;
  private locOverlay!: HTMLElement;
  private locVisible = true;
  private _locLastUpdate = 0;
  private trajectoryGlowPast!: THREE.Mesh;
  private trajectoryGlowFuture!: THREE.Mesh;
  private sunTrajectoryPast!: THREE.Mesh;
  private sunTrajectoryFuture!: THREE.Mesh;

  private data!: SceneData;
  private ghostOffsetHours = 0;
  private followGhost = false;
  private followTransition = 0;
  private ghostWorldPos = new THREE.Vector3();
  private ghostSunWorldPos = new THREE.Vector3();
  private controls!: OrbitControls;
  private needsDataUpdate = true;
  private firstLoad = true;
  private scenePivot!: THREE.Group;
  private upFrame: UpFrame = 'ecliptic';
  private upQuatTarget = new THREE.Quaternion();
  private upQuatCurrent = new THREE.Quaternion();

  async init(container: HTMLElement): Promise<void> {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.setClearColor(0x020308);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      55, container.clientWidth / container.clientHeight, 0.01, 5000,
    );

    this.scene = new THREE.Scene();
    this.scenePivot = new THREE.Group();
    this.scene.add(this.scenePivot);

    this.scenePivot.add(new THREE.AmbientLight(0x1a1a2e, 0.15));
    this.scenePivot.add(new THREE.HemisphereLight(0x2244aa, 0x111122, 0.1));

    this.buildStarfield();
    this.buildEarth();
    this.buildSun();
    this.buildMoon();
    this.buildAxisLine();
    this.buildPoleSweeps();
    this.buildArrow();
    this.buildOrbitalRing();
    this.buildLocationMarker();

    this.buildGhost();

    this.sunLabel = this.makeLabelSprite('☉', '#ffd54f');
    this.sunLabel.scale.set(1.4, 0.7, 1);
    this.scenePivot.add(this.sunLabel);

    const beamGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 0),
    ]);
    this.sunBeam = new THREE.Line(beamGeo, new THREE.LineBasicMaterial({
      color: 0xffd54f, transparent: true, opacity: 0.12,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.scenePivot.add(this.sunBeam);

    this.sunDistLabel = this.makeDistLabel();
    this.sunDistLabel.scale.set(8, 1, 1);
    this.scenePivot.add(this.sunDistLabel);

    this.moonDistLabel = this.makeDistLabel();
    this.moonDistLabel.scale.set(5, 0.65, 1);
    this.scenePivot.add(this.moonDistLabel);

    this.ui = createUI(container, {
      onTimeChange: (hours) => {
        this.ghostOffsetHours = hours;
        this.updateGhost();
      },
      onToggleFollow: () => {
        this.followGhost = !this.followGhost;
        if (this.followGhost) this.followTransition = 1.0;
      },
      onToggleLocation: () => {
        this.locVisible = !this.locVisible;
      },
      onUpFrameChange: (frame: UpFrame) => {
        this.upFrame = frame;
        this.upQuatTarget.copy(this.getFrameQuaternion(frame));
      },
    });

    await this.locationService.request();
    this.locationService.startWatching();

    // OrbitControls — intuitive drag-to-orbit, scroll-to-zoom, touch support, inertia
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.rotateSpeed = 0.5;
    this.controls.zoomSpeed = 0.8;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 80;
    this.controls.enablePan = false;
    this.controls.target.set(0, 0, 0);

    window.addEventListener('resize', () => {
      this.camera.aspect = container.clientWidth / container.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(container.clientWidth, container.clientHeight);
    });

    this.updateSceneData();
    this.animate();

    // Live mode: refresh data every 30s so positions stay current
    setInterval(() => { this.needsDataUpdate = true; }, 30_000);
  }

  // ── Build objects ──

  private buildStarfield(): void {
    const R = 600;
    const eps = 23.4393 * Math.PI / 180; // J2000 obliquity for coordinate conversion
    const cosE = Math.cos(eps), sinE = Math.sin(eps);

    // Real bright stars from Hipparcos catalog
    const realCount = BRIGHT_STARS.length;
    // Background stars to fill the sky — mix of bright and dim
    const bgCount = 20000;
    const totalCount = realCount + bgCount;
    const pos = new Float32Array(totalCount * 3);
    const colors = new Float32Array(totalCount * 3);
    const sizes = new Float32Array(totalCount);

    for (let i = 0; i < realCount; i++) {
      const s = BRIGHT_STARS[i];
      const raRad = s.ra * (Math.PI / 12);
      const decRad = s.dec * (Math.PI / 180);

      // Equatorial to ecliptic (J2000)
      const eqX = Math.cos(decRad) * Math.cos(raRad);
      const eqY = Math.cos(decRad) * Math.sin(raRad);
      const eqZ = Math.sin(decRad);
      const eclX = eqX;
      const eclY = eqY * cosE + eqZ * sinE;
      const eclZ = -eqY * sinE + eqZ * cosE;

      // Ecliptic to Three.js: X→X, Y→-Z, Z→Y
      pos[i * 3]     = eclX * R;
      pos[i * 3 + 1] = eclZ * R;
      pos[i * 3 + 2] = -eclY * R;

      const [r, g, b] = bvToRGB(s.bv);
      const brightness = Math.max(0.4, 1.0 - s.mag * 0.18);
      colors[i * 3]     = r * brightness;
      colors[i * 3 + 1] = g * brightness;
      colors[i * 3 + 2] = b * brightness;

      // Brighter stars get bigger points
      sizes[i] = Math.max(1.5, 4.5 - s.mag * 1.0);
    }

    // Background filler stars — power-law brightness distribution
    for (let i = realCount; i < totalCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = R + Math.random() * 200;
      pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);

      // Power-law: most stars dim, some noticeably bright
      const roll = Math.random();
      let brightness: number;
      let size: number;
      if (roll < 0.005) {
        // Rare bright ones
        brightness = 0.7 + Math.random() * 0.3;
        size = 2.5 + Math.random() * 1.5;
      } else if (roll < 0.05) {
        // Medium-bright
        brightness = 0.35 + Math.random() * 0.3;
        size = 1.5 + Math.random() * 1.0;
      } else if (roll < 0.25) {
        // Visible but modest
        brightness = 0.18 + Math.random() * 0.2;
        size = 1.0 + Math.random() * 0.6;
      } else {
        // Dim filler — the majority
        brightness = 0.08 + Math.random() * 0.15;
        size = 0.6 + Math.random() * 0.5;
      }

      // Slight color variation — warm or cool tint
      const tint = Math.random();
      if (tint < 0.15) {
        colors[i * 3]     = brightness * 1.1;
        colors[i * 3 + 1] = brightness * 0.85;
        colors[i * 3 + 2] = brightness * 0.7;
      } else if (tint < 0.3) {
        colors[i * 3]     = brightness * 0.75;
        colors[i * 3 + 1] = brightness * 0.85;
        colors[i * 3 + 2] = brightness * 1.15;
      } else {
        colors[i * 3]     = brightness;
        colors[i * 3 + 1] = brightness;
        colors[i * 3 + 2] = brightness * (0.95 + Math.random() * 0.1);
      }
      sizes[i] = size;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: `
        attribute float size;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (300.0 / -mvPos.z);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          float alpha = 1.0 - smoothstep(0.3, 0.5, d);
          gl_FragColor = vec4(vColor, alpha);
        }
      `,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.starfield = new THREE.Points(geo, mat);
    this.scenePivot.add(this.starfield);
  }

  private buildEarth(): void {
    const loader = new THREE.TextureLoader();
    const dayTex = loader.load('/textures/earth-day.jpg');
    const nightTex = loader.load('/textures/earth-night.jpg');
    const cloudTex = loader.load('/textures/earth-clouds.jpg');

    dayTex.colorSpace = THREE.SRGBColorSpace;

    // Earth surface: NASA Blue Marble day + city lights night, blended at terminator
    const geo = new THREE.SphereGeometry(EARTH_R, 64, 64);
    const earthMat = new THREE.ShaderMaterial({
      uniforms: {
        sunDirection: { value: new THREE.Vector3(1, 0, 0) },
        dayMap: { value: dayTex },
        nightMap: { value: nightTex },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 sunDirection;
        uniform sampler2D dayMap;
        uniform sampler2D nightMap;
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        void main() {
          vec3 sunDir = normalize(sunDirection);
          float NdotL = dot(vWorldNormal, sunDir);
          float dayFactor = smoothstep(-0.12, 0.2, NdotL);

          vec3 dayColor = texture2D(dayMap, vUv).rgb;
          float diffuse = 0.12 + 0.88 * max(0.0, NdotL);
          dayColor *= diffuse;

          // Specular highlight — strongest on oceans (dark/blue areas)
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          vec3 halfDir = normalize(sunDir + viewDir);
          float spec = pow(max(0.0, dot(vWorldNormal, halfDir)), 50.0);
          float rawLum = dot(texture2D(dayMap, vUv).rgb, vec3(0.299, 0.587, 0.114));
          float waterMask = 1.0 - smoothstep(0.08, 0.25, rawLum);
          dayColor += vec3(0.7, 0.65, 0.5) * spec * waterMask * 0.4 * max(0.0, NdotL);

          vec3 nightColor = texture2D(nightMap, vUv).rgb * 1.4;

          vec3 color = mix(nightColor, dayColor, dayFactor);
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    this.earth = new THREE.Mesh(geo, earthMat);
    this.scenePivot.add(this.earth);

    // Cloud layer — slightly larger sphere, semi-transparent white clouds
    const cloudGeo = new THREE.SphereGeometry(EARTH_R * 1.015, 64, 64);
    const cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        sunDirection: { value: new THREE.Vector3(1, 0, 0) },
        cloudMap: { value: cloudTex },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        void main() {
          vUv = uv;
          vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 sunDirection;
        uniform sampler2D cloudMap;
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        void main() {
          float NdotL = dot(vWorldNormal, normalize(sunDirection));
          float light = smoothstep(-0.1, 0.3, NdotL) * (0.6 + 0.4 * max(0.0, NdotL));
          float cloud = texture2D(cloudMap, vUv).r;
          gl_FragColor = vec4(vec3(light), cloud * 0.45);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    this.clouds = new THREE.Mesh(cloudGeo, cloudMat);
    this.scenePivot.add(this.clouds);

    // Fresnel atmosphere rim
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
    this.scenePivot.add(this.atmosphere);
  }

  private buildSun(): void {
    this.sunLight = new THREE.PointLight(0xfff4e0, 3, 500, 0.3);
    this.scenePivot.add(this.sunLight);

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
    this.scenePivot.add(this.sunSprite);

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
    this.scenePivot.add(this.sunGlow);
  }

  private buildMoon(): void {
    const geo = new THREE.SphereGeometry(EARTH_R * 0.27, 32, 32);
    const moonMat = new THREE.ShaderMaterial({
      uniforms: {
        sunDirection: { value: new THREE.Vector3(1, 0, 0) },
      },
      vertexShader: `
        varying vec3 vWorldNormal;
        void main() {
          vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 sunDirection;
        varying vec3 vWorldNormal;
        void main() {
          vec3 sunDir = normalize(sunDirection);
          float NdotL = dot(vWorldNormal, sunDir);
          float lit = 0.02 + 0.98 * max(0.0, NdotL);
          vec3 color = vec3(0.72, 0.71, 0.68) * lit;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    this.moonMesh = new THREE.Mesh(geo, moonMat);
    this.scenePivot.add(this.moonMesh);

    // Moon orbital path — computed from actual lunar ephemeris over one sidereal month
    this.moonOrbitLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0x999999, transparent: true, opacity: 0.1, depthWrite: false,
      }),
    );
    this.scenePivot.add(this.moonOrbitLine);
  }

  private buildLocationMarker(): void {
    this.locMarker = new THREE.Group();

    const dotGeo = new THREE.SphereGeometry(0.02, 12, 12);
    const dotMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.locDot = new THREE.Mesh(dotGeo, dotMat);
    this.locMarker.add(this.locDot);
    this.scenePivot.add(this.locMarker);

    // HTML overlay — projected from 3D to screen each frame
    this.locOverlay = document.createElement('div');
    this.locOverlay.className = 'cm-loc-overlay';
    this.locOverlay.innerHTML = `
      <div class="cm-loc-line1"></div>
      <div class="cm-loc-line2"></div>
    `;
    document.getElementById('app')!.appendChild(this.locOverlay);
  }

  private updateLocationMarker(): void {
    if (!this.data || !this.locMarker) return;
    this.locMarker.visible = this.locVisible;
    this.locOverlay.style.display = this.locVisible ? '' : 'none';
    if (!this.locVisible) return;

    const loc = this.locationService.location;
    const latRad = loc.latDeg * Math.PI / 180;
    const lonRad = loc.lonDeg * Math.PI / 180;

    const cosLat = Math.cos(latRad);
    const surfacePos = new THREE.Vector3(
      cosLat * Math.cos(lonRad),
      Math.sin(latRad),
      -cosLat * Math.sin(lonRad),
    ).multiplyScalar(EARTH_R * 1.005);

    const rotSpeed = (2 * Math.PI) / (23.9345 * 3600);
    const tiltAxis = eclToThree([1, 0, 0]).normalize();
    const tiltQuat = new THREE.Quaternion().setFromAxisAngle(tiltAxis, this.data.obliquity);
    const spinQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      this.data.rotationAngle + performance.now() * 0.001 * rotSpeed,
    );
    const earthQuat = tiltQuat.clone().multiply(spinQuat);
    const worldPos = surfacePos.clone().applyQuaternion(earthQuat);
    this.locDot.position.copy(worldPos);

    // Project 3D position to screen — hide if behind Earth
    const dotDir = worldPos.clone().normalize();
    const camDir = this.camera.position.clone().normalize();
    const facing = dotDir.dot(camDir) > -0.1;

    if (!facing) {
      this.locOverlay.style.opacity = '0';
      return;
    }
    this.locOverlay.style.opacity = '1';

    const projected = worldPos.clone().add(dotDir.multiplyScalar(0.15));
    projected.project(this.camera);
    const hw = window.innerWidth / 2;
    const hh = window.innerHeight / 2;
    const sx = projected.x * hw + hw;
    const sy = -projected.y * hh + hh;
    this.locOverlay.style.transform = `translate(${sx}px, ${sy}px)`;

    // Update text content (throttled — every ~500ms)
    const now = performance.now();
    if (!this._locLastUpdate || now - this._locLastUpdate > 500) {
      this._locLastUpdate = now;
      const locData = this.computeLocationData();
      const l1 = this.locOverlay.querySelector('.cm-loc-line1')!;
      const l2 = this.locOverlay.querySelector('.cm-loc-line2')!;
      const dflt = locData.isDefault ? ' ~' : '';
      l1.textContent = `${locData.latStr} ${locData.lonStr}${dflt} · ${locData.localTime}`;
      l2.textContent = locData.sunset;
    }
  }

  private computeLocationData(): { latStr: string; lonStr: string; localTime: string; sunset: string; isDefault: boolean } {
    const loc = this.locationService.location;
    const latRad = loc.latDeg * Math.PI / 180;
    const now = new Date();

    const localTime = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    const sd = this.data.sunDir;
    const eps = this.data.obliquity;
    const sunEqY = sd[1] * Math.cos(eps) + sd[2] * Math.sin(eps);
    const sunDecl = Math.asin(Math.max(-1, Math.min(1, sunEqY)));

    const cosHA = (Math.sin(-0.01454) - Math.sin(latRad) * Math.sin(sunDecl))
      / (Math.cos(latRad) * Math.cos(sunDecl));

    let sunset: string;
    if (cosHA > 1) {
      sunset = 'Polar night';
    } else if (cosHA < -1) {
      sunset = 'Midnight sun';
    } else {
      const haSet = Math.acos(cosHA);
      const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400_000);
      const B = (2 * Math.PI / 365) * (dayOfYear - 81);
      const eqOfTime = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
      const solarNoonUTC = 12 - loc.lonDeg / 15 - eqOfTime / 60;
      const sunsetUTC = solarNoonUTC + haSet * (12 / Math.PI);
      const sunsetDate = new Date(now);
      sunsetDate.setUTCHours(0, 0, 0, 0);
      sunsetDate.setTime(sunsetDate.getTime() + sunsetUTC * 3600_000);
      let diffMs = sunsetDate.getTime() - now.getTime();
      if (diffMs < -600_000) diffMs += 86400_000;
      if (diffMs < 0) {
        sunset = 'Sun has set';
      } else {
        const totalMin = Math.round(diffMs / 60_000);
        const uh = Math.floor(totalMin / 60);
        const um = totalMin % 60;
        sunset = uh > 0 ? `${uh}h ${um}m` : `${um}m`;
      }
    }

    return {
      latStr: `${Math.abs(loc.latDeg).toFixed(2)}°${loc.latDeg >= 0 ? 'N' : 'S'}`,
      lonStr: `${Math.abs(loc.lonDeg).toFixed(2)}°${loc.lonDeg >= 0 ? 'E' : 'W'}`,
      localTime,
      sunset,
      isDefault: !this.locationService.hasRealLocation,
    };
  }

  private computeTravelDistances(offsetHours: number): { earthKm: number; sunKm: number } {
    const offsetDays = offsetHours / 24;
    const absDays = Math.abs(offsetDays);

    // Sun's galactic travel: straight line, constant speed
    const sunKm = this.data.solarGalacticSpeedKmS * Math.abs(offsetHours) * 3600;

    // Earth's orbital travel: integrate arc length along the trajectory
    // Walk through trajectory points from dayOffset=0 to dayOffset=offsetDays,
    // summing the actual distances between consecutive positions (in AU, convert to km)
    const AU_KM = 149597870.7;
    const pts = this.data.trajectory;
    let earthAU = 0;

    // Find direction: past or future
    const sign = offsetDays >= 0 ? 1 : -1;
    let prevPos: [number, number, number] | null = null;

    for (const pt of pts) {
      if (sign > 0 && pt.dayOffset < 0) continue;
      if (sign < 0 && pt.dayOffset > 0) continue;
      if (Math.abs(pt.dayOffset) > absDays) break;

      if (prevPos) {
        const dx = pt.pos[0] - prevPos[0];
        const dy = pt.pos[1] - prevPos[1];
        const dz = pt.pos[2] - prevPos[2];
        earthAU += Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
      prevPos = pt.pos;
    }

    return { earthKm: earthAU * AU_KM, sunKm };
  }

  private getFrameQuaternion(frame: UpFrame): THREE.Quaternion {
    const q = new THREE.Quaternion();
    if (frame === 'ecliptic') {
      // Identity — ecliptic Z is already mapped to Three.js Y (up)
      return q;
    }
    if (frame === 'equatorial') {
      // Rotate so Earth's spin axis (tilted ~23.44° from ecliptic north) becomes Y-up
      // In ecliptic coords, the equatorial north pole is at ecliptic lon=270°(=–X), lat=66.56°
      // eclToThree maps ecl(0,0,1) → Y. We need ecl rotated so that the equatorial pole → Y.
      // Equatorial north in ecliptic: (0, -sin(ε), cos(ε)) where ε ≈ 23.44°
      // In Three.js via eclToThree: (0, cos(ε), sin(ε))
      // We need to rotate this vector to (0,1,0)
      const eps = 23.4393 * Math.PI / 180;
      const axis = new THREE.Vector3(1, 0, 0); // rotate around X
      q.setFromAxisAngle(axis, eps);
      return q;
    }
    if (frame === 'galactic') {
      // Galactic north pole in ecliptic coords: (lon≈180.02°, lat≈29.81°)
      // Simplified: galactic north in ecliptic ≈ (-cos(29.8°)·cos(0°), -cos(29.8°)·sin(0°), sin(29.8°))
      // More precisely, galactic north pole (J2000): RA=12h51m, Dec=+27°07'
      // In ecliptic: lon≈180.02°, lat≈29.81°
      const lonRad = 180.02 * Math.PI / 180;
      const latRad = 29.81 * Math.PI / 180;
      const galNorthEcl: [number, number, number] = [
        Math.cos(latRad) * Math.cos(lonRad),
        Math.cos(latRad) * Math.sin(lonRad),
        Math.sin(latRad),
      ];
      const galNorthThree = new THREE.Vector3(
        galNorthEcl[0], galNorthEcl[2], -galNorthEcl[1],
      ).normalize();
      q.setFromUnitVectors(galNorthThree, new THREE.Vector3(0, 1, 0));
      return q;
    }
    return q;
  }

  private fmtTravelDist(km: number): string {
    if (km >= 1e12) return `${(km / 1e9).toFixed(1)}B km`;
    if (km >= 1e9) return `${(km / 1e9).toFixed(2)}B km`;
    if (km >= 1e7) return `${(km / 1e6).toFixed(1)}M km`;
    if (km >= 1e6) return `${(km / 1e6).toFixed(2)}M km`;
    if (km >= 1e3) return `${(km / 1e3).toFixed(1)}K km`;
    return `${Math.round(km).toLocaleString()} km`;
  }

  private buildPoleSweeps(): void {
    this.poleSweepGroup = new THREE.Group();
    const axisLen = EARTH_R * 2.5;

    this.northSweep = this.createSweepArc(0.35, 0.9);
    this.northSweep.position.y = axisLen;
    this.poleSweepGroup.add(this.northSweep);

    this.scenePivot.add(this.poleSweepGroup);
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
    this.scenePivot.add(this.axisLine);
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
    this.scenePivot.add(this.arrowHelper);
  }

  private buildOrbitalRing(): void {
    const segments = 128;
    const pts: THREE.Vector3[] = [];
    // Draw at SUN_DIST scale — shows Earth's orbit as a ring around the Sun
    const orbitRadius = SUN_DIST;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pts.push(new THREE.Vector3(
        orbitRadius * Math.cos(a), 0, orbitRadius * Math.sin(a),
      ));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    this.orbitalRing = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0x4fc3f7, transparent: true, opacity: 0.08,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.scenePivot.add(this.orbitalRing);
  }

  private rebuildMoonOrbit(date: Date): void {
    const SIDEREAL_MONTH_DAYS = 27.3217;
    const steps = 120;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= steps; i++) {
      const dayOff = (i / steps) * SIDEREAL_MONTH_DAYS;
      const stepDate = new Date(date.getTime() + dayOff * 86400_000);
      const jd = dateToJD(stepDate);
      const eps = obliquity(jd);
      const moon = moonPosition(jd);
      const moonEq = raDecToCartesian(moon.ra, moon.dec);
      const moonEcl = equatorialToEcliptic(moonEq, eps);
      pts.push(eclToThree(moonEcl).multiplyScalar(MOON_DIST));
    }
    this.moonOrbitLine.geometry.dispose();
    this.moonOrbitLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  }

  private buildGhost(): void {
    this.ghostGroup = new THREE.Group();
    this.ghostGroup.visible = false;

    const loader = new THREE.TextureLoader();
    const dayTex = loader.load('/textures/earth-day.jpg');
    const nightTex = loader.load('/textures/earth-night.jpg');
    const cloudTex = loader.load('/textures/earth-clouds.jpg');
    dayTex.colorSpace = THREE.SRGBColorSpace;

    // Ghost Earth — same shader as main but semi-transparent
    const geo = new THREE.SphereGeometry(EARTH_R, 48, 48);
    const ghostEarthMat = new THREE.ShaderMaterial({
      uniforms: {
        sunDirection: { value: new THREE.Vector3(1, 0, 0) },
        dayMap: { value: dayTex },
        nightMap: { value: nightTex },
        ghostAlpha: { value: 0.6 },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 sunDirection;
        uniform sampler2D dayMap;
        uniform sampler2D nightMap;
        uniform float ghostAlpha;
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;
        void main() {
          vec3 sunDir = normalize(sunDirection);
          float NdotL = dot(vWorldNormal, sunDir);
          float dayFactor = smoothstep(-0.12, 0.2, NdotL);
          vec3 dayColor = texture2D(dayMap, vUv).rgb * (0.12 + 0.88 * max(0.0, NdotL));
          vec3 nightColor = texture2D(nightMap, vUv).rgb * 1.4;
          vec3 color = mix(nightColor, dayColor, dayFactor);
          gl_FragColor = vec4(color, ghostAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    this.ghostEarth = new THREE.Mesh(geo, ghostEarthMat);
    this.ghostGroup.add(this.ghostEarth);

    // Ghost clouds
    const cloudGeo = new THREE.SphereGeometry(EARTH_R * 1.015, 48, 48);
    const ghostCloudMat = new THREE.ShaderMaterial({
      uniforms: {
        sunDirection: { value: new THREE.Vector3(1, 0, 0) },
        cloudMap: { value: cloudTex },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        void main() {
          vUv = uv;
          vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 sunDirection;
        uniform sampler2D cloudMap;
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        void main() {
          float NdotL = dot(vWorldNormal, normalize(sunDirection));
          float light = smoothstep(-0.1, 0.3, NdotL) * (0.6 + 0.4 * max(0.0, NdotL));
          float cloud = texture2D(cloudMap, vUv).r;
          gl_FragColor = vec4(vec3(light), cloud * 0.3);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    this.ghostClouds = new THREE.Mesh(cloudGeo, ghostCloudMat);
    this.ghostGroup.add(this.ghostClouds);

    // Ghost atmosphere rim
    const atmoGeo = new THREE.SphereGeometry(EARTH_R * 1.06, 48, 48);
    const ghostAtmoMat = new THREE.ShaderMaterial({
      uniforms: { sunDirection: { value: new THREE.Vector3(1, 0, 0) } },
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
          float fresnel = pow(1.0 - dot(vViewDir, vNormal), 3.0);
          float sunBoost = smoothstep(-0.3, 0.5, dot(vWorldNormal, normalize(sunDirection)));
          float alpha = fresnel * (0.15 + 0.35 * sunBoost);
          vec3 color = mix(vec3(0.2, 0.4, 0.9), vec3(0.4, 0.7, 1.0), sunBoost);
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    this.ghostAtmo = new THREE.Mesh(atmoGeo, ghostAtmoMat);
    this.ghostGroup.add(this.ghostAtmo);

    // Ghost Moon
    const moonGeo = new THREE.SphereGeometry(EARTH_R * 0.27, 24, 24);
    const ghostMoonMat = new THREE.ShaderMaterial({
      uniforms: { sunDirection: { value: new THREE.Vector3(1, 0, 0) } },
      vertexShader: `
        varying vec3 vWorldNormal;
        void main() {
          vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 sunDirection;
        varying vec3 vWorldNormal;
        void main() {
          float NdotL = dot(vWorldNormal, normalize(sunDirection));
          float lit = 0.02 + 0.98 * max(0.0, NdotL);
          vec3 color = vec3(0.72, 0.71, 0.68) * lit;
          gl_FragColor = vec4(color, 0.6);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    this.ghostMoon = new THREE.Mesh(moonGeo, ghostMoonMat);
    this.ghostGroup.add(this.ghostMoon);

    // Ghost axis tilt line
    const axisLen = EARTH_R * 2.5;
    const axisGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -axisLen, 0),
      new THREE.Vector3(0, axisLen, 0),
    ]);
    this.ghostAxisLine = new THREE.Line(axisGeo, new THREE.LineDashedMaterial({
      color: 0xffffff, transparent: true, opacity: 0.1,
      dashSize: 0.12, gapSize: 0.06,
    }));
    this.ghostAxisLine.computeLineDistances();
    this.ghostGroup.add(this.ghostAxisLine);

    // Ghost pole sweep
    this.ghostSweep = this.createSweepArc(0.35, 0.5);
    this.ghostSweep.position.y = axisLen;
    this.ghostGroup.add(this.ghostSweep);

    // Ghost sun beam
    const ghostBeamGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(), new THREE.Vector3(),
    ]);
    this.ghostSunBeam = new THREE.Line(ghostBeamGeo, new THREE.LineBasicMaterial({
      color: 0xffd54f, transparent: true, opacity: 0.08,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.ghostGroup.add(this.ghostSunBeam);

    // Ghost Sun — smaller, semi-transparent version of the Sun sprite
    const ghostSunCanvas = document.createElement('canvas');
    ghostSunCanvas.width = 128; ghostSunCanvas.height = 128;
    const gsCtx = ghostSunCanvas.getContext('2d')!;
    const gsGrad = gsCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gsGrad.addColorStop(0, 'rgba(255,252,230,0.6)');
    gsGrad.addColorStop(0.1, 'rgba(255,220,100,0.5)');
    gsGrad.addColorStop(0.35, 'rgba(255,170,0,0.2)');
    gsGrad.addColorStop(1, 'rgba(255,120,0,0)');
    gsCtx.fillStyle = gsGrad;
    gsCtx.fillRect(0, 0, 128, 128);
    this.ghostSunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(ghostSunCanvas),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.ghostSunSprite.scale.set(10, 10, 1);
    this.ghostGroup.add(this.ghostSunSprite);

    const ghostGlowCanvas = document.createElement('canvas');
    ghostGlowCanvas.width = 256; ghostGlowCanvas.height = 256;
    const ggCtx = ghostGlowCanvas.getContext('2d')!;
    const ggGrad = ggCtx.createRadialGradient(128, 128, 0, 128, 128, 128);
    ggGrad.addColorStop(0, 'rgba(255,230,120,0.1)');
    ggGrad.addColorStop(0.2, 'rgba(255,200,60,0.04)');
    ggGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ggCtx.fillStyle = ggGrad;
    ggCtx.fillRect(0, 0, 256, 256);
    this.ghostSunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(ghostGlowCanvas),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.ghostSunGlow.scale.set(35, 35, 1);
    this.ghostGroup.add(this.ghostSunGlow);

    this.ghostSunLabel = this.makeLabelSprite('☉', '#ffd54f');
    this.ghostSunLabel.scale.set(1.0, 0.5, 1);
    this.ghostSunLabel.material.opacity = 0.5;
    this.ghostGroup.add(this.ghostSunLabel);

    // Ghost Sun distance label
    this.ghostSunDistLabel = this.makeDistLabel();
    this.ghostSunDistLabel.scale.set(7, 0.9, 1);
    this.ghostGroup.add(this.ghostSunDistLabel);

    // Ghost Moon distance + phase label
    this.ghostMoonDistLabel = this.makeDistLabel();
    this.ghostMoonDistLabel.scale.set(5, 0.65, 1);
    this.ghostGroup.add(this.ghostMoonDistLabel);

    // Ghost date/time label
    this.ghostLabel = this.makeLabelSprite('', '#ffffff');
    this.ghostLabel.scale.set(2.5, 0.6, 1);
    this.ghostGroup.add(this.ghostLabel);

    // Travel-distance labels (not inside ghostGroup — they span current→ghost)
    this.earthTravelLabel = this.makeDistLabel();
    this.earthTravelLabel.scale.set(7, 0.9, 1);
    this.earthTravelLabel.visible = false;
    this.scenePivot.add(this.earthTravelLabel);

    this.sunTravelLabel = this.makeDistLabel();
    this.sunTravelLabel.scale.set(7, 0.9, 1);
    this.sunTravelLabel.visible = false;
    this.scenePivot.add(this.sunTravelLabel);

    this.scenePivot.add(this.ghostGroup);
  }

  // ── Update scene from engine data ──

  private updateSceneData(): void {
    const date = new Date();
    this.data = computeSceneData(date, 36525);
    this.needsDataUpdate = false;

    const velocityDir = eclToThree(this.data.velocityDir).normalize();

    this.buildTrajectoryMeshes();
    this.rebuildMoonOrbit(date);
    this.arrowHelper.setDirection(velocityDir);

    // Sun
    const sunPos = eclToThree(this.data.sunDir).multiplyScalar(SUN_DIST);
    this.sunLight.position.copy(sunPos);
    this.sunSprite.position.copy(sunPos);
    this.sunGlow.position.copy(sunPos);
    this.sunLabel.position.copy(sunPos).add(new THREE.Vector3(0, 5, 0));

    const sunDirNorm = eclToThree(this.data.sunDir).normalize();

    // On first load, place camera so it faces the Sun
    if (this.firstLoad) {
      this.firstLoad = false;
      // Camera goes on the opposite side of Earth from the Sun, slightly above
      const awayFromSun = sunPos.clone().normalize().multiplyScalar(-12);
      awayFromSun.y = 4;
      this.camera.position.copy(awayFromSun);
      this.controls.update();
    }

    (this.earth.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(sunDirNorm);
    (this.clouds.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(sunDirNorm);
    (this.atmosphere.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(sunDirNorm);
    (this.moonMesh.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(sunDirNorm);

    const beamArr = new Float32Array([0, 0, 0, sunPos.x, sunPos.y, sunPos.z]);
    this.sunBeam.geometry.setAttribute('position', new THREE.BufferAttribute(beamArr, 3));

    // Orbital ring — centered on the Sun, in the ecliptic plane
    this.orbitalRing.position.copy(sunPos);

    // Sun distance label — along beam
    const sunMid = sunPos.clone().multiplyScalar(0.4);
    sunMid.y += 2;
    this.sunDistLabel.position.copy(sunMid);
    const sunKm = this.data.sunDistAU * 149597870.7;
    const lightSec = sunKm / 299792.458;
    const lightMin = Math.floor(lightSec / 60);
    const lightS = Math.round(lightSec % 60);
    this.updateDistLabel(
      this.sunDistLabel,
      `☉  ${(sunKm / 1e6).toFixed(1)}M km  ·  ${lightMin}m ${String(lightS).padStart(2, '0')}s light`,
      'rgba(255, 230, 160, 0.85)',
    );

    // Moon phase: angle between Sun and Moon as seen from Earth
    const sunV = new THREE.Vector3(...this.data.sunDir);
    const moonV = new THREE.Vector3(...this.data.moonDir);
    const phaseAngle = sunV.angleTo(moonV);
    const cross = new THREE.Vector3().crossVectors(sunV, moonV);
    const moonPhaseWaxing = cross.z > 0;

    // Moon
    const moonPos = eclToThree(this.data.moonDir).multiplyScalar(MOON_DIST);
    this.moonMesh.position.copy(moonPos);

    const moonLabelPos = moonPos.clone();
    moonLabelPos.y += EARTH_R * 0.7;
    this.moonDistLabel.position.copy(moonLabelPos);
    const phaseDeg = phaseAngle * 180 / Math.PI;
    const phaseName = phaseDeg > 175 ? 'New' : phaseDeg < 5 ? 'Full'
      : moonPhaseWaxing
        ? (phaseDeg > 95 ? 'Wax. Crescent' : phaseDeg > 85 ? '1st Quarter' : 'Wax. Gibbous')
        : (phaseDeg < 85 ? 'Wan. Gibbous' : phaseDeg < 95 ? '3rd Quarter' : 'Wan. Crescent');
    this.updateDistLabel(
      this.moonDistLabel,
      `☽  ${Math.round(this.data.moonDistKm).toLocaleString()} km  ·  ${phaseName}`,
      'rgba(220, 220, 215, 0.8)',
    );

    // Earth tilt
    const tiltAxis = eclToThree([1, 0, 0]).normalize();
    const tiltQuat = new THREE.Quaternion().setFromAxisAngle(tiltAxis, this.data.obliquity);
    this.earth.quaternion.copy(tiltQuat);
    this.clouds.quaternion.copy(tiltQuat);
    this.atmosphere.quaternion.copy(tiltQuat);
    this.poleSweepGroup.quaternion.copy(tiltQuat);
    this.axisLine.quaternion.copy(tiltQuat);

    const travel = Math.abs(this.ghostOffsetHours) > 0.01
      ? this.computeTravelDistances(this.ghostOffsetHours) : null;

    this.ui.update({
      speedKmS: this.data.speedKmS,
      orbitalSpeedKmS: this.data.orbitalSpeedKmS,
      solarGalacticSpeedKmS: this.data.solarGalacticSpeedKmS,
      sunDistAU: this.data.sunDistAU,
      moonDistKm: this.data.moonDistKm,
      moonPhaseAngle: phaseAngle,
      moonPhaseWaxing,
      obliquity: this.data.obliquity,
      rotationAngle: this.data.rotationAngle,
      date: new Date(),
      earthDistTraveled: travel?.earthKm,
      sunDistTraveled: travel?.sunKm,
    });
    this.updateGhost();
  }

  private updateGhost(): void {
    if (!this.data) return;

    if (Math.abs(this.ghostOffsetHours) < 0.01) {
      this.ghostGroup.visible = false;
      this.earthTravelLabel.visible = false;
      this.sunTravelLabel.visible = false;
      return;
    }

    this.ghostGroup.visible = true;

    const ghostDate = new Date(Date.now() + this.ghostOffsetHours * 3600_000);
    const ghostData = computeSceneData(ghostDate, 0);
    const offsetDays = this.ghostOffsetHours / 24;
    // Find the ghost Earth's position relative to NOW Earth using the trajectory
    // For positions within our trajectory range, interpolate; otherwise compute fresh
    let ghostPos: THREE.Vector3;
    const pts = this.data.trajectory;
    let lower = pts[0], upper = pts[pts.length - 1];
    for (let i = 0; i < pts.length - 1; i++) {
      if (pts[i].dayOffset <= offsetDays && pts[i + 1].dayOffset >= offsetDays) {
        lower = pts[i];
        upper = pts[i + 1];
        break;
      }
    }
    const range = upper.dayOffset - lower.dayOffset;
    const t = range > 0 ? (offsetDays - lower.dayOffset) / range : 0;
    ghostPos = new THREE.Vector3(
      lower.pos[0] + t * (upper.pos[0] - lower.pos[0]),
      lower.pos[1] + t * (upper.pos[1] - lower.pos[1]),
      lower.pos[2] + t * (upper.pos[2] - lower.pos[2]),
    );
    ghostPos = eclToThree([ghostPos.x, ghostPos.y, ghostPos.z]).multiplyScalar(AU_TO_SCENE);

    // Position the ghost group + store for camera tracking
    this.ghostWorldPos.copy(ghostPos);
    this.ghostEarth.position.copy(ghostPos);
    this.ghostClouds.position.copy(ghostPos);
    this.ghostAtmo.position.copy(ghostPos);

    // Ghost Earth rotation (GMST at ghost time)
    const tiltAxis = eclToThree([1, 0, 0]).normalize();
    const tiltQuat = new THREE.Quaternion().setFromAxisAngle(tiltAxis, ghostData.obliquity);
    const spinQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0), ghostData.rotationAngle,
    );
    const ghostQ = tiltQuat.clone().multiply(spinQuat);
    this.ghostEarth.quaternion.copy(ghostQ);
    this.ghostClouds.quaternion.copy(ghostQ);
    this.ghostAtmo.quaternion.copy(tiltQuat);

    // Ghost axis line + pole sweep — positioned at ghost, tilted
    this.ghostAxisLine.position.copy(ghostPos);
    this.ghostAxisLine.quaternion.copy(tiltQuat);

    const sweepParentPos = ghostPos.clone();
    const axisLen = EARTH_R * 2.5;
    const axisUp = new THREE.Vector3(0, axisLen, 0).applyQuaternion(tiltQuat);
    this.ghostSweep.position.copy(sweepParentPos.clone().add(axisUp));
    this.ghostSweep.quaternion.copy(tiltQuat);

    // Ghost Sun direction
    const ghostSunDir = eclToThree(ghostData.sunDir).normalize();
    (this.ghostEarth.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(ghostSunDir);
    (this.ghostClouds.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(ghostSunDir);
    (this.ghostAtmo.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(ghostSunDir);

    // Ghost Sun — on the Sun's straight galactic line at this time offset
    const primarySunPos = eclToThree(this.data.sunDir).multiplyScalar(SUN_DIST);
    const galDir = eclToThree(this.data.solarGalacticDir).normalize();
    const driftPerDay = this.data.solarGalacticSpeedKmS * 86400 / 149597870.7 / 8 * AU_TO_SCENE;
    this.ghostSunWorldPos.copy(primarySunPos).add(
      galDir.clone().multiplyScalar(offsetDays * driftPerDay),
    );
    this.ghostSunSprite.position.copy(this.ghostSunWorldPos);
    this.ghostSunGlow.position.copy(this.ghostSunWorldPos);
    this.ghostSunLabel.position.copy(this.ghostSunWorldPos).add(new THREE.Vector3(0, 4, 0));

    // Ghost sun beam — from ghost Earth toward ghost Sun
    const beamArr = new Float32Array([
      ghostPos.x, ghostPos.y, ghostPos.z,
      this.ghostSunWorldPos.x, this.ghostSunWorldPos.y, this.ghostSunWorldPos.z,
    ]);
    this.ghostSunBeam.geometry.setAttribute('position', new THREE.BufferAttribute(beamArr, 3));

    // Ghost Moon — position relative to ghost Earth
    const ghostMoonPos = eclToThree(ghostData.moonDir).multiplyScalar(MOON_DIST);
    this.ghostMoon.position.copy(ghostPos).add(ghostMoonPos);
    (this.ghostMoon.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(ghostSunDir);

    // Ghost Sun distance label — along the ghost sun beam
    const ghostSunMid = ghostPos.clone().lerp(this.ghostSunWorldPos, 0.4);
    ghostSunMid.y += 1.5;
    this.ghostSunDistLabel.position.copy(ghostSunMid);
    const gSunKm = ghostData.sunDistAU * 149597870.7;
    const gLightSec = gSunKm / 299792.458;
    const gLightMin = Math.floor(gLightSec / 60);
    const gLightS = Math.round(gLightSec % 60);
    this.updateDistLabel(
      this.ghostSunDistLabel,
      `☉  ${(gSunKm / 1e6).toFixed(1)}M km  ·  ${gLightMin}m ${String(gLightS).padStart(2, '0')}s light`,
      'rgba(255, 230, 160, 0.6)',
    );

    // Ghost Moon distance + phase label
    const ghostMoonLabelPos = ghostPos.clone().add(ghostMoonPos);
    ghostMoonLabelPos.y += EARTH_R * 0.7;
    this.ghostMoonDistLabel.position.copy(ghostMoonLabelPos);
    const gSunV = new THREE.Vector3(...ghostData.sunDir);
    const gMoonV = new THREE.Vector3(...ghostData.moonDir);
    const gPhaseAngle = gSunV.angleTo(gMoonV);
    const gCross = new THREE.Vector3().crossVectors(gSunV, gMoonV);
    const gWaxing = gCross.z > 0;
    const gPhaseDeg = gPhaseAngle * 180 / Math.PI;
    const gPhaseName = gPhaseDeg > 175 ? 'New' : gPhaseDeg < 5 ? 'Full'
      : gWaxing
        ? (gPhaseDeg > 95 ? 'Wax. Crescent' : gPhaseDeg > 85 ? '1st Quarter' : 'Wax. Gibbous')
        : (gPhaseDeg < 85 ? 'Wan. Gibbous' : gPhaseDeg < 95 ? '3rd Quarter' : 'Wan. Crescent');
    this.updateDistLabel(
      this.ghostMoonDistLabel,
      `☽  ${Math.round(ghostData.moonDistKm).toLocaleString()} km  ·  ${gPhaseName}`,
      'rgba(220, 220, 215, 0.6)',
    );

    // Ghost label
    this.ghostLabel.position.copy(ghostPos).add(new THREE.Vector3(0, EARTH_R * 2.5 + 0.5, 0));
    this.updateGhostLabel(ghostDate);

    // Travel-distance labels along the trajectory lines
    const travel = this.computeTravelDistances(this.ghostOffsetHours);
    const primaryEarthPos = new THREE.Vector3(0, 0, 0);
    const primarySunPos2 = eclToThree(this.data.sunDir).multiplyScalar(SUN_DIST);

    // Earth travel label — midpoint of current→ghost Earth, offset slightly
    const earthMid = primaryEarthPos.clone().lerp(ghostPos, 0.5);
    const earthLineDir = ghostPos.clone().sub(primaryEarthPos).normalize();
    const earthPerp = new THREE.Vector3(-earthLineDir.z, 0, earthLineDir.x).normalize();
    earthMid.add(earthPerp.multiplyScalar(1.2));
    earthMid.y += 0.8;
    this.earthTravelLabel.position.copy(earthMid);
    this.earthTravelLabel.visible = true;
    // Scale based on distance to camera so it stays readable
    const earthCamDist = this.camera.position.distanceTo(earthMid);
    const earthScale = Math.max(4, Math.min(12, earthCamDist * 0.35));
    this.earthTravelLabel.scale.set(earthScale, earthScale * 0.13, 1);
    this.updateDistLabel(
      this.earthTravelLabel,
      `⊕ ${this.fmtTravelDist(travel.earthKm)} traveled`,
      'rgba(130, 180, 255, 0.75)',
    );

    // Sun travel label — midpoint of current→ghost Sun, offset slightly
    const sunMid = primarySunPos2.clone().lerp(this.ghostSunWorldPos, 0.5);
    sunMid.y += 2;
    this.sunTravelLabel.position.copy(sunMid);
    this.sunTravelLabel.visible = true;
    const sunCamDist = this.camera.position.distanceTo(sunMid);
    const sunScale = Math.max(5, Math.min(15, sunCamDist * 0.35));
    this.sunTravelLabel.scale.set(sunScale, sunScale * 0.13, 1);
    this.updateDistLabel(
      this.sunTravelLabel,
      `☉ ${this.fmtTravelDist(travel.sunKm)} traveled`,
      'rgba(255, 220, 130, 0.75)',
    );
  }

  private updateGhostLabel(date: Date): void {
    const text = date.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 24px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, 128, 32);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    (this.ghostLabel.material as THREE.SpriteMaterial).map?.dispose();
    (this.ghostLabel.material as THREE.SpriteMaterial).map = tex;
    (this.ghostLabel.material as THREE.SpriteMaterial).needsUpdate = true;
  }

  private buildTrajectoryMeshes(): void {
    // Remove old trajectories
    if (this.trajectoryMesh) { this.scene.remove(this.trajectoryMesh); this.trajectoryMesh.geometry.dispose(); }
    if (this.trajectoryForwardMesh) { this.scene.remove(this.trajectoryForwardMesh); this.trajectoryForwardMesh.geometry.dispose(); }
    if (this.trajectoryGlowPast) { this.scene.remove(this.trajectoryGlowPast); this.trajectoryGlowPast.geometry.dispose(); }
    if (this.trajectoryGlowFuture) { this.scene.remove(this.trajectoryGlowFuture); this.trajectoryGlowFuture.geometry.dispose(); }
    if (this.sunTrajectoryPast) { this.scene.remove(this.sunTrajectoryPast); this.sunTrajectoryPast.geometry.dispose(); }
    if (this.sunTrajectoryFuture) { this.scene.remove(this.sunTrajectoryFuture); this.sunTrajectoryFuture.geometry.dispose(); }

    const pts = this.data.trajectory;

    // Use the raw computed trajectory points directly — they ARE the true path.
    // Split at "now" for past/future coloring. Use simple line geometry, not tubes
    // with spline fitting, which was destroying the helical detail.
    const pastPts: THREE.Vector3[] = [];
    const futurePts: THREE.Vector3[] = [];

    for (const pt of pts) {
      const v = eclToThree(pt.pos).multiplyScalar(AU_TO_SCENE);
      if (pt.dayOffset <= 0.01) pastPts.push(v.clone());
      if (pt.dayOffset >= -0.01) futurePts.push(v);
    }

    if (pastPts.length >= 2) {
      const geo = new THREE.BufferGeometry().setFromPoints(pastPts);
      this.trajectoryMesh = new THREE.Mesh(); // placeholder — using Line instead
      this.trajectoryGlowPast = new THREE.Mesh();
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: 0x9c6dff, transparent: true, opacity: 0.4,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      this.scenePivot.add(line);
      this.trajectoryMesh = line as unknown as THREE.Mesh;
    }

    if (futurePts.length >= 2) {
      const geo = new THREE.BufferGeometry().setFromPoints(futurePts);
      this.trajectoryForwardMesh = new THREE.Mesh();
      this.trajectoryGlowFuture = new THREE.Mesh();
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: 0x00e5ff, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      this.scenePivot.add(line);
      this.trajectoryForwardMesh = line as unknown as THREE.Mesh;
    }

    // Sun trajectory — straight line through the primary Sun in galactic direction.
    // The Sun moves linearly through the galaxy; Earth corkscrews around it.
    const sunPos = eclToThree(this.data.sunDir).multiplyScalar(SUN_DIST);
    const galDir = eclToThree(this.data.solarGalacticDir).normalize();
    // Same compressed galactic drift rate used for Earth trajectory
    const daysRange = pts.length > 0 ? Math.abs(pts[pts.length - 1].dayOffset) : 365;
    const driftPerDay = this.data.solarGalacticSpeedKmS * 86400 / 149597870.7 / 8 * AU_TO_SCENE;

    const sunPastPts: THREE.Vector3[] = [];
    const sunFuturePts: THREE.Vector3[] = [];
    const sunSteps = 120;
    for (let i = -sunSteps; i <= sunSteps; i++) {
      const dayOff = (i / sunSteps) * daysRange;
      const drift = galDir.clone().multiplyScalar(dayOff * driftPerDay);
      const p = sunPos.clone().add(drift);
      if (dayOff <= 0.01) sunPastPts.push(p.clone());
      if (dayOff >= -0.01) sunFuturePts.push(p);
    }

    // Sun past trajectory — single warm golden line
    if (sunPastPts.length >= 2) {
      const curve = new THREE.CatmullRomCurve3(sunPastPts, false, 'centripetal');
      const geo = new THREE.TubeGeometry(curve, Math.min(sunPastPts.length * 2, 256), 0.04, 6, false);
      this.sunTrajectoryPast = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffa726, transparent: true, opacity: 0.15,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      this.scenePivot.add(this.sunTrajectoryPast);
    }

    // Sun future trajectory — single warm golden line
    if (sunFuturePts.length >= 2) {
      const curve = new THREE.CatmullRomCurve3(sunFuturePts, false, 'centripetal');
      const geo = new THREE.TubeGeometry(curve, Math.min(sunFuturePts.length * 2, 256), 0.05, 6, false);
      this.sunTrajectoryFuture = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffcc00, transparent: true, opacity: 0.2,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      this.scenePivot.add(this.sunTrajectoryFuture);
    }
  }

  private makeLabelSprite(text: string, color: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.font = '20px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 32);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    return new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false,
    }));
  }

  private makeDistLabel(): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 80;
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    return new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false, depthTest: false,
    }));
  }

  private updateDistLabel(sprite: THREE.Sprite, text: string, color = 'rgba(255,255,255,0.75)'): void {
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 80;
    const ctx = canvas.getContext('2d')!;
    ctx.font = '500 28px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,1)';
    ctx.shadowBlur = 16;
    ctx.fillStyle = color;
    ctx.fillText(text, 320, 40);
    ctx.shadowBlur = 8;
    ctx.fillText(text, 320, 40);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    const mat = sprite.material as THREE.SpriteMaterial;
    mat.map?.dispose();
    mat.map = tex;
    mat.needsUpdate = true;
  }

  private updateSpriteText(sprite: THREE.Sprite, text: string, color: string): void {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.font = '18px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 6;
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 32);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    const mat = sprite.material as THREE.SpriteMaterial;
    mat.map?.dispose();
    mat.map = tex;
    mat.needsUpdate = true;
  }

  // ── Animation loop ──

  private animate = (): void => {
    requestAnimationFrame(this.animate);

    if (this.needsDataUpdate) this.updateSceneData();

    this.ui.tickPlayback();

    // Earth spin animation
    const rotSpeed = (2 * Math.PI) / (23.9345 * 3600);
    const tiltAxis = eclToThree([1, 0, 0]).normalize();
    const tiltQuat = new THREE.Quaternion().setFromAxisAngle(tiltAxis, this.data.obliquity);
    const spinQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      this.data.rotationAngle + performance.now() * 0.001 * rotSpeed,
    );
    this.earth.quaternion.copy(tiltQuat).multiply(spinQuat);

    // Clouds spin with Earth but drift very slightly slower
    const cloudSpinQuat = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      this.data.rotationAngle + performance.now() * 0.001 * rotSpeed * 0.97,
    );
    this.clouds.quaternion.copy(tiltQuat).multiply(cloudSpinQuat);

    // Pole sweep chases around the north pole to show spin direction
    this.northSweep.rotation.y = performance.now() * 0.0018;

    // Ghost sweep spins too
    if (this.ghostGroup.visible) {
      this.ghostSweep.rotation.y = performance.now() * 0.0018;
    }

    // Update location marker position every frame (rotates with Earth)
    this.updateLocationMarker();

    if (this.followGhost && this.ghostGroup.visible) {
      // Move orbit center + camera with the ghost Earth so user rides along
      const delta = this.ghostWorldPos.clone().sub(this.controls.target);
      this.controls.target.copy(this.ghostWorldPos);
      this.camera.position.add(delta);
    } else if (!this.followGhost) {
      this.controls.target.lerp(new THREE.Vector3(0, 0, 0), 0.06);
    }

    // Smoothly interpolate scene pivot toward target "up" frame
    this.upQuatCurrent.slerp(this.upQuatTarget, 0.06);
    this.scenePivot.quaternion.copy(this.upQuatCurrent);

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}
