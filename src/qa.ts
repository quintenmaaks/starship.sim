// QA-hulpmiddelen voor headless screenshots (alleen met ?qa)
import type { App } from './app';
import { MISSION_BY_ID } from './game/missions';
import { findDesign, newGame, saveGame } from './game/state';
import { quickFly } from './ui/launch';
import { showDesigner } from './ui/designer';
import { sandbox } from './ui/menu';
import { doIPO, advanceDays, stockShock, grantMilestone } from './game/economy';

export function installQA(app: App) {
  (window as any).__qa = {
    designer: () => showDesigner(app, null, () => app.menu(), 'v3t'),
    testcenter: () => sandbox(app, 'test'),
    fly: (id: string, design?: string, hour?: number) => quickFly(app, MISSION_BY_ID[id], findDesign(null, design || MISSION_BY_ID[id].designs[0]), { hour, back: () => app.menu() }),
    // vluchtsimulatie versneld vooruitspoelen (zoals tests/flighttest.ts)
    ffwd: (sec: number, cond?: string) => {
      const fc = (window as any).__fc; const f = fc.setup; const w = f.world; const t1 = w.t + sec; const t0 = performance.now();
      while (!f.ended && w.t < t1 && performance.now() - t0 < 60000) {
        if (cond && new Function('f', 'w', 'return ' + cond)(f, w)) break;
        const mw = f.maxWarp(); w.warp = Math.min(mw, mw >= 1000 ? 100 : mw);
        w.advance(w.warp > 4 ? 1 : 0.02 * w.warp, f.focus); f.update(0.02);
        if (f.transition) { f.transition.run(); f.transition = null; }
      }
      w.warp = 1; return { t: w.t, alt: f.focus.tel.alt, state: f.focus.state, name: f.focus.name };
    },
    career: (tab?: string) => {
      const g = newGame('Noordzee Aerospace', 'career', 3);
      g.research.orbital = true; g.research.raptor2 = true; g.research.hotstage = true; g.research.catch = true;
      g.tests.hop150 = { count: 2, ok: 2 }; g.tests.hop10k = { count: 3, ok: 2 }; g.tests.suborbital = { count: 2, ok: 1 }; g.tests.orbital = { count: 1, ok: 1 };
      g.milestones.firsthop = 10; g.milestones.bellyflop = 60; g.milestones.space = 120; g.milestones.orbit = 160;
      g.rep = 48; g.hype = 62; g.stats.flights = 8; g.stats.successes = 6; g.tutorial.done = true;
      g.builds.push({ id: 'b9', designId: 'v2', name: 'B12/S28 (Starship V2)', kind: 'stack', daysLeft: 0, daysTotal: 60, flights: 1, condition: 0.9, ready: true, tested: { static: true } });
      advanceDays(g, 40); doIPO(g, 0.15); grantMilestone(g, 'ipo', []);
      const shocks = [0.04, -0.02, 0.09, -0.12, 0.03, 0.06, 0.11, -0.03, 0.05, 0.14, -0.05, 0.08];
      for (const s of shocks) { advanceDays(g, 9); stockShock(g, s, s > 0 ? 'geslaagde vlucht' : 'RUD'); }
      saveGame(g); app.g = g; app.hub(tab);
    },
  };
}
