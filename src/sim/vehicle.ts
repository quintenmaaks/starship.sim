import * as THREE from 'three';
import { EngineSpec, StageSpec, VehicleSpec } from './spec';
import { atmosphere } from './atmosphere';
import { G0, P0 } from './constants';
import { clamp } from '../core/util';

export interface Reliability {
  engineIgnition: number; engineRun: number; engineRud: number;
  structure: number; tiles: number; flaps: number; avionics: number;
  legs: number; catchSys: number; sep: number; rcs: number;
}
export const PERFECT: Reliability = { engineIgnition: 0, engineRun: 0, engineRud: 0, structure: 1, tiles: 0, flaps: 0, avionics: 0, legs: 0, catchSys: 0, sep: 0, rcs: 0 };

export interface EngineRT { spec: EngineSpec; on: boolean; failed: boolean; throttle: number; ignitions: number; rud: boolean; selected: boolean; spool: number; }
export interface StageRT {
  spec: StageSpec; prop: number; engines: EngineRT[];
  flapHealth: number; tileHealth: number; shieldT: number; burn: number; legHealth: number; finHealth: number;
}
export type VState = 'clamped' | 'flying' | 'landed' | 'caught' | 'splashed' | 'destroyed';

export interface Telemetry {
  alt: number; agl: number; vSurf: number; vOrb: number; vVert: number; vHoriz: number; mach: number; q: number; gLoad: number; alpha: number;
  heatFlux: number; rho: number; pAmb: number; thrust: number; twr: number; mass: number; tilt: number; body: 'earth' | 'moon';
  lat: number; lon: number; downrange: number;
}

let VID = 1;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const Yb = new THREE.Vector3(0, 1, 0);

export class Vehicle {
  id = VID++;
  name: string;
  role: 'stack' | 'booster' | 'ship' | 'tanker' | 'lander';
  spec: VehicleSpec;
  stages: StageRT[];
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  q = new THREE.Quaternion();
  w = new THREE.Vector3();          // body rad/s
  cmdThrottle = 0;
  flapsOn = true; finsOut = false; legsDown = false; rcsOn = true;
  sas: 'off' | 'hold' | 'target' = 'hold';
  holdQuat = new THREE.Quaternion();
  targetQuat = new THREE.Quaternion();
  input = new THREE.Vector3();      // pitch(x), roll(y), yaw(z) manueel -1..1
  state: VState = 'flying';
  rel: Reliability = PERFECT;
  rng: () => number = Math.random;
  tel: Telemetry = { alt: 0, agl: 0, vSurf: 0, vOrb: 0, vVert: 0, vHoriz: 0, mach: 0, q: 0, gLoad: 0, alpha: 0, heatFlux: 0, rho: 0, pAmb: P0, thrust: 0, twr: 0, mass: 0, tilt: 0, body: 'earth', lat: 0, lon: 0, downrange: 0 };
  vRel = new THREE.Vector3();
  accel = new THREE.Vector3();
  log: (txt: string, kind?: string) => void = () => {};
  maxQSeen = 0; maxGSeen = 0; maxHeat = 0; maxAlt = 0; maxSpeed = 0;
  structDamage = 0;
  ap: any = null;                   // autopiloot
  failureCause = '';
  wind = new THREE.Vector3();
  caughtBy: string | null = null;
  propTransferred = 0;
  crewSafe = true;
  avionicsGlitch = 0;
  sepFailed = false;
  splashTimer = 0;

  constructor(spec: VehicleSpec, role: Vehicle['role'], stages?: StageRT[]) {
    this.spec = spec;
    this.name = spec.name;
    this.role = role;
    this.stages = stages || spec.stages.map((s) => Vehicle.makeStage(s));
  }
  static makeStage(s: StageSpec): StageRT {
    return {
      spec: s, prop: s.propMax,
      engines: s.engines.map((e) => ({ spec: e, on: false, failed: false, throttle: 0, ignitions: 0, rud: false, selected: true, spool: 0 })),
      flapHealth: s.flaps ? 1 : 0, tileHealth: s.heatShield, shieldT: 290, burn: 0, legHealth: s.legs ? 1 : 0, finHealth: s.gridFins ? 1 : 0,
    };
  }
  get active(): StageRT { return this.stages[0]; }
  get top(): StageRT { return this.stages[this.stages.length - 1]; }
  get length() { return this.stages.reduce((s, st) => s + st.spec.length, 0); }
  get diameter() { return this.stages[0].spec.diameter; }
  get mass() {
    let m = 0;
    for (const s of this.stages) m += s.spec.dry + s.prop + s.spec.payload + s.spec.crew * 100;
    return m;
  }
  get propFrac() { const s = this.active; return s.prop / Math.max(1, s.spec.propMax); }
  com() {
    let h = 0, m = 0, y = 0;
    for (const s of this.stages) {
      const ms = s.spec.dry + s.prop + s.spec.payload;
      // brandstof zakt naar onderen
      const fill = s.prop / Math.max(1, s.spec.propMax);
      const yc = y + s.spec.length * (0.5 - 0.25 * (1 - fill) * 0 - 0.1);
      h += ms * yc; m += ms; y += s.spec.length;
    }
    return h / m;
  }
  inertia() {
    const comY = this.com();
    let I = 0, y = 0, m = 0;
    for (const s of this.stages) {
      const ms = s.spec.dry + s.prop + s.spec.payload;
      const L = s.spec.length; const yc = y + L / 2;
      I += ms * (L * L / 12 + (yc - comY) ** 2);
      m += ms; y += L;
    }
    const r = this.diameter / 2;
    return { pitch: Math.max(I, 1), roll: Math.max(m * r * r / 2, 1) };
  }
  nose(out = new THREE.Vector3()) { return out.copy(Yb).applyQuaternion(this.q); }
  belly(out = new THREE.Vector3()) { return out.set(0, 0, 1).applyQuaternion(this.q); }
  hasEngines() { return this.active.engines.some((e) => !e.failed); }
  enginesRunning() { return this.active.engines.filter((e) => e.on && !e.failed).length; }

  selectEngines(mode: 'all' | 'center' | 'inner' | 'sl' | 'vac' | 'three') {
    const st = this.active;
    let count = 0;
    for (const e of st.engines) {
      let sel = true;
      if (mode === 'center') sel = e.spec.ring === 0;
      if (mode === 'inner') sel = e.spec.ring <= 1;
      if (mode === 'sl') sel = e.spec.kind === 'sl';
      if (mode === 'vac') sel = e.spec.kind === 'vac';
      if (mode === 'three') sel = e.spec.kind === 'sl' && e.spec.ring <= 1;
      e.selected = sel;
      if (sel) count++;
    }
    if (count === 0) st.engines.forEach((e) => (e.selected = e.spec.kind === 'sl' || st.engines.every((x) => x.spec.kind === 'vac')));
  }

  // Motoren aan/uit volgens throttle-commando
  updateEngines(dt: number, pAmb: number, time: number) {
    const st = this.active;
    const want = this.cmdThrottle > 0.001 && st.prop > 0;
    for (const e of st.engines) {
      if (e.failed) { e.on = false; e.throttle = 0; continue; }
      const shouldOn = want && e.selected;
      if (shouldOn && !e.on) {
        e.on = true; e.ignitions++; e.spool = 0;
        if (this.rng() < this.rel.engineIgnition * (e.ignitions > 1 ? 1.6 : 1)) {
          this.failEngine(st, e, 'ontstekingsfout', this.rng() < this.rel.engineRud * 0.5);
          continue;
        }
      } else if (!shouldOn && e.on) { e.on = false; }
      const target = e.on ? Math.max(e.spec.minThrottle, this.cmdThrottle) : 0;
      e.spool = clamp(e.spool + dt / 1.2, 0, 1);
      const rate = e.on ? 0.8 : 2.5;
      e.throttle += clamp(target * (e.on ? e.spool : 1) - e.throttle, -rate * dt, rate * dt);
      // looptijdstoringen
      if (e.on && e.throttle > 0.2) {
        let hz = this.rel.engineRun;
        if (e.spec.kind === 'vac' && pAmb > 30000) hz += 0.02 * (pAmb / P0); // stromingsloslating
        if (this.tel.q > 30000) hz *= 1.5;
        if (this.rng() < hz * dt) this.failEngine(st, e, 'motorstoring', this.rng() < this.rel.engineRud);
      }
    }
  }
  failEngine(st: StageRT, e: EngineRT, why: string, violent: boolean) {
    if (e.failed) return;
    e.failed = true; e.on = false; e.throttle = 0; e.rud = violent;
    const idx = st.engines.indexOf(e) + 1;
    this.log(`${st.spec.name}: motor ${idx} uitgevallen (${why}${violent ? ', explosief' : ''})`, 'fail');
    if (violent) {
      // schade aan buurmotoren
      for (const o of st.engines) {
        if (o === e || o.failed) continue;
        const d = Math.hypot(o.spec.x - e.spec.x, o.spec.z - e.spec.z);
        if (d < 2.2 && this.rng() < 0.35) { o.failed = true; o.on = false; o.throttle = 0; this.log(`${st.spec.name}: motor ${st.engines.indexOf(o) + 1} beschadigd door buurexplosie`, 'fail'); }
      }
      if (this.rng() < 0.12 + (st.engines.length < 8 ? 0.15 : 0)) this.destroy('Motorexplosie scheurde de motorsectie open');
    }
  }

  thrustInfo(pAmb: number) {
    const st = this.active;
    let F = 0, mdot = 0, tx = 0, tz = 0, gimbalAuth = 0, rollAuth = 0;
    for (const e of st.engines) {
      if (!e.on || e.failed || e.throttle <= 0) continue;
      const s = e.spec;
      const Ae = s.thrustVac * (1 - s.ispSL / s.ispVac) / P0;
      const f = Math.max(0, e.throttle * s.thrustVac - pAmb * Ae);
      F += f; mdot += e.throttle * s.thrustVac / (s.ispVac * G0);
      tx += f * s.x; tz += f * s.z;
      gimbalAuth += f * Math.sin(s.gimbal);
      rollAuth += f * Math.sin(s.gimbal) * Math.hypot(s.x, s.z) * 0.5;
    }
    return { F, mdot, tx, tz, gimbalAuth, rollAuth };
  }

  destroy(cause: string) {
    if (this.state === 'destroyed') return;
    this.state = 'destroyed';
    this.failureCause = cause;
    this.cmdThrottle = 0;
    this.crewSafe = false;
    for (const s of this.stages) for (const e of s.engines) { e.on = false; e.throttle = 0; }
    this.log(`RUD — ${cause}`, 'rud');
  }
}

// ---- Krachten & integratie (wordt aangeroepen door World) ----
export interface EnvSample { center: THREE.Vector3; bodyR: number; body: 'earth' | 'moon'; atmo: boolean; omega: THREE.Vector3; }

export function stepAttitude(v: Vehicle, dt: number, qdyn: number, uBody: THREE.Vector3, mach: number, gimbalAuth: number, rollAuth: number, tx: number, tz: number) {
  const I = v.inertia();
  const L = v.length, D = v.diameter;
  const comY = v.com();
  const st = v.active;
  const single = v.stages.length === 1;
  const S = L * D;
  // ---- Aerodynamisch moment (stabiliteit naar 'lead'-as) ----
  const tau = _a.set(0, 0, 0);
  if (qdyn > 1 && uBody.lengthSq() > 0.5) {
    let lead: THREE.Vector3 | null = null, c = 0;
    if (!single) { lead = _b.set(0, 1, 0); c = -0.004; }
    else if (st.spec.kind === 'booster') { if (v.finsOut && st.finHealth > 0.3) { lead = _b.set(0, -1, 0); c = 0.05; } else { lead = _b.set(0, -1, 0); c = 0.012; } }
    else {
      if (st.spec.flaps && st.flapHealth > 0.4 && v.flapsOn) { lead = _b.set(0, -0.25, 1).normalize(); c = 0.02; }
      else { lead = _b.set(0, -1, 0); c = 0.04; }
    }
    const cross = _c.crossVectors(lead, uBody);
    tau.addScaledVector(cross, c * qdyn * S * L * 0.5);
    // aerodemping
    const damp = 0.08 * qdyn * S * L * L / Math.max(v.tel.vSurf, 40);
    tau.x -= v.w.x * damp; tau.z -= v.w.z * damp; tau.y -= v.w.y * damp * 0.05;
  }
  // asymmetrische stuwkracht (motoruitval)
  const lever = Math.max(comY, 1);
  tau.x += -tz * 0.0 + tz * 0; // r x F met r=(x,-lever,z),F=(0,T,0) => (-zT,0,xT)
  tau.x += -tz; tau.z += tx;
  // ---- Regelautoriteit ----
  const authPY = gimbalAuth * lever + (v.rcsOn ? st.spec.rcs * L * 0.5 : 0)
    + (st.spec.flaps && v.flapsOn ? qdyn * S * 0.05 * L * st.flapHealth : 0)
    + (st.spec.gridFins && v.finsOut ? qdyn * D * D * 0.6 * L * st.finHealth : 0);
  const authR = rollAuth + (v.rcsOn ? st.spec.rcs * D * 0.5 : 0) + (st.spec.flaps && v.flapsOn ? qdyn * S * 0.02 * D * st.flapHealth : 0)
    + (st.spec.gridFins && v.finsOut ? qdyn * D * D * 0.3 * D * st.finHealth : 0);
  // ---- Gewenst moment (SAS) ----
  const des = _d.set(0, 0, 0);
  const maxRate = 0.35, maxRoll = 0.6;
  const hasInput = v.input.lengthSq() > 0.0025;
  const glitch = v.avionicsGlitch > 0;
  if (!glitch) {
    if (hasInput) {
      des.set(v.input.x * maxRate, v.input.y * maxRoll, v.input.z * maxRate).sub(v.w).multiplyScalar(3);
      v.holdQuat.copy(v.q);
    } else if (v.sas !== 'off') {
      const tq = v.sas === 'target' ? v.targetQuat : v.holdQuat;
      // fout-quaternion in body-frame
      _qa.copy(v.q).invert().multiply(tq);
      if (_qa.w < 0) { _qa.x *= -1; _qa.y *= -1; _qa.z *= -1; _qa.w *= -1; }
      const ang = 2 * Math.acos(clamp(_qa.w, -1, 1));
      const sn = Math.sqrt(Math.max(1 - _qa.w * _qa.w, 1e-12));
      const ex = _qa.x / sn * ang, ey = _qa.y / sn * ang, ez = _qa.z / sn * ang;
      // tijdoptimale snelheid gegeven beschikbare versnelling
      const accPY = authPY / I.pitch, accR = authR / I.roll;
      const rt = (e: number, acc: number, mr: number) => Math.sign(e) * Math.min(mr, Math.sqrt(2 * Math.max(acc, 1e-4) * 0.6 * Math.abs(e)), Math.abs(e) * 2.0);
      des.set(rt(ex, accPY, maxRate) - v.w.x, rt(ey, accR, maxRoll) - v.w.y, rt(ez, accPY, maxRate) - v.w.z).multiplyScalar(4);
    }
  }
  // moment = I * gewenste hoekversnelling, begrensd door autoriteit (na compensatie van verstoring)
  const ctl = _c.set(
    clamp(des.x * I.pitch - tau.x, -authPY, authPY),
    clamp(des.y * I.roll - tau.y, -authR, authR),
    clamp(des.z * I.pitch - tau.z, -authPY, authPY));
  if (v.sas === 'off' && !hasInput) ctl.set(0, 0, 0);
  if (glitch) ctl.multiplyScalar(0.1);
  tau.add(ctl);
  v.w.x += tau.x / I.pitch * dt; v.w.y += tau.y / I.roll * dt; v.w.z += tau.z / I.pitch * dt;
  const wl = v.w.length();
  if (wl > 3) v.w.multiplyScalar(3 / wl);
  if (wl > 1e-9) {
    _qb.setFromAxisAngle(_b.copy(v.w).multiplyScalar(1 / wl), wl * dt);
    v.q.multiply(_qb).normalize();
  }
  return { authPY, authR };
}

// Aerodynamische kracht in wereldframe. uBody: eenheidsvector luchtsnelheid in body-frame
export function aeroForce(v: Vehicle, qdyn: number, mach: number, vrelW: THREE.Vector3, out: THREE.Vector3) {
  out.set(0, 0, 0);
  const vr = vrelW.length();
  if (qdyn < 0.01 || vr < 0.1) return out;
  const L = v.length, D = v.diameter;
  const A = Math.PI * D * D / 4, S = L * D * 0.9;
  // Mach-afhankelijke coëfficiënten
  let cda = mach < 0.8 ? 0.35 : mach < 1.1 ? 0.35 + (mach - 0.8) / 0.3 * 0.55 : Math.max(0.5, 0.9 - (mach - 1.1) * 0.12);
  let cn = mach < 0.8 ? 1.0 : mach < 1.2 ? 1.0 + (mach - 0.8) * 1.0 : 1.4;
  const st = v.active;
  // stomp achterwaarts (motoren eerst): hogere basisweerstand
  _qa.copy(v.q).invert();
  const uy0 = _a.copy(vrelW).multiplyScalar(1 / vr).applyQuaternion(_qa).y;
  if (uy0 < -0.5) cda = mach < 0.8 ? 0.9 : mach < 1.2 ? 0.9 + (mach - 0.8) * 1.0 : 1.3;
  if (st.spec.gridFins && v.finsOut) cda += 0.6 * st.finHealth;
  if (v.legsDown) cda += 0.05;
  // body-frame luchtstroom
  _qa.copy(v.q).invert();
  const u = _a.copy(vrelW).multiplyScalar(1 / vr).applyQuaternion(_qa);
  const uy = u.y;
  const perp = _b.set(u.x, 0, u.z);
  const pl = perp.length();
  // flaps vergroten weerstand in buiklandingshouding
  if (st.spec.flaps && v.flapsOn && v.stages.length === 1) cn += (mach < 0.9 ? 0.45 : 0.15) * st.flapHealth;
  const fb = _c.set(0, -qdyn * A * cda * uy * Math.abs(uy), 0);
  fb.addScaledVector(perp, -qdyn * S * cn * pl);
  // kleine lift langs de buik (glijden in subsone fase)
  if (v.stages.length === 1 && st.spec.flaps && v.flapsOn && mach < 0.9) {
    const liftDir = _d.set(0, 1, 0).sub(_b.copy(u).multiplyScalar(uy));
    if (liftDir.lengthSq() > 1e-6) fb.addScaledVector(liftDir.normalize(), qdyn * S * 0.25 * Math.abs(uy) * Math.sqrt(Math.max(0, 1 - uy * uy)) * st.flapHealth);
  }
  out.copy(fb).applyQuaternion(v.q);
  return out;
}
export { Yb };
