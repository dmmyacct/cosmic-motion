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
  private ghostLabel!: THREE.Sprite;
  private sunLight!: THREE.PointLight;
  private sunSprite!: THREE.Sprite;
  private sunGlow!: THREE.Sprite;
  private moonMesh!: THREE.Mesh;
  private starfield!: THREE.Points;
  private arrowHelper!: THREE.ArrowHelper;
  private sunLabel!: THREE.Sprite;
  private sunBeam!: THREE.Line;
  private orbitalRing!: THREE.Line;
  private trajectoryGlowPast!: THREE.Mesh;
  private trajectoryGlowFuture!: THREE.Mesh;
  private sunTrajectoryPast!: THREE.Mesh;
  private sunTrajectoryFuture!: THREE.Mesh;

  private data!: SceneData;
  private ghostOffsetHours = 0;
  private camTarget: 'now' | 'ghost' = 'now';
  private camTargetPos = new THREE.Vector3();
  private ghostWorldPos = new THREE.Vector3();
  private camAzimuth = 0.4;
  private camElevation = 0.45;
  private camDist = 12;
  private dragging = false;
  private lastPtr = { x: 0, y: 0 };
  private forwardDir = new THREE.Vector3(0, 0, -1);
  private needsDataUpdate = true;

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

    this.scene.add(new THREE.AmbientLight(0x1a1a2e, 0.15));
    this.scene.add(new THREE.HemisphereLight(0x2244aa, 0x111122, 0.1));

    this.buildStarfield();
    this.buildEarth();
    this.buildSun();
    this.buildMoon();
    this.buildAxisLine();
    this.buildPoleSweeps();
    this.buildArrow();
    this.buildOrbitalRing();

    this.buildGhost();

    this.sunLabel = this.makeLabelSprite('☉', '#ffd54f');
    this.sunLabel.scale.set(1.4, 0.7, 1);
    this.scene.add(this.sunLabel);

    const beamGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 0),
    ]);
    this.sunBeam = new THREE.Line(beamGeo, new THREE.LineBasicMaterial({
      color: 0xffd54f, transparent: true, opacity: 0.12,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.scene.add(this.sunBeam);

    this.ui = createUI(container, {
      onTimeChange: (hours) => {
        this.ghostOffsetHours = hours;
        this.updateGhost();
      },
      onToggleFollow: () => {
        this.camTarget = this.camTarget === 'now' ? 'ghost' : 'now';
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
    this.scene.add(this.earth);

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
    this.scene.add(this.clouds);

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
    this.scene.add(this.orbitalRing);
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

    // Ghost date/time label
    this.ghostLabel = this.makeLabelSprite('', '#ffffff');
    this.ghostLabel.scale.set(2.5, 0.6, 1);
    this.ghostGroup.add(this.ghostLabel);

    this.scene.add(this.ghostGroup);
  }

  // ── Update scene from engine data ──

  private updateSceneData(): void {
    const date = new Date();
    this.data = computeSceneData(date, 365, 1);
    this.needsDataUpdate = false;

    this.forwardDir = eclToThree(this.data.velocityDir).normalize();

    this.buildTrajectoryMeshes();
    this.arrowHelper.setDirection(this.forwardDir);

    // Sun
    const sunPos = eclToThree(this.data.sunDir).multiplyScalar(SUN_DIST);
    this.sunLight.position.copy(sunPos);
    this.sunSprite.position.copy(sunPos);
    this.sunGlow.position.copy(sunPos);
    this.sunLabel.position.copy(sunPos).add(new THREE.Vector3(0, 5, 0));

    const sunDirNorm = eclToThree(this.data.sunDir).normalize();
    (this.earth.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(sunDirNorm);
    (this.clouds.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(sunDirNorm);
    (this.atmosphere.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(sunDirNorm);
    (this.moonMesh.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(sunDirNorm);

    const beamArr = new Float32Array([0, 0, 0, sunPos.x, sunPos.y, sunPos.z]);
    this.sunBeam.geometry.setAttribute('position', new THREE.BufferAttribute(beamArr, 3));

    // Orbital ring — centered on the Sun, in the ecliptic plane
    this.orbitalRing.position.copy(sunPos);

    // Moon
    const moonPos = eclToThree(this.data.moonDir).multiplyScalar(MOON_DIST);
    this.moonMesh.position.copy(moonPos);

    // Earth tilt
    const tiltAxis = eclToThree([1, 0, 0]).normalize();
    const tiltQuat = new THREE.Quaternion().setFromAxisAngle(tiltAxis, this.data.obliquity);
    this.earth.quaternion.copy(tiltQuat);
    this.clouds.quaternion.copy(tiltQuat);
    this.atmosphere.quaternion.copy(tiltQuat);
    this.poleSweepGroup.quaternion.copy(tiltQuat);
    this.axisLine.quaternion.copy(tiltQuat);

    this.ui.update({ speedKmS: this.data.speedKmS, date: new Date() });
    this.updateGhost();
  }

  private updateGhost(): void {
    if (!this.data) return;

    if (Math.abs(this.ghostOffsetHours) < 0.01) {
      this.ghostGroup.visible = false;
      return;
    }

    this.ghostGroup.visible = true;

    const ghostDate = new Date(Date.now() + this.ghostOffsetHours * 3600_000);
    const ghostData = computeSceneData(ghostDate, 0, 1);
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
    const ghostSunWorldPos = primarySunPos.clone().add(
      galDir.clone().multiplyScalar(offsetDays * driftPerDay),
    );
    this.ghostSunSprite.position.copy(ghostSunWorldPos);
    this.ghostSunGlow.position.copy(ghostSunWorldPos);
    this.ghostSunLabel.position.copy(ghostSunWorldPos).add(new THREE.Vector3(0, 4, 0));

    // Ghost sun beam — from ghost Earth toward ghost Sun
    const beamArr = new Float32Array([
      ghostPos.x, ghostPos.y, ghostPos.z,
      ghostSunWorldPos.x, ghostSunWorldPos.y, ghostSunWorldPos.z,
    ]);
    this.ghostSunBeam.geometry.setAttribute('position', new THREE.BufferAttribute(beamArr, 3));

    // Ghost Moon — position relative to ghost Earth
    const ghostMoonPos = eclToThree(ghostData.moonDir).multiplyScalar(MOON_DIST);
    this.ghostMoon.position.copy(ghostPos).add(ghostMoonPos);
    (this.ghostMoon.material as THREE.ShaderMaterial).uniforms.sunDirection.value.copy(ghostSunDir);

    // Ghost label
    this.ghostLabel.position.copy(ghostPos).add(new THREE.Vector3(0, EARTH_R * 2.5 + 0.5, 0));
    // Update label texture with ghost date
    this.updateGhostLabel(ghostDate);
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

    // Split Earth trajectory into past and future
    const pastPts: THREE.Vector3[] = [];
    const futurePts: THREE.Vector3[] = [];

    for (const pt of pts) {
      const earthV = eclToThree(pt.pos).multiplyScalar(AU_TO_SCENE);
      if (pt.dayOffset <= 0.01) pastPts.push(earthV);
      if (pt.dayOffset >= -0.01) futurePts.push(earthV);
    }

    // Earth past trajectory — thin purple thread
    if (pastPts.length >= 2) {
      const curve = new THREE.CatmullRomCurve3(pastPts);
      const geo = new THREE.TubeGeometry(curve, pastPts.length * 4, 0.03, 6, false);
      this.trajectoryMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0x9c6dff, transparent: true, opacity: 0.35,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      this.scene.add(this.trajectoryMesh);

      const glowGeo = new THREE.TubeGeometry(curve, pastPts.length * 4, 0.12, 6, false);
      this.trajectoryGlowPast = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({
        color: 0x7c4dff, transparent: true, opacity: 0.04,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
      }));
      this.scene.add(this.trajectoryGlowPast);
    }

    // Earth future trajectory — thin cyan thread
    if (futurePts.length >= 2) {
      const curve = new THREE.CatmullRomCurve3(futurePts);
      const geo = new THREE.TubeGeometry(curve, futurePts.length * 4, 0.04, 6, false);
      this.trajectoryForwardMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0x00e5ff, transparent: true, opacity: 0.45,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      this.scene.add(this.trajectoryForwardMesh);

      const glowGeo = new THREE.TubeGeometry(curve, futurePts.length * 4, 0.15, 6, false);
      this.trajectoryGlowFuture = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({
        color: 0x00bcd4, transparent: true, opacity: 0.05,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
      }));
      this.scene.add(this.trajectoryGlowFuture);
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
    const sunSteps = 60;
    for (let i = -sunSteps; i <= sunSteps; i++) {
      const dayOff = (i / sunSteps) * daysRange;
      const drift = galDir.clone().multiplyScalar(dayOff * driftPerDay);
      const p = sunPos.clone().add(drift);
      if (dayOff <= 0.01) sunPastPts.push(p.clone());
      if (dayOff >= -0.01) sunFuturePts.push(p);
    }

    // Sun past trajectory — single warm golden line
    if (sunPastPts.length >= 2) {
      const curve = new THREE.CatmullRomCurve3(sunPastPts);
      const geo = new THREE.TubeGeometry(curve, 64, 0.04, 6, false);
      this.sunTrajectoryPast = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffa726, transparent: true, opacity: 0.15,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      this.scene.add(this.sunTrajectoryPast);
    }

    // Sun future trajectory — single warm golden line
    if (sunFuturePts.length >= 2) {
      const curve = new THREE.CatmullRomCurve3(sunFuturePts);
      const geo = new THREE.TubeGeometry(curve, 64, 0.05, 6, false);
      this.sunTrajectoryFuture = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffcc00, transparent: true, opacity: 0.2,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      this.scene.add(this.sunTrajectoryFuture);
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

    // Camera target — smoothly follow NOW or GHOST Earth
    const targetPos = this.camTarget === 'ghost' && this.ghostGroup.visible
      ? this.ghostWorldPos : new THREE.Vector3(0, 0, 0);
    this.camTargetPos.lerp(targetPos, 0.08);

    // Camera orbit around target
    const fwd = this.forwardDir;
    const worldUp = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(fwd, worldUp).normalize();
    if (right.lengthSq() < 0.001) right.set(1, 0, 0);
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();

    const az = this.camAzimuth;
    const el = this.camElevation;
    const d = this.camDist;

    const camOffset = new THREE.Vector3()
      .addScaledVector(fwd, -Math.cos(el) * Math.cos(az))
      .addScaledVector(right, Math.cos(el) * Math.sin(az))
      .addScaledVector(up, Math.sin(el))
      .normalize()
      .multiplyScalar(d);

    this.camera.position.copy(this.camTargetPos).add(camOffset);
    this.camera.lookAt(this.camTargetPos);

    this.renderer.render(this.scene, this.camera);
  };
}
