(globalThis as any).CATCHDBG = !!process.env.CATCHDBG;
import * as THREE from 'three';
import { World } from '../src/sim/world';
import { Ephemeris } from '../src/sim/bodies';
import { BUILTIN_DESIGNS, designToSpec, designStats } from '../src/game/parts';
import { AscentProgram, BoostbackProgram, HopProgram, ShipReturnProgram } from '../src/sim/autopilot';
import * as AP from '../src/sim/autopilot';
import { REGIONS } from '../src/sim/terrain';

function run(name: string, setup: (w: World) => any, maxT: number) {
  const e = new Ephemeris(0); e.setLocalHour(-97.157, 10);
  const w = new World(e, ['gulf']);
  w.on((ev) => { if (ev.text) console.log(`  [${name} T${ev.t.toFixed(1)}] ${ev.vehicle?.name ?? ''}: ${ev.text} ${ev.data ? JSON.stringify(ev.data) : ''}`); });
  setup(w);
  let last = 0;
  while (w.t < maxT) {
    w.step(w.dt);
    if (w.t - last > (process.env.FINE && w.vehicles.some(v=>(v.ap?.phase||'').startsWith('Landing')) ? 1 : 20)) {
      last = w.t;
      const s = w.vehicles.map((v) => `${v.name}[${v.state}] alt=${(v.tel.alt / 1000).toFixed(2)}km v=${v.tel.vSurf.toFixed(0)} vv=${v.tel.vVert.toFixed(0)} q=${(v.tel.q/1000).toFixed(1)} prop=${(v.propFrac*100).toFixed(0)}% thr=${v.cmdThrottle.toFixed(2)} n=${v.enginesRunning()} g=${v.tel.gLoad.toFixed(1)} tilt=${v.tel.tilt.toFixed(0)} ${v.ap?.phase ?? ''} ${v.ap?.status ?? ''}`).join(' | ');
      console.log(`${name} t=${w.t.toFixed(0)} ${s}`);
    }
    if (process.env.DBG) for (const v of w.vehicles) if (v.ap && v.tel.agl < 60 && v.state==='flying') { const { localState } = AP; const ls = localState(w, v, 'gulf'); console.log('dbg', ls.p.x.toFixed(2), ls.vel.x.toFixed(2), ls.p.y.toFixed(1), 'nose', v.nose().applyQuaternion(ls.inv).toArray().map(x=>x.toFixed(3)).join(','), 'tgt', new THREE.Vector3(0,1,0).applyQuaternion(v.targetQuat).applyQuaternion(ls.inv).toArray().map(x=>x.toFixed(3)).join(','), 'w', v.w.toArray().map(x=>x.toFixed(3)).join(',')); }
    if (w.vehicles.every((v) => v.state !== 'flying' && v.state !== 'clamped')) break;
  }
  for (const v of w.vehicles) console.log('END', v.name, v.state, w.toLocal('gulf', v.pos), v.active.spec.catchPins, w.towers.map(t=>t.armH.toFixed(1)+'/'+t.armTargetH.toFixed(1)));
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
  v.ap = new AscentProgram(v, { apo: 200000, peri: -30000, azimuth: 92, boosterReserve: 0.115, onStage: (ship, b) => {
    b.ap = new BoostbackProgram(b, { region: 'gulf', pad, x: pad.x, z: pad.z, y: pad.top + 12, catchTower: true });
  } });
}, 900);
if (which === 'orbit') {}
if (which === 'catchdbg') {
  const w = run('catchdbg', (w) => {
    const pad = REGIONS.gulf.pads.find((p) => p.id === 'olm')!;
    const d = BUILTIN_DESIGNS[3];
    const spec = designToSpec(d);
    const b = w.spawnOnPad({ name: 'SH', stages: [spec.stages[0]] }, 'booster', 'gulf', 'olm', 400, [0.05]);
    w.release(b);
    b.ap = new BoostbackProgram(b, { region: 'gulf', pad, x: pad.x, z: pad.z, y: pad.top + 12, catchTower: true });
    (b.ap as any).bbDone = true;
    console.log('towers', w.towers.map(t => t.key), 'pins', b.active.spec.catchPins);
  }, 120);
  const b = w.vehicles[0];
  console.log('local', w.toLocal('gulf', b.pos), w.towers[0].armH, w.towers[0].armTargetH, b.length);
}
