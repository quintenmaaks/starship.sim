import './style.css';
import { View } from './render/view';
import { App } from './app';
import { audio } from './ui/audio';
import { h } from './ui/dom';

const params = new URLSearchParams(location.search);
const bootBar = document.querySelector('#boot .boot-bar i') as HTMLElement | null;
const boot = document.getElementById('boot');
const msg = h('div', 'boot-msg', 'Starbase opstarten…'); boot?.append(msg);
const step = async (p: number, text: string) => { if (bootBar) bootBar.style.width = p + '%'; msg.textContent = text; await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30))); };

// draai-hint voor portretstand
document.body.append(h('div', 'rotate-hint', h('div', 'ph', '📱'), h('div', null, 'Draai je iPhone naar liggend'), h('div', { style: { fontSize: '11px' } } as any, 'Voor volledig scherm: Deel → "Zet op beginscherm"')));

async function start() {
  await step(10, 'Grafische motor laden…');
  let view: View;
  try { view = new View(document.getElementById('gl') as HTMLCanvasElement); }
  catch (e) {
    msg.textContent = 'WebGL kon niet starten op dit apparaat. Probeer Safari opnieuw te openen.';
    console.error(e); return;
  }
  (window as any).__view = view;
  await step(35, 'Aarde, Maan en sterren genereren…');
  const app = new App(view);
  (window as any).__app = app;
  await step(60, 'Starbase bouwen: OLM, Mechazilla, tankopslag…');
  if (params.has('qa')) { const { installQA } = await import('./qa'); installQA(app); }
  if (params.has('dev')) { const { devtest } = await import('./devtest'); devtest(view, params.get('dev') || 'launch'); }
  else app.menu();
  await step(85, 'Shaders compileren…');
  view.render(0.016);
  await step(100, 'Klaar voor lancering');
  audio.init();
  boot?.classList.add('fade'); setTimeout(() => boot?.remove(), 700);
}
start();

// service worker (offline / beginscherm)
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !params.has('nosw') && !location.hostname.match(/^(localhost|127\.)/)) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
