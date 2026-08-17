/**
 * Sun, sky and the day/night cycle.
 *
 * The sun's position comes from the standard solar-geometry equations for the
 * given day of year, solar time and latitude, then gets rotated into the
 * scene by the site's north offset. That means the shadow falling across the
 * terrace at 17:00 in June is where it will actually be — which is usually the
 * whole reason for putting a garden in 3D in the first place.
 */

import * as THREE from 'three';
import type { EnvironmentSettings, SiteSettings } from '../core/types';

export interface SunState {
  /** Degrees above the horizon; negative when the sun is down. */
  elevation: number;
  /** Compass bearing in degrees, 0 = north, 90 = east. */
  azimuth: number;
  /** Unit vector from the garden towards the sun, in scene space. */
  direction: THREE.Vector3;
  night: boolean;
  /** 0 at night, 1 in full midday sun. */
  daylight: number;
}

const DEG = Math.PI / 180;

/** Solar declination for a day of the year, in degrees (Cooper's equation). */
function declination(dayOfYear: number): number {
  return 23.45 * Math.sin(((360 / 365) * (284 + dayOfYear)) * DEG);
}

/** Sun elevation and azimuth for a moment and place. */
export function solarPosition(
  dayOfYear: number,
  timeMinutes: number,
  latitude: number,
): { elevation: number; azimuth: number } {
  const decl = declination(dayOfYear) * DEG;
  const lat = latitude * DEG;
  // Hour angle: 0 at solar noon, 15° per hour, positive in the afternoon.
  const hourAngle = (timeMinutes / 60 - 12) * 15 * DEG;

  const sinElevation =
    Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinElevation)));

  const cosAzimuth =
    (Math.sin(decl) * Math.cos(lat) - Math.cos(decl) * Math.sin(lat) * Math.cos(hourAngle)) /
    Math.max(1e-6, Math.cos(elevation));
  let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAzimuth)));
  // Before solar noon the sun is in the east; after it, mirror to the west.
  if (hourAngle > 0) azimuth = Math.PI * 2 - azimuth;

  return { elevation: elevation / DEG, azimuth: azimuth / DEG };
}

/**
 * Converts a compass bearing to a scene direction.
 * The -Z axis points along the site's `northOffset` bearing.
 */
function bearingToScene(bearingDeg: number, northOffset: number, elevationDeg: number): THREE.Vector3 {
  const theta = (bearingDeg - northOffset) * DEG;
  const cosEl = Math.cos(elevationDeg * DEG);
  return new THREE.Vector3(
    Math.sin(theta) * cosEl,
    Math.sin(elevationDeg * DEG),
    -Math.cos(theta) * cosEl,
  );
}

/** Colour stops for direct sunlight, keyed by elevation in degrees. */
const SUN_COLORS: { at: number; color: string; intensity: number }[] = [
  { at: -6, color: '#2b3a5c', intensity: 0.0 },
  { at: -2, color: '#7a3b57', intensity: 0.04 },
  { at: 0, color: '#ff7a3d', intensity: 0.35 },
  { at: 2, color: '#ff9152', intensity: 0.75 },
  { at: 4, color: '#ff9d52', intensity: 1.0 },
  { at: 10, color: '#ffc078', intensity: 1.9 },
  { at: 20, color: '#ffdcae', intensity: 2.6 },
  { at: 40, color: '#fff2dc', intensity: 3.1 },
  { at: 90, color: '#fffaf0', intensity: 3.3 },
];

/** Sky zenith / horizon colours through the day. Extra stops either side of the
 * horizon give sunrise and sunset a proper "blue hour" and "golden hour" band
 * to pass through, instead of jumping straight from night-blue to day-blue. */
const SKY_COLORS: { at: number; top: string; bottom: string }[] = [
  { at: -18, top: '#070b16', bottom: '#0d1424' },
  { at: -6, top: '#101a33', bottom: '#2b2f4d' },
  { at: -3, top: '#182449', bottom: '#5a3a54' },
  { at: -1, top: '#26365e', bottom: '#7d5a6b' },
  { at: 1, top: '#35507f', bottom: '#f0895f' },
  { at: 3, top: '#3f6191', bottom: '#e0885c' },
  { at: 10, top: '#4f83bd', bottom: '#c9c1a8' },
  { at: 30, top: '#3e7cc4', bottom: '#bcd4e6' },
  { at: 90, top: '#2f6fbd', bottom: '#b9d3ea' },
];

function sampleStops<T extends { at: number }>(stops: T[], value: number): [T, T, number] {
  if (value <= stops[0].at) return [stops[0], stops[0], 0];
  for (let i = 1; i < stops.length; i++) {
    if (value <= stops[i].at) {
      const span = stops[i].at - stops[i - 1].at;
      return [stops[i - 1], stops[i], span < 1e-6 ? 0 : (value - stops[i - 1].at) / span];
    }
  }
  const last = stops[stops.length - 1];
  return [last, last, 0];
}

const SKY_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uBottom;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform float uSunVisible;
  uniform float uTime;
  uniform float uCloudiness;
  uniform vec3 uCloudLit;
  uniform vec3 uCloudShadow;
  uniform float uHorizonStrength;
  uniform float uNightVisible;
  uniform vec3 uMoonDirection;
  varying vec3 vWorld;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      v += amp * valueNoise(p);
      p *= 2.05;
      amp *= 0.55;
    }
    return v;
  }

  // Sparse pseudo-random points on the dome, quantised per direction cell.
  float stars(vec3 dir) {
    vec3 p = dir * 190.0;
    vec3 cell = floor(p);
    vec3 f = fract(p) - 0.5;
    float h = hash13(cell);
    vec3 jitter = vec3(hash13(cell + 1.7), hash13(cell + 8.3), hash13(cell + 4.1)) - 0.5;
    float d = length(f - jitter * 0.7);
    float dot_ = smoothstep(0.06, 0.0, d) * step(0.985, h);
    float twinkle = 0.55 + 0.45 * sin(uTime * 2.4 + h * 60.0);
    return dot_ * twinkle;
  }

  void main() {
    vec3 dir = normalize(vWorld);
    // Bias the gradient towards the horizon so the band reads naturally.
    float h = clamp(dir.y * 1.15 + 0.08, 0.0, 1.0);
    vec3 sky = mix(uBottom, uTop, pow(h, 0.55));

    // Atmospheric glow that hugs the horizon around sunrise/sunset, visible
    // even away from the sun itself, the way real skies wash pink all round.
    float band = exp(-abs(dir.y) * 5.0);
    sky += uSunColor * band * uHorizonStrength;

    // Clouds live on an imaginary flat layer above the garden: project the
    // view ray onto it so cloud shapes stretch near the horizon like real
    // ones do, and drift them slowly over time.
    float ch = max(dir.y, 0.05);
    vec2 cloudUv = dir.xz / ch * 0.07 + uTime * vec2(0.012, 0.005);
    float n = fbm(cloudUv);
    float edge = mix(0.86, 0.16, clamp(uCloudiness, 0.0, 1.0));
    float coverage = smoothstep(edge, edge + 0.22, n) * smoothstep(0.02, 0.15, uCloudiness);
    float verticalFade = smoothstep(-0.05, 0.15, dir.y) * (1.0 - smoothstep(0.7, 1.0, dir.y) * 0.5);
    float cloudAlpha = coverage * verticalFade;

    float sunFacing = clamp(dot(dir, normalize(uSunDirection)) * 0.5 + 0.5, 0.0, 1.0);
    vec3 cloudColor = mix(uCloudShadow, uCloudLit, pow(sunFacing, 1.4));
    cloudColor = mix(cloudColor, uSunColor, uHorizonStrength * 0.35 * verticalFade);
    sky = mix(sky, cloudColor, cloudAlpha);

    // Stars and moon show through gaps in the cloud, not underneath them.
    float clearPatch = 1.0 - cloudAlpha;
    sky += vec3(0.9, 0.93, 1.0) * stars(dir) * uNightVisible * clearPatch;

    float moonCos = dot(dir, normalize(uMoonDirection));
    float moonDisc = smoothstep(0.9985, 0.9995, moonCos);
    float moonHalo = pow(max(moonCos, 0.0), 300.0) * 0.5 + pow(max(moonCos, 0.0), 20.0) * 0.08;
    sky += vec3(0.85, 0.88, 1.0) * (moonDisc * 1.6 + moonHalo) * uNightVisible * clearPatch;

    // The sun's disc plus the halo around it, dimmed where cloud covers it.
    float cosAngle = dot(dir, normalize(uSunDirection));
    float disc = smoothstep(0.9994, 0.9997, cosAngle);
    float halo = pow(max(cosAngle, 0.0), 220.0) * 0.55 + pow(max(cosAngle, 0.0), 12.0) * 0.14;
    float obscure = clamp(coverage * 1.3, 0.0, 0.9);
    sky += uSunColor * (disc * 2.2 + halo) * uSunVisible * (1.0 - obscure);

    gl_FragColor = vec4(sky, 1.0);
  }
`;

export class SkySystem {
  readonly sun: THREE.DirectionalLight;
  readonly moon: THREE.DirectionalLight;
  readonly hemisphere: THREE.HemisphereLight;
  readonly ambient: THREE.AmbientLight;
  readonly dome: THREE.Mesh;
  private uniforms: Record<string, THREE.IUniform>;
  private state: SunState;
  private elapsed = 0;

  constructor(private scene: THREE.Scene) {
    this.sun = new THREE.DirectionalLight('#fff2dc', 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // A dim fill from the opposite side, standing in for moon and skylight.
    this.moon = new THREE.DirectionalLight('#7f9bd4', 0);
    scene.add(this.moon);
    scene.add(this.moon.target);

    this.hemisphere = new THREE.HemisphereLight('#bfd6ef', '#4a4436', 1);
    scene.add(this.hemisphere);

    this.ambient = new THREE.AmbientLight('#ffffff', 0.12);
    scene.add(this.ambient);

    this.uniforms = {
      uTop: { value: new THREE.Color('#3e7cc4') },
      uBottom: { value: new THREE.Color('#bcd4e6') },
      uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color('#fff2dc') },
      uSunVisible: { value: 1 },
      uTime: { value: 0 },
      uCloudiness: { value: 0 },
      uCloudLit: { value: new THREE.Color('#f4f2ee') },
      uCloudShadow: { value: new THREE.Color('#5c6472') },
      uHorizonStrength: { value: 0 },
      uNightVisible: { value: 0 },
      uMoonDirection: { value: new THREE.Vector3(0, 1, 0) },
    };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(500, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.dome.renderOrder = -1000;
    scene.add(this.dome);

    scene.fog = new THREE.Fog('#bcd4e6', 40, 260);

    this.state = {
      elevation: 45,
      azimuth: 180,
      direction: new THREE.Vector3(0, 1, 0),
      night: false,
      daylight: 1,
    };
  }

  get sunState(): SunState {
    return this.state;
  }

  /** Direct sunlight colour, unscaled by intensity — matches the dome's sun disc. */
  get sunColor(): THREE.Color {
    return this.uniforms.uSunColor.value as THREE.Color;
  }

  /** 0..1 fade used to hide the sun disc/halo around sunrise and sunset. */
  get sunVisible(): number {
    return this.uniforms.uSunVisible.value as number;
  }

  get skyTop(): THREE.Color {
    return this.uniforms.uTop.value as THREE.Color;
  }

  get skyBottom(): THREE.Color {
    return this.uniforms.uBottom.value as THREE.Color;
  }

  /** Advances cloud drift and star twinkle. Cheap enough to call every frame. */
  tick(delta: number) {
    this.elapsed += delta;
    this.uniforms.uTime.value = this.elapsed;
  }

  /** Recomputes lighting for the current environment. Returns the sun state. */
  update(environment: EnvironmentSettings, site: SiteSettings): SunState {
    const { elevation, azimuth } = solarPosition(
      environment.dayOfYear,
      environment.timeMinutes,
      site.latitude,
    );
    const direction = bearingToScene(azimuth, site.northOffset, elevation);
    const night = elevation < -0.8;
    // Ramps from 0 at 6° below the horizon to 1 at 8° above it.
    const daylight = clamp01((elevation + 6) / 14);

    const [a, b, t] = sampleStops(SUN_COLORS, elevation);
    const sunColor = new THREE.Color(a.color).lerp(new THREE.Color(b.color), t);
    const clouds = 1 - environment.cloudiness * 0.65;
    const intensity = (a.intensity + (b.intensity - a.intensity) * t) * clouds;

    this.sun.color.copy(sunColor);
    this.sun.intensity = Math.max(0, intensity);
    this.sun.visible = intensity > 0.01;
    this.sun.castShadow = environment.showShadows && intensity > 0.05;

    // Park the light well outside the garden so the shadow camera can be a
    // tight ortho box round the site instead of a huge, blurry one.
    const distance = Math.max(site.width, site.depth) * 1.6 + 20;
    this.sun.position.copy(direction).multiplyScalar(distance);
    this.sun.target.position.set(0, 0, 0);
    this.fitShadowCamera(site);

    this.moon.position.set(-direction.x * 40, 40, -direction.z * 40);
    this.moon.intensity = night ? 0.5 : 0;
    this.moon.visible = night;

    // Ambient and sky fill: enough to read the model at night without making
    // it look like daylight.
    const [skyA, skyB, skyT] = sampleStops(SKY_COLORS, elevation);
    const top = new THREE.Color(skyA.top).lerp(new THREE.Color(skyB.top), skyT);
    const bottom = new THREE.Color(skyA.bottom).lerp(new THREE.Color(skyB.bottom), skyT);
    // Overcast washes the sky towards flat grey.
    const overcast = new THREE.Color('#9aa3ad');
    top.lerp(overcast, environment.cloudiness * 0.6);
    bottom.lerp(overcast, environment.cloudiness * 0.5);

    (this.uniforms.uTop.value as THREE.Color).copy(top);
    (this.uniforms.uBottom.value as THREE.Color).copy(bottom);
    (this.uniforms.uSunDirection.value as THREE.Vector3).copy(direction);
    (this.uniforms.uSunColor.value as THREE.Color).copy(sunColor);
    this.uniforms.uSunVisible.value = clamp01((elevation + 2) / 3) * (1 - environment.cloudiness * 0.8);

    // Cloud layer: lit side leans towards the sun colour, shadowed side
    // towards the ambient sky; both flatten towards grey as it gets overcast.
    const cloudLit = new THREE.Color('#f4f2ee').lerp(sunColor, 0.22);
    const cloudShadow = new THREE.Color('#5c6472').lerp(bottom, 0.35);
    if (night) {
      cloudLit.lerp(new THREE.Color('#232a3d'), 0.8);
      cloudShadow.lerp(new THREE.Color('#12151f'), 0.85);
    }
    cloudLit.lerp(overcast, environment.cloudiness * 0.5);
    cloudShadow.lerp(overcast.clone().multiplyScalar(0.6), environment.cloudiness * 0.5);
    (this.uniforms.uCloudLit.value as THREE.Color).copy(cloudLit);
    (this.uniforms.uCloudShadow.value as THREE.Color).copy(cloudShadow);
    this.uniforms.uCloudiness.value = environment.cloudiness;

    // A golden/rose glow that peaks right around sunrise and sunset and
    // fades at midday and deep night, dulled a little when it's overcast.
    const horizonBump = clamp01(1 - Math.abs(elevation - 2) / 10);
    this.uniforms.uHorizonStrength.value = horizonBump * horizonBump * (1 - environment.cloudiness * 0.7);

    // Stars and the moon disc fade in through nautical twilight and fade
    // back out under heavy cloud.
    this.uniforms.uNightVisible.value = clamp01((-elevation - 2) / 14) * (1 - environment.cloudiness * 0.85);
    (this.uniforms.uMoonDirection.value as THREE.Vector3).copy(direction).multiplyScalar(-1);

    // Skylight does most of the work on vertical surfaces outdoors: without a
    // strong hemisphere term every north-facing fence and wall crushes to
    // black under the tone mapping, which is not what a garden looks like.
    this.hemisphere.color.copy(top);
    this.hemisphere.groundColor.set(night ? '#15161c' : '#6b6350');
    this.hemisphere.intensity = 0.3 + daylight * (1.9 + environment.cloudiness * 0.8);
    this.ambient.intensity = night ? 0.12 : 0.12 + daylight * 0.3;

    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(bottom);
      this.scene.fog.near = 40;
      this.scene.fog.far = 260;
    }

    this.state = { elevation, azimuth, direction, night, daylight };
    return this.state;
  }

  /** Sizes the shadow frustum to the site so shadows stay crisp. */
  private fitShadowCamera(site: SiteSettings) {
    const radius = Math.hypot(site.width, site.depth) / 2 + 6;
    const camera = this.sun.shadow.camera;
    camera.left = -radius;
    camera.right = radius;
    camera.top = radius;
    camera.bottom = -radius;
    camera.near = 1;
    camera.far = radius * 6 + 60;
    camera.updateProjectionMatrix();
  }

  dispose() {
    this.dome.geometry.dispose();
    (this.dome.material as THREE.Material).dispose();
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Sunrise and sunset in minutes from midnight, or null on a polar day. */
export function sunTimes(
  dayOfYear: number,
  latitude: number,
): { sunrise: number; sunset: number } | null {
  const decl = declination(dayOfYear) * DEG;
  const lat = latitude * DEG;
  const cosHour = -Math.tan(lat) * Math.tan(decl);
  if (cosHour < -1 || cosHour > 1) return null;
  const hourAngle = Math.acos(cosHour) / DEG / 15;
  return { sunrise: (12 - hourAngle) * 60, sunset: (12 + hourAngle) * 60 };
}
