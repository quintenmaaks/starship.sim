// Starten van vluchten buiten en binnen de carrière + dagelijkse uitdaging
import type { App } from '../app';
import { MissionDef, MISSION_BY_ID } from '../game/missions';
import { Design } from '../game/parts';
import { FlightSetup } from '../flight/setup';
import { FlightCtx } from '../game/career';
import { reliabilityFor, Prep } from '../game/economy';
import { PERFECT } from '../sim/vehicle';
import { findDesign } from '../game/state';
import { hashStr, rng } from '../core/util';
import type { FlightResult } from '../flight/controller';

export type RelMode = 'perfect' | 'real' | 'rush';
export interface QuickOpts { hour?: number; wind?: number; relMode?: RelMode; back: () => void; onResult?: (r: FlightResult) => void }
export function quickFly(app: App, m: MissionDef, design: Design, o: QuickOpts) {
  const prep: Prep = o.relMode === 'rush' ? 'rush' : 'normal';
  const rel = o.relMode === 'perfect' || !o.relMode ? PERFECT : reliabilityFor(null, design, prep).rel;
  const hour = o.hour ?? (m.id === 'sc_night' ? 23.5 : 15.5);
  const run = () => {
    const setup = new FlightSetup({ mission: m, design, rel, hour, wind: o.wind, sandbox: true });
    const ctx: FlightCtx = { mission: m, design, build: null, prep, relScore: 1, hour };
    app.fly(setup, ctx, (r, rw) => { o.onResult?.(r); app.results(r, rw, o.back, run); }, run);
  };
  run();
}

// ---- Dagelijkse uitdaging (wisselt elke kalenderdag) ----
export interface Daily { key: string; mission: MissionDef; design: Design; title: string; goal: string; check: (r: FlightResult) => boolean; hour: number; wind: number }
export function dailyChallenge(): Daily {
  const d = new Date(); const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  const r = rng(hashStr('daily' + key));
  const pool: Omit<Daily, 'key' | 'design' | 'hour' | 'wind'>[] = [
    { mission: MISSION_BY_ID.sc_boostercatch, title: 'Chirurgische vangst', goal: 'Vang Super Heavy binnen 0,8 m van het midden', check: (x) => x.success && (x.metrics.accuracy ?? 9) < 0.8 },
    { mission: MISSION_BY_ID.hop150, title: 'Speldenprik', goal: 'Land de hop binnen 0,5 m', check: (x) => x.success && (x.metrics.accuracy ?? 9) < 0.5 },
    { mission: MISSION_BY_ID.sc_sn8, title: 'Buiklanding', goal: 'Land SN8 heelhuids op Pad C', check: (x) => x.success },
    { mission: MISSION_BY_ID.sc_shipcatch, title: 'Vangst uit de baan', goal: 'Laat Mechazilla het schip vangen', check: (x) => x.success },
    { mission: MISSION_BY_ID.tank, title: 'Drukmeester', goal: 'Bewijs ≥ 8,3 bar zonder knal', check: (x) => (x.metrics.pressure ?? 0) >= 8.3 && !x.anyRud },
    { mission: MISSION_BY_ID.sc_artemis, title: 'Zuidpoolprecisie', goal: 'Land binnen 2 m van de markering op de Maan', check: (x) => (x.metrics.accuracy ?? 99) < 2 && x.objectives.some((o) => o.id === 'land' && o.state === 'done') },
    { mission: MISSION_BY_ID.sc_ift5, title: 'IFT-dag', goal: 'Volledige vlucht met boostervangst', check: (x) => !!x.metrics.boosterCatch },
  ];
  const p = pool[Math.floor(r() * pool.length)];
  const hours = [8, 12, 15.5, 16.9, 22.5];
  return { ...p, key, design: findDesign(null, p.mission.designs[0]), hour: hours[Math.floor(r() * hours.length)], wind: 3 + r() * 12 };
}
export function dailyState() {
  try { return JSON.parse(localStorage.getItem('starship_daily') || '{}') as { done?: Record<string, boolean>; streak?: number; last?: string }; } catch { return {}; }
}
export function markDaily(key: string) {
  const s = dailyState(); s.done ||= {};
  if (s.done[key]) return s;
  s.done[key] = true;
  const y = new Date(Date.now() - 86400000); const yk = `${y.getFullYear()}-${y.getMonth() + 1}-${y.getDate()}`;
  s.streak = s.last === yk ? (s.streak || 0) + 1 : 1; s.last = key;
  localStorage.setItem('starship_daily', JSON.stringify(s));
  return s;
}
