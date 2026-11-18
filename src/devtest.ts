import * as THREE from 'three';
import { World } from './sim/world';
import { Ephemeris } from './sim/bodies';
import { BUILTIN_DESIGNS, designToSpec } from './game/parts';
import { AscentProgram, BoostbackProgram } from './sim/autopilot';
import { REGIONS } from './sim/terrain';
import { View } from './render/view';

export function devtest(view: View, mode: string) {
  const e = new Ephemeris(0); e.setLocalHour(-97.157, Number(new URLSearchParams(location.search).get('hour') || 17));
  const w = new World(e, ['gulf', 'lunar']);
  view.setWorld(w);
  const v = w.spawnOnPad(designToSpec(BUILTIN_DESIGNS[3]), 'stack', 'gulf', 'olm');
  view.focus = v;
  const pad = REGIONS.gulf.pads.find((p) => p.id === 'olm')!;
  if (mode !== 'pad') {
    w.launchT = 3;
    v.ap = new AscentProgram(v, { apo: 200000, peri: -30000, azimuth: 92, boosterReserve: 0.115, onStage: (ship, b) => {
      b.ap = new BoostbackProgram(b, { region: 'gulf', pad, x: pad.x, z: pad.z, y: pad.top + 12, catchTower: true });
    } });
  }
  const skip = Number(new URLSearchParams(location.search).get('t') || 0);
  while (w.t < skip) w.step(w.dt);
  const cam = new URLSearchParams(location.search).get('cam');
  if (cam) view.setCam(cam as any);
  let last = performance.now();
  (window as any).__w = w; (window as any).__view = view; (window as any).THREE = THREE;
  const loop = () => {
    const now = performance.now(); const dt = Math.min(0.1, (now - last) / 1000); last = now;
    w.advance(dt, v);
    view.render(dt);
    requestAnimationFrame(loop);
  };
  loop();
}
