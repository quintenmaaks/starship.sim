import * as THREE from 'three';
import { Ephemeris } from './bodies';
import { Vehicle, aeroForce, stepAttitude, StageRT } from './vehicle';
import { atmosphere } from './atmosphere';
import { MOON_PERIOD, MOON_SOI, MU_E, MU_M, OMEGA_E, R_E, R_M, ATMO_TOP, G0 } from './constants';
import { REGIONS, RegionDef, PadDef } from './terrain';
import { kepler } from './orbit';
import { VehicleSpec } from './spec';
import { clamp } from '../core/util';

export interface SimEvent { t: number; text: string; kind: string; vehicle?: Vehicle; pos?: THREE.Vector3; data?: any; }
export interface RegionFrame { def: RegionDef; origin: THREE.Vector3; quat: THREE.Quaternion; inv: THREE.Quaternion; center: THREE.Vector3; up: THREE.Vector3; }
export interface TowerState { key: string; region: string; pad: PadDef; armH: number; armOpen: number; armTargetH: number; caught: Vehicle | null; damaged: boolean; }
interface Anchor { region: string; local: THREE.Vector3; lq: THREE.Quaternion; }

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3(), _s3 = new THREE.Vector3();
const _atm = { p: 0, rho: 0, T: 0, a: 0 };
const OMEGA = new THREE.Vector3(0, OMEGA_E, 0);

export class World {
  ephem: Ephemeris;
  t = 0;
  vehicles: Vehicle[] = [];
  events: SimEvent[] = [];
  listeners: ((e: SimEvent) => void)[] = [];
  towers: TowerState[] = [];
  regions: RegionDef[];
  frames: Record<string, RegionFrame> = {};
  anchors = new Map<Vehicle, Anchor>();
  windBase = new THREE.Vector3(); // lokaal (oost, -, zuid) m/s
  gust = 0; gustT = 0;
  windStrength = 6;
  rng: () => number = Math.random;
  launchT = 0;     // T-0 (missietijd)
  dt = 0.02;
  acc = 0;
  warp = 1;
  railMode = false;
  constructor(ephem: Ephemeris, regionIds: string[]) {
    this.ephem = ephem;
    this.regions = regionIds.map((r) => REGIONS[r]);
    for (const r of this.regions) for (const p of r.pads) if (p.tower) {
      this.towers.push({ key: r.id + ':' + p.id, region: r.id, pad: p, armH: 90, armOpen: 1, armTargetH: 90, caught: null, damaged: false });
    }
    this.updateFrames();
    const a = this.rng() * Math.PI * 2;
    this.windBase.set(Math.cos(a), 0, Math.sin(a));
  }
  on(f: (e: SimEvent) => void) { this.listeners.push(f); }
  emit(text: string, kind = 'info', vehicle?: Vehicle, data?: any) {
    const e: SimEvent = { t: this.t - this.launchT, text, kind, vehicle, pos: vehicle ? vehicle.pos.clone() : undefined, data };
    this.events.push(e);
    for (const f of this.listeners) f(e);
  }
  updateFrames() {
    for (const r of this.regions) {
      const f = this.ephem.frameAt(r.body, r.lat, r.lon, 0, this.t);
      const fr = this.frames[r.id] || (this.frames[r.id] = { def: r, origin: new THREE.Vector3(), quat: new THREE.Quaternion(), inv: new THREE.Quaternion(), center: new THREE.Vector3(), up: new THREE.Vector3() });
      fr.origin.copy(f.pos); fr.quat.copy(f.quat); fr.inv.copy(f.quat).invert(); fr.center.copy(f.center); fr.up.copy(f.up);
    }
  }
  toLocal(region: string, p: THREE.Vector3, out = new THREE.Vector3()) {
    const f = this.frames[region];
    return out.copy(p).sub(f.origin).applyQuaternion(f.inv);
  }
  toWorld(region: string, l: THREE.Vector3, out = new THREE.Vector3()) {
    const f = this.frames[region];
    return out.copy(l).applyQuaternion(f.quat).add(f.origin);
  }
  surfaceVel(body: 'earth' | 'moon', p: THREE.Vector3, out = new THREE.Vector3()) {
    if (body === 'earth') return out.crossVectors(OMEGA, p);
    const c = this.ephem.moonPos(this.t, _s1);
    const n = this.ephem.moonNormal(_s2).multiplyScalar(2 * Math.PI / MOON_PERIOD);
    out.crossVectors(n, _s3.copy(p).sub(c));
    return out.add(this.ephem.moonVel(this.t, _s1));
  }
  dominant(p: THREE.Vector3): 'earth' | 'moon' {
    const m = this.ephem.moonPos(this.t, _v4);
    return p.distanceTo(m) < MOON_SOI ? 'moon' : 'earth';
  }
  regionFor(v: Vehicle, body: 'earth' | 'moon'): RegionFrame | null {
    for (const r of this.regions) {
      if (r.body !== body) continue;
      const l = this.toLocal(r.id, v.pos, _v1);
      if (Math.abs(l.x) < r.extent && Math.abs(l.z) < r.extent && l.y < 400000) return this.frames[r.id];
    }
    return null;
  }

  // ---- Voertuig plaatsen ----
  spawnOnPad(spec: VehicleSpec, role: Vehicle['role'], regionId: string, padId: string, extraH = 0, fills?: number[]) {
    const v = new Vehicle(spec, role);
    if (fills) v.stages.forEach((s, i) => { if (fills[i] !== undefined) s.prop = s.spec.propMax * fills[i]; });
    const pad = REGIONS[regionId].pads.find((p) => p.id === padId)!;
    this.placeAnchored(v, regionId, new THREE.Vector3(pad.x, REGIONS[regionId].height(pad.x, pad.z) * 0 + pad.top + extraH, pad.z), new THREE.Quaternion());
    v.state = 'clamped';
    this.add(v);
    return v;
  }
  placeAnchored(v: Vehicle, region: string, local: THREE.Vector3, lq: THREE.Quaternion) {
    this.anchors.set(v, { region, local: local.clone(), lq: lq.clone() });
    this.applyAnchor(v);
  }
  applyAnchor(v: Vehicle) {
    const a = this.anchors.get(v);
    if (!a) return;
    const f = this.frames[a.region];
    this.toWorld(a.region, a.local, v.pos);
    v.q.copy(f.quat).multiply(a.lq);
    this.surfaceVel(f.def.body, v.pos, v.vel);
    v.w.set(0, 0, 0);
  }
  anchorHere(v: Vehicle, region: string) {
    const f = this.frames[region];
    const local = this.toLocal(region, v.pos);
    const lq = f.inv.clone().multiply(v.q);
    this.anchors.set(v, { region, local, lq });
  }
  add(v: Vehicle) {
    v.log = (txt, kind) => this.emit(txt, kind || 'info', v);
    v.rng = this.rng;
    this.vehicles.push(v);
  }
  release(v: Vehicle) {
    this.anchors.delete(v);
    v.state = 'flying';
    v.holdQuat.copy(v.q);
  }

  // ---- Trapscheiding (hot staging) ----
  stage(v: Vehicle): Vehicle | null {
    if (v.stages.length < 2 || v.state !== 'flying') return null;
    if (this.rng() < v.rel.sep) {
      v.sepFailed = true;
      this.emit('Trapscheiding mislukt — klemmen geven niet los!', 'fail', v);
      return null;
    }
    const lower: StageRT = v.stages.shift()!;
    const bSpec: VehicleSpec = { name: lower.spec.name, stages: [lower.spec] };
    const b = new Vehicle(bSpec, 'booster', [lower]);
    b.pos.copy(v.pos); b.vel.copy(v.vel); b.q.copy(v.q); b.w.copy(v.w);
    b.rel = v.rel; b.holdQuat.copy(v.q);
    const axis = v.nose(_v1);
    v.pos.addScaledVector(axis, lower.spec.length);
    v.vel.addScaledVector(axis, 1.5);
    b.vel.addScaledVector(axis, -1.0);
    b.cmdThrottle = 0;
    for (const e of lower.engines) { if (e.on) e.throttle = Math.min(e.throttle, 0.4); }
    v.role = v.stages[0].spec.kind === 'ship' ? 'ship' : v.role;
    v.name = v.stages[0].spec.name;
    b.state = 'flying';
    this.add(b);
    this.emit('Hot staging — trapscheiding bevestigd', 'stage', v);
    return b;
  }

  // ---- Hoofdlus ----
  advance(frameDt: number, focus: Vehicle | null) {
    const total = frameDt * this.warp;
    const coasting = this.vehicles.every((v) => v.state === 'destroyed' || this.anchors.has(v) || (v.cmdThrottle === 0 && v.tel.alt > ATMO_TOP && !(v.ap && v.ap.busy && v.ap.busy())));
    this.railMode = this.warp > 4 && coasting;
    if (this.railMode) {
      let left = total;
      while (left > 0 && this.railMode) {
        const h = Math.min(left, 20);
        this.railStep(h);
        left -= h;
        if (this.warp <= 4) break;
      }
      return;
    }
    this.acc += Math.min(total, 0.25 * Math.max(1, this.warp));
    let n = 0;
    while (this.acc >= this.dt && n < 400) {
      this.step(this.dt);
      this.acc -= this.dt; n++;
    }
  }

  railStep(h: number) {
    this.t += h;
    this.updateFrames();
    const mp = this.ephem.moonPos(this.t - h, new THREE.Vector3()), mv = this.ephem.moonVel(this.t - h, new THREE.Vector3());
    const mp2 = this.ephem.moonPos(this.t, new THREE.Vector3()), mv2 = this.ephem.moonVel(this.t, new THREE.Vector3());
    for (const v of this.vehicles) {
      if (v.state === 'destroyed') continue;
      if (this.anchors.has(v)) { this.applyAnchor(v); continue; }
      const body = v.pos.distanceTo(mp) < MOON_SOI ? 'moon' : 'earth';
      if (body === 'earth') {
        kepler(v.pos.clone(), v.vel.clone(), h, MU_E, v.pos, v.vel);
      } else {
        const r = v.pos.clone().sub(mp), vv = v.vel.clone().sub(mv);
        kepler(r, vv, h, MU_M, r, vv);
        v.pos.copy(r).add(mp2); v.vel.copy(vv).add(mv2);
      }
      this.telemetry(v);
      if (v.ap && !v.ap.done) { v.ap.update(h, this); if (v.cmdThrottle > 0) { this.warp = Math.min(this.warp, 1); } }
      // tijdens tijdversnelling: houding direct op doel (zoals SAS 'op rails')
      if (v.sas === 'target') v.q.copy(v.targetQuat);
      v.w.set(0, 0, 0);
      const bodyR = v.tel.body === 'earth' ? R_E : R_M;
      if (v.tel.alt < (v.tel.body === 'earth' ? ATMO_TOP : 5000)) { this.warp = Math.min(this.warp, 4); }
      if (v.tel.alt < 0 && bodyR) { v.destroy('Inslag tijdens tijdversnelling'); this.emit('Inslag!', 'rud', v); }
    }
    this.towersStep(h);
  }

  step(dt: number) {
    // windvlagen
    this.gustT -= dt;
    if (this.gustT < 0) { this.gustT = 2 + this.rng() * 5; this.gust = (this.rng() - 0.3) * this.windStrength * 0.8; }
    const list = this.vehicles.slice();
    const regs = list.map((v) => this.stepVehicle(v, dt));
    // tijd en frames naar t+dt, daarna contact
    this.t += dt;
    this.updateFrames();
    list.forEach((v, i) => {
      if (this.anchors.has(v)) { this.applyAnchor(v); return; }
      if (regs[i] !== undefined && v.state === 'flying') this.ground(v, this.regionFor(v, this.dominant(v.pos)), dt);
    });
    this.towersStep(dt);
    this.postStep(dt);
  }

  towersStep(dt: number) {
    for (const tw of this.towers) {
      tw.armH += clamp(tw.armTargetH - tw.armH, -6 * dt, 6 * dt);
      if (tw.caught) {
        tw.armOpen = Math.max(0, tw.armOpen - dt * 0.6);
        const v = tw.caught;
        if (v.state === 'caught') this.applyAnchor(v);
      }
    }
  }

  telemetry(v: Vehicle) {
    const body = this.dominant(v.pos);
    const center = body === 'earth' ? _v2.set(0, 0, 0) : this.ephem.moonPos(this.t, _v2);
    const rel = _v3.copy(v.pos).sub(center);
    const r = rel.length();
    const bodyR = body === 'earth' ? R_E : R_M;
    const T = v.tel;
    T.body = body;
    T.alt = r - bodyR;
    const up = rel.multiplyScalar(1 / r);
    const sv = this.surfaceVel(body, v.pos, _v4);
    const vs = _v5.copy(v.vel).sub(sv);
    if (body === 'earth') {
      const a = atmosphere(T.alt, _atm);
      T.rho = T.alt < 160000 ? a.rho : 0; T.pAmb = T.alt < 160000 ? a.p : 0;
      T.mach = vs.length() / a.a;
    } else { T.rho = 0; T.pAmb = 0; T.mach = 0; }
    T.vSurf = vs.length();
    T.vVert = vs.dot(up);
    T.vHoriz = Math.sqrt(Math.max(0, T.vSurf * T.vSurf - T.vVert * T.vVert));
    const vOrb = _v1.copy(v.vel);
    if (body === 'moon') vOrb.sub(this.ephem.moonVel(this.t, _v4));
    T.vOrb = vOrb.length();
    T.q = 0.5 * T.rho * T.vSurf * T.vSurf;
    T.mass = v.mass;
    const nose = v.nose(_v1);
    T.tilt = Math.acos(clamp(nose.dot(up), -1, 1)) * 180 / Math.PI;
    T.alpha = T.vSurf > 1 ? Math.acos(clamp(nose.dot(vs) / T.vSurf, -1, 1)) * 180 / Math.PI : 0;
    T.lat = Math.asin(clamp(up.y, -1, 1)) * 180 / Math.PI;
    // lokale hoogte boven terrein
    const reg = this.regionFor(v, body);
    let gh = 0;
    if (reg) {
      const l = this.toLocal(reg.def.id, v.pos, _v1);
      gh = this.groundAt(reg, l.x, l.z, v).h;
    }
    T.agl = T.alt - gh;
    v.vRel.copy(vs);
    if (T.alt > v.maxAlt) v.maxAlt = T.alt;
    if (T.vOrb > v.maxSpeed && v.state === 'flying') v.maxSpeed = T.vOrb;
    return up;
  }

  groundAt(reg: RegionFrame, x: number, z: number, v?: Vehicle): { h: number; water: boolean; pad: PadDef | null } {
    const def = reg.def;
    let h = def.height(x, z);
    let water = def.water(x, z);
    let pad: PadDef | null = null;
    for (const p of def.pads) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.r) { h = Math.max(h, p.top); pad = p; water = false; }
    }
    if (water) h = 0;
    return { h, water, pad };
  }

  stepVehicle(v: Vehicle, dt: number): RegionFrame | null | undefined {
    if (v.state === 'destroyed') return undefined;
    if (v.state === 'splashed' && !this.anchors.has(v)) { v.pos.applyAxisAngle(new THREE.Vector3(0, 1, 0), OMEGA_E * dt); this.telemetry(v); return undefined; }
    if (v.ap && !v.ap.done) v.ap.update(dt, this);
    const up = this.telemetry(v).clone();
    const T = v.tel;
    if (v.avionicsGlitch > 0) v.avionicsGlitch -= dt;
    // ---- verankerd (klem / geland / gevangen) ----
    if (this.anchors.has(v)) {
      v.updateEngines(dt, T.pAmb, this.t);
      const th = v.thrustInfo(T.pAmb);
      T.thrust = th.F; T.twr = th.F / (v.mass * (T.body === 'earth' ? G0 : 1.62));
      v.active.prop = Math.max(0, v.active.prop - th.mdot * dt);
      if (v.state === 'clamped' && v.cmdThrottle > 0 && this.t >= this.launchT && th.F > v.mass * G0 * 1.02 && (v as any).releaseArmed) {
        this.release(v);
        this.emit('Lancering! Losgelaten van de klemmen', 'liftoff', v);
      } else if (v.state === 'landed' && th.F > v.mass * (T.body === 'earth' ? G0 : 1.62) * 1.02) {
        this.release(v); this.emit('Opstijgen', 'liftoff', v);
      } else {
        this.applyAnchor(v);
        if (v.state === 'clamped' && th.F > 0) (v as any).staticFireTime = ((v as any).staticFireTime || 0) + dt;
        return undefined;
      }
    }
    // ---- motoren ----
    v.updateEngines(dt, T.pAmb, this.t);
    const th = v.thrustInfo(T.pAmb);
    const m = v.mass;
    T.thrust = th.F;
    const gLocal = T.body === 'earth' ? MU_E / (R_E + T.alt) ** 2 : MU_M / (R_M + T.alt) ** 2;
    T.twr = th.F / (m * gLocal);
    // ---- wind & luchtsnelheid ----
    const reg = this.regionFor(v, T.body);
    if (reg && T.body === 'earth' && T.alt < 15000) {
      const ws = (this.windStrength + this.gust) * clamp(0.4 + T.alt / 3000, 0.4, 2.2);
      v.wind.copy(this.windBase).multiplyScalar(ws).applyQuaternion(reg.quat);
    } else v.wind.set(0, 0, 0);
    const vrel = _v1.copy(v.vRel).sub(v.wind);
    const vr = vrel.length();
    const qdyn = 0.5 * T.rho * vr * vr;
    T.q = qdyn;
    if (qdyn > v.maxQSeen) v.maxQSeen = qdyn;
    const qi = _q1.copy(v.q).invert();
    const uBody = _v2.copy(vrel).multiplyScalar(vr > 0.1 ? 1 / vr : 0).applyQuaternion(qi);
    stepAttitude(v, dt, qdyn, uBody, T.mach, th.gimbalAuth, th.rollAuth, th.tx, th.tz);
    // ---- krachten ----
    const aero = aeroForce(v, qdyn, T.mach, vrel, _v3);
    const thrustAcc = v.nose(_v4).multiplyScalar(th.F / m);
    const extra = _v5.copy(aero).multiplyScalar(1 / m).add(thrustAcc);
    v.accel.copy(extra);
    T.gLoad = extra.length() / G0;
    if (T.gLoad > v.maxGSeen) v.maxGSeen = T.gLoad;
    this.integrate(v, extra, dt);
    v.active.prop = Math.max(0, v.active.prop - th.mdot * dt);
    if (v.active.prop <= 0 && th.F > 0) this.emit(`${v.active.spec.name}: brandstof op`, 'warn', v);
    // ---- verhitting ----
    this.heating(v, vr, dt, uBody);
    // ---- belastingen ----
    this.loads(v, qdyn, dt);
    if ((v.state as string) === 'destroyed') { this.emit('', 'explode', v); return undefined; }
    // sonische knal
    const prevM = (v as any)._prevMach || 0;
    if (prevM > 1 && T.mach <= 1 && T.alt < 20000 && v.tel.vVert < 0) this.emit('Sonische knal', 'boom', v);
    (v as any)._prevMach = T.mach;
    return reg || null;
  }

  integrate(v: Vehicle, extra: THREE.Vector3, dt: number) {
    // RK4 voor zwaartekracht met constante extra versnelling
    const e = this.ephem, t = this.t;
    const p0 = v.pos.clone(), v0 = v.vel.clone();
    const a1 = e.gravity(p0, t, new THREE.Vector3()).add(extra);
    const p2 = p0.clone().addScaledVector(v0, dt / 2), v2 = v0.clone().addScaledVector(a1, dt / 2);
    const a2 = e.gravity(p2, t + dt / 2, new THREE.Vector3()).add(extra);
    const p3 = p0.clone().addScaledVector(v2, dt / 2), v3 = v0.clone().addScaledVector(a2, dt / 2);
    const a3 = e.gravity(p3, t + dt / 2, new THREE.Vector3()).add(extra);
    const p4 = p0.clone().addScaledVector(v3, dt), v4 = v0.clone().addScaledVector(a3, dt);
    const a4 = e.gravity(p4, t + dt, new THREE.Vector3()).add(extra);
    v.pos.addScaledVector(v0, dt / 6).addScaledVector(v2, dt / 3).addScaledVector(v3, dt / 3).addScaledVector(v4, dt / 6);
    v.vel.addScaledVector(a1, dt / 6).addScaledVector(a2, dt / 3).addScaledVector(a3, dt / 3).addScaledVector(a4, dt / 6);
  }

  heating(v: Vehicle, vr: number, dt: number, uBody: THREE.Vector3) {
    const T = v.tel;
    const st = v.active;
    if (T.rho <= 0) { st.shieldT += (200 - st.shieldT) * dt * 0.01; T.heatFlux = 0; return; }
    const Rn = v.stages.length === 1 && st.spec.kind === 'ship' ? 4.5 : 2.0;
    const flux = 1.7415e-4 * Math.sqrt(T.rho / Rn) * vr * vr * vr; // W/m2
    T.heatFlux = flux;
    if (flux > v.maxHeat) v.maxHeat = flux;
    // beschermd? hitteschild aan +Z
    const shielded = st.spec.heatShield > 0 && uBody.z > 0.45;
    const protect = shielded ? clamp(st.tileHealth, 0, 1) : (st.spec.kind === 'booster' && uBody.y < -0.7 ? 0.85 : 0);
    const eff = flux * (1 - protect * 0.97);
    const Teq = Math.pow(eff / (0.85 * 5.67e-8) + 290 ** 4, 0.25);
    st.shieldT += (Teq - st.shieldT) * clamp(dt / 6, 0, 1);
    // tegelverlies
    if (shielded && flux > 150000 && this.rng() < v.rel.tiles * (flux / 1e6) * dt * 8) {
      const loss = 0.03 + this.rng() * 0.08;
      st.tileHealth = Math.max(0, st.tileHealth - loss);
      this.emit(`Hitteschildtegels verloren (${Math.round(st.tileHealth * 100)}% intact)`, 'warn', v);
    }
    // flapschade
    if (st.spec.flaps && st.flapHealth > 0 && v.flapsOn && T.q > 2000 && this.rng() < v.rel.flaps * dt) {
      st.flapHealth = Math.max(0, st.flapHealth - 0.5);
      this.emit('Flap-actuator storing!', 'fail', v);
    }
    if (st.shieldT > 1500) {
      st.burn += (st.shieldT - 1500) / 300 * dt * 0.05;
      if (st.burn > 0.4 && st.flapHealth > 0 && this.rng() < dt * 0.3) { st.flapHealth = Math.max(0, st.flapHealth - 0.35); this.emit('Doorbranding bij de flaps!', 'fail', v); }
      if (st.burn > 1) v.destroy('Doorbranding van de romp tijdens terugkeer');
    }
  }

  loads(v: Vehicle, q: number, dt: number) {
    const T = v.tel;
    const st = v.active;
    const strength = v.rel.structure;
    if (v.stages.length > 1) {
      const qa = q * Math.sin(Math.min(T.alpha, 180 - T.alpha) * Math.PI / 180);
      if (qa > 9000 * strength && T.alpha < 120) v.destroy(`Constructief bezweken: q·α te hoog (${(qa / 1000).toFixed(1)} kPa)`);
    } else if (st.spec.kind === 'booster') {
      if (q > 250000 * strength) v.destroy('Booster bezweken onder aerodynamische belasting');
    }
    if (q > st.spec.maxQ * 1.6 * strength) v.destroy('Te hoge dynamische druk');
    if (T.gLoad > st.spec.maxG * strength * (v.stages.length > 1 ? 1 : 1.3)) v.destroy(`Te hoge g-belasting (${T.gLoad.toFixed(1)} g)`);
    // tolerantie: hoge q zonder hitteschild-orientatie bij schip
    if (q > 20000 && Math.random() < (1 - strength) * dt * 0.2) v.destroy('Tankwand gescheurd bij max-Q');
    // avionica
    if (this.rng() < v.rel.avionics * dt) { v.avionicsGlitch = 1.5 + this.rng() * 3; this.emit('Avionica-storing: vluchtcomputer herstart', 'warn', v); }
    // tuimelen bij hoge q -> breuk
    if (q > 8000 && v.w.length() > 0.6) v.destroy('Voertuig tuimelde en brak op');
  }

  ground(v: Vehicle, reg: RegionFrame | null, dt: number) {
    const T = v.tel;
    const body = T.body;
    if (!reg) {
      if (T.alt < 0) {
        if (body === 'earth') {
          if (T.vVert > -14 && v.stages.length === 1) { v.state = 'splashed'; v.splashTimer = 8; v.vel.copy(this.surfaceVel('earth', v.pos)); (v as any).openSea = true; this.emit(`${v.name}: zachte landing in de oceaan (${Math.abs(T.vVert).toFixed(1)} m/s)`, 'splash', v, { vv: T.vVert, tilt: T.tilt, ocean: true }); }
          else { v.destroy('Inslag in zee'); this.emit('', 'explode', v); }
        }
        else { v.destroy('Inslag op het maanoppervlak'); this.emit('', 'explode', v); }
      }
      return;
    }
    const l = this.toLocal(reg.def.id, v.pos, _v1);
    // torenbotsing / vangst
    for (const tw of this.towers) {
      if (tw.region !== reg.def.id) continue;
      const p = tw.pad;
      const dxT = Math.hypot(l.x - p.tower!.x, l.z - p.tower!.z);
      const nose = this.toLocalDir(reg, v.nose(_v2));
      const topY = l.y + nose.y * v.length;
      const dxPad = Math.hypot(l.x - p.x, l.z - p.z);
      if (dxT < 9 + v.diameter / 2 && l.y < p.tower!.h && topY > 0) {
        v.destroy('Botsing met de lanceertoren'); tw.damaged = true; this.emit('', 'explode', v); return;
      }
      // vangen
      const st = v.active;
      if (st.spec.catchPins && v.stages.length === 1 && !tw.caught && dxPad < 12) {
        const pinY = l.y + v.length * 0.86;
        const armY = tw.armH;
        if (Math.abs(pinY - armY) < 1.5 && l.y > p.top + 2) {
          const tilt = T.tilt, vv = T.vVert, hv = T.vHoriz;
          if (dxPad < 4.5 && vv > -5 && hv < 2.5 && tilt < 7) {
            if (this.rng() < v.rel.catchSys) {
              this.emit('Vangarmen sluiten te laat — misgegrepen!', 'fail', v);
              tw.armOpen = 0.6;
            } else {
              tw.caught = v; v.state = 'caught'; v.cmdThrottle = 0;
              for (const e of st.engines) { e.on = false; e.throttle = 0; }
              // rechtzetten in arm
              this.anchorHere(v, reg.def.id);
              const a = this.anchors.get(v)!;
              a.local.x = p.x + (l.x - p.x) * 0.3; a.local.z = p.z + (l.z - p.z) * 0.3;
              a.lq.identity();
              this.emit(`${v.name} GEVANGEN door de toren!`, 'catch', v, { dx: dxPad, vv, tilt });
              return;
            }
          } else if (dxPad < 8 && vv < -8) {
            v.destroy('Te snel tegen de vangarmen'); tw.damaged = true; this.emit('', 'explode', v); return;
          }
        }
      }
    }
    const g = this.groundAt(reg, l.x, l.z, v);
    const groundY = this.surfaceY(reg, l, g.h);
    if (l.y > groundY + 0.05) return;
    if (T.vVert > -0.3 && l.y > groundY - 2) { if (l.y < groundY) { const a = this.toWorld(reg.def.id, _v2.set(l.x, groundY, l.z)); v.pos.copy(a); } return; }
    // contact
    const vv = T.vVert, hv = T.vHoriz, tilt = T.tilt;
    const st = v.active;
    if (g.water) {
      if (vv > -14 && v.stages.length === 1) {
        v.state = 'splashed'; v.splashTimer = 6 + this.rng() * 4;
        this.anchorHere(v, reg.def.id);
        this.emit(`${v.name}: zachte landing in zee (${Math.abs(vv).toFixed(1)} m/s)`, 'splash', v, { vv, hv, tilt });
      } else { v.destroy(`Inslag op het water (${Math.abs(vv).toFixed(0)} m/s)`); this.emit('', 'explode', v); }
      return;
    }
    if (g.pad && g.pad.kind === 'olm') { v.destroy('Neergestort op het lanceerplatform'); this.emit('', 'explode', v); return; }
    const legsOk = st.spec.legs && v.legsDown && st.legHealth > 0.5;
    const lim = legsOk ? { vv: 4.5, hv: 2.5, tilt: 10 } : { vv: 1.5, hv: 1, tilt: 4 };
    if (-vv < lim.vv && hv < lim.hv && tilt < lim.tilt) {
      if (legsOk && this.rng() < v.rel.legs) {
        this.emit('Landingspoot bezwijkt!', 'fail', v);
        v.destroy('Omgevallen na falen van landingspoot'); this.emit('', 'explode', v); return;
      }
      v.state = 'landed'; v.cmdThrottle = 0;
      for (const e of st.engines) { e.on = false; e.throttle = 0; }
      // rechtzetten op de grond
      this.anchorHere(v, reg.def.id);
      const a = this.anchors.get(v)!;
      a.local.y = groundY;
      this.emit(`${v.name} GELAND${g.pad ? ' op ' + g.pad.label : ''}! (${Math.abs(vv).toFixed(1)} m/s)`, 'landed', v, { vv, hv, tilt, pad: g.pad ? g.pad.id : null, dx: g.pad ? Math.hypot(l.x - g.pad.x, l.z - g.pad.z) : 999 });
    } else {
      v.destroy(`Harde landing (${Math.abs(vv).toFixed(1)} m/s verticaal, ${hv.toFixed(1)} m/s zijwaarts, ${tilt.toFixed(0)}° scheef)`);
      this.emit('', 'explode', v);
    }
  }
  // hoogte van terrein in lokaal frame incl. kromming
  surfaceY(reg: RegionFrame, l: THREE.Vector3, h: number) {
    const R = reg.def.body === 'earth' ? R_E : R_M;
    const d2 = l.x * l.x + l.z * l.z;
    return h - d2 / (2 * R);
  }
  toLocalDir(reg: RegionFrame, d: THREE.Vector3) { return d.applyQuaternion(reg.inv); }

  // splash-timers & opruimen
  postStep(dt: number) {
    for (const v of this.vehicles) {
      if (v.state === 'splashed') {
        v.splashTimer -= dt;
        if ((v as any).openSea) { v.vel.copy(this.surfaceVel('earth', v.pos)); }
        if (v.splashTimer < 0) { v.destroy('Kantelde in zee en explodeerde'); this.emit('', 'explode', v); this.emit(`${v.name} kantelt en explodeert in zee`, 'info', v); }
      }
    }
  }
}
