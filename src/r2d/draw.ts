// 2D-tekenroutines: voertuigtrappen (roestvrij staal), motoren, scenery (Starbase, Mechazilla)
import type { StageSpec } from '../sim/spec';

export const PPM = 9; // sprite-resolutie in pixels per meter
const M = 7;          // zijmarge (m) voor flaps/roosterroeren/poten
const BELOW = 5;      // ruimte onder de trap voor motorklokken (m)
export interface StageSprite { c: HTMLCanvasElement; w: number; h: number; ox: number; oy: number } // ox,oy = onderkant-midden van de romp in sprite-px

function steel(x: CanvasRenderingContext2D, x0: number, x1: number, white = false) {
  const g = x.createLinearGradient(x0, 0, x1, 0);
  if (white) { g.addColorStop(0, '#8f969e'); g.addColorStop(0.3, '#ffffff'); g.addColorStop(0.55, '#e7ebef'); g.addColorStop(0.85, '#a9b0b8'); g.addColorStop(1, '#7c838b'); }
  else { g.addColorStop(0, '#5b6168'); g.addColorStop(0.18, '#9aa2ab'); g.addColorStop(0.36, '#f2f5f8'); g.addColorStop(0.46, '#dfe4ea'); g.addColorStop(0.7, '#a4acb5'); g.addColorStop(0.9, '#737a83'); g.addColorStop(1, '#50565d'); }
  return g;
}
const isHls = (s: StageSpec) => s.name.toLowerCase().includes('hls') || (s.kind === 'ship' && !s.flaps && s.heatShield === 0 && s.legs && s.length > 40 && s.name !== 'Starhopper');
const cache = new Map<string, StageSprite>();
export function stageSprite(s: StageSpec, legs: boolean, flapsAng = 0): StageSprite {
  const key = JSON.stringify([s.name, s.kind, s.length, s.tankLen, s.engines.length, s.engines.map((e) => e.kind).join(''), s.flaps, s.heatShield, s.legs, s.gridFins, s.catchPins, s.cabin, s.payloadBay, s.tanker, legs, Math.round(flapsAng * 4)]);
  const hit = cache.get(key); if (hit) return hit;
  const D = s.diameter, L = s.length;
  const w = Math.ceil((D + 2 * M) * PPM), h = Math.ceil((L + BELOW + 2) * PPM);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d')!;
  const ox = w / 2, oy = h - BELOW * PPM;
  x.translate(ox, oy); x.scale(PPM, -PPM); // meters, y omhoog, oorsprong = onderkant romp
  const R = D / 2;
  const hopper = s.name === 'Starhopper';
  const hls = isHls(s);
  const noseL = s.kind === 'booster' ? 0 : hopper ? 5 : Math.max(8, L - s.tankLen - 3);
  const bodyTop = L - noseL;
  // --- motorklokken ---
  const bells = new Map<number, { k: string }>();
  for (const e of s.engines) { const bx = Math.round(e.x * 2) / 2; if (!bells.has(bx) || e.kind === 'vac') bells.set(bx, { k: e.kind }); }
  for (const [bx, b] of [...bells.entries()].sort((a, b2) => Math.abs(b2[0]) - Math.abs(a[0]))) {
    const vac = b.k === 'vac', bw = vac ? 2.3 : 1.3, bl = vac ? 3.6 : 2.3;
    const gx = x.createLinearGradient(bx - bw / 2, 0, bx + bw / 2, 0);
    gx.addColorStop(0, '#2a2522'); gx.addColorStop(0.4, '#7d6f66'); gx.addColorStop(0.6, '#4a403a'); gx.addColorStop(1, '#1d1a18');
    x.fillStyle = gx;
    x.beginPath(); x.moveTo(bx - bw * 0.25, 0); x.lineTo(bx + bw * 0.25, 0); x.lineTo(bx + bw / 2, -bl); x.lineTo(bx - bw / 2, -bl); x.closePath(); x.fill();
  }
  // --- romp ---
  x.fillStyle = steel(x, -R, R, hls);
  x.fillRect(-R, 0, D, bodyTop);
  // neus (ogief)
  if (noseL > 0) {
    x.beginPath(); x.moveTo(-R, bodyTop);
    if (hopper) { x.quadraticCurveTo(-R, bodyTop + noseL, 0, bodyTop + noseL); x.quadraticCurveTo(R, bodyTop + noseL, R, bodyTop); }
    else { x.bezierCurveTo(-R, bodyTop + noseL * 0.55, -R * 0.45, bodyTop + noseL * 0.95, 0, bodyTop + noseL); x.bezierCurveTo(R * 0.45, bodyTop + noseL * 0.95, R, bodyTop + noseL * 0.55, R, bodyTop); }
    x.closePath(); x.fillStyle = steel(x, -R, R, hls); x.fill();
  }
  // lasnaden (ringen)
  x.strokeStyle = 'rgba(40,46,54,.22)'; x.lineWidth = 0.08;
  for (let y = 1.8; y < bodyTop - 0.5; y += 1.8) { x.beginPath(); x.moveTo(-R, y); x.lineTo(R, y); x.stroke(); }
  // spiegelende streep
  const sp = x.createLinearGradient(-R, 0, R, 0); sp.addColorStop(0.28, 'rgba(255,255,255,0)'); sp.addColorStop(0.34, 'rgba(255,255,255,.55)'); sp.addColorStop(0.4, 'rgba(255,255,255,0)');
  x.fillStyle = sp; x.fillRect(-R, 0, D, bodyTop);
  // hitteschild: zwarte tegels aan de buikkant (links)
  if (s.heatShield > 0 && !hopper) {
    x.save(); x.beginPath(); x.rect(-R - 0.01, 0, R * 0.95, bodyTop); x.moveTo(-R, bodyTop);
    x.bezierCurveTo(-R, bodyTop + noseL * 0.55, -R * 0.45, bodyTop + noseL * 0.95, -0.05, bodyTop + noseL); x.lineTo(-0.05, bodyTop); x.closePath(); x.clip();
    const tg = x.createLinearGradient(-R, 0, 0, 0); tg.addColorStop(0, '#0b0c0e'); tg.addColorStop(0.6, '#24272b'); tg.addColorStop(1, '#16181b');
    x.fillStyle = tg; x.fillRect(-R, 0, R, L + 1);
    x.strokeStyle = 'rgba(255,255,255,.06)'; x.lineWidth = 0.05;
    for (let y = 0.5; y < L; y += 0.9) { x.beginPath(); x.moveTo(-R, y); x.lineTo(0, y); x.stroke(); }
    for (let i = 0; i < 6; i++) { const xx = -R + i * R / 6; x.beginPath(); x.moveTo(xx, 0); x.lineTo(xx, L); x.stroke(); }
    if (s.heatShield < 0.8) { x.fillStyle = 'rgba(200,205,210,.6)'; for (let i = 0; i < 30; i++) x.fillRect(-R + ((i * 37) % 9) / 9 * R, (i * 53) % Math.max(1, bodyTop), 0.6, 0.5); }
    x.restore();
  }
  if (s.kind === 'booster') {
    // chines + afdekking + motorkap
    x.fillStyle = 'rgba(50,55,62,.5)'; x.fillRect(-R - 0.25, 2, 0.35, L - 10); x.fillRect(R - 0.1, 2, 0.35, L - 10);
    const sk = x.createLinearGradient(-R, 0, R, 0); sk.addColorStop(0, '#3a3e44'); sk.addColorStop(0.4, '#8c939b'); sk.addColorStop(1, '#2f3338');
    x.fillStyle = sk; x.fillRect(-R, 0, D, 2.2);
    if (s.parts.includes('hotstage')) {
      x.fillStyle = '#2b2e33'; x.fillRect(-R, L - 2, D, 2);
      x.fillStyle = 'rgba(255,140,60,.0)';
      x.fillStyle = '#0c0d0f'; for (let i = -3.5; i <= 3.5; i += 1) x.fillRect(i - 0.25, L - 1.6, 0.5, 1.2);
    }
    if (s.gridFins) {
      const fy = L - (s.parts.includes('hotstage') ? 6 : 4), fw = s.parts.includes('fins2') ? 3.6 : 3, fh = s.parts.includes('fins2') ? 4.2 : 3.4;
      for (const sd of [-1, 1]) {
        const x0 = sd < 0 ? -R - fw : R;
        x.fillStyle = '#3d4249'; x.fillRect(x0, fy - fh / 2, fw, fh);
        x.strokeStyle = '#191b1e'; x.lineWidth = 0.18;
        for (let i = 1; i < 5; i++) { x.beginPath(); x.moveTo(x0 + fw * i / 5, fy - fh / 2); x.lineTo(x0 + fw * i / 5, fy + fh / 2); x.stroke(); }
        for (let i = 1; i < 6; i++) { x.beginPath(); x.moveTo(x0, fy - fh / 2 + fh * i / 6); x.lineTo(x0 + fw, fy - fh / 2 + fh * i / 6); x.stroke(); }
      }
      x.fillStyle = '#2a2d31'; x.fillRect(-0.9, fy - 1.6, 1.8, 3.2); // middelste vin (van voren)
    }
    if (s.catchPins) { x.fillStyle = '#25282c'; x.fillRect(-R - 0.8, L - 9, 0.8, 0.9); x.fillRect(R, L - 9, 0.8, 0.9); }
  } else {
    // flaps (voor en achter), aan beide zijden; hoek uit ingeklapt
    if (s.flaps) {
      const a = flapsAng;
      const fl = (y0: number, len: number, wid: number, sd: number) => {
        x.save(); x.translate(sd * R, y0); x.rotate(sd * a * 0.6);
        const g = x.createLinearGradient(0, 0, sd * wid, 0); g.addColorStop(0, '#16181b'); g.addColorStop(1, '#30343a');
        x.fillStyle = g; x.beginPath(); x.moveTo(0, 0); x.lineTo(sd * wid, len * 0.12); x.lineTo(sd * wid, len * 0.85); x.lineTo(0, len); x.closePath(); x.fill(); x.restore();
      };
      for (const sd of [-1, 1]) { fl(1.2, 9, 2.2, sd); fl(bodyTop + 0.5, noseL * 0.55, 1.4, sd); }
    }
    if (s.cabin) { x.fillStyle = '#0d1520'; for (let i = 0; i < 5; i++) { x.beginPath(); x.arc(-R * 0.5 + i * R * 0.25 + R * 0.15, bodyTop + noseL * 0.25, 0.32, 0, Math.PI * 2); x.fill(); } }
    if (s.payloadBay) { x.strokeStyle = 'rgba(30,34,40,.55)'; x.lineWidth = 0.12; x.strokeRect(-R * 0.1, bodyTop - 6, R * 1.0, 8); }
    if (hls) { // witte bovenkant + dunne band, motorpods hoog op de romp
      x.fillStyle = 'rgba(30,34,40,.45)'; x.fillRect(-R, bodyTop - 14, D, 0.25);
      x.fillStyle = '#3a3e44'; for (const sd of [-1, 1]) x.fillRect(sd < 0 ? -R - 0.6 : R, bodyTop - 2, 0.6, 1.8);
    }
    if (s.catchPins) { x.fillStyle = '#25282c'; x.fillRect(-R - 0.7, bodyTop - 2.5, 0.7, 0.8); x.fillRect(R, bodyTop - 2.5, 0.7, 0.8); }
  }
  // poten
  if (s.legs && (legs || hls)) {
    x.strokeStyle = '#2a2d32'; x.lineWidth = hls ? 0.55 : 0.4; x.lineCap = 'round';
    const span = hls ? R + 3.6 : hopper ? R + 2.2 : R + 1.6, top = hls ? 7 : 3.2, foot = hls ? -1.2 : -BELOW + 1.5;
    for (const sd of [-1, 1]) { x.beginPath(); x.moveTo(sd * R * 0.8, top); x.lineTo(sd * span, foot); x.stroke(); x.beginPath(); x.moveTo(sd * R * 0.95, 0.5); x.lineTo(sd * span, foot); x.stroke(); }
    x.fillStyle = '#1c1e21'; for (const sd of [-1, 1]) x.fillRect(sd * span - 0.7, foot - 0.25, 1.4, 0.5);
  }
  // randschaduw voor volume
  const ed = x.createLinearGradient(-R, 0, R, 0); ed.addColorStop(0, 'rgba(0,0,0,.28)'); ed.addColorStop(0.15, 'rgba(0,0,0,0)'); ed.addColorStop(0.85, 'rgba(0,0,0,0)'); ed.addColorStop(1, 'rgba(0,0,0,.32)');
  x.fillStyle = ed; x.fillRect(-R, 0, D, bodyTop);
  const out = { c, w, h, ox, oy };
  if (cache.size > 60) cache.clear();
  cache.set(key, out);
  return out;
}

// ---- Scenery (in meters, y omhoog, oorsprong op de grond) ----
export function drawTower(x: CanvasRenderingContext2D, h: number, armH: number, armOpen: number, side: number) {
  // vakwerktoren 
  const w = 9;
  const g = x.createLinearGradient(-w / 2, 0, w / 2, 0); g.addColorStop(0, '#1d2025'); g.addColorStop(0.5, '#3b4047'); g.addColorStop(1, '#1a1c20');
  x.strokeStyle = g; x.lineWidth = 0.7;
  x.beginPath(); x.moveTo(-w / 2, 0); x.lineTo(-w / 2, h); x.moveTo(w / 2, 0); x.lineTo(w / 2, h); x.stroke();
  x.lineWidth = 0.35;
  x.beginPath();
  for (let y = 0; y < h - 4; y += 6) { x.moveTo(-w / 2, y); x.lineTo(w / 2, y + 6); x.moveTo(w / 2, y); x.lineTo(-w / 2, y + 6); x.moveTo(-w / 2, y); x.lineTo(w / 2, y); }
  x.stroke();
  // top + bliksemafleider
  x.fillStyle = '#2b2f35'; x.fillRect(-w / 2 - 1, h - 3, w + 2, 3);
  x.strokeStyle = '#2b2f35'; x.lineWidth = 0.3; x.beginPath(); x.moveTo(0, h); x.lineTo(0, h + 12); x.stroke();
  // carriage + chopsticks (richting = side)
  x.fillStyle = '#32373e'; x.fillRect(-w / 2 - 1.5, armH - 2, w + 3, 5);
  const len = 36, open = armOpen;
  x.save(); x.translate(side * w / 2, armH + 1);
  for (const k of [1, -1]) {
    x.save(); x.rotate(side * k * open * 0.18);
    const ag = x.createLinearGradient(0, -1, 0, 1.5); ag.addColorStop(0, '#22262b'); ag.addColorStop(1, '#4a5058');
    x.fillStyle = ag; x.beginPath(); x.moveTo(0, -1.4); x.lineTo(side * len, -0.6); x.lineTo(side * len, 0.9); x.lineTo(0, 1.8); x.closePath(); x.fill();
    x.restore();
  }
  x.restore();
  // QD-arm
  x.fillStyle = '#2c3036'; x.fillRect(side * w / 2, h * 0.47, side * 10, 1.6);
}
export function drawOLM(x: CanvasRenderingContext2D, top: number) {
  // Orbital Launch Mount: tafel op zes poten + flame trench / deluge
  const g = x.createLinearGradient(-12, 0, 12, 0); g.addColorStop(0, '#3a3d42'); g.addColorStop(0.45, '#8d939a'); g.addColorStop(1, '#2e3135');
  x.fillStyle = g;
  for (const px of [-10.5, -5.5, 5.5, 10.5]) x.fillRect(px - 1.2, 0, 2.4, top - 3);
  x.fillRect(-13, top - 4, 26, 4);
  x.fillStyle = '#1b1d20'; x.fillRect(-5, top - 4.2, 10, 1);
  x.fillStyle = '#6c7178'; x.fillRect(-16, 0, 32, 1.2);
}
export function drawTankFarm(x: CanvasRenderingContext2D) {
  for (let i = 0; i < 7; i++) {
    const cx = i * 7, hh = i % 3 === 0 ? 30 : 22, r = i % 3 === 0 ? 3.2 : 2.8;
    const g = x.createLinearGradient(cx - r, 0, cx + r, 0); g.addColorStop(0, '#9aa0a8'); g.addColorStop(0.4, '#f4f6f8'); g.addColorStop(1, '#8b9199');
    x.fillStyle = g; x.fillRect(cx - r, 0, 2 * r, hh); x.beginPath(); x.ellipse(cx, hh, r, r * 0.4, 0, 0, Math.PI); x.fill();
  }
}
export function drawHighBay(x: CanvasRenderingContext2D) {
  const g = x.createLinearGradient(0, 0, 0, 80); g.addColorStop(0, '#d9dde2'); g.addColorStop(1, '#b8bec6');
  x.fillStyle = g; x.fillRect(0, 0, 60, 81); x.fillRect(70, 0, 70, 95);
  x.fillStyle = 'rgba(40,50,60,.35)'; for (let y = 8; y < 90; y += 8) x.fillRect(70, y, 70, 0.6);
  x.fillStyle = '#2a3442'; x.fillRect(85, 0, 40, 88);
  x.fillStyle = '#0d1b2e'; x.font = 'bold 6px sans-serif';
}
export function drawStand(x: CanvasRenderingContext2D, top: number) {
  x.fillStyle = '#5d636b'; x.fillRect(-8, 0, 3, top); x.fillRect(5, 0, 3, top); x.fillRect(-9, top - 2, 18, 2);
  x.strokeStyle = '#3f444b'; x.lineWidth = 0.4; x.beginPath(); x.moveTo(-8, 0); x.lineTo(8, top); x.moveTo(8, 0); x.lineTo(-8, top); x.stroke();
}
export function drawPadSlab(x: CanvasRenderingContext2D, r: number) { x.fillStyle = '#9b9a94'; x.fillRect(-r, -0.3, 2 * r, 1.6); x.fillStyle = '#ffd34d'; x.fillRect(-1, 1.25, 2, 0.12); }
export function drawPlatform(x: CanvasRenderingContext2D) {
  x.fillStyle = '#4a4f57'; for (const px of [-30, -12, 12, 30]) x.fillRect(px - 2, -20, 4, 30);
  x.fillStyle = '#6b7079'; x.fillRect(-46, 8, 92, 4); x.fillStyle = '#c33'; x.fillRect(-46, 11.6, 92, 0.4);
}
export function drawLunarPad(x: CanvasRenderingContext2D, r: number) { x.fillStyle = 'rgba(210,210,200,.6)'; x.fillRect(-r, 0, 2 * r, 0.4); }
// zachte rookwolk-sprite
let puff: HTMLCanvasElement | null = null;
export function puffSprite() {
  if (puff) return puff;
  puff = document.createElement('canvas'); puff.width = puff.height = 64;
  const x = puff.getContext('2d')!; const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return puff;
}
let glow: HTMLCanvasElement | null = null;
export function glowSprite() {
  if (glow) return glow;
  glow = document.createElement('canvas'); glow.width = glow.height = 128;
  const x = glow.getContext('2d')!; const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,250,235,1)'); g.addColorStop(0.15, 'rgba(255,214,150,.8)'); g.addColorStop(0.45, 'rgba(255,140,60,.25)'); g.addColorStop(1, 'rgba(255,110,40,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return glow;
}

export function darkSprite(s: StageSprite & { dark?: HTMLCanvasElement }) {
  if (s.dark) return s.dark;
  const c = document.createElement('canvas'); c.width = s.w; c.height = s.h;
  const x = c.getContext('2d')!; x.drawImage(s.c, 0, 0); x.globalCompositeOperation = 'source-atop'; x.fillStyle = '#03060d'; x.fillRect(0, 0, s.w, s.h);
  s.dark = c; return c;
}
