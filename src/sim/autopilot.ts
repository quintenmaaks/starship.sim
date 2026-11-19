import * as THREE from 'three';
import { Vehicle } from './vehicle';
import { World } from './world';
import { MU_E, MU_M, R_E, R_M, G0, P0, ATMO_TOP, OMEGA_E } from './constants';
import { REGIONS, PadDef } from './terrain';
import { atmosphere } from './atmosphere';
import { elements } from './orbit';
import { clamp } from '../core/util';

const _m = new THREE.Matrix4();
export function pointQuat(nose: THREE.Vector3, bellyHint: THREE.Vector3, out = new THREE.Quaternion()) {
  const y = nose.clone().normalize();
  let z = bellyHint.clone().sub(y.clone().multiplyScalar(bellyHint.dot(y)));
  if (z.lengthSq() < 1e-8) { z = new THREE.Vector3(1, 0, 0).cross(y); if (z.lengthSq() < 1e-8) z = new THREE.Vector3(0, 0, 1).cross(y); }
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  _m.makeBasis(x, y, z);
  return out.setFromRotationMatrix(_m);
}
export function point(v: Vehicle, nose: THREE.Vector3, belly: THREE.Vector3) {
  pointQuat(nose, belly, v.targetQuat);
  v.sas = 'target';
}
export function angleTo(v: Vehicle, dir: THREE.Vector3) {
  return Math.acos(clamp(v.nose().dot(dir.clone().normalize()), -1, 1)) * 180 / Math.PI;
}
export interface LocalState { region: string; p: THREE.Vector3; vel: THREE.Vector3; up: THREE.Vector3; quat: THREE.Quaternion; inv: THREE.Quaternion; g: number; }
export function localState(w: World, v: Vehicle, region: string): LocalState {
  const f = w.frames[region];
  const p = w.toLocal(region, v.pos);
  const sv = w.surfaceVel(f.def.body, v.pos, new THREE.Vector3());
  const vel = v.vel.clone().sub(sv).applyQuaternion(f.inv);
  const R = f.def.body === 'earth' ? R_E : R_M;
  const mu = f.def.body === 'earth' ? MU_E : MU_M;
  // lokale "omhoog" voor dit punt (kromming)
  const upW = v.pos.clone().sub(f.center).normalize();
  const up = upW.applyQuaternion(f.inv);
  const r = v.pos.distanceTo(f.center);
  return { region, p, vel, up, quat: f.quat, inv: f.inv, g: mu / (r * r) };
}

// ---- Inslagvoorspeller (puntmassa + weerstand) ----
export function predictImpact(w: World, v: Vehicle, cda: number, regionId: string, maxT = 3000) {
  const body = REGIONS[regionId].body;
  const p = v.pos.clone(), vel = v.vel.clone();
  const center = body === 'earth' ? new THREE.Vector3() : w.ephem.moonPos(w.t);
  const mvel = body === 'earth' ? new THREE.Vector3() : w.ephem.moonVel(w.t);
  p.sub(center); vel.sub(mvel);
  const mu = body === 'earth' ? MU_E : MU_M, R = body === 'earth' ? R_E : R_M;
  const m = v.mass;
  const om = new THREE.Vector3(0, body === 'earth' ? OMEGA_E : 0, 0);
  let t = 0;
  const a = new THREE.Vector3(), vr = new THREE.Vector3();
  const reg = REGIONS[regionId];
  const fr = w.frames[regionId];
  const gh = reg.pads[0].top;
  while (t < maxT) {
    const r = p.length();
    const alt = r - R;
    const dt = alt > 100000 ? 4 : alt > 20000 ? 1 : 0.5;
    a.copy(p).multiplyScalar(-mu / (r * r * r));
    if (body === 'earth' && alt < 120000) {
      const atm = atmosphere(alt);
      vr.crossVectors(om, p); vr.subVectors(vel, vr);
      const s = vr.length();
      a.addScaledVector(vr, -0.5 * atm.rho * s * cda / m);
    }
    vel.addScaledVector(a, dt); p.addScaledVector(vel, dt); t += dt;
    if (p.length() - R < gh) break;
  }
  // in regio-frame op inslagtijd: aarde draait door
  const ang = body === 'earth' ? OMEGA_E * t : 0;
  const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -ang);
  const pw = p.clone().applyQuaternion(rot).add(center);
  const local = w.toLocal(regionId, pw);
  return { local, t, vImpact: vel.length() };
}

export interface LandTarget { region: string; pad: PadDef | null; x: number; z: number; y: number; catchTower?: boolean; water?: boolean; }

// ---- Landingsgeleiding (gemeenschappelijk) ----
export class LandingGuidance {
  engineSet: 'inner' | 'center' | 'single' | 'three' | 'all' = 'inner';
  ignited = false;
  constructor(public v: Vehicle, public tgt: LandTarget, public maxTilt = 18) {}
  availThrust(set: string) {
    const st = this.v.active;
    let F = 0, Fmin = 0, n = 0;
    const pAmb = this.v.tel.pAmb;
    for (const e of st.engines) {
      if (e.failed) continue;
      if (e.spec.kind === 'vac' && pAmb > 5000) continue;
      const sel = set === 'all' ? true : set === 'inner' ? e.spec.ring <= 1 : set === 'three' ? e.spec.ring === 0 : set === 'center' ? e.spec.ring === 0 : e.spec.ring === 0;
      if (!sel) continue;
      if (set === 'single' && n >= 1) continue;
      const Ae = e.spec.thrustVac * (1 - e.spec.ispSL / e.spec.ispVac) / P0;
      const f = Math.max(0, e.spec.thrustVac - pAmb * Ae);
      F += f; Fmin += f * e.spec.minThrottle; n++;
    }
    return { F, Fmin, n };
  }
  applySet(set: string) {
    const st = this.v.active;
    let n = 0;
    for (const e of st.engines) {
      let sel = false;
      if (e.failed) { e.selected = false; continue; }
      if (e.spec.kind === 'vac' && this.v.tel.pAmb > 5000) { e.selected = false; continue; }
      if (set === 'all') sel = true;
      else if (set === 'inner') sel = e.spec.ring <= 1;
      else if (set === 'three' || set === 'center') sel = e.spec.ring === 0;
      else if (set === 'single') sel = e.spec.ring === 0 && n < 1;
      if (sel) n++;
      e.selected = sel;
    }
    // vervanging bij uitval: pak andere motoren
    if (n === 0) for (const e of st.engines) if (!e.failed && e.spec.kind === 'sl') { e.selected = true; n++; if (n >= (set === 'single' ? 1 : 3)) break; }
  }
  stopDist(ls: LocalState) {
    const set = this.v.active.spec.kind === 'booster' ? 'inner' : 'three';
    const a = this.availThrust(set).F / this.v.mass;
    const vy = Math.min(0, ls.vel.y);
    const net = Math.max(0.5, Math.min(a * 0.72, 4.6 * G0) - ls.g);
    const vtot = Math.hypot(vy, Math.min(Math.hypot(ls.vel.x, ls.vel.z), 60));
    return vtot * vtot / (2 * net) + Math.abs(vy) * 2.2 + 25;
  }
  // 1D-voorspelling met weerstand: stopt het voertuig boven het doel als we nu ontsteken?
  shouldIgnite(ls: LocalState, cda: number, margin = 60) {
    const set = this.v.active.spec.kind === 'booster' ? 'inner' : 'three';
    const m = this.v.mass;
    const aT = Math.min(this.availThrust(set).F / m * 0.8, 4.6 * G0);
    let h = ls.p.y - this.tgt.y, vd = -ls.vel.y; // omlaag positief
    const vh = Math.hypot(ls.vel.x, ls.vel.z);
    const earth = REGIONS[this.tgt.region].body === 'earth';
    const dt = 0.1;
    let t = 0;
    // ontsteking + flip-vertraging
    const delay = this.v.active.spec.kind === 'ship' ? 4.5 : 1.5;
    while (vd > 0 && h > -50 && t < 120) {
      const rho = earth ? atmosphere(Math.max(0, h + this.tgt.y)).rho : 0;
      const drag = 0.5 * rho * vd * vd * cda / m;
      const thr = t > delay ? aT * Math.min(1, vd / Math.max(vd, 1)) : 0;
      vd += (ls.g - drag - thr) * dt;
      h -= vd * dt; t += dt;
    }
    return h < margin + vh * 1.2;
  }
  update(dt: number, w: World) {
    const v = this.v;
    const ls = localState(w, v, this.tgt.region);
    const h = ls.p.y - this.tgt.y;
    const m = v.mass;
    // motorselectie
    let av = this.availThrust(this.engineSet);
    const ex = this.tgt.x - ls.p.x, ez = this.tgt.z - ls.p.z;
    const dist = Math.hypot(ex, ez);
    const aMax0 = av.F / m;
    let vt = 0;
    let ayReq: number;
    const vy = ls.vel.y;
    const hEff = h - (this.tgt.catchTower ? 7 : 4);
    if (hEff > 3 && vy < -1.5) {
      const aReq = vy * vy / (2 * hEff);
      ayReq = ls.g + aReq * 1.08;
      vt = vy;
    } else {
      vt = this.tgt.catchTower ? -0.8 : -1.2;
      // eerst uitlijnen, dan zakken (vangst: zweven tot binnen 2 m)
      if ((dist > (this.tgt.catchTower ? 1.8 : 6) || Math.hypot(ls.vel.x, ls.vel.z) > 1.0) && h > 2) vt = this.tgt.catchTower ? 0 : -0.4;
      ayReq = ls.g + (vt - vy) * 2.0;
    }
    // laterale geleiding (zero-effort-miss)
    const tgo = Math.max(1.5, 2 * Math.max(hEff, 0) / Math.max(Math.abs(ls.vel.y), 2));
    let ax: number, az: number;
    if (hEff > 3) {
      // optimale geleiding met eindsnelheid 0 (ZEM/ZEV)
      const tg = Math.max(tgo, 2.5);
      ax = 6 * ex / (tg * tg) - 4 * ls.vel.x / tg;
      az = 6 * ez / (tg * tg) - 4 * ls.vel.z / tg;
    } else {
      ax = clamp(ex, -6, 6) * 0.5 - ls.vel.x * 1.5;
      az = clamp(ez, -6, 6) * 0.5 - ls.vel.z * 1.5;
    }
    const vhx = clamp(ex / tgo, -40, 40), vhz = clamp(ez / tgo, -40, 40);
    const ay = ayReq;
    const tiltMax = (h < 2 ? 4 : h < 60 ? 10 : this.maxTilt) * Math.PI / 180;
    const latMax = Math.max(ay, 0.6 * ls.g) * Math.tan(tiltMax);
    // aerodynamische stuurhulp (roosterroeren/flaps) in dichte lucht
    if (v.tel.q > 1500 && h > 30) {
      const fin = (v.active.spec.gridFins && v.finsOut ? v.active.finHealth : 0) + (v.active.spec.flaps ? v.active.flapHealth * 0.6 : 0);
      if (fin > 0) {
        let cx = (vhx - ls.vel.x) * 0.5, cz = (vhz - ls.vel.z) * 0.5; const cm = Math.hypot(cx, cz); const L = Math.min(3, v.tel.q / 8000) * fin;
        if (cm > L) { cx *= L / cm; cz *= L / cm; }
        v.vel.addScaledVector(new THREE.Vector3(cx, 0, cz).applyQuaternion(ls.quat), dt);
      }
    }
    const al = Math.hypot(ax, az);
    if (al > latMax) { ax *= latMax / al; az *= latMax / al; }
    const need = Math.min(Math.hypot(ax, Math.max(ay, 0.3), az), 5.5 * G0) * m;
    // motoren schakelen
    const order: any[] = v.active.spec.kind === 'booster' ? ['inner', 'center', 'single'] : ['three', 'single'];
    let idx = Math.max(0, order.indexOf(this.engineSet));
    (this as any).lowT = need < av.Fmin * 0.92 ? ((this as any).lowT || 0) + dt : 0;
    if ((this as any).lowT > 0.6 && idx < order.length - 1 && h < 500) { idx++; (this as any).lowT = 0; }
    else if (need > av.F * 1.0 && idx > 0) idx--;
    if (order[idx] !== this.engineSet) { this.engineSet = order[idx]; av = this.availThrust(this.engineSet); }
    this.applySet(this.engineSet);
    const dirL = new THREE.Vector3(ax, Math.max(ay, 0.3), az).normalize();
    const dirW = dirL.applyQuaternion(ls.quat);
    const align = Math.max(0, v.nose().dot(dirW));
    const thr = av.F > 0 ? need / av.F : 0;
    // tijdens de flip niet zijwaarts duwen
    v.cmdThrottle = clamp(thr * (align > 0.94 ? 1 : Math.pow(align, 6)), 0.0, 1);
    if (v.cmdThrottle < 0.01) v.cmdThrottle = 0.01;
    const belly = v.belly();
    point(v, dirW, belly);
    if (h < 400 && v.active.spec.legs) v.legsDown = true;
    if ((globalThis as any).CATCHDBG && h < 12) console.log("LG", ls.p.x.toFixed(2), w.toLocal(this.tgt.region, v.pos).x.toFixed(2), v.id, ex.toFixed(2), ez.toFixed(2), h.toFixed(1), ax.toFixed(2), az.toFixed(2), "vel", ls.vel.x.toFixed(2), "nose", v.nose().applyQuaternion(ls.inv).x.toFixed(3), "acc", v.accel.clone().applyQuaternion(ls.inv).x.toFixed(2), v.cmdThrottle.toFixed(2), v.enginesRunning());
    return { h, dist, vt };
  }
}

// ---- Basisklasse ----
export abstract class Program {
  phase = '';
  done = false;
  failed = false;
  status = '';
  v: Vehicle;
  constructor(v: Vehicle) { this.v = v; }
  abstract update(dt: number, w: World): void;
  busy() { return !this.done; }
}

function upAt(w: World, v: Vehicle) {
  const c = w.dominant(v.pos) === 'earth' ? new THREE.Vector3() : w.ephem.moonPos(w.t);
  return v.pos.clone().sub(c).normalize();
}

// ===== OPSTIJGING =====
export interface AscentPlan { apo: number; peri: number; azimuth: number; boosterReserve: number; onStage?: (ship: Vehicle, booster: Vehicle) => void; maxQThrottle?: number; }
export class AscentProgram extends Program {
  plan: AscentPlan;
  t = 0;
  stageT = -1;
  constructor(v: Vehicle, plan: AscentPlan) { super(v); this.plan = plan; this.phase = 'Lancering'; }
  update(dt: number, w: World) {
    const v = this.v;
    if (v.state === 'destroyed') { this.done = true; return; }
    this.t += dt;
    if (v.state === 'clamped') {
      v.cmdThrottle = w.t >= w.launchT - 3 ? 1 : 0; (v as any).releaseArmed = true;
      v.selectEngines(v.stages.length > 1 ? 'all' : 'sl');
      this.phase = 'Ontsteking'; return;
    }
    const T = v.tel;
    const up = upAt(w, v);
    // gewenst azimut in lokaal horizontaal vlak
    const east = new THREE.Vector3(0, 1, 0).cross(up).normalize();
    const north = up.clone().cross(east);
    const az = this.plan.azimuth * Math.PI / 180;
    const horiz = north.clone().multiplyScalar(Math.cos(az)).add(east.clone().multiplyScalar(Math.sin(az)));
    if (v.stages.length > 1) {
      // ---- eerste trap: gravity turn ----
      v.selectEngines('all');
      const vs = v.vRel.clone();
      let dir: THREE.Vector3;
      if (T.vSurf < 60 || T.alt < 800) dir = up.clone();
      else {
        const pro = vs.clone().normalize();
        // doelvluchtpad
        const gammaT = (90 - 72 * Math.pow(clamp(T.alt / 75000, 0, 1), 0.55)) * Math.PI / 180;
        const tgt = up.clone().multiplyScalar(Math.sin(gammaT)).add(horiz.clone().multiplyScalar(Math.cos(gammaT)));
        const maxA = (T.q > 5000 ? 2.5 : 8) * Math.PI / 180;
        const ang = pro.angleTo(tgt);
        dir = ang < maxA ? tgt : pro.clone().lerp(tgt, maxA / ang).normalize();
        if (T.vSurf < 120) dir = up.clone().lerp(horiz, 0.05 * (T.vSurf - 60) / 60).normalize();
      }
      point(v, dir, horiz.clone().negate().addScaledVector(up, -0.5));
      const mq = this.plan.maxQThrottle ?? 0.72;
      v.cmdThrottle = T.q > 30000 ? mq : 1;
      if (T.gLoad > 3.6) v.cmdThrottle = Math.max(0.45, v.cmdThrottle - 0.2);
      this.phase = T.q > 20000 ? 'Max-Q' : T.alt < 2000 ? 'Opstijgen' : 'Eerste trap';
      if (v.propFrac <= this.plan.boosterReserve || (this.stageT < 0 && v.active.prop <= 0)) {
        if (this.stageT < 0) { this.stageT = this.t; v.selectEngines('inner'); v.cmdThrottle = 0.45; w.emit('MECO — hoofdmotoren grotendeels uit', 'meco', v); this.phase = 'MECO'; }
      }
      if (this.stageT >= 0 && this.t - this.stageT > 1.2) {
        const b = w.stage(v);
        if (b) {
          v.selectEngines('all'); v.cmdThrottle = 1;
          this.phase = 'Tweede trap';
          if (this.plan.onStage) this.plan.onStage(v, b);
        } else if (v.sepFailed) { this.failed = true; this.done = true; v.cmdThrottle = 0; }
      }
      return;
    }
    // ---- tweede trap: gesloten-lus naar doelbaan ----
    v.selectEngines('all');
    const r = v.pos.length();
    const vr = v.vel.dot(up);
    const vh = v.vel.clone().sub(up.clone().multiplyScalar(vr));
    const hdir = vh.lengthSq() > 1 ? vh.clone().normalize() : horiz;
    const el = elements(v.pos, v.vel, MU_E, R_E);
    const ht = this.plan.apo;
    const vrStar = clamp((ht - T.alt) / 90, -60, 450);
    const g = MU_E / (r * r) - vh.lengthSq() / r;
    const th = v.thrustInfo(T.pAmb);
    const aT = Math.max(th.F, 1) / v.mass;
    const arNeed = (vrStar - vr) / 10 + g;
    const s = clamp(arNeed / aT, -0.4, 0.85);
    const dir = hdir.clone().multiplyScalar(Math.sqrt(1 - s * s)).add(up.clone().multiplyScalar(s));
    point(v, dir, up.clone().multiplyScalar(-1));
    v.cmdThrottle = T.gLoad > 3.8 ? Math.max(0.5, v.cmdThrottle - 0.05) : 1;
    this.phase = 'Tweede trap → baan';
    this.status = `Apo ${(el.apo / 1000).toFixed(0)} km · Peri ${(el.peri / 1000).toFixed(0)} km`;
    if (el.peri >= this.plan.peri && el.apo >= this.plan.apo * 0.9) {
      v.cmdThrottle = 0; this.done = true; this.phase = 'SECO';
      w.emit(`SECO — baan bereikt (${(el.apo / 1000).toFixed(0)} × ${(el.peri / 1000).toFixed(0)} km)`, 'seco', v);
    } else if (v.active.prop <= 0) { this.done = true; this.failed = true; w.emit('Brandstof op vóór de doelbaan', 'fail', v); }
  }
}

// ===== BOOSTER TERUGKEER =====
export class BoostbackProgram extends Program {
  t = 0; tgt: LandTarget; lg: LandingGuidance; bbDone = false;
  constructor(v: Vehicle, tgt: LandTarget) { super(v); this.tgt = tgt; this.lg = new LandingGuidance(v, tgt, 16); this.phase = 'Flip'; }
  cda() { return (1.25 + (this.v.finsOut ? 0.6 : 0)) * Math.PI * 20.25; }
  estF() { let F = 0; for (const e of this.v.active.engines) if (!e.failed && e.selected) F += e.spec.thrustVac; return F; }
  update(dt: number, w: World) {
    const v = this.v;
    if (v.state !== 'flying') { this.done = true; return; }
    this.t += dt;
    const up = upAt(w, v);
    const T = v.tel;
    if (this.tgt.catchTower) {
      const tw = w.towers.find((x) => x.region === this.tgt.region && x.pad.id === this.tgt.pad?.id);
      if (tw) tw.armTargetH = this.tgt.y + v.length * 0.86;
    }
    if (!this.bbDone) {
      if (this.t < 1.5) { v.cmdThrottle = 0; return; }
      const pr = predictImpact(w, v, this.cda(), this.tgt.region);
      const ex = this.tgt.x - pr.local.x, ez = this.tgt.z - pr.local.z;
      const errL = new THREE.Vector3(ex, 0, ez);
      const err = errL.length();
      const dirW = errL.clone().normalize().applyQuaternion(w.frames[this.tgt.region].quat);
      dirW.addScaledVector(up, 0.08).normalize();
      point(v, dirW, up);
      this.phase = 'Boostback';
      this.status = `Inslagfout ${(err / 1000).toFixed(1)} km`;
      const ang = angleTo(v, dirW);
      v.selectEngines('inner');
      const Fb = v.thrustInfo(0).F || this.estF();
      const gl = Math.min(1, 4.0 * G0 * v.mass / Math.max(1, this.estF()));
      v.cmdThrottle = ang < 20 && v.active.prop > 0 ? clamp(Math.min(err / 20000, gl), 0.4, 1) : 0;
      if (err < 300 || ((this as any).lastErr !== undefined && err > (this as any).lastErr + 50 && err < 5000) || v.propFrac < 0.022) {
        v.cmdThrottle = 0; this.bbDone = true; w.emit('Boostback voltooid', 'info', v);
      }
      (this as any).lastErr = err;
      return;
    }
    const ls = localState(w, v, this.tgt.region);
    const h = ls.p.y - this.tgt.y;
    if (!this.lg.ignited && (T.vVert > 0 || !this.lg.shouldIgnite(ls, this.cda(), 80))) {
      // uitrollen: motoren vooruit, stuur met roosterroeren
      v.finsOut = true;
      v.cmdThrottle = 0;
      const vs = v.vRel.clone().normalize();
      let nose = vs.clone().multiplyScalar(-1);
      if (T.alt > 70000) nose = up.clone();
      else {
        const pr = predictImpact(w, v, this.cda(), this.tgt.region, 600);
        const e = new THREE.Vector3(this.tgt.x - pr.local.x, 0, this.tgt.z - pr.local.z).applyQuaternion(w.frames[this.tgt.region].quat);
        const tilt = clamp(e.length() / 1500, 0, 1) * 0.2;
        // roosterroeren: aerodynamisch glijden richting doel
        if (T.q > 2000) { const L = Math.min(4, T.q / 10000) * v.active.finHealth; v.vel.addScaledVector(e.clone().normalize(), Math.min(L, e.length() / 200) * dt); }
        if (e.lengthSq() > 1) nose.addScaledVector(e.normalize(), -tilt).normalize();
        this.status = `Afwijking ${(Math.hypot(this.tgt.x - pr.local.x, this.tgt.z - pr.local.z)).toFixed(0)} m`;
      }
      point(v, nose, v.belly());
      this.phase = T.alt > 70000 ? 'Ballistisch' : 'Terugkeer (roosterroeren)';
      return;
    }
    if (!this.lg.ignited) { this.lg.ignited = true; w.emit('Landingsbrand gestart', 'info', v); }
    this.phase = this.tgt.catchTower ? 'Landingsbrand → vangst' : 'Landingsbrand';
    const r = this.lg.update(dt, w);
    this.status = `Afstand ${r.dist.toFixed(1)} m · h ${r.h.toFixed(0)} m`;
  }
}

// ===== SCHIP TERUGKEER (buiklanding + flip) =====
export let RANGE_BIAS = 214000;
export function setRangeBias(b: number) { RANGE_BIAS = b; }
export class ShipReturnProgram extends Program {
  tgt: LandTarget | null; lg: LandingGuidance | null = null; flipped = false;
  alpha = 70; rangeErr = 0; bank = 0;
  constructor(v: Vehicle, tgt: LandTarget | null) { super(v); this.tgt = tgt; if (tgt) this.lg = new LandingGuidance(v, tgt, 20); this.phase = 'Kust'; }
  update(dt: number, w: World) {
    const v = this.v;
    if (v.state !== 'flying') { this.done = true; return; }
    const T = v.tel;
    const up = upAt(w, v);
    const vs = v.vRel.clone();
    const vsn = vs.lengthSq() > 1 ? vs.clone().normalize() : up.clone().multiplyScalar(-1);
    v.cmdThrottle = this.lg && this.lg.ignited ? v.cmdThrottle : 0;
    if (this.tgt && this.lg) {
      const ls = localState(w, v, this.tgt.region);
      const h = ls.p.y - this.tgt.y;
      const dist = Math.hypot(ls.p.x - this.tgt.x, ls.p.z - this.tgt.z);
      if (this.tgt.catchTower) {
        const tw = w.towers.find((x) => x.region === this.tgt!.region && x.pad.id === this.tgt!.pad?.id);
        if (tw) tw.armTargetH = this.tgt.y + v.length * 0.86;
      }
      if (!this.lg.ignited && T.alt < 20000 && dist < 30000 && this.lg.shouldIgnite(ls, 1.4 * v.length * 9, 150)) {
        this.lg.ignited = true; w.emit('Flip-manoeuvre! Motoren herstarten', 'flip', v);
      }
      if (this.lg.ignited) {
        this.phase = this.tgt.catchTower ? 'Flip → vangst' : 'Flip → landing';
        const r = this.lg.update(dt, w);
        this.status = `Afstand ${r.dist.toFixed(1)} m · h ${r.h.toFixed(0)} m`;
        return;
      }
    }
    // geen doel: gecontroleerde landing in de oceaan (flip + landingsbrand)
    if (!this.tgt && T.alt < 6000 && T.mach < 0.8) {
      const vd = -T.vVert;
      const m = v.mass;
      let F = 0;
      for (const e of v.active.engines) if (!e.failed && e.spec.kind === 'sl' && e.spec.ring === 0) F += e.spec.thrustVac * 0.97;
      const aT = Math.min(F / m * 0.8, 4 * G0);
      // 1D-voorspelling
      if (!(this as any).oceanBurn) {
        let h = T.alt, vv = vd, t = 0;
        while (vv > 0 && h > -20 && t < 60) { const rho = atmosphere(Math.max(0, h)).rho; const drag = 0.5 * rho * vv * vv * 1.4 * v.length * 9 / m; vv += (9.81 - drag - (t > 4.5 ? aT : 0)) * 0.1; h -= vv * 0.1; t += 0.1; }
        if (h < 120) { (this as any).oceanBurn = true; w.emit('Flip-manoeuvre boven zee! Motoren herstarten', 'flip', v); }
      }
      if ((this as any).oceanBurn) {
        this.phase = 'Landingsbrand (oceaan)';
        v.selectEngines('three'); v.legsDown = true;
        const h = Math.max(T.alt - 3, 0.5);
        const aReq = vd > 0 ? vd * vd / (2 * h) : 0;
        const ay = 9.81 + (vd > 3 ? aReq * 1.05 : (vd - 2) * 2);
        const align = Math.max(0, v.nose().dot(up));
        v.cmdThrottle = clamp(ay * m / Math.max(F, 1) * (align > 0.94 ? 1 : Math.pow(align, 6)), 0.01, 1);
        point(v, up, v.belly());
        return;
      }
    }
    // buikhouding
    let alpha = T.mach > 3 ? 68 : T.mach > 1 ? 75 : 88;
    if (T.alt > ATMO_TOP) alpha = 65;
    let bankOff = new THREE.Vector3();
    if (this.tgt && T.alt < 125000 && T.alt > 8000) {
      // bereikregeling: lagere invalshoek = verder glijden, hogere = korter
      const pr = predictImpact(w, v, (1.15 + (alpha - 70) * 0.012) * v.length * 9, this.tgt.region, 2400);
      const ls = localState(w, v, this.tgt.region);
      const hv = new THREE.Vector3(ls.vel.x, 0, ls.vel.z);
      if (hv.lengthSq() > 1) {
        hv.normalize();
        const along = (this.tgt.x - pr.local.x) * hv.x + (this.tgt.z - pr.local.z) * hv.z - RANGE_BIAS * clamp((T.vSurf - 400) / 2000, 0, 1);
        this.rangeErr = along;
        const k = clamp(along / 150000, -1, 1);
        if (T.mach > 1.5) alpha = clamp(alpha - k * 18, 50, 85);
        // dwarsfout → rolhoek (lift opzij kantelen)
        const cross = -(this.tgt.x - pr.local.x) * hv.z + (this.tgt.z - pr.local.z) * hv.x;
        this.bank = clamp(cross / 60000, -1, 1) * 45 * Math.PI / 180;
      }
    }
    else this.bank = 0;
    if (this.tgt && T.alt < 60000) {
      // stuur naar doel via kleine glijhoek
      const pr = predictImpact(w, v, 1.15 * v.length * 9, this.tgt.region, 1200);
      const e = new THREE.Vector3(this.tgt.x - pr.local.x, 0, this.tgt.z - pr.local.z);
      this.status = `Inslagfout ${(e.length() / 1000).toFixed(2)} km`;
      const eW = e.applyQuaternion(w.frames[this.tgt.region].quat);
      if (eW.lengthSq() > 1) bankOff = eW.normalize().multiplyScalar(clamp(e.length() / 2000, 0, 1) * 0.35);
    }
    const hperp = up.clone().sub(vsn.clone().multiplyScalar(up.dot(vsn)));
    if (hperp.lengthSq() < 1e-6) hperp.set(1, 0, 0);
    hperp.normalize();
    if (this.bank) hperp.applyAxisAngle(vsn, this.bank);
    const a = alpha * Math.PI / 180;
    const nose = vsn.clone().multiplyScalar(Math.cos(a)).add(hperp.clone().multiplyScalar(Math.sin(a))).add(bankOff).normalize();
    const belly = vsn.clone().multiplyScalar(Math.sin(a)).sub(hperp.clone().multiplyScalar(Math.cos(a)));
    point(v, nose, belly);
    v.flapsOn = true;
    // subsonische buikglijvlucht: flaps sturen horizontale snelheid naar het doel (L/D ~0,25)
    if (this.tgt && T.mach < 0.9 && T.alt < 18000 && v.active.flapHealth > 0.4) {
      const ls = localState(w, v, this.tgt.region);
      const hh = ls.p.y - this.tgt.y;
      const ex = this.tgt.x - ls.p.x, ez = this.tgt.z - ls.p.z;
      const tgo = Math.max(5, hh / Math.max(-ls.vel.y, 10));
      let dx = ex / tgo, dz = ez / tgo; const dm = Math.hypot(dx, dz); if (dm > 30) { dx *= 30 / dm; dz *= 30 / dm; }
      let cx = (dx - ls.vel.x) * 0.8, cz = (dz - ls.vel.z) * 0.8; const cm = Math.hypot(cx, cz); const lim = 2.5;
      if (cm > lim) { cx *= lim / cm; cz *= lim / cm; }
      v.vel.addScaledVector(new THREE.Vector3(cx, 0, cz).applyQuaternion(ls.quat), dt);
    }
    this.phase = T.alt > ATMO_TOP ? 'Terugkeerhouding' : T.mach > 1 ? 'Terugkeer (plasma)' : 'Buiklanding (belly flop)';
  }
  busy() { return !this.done && (this.v.tel.alt < ATMO_TOP + 20000); }
}

// ===== HOP =====
export class HopProgram extends Program {
  stage: 'up' | 'translate' | 'fall' | 'land' = 'up';
  tgt: LandTarget; lg: LandingGuidance; apexT = 0; t = 0;
  constructor(v: Vehicle, public alt: number, tgt: LandTarget, public bellyflop: boolean) { super(v); this.tgt = tgt; this.lg = new LandingGuidance(v, tgt, 14); this.phase = 'Ontsteking'; }
  update(dt: number, w: World) {
    const v = this.v;
    this.t += dt;
    if (v.state === 'clamped') { v.selectEngines('sl'); v.cmdThrottle = 1; (v as any).releaseArmed = true; return; }
    if (v.state !== 'flying') { this.done = true; return; }
    const ls = localState(w, v, this.tgt.region);
    const upW = ls.up.clone().applyQuaternion(ls.quat);
    const h = ls.p.y;
    const m = v.mass;
    if (this.stage === 'up') {
      this.phase = 'Opstijgen';
      const th = v.thrustInfo(v.tel.pAmb);
      const remaining = this.alt - h;
      const vt = remaining > 0 ? Math.min(this.bellyflop ? 220 : 12, Math.sqrt(2 * 9 * Math.max(remaining, 0)) * (this.bellyflop ? 1 : 0.6) + 1) : 0;
      // horizontaal naar doel als niet buik
      const ex = this.tgt.x - ls.p.x, ez = this.tgt.z - ls.p.z;
      let ax = 0, az = 0;
      if (h > 30 && !this.bellyflop) { ax = clamp(ex * 0.02 - ls.vel.x * 0.4, -1.5, 1.5); az = clamp(ez * 0.02 - ls.vel.z * 0.4, -1.5, 1.5); }
      if (this.bellyflop && h > 2000) { ax = clamp(ex * 0.0004, -0.6, 0.6); az = clamp(ez * 0.0004, -0.6, 0.6); }
      const ay = ls.g + (vt - ls.vel.y) * 0.8;
      const need = Math.hypot(ax, ay, az) * m;
      let F = 0, Fmin = 0;
      for (const e of v.active.engines) if (!e.failed && e.selected && e.spec.kind === 'sl') { const Ae = e.spec.thrustVac * (1 - e.spec.ispSL / e.spec.ispVac) / P0; const f = e.spec.thrustVac - v.tel.pAmb * Ae; F += f; Fmin += f * e.spec.minThrottle; }
      // motoren afschakelen als te sterk
      if (need < Fmin * 0.95) {
        const on = v.active.engines.filter((e) => e.selected && !e.failed);
        if (on.length > 1) { on[on.length - 1].selected = false; w.emit('Motor uitgeschakeld (gaspedaal)', 'info', v); }
      }
      v.cmdThrottle = F > 0 ? clamp(need / F, 0.05, 1) : 0;
      const dir = new THREE.Vector3(ax, Math.max(ay, 1), az).normalize().applyQuaternion(ls.quat);
      point(v, dir, v.belly());
      const atTop = this.bellyflop ? (ls.vel.y < 15 && h > this.alt * 0.85) || h >= this.alt : (h >= this.alt - 3);
      if (atTop) {
        if (this.bellyflop) { this.stage = 'fall'; v.cmdThrottle = 0; w.emit('Apogeum — motoren uit, kantelen naar buikhouding', 'info', v); }
        else this.stage = 'translate';
        this.apexT = this.t;
      }
      return;
    }
    if (this.stage === 'translate') {
      this.phase = 'Verplaatsen';
      const ex = this.tgt.x - ls.p.x, ez = this.tgt.z - ls.p.z;
      const d = Math.hypot(ex, ez);
      // zweven op hoogte, schuif naar doel
      const ax = clamp(ex * 0.04 - ls.vel.x * 0.6, -1.2, 1.2), az = clamp(ez * 0.04 - ls.vel.z * 0.6, -1.2, 1.2);
      const ay = ls.g + (this.alt - h) * 0.3 - ls.vel.y * 0.8;
      const need = Math.hypot(ax, ay, az) * m;
      let F = 0;
      for (const e of v.active.engines) if (!e.failed && e.selected) { const Ae = e.spec.thrustVac * (1 - e.spec.ispSL / e.spec.ispVac) / P0; F += e.spec.thrustVac - v.tel.pAmb * Ae; }
      v.cmdThrottle = F > 0 ? clamp(need / F, 0.05, 1) : 0;
      point(v, new THREE.Vector3(ax, ay, az).normalize().applyQuaternion(ls.quat), v.belly());
      if (d < 4 && Math.hypot(ls.vel.x, ls.vel.z) < 1.5) { this.stage = 'land'; this.lg.ignited = true; this.lg.engineSet = 'single'; }
      return;
    }
    if (this.stage === 'fall') {
      const hh = h - this.tgt.y;
      this.phase = 'Buiklanding (belly flop)';
      v.cmdThrottle = 0; v.flapsOn = true;
      const vs = v.vRel.clone();
      // horizontaal buik naar beneden; neus richting doel
      const ex = this.tgt.x - ls.p.x, ez = this.tgt.z - ls.p.z;
      const toT = new THREE.Vector3(ex, 0, ez);
      const glide = clamp(toT.length() / 1500, 0, 1);
      const noseL = toT.lengthSq() > 1 ? toT.normalize() : new THREE.Vector3(1, 0, 0);
      const pitch = (this.t - this.apexT < 4 ? 30 : 4 + glide * 8) * Math.PI / 180;
      const nose = noseL.clone().multiplyScalar(Math.cos(pitch)).add(new THREE.Vector3(0, Math.sin(pitch), 0)).normalize().applyQuaternion(ls.quat);
      // buik naar beneden (+Z naar grond)
      point(v, nose, upW.clone().multiplyScalar(-1));
      // stuur door glijden: verschuif via lift (vereenvoudigd: kleine horizontale correctie)
      if (vs.length() > 30 && v.active.flapHealth > 0.4) {
        // glijden met flaps (L/D ~0,25): stuur horizontale snelheid naar doel
        const tgo = Math.max(5, hh / Math.max(-ls.vel.y, 10));
        let dx = ex / tgo, dz = ez / tgo; const dm = Math.hypot(dx, dz); if (dm > 35) { dx *= 35 / dm; dz *= 35 / dm; }
        const amax = 0.25 * Math.max(0, -ls.vel.y) * Math.max(0, -ls.vel.y) * 0.02;
        let cx = (dx - ls.vel.x) * 0.9, cz = (dz - ls.vel.z) * 0.9; const cm = Math.hypot(cx, cz); const lim = Math.min(3, amax + 0.5);
        if (cm > lim) { cx *= lim / cm; cz *= lim / cm; }
        v.vel.addScaledVector(new THREE.Vector3(cx, 0, cz).applyQuaternion(ls.quat), dt);
      }
      this.status = `Afstand ${Math.hypot(ex, ez).toFixed(0)} m`;
      if (this.lg.shouldIgnite(ls, 1.4 * v.length * 9, 150)) { this.stage = 'land'; this.lg.ignited = true; w.emit('Flip-manoeuvre! Motoren herstarten', 'flip', v); }
      return;
    }
    this.phase = 'Landing';
    const r = this.lg.update(dt, w);
    this.status = `Afstand ${r.dist.toFixed(1)} m · h ${r.h.toFixed(0)} m`;
  }
}

// ===== BAANHOUDING & MANOEUVRES =====
export class HoldProgram extends Program {
  constructor(v: Vehicle, public mode: 'prograde' | 'retrograde' | 'radial' | 'antiradial' | 'normal' | 'antinormal' | 'sun') { super(v); this.phase = 'Houding: ' + mode; }
  update(dt: number, w: World) {
    const v = this.v;
    const body = w.dominant(v.pos);
    const c = body === 'earth' ? new THREE.Vector3() : w.ephem.moonPos(w.t);
    const cv = body === 'earth' ? new THREE.Vector3() : w.ephem.moonVel(w.t);
    const r = v.pos.clone().sub(c), vel = v.vel.clone().sub(cv);
    if (v.tel.alt < 70000 && body === 'earth') vel.copy(v.vRel);
    const n = r.clone().cross(vel).normalize();
    let d = vel.clone().normalize();
    if (this.mode === 'retrograde') d.negate();
    if (this.mode === 'radial') d = r.clone().normalize();
    if (this.mode === 'antiradial') d = r.clone().normalize().negate();
    if (this.mode === 'normal') d = n.clone();
    if (this.mode === 'antinormal') d = n.clone().negate();
    point(v, d, r.clone().normalize().negate());
  }
  busy() { return false; }
}

export interface ManeuverNode { t: number; pro: number; nrm: number; rad: number; }
export function nodeVector(w: World, v: Vehicle, node: ManeuverNode, pos: THREE.Vector3, vel: THREE.Vector3) {
  const r = pos.clone(), vv = vel.clone();
  const pro = vv.clone().normalize();
  const nrm = r.clone().cross(vv).normalize();
  const rad = nrm.clone().cross(pro).normalize();
  return pro.multiplyScalar(node.pro).add(nrm.multiplyScalar(node.nrm)).add(rad.multiplyScalar(node.rad));
}
export class BurnProgram extends Program {
  dvLeft: number; dir: THREE.Vector3; started = false;
  constructor(v: Vehicle, public node: ManeuverNode, public label = 'Manoeuvre', public engines: 'all' | 'vac' | 'sl' = 'all') { super(v); this.dvLeft = Math.hypot(node.pro, node.nrm, node.rad); this.dir = new THREE.Vector3(); this.phase = label + ': wachten'; }
  update(dt: number, w: World) {
    const v = this.v;
    if (v.state !== 'flying') { this.done = true; return; }
    const body = w.dominant(v.pos);
    const c = body === 'earth' ? new THREE.Vector3() : w.ephem.moonPos(w.t);
    const cv = body === 'earth' ? new THREE.Vector3() : w.ephem.moonVel(w.t);
    if (!this.started) {
      this.dir = nodeVector(w, v, this.node, v.pos.clone().sub(c), v.vel.clone().sub(cv)).normalize();
    }
    const th = v.thrustInfo(0);
    const F = this.estThrust();
    const burnTime = this.dvLeft * v.mass / Math.max(F, 1);
    const tStart = this.node.t - burnTime / 2;
    point(v, this.dir, v.pos.clone().sub(c).normalize().negate());
    if (w.t < tStart) {
      this.phase = `${this.label}: over ${Math.max(0, tStart - w.t).toFixed(0)} s`;
      v.cmdThrottle = 0;
      if (tStart - w.t < 30 && w.warp > 4) w.warp = 1;
      return;
    }
    if (angleTo(v, this.dir) > 6 && !this.started) { this.phase = `${this.label}: richten`; v.cmdThrottle = 0; return; }
    this.started = true;
    v.selectEngines(this.engines === 'all' ? 'all' : this.engines);
    const thr = clamp(this.dvLeft / 15, 0.05, 1);
    v.cmdThrottle = Math.max(thr, 0.4);
    const a = v.accel.dot(this.dir);
    this.dvLeft -= Math.max(0, a) * dt;
    this.phase = `${this.label}: brand (${this.dvLeft.toFixed(0)} m/s)`;
    if (this.dvLeft <= 0.3 || v.active.prop <= 0) { v.cmdThrottle = 0; this.done = true; w.emit(`${this.label} voltooid`, 'info', v); }
  }
  estThrust() {
    let F = 0;
    for (const e of this.v.active.engines) if (!e.failed) F += e.spec.thrustVac;
    return F * 0.95;
  }
  busy() { return !this.done && this.started; }
}
export { upAt };
