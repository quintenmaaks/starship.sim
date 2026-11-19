// Vluchtopzet: zet per missie/scenario de wereld, voertuigen, autopiloot en doelen klaar.
// Puur simulatie (geen DOM) zodat het ook headless getest kan worden.
import * as THREE from 'three';
import { World, SimEvent } from '../sim/world';
import { Ephemeris } from '../sim/bodies';
import { Vehicle, Reliability, PERFECT } from '../sim/vehicle';
import { VehicleSpec } from '../sim/spec';
import { REGIONS } from '../sim/terrain';
import { AscentProgram, BoostbackProgram, HopProgram, ShipReturnProgram, HoldProgram, BurnProgram, LandTarget } from '../sim/autopilot';
import { StaticFireProgram, LunarDescentProgram, DockingProgram, planTLI, planMidCourse, TliBurnProgram, LunarCaptureProgram, SequenceProgram, LunarAscentProgram } from '../sim/programs2';
import { placeEntry, placeOrbit, spawnFree } from '../sim/spawn';
import { elements } from '../sim/orbit';
import { MU_E, R_E, G0 } from '../sim/constants';
import { Design, designToSpec } from '../game/parts';
import { MissionDef, MISSIONS } from '../game/missions';
import { clamp, rng as mkRng } from '../core/util';

export type ObjState = 'open' | 'done' | 'fail';
export interface Objective { id: string; label: string; state: ObjState; optional?: boolean; t?: number; value?: string }
export interface FlightConfig {
  mission: MissionDef; design: Design; rel?: Reliability; hour?: number; wind?: number; seed?: number;
  crew?: number; payload?: number; manual?: boolean; headless?: boolean; sandbox?: boolean;
}
export interface Transition { text: string; sub?: string; dur: number; run: () => void }

const ENTRY_D = 2615e3;
const pad = (region: string, id: string) => REGIONS[region].pads.find((p) => p.id === id)!;
const tgtPad = (region: string, id: string, dy = 0, extra: Partial<LandTarget> = {}): LandTarget => { const p = pad(region, id); return { region, pad: p, x: p.x, z: p.z, y: p.top + dy, ...extra }; };
const WATER_GULF: LandTarget = { region: 'gulf', pad: null, x: 29000, z: 2600, y: 0, water: true };
const SHIP_WATER: LandTarget = { region: 'gulf', pad: null, x: 27500, z: -3200, y: 0, water: true };

export class FlightSetup {
  world: World; cfg: FlightConfig; mission: MissionDef;
  title = ''; subtitle = '';
  main!: Vehicle; focus!: Vehicle;
  ship: Vehicle | null = null; booster: Vehicle | null = null; other: Vehicle | null = null;
  objectives: Objective[] = [];
  metrics: Record<string, number> = {};
  ended = false; endT = -1; endReason = '';
  transition: Transition | null = null;
  custom: null | 'pressure' = null;
  pressure = { set: 0, p: 0, burst: 9, hold: 0, maxHeld: 0, cryo: false, frost: 0 };
  maxT = 4 * 3600;
  hint = '';
  tickers: ((dt: number) => void)[] = [];
  handlers: ((e: SimEvent) => void)[] = [];
  focusLock = false;
  boosterFocus = false;
  autoReturnAfterOrbit = true;
  returnMode: 'catch' | 'water' | 'pad' = 'water';
  rand: () => number;
  replayKeys: string[] = [];

  constructor(cfg: FlightConfig) {
    this.cfg = cfg; this.mission = cfg.mission;
    this.rand = mkRng(cfg.seed ?? ((Math.random() * 1e9) | 0));
    const lunarish = ['lunar', 'crewlunar', 'sc_artemis', 'sc_tli'].includes(cfg.mission.id);
    const e = new Ephemeris(0);
    e.setLocalHour(lunarish ? -97.157 : REGIONS.gulf.lon, cfg.hour ?? 16.5);
    this.world = new World(e, lunarish ? ['gulf', 'lunar'] : ['gulf']);
    this.world.rng = this.rand;
    this.world.windStrength = cfg.wind ?? 5;
    this.title = cfg.mission.title;
    this.world.on((ev) => this.onEvent(ev));
    this.build();
    if (!this.focus) this.focus = this.main;
  }

  // ---------- hulpfuncties ----------
  obj(id: string, label: string, optional = false) { this.objectives.push({ id, label, state: 'open', optional }); }
  done(id: string, value?: string) { const o = this.objectives.find((x) => x.id === id); if (o && o.state === 'open') { o.state = 'done'; o.t = this.world.t; if (value) o.value = value; this.world.emit(`✔ Doel: ${o.label}${value ? ' (' + value + ')' : ''}`, 'objective', undefined, { id }); } }
  fail(id: string, value?: string) { const o = this.objectives.find((x) => x.id === id); if (o && o.state === 'open') { o.state = 'fail'; o.t = this.world.t; if (value) o.value = value; this.world.emit(`✖ Mislukt: ${o.label}`, 'objfail', undefined, { id }); } }
  is(id: string) { return this.objectives.find((x) => x.id === id)?.state; }
  tick(f: (dt: number) => void) { this.tickers.push(f); }
  on(f: (e: SimEvent) => void) { this.handlers.push(f); }
  spec(): VehicleSpec { return designToSpec(this.cfg.design); }
  shipOnly(): VehicleSpec { const s = this.spec(); return { name: s.stages[s.stages.length - 1].name, stages: [s.stages[s.stages.length - 1]] }; }
  boosterOnly(): VehicleSpec { const s = this.spec(); return { name: s.stages[0].name, stages: [s.stages[0]] }; }
  setRel(v: Vehicle) { v.rel = this.cfg.rel ?? PERFECT; }
  end(reason: string) { if (!this.ended) { this.ended = true; this.endT = this.world.t; this.endReason = reason; for (const o of this.objectives) if (o.state === 'open') o.state = o.optional ? 'open' : 'fail'; } }
  terminal(v: Vehicle | null) { return !v || v.state === 'destroyed' || v.state === 'landed' || v.state === 'caught' || v.state === 'splashed'; }

  onEvent(e: SimEvent) {
    const v = e.vehicle;
    if (v) {
      if (e.kind === 'liftoff') this.done('liftoff');
      if (e.kind === 'stage') this.done('stage');
    }
    for (const h of this.handlers) h(e);
  }
  update(dt: number) {
    const w = this.world;
    for (const v of w.vehicles) {
      if (v.state === 'flying') {
        if (v.tel.q > (this.metrics.maxQ || 0)) this.metrics.maxQ = v.tel.q;
        if (v.tel.alt > (this.metrics.maxAlt || 0) && v.tel.body === 'earth') this.metrics.maxAlt = v.tel.alt;
        if (v.tel.vSurf > (this.metrics.maxSpeed || 0)) this.metrics.maxSpeed = v.tel.vSurf;
        if (v.tel.gLoad > (this.metrics.maxG || 0)) this.metrics.maxG = v.tel.gLoad;
        if (v.tel.heatFlux > (this.metrics.maxHeat || 0)) this.metrics.maxHeat = v.tel.heatFlux;
      }
    }
    for (const t of this.tickers) t(dt);
    if (!this.ended && w.t > this.maxT) this.end('Tijdslimiet bereikt');
  }
  score() {
    const req = this.objectives.filter((o) => !o.optional), opt = this.objectives.filter((o) => o.optional);
    const rd = req.filter((o) => o.state === 'done').length, od = opt.filter((o) => o.state === 'done').length;
    const base = req.length ? rd / req.length : 1;
    let s = base * 80 + (opt.length ? od / opt.length * 20 : 20 * base);
    if (this.metrics.accuracy !== undefined && base === 1) s = Math.min(100, s + clamp(5 - this.metrics.accuracy, 0, 5));
    return Math.round(clamp(s, 0, 100));
  }
  success() { return this.objectives.filter((o) => !o.optional).every((o) => o.state === 'done'); }
  partial() { const req = this.objectives.filter((o) => !o.optional); return req.some((o) => o.state === 'done') && !this.success(); }

  // ---------- opzet per missie ----------
  build() {
    const id = this.mission.id;
    switch (id) {
      case 'tank': return this.setupPressure(false);
      case 'cryo': return this.setupPressure(true);
      case 'static_ship': return this.setupStatic(false);
      case 'static_booster': return this.setupStatic(true);
      case 'hop150': case 'sc_firsthop': return this.setupHop(150);
      case 'hop10k': return this.setupHop(10000);
      case 'sc_sn8': return this.setupHop(10000, true);
      case 'suborbital': return this.setupLaunch({ apo: 200000, peri: -30000, booster: 'water', ship: 'suborbital' });
      case 'orbital': case 'sc_engineout': case 'sc_wind':
        if (id === 'sc_engineout') this.cfg.rel = { ...(this.cfg.rel ?? PERFECT), engineRun: 0.00035, engineIgnition: 0.03 };
        if (id === 'sc_wind') this.world.windStrength = 17;
        return this.setupLaunch({ apo: 220000, peri: 150000, booster: this.canCatchBooster() ? 'catch' : 'water', ship: 'orbit' });
      case 'boostercatch': case 'sc_ift5': case 'sc_night':
        return this.setupLaunch({ apo: 200000, peri: -30000, booster: 'catch', ship: 'suborbital', followBooster: true });
      case 'sc_boostercatch': return this.setupBoosterFinal();
      case 'shipcatch': case 'sc_shipcatch': return this.setupShipEntry('catch');
      case 'starlink': case 'satdeploy':
        return this.setupLaunch({ apo: 230000, peri: 160000, booster: this.canCatchBooster() ? 'catch' : 'water', ship: 'orbit', deploy: true });
      case 'crewleo': case 'tourism':
        return this.setupLaunch({ apo: 230000, peri: 170000, booster: 'catch', ship: 'orbit', crew: true });
      case 'proptransfer': case 'sc_tanker': return this.setupDocking();
      case 'lunar': return this.setupLunarLanding(false);
      case 'crewlunar': case 'sc_artemis': return this.setupLunarLanding(true);
      case 'sc_tli': return this.setupTLI();
      case 'sc_orbit': return this.setupOrbitFree();
      default: return this.setupLaunch({ apo: 220000, peri: 150000, booster: 'water', ship: 'orbit' });
    }
  }
  canCatchBooster() { return !!this.cfg.design.booster.catchPins && (this.cfg.sandbox || this.cfg.rel === undefined || true); }

  // ----- Tankdruk / cryo -----
  setupPressure(cryo: boolean) {
    const w = this.world;
    const v = w.spawnOnPad(this.shipOnly(), 'ship', 'gulf', 'stand', 0, [cryo ? 1 : 0]);
    for (const e of v.active.engines) e.failed = false;
    this.setRel(v);
    this.main = this.focus = v; this.custom = 'pressure';
    const strength = 1 - (this.cfg.rel?.structure !== undefined ? (1 - this.cfg.rel.structure) : 0);
    this.pressure.cryo = cryo;
    this.pressure.burst = (cryo ? 7.6 : 8.4) * (0.82 + 0.28 * strength) + (this.rand() - 0.5) * 1.2;
    this.title = cryo ? 'Cryogene proef' : 'Tankdruktest';
    this.subtitle = "Massey's teststand";
    this.hint = cryo ? 'Houd de druk 60 s boven 5 bar. Vloeibare stikstof maakt het staal brosser.' : 'Verhoog de druk. 6 bar = geslaagd, 8 bar = bonus. Hoe ver durf jij?';
    if (cryo) { this.obj('fill', 'Tanks vullen met LN2'); this.obj('hold', '60 s boven 5 bar'); this.obj('max', 'Bewezen druk ≥ 7 bar', true); }
    else { this.obj('p6', 'Druk ≥ 6 bar vasthouden (5 s)'); this.obj('p8', 'Druk ≥ 8 bar (bonus)', true); }
    this.maxT = 600;
    const P = this.pressure;
    this.tick((dt) => {
      if (this.ended) return;
      if (v.state === 'destroyed') return;
      if (cryo) { P.frost = Math.min(1, P.frost + dt / 15); if (P.frost >= 1) this.done('fill'); }
      const rate = 0.35;
      P.p += clamp(P.set - P.p, -rate * dt * 2, rate * dt);
      if (P.p > 0.2) P.p += (this.rand() - 0.5) * 0.01;
      const burstAt = P.burst * (cryo && P.frost < 1 ? 1.05 : 1);
      if (P.p >= burstAt - 0.02 || (P.p > burstAt * 0.9 && this.rand() < dt * (P.p - burstAt * 0.9) * 0.6)) {
        v.destroy(`Tank gebarsten bij ${P.p.toFixed(2)} bar`);
        w.emit(`KNAL! Tank gebarsten bij ${P.p.toFixed(2)} bar`, 'explode', v);
        this.metrics.burst = P.p;
        if (!cryo) { if (this.is('p6') === 'open') this.fail('p6'); }
        else { if (this.is('hold') === 'open') this.fail('hold'); }
        this.end('Tank gebarsten');
        return;
      }
      if (P.p > P.maxHeld) P.maxHeld = P.p;
      this.metrics.pressure = P.maxHeld;
      if (!cryo) {
        if (P.p >= 6) { P.hold += dt; if (P.hold >= 5) this.done('p6', P.p.toFixed(1) + ' bar'); } else P.hold = 0;
        if (P.p >= 8 && P.hold > 3) this.done('p8', P.p.toFixed(1) + ' bar');
      } else {
        if (P.frost >= 1 && P.p >= 5) { P.hold += dt; if (P.hold >= 60) this.done('hold'); } else if (P.p < 5) P.hold = Math.max(0, P.hold - dt * 2);
        if (P.p >= 7 && P.frost >= 1) this.done('max', P.p.toFixed(1) + ' bar');
      }
    });
  }
  stopPressureTest() {
    if (this.ended) return;
    this.metrics.pressure = this.pressure.maxHeld;
    this.end('Test beëindigd — druk afgelaten');
  }

  // ----- Statische vuurproef -----
  setupStatic(booster: boolean) {
    const w = this.world;
    const spec = booster ? this.boosterOnly() : this.shipOnly();
    const v = w.spawnOnPad(spec, booster ? 'booster' : 'ship', 'gulf', booster ? 'olm' : 'stand', booster ? 0 : 0, [booster ? 0.25 : 0.3]);
    this.setRel(v);
    this.main = this.focus = v;
    const dur = booster ? 8 : 6;
    v.ap = new StaticFireProgram(v, dur, booster ? 0.6 : 0.7, booster ? 'all' : 'sl');
    this.title = booster ? 'Statische vuurproef — Super Heavy' : 'Statische vuurproef — Starship';
    this.subtitle = booster ? 'Orbital Launch Mount A' : "Massey's teststand";
    this.obj('ign', 'Alle motoren ontsteken'); this.obj('run', `${dur} s volle duur`); this.obj('all', 'Geen motoruitval', true);
    this.maxT = 60;
    let ignChecked = false;
    this.tick(() => {
      const ap = v.ap as StaticFireProgram;
      if (ap.ignT >= 0 && !ignChecked && ap.t - ap.ignT > 1.5) {
        ignChecked = true;
        const n = v.enginesRunning(), tot = v.active.engines.filter((e) => booster || e.spec.kind === 'sl').length;
        if (n >= tot) this.done('ign', `${n}/${tot}`); else { this.fail('ign', `${n}/${tot}`); }
      }
      if (v.state === 'destroyed') { this.fail('run'); this.fail('all'); this.end('RUD op de teststand'); return; }
      if (ap.done && !this.ended) {
        const failed = v.active.engines.filter((e) => e.failed).length;
        if (failed === 0) this.done('all');
        this.done('run');
        this.metrics.enginesOk = v.active.engines.length - failed;
        this.end('Vuurproef voltooid');
      }
    });
  }

  // ----- Hops -----
  setupHop(alt: number, fromFall = false) {
    const w = this.world;
    const hopper = this.cfg.design.ship.variant === 'hopper';
    const fill = alt <= 150 ? (hopper ? 1 : 0.08) : 0.17;
    const v = w.spawnOnPad(this.shipOnly(), 'ship', 'gulf', 'padB', 0, [fill]);
    this.setRel(v);
    this.main = this.focus = v;
    const tgt = tgtPad('gulf', 'padC');
    v.legsDown = alt <= 150;
    v.ap = new HopProgram(v, alt, tgt, alt > 1000);
    this.title = this.mission.title; this.subtitle = 'Starbase, Boca Chica';
    this.obj('liftoff', 'Opstijgen van Pad B');
    this.obj('apex', `Hoogte ${alt >= 1000 ? (alt / 1000).toFixed(0) + ' km' : alt + ' m'} bereiken`);
    if (alt > 1000) { this.obj('flop', 'Belly flop'); this.obj('flip', 'Flip-and-burn'); }
    this.obj('land', 'Landen op Pad C');
    this.obj('acc', 'Precisie: < 3 m van het midden', true);
    this.maxT = alt > 1000 ? 900 : 300;
    if (fromFall) {
      // SN8-scenario: begin net na de apex in buikhouding
      w.anchors.delete(v); v.state = 'flying';
      const l = new THREE.Vector3(tgt.x + 1300, 9800, tgt.z + 40);
      w.toWorld('gulf', l, v.pos); w.surfaceVel('earth', v.pos, v.vel);
      const f = w.frames.gulf;
      v.vel.add(new THREE.Vector3(-30, -5, 0).applyQuaternion(f.quat));
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)).premultiply(f.quat);
      v.q.copy(q); v.holdQuat.copy(q);
      const ap = v.ap as any; ap.stage = 'fall'; ap.t = 60; ap.apex = true;
      this.done('liftoff'); this.done('apex');
      this.title = 'SN8: de buiklanding';
    }
    this.tick(() => {
      if (v.tel.alt > alt * 0.9 && v.state === 'flying') this.done('apex', `${Math.round(v.tel.alt)} m`);
      if (alt > 1000 && v.tel.alt < alt * 0.8 && this.is('apex') === 'done' && Math.abs(v.tel.tilt - 90) < 30 && v.tel.vVert < -20) this.done('flop');
    });
    this.on((e) => {
      if (e.vehicle !== v) return;
      if (e.kind === 'flip') this.done('flip');
      if (e.kind === 'landed') {
        const d = e.data || {};
        if (d.pad === 'padC' || (d.pad && d.pad !== 'padB')) { this.done('land', `${Math.abs(d.vv).toFixed(1)} m/s`); this.metrics.accuracy = d.dx ?? 99; if ((d.dx ?? 99) < 3) this.done('acc', `${(d.dx ?? 0).toFixed(1)} m`); else this.fail('acc', `${(d.dx ?? 0).toFixed(1)} m`); }
        else { this.fail('land', 'naast de pad'); }
        this.end('Geland');
      }
      if (e.kind === 'explode' || e.kind === 'rud') { this.end(v.failureCause || 'RUD'); }
    });
  }

  // ----- Volledige lancering (IFT / baan) -----
  setupLaunch(o: { apo: number; peri: number; booster: 'catch' | 'water'; ship: 'suborbital' | 'orbit'; followBooster?: boolean; deploy?: boolean; crew?: boolean }) {
    const w = this.world;
    const pid = 'olm';
    const v = w.spawnOnPad(this.spec(), 'stack', 'gulf', pid);
    this.setRel(v);
    if (o.crew || this.mission.crew) v.crewSafe = true;
    this.main = this.focus = v;
    w.launchT = 4;
    const padDef = pad('gulf', pid);
    const btgt: LandTarget = o.booster === 'catch' && this.cfg.design.booster.catchPins ? tgtPad('gulf', pid, 12, { catchTower: true }) : WATER_GULF;
    const catching = !!btgt.catchTower;
    this.title = this.mission.title; this.subtitle = 'Starbase · ' + padDef.label;
    this.obj('liftoff', 'Lancering');
    this.obj('maxq', 'Max-Q doorstaan');
    this.obj('stage', 'Hot staging');
    this.obj('seco', o.ship === 'orbit' ? 'Baan bereikt (SECO)' : 'SECO — suborbitaal traject');
    if (catching) this.obj('bcatch', 'Super Heavy gevangen door Mechazilla', !o.followBooster ? true : false);
    else this.obj('bsplash', 'Booster: gecontroleerde landing in zee', true);
    if (o.deploy) this.obj('deploy', this.mission.id === 'starlink' ? 'Starlink-satellieten uitzetten' : 'Satelliet uitzetten');
    this.obj('reentry', 'Terugkeer overleven');
    const shipCatch = o.ship === 'orbit' && this.cfg.design.ship.catchPins && (this.cfg.sandbox || this.mission.id !== 'orbital');
    this.returnMode = shipCatch ? 'catch' : 'water';
    if (o.crew) this.returnMode = this.cfg.design.ship.catchPins ? 'catch' : 'water';
    this.obj('sland', this.returnMode === 'catch' ? 'Starship gevangen door de toren' : 'Zachte landing in zee');
    if (o.crew || this.mission.crew) this.obj('crew', 'Bemanning veilig terug');
    this.maxT = o.ship === 'orbit' ? 3 * 3600 : 2 * 3600;
    v.ap = new AscentProgram(v, { apo: o.apo, peri: o.peri, azimuth: 92, boosterReserve: 0.115, onStage: (ship, b) => {
      this.booster = b; this.ship = ship;
      b.ap = new BoostbackProgram(b, btgt);
      if (o.followBooster) { this.focus = b; this.boosterFocus = true; }
    } });
    let secoT = -1, deployed = false;
    this.on((e) => {
      const ev = e.vehicle;
      if (e.kind === 'seco' && ev && ev === this.ship) { this.done('seco', `${(this.metrics.maxAlt / 1000 || 0).toFixed(0)} km`); secoT = w.t; }
      if (e.kind === 'catch' && ev === this.booster) { this.done('bcatch'); this.metrics.boosterCatch = 1; }
      if (e.kind === 'splash' && ev === this.booster) this.done('bsplash');
      if ((e.kind === 'explode' || e.kind === 'rud') && ev && ev === this.booster) { this.fail('bcatch'); this.fail('bsplash'); }
      if (ev && ev === this.ship) {
        if (e.kind === 'catch') { this.done('reentry'); this.done('sland'); this.done('crew'); this.metrics.shipCatch = 1; }
        if (e.kind === 'splash' || e.kind === 'landed') { this.done('reentry'); if (this.returnMode !== 'catch') this.done('sland'); else this.fail('sland', 'in zee'); this.done('crew'); }
        if (e.kind === 'explode' || e.kind === 'rud') { this.fail('seco'); this.fail('deploy'); this.fail('reentry'); this.fail('sland'); this.fail('crew'); }
      }
      if ((e.kind === 'explode' || e.kind === 'rud') && ev === this.main && !this.ship) { this.fail('stage'); this.fail('seco'); }
    });
    let returned = false, bDoneT = -1;
    this.tick(() => {
      const s = this.ship;
      // max-Q
      if (this.is('maxq') === 'open' && this.main.state === 'flying' && this.main.tel.alt > 16000 && this.main.tel.q < (this.metrics.maxQ || 0) * 0.8) this.done('maxq', `${((this.metrics.maxQ || 0) / 1000).toFixed(0)} kPa`);
      if (this.main.state === 'destroyed' && this.is('maxq') === 'open') this.fail('maxq');
      // booster klaar → focus terug naar schip
      if (this.booster && this.terminal(this.booster)) {
        if (bDoneT < 0) bDoneT = w.t;
        if (this.focus === this.booster && w.t - bDoneT > 7 && s && s.state !== 'destroyed') { this.focus = s; this.boosterFocus = false; }
      }
      if (!s) { if (this.main.state === 'destroyed') this.end(this.main.failureCause || 'RUD'); return; }
      if (o.deploy && secoT > 0 && !deployed && w.t - secoT > 25 && s.state === 'flying') {
        deployed = true;
        const st = s.active; const pl = (st.spec as any).payload || 0;
        (st.spec as any).payloadOut = true;
        if (pl) { st.spec = { ...st.spec, payload: 0 }; }
        w.emit(this.mission.id === 'starlink' ? 'Pez-deur open — Starlink-satellieten losgelaten!' : 'Satelliet losgekoppeld en vrijgegeven', 'deploy', s);
        this.done('deploy');
        this.metrics.deployed = 1;
      }
      // terugkeer: na de baan + booster klaar → sprong naar de terugkeer (deorbit boven de Stille Oceaan)
      if (o.ship === 'orbit' && secoT > 0 && !returned && s.state === 'flying' && (!o.deploy || deployed) && w.t - secoT > (o.deploy ? 40 : 25) && (!this.booster || this.terminal(this.booster) && w.t - bDoneT > 6)) {
        returned = true;
        this.scheduleReturn(s);
      }
      if (o.ship === 'suborbital' && secoT > 0 && !returned && s.state === 'flying' && (!this.booster || this.terminal(this.booster) && w.t - bDoneT > 6)) {
        returned = true;
        // IFT: kustvlucht halverwege de aarde rond → snel vooruit naar de terugkeer in de Indische Oceaan
        this.scheduleReturn(s, true);
      }
      if (s.state === 'destroyed' && (!this.booster || this.terminal(this.booster))) this.end(s.failureCause || 'Starship verloren');
      if (this.terminal(s) && s.state !== 'destroyed' && (!this.booster || this.terminal(this.booster))) this.end('Missie voltooid');
    });
  }

  // Overgang naar de terugkeer (tijdsprong met beeldovergang)
  scheduleReturn(s: Vehicle, ocean = false) {
    const w = this.world;
    const run = () => {
      // deorbitbrand: Δv ~ 110 m/s van de tank afhalen
      const st = s.active; const isp = 375;
      const dm = s.mass * (1 - Math.exp(-110 / (isp * G0)));
      st.prop = Math.max(st.prop * 0.5, st.prop - dm);
      s.w.set(0, 0, 0);
      if (ocean) {
        const tg = SHIP_WATER;
        placeEntry(w, s, 'gulf', tg.x, tg.z, ENTRY_D);
        s.ap = new ShipReturnProgram(s, tg);
      } else if (this.returnMode === 'catch') {
        const t = tgtPad('gulf', 'olm2', 12, { catchTower: true });
        placeEntry(w, s, 'gulf', t.x, t.z, ENTRY_D);
        s.ap = new ShipReturnProgram(s, t);
      } else {
        placeEntry(w, s, 'gulf', SHIP_WATER.x, SHIP_WATER.z, ENTRY_D);
        s.ap = new ShipReturnProgram(s, SHIP_WATER);
      }
      s.flapsOn = true;
      this.focus = s;
      w.emit(ocean ? 'Terugkeer: Starship duikt de atmosfeer in' : 'Deorbitbrand voltooid — terugkeer naar Starbase', 'reentry', s);
    };
    const tr: Transition = { text: ocean ? 'Kustvlucht door de ruimte' : 'Rondje om de aarde', sub: ocean ? '≈ 45 minuten later — terugkeer begint' : 'Deorbitbrand boven de Stille Oceaan — terugkeer begint', dur: 2.6, run };
    if (this.cfg.headless) run(); else this.transition = tr;
  }

  // ----- Booster-vangst van dichtbij -----
  setupBoosterFinal() {
    const w = this.world;
    const p = pad('gulf', 'olm');
    const b = w.spawnOnPad(this.boosterOnly(), 'booster', 'gulf', 'olm', 0, [0.0365]);
    this.setRel(b);
    w.anchors.delete(b); b.state = 'flying';
    // toestand overgenomen uit een volledige IFT-vlucht op 9 km hoogte
    const f = w.frames.gulf;
    w.toWorld('gulf', new THREE.Vector3(p.x + 2022, 8967, p.z + 63), b.pos);
    w.surfaceVel('earth', b.pos, b.vel);
    b.vel.add(new THREE.Vector3(-238, -880, -10).applyQuaternion(f.quat));
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.2428, 0.9700, 0.0073).normalize()).premultiply(f.quat);
    b.q.copy(q); b.holdQuat.copy(q); b.finsOut = true;
    b.ap = new BoostbackProgram(b, tgtPad('gulf', 'olm', 12, { catchTower: true }));
    (b.ap as any).bbDone = true;
    this.main = this.focus = this.booster = b;
    this.title = 'Vangst van dichtbij'; this.subtitle = 'Super Heavy keert terug naar Starbase';
    this.obj('burn', 'Landingsbrand'); this.obj('bcatch', 'Gevangen door de chopsticks'); this.obj('acc', 'Precisie < 1,5 m', true);
    this.maxT = 200;
    this.on((e) => {
      if (e.vehicle !== b) return;
      if (e.kind === 'flip' || (e.text || '').includes('andingsbrand')) this.done('burn');
      if (e.kind === 'catch') { this.done('burn'); this.done('bcatch'); const dx = e.data?.dx ?? 9; this.metrics.accuracy = dx; if (dx < 1.5) this.done('acc', `${dx.toFixed(2)} m`); else this.fail('acc', `${dx.toFixed(2)} m`); this.end('Gevangen!'); }
      if (e.kind === 'explode' || e.kind === 'rud' || e.kind === 'splash') this.end(b.failureCause || 'Gemist');
    });
    this.tick(() => { if (b.enginesRunning() > 0 && b.tel.alt < 3000) this.done('burn'); if (this.terminal(b)) this.end(b.state === 'caught' ? 'Gevangen!' : 'Booster verloren'); });
  }

  // ----- Starship terugkeer & vangst -----
  setupShipEntry(mode: 'catch' | 'water') {
    const w = this.world;
    const s = spawnFree(w, this.shipOnly(), 'ship', [0.06]);
    this.setRel(s);
    const t = mode === 'catch' ? tgtPad('gulf', 'olm', 12, { catchTower: true }) : SHIP_WATER;
    placeEntry(w, s, 'gulf', t.x, t.z, ENTRY_D);
    s.ap = new ShipReturnProgram(s, t);
    this.main = this.focus = this.ship = s;
    this.title = this.mission.title; this.subtitle = 'Terugkeer boven de Golf van Mexico';
    this.obj('plasma', 'Piekverhitting doorstaan'); this.obj('flop', 'Belly flop (subsonisch)'); this.obj('flip', 'Flip-and-burn');
    this.obj('sland', mode === 'catch' ? 'Gevangen door Mechazilla' : 'Zachte landing in zee');
    this.obj('tiles', 'Hitteschild > 90% intact', true);
    this.maxT = 1800;
    let peak = 0;
    this.tick(() => {
      if (s.tel.heatFlux > peak) peak = s.tel.heatFlux;
      if (peak > 0 && s.tel.heatFlux < peak * 0.3 && s.tel.alt < 50000 && s.state === 'flying') this.done('plasma');
      if (s.tel.mach < 1 && s.tel.alt < 15000 && s.state === 'flying') { this.done('plasma'); this.done('flop'); }
      if (this.terminal(s)) { if (s.active.tileHealth > 0.9 && s.state !== 'destroyed') this.done('tiles'); this.end(s.state === 'destroyed' ? s.failureCause || 'Starship verloren' : 'Missie voltooid'); }
    });
    this.on((e) => {
      if (e.vehicle !== s) return;
      if (e.kind === 'flip') this.done('flip');
      if (e.kind === 'catch') { this.done('sland'); this.metrics.accuracy = e.data?.dx ?? 0; this.metrics.shipCatch = 1; }
      if (e.kind === 'splash') { if (mode === 'water') this.done('sland'); else this.fail('sland', 'in zee'); }
    });
  }

  // ----- Brandstofoverdracht -----
  setupDocking() {
    const w = this.world;
    const tgt = spawnFree(w, this.shipOnly(), 'ship', [0.2]);
    tgt.name = 'Depot';
    placeOrbit(w, tgt, 250000, 'earth', 20, -60, 90, 0);
    const tk = spawnFree(w, this.shipOnly(), 'tanker', [0.9]);
    tk.name = 'Tanker';
    placeOrbit(w, tk, 250000, 'earth', 20, -60, 90, -0.004);
    tk.pos.addScaledVector(tk.pos.clone().normalize(), 40);
    this.setRel(tk); this.setRel(tgt);
    const ap = new DockingProgram(tk, tgt, 400000); tk.ap = ap;
    tgt.ap = new HoldProgram(tgt, 'prograde');
    this.main = this.focus = tk; this.other = tgt;
    this.title = this.mission.title; this.subtitle = 'Lage baan om de aarde · 250 km';
    this.obj('approach', 'Nadering tot 50 m'); this.obj('dock', 'Koppelen'); this.obj('xfer', '400 t brandstof overpompen'); this.obj('gentle', 'Zacht gekoppeld (< 0,2 m/s)', true);
    this.maxT = 5000;
    this.tick(() => {
      const d = tk.pos.distanceTo(tgt.pos);
      this.metrics.dist = d;
      if (d < 50 + tk.length) this.done('approach');
      if (ap.docked) { this.done('approach'); this.done('dock'); }
      this.metrics.transferred = ap.transferred;
      if (ap.done && ap.docked) { this.done('xfer', `${(ap.transferred / 1000).toFixed(0)} t`); this.end('Overdracht voltooid'); }
      if (tk.state === 'destroyed' || tgt.state === 'destroyed') this.end('Botsing in de ruimte');
    });
    this.on((e) => { if (e.vehicle === tk && e.text.startsWith('KOPPELING')) { const rv = tk.vel.distanceTo(tgt.vel); this.metrics.dockSpeed = rv; if (rv < 0.2) this.done('gentle', rv.toFixed(2) + ' m/s'); else this.fail('gentle', rv.toFixed(2) + ' m/s'); } });
  }

  // ----- Maanlanding (+ bemanning, + terug naar baan) -----
  setupLunarLanding(crew: boolean) {
    const w = this.world;
    const s = spawnFree(w, this.shipOnly(), 'lander', [crew ? 0.42 : 0.35]);
    this.setRel(s);
    const p = REGIONS.lunar.pads[0];
    placeOrbit(w, s, 15000, 'moon', REGIONS.lunar.lat, REGIONS.lunar.lon, 180, -5.5);
    s.ap = new LunarDescentProgram(s, { region: 'lunar', pad: p, x: p.x, z: p.z, y: p.top });
    this.main = this.focus = this.ship = s;
    this.title = this.mission.title; this.subtitle = 'Zuidpool van de Maan · Shackleton-rand';
    this.obj('pdi', 'Remfase (PDI)'); this.obj('terminal', 'Eindnadering'); this.obj('land', 'Landen bij HLS-landingsplaats 1'); this.obj('acc', 'Precisie < 10 m', true);
    if (crew) { this.obj('eva', 'Eerste stap op de Maan'); this.obj('ascent', 'Terug naar de maanbaan'); }
    this.maxT = crew ? 6000 : 1600;
    let landedT = -1, ascending = false;
    this.done('pdi');
    this.tick(() => {
      const ap = s.ap as any;
      if (ap && ap.stage === 'terminal') this.done('terminal');
      if (s.state === 'landed' && landedT < 0) {
        landedT = w.t;
        const l = w.toLocal('lunar', s.pos); const dx = Math.hypot(l.x - p.x, l.z - p.z);
        this.done('terminal'); this.done('land', `${dx.toFixed(1)} m`); this.metrics.accuracy = dx;
        if (dx < 10) this.done('acc', `${dx.toFixed(1)} m`); else this.fail('acc', `${dx.toFixed(0)} m`);
        if (!crew) this.end('Geland op de Maan');
      }
      if (crew && landedT > 0 && w.t - landedT > 12 && this.is('eva') === 'open') { this.done('eva'); w.emit('"Een kleine stap…" — de bemanning staat op de Maan!', 'eva', s); }
      if (crew && landedT > 0 && w.t - landedT > 30 && !ascending) { ascending = true; s.ap = new LunarAscentProgram(s, 80000, 0); w.emit('Ontsteking — opstijgen vanaf de Maan', 'liftoff', s); }
      if (crew && ascending && (s.ap as any)?.done && s.state === 'flying') { const el = elements(s.pos.clone().sub(w.ephem.moonPos(w.t)), s.vel.clone().sub(w.ephem.moonVel(w.t)), 4.9048695e12, 1737400); if (el.peri > 10000) { this.done('ascent'); this.end('Terug in maanbaan'); } else { this.fail('ascent'); this.end('Baan niet bereikt'); } }
      if (s.state === 'destroyed') this.end(s.failureCause || 'Neergestort');
    });
  }

  // ----- Trans-maaninjectie -----
  setupTLI() {
    const w = this.world;
    const s = spawnFree(w, this.shipOnly(), 'lander', [1]);
    this.setRel(s);
    // parkeerbaan in het baanvlak van de Maan (anders is de Maan niet bereikbaar met een prograde brand)
    {
      const mp = w.ephem.moonPos(w.t), mv = w.ephem.moonVel(w.t);
      const n = new THREE.Vector3().crossVectors(mp, mv).normalize();
      const dir0 = mp.clone().normalize().applyAxisAngle(n, -2.4);
      const r = R_E + 300000;
      s.pos.copy(dir0).multiplyScalar(r);
      s.vel.crossVectors(n, dir0).normalize().multiplyScalar(Math.sqrt(MU_E / r));
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), s.vel.clone().normalize());
      s.q.copy(q); s.holdQuat.copy(q);
    }
    const node = planTLI(w, s)!;
    s.ap = new SequenceProgram(s, [() => new TliBurnProgram(s, node as any), () => new BurnProgram(s, planMidCourse(w, s), 'Koerscorrectie', 'vac'), () => new LunarCaptureProgram(s)]);
    this.main = this.focus = this.ship = s;
    this.title = 'Trans-maaninjectie'; this.subtitle = 'Van een volgetankte baan naar de Maan';
    this.obj('tli', 'TLI-brand'); this.obj('mcc', 'Koerscorrectie'); this.obj('soi', 'Invloedssfeer van de Maan'); this.obj('loi', 'Maanbaaninbrenging (LOI)');
    this.maxT = 7 * 86400;
    this.on((e) => {
      if (e.vehicle !== s) return;
      if (e.text.startsWith('TLI voltooid')) this.done('tli');
      if (e.text.startsWith('Koerscorrectie voltooid')) this.done('mcc');
      if (e.text.startsWith('LOI gepland')) this.done('soi');
      if (e.text.startsWith('In maanbaan')) { this.done('loi'); this.end('In maanbaan'); }
    });
    this.tick(() => { if (s.tel.body === 'moon') this.done('soi'); if (s.state === 'destroyed') this.end('Verloren'); });
  }

  // ----- Vrije baan -----
  setupOrbitFree() {
    const w = this.world;
    const s = spawnFree(w, this.shipOnly(), 'ship', [0.12]);
    this.setRel(s);
    placeOrbit(w, s, 250000, 'earth', 22, -150, 75, 0);
    s.ap = new HoldProgram(s, 'prograde');
    this.main = this.focus = this.ship = s;
    this.title = 'Rondje om de aarde'; this.subtitle = 'Baan van 250 km · vrije besturing';
    this.hint = 'Gebruik de knop TERUGKEER voor een automatische deorbit, of vlieg zelf.';
    this.obj('deorbit', 'Deorbitbrand (perigeum < 60 km)'); this.obj('reentry', 'Terugkeer overleven'); this.obj('sland', 'Zachte landing');
    this.maxT = 4 * 3600;
    this.tick(() => {
      if (s.state === 'flying') { const el = elements(s.pos, s.vel, MU_E, R_E); if (el.peri < 60000) this.done('deorbit'); if (s.tel.alt < 20000 && this.is('deorbit') === 'done') this.done('reentry'); }
      if (this.terminal(s)) this.end(s.state === 'destroyed' ? s.failureCause || 'Verloren' : 'Geland');
    });
    this.on((e) => { if (e.vehicle === s && (e.kind === 'splash' || e.kind === 'landed' || e.kind === 'catch')) { this.done('reentry'); this.done('sland'); } });
  }
  // Maximaal toegestane tijdversnelling (1 = alleen realtime)
  maxWarp(): number {
    const w = this.world;
    let m = 1000;
    for (const v of w.vehicles) {
      if (v.state === 'destroyed') continue;
      if (v.state === 'clamped' || (v.ap && !v.ap.done && v.ap.busy && v.ap.busy())) return 1;
      if (v.state !== 'flying') continue;
      if (v.tel.body === 'earth' && v.tel.alt < 100000) m = Math.min(m, v.tel.alt < 30000 ? 2 : 4);
      if (v.tel.body === 'moon' && v.tel.alt < 30000) m = Math.min(m, 4);
      if (v.cmdThrottle > 0 && v.enginesRunning() > 0) return 1;
    }
    if (this.custom) return 4;
    return m;
  }
  // knop "Terugkeer" in vrije baan
  autoDeorbit() {
    const s = this.ship; if (!s || s.state !== 'flying') return;
    const w = this.world;
    s.ap = new SequenceProgram(s, [() => new BurnProgram(s, { t: w.t + 60, pro: -120, nrm: 0, rad: 0 }, 'Deorbitbrand', 'vac'), () => new ShipReturnProgram(s, null)]);
  }
}

export function missionById(id: string) { return MISSIONS.find((m) => m.id === id)!; }
