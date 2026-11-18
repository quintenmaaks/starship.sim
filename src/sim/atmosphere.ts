// US Standard Atmosphere 1976 (vereenvoudigd, tot 86 km) + exponentiële staart
import { P0 } from './constants';
const layers = [
  { h: 0, T: 288.15, L: -0.0065, p: 101325 },
  { h: 11000, T: 216.65, L: 0, p: 22632.1 },
  { h: 20000, T: 216.65, L: 0.001, p: 5474.89 },
  { h: 32000, T: 228.65, L: 0.0028, p: 868.019 },
  { h: 47000, T: 270.65, L: 0, p: 110.906 },
  { h: 51000, T: 270.65, L: -0.0028, p: 66.9389 },
  { h: 71000, T: 214.65, L: -0.002, p: 3.95642 },
  { h: 86000, T: 186.87, L: 0, p: 0.3734 },
];
const R = 287.053, g = 9.80665, GAMMA = 1.4;
export interface AtmoSample { p: number; rho: number; T: number; a: number; }
const out: AtmoSample = { p: 0, rho: 0, T: 0, a: 0 };
export function atmosphere(h: number, o: AtmoSample = out): AtmoSample {
  if (h < 0) h = 0;
  if (h > 86000) {
    const T = 186.87 + Math.min((h - 86000) * 0.004, 600);
    const p = 0.3734 * Math.exp(-(h - 86000) / 6500);
    o.p = p; o.T = T; o.rho = h > 160000 ? 0 : p / (R * T); o.a = Math.sqrt(GAMMA * R * Math.min(T, 300));
    return o;
  }
  let i = layers.length - 1;
  while (layers[i].h > h) i--;
  const l = layers[i];
  const dh = h - l.h;
  let T: number, p: number;
  if (l.L === 0) { T = l.T; p = l.p * Math.exp(-g * dh / (R * l.T)); }
  else { T = l.T + l.L * dh; p = l.p * Math.pow(T / l.T, -g / (l.L * R)); }
  o.p = p; o.T = T; o.rho = p / (R * T); o.a = Math.sqrt(GAMMA * R * T);
  return o;
}
export const pressureRatio = (h: number) => atmosphere(h).p / P0;
