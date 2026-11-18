import * as THREE from 'three';
import { World } from '../src/sim/world';
import { Ephemeris } from '../src/sim/bodies';
import { BUILTIN_DESIGNS, designToSpec, designStats } from '../src/game/parts';
import { AscentProgram, BoostbackProgram, HopProgram, ShipReturnProgram } from '../src/sim/autopilot';
import { REGIONS } from '../src/sim/terrain';

function run(name: string, setup: (w: World) => any, maxT: number) {
  const e = new Ephemeris(0); e.setLocalHour(-97.157, 10);
  const w = new World(e, ['gulf']);
  w.on((ev) => { if (ev.text) console.log(`  [${name} T${ev.t.toFixed(1)}] ${ev.vehicle?.name ?? ''}: ${ev.text} ${ev.data ? JSON.stringify(ev.data) : ''}`); });
  setup(w);
  let last = 0;
  while (w.t < maxT) {
    w.step(w.dt);
    if (w.t - last > (process.env.FINE && w.vehicles.some(v=>v.ap?.phase==='Landing') ? 1 : 20)) {
      last = w.t;
      const s = w.vehicles.map((v) => `${v.name}[${v.state}] alt=${(v.tel.alt / 1000).toFixed(2)}km v=${v.tel.vSurf.toFixed(0)} vv=${v.tel.vVert.toFixed(0)} q=${(v.tel.q/1000).toFixed(1)} prop=${(v.propFrac*100).toFixed(0)}% ${v.ap?.phase ?? ''} ${v.ap?.status ?? ''}`).join(' | ');
      console.log(`${name} t=${w.t.toFixed(0)} ${s}`);
    }
    if (w.vehicles.every((v) => v.state !== 'flying' && v.state !== 'clamped')) break;
  }
  return w;
}
for (const d of BUILTIN_DESIGNS) { const s = designStats(d); console.log(d.name, 'dv', s.dvTotal.toFixed(0), 'twr', s.liftoffTWR.toFixed(2), 'mass t', (s.totalMass/1000).toFixed(0), 'cost', (s.cost/1e6).toFixed(0)); }
const which = process.argv[2] || 'all';
if (which === 'hop' || which === 'all') run('hop150', (w) => {
  const v = w.spawnOnPad(designToSpec(BUILTIN_DESIGNS[0]), 'ship', 'gulf', 'padB', 0, [1]);
  const pad = REGIONS.gulf.pads.find((p) => p.id === 'padC')!;
  v.ap = new HopProgram(v, 150, { region: 'gulf', pad, x: pad.x, z: pad.z, y: pad.top }, false);
  v.legsDown = true;
}, 200);
if (which === 'hop10' || which === 'all') run('hop10k', (w) => {
  const v = w.spawnOnPad(designToSpec(BUILTIN_DESIGNS[1]), 'ship', 'gulf', 'padB', 0, [0.17]);
  const pad = REGIONS.gulf.pads.find((p) => p.id === 'padC')!;
  v.ap = new HopProgram(v, 10000, { region: 'gulf', pad, x: pad.x, z: pad.z, y: pad.top }, true);
}, 600);
if (which === 'orbit' || which === 'all') run('orbit', (w) => {
  const v = w.spawnOnPad(designToSpec(BUILTIN_DESIGNS[3]), 'stack', 'gulf', 'olm');
  w.launchT = 3;
  const pad = REGIONS.gulf.pads.find((p) => p.id === 'olm')!;
  v.ap = new AscentProgram(v, { apo: 200000, peri: -30000, azimuth: 92, boosterReserve: 0.11, onStage: (ship, b) => {
    b.ap = new BoostbackProgram(b, { region: 'gulf', pad, x: pad.x, z: pad.z, y: pad.top + 12, catchTower: true });
  } });
}, 900);
