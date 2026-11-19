// Kaartweergave: voorspelde baan (Kepler) met apo-/perigeummarkeringen
import * as THREE from 'three';
import type { World } from '../sim/world';
import type { Vehicle } from '../sim/vehicle';
import { MU_E, R_E, MU_M, R_M } from '../sim/constants';
import { elements, kepler } from '../sim/orbit';

const N = 240;
export class MapLines {
  group = new THREE.Group();
  lines: { line: THREE.Line; geo: THREE.BufferGeometry; pts: Float32Array }[] = [];
  apo: THREE.Mesh; peri: THREE.Mesh;
  center = new THREE.Vector3(); // lichaamscentrum (ECI) van de getekende baan
  t = 0; info: { apo: number; peri: number; body: string } | null = null;
  constructor() {
    const cols = [0x5fd4ff, 0xffb347, 0x8cff9e];
    for (let i = 0; i < 3; i++) {
      const pts = new Float32Array(N * 3); const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: cols[i], transparent: true, opacity: 0.9, depthTest: true }));
      line.frustumCulled = false; line.visible = false;
      this.group.add(line); this.lines.push({ line, geo, pts });
    }
    const sg = new THREE.SphereGeometry(1, 12, 8);
    this.apo = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0xffb347 }));
    this.peri = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0x5fd4ff }));
    this.lines[0].line.add(this.apo, this.peri);
    this.group.visible = false;
  }
  // relatieve punten (t.o.v. lichaamscentrum) opnieuw berekenen
  private compute(i: number, w: World, v: Vehicle, origin: THREE.Vector3, camDist: number) {
    const L = this.lines[i];
    const moon = v.tel.body === 'moon';
    const mu = moon ? MU_M : MU_E, R = moon ? R_M : R_E;
    const c = moon ? w.ephem.moonPos(w.t, new THREE.Vector3()) : new THREE.Vector3();
    let vb = new THREE.Vector3();
    if (moon) { const c2 = w.ephem.moonPos(w.t + 1, new THREE.Vector3()); vb = c2.sub(c); }
    const r0 = v.pos.clone().sub(c), v0 = v.vel.clone().sub(vb);
    const el = elements(r0, v0, mu, R);
    // tijdsduur: één omloop of tot inslag / ver weg
    const T = el.e < 1 && isFinite(el.period) ? el.period : 3 * 86400;
    const dt = Math.min(T, 4 * 86400) / (N - 1);
    const r = new THREE.Vector3(), vv = new THREE.Vector3();
    let last = 0;
    for (let k = 0; k < N; k++) {
      if (k === 0) r.copy(r0); else kepler(r0, v0, dt * k, mu, r, vv);
      if (k > 0 && r.length() < R * 0.999) { break; }
      L.pts[k * 3] = r.x; L.pts[k * 3 + 1] = r.y; L.pts[k * 3 + 2] = r.z;
      last = k;
    }
    L.geo.setDrawRange(0, last + 1);
    (L.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    L.line.visible = last > 1; L.line.userData.c = c.clone();
    if (i === 0) {
      this.info = { apo: el.apo, peri: el.peri, body: moon ? 'moon' : 'earth' };
      const s = camDist * 0.006;
      const ev = el.evec.clone(); const e = ev.length();
      if (e > 1e-4) {
        ev.normalize();
        const a = el.a; const rp = a * (1 - e), ra = a * (1 + e);
        this.peri.position.copy(ev).multiplyScalar(rp); this.peri.scale.setScalar(s); this.peri.visible = el.peri > -R * 0.9;
        this.apo.position.copy(ev).multiplyScalar(-ra); this.apo.scale.setScalar(s); this.apo.visible = e < 1;
      } else { this.apo.visible = this.peri.visible = false; }
    }
  }
  place(origin: THREE.Vector3) { for (const L of this.lines) if (L.line.userData.c) L.line.position.copy(L.line.userData.c).sub(origin); }
  update(w: World, focus: Vehicle | null, origin: THREE.Vector3, camDist: number, show: boolean) {
    this.group.visible = show && !!focus;
    if (!this.group.visible || !focus) return;
    const vs = [focus, ...w.vehicles.filter((x) => x !== focus && x.state === 'flying')].slice(0, 3);
    for (let i = 0; i < 3; i++) {
      const v = vs[i];
      if (!v || v.state === 'destroyed' || v.state === 'landed' || v.state === 'clamped') { this.lines[i].line.visible = false; if (i === 0) this.apo.visible = this.peri.visible = false; continue; }
      this.compute(i, w, v, origin, camDist);
    }
  }
}
