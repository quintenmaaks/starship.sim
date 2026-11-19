import * as THREE from 'three';
import { FlightSetup, missionById } from '../src/flight/setup';
import { BUILTIN_DESIGNS } from '../src/game/parts';
import { kepler } from '../src/sim/orbit';
const f = new FlightSetup({ mission: missionById('sc_tli'), design: BUILTIN_DESIGNS[6], headless: true, seed: 7, sandbox: true });
const w = f.world; const s = f.ship!;
const MU = 3.986004418e14;
for (const dv of [3100, 3130, 3150, 3170]) {
  let best = 1e18, bt = 0, bta = 0;
  for (let tDep = 120; tDep < 5600; tDep += 120) {
    const r = new THREE.Vector3(), v = new THREE.Vector3(); kepler(s.pos, s.vel, tDep, MU, r, v);
    v.addScaledVector(v.clone().normalize(), dv);
    let pr = r.clone(), pv = v.clone(); const rr = new THREE.Vector3(), vv = new THREE.Vector3();
    for (let t = 0; t < 6 * 86400; t += 1800) { kepler(pr, pv, 1800, MU, rr, vv); pr.copy(rr); pv.copy(vv); const d = pr.distanceTo(w.ephem.moonPos(w.t + tDep + t + 1800)); if (d < best) { best = d; bt = tDep; bta = t; } }
  }
  console.log(dv, 'minD km', (best / 1e3).toFixed(0), 'tDep', bt, 'arrive d', (bta / 86400).toFixed(2));
}
