import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { World, SimEvent } from '../sim/world';
import { Vehicle } from '../sim/vehicle';
import { R_E, R_M } from '../sim/constants';
import { Space } from './space';
import { RegionView } from './regions';
import { Mats } from './materials';
import { envGradient } from './textures';
import { buildStage, StageMesh } from './vehiclemesh';
import { Particles, plumeMaterial, plumeGeometry, plasmaMaterial } from './fx';
import { skyColorJS, sunTransmittance } from './atmo';
import { QualityPreset, currentPreset } from './quality';
import { clamp } from '../core/util';
import { Flare } from './flare';

export type CamMode = 'chase' | 'tower' | 'onboard' | 'drone' | 'free' | 'map';
export const CAM_LABELS: Record<CamMode, string> = { chase: 'Volgcamera', tower: 'Torencamera', onboard: 'Boordcamera', drone: 'Dronecamera', free: 'Vrije camera', map: 'Kaart' };

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion();

interface VView {
  v: Vehicle; group: THREE.Group; stages: StageMesh[]; nStages: number;
  plumes: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; st: number; ei: number }[];
  plumeMats: THREE.ShaderMaterial[];
  plasma: THREE.Mesh; vapor: THREE.Mesh; glow: THREE.PointLight; marker: THREE.Sprite;
  dead: boolean; deathT: number;
}
interface Debris { mesh: THREE.Mesh; p: THREE.Vector3; v: THREE.Vector3; w: THREE.Vector3; t: number; smoke: boolean }

export class View {
  renderer: THREE.WebGLRenderer; composer: EffectComposer; bloom: UnrealBloomPass;
  scene = new THREE.Scene(); camera: THREE.PerspectiveCamera;
  qp: QualityPreset; mats: Mats; space: Space;
  world: World | null = null;
  regions = new Map<string, RegionView>();
  vviews = new Map<Vehicle, VView>();
  smoke: Particles; fire: Particles;
  debris: Debris[] = [];
  flashes: { light: THREE.PointLight; t: number; p: THREE.Vector3 }[] = [];
  origin = new THREE.Vector3();
  focus: Vehicle | null = null;
  camMode: CamMode = 'chase';
  camYaw = 0.6; camPitch = 0.12; camDist = 0; camFov = 55; zoom = 1;
  dronePos: THREE.Vector3 | null = null; droneRegion = '';
  camECI = new THREE.Vector3();
  time = 0; frameMs = 16; fps = 60; frames = 0; fpsT = 0;
  shake = 0;
  skyBright = 1;
  localUp = new THREE.Vector3(0, 1, 0);
  sunCol = new THREE.Color();
  mapGroup = new THREE.Group();
  onBeforeRender: (() => void) | null = null;
  replaySample: (() => void) | null = null;
  canvas: HTMLCanvasElement;
  lost = false;
  flare = new Flare();
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.qp = currentPreset();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance', alpha: false, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.qp.dprMax));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.qp.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault(); this.lost = true;
      // noodvangnet: volgende keer veiligere instellingen
      try { localStorage.setItem('ss_gfx_safe', '1'); } catch { /* */ }
      setTimeout(() => location.reload(), 600);
    });
    this.camera = new THREE.PerspectiveCamera(this.camFov, 1, 0.3, 1e12);
    this.scene.add(this.camera);
    const env = envGradient(this.renderer);
    this.mats = new Mats(env);
    const loader = new THREE.TextureLoader();
    this.space = new Space(this.renderer, loader, './', this.qp);
    this.scene.add(this.space.group);
    const sl = this.space.sunLight;
    sl.castShadow = this.qp.shadows;
    sl.shadow.mapSize.set(this.qp.shadowMap, this.qp.shadowMap);
    sl.shadow.bias = -0.0004; sl.shadow.normalBias = 0.05;
    this.scene.fog = new THREE.FogExp2(0xaabbcc, 0.00002);
    this.smoke = new Particles(this.qp.particles, false);
    this.fire = new Particles(Math.floor(this.qp.particles * 0.6), true);
    this.scene.add(this.smoke.mesh, this.fire.mesh, this.mapGroup);
    // nabewerking
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.qp.antialias ? 4 : 0 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.45, 0.5, 1.6);
    if (this.qp.bloom) this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  setWorld(w: World | null) {
    // opruimen
    for (const r of this.regions.values()) this.scene.remove(r.group);
    this.regions.clear();
    for (const vv of this.vviews.values()) this.scene.remove(vv.group);
    this.vviews.clear();
    for (const d of this.debris) this.scene.remove(d.mesh);
    this.debris = [];
    this.smoke.clear(); this.fire.clear();
    this.world = w;
    this.dronePos = null;
    if (!w) return;
    for (const def of w.regions) {
      const rv = new RegionView(def, this.mats, this.qp, w.towers);
      this.regions.set(def.id, rv);
      this.scene.add(rv.group);
    }
    w.on((e) => this.onEvent(e));
  }

  // ------------ Voertuigen ------------
  makeVView(v: Vehicle): VView {
    const group = new THREE.Group();
    const vv: VView = { v, group, stages: [], nStages: 0, plumes: [], plumeMats: [], plasma: null as any, vapor: null as any, glow: null as any, marker: null as any, dead: false, deathT: 0 };
    this.buildVehicle(vv);
    this.scene.add(group);
    this.vviews.set(v, vv);
    return vv;
  }
  buildVehicle(vv: VView) {
    const g = vv.group;
    while (g.children.length) g.remove(g.children[0]);
    vv.stages = []; vv.plumes = []; vv.plumeMats = [];
    const v = vv.v;
    let y = 0;
    const pg = plumeGeometry();
    v.stages.forEach((st, si) => {
      const name = st.spec.name.toLowerCase();
      const sm = buildStage(st.spec, this.mats, { hls: name.includes('hls'), crew: st.spec.cabin, hopper: st.spec.length < 25 && st.spec.kind === 'ship' });
      sm.group.position.y = y;
      g.add(sm.group);
      vv.stages.push(sm);
      const pm = plumeMaterial();
      vv.plumeMats.push(pm);
      st.engines.forEach((e, ei) => {
        const m = new THREE.Mesh(pg, pm);
        m.position.set(e.spec.x, y - (e.spec.kind === 'vac' ? 3.2 : 1.7) + 0.8, e.spec.z);
        m.visible = false; m.renderOrder = 7; m.frustumCulled = false;
        g.add(m);
        vv.plumes.push({ mesh: m, mat: pm, st: si, ei });
      });
      y += st.spec.length;
    });
    vv.nStages = v.stages.length;
    // terugkeerplasma
    const L = v.length, R = v.diameter / 2;
    const pl = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), plasmaMaterial());
    pl.scale.set(R * 1.5, L * 0.62, R * 1.7); pl.position.set(0, L * 0.5, R * 0.25);
    pl.visible = false; pl.renderOrder = 8; g.add(pl); vv.plasma = pl;
    // condensatiekegel (max-Q)
    const vc = new THREE.Mesh(new THREE.ConeGeometry(R * 2.2, L * 0.3, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    vc.position.y = L * 0.55; vc.rotation.x = Math.PI; g.add(vc); vv.vapor = vc;
    const gl = new THREE.PointLight(0xffaa66, 0, 600, 1.6); gl.position.y = -10; g.add(gl); vv.glow = gl;
    const mk = new THREE.Sprite(new THREE.SpriteMaterial({ color: v.role === 'booster' ? 0x66ccff : 0xffcc55, depthTest: false, sizeAttenuation: false, transparent: true }));
    mk.scale.set(0.02, 0.02, 1); mk.visible = false; mk.renderOrder = 50; g.add(mk); vv.marker = mk;
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh && !(o as any).material?.transparent && (o as any).material?.type !== 'ShaderMaterial') { o.castShadow = true; o.receiveShadow = true; } });
  }

  onEvent(e: SimEvent) {
    if ((e.kind === 'explode' || e.kind === 'rud') && e.vehicle) this.explode(e.vehicle);
    if (e.kind === 'boom') this.shake = Math.max(this.shake, 0.4);
    if (e.kind === 'stage' && e.vehicle) {
      // ontkoppelingswolk
      const p = e.vehicle.pos; const n = e.vehicle.nose(_v);
      for (let i = 0; i < 40; i++) this.fire.emit({ x: p.x, y: p.y, z: p.z }, { x: e.vehicle.vel.x + (Math.random() - 0.5) * 40 + n.x * -20, y: e.vehicle.vel.y + (Math.random() - 0.5) * 40, z: e.vehicle.vel.z + (Math.random() - 0.5) * 40 }, 1.2, 6, 30, 1, 0.6, 0.3, 1, 0.2);
    }
  }
  explode(v: Vehicle) {
    const vv = this.vviews.get(v);
    const p = v.pos.clone();
    const L = v.length;
    const n = v.nose(new THREE.Vector3());
    const air = v.tel.rho;
    const size = 10 + L * 0.8;
    const N = Math.floor(this.qp.particles * 0.15);
    for (let i = 0; i < N; i++) {
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(20 + Math.random() * 90);
      const at = p.clone().addScaledVector(n, Math.random() * L);
      this.fire.emit(at, { x: v.vel.x + d.x, y: v.vel.y + d.y, z: v.vel.z + d.z }, 1.2 + Math.random() * 2.2, size * 0.4, size * (1.2 + Math.random()), 1, 0.5 + Math.random() * 0.3, 0.15, 1.3, air > 0.01 ? 1.3 : 0.05);
      if (air > 1e-4) this.smoke.emit(at, { x: v.vel.x + d.x * 0.5, y: v.vel.y + d.y * 0.5, z: v.vel.z + d.z * 0.5 }, 8 + Math.random() * 14, size * 0.5, size * 2.5, 0.15, 0.13, 0.12, 0.9, 0.6, 4);
    }
    const light = new THREE.PointLight(0xffaa55, 2e7, 8000, 2);
    this.scene.add(light);
    this.flashes.push({ light, t: 0, p });
    // brokstukken
    for (let i = 0; i < 26; i++) {
      const s = 0.8 + Math.random() * 4;
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, s * (0.2 + Math.random()), s * 0.15), Math.random() < 0.7 ? this.mats.steel : this.mats.tiles);
      m.castShadow = true;
      this.scene.add(m);
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize();
      this.debris.push({ mesh: m, p: p.clone().addScaledVector(n, Math.random() * L), v: v.vel.clone().addScaledVector(dir, 20 + Math.random() * 70), w: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6), t: 0, smoke: Math.random() < 0.4 });
    }
    if (vv) { vv.dead = true; vv.group.visible = false; }
    this.shake = Math.max(this.shake, this.focus && this.focus.pos.distanceTo(p) < 5000 ? 1.5 : 0.3);
  }

  // ------------ Camera ------------
  cycleCam() {
    const order: CamMode[] = ['chase', 'tower', 'onboard', 'drone', 'free'];
    const i = order.indexOf(this.camMode);
    this.setCam(order[(i + 1) % order.length]);
  }
  setCam(m: CamMode) { this.camMode = m; this.dronePos = null; this.zoom = 1; }
  orbitInput(dx: number, dy: number) { this.camYaw -= dx * 0.006; this.camPitch = clamp(this.camPitch + dy * 0.005, -1.45, 1.45); }
  zoomInput(f: number) { this.zoom = clamp(this.zoom * f, 0.05, 60); }

  bodyCenter(body: 'earth' | 'moon', out: THREE.Vector3) {
    if (!this.world || body === 'earth') return out.set(0, 0, 0);
    return this.world.ephem.moonPos(this.world.t, out);
  }
  nearestRegion(p: THREE.Vector3) {
    if (!this.world) return null;
    let best: string | null = null, bd = Infinity;
    for (const r of this.world.regions) {
      const f = this.world.frames[r.id];
      const d = p.distanceTo(f.origin);
      if (d < bd) { bd = d; best = r.id; }
    }
    return best ? { id: best, d: bd } : null;
  }

  updateCamera(dt: number) {
    const w = this.world!; const v = this.focus!;
    const body = v.tel.body || 'earth';
    const c = this.bodyCenter(body, _v3);
    const up = this.localUp.copy(v.pos).sub(c).normalize();
    // lokale basis (oost, noord)
    const east = _v2.set(0, 1, 0).cross(up);
    if (east.lengthSq() < 1e-6) east.set(1, 0, 0);
    east.normalize();
    const north = new THREE.Vector3().crossVectors(up, east);
    const L = v.length;
    const cam = this.camera;
    const target = new THREE.Vector3().copy(v.pos).addScaledVector(v.nose(_v), L * 0.45);
    const dirFrom = (yaw: number, pitch: number) => new THREE.Vector3().addScaledVector(east, Math.cos(pitch) * Math.sin(yaw)).addScaledVector(north, Math.cos(pitch) * Math.cos(yaw)).addScaledVector(up, Math.sin(pitch));
    let pos = new THREE.Vector3();
    let look = target.clone();
    let fov = 55;
    let camUp = up.clone();
    let mode = this.camMode;
    const reg = this.nearestRegion(v.pos);
    if (mode === 'tower' && (!reg || reg.d > 120000)) mode = 'chase';
    if (mode === 'chase' || mode === 'free') {
      const dist = (L * 2.4 + 30) * this.zoom;
      let yaw = this.camYaw, pitch = this.camPitch;
      if (mode === 'chase' && v.tel.vSurf > 30 && v.state === 'flying') {
        // achter de vector aan
        const vd = v.vRel.clone().normalize();
        const off = vd.clone().multiplyScalar(-1).applyAxisAngle(up, this.camYaw - 0.6).addScaledVector(up, this.camPitch * 0.8).normalize();
        pos.copy(target).addScaledVector(off, dist);
      } else pos.copy(target).addScaledVector(dirFrom(yaw, pitch), dist);
    } else if (mode === 'tower') {
      const f = w.frames[reg!.id];
      const rv = this.regions.get(reg!.id)!;
      // vaste camera's: kies de dichtstbijzijnde pad
      const l = w.toLocal(reg!.id, v.pos, new THREE.Vector3());
      let best = rv.def.pads[0], bd = Infinity;
      for (const p of rv.def.pads) { const d = Math.hypot(l.x - p.x, l.z - p.z); if (d < bd) { bd = d; best = p; } }
      const cl = new THREE.Vector3(best.x + 420, rv.y(best.x + 420, best.z + 260) + 3, best.z + 260);
      if (best.kind === 'platform') cl.set(best.x - 300, 12, best.z + 200);
      pos = w.toWorld(reg!.id, cl, new THREE.Vector3());
      const dist = pos.distanceTo(target);
      fov = clamp(2 * Math.atan((L * 1.6 + 40) / dist) * 57.3, 0.4, 60) / this.zoom;
      camUp.copy(f.up);
    } else if (mode === 'onboard') {
      // klassieke livestream-camera: op de romp, kijkend naar achteren
      const top = v.length - (v.active.spec.kind === 'ship' ? 18 : 8);
      const lp = new THREE.Vector3(v.diameter / 2 + 1.2, Math.max(4, top * 0.55), 0).applyQuaternion(v.q);
      pos.copy(v.pos).add(lp);
      look = new THREE.Vector3().copy(v.pos).add(new THREE.Vector3(v.diameter / 2 - 0.4, -40, 0).applyQuaternion(v.q));
      camUp = new THREE.Vector3(1, 0, 0).applyQuaternion(v.q);
      fov = 75 / this.zoom;
    } else if (mode === 'drone') {
      // drone vliegt traag achter het voertuig aan (in lokaal frame)
      const regId = reg && reg.d < 60000 ? reg.id : '';
      const want = new THREE.Vector3().copy(target).addScaledVector(dirFrom(this.camYaw + 1.2, 0.05), (L * 4 + 80) * this.zoom);
      if (!this.dronePos || this.droneRegion !== regId) { this.dronePos = regId ? w.toLocal(regId, want) : want.clone().sub(v.pos); this.droneRegion = regId; }
      const cur = regId ? w.toWorld(regId, this.dronePos, new THREE.Vector3()) : this.dronePos.clone().add(v.pos);
      const k = 1 - Math.exp(-dt * 0.8);
      cur.lerp(want, k);
      if (regId) { const rv = this.regions.get(regId)!; const ll = w.toLocal(regId, cur); const gy = rv.y(ll.x, ll.z) + 4; if (ll.y < gy) ll.y = gy; this.dronePos = ll; pos = w.toWorld(regId, ll, new THREE.Vector3()); }
      else { this.dronePos = cur.clone().sub(v.pos); pos = cur; }
      fov = 50;
    } else if (mode === 'map') {
      const r = v.pos.length();
      const dist = Math.max(R_E * 3.2, r * 2.4) * this.zoom;
      const centerB = body === 'moon' && this.zoom < 0.4 ? c.clone() : new THREE.Vector3();
      pos.copy(centerB).addScaledVector(new THREE.Vector3(Math.cos(this.camPitch) * Math.sin(this.camYaw), Math.sin(this.camPitch), Math.cos(this.camPitch) * Math.cos(this.camYaw)), dist);
      look.copy(centerB);
      camUp.set(0, 1, 0);
      fov = 45;
    }
    // niet onder de grond
    if (mode !== 'map' && mode !== 'onboard' && reg && reg.d < 60000) {
      const rv = this.regions.get(reg.id)!;
      const ll = w.toLocal(reg.id, pos, new THREE.Vector3());
      const gy = Math.max(rv.y(ll.x, ll.z), rv.def.body === 'earth' && rv.def.water(ll.x, ll.z) ? 0 : -1e9) + 2;
      if (ll.y < gy) { ll.y = gy; w.toWorld(reg.id, ll, pos); }
    }
    this.camFov += (fov - this.camFov) * Math.min(1, dt * 4);
    if (Math.abs(fov - this.camFov) > 20) this.camFov = fov;
    cam.fov = this.camFov;
    // schudden
    if (this.shake > 0) {
      const s = this.shake * Math.min(1, 30 / Math.max(1, pos.distanceTo(target) / 10));
      pos.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
      this.shake = Math.max(0, this.shake - dt * 1.2);
    }
    this.camECI.copy(pos);
    // drijvende oorsprong
    this.origin.copy(mode === 'map' ? pos : v.pos);
    cam.position.copy(pos).sub(this.origin);
    cam.up.copy(camUp);
    cam.lookAt(_v.copy(look).sub(this.origin));
    cam.near = mode === 'map' ? 1000 : 0.3;
    cam.updateProjectionMatrix();
  }

  // ------------ Frame ------------
  render(dt: number) {
    this.time += dt;
    this.frames++; this.fpsT += dt;
    if (this.fpsT > 0.5) { this.fps = this.frames / this.fpsT; this.frames = 0; this.fpsT = 0; }
    const w = this.world;
    if (!w || !this.focus) { this.renderer.render(this.scene, this.camera); return; }
    this.updateCamera(dt);
    const o = this.origin;
    const ep = w.ephem;
    const sun = ep.sunDir(w.t, new THREE.Vector3());
    // kleuren van lucht/zon/mist op camerapositie (km)
    const camKm = [this.camECI.x / 1000, this.camECI.y / 1000, this.camECI.z / 1000];
    const camR = this.camECI.length();
    const camAlt = camR - R_E;
    const up = _v.copy(this.camECI).normalize();
    const st = sunTransmittance(camKm, [sun.x, sun.y, sun.z]);
    const sunElev = up.dot(sun);
    this.sunCol.setRGB(st[0], st[1], st[2]);
    this.space.sunLight.color.copy(this.sunCol);
    this.space.sunLight.intensity = 3.2;
    const zen = skyColorJS(camKm, [up.x, up.y, up.z], [sun.x, sun.y, sun.z], 8);
    const horDir = new THREE.Vector3().crossVectors(up, sun).cross(up);
    if (horDir.lengthSq() < 1e-6) horDir.set(1, 0, 0).cross(up);
    horDir.normalize().multiplyScalar(-1).addScaledVector(up, 0.02).normalize();
    const hor = skyColorJS(camKm, [horDir.x, horDir.y, horDir.z], [sun.x, sun.y, sun.z], 8);
    const bright = (zen[0] + zen[1] + zen[2]) / 3;
    this.skyBright = camAlt > 120000 ? 0 : clamp(bright * 4 + clamp(sunElev * 4 + 0.6, 0, 1) * clamp(1 - camAlt / 60000, 0, 1), 0, 1);
    const ambI = 0.15 + clamp(bright * 2, 0, 1) * 0.6;
    this.space.ambient.color.setRGB(zen[0] * 1.5 + 0.02, zen[1] * 1.5 + 0.02, zen[2] * 1.5 + 0.03);
    this.space.ambient.groundColor.setRGB(0.25 * st[0] * Math.max(0.05, sunElev) + 0.02, 0.22 * st[1] * Math.max(0.05, sunElev) + 0.02, 0.18 * st[2] * Math.max(0.05, sunElev) + 0.02);
    this.space.ambient.intensity = ambI;
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.setRGB(Math.min(1, hor[0]), Math.min(1, hor[1]), Math.min(1, hor[2]));
    fog.density = camAlt < 100000 && this.focus.tel.body === 'earth' ? 0.000022 * Math.exp(-Math.max(0, camAlt) / 7000) : 0;
    // ruimte
    const moonPos = ep.moonPos(w.t, new THREE.Vector3());
    this.space.update({ origin: o, camECI: this.camECI, camLocal: this.camera.position, sun, earthQ: ep.earthQuat(w.t, new THREE.Quaternion()), moonPos, moonQ: ep.moonQuat(w.t, new THREE.Quaternion()), t: w.t, skyBright: this.skyBright, pixelRatio: this.renderer.getPixelRatio() });
    // belichtingsaanpassing: in de ruimte iets donkerder (felle zon)
    this.renderer.toneMappingExposure = camAlt > 60000 ? 0.85 : 1.0;
    // regio's
    for (const [id, rv] of this.regions) {
      const f = w.frames[id];
      const dist = this.camECI.distanceTo(f.origin);
      const vis = dist < (rv.def.body === 'moon' ? 260000 : 700000);
      rv.group.visible = vis;
      if (!vis) continue;
      rv.group.position.copy(f.origin).sub(o);
      rv.group.quaternion.copy(f.quat);
      const sunLocal = sun.clone().applyQuaternion(f.inv);
      rv.update(this.time, sunLocal, 1 - clamp(sunLocal.y * 5 + 0.5, 0, 1));
      if (rv.waterMat) {
        const u = rv.waterMat.uniforms;
        u.uSun.value.copy(sun); u.uSunCol.value.copy(this.sunCol); u.uUp.value.copy(f.up);
        u.uSky.value.setRGB(zen[0], zen[1], zen[2]); u.uHorizon.value.setRGB(Math.min(1.2, hor[0]), Math.min(1.2, hor[1]), Math.min(1.2, hor[2]));
        u.uLight.value = clamp(sunLocal.y * 4 + 0.15, 0.05, 1);
        u.fogColor.value.copy(fog.color); u.fogDensity.value = fog.density;
      }
      if (rv.clouds) {
        rv.clouds.visible = camAlt < 40000;
        rv.clouds.traverse((c) => { const s = c as THREE.Sprite; if (s.isSprite) (s.material as THREE.SpriteMaterial).color.setRGB(this.sunCol.r * 0.7 + zen[0] + 0.15, this.sunCol.g * 0.7 + zen[1] + 0.15, this.sunCol.b * 0.7 + zen[2] + 0.15); });
      }
    }
    // schaduwen rond focus
    const sl = this.space.sunLight;
    const sh = Math.max(60, this.focus.length * 2.2);
    const scam = sl.shadow.camera as THREE.OrthographicCamera;
    scam.left = -sh; scam.right = sh; scam.top = sh; scam.bottom = -sh; scam.near = 1; scam.far = 12000; scam.updateProjectionMatrix();
    sl.position.copy(this.focus.pos).sub(o).addScaledVector(sun, 5000);
    sl.target.position.copy(this.focus.pos).sub(o);
    sl.castShadow = this.qp.shadows && camAlt < 60000;
    // voertuigen
    for (const v of w.vehicles) {
      let vv = this.vviews.get(v);
      if (!vv) { if (v.state === 'destroyed') continue; vv = this.makeVView(v); }
      if (vv.nStages !== v.stages.length) this.buildVehicle(vv);
      this.updateVehicle(vv, dt, sun);
    }
    // deeltjes
    this.smoke.originX = o.x; this.smoke.originY = o.y; this.smoke.originZ = o.z;
    this.fire.originX = o.x; this.fire.originY = o.y; this.fire.originZ = o.z;
    const fb = this.focus.tel.body;
    const airVel = w.surfaceVel(fb, this.focus.pos, new THREE.Vector3());
    const gUp = this.localUp.clone();
    this.smoke.up.copy(gUp); this.fire.up.copy(gUp);
    const pdt = Math.min(dt * w.warp, 0.1);
    this.smoke.update(pdt, null, airVel);
    this.fire.update(pdt, null, airVel);
    (this.smoke.mesh.material as THREE.ShaderMaterial).uniforms.uSunCol.value.copy(this.sunCol).multiplyScalar(Math.max(0.1, sunElev + 0.2));
    (this.smoke.mesh.material as THREE.ShaderMaterial).uniforms.uAmb.value.copy(this.space.ambient.color).multiplyScalar(0.8);
    // brokstukken
    const g = new THREE.Vector3();
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.t += pdt;
      w.ephem.gravity(d.p, w.t, g);
      d.v.addScaledVector(g, pdt);
      const sv = w.surfaceVel('earth', d.p, _v2);
      const rel = _v3.copy(d.v).sub(sv);
      const alt = d.p.length() - R_E;
      if (alt < 80000) d.v.addScaledVector(rel, -Math.min(1, pdt * 0.4 * Math.exp(-alt / 8000)));
      d.p.addScaledVector(d.v, pdt);
      d.mesh.position.copy(d.p).sub(o);
      d.mesh.rotation.x += d.w.x * pdt; d.mesh.rotation.y += d.w.y * pdt; d.mesh.rotation.z += d.w.z * pdt;
      if (d.smoke && d.t < 6 && Math.random() < 0.5) this.smoke.emit(d.p, sv, 6, 3, 14, 0.12, 0.11, 0.1, 0.7, 1, 1);
      const reg = this.nearestRegion(d.p);
      let ground = false;
      if (reg && reg.d < 50000) { const rv = this.regions.get(reg.id)!; const l = w.toLocal(reg.id, d.p, _v2); if (l.y < Math.max(rv.y(l.x, l.z), 0) + 0.5) ground = true; }
      else if (alt < 0) ground = true;
      if (ground) { d.v.set(0, 0, 0); if (d.t > 40) { this.scene.remove(d.mesh); this.debris.splice(i, 1); } d.v.copy(sv); }
      if (d.t > 60) { this.scene.remove(d.mesh); this.debris.splice(i, 1); }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]; f.t += dt;
      f.light.position.copy(f.p).sub(o);
      f.light.intensity = 2e7 * Math.exp(-f.t * 2.5);
      if (f.t > 3) { this.scene.remove(f.light); this.flashes.splice(i, 1); }
    }
    this.onBeforeRender?.();
    this.composer.render(dt);
    // lensflare: zon in beeld en niet achter een hemellichaam
    if (this.camMode !== 'map') {
      const sp = this.camera.position.clone().addScaledVector(sun, 1e9).project(this.camera);
      if (sp.z < 1 && Math.abs(sp.x) < 1.2 && Math.abs(sp.y) < 1.2) {
        const st2 = sunTransmittance(camKm, [sun.x, sun.y, sun.z]);
        let vis = (st2[0] + st2[1] + st2[2]) / 3;
        // Maan blokkeert?
        const mp = moonPos.clone().sub(this.camECI); const along = mp.dot(sun);
        if (along > 0 && mp.clone().addScaledVector(sun, -along).length() < R_M) vis = 0;
        vis *= clamp(1.3 - Math.max(Math.abs(sp.x), Math.abs(sp.y)), 0, 1);
        this.flare.render(this.renderer, sp.x, sp.y, vis * 0.9, this.camera.aspect);
      }
    }
  }

  updateVehicle(vv: VView, dt: number, sun: THREE.Vector3) {
    const v = vv.v;
    const w = this.world!;
    if (v.state === 'destroyed') { vv.group.visible = false; return; }
    vv.group.visible = true;
    vv.group.position.copy(v.pos).sub(this.origin);
    vv.group.quaternion.copy(v.q);
    const map = this.camMode === 'map';
    vv.marker.visible = map;
    const T = v.tel;
    // motoren en pluimen
    let flameTot = 0;
    const plumeLenBase = (vac: boolean) => vac ? 60 : 30;
    const pAmb = T.pAmb / 101325;
    const vacK = clamp(1 - pAmb * 4, 0, 1);
    let ei = 0;
    let curSt = -1, curOffset = 0;
    for (const p of vv.plumes) {
      const st = v.stages[p.st];
      if (p.st !== curSt) { curSt = p.st; curOffset = ei; }
      const e = st?.engines[p.ei];
      ei++;
      if (!e) { p.mesh.visible = false; continue; }
      const on = e.on && !e.failed && e.spool > 0.05;
      p.mesh.visible = on && !map;
      const stm = vv.stages[p.st];
      if (stm) { const bm = stm.bellMats[p.ei]; if (bm) bm.emissive.setRGB(on ? 0.9 * e.spool : e.failed ? 0 : 0, on ? 0.25 * e.spool : 0, on ? 0.1 : 0); }
      if (!on) continue;
      const vac = e.spec.kind === 'vac';
      const thr = e.throttle * e.spool;
      flameTot += thr;
      const rex = vac ? 1.15 : 0.65;
      const len = plumeLenBase(vac) * (0.45 + 0.55 * thr) * (1 + vacK * 3);
      p.mesh.scale.set(rex, len, rex);
      p.mat.uniforms.uThr.value = 0.6 + thr * 0.4;
      p.mat.uniforms.uVac.value = vacK;
      p.mat.uniforms.uTime.value = this.time;
    }
    void curOffset;
    // klapvleugels / gridvinnen / poten
    for (const sm of vv.stages) {
      for (const f of sm.flaps) {
        const base = v.flapsOn && T.q > 50 ? 0.25 : 0.05;
        const ctrl = (f.fwd ? 1 : -1) * v.input.x * 0.35 + f.side * v.input.z * 0.25;
        f.obj.rotation.y = f.side * (base + ctrl) * (f.side > 0 ? -1 : 1) * 0.8;
      }
      for (const fn of sm.fins) fn.rotation.z = v.finsOut || v.state === 'flying' && v.role === 'booster' ? 0 : -1.2;
      for (const lg of sm.legs) { const target = v.legsDown ? 0.55 : 0.0; (lg.children[0] as THREE.Object3D).rotation.x += (target - lg.children[0].rotation.x) * Math.min(1, dt * 2); }
      if (sm.frost) sm.frost.visible = v.state === 'clamped' && v.stages[vv.stages.indexOf(sm)]?.prop > 0.4 * sm.spec.propMax;
      // gloeiend hitteschild
      if (sm.shield) { const st = v.stages[vv.stages.indexOf(sm)]; const tt = st ? clamp((st.shieldT - 900) / 900, 0, 1) : 0; (sm.shield.material as THREE.MeshStandardMaterial).emissive.setRGB(tt * 1.2, tt * 0.35, tt * 0.1); }
    }
    // plasma
    const hf = T.heatFlux || 0;
    const pl = clamp((hf - 8e4) / 6e5, 0, 1.5);
    vv.plasma.visible = pl > 0.01 && !map;
    if (vv.plasma.visible) {
      (vv.plasma.material as THREE.ShaderMaterial).uniforms.uI.value = pl;
      (vv.plasma.material as THREE.ShaderMaterial).uniforms.uTime.value = this.time;
      // plasma richting de luchtstroom
      if (Math.random() < pl * 0.8) {
        const p = v.pos.clone().addScaledVector(v.belly(_v2), v.diameter * 0.6).addScaledVector(v.nose(_v3), v.length * Math.random());
        this.fire.emit(p, { x: v.vel.x - v.vRel.x * 0.15, y: v.vel.y - v.vRel.y * 0.15, z: v.vel.z - v.vRel.z * 0.15 }, 0.5, v.diameter * 1.2, v.diameter * 4, 1, 0.4, 0.55, 0.6 * pl, 0);
      }
    }
    // condensatie rond Mach 1 in de lagere atmosfeer
    const vap = T.mach > 0.85 && T.mach < 1.35 && T.alt < 16000 && T.rho > 0.15 ? Math.sin((T.mach - 0.85) / 0.5 * Math.PI) * 0.45 : 0;
    (vv.vapor.material as THREE.MeshBasicMaterial).opacity += (vap - (vv.vapor.material as THREE.MeshBasicMaterial).opacity) * Math.min(1, dt * 4);
    vv.vapor.visible = (vv.vapor.material as THREE.MeshBasicMaterial).opacity > 0.01 && !map;
    // licht van de vlam
    vv.glow.intensity = flameTot > 0 ? Math.min(8e5, flameTot * 4e4) * (1 - vacK * 0.7) : 0;
    // rook en stoom
    if (flameTot > 0 && !map) this.emitExhaust(v, flameTot, vacK, dt);
    if (map) {
      // markeringsgrootte in kaartmodus
      vv.marker.scale.set(0.025, 0.025, 1);
    }
    void sun; void w;
  }

  emitExhaust(v: Vehicle, flame: number, vacK: number, dt: number) {
    const w = this.world!;
    const T = v.tel;
    const dn = v.nose(_v2).multiplyScalar(-1);
    const sv = w.surfaceVel(T.body, v.pos, _v3.set(0, 0, 0)).clone();
    const k = dt * Math.min(4, w.warp);
    // stoom/stofwolken aan de grond
    if (T.agl < 260 && T.body === 'earth') {
      const groundDist = Math.max(0, T.agl);
      const intensity = flame * clamp(1 - groundDist / 260, 0, 1);
      const n = Math.min(40, Math.floor(intensity * 1.2 * k * 60 * (this.qp.particles / 3000)) + (Math.random() < 0.5 ? 1 : 0));
      const up = this.localUp;
      const gp = v.pos.clone().addScaledVector(up, -groundDist);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const e1 = _v.set(1, 0, 0).cross(up).normalize().clone();
        const e2 = new THREE.Vector3().crossVectors(up, e1);
        const dir = e1.multiplyScalar(Math.cos(a)).addScaledVector(e2, Math.sin(a));
        const spd = 40 + Math.random() * 90;
        const pos = gp.clone().addScaledVector(dir, 5 + Math.random() * 10).addScaledVector(up, 2);
        this.smoke.emit(pos, { x: sv.x + dir.x * spd + up.x * 8, y: sv.y + dir.y * spd + up.y * 8, z: sv.z + dir.z * spd + up.z * 8 }, 9 + Math.random() * 10, 10, 55 + Math.random() * 40, 0.95, 0.94, 0.92, 0.75, 0.7, 2.5);
      }
    }
    // uitlaatspoor in de atmosfeer
    if (T.alt < 45000 && T.body === 'earth') {
      const n = Math.min(12, Math.floor(flame * 0.25 * k * 60 * (this.qp.particles / 3000)) + 1);
      const len = 30 * (1 + vacK * 3);
      for (let i = 0; i < n; i++) {
        const p = v.pos.clone().addScaledVector(dn, len * (0.6 + Math.random() * 0.6));
        p.x += (Math.random() - 0.5) * v.diameter; p.z += (Math.random() - 0.5) * v.diameter;
        const ev = v.vel.clone().addScaledVector(dn, 60 + Math.random() * 40);
        const thin = clamp(1 - T.alt / 45000, 0, 1);
        const s0 = v.diameter * 1.2, s1 = v.diameter * (4 + (1 - thin) * 20);
        this.smoke.emit(p, ev, 6 + thin * 20, s0, s1, 0.92, 0.9, 0.88, 0.35 + thin * 0.35, 0.4 * thin + 0.05, 0.5);
        if (Math.random() < 0.3) this.fire.emit(p, ev, 0.25, v.diameter, v.diameter * 3, 1, 0.55, 0.25, 0.5, 0.2);
      }
    }
  }

  // Screenshot (voor tests)
  snapshot() { return this.canvas.toDataURL('image/jpeg', 0.9); }
}
