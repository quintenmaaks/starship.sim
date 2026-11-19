// Kleine DOM-helpers: elementen, toasts, modals, confetti
import { audio } from './audio';

type Child = Node | string | null | undefined | false;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> | string | null = null, ...kids: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (typeof attrs === 'string') e.className = attrs;
  else if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      const ev = k.slice(2).toLowerCase();
      if (ev === 'click' || ev === 'tap') e.addEventListener('click', (x) => { audio.unlock(); audio.click(); audio.haptic(8); v(x); });
      else e.addEventListener(ev, v);
    } else e.setAttribute(k, String(v));
  }
  for (const k of kids.flat()) {
    if (k === null || k === undefined || k === false) continue;
    if (typeof k === 'object' && !(k instanceof Node)) { // attributen als kind meegegeven
      const a = k as any;
      for (const key in a) { if (key === 'style' && typeof a[key] === 'object') Object.assign(e.style, a[key]); else if (key === 'class') e.className += ' ' + a[key]; else e.setAttribute(key, String(a[key])); }
      continue;
    }
    e.append(k as any);
  }
  return e;
}
export const btn = (label: string, onClick: () => void, cls = '') => h('button', { class: 'btn ' + cls, onClick }, label);
export function clear(e: HTMLElement) { while (e.firstChild) e.removeChild(e.firstChild); return e; }

let toastBox: HTMLElement | null = null;
export function toast(text: string, kind: '' | 'good' | 'bad' | 'gold' = '', ms = 2600) {
  const ui = document.getElementById('ui')!;
  if (!toastBox || !toastBox.isConnected) { toastBox = h('div', 'toastbox'); ui.append(toastBox); }
  const t = h('div', 'toast glass ' + kind, text);
  toastBox.append(t);
  setTimeout(() => { t.style.transition = 'opacity .5s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 500); }, ms);
}
export function modal(title: string, body: HTMLElement | string, buttons: { label: string; cls?: string; onClick?: () => boolean | void }[] = [{ label: 'Sluiten' }], wide = false) {
  const ui = document.getElementById('ui')!;
  const bg = h('div', 'modal-bg');
  const close = () => { bg.remove(); };
  const box = h('div', 'modal glass' + (wide ? ' wide' : ''),
    h('h2', null, title),
    h('div', 'mbody scroll', typeof body === 'string' ? h('div', { html: body }) : body),
    h('div', 'row', h('div', 'grow'), ...buttons.map((b) => h('button', { class: 'btn ' + (b.cls || ''), onClick: () => { const keep = b.onClick?.(); if (keep !== true) close(); } }, b.label))));
  bg.append(box);
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  ui.append(bg);
  return { close, box };
}
export function confirmBox(title: string, text: string, okLabel: string, onOk: () => void, cls = 'primary') {
  modal(title, h('p', { html: text }), [{ label: 'Annuleren', cls: 'ghost' }, { label: okLabel, cls, onClick: onOk }]);
}
export function confetti(n = 90) {
  const ui = document.getElementById('ui')!;
  const c = h('div', 'confetti');
  const cols = ['#ffd36b', '#5fd4ff', '#4be38a', '#ffffff', '#ff7a6a', '#c58cff'];
  for (let i = 0; i < n; i++) {
    const p = h('i');
    p.style.left = Math.random() * 100 + '%';
    p.style.background = cols[i % cols.length];
    p.style.animationDuration = (1.8 + Math.random() * 1.8) + 's';
    p.style.animationDelay = Math.random() * 0.6 + 's';
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    c.append(p);
  }
  ui.append(c);
  setTimeout(() => c.remove(), 4500);
}
// telt een getal op in een element (voor beloningen)
export function countUp(e: HTMLElement, to: number, fmt: (v: number) => string, ms = 900, delay = 0) {
  const start = performance.now() + delay;
  const step = (now: number) => {
    const t = Math.min(1, Math.max(0, (now - start) / ms));
    const k = 1 - Math.pow(1 - t, 3);
    e.textContent = fmt(to * k);
    if (t < 1) requestAnimationFrame(step);
  };
  e.textContent = fmt(0);
  requestAnimationFrame(step);
}
// SVG-sparkline / lijngrafiek
export function lineChart(pts: { x: number; y: number }[], w = 400, hgt = 140, color = '#5fd4ff', labels = true) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`); svg.setAttribute('class', 'chart'); svg.setAttribute('preserveAspectRatio', 'none');
  if (pts.length < 2) return svg as unknown as HTMLElement;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys) * 0.96, y1 = Math.max(...ys) * 1.04;
  const X = (x: number) => ((x - x0) / Math.max(1e-9, x1 - x0)) * (w - 4) + 2;
  const Y = (y: number) => hgt - 4 - ((y - y0) / Math.max(1e-9, y1 - y0)) * (hgt - 8);
  let d = '';
  pts.forEach((p, i) => { d += (i ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1); });
  const grad = document.createElementNS(ns, 'linearGradient'); grad.setAttribute('id', 'lg' + color.slice(1)); grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0'); grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1');
  grad.innerHTML = `<stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>`;
  const defs = document.createElementNS(ns, 'defs'); defs.append(grad); svg.append(defs);
  const area = document.createElementNS(ns, 'path'); area.setAttribute('d', d + `L${X(x1)} ${hgt}L${X(x0)} ${hgt}Z`); area.setAttribute('fill', `url(#lg${color.slice(1)})`); svg.append(area);
  const line = document.createElementNS(ns, 'path'); line.setAttribute('d', d); line.setAttribute('fill', 'none'); line.setAttribute('stroke', color); line.setAttribute('stroke-width', '2'); line.setAttribute('vector-effect', 'non-scaling-stroke'); svg.append(line);
  if (labels) {
    for (const [v, y] of [[y1 / 1.04, 12], [y0 / 0.96, hgt - 4]] as [number, number][]) {
      const t = document.createElementNS(ns, 'text'); t.setAttribute('x', '4'); t.setAttribute('y', String(y)); t.setAttribute('fill', 'rgba(255,255,255,.5)'); t.setAttribute('font-size', '10'); t.textContent = '€ ' + v.toFixed(2); svg.append(t);
    }
  }
  return svg as unknown as HTMLElement;
}
// Cirkelmeter (webcast-stijl)
export function gauge(label: string, unit: string) {
  const wrap = h('div', 'gauge');
  wrap.innerHTML = `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="rgba(8,12,18,.55)" stroke="rgba(255,255,255,.15)" stroke-width="5" stroke-dasharray="198 66" transform="rotate(135 50 50)"/><circle class="arc" cx="50" cy="50" r="42" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-dasharray="0 264" transform="rotate(135 50 50)"/></svg><div class="gv"><b>0</b><span>${unit}</span></div><div class="gl">${label}</div>`;
  const arc = wrap.querySelector('.arc') as SVGCircleElement, val = wrap.querySelector('b')!, un = wrap.querySelector('.gv span')!;
  return { el: wrap, set(v: string, frac: number, u?: string) { val.textContent = v; if (u) un.textContent = u; arc.setAttribute('stroke-dasharray', `${(Math.max(0, Math.min(1, frac)) * 198).toFixed(1)} 264`); } };
}
