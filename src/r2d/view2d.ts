// 2D-weergave (Canvas2D) in de stijl van Spaceflight Simulator, maar mooier: camera-relatief, DPR-begrensd
import * as THREE from 'three';
import { World, SimEvent } from '../sim/world';
import { Vehicle } from '../sim/vehicle';
import { R_E, R_M, MU_E, MU_M } from '../sim/constants';
import { elements, kepler } from '../sim/orbit';
import { clamp } from '../core/util';
import { loadTex, getTex, SphereBuffer } from './planet';
import { stageSprite, PPM, drawTower, drawOLM, drawTankFarm, drawHighBay, drawStand, drawPadSlab, drawPlatform, drawLunarPad, puffSprite, glowSprite, darkSprite } from './draw';

export type CamMode = 'chase' | 'tower' | 'onboard' | 'drone' | 'free' | 'map';
export const CAM_LABELS: Record<CamMode, string> = { chase: 'Volgcamera', tower: 'Torencamera', onboard: 'Dichtbij', drone: 'Overzicht', free: 'Vrije camera', map: 'Kaart' };

interface P { p: THREE.Vector3; v: THREE.Vector3; t: number; life: number; s0: number; s1: number; a: number; kind: 0 | 1 | 2; drag: number }
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const rgb = (r: number, g: number, b: number, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;

export class View2D {
  canvas: HTMLCanvasElement; x: CanvasRenderingContext2D;
  world: World | null = null; focus: Vehicle | null = null;
  camMode: CamMode = 'chase';
  camYaw = 0; camPitch = 0; zoom = 1; zoomS = 1; mapZoom = 1; mapZoomS = 1; cineSpin = 0; shake = 0;
  camECI = new THREE.Vector3();
  camera = { position: new THREE.Vector3(0, 0, 100) };
  dpr = 1; W = 390; H = 844;
  renderer = { getPixelRatio: () => this.dpr };
  fps = 60; frames = 0; fpsT = 0; time = 0;
  mapLines: { info: { apo: number; peri: number; body: string } | null; t: number } = { info: null, t: 0 };
  // basis
  up = new THREE.Vector3(0, 1, 0); tan = new THREE.Vector3(1, 0, 0); nrm = new THREE.Vector3(0, 0, 1); nS = new THREE.Vector3();
  center = new THREE.Vector3(); s = 4; // px (css) per m
  pan = new THREE.Vector2(); panIdle = 0;
  parts: P[] = []; maxParts = 520;
  dead = new Set<Vehicle>();
  flashes: { p: THREE.Vector3; t: number; r: number }[] = [];
  sphere = new SphereBuffer(); moonSphere = new SphereBuffer();
  stars: Float32Array;
  orbitPts: { pts: Float32Array; n: number; c: THREE.Vector3; col: string }[] = [];
  apoP: THREE.Vector3 | null = null; periP: THREE.Vector3 | null = null; orbBody: 'earth' | 'moon' = 'earth';
  mapBasis = { e1: new THREE.Vector3(1, 0, 0), e2: new THREE.Vector3(0, 1, 0), n: new THREE.Vector3(0, 0, 1) };
  sun = new THREE.Vector3(1, 0, 0);
  lost = false;
  onBeforeRender: (() => void) | null = null;
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.x = canvas.getContext('2d', { alpha: false } as any) as CanvasRenderingContext2D;
    this.stars = new Float32Array(260 * 4);
    for (let i = 0; i < 260; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      this.stars.set([r * Math.cos(a), u, r * Math.sin(a), Math.pow(Math.random(), 3)], i * 4);
    }
    loadTex('./tex/earth_day.jpg', 1024); loadTex('./tex/earth_night.jpg', 1024); loadTex('./tex/moon.jpg', 1024);
    this.resize();
    addEventListener('resize', () => this.resize());
  }
  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = innerWidth; this.H = innerHeight;
    this.canvas.width = Math.round(this.W * this.dpr); this.canvas.height = Math.round(this.H * this.dpr);
    this.canvas.style.width = this.W + 'px'; this.canvas.style.height = this.H + 'px';
  }
  setWorld(w: World | null) {
    this.world = w; this.sF = 0; this.parts = []; this.dead.clear(); this.flashes = []; this.orbitPts = []; this.mapLines.info = null; this.nS.set(0, 0, 0);
    if (w) w.on((e) => this.onEvent(e));
  }
  onEvent(e: SimEvent) {
    if ((e.kind === 'explode' || e.kind === 'rud') && e.vehicle) this.explode(e.vehicle);
    if (e.kind === 'boom') this.shake = Math.max(this.shake, 0.4);
    if (e.kind === 'stage' && e.vehicle) {
      const v = e.vehicle; const p = v.pos.clone().addScaledVector(v.nose(_a), v.stages[0] ? v.stages[0].spec.length : 0);
      for (let i = 0; i < 30; i++) this.emit(p, v.vel.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(25)), 1.2, 4, 18, 0.9, 2, 0.2);
    }
  }
  explode(v: Vehicle) {
    if (this.dead.has(v)) return;
    this.dead.add(v);
    const c = v.pos.clone().addScaledVector(v.nose(_a), v.length * 0.4);
    const air = v.tel.body === 'earth' && v.tel.alt < 60000;
    for (let i = 0; i < 70; i++) {
      const d = new THREE.Vector3().randomDirection(); const sp = 10 + Math.random() * 70;
      this.emit(c.clone().addScaledVector(d, Math.random() * v.diameter), v.vel.clone().addScaledVector(d, sp), 0.8 + Math.random() * 1.6, 6, 30 + Math.random() * 30, 1, 2, air ? 0.5 : 0);
      if (air) this.emit(c.clone().addScaledVector(d, Math.random() * 8), v.vel.clone().addScaledVector(d, sp * 0.4), 5 + Math.random() * 8, 10, 60 + Math.random() * 60, 0.75, 1, 0.8);
    }
    this.flashes.push({ p: c, t: 0, r: v.length * 2.5 });
    this.shake = Math.max(this.shake, 0.8);
  }
  emit(p: THREE.Vector3, v: THREE.Vector3, life: number, s0: number, s1: number, a: number, kind: 0 | 1 | 2, drag: number) {
    if (this.parts.length >= this.maxParts) this.parts.splice(0, 1);
    this.parts.push({ p: p.clone(), v: v.clone(), t: 0, life, s0, s1, a, kind, drag });
  }
  cycleCam() { const o: CamMode[] = ['chase', 'tower', 'drone', 'map']; this.setCam(o[(o.indexOf(this.camMode) + 1) % o.length]); }
  setCam(m: CamMode) { this.camMode = m; this.sF = 0; this.zoom = 1; this.pan.set(0, 0); if (m === 'map') { this.mapZoom = 1; } }
  orbitInput(dx: number, dy: number) {
    if (this.camMode === 'map') { this.pan.x -= dx / this.mapScale(); this.pan.y += dy / this.mapScale(); }
    else { this.pan.x -= dx / this.s; this.pan.y += dy / this.s; }
    this.panIdle = 0;
  }
  zoomInput(f: number) { if (this.camMode === 'map') this.mapZoom = clamp(this.mapZoom * f, 0.02, 40); else this.zoom = clamp(this.zoom * f, 0.08, 4e5); }
  bodyCenter(body: 'earth' | 'moon', out: THREE.Vector3) { if (!this.world || body === 'earth') return out.set(0, 0, 0); return this.world.ephem.moonPos(this.world.t, out); }
  nearestRegion(p: THREE.Vector3) {
    if (!this.world) return null;
    let best: string | null = null, bd = Infinity;
    for (const r of this.world.regions) { const d = p.distanceTo(this.world.frames[r.id].origin); if (d < bd) { bd = d; best = r.id; } }
    return best ? { id: best, d: bd } : null;
  }
  // scherm (css px) van ECI-punt
  sx(p: THREE.Vector3) { return this.W / 2 + _d.copy(p).sub(this.center).dot(this.tan) * this.s; }
  sy(p: THREE.Vector3) { return this.H * this.cyF - _d.copy(p).sub(this.center).dot(this.up) * this.s; }
  cyF = 0.5;
  mapScale() { return this.mapS; }
  mapS = 1e-5; sF = 0;

  // ---------------- frame ----------------
  render(dt: number) {
    this.time += dt; this.frames++; this.fpsT += dt;
    if (this.fpsT > 0.5) { this.fps = this.frames / this.fpsT; this.frames = 0; this.fpsT = 0; }
    const x = this.x, w = this.world, v = this.focus;
    x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (!w || !v) { x.fillStyle = '#05070c'; x.fillRect(0, 0, this.W, this.H); this.grab(); return; }
    this.onBeforeRender?.();
    w.ephem.sunDir(w.t, this.sun);
    this.updateParticles(dt);
    if (this.camMode === 'map') this.drawMap(dt); else this.drawFlight(dt);
    this.grab();
  }
  grab() { const W = window as any; if (W.__grab) { W.__img = this.canvas.toDataURL('image/jpeg', 0.9); W.__grab = false; } }
  snapshot() { return this.canvas.toDataURL('image/jpeg', 0.9); }

  basis(v: Vehicle, dt: number) {
    const w = this.world!;
    const c = this.bodyCenter(v.tel.body || 'earth', _a);
    const up = this.up.copy(v.pos).sub(c).normalize();
    // vlak door positie en (inertiële) snelheid t.o.v. het lichaam: prograde naar rechts
    const vb = _b.copy(v.vel);
    if (v.tel.body === 'moon') { const m1 = w.ephem.moonPos(w.t + 1, _c); vb.sub(m1.sub(c)); }
    let n = _c.copy(vb).cross(up);
    if (n.lengthSq() < 1e-6) n.set(0, 1, 0).cross(up).negate();
    n.normalize();
    if (this.nS.lengthSq() < 0.5 || this.nS.dot(n) < 0.2) this.nS.copy(n); else this.nS.lerp(n, Math.min(1, dt * 1.5)).normalize();
    this.nrm.copy(this.nS).addScaledVector(up, -this.nS.dot(up)).normalize();
    this.tan.copy(up).cross(this.nrm).normalize();
  }

  drawFlight(dt: number) {
    const x = this.x, w = this.world!, v = this.focus!;
    this.basis(v, dt);
    const body = (v.tel.body || 'earth') as 'earth' | 'moon';
    const bc = this.bodyCenter(body, new THREE.Vector3());
    const R = body === 'moon' ? R_M : R_E;
    const L = Math.max(8, v.length);
    // zoom (log-ruimte, vloeiend)
    this.zoomS = Math.exp(lerp(Math.log(this.zoomS), Math.log(this.zoom), Math.min(1, dt * 6)));
    let s0 = this.H * 0.42 / (L + 24);
    let mode = this.camMode;
    const reg = this.nearestRegion(v.pos);
    let target = v.pos.clone().addScaledVector(v.nose(_a), L * 0.5);
    // dichtbij de grond: automatisch uitzoomen zodat het terrein in beeld blijft (minstens ~30 px voertuig)
    if ((mode === 'chase' || mode === 'drone') && v.state === 'flying' && v.tel.agl < 6000 && (v.tel.vVert < -3 || v.tel.agl < 120)) {
      const fit = this.H * 0.4 / (Math.max(0, v.tel.agl) + L * 0.5 + 20);
      s0 = Math.max(Math.min(s0, fit), 45 / L);
      target = target.clone().addScaledVector(this.up, -Math.min(v.tel.agl, 0.4 * this.H / s0) * 0.5);
    }
    if (mode === 'drone') s0 *= 0.25;
    if (mode === 'onboard') s0 *= 2.2;
    if (mode === 'tower' && reg && reg.d < 60000) {
      // kader met toren én voertuig
      const tw = w.towers.find((t) => t.region === reg.id) || null;
      const l = w.toLocal(reg.id, v.pos, _b);
      let pad = w.regions.find((r) => r.id === reg.id)!.pads[0]; let bd = Infinity;
      for (const p of w.regions.find((r) => r.id === reg.id)!.pads) { const d = Math.hypot(l.x - p.x, l.z - p.z); if (d < bd) { bd = d; pad = p; } }
      void tw;
      const pp = w.toWorld(reg.id, new THREE.Vector3(pad.x, pad.top + 40, pad.z), new THREE.Vector3());
      const sep = Math.abs(_c.copy(v.pos).sub(pp).dot(this.up)) + Math.abs(_c.copy(v.pos).sub(pp).dot(this.tan));
      if (sep < 6000) { target = pp.lerp(target, 0.5); s0 = Math.min(s0, this.H * 0.4 / (sep * 0.5 + L * 0.7 + 60)); } else mode = 'chase';
    }
    // pan loslaten na stilstand
    this.panIdle += dt; if (this.panIdle > 4) this.pan.multiplyScalar(Math.max(0, 1 - dt * 2));
    const sT = s0 / this.zoomS;
    this.s = this.sF > 0 ? Math.exp(lerp(Math.log(this.sF), Math.log(sT), Math.min(1, dt * 3))) : sT; this.sF = this.s;
    // camera niet onder de grond: houd grond onder het midden als we dichtbij zijn
    this.center.copy(target).addScaledVector(this.tan, this.pan.x).addScaledVector(this.up, this.pan.y);
    if (this.shake > 0) { const k = this.shake * 6 / this.s; this.center.addScaledVector(this.tan, (Math.random() - 0.5) * k).addScaledVector(this.up, (Math.random() - 0.5) * k); this.shake = Math.max(0, this.shake - dt * 1.2); }
    this.camECI.copy(this.center).addScaledVector(this.nrm, this.H / this.s);
    this.camera.position.set(0, 0, this.H / this.s * 0.6);
    const camR = this.center.distanceTo(bc), alt = camR - R;
    // --- lucht ---
    const sunEl = this.up.dot(this.sun);
    const day = smooth(-0.18, 0.12, sunEl);
    const dens = body === 'earth' ? Math.exp(-Math.max(0, alt) / 11000) : 0;
    const sky = body === 'earth' ? clamp(dens * 1.6, 0, 1) * (0.06 + 0.94 * day) : 0;
    const sunset = body === 'earth' ? Math.max(0, 1 - Math.abs(sunEl - 0.02) / 0.22) * clamp(dens * 2, 0, 1) : 0;
    const g = x.createLinearGradient(0, 0, 0, this.H);
    const zr = lerp(2, 38, sky), zg = lerp(3, 104, sky), zb = lerp(8, 205, sky);
    const hr = lerp(4, 165, sky) + 90 * sunset, hg = lerp(6, 205, sky) + 20 * sunset, hb = lerp(12, 245, sky) - 60 * sunset;
    g.addColorStop(0, rgb(zr, zg, zb)); g.addColorStop(0.55, rgb(lerp(zr, hr, 0.55), lerp(zg, hg, 0.55), lerp(zb, hb, 0.55))); g.addColorStop(1, rgb(hr, hg, hb));
    x.fillStyle = g; x.fillRect(0, 0, this.W, this.H);
    // sterren
    const starA = 1 - clamp(sky * 2.2, 0, 1);
    if (starA > 0.02) this.drawStars(starA);
    // zon (alleen als die in het beeldvlak ongeveer zichtbaar is)
    this.drawSunDisk(sky);
    // --- lichamen ---
    const moonC = w.ephem.moonPos(w.t, new THREE.Vector3());
    this.drawBody('moon', moonC, R_M, false);
    const near = R * this.s > 25000;
    if (near) this.drawGround(body, bc, R, alt);
    else this.drawBody(body, bc, R, body === 'earth');
    if (body === 'moon' && !near) { /* aarde in de verte */ this.drawBody('earth', new THREE.Vector3(), R_E, true); }
    // --- scenery ---
    if (reg && reg.d < 80000 && this.s > 0.004) this.drawScenery(reg.id);
    // --- deeltjes achter ---
    this.drawParticles(false);
    // --- voertuigen ---
    for (const vh of w.vehicles) if (!this.dead.has(vh) && vh.state !== 'destroyed') this.drawVehicle(vh, dt);
    this.drawParticles(true);
    this.drawFlashes(dt);
  }

  drawStars(a: number) {
    const x = this.x, st = this.stars, S = Math.max(this.W, this.H) * 0.9;
    x.fillStyle = '#fff';
    for (let i = 0; i < st.length; i += 4) {
      const dx = st[i] * this.tan.x + st[i + 1] * this.tan.y + st[i + 2] * this.tan.z;
      const dy = st[i] * this.up.x + st[i + 1] * this.up.y + st[i + 2] * this.up.z;
      const dz = st[i] * this.nrm.x + st[i + 1] * this.nrm.y + st[i + 2] * this.nrm.z;
      if (dz < 0) continue;
      const px = this.W / 2 + dx * S, py = this.H / 2 - dy * S;
      if (px < 0 || py < 0 || px > this.W || py > this.H) continue;
      const m = st[i + 3];
      x.globalAlpha = a * (0.35 + 0.65 * m); const r = 0.5 + m * 1.3;
      x.fillRect(px - r / 2, py - r / 2, r, r);
    }
    x.globalAlpha = 1;
  }
  drawSunDisk(sky: number) {
    const dx = this.sun.dot(this.tan), dy = this.sun.dot(this.up), dz = this.sun.dot(this.nrm);
    if (dz < -0.2) return;
    const S = Math.max(this.W, this.H) * 0.9;
    const px = this.W / 2 + dx * S, py = this.H / 2 - dy * S;
    if (px < -200 || py < -200 || px > this.W + 200 || py > this.H + 200) return;
    const x = this.x; x.globalCompositeOperation = 'lighter';
    const gs = glowSprite(); const r = 90 + 60 * sky;
    x.globalAlpha = 0.7; x.drawImage(gs, px - r, py - r, r * 2, r * 2);
    x.globalAlpha = 1; x.fillStyle = '#fffaf0'; x.beginPath(); x.arc(px, py, 7, 0, Math.PI * 2); x.fill();
    x.globalCompositeOperation = 'source-over';
  }

  // bol (aarde/maan) orthografisch, in lage resolutie
  drawBody(body: 'earth' | 'moon', c: THREE.Vector3, R: number, atmo: boolean) {
    const x = this.x;
    const rp = R * this.s; if (rp < 0.6) return;
    const cx = this.sx(c), cy = this.sy(c);
    const pad = rp * (atmo ? 1.04 : 1);
    if (cx + pad < 0 || cx - pad > this.W || cy + pad < 0 || cy - pad > this.H) return;
    // diepte: achter de camera? (orthografisch: altijd zichtbaar)
    const k = rp > 400 ? 2.5 : 1.5; // buffer-schaal (css px per bufferpixel)
    const BW = this.W / k, BH = this.H / k;
    const w = this.world!;
    const q = body === 'earth' ? w.ephem.earthQuat(w.t, new THREE.Quaternion()) : w.ephem.moonQuat(w.t, new THREE.Quaternion());
    const sb = body === 'earth' ? this.sphere : this.moonSphere;
    const sbx = sb as any; const key = `${(cx / k) | 0},${(cy / k) | 0},${(rp / k).toFixed(1)},${BW | 0}`;
    let img: HTMLCanvasElement;
    if (sbx._key === key && this.time - sbx._t < 0.08) img = sb.c;
    else { img = sb.render(body, BW, BH, cx / k, cy / k, rp / k, this.tan, this.up, this.nrm, q, this.sun, w.t * 2e-6, atmo); sbx._key = key; sbx._t = this.time; }
    x.imageSmoothingEnabled = true;
    x.drawImage(img, 0, 0, this.W, this.H);
    if (atmo && rp < 2e5) {
      const g = x.createRadialGradient(cx, cy, rp * 0.996, cx, cy, rp * 1.02);
      const sd = this.sun.dot(this.up);
      g.addColorStop(0, 'rgba(120,180,255,0)'); g.addColorStop(0.4, `rgba(110,170,255,${0.35 + 0.3 * Math.max(0, sd)})`); g.addColorStop(1, 'rgba(60,120,255,0)');
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, rp * 1.02, 0, Math.PI * 2); x.fill();
    }
  }

  // dwarsdoorsnede van het terrein rond het voertuig
  drawGround(body: 'earth' | 'moon', bc: THREE.Vector3, R: number, alt: number) {
    const x = this.x, w = this.world!;
    const N = 96; const half = this.W / 2 / this.s * 1.15;
    const pts: number[] = []; const wat: boolean[] = []; const hs: number[] = [];
    const reg = this.nearestRegion(this.center);
    const def = reg ? w.regions.find((r) => r.id === reg.id)! : null;
    const tmp = new THREE.Vector3(), loc = new THREE.Vector3();
    const day = getTex('./tex/earth_day.jpg');
    const sunEl = this.up.dot(this.sun); const lit = 0.1 + 0.9 * smooth(-0.15, 0.15, sunEl);
    const rc = _d.copy(this.center).sub(bc); const cu = rc.dot(this.up), ct = rc.dot(this.tan); alt = cu - R;
    for (let i = 0; i <= N; i++) {
      const dx = -half + 2 * half * i / N + ct; const phi = dx / R;
      tmp.copy(this.up).multiplyScalar(Math.cos(phi)).addScaledVector(this.tan, Math.sin(phi)).multiplyScalar(R).add(bc);
      let h = 0, water = false;
      if (def && def.body === body) {
        w.toLocal(def.id, tmp, loc);
        if (Math.abs(loc.x) < def.extent && Math.abs(loc.z) < def.extent) { h = def.height(loc.x, loc.z); water = body === 'earth' && def.water(loc.x, loc.z); }
        else water = body === 'earth' && this.texWater(tmp, day);
      } else water = body === 'earth' && this.texWater(tmp, day);
      if (body === 'moon' && !(def && def.body === 'moon')) h = 0;
      const sh = Math.max(h, water ? 0 : h);
      const sinH = Math.sin(phi / 2);
      const ry = (sh - alt) - (R + sh) * 2 * sinH * sinH; const rx = (R + sh) * Math.sin(phi) - ct;
      // relatief t.o.v. camera-centrum: center ligt op hoogte alt boven bc langs up
      pts.push(this.W / 2 + rx * this.s, this.H * this.cyF - ry * this.s);
      wat.push(water); hs.push(h);
    }
    // grondvulling
    const gy = Math.min(...pts.filter((_, i) => i % 2 === 1));
    const grad = x.createLinearGradient(0, gy, 0, gy + Math.max(60, 400));
    if (body === 'earth') { grad.addColorStop(0, rgb(196 * lit, 176 * lit, 128 * lit)); grad.addColorStop(0.06, rgb(150 * lit, 132 * lit, 92 * lit)); grad.addColorStop(1, rgb(70 * lit, 58 * lit, 42 * lit)); }
    else { grad.addColorStop(0, rgb(170 * lit, 168 * lit, 162 * lit)); grad.addColorStop(1, rgb(60 * lit, 60 * lit, 58 * lit)); }
    x.fillStyle = grad;
    x.beginPath(); x.moveTo(pts[0], this.H + 10);
    for (let i = 0; i <= N; i++) x.lineTo(pts[i * 2], pts[i * 2 + 1]);
    x.lineTo(pts[N * 2], this.H + 10); x.closePath(); x.fill();
    // water: blauwe vlakken + spiegelende rand
    if (body === 'earth') {
      x.fillStyle = rgb(26 * lit + 4, 92 * lit + 6, 140 * lit + 12);
      let i = 0;
      while (i <= N) {
        if (!wat[i]) { i++; continue; }
        const st = i; while (i <= N && wat[i]) i++;
        const en = Math.min(N, i);
        x.beginPath(); x.moveTo(pts[st * 2], pts[st * 2 + 1]);
        for (let j = st; j <= en; j++) x.lineTo(pts[j * 2], pts[j * 2 + 1]);
        x.lineTo(pts[en * 2], this.H + 10); x.lineTo(pts[st * 2], this.H + 10); x.closePath(); x.fill();
        x.strokeStyle = `rgba(200,230,255,${0.5 * lit})`; x.lineWidth = 1.5; x.beginPath();
        for (let j = st; j <= en; j++) { if (j === st) x.moveTo(pts[j * 2], pts[j * 2 + 1]); else x.lineTo(pts[j * 2], pts[j * 2 + 1]); }
        x.stroke();
      }
      // gras/zandrand
      x.strokeStyle = rgb(120 * lit, 140 * lit, 80 * lit); x.lineWidth = 2; x.beginPath(); let on = false;
      for (let j = 0; j <= N; j++) { if (wat[j]) { on = false; continue; } if (!on) { x.moveTo(pts[j * 2], pts[j * 2 + 1]); on = true; } else x.lineTo(pts[j * 2], pts[j * 2 + 1]); }
      x.stroke();
      // nevel boven de horizon
      if (alt < 30000) {
        const hz = x.createLinearGradient(0, gy - 140, 0, gy);
        const sky = smooth(-0.15, 0.15, sunEl);
        hz.addColorStop(0, 'rgba(200,220,240,0)'); hz.addColorStop(1, `rgba(${200 * sky + 20},${215 * sky + 25},${235 * sky + 35},${0.35 * (1 - alt / 30000)})`);
        x.fillStyle = hz; x.fillRect(0, gy - 140, this.W, 140);
      }
    }
  }
  texWater(p: THREE.Vector3, day: any) {
    if (!day) return false;
    const w = this.world!;
    const q = w.ephem.earthQuat(w.t, new THREE.Quaternion()).invert();
    const d = _b.copy(p).normalize().applyQuaternion(q);
    const lat = Math.asin(clamp(d.y, -1, 1)), lon = Math.atan2(-d.z, d.x);
    const u = (lon + Math.PI) / (2 * Math.PI), vv = 0.5 - lat / Math.PI;
    const i = ((Math.min(day.h - 1, Math.max(0, (vv * day.h) | 0)) * day.w) + Math.min(day.w - 1, Math.max(0, (u * day.w) | 0))) * 4;
    return day.d[i + 2] > day.d[i] * 1.25 && day.d[i + 2] > day.d[i + 1] * 1.05;
  }

  // scenery van een regio in de vlakke doorsnede
  drawScenery(regionId: string) {
    const x = this.x, w = this.world!;
    const def = w.regions.find((r) => r.id === regionId)!;
    const f = w.frames[regionId];
    const ang = Math.atan2(f.up.dot(this.tan), f.up.dot(this.up));
    const at = (lx: number, ly: number, lz: number) => w.toWorld(regionId, _c.set(lx, ly, lz), new THREE.Vector3());
    const tf = (p: THREE.Vector3, flip = 1) => {
      const px = this.sx(p), py = this.sy(p);
      x.setTransform(this.dpr * this.s * flip, 0, 0, -this.dpr * this.s, px * this.dpr, py * this.dpr); x.rotate(-ang * flip);
      return px > -4000 && px < this.W + 4000 && py > -4000 && py < this.H + 4000;
    };
    const day = 0.25 + 0.75 * smooth(-0.15, 0.15, this.up.dot(this.sun));
    for (const pad of def.pads) {
      const base = at(pad.x, def.height(pad.x, pad.z), pad.z);
      const depth = _a.copy(base).sub(this.center).dot(this.nrm);
      if (Math.abs(depth) > 3000) continue;
      if (!tf(base)) continue;
      if (pad.kind === 'olm') {
        drawOLM(x, pad.top);
        // tankfarm en high bay op een vaste afstand in beeld
        x.save(); x.translate(70, 0); drawTankFarm(x); x.restore();
        x.save(); x.translate(-520, 0); drawHighBay(x); x.restore();
      } else if (pad.kind === 'stand') drawStand(x, pad.top);
      else if (pad.kind === 'platform') { x.save(); x.translate(0, pad.top - 12); drawPlatform(x); x.restore(); }
      else if (pad.kind === 'lunarpad') drawLunarPad(x, pad.r);
      else drawPadSlab(x, pad.r);
      if (pad.tower) {
        const tb = at(pad.tower.x, def.height(pad.tower.x, pad.tower.z), pad.tower.z);
        const tw = w.towers.find((t) => t.region === regionId && t.pad.id === pad.id);
        const dx = _a.copy(base).sub(tb).dot(this.tan);
        let td = dx; if (Math.abs(td) < 6) td = -24; // altijd naast het platform
        const side = td > 0 ? 1 : -1;
        tf(base); x.translate(-td, 0);
        drawTower(x, pad.tower.h, tw ? tw.armH : pad.tower.h * 0.6, tw ? tw.armOpen : 1, side);
      }
      // nachtverduistering
      if (day < 0.99) { x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); }
    }
    x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  // ---------------- voertuig ----------------
  vehicleLight(v: Vehicle) {
    const w = this.world!;
    const c = this.bodyCenter(v.tel.body || 'earth', _a);
    const upv = _b.copy(v.pos).sub(c).normalize();
    const el = upv.dot(this.sun);
    let l = smooth(-0.12, 0.08, el);
    if (v.tel.alt > 80000) {
      // schaduw van de aarde
      const p = v.pos; const along = p.dot(this.sun);
      const perp = Math.sqrt(Math.max(0, p.lengthSq() - along * along));
      l = along > 0 || perp > R_E ? 1 : 0;
    }
    void w; return 0.18 + 0.82 * l;
  }
  drawVehicle(v: Vehicle, dt: number) {
    const x = this.x;
    const px = this.sx(v.pos), py = this.sy(v.pos);
    const Lp = v.length * this.s;
    const nose = v.nose(_a);
    const ang = Math.atan2(nose.dot(this.tan), nose.dot(this.up));
    if (px < -Lp - 300 || px > this.W + Lp + 300 || py < -Lp - 300 || py > this.H + Lp + 300) return;
    const lit = this.vehicleLight(v);
    if (Lp < 7) {
      // klein: markering
      x.save(); x.translate(px, py); x.rotate(ang);
      x.fillStyle = v === this.focus ? '#ffd27a' : '#cfe3ff'; x.beginPath(); x.moveTo(0, -9); x.lineTo(5, 5); x.lineTo(-5, 5); x.closePath(); x.fill();
      x.restore();
      return;
    }
    const belly = v.belly(_b);
    const flip = belly.dot(this.tan) > 0 ? -1 : 1;
    const T = v.tel;
    const pAmb = T.pAmb / 101325, vacK = clamp(1 - pAmb * 4, 0, 1);
    x.save();
    x.translate(px, py); x.rotate(ang);
    const k = this.s / PPM;
    // plasma achter het voertuig (eerst)
    const hf = T.heatFlux || 0; const pl = clamp((hf - 8e4) / 6e5, 0, 1.5);
    if (pl > 0.01) { x.restore(); this.drawPlasma(v, px, py, pl, 0); x.save(); x.translate(px, py); x.rotate(ang); }
    // trappen
    let off = 0;
    const flapsAng = v.flapsOn && T.q > 50 ? 1 : 0;
    const flames: [number, number, number, boolean, number, number][] = []; // y(m), xLat(m), thr, vac, D, nOn
    for (let i = 0; i < v.stages.length; i++) {
      const st = v.stages[i]; const sp = st.spec;
      const spr = stageSprite(sp, v.legsDown, flapsAng);
      x.save(); x.scale(flip, 1);
      x.drawImage(spr.c, -spr.ox * k, -(off * PPM + spr.oy) * k, spr.w * k, spr.h * k);
      if (lit < 0.97) { x.globalAlpha = (1 - lit) * 0.85; x.drawImage(darkSprite(spr), -spr.ox * k, -(off * PPM + spr.oy) * k, spr.w * k, spr.h * k); x.globalAlpha = 1; }
      x.restore();
      // motoren
      let nOn = 0;
      const seen = new Map<number, number>();
      for (const e of st.engines) {
        if (!(e.on && !e.failed && e.spool > 0.05)) continue;
        nOn++;
        const bx = Math.round(e.spec.x * 2) / 2 * flip;
        const thr = e.throttle * e.spool;
        if (sp.engines.length > 12) continue;
        seen.set(bx, Math.max(seen.get(bx) || 0, thr));
        flames.push([off, bx, thr, e.spec.kind === 'vac', sp.diameter, 1]);
      }
      if (sp.engines.length > 12 && nOn > 0) {
        let f = 0; for (const e of st.engines) if (e.on && !e.failed) f += e.throttle * e.spool;
        flames.push([off, 0, f / nOn, false, sp.diameter, nOn]);
      }
      off += sp.length;
    }
    // vlammen (additief)
    if (flames.length) {
      x.globalCompositeOperation = 'lighter';
      // vlam stopt op de grond/het lanceerplatform (plus gloed op het raakpunt)
      const upDot = Math.max(0.2, v.nose(_c).dot(this.up));
      const gnd = T.agl < 300 ? (Math.max(0, T.agl) + 1) / upDot : 1e9;
      for (const [yo, bx, thr, vac, D, nOn] of flames) this.drawFlame(bx, -yo, thr, vac, D, nOn, vacK, v, gnd);
      if (gnd < 200) { const gs2 = glowSprite(); const rr = (v.diameter * 2.5 + 10) * this.s; x.globalAlpha = 0.8; x.drawImage(gs2, -rr, gnd * this.s - rr * 0.6, rr * 2, rr * 1.2); x.globalAlpha = 1; }
      // gloed
      const gs = glowSprite(); const gr = (v.diameter * 3 + 25 * (1 - vacK)) * this.s;
      x.globalAlpha = 0.55 * (1 - vacK * 0.6); x.drawImage(gs, -gr, -gr + 2 * this.s, gr * 2, gr * 2); x.globalAlpha = 1;
      x.globalCompositeOperation = 'source-over';
      if (dt > 0) this.emitExhaust(v, flames.reduce((a, f) => a + f[2] * f[5], 0), vacK, dt);
    }
    // HLS-landingsmotoren
    const ap = v.ap as any;
    if (ap && ap.phase === 'Landingsmotoren' && ap.landThrust > 0) {
      x.globalCompositeOperation = 'lighter';
      for (const sd of [-1, 1]) {
        const y = -v.length * 0.68; const fl = (8 + Math.random() * 3) * this.s;
        const g = x.createLinearGradient(0, y * this.s, 0, y * this.s + fl);
        g.addColorStop(0, 'rgba(255,240,210,.9)'); g.addColorStop(1, 'rgba(255,140,80,0)');
        x.fillStyle = g; x.beginPath(); x.moveTo(sd * (v.diameter / 2 + 0.3) * this.s, y * this.s); x.lineTo(sd * (v.diameter / 2 + 2.5) * this.s, y * this.s + fl); x.lineTo(sd * (v.diameter / 2 - 0.6) * this.s, y * this.s + fl); x.fill();
      }
      x.globalCompositeOperation = 'source-over';
    }
    x.restore();
    // plasma bij terugkeer
    if (pl > 0.01) this.drawPlasma(v, px, py, pl, 1);
    // condensatiewolk rond Mach 1
    const vap = T.mach > 0.85 && T.mach < 1.35 && T.alt < 16000 ? Math.sin((T.mach - 0.85) / 0.5 * Math.PI) * 0.45 : 0;
    if (vap > 0.02) {
      x.save(); x.translate(px, py); x.rotate(ang);
      const yy = -v.length * 0.55 * this.s, rr = v.diameter * 1.4 * this.s;
      const g = x.createRadialGradient(0, yy, rr * 0.3, 0, yy, rr);
      g.addColorStop(0, `rgba(255,255,255,${vap})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.beginPath(); x.ellipse(0, yy, rr, rr * 1.6, 0, 0, Math.PI * 2); x.fill(); x.restore();
    }
  }
  drawFlame(bx: number, y0: number, thr: number, vac: boolean, D: number, nOn: number, vacK: number, v: Vehicle, maxLen = 1e9) {
    const x = this.x, s = this.s;
    const cluster = nOn > 1;
    const bellL = vac ? 3.6 : 2.3;
    const ey = (y0 + bellL) * s; // naar beneden = +y
    const flick = 0.9 + Math.random() * 0.2;
    let len = (vac ? 70 : 55) * (0.45 + 0.55 * thr) * (1 + vacK * 2.5) * flick;
    let wid = (vac ? 2.3 : 1.3) * (1 + vacK * 1.8);
    if (cluster) { len = 140 * (0.5 + 0.5 * thr) * (1 + vacK * 2.5) * flick; wid = D * 0.85 * (1 + vacK * 1.2); }
    len = Math.min(len, Math.max(3, maxLen - bellL - y0));
    const L = len * s, Wd = wid * s, cx = bx * s;
    // buitenste pluim: oranje-geel op zeeniveau, blauw-violet en wijd in vacuüm
    const g = x.createLinearGradient(0, ey, 0, ey + L);
    const b = vacK;
    g.addColorStop(0, `rgba(255,${lerp(225, 190, b)},${lerp(150, 255, b)},${lerp(0.95, 0.55, b)})`);
    g.addColorStop(0.2, `rgba(255,${lerp(150, 120, b)},${lerp(60, 230, b)},${lerp(0.7, 0.32, b)})`);
    g.addColorStop(0.6, `rgba(${lerp(255, 140, b)},${lerp(90, 90, b)},${lerp(40, 230, b)},${lerp(0.3, 0.12, b)})`);
    g.addColorStop(1, `rgba(${lerp(200, 90, b)},${lerp(60, 70, b)},${lerp(40, 200, b)},0)`);
    x.fillStyle = g;
    const spread = Wd * (1 + vacK * 2.5);
    x.beginPath(); x.moveTo(cx - Wd / 2, ey); x.quadraticCurveTo(cx - spread * 0.7, ey + L * 0.35, cx - spread * 0.25, ey + L);
    x.lineTo(cx + spread * 0.25, ey + L); x.quadraticCurveTo(cx + spread * 0.7, ey + L * 0.35, cx + Wd / 2, ey); x.closePath(); x.fill();
    // kern
    const cg = x.createLinearGradient(0, ey, 0, ey + L * 0.45);
    cg.addColorStop(0, 'rgba(255,255,245,1)'); cg.addColorStop(0.3, 'rgba(255,230,190,.8)'); cg.addColorStop(1, 'rgba(255,170,110,0)');
    x.fillStyle = cg;
    x.beginPath(); x.moveTo(cx - Wd * 0.42, ey); x.quadraticCurveTo(cx, ey + L * 0.5, cx, ey + L * 0.5); x.quadraticCurveTo(cx, ey + L * 0.5, cx + Wd * 0.42, ey); x.closePath(); x.fill();
    // schokdiamanten op zeeniveau
    if (vacK < 0.6 && L > 30) {
      x.fillStyle = `rgba(255,250,230,${0.55 * (1 - vacK)})`;
      const n = cluster ? 0 : 4;
      for (let i = 1; i <= n; i++) { const yy = ey + L * 0.07 * i; const r = Wd * 0.22 * (1 - i * 0.12); x.beginPath(); x.ellipse(cx, yy, r, r * 0.6, 0, 0, Math.PI * 2); x.fill(); }
      if (cluster) for (let i = -3; i <= 3; i++) { x.beginPath(); x.ellipse(cx + i * Wd * 0.13, ey + Wd * 0.25, Wd * 0.05, Wd * 0.16, 0, 0, Math.PI * 2); x.fill(); }
    }
    void v;
  }
  // plasma bij terugkeer: staart achter het voertuig (part 0) en boeggloed op de aanstroomzijde (part 1)
  drawPlasma(v: Vehicle, px: number, py: number, pl: number, part: 0 | 1) {
    const x = this.x, s = this.s;
    const vr = v.vRel; const wx = vr.dot(this.tan), wy = vr.dot(this.up);
    const a = Math.atan2(wx, wy);
    const nose = v.nose(_a); const ba = Math.atan2(nose.dot(this.tan), nose.dot(this.up));
    const midx = px + Math.sin(ba) * v.length * 0.5 * s, midy = py - Math.cos(ba) * v.length * 0.5 * s;
    const wd = (Math.abs(v.length * Math.sin(ba - a)) + v.diameter) * s;
    const k = Math.min(1, pl); const fl = 0.85 + Math.random() * 0.3;
    x.save(); x.translate(midx, midy); x.rotate(a); x.globalCompositeOperation = 'lighter';
    if (part === 0) {
      const len = (wd * 0.8 + v.length * s * 0.4) * fl;
      const g = x.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, `rgba(255,150,90,${0.38 * k})`); g.addColorStop(0.4, `rgba(220,90,150,${0.16 * k})`); g.addColorStop(1, 'rgba(120,60,200,0)');
      x.fillStyle = g;
      x.beginPath(); x.moveTo(-wd * 0.52, -wd * 0.02); x.bezierCurveTo(-wd * 0.34, len * 0.22, -wd * 0.05, len * 0.6, 0, len); x.bezierCurveTo(wd * 0.05, len * 0.6, wd * 0.34, len * 0.22, wd * 0.52, -wd * 0.02); x.closePath(); x.fill();
    } else {
      const g = x.createRadialGradient(0, -wd * 0.08, 0, 0, -wd * 0.08, wd * 0.55);
      g.addColorStop(0, `rgba(255,240,245,${0.6 * k})`); g.addColorStop(0.5, `rgba(255,140,190,${0.3 * k})`); g.addColorStop(1, 'rgba(255,90,150,0)');
      x.fillStyle = g; x.beginPath(); x.ellipse(0, -wd * 0.08, wd * 0.55, wd * 0.16, 0, 0, Math.PI * 2); x.fill();

    }
    x.globalCompositeOperation = 'source-over'; x.restore();
  }
  emitExhaust(v: Vehicle, flame: number, vacK: number, dt: number) {
    const w = this.world!, T = v.tel;
    const dn = v.nose(_a).clone().multiplyScalar(-1);
    const sv = w.surfaceVel(T.body, v.pos, new THREE.Vector3());
    const k = dt * 60;
    if (T.agl < 300 && T.body === 'earth') {
      const inten = Math.min(1, flame / 10) * clamp(1 - Math.max(0, T.agl) / 300, 0, 1);
      const n = Math.min(3, Math.floor(inten * 1.5 * k) + (Math.random() < inten * 0.6 ? 1 : 0));
      const gp = v.pos.clone().addScaledVector(this.up, -Math.max(0, T.agl));
      for (let i = 0; i < n; i++) {
        const sd = Math.random() < 0.5 ? -1 : 1; const sp = 30 + Math.random() * 90;
        this.emit(gp.clone().addScaledVector(this.tan, sd * (6 + Math.random() * 8)).addScaledVector(this.up, 3), sv.clone().addScaledVector(this.tan, sd * sp).addScaledVector(this.up, 4 + Math.random() * 10), 5 + Math.random() * 5, 10, 45 + Math.random() * 35, 0.55, 0, 0.6);
      }
    }
    if (T.alt < 50000 && T.agl > 70 && T.body === 'earth') {
      const thin = clamp(1 - T.alt / 50000, 0, 1);
      const n = Math.min(3, Math.floor(Math.min(1, flame / 3) * 1.5 * k) + 1);
      for (let i = 0; i < n; i++) {
        const p = v.pos.clone().addScaledVector(dn, 30 * (1 + vacK * 2) * (0.5 + Math.random()));
        this.emit(p, v.vel.clone().lerp(sv, 0.6).addScaledVector(dn, 40), 3 + thin * 8, v.diameter * 1.2, v.diameter * (3 + (1 - thin) * 10), 0.18 + thin * 0.3, 0, 0.3);
      }
    }
  }
  updateParticles(dt: number) {
    const w = this.world; if (!w) return;
    const k = dt * Math.min(4, w.warp || 1);
    const sv = new THREE.Vector3();
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]; p.t += k;
      if (p.t > p.life) { this.parts.splice(i, 1); continue; }
      if (p.drag > 0) { w.surfaceVel('earth', p.p, sv); p.v.lerp(sv, Math.min(1, p.drag * k)); }
      p.p.addScaledVector(p.v, k);
    }
  }
  drawParticles(front: boolean) {
    const x = this.x; if (!this.parts.length) return;
    const puff = puffSprite(), gs = glowSprite();
    const night = 0.35 + 0.65 * smooth(-0.15, 0.1, this.up.dot(this.sun));
    for (const p of this.parts) {
      if ((p.kind === 2) !== front) continue;
      const u = p.t / p.life; const r = lerp(p.s0, p.s1, Math.sqrt(u)) * this.s;
      if (r < 0.4) continue;
      const px = this.sx(p.p), py = this.sy(p.p);
      if (px < -r || py < -r || px > this.W + r || py > this.H + r) continue;
      if (p.kind === 2) {
        x.globalCompositeOperation = 'lighter'; x.globalAlpha = p.a * (1 - u) * (1 - u);
        x.drawImage(gs, px - r, py - r, r * 2, r * 2);
        x.globalCompositeOperation = 'source-over';
      } else {
        x.globalAlpha = p.a * (1 - u) * Math.min(1, u * 8) * night;
        x.drawImage(puff, px - r, py - r, r * 2, r * 2);
      }
    }
    x.globalAlpha = 1;
  }
  drawFlashes(dt: number) {
    const x = this.x; const gs = glowSprite();
    x.globalCompositeOperation = 'lighter';
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]; f.t += dt;
      if (f.t > 1.4) { this.flashes.splice(i, 1); continue; }
      const r = f.r * (0.6 + f.t) * this.s; x.globalAlpha = Math.max(0, 1 - f.t / 1.4);
      x.drawImage(gs, this.sx(f.p) - r, this.sy(f.p) - r, r * 2, r * 2);
    }
    x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
  }

  // ---------------- kaart ----------------
  drawMap(dt: number) {
    const x = this.x, w = this.world!, v = this.focus!;
    const body = (v.tel.body || 'earth') as 'earth' | 'moon';
    const bc = this.bodyCenter(body, new THREE.Vector3());
    const R = body === 'moon' ? R_M : R_E, mu = body === 'moon' ? MU_M : MU_E;
    // baanvlak-basis (stabiel)
    const vb = v.vel.clone(); if (body === 'moon') vb.sub(w.ephem.moonPos(w.t + 1, new THREE.Vector3()).sub(bc));
    const r0 = v.pos.clone().sub(bc);
    let n = r0.clone().cross(vb); if (n.lengthSq() < 1e-3) n.set(0, 1, 0); n.normalize();
    if (n.dot(this.mapBasis.n) < 0.999 || this.orbBody !== body) {
      this.mapBasis.n.copy(n);
      const e1 = new THREE.Vector3(0, 1, 0).cross(n); if (e1.lengthSq() < 1e-6) e1.set(1, 0, 0).cross(n);
      this.mapBasis.e1.copy(e1.normalize()); this.mapBasis.e2.copy(n).cross(this.mapBasis.e1).normalize();
      this.mapBasis.e2.negate(); this.mapBasis.e2.copy(this.mapBasis.n).cross(this.mapBasis.e1).normalize();
    }
    // in de kaart kijken we van "boven" het baanvlak: rechts=e1, op=e2, naar kijker=n
    this.tan.copy(this.mapBasis.e1); this.up.copy(this.mapBasis.e2); this.nrm.copy(this.mapBasis.n);
    // banen berekenen
    this.mapLines.t += dt;
    if (this.mapLines.t > 0.25 || !this.orbitPts.length || this.orbBody !== body) { this.mapLines.t = 0; this.computeOrbits(body, bc, R, mu); }
    this.orbBody = body;
    let extent = R * 1.6;
    if (this.mapLines.info && isFinite(this.mapLines.info.apo) && this.mapLines.info.apo > 0) extent = Math.max(extent, Math.min(R + this.mapLines.info.apo, R * 70) * 1.15);
    extent = Math.max(extent, r0.length() * 1.15);
    this.mapZoomS = Math.exp(lerp(Math.log(this.mapZoomS), Math.log(this.mapZoom), Math.min(1, dt * 6)));
    this.mapS = Math.min(this.W, this.H) * 0.46 / extent / this.mapZoomS;
    this.s = this.mapS;
    this.panIdle += dt;
    this.center.copy(bc).addScaledVector(this.tan, this.pan.x).addScaledVector(this.up, this.pan.y);
    this.camECI.copy(this.center).addScaledVector(this.nrm, extent * 2);
    this.camera.position.set(0, 0, extent);
    x.fillStyle = '#03050a'; x.fillRect(0, 0, this.W, this.H);
    this.drawStars(0.9);
    // raster
    x.strokeStyle = 'rgba(90,140,200,.07)'; x.lineWidth = 1;
    for (let gx = (this.W / 2) % 40; gx < this.W; gx += 40) { x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, this.H); x.stroke(); }
    for (let gy = (this.H / 2) % 40; gy < this.H; gy += 40) { x.beginPath(); x.moveTo(0, gy); x.lineTo(this.W, gy); x.stroke(); }
    const moonC = w.ephem.moonPos(w.t, new THREE.Vector3());
    this.drawBody(body, bc, R, body === 'earth');
    if (body === 'earth') { this.drawBody('moon', moonC, R_M, false); this.markerLabel(moonC, 'Maan', '#cfd6e0'); }
    else this.drawBody('earth', new THREE.Vector3(), R_E, true);
    // banen
    x.lineWidth = 2; x.lineJoin = 'round';
    for (const o of this.orbitPts) {
      x.strokeStyle = o.col; x.beginPath();
      for (let i = 0; i < o.n; i++) { _b.set(o.pts[i * 3], o.pts[i * 3 + 1], o.pts[i * 3 + 2]).add(o.c); const px = this.sx(_b), py = this.sy(_b); if (i) x.lineTo(px, py); else x.moveTo(px, py); }
      x.stroke();
    }
    const km = (m: number) => (m / 1000).toLocaleString('nl-NL', { maximumFractionDigits: 0 }) + ' km';
    if (this.apoP && this.mapLines.info) this.markerLabel(this.apoP, 'Ap ' + km(this.mapLines.info.apo), '#ffb347');
    if (this.periP && this.mapLines.info) this.markerLabel(this.periP, 'Pe ' + km(this.mapLines.info.peri), '#5fd4ff');
    // voertuigen
    for (const vh of w.vehicles) {
      if (this.dead.has(vh) || vh.state === 'destroyed') continue;
      const px = this.sx(vh.pos), py = this.sy(vh.pos); const nose = vh.nose(_a);
      const a = Math.atan2(nose.dot(this.tan), nose.dot(this.up));
      x.save(); x.translate(px, py); x.rotate(a);
      x.fillStyle = vh === v ? '#ffd27a' : '#9fc4ff'; x.strokeStyle = 'rgba(0,0,0,.6)'; x.lineWidth = 1.5;
      x.beginPath(); x.moveTo(0, -10); x.lineTo(6, 7); x.lineTo(0, 4); x.lineTo(-6, 7); x.closePath(); x.stroke(); x.fill(); x.restore();
    }
  }
  markerLabel(p: THREE.Vector3, txt: string, col: string) {
    const x = this.x, px = this.sx(p), py = this.sy(p);
    if (px < -50 || py < -20 || px > this.W + 50 || py > this.H + 20) return;
    x.fillStyle = col; x.beginPath(); x.arc(px, py, 4, 0, Math.PI * 2); x.fill();
    x.font = '600 12px system-ui, sans-serif'; x.fillStyle = 'rgba(0,0,0,.6)'; x.fillText(txt, px + 8, py + 5); x.fillStyle = col; x.fillText(txt, px + 7, py + 4);
  }
  computeOrbits(body: 'earth' | 'moon', bc: THREE.Vector3, R: number, mu: number) {
    const w = this.world!, v = this.focus!;
    const cols = ['#5fd4ff', '#ffb347', '#8cff9e'];
    const vs = [v, ...w.vehicles.filter((o) => o !== v && o.state === 'flying')].slice(0, 3);
    this.orbitPts = []; this.apoP = this.periP = null;
    const N = 240;
    vs.forEach((vh, idx) => {
      if (vh.state === 'destroyed' || vh.state === 'landed' || vh.state === 'clamped') { if (idx === 0) this.mapLines.info = null; return; }
      const vb = vh.vel.clone(); if (body === 'moon') vb.sub(w.ephem.moonPos(w.t + 1, new THREE.Vector3()).sub(bc));
      const r0 = vh.pos.clone().sub(bc);
      const el = elements(r0, vb, mu, R);
      const T = el.e < 1 && isFinite(el.period) ? el.period : 3 * 86400;
      const dtk = Math.min(T, 4 * 86400) / (N - 1);
      const pts = new Float32Array(N * 3); const r = new THREE.Vector3(), vv = new THREE.Vector3();
      let n = 0;
      for (let k = 0; k < N; k++) {
        if (k === 0) r.copy(r0); else kepler(r0, vb, dtk * k, mu, r, vv);
        if (k > 0 && r.length() < R * 0.999) break;
        pts[k * 3] = r.x; pts[k * 3 + 1] = r.y; pts[k * 3 + 2] = r.z; n = k + 1;
      }
      this.orbitPts.push({ pts, n, c: bc.clone(), col: cols[idx] });
      if (idx === 0) {
        this.mapLines.info = { apo: el.apo, peri: el.peri, body };
        const ev = el.evec.clone(); const e = ev.length();
        if (e > 1e-4) {
          ev.normalize();
          if (el.peri > -R * 0.9) this.periP = ev.clone().multiplyScalar(el.a * (1 - e)).add(bc);
          if (e < 1) this.apoP = ev.clone().multiplyScalar(-el.a * (1 + e)).add(bc);
        }
      }
    });
  }
}
