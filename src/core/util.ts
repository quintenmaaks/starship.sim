// Algemene hulpfuncties
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

// Deterministische RNG (mulberry32)
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export const pick = <T>(arr: T[], r: () => number = Math.random): T => arr[Math.floor(r() * arr.length)];

// Formattering (Nederlands)
const nf0 = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
export const fmt0 = (v: number) => nf0.format(v);
export const fmt1 = (v: number) => nf1.format(v);
export const fmt2 = (v: number) => nf2.format(v);
export function money(v: number, short = true) {
  const s = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (!short) return s + '€ ' + nf0.format(a);
  if (a >= 1e9) return s + '€ ' + nf2.format(a / 1e9) + ' mld';
  if (a >= 1e6) return s + '€ ' + nf1.format(a / 1e6) + ' mln';
  if (a >= 1e3) return s + '€ ' + nf0.format(a / 1e3) + 'k';
  return s + '€ ' + nf0.format(a);
}
export function dist(m: number) {
  const a = Math.abs(m);
  if (a >= 1e6) return nf0.format(m / 1000) + ' km';
  if (a >= 1e4) return nf1.format(m / 1000) + ' km';
  if (a >= 1000) return nf2.format(m / 1000) + ' km';
  return nf0.format(m) + ' m';
}
export function speed(ms: number) {
  return nf0.format(ms * 3.6) + ' km/u';
}
export function tplus(t: number) {
  const s = t < 0 ? '-' : '+';
  const a = Math.abs(t);
  const h = Math.floor(a / 3600), m = Math.floor((a % 3600) / 60), sec = Math.floor(a % 60);
  const p = (n: number) => String(n).padStart(2, '0');
  return `T${s}${p(h)}:${p(m)}:${p(sec)}`;
}
export function duration(sec: number) {
  if (sec < 60) return fmt0(sec) + ' s';
  if (sec < 3600) return Math.floor(sec / 60) + ' min ' + Math.floor(sec % 60) + ' s';
  if (sec < 86400) return Math.floor(sec / 3600) + ' u ' + Math.floor((sec % 3600) / 60) + ' min';
  return fmt1(sec / 86400) + ' dagen';
}
export const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
export function gameDate(day: number) {
  // dag 0 = 1 maart 2027
  const d = new Date(Date.UTC(2027, 2, 1) + day * 86400000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
export function $(sel: string, root: ParentNode = document) { return root.querySelector(sel) as HTMLElement; }
export function $$(sel: string, root: ParentNode = document) { return Array.from(root.querySelectorAll(sel)) as HTMLElement[]; }

// Simpele event-bus
type Fn = (...a: any[]) => void;
export class Emitter {
  private h: Record<string, Fn[]> = {};
  on(ev: string, f: Fn) { (this.h[ev] ||= []).push(f); return () => this.off(ev, f); }
  off(ev: string, f: Fn) { this.h[ev] = (this.h[ev] || []).filter((x) => x !== f); }
  emit(ev: string, ...a: any[]) { (this.h[ev] || []).slice().forEach((f) => f(...a)); }
}
export const bus = new Emitter();
