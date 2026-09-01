/**
 * Cosmic Motion — 3D orrery view.
 *
 * Heliocentric scene: Sun at origin, all bodies at absolute heliocentric
 * ecliptic positions scaled by AU_SCENE. See PRINCIPLES.md.
 *
 * Coordinate mapping: ecliptic X→Three X, ecliptic Y→-Three Z, ecliptic Z→Three Y
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { computeSceneData, computePlanetTrajectories, type SceneData, type PlanetTrajectory } from './engine/observer';
import { moonPosition } from './engine/lunar';
import { raDecToCartesian, equatorialToEcliptic, obliquity } from './engine/coordinates';
import { dateToJD } from './engine/time';
import { BRIGHT_STARS, bvToRGB } from './engine/stars';
import { LocationService } from './sensors/location';
import { createUI, type UpFrame } from './ui/controls';
import { PLANETS, computePlanetPositions, computeOrbitPath, poleToEclipticAxis } from './engine/planets';

const EARTH_R = 0.5;
const AU_SCENE = 50;
const MOON_DIST = 2.5;

// Galactic drift visualization: real drift is ~46 AU/yr (pitch:radius = 46:1).
// Compress 8× so the spiral is visible (pitch:radius ≈ 5.75:1).
const GALACTIC_VIS_COMPRESSION = 8;

// ── Perspective-faithful scaling ──
// True proportional radii: sceneR = radiusKm / AU_KM * AU_SCENE
// Bodies render at their real angular size from the camera's position,
// with a pixel-floor so distant bodies remain visible.
const AU_KM_VAL = 149597870.7;
const SUN_RADIUS_KM = 696000;
const MOON_RADIUS_KM = 1737.4;
const SUN_TRUE_R = SUN_RADIUS_KM / AU_KM_VAL * AU_SCENE;   // ~0.2326
const MOON_TRUE_R = MOON_RADIUS_KM / AU_KM_VAL * AU_SCENE;  // ~0.000581
const SUN_MESH_R = 4;
const MOON_MESH_R = EARTH_R * 0.27;
const MIN_BODY_PX = 3;

function eclToThree(v: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(v[0], v[2], -v[1]);
}

const NOISE_GLSL = `
  float hash3(vec3 p) {
    p = fract(p * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }
  float noise3d(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f*f*(3.0-2.0*f);
    return mix(
      mix(mix(hash3(i), hash3(i+vec3(1,0,0)), f.x),
          mix(hash3(i+vec3(0,1,0)), hash3(i+vec3(1,1,0)), f.x), f.y),
      mix(mix(hash3(i+vec3(0,0,1)), hash3(i+vec3(1,0,1)), f.x),
          mix(hash3(i+vec3(0,1,1)), hash3(i+vec3(1,1,1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 6; i++) {
      v += a * noise3d(p);
      p = p * 2.03 + vec3(1.7, 9.2, 3.4);
      a *= 0.49;
    }
    return v;
  }
`;

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
  private locVisible = false;
  private _locLastUpdate = 0;
  private trajectoryGlowPast!: THREE.Mesh;
  private trajectoryGlowFuture!: THREE.Mesh;
  private sunTrajectoryPast!: THREE.Mesh;
  private sunTrajectoryFuture!: THREE.Mesh;
  private planetTrajectoryLines: THREE.Line[] = [];

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

  private earthGroup!: THREE.Group;

  private sunMesh!: THREE.Mesh;
  private sunCorona!: THREE.Mesh;
  private sunTime = 0;
  private planetMeshes = new Map<string, THREE.Mesh>();
  private planetGlows = new Map<string, THREE.Sprite>();
  private planetOrbitLines = new Map<string, THREE.Line>();
  private planetAxisLines = new Map<string, THREE.Line>();
  private planetGroups = new Map<string, THREE.Group>();
  private planetSweeps = new Map<string, THREE.Group>();
  private planetOrbitsGroup!: THREE.Group;
  private hoveredBody: string | null = null;
  private showOrbits = true;
  private showTrajectories = true;
  private showAllBeams = false;
  private showTerminators = false;
  private earthTerminator!: THREE.LineLoop;
  private moonTerminator!: THREE.LineLoop;
  private planetTerminators = new Map<string, THREE.LineLoop>();

  private planetBeams = new Map<string, THREE.Line>();
  private planetDistLabels = new Map<string, THREE.Sprite>();
  private planetGhostBeams = new Map<string, THREE.Line>();
  private planetGhostDistLabels = new Map<string, THREE.Sprite>();
  private planetTravelLabels = new Map<string, THREE.Sprite>();
  private storedPlanetTrajectories: PlanetTrajectory[] = [];

  private isNavigating = false;
  private navStartCamPos = new THREE.Vector3();
  private navEndCamPos = new THREE.Vector3();
  private navStartTarget = new THREE.Vector3();
  private navEndTarget = new THREE.Vector3();
  private navTime = 0;
  private navDuration = 2.0;
  private currentBody = 'Earth';
  private navTargetBody = 'Earth';
  private navBodySwitched = false;
  private navFovBase = 55;
  private navChargeEnd = new THREE.Vector3();
  private navFinalCamPos = new THREE.Vector3();
  private navLockOnSpin = 0;
  private navP1 = 0;
  private navP2 = 0;
  private navP3 = 0;
  private navTripDistKm = 0;
  private navTripSpeedC = 0;
  private navTripEta = '';
  private navTripCardTimer = 0;
  private tripCard!: HTMLElement;
  private lockOnReticle!: SVGSVGElement;
  private hudOverlay!: HTMLElement;
  private hudCard!: HTMLElement;
  private hudReticle!: SVGSVGElement;
  private hudLine!: SVGSVGElement;
  private hudVisible = true;
  private hudOpacity = 0;
  private hudTargetOpacity = 1;
  private hudLastBody = '';
  private moonHudCard!: HTMLElement;
  private moonHudReticle!: SVGSVGElement;
  private moonHudLine!: SVGSVGElement;
  private moonHudVisible = true;
  private moonHudOpacity = 0;
  private moonAxisLine!: THREE.Line;
  private moonSweep!: THREE.Group;
  private previousBody = 'Earth';
  private _earthScale = 1;
  private _delta = 0;
  private posIndicator!: HTMLElement;
  private posXEl!: HTMLElement;
  private posYEl!: HTMLElement;
  private posZEl!: HTMLElement;
  private posNearestEl!: HTMLElement;
  private posSunDistEl!: HTMLElement;
  private posSunLightEl!: HTMLElement;
  private posFacingEl!: HTMLElement;
  private posHdgEl!: HTMLElement;
  private posPitEl!: HTMLElement;
  private posFrameCounter = 0;
  private snapOverlay!: HTMLElement;
  private snapBtnEl!: HTMLButtonElement;
  private activeSnapKey = '';
  private lastPosFingerprint = '';

  // Flight — always-on 6DOF; "locked" orbits a body, any thrust breaks free
  private flightLocked = true;
  private flightKeys: Record<string, boolean> = {};
  private flightSpeed = 1.0;
  private flightSpeedLevel = 5;
  private flightVelocity = new THREE.Vector3();
  private flightQuat = new THREE.Quaternion();
  private flightMouseDown = false;
  private flightMousePrevX = 0;
  private flightMousePrevY = 0;
  private flightNewton = false;
  private flightHintEl!: HTMLElement;
  private flightSpeedEl!: HTMLElement;
  private flightNewtonEl!: HTMLElement;
  private flightHintTimer: ReturnType<typeof setTimeout> | null = null;

  async init(container: HTMLElement): Promise<void> {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.setClearColor(0x020308);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      55, container.clientWidth / container.clientHeight, 0.1, 500000,
    );

    this.scene = new THREE.Scene();
    this.scenePivot = new THREE.Group();
    this.scene.add(this.scenePivot);

    this.scenePivot.add(new THREE.AmbientLight(0x1a1a2e, 0.15));
    this.scenePivot.add(new THREE.HemisphereLight(0x2244aa, 0x111122, 0.1));

    this.earthGroup = new THREE.Group();
    this.scenePivot.add(this.earthGroup);

    this.buildStarfield();
    this.buildEarth();
    this.buildSun();
    this.buildMoon();
    this.buildAxisLine();
    this.buildPoleSweeps();
    this.buildArrow();
    this.buildOrbitalRing();
    this.buildPlanets();
    this.buildLocationMarker();
    this.buildTerminators();

    this.buildGhost();
    this.buildPlanetBeams();
    this.buildHUD(container);

    // Moon click to toggle its HUD
    this.renderer.domElement.addEventListener('click', (e) => {
      if (this.currentBody !== 'Earth') return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, this.camera);
      const hits = raycaster.intersectObject(this.moonMesh, false);
      if (hits.length > 0) {
        this.moonHudVisible = !this.moonHudVisible;
      }
    });

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
    this.moonDistLabel.visible = false;
    this.earthGroup.add(this.moonDistLabel);

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
      onNavigate: (bodyName: string) => {
        this.navigateToBody(bodyName);
      },
      onHoverBody: (bodyName: string | null) => {
        this.setHoveredBody(bodyName);
      },
      onToggleOrbits: () => {
        this.showOrbits = !this.showOrbits;
      },
      onToggleTrajectories: () => {
        this.showTrajectories = !this.showTrajectories;
      },
      onToggleAllBeams: () => {
        this.showAllBeams = !this.showAllBeams;
      },
      onToggleTerminators: () => {
        this.showTerminators = !this.showTerminators;
      },
      onToggleFlightMode: () => {
        this.showFlightHint(6000);
      },
      onFlightHover: (hovering: boolean) => {
        if (hovering) {
          if (this.flightHintTimer) clearTimeout(this.flightHintTimer);
          this.flightHintTimer = null;
          this.flightHintEl.style.display = '';
          this.flightHintEl.classList.remove('cm-flight-hint-fade');
          void this.flightHintEl.offsetWidth;
        } else {
          this.flightHintEl.classList.add('cm-flight-hint-fade');
        }
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
    this.controls.maxDistance = 100000;
    this.controls.enablePan = false;
    this.controls.target.set(0, 0, 0);

    this.initFlightControls();

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
    const R = 90000;
    const eps = 23.4393 * Math.PI / 180; // J2000 obliquity for coordinate conversion
    const cosE = Math.cos(eps), sinE = Math.sin(eps);

    // Real bright stars from Hipparcos catalog
    const realCount = BRIGHT_STARS.length;
    // Background stars to fill the sky — mix of bright and dim
    const bgCount = 40000;
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
      const r = R * (0.95 + Math.random() * 0.05);
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
          gl_PointSize = size * (25000.0 / -mvPos.z);
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
    this.starfield.frustumCulled = false;
    this.scene.add(this.starfield);
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
    this.earthGroup.add(this.earth);

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
    this.earthGroup.add(this.clouds);

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
    this.earthGroup.add(this.atmosphere);
  }

  private buildSun(): void {
    this.sunLight = new THREE.PointLight(0xfff4e0, 3, 500, 0.3);
    this.scenePivot.add(this.sunLight);

    const SUN_R = 4;

    // ── Photosphere — procedural noise surface with limb darkening ──
    const sunGeo = new THREE.SphereGeometry(SUN_R, 64, 64);

    const sunMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vPosition;
        void main() {
          vPosition = position;
          vNormal = normalize(normalMatrix * normal);
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vViewDir = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vPosition;
        ${NOISE_GLSL}
        void main() {
          float NdotV = max(0.0, dot(vNormal, vViewDir));
          float limb = pow(NdotV, 0.42);

          vec3 p = vPosition * 3.5;
          float slow = uTime * 0.012;
          float n1 = fbm(p + slow);
          float n2 = fbm(p * 2.1 - slow * 0.7);
          float n3 = fbm(p * 0.7 + slow * 0.5);

          float surface = n1 * 0.45 + n2 * 0.3 + n3 * 0.25;
          float cells = smoothstep(0.35, 0.65, surface);
          float spots = smoothstep(0.22, 0.38, n3 + n1 * 0.2);

          vec3 white  = vec3(1.0, 0.98, 0.93);
          vec3 yellow = vec3(1.0, 0.88, 0.45);
          vec3 orange = vec3(1.0, 0.62, 0.18);
          vec3 dark   = vec3(0.85, 0.38, 0.08);

          vec3 color = mix(yellow, white, NdotV * 0.7 + cells * 0.3);
          color = mix(dark, color, spots);
          color = mix(orange, color, limb);

          float brightness = (0.4 + 0.6 * limb) * (0.7 + 0.3 * cells);
          color *= brightness;
          color += white * pow(NdotV, 3.0) * 0.25;
          color += orange * (1.0 - limb) * 0.15;

          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    this.sunMesh = new THREE.Mesh(sunGeo, sunMat);
    this.scenePivot.add(this.sunMesh);

    // ── Corona — fresnel rim with noise variation ──
    const coronaGeo = new THREE.SphereGeometry(SUN_R * 1.5, 64, 64);
    const coronaMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uGlowBoost: { value: 1.0 } },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vPosition;
        void main() {
          vPosition = position;
          vNormal = normalize(normalMatrix * normal);
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vViewDir = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uGlowBoost;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        varying vec3 vPosition;
        ${NOISE_GLSL}
        void main() {
          float NdotV = max(0.0, dot(vNormal, vViewDir));
          float fresnel = pow(1.0 - NdotV, 2.0);
          float n = fbm(vPosition * 1.5 + uTime * 0.008);

          vec3 inner = vec3(1.0, 0.92, 0.6);
          vec3 outer = vec3(1.0, 0.65, 0.2);
          vec3 color = mix(inner, outer, fresnel);

          float alpha = fresnel * (0.35 + 0.15 * n) * smoothstep(0.0, 0.15, NdotV) * uGlowBoost;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    this.sunCorona = new THREE.Mesh(coronaGeo, coronaMat);
    this.scenePivot.add(this.sunCorona);

    // ── Inner glow sprite ──
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,250,235,0.85)');
    g.addColorStop(0.12, 'rgba(255,230,160,0.55)');
    g.addColorStop(0.35, 'rgba(255,180,60,0.18)');
    g.addColorStop(0.65, 'rgba(255,140,20,0.04)');
    g.addColorStop(1, 'rgba(255,100,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(c), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.sunSprite.scale.set(22, 22, 1);
    this.scenePivot.add(this.sunSprite);

    // ── Outer glow sprite ──
    const gc = document.createElement('canvas');
    gc.width = 512; gc.height = 512;
    const gctx = gc.getContext('2d')!;
    const gg = gctx.createRadialGradient(256, 256, 0, 256, 256, 256);
    gg.addColorStop(0, 'rgba(255,240,180,0.12)');
    gg.addColorStop(0.12, 'rgba(255,210,100,0.06)');
    gg.addColorStop(0.35, 'rgba(255,160,40,0.02)');
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    gctx.fillStyle = gg;
    gctx.fillRect(0, 0, 512, 512);
    this.sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(gc), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.sunGlow.scale.set(60, 60, 1);
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
    this.earthGroup.add(this.moonMesh);

    // Moon axis tilt line — IAU pole: RA=269.9949°, Dec=66.5392°
    const moonPoleEcl = poleToEclipticAxis(269.9949, 66.5392);
    const moonPoleDir = eclToThree(moonPoleEcl).normalize();
    const moonR = EARTH_R * 0.27;
    const moonAxisLen = moonR * 2.5;
    const moonAxisGeo = new THREE.BufferGeometry().setFromPoints([
      moonPoleDir.clone().multiplyScalar(-moonAxisLen),
      moonPoleDir.clone().multiplyScalar(moonAxisLen),
    ]);
    const moonAxisMat = new THREE.LineDashedMaterial({
      color: 0x999999, transparent: true, opacity: 0.3,
      dashSize: moonR * 0.25, gapSize: moonR * 0.12,
    });
    this.moonAxisLine = new THREE.Line(moonAxisGeo, moonAxisMat);
    this.moonAxisLine.computeLineDistances();
    this.earthGroup.add(this.moonAxisLine);

    // Moon rotation sweep
    this.moonSweep = this.createPlanetSweep(moonR * 0.7, '#999999', false);
    this.moonSweep.position.copy(moonPoleDir.clone().multiplyScalar(moonAxisLen));
    const moonTiltQuat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), moonPoleDir,
    );
    this.moonSweep.quaternion.copy(moonTiltQuat);
    this.moonMesh.quaternion.copy(moonTiltQuat);
    this.earthGroup.add(this.moonSweep);

    // Moon orbital path — computed from actual lunar ephemeris over one sidereal month
    this.moonOrbitLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0x999999, transparent: true, opacity: 0.1, depthWrite: false,
      }),
    );
    this.earthGroup.add(this.moonOrbitLine);
  }

  private buildPlanets(): void {
    this.planetOrbitsGroup = new THREE.Group();
    this.scenePivot.add(this.planetOrbitsGroup);

    for (const planet of PLANETS) {
      const orbitPath = computeOrbitPath(planet, 360, new Date());
      const orbitPts = orbitPath.map(p => eclToThree(p));
      const orbitGeo = new THREE.BufferGeometry().setFromPoints(orbitPts);
      const orbitLine = new THREE.Line(orbitGeo, new THREE.LineBasicMaterial({
        color: new THREE.Color(planet.color),
        transparent: true,
        opacity: 0.12,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }));
      orbitLine.frustumCulled = false;
      this.planetOrbitsGroup.add(orbitLine);
      this.planetOrbitLines.set(planet.name, orbitLine);

      if (planet.name === 'Earth') continue;

      const group = new THREE.Group();
      this.scenePivot.add(group);
      this.planetGroups.set(planet.name, group);

      const geo = new THREE.SphereGeometry(planet.sceneRadius, 48, 48);

      let mat: THREE.ShaderMaterial;
      if (planet.name === 'Mercury') {
        mat = new THREE.ShaderMaterial({
          uniforms: { sunDirection: { value: new THREE.Vector3(1, 0, 0) } },
          vertexShader: `
            varying vec3 vWorldNormal;
            varying vec3 vPosition;
            void main() {
              vPosition = position;
              vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform vec3 sunDirection;
            varying vec3 vWorldNormal;
            varying vec3 vPosition;
            ${NOISE_GLSL}
            void main() {
              vec3 p = vPosition * 3.0;
              float n = fbm(p);
              float craters = fbm(p * 5.0 + vec3(7.0));
              craters = smoothstep(0.45, 0.55, craters) * 0.15;
              vec3 color = mix(vec3(0.35, 0.32, 0.30), vec3(0.65, 0.62, 0.58), n);
              color -= craters;
              float NdotL = dot(vWorldNormal, normalize(sunDirection));
              float lit = 0.02 + 0.98 * smoothstep(-0.02, 0.02, NdotL);
              gl_FragColor = vec4(color * lit, 1.0);
            }
          `,
        });
      } else if (planet.name === 'Venus') {
        mat = new THREE.ShaderMaterial({
          uniforms: { sunDirection: { value: new THREE.Vector3(1, 0, 0) } },
          vertexShader: `
            varying vec3 vWorldNormal;
            varying vec3 vViewDir;
            varying vec3 vPosition;
            void main() {
              vPosition = position;
              vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
              vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
              vViewDir = normalize(-mvPos.xyz);
              gl_Position = projectionMatrix * mvPos;
            }
          `,
          fragmentShader: `
            uniform vec3 sunDirection;
            varying vec3 vWorldNormal;
            varying vec3 vViewDir;
            varying vec3 vPosition;
            ${NOISE_GLSL}
            void main() {
              vec3 p = vPosition * 2.0;
              float lat = asin(clamp(normalize(vPosition).y, -1.0, 1.0));
              float bands = sin(lat * 8.0) * 0.05;
              float n = fbm(p + vec3(0.0, bands, 0.0));
              vec3 color = mix(vec3(0.85, 0.75, 0.50), vec3(0.95, 0.90, 0.70), n);
              float NdotL = dot(vWorldNormal, normalize(sunDirection));
              float lit = 0.08 + 0.92 * smoothstep(-0.3, 0.3, NdotL);
              float fresnel = pow(1.0 - max(0.0, dot(vViewDir, vWorldNormal)), 2.5);
              color += vec3(0.95, 0.85, 0.55) * fresnel * 0.15;
              gl_FragColor = vec4(color * lit, 1.0);
            }
          `,
        });
      } else if (planet.name === 'Mars') {
        mat = new THREE.ShaderMaterial({
          uniforms: { sunDirection: { value: new THREE.Vector3(1, 0, 0) } },
          vertexShader: `
            varying vec3 vWorldNormal;
            varying vec3 vPosition;
            void main() {
              vPosition = position;
              vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform vec3 sunDirection;
            varying vec3 vWorldNormal;
            varying vec3 vPosition;
            ${NOISE_GLSL}
            void main() {
              vec3 p = vPosition * 3.0;
              float n = fbm(p);
              float mare = fbm(p * 2.0 + vec3(3.0, 1.0, 5.0));
              mare = smoothstep(0.4, 0.6, mare) * 0.12;
              vec3 color = mix(vec3(0.72, 0.35, 0.18), vec3(0.88, 0.58, 0.35), n);
              color -= mare;
              float lat = asin(clamp(normalize(vPosition).y, -1.0, 1.0));
              float polar = smoothstep(0.82, 0.95, abs(lat));
              color = mix(color, vec3(0.92, 0.93, 0.95), polar);
              float NdotL = dot(vWorldNormal, normalize(sunDirection));
              float lit = 0.04 + 0.96 * smoothstep(-0.1, 0.15, NdotL);
              gl_FragColor = vec4(color * lit, 1.0);
            }
          `,
        });
      } else if (planet.name === 'Jupiter') {
        mat = new THREE.ShaderMaterial({
          uniforms: { sunDirection: { value: new THREE.Vector3(1, 0, 0) } },
          vertexShader: `
            varying vec3 vWorldNormal;
            varying vec3 vViewDir;
            varying vec3 vPosition;
            void main() {
              vPosition = position;
              vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
              vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
              vViewDir = normalize(-mvPos.xyz);
              gl_Position = projectionMatrix * mvPos;
            }
          `,
          fragmentShader: `
            uniform vec3 sunDirection;
            varying vec3 vWorldNormal;
            varying vec3 vViewDir;
            varying vec3 vPosition;
            ${NOISE_GLSL}
            void main() {
              vec3 p = vPosition * 2.0;
              float lat = asin(clamp(normalize(vPosition).y, -1.0, 1.0));
              float bandBase = sin(lat * 14.0 + fbm(p * 3.0) * 0.6) * 0.5 + 0.5;
              float turb = fbm(p * 4.0) * 0.15;
              float band = clamp(bandBase + turb, 0.0, 1.0);
              vec3 color = mix(vec3(0.78, 0.54, 0.30), vec3(0.93, 0.87, 0.73), band);
              float NdotL = dot(vWorldNormal, normalize(sunDirection));
              float lit = 0.06 + 0.94 * max(0.0, NdotL);
              float fresnel = pow(1.0 - max(0.0, dot(vViewDir, vWorldNormal)), 2.5);
              color += vec3(0.90, 0.82, 0.65) * fresnel * 0.15;
              gl_FragColor = vec4(color * lit, 1.0);
            }
          `,
        });
      } else if (planet.name === 'Saturn') {
        mat = new THREE.ShaderMaterial({
          uniforms: { sunDirection: { value: new THREE.Vector3(1, 0, 0) } },
          vertexShader: `
            varying vec3 vWorldNormal;
            varying vec3 vViewDir;
            varying vec3 vPosition;
            void main() {
              vPosition = position;
              vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
              vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
              vViewDir = normalize(-mvPos.xyz);
              gl_Position = projectionMatrix * mvPos;
            }
          `,
          fragmentShader: `
            uniform vec3 sunDirection;
            varying vec3 vWorldNormal;
            varying vec3 vViewDir;
            varying vec3 vPosition;
            ${NOISE_GLSL}
            void main() {
              vec3 p = vPosition * 2.0;
              float lat = asin(clamp(normalize(vPosition).y, -1.0, 1.0));
              float bandBase = sin(lat * 10.0 + fbm(p * 2.0) * 0.3) * 0.5 + 0.5;
              float turb = fbm(p * 3.0) * 0.08;
              float band = clamp(bandBase + turb, 0.0, 1.0);
              vec3 color = mix(vec3(0.84, 0.74, 0.52), vec3(0.94, 0.89, 0.70), band);
              float NdotL = dot(vWorldNormal, normalize(sunDirection));
              float lit = 0.06 + 0.94 * max(0.0, NdotL);
              float fresnel = pow(1.0 - max(0.0, dot(vViewDir, vWorldNormal)), 2.5);
              color += vec3(0.92, 0.86, 0.65) * fresnel * 0.15;
              gl_FragColor = vec4(color * lit, 1.0);
            }
          `,
        });
      } else if (planet.name === 'Uranus') {
        mat = new THREE.ShaderMaterial({
          uniforms: { sunDirection: { value: new THREE.Vector3(1, 0, 0) } },
          vertexShader: `
            varying vec3 vWorldNormal;
            varying vec3 vViewDir;
            varying vec3 vPosition;
            void main() {
              vPosition = position;
              vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
              vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
              vViewDir = normalize(-mvPos.xyz);
              gl_Position = projectionMatrix * mvPos;
            }
          `,
          fragmentShader: `
            uniform vec3 sunDirection;
            varying vec3 vWorldNormal;
            varying vec3 vViewDir;
            varying vec3 vPosition;
            ${NOISE_GLSL}
            void main() {
              vec3 p = vPosition * 2.5;
              float n = fbm(p) * 0.15;
              float lat = asin(clamp(normalize(vPosition).y, -1.0, 1.0));
              float polarDark = smoothstep(0.6, 1.0, abs(lat)) * 0.05;
              vec3 color = mix(vec3(0.55, 0.78, 0.82), vec3(0.62, 0.84, 0.88), n);
              color -= polarDark;
              float NdotL = dot(vWorldNormal, normalize(sunDirection));
              float lit = 0.06 + 0.94 * max(0.0, NdotL);
              float fresnel = pow(1.0 - max(0.0, dot(vViewDir, vWorldNormal)), 2.5);
              color += vec3(0.50, 0.78, 0.85) * fresnel * 0.15;
              gl_FragColor = vec4(color * lit, 1.0);
            }
          `,
        });
      } else if (planet.name === 'Neptune') {
        mat = new THREE.ShaderMaterial({
          uniforms: { sunDirection: { value: new THREE.Vector3(1, 0, 0) } },
          vertexShader: `
            varying vec3 vWorldNormal;
            varying vec3 vViewDir;
            varying vec3 vPosition;
            void main() {
              vPosition = position;
              vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
              vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
              vViewDir = normalize(-mvPos.xyz);
              gl_Position = projectionMatrix * mvPos;
            }
          `,
          fragmentShader: `
            uniform vec3 sunDirection;
            varying vec3 vWorldNormal;
            varying vec3 vViewDir;
            varying vec3 vPosition;
            ${NOISE_GLSL}
            void main() {
              vec3 p = vPosition * 2.5;
              float lat = asin(clamp(normalize(vPosition).y, -1.0, 1.0));
              float bandBase = sin(lat * 8.0 + fbm(p * 2.0) * 0.3) * 0.5 + 0.5;
              float n = fbm(p) * 0.1;
              float band = clamp(bandBase * 0.15 + n, 0.0, 1.0);
              vec3 color = mix(vec3(0.20, 0.30, 0.62), vec3(0.35, 0.48, 0.78), band);
              float NdotL = dot(vWorldNormal, normalize(sunDirection));
              float lit = 0.06 + 0.94 * max(0.0, NdotL);
              float fresnel = pow(1.0 - max(0.0, dot(vViewDir, vWorldNormal)), 2.5);
              color += vec3(0.30, 0.35, 0.75) * fresnel * 0.15;
              gl_FragColor = vec4(color * lit, 1.0);
            }
          `,
        });
      } else {
        mat = new THREE.ShaderMaterial({
          uniforms: {
            sunDirection: { value: new THREE.Vector3(1, 0, 0) },
            baseColor: { value: new THREE.Color(planet.color) },
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
            uniform vec3 baseColor;
            varying vec3 vWorldNormal;
            void main() {
              float NdotL = dot(vWorldNormal, normalize(sunDirection));
              float lit = 0.04 + 0.96 * max(0.0, NdotL);
              gl_FragColor = vec4(baseColor * lit, 1.0);
            }
          `,
        });
      }
      const mesh = new THREE.Mesh(geo, mat);
      group.add(mesh);
      this.planetMeshes.set(planet.name, mesh);

      // Axis tilt line from IAU pole direction
      const poleEcl = poleToEclipticAxis(planet.poleRA, planet.poleDec);
      const poleDir = eclToThree(poleEcl).normalize();
      const axisLen = planet.sceneRadius * 2.5;
      const axisGeo = new THREE.BufferGeometry().setFromPoints([
        poleDir.clone().multiplyScalar(-axisLen),
        poleDir.clone().multiplyScalar(axisLen),
      ]);
      const axisMat = new THREE.LineDashedMaterial({
        color: new THREE.Color(planet.color),
        transparent: true, opacity: 0.3,
        dashSize: planet.sceneRadius * 0.25,
        gapSize: planet.sceneRadius * 0.12,
      });
      const axisLine = new THREE.Line(axisGeo, axisMat);
      axisLine.computeLineDistances();
      group.add(axisLine);
      this.planetAxisLines.set(planet.name, axisLine);

      // Apply axial tilt to the mesh via the pole direction
      const defaultUp = new THREE.Vector3(0, 1, 0);
      const tiltQuat = new THREE.Quaternion().setFromUnitVectors(defaultUp, poleDir);
      mesh.quaternion.copy(tiltQuat);

      // Rotation sweep arc at the north pole
      const sweepRadius = planet.sceneRadius * 0.7;
      const sweepArc = this.createPlanetSweep(sweepRadius, planet.color, planet.siderealRotationHours < 0);
      sweepArc.position.copy(poleDir.clone().multiplyScalar(axisLen));
      sweepArc.quaternion.copy(tiltQuat);
      group.add(sweepArc);
      this.planetSweeps.set(planet.name, sweepArc);

      if (planet.name === 'Saturn') {
        const innerR = planet.sceneRadius * 1.2;
        const outerR = planet.sceneRadius * 2.3;
        const ringGeo = new THREE.RingGeometry(innerR, outerR, 128, 1);
        const pos = ringGeo.attributes.position;
        const uv = ringGeo.attributes.uv;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const y = pos.getY(i);
          const dist = Math.sqrt(x * x + y * y);
          const t = (dist - innerR) / (outerR - innerR);
          uv.setXY(i, uv.getX(i), t);
        }

        const ringMat = new THREE.ShaderMaterial({
          uniforms: {
            sunDirection: { value: new THREE.Vector3(1, 0, 0) },
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
            varying vec2 vUv;
            varying vec3 vWorldNormal;
            varying vec3 vWorldPos;
            void main() {
              float r = vUv.y;
              float ringR = mix(1.2, 2.3, r);

              float cRing = smoothstep(1.2, 1.28, ringR) * (1.0 - smoothstep(1.50, 1.53, ringR)) * 0.35;
              float bRing = smoothstep(1.53, 1.56, ringR) * (1.0 - smoothstep(1.93, 1.95, ringR)) * 1.0;
              float aRing = smoothstep(2.03, 2.06, ringR) * (1.0 - smoothstep(2.24, 2.27, ringR)) * 0.7;

              float cassiniGap = 1.0 - smoothstep(1.93, 1.95, ringR) * (1.0 - smoothstep(2.01, 2.03, ringR));
              float enckeGap = 1.0 - smoothstep(2.20, 2.21, ringR) * (1.0 - smoothstep(2.22, 2.23, ringR)) * 0.8;

              float brightness = (cRing + bRing + aRing) * cassiniGap * enckeGap;
              float alpha = brightness;

              if (alpha < 0.01) discard;

              vec3 ringColor = mix(vec3(0.78, 0.72, 0.58), vec3(0.88, 0.84, 0.72), r);

              float NdotL = dot(normalize(vWorldNormal), normalize(sunDirection));
              float lit = 0.2 + 0.8 * abs(NdotL);

              gl_FragColor = vec4(ringColor * lit * brightness, alpha * 0.9);
            }
          `,
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
        });

        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.quaternion.copy(tiltQuat);
        group.add(ringMesh);
        this.planetMeshes.set('SaturnRings', ringMesh);
      }
    }
  }

  navigateToBody(bodyName: string): void {
    if (bodyName === this.currentBody && !this.isNavigating) return;
    if (this.isNavigating && bodyName === this.navTargetBody) return;

    if (bodyName !== 'Moon') this.ui.exitDrillDown();

    // If mid-flight, snap currentBody to wherever we were headed
    if (this.isNavigating && !this.navBodySwitched) {
      this.currentBody = this.navTargetBody;
    }

    this.flightLocked = true;
    this.flightMouseDown = false;
    this.flightKeys = {};
    this.controls.enabled = true;

    this.previousBody = this.currentBody;
    this.navTargetBody = bodyName;
    this.navBodySwitched = false;
    this.navFovBase = this.camera.fov;
    this.navLockOnSpin = 0;

    const targetPos = this.getBodyScenePos(bodyName);
    const sunPos = this.sunMesh.position.clone();

    const toSun = sunPos.clone().sub(targetPos);
    const distToSun = toSun.length();
    const sunDir = distToSun > 0.01 ? toSun.clone().normalize() : new THREE.Vector3(1, 0, 0);

    const trueR = this.bodyTrueRadius(bodyName);

    const viewDist = bodyName === 'Sun'
      ? Math.max(trueR * 8, trueR * 5)
      : bodyName === 'Moon'
        ? MOON_DIST * 1.5
        : Math.max(trueR * 8, Math.min(distToSun * 0.15, trueR * 30));

    const up = new THREE.Vector3(0, 1, 0);

    // Charge end: arrive on a direct line from camera to target, at viewDist
    const chargeDir = targetPos.clone().sub(this.camera.position).normalize();
    this.navChargeEnd.copy(targetPos).add(chargeDir.clone().negate().multiplyScalar(viewDist));

    // Sun-oriented final position: anti-Sun side with slight elevation
    const litSideDir = sunDir.clone().negate();
    if (bodyName === 'Sun') {
      this.navFinalCamPos.copy(this.navChargeEnd);
    } else {
      this.navFinalCamPos.copy(targetPos)
        .add(litSideDir.clone().multiplyScalar(viewDist))
        .add(up.clone().multiplyScalar(viewDist * 0.25));
    }

    this.navEndTarget.copy(targetPos);
    this.navStartCamPos.copy(this.camera.position);
    this.navStartTarget.copy(this.controls.target);
    this.navEndCamPos.copy(this.navFinalCamPos);

    this.isNavigating = true;
    this.navTime = 0;

    // Adaptive duration: scales with distance so nearby hops feel quick
    // and cross-system journeys feel like real voyages
    const travelDist = this.camera.position.distanceTo(targetPos);
    const travelAU = travelDist / AU_SCENE;
    const AIM_SEC = 1.5;
    const LOCK_SEC = 0.6;
    const ORIENT_SEC = 2.0;
    const fixedSec = AIM_SEC + LOCK_SEC + ORIENT_SEC;

    let chargeSec: number;
    if (bodyName === 'Moon' || this.previousBody === 'Moon') {
      chargeSec = 2.0;
    } else if (travelAU < 1) {
      chargeSec = 2.0 + travelAU * 2.0;
    } else {
      chargeSec = 3.0 + Math.sqrt(travelAU) * 2.0;
    }
    chargeSec = Math.max(1.5, Math.min(12.0, chargeSec));

    this.navDuration = fixedSec + chargeSec;
    this.navP1 = AIM_SEC / this.navDuration;
    this.navP2 = (AIM_SEC + LOCK_SEC) / this.navDuration;
    this.navP3 = (AIM_SEC + LOCK_SEC + chargeSec) / this.navDuration;
    this.controls.enabled = false;

    this.navTripDistKm = travelAU * AU_KM_VAL;
    this.navTripSpeedC = this.navTripDistKm / Math.max(0.01, chargeSec) / 299792.458;

    this.navTripEta = chargeSec >= 10
      ? `${chargeSec.toFixed(0)}s`
      : `${chargeSec.toFixed(1)}s`;

    const destLabel = bodyName.toUpperCase();
    const distAU = travelAU;
    const distKmStr = this.navTripDistKm >= 1e9
      ? `${(this.navTripDistKm / 1e9).toFixed(0)}B km`
      : this.navTripDistKm >= 1e6
        ? `${(this.navTripDistKm / 1e6).toFixed(0)}M km`
        : `${Math.round(this.navTripDistKm).toLocaleString()} km`;
    const speedStr = this.navTripSpeedC >= 10
      ? `${Math.round(this.navTripSpeedC).toLocaleString()}c`
      : this.navTripSpeedC >= 1
        ? `${this.navTripSpeedC.toFixed(1)}c`
        : `${this.navTripSpeedC.toFixed(2)}c`;

    const destEl = this.tripCard.querySelector('.cm-trip-dest') as HTMLElement;
    const distEl = this.tripCard.querySelector('.cm-trip-dist') as HTMLElement;
    const speedEl = this.tripCard.querySelector('.cm-trip-speed') as HTMLElement;
    const etaEl = this.tripCard.querySelector('.cm-trip-eta') as HTMLElement;
    if (destEl) destEl.textContent = destLabel;
    if (distEl) distEl.textContent = `${distAU.toFixed(2)} AU \u2014 ${distKmStr}`;
    if (speedEl) speedEl.textContent = speedStr;
    if (etaEl) etaEl.textContent = this.navTripEta;

    const destPlanet = PLANETS.find(p => p.name === bodyName);
    const tripColor = bodyName === 'Sun' ? '#ffd54f'
      : bodyName === 'Moon' ? '#b0b0aa'
      : (destPlanet?.color ?? '#ffffff');
    this.tripCard.style.setProperty('--hud-color', tripColor);
  }

  private setHoveredBody(name: string | null): void {
    if (this.hoveredBody === 'Sun') {
      (this.sunCorona.material as THREE.ShaderMaterial).uniforms.uGlowBoost.value = 1.0;
    }
    this.hoveredBody = name;
    if (name === 'Sun') {
      (this.sunCorona.material as THREE.ShaderMaterial).uniforms.uGlowBoost.value = 2.0;
    }
    // Orbit line and glow highlighting is handled in animate() via the hoveredBody flag
  }

  private getBodyScenePos(name: string): THREE.Vector3 {
    if (name === 'Sun') return new THREE.Vector3(0, 0, 0);
    if (name === 'Earth') return this.earthGroup.position.clone();
    if (name === 'Moon') return this.moonMesh.getWorldPosition(new THREE.Vector3());
    const group = this.planetGroups.get(name);
    if (group) return group.position.clone();
    const mesh = this.planetMeshes.get(name);
    return mesh ? mesh.getWorldPosition(new THREE.Vector3()) : this.earthGroup.position.clone();
  }

  private bodyTrueRadius(name: string): number {
    if (name === 'Sun') return SUN_TRUE_R;
    if (name === 'Moon') return MOON_TRUE_R;
    const planet = PLANETS.find(p => p.name === name);
    return planet ? planet.radiusKm / AU_KM_VAL * AU_SCENE : SUN_TRUE_R;
  }

  private bodyMeshRadius(name: string): number {
    if (name === 'Sun') return SUN_MESH_R;
    if (name === 'Moon') return MOON_MESH_R;
    const planet = PLANETS.find(p => p.name === name);
    return planet?.sceneRadius ?? EARTH_R;
  }

  private effectiveRadius(trueR: number, distToCamera: number): number {
    if (distToCamera < 0.0001) return trueR;
    const h = this.renderer.domElement.clientHeight;
    const halfFovTan = Math.tan(this.camera.fov * Math.PI / 360);
    const minAngular = MIN_BODY_PX / (h * 0.5) * halfFovTan;
    const trueAngular = trueR / distToCamera;
    return Math.max(trueAngular, minAngular) * distToCamera;
  }

  private updatePerspectiveScaling(): void {
    const camPos = this.camera.position;
    const _wp = new THREE.Vector3();

    // ── Sun ──
    this.sunMesh.getWorldPosition(_wp);
    const sunDist = camPos.distanceTo(_wp);
    const sunEff = this.effectiveRadius(SUN_TRUE_R, sunDist);
    const sunSf = sunEff / SUN_MESH_R;
    this.sunMesh.scale.setScalar(sunSf);
    this.sunCorona.scale.setScalar(sunSf);
    this.sunSprite.scale.set(22 * sunSf, 22 * sunSf, 1);
    this.sunGlow.scale.set(60 * sunSf, 60 * sunSf, 1);
    this.sunLabel.position.set(0, sunEff + Math.max(0.5, sunEff * 0.6), 0);

    const sunGlowFade = Math.min(1, sunDist / (SUN_TRUE_R * 10));
    (this.sunSprite.material as THREE.SpriteMaterial).opacity = sunGlowFade;
    (this.sunGlow.material as THREE.SpriteMaterial).opacity = sunGlowFade * 0.8;

    // ── Earth ──
    this.earthGroup.getWorldPosition(_wp);
    const earthTrueR = PLANETS.find(p => p.name === 'Earth')!.radiusKm / AU_KM_VAL * AU_SCENE;
    const earthDist = camPos.distanceTo(_wp);
    const earthEff = this.effectiveRadius(earthTrueR, earthDist);
    const earthSf = earthEff / EARTH_R;
    this._earthScale = earthSf;
    this.earth.scale.setScalar(earthSf);
    this.clouds.scale.setScalar(earthSf);
    this.atmosphere.scale.setScalar(earthSf);
    this.axisLine.scale.setScalar(earthSf);
    this.poleSweepGroup.scale.setScalar(earthSf);

    this.locMarker.scale.setScalar(earthSf);
    this.arrowHelper.scale.setScalar(earthSf);
    this.earthTerminator.scale.setScalar(earthSf);

    // ── Moon ──
    this.moonMesh.getWorldPosition(_wp);
    const moonDist = camPos.distanceTo(_wp);
    const moonEff = this.effectiveRadius(MOON_TRUE_R, moonDist);
    const moonSf = moonEff / MOON_MESH_R;
    this.moonMesh.scale.setScalar(moonSf);
    this.moonAxisLine.scale.setScalar(moonSf);
    this.moonSweep.scale.setScalar(moonSf);
    this.moonTerminator.scale.setScalar(moonSf);

    // ── Other planets ──
    for (const planet of PLANETS) {
      if (planet.name === 'Earth') continue;
      const mesh = this.planetMeshes.get(planet.name);
      const group = this.planetGroups.get(planet.name);
      if (!mesh || !group) continue;

      group.getWorldPosition(_wp);
      const dist = camPos.distanceTo(_wp);
      const trueR = planet.radiusKm / AU_KM_VAL * AU_SCENE;
      const eff = this.effectiveRadius(trueR, dist);
      const sf = eff / planet.sceneRadius;
      mesh.scale.setScalar(sf);

      const axisLine = this.planetAxisLines.get(planet.name);
      if (axisLine) axisLine.scale.setScalar(sf);

      const sweep = this.planetSweeps.get(planet.name);
      if (sweep) {
        sweep.scale.setScalar(sf);
        const poleEcl = poleToEclipticAxis(planet.poleRA, planet.poleDec);
        const poleDir = eclToThree(poleEcl).normalize();
        sweep.position.copy(poleDir.clone().multiplyScalar(planet.sceneRadius * 2.5 * sf));
      }

      if (planet.name === 'Saturn') {
        const rings = this.planetMeshes.get('SaturnRings');
        if (rings) rings.scale.setScalar(sf);
      }

      const term = this.planetTerminators.get(planet.name);
      if (term) term.scale.setScalar(sf);
    }

    // ── Ghost bodies ──
    if (this.ghostGroup.visible) {
      this.ghostEarth.getWorldPosition(_wp);
      const geDist = camPos.distanceTo(_wp);
      const geEff = this.effectiveRadius(earthTrueR, geDist);
      const geSf = geEff / EARTH_R;
      this.ghostEarth.scale.setScalar(geSf);
      this.ghostClouds.scale.setScalar(geSf);
      this.ghostAtmo.scale.setScalar(geSf);
      this.ghostAxisLine.scale.setScalar(geSf);
      this.ghostSweep.scale.setScalar(geSf);

      this.ghostMoon.getWorldPosition(_wp);
      const gmDist = camPos.distanceTo(_wp);
      const gmEff = this.effectiveRadius(MOON_TRUE_R, gmDist);
      this.ghostMoon.scale.setScalar(gmEff / MOON_MESH_R);

      this.ghostSunSprite.getWorldPosition(_wp);
      const gsDist = camPos.distanceTo(_wp);
      const gsEff = this.effectiveRadius(SUN_TRUE_R, gsDist);
      const gsSf = gsEff / SUN_MESH_R;
      this.ghostSunSprite.scale.set(10 * gsSf, 10 * gsSf, 1);
      this.ghostSunGlow.scale.set(35 * gsSf, 35 * gsSf, 1);
      this.ghostSunLabel.position.copy(this.ghostSunWorldPos).add(
        new THREE.Vector3(0, gsEff + Math.max(0.3, gsEff * 0.6), 0),
      );
    }

    // ── Dynamic near plane + min orbit distance ──
    const focusedPos = this.getBodyScenePos(this.currentBody);
    const focusDist = camPos.distanceTo(focusedPos);
    const focusTrueR = this.bodyTrueRadius(this.currentBody);
    this.controls.minDistance = Math.max(focusTrueR * 2.5, 0.0005);
    if (this.flightLocked) {
      this.camera.near = Math.min(0.1, Math.max(0.0001, focusDist * 0.05));
      this.camera.updateProjectionMatrix();
    }
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
    this.earthGroup.add(this.locMarker);

    // HTML overlay — projected from 3D to screen each frame
    this.locOverlay = document.createElement('div');
    this.locOverlay.className = 'cm-loc-overlay';
    this.locOverlay.innerHTML = `
      <div class="cm-loc-line1"></div>
      <div class="cm-loc-line2"></div>
    `;
    document.getElementById('app')!.appendChild(this.locOverlay);
  }

  private createTerminatorLine(radius: number, color: number, segments = 128): THREE.LineLoop {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      pts.push(new THREE.Vector3(0, Math.cos(angle) * radius, Math.sin(angle) * radius));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      color, transparent: true, opacity: 0.6, depthWrite: false,
    });
    return new THREE.LineLoop(geo, mat);
  }

  private orientTerminator(line: THREE.LineLoop, sunDir: THREE.Vector3): void {
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), sunDir.clone().normalize());
    line.quaternion.copy(q);
  }

  private buildTerminators(): void {
    this.earthTerminator = this.createTerminatorLine(EARTH_R * 1.002, 0x44aaff);
    this.earthTerminator.visible = false;
    this.earthGroup.add(this.earthTerminator);

    this.moonTerminator = this.createTerminatorLine(MOON_MESH_R * 1.002, 0xaaaaaa);
    this.moonTerminator.visible = false;
    this.earthGroup.add(this.moonTerminator);

    for (const planet of PLANETS) {
      if (planet.name === 'Earth') continue;
      const line = this.createTerminatorLine(planet.sceneRadius * 1.002, new THREE.Color(planet.color).getHex());
      line.visible = false;
      const group = this.planetGroups.get(planet.name);
      if (group) group.add(line);
      this.planetTerminators.set(planet.name, line);
    }
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
    const worldAbsPos = this.locDot.getWorldPosition(new THREE.Vector3());
    const earthWorldPos = this.earthGroup.getWorldPosition(new THREE.Vector3());
    const dotFromEarth = worldAbsPos.clone().sub(earthWorldPos).normalize();
    const camFromEarth = this.camera.position.clone().sub(earthWorldPos).normalize();
    const facing = dotFromEarth.dot(camFromEarth) > -0.1;

    if (!facing) {
      this.locOverlay.style.opacity = '0';
      return;
    }
    this.locOverlay.style.opacity = '1';

    const projected = worldAbsPos.clone().project(this.camera);
    const hw = window.innerWidth / 2;
    const hh = window.innerHeight / 2;
    const sx = projected.x * hw + hw;
    const sy = -projected.y * hh + hh;
    this.locOverlay.style.transform = `translate(${sx}px, ${sy - 20}px)`;

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

    // Sun direction from Earth = -earthPos (normalized)
    const ep = this.data.earthPos;
    const epLen = Math.sqrt(ep[0] * ep[0] + ep[1] * ep[1] + ep[2] * ep[2]);
    const sd: [number, number, number] = [-ep[0] / epLen, -ep[1] / epLen, -ep[2] / epLen];
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

  /**
   * Map a sidereal rotation period (hours, negative=retrograde) to a visual
   * angular velocity (rad/ms) using a logarithmic scale.
   * Preserves sign for retrograde, compresses the 588:1 range (Jupiter vs Venus)
   * into a perceptible ~10:1 visual range.
   */
  private logRotationSpeed(periodHours: number): number {
    const dir = periodHours < 0 ? -1 : 1;
    const absH = Math.abs(periodHours);
    const rate = 1 / absH;
    const logRate = Math.log10(rate);
    // Jupiter ≈ -1.0, Venus ≈ -3.8
    const logMin = -3.8;
    const logMax = -1.0;
    const t = Math.max(0, Math.min(1, (logRate - logMin) / (logMax - logMin)));
    const minSpeed = 0.0004;
    const maxSpeed = 0.005;
    return dir * (minSpeed + t * (maxSpeed - minSpeed));
  }

  private scaleDistLabel(sprite: THREE.Sprite): void {
    if (!sprite.visible) return;
    const dist = this.camera.position.distanceTo(sprite.position);
    if (dist < 0.01) return;
    const vFov = this.camera.fov * Math.PI / 180;
    const screenFrac = 0.22;
    const worldHeight = 2 * dist * Math.tan(vFov / 2);
    const s = worldHeight * screenFrac;
    sprite.scale.set(s, s * 0.125, 1);
  }

  private planetColorCSS(name: string): string {
    const planet = PLANETS.find(p => p.name === name);
    if (!planet) return '255, 255, 255';
    const c = new THREE.Color(planet.color);
    return `${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}`;
  }

  private computePlanetTravelDist(trajectoryPoints: { pos: [number, number, number]; dayOffset: number }[], offsetDays: number): number {
    const absDays = Math.abs(offsetDays);
    const sign = offsetDays >= 0 ? 1 : -1;
    let totalAU = 0;
    let prevPos: [number, number, number] | null = null;

    for (const pt of trajectoryPoints) {
      if (sign > 0 && pt.dayOffset < 0) continue;
      if (sign < 0 && pt.dayOffset > 0) continue;
      if (Math.abs(pt.dayOffset) > absDays) break;
      if (prevPos) {
        const dx = pt.pos[0] - prevPos[0];
        const dy = pt.pos[1] - prevPos[1];
        const dz = pt.pos[2] - prevPos[2];
        totalAU += Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
      prevPos = pt.pos;
    }
    return totalAU * 149597870.7;
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

    this.earthGroup.add(this.poleSweepGroup);
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

  private createPlanetSweep(radius: number, colorHex: string, retrograde: boolean): THREE.Group {
    const group = new THREE.Group();
    const arcAngle = Math.PI * 1.6;
    const segments = 60;
    const c = new THREE.Color(colorHex);

    const positions = new Float32Array((segments + 1) * 3);
    const colors = new Float32Array((segments + 1) * 3);
    const dir = retrograde ? -1 : 1;

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const angle = t * arcAngle * dir;
      positions[i * 3] = radius * Math.cos(angle);
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = radius * Math.sin(angle);

      const fade = Math.pow(1.0 - t, 2.0) * 0.8;
      colors[i * 3] = c.r * fade;
      colors[i * 3 + 1] = c.g * fade;
      colors[i * 3 + 2] = c.b * fade;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    group.add(new THREE.Line(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })));

    const coneSize = Math.max(0.02, radius * 0.12);
    const coneGeo = new THREE.ConeGeometry(coneSize, coneSize * 3.5, 6);
    const coneMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colorHex), transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.set(radius, 0, 0);
    const tangent = new THREE.Vector3(0, 0, retrograde ? 1 : -1);
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
    this.earthGroup.add(this.axisLine);
  }

  private buildArrow(): void {
    this.arrowHelper = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 0),
      EARTH_R * 3, 0x00e5ff, 0.2, 0.1,
    );
    this.arrowHelper.visible = false;
    this.earthGroup.add(this.arrowHelper);
  }

  private buildOrbitalRing(): void {
    const segments = 128;
    const pts: THREE.Vector3[] = [];
    const orbitRadius = AU_SCENE;
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

  private rebuildPlanetOrbits(date: Date): void {
    for (const planet of PLANETS) {
      const line = this.planetOrbitLines.get(planet.name);
      if (!line) continue;
      const path = computeOrbitPath(planet, 360, date);
      const pts = path.map(p => eclToThree(p));
      line.geometry.dispose();
      line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    }
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

  private buildPlanetBeams(): void {
    for (const planet of PLANETS) {
      if (planet.name === 'Earth') continue;

      const beamGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(), new THREE.Vector3(),
      ]);
      const beam = new THREE.Line(beamGeo, new THREE.LineBasicMaterial({
        color: new THREE.Color(planet.color), transparent: true, opacity: 0.12,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      beam.frustumCulled = false;
      beam.visible = false;
      this.scenePivot.add(beam);
      this.planetBeams.set(planet.name, beam);

      const distLabel = this.makeDistLabel();
      distLabel.scale.set(8, 1, 1);
      distLabel.visible = false;
      this.scenePivot.add(distLabel);
      this.planetDistLabels.set(planet.name, distLabel);

      const ghostBeamGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(), new THREE.Vector3(),
      ]);
      const ghostBeam = new THREE.Line(ghostBeamGeo, new THREE.LineBasicMaterial({
        color: new THREE.Color(planet.color), transparent: true, opacity: 0.08,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      ghostBeam.frustumCulled = false;
      ghostBeam.visible = false;
      this.scenePivot.add(ghostBeam);
      this.planetGhostBeams.set(planet.name, ghostBeam);

      const ghostDistLabel = this.makeDistLabel();
      ghostDistLabel.scale.set(7, 0.9, 1);
      ghostDistLabel.visible = false;
      this.scenePivot.add(ghostDistLabel);
      this.planetGhostDistLabels.set(planet.name, ghostDistLabel);

      const travelLabel = this.makeDistLabel();
      travelLabel.scale.set(7, 0.9, 1);
      travelLabel.visible = false;
      this.scenePivot.add(travelLabel);
      this.planetTravelLabels.set(planet.name, travelLabel);
    }
  }

  private buildHUD(container: HTMLElement): void {
    this.hudOverlay = document.createElement('div');
    this.hudOverlay.className = 'cm-hud';
    container.appendChild(this.hudOverlay);

    // Reticle SVG — rotating arc segments around the target
    this.hudReticle = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.hudReticle.classList.add('cm-hud-reticle');
    this.hudReticle.setAttribute('viewBox', '-50 -50 100 100');
    this.hudReticle.innerHTML = `
      <g class="cm-reticle-spin">
        <path d="M 0,-42 A 42,42 0 0,1 36.37,-21" class="cm-reticle-arc"/>
        <path d="M 42,0 A 42,42 0 0,1 21,36.37" class="cm-reticle-arc"/>
        <path d="M 0,42 A 42,42 0 0,1 -36.37,21" class="cm-reticle-arc" style="opacity:0.35"/>
        <path d="M -42,0 A 42,42 0 0,1 -21,-36.37" class="cm-reticle-arc" style="opacity:0.35"/>
      </g>
    `;
    this.hudOverlay.appendChild(this.hudReticle);

    // Lock-on reticle — appears on the destination body during navigation
    this.lockOnReticle = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.lockOnReticle.classList.add('cm-hud-reticle', 'cm-lockon-reticle');
    this.lockOnReticle.setAttribute('viewBox', '-50 -50 100 100');
    this.lockOnReticle.innerHTML = `
      <g class="cm-reticle-spin">
        <path d="M 0,-42 A 42,42 0 0,1 36.37,-21" class="cm-reticle-arc"/>
        <path d="M 42,0 A 42,42 0 0,1 21,36.37" class="cm-reticle-arc"/>
        <path d="M 0,42 A 42,42 0 0,1 -36.37,21" class="cm-reticle-arc"/>
        <path d="M -42,0 A 42,42 0 0,1 -21,-36.37" class="cm-reticle-arc"/>
      </g>
    `;
    this.lockOnReticle.style.opacity = '0';
    this.hudOverlay.appendChild(this.lockOnReticle);

    this.tripCard = document.createElement('div');
    this.tripCard.className = 'cm-trip-card';
    this.tripCard.innerHTML = `
      <div class="cm-trip-dest"></div>
      <div class="cm-trip-stat"><span class="cm-trip-label">DIST</span><span class="cm-trip-value cm-trip-dist"></span></div>
      <div class="cm-trip-stat"><span class="cm-trip-label">SPEED</span><span class="cm-trip-value cm-trip-speed"></span></div>
      <div class="cm-trip-stat"><span class="cm-trip-label">ETA</span><span class="cm-trip-value cm-trip-eta"></span></div>
    `;
    this.hudOverlay.appendChild(this.tripCard);

    // Leader line SVG — full viewport, draws the elbow line
    this.hudLine = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.hudLine.classList.add('cm-hud-line');
    this.hudLine.innerHTML = `<polyline class="cm-leader-line" points="0,0 0,0 0,0"/>
      <circle r="3" class="cm-leader-dot cm-leader-dot-body"/>
      <circle r="3" class="cm-leader-dot cm-leader-dot-card"/>`;
    this.hudOverlay.appendChild(this.hudLine);

    // Info card
    this.hudCard = document.createElement('div');
    this.hudCard.className = 'cm-hud-card';
    this.hudCard.innerHTML = `
      <button class="cm-hud-close" title="Close">×</button>
      <div class="cm-hud-name"></div>
      <div class="cm-hud-stats"></div>
    `;
    this.hudOverlay.appendChild(this.hudCard);

    this.hudCard.querySelector('.cm-hud-close')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hudVisible = false;
      this.hudTargetOpacity = 0;
    });

    // Moon HUD — secondary target
    this.moonHudReticle = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.moonHudReticle.classList.add('cm-hud-reticle');
    this.moonHudReticle.setAttribute('viewBox', '-50 -50 100 100');
    this.moonHudReticle.innerHTML = `
      <g class="cm-reticle-spin">
        <path d="M 0,-42 A 42,42 0 0,1 36.37,-21" class="cm-reticle-arc"/>
        <path d="M 42,0 A 42,42 0 0,1 21,36.37" class="cm-reticle-arc"/>
        <path d="M 0,42 A 42,42 0 0,1 -36.37,21" class="cm-reticle-arc" style="opacity:0.35"/>
        <path d="M -42,0 A 42,42 0 0,1 -21,-36.37" class="cm-reticle-arc" style="opacity:0.35"/>
      </g>
    `;
    this.hudOverlay.appendChild(this.moonHudReticle);

    this.moonHudLine = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.moonHudLine.classList.add('cm-hud-line');
    this.moonHudLine.innerHTML = `<polyline class="cm-leader-line" points="0,0 0,0 0,0"/>
      <circle r="2" class="cm-leader-dot cm-leader-dot-body"/>
      <circle r="2" class="cm-leader-dot cm-leader-dot-card"/>`;
    this.hudOverlay.appendChild(this.moonHudLine);

    this.moonHudCard = document.createElement('div');
    this.moonHudCard.className = 'cm-hud-card cm-hud-card-moon';
    this.moonHudCard.innerHTML = `
      <button class="cm-hud-close" title="Close">×</button>
      <div class="cm-hud-name"><span class="cm-hud-symbol" style="color:rgba(200,200,195,0.7)">☽</span> Moon</div>
      <div class="cm-hud-stats"></div>
    `;
    this.hudOverlay.appendChild(this.moonHudCard);

    this.moonHudCard.querySelector('.cm-hud-close')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.moonHudVisible = false;
    });

    this.buildPositionIndicator(container);
  }

  private buildPositionIndicator(container: HTMLElement): void {
    this.posIndicator = document.createElement('div');
    this.posIndicator.className = 'cm-pos-indicator';
    this.posIndicator.innerHTML = `
      <div class="cm-pos-section">Position</div>
      <div class="cm-pos-coord"><span class="cm-pos-axis">X</span><span class="cm-pos-value" data-pos="x">+0.0000 AU</span></div>
      <div class="cm-pos-coord"><span class="cm-pos-axis">Y</span><span class="cm-pos-value" data-pos="y">+0.0000 AU</span></div>
      <div class="cm-pos-coord"><span class="cm-pos-axis">Z</span><span class="cm-pos-value" data-pos="z">+0.0000 AU</span></div>
      <div class="cm-pos-section">Nearest</div>
      <div class="cm-pos-nearest">
        <span class="cm-pos-body-symbol"></span>
        <span class="cm-pos-body-name"></span>
        <span class="cm-pos-body-dist"></span>
      </div>
      <div class="cm-pos-section">Heading</div>
      <div class="cm-pos-coord"><span class="cm-pos-axis">HDG</span><span class="cm-pos-value" data-pos="hdg">0.0°</span></div>
      <div class="cm-pos-coord"><span class="cm-pos-axis">PIT</span><span class="cm-pos-value" data-pos="pit">0.0°</span></div>
      <div class="cm-pos-facing">
        <span class="cm-pos-facing-arrow">→</span>
        <span class="cm-pos-facing-symbol"></span>
        <span class="cm-pos-facing-name"></span>
      </div>
      <div class="cm-pos-section">Sun</div>
      <div class="cm-pos-sun">
        <span class="cm-pos-sun-symbol">☉</span>
        <span class="cm-pos-sun-dist"></span>
        <span class="cm-pos-sun-light"></span>
      </div>
      <button class="cm-pos-snap-btn" title="Snapshot position to clipboard">⎘</button>
    `;
    container.appendChild(this.posIndicator);

    this.snapBtnEl = this.posIndicator.querySelector('.cm-pos-snap-btn')! as HTMLButtonElement;
    this.snapBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.snapshotPosition();
    });

    this.posXEl = this.posIndicator.querySelector('[data-pos="x"]')!;
    this.posYEl = this.posIndicator.querySelector('[data-pos="y"]')!;
    this.posZEl = this.posIndicator.querySelector('[data-pos="z"]')!;
    this.posNearestEl = this.posIndicator.querySelector('.cm-pos-nearest')!;
    this.posFacingEl = this.posIndicator.querySelector('.cm-pos-facing')!;
    this.posHdgEl = this.posIndicator.querySelector('[data-pos="hdg"]')!;
    this.posPitEl = this.posIndicator.querySelector('[data-pos="pit"]')!;
    this.posSunDistEl = this.posIndicator.querySelector('.cm-pos-sun-dist')!;
    this.posSunLightEl = this.posIndicator.querySelector('.cm-pos-sun-light')!;

    this.snapOverlay = document.createElement('div');
    this.snapOverlay.className = 'cm-snap-overlay';
    this.snapOverlay.innerHTML = `
      <div class="cm-snap-key"></div>
      <div class="cm-snap-label">Position snapshot copied</div>
    `;
    document.body.appendChild(this.snapOverlay);
  }

  private snapshotPosition(): void {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const rng = () => chars[(Math.random() * chars.length) | 0];
    let raw = '';
    for (let i = 0; i < 6; i++) raw += rng();
    const key = raw.slice(0, 3) + '-' + raw.slice(3);
    this.activeSnapKey = key;

    const x = this.posXEl.textContent || '';
    const y = this.posYEl.textContent || '';
    const z = this.posZEl.textContent || '';
    const nearest = this.posNearestEl.querySelector('.cm-pos-body-name')?.textContent || '';
    const nearestDist = this.posNearestEl.querySelector('.cm-pos-body-dist')?.textContent || '';
    const hdg = this.posHdgEl.textContent || '';
    const pit = this.posPitEl.textContent || '';
    const facing = this.posFacingEl.querySelector('.cm-pos-facing-name')?.textContent || '';
    const sunDist = this.posSunDistEl.textContent || '';
    const sunLight = this.posSunLightEl.textContent || '';
    const date = new Date().toISOString();

    const clipText = [
      `[CM-${key}]`,
      `Date: ${date}`,
      `Position: X ${x}  Y ${y}  Z ${z}`,
      `Nearest: ${nearest} @ ${nearestDist}`,
      `Heading: HDG ${hdg}  PIT ${pit}`,
      `Facing: ${facing}`,
      `Sun: ${sunDist} (${sunLight})`,
    ].join('\n');

    const copyFallback = () => {
      const ta = document.createElement('textarea');
      ta.value = clipText;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(clipText).catch(copyFallback);
    } else {
      copyFallback();
    }

    this.snapBtnEl.textContent = key;
    this.snapBtnEl.classList.add('cm-pos-snap-active');

    const keyEl = this.snapOverlay.querySelector('.cm-snap-key')!;
    keyEl.textContent = `CM-${key}`;
    this.snapOverlay.classList.remove('cm-snap-show');
    void this.snapOverlay.offsetWidth;
    this.snapOverlay.classList.add('cm-snap-show');
  }

  private resetSnapshot(): void {
    if (!this.activeSnapKey) return;
    this.activeSnapKey = '';
    this.snapBtnEl.textContent = '⎘';
    this.snapBtnEl.classList.remove('cm-pos-snap-active');
  }

  private updateHUD(): void {
    // Get the actual world position from the 3D object
    const bodyPos = new THREE.Vector3();
    if (this.currentBody === 'Sun') {
      this.sunMesh.getWorldPosition(bodyPos);
    } else if (this.currentBody === 'Earth') {
      this.earthGroup.getWorldPosition(bodyPos);
    } else if (this.currentBody === 'Moon') {
      this.moonMesh.getWorldPosition(bodyPos);
    } else {
      const grp = this.planetGroups.get(this.currentBody);
      if (grp) grp.getWorldPosition(bodyPos);
    }
    const screenPos = bodyPos.clone().project(this.camera);
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    const sx = (screenPos.x * 0.5 + 0.5) * w;
    const sy = (-screenPos.y * 0.5 + 0.5) * h;
    const behind = screenPos.z > 1;

    // Fade logic — integrated with four-phase navigation
    if (this.currentBody !== this.hudLastBody) {
      this.hudLastBody = this.currentBody;
      this.hudVisible = true;
      this.hudTargetOpacity = 1;
      this.hudOpacity = 0;
      if (this.currentBody === 'Earth') this.moonHudVisible = true;
      this.updateHUDContent();
    }

    // During navigation: fade out departure HUD during aim phase,
    // new HUD fades in after body switch at end of lock-on phase
    if (this.isNavigating) {
      const tg = Math.min(1, this.navTime / this.navDuration);
      if (!this.navBodySwitched) {
        // Fade out over the aim phase
        this.hudTargetOpacity = Math.max(0, 1 - tg / this.navP1);
      }
    }

    const fadeSpeed = this.isNavigating ? 0.15 : 0.08;
    this.hudOpacity += (this.hudTargetOpacity - this.hudOpacity) * fadeSpeed;
    const op = behind ? 0 : this.hudOpacity;
    this.hudOverlay.style.opacity = String(Math.max(0, Math.min(1, op)));

    // Reticle tracks the body — size scales with apparent body size
    const hudPlanet = PLANETS.find(p => p.name === this.currentBody);
    const trueR = this.bodyTrueRadius(this.currentBody);
    const camDist = this.camera.position.distanceTo(bodyPos);
    const effR = this.effectiveRadius(trueR, camDist);
    const hasAtmo = this.currentBody === 'Earth' || this.currentBody === 'Venus' ||
      this.currentBody === 'Mars' || this.currentBody === 'Jupiter' ||
      this.currentBody === 'Saturn' || this.currentBody === 'Uranus' || this.currentBody === 'Neptune';
    const visR = effR * (hasAtmo ? 1.15 : 1.06);
    const camRight = new THREE.Vector3();
    this.camera.getWorldDirection(camRight);
    camRight.cross(this.camera.up).normalize();
    const edgePt = bodyPos.clone().add(camRight.multiplyScalar(visR));
    const edgeScreen = edgePt.clone().project(this.camera);
    const edgeSx = (edgeScreen.x * 0.5 + 0.5) * w;
    const edgeSy = (-edgeScreen.y * 0.5 + 0.5) * h;
    const pixelRadius = Math.sqrt((edgeSx - sx) ** 2 + (edgeSy - sy) ** 2);
    const gap = Math.max(14, Math.min(50, 12 + pixelRadius * 0.05));
    const reticleSize = Math.max(56, (pixelRadius + gap) * (100 / 42));
    const halfR = reticleSize / 2;
    const bodyFill = pixelRadius / Math.min(w, h);
    if (bodyFill > 1.5) {
      this.hudReticle.style.opacity = '0';
    } else if (bodyFill > 1.0) {
      this.hudReticle.style.opacity = String(1 - (bodyFill - 1.0) / 0.5);
    } else {
      this.hudReticle.style.opacity = '';
    }
    this.hudReticle.style.width = `${reticleSize}px`;
    this.hudReticle.style.height = `${reticleSize}px`;
    this.hudReticle.style.transform = `translate(${sx - halfR}px, ${sy - halfR}px)`;

    // Rotate arcs via JS (not CSS animation, for reliability)
    const spin = this.hudReticle.querySelector('.cm-reticle-spin') as SVGGElement;
    if (spin) spin.setAttribute('transform', `rotate(${(performance.now() * 0.03) % 360})`);

    // Lock-on reticle: visible during nav aim/lock-on, tracks the destination body
    if (this.isNavigating && this.navLockOnSpin >= 0) {
      const destBodyPos = this.getBodyScenePos(this.navTargetBody);
      const destScreen = destBodyPos.clone().project(this.camera);
      const dsx = (destScreen.x * 0.5 + 0.5) * w;
      const dsy = (-destScreen.y * 0.5 + 0.5) * h;
      const destBehind = destScreen.z > 1;

      const tg = Math.min(1, this.navTime / this.navDuration);
      // Visible during aim + lock-on (phases 1-2), fade out at charge start
      const lockVis = tg < this.navP1
        ? Math.min(1, tg / 0.08)
        : tg < this.navP2
          ? 1
          : Math.max(0, 1 - (tg - this.navP2) / 0.06);

      // Spin speed ramps up during lock-on
      const spinSpeed = 0.03 + this.navLockOnSpin * 0.20;
      const lockSpin = this.lockOnReticle.querySelector('.cm-reticle-spin') as SVGGElement;
      if (lockSpin) lockSpin.setAttribute('transform', `rotate(${(performance.now() * spinSpeed) % 360})`);

      // Scale pulse during lock-on
      const scalePulse = this.navLockOnSpin > 0
        ? 1 + 0.2 * Math.sin(this.navLockOnSpin * Math.PI)
        : 1;
      const lockSize = 70 * scalePulse;
      const lockHalf = lockSize / 2;
      this.lockOnReticle.style.width = `${lockSize}px`;
      this.lockOnReticle.style.height = `${lockSize}px`;
      this.lockOnReticle.style.transform = `translate(${dsx - lockHalf}px, ${dsy - lockHalf}px)`;
      this.lockOnReticle.style.opacity = destBehind ? '0' : String(lockVis);

      // Color: use the destination body's color
      const destPlanet = PLANETS.find(p => p.name === this.navTargetBody);
      const lockColor = this.navTargetBody === 'Sun' ? '#ffd54f'
        : this.navTargetBody === 'Moon' ? '#b0b0aa'
        : (destPlanet?.color ?? '#ffffff');
      this.lockOnReticle.style.setProperty('--hud-color', lockColor);
    } else {
      this.lockOnReticle.style.opacity = '0';
    }

    // Trip card: fade in at lock-on, visible through charge, persist after arrival
    if (this.isNavigating) {
      const tg = Math.min(1, this.navTime / this.navDuration);
      let tripOpacity = 0;
      if (tg >= this.navP1 && tg < this.navP2) {
        tripOpacity = Math.min(1, (tg - this.navP1) / (this.navP2 - this.navP1));
      } else if (tg >= this.navP2) {
        tripOpacity = 1;
      }
      this.tripCard.style.opacity = String(tripOpacity);
      this.navTripCardTimer = 3.0;

      // Live countdown: ETA counts down during charge (travel to object)
      const etaEl = this.tripCard.querySelector('.cm-trip-eta') as HTMLElement;
      if (etaEl && tg >= this.navP2 && tg < this.navP3) {
        const chargeProgress = (tg - this.navP2) / (this.navP3 - this.navP2);
        const chargeTotalSec = this.navDuration * (this.navP3 - this.navP2);
        const remaining = Math.max(0, chargeTotalSec * (1 - chargeProgress));
        etaEl.textContent = remaining >= 10
          ? `${remaining.toFixed(0)}s`
          : `${remaining.toFixed(1)}s`;
      } else if (etaEl && tg >= this.navP3) {
        etaEl.textContent = 'ARRIVED';
      }
    } else if (this.navTripCardTimer > 0) {
      this.navTripCardTimer -= this._delta;
      const fade = Math.min(1, this.navTripCardTimer / 1.0);
      this.tripCard.style.opacity = String(Math.max(0, fade));
    } else {
      this.tripCard.style.opacity = '0';
    }

    // Card position — offset to upper-right of planet, clamped to viewport
    const cardW = 200;
    const cardH = 180;
    const offsetX = halfR + 20;
    const offsetY = -40;
    let cx = sx + offsetX;
    let cy = sy + offsetY;
    cx = Math.max(8, Math.min(w - cardW - 8, cx));
    cy = Math.max(8, Math.min(h - cardH - 8, cy));
    this.hudCard.style.transform = `translate(${cx}px, ${cy}px)`;

    // Leader line: body point → elbow → card edge
    const lineEl = this.hudLine.querySelector('.cm-leader-line') as SVGPolylineElement;
    const dotBody = this.hudLine.querySelector('.cm-leader-dot-body') as SVGCircleElement;
    const dotCard = this.hudLine.querySelector('.cm-leader-dot-card') as SVGCircleElement;
    this.hudLine.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.hudLine.style.width = `${w}px`;
    this.hudLine.style.height = `${h}px`;

    const cardAnchorX = cx;
    const cardAnchorY = cy + cardH / 2;
    const elbowX = cardAnchorX;
    const elbowY = sy;

    lineEl.setAttribute('points', `${sx},${sy} ${elbowX},${elbowY} ${cardAnchorX},${cardAnchorY}`);
    dotBody.setAttribute('cx', String(sx));
    dotBody.setAttribute('cy', String(sy));
    dotCard.setAttribute('cx', String(cardAnchorX));
    dotCard.setAttribute('cy', String(cardAnchorY));

    // Color theming
    const color = this.currentBody === 'Sun' ? '#ffd54f'
      : this.currentBody === 'Moon' ? '#b0b0aa'
      : (hudPlanet?.color ?? '#ffffff');
    this.hudReticle.style.setProperty('--hud-color', color);
    this.hudLine.style.setProperty('--hud-color', color);
    this.hudCard.style.setProperty('--hud-color', color);
  }

  private updateHUDContent(): void {
    const name = this.currentBody;
    const planet = PLANETS.find(p => p.name === name);
    const symbol = name === 'Sun' ? '☉' : name === 'Moon' ? '☽' : (planet?.symbol ?? '');
    const color = name === 'Sun' ? '#ffd54f' : name === 'Moon' ? '#b0b0aa' : (planet?.color ?? '#ffffff');

    const nameEl = this.hudCard.querySelector('.cm-hud-name')!;
    nameEl.innerHTML = `<span class="cm-hud-symbol" style="color:${color}">${symbol}</span> ${name}`;

    // Stats get updated each frame via updateHUDStats
  }

  private updateHUDStats(): void {
    if (this.hudOpacity < 0.05) return;
    const statsEl = this.hudCard.querySelector('.cm-hud-stats')!;
    const name = this.currentBody;
    const planet = PLANETS.find(p => p.name === name);
    if (!planet && name !== 'Sun' && name !== 'Moon') return;

    if (name === 'Moon') {
      const sunV = new THREE.Vector3(
        -this.data.earthPos[0], -this.data.earthPos[1], -this.data.earthPos[2],
      ).normalize();
      const moonV = new THREE.Vector3(...this.data.moonDir);
      const phaseAngle = sunV.angleTo(moonV);
      const crossV = new THREE.Vector3().crossVectors(sunV, moonV);
      const waxing = crossV.z > 0;
      const phaseDeg = phaseAngle * 180 / Math.PI;
      const phaseName = phaseDeg > 175 ? 'New Moon' : phaseDeg < 5 ? 'Full Moon'
        : waxing
          ? (phaseDeg > 95 ? 'Wax. Crescent' : phaseDeg > 85 ? '1st Quarter' : 'Wax. Gibbous')
          : (phaseDeg < 85 ? 'Wan. Gibbous' : phaseDeg < 95 ? '3rd Quarter' : 'Wan. Crescent');
      const illum = ((1 + Math.cos(phaseAngle)) / 2 * 100).toFixed(1);
      statsEl.innerHTML = `
        <div class="cm-hs"><span class="cm-hsl">Earth dist</span><span class="cm-hsv">${Math.round(this.data.moonDistKm).toLocaleString()} km</span></div>
        <div class="cm-hs"><span class="cm-hsl">Light time</span><span class="cm-hsv">${(this.data.moonDistKm / 299792.458).toFixed(1)}s</span></div>
        <div class="cm-hs"><span class="cm-hsl">Phase</span><span class="cm-hsv">${phaseName}</span></div>
        <div class="cm-hs"><span class="cm-hsl">Illumination</span><span class="cm-hsv">${illum}%</span></div>
        <div class="cm-hs"><span class="cm-hsl">Orbital period</span><span class="cm-hsv">27.3 days</span></div>
        <div class="cm-hs"><span class="cm-hsl">Axial tilt</span><span class="cm-hsv">6.7°</span></div>
      `;
      return;
    }

    if (name === 'Sun') {
      statsEl.innerHTML = `
        <div class="cm-hs"><span class="cm-hsl">Galactic speed</span><span class="cm-hsv">230 km/s</span></div>
        <div class="cm-hs"><span class="cm-hsl">Type</span><span class="cm-hsv">G2V Star</span></div>
      `;
      return;
    }

    const pos = this.getBodyScenePos(name);
    const sunDist = pos.length() / AU_SCENE;
    const sunKm = sunDist * 149597870.7;
    const lightSec = sunKm / 299792.458;
    const lightStr = lightSec < 60 ? `${lightSec.toFixed(1)}s`
      : `${Math.floor(lightSec / 60)}m ${Math.round(lightSec % 60).toString().padStart(2, '0')}s`;

    const earthPos = this.earthGroup.position;
    const earthDistScene = pos.distanceTo(earthPos);
    const earthDistAU = earthDistScene / AU_SCENE;

    const rotHrs = Math.abs(planet!.siderealRotationHours);
    const rotDir = planet!.siderealRotationHours < 0 ? '↺' : '↻';
    const rotStr = rotHrs > 48
      ? `${(rotHrs / 24).toFixed(1)}d ${rotDir}`
      : `${rotHrs.toFixed(1)}h ${rotDir}`;

    const isEarth = name === 'Earth';

    statsEl.innerHTML = `
      <div class="cm-hs"><span class="cm-hsl">Sun dist</span><span class="cm-hsv">${sunDist.toFixed(3)} AU</span></div>
      ${!isEarth ? `<div class="cm-hs"><span class="cm-hsl">Earth dist</span><span class="cm-hsv">${earthDistAU.toFixed(3)} AU</span></div>` : ''}
      <div class="cm-hs"><span class="cm-hsl">Light time</span><span class="cm-hsv">${lightStr}</span></div>
      <div class="cm-hs"><span class="cm-hsl">Orbital speed</span><span class="cm-hsv">${sunDist > 0.01 ? (29.78 * Math.sqrt(2 / sunDist - 1 / planet!.semiMajorAU)).toFixed(1) : '—'} km/s</span></div>
      <div class="cm-hs"><span class="cm-hsl">Rotation</span><span class="cm-hsv">${rotStr}</span></div>
      <div class="cm-hs"><span class="cm-hsl">Gravity</span><span class="cm-hsv">${planet!.surfaceGravityMs2.toFixed(1)} m/s²</span></div>
      <div class="cm-hs"><span class="cm-hsl">Axial tilt</span><span class="cm-hsv">${planet!.axialTiltDeg.toFixed(1)}°</span></div>
    `;
  }

  private updateMoonHUD(): void {
    const showMoon = this.currentBody === 'Earth' && this.moonHudVisible;
    const moonColor = '#b0b0aa';

    if (!showMoon) {
      this.moonHudReticle.style.opacity = '0';
      this.moonHudLine.style.opacity = '0';
      this.moonHudCard.style.opacity = '0';
      this.moonHudCard.style.pointerEvents = 'none';
      return;
    }

    const moonWorldPos = new THREE.Vector3();
    this.moonMesh.getWorldPosition(moonWorldPos);
    const screenPos = moonWorldPos.clone().project(this.camera);
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    const mx = (screenPos.x * 0.5 + 0.5) * w;
    const my = (-screenPos.y * 0.5 + 0.5) * h;
    const behind = screenPos.z > 1;

    const op = behind ? '0' : '1';
    this.moonHudReticle.style.opacity = op;
    this.moonHudLine.style.opacity = op;
    this.moonHudCard.style.opacity = op;
    this.moonHudCard.style.pointerEvents = behind ? 'none' : 'auto';

    // Reticle sizing — uses perspective-faithful effective radius
    const camDist = this.camera.position.distanceTo(moonWorldPos);
    const moonEffR = this.effectiveRadius(MOON_TRUE_R, camDist);
    const moonVisR = moonEffR * 1.05;
    const moonCamRight = new THREE.Vector3();
    this.camera.getWorldDirection(moonCamRight);
    moonCamRight.cross(this.camera.up).normalize();
    const moonEdgePt = moonWorldPos.clone().add(moonCamRight.clone().multiplyScalar(moonVisR));
    const moonEdgeScreen = moonEdgePt.clone().project(this.camera);
    const moonEdgeSx = (moonEdgeScreen.x * 0.5 + 0.5) * w;
    const moonEdgeSy = (-moonEdgeScreen.y * 0.5 + 0.5) * h;
    const pixR = Math.sqrt((moonEdgeSx - mx) ** 2 + (moonEdgeSy - my) ** 2);
    const moonGap = Math.max(10, Math.min(32, 8 + pixR * 0.04));
    const rSize = Math.max(40, (pixR + moonGap) * (100 / 42));
    const moonBodyFill = pixR / Math.min(w, h);
    if (moonBodyFill > 1.5) {
      this.moonHudReticle.style.opacity = '0';
    } else if (moonBodyFill > 1.0) {
      this.moonHudReticle.style.opacity = String(1 - (moonBodyFill - 1.0) / 0.5);
    } else {
      this.moonHudReticle.style.opacity = '';
    }
    const halfR = rSize / 2;
    this.moonHudReticle.style.width = `${rSize}px`;
    this.moonHudReticle.style.height = `${rSize}px`;
    this.moonHudReticle.style.transform = `translate(${mx - halfR}px, ${my - halfR}px)`;
    this.moonHudReticle.style.setProperty('--hud-color', moonColor);

    const spin = this.moonHudReticle.querySelector('.cm-reticle-spin') as SVGGElement;
    if (spin) spin.setAttribute('transform', `rotate(${(-performance.now() * 0.02) % 360})`);

    // Card — position below-left to avoid collision with main card
    const cardW = 175;
    const cardH = 160;
    let cx = mx - cardW - 20;
    let cy = my + 30;
    cx = Math.max(8, Math.min(w - cardW - 8, cx));
    cy = Math.max(8, Math.min(h - cardH - 8, cy));
    this.moonHudCard.style.transform = `translate(${cx}px, ${cy}px)`;
    this.moonHudCard.style.setProperty('--hud-color', moonColor);

    // Leader line
    const lineEl = this.moonHudLine.querySelector('.cm-leader-line') as SVGPolylineElement;
    const dotBody = this.moonHudLine.querySelector('.cm-leader-dot-body') as SVGCircleElement;
    const dotCard = this.moonHudLine.querySelector('.cm-leader-dot-card') as SVGCircleElement;
    this.moonHudLine.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.moonHudLine.style.width = `${w}px`;
    this.moonHudLine.style.height = `${h}px`;
    this.moonHudLine.style.setProperty('--hud-color', moonColor);

    const cardAnchorX = cx + cardW;
    const cardAnchorY = cy + cardH / 2;
    lineEl.setAttribute('points', `${mx},${my} ${cardAnchorX},${my} ${cardAnchorX},${cardAnchorY}`);
    dotBody.setAttribute('cx', String(mx));
    dotBody.setAttribute('cy', String(my));
    dotCard.setAttribute('cx', String(cardAnchorX));
    dotCard.setAttribute('cy', String(cardAnchorY));

    // Stats
    if (!this.data) return;
    const statsEl = this.moonHudCard.querySelector('.cm-hud-stats')!;
    const distKm = this.data.moonDistKm;
    const lightSec = distKm / 299792.458;
    // Compute phase locally
    const sunV = new THREE.Vector3(-this.data.earthPos[0], -this.data.earthPos[1], -this.data.earthPos[2]).normalize();
    const moonV = new THREE.Vector3(...this.data.moonDir);
    const phaseAngleMoon = sunV.angleTo(moonV);
    const crossMoon = new THREE.Vector3().crossVectors(sunV, moonV);
    const waxing = crossMoon.z > 0;
    const phaseDeg = phaseAngleMoon * 180 / Math.PI;
    const phaseName = phaseDeg > 175 ? 'New Moon' : phaseDeg < 5 ? 'Full Moon'
      : (waxing
        ? (phaseDeg > 95 ? 'Wax. Crescent' : phaseDeg > 85 ? '1st Quarter' : 'Wax. Gibbous')
        : (phaseDeg < 85 ? 'Wan. Gibbous' : phaseDeg < 95 ? '3rd Quarter' : 'Wan. Crescent'));
    const illum = ((1 + Math.cos(phaseAngleMoon)) / 2 * 100).toFixed(1);

    statsEl.innerHTML = `
      <div class="cm-hs"><span class="cm-hsl">Distance</span><span class="cm-hsv">${Math.round(distKm).toLocaleString()} km</span></div>
      <div class="cm-hs"><span class="cm-hsl">Light time</span><span class="cm-hsv">${lightSec.toFixed(1)}s</span></div>
      <div class="cm-hs"><span class="cm-hsl">Phase</span><span class="cm-hsv">${phaseName}</span></div>
      <div class="cm-hs"><span class="cm-hsl">Illumination</span><span class="cm-hsv">${illum}%</span></div>
      <div class="cm-hs"><span class="cm-hsl">Rotation</span><span class="cm-hsv">27.3d ↻</span></div>
      <div class="cm-hs"><span class="cm-hsl">Axial tilt</span><span class="cm-hsv">6.7°</span></div>
    `;
  }

  private updatePositionIndicator(): void {
    this.posFrameCounter++;
    if (this.posFrameCounter % 6 !== 0) return;

    const cam = this.camera.position;
    const auX = cam.x / AU_SCENE;
    const auY = cam.y / AU_SCENE;
    const auZ = cam.z / AU_SCENE;

    const fmtCoord = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(4) + ' AU';
    this.posXEl.textContent = fmtCoord(auX);
    this.posYEl.textContent = fmtCoord(auY);
    this.posZEl.textContent = fmtCoord(auZ);

    const AU_KM = 149597870.7;
    const bodies: { name: string; symbol: string; color: string }[] = [
      { name: 'Sun', symbol: '☉', color: 'rgba(255,213,79,0.7)' },
      { name: 'Moon', symbol: '☽', color: 'rgba(200,200,195,0.7)' },
      ...PLANETS.map(p => ({ name: p.name, symbol: p.symbol, color: p.color })),
    ];

    let minDist = Infinity;
    let nearestName = '';
    let nearestSymbol = '';
    let nearestColor = '';

    for (const body of bodies) {
      const pos = this.getBodyScenePos(body.name);
      const d = cam.distanceTo(pos);
      if (d < minDist) {
        minDist = d;
        nearestName = body.name;
        nearestSymbol = body.symbol;
        nearestColor = body.color;
      }
    }

    const nearestAU = minDist / AU_SCENE;
    const nearestKm = nearestAU * AU_KM;
    let distStr: string;
    if (nearestAU < 0.001) {
      distStr = Math.round(nearestKm).toLocaleString() + ' km';
    } else if (nearestAU < 0.01) {
      distStr = nearestKm.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' km';
    } else {
      distStr = nearestAU.toFixed(4) + ' AU';
    }

    const symbolEl = this.posNearestEl.querySelector('.cm-pos-body-symbol') as HTMLElement;
    const nameEl = this.posNearestEl.querySelector('.cm-pos-body-name') as HTMLElement;
    const distEl = this.posNearestEl.querySelector('.cm-pos-body-dist') as HTMLElement;
    symbolEl.textContent = nearestSymbol;
    symbolEl.style.color = nearestColor;
    nameEl.textContent = nearestName;
    distEl.textContent = distStr;

    const lookDir = !this.flightLocked
      ? new THREE.Vector3(0, 0, -1).applyQuaternion(this.flightQuat)
      : this.controls.target.clone().sub(cam).normalize();

    // Ecliptic heading (longitude) and pitch (latitude) from the look direction
    // eclToThree maps ecl(x,y,z) → three(x, z, -y), so inverse:
    // ecl X = three X, ecl Y = -three Z, ecl Z = three Y
    const eclLookX = lookDir.x;
    const eclLookY = -lookDir.z;
    let hdgRad = Math.atan2(eclLookY, eclLookX);
    if (hdgRad < 0) hdgRad += 2 * Math.PI;
    const hdgDeg = hdgRad * 180 / Math.PI;
    const pitDeg = Math.asin(Math.max(-1, Math.min(1, lookDir.y))) * 180 / Math.PI;

    this.posHdgEl.textContent = hdgDeg.toFixed(1) + '°';
    this.posPitEl.textContent = (pitDeg >= 0 ? '+' : '') + pitDeg.toFixed(1) + '°';

    let minAngle = Infinity;
    let facingName = '';
    let facingSymbol = '';
    let facingColor = '';
    for (const body of bodies) {
      const pos = this.getBodyScenePos(body.name);
      const toBody = pos.clone().sub(cam).normalize();
      const angle = lookDir.angleTo(toBody);
      if (angle < minAngle) {
        minAngle = angle;
        facingName = body.name;
        facingSymbol = body.symbol;
        facingColor = body.color;
      }
    }
    const facSymEl = this.posFacingEl.querySelector('.cm-pos-facing-symbol') as HTMLElement;
    const facNameEl = this.posFacingEl.querySelector('.cm-pos-facing-name') as HTMLElement;
    facSymEl.textContent = facingSymbol;
    facSymEl.style.color = facingColor;
    facNameEl.textContent = facingName;

    const sunDistScene = cam.length();
    const sunDistAU = sunDistScene / AU_SCENE;
    this.posSunDistEl.textContent = sunDistAU.toFixed(4) + ' AU';

    const sunKm = sunDistAU * AU_KM;
    const lightSec = sunKm / 299792.458;
    if (lightSec < 60) {
      this.posSunLightEl.textContent = lightSec.toFixed(1) + 's';
    } else {
      const m = Math.floor(lightSec / 60);
      const s = Math.round(lightSec % 60);
      this.posSunLightEl.textContent = m + 'm ' + (s < 10 ? '0' : '') + s + 's';
    }

    if (this.activeSnapKey) {
      const fp = `${auX.toFixed(3)}|${auY.toFixed(3)}|${auZ.toFixed(3)}|${hdgDeg.toFixed(0)}|${pitDeg.toFixed(0)}`;
      if (this.lastPosFingerprint && fp !== this.lastPosFingerprint) {
        this.resetSnapshot();
      }
      this.lastPosFingerprint = fp;
    } else {
      const fp = `${auX.toFixed(3)}|${auY.toFixed(3)}|${auZ.toFixed(3)}|${hdgDeg.toFixed(0)}|${pitDeg.toFixed(0)}`;
      this.lastPosFingerprint = fp;
    }
  }

  // ── Update scene from engine data ──

  private updateSceneData(): void {
    const date = new Date();
    this.data = computeSceneData(date, 36525);
    this.needsDataUpdate = false;

    const velocityDir = eclToThree(this.data.velocityDir).normalize();

    this.buildTrajectoryMeshes();
    this.rebuildMoonOrbit(date);
    this.rebuildPlanetOrbits(date);
    this.arrowHelper.setDirection(velocityDir);

    // Heliocentric layout: Sun at origin, Earth at absolute heliocentric position
    const earthScenePos = eclToThree(this.data.earthPos).multiplyScalar(AU_SCENE);
    this.earthGroup.position.copy(earthScenePos);

    // Sun direction from Earth (for lighting)
    const sunDirNorm = earthScenePos.clone().negate().normalize();

    // Sun at origin — label position updated in updatePerspectiveScaling

    // Planet positions — absolute heliocentric
    const planetPositions = computePlanetPositions(date);
    const planetAnglesForUI: { name: string; angle: number }[] = [];
    const planetOrbitsForUI: { name: string; periodDays: number; dayInOrbit: number; percentComplete: number }[] = [];
    let earthOrbitPeriod = 365.25;
    let earthOrbitPercent = 0;
    let earthOrbitalSpeed = 29.78;

    const earthPP = planetPositions.find(pp => pp.name === 'Earth');
    const earthPos = earthPP?.helioEcliptic ?? [0, 0, 0];
    if (earthPP) {
      earthOrbitPeriod = earthPP.periodDays;
      earthOrbitPercent = earthPP.percentComplete;
      earthOrbitalSpeed = earthPP.orbitalSpeedKmS;
    }

    const planetDataForUI: import('./ui/controls').PlanetPanelData[] = [];

    for (const pp of planetPositions) {
      planetAnglesForUI.push({ name: pp.name, angle: pp.orbitAngle });
      planetOrbitsForUI.push({ name: pp.name, periodDays: pp.periodDays, dayInOrbit: pp.dayInOrbit, percentComplete: pp.percentComplete });
      const pInfo = PLANETS.find(p => p.name === pp.name);
      if (pInfo) {
        const dx = pp.helioEcliptic[0] - earthPos[0];
        const dy = pp.helioEcliptic[1] - earthPos[1];
        const dz = pp.helioEcliptic[2] - earthPos[2];
        const distFromEarthAU = Math.sqrt(dx * dx + dy * dy + dz * dz);
        planetDataForUI.push({
          name: pp.name, symbol: pInfo.symbol, color: pInfo.color,
          distAU: pp.distanceAU,
          orbitalSpeedKmS: pp.orbitalSpeedKmS,
          perihelionAU: pp.perihelionAU,
          aphelionAU: pp.aphelionAU,
          solarIrradiance: pp.solarIrradiance,
          periodDays: pp.periodDays,
          dayInOrbit: pp.dayInOrbit,
          percentComplete: pp.percentComplete,
          distFromEarthAU,
          siderealRotationHours: pInfo.siderealRotationHours,
          axialTiltDeg: pInfo.axialTiltDeg,
          surfaceGravityMs2: pInfo.surfaceGravityMs2,
          escapeVelocityKmS: pInfo.escapeVelocityKmS,
          eccentricity: pInfo.eccentricity,
          inclinationDeg: pInfo.inclination,
        });
      }
      if (pp.name === 'Earth') continue;
      const pos = eclToThree(pp.helioEcliptic).multiplyScalar(AU_SCENE);
      const group = this.planetGroups.get(pp.name);
      if (group) group.position.copy(pos);
      const mesh = this.planetMeshes.get(pp.name);
      if (mesh) {
        const toSun = pos.clone().negate().normalize();
        (mesh.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(toSun);
        if (pp.name === 'Saturn') {
          const rings = this.planetMeshes.get('SaturnRings');
          if (rings) {
            (rings.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(toSun);
          }
        }
        const term = this.planetTerminators.get(pp.name);
        if (term) this.orientTerminator(term, toSun);
      }
    }

    // On first load, place camera near Earth looking toward the Sun
    if (this.firstLoad) {
      this.firstLoad = false;
      const camPos = new THREE.Vector3(
        0.9399 * AU_SCENE,
        0.0001 * AU_SCENE,
        0.3686 * AU_SCENE,
      );
      this.camera.position.copy(camPos);
      this.controls.target.copy(earthScenePos);
      this.controls.minDistance = 0.0005;
      this.controls.update();
    }

    // Earth lighting (sun direction in Earth-local space)
    (this.earth.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(sunDirNorm);
    (this.clouds.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(sunDirNorm);
    (this.atmosphere.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(sunDirNorm);
    (this.moonMesh.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(sunDirNorm);

    // Terminator lines — always orient so they're correct when toggled on
    this.orientTerminator(this.earthTerminator, sunDirNorm);
    this.moonTerminator.position.copy(this.moonMesh.position);
    this.orientTerminator(this.moonTerminator, sunDirNorm);

    // Sun beam from Earth to Sun (both in scenePivot world coords)
    const beamArr = new Float32Array([
      earthScenePos.x, earthScenePos.y, earthScenePos.z,
      0, 0, 0,
    ]);
    this.sunBeam.geometry.setAttribute('position', new THREE.BufferAttribute(beamArr, 3));

    // Orbital ring (legacy) — now redundant with Earth's orbit line in planetOrbitLines
    this.orbitalRing.visible = false;
    this.planetOrbitsGroup.position.set(0, 0, 0);
    this.planetOrbitsGroup.scale.set(AU_SCENE, AU_SCENE, AU_SCENE);

    // Sun distance label — along beam between Earth and Sun
    const sunMid = earthScenePos.clone().multiplyScalar(0.6);
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

    // Update per-planet beam lines and distance labels
    for (const pp of planetPositions) {
      if (pp.name === 'Earth') continue;
      const planetPos = this.planetGroups.get(pp.name)?.position;
      if (!planetPos) continue;

      const beam = this.planetBeams.get(pp.name);
      if (beam) {
        const arr = new Float32Array([planetPos.x, planetPos.y, planetPos.z, 0, 0, 0]);
        beam.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      }

      const distLabel = this.planetDistLabels.get(pp.name);
      if (distLabel) {
        const mid = planetPos.clone().multiplyScalar(0.6);
        mid.y += 2;
        distLabel.position.copy(mid);
        const pKm = pp.distanceAU * 149597870.7;
        const pLightSec = pKm / 299792.458;
        const pLightMin = Math.floor(pLightSec / 60);
        const pLightS = Math.round(pLightSec % 60);
        const ltStr = pLightMin > 0
          ? `${pLightMin}m ${String(pLightS).padStart(2, '0')}s`
          : `${pLightSec.toFixed(1)}s`;
        this.updateDistLabel(
          distLabel,
          `☉  ${(pKm / 1e6).toFixed(1)}M km  ·  ${ltStr} light`,
          `rgba(${this.planetColorCSS(pp.name)}, 0.85)`,
        );
      }
    }

    // Store planet trajectories for travel distance computation
    this.storedPlanetTrajectories = computePlanetTrajectories(date, 36525);

    // Moon phase: angle between Sun and Moon as seen from Earth
    // Sun direction from Earth = -earthPos (normalized)
    const sunV = new THREE.Vector3(-this.data.earthPos[0], -this.data.earthPos[1], -this.data.earthPos[2]).normalize();
    const moonV = new THREE.Vector3(...this.data.moonDir);
    const phaseAngle = sunV.angleTo(moonV);
    const cross = new THREE.Vector3().crossVectors(sunV, moonV);
    const moonPhaseWaxing = cross.z > 0;

    const moonAngle = Math.atan2(this.data.moonDir[1], this.data.moonDir[0]);

    // Moon
    const moonPos = eclToThree(this.data.moonDir).multiplyScalar(MOON_DIST);
    this.moonMesh.position.copy(moonPos);
    this.moonAxisLine.position.copy(moonPos);
    const moonR = EARTH_R * 0.27;
    const moonPoleEcl = poleToEclipticAxis(269.9949, 66.5392);
    const moonPoleDir = eclToThree(moonPoleEcl).normalize();
    this.moonSweep.position.copy(moonPos.clone().add(moonPoleDir.clone().multiplyScalar(moonR * 2.5)));

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
      orbitalSpeedKmS: earthOrbitalSpeed,
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
      planetAngles: planetAnglesForUI,
      planetOrbits: planetOrbitsForUI,
      planetData: planetDataForUI,
      earthOrbitPeriodDays: earthOrbitPeriod,
      earthOrbitPercent: earthOrbitPercent,
      currentBody: this.currentBody,
      moonAngle,
    });
    this.updateGhost();
  }

  private updateGhost(): void {
    if (!this.data) return;

    if (Math.abs(this.ghostOffsetHours) < 0.01) {
      this.ghostGroup.visible = false;
      this.earthTravelLabel.visible = false;
      this.sunTravelLabel.visible = false;
      for (const b of this.planetGhostBeams.values()) b.visible = false;
      for (const l of this.planetGhostDistLabels.values()) l.visible = false;
      for (const l of this.planetTravelLabels.values()) l.visible = false;
      return;
    }

    this.ghostGroup.visible = true;

    const ghostDate = new Date(Date.now() + this.ghostOffsetHours * 3600_000);
    const ghostData = computeSceneData(ghostDate, 0);

    // Galactic drift for ghost time offset — all bodies share this
    const ghostGalDir = eclToThree(this.data.solarGalacticDir).normalize();
    const ghostOffsetDays = this.ghostOffsetHours / 24;
    const ghostDriftPerDay = (this.data.solarGalacticSpeedKmS * 86400 / 149597870.7)
      / GALACTIC_VIS_COMPRESSION * AU_SCENE;
    const ghostDrift = ghostGalDir.clone().multiplyScalar(ghostOffsetDays * ghostDriftPerDay);

    // Update all planet positions to ghost-time positions + galactic drift
    const ghostPlanets = computePlanetPositions(ghostDate);
    const ghostAngles: { name: string; angle: number }[] = [];
    const ghostOrbits: { name: string; periodDays: number; dayInOrbit: number; percentComplete: number }[] = [];

    for (const pp of ghostPlanets) {
      ghostAngles.push({ name: pp.name, angle: pp.orbitAngle });
      ghostOrbits.push({ name: pp.name, periodDays: pp.periodDays, dayInOrbit: pp.dayInOrbit, percentComplete: pp.percentComplete });
      if (pp.name === 'Earth') continue;
      const scenePos = eclToThree(pp.helioEcliptic).multiplyScalar(AU_SCENE).add(ghostDrift.clone());
      const group = this.planetGroups.get(pp.name);
      if (group) group.position.copy(scenePos);
    }
    const ghostMoonAngle = Math.atan2(ghostData.moonDir[1], ghostData.moonDir[0]);
    this.ui.updateNav(ghostAngles, ghostOrbits, this.currentBody, ghostMoonAngle);

    // Ghost Earth — heliocentric position + same galactic drift
    const ghostPos = eclToThree(ghostData.earthPos).multiplyScalar(AU_SCENE).add(ghostDrift.clone());

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

    // Ghost axis line + pole sweep
    this.ghostAxisLine.position.copy(ghostPos);
    this.ghostAxisLine.quaternion.copy(tiltQuat);

    const axisLen = EARTH_R * 2.5;
    const axisUp = new THREE.Vector3(0, axisLen, 0).applyQuaternion(tiltQuat);
    this.ghostSweep.position.copy(ghostPos.clone().add(axisUp));
    this.ghostSweep.quaternion.copy(tiltQuat);

    // Ghost Sun direction from ghost Earth (Sun at origin)
    const ghostSunDir = ghostPos.clone().negate().normalize();
    (this.ghostEarth.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(ghostSunDir);
    (this.ghostClouds.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(ghostSunDir);
    (this.ghostAtmo.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(ghostSunDir);

    // Ghost Sun — on the Sun's galactic drift line at the ghost time offset
    const galDir = eclToThree(this.data.solarGalacticDir).normalize();
    const offsetDays = this.ghostOffsetHours / 24;
    const driftPerDay = (this.data.solarGalacticSpeedKmS * 86400 / 149597870.7)
      / GALACTIC_VIS_COMPRESSION * AU_SCENE;
    this.ghostSunWorldPos.copy(galDir.clone().multiplyScalar(offsetDays * driftPerDay));
    this.ghostSunSprite.position.copy(this.ghostSunWorldPos);
    this.ghostSunGlow.position.copy(this.ghostSunWorldPos);
    this.ghostSunLabel.position.copy(this.ghostSunWorldPos).add(new THREE.Vector3(0, SUN_TRUE_R + 0.5, 0));

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

    // Ghost Sun distance label — between ghost Earth and ghost Sun
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
    // Sun direction from Earth for phase = -earthPos (normalized)
    const gSunV = new THREE.Vector3(-ghostData.earthPos[0], -ghostData.earthPos[1], -ghostData.earthPos[2]).normalize();
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
    const ghostLabelOffset = EARTH_R * 2.5 * (this.ghostGroup.visible ? (this.ghostEarth.scale.x || 1) : 1) + 0.5;
    this.ghostLabel.position.copy(ghostPos).add(new THREE.Vector3(0, ghostLabelOffset, 0));
    this.updateGhostLabel(ghostDate);

    // Travel-distance labels
    const travel = this.computeTravelDistances(this.ghostOffsetHours);
    const primaryEarthPos = this.earthGroup.position.clone();

    // Earth travel label
    const earthMid = primaryEarthPos.clone().lerp(ghostPos, 0.5);
    const earthLineDir = ghostPos.clone().sub(primaryEarthPos).normalize();
    const earthPerp = new THREE.Vector3(-earthLineDir.z, 0, earthLineDir.x).normalize();
    earthMid.add(earthPerp.multiplyScalar(1.2));
    earthMid.y += 0.8;
    this.earthTravelLabel.position.copy(earthMid);
    this.earthTravelLabel.visible = true;
    const earthCamDist = this.camera.position.distanceTo(earthMid);
    const earthScale = Math.max(4, Math.min(12, earthCamDist * 0.35));
    this.earthTravelLabel.scale.set(earthScale, earthScale * 0.13, 1);
    this.updateDistLabel(
      this.earthTravelLabel,
      `⊕ ${this.fmtTravelDist(travel.earthKm)} traveled`,
      'rgba(130, 180, 255, 0.75)',
    );

    // Sun travel label — midpoint along galactic drift line
    const sunMidPt = this.ghostSunWorldPos.clone().multiplyScalar(0.5);
    sunMidPt.y += 2;
    this.sunTravelLabel.position.copy(sunMidPt);
    this.sunTravelLabel.visible = true;
    const sunCamDist = this.camera.position.distanceTo(sunMidPt);
    const sunScale = Math.max(5, Math.min(15, sunCamDist * 0.35));
    this.sunTravelLabel.scale.set(sunScale, sunScale * 0.13, 1);
    this.updateDistLabel(
      this.sunTravelLabel,
      `☉ ${this.fmtTravelDist(travel.sunKm)} traveled`,
      'rgba(255, 220, 130, 0.75)',
    );

    // Ghost beams, distance labels, and travel labels for non-Earth planets
    const offsetDaysFull = this.ghostOffsetHours / 24;
    for (const pp of ghostPlanets) {
      if (pp.name === 'Earth') continue;
      const planetScenePos = this.planetGroups.get(pp.name)?.position;
      if (!planetScenePos) continue;

      // Ghost beam from planet to ghost Sun
      const gBeam = this.planetGhostBeams.get(pp.name);
      if (gBeam) {
        const arr = new Float32Array([
          planetScenePos.x, planetScenePos.y, planetScenePos.z,
          this.ghostSunWorldPos.x, this.ghostSunWorldPos.y, this.ghostSunWorldPos.z,
        ]);
        gBeam.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        gBeam.visible = true;
      }

      // Ghost distance label
      const gDistLabel = this.planetGhostDistLabels.get(pp.name);
      if (gDistLabel) {
        const mid = planetScenePos.clone().lerp(this.ghostSunWorldPos, 0.4);
        mid.y += 1.5;
        gDistLabel.position.copy(mid);
        const pKm = pp.distanceAU * 149597870.7;
        const pLightSec = pKm / 299792.458;
        const pLightMin = Math.floor(pLightSec / 60);
        const pLightS = Math.round(pLightSec % 60);
        const ltStr = pLightMin > 0
          ? `${pLightMin}m ${String(pLightS).padStart(2, '0')}s`
          : `${pLightSec.toFixed(1)}s`;
        const css = this.planetColorCSS(pp.name);
        this.updateDistLabel(gDistLabel, `☉  ${(pKm / 1e6).toFixed(1)}M km  ·  ${ltStr} light`, `rgba(${css}, 0.6)`);
        gDistLabel.visible = true;
      }

      // Travel label
      const tLabel = this.planetTravelLabels.get(pp.name);
      if (tLabel) {
        const traj = this.storedPlanetTrajectories.find(t => t.name === pp.name);
        if (traj) {
          const travelKm = this.computePlanetTravelDist(traj.points, offsetDaysFull);
          const planet = PLANETS.find(p => p.name === pp.name);
          const sym = planet?.symbol ?? pp.name;
          const tMid = planetScenePos.clone();
          const pMesh = this.planetMeshes.get(pp.name);
          const pVisR = pMesh ? pMesh.scale.x * (planet?.sceneRadius ?? 0.5) : 1;
          tMid.y += pVisR * 2.5 + 0.5;
          tLabel.position.copy(tMid);
          const tCamDist = this.camera.position.distanceTo(tMid);
          const tScale = Math.max(4, Math.min(12, tCamDist * 0.35));
          tLabel.scale.set(tScale, tScale * 0.13, 1);
          const css = this.planetColorCSS(pp.name);
          this.updateDistLabel(tLabel, `${sym} ${this.fmtTravelDist(travelKm)} traveled`, `rgba(${css}, 0.75)`);
          tLabel.visible = true;
        }
      }
    }
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
    if (this.trajectoryMesh) { this.scenePivot.remove(this.trajectoryMesh); this.trajectoryMesh.geometry.dispose(); }
    if (this.trajectoryForwardMesh) { this.scenePivot.remove(this.trajectoryForwardMesh); this.trajectoryForwardMesh.geometry.dispose(); }
    if (this.trajectoryGlowPast) { this.scenePivot.remove(this.trajectoryGlowPast); this.trajectoryGlowPast.geometry.dispose(); }
    if (this.trajectoryGlowFuture) { this.scenePivot.remove(this.trajectoryGlowFuture); this.trajectoryGlowFuture.geometry.dispose(); }
    if (this.sunTrajectoryPast) { this.scenePivot.remove(this.sunTrajectoryPast); this.sunTrajectoryPast.geometry.dispose(); }
    if (this.sunTrajectoryFuture) { this.scenePivot.remove(this.sunTrajectoryFuture); this.sunTrajectoryFuture.geometry.dispose(); }

    const pts = this.data.trajectory;

    // Galactic drift direction & rate (compressed for visualization).
    // Data stays heliocentric — drift is applied only to the visual line.
    const galDir = eclToThree(this.data.solarGalacticDir).normalize();
    const driftPerDay = (this.data.solarGalacticSpeedKmS * 86400 / 149597870.7)
      / GALACTIC_VIS_COMPRESSION * AU_SCENE;

    // Earth trajectory: heliocentric orbit + compressed galactic drift → spiral
    const pastPts: THREE.Vector3[] = [];
    const futurePts: THREE.Vector3[] = [];

    for (const pt of pts) {
      const helioScene = eclToThree(pt.pos).multiplyScalar(AU_SCENE);
      const drift = galDir.clone().multiplyScalar(pt.dayOffset * driftPerDay);
      const v = helioScene.add(drift);
      if (pt.dayOffset <= 0.01) pastPts.push(v.clone());
      if (pt.dayOffset >= -0.01) futurePts.push(v);
    }

    if (pastPts.length >= 2) {
      const geo = new THREE.BufferGeometry().setFromPoints(pastPts);
      this.trajectoryMesh = new THREE.Mesh();
      this.trajectoryGlowPast = new THREE.Mesh();
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: 0x9c6dff, transparent: true, opacity: 0.55,
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
        color: 0x00e5ff, transparent: true, opacity: 0.6,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      this.scenePivot.add(line);
      this.trajectoryForwardMesh = line as unknown as THREE.Mesh;
    }

    // Sun trajectory — straight line through origin in the galactic drift direction
    const daysRange = pts.length > 0 ? Math.abs(pts[pts.length - 1].dayOffset) : 365;
    const sunExtend = daysRange * 1.3;
    const sunSteps = 300;
    const sunPastPts: THREE.Vector3[] = [];
    const sunFuturePts: THREE.Vector3[] = [];

    for (let i = -sunSteps; i <= sunSteps; i++) {
      const dayOff = (i / sunSteps) * sunExtend;
      const p = galDir.clone().multiplyScalar(dayOff * driftPerDay);
      if (dayOff <= 0.01) sunPastPts.push(p.clone());
      if (dayOff >= -0.01) sunFuturePts.push(p);
    }

    if (sunPastPts.length >= 2) {
      const geo = new THREE.BufferGeometry().setFromPoints(sunPastPts);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: 0xffa726, transparent: true, opacity: 0.2,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      this.sunTrajectoryPast = line as unknown as THREE.Mesh;
      this.scenePivot.add(line);
    }

    if (sunFuturePts.length >= 2) {
      const geo = new THREE.BufferGeometry().setFromPoints(sunFuturePts);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: 0xffcc00, transparent: true, opacity: 0.25,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      this.sunTrajectoryFuture = line as unknown as THREE.Mesh;
      this.scenePivot.add(line);
    }

    // Planet trajectories — spirals for all planets (same galactic drift as Earth)
    for (const old of this.planetTrajectoryLines) {
      this.scenePivot.remove(old);
      old.geometry.dispose();
    }
    this.planetTrajectoryLines = [];

    const planetTrajs = computePlanetTrajectories(new Date(), daysRange);
    for (const traj of planetTrajs) {
      const pPast: THREE.Vector3[] = [];
      const pFuture: THREE.Vector3[] = [];

      for (const pt of traj.points) {
        const helioScene = eclToThree(pt.pos).multiplyScalar(AU_SCENE);
        const drift = galDir.clone().multiplyScalar(pt.dayOffset * driftPerDay);
        const v = helioScene.add(drift);
        if (pt.dayOffset <= 0.01) pPast.push(v.clone());
        if (pt.dayOffset >= -0.01) pFuture.push(v);
      }

      const color = new THREE.Color(traj.color);

      if (pPast.length >= 2) {
        const geo = new THREE.BufferGeometry().setFromPoints(pPast);
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
          color, transparent: true, opacity: 0.25,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        this.scenePivot.add(line);
        this.planetTrajectoryLines.push(line);
      }

      if (pFuture.length >= 2) {
        const geo = new THREE.BufferGeometry().setFromPoints(pFuture);
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
          color, transparent: true, opacity: 0.30,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        this.scenePivot.add(line);
        this.planetTrajectoryLines.push(line);
      }
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
    canvas.width = 1024; canvas.height = 128;
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    return new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false, depthTest: false,
    }));
  }

  private updateDistLabel(sprite: THREE.Sprite, text: string, color = 'rgba(255,255,255,0.75)'): void {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.font = '600 44px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,1)';
    ctx.shadowBlur = 20;
    ctx.fillStyle = color;
    ctx.fillText(text, 512, 64);
    ctx.shadowBlur = 10;
    ctx.fillText(text, 512, 64);
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

  // ── Flight Mode ──

  private static readonly FLIGHT_SPEEDS = [
    { val: 0.001,  label: '150 km/s' },
    { val: 0.005,  label: '750 km/s' },
    { val: 0.02,   label: '3,000 km/s' },
    { val: 0.05,   label: '0.01c' },
    { val: 0.2,    label: '0.03 AU/s' },
    { val: 1.0,    label: '0.15 AU/s' },
    { val: 5.0,    label: '0.75 AU/s' },
    { val: 20.0,   label: '3 AU/s' },
    { val: 80.0,   label: '12 AU/s' },
    { val: 300.0,  label: '45 AU/s' },
  ];

  private static readonly FLIGHT_THRUST_KEYS = ['w', 's', 'a', 'd', 'r', 'f', 'q', 'e',
    'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];

  private breakLock(): void {
    if (!this.flightLocked) return;
    this.flightLocked = false;
    this.controls.enabled = false;
    this.flightQuat.copy(this.camera.quaternion);
    this.flightVelocity.set(0, 0, 0);
  }

  private initFlightControls(): void {
    this.flightSpeedLevel = 5;
    this.flightSpeed = CosmicMotionApp.FLIGHT_SPEEDS[this.flightSpeedLevel].val;

    window.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      this.flightKeys[key] = true;

      if (CosmicMotionApp.FLIGHT_THRUST_KEYS.includes(key)) {
        this.breakLock();
      }

      if (key === 'n' && !this.flightLocked) {
        this.flightNewton = !this.flightNewton;
        this.flightNewtonEl.textContent = this.flightNewton ? 'NEWTON ON' : 'DAMPED';
        this.flightNewtonEl.classList.toggle('cm-newton-on', this.flightNewton);
      }
    });

    window.addEventListener('keyup', (e) => {
      this.flightKeys[e.key.toLowerCase()] = false;
    });

    this.renderer.domElement.addEventListener('mousedown', (e) => {
      if (e.button !== 2) return;
      if (!this.flightLocked) {
        e.preventDefault();
        this.flightMouseDown = true;
        this.flightMousePrevX = e.clientX;
        this.flightMousePrevY = e.clientY;
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.flightLocked || !this.flightMouseDown) return;
      const precision = this.flightKeys['control'] ? 0.1 : 1.0;
      const dx = (e.clientX - this.flightMousePrevX) * 0.003 * precision;
      const dy = (e.clientY - this.flightMousePrevY) * 0.003 * precision;
      this.flightMousePrevX = e.clientX;
      this.flightMousePrevY = e.clientY;

      const pitchQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -dy);
      const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -dx);
      this.flightQuat.multiply(yawQ).multiply(pitchQ).normalize();
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.flightMouseDown = false;
    });

    this.renderer.domElement.addEventListener('contextmenu', (e) => {
      if (!this.flightLocked) e.preventDefault();
    });

    this.renderer.domElement.addEventListener('wheel', (e) => {
      if (this.flightLocked) return;
      e.preventDefault();
      const speeds = CosmicMotionApp.FLIGHT_SPEEDS;
      if (e.deltaY < 0 && this.flightSpeedLevel < speeds.length - 1) {
        this.flightSpeedLevel++;
      } else if (e.deltaY > 0 && this.flightSpeedLevel > 0) {
        this.flightSpeedLevel--;
      }
      this.flightSpeed = speeds[this.flightSpeedLevel].val;
      if (this.flightSpeedEl) {
        this.flightSpeedEl.textContent = speeds[this.flightSpeedLevel].label;
      }
    }, { passive: false });

    this.flightHintEl = document.createElement('div');
    this.flightHintEl.className = 'cm-flight-hint';
    this.flightHintEl.innerHTML = `
      <div class="cm-flight-hint-title">FLIGHT CONTROLS — 6DOF</div>
      <div class="cm-flight-hint-keys">
        <span>WASD</span> move &nbsp;
        <span>R/F</span> up/down &nbsp;
        <span>Q/E</span> roll<br>
        <span>Right-drag</span> look &nbsp;
        <span>Scroll</span> speed &nbsp;
        <span>Shift</span> boost<br>
        <span>Ctrl</span> precision &nbsp;
        <span>N</span> Newton toggle<br>
        Click a body to return to orbit
      </div>
      <div class="cm-flight-speed">Speed: <span class="cm-flight-speed-val">${CosmicMotionApp.FLIGHT_SPEEDS[this.flightSpeedLevel].label}</span></div>
      <div class="cm-flight-newton">DAMPED</div>
    `;
    this.flightHintEl.style.display = 'none';
    document.body.appendChild(this.flightHintEl);
    this.flightSpeedEl = this.flightHintEl.querySelector('.cm-flight-speed-val')!;
    this.flightNewtonEl = this.flightHintEl.querySelector('.cm-flight-newton')!;
  }

  private showFlightHint(fadeAfterMs: number): void {
    if (this.flightHintTimer) clearTimeout(this.flightHintTimer);
    this.flightHintEl.style.display = '';
    this.flightHintEl.classList.remove('cm-flight-hint-fade');
    void this.flightHintEl.offsetWidth;
    this.flightHintTimer = setTimeout(() => {
      this.flightHintEl.classList.add('cm-flight-hint-fade');
      this.flightHintTimer = null;
    }, fadeAfterMs);
  }

  private findNearestBody(): string {
    const cam = this.camera.position;
    const bodies = ['Sun', 'Earth', 'Moon', ...PLANETS.map(p => p.name)];
    let minDist = Infinity;
    let nearest = 'Earth';
    for (const name of bodies) {
      const pos = this.getBodyScenePos(name);
      const d = cam.distanceTo(pos);
      if (d < minDist) { minDist = d; nearest = name; }
    }
    return nearest;
  }

  private updateFlightMode(dt: number): void {
    if (this.flightLocked) return;

    const k = this.flightKeys;
    const precision = k['control'] ? 0.1 : 1.0;
    const boost = k['shift'] ? 5 : 1;
    const speed = this.flightSpeed * boost * precision * dt;

    // Roll via Q/E — true roll around camera forward axis
    const rollRate = 1.5 * dt * precision;
    if (k['q']) {
      const rollQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rollRate);
      this.flightQuat.multiply(rollQ).normalize();
    }
    if (k['e']) {
      const rollQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -rollRate);
      this.flightQuat.multiply(rollQ).normalize();
    }

    // Derive local axes from the quaternion
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.flightQuat);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.flightQuat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.flightQuat);

    // Accumulate thrust in camera-local space
    const accel = new THREE.Vector3();
    if (k['w'] || k['arrowup'])    accel.add(forward);
    if (k['s'] || k['arrowdown'])  accel.sub(forward);
    if (k['d'] || k['arrowright']) accel.add(right);
    if (k['a'] || k['arrowleft'])  accel.sub(right);
    if (k['r'])                    accel.add(up);
    if (k['f'])                    accel.sub(up);

    if (accel.lengthSq() > 0) {
      accel.normalize().multiplyScalar(speed);
      this.flightVelocity.add(accel);
    }

    if (!this.flightNewton) {
      this.flightVelocity.multiplyScalar(0.88);
    }

    if (this.flightVelocity.lengthSq() < 1e-14) {
      this.flightVelocity.set(0, 0, 0);
    }

    this.camera.position.add(this.flightVelocity);
    this.camera.quaternion.copy(this.flightQuat);

    const lookTarget = this.camera.position.clone().add(forward);
    this.controls.target.copy(lookTarget);

    const nearestBody = this.findNearestBody();
    const nearestPos = this.getBodyScenePos(nearestBody);
    const distToNearest = this.camera.position.distanceTo(nearestPos);
    this.camera.near = Math.min(0.1, Math.max(0.00001, distToNearest * 0.01));
    this.camera.updateProjectionMatrix();
  }

  // ── Animation loop ──

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    const delta = this.clock.getDelta();
    this._delta = delta;

    if (this.needsDataUpdate) this.updateSceneData();

    this.ui.tickPlayback();

    // Sun shader time
    this.sunTime += delta;
    (this.sunMesh.material as THREE.ShaderMaterial).uniforms.uTime.value = this.sunTime;
    (this.sunCorona.material as THREE.ShaderMaterial).uniforms.uTime.value = this.sunTime;

    // Starfield follows camera so stars are always at "infinite" distance
    this.starfield.position.copy(this.camera.position);
    this.starfield.quaternion.copy(this.scenePivot.quaternion);

    // Zoom-adaptive: orbit lines and planet glows adjust with camera distance
    const camDist = this.camera.position.length();
    // Orbit lines: fade in based on how far camera is from Sun (origin).
    // Visible as soon as camera can see the inner solar system (~15 units out).
    const orbitFade = Math.min(1, Math.max(0, (camDist - 15) / 60));
    for (const [name, line] of this.planetOrbitLines) {
      if (!this.showOrbits) {
        (line.material as THREE.LineBasicMaterial).opacity = 0;
        continue;
      }
      const baseLine = this.hoveredBody === name ? 0.5 : 0.12;
      (line.material as THREE.LineBasicMaterial).opacity = baseLine * orbitFade;
    }
    (this.moonOrbitLine.material as THREE.LineBasicMaterial).opacity = this.showOrbits ? 0.1 * orbitFade : 0;
    // Trajectory visibility toggle
    const trajVis = this.showTrajectories;
    if (this.trajectoryMesh) this.trajectoryMesh.visible = trajVis;
    if (this.trajectoryForwardMesh) this.trajectoryForwardMesh.visible = trajVis;
    if (this.trajectoryGlowPast) this.trajectoryGlowPast.visible = trajVis;
    if (this.trajectoryGlowFuture) this.trajectoryGlowFuture.visible = trajVis;
    if (this.sunTrajectoryPast) this.sunTrajectoryPast.visible = trajVis;
    if (this.sunTrajectoryFuture) this.sunTrajectoryFuture.visible = trajVis;
    for (const line of this.planetTrajectoryLines) line.visible = trajVis;

    // Terminator line visibility
    this.earthTerminator.visible = this.showTerminators;
    this.moonTerminator.visible = this.showTerminators;
    for (const [, term] of this.planetTerminators) term.visible = this.showTerminators;

    // Planet glows and body scaling handled in updatePerspectiveScaling()

    // Beam/label visibility — show only for focused body (or all if toggled)
    const ghostActive = this.ghostGroup.visible;
    const focusedBody = this.currentBody;

    // Sun label — hide when focused on the Sun
    this.sunLabel.visible = focusedBody !== 'Sun';

    // Earth beam/labels
    const earthShow = focusedBody === 'Earth' || this.showAllBeams;
    this.sunBeam.visible = earthShow;
    this.sunDistLabel.visible = earthShow;
    this.ghostSunBeam.visible = earthShow;
    this.ghostSunDistLabel.visible = earthShow;
    if (ghostActive) {
      this.earthTravelLabel.visible = earthShow;
    }

    // Planet beams/labels
    for (const [name, beam] of this.planetBeams) {
      const show = focusedBody === name || this.showAllBeams;
      beam.visible = show;
      const dl = this.planetDistLabels.get(name);
      if (dl) dl.visible = show;

      if (ghostActive) {
        const gb = this.planetGhostBeams.get(name);
        if (gb) gb.visible = show;
        const gdl = this.planetGhostDistLabels.get(name);
        if (gdl) gdl.visible = show;
        const tl = this.planetTravelLabels.get(name);
        if (tl) tl.visible = show;
      } else {
        const gb = this.planetGhostBeams.get(name);
        if (gb) gb.visible = false;
        const gdl = this.planetGhostDistLabels.get(name);
        if (gdl) gdl.visible = false;
        const tl = this.planetTravelLabels.get(name);
        if (tl) tl.visible = false;
      }
    }

    // When focused on Sun, hide all beams unless show-all is on
    if (focusedBody === 'Sun' && !this.showAllBeams) {
      this.sunBeam.visible = false;
      this.sunDistLabel.visible = false;
    }

    // Adaptive label scaling — keeps distance labels readable at any zoom
    this.scaleDistLabel(this.sunDistLabel);
    this.scaleDistLabel(this.moonDistLabel);
    this.scaleDistLabel(this.ghostSunDistLabel);
    this.scaleDistLabel(this.ghostMoonDistLabel);
    this.scaleDistLabel(this.earthTravelLabel);
    this.scaleDistLabel(this.sunTravelLabel);
    for (const l of this.planetDistLabels.values()) this.scaleDistLabel(l);
    for (const l of this.planetGhostDistLabels.values()) this.scaleDistLabel(l);
    for (const l of this.planetTravelLabels.values()) this.scaleDistLabel(l);

    // Navigation animation — four-phase target-and-charge
    if (this.isNavigating) {
      this.navTime += delta;
      const tGlobal = Math.min(1, this.navTime / this.navDuration);

      const P1_END = this.navP1;
      const P2_END = this.navP2;
      const P3_END = this.navP3;

      // Body switch at end of lock-on phase
      if (tGlobal >= P2_END && !this.navBodySwitched) {
        this.navBodySwitched = true;
        this.currentBody = this.navTargetBody;
        if (this.currentBody === 'Earth') this.moonHudVisible = true;
      }

      // FOV breathing: only during the charge phase
      const fovPeak = 4;
      let fovOffset = 0;
      if (tGlobal >= P2_END && tGlobal < P3_END) {
        const pt = (tGlobal - P2_END) / (P3_END - P2_END);
        fovOffset = fovPeak * Math.sin(pt * Math.PI);
      } else if (tGlobal >= P3_END) {
        const pt = (tGlobal - P3_END) / (1 - P3_END);
        fovOffset = fovPeak * 0.3 * (1 - pt);
      }
      this.camera.fov = this.navFovBase + fovOffset;
      this.camera.updateProjectionMatrix();

      // Update destination position each frame (bodies move)
      const destPos = this.getBodyScenePos(this.navTargetBody);

      if (tGlobal < P1_END) {
        // Phase 1 — Aim: slow theatrical pan, camera rotates to find the target
        // Smooth cubic ease that spends most of its time in slow drift
        const pt = tGlobal / P1_END;
        const ease = pt * pt * (3 - 2 * pt); // smoothstep — slow start, slow end
        this.controls.target.lerpVectors(this.navStartTarget, destPos, ease);

      } else if (tGlobal < P2_END) {
        // Phase 2 — Lock-on: target acquired, brief dramatic hold
        const pt = (tGlobal - P1_END) / (P2_END - P1_END);
        this.controls.target.lerpVectors(this.controls.target, destPos, 0.15);
        this.navLockOnSpin = pt;

      } else if (tGlobal < P3_END) {
        // Phase 3 — Charge: straight line from current pos to close orbit
        const pt = (tGlobal - P2_END) / (P3_END - P2_END);
        const ease = pt < 0.5
          ? 16 * pt * pt * pt * pt * pt
          : 1 - Math.pow(-2 * pt + 2, 5) / 2;

        const chargeDir = destPos.clone().sub(this.navStartCamPos).normalize();
        const trueR = this.bodyTrueRadius(this.navTargetBody);
        const sunPos = this.sunMesh.position.clone();
        const dts = sunPos.distanceTo(destPos);
        const viewDist = this.navTargetBody === 'Sun'
          ? Math.max(trueR * 8, trueR * 5)
          : this.navTargetBody === 'Moon'
            ? MOON_DIST * 1.5
            : Math.max(trueR * 8, Math.min(dts * 0.15, trueR * 30));
        this.navChargeEnd.copy(destPos).add(chargeDir.clone().negate().multiplyScalar(viewDist));

        this.camera.position.lerpVectors(this.navStartCamPos, this.navChargeEnd, ease);
        this.controls.target.copy(destPos);

      } else {
        // Phase 4 — Sun orient: slowly orbit left/right around the body
        // until the Sun is reasonably in view. Never flip — preserve our up.
        const pt = (tGlobal - P3_END) / (1 - P3_END);
        const ease = pt * pt * pt; // cubic — slow and deliberate

        if (this.navTargetBody === 'Sun') {
          this.camera.position.lerp(this.navChargeEnd, 0.1);
        } else {
          const sunPos = this.sunMesh.position.clone();
          const toSun = sunPos.clone().sub(destPos);
          const dts = toSun.length();
          const sunDir = dts > 0.01 ? toSun.clone().normalize() : new THREE.Vector3(1, 0, 0);

          // Current offset from body to camera, projected onto the ecliptic plane
          const offset = this.camera.position.clone().sub(destPos);
          const dist = offset.length();

          // Desired direction: anti-Sun with a little elevation
          const desiredDir = sunDir.clone().negate();
          desiredDir.y = 0.25;
          desiredDir.normalize();

          // Compute the signed angle between current and desired in the XZ plane
          // to determine shortest rotation direction (left or right)
          const curFlat = new THREE.Vector2(offset.x, offset.z).normalize();
          const desFlat = new THREE.Vector2(desiredDir.x, desiredDir.z).normalize();
          const cross2d = curFlat.x * desFlat.y - curFlat.y * desFlat.x;
          const dot2d = curFlat.dot(desFlat);
          let angle = Math.atan2(cross2d, dot2d);

          // Only rotate as much as needed — cap to keep Sun "reasonably in view"
          // (within ~60deg of forward) rather than perfectly behind
          const maxAngle = Math.abs(angle);
          const rotAmount = maxAngle * ease;
          const rotSign = angle > 0 ? 1 : -1;

          // Rotate the offset around Y by the computed amount
          const cosA = Math.cos(rotSign * rotAmount);
          const sinA = Math.sin(rotSign * rotAmount);
          const rx = offset.x * cosA - offset.z * sinA;
          const rz = offset.x * sinA + offset.z * cosA;

          // Gently bring the elevation toward the desired
          const targetY = desiredDir.y * dist;
          const newY = offset.y + (targetY - offset.y) * ease * 0.5;

          this.camera.position.copy(destPos).add(
            new THREE.Vector3(rx, newY, rz).normalize().multiplyScalar(dist),
          );
        }
        this.controls.target.copy(destPos);
        this.navLockOnSpin = 0;
      }

      if (tGlobal >= 0.999) {
        this.isNavigating = false;
        this.navBodySwitched = false;
        this.navLockOnSpin = 0;
        this.controls.enabled = true;
        // Keep the position phase 4 settled into — don't snap to a precomputed pos
        this.controls.target.copy(destPos);
        this.camera.fov = this.navFovBase;
        this.camera.updateProjectionMatrix();
        if (this.currentBody !== this.navTargetBody) {
          this.currentBody = this.navTargetBody;
        }
      }
    }

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

    // Pole sweep + planet sweeps: log-mapped rotation speeds
    const earthSpeed = this.logRotationSpeed(23.9345);
    this.northSweep.rotation.y = performance.now() * earthSpeed;

    for (const [name, sweep] of this.planetSweeps) {
      const planet = PLANETS.find(p => p.name === name);
      if (!planet) continue;
      const speed = this.logRotationSpeed(planet.siderealRotationHours);
      sweep.rotation.y = performance.now() * speed;
    }

    // Moon sync rotation — sidereal period 655.7 hours (27.3 days)
    const moonRotSpeed = this.logRotationSpeed(655.7);
    this.moonSweep.rotation.y = performance.now() * moonRotSpeed;

    // Ghost sweep spins too
    if (this.ghostGroup.visible) {
      this.ghostSweep.rotation.y = performance.now() * 0.0018;
    }

    // Update location marker position every frame (rotates with Earth)
    this.updateLocationMarker();

    if (!this.flightLocked) {
      this.updateFlightMode(delta);
    } else if (this.followGhost && this.ghostGroup.visible) {
      const ghostDelta = this.ghostWorldPos.clone().sub(this.controls.target);
      this.controls.target.copy(this.ghostWorldPos);
      this.camera.position.add(ghostDelta);
    } else if (!this.followGhost && !this.isNavigating) {
      const bodyTarget = this.getBodyScenePos(this.currentBody);
      this.controls.target.lerp(bodyTarget, 0.06);
    }

    // Smoothly interpolate scene pivot toward target "up" frame
    this.upQuatCurrent.slerp(this.upQuatTarget, 0.06);
    this.scenePivot.quaternion.copy(this.upQuatCurrent);

    if (this.flightLocked) this.controls.update();

    this.updatePerspectiveScaling();

    this.renderer.render(this.scene, this.camera);

    this.updateHUD();
    this.updateHUDStats();
    this.updateMoonHUD();
    this.updatePositionIndicator();
  };
}
