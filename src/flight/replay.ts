// Vluchtopname en -weergave. Opname: snapshots van alle voertuigen (10 Hz) + gebeurtenissen.
// Weergave: een 'spookwereld' zonder fysica waarin de voertuigen de opname volgen.
import * as THREE from 'three';
import { World, SimEvent } from '../sim/world';
import { Ephemeris } from '../sim/bodies';
import { Vehicle, VState } from '../sim/vehicle';
import { VehicleSpec } from '../sim/spec';

const STATES: VState[] = ['clamped', 'flying', 'landed', 'caught', 'splashed', 'destroyed'];
// per voertuig per frame: px py pz qx qy qz qw state flame nRun flags heat mach q alt vSurf vVert prop nStages tilt thrust
const NF = 21;
export interface ReplayData {
  title: string; regions: string[]; theta0: number; epoch: number; t0: number;
  vehicles: { spec: VehicleSpec; role: Vehicle['role']; name: string; born: number }[];
  frames: { t: number; d: (number[] | null)[]; tw: number[] }[];
  events: { t: number; text: string; kind: string; vi: number }[];
  duration: number; score?: number;
}
export class Recorder {
  data: ReplayData;
  map = new Map<Vehicle, number>();
  lastT = -1e9;
  interval = 0.1;
  constructor(public w: World, title: string) {
    this.data = { title, regions: w.regions.map((r) => r.id), theta0: (w.ephem as any).theta0, epoch: (w.ephem as any).epoch, t0: w.t, vehicles: [], frames: [], events: [], duration: 0 };
    w.on((e) => this.onEvent(e));
  }
  idx(v: Vehicle) {
    let i = this.map.get(v);
    if (i === undefined) {
      i = this.data.vehicles.length;
      // spec van de huidige trappen (een stack begint met 2 trappen)
      this.data.vehicles.push({ spec: { name: v.spec.name, stages: v.stages.map((s) => s.spec) }, role: v.role, name: v.name, born: this.w.t });
      this.map.set(v, i);
    }
    return i;
  }
  onEvent(e: SimEvent) {
    if (!e.text && e.kind !== 'explode') return;
    this.data.events.push({ t: e.t, text: e.text, kind: e.kind, vi: e.vehicle ? this.idx(e.vehicle) : -1 });
  }
  sample(force = false) {
    const w = this.w;
    const iv = w.warp > 4 ? Math.max(this.interval, w.warp * 0.05) : this.interval;
    if (!force && w.t - this.lastT < iv) return;
    this.lastT = w.t;
    for (const v of w.vehicles) this.idx(v);
    const d: (number[] | null)[] = [];
    for (const v of w.vehicles) {
      const i = this.map.get(v)!;
      let flame = 0, n = 0;
      for (const e of v.active.engines) if (e.on && !e.failed) { flame += e.throttle * e.spool; n++; }
      const T = v.tel;
      d[i] = [v.pos.x, v.pos.y, v.pos.z, v.q.x, v.q.y, v.q.z, v.q.w, STATES.indexOf(v.state), n ? flame / n : 0, n,
        (v.flapsOn ? 1 : 0) | (v.legsDown ? 2 : 0) | (v.finsOut ? 4 : 0), T.heatFlux, T.mach, T.q, T.alt, T.vSurf, T.vVert, v.propFrac, v.stages.length, T.tilt, T.thrust];
    }
    const tw: number[] = [];
    for (const t of w.towers) tw.push(t.armH, t.armOpen);
    this.data.frames.push({ t: w.t, d, tw });
    this.data.duration = w.t - this.data.t0;
    if (this.data.frames.length > 40000) { // decimeren bij lange vluchten
      this.data.frames = this.data.frames.filter((_, k) => k % 2 === 0);
      this.interval *= 2;
    }
  }
}

export class Player {
  w: World; vs: Vehicle[] = []; t: number; fi = 0; ei = 0;
  speed = 1; paused = false;
  constructor(public data: ReplayData) {
    const e = new Ephemeris(data.epoch, data.theta0);
    this.w = new World(e, data.regions);
    this.t = data.t0;
    for (const vd of data.vehicles) {
      const v = new Vehicle(vd.spec, vd.role);
      v.name = vd.name;
      this.vs.push(v);
    }
    this.apply(true);
  }
  get end() { return this.data.t0 + this.data.duration; }
  seek(t: number) {
    this.t = Math.max(this.data.t0, Math.min(this.end, t));
    // gebeurtenissen niet opnieuw afspelen bij terugspoelen
    this.ei = this.data.events.findIndex((e) => e.t > this.t); if (this.ei < 0) this.ei = this.data.events.length;
    this.fi = 0;
    this.apply(true);
  }
  step(dt: number) {
    if (this.paused) return;
    this.t = Math.min(this.end, this.t + dt * this.speed);
    this.apply(false);
  }
  apply(silent: boolean) {
    const F = this.data.frames;
    if (!F.length) return;
    while (this.fi < F.length - 2 && F[this.fi + 1].t <= this.t) this.fi++;
    while (this.fi > 0 && F[this.fi].t > this.t) this.fi--;
    const a = F[this.fi], b = F[Math.min(F.length - 1, this.fi + 1)];
    const k = b.t > a.t ? Math.max(0, Math.min(1, (this.t - a.t) / (b.t - a.t))) : 0;
    this.w.t = this.t;
    this.w.updateFrames();
    const present: Vehicle[] = [];
    for (let i = 0; i < this.vs.length; i++) {
      const da = a.d[i], db = b.d[i] || da;
      const v = this.vs[i];
      if (!da) continue;
      present.push(v);
      v.pos.set(da[0] + (db![0] - da[0]) * k, da[1] + (db![1] - da[1]) * k, da[2] + (db![2] - da[2]) * k);
      const qa = new THREE.Quaternion(da[3], da[4], da[5], da[6]), qb = new THREE.Quaternion(db![3], db![4], db![5], db![6]);
      v.q.copy(qa.slerp(qb, k));
      if (b.t > a.t) v.vel.set((db![0] - da[0]) / (b.t - a.t), (db![1] - da[1]) / (b.t - a.t), (db![2] - da[2]) / (b.t - a.t));
      v.state = STATES[da[7]];
      while (v.stages.length > da[18]) v.stages.shift();
      const n = da[9], flame = da[8];
      let c = 0;
      for (const e of v.active.engines) { const on = c < n; e.on = on; e.failed = false; e.throttle = on ? flame : 0; e.spool = on ? 1 : 0; c++; }
      v.flapsOn = !!(da[10] & 1); v.legsDown = !!(da[10] & 2); v.finsOut = !!(da[10] & 4);
      const T = v.tel;
      T.heatFlux = da[11]; T.mach = da[12]; T.q = da[13]; T.alt = da[14]; T.vSurf = da[15]; T.vVert = da[16];
      v.active.prop = da[17] * v.active.spec.propMax; T.tilt = da[19]; T.thrust = da[20];
      T.body = this.w.dominant(v.pos);
      T.pAmb = T.body === 'earth' ? 101325 * Math.exp(-Math.max(0, T.alt) / 8000) : 0;
      v.vRel.copy(v.vel).sub(this.w.surfaceVel(T.body, v.pos, new THREE.Vector3()));
    }
    this.w.vehicles = present;
    for (let i = 0; i < this.w.towers.length; i++) { const tw = a.tw; if (tw && tw.length > i * 2) { this.w.towers[i].armH = tw[i * 2]; this.w.towers[i].armOpen = tw[i * 2 + 1]; } }
    // gebeurtenissen
    const E = this.data.events;
    while (this.ei < E.length && E[this.ei].t <= this.t) {
      const e = E[this.ei++];
      if (!silent) this.w.emit(e.text, e.kind, e.vi >= 0 ? this.vs[e.vi] : undefined);
    }
  }
}
// compacte opslag (beste vluchten) in localStorage
export function packReplay(d: ReplayData, maxFrames = 2500): string {
  let frames = d.frames;
  if (frames.length > maxFrames) { const k = Math.ceil(frames.length / maxFrames); frames = frames.filter((_, i) => i % k === 0 || i === d.frames.length - 1); }
  const r = (x: number) => Math.abs(x) > 1000 ? Math.round(x * 10) / 10 : Math.round(x * 1000) / 1000;
  return JSON.stringify({ ...d, frames: frames.map((f) => ({ t: r(f.t), d: f.d.map((a) => a ? a.map(r) : null), tw: f.tw.map(r) })) });
}
export function saveBestReplay(key: string, d: ReplayData) {
  try { localStorage.setItem('starship_replay_' + key, packReplay(d)); } catch { /* opslag vol */ }
}
export function loadReplay(key: string): ReplayData | null {
  try { const s = localStorage.getItem('starship_replay_' + key); return s ? JSON.parse(s) : null; } catch { return null; }
}
export function listReplays(): string[] {
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; if (k.startsWith('starship_replay_')) out.push(k.slice(16)); }
  return out;
}
