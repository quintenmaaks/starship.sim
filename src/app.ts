// App: schermbeheer, 3D-achtergrond (Starbase bij zonsondergang), starten van vluchten en herhalingen.
import { View } from './render/view';
import { World } from './sim/world';
import { Ephemeris } from './sim/bodies';
import { REGIONS } from './sim/terrain';
import { Design, designToSpec, BUILTIN_DESIGNS } from './game/parts';
import { GameState, loadGame, saveGame, settings, saveSettings } from './game/state';
import { MissionDef } from './game/missions';
import { FlightSetup } from './flight/setup';
import { FlightController, FlightResult, ReplayController } from './flight/controller';
import { ReplayData } from './flight/replay';
import { applyResult, FlightCtx, Reward } from './game/career';
import { audio } from './ui/audio';
import { h, clear } from './ui/dom';
import { showMenu } from './ui/menu';
import { showHub } from './ui/hub';
import { showResults } from './ui/results';
import { genContracts } from './game/economy';

export class App {
  view: View; ui: HTMLElement;
  g: GameState | null = null;
  backdrop: World | null = null; backdropDesign = '';
  raf = 0; last = 0; inFlight = false;
  screenEl: HTMLElement | null = null;
  constructor(view: View) {
    this.view = view;
    this.ui = document.getElementById('ui')!;
    this.loop = this.loop.bind(this);
    document.addEventListener('pointerdown', () => audio.unlock(), { capture: true });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.g) saveGame(this.g); });
    setInterval(() => { if (this.g && !this.inFlight) saveGame(this.g); }, 30000);
  }
  // ---------- achtergrond ----------
  setBackdrop(design: Design = BUILTIN_DESIGNS[3], hour = 16.8, cam: 'free' | 'tower' = 'free') {
    const key = JSON.stringify(design) + hour;
    if (!this.backdrop || this.backdropDesign !== key) {
      if (!this.backdrop) {
        const e = new Ephemeris(0); e.setLocalHour(REGIONS.gulf.lon, hour);
        this.backdrop = new World(e, ['gulf']);
      } else {
        this.backdrop.vehicles = []; this.backdrop.anchors.clear();
        for (const t of this.backdrop.towers) t.caught = null;
      }
      if ((this.backdrop as any)._hour !== hour) { (this.backdrop as any).ephem.setLocalHour(REGIONS.gulf.lon, hour); (this.backdrop as any)._hour = hour; this.backdrop.t = 0; this.backdrop.updateFrames(); }
      if (this.view.world !== this.backdrop) this.view.setWorld(this.backdrop);
      const spec = designToSpec(design);
      const pad = spec.stages.length > 1 ? 'olm' : 'padB';
      const v = this.backdrop.spawnOnPad(spec, 'stack', 'gulf', pad);
      v.legsDown = true;
      this.view.focus = v;
      this.backdropDesign = key;
    } else if (this.view.world !== this.backdrop) { this.view.setWorld(this.backdrop); this.view.focus = this.backdrop.vehicles[0]; }
    this.view.setCam(cam);
    this.view.camPitch = 0.1; this.view.zoom = design.booster.enabled ? 0.95 : 1.8; this.view.cineSpin = 0.035;
    this.startLoop();
  }
  startLoop() { if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.loop); } }
  stopLoop() { cancelAnimationFrame(this.raf); this.raf = 0; }
  loop(now: number) {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    if (this.backdrop && this.view.world === this.backdrop) { this.backdrop.t += dt * 2; this.backdrop.updateFrames(); for (const v of this.backdrop.vehicles) this.backdrop.applyAnchor(v); }
    this.view.render(dt);
  }
  // ---------- schermen ----------
  setScreen(el: HTMLElement) {
    this.screenEl?.remove();
    document.querySelectorAll('.modal-bg').forEach((e) => e.remove());
    this.screenEl = el;
    this.ui.append(el);
  }
  menu() { this.g = null; audio.setMusic(true); showMenu(this); }
  hub(tab?: string) { if (!this.g) return this.menu(); genContracts(this.g); audio.setMusic(true); showHub(this, tab); }
  openCareer(slot: number) { const g = loadGame(slot); if (g) { this.g = g; settings.lastSlot = slot; saveSettings(); this.hub(); } }

  // ---------- vlucht ----------
  fly(setup: FlightSetup, ctx: FlightCtx, after: (r: FlightResult, rw: Reward) => void, restart?: () => void) {
    this.stopLoop();
    this.screenEl?.remove(); this.screenEl = null;
    this.inFlight = true;
    audio.setMusic(false);
    new FlightController(this.view, setup, (r) => {
      this.inFlight = false;
      const rw = applyResult(this.g && this.g.mode === 'career' ? this.g : null, ctx, r);
      after(r, rw);
    }, () => { this.inFlight = false; restart ? restart() : this.menu(); });
  }
  results(r: FlightResult, rw: Reward, onContinue: () => void, onRetry?: () => void) {
    this.setBackdropAfterFlight(r);
    showResults(this, r, rw, onContinue, onRetry);
  }
  setBackdropAfterFlight(_r: FlightResult) {
    // de vluchtwereld blijft zichtbaar als achtergrond (langzaam draaiende camera)
    this.view.cineSpin = 0.03;
    if (this.view.camMode === 'map' || this.view.camMode === 'onboard') this.view.setCam('chase');
    this.startLoop();
  }
  replay(data: ReplayData, back: () => void) {
    this.stopLoop();
    this.screenEl?.remove(); this.screenEl = null;
    new ReplayController(this.view, data, () => { back(); });
  }
}
export type { MissionDef };
export { h, clear };
