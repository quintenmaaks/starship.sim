import * as THREE from 'three';
// Kepler-baanelementen + propagatie (patched conics)
export interface Elements { a: number; e: number; i: number; apo: number; peri: number; period: number; energy: number; h: THREE.Vector3; evec: THREE.Vector3; nu: number; }
const _h = new THREE.Vector3(), _e = new THREE.Vector3(), _t = new THREE.Vector3();
export function elements(r: THREE.Vector3, v: THREE.Vector3, mu: number, bodyR: number, axis = new THREE.Vector3(0, 1, 0)): Elements {
  const rl = r.length(), v2 = v.lengthSq();
  const energy = v2 / 2 - mu / rl;
  const h = _h.crossVectors(r, v);
  const evec = _e.crossVectors(v, h).multiplyScalar(1 / mu).sub(_t.copy(r).multiplyScalar(1 / rl));
  const e = evec.length();
  const a = -mu / (2 * energy);
  const hl = h.length();
  const p = hl * hl / mu;
  const peri = p / (1 + e) - bodyR;
  const apo = e < 1 ? a * (1 + e) - bodyR : Infinity;
  const i = Math.acos(Math.max(-1, Math.min(1, h.dot(axis) / (hl || 1))));
  const period = e < 1 ? 2 * Math.PI * Math.sqrt(a * a * a / mu) : Infinity;
  let nu = Math.acos(Math.max(-1, Math.min(1, evec.dot(r) / ((e || 1e-9) * rl))));
  if (r.dot(v) < 0) nu = 2 * Math.PI - nu;
  return { a, e, i, apo, peri, period, energy, h: h.clone(), evec: evec.clone(), nu };
}

// Universele-variabele Kepler-propagatie (Vallado)
function stumpC(z: number) { return z > 1e-6 ? (1 - Math.cos(Math.sqrt(z))) / z : z < -1e-6 ? (Math.cosh(Math.sqrt(-z)) - 1) / -z : 0.5 - z / 24; }
function stumpS(z: number) {
  if (z > 1e-6) { const s = Math.sqrt(z); return (s - Math.sin(s)) / (s * s * s); }
  if (z < -1e-6) { const s = Math.sqrt(-z); return (Math.sinh(s) - s) / (s * s * s); }
  return 1 / 6 - z / 120;
}
export function kepler(r0: THREE.Vector3, v0: THREE.Vector3, dt: number, mu: number, rOut: THREE.Vector3, vOut: THREE.Vector3) {
  const r0l = r0.length();
  const vr0 = r0.dot(v0) / r0l;
  const alpha = 2 / r0l - v0.lengthSq() / mu;
  const sq = Math.sqrt(mu);
  let x = sq * Math.abs(alpha) * dt;
  if (Math.abs(alpha) < 1e-12) x = sq * dt / r0l;
  for (let k = 0; k < 60; k++) {
    const z = alpha * x * x;
    const C = stumpC(z), S = stumpS(z);
    const F = r0l * vr0 / sq * x * x * C + (1 - alpha * r0l) * x * x * x * S + r0l * x - sq * dt;
    const dF = r0l * vr0 / sq * x * (1 - alpha * x * x * S) + (1 - alpha * r0l) * x * x * C + r0l;
    const dx = F / dF;
    x -= dx;
    if (Math.abs(dx) < 1e-8) break;
  }
  const z = alpha * x * x;
  const C = stumpC(z), S = stumpS(z);
  const f = 1 - x * x / r0l * C;
  const g = dt - x * x * x / sq * S;
  rOut.copy(r0).multiplyScalar(f).addScaledVector(v0, g);
  const rl = rOut.length();
  const fd = sq / (rl * r0l) * (alpha * x * x * x * S - x);
  const gd = 1 - x * x / rl * C;
  const vx = v0.clone();
  vOut.copy(r0).multiplyScalar(fd).addScaledVector(vx, gd);
}
