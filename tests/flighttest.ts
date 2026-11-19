import { FlightSetup, missionById } from '../src/flight/setup';
import { BUILTIN_DESIGNS } from '../src/game/parts';
const id = process.argv[2] || 'hop150';
const did = process.argv[3];
const m = missionById(id);
const design = BUILTIN_DESIGNS.find((d) => d.id === (did || m.designs[0]))!;
const f = new FlightSetup({ mission: m, design, headless: true, seed: Number(process.env.SEED || 7), sandbox: true });
const w = f.world;
w.on((e) => { if (e.text) console.log(`  [T${e.t.toFixed(1)}] ${e.vehicle?.name ?? ''}: ${e.text}`); });
if (f.custom === 'pressure') { f.pressure.set = Number(process.env.P || 8.2); }
let last = 0; const t0 = Date.now();
while (!f.ended && w.t < f.maxT + 10 && Date.now() - t0 < 240000) {
  const mw = f.maxWarp();
  w.warp = Math.min(mw, mw >= 1000 ? 100 : mw);
  w.advance(w.warp > 4 ? 1 : 0.02 * w.warp, f.focus);
  f.update(0.02);
  if (process.env.DUMPB) for (const v of w.vehicles) if (v.role === 'booster' && v.tel.alt < 9000 && v.tel.vVert < 0 && !(v as any)._d) { (v as any)._d = 1; const l = w.toLocal('gulf', v.pos); const vel = v.vel.clone().sub(w.surfaceVel('earth', v.pos)).applyQuaternion(w.frames.gulf.inv); const nose = v.nose().applyQuaternion(w.frames.gulf.inv); console.log('BDUMP', JSON.stringify({ l, vel, nose, prop: v.active.prop / v.active.spec.propMax, fins: v.finsOut, ap: (v.ap as any)?.phase })); }
  if (f.transition) { f.transition.run(); f.transition = null; }
  if (w.t - last > (w.warp > 4 ? 600 : 30)) { last = w.t; const v = f.focus; console.log(`t=${w.t.toFixed(0)} warp=${w.warp} ${v.name}[${v.state}] alt=${(v.tel.alt / 1000).toFixed(2)}km v=${v.tel.vSurf.toFixed(0)} ${v.ap?.phase ?? ''} ${v.ap?.status ?? ''}`); }
}
console.log('END', f.endReason, 'success', f.success(), 'score', f.score(), JSON.stringify(f.metrics));
for (const o of f.objectives) console.log(' ', o.state.padEnd(4), o.label, o.value ?? '', o.optional ? '(optioneel)' : '');
