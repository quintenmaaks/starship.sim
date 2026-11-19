(globalThis as any).CATCHDBG = !!process.env.CATCHDBG;
import * as THREE from 'three';
import { World } from '../src/sim/world';
import { Ephemeris } from '../src/sim/bodies';
import { BUILTIN_DESIGNS, designToSpec, designStats } from '../src/game/parts';
import { AscentProgram, BoostbackProgram, HopProgram, ShipReturnProgram } from '../src/sim/autopilot';
import * as AP from '../src/sim/autopilot';
import { REGIONS } from '../src/sim/terrain';
import { placeEntry, spawnFree, placeOrbit } from '../src/sim/spawn';
import { LunarDescentProgram, DockingProgram, planTLI, LunarCaptureProgram, SequenceProgram, TliBurnProgram, planMidCourse } from '../src/sim/programs2';
import { BurnProgram } from '../src/sim/autopilot';

function run(name: string, setup: (w: World) => any, maxT: number) {
  const e = new Ephemeris(0); e.setLocalHour(-97.157, 10);
  const w = new World(e, ['gulf']);
  w.on((ev) => { if (ev.text) console.log(`  [${name} T${ev.t.toFixed(1)}] ${ev.vehicle?.name ?? ''}: ${ev.text} ${ev.data ? JSON.stringify(ev.data) : ''}`); });
  setup(w);
  let last = 0;
  while (w.t < maxT) {
    w.step(w.dt);
    const sv = (w as any)._v; if (sv && sv._chk) sv._chk();
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
if (which === 'ift') {
  run('ift', (w) => {
    const v = w.spawnOnPad(designToSpec(BUILTIN_DESIGNS[2]), 'stack', 'gulf', 'olm');
    w.launchT = 3;
    const pad = REGIONS.gulf.pads.find((p) => p.id === 'olm')!;
    const ap = new AscentProgram(v, { apo: 200000, peri: -30000, azimuth: 92, boosterReserve: 0.115, onStage: (ship, b) => {
      b.ap = new BoostbackProgram(b, { region: 'gulf', pad: null, x: 29000, z: 2000, y: 0, water: true });
    } });
    v.ap = ap;
    const iv = setInterval(() => {}, 1000); clearInterval(iv);
    (v as any)._chk = () => { if (ap.done && !(v as any)._ret) { (v as any)._ret = true; v.ap = new ShipReturnProgram(v, null); } };
    w.on(() => (v as any)._chk());
    w.on((e) => { if (e.kind === 'seco') { setTimeout(()=>{},0); } });
    (w as any)._v = v;
  }, 4200);
}

if (which === 'shipcatch') {
  const D = Number(process.env.D || 2300e3), G = Number(process.env.G || -1.2), VV = Number(process.env.V || 7400), AZ = Number(process.env.AZ || 90);
  run('shipcatch', (w) => {
    const pad = REGIONS.gulf.pads.find((p) => p.id === 'olm')!;
    const spec = designToSpec(BUILTIN_DESIGNS[3]);
    const v = w.spawnOnPad({ name: 'S', stages: [spec.stages[1]] }, 'ship', 'gulf', 'olm', 0, [0.06]);
    w.anchors.delete(v); v.state = 'flying';
    placeEntry(w, v, 'gulf', pad.x, pad.z, D, G, VV, AZ);
    v.ap = new ShipReturnProgram(v, { region: 'gulf', pad, x: pad.x, z: pad.z, y: pad.top + 12, catchTower: true });
  }, 3000);
}
if (which === 'lunar') {
  const e = new Ephemeris(0); e.setLocalHour(-97.157, 10);
  const w = new World(e, ['gulf', 'lunar']);
  w.on((ev) => { if (ev.text) console.log(`  [T${ev.t.toFixed(1)}] ${ev.vehicle?.name ?? ''}: ${ev.text} ${ev.data ? JSON.stringify(ev.data) : ''}`); });
  const spec = designToSpec(BUILTIN_DESIGNS[6]);
  const v = spawnFree(w, { name: 'HLS', stages: [spec.stages[1]] }, 'lander', [0.35]);
  const pad = REGIONS.lunar.pads[0];
  placeOrbit(w, v, Number(process.env.H || 15000), 'moon', REGIONS.lunar.lat, REGIONS.lunar.lon, 180, -Number(process.env.PH || 5.5));
  v.ap = new LunarDescentProgram(v, { region: 'lunar', pad, x: pad.x, z: pad.z, y: pad.top });
  let last = 0;
  while (w.t < 1500 && v.state === 'flying') { w.step(w.dt); if (w.t - last > 20) { last = w.t; console.log(`t=${w.t.toFixed(0)} alt=${(v.tel.alt/1000).toFixed(2)} vs=${v.tel.vSurf.toFixed(0)} vv=${v.tel.vVert.toFixed(1)} prop=${(v.propFrac*100).toFixed(1)}% thr=${v.cmdThrottle.toFixed(2)} ${v.ap.phase} ${v.ap.status}`); } }
  console.log('END', v.state, w.toLocal('lunar', v.pos));
}
if (which === 'dock') {
  const e = new Ephemeris(0); e.setLocalHour(-97.157, 10);
  const w = new World(e, ['gulf']);
  w.on((ev) => { if (ev.text) console.log(`  [T${ev.t.toFixed(1)}] ${ev.vehicle?.name ?? ''}: ${ev.text}`); });
  const spec = designToSpec(BUILTIN_DESIGNS[4]);
  const tgt = spawnFree(w, { name: 'Depot', stages: [spec.stages[1]] }, 'ship', [0.2]);
  placeOrbit(w, tgt, 250000, 'earth', 20, -60, 90, 0);
  const tk = spawnFree(w, { name: 'Tanker', stages: [spec.stages[1]] }, 'tanker', [0.9]);
  placeOrbit(w, tk, 250000, 'earth', 20, -60, 90, -0.004);
  tk.pos.addScaledVector(tk.pos.clone().normalize(), 40);
  const ap = new DockingProgram(tk, tgt, 400000); tk.ap = ap;
  let last = 0;
  while (w.t < 3000 && !ap.done) { w.step(w.dt); if (w.t - last > 60) { last = w.t; console.log(`t=${w.t.toFixed(0)} ${ap.phase} ${ap.status} alt=${(tk.tel.alt/1000).toFixed(1)}`); } }
  console.log('END', ap.docked, ap.transferred, tgt.tel.alt);
}
if (which === 'tli') {
  const e = new Ephemeris(0); e.setLocalHour(-97.157, 10);
  const w = new World(e, ['gulf', 'lunar']);
  w.on((ev) => { if (ev.text) console.log(`  [T${ev.t.toFixed(1)}] ${ev.vehicle?.name ?? ''}: ${ev.text} ${ev.data ? JSON.stringify(ev.data) : ''}`); });
  const spec = designToSpec(BUILTIN_DESIGNS[6]);
  const v = spawnFree(w, { name: 'HLS', stages: [spec.stages[1]] }, 'lander', [1]);
  placeOrbit(w, v, 300000, 'earth', 0, -60, 70, 0);
  const t0 = Date.now();
  const node = planTLI(w, v)!;
  console.log('plan', node, (Date.now() - t0) + 'ms', (planTLI as any).last);
  { const { kepler, elements } = await import('../src/sim/orbit'); const r = new THREE.Vector3(), vv = new THREE.Vector3(); kepler(v.pos, v.vel, node.t - w.t, 3.986004418e14, r, vv); vv.addScaledVector(vv.clone().normalize(), node.pro); const el = elements(r, vv, 3.986004418e14, 6371000); console.log('predicted apo', el.apo / 1000, 'vel before', v.vel.length()); }
  v.ap = new SequenceProgram(v, [() => new TliBurnProgram(v, node as any), () => { const mc = planMidCourse(w, v); console.log('MCC', mc); return new BurnProgram(v, mc, 'Koerscorrectie', 'vac'); }, () => new LunarCaptureProgram(v)]);
  let last = 0;
  while (w.t < 6 * 86400 && !v.ap.done && v.state === 'flying') {
    const busy = v.ap.busy();
    const cur = (v.ap as any).cur;
    const pending = cur && (cur.node ? cur.node.t - w.t : cur.burn ? cur.burn.node.t - w.t : 1e9);
    w.warp = busy || pending < 120 ? 1 : pending < 2000 ? 20 : 200;
    w.advance(busy ? 0.02 : 30, v);
    if ((v as any)._wasBusy && !busy) { const { elements } = await import('../src/sim/orbit'); const el = elements(v.pos, v.vel, 3.986004418e14, 6371000); console.log('post', el.apo/1000, el.peri/1000, el.e); }
    (v as any)._wasBusy = busy;
    if (w.t - last > 3600 * 6 || (busy && w.t - last > 60)) { last = w.t; const mp = w.ephem.moonPos(w.t); console.log(`t=${(w.t/3600).toFixed(2)}h dMoon=${(v.pos.distanceTo(mp)/1000).toFixed(0)}km ${v.ap.phase} ${v.ap.status} prop=${(v.propFrac*100).toFixed(0)}%`); }
  }
  console.log('END', v.state, v.tel.body, v.tel.alt);
}
