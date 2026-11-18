// Gedeelde terreinfuncties (fysica + weergave). Lokale coördinaten: x=oost, z=zuid (m).
export function hash2(x: number, y: number) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x: number, y: number, oct = 5) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; }
  return s;
}
export interface PadDef { id: string; x: number; z: number; top: number; r: number; kind: 'olm' | 'pad' | 'stand' | 'platform' | 'lunarpad'; tower?: { x: number; z: number; h: number }; label: string; }
export interface RegionDef {
  id: string; body: 'earth' | 'moon'; lat: number; lon: number; extent: number;
  height: (x: number, z: number) => number; water: (x: number, z: number) => boolean;
  pads: PadDef[];
}
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function flatten(h: number, x: number, z: number, pads: { x: number; z: number; r: number }[], level = 1.2) {
  for (const p of pads) {
    const d = Math.hypot(x - p.x, z - p.z);
    const k = smooth(p.r * 1.0, p.r * 2.2, d);
    h = level * (1 - k) + h * k;
  }
  return h;
}

// --- Golfkust (Sterbasis + testlocatie + zeeplatform) ---
const gulfCoast = (z: number) => 2600 + 400 * Math.sin(z / 2700) + 150 * Math.sin(z / 730 + 1.3);
const gulfFlat = [{ x: 0, z: 0, r: 900 }, { x: -3300, z: -1440, r: 700 }];
export const GULF: RegionDef = {
  id: 'gulf', body: 'earth', lat: 25.997, lon: -97.157, extent: 45000,
  height(x, z) {
    const c = gulfCoast(z);
    const dx = c - x; // afstand tot kust (positief = land)
    if (dx < 0) return -2 - Math.min(-dx * 0.004, 60);
    const beach = smooth(0, 300, dx);
    let h = 0.4 + beach * (1.2 + 2.5 * fbm(x / 180, z / 180, 3) * smooth(80, 600, dx));
    // duinen langs de kust
    h += Math.max(0, Math.sin((dx) / 60) * 3) * smooth(100, 250, dx) * (1 - smooth(400, 900, dx)) * fbm(x / 400, z / 400, 2);
    // lagunes
    const lag = fbm(x / 2600 + 13, z / 2600 - 7, 4);
    if (lag < 0.36 && dx > 900) h = Math.min(h, (lag - 0.36) * 60);
    // heuvels in de verte
    h += Math.max(0, -x - 14000) * 0.004 * fbm(x / 5000, z / 5000, 3) * 2;
    return flatten(h, x, z, gulfFlat);
  },
  water(x, z) { return this.height(x, z) < 0; },
  pads: [
    { id: 'olm', x: 0, z: 0, top: 22, r: 5.5, kind: 'olm', tower: { x: -24, z: 0, h: 146 }, label: 'Orbital Launch Mount A (Pad 1)' },
    { id: 'olm2', x: 0, z: 280, top: 22, r: 5.5, kind: 'olm', tower: { x: -24, z: 280, h: 146 }, label: 'Orbital Launch Mount B (Pad 2)' },
    { id: 'stand', x: -3300, z: -1440, top: 14, r: 5, kind: 'stand', label: "Massey's statische teststand" },
    { id: 'padB', x: -3000, z: -1200, top: 1.6, r: 18, kind: 'pad', label: 'Suborbital Pad B' },
    { id: 'padC', x: -3650, z: -1150, top: 1.6, r: 18, kind: 'pad', label: 'Suborbital Pad C' },
    { id: 'platform', x: 29700, z: 0, top: 10, r: 46, kind: 'platform', label: 'Offshore platform "Deimos"' },
  ],
};
// --- Kaap ---
const capeCoast = (z: number) => 1800 + 900 * Math.sin(z / 5200) + 120 * Math.sin(z / 600);
export const CAPE: RegionDef = {
  id: 'cape', body: 'earth', lat: 28.608, lon: -80.604, extent: 45000,
  height(x, z) {
    const dx = capeCoast(z) - x;
    if (dx < 0) return -2 - Math.min(-dx * 0.004, 60);
    let h = 0.6 + smooth(0, 200, dx) * (1.5 + 3 * fbm(x / 250, z / 250, 3));
    const riv = Math.abs(x + 6000 + 1500 * Math.sin(z / 4000));
    if (riv < 1600) h = Math.min(h, -1 + riv / 900);
    return flatten(h, x, z, [{ x: 0, z: 0, r: 900 }]);
  },
  water(x, z) { return this.height(x, z) < 0; },
  pads: [{ id: 'olm', x: 0, z: 0, top: 22, r: 5.5, kind: 'olm', tower: { x: -24, z: 0, h: 146 }, label: 'LC-39A' }],
};
// --- Maan ---
const craters: { x: number; z: number; r: number }[] = [];
for (let i = 0; i < 160; i++) {
  const a = hash2(i, 7) * Math.PI * 2, d = 1500 + Math.pow(hash2(i, 9), 0.7) * 40000;
  craters.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, r: 40 + Math.pow(hash2(i, 11), 3) * 2500 });
}
export const MOON_CRATERS = craters;
export const LUNAR: RegionDef = {
  id: 'lunar', body: 'moon', lat: -84.5, lon: 30, extent: 40000,
  height(x, z) {
    let h = fbm(x / 3000, z / 3000, 5) * 220 - 110 + fbm(x / 120, z / 120, 3) * 6;
    for (const c of craters) {
      const d = Math.hypot(x - c.x, z - c.z) / c.r;
      if (d < 1.6) {
        if (d < 1) h += c.r * 0.18 * (d * d - 1) * 0.6;
        h += c.r * 0.05 * Math.exp(-((d - 1) ** 2) * 18);
      }
    }
    return flatten(h, x, z, [{ x: 0, z: 0, r: 700 }], 0);
  },
  water() { return false; },
  pads: [
    { id: 'lpad', x: 0, z: 0, top: 0.4, r: 25, kind: 'lunarpad', label: 'HLS-landingsplaats 1' },
    { id: 'lpad2', x: 180, z: 60, top: 0.4, r: 25, kind: 'lunarpad', label: 'HLS-landingsplaats 2' },
  ],
};
export const REGIONS: Record<string, RegionDef> = { gulf: GULF, cape: CAPE, lunar: LUNAR };
