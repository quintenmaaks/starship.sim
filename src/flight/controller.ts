// Vluchtcontroller: lus, tijdversnelling, invoer (touch + toetsenbord), HUD, camera-regie, opname.
import * as THREE from 'three';
import { View2D as View, CamMode, CAM_LABELS } from '../r2d/view2d';
import { FlightSetup, Objective } from './setup';
import { Recorder, ReplayData, Player } from './replay';
import { Vehicle } from '../sim/vehicle';
import { SimEvent } from '../sim/world';
import { BoostbackProgram, point, LandTarget } from '../sim/autopilot';
import { REGIONS } from '../sim/terrain';
import { h, clear, gauge, modal, toast } from '../ui/dom';
import { audio } from '../ui/audio';
import { settings, saveSettings } from '../game/state';
import { clamp, tplus, fmt0, fmt1, dist as fdist } from '../core/util';
import { MissionDef } from '../game/missions';

export interface FlightResult {
  mission: MissionDef; success: boolean; partial: boolean; score: number; objectives: Objective[]; metrics: Record<string, number>;
  endReason: string; simTime: number; replay: ReplayData; aborted: boolean; enginesFailed: number; anyRud: boolean;
}
const WARPS = [1, 2, 4, 10, 50, 100, 1000];
const CAPTION: Record<string, [string, string, string]> = {
  liftoff: ['LIFTOFF', '', ''], stage: ['HOT STAGING', 'trapscheiding', ''], seco: ['SECO', 'motoren uit', ''],
  catch: ['GEVANGEN!', '', 'good'], landed: ['GELAND!', '', 'good'], splash: ['ZACHTE LANDING', 'in zee', 'good'],
  rud: ['RUD', 'snelle ongeplande demontage', 'bad'], flip: ['FLIP!', 'motoren herstarten', ''], eva: ['MAANWANDELING', 'een kleine stap…', 'good'],
  deploy: ['UITGEZET', 'lading vrijgegeven', 'good'], reentry: ['TERUGKEER', 'het plasma begint', ''],
};

// ---------- gedeelde HUD (live vlucht en herhaling), SFS-indeling voor staand scherm ----------
export class Hud {
  root: HTMLElement; tl: HTMLElement; tr: HTMLElement; telem: HTMLElement; events: HTMLElement;
  missionT: HTMLElement; missionS: HTMLElement; objs: HTMLElement; clock: HTMLElement; liveLbl: HTMLElement; missionBox: HTMLElement;
  altV: HTMLElement; spdV: HTMLElement; altL: HTMLElement;
  vname: HTMLElement; phase: HTMLElement; status: HTMLElement; timeline: HTMLElement; engines: HTMLElement; prop: HTMLElement;
  fuelFill: HTMLElement; fuelPct: HTMLElement; fuelStages: HTMLElement;
  bigEl: HTMLElement | null = null; bigT = 0;
  engKey = '';
  constructor(parent: HTMLElement, live: boolean) {
    this.root = h('div', 'hud');
    this.missionT = h('div', 'mt'); this.missionS = h('div', 'ms'); this.objs = h('div', 'objs');
    this.missionBox = h('div', 'mission glass', this.missionT, this.missionS, this.objs);
    this.missionBox.addEventListener('click', () => this.missionBox.classList.toggle('open'));
    this.tl = h('div', 'tl');
    this.tr = h('div', 'tr');
    this.clock = h('span', 'clock', 'T+00:00:00');
    this.liveLbl = h('span', 'lbl', live ? 'LIVE' : 'HERHALING');
    this.altV = h('b', null, '0 m'); this.spdV = h('b', null, '0 m/s'); this.altL = h('span', null, 'Hoogte (terrein)');
    this.vname = h('div', 'vname', ''); this.phase = h('div', 'phase', ''); this.status = h('div', 'status', '');
    this.timeline = h('div', 'timeline'); this.engines = h('div', 'engines');
    this.telem = h('div', 'readouts',
      h('div', 'ro', this.altL, this.altV),
      h('div', 'ro', h('span', null, 'Snelheid'), this.spdV),
      h('div', 'ro2', this.phase), h('div', 'ro2', this.status),
      h('div', 'ro2 live', h('i', 'dot'), this.liveLbl, this.clock));
    this.fuelFill = h('i'); this.fuelPct = h('span', 'fp', '100%'); this.fuelStages = h('div', 'fst');
    this.prop = h('div', 'fuel glass', h('div', 'fl', 'Vloeibare brandstof', this.fuelPct), h('div', 'fbar', this.fuelFill), this.fuelStages);
    this.events = h('div', 'events');
    this.root.append(this.tl, this.tr, this.telem, this.missionBox, this.prop, this.events);
    parent.append(this.root);
  }
  setMission(t: string, s: string) { this.missionT.textContent = t; this.missionS.textContent = s; }
  setObjectives(objs: Objective[]) {
    clear(this.objs);
    for (const o of objs) this.objs.append(h('div', 'obj ' + o.state + (o.optional ? ' opt' : ''), h('i', null, o.state === 'done' ? '✓' : o.state === 'fail' ? '✗' : o.optional ? '☆' : '○'), o.label + (o.value ? ` · ${o.value}` : '')));
    const next = objs.find((o) => o.state === 'open' && !o.optional);
    const done = objs.filter((o) => o.state === 'done').length;
    this.missionS.textContent = (next ? '▸ ' + next.label : 'Alle doelen afgerond') + `  (${done}/${objs.length})`;
  }
  telemetry(v: Vehicle, t: number, apPhase: string, apStatus: string) {
    const T = v.tel;
    this.clock.textContent = tplus(t);
    const nl = (x: number, d = 0) => x.toLocaleString('nl-NL', { maximumFractionDigits: d, minimumFractionDigits: d });
    const terr = T.alt < 30000;
    const a = terr ? Math.max(0, Math.min(T.agl, T.alt)) : T.alt;
    this.altL.textContent = terr ? 'Hoogte (terrein)' : 'Hoogte';
    this.altV.textContent = a < 10000 ? nl(a) + ' m' : nl(a / 1000, a < 1e6 ? 1 : 0) + ' km';
    const orb = T.alt > 70000;
    const spd = orb ? v.vel.length() : T.vSurf;
    this.spdV.textContent = nl(spd) + ' m/s';
    this.phase.textContent = apPhase || stateLabel(v) || '';
    this.status.textContent = apStatus || `${T.mach > 0.3 && !orb ? 'Mach ' + fmt1(T.mach) + ' · ' : ''}${fmt1(T.gLoad)} g`;
    // brandstof
    const st = v.active; const f = st.prop / Math.max(1, st.spec.propMax);
    this.fuelFill.style.width = (f * 100).toFixed(1) + '%';
    this.fuelFill.style.background = f < 0.1 ? 'linear-gradient(90deg,#ff5a4a,#ff9b6b)' : '';
    this.fuelPct.textContent = Math.round(f * 100) + '%';
    const key = v.stages.map((s) => s.spec.kind).join();
    if (key !== this.engKey) { this.engKey = key; clear(this.fuelStages); for (const s of v.stages) this.fuelStages.append(h('div', 'fs', h('span', null, s.spec.kind === 'booster' ? 'Super Heavy' : s.spec.name), h('div', 'fbar s', h('i')))); }
    v.stages.forEach((s, i) => { const b = this.fuelStages.children[i]?.querySelector('i') as HTMLElement; if (b) b.style.width = (s.prop / Math.max(1, s.spec.propMax) * 100).toFixed(1) + '%'; });
  }
  event(text: string, kind: string) {
    if (!text) return;
    const e = h('div', 'ev ' + kind, text);
    this.events.append(e);
    while (this.events.children.length > 3) this.events.firstChild!.remove();
    setTimeout(() => { e.style.opacity = '0'; setTimeout(() => e.remove(), 1000); }, 5000);
  }
  big(title: string, sub = '', cls = '') {
    this.bigEl?.remove();
    this.bigEl = h('div', 'big ' + cls, title, sub ? h('small', null, sub) : null);
    this.root.append(this.bigEl);
    const el = this.bigEl;
    setTimeout(() => { el.style.transition = 'opacity .8s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 800); }, 2200);
  }
  destroy() { this.root.remove(); }
}
function stateLabel(v: Vehicle) {
  return ({ clamped: 'Op het platform', flying: 'Vlucht', landed: 'Geland', caught: 'Gevangen', splashed: 'In zee', destroyed: 'Verloren' } as any)[v.state];
}

// ---------- invoer (gedeeld) ----------
function bindCameraGestures(view: View, el: HTMLElement) {
  const pts = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  el.addEventListener('pointerdown', (e) => { if (e.target !== el) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); el.setPointerCapture(e.pointerId); audio.unlock(); });
  el.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId); if (!p) return;
    if (pts.size === 1) view.orbitInput(e.clientX - p.x, e.clientY - p.y);
    p.x = e.clientX; p.y = e.clientY;
    if (pts.size === 2) {
      const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) view.zoomInput(pinch / d); pinch = d;
    }
  });
  const up = (e: PointerEvent) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', (e) => { view.zoomInput(e.deltaY > 0 ? 1.1 : 0.9); e.preventDefault(); }, { passive: false });
}

// ---------- live vlucht ----------
export class FlightController {
  root: HTMLElement; hud: Hud; rec: Recorder;
  manual = false; savedAp: any = null; warpSel = 1; skip = false; paused = false; done = false; endWait = -1;
  throttle = 0; joy = { x: 0, y: 0 }; keys = new Set<string>(); rotHold = 0; engOn = true; wasRot = false;
  camLockT = 0; lastFocus: Vehicle | null = null; sasMode: 'hold' | 'pro' | 'retro' | 'up' = 'hold'; engMode = 0;
  raf = 0; last = 0; objKey = '';
  transitionEl: HTMLElement | null = null; transT = 0;
  aborted = false; anyRud = false; enginesFailed = 0;
  ui: Record<string, HTMLElement> = {};
  fpsEl: HTMLElement | null = null; mapInfo: HTMLElement | null = null;
  pressureEl: HTMLElement | null = null;
  constructor(public view: View, public setup: FlightSetup, public onEnd: (r: FlightResult) => void, public onRestart: () => void) {
    const ui = document.getElementById('ui')!;
    this.root = h('div', 'screen'); this.root.style.padding = '0';
    ui.append(this.root);
    bindCameraGestures(view, this.root);
    this.hud = new Hud(this.root, true);
    this.hud.setMission(setup.title, setup.subtitle);
    this.rec = new Recorder(setup.world, setup.title);
    view.setWorld(setup.world);
    view.focus = setup.focus;
    view.cineSpin = 0; view.zoom = 1; view.cyF = 0.5;
    view.setCam(setup.focus.state === 'clamped' ? 'tower' : 'chase');
    
    if (setup.mission.id === 'lunar' || setup.mission.id === 'crewlunar' || setup.mission.id === 'sc_artemis') view.setCam('chase');
    setup.world.on((e) => this.onEvent(e));
    this.buildControls();
    (window as any).__fc = this;
    if (setup.custom === 'pressure') this.buildPressure();
    if (setup.hint) setTimeout(() => toast(setup.hint, '', 5200), 600);
    this.keyDown = this.keyDown.bind(this); this.keyUp = this.keyUp.bind(this);
    window.addEventListener('keydown', this.keyDown); window.addEventListener('keyup', this.keyUp);
    if (settings.fps) { this.fpsEl = h('div', 'fps', ''); ui.append(this.fpsEl); }
    audio.setMusic(false);
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }
  get v() { return this.setup.focus; }

  buildControls() {
    const r = this.root;
    const sb = (txt: string, f: () => void, key?: string, cls = '') => { const b = h('button', { class: 'sbtn ' + cls, onClick: f }, txt); if (key) this.ui[key] = b; return b; };
    // linksboven: menu, kaart, auto, camera
    this.hud.tl.append(
      sb('☰', () => this.pauseMenu(), 'menu'),
      sb('Kaart', () => { this.view.setCam(this.view.camMode === 'map' ? 'chase' : 'map'); this.camLockT = 30; this.ui.map.classList.toggle('on', this.view.camMode === 'map'); }, 'map'),
      sb('AUTO', () => this.toggleManual(), 'auto', 'on'));
    // rechtsboven: tijdversnelling << x >>
    const wl = h('span', 'wl', '×1');
    const warpBox = h('div', 'warp2', sb('«', () => { this.skip = false; const i = WARPS.indexOf(this.warpSel); this.warpSel = WARPS[Math.max(0, i - 1)]; }), wl, sb('»', () => { this.skip = false; const i = WARPS.indexOf(this.warpSel); this.warpSel = WARPS[Math.min(WARPS.length - 1, i + 1)]; }));
    const skipBtn = sb('⏩', () => { this.skip = !this.skip; skipBtn.classList.toggle('on', this.skip); if (!this.skip) this.warpSel = 1; }, 'skip');
    this.ui.warp = warpBox; this.ui.wl = wl;
    this.hud.tr.append(warpBox, skipBtn);
    // rechts: verticale gashendel + Aan
    const fill = h('div', 'fill'), knob = h('div', 'knob'), pct = h('div', 'pct', '0%');
    const track = h('div', 'track', fill, knob);
    const onBtn = sb('Aan', () => { this.engOn = !this.engOn; onBtn.classList.toggle('on', this.engOn); onBtn.textContent = this.engOn ? 'Aan' : 'Uit'; this.takeOver(); }, 'on', 'on');
    const thr = h('div', 'thr2', pct, track, onBtn);
    this.ui.thr = thr; this.ui.pct = pct; this.ui.fill = fill; this.ui.knob = knob;
    const setThr = (e: PointerEvent) => { const rc = track.getBoundingClientRect(); this.throttle = clamp(1 - (e.clientY - rc.top) / rc.height, 0, 1); if (this.throttle < 0.04) this.throttle = 0; this.takeOver(); };
    track.addEventListener('pointerdown', (e) => { track.setPointerCapture(e.pointerId); setThr(e); audio.unlock(); });
    track.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') setThr(e); });
    r.append(thr);
    // midden onder: zes pijlknoppen
    const hold = (txt: string, dir: number, title: string) => {
      const b = h('button', { class: 'abtn', title }, txt);
      b.addEventListener('pointerdown', (e) => { b.setPointerCapture(e.pointerId); this.rotHold = dir; this.sasMode = 'hold'; this.takeOver(); audio.unlock(); });
      const up = () => { if (this.rotHold === dir) this.rotHold = 0; };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
      return b;
    };
    const sas = (txt: string, m: 'hold' | 'pro' | 'retro' | 'up', title: string) => h('button', { class: 'abtn', title, onClick: () => { this.takeOver(); this.sasMode = m; this.v.holdQuat.copy(this.v.q); const n: Record<string, string> = { hold: 'Houding vasthouden', pro: 'Prograde', retro: 'Retrograde', up: 'Recht omhoog' }; toast(n[m], '', 900); } }, txt);
    const arrows = h('div', 'arrows', hold('⟲', -1, 'Linksom'), sas('⇡', 'up', 'Recht omhoog'), hold('⟳', 1, 'Rechtsom'), sas('↗', 'pro', 'Prograde'), sas('◼', 'hold', 'Vasthouden'), sas('↙', 'retro', 'Retrograde'));
    this.ui.joy = arrows;
    r.append(arrows);
    // rechtsonder: trapknop + extra's
    const cb = (icon: string, label: string, f: () => void, key?: string) => { const b = h('button', { class: 'cbtn', onClick: f }, h('span', 'i', icon), label); if (key) this.ui[key] = b; return b; };
    const extra = h('div', 'extras',
      cb('🎥', 'Camera', () => this.cycleCam(), 'cam'),
      cb('🪽', 'Flaps', () => { this.v.flapsOn = !this.v.flapsOn; this.v.finsOut = this.v.flapsOn || this.v.finsOut; this.ui.flaps.classList.toggle('on', this.v.flapsOn); }, 'flaps'),
      cb('🦵', 'Poten', () => { this.v.legsDown = !this.v.legsDown; this.ui.legs.classList.toggle('on', this.v.legsDown); }, 'legs'),
      cb('🔥', 'Motor', () => this.cycleEngines(), 'eng'),
      cb('🎯', 'Volg', () => this.cycleFocus(), 'focusb'),
      cb('↩️', 'Terug', () => this.setup.autoDeorbit(), 'deorbit'));
    const stage = h('button', { class: 'stagebtn', onClick: () => { this.takeOver(); this.doStage(); } }, h('span', 'i', '⇵'), 'Trap');
    this.ui.stage = stage; this.ui.sas = h('i');
    const grid = h('div', 'ctrl-r', extra, stage);
    this.ui.grid = grid;
    r.append(grid);
    this.updateControlVisibility();
  }
  takeOver() { if (!this.manual && !this.setup.custom) this.toggleManual(); }
  buildPressure() {
    const s = this.setup; const P = s.pressure;
    const val = h('div', 'pgauge', '0,00', h('small', null, ' bar'));
    const setv = h('div', 'mono dim', 'Doel: 0,0 bar');
    const holdEl = h('div', 'mono', '');
    const bar = h('div', 'bar', h('i'));
    const slider = h('input', { type: 'range', min: '0', max: '11', step: '0.1', value: '0' }) as HTMLInputElement;
    slider.addEventListener('input', () => { P.set = +slider.value; });
    const bump = (d: number) => { P.set = clamp(P.set + d, 0, 11); slider.value = String(P.set); };
    const warn = h('div', 'warn', '');
    const box = h('div', 'pressure glass',
      h('div', 'lbl', P.cryo ? 'CRYOGENE PROEF · LN2' : 'TANKDRUKTEST'),
      val, bar, setv, slider,
      h('div', 'row', h('button', { class: 'btn small', onClick: () => bump(-0.5) }, '−0,5'), h('button', { class: 'btn small', onClick: () => bump(0.1) }, '+0,1'), h('button', { class: 'btn small', onClick: () => bump(0.5) }, '+0,5')),
      holdEl, warn,
      h('button', { class: 'btn danger', onClick: () => s.stopPressureTest() }, 'Druk aflaten & stoppen'));
    this.root.append(box);
    this.pressureEl = box;
    (this as any)._p = { val, setv, holdEl, bar, warn };
    this.ui.thr.classList.add('hidden'); this.ui.joy.classList.add('hidden'); this.ui.auto.classList.add('hidden'); this.ui.grid.classList.add('hidden');
  }
  updatePressure() {
    const s = this.setup, P = s.pressure, e = (this as any)._p; if (!e) return;
    e.val.firstChild.textContent = fmt1(P.p).replace('.', ',') + (P.p < 10 ? '0' : '').slice(0, 0);
    e.val.firstChild.textContent = P.p.toFixed(2).replace('.', ',');
    e.setv.textContent = `Doel: ${P.set.toFixed(1).replace('.', ',')} bar · max bewezen ${P.maxHeld.toFixed(2).replace('.', ',')}`;
    e.bar.querySelector('i').style.width = (P.p / 11 * 100) + '%';
    e.holdEl.textContent = P.cryo ? `Bevriezing ${(P.frost * 100).toFixed(0)}% · stabiel ${P.hold.toFixed(0)}/60 s` : P.p >= 6 ? `Vasthouden ${Math.min(5, P.hold).toFixed(1)} / 5 s` : '';
    const danger = P.p > P.burst * 0.88;
    e.warn.textContent = danger ? '⚠ Krakende geluiden uit de tank…' : P.p > P.burst * 0.8 ? 'Rek in de lasnaden gemeten' : '';
    if (danger && Math.random() < 0.02) { audio.warn(); this.view.shake = Math.max(this.view.shake, 0.15); }
  }
  updateControlVisibility() {
    const m = this.manual;
    this.ui.thr.classList.toggle('hidden', !!this.setup.custom);
    this.ui.joy.classList.toggle('hidden', !!this.setup.custom);
    this.ui.thr.classList.toggle('dim', !m); this.ui.joy.classList.toggle('dim', !m);
    this.ui.auto.classList.toggle('on', !m);
    this.ui.auto.textContent = m ? 'HAND' : 'AUTO';
    this.ui.deorbit.classList.toggle('hidden', this.setup.mission.id !== 'sc_orbit');
    this.ui.focusb.classList.toggle('hidden', this.setup.world.vehicles.filter((x) => x.state !== 'destroyed').length < 2);
    this.ui.legs.classList.toggle('hidden', !this.v.stages.some((s) => s.spec.legs));
    this.ui.flaps.classList.toggle('hidden', !this.v.stages.some((s) => s.spec.flaps || s.spec.gridFins));
  }
  toggleManual() {
    const v = this.v;
    this.manual = !this.manual;
    if (this.manual) {
      this.savedAp = v.ap; v.ap = null; v.sas = 'hold'; v.holdQuat.copy(v.q); this.throttle = v.cmdThrottle; this.sasMode = 'hold';
      toast('Handbesturing — pijlen = draaien, schuif = gas', '', 2000);
    } else {
      if (this.savedAp && !this.savedAp.done && this.savedAp.v === v) v.ap = this.savedAp;
      v.input.set(0, 0, 0);
      toast(v.ap ? 'Autopiloot hervat' : 'Geen actief autopilootprogramma', '', 2000);
    }
    this.updateControlVisibility();
  }
  cycleCam() {
    const order: CamMode[] = ['chase', 'tower', 'onboard', 'drone'];
    const i = order.indexOf(this.view.camMode);
    const next = order[(i + 1) % order.length];
    this.view.setCam(next); this.camLockT = 25;
    toast(CAM_LABELS[next], '', 1100);
  }
  cycleFocus() {
    const vs = this.setup.world.vehicles.filter((x) => x.state !== 'destroyed');
    if (vs.length < 2) return;
    const i = vs.indexOf(this.setup.focus);
    this.setup.focus = vs[(i + 1) % vs.length];
    this.setup.focusLock = true;
    toast('Volg: ' + this.setup.focus.name, '', 1200);
  }
  doStage() {
    const v = this.v; const w = this.setup.world;
    if (v.stages.length < 2) { toast('Geen trap om af te werpen', 'bad'); return; }
    const b = w.stage(v);
    if (b) {
      this.setup.booster = b; this.setup.ship = v;
      const p = REGIONS.gulf.pads.find((x) => x.id === 'olm')!;
      const tgt: LandTarget = b.active.spec.catchPins ? { region: 'gulf', pad: p, x: p.x, z: p.z, y: p.top + 12, catchTower: true } : { region: 'gulf', pad: null, x: 29000, z: 2600, y: 0, water: true };
      b.ap = new BoostbackProgram(b, tgt);
    }
  }
  cycleEngines() {
    const v = this.v;
    const modes: ('all' | 'inner' | 'center' | 'sl' | 'vac')[] = v.active.spec.kind === 'booster' ? ['all', 'inner', 'center'] : ['sl', 'vac', 'all'];
    this.engMode = (this.engMode + 1) % modes.length;
    v.selectEngines(modes[this.engMode]);
    const names: Record<string, string> = { all: 'Alle motoren', inner: 'Binnenring', center: 'Middelste 3', sl: 'Zeeniveau-Raptors', vac: 'Vacuüm-Raptors (RVac)' };
    toast(names[modes[this.engMode]], '', 1200);
  }
  cycleSas() {
    const order: ('hold' | 'pro' | 'retro' | 'up')[] = ['hold', 'pro', 'retro', 'up'];
    this.sasMode = order[(order.indexOf(this.sasMode) + 1) % order.length];
    const n: Record<string, string> = { hold: 'SAS: houding vasthouden', pro: 'SAS: prograde', retro: 'SAS: retrograde', up: 'SAS: verticaal omhoog' };
    toast(n[this.sasMode], '', 1200);
    this.v.holdQuat.copy(this.v.q);
  }
  keyDown(e: KeyboardEvent) {
    this.keys.add(e.key.toLowerCase());
    const k = e.key.toLowerCase();
    if (k === ' ') { if (this.manual) this.doStage(); e.preventDefault(); }
    if (k === 'c') this.cycleCam();
    if (k === 'm') { this.view.setCam(this.view.camMode === 'map' ? 'chase' : 'map'); }
    if (k === 't') this.toggleManual();
    if (k === 'f') this.v.flapsOn = !this.v.flapsOn;
    if (k === 'g') this.v.legsDown = !this.v.legsDown;
    if (k === 'v') this.cycleFocus();
    if (k === 'z') this.throttle = 1;
    if (k === 'x') this.throttle = 0;
    if (k === '.') { const i = WARPS.indexOf(this.warpSel); this.warpSel = WARPS[Math.min(WARPS.length - 1, i + 1)]; }
    if (k === ',') { const i = WARPS.indexOf(this.warpSel); this.warpSel = WARPS[Math.max(0, i - 1)]; }
    if (k === 'escape') this.pauseMenu();
  }
  keyUp(e: KeyboardEvent) { this.keys.delete(e.key.toLowerCase()); }

  onEvent(e: SimEvent) {
    const s = this.setup;
    const mine = !e.vehicle || e.vehicle === s.focus || e.kind === 'objective' || e.kind === 'objfail';
    if (e.text) this.hud.event(e.text, e.kind);
    const cap = CAPTION[e.kind];
    if (cap && (mine || e.kind === 'catch')) this.hud.big(cap[0], e.kind === 'rud' && e.vehicle ? (e.vehicle.failureCause || cap[1]) : cap[1], cap[2]);
    if (e.kind === 'objective') { audio.objective(); audio.haptic(20); }
    if (e.kind === 'objfail') audio.fail();
    if (e.kind === 'explode' || e.kind === 'rud') {
      if (e.kind === 'rud') this.anyRud = true;
      const d = e.vehicle ? this.view.camECI.distanceTo(e.vehicle.pos) : 1000;
      audio.explosion(clamp(3000 / (d + 300), 0.15, 1)); audio.haptic(80);
    }
    if (e.kind === 'boom') audio.boom();
    if (e.kind === 'catch') { audio.clank(); audio.haptic(60); }
    if (e.kind === 'stage') { audio.stage(); audio.haptic(40); }
    if (e.kind === 'fail' && e.text.includes('motor')) this.enginesFailed++;
    if (e.kind === 'fail' || e.kind === 'warn') audio.warn();
    if (e.kind === 'liftoff' && settings.autoCam && this.camLockT <= 0) setTimeout(() => { if (this.camLockT <= 0 && this.view.camMode === 'tower') this.view.setCam('chase'); }, 9000);
    if (e.kind === 'reentry') this.view.setCam('chase');
    this.updateControlVisibility();
  }

  autoCamera(dt: number) {
    this.camLockT -= dt;
    const v = this.v; const view = this.view;
    if (this.lastFocus !== v) { this.lastFocus = v; if (view.camMode === 'onboard' || view.camMode === 'drone') view.setCam('chase'); }
    if (!settings.autoCam || this.camLockT > 0 || view.camMode === 'map') return;
    const near = view.nearestRegion(v.pos);
    if (v.state === 'flying' && v.tel.vVert < -5 && v.tel.alt < 2500 && near && near.d < 40000 && v.tel.body === 'earth' && view.camMode === 'chase') { view.setCam('tower'); }
    if (view.camMode === 'tower' && v.state === 'flying' && v.tel.alt > 4000) view.setCam('chase');
  }

  manualControl(dt: number) {
    const v = this.v;
    const tpos = this.throttle;
    (this.ui.fill as HTMLElement).style.height = (tpos * 100) + '%';
    (this.ui.knob as HTMLElement).style.bottom = `calc(${tpos * 100}% - 9px)`;
    this.ui.pct.textContent = Math.round((this.manual ? tpos : v.cmdThrottle) * 100) + '%';
    if (!this.manual) { this.throttle = v.cmdThrottle; return; }
    const k = this.keys;
    let rot = this.rotHold;
    if (k.has('a') || k.has('arrowleft')) rot = -1; if (k.has('d') || k.has('arrowright')) rot = 1;
    if (k.has('shift') || k.has('w')) this.throttle = clamp(this.throttle + dt * 0.6, 0, 1);
    if (k.has('control') || k.has('s')) this.throttle = clamp(this.throttle - dt * 0.6, 0, 1);
    v.input.set(0, 0, 0);
    v.cmdThrottle = this.engOn ? this.throttle : 0;
    if (v.state === 'clamped' && v.cmdThrottle > 0.5) (v as any).releaseArmed = true;
    if (rot !== 0) {
      const q = new THREE.Quaternion().setFromAxisAngle(this.view.nrm, -rot * 0.3 * (settings.joySens || 1));
      v.targetQuat.copy(q).multiply(v.q); v.sas = 'target'; this.wasRot = true;
    } else if (this.sasMode !== 'hold') {
      const c = v.tel.body === 'moon' ? this.setup.world.ephem.moonPos(this.setup.world.t) : new THREE.Vector3();
      const up = v.pos.clone().sub(c).normalize();
      const vel = v.tel.alt < 80000 ? v.vRel.clone() : v.vel.clone().sub(v.tel.body === 'moon' ? this.setup.world.ephem.moonVel(this.setup.world.t) : new THREE.Vector3());
      const dir = this.sasMode === 'up' ? up : vel.normalize().multiplyScalar(this.sasMode === 'pro' ? 1 : -1);
      point(v, dir, v.belly());
    } else {
      if (this.wasRot) { v.holdQuat.copy(v.q); this.wasRot = false; }
      v.sas = 'hold';
    }
  }

  loop(now: number) {
    if (this.done) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    const s = this.setup, w = s.world;
    if (this.view.camMode === 'map' && this.view.mapLines.info) {
      const inf = this.view.mapLines.info; const km = (x: number) => isFinite(x) ? (x / 1000).toLocaleString('nl-NL', { maximumFractionDigits: 0 }) + ' km' : '∞';
      if (!this.mapInfo) { this.mapInfo = h('div', 'glass', ''); Object.assign(this.mapInfo.style, { position: 'absolute', bottom: 'calc(150px + var(--sab))', left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap', padding: '5px 12px', fontSize: '12px', fontFamily: 'var(--mono)', zIndex: '6' }); this.root.append(this.mapInfo); }
      this.mapInfo.style.display = '';
      this.mapInfo.innerHTML = `<span style="color:#ffb347">● Apo ${km(inf.apo)}</span> &nbsp; <span style="color:#5fd4ff">● Peri ${km(inf.peri)}</span> &nbsp; <span style="opacity:.7">${inf.body === 'moon' ? 'Maan' : 'Aarde'}</span>`;
    } else if (this.mapInfo) this.mapInfo.style.display = 'none';
    if (this.fpsEl) this.fpsEl.textContent = `${this.view.fps.toFixed(0)} fps · ${this.view.renderer.getPixelRatio().toFixed(1)}x`;
    // overgang (tijdsprong)
    if (s.transition && !this.transitionEl) {
      const tr = s.transition;
      this.transitionEl = h('div', 'transition', h('div', 't1', tr.text), h('div', 't2', tr.sub || ''));
      this.root.append(this.transitionEl); this.transT = 0; audio.silence();
    }
    if (this.transitionEl) {
      this.transT += dt;
      if (this.transT > 0.5 && s.transition) { s.transition.run(); s.transition = null; this.view.setCam('chase'); }
      if (this.transT > (2.6)) { this.transitionEl.remove(); this.transitionEl = null; }
      this.view.render(dt);
      return;
    }
    if (!this.paused) {
      this.manualControl(dt);
      // tijdversnelling
      const maxW = s.maxWarp();
      let warp = this.skip ? Math.min(maxW, maxW >= 1000 ? 1000 : maxW) : Math.min(this.warpSel, maxW);
      if (s.ended) warp = 1;
      w.warp = warp;
      w.advance(dt * (warp > 4 ? 1 : 1), s.focus);
      s.update(dt * warp);
      this.rec.sample();
      // focus van setup volgen
      if (this.view.focus !== s.focus) { this.view.focus = s.focus; if (this.manual && this.savedAp) { this.manual = false; this.updateControlVisibility(); } }
      this.ui.wl.textContent = '×' + (w.warp >= 1000 ? '1k' : w.warp);
    }
    this.autoCamera(dt);
    // HUD
    const v = s.focus;
    const ap = v.ap;
    this.hud.telemetry(v, w.t - w.launchT, ap?.phase || '', ap?.status || '');
    const ok = s.objectives.map((o) => o.state + (o.value || '')).join();
    if (ok !== this.objKey) { this.objKey = ok; this.hud.setObjectives(s.objectives); }
    if (this.pressureEl) this.updatePressure();
    // geluid
    const T = v.tel;
    let Fmax = 0; for (const e of v.active.engines) Fmax += e.spec.thrustVac;
    const camD = this.view.camera.position.length();
    audio.engine(T.thrust / Math.max(1, Fmax) * (v.state === 'destroyed' ? 0 : 1) * (this.view.camMode === 'map' ? 0 : 1), camD, T.pAmb / 101325, this.view.camMode === 'onboard', T.q, T.heatFlux);
    this.view.render(dt);
    // einde
    if (s.ended && this.endWait < 0) { this.endWait = 0; this.showEndBanner(); }
    if (this.endWait >= 0) { this.endWait += dt; if (this.endWait > 6) this.finish(); }
  }
  showEndBanner() {
    const s = this.setup;
    const ok = s.success();
    if (ok) { audio.fanfare(); } else audio.fail();
    this.hud.big(ok ? 'MISSIE GESLAAGD' : s.partial() ? 'GEDEELTELIJK GESLAAGD' : 'MISSIE MISLUKT', s.endReason, ok ? 'good' : 'bad');
    const b = h('button', { class: 'btn primary', style: { position: 'absolute', left: '50%', top: '46%', transform: 'translateX(-50%)' }, onClick: () => this.finish() }, 'Resultaten →');
    this.root.append(b);
  }
  pauseMenu() {
    if (this.done) return;
    this.paused = true; audio.silence();
    const fpsLbl = () => settings.fps ? 'FPS-teller: aan' : 'FPS-teller: uit';
    const body = h('div', 'col',
      h('p', 'dim', `${this.setup.title} · ${tplus(this.setup.world.t - this.setup.world.launchT)}`),
      h('div', 'kv', h('span', null, 'Bediening'), h('b', null, 'Sleep = kijken · knijp = zoom')),
      h('div', 'kv', h('span', null, 'Toetsenbord'), h('b', null, 'A/D draaien · W/S gas · Spatie trap · C camera · M kaart · T auto')));
    modal('Gepauzeerd', body, [
      { label: fpsLbl(), cls: 'ghost', onClick: () => { settings.fps = !settings.fps; saveSettings(); if (settings.fps && !this.fpsEl) { this.fpsEl = h('div', 'fps'); document.getElementById('ui')!.append(this.fpsEl); } else if (!settings.fps) { this.fpsEl?.remove(); this.fpsEl = null; } this.paused = false; } },
      { label: 'Afbreken', cls: 'danger', onClick: () => { this.aborted = true; this.setup.end('Missie afgebroken door vluchtleiding'); this.finish(); } },
      { label: 'Opnieuw', onClick: () => { this.destroy(); this.onRestart(); } },
      { label: 'Hervatten', cls: 'primary', onClick: () => { this.paused = false; } },
    ]);
    const bg = document.querySelector('.modal-bg') as HTMLElement;
    bg?.addEventListener('click', (e) => { if (e.target === bg) this.paused = false; });
  }
  finish() {
    if (this.done) return;
    this.rec.sample(true);
    const s = this.setup;
    const r: FlightResult = { mission: s.mission, success: s.success() && !this.aborted, partial: s.partial(), score: this.aborted ? 0 : s.score(), objectives: s.objectives, metrics: s.metrics, endReason: s.endReason, simTime: s.world.t - s.world.launchT, replay: this.rec.data, aborted: this.aborted, enginesFailed: this.enginesFailed, anyRud: this.anyRud };
    this.destroy();
    this.onEnd(r);
  }
  destroy() {
    this.done = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.keyDown); window.removeEventListener('keyup', this.keyUp);
    this.root.remove(); this.fpsEl?.remove();
    document.querySelectorAll('.modal-bg').forEach((e) => e.remove());
    audio.silence();
  }
}

// ---------- herhaling ----------
export class ReplayController {
  root: HTMLElement; hud: Hud; player: Player; raf = 0; last = 0; done = false; objKey = '';
  constructor(public view: View, data: ReplayData, public onExit: () => void) {
    const ui = document.getElementById('ui')!;
    this.root = h('div', 'screen'); this.root.style.padding = '0'; ui.append(this.root);
    bindCameraGestures(view, this.root);
    this.player = new Player(data);
    this.hud = new Hud(this.root, false);
    this.hud.setMission(data.title, 'Herhaling · ' + fdist(0).replace('0 m', '') + Math.round(data.duration) + ' s');
    view.setWorld(this.player.w);
    view.focus = this.player.vs[0];
    view.setCam('chase'); view.cyF = 0.5;
    this.player.w.on((e) => { if (e.text) this.hud.event(e.text, e.kind); const c = CAPTION[e.kind]; if (c) this.hud.big(c[0], c[1], c[2]); if (e.kind === 'explode' || e.kind === 'rud') audio.explosion(0.6); if (e.kind === 'catch') audio.clank(); });
    const scrub = h('input', { type: 'range', min: String(data.t0), max: String(data.t0 + data.duration), step: '0.1', value: String(data.t0) }) as HTMLInputElement;
    scrub.style.width = '260px';
    scrub.addEventListener('input', () => this.player.seek(+scrub.value));
    (this as any).scrub = scrub;
    const sp = h('div', 'warpbox glass');
    for (const s of [0.5, 1, 2, 4, 10, 30]) { const b = h('button', { class: 'btn' + (s === 1 ? ' on' : ''), onClick: () => { this.player.speed = s; [...sp.children].forEach((c) => c.classList.remove('on')); b.classList.add('on'); } }, '×' + s); sp.append(b); }
    const pp = h('button', { class: 'btn small', onClick: () => { this.player.paused = !this.player.paused; pp.textContent = this.player.paused ? '▶' : '❚❚'; } }, '❚❚');
    const cam = h('button', { class: 'btn small', onClick: () => { const o: CamMode[] = ['chase', 'tower', 'onboard', 'drone', 'free', 'map']; this.view.setCam(o[(o.indexOf(this.view.camMode) + 1) % o.length]); toast(CAM_LABELS[this.view.camMode], '', 1000); } }, '🎥');
    const foc = h('button', { class: 'btn small', onClick: () => { const vs = this.player.w.vehicles; const i = vs.indexOf(this.view.focus!); if (vs.length) this.view.focus = vs[(i + 1) % vs.length]; } }, '🎯');
    const exit = h('button', { class: 'btn small primary', onClick: () => this.exit() }, 'Sluiten');
    this.root.append(h('div', { class: 'glass row', style: { position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 'calc(98px + var(--sab))', padding: '6px 10px' } }, pp, scrub, sp, cam, foc, exit));
    this.hud.objs.remove(); this.hud.prop.style.display = 'none';
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }
  loop(now: number) {
    if (this.done) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    this.player.step(dt);
    const f = this.view.focus;
    if (f && !this.player.w.vehicles.includes(f) && this.player.w.vehicles.length) this.view.focus = this.player.w.vehicles[0];
    if (this.view.focus) this.hud.telemetry(this.view.focus, this.player.t - this.player.data.t0, '', '');
    (this as any).scrub.value = String(this.player.t);
    this.player.w.warp = this.player.speed;
    this.view.render(dt);
  }
  exit() { this.done = true; cancelAnimationFrame(this.raf); this.root.remove(); this.onExit(); }
}
