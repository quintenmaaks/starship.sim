import * as THREE from 'three';
import { World } from '../src/sim/world';
import { Ephemeris } from '../src/sim/bodies';
import { BUILTIN_DESIGNS, designToSpec } from '../src/game/parts';
import { point, localState } from '../src/sim/autopilot';
const e = new Ephemeris(0); e.setLocalHour(-97.157, 10);
const w = new World(e, ['gulf']); w.windStrength = 0;
const spec = designToSpec(BUILTIN_DESIGNS[3]);
const b = w.spawnOnPad({ name: 'SH', stages: [spec.stages[0]] }, 'booster', 'gulf', 'olm', 400, [0.05]);
w.release(b);
b.selectEngines('center');
for (let i = 0; i < 400; i++) {
  const ls = localState(w, b, 'gulf');
  const dir = new THREE.Vector3(0.05, 1, 0).normalize().applyQuaternion(ls.quat);
  point(b, dir, b.belly());
  b.cmdThrottle = 0.5;
  w.step(w.dt);
  if (i % 50 === 0) console.log(i, ls.p.toArray().map(x => x.toFixed(2)).join(','), ls.vel.toArray().map(x => x.toFixed(2)).join(','), b.nose().applyQuaternion(ls.inv).toArray().map(x => x.toFixed(3)).join(','), b.tel.thrust.toFixed(0));
}
