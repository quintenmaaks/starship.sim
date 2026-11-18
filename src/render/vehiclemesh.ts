import * as THREE from 'three';
import { StageSpec } from '../sim/spec';
import { Mats } from './materials';

// Procedureel voertuigmodel. Oorsprong = onderkant (motorvlak), +Y = neus, +Z = buikzijde (hitteschild).
export interface StageMesh {
  group: THREE.Group; spec: StageSpec;
  bells: THREE.Object3D[]; bellMats: THREE.MeshStandardMaterial[];
  flaps: { obj: THREE.Object3D; side: number; fwd: boolean }[];
  fins: THREE.Object3D[]; legs: THREE.Object3D[];
  frost: THREE.Mesh | null; shield: THREE.Mesh | null;
  length: number;
}

function ogive(R: number, L: number, segs = 20) {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const y = t * L;
    const r = R * Math.sqrt(Math.max(0, 1 - Math.pow(t, 2.2)));
    pts.push(new THREE.Vector2(Math.max(r, 0.02), y));
  }
  return pts;
}
function bellGeo(rThroat: number, rExit: number, len: number) {
  const pts: THREE.Vector2[] = [];
  pts.push(new THREE.Vector2(rThroat * 1.4, len + 0.6));
  pts.push(new THREE.Vector2(rThroat * 1.2, len + 0.2));
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    pts.push(new THREE.Vector2(rThroat + (rExit - rThroat) * Math.pow(t, 0.62), len * (1 - t)));
  }
  return new THREE.LatheGeometry(pts, 20);
}
function flapGeo(root: number, tip: number, span: number, th = 0.25) {
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(span, (root - tip) * 0.6); s.lineTo(span, (root - tip) * 0.6 + tip); s.lineTo(0, root); s.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: th, bevelEnabled: false });
  g.translate(0, 0, -th / 2);
  return g;
}

export function buildStage(spec: StageSpec, mats: Mats, opts: { variant?: string; crew?: boolean; hls?: boolean; hopper?: boolean } = {}): StageMesh {
  const g = new THREE.Group();
  const R = spec.diameter / 2;
  const L = spec.length;
  const bells: THREE.Object3D[] = [], bellMats: THREE.MeshStandardMaterial[] = [];
  const flaps: StageMesh['flaps'] = [], fins: THREE.Object3D[] = [], legs: THREE.Object3D[] = [];
  let shield: THREE.Mesh | null = null;
  const isShip = spec.kind === 'ship';
  const hopper = opts.hopper || (isShip && L < 25);
  const noseL = isShip ? (hopper ? R * 1.3 : R * 2.4) : 0;
  const skirt = 1.6;
  const bodyL = L - noseL;
  // motorrok
  const sk = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 1.0, skirt, 48, 1, true), mats.steelDark);
  sk.position.y = skirt / 2; sk.castShadow = true; g.add(sk);
  // hoofdlichaam
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, bodyL - skirt, 64, 1, false), mats.steel);
  body.position.y = skirt + (bodyL - skirt) / 2; body.castShadow = true; body.receiveShadow = true;
  (body.geometry as THREE.CylinderGeometry).attributes.uv.needsUpdate = true;
  g.add(body);
  // ijsaanslag (frost) op tanks na tanken
  const frost = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.004, R * 1.004, spec.tankLen * 0.92, 48, 1, true), mats.frost);
  frost.position.y = skirt + 1 + spec.tankLen * 0.46; frost.visible = false; g.add(frost);
  if (opts.hls) {
    // HLS: wit bovendeel, landingspoten, thrusters halverwege
    const wh = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.003, R * 1.003, bodyL * 0.45, 48, 1, true), mats.paintWhite);
    wh.position.y = bodyL * 0.75; g.add(wh);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const th = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.5, 0.6), mats.steelDark); th.position.set(Math.cos(a) * (R + 0.3), bodyL * 0.62, Math.sin(a) * (R + 0.3)); th.rotation.y = -a; g.add(th); }
  }
  if (isShip) {
    // neus
    const nose = new THREE.Mesh(new THREE.LatheGeometry(ogive(R, noseL), 64), opts.hls ? mats.paintWhite : mats.steel);
    nose.position.y = bodyL; nose.castShadow = true; g.add(nose);
    if (!hopper && !opts.hls && spec.heatShield > 0) {
      // hitteschild (buikzijde +Z): halve cilinder + neusdeel
      const sh = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.012, R * 1.012, bodyL - 0.4, 48, 1, true, -Math.PI * 0.5, Math.PI), mats.tiles);
      sh.position.y = (bodyL - 0.4) / 2 + 0.4; sh.receiveShadow = true; sh.castShadow = true;
      g.add(sh); shield = sh;
      const ns = new THREE.Mesh(new THREE.LatheGeometry(ogive(R * 1.012, noseL * 0.98), 48, -Math.PI * 0.5, Math.PI), mats.tiles);
      ns.position.y = bodyL; g.add(ns);
    }
    if (spec.flaps) {
      const mk = (fwd: boolean, side: number) => {
        const pivot = new THREE.Group();
        const root = fwd ? 6 : 10, tip = fwd ? 3.5 : 6, span = fwd ? 3.2 : 4.4;
        const m = new THREE.Mesh(flapGeo(root, tip, span, 0.35), mats.tiles);
        m.castShadow = true;
        const holder = new THREE.Group(); holder.add(m);
        holder.rotation.y = side > 0 ? 0 : Math.PI;
        pivot.add(holder);
        pivot.position.set(side * R * 0.98, fwd ? bodyL + noseL * 0.05 - 3 : 2.2, 0.8);
        g.add(pivot);
        flaps.push({ obj: pivot, side, fwd });
      };
      mk(true, 1); mk(true, -1); mk(false, 1); mk(false, -1);
    }
    if (opts.crew || spec.cabin) {
      // ramen
      for (let i = 0; i < 14; i++) {
        const a = -Math.PI / 2 + Math.PI + (i / 14 - 0.5) * 1.6;
        const w = new THREE.Mesh(new THREE.CircleGeometry(0.35, 12), mats.glass);
        const yy = bodyL - 2.5 - (i % 2) * 1.2;
        w.position.set(Math.sin(a) * (R + 0.02), yy, Math.cos(a) * (R + 0.02)); w.lookAt(w.position.clone().multiplyScalar(2).setY(yy));
        g.add(w);
      }
    }
    if (spec.payloadBay && !spec.tanker && !opts.hls) {
      const door = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.4), mats.black);
      door.position.set(0, bodyL - 6, -R - 0.03); door.rotation.y = Math.PI; g.add(door);
    }
  } else {
    // booster: hot-staging-ring met ventilatieopeningen
    const hs = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 2.2, 48, 1, true), mats.steelDark);
    hs.position.y = L - 1.1; g.add(hs);
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2;
      const v = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.4), mats.black);
      v.position.set(Math.sin(a) * (R + 0.02), L - 1.1, Math.cos(a) * (R + 0.02)); v.rotation.y = a; g.add(v);
    }
    const top = new THREE.Mesh(new THREE.CircleGeometry(R, 48), mats.steelDark); top.rotation.x = -Math.PI / 2; top.position.y = L; g.add(top);
    // chines
    for (const s of [-1, 1]) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.5, L * 0.6, 0.9), mats.steel); c.position.set(s * (R + 0.2), L * 0.5, 0); g.add(c); }
    if (spec.gridFins) {
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + i * Math.PI / 2;
        const piv = new THREE.Group();
        piv.position.set(Math.sin(a) * R, L - 4.2, Math.cos(a) * R); piv.rotation.y = a;
        const fin = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.35, 2.8), mats.gridFin);
        fin.position.set(0, 0, 1.4 + 0.2);
        const finFace = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.8), mats.gridFin);
        finFace.rotation.x = -Math.PI / 2; finFace.position.set(0, 0.2, 1.6);
        piv.add(fin, finFace);
        g.add(piv); fins.push(piv);
      }
    }
    // vangpinnen
    if (spec.catchPins) for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 1.6), mats.steelDark); p.position.set(0, L * 0.86, s * (R + 0.7)); g.add(p); }
  }
  if (spec.legs) {
    const n = hopper ? 3 : 6;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + Math.PI / n;
      const piv = new THREE.Group();
      piv.position.set(Math.sin(a) * R * 0.95, skirt + 2.5, Math.cos(a) * R * 0.95); piv.rotation.y = a;
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4.5, 0.5), mats.steelDark);
      leg.position.set(0, -2.25, 0);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.2, 10), mats.steelDark); foot.position.set(0, -4.5, 0);
      const hold = new THREE.Group(); hold.add(leg, foot);
      piv.add(hold); g.add(piv); legs.push(piv);
    }
  }
  // motoren
  for (const e of spec.engines) {
    const vac = e.kind === 'vac';
    const len = vac ? 3.2 : 1.7, rex = vac ? 1.15 : 0.65;
    const m = mats.engine.clone(); bellMats.push(m);
    const bell = new THREE.Mesh(bellGeo(0.25, rex, len), m);
    const piv = new THREE.Group(); piv.position.set(e.x, 0.8, e.z);
    bell.position.y = -len; piv.add(bell);
    // motorkop (turbopomp) blok
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 1.0, 10), mats.steelDark); head.position.y = 1.1 - len + len; piv.add(head);
    g.add(piv); bells.push(piv);
  }
  return { group: g, spec, bells, bellMats, flaps, fins, legs, frost, shield, length: L };
}
