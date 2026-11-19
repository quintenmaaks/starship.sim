import * as THREE from 'three';
import { Vehicle } from './vehicle';
import { World } from './world';
import { Program, point, localState, LandingGuidance, LandTarget, angleTo, ManeuverNode, BurnProgram, upAt } from './autopilot';
import { MU_E, MU_M, R_M, G0, MOON_SOI } from './constants';
import { kepler, elements } from './orbit';
import { clamp } from '../core/util';

// ===== Statische vuurproef =====
export class StaticFireProgram extends Program {
  t = 0; ignT = -1;
  constructor(v: Vehicle, public duration: number, public throttle = 0.7, public mode: 'all' | 'sl' = 'all') { super(v); this.phase = 'Aftellen'; }
  update(dt: number, w: World) {
    const v = this.v;
    this.t += dt;
    if (v.state === 'destroyed') { this.done = true; return; }
    if (this.t < 3) { this.phase = `Aftellen T−${(3 - this.t).toFixed(0)}`; v.cmdThrottle = 0; return; }
    if (this.ignT < 0) { this.ignT = this.t; v.selectEngines(this.mode === 'sl' ? 'sl' : 'all'); w.emit('Ontsteking — statische vuurproef', 'liftoff', v); }
    const run = this.t - this.ignT;
    v.cmdThrottle = run < this.duration ? this.throttle : 0;
    this.phase = run < this.duration ? `Vuurproef ${run.toFixed(1)} / ${this.duration} s` : 'Afslag';
    this.status = `${v.enginesRunning()} / ${v.active.engines.length} motoren`;
    if (run > this.duration + 2) { this.done = true; w.emit('Afslag — vuurproef voltooid', 'meco', v); }
  }
  busy() { return !this.done; }
}

// ===== Maanlanding: remfase met E-geleiding, daarna landingsmotoren =====
export class LunarDescentProgram extends Program {
  stage: 'braking' | 'approach' | 'terminal' = 'braking';
  tgo = -1; lg: LandingGuidance; tgt: LandTarget;
  landThrust = 0;
  constructor(v: Vehicle, tgt: LandTarget) { super(v); this.tgt = tgt; this.lg = new LandingGuidance(v, tgt, 12); this.phase = 'Remfase (PDI)'; }
  mainThrust() { let F = 0; for (const e of this.v.active.engines) if (!e.failed && e.spec.kind === 'vac') F += e.spec.thrustVac; if (F === 0) for (const e of this.v.active.engines) if (!e.failed) F += e.spec.thrustVac; return F; }
  update(dt: number, w: World) {
    const v = this.v;
    if (v.state !== 'flying') { this.done = true; v.cmdThrottle = 0; return; }
    const ls = localState(w, v, this.tgt.region);
    const g = ls.g;
    const rf = new THREE.Vector3(this.tgt.x, this.tgt.y, this.tgt.z);
    const r = ls.p, vel = ls.vel;
    const m = v.mass;
    const hAbove = r.y - this.tgt.y;
    const dh = Math.hypot(rf.x - r.x, rf.z - r.z);
    v.legsDown = hAbove < 3000;
    if (this.stage === 'braking') {
      const gate = rf.clone().add(new THREE.Vector3(0, 450, 0));
      const vf = new THREE.Vector3(0, -12, 0);
      if (this.tgo < 0) { const vh = Math.hypot(vel.x, vel.z); this.tgo = clamp(2 * dh / Math.max(vh, 50), 60, 900); }
      this.tgo = Math.max(3, this.tgo - dt);
      const tg = this.tgo;
      const a = gate.clone().sub(r).multiplyScalar(6 / (tg * tg)).sub(vel.clone().multiplyScalar(4 / tg)).sub(vf.clone().multiplyScalar(2 / tg));
      a.y += g;
      const F = this.mainThrust();
      let aMag = a.length();
      const aMax = F / m;
      // niet onder minimale stuwkracht: dan kort uit
      v.selectEngines('vac');
      if (v.active.engines.every((e) => e.spec.kind !== 'vac' || e.failed)) v.selectEngines('all');
      const thr = aMag / aMax;
      v.cmdThrottle = thr < 0.38 ? (thr > 0.2 ? 0.4 : 0) : clamp(thr, 0.4, 1);
      if (aMag < 1e-3) aMag = 1;
      const dirW = a.clone().normalize().applyQuaternion(ls.quat);
      point(v, dirW, upAt(w, v).negate());
      this.phase = 'Remfase (PDI)';
      this.status = `Afstand ${(dh / 1000).toFixed(1)} km · h ${(hAbove / 1000).toFixed(2)} km · tgo ${tg.toFixed(0)} s`;
      if (tg < 8 || (hAbove < 600 && Math.hypot(vel.x, vel.z) < 25)) { this.stage = 'terminal'; v.cmdThrottle = 0; w.emit('Overgang naar landingsmotoren (hoog op de romp)', 'info', v); }
      return;
    }
    // ---- landingsmotoren: directe stuwkracht (hoge HLS-thrusters), ZEM/ZEV + constante vertraging
    v.cmdThrottle = 0;
    const ex = rf.x - r.x, ez = rf.z - r.z;
    const dist = Math.hypot(ex, ez), hv = Math.hypot(vel.x, vel.z);
    // horizontaal: naar het doel met snelheid ~ wortel(afstand), begrensd
    const vWant = Math.min(20, Math.sqrt(dist) * 0.9);
    const wx = dist > 0.01 ? ex / dist * vWant : 0, wz = dist > 0.01 ? ez / dist * vWant : 0;
    let ax = (wx - vel.x) * 0.6, az = (wz - vel.z) * 0.6;
    const al = Math.hypot(ax, az); if (al > 4) { ax *= 4 / al; az *= 4 / al; }
    const hEff = Math.max(hAbove - 1.5, 0.3);
    const vd = -vel.y;
    // verticaal: zweven op ~40 m tot we boven het doel staan
    const aligned = dist < 3 && hv < 1;
    const floorH = aligned ? 0 : 40;
    let vTarget = Math.max(1.0, Math.min(25, Math.sqrt(2 * 0.9 * Math.max(0.3, hEff - floorH))));
    if (!aligned && hEff < floorH + 2) vTarget = (hEff - floorH) * 0.3;
    const ay = g + clamp((vd - vTarget) * 1.2, -2, 6);
    const acc = new THREE.Vector3(ax, ay, az);
    const thrustN = acc.length() * m;
    this.landThrust = thrustN;
    const prop = v.active;
    const dm = thrustN / (330 * G0) * dt;
    if (prop.prop > dm) {
      prop.prop -= dm;
      v.vel.addScaledVector(acc.clone().applyQuaternion(ls.quat), dt);
      // zwaartekrachtcompensatie zit in acc.y; de integratie voegt zwaartekracht toe
    }
    point(v, upAt(w, v), v.belly());
    this.phase = 'Landingsmotoren';
    this.status = `Afstand ${dist.toFixed(1)} m · h ${hAbove.toFixed(0)} m · ${vd.toFixed(1)} m/s`;
  }
  busy() { return !this.done; }
}

// ===== Koppelen en brandstofoverdracht (staart-aan-staart) =====
export class DockingProgram extends Program {
  docked = false; transferred = 0;
  constructor(v: Vehicle, public target: Vehicle, public amount: number) { super(v); this.phase = 'Naderen'; }
  update(dt: number, w: World) {
    const v = this.v, T = this.target;
    if (v.state === 'destroyed' || T.state === 'destroyed') { this.done = true; this.failed = true; return; }
    const prog = T.vel.clone().normalize();
    // doel: neus prograde; tanker: neus retrograde; motorvlakken tegen elkaar
    point(T, prog, T.pos.clone().normalize().negate());
    T.sas = 'target';
    const dockPt = T.pos.clone(); // onderkant doelschip
    const rel = v.pos.clone().sub(dockPt);
    const relV = v.vel.clone().sub(T.vel);
    if (this.docked) {
      v.pos.copy(dockPt).addScaledVector(prog, -0.2); v.vel.copy(T.vel); v.q.copy(T.q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI)); v.w.set(0, 0, 0);
      const rate = 900 * dt * Math.min(20, w.warp);
      const take = Math.min(rate, v.active.prop - v.active.spec.propMax * 0.04, T.active.spec.propMax - T.active.prop, this.amount - this.transferred);
      if (take > 0) { v.active.prop -= take; T.active.prop += take; this.transferred += take; T.propTransferred += take; }
      this.phase = 'Brandstofoverdracht';
      this.status = `${(this.transferred / 1000).toFixed(0)} / ${(this.amount / 1000).toFixed(0)} t`;
      if (this.transferred >= this.amount - 1 || take <= 0) { this.done = true; w.emit(`Overdracht voltooid: ${(this.transferred / 1000).toFixed(0)} ton brandstof`, 'catch', v, { transferred: this.transferred }); }
      return;
    }
    point(v, prog.clone().negate(), v.pos.clone().normalize().negate());
    const d = rel.length();
    // gewenste naderingssnelheid
    const vApp = d > 150 ? 3 : d > 30 ? 1.2 : d > 5 ? 0.5 : 0.2;
    const want = rel.clone().normalize().multiplyScalar(-Math.min(vApp, d * 0.05 + 0.1));
    const dv = want.sub(relV);
    const aMax = 0.12; // RCS
    const a = dv.clone().multiplyScalar(0.5);
    if (a.length() > aMax) a.setLength(aMax);
    v.vel.addScaledVector(a, dt);
    const dm = a.length() * v.mass / (70 * G0) * dt; v.active.prop = Math.max(0, v.active.prop - dm);
    this.phase = d > 30 ? 'Naderen (RCS)' : 'Eindnadering';
    this.status = `Afstand ${d.toFixed(1)} m · ${relV.length().toFixed(2)} m/s`;
    if (d < 1.2 && relV.length() < 0.35 && angleTo(v, prog.clone().negate()) < 4) { this.docked = true; w.emit('KOPPELING BEVESTIGD — zachte vangst', 'catch', v); }
  }
  busy() { return !this.done; }
}

// ===== Trans-maaninjectie: zoek vertrektijd & Δv =====
export function planTLI(w: World, v: Vehicle, targetPeri = 110000): ManeuverNode | null {
  const r0 = v.pos.clone(), v0 = v.vel.clone();
  const el = elements(r0, v0, MU_E, 6371000);
  const period = el.period || 5400;
  const tmpR = new THREE.Vector3(), tmpV = new THREE.Vector3(), rr = new THREE.Vector3(), vv = new THREE.Vector3();
  let best: { t: number; dv: number; score: number } | null = null;
  const evalCand = (tDep: number, dv: number) => {
    kepler(r0, v0, tDep, MU_E, tmpR, tmpV);
    const vn = tmpV.clone().addScaledVector(tmpV.clone().normalize(), dv);
    // propagatie tot 6 dagen; minimale afstand tot maan
    let minD = Infinity;
    const step = 1800;
    let pr = tmpR.clone(), pv = vn.clone();
    for (let t = 0; t < 6 * 86400; t += step) {
      kepler(pr, pv, step, MU_E, rr, vv); pr.copy(rr); pv.copy(vv);
      const mp = w.ephem.moonPos(w.t + tDep + t + step);
      const d = pr.distanceTo(mp);
      if (d < minD) minD = d;
      if (pr.length() > 5e8) break;
    }
    // gewenste missafstand (zonder maanzwaartekracht) voor periapsis targetPeri
    const vinf = 900;
    const rp = R_M + targetPeri;
    const b = rp * Math.sqrt(1 + 2 * MU_M / (rp * vinf * vinf));
    return Math.abs(minD - b);
  };
  for (let tDep = 120; tDep < period + 120; tDep += 90) {
    for (let dv = 3040; dv <= 3200; dv += 20) {
      const s = evalCand(tDep, dv);
      if (!best || s < best.score) best = { t: tDep, dv, score: s };
    }
  }
  if (!best) return null;
  // verfijnen
  for (let it = 0; it < 3; it++) {
    const st = [30, 10, 3][it], sd = [6, 2, 0.6][it];
    let b2 = best;
    for (let dt = -3; dt <= 3; dt++) for (let dd = -3; dd <= 3; dd++) {
      const t = best.t + dt * st, dv = best.dv + dd * sd;
      if (t < 60) continue;
      const s = evalCand(t, dv);
      if (s < b2.score) b2 = { t, dv, score: s };
    }
    best = b2;
  }
  (planTLI as any).last = best;
  kepler(r0, v0, best.t, MU_E, tmpR, tmpV);
  tmpV.addScaledVector(tmpV.clone().normalize(), best.dv);
  const elA = elements(tmpR, tmpV, MU_E, 6371000);
  return { t: w.t + best.t, pro: best.dv, nrm: 0, rad: 0, apo: elA.apo } as ManeuverNode & { apo: number };
}

// ===== Maanbaaninbrenging (LOI) bij periapsis =====
export class LunarCaptureProgram extends Program {
  burn: BurnProgram | null = null; captured = false;
  constructor(v: Vehicle) { super(v); this.phase = 'Kustvlucht naar de Maan'; }
  update(dt: number, w: World) {
    const v = this.v;
    if (v.state !== 'flying') { this.done = true; return; }
    const mp = w.ephem.moonPos(w.t), mv = w.ephem.moonVel(w.t);
    const r = v.pos.clone().sub(mp), vel = v.vel.clone().sub(mv);
    if (this.burn) {
      this.burn.update(dt, w);
      this.phase = this.burn.phase; this.status = this.burn.status;
      if (this.burn.done) { this.done = true; this.captured = true; const el = elements(r, vel, MU_M, R_M); w.emit(`In maanbaan: ${(el.apo / 1000).toFixed(0)} × ${(el.peri / 1000).toFixed(0)} km`, 'seco', v, { apo: el.apo, peri: el.peri }); }
      return;
    }
    if (r.length() > MOON_SOI) {
      const d = r.length();
      this.phase = 'Kustvlucht naar de Maan';
      this.status = `Afstand tot Maan ${(d / 1000).toFixed(0)} km`;
      return;
    }
    // in SOI: zoek periapsis
    const el = elements(r, vel, MU_M, R_M);
    this.status = `Periluna ${(el.peri / 1000).toFixed(0)} km`;
    if (r.dot(vel) < 0) {
      // tijd tot periapsis via propagatie
      const tr = new THREE.Vector3(), tv = new THREE.Vector3();
      let best = 0, bd = Infinity;
      for (let t = 0; t < 3 * 86400; t += 60) { kepler(r, vel, t, MU_M, tr, tv); const d = tr.length(); if (d < bd) { bd = d; best = t; } else if (d > bd + 1000) break; }
      kepler(r, vel, best, MU_M, tr, tv);
      const vc = Math.sqrt(MU_M / tr.length());
      const dv = tv.length() - vc;
      this.burn = new BurnProgram(v, { t: w.t + best, pro: -dv, nrm: 0, rad: 0 }, 'Maanbaaninbrenging (LOI)', 'all');
      w.emit(`LOI gepland: ${dv.toFixed(0)} m/s over ${(best / 60).toFixed(0)} min`, 'info', v);
    }
  }
  busy() { return !!this.burn && this.burn.busy(); }
}

// ===== Programmareeks =====
export class SequenceProgram extends Program {
  i = 0;
  constructor(v: Vehicle, public items: (() => Program)[], public labels: string[] = []) { super(v); }
  cur: Program | null = null;
  update(dt: number, w: World) {
    if (!this.cur) { if (this.i >= this.items.length) { this.done = true; return; } this.cur = this.items[this.i++](); }
    this.cur.update(dt, w);
    this.phase = this.cur.phase; this.status = this.cur.status;
    if (this.cur.done) { this.cur = null; if (this.i >= this.items.length) this.done = true; }
  }
  busy() { return !!this.cur && this.cur.busy(); }
}

// TLI-brand: gesloten lus op apogeum (veel nauwkeuriger dan Δv tellen)
export class TliBurnProgram extends Program {
  started = false;
  constructor(v: Vehicle, public node: ManeuverNode & { apo: number }) { super(v); this.phase = 'TLI: wachten'; }
  update(dt: number, w: World) {
    const v = this.v;
    if (v.state !== 'flying') { this.done = true; return; }
    const dir = v.vel.clone().normalize();
    point(v, dir, v.pos.clone().normalize().negate());
    let F = 0; for (const e of v.active.engines) if (!e.failed) F += e.spec.thrustVac;
    const burnTime = this.node.pro * v.mass / Math.max(F * 0.95, 1) * 0.8;
    const tStart = this.node.t - burnTime / 2;
    if (!this.started && w.t < tStart) {
      this.phase = `TLI over ${Math.max(0, tStart - w.t).toFixed(0)} s`;
      v.cmdThrottle = 0;
      if (tStart - w.t < 40 && w.warp > 4) w.warp = 1;
      return;
    }
    if (!this.started) { this.started = true; v.selectEngines('all'); w.emit('Trans-maaninjectie: ontsteking!', 'liftoff', v); }
    const el = elements(v.pos, v.vel, MU_E, 6371000);
    const apo = el.e < 1 ? el.apo : 1e12;
    const left = this.node.apo - apo;
    v.cmdThrottle = left > 30e6 ? 1 : clamp(left / 30e6, 0.4, 1);
    this.phase = 'TLI-brand';
    this.status = `Apogeum ${(Math.max(0, apo) / 1000).toFixed(0)} / ${(this.node.apo / 1000).toFixed(0)} km`;
    if (apo >= this.node.apo || v.active.prop <= 0) { v.cmdThrottle = 0; this.done = true; w.emit('TLI voltooid — op weg naar de Maan', 'seco', v); }
  }
  busy() { return this.started && !this.done; }
}
// Koerscorrectie: kleine prograde/retrograde Δv om de periluna te raken
export function planMidCourse(w: World, v: Vehicle, targetPeri = 110000): ManeuverNode {
  const tDep = 120;
  const r0 = v.pos.clone(), v0 = v.vel.clone();
  const tmpR = new THREE.Vector3(), tmpV = new THREE.Vector3(), rr = new THREE.Vector3(), vv = new THREE.Vector3();
  kepler(r0, v0, tDep, MU_E, tmpR, tmpV);
  const rp = R_M + targetPeri, vinf = 900;
  const b = rp * Math.sqrt(1 + 2 * MU_M / (rp * vinf * vinf));
  const score = (dv: number, dr: number) => {
    const pv0 = tmpV.clone().addScaledVector(tmpV.clone().normalize(), dv).addScaledVector(tmpR.clone().normalize(), dr);
    let pr = tmpR.clone(), pv = pv0; let minD = Infinity;
    for (let t = 0; t < 6 * 86400; t += 900) { kepler(pr, pv, 900, MU_E, rr, vv); pr = rr.clone(); pv = vv.clone(); const d = pr.distanceTo(w.ephem.moonPos(w.t + tDep + t + 900)); if (d < minD) minD = d; else if (d > minD + 2e7) break; }
    return Math.abs(minD - b);
  };
  let best = { dv: 0, dr: 0, s: score(0, 0) };
  for (const step of [8, 2, 0.5, 0.1]) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const [a, c] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
        const s2 = score(best.dv + a, best.dr + c);
        if (s2 < best.s) { best = { dv: best.dv + a, dr: best.dr + c, s: s2 }; improved = true; }
      }
    }
  }
  return { t: w.t + tDep, pro: best.dv, nrm: 0, rad: best.dr };
}

// ===== Opstijgen vanaf de Maan naar een lage maanbaan =====
export class LunarAscentProgram extends Program {
  t = 0; stage: 'rise' | 'pitch' | 'coast' | 'circ' = 'rise';
  constructor(v: Vehicle, public targetAlt = 80000, public azDeg = 0) { super(v); this.phase = 'Lancering vanaf de Maan'; }
  update(dt: number, w: World) {
    const v = this.v;
    if (v.state === 'landed') { v.selectEngines('vac'); v.cmdThrottle = 0.6; this.phase = 'Ontsteking'; return; }
    if (v.state !== 'flying') { this.done = true; return; }
    this.t += dt;
    const mc = w.ephem.moonPos(w.t), mv = w.ephem.moonVel(w.t);
    const r = v.pos.clone().sub(mc), vel = v.vel.clone().sub(mv);
    const up = r.clone().normalize();
    const vr = vel.dot(up);
    const vh = vel.clone().addScaledVector(up, -vr);
    // horizontale richting: azimut t.o.v. lokaal noord (as = maan-noord ≈ +Y)
    const north = new THREE.Vector3(0, 1, 0).addScaledVector(up, -up.y).normalize();
    const east = new THREE.Vector3().crossVectors(north, up).normalize();
    const az = this.azDeg * Math.PI / 180;
    const hdir = vh.length() > 30 ? vh.clone().normalize() : north.clone().multiplyScalar(Math.cos(az)).addScaledVector(east, Math.sin(az));
    const el = elements(r, vel, MU_M, R_M);
    const alt = r.length() - R_M;
    v.selectEngines('vac');
    if (this.stage === 'rise') {
      point(v, up, hdir.clone().negate()); v.cmdThrottle = 0.55; v.legsDown = true;
      this.phase = 'Verticale klim';
      if (this.t > 6) { this.stage = 'pitch'; w.emit('Kanteling naar de baan', 'info', v); }
    } else {
      const g = MU_M / r.lengthSq() - vh.lengthSq() / r.length();
      const th = v.thrustInfo(0); const F = Math.max(th.F, 1);
      v.cmdThrottle = clamp(2.5 * 9.81 * v.mass / F, 0.1, 1);
      const aT = F * v.cmdThrottle / v.mass;
      const vrStar = clamp((15000 - alt) / 30, 0, 90);
      const s2 = clamp(((vrStar - vr) / 8 + g) / aT, -0.3, 0.9);
      const dir = hdir.clone().multiplyScalar(Math.sqrt(1 - s2 * s2)).addScaledVector(up, s2);
      point(v, dir, up.clone().negate());
      v.legsDown = false;
      this.phase = 'Klim naar maanbaan';
      this.status = `Apo ${(el.apo / 1000).toFixed(0)} km · Peri ${(el.peri / 1000).toFixed(0)} km`;
      if (this.stage === 'circ') {
        point(v, hdir, up.clone().negate());
        const need = Math.sqrt(MU_M / r.length()) - vh.length();
        v.cmdThrottle = clamp(need / 30, 0.05, 1) * Math.min(1, 2.5 * 9.81 * v.mass / F);
        this.phase = 'Circularisatie';
        if (need <= 0.5 || el.peri >= this.targetAlt * 0.85 || v.active.prop <= 0) {
          v.cmdThrottle = 0; this.done = true;
          if (el.peri < 10000) w.emit('Brandstof op vóór de maanbaan!', 'fail', v);
          else w.emit(`In maanbaan: ${(el.apo / 1000).toFixed(0)} × ${(el.peri / 1000).toFixed(0)} km`, 'seco', v);
        }
      } else if (this.stage === 'coast') {
        v.cmdThrottle = 0; point(v, hdir, up.clone().negate());
        this.phase = 'Kust naar apolunium';
        if (vr <= 1) { this.stage = 'circ'; w.emit('Circularisatiebrand', 'info', v); }
      } else if (el.apo >= this.targetAlt) { v.cmdThrottle = 0; this.stage = 'coast'; w.emit('Motoren uit — kust naar apolunium', 'meco', v); }
      else if (v.active.prop <= 0) { this.done = true; w.emit('Brandstof op vóór de maanbaan!', 'fail', v); }
    }
  }
  busy() { return !this.done; }
}
