// Vluchtcontroller: lus, tijdversnelling, invoer (touch + toetsenbord), HUD, camera-regie, opname.
import * as THREE from 'three';
import { View, CamMode, CAM_LABELS } from '../render/view';
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

// ---------- gedeelde HUD (live vlucht en herhaling) ----------
export class Hud {
  root: HTMLElement; tl: HTMLElement; tr: HTMLElement; telem: HTMLElement; events: HTMLElement;
  missionT: HTMLElement; missionS: HTMLElement; objs: HTMLElement; clock: HTMLElement; liveLbl: HTMLElement;
  gSpeed = gauge('SNELHEID', 'KM/U'); gAlt = gauge('HOOGTE', 'KM');
  vname: HTMLElement; phase: HTMLElement; status: HTMLElement; timeline: HTMLElement; engines: HTMLElement; prop: HTMLElement;
  bigEl: HTMLElement | null = null; bigT = 0;
  engKey = '';
  constructor(parent: HTMLElement, live: boolean) {
    this.root = h('div', 'hud');
    this.missionT = h('div', 'mt'); this.missionS = h('div', 'ms'); this.objs = h('div', 'objs');
    this.tl = h('div', 'tl', h('div', 'mission glass', this.missionT, this.missionS, this.objs));
    this.clock = h('div', 'clock', 'T+00:00:00');
    this.liveLbl = h('span', 'lbl', live ? 'LIVE' : 'HERHALING');
    this.tr = h('div', 'tr', h('div', 'live glass', h('i', 'dot'), this.liveLbl, this.clock));
    this.vname = h('div', 'vname', ''); this.phase = h('div', 'phase', ''); this.status = h('div', 'status', '');
    this.timeline = h('div', 'timeline'); this.engines = h('div', 'engines'); this.prop = h('div', 'prop');
    this.engines.style.cssText = 'position:relative;width:46px;height:46px;';
    this.telem = h('div', 'telem',
      this.gSpeed.el,
      h('div', 'center-col glass', this.vname, this.phase, this.status, this.timeline, h('div', 'row', this.engines, this.prop)),
      this.gAlt.el);
    this.events = h('div', 'events');
    this.root.append(this.tl, this.tr, this.telem, this.events);
    parent.append(this.root);
  }
  setMission(t: string, s: string) { this.missionT.textContent = t; this.missionS.textContent = s; }
  setObjectives(objs: Objective[]) {
    clear(this.objs);
    for (const o of objs) this.objs.append(h('div', 'obj ' + o.state + (o.optional ? ' opt' : ''), h('i', null, o.state === 'done' ? '✓' : o.state === 'fail' ? '✗' : o.optional ? '☆' : '○'), o.label + (o.value ? ` · ${o.value}` : '')));
    // tijdlijn
    clear(this.timeline);
    const req = objs;
    const n = req.length;
    const doneN = req.filter((o) => o.state !== 'open').length;
    this.timeline.append(h('div', 'tline'), h('div', { class: 'tfill', style: { width: `${n > 1 ? Math.max(0, (doneN - 1) / (n - 1)) * 100 : 0}%` } }));
    req.forEach((o, i) => {
      const x = n > 1 ? (i / (n - 1)) * 100 : 50;
      this.timeline.append(h('div', { class: 'tev ' + (o.state === 'done' ? 'done' : o.state === 'fail' ? 'fail' : ''), style: { left: x + '%' } }));
    });
  }
  telemetry(v: Vehicle, t: number, apPhase: string, apStatus: string) {
    const T = v.tel;
    this.clock.textContent = tplus(t);
    const kmh = T.vSurf * 3.6;
    this.gSpeed.set(kmh > 99999 ? fmt0(kmh / 1000) + 'k' : fmt0(kmh), kmh / 30000);
    const moon = T.body === 'moon';
    if (T.alt < 10000) this.gAlt.set(fmt0(Math.max(0, T.agl < T.alt ? T.agl : T.alt)), T.alt / 250000, 'M');
    else if (T.alt < 1e6) this.gAlt.set(fmt1(T.alt / 1000), T.alt / 250000, 'KM');
    else this.gAlt.set(fmt0(T.alt / 1000), 1, 'KM');
    this.vname.textContent = (v.name || '').toUpperCase() + (moon ? ' · MAAN' : '');
    this.phase.textContent = apPhase || stateLabel(v);
    this.status.textContent = apStatus || `${T.mach > 0.3 ? 'Mach ' + fmt1(T.mach) + ' · ' : ''}${fmt1(T.gLoad)} g`;
    // motoren (posities volgens de echte ringindeling)
    const st = v.active;
    const key = st.spec.name + st.engines.length;
    if (key !== this.engKey) {
      this.engKey = key; clear(this.engines);
      const R = Math.max(1, ...st.engines.map((e) => Math.hypot(e.spec.x, e.spec.z)));
      for (const e of st.engines) {
        const d = h('i'); d.style.cssText = `position:absolute;left:${20 + (e.spec.x / R) * 18}px;top:${20 + (e.spec.z / R) * 18}px;`;
        if (e.spec.kind === 'vac') d.classList.add('vac');
        this.engines.append(d);
      }
    }
    const dots = this.engines.children;
    st.engines.forEach((e, i) => { const d = dots[i] as HTMLElement; if (!d) return; d.className = (e.failed ? 'fail' : e.on && e.throttle > 0.05 ? 'on' : '') + (e.spec.kind === 'vac' ? ' vac' : ''); });
    // brandstof
    const rows = v.stages.map((s) => ({ n: s.spec.kind === 'booster' ? 'BOOSTER' : 'SCHIP', f: s.prop / Math.max(1, s.spec.propMax) }));
    if (this.prop.children.length !== rows.length) { clear(this.prop); for (const r of rows) this.prop.append(h('div', 'pr', h('span', null, r.n), h('div', 'bar', h('i')))); }
    rows.forEach((r, i) => { const b = this.prop.children[i]?.querySelector('i') as HTMLElement; if (b) { b.style.width = (r.f * 100).toFixed(1) + '%'; } });
  }
  event(text: string, kind: string) {
    if (!text) return;
    const e = h('div', 'ev ' + kind, text);
    this.events.append(e);
    while (this.events.children.length > 5) this.events.firstChild!.remove();
    setTimeout(() => { e.style.opacity = '0'; setTimeout(() => e.remove(), 1000); }, 6000);
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
  throttle = 0; joy = { x: 0, y: 0 }; keys = new Set<string>();
  camLockT = 0; lastFocus: Vehicle | null = null; sasMode: 'hold' | 'pro' | 'retro' | 'up' = 'hold'; engMode = 0;
  raf = 0; last = 0; objKey = '';
  transitionEl: HTMLElement | null = null; transT = 0;
  aborted = false; anyRud = false; enginesFailed = 0;
  ui: Record<string, HTMLElement> = {};
  fpsEl: HTMLElement | null = null;
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
    view.cineSpin = 0; view.zoom = 1;
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
    // rechtsboven: tijdversnelling + pauze
    const warpBox = h('div', 'warpbox glass');
    this.ui.warp = warpBox;
    const skipBtn = h('button', { class: 'btn small', onClick: () => { this.skip = !this.skip; skipBtn.classList.toggle('on', this.skip); if (!this.skip) this.warpSel = 1; } }, '⏩ Snel');
    this.ui.skip = skipBtn;
    for (const wv of WARPS.slice(0, 6)) {
      const b = h('button', { class: 'btn', onClick: () => { this.warpSel = wv; this.skip = false; skipBtn.classList.remove('on'); } }, '×' + wv);
      b.dataset.w = String(wv); warpBox.append(b);
    }
    const pause = h('button', { class: 'btn small', onClick: () => this.pauseMenu() }, '❚❚');
    this.hud.tr.append(pause, h('div', 'col', warpBox, h('div', 'row', skipBtn, h('div', 'grow'))));
    // links onder: gashendel + joystick (alleen handmatig) + AUTO-knop
    const thr = h('div', 'throttle glass', h('div', 'fill'), h('div', 'lab', 'GAS'), h('div', 'val', '0%'));
    this.ui.thr = thr;
    const setThr = (e: PointerEvent) => { const rc = thr.getBoundingClientRect(); this.throttle = clamp(1 - (e.clientY - rc.top) / rc.height, 0, 1); if (this.throttle < 0.04) this.throttle = 0; };
    thr.addEventListener('pointerdown', (e) => { thr.setPointerCapture(e.pointerId); setThr(e); audio.unlock(); });
    thr.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') setThr(e); });
    const joy = h('div', 'joy glass', h('div', 'ring'), h('div', 'knob'), h('div', 'lab', 'HOUDING'));
    this.ui.joy = joy;
    const knob = joy.querySelector('.knob') as HTMLElement;
    let jid = -1;
    const setJoy = (e: PointerEvent) => { const rc = joy.getBoundingClientRect(); const x = (e.clientX - rc.left) / rc.width * 2 - 1, y = (e.clientY - rc.top) / rc.height * 2 - 1; const l = Math.hypot(x, y); const k = l > 1 ? 1 / l : 1; this.joy.x = x * k; this.joy.y = y * k; knob.style.transform = `translate(${this.joy.x * 40}px, ${this.joy.y * 40}px)`; };
    joy.addEventListener('pointerdown', (e) => { jid = e.pointerId; joy.setPointerCapture(e.pointerId); setJoy(e); });
    joy.addEventListener('pointermove', (e) => { if (e.pointerId === jid) setJoy(e); });
    const jup = (e: PointerEvent) => { if (e.pointerId !== jid) return; jid = -1; this.joy.x = 0; this.joy.y = 0; knob.style.transform = ''; };
    joy.addEventListener('pointerup', jup); joy.addEventListener('pointercancel', jup);
    const autoBtn = h('button', { class: 'cbtn on', onClick: () => this.toggleManual() }, h('span', 'i', '🤖'), 'AUTO');
    autoBtn.style.width = '58px';
    this.ui.auto = autoBtn;
    const left = h('div', 'ctrl-l', h('div', 'col', autoBtn), thr, joy);
    r.append(left);
    // rechts onder: knoppenraster
    const cb = (icon: string, label: string, f: () => void, key?: string) => { const b = h('button', { class: 'cbtn', onClick: f }, h('span', 'i', icon), label); if (key) this.ui[key] = b; return b; };
    const grid = h('div', 'btngrid',
      cb('🎥', 'Camera', () => this.cycleCam(), 'cam'),
      cb('🗺️', 'Kaart', () => { this.view.setCam(this.view.camMode === 'map' ? 'chase' : 'map'); this.camLockT = 30; }, 'map'),
      cb('🎯', 'Volg', () => this.cycleFocus(), 'focusb'),
      cb('⇵', 'Trap', () => this.doStage(), 'stage'),
      cb('🔥', 'Motor', () => this.cycleEngines(), 'eng'),
      cb('🧭', 'SAS', () => this.cycleSas(), 'sas'),
      cb('🪽', 'Flaps', () => { this.v.flapsOn = !this.v.flapsOn; this.v.finsOut = this.v.flapsOn || this.v.finsOut; }, 'flaps'),
      cb('🦵', 'Poten', () => { this.v.legsDown = !this.v.legsDown; }, 'legs'),
      cb('↩️', 'Terug', () => this.setup.autoDeorbit(), 'deorbit'));
    this.ui.grid = grid;
    r.append(h('div', 'ctrl-r', grid));
    this.updateControlVisibility();
  }
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
    this.ui.thr.classList.toggle('hidden', !m || !!this.setup.custom);
    this.ui.joy.classList.toggle('hidden', !m || !!this.setup.custom);
    this.ui.auto.classList.toggle('on', !m);
    this.ui.auto.innerHTML = m ? '<span class="i">🕹️</span>HAND' : '<span class="i">🤖</span>AUTO';
    for (const k of ['stage', 'eng', 'sas', 'legs']) this.ui[k].classList.toggle('hidden', !m);
    this.ui.deorbit.classList.toggle('hidden', this.setup.mission.id !== 'sc_orbit');
    this.ui.focusb.classList.toggle('hidden', this.setup.world.vehicles.filter((x) => x.state !== 'destroyed').length < 2);
  }
  toggleManual() {
    const v = this.v;
    this.manual = !this.manual;
    if (this.manual) {
      this.savedAp = v.ap; v.ap = null; v.sas = 'hold'; v.holdQuat.copy(v.q); this.throttle = v.cmdThrottle; this.sasMode = 'hold';
      toast('Handmatige besturing — joystick = houding, schuif = gas', '', 2600);
    } else {
      if (this.savedAp && !this.savedAp.done && this.savedAp.v === v) v.ap = this.savedAp;
      v.input.set(0, 0, 0);
      toast(v.ap ? 'Autopiloot hervat' : 'Geen actief autopilootprogramma', '', 2000);
    }
    this.updateControlVisibility();
  }
  cycleCam() {
    const order: CamMode[] = ['chase', 'tower', 'onboard', 'drone', 'free'];
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
    if (!this.manual) return;
    const k = this.keys;
    let px = this.joy.y * (settings.invertY ? -1 : 1), yz = -this.joy.x, rl = 0;
    if (k.has('w')) px = -1; if (k.has('s')) px = 1; if (k.has('a')) yz = 1; if (k.has('d')) yz = -1; if (k.has('q')) rl = 1; if (k.has('e')) rl = -1;
    if (k.has('shift')) this.throttle = clamp(this.throttle + dt * 0.6, 0, 1);
    if (k.has('control')) this.throttle = clamp(this.throttle - dt * 0.6, 0, 1);
    const sens = settings.joySens || 1;
    v.input.set(px * sens, rl, yz * sens);
    v.cmdThrottle = this.throttle;
    if (v.state === 'clamped' && this.throttle > 0.5) (v as any).releaseArmed = true;
    // SAS-richtingen
    if (this.sasMode !== 'hold' && v.input.lengthSq() < 0.0025) {
      const c = v.tel.body === 'moon' ? this.setup.world.ephem.moonPos(this.setup.world.t) : new THREE.Vector3();
      const up = v.pos.clone().sub(c).normalize();
      const vel = v.tel.alt < 80000 ? v.vRel.clone() : v.vel.clone().sub(v.tel.body === 'moon' ? this.setup.world.ephem.moonVel(this.setup.world.t) : new THREE.Vector3());
      const dir = this.sasMode === 'up' ? up : vel.normalize().multiplyScalar(this.sasMode === 'pro' ? 1 : -1);
      point(v, dir, v.belly());
    } else v.sas = 'hold';
    const tf = this.ui.thr.querySelector('.fill') as HTMLElement; tf.style.height = (this.throttle * 100) + '%';
    (this.ui.thr.querySelector('.val') as HTMLElement).textContent = Math.round(this.throttle * 100) + '%';
  }

  loop(now: number) {
    if (this.done) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    const s = this.setup, w = s.world;
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
      for (const b of this.ui.warp.children) (b as HTMLElement).classList.toggle('on', +(b as HTMLElement).dataset.w! === w.warp);
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
      h('div', 'kv', h('span', null, 'Bediening'), h('b', null, 'Sleep = camera · knijp = zoom')),
      h('div', 'kv', h('span', null, 'Toetsenbord'), h('b', null, 'WASD/QE houding · Shift/Ctrl gas · Spatie trap · C camera · M kaart · T auto')));
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
    view.setCam('chase');
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
    this.hud.tl.querySelector('.objs')!.remove();
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
