// 2D-planeetweergave: textuur-sampling en orthografische bolweergave in een lage-resolutie buffer
import * as THREE from 'three';
import { vnoise } from '../sim/terrain';

export interface Tex { w: number; h: number; d: Uint8ClampedArray }
const texCache: Record<string, Tex | null> = {};
export function loadTex(url: string, maxW = 1024): Promise<Tex | null> {
  if (url in texCache) return Promise.resolve(texCache[url]);
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const w = Math.min(maxW, img.width), h = Math.round(w * img.height / img.width);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d', { willReadFrequently: true })!; x.drawImage(img, 0, 0, w, h);
      const t = { w, h, d: x.getImageData(0, 0, w, h).data };
      texCache[url] = t; res(t);
    };
    img.onerror = () => { texCache[url] = null; res(null); };
    img.src = url;
  });
}
export function getTex(url: string) { return texCache[url] || null; }
// procedurele wolkenkaart (alpha 0..255)
let clouds: Uint8ClampedArray | null = null; const CW = 512, CH = 256;
export function cloudMap() {
  if (clouds) return clouds;
  clouds = new Uint8ClampedArray(CW * CH);
  for (let y = 0; y < CH; y++) {
    const lat = (0.5 - y / CH) * Math.PI;
    const band = 0.55 + 0.25 * Math.cos(lat * 6) * Math.cos(lat); // ITCZ / stormbanden
    for (let x = 0; x < CW; x++) {
      // naadloos in lengte: ruis op cilinder
      const a = x / CW * Math.PI * 2, rr = 6;
      let n = 0, amp = 0.5, f = 1;
      for (let o = 0; o < 5; o++) { n += amp * vnoise(Math.cos(a) * rr * f + 50, Math.sin(a) * rr * f + y / CH * 12 * f); amp *= 0.5; f *= 2.1; }
      const v = Math.max(0, n * band - 0.32) * 3.2;
      clouds[y * CW + x] = Math.min(255, v * 255);
    }
  }
  return clouds;
}
function sample(t: Tex, u: number, v: number, out: number[]) {
  u = u - Math.floor(u); v = Math.min(0.9999, Math.max(0, v));
  const i = ((v * t.h | 0) * t.w + (u * t.w | 0)) * 4;
  out[0] = t.d[i]; out[1] = t.d[i + 1]; out[2] = t.d[i + 2];
}
const _c = [0, 0, 0], _n = [0, 0, 0];
const _p = new THREE.Vector3(), _q = new THREE.Quaternion();
// Kleur van een punt op het oppervlak (ECI-richting, eenheidsvector) incl. belichting
export function surfaceColor(body: 'earth' | 'moon', dir: THREE.Vector3, bodyQinv: THREE.Quaternion, sun: THREE.Vector3, out: number[], cloudRot = 0) {
  _p.copy(dir).applyQuaternion(bodyQinv);
  const lat = Math.asin(Math.max(-1, Math.min(1, _p.y))), lon = Math.atan2(-_p.z, _p.x);
  const u = (lon + Math.PI) / (Math.PI * 2), v = 0.5 - lat / Math.PI;
  const nl = dir.x * sun.x + dir.y * sun.y + dir.z * sun.z;
  if (body === 'earth') {
    const day = getTex('./tex/earth_day.jpg');
    if (day) sample(day, u, v, _c); else { _c[0] = 30; _c[1] = 70; _c[2] = 140; }
    const cm = cloudMap();
    const cu = u + cloudRot; const ci = ((v * CH | 0) * CW + (((cu - Math.floor(cu)) * CW) | 0));
    const cl = (cm[ci] || 0) / 255;
    const dk = Math.min(1, Math.max(0, (nl + 0.08) / 0.25));
    const lit = 0.06 + 1.15 * Math.max(0, nl);
    let r = (_c[0] * (1 - cl) + 245 * cl) * lit, g = (_c[1] * (1 - cl) + 248 * cl) * lit, b = (_c[2] * (1 - cl) + 255 * cl) * lit;
    // schemering: oranje rand
    const tw = Math.max(0, 1 - Math.abs(nl) * 6) * 0.5;
    r += 60 * tw; g += 20 * tw;
    // nachtlichten
    if (dk < 1) {
      const nt = getTex('./tex/earth_night.jpg');
      if (nt) { sample(nt, u, v, _n); const k = (1 - dk) * (1 - cl * 0.8) * 1.3; r += _n[0] * k; g += _n[1] * k * 0.8; b += _n[2] * k * 0.5; }
    }
    out[0] = r; out[1] = g; out[2] = b;
  } else {
    const mt = getTex('./tex/moon.jpg');
    if (mt) sample(mt, u, v, _c); else { _c[0] = _c[1] = _c[2] = 150; }
    const lit = 0.02 + 1.2 * Math.max(0, nl);
    out[0] = _c[0] * lit; out[1] = _c[1] * lit; out[2] = _c[2] * lit;
  }
  return out;
}

// Orthografische bolweergave: viewer kijkt langs -n; schermrechts = rx, schermop = ux (ECI-eenheidsvectoren)
export class SphereBuffer {
  c = document.createElement('canvas'); x: CanvasRenderingContext2D; img: ImageData | null = null;
  key = ''; t = 0;
  constructor() { this.x = this.c.getContext('2d')!; }
  // cx,cy = middelpunt in buffer-px, rad = straal in buffer-px; alleen het zichtbare deel (0..W, 0..H) wordt berekend
  render(body: 'earth' | 'moon', W: number, H: number, cx: number, cy: number, rad: number, rx: THREE.Vector3, ux: THREE.Vector3, nx: THREE.Vector3, bodyQ: THREE.Quaternion, sun: THREE.Vector3, cloudRot: number, atmo: boolean) {
    W = Math.max(1, Math.ceil(W)); H = Math.max(1, Math.ceil(H));
    if (this.c.width !== W || this.c.height !== H) { this.c.width = W; this.c.height = H; this.img = null; }
    if (!this.img) this.img = this.x.createImageData(W, H);
    const d = this.img.data; d.fill(0);
    const qi = _q.copy(bodyQ).invert();
    const dir = new THREE.Vector3(); const col = [0, 0, 0];
    const y0 = Math.max(0, Math.floor(cy - rad * (atmo ? 1.03 : 1))), y1 = Math.min(H, Math.ceil(cy + rad * (atmo ? 1.03 : 1)));
    const x0 = Math.max(0, Math.floor(cx - rad * (atmo ? 1.03 : 1))), x1 = Math.min(W, Math.ceil(cx + rad * (atmo ? 1.03 : 1)));
    const inv = 1 / rad;
    for (let py = y0; py < y1; py++) {
      const sy = (cy - py - 0.5) * inv;
      for (let px = x0; px < x1; px++) {
        const sx = (px + 0.5 - cx) * inv;
        const r2 = sx * sx + sy * sy;
        const i = (py * W + px) * 4;
        if (r2 > 1) {
          if (!atmo || r2 > 1.06) continue;
          // atmosfeergloed buiten de rand
          const e = Math.sqrt(r2) - 1; const k = Math.max(0, 1 - e / 0.03);
          dir.set(rx.x * sx + ux.x * sy, rx.y * sx + ux.y * sy, rx.z * sx + ux.z * sy).normalize();
          const nl = dir.dot(sun); const lk = Math.max(0, Math.min(1, nl * 2 + 0.4));
          d[i] = 90 * lk + 30; d[i + 1] = 150 * lk + 20; d[i + 2] = 255 * lk + 40; d[i + 3] = 255 * k * k * (0.25 + 0.75 * lk);
          continue;
        }
        const sz = Math.sqrt(1 - r2);
        dir.set(rx.x * sx + ux.x * sy + nx.x * sz, rx.y * sx + ux.y * sy + nx.y * sz, rx.z * sx + ux.z * sy + nx.z * sz);
        surfaceColor(body, dir, qi, sun, col, cloudRot);
        if (atmo) { // limb-verstrooiing
          const rim = Math.pow(1 - sz, 4) * 0.7; const nl = Math.max(0, dir.dot(sun) + 0.2);
          col[0] = col[0] * (1 - rim) + 110 * rim * nl; col[1] = col[1] * (1 - rim) + 170 * rim * nl; col[2] = col[2] * (1 - rim) + 255 * rim * nl;
        }
        d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
      }
    }
    this.x.putImageData(this.img, 0, 0);
    return this.c;
  }
}
