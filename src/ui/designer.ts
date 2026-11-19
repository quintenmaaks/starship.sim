// Bouwer in de stijl van Spaceflight Simulator: blauw raster, onderdelen stapelen, live massa/stuwkracht/TWR.
// Het gestapelde voertuig wordt vertaald naar het bestaande Design (Super Heavy + Starship).
import type { App } from '../app';
import { h, btn, toast, confirmBox, modal, fill } from './dom';
import { audio } from './audio';
import { GameState, allDesigns, loadSandboxDesigns, saveSandboxDesigns, saveGame } from '../game/state';
import { Design, designStats, designToSpec, ENGINES, SHIP_VARIANTS, ShipDesign, BUILTIN_DESIGNS } from '../game/parts';
import { buildCost, buildDays, orderBuild, maxParallelBuilds } from '../game/economy';
import { RESEARCH_BY_ID } from '../game/research';
import { MISSION_BY_ID } from '../game/missions';
import { money } from '../core/util';
import { stageSprite, PPM } from '../r2d/draw';
import { quickFly } from './launch';

const clone = (d: Design): Design => JSON.parse(JSON.stringify(d));
type Cat = 'landing' | 'besturing' | 'hitte' | 'trappen' | 'tanks' | 'motoren';
const CATS: [Cat, string, string][] = [
  ['landing', '🦵', 'Landing'], ['besturing', '🪽', 'Besturing'], ['hitte', '🛡️', 'Hitteschilden'],
  ['trappen', '⇵', 'Trappen'], ['tanks', '🛢️', 'Brandstoftanks'], ['motoren', '🔥', 'Motoren'],
];
interface Part { id: string; name: string; desc: string; lock?: string | null; on?: (d: Design) => boolean; apply: (d: Design) => string | void; ok?: (d: Design) => boolean }
const hasB = (d: Design) => d.booster.enabled && d.ship.variant !== 'hopper';

export function showDesigner(app: App, g: GameState | null, back: () => void, startId?: string) {
  const has = (r: string | null | undefined) => !r || !g || g.mode === 'sandbox' || !!g.research[r];
  const designs = () => allDesigns(g);
  let d: Design = clone(designs().find((x) => x.id === startId) || designs().find((x) => x.id === 'v2') || BUILTIN_DESIGNS[0]);
  const hist: string[] = [];
  let cat: Cat = 'tanks'; let paletteOpen = true; let sel: 'booster' | 'ship' = 'ship';
  const fork = () => { if (!d.builtin) return; const base = d.name; d.builtin = false; d.id = 'u' + Date.now().toString(36); d.name = base.replace(/ \(kopie\)$/, '') + ' (kopie)'; };

  const P = (cat: Cat): Part[] => {
    const B = d.booster, S = d.ship;
    switch (cat) {
      case 'tanks': return [
        { id: 'shring', name: 'Super Heavy tankring', desc: '+4 m methalox · ~220 t brandstof', lock: 'orbital', apply: (x) => { if (!hasB(x)) { x.booster.enabled = true; if (x.ship.variant === 'hopper') x.ship.variant = 'prototype'; } x.booster.tankLen = Math.min(75, x.booster.tankLen + 4); sel = 'booster'; } },
        { id: 'shring-', name: 'Super Heavy ring eraf', desc: '−4 m', ok: hasB, apply: (x) => { x.booster.tankLen = Math.max(40, x.booster.tankLen - 4); sel = 'booster'; } },
        { id: 'ssring', name: 'Starship tankring', desc: '+4 m · ~176 t brandstof', apply: (x) => { const mx = x.ship.variant === 'hopper' ? 18 : 50; x.ship.tankLen = Math.min(mx, x.ship.tankLen + 4); sel = 'ship'; } },
        { id: 'ssring-', name: 'Starship ring eraf', desc: '−4 m', apply: (x) => { x.ship.tankLen = Math.max(x.ship.variant === 'hopper' ? 8 : 18, x.ship.tankLen - 4); sel = 'ship'; } },
      ];
      case 'motoren': {
        const sl = Object.values(ENGINES).filter((e) => e.kind === 'sl'), vac = Object.values(ENGINES).filter((e) => e.kind === 'vac');
        return [
          ...sl.map((e): Part => ({ id: e.id, name: e.name, desc: `${(e.thrustSL / 9806.65).toFixed(0)} tf · Isp ${e.ispSL}/${e.ispVac} s`, lock: e.unlock, on: (x) => (sel === 'booster' && hasB(x) ? x.booster.engineType : x.ship.engineType) === e.id, apply: (x) => { if (sel === 'booster' && hasB(x)) x.booster.engineType = e.id; else x.ship.engineType = e.id; } })),
          ...vac.map((e): Part => ({ id: e.id, name: e.name.replace('Raptor Vacuum', 'Raptor Vacuum (RVac)'), desc: `${(e.thrustVac / 9806.65).toFixed(0)} tf vac · Isp ${e.ispVac} s · alleen schip`, lock: e.unlock, ok: (x) => x.ship.variant !== 'hopper', on: (x) => x.ship.vac > 0 && x.ship.vacType === e.id, apply: (x) => { x.ship.vacType = e.id; x.ship.vac = x.ship.vac >= 3 && x.ship.vacType === e.id ? x.ship.vac : 3; sel = 'ship'; } })),
          { id: 'vac0', name: 'RVacs verwijderen', desc: 'Geen vacuümmotoren', ok: (x) => x.ship.vac > 0, apply: (x) => { x.ship.vac = 0; } },
        ];
      }
      case 'trappen': return [
        { id: 'sh', name: 'Super Heavy booster', desc: 'Eerste trap onder het schip', lock: 'orbital', on: hasB, apply: (x) => { x.booster.enabled = true; if (x.ship.variant === 'hopper') { x.ship.variant = 'prototype'; x.ship.tankLen = 32; } sel = 'booster'; } },
        { id: 'nosh', name: 'Zonder booster', desc: 'Alleen het schip (hops)', on: (x) => !hasB(x), apply: (x) => { x.booster.enabled = false; sel = 'ship'; } },
        { id: 'hot', name: 'Hot-staging-ring', desc: 'Schip ontsteekt vóór scheiding (+prestaties)', lock: 'hotstage', ok: hasB, on: (x) => hasB(x) && x.booster.hotStage, apply: (x) => { x.booster.hotStage = !x.booster.hotStage; } },
        ...(Object.keys(SHIP_VARIANTS) as ShipDesign['variant'][]).map((k): Part => ({ id: 'v_' + k, name: SHIP_VARIANTS[k].name, desc: SHIP_VARIANTS[k].desc, lock: SHIP_VARIANTS[k].unlock, on: (x) => x.ship.variant === k, apply: (x) => {
          x.ship.variant = k; sel = 'ship';
          if (k === 'hls') { x.ship.heatShield = 0; x.ship.flaps = 0; x.ship.legs = true; x.ship.crew = Math.min(4, x.ship.crew || 4); }
          if (k === 'hopper') { x.ship.sl = Math.min(x.ship.sl, 3); x.ship.tankLen = Math.min(x.ship.tankLen, 18); x.ship.legs = true; x.booster.enabled = false; }
          if (k === 'crew') x.ship.crew = x.ship.crew || 12;
        } })),
      ];
      case 'hitte': return [
        { id: 'hs0', name: 'Geen hitteschild', desc: 'Kaal staal: alleen voor hops', on: (x) => x.ship.heatShield === 0, apply: (x) => { x.ship.heatShield = 0; } },
        { id: 'hs1', name: 'Hitteschildtegels (basis)', desc: 'Zeshoekige tegels, gaten mogelijk', ok: (x) => x.ship.variant !== 'hls' && x.ship.variant !== 'hopper', on: (x) => x.ship.heatShield === 1, apply: (x) => { x.ship.heatShield = 1; } },
        { id: 'hs2', name: 'Volledig hitteschild', desc: 'Dichte tegeldekking', lock: 'heatshield2', ok: (x) => x.ship.variant !== 'hls' && x.ship.variant !== 'hopper', on: (x) => x.ship.heatShield === 2, apply: (x) => { x.ship.heatShield = 2; } },
        { id: 'hs3', name: 'Hitteschild v3 (ablatief)', desc: 'Tegels + ablatieve reservelaag', lock: 'heatshield3', ok: (x) => x.ship.variant !== 'hls' && x.ship.variant !== 'hopper', on: (x) => x.ship.heatShield === 3, apply: (x) => { x.ship.heatShield = 3; } },
      ];
      case 'besturing': return [
        { id: 'gf1', name: 'Roosterroeren v1 (4×)', desc: 'Sturen van Super Heavy bij terugkeer', ok: hasB, on: (x) => x.booster.gridFins === 1, apply: (x) => { x.booster.gridFins = x.booster.gridFins === 1 ? 0 : 1; } },
        { id: 'gf2', name: 'Roosterroeren v2 (3× groot)', desc: 'Sterker, lichter', lock: 'gridfin2', ok: hasB, on: (x) => x.booster.gridFins === 2, apply: (x) => { x.booster.gridFins = x.booster.gridFins === 2 ? 0 : 2; } },
        { id: 'fl1', name: 'Flaps v1', desc: 'Voor- en achterflaps voor de belly flop', ok: (x) => x.ship.variant !== 'hls' && x.ship.variant !== 'hopper', on: (x) => x.ship.flaps === 1, apply: (x) => { x.ship.flaps = x.ship.flaps === 1 ? 0 : 1; } },
        { id: 'fl2', name: 'Flaps v2 (lijwaarts)', desc: 'Voorflaps uit de hitte', lock: 'flaps2', ok: (x) => x.ship.variant !== 'hls' && x.ship.variant !== 'hopper', on: (x) => x.ship.flaps === 2, apply: (x) => { x.ship.flaps = x.ship.flaps === 2 ? 0 : 2; } },
        { id: 'pinb', name: 'Vangpinnen booster (chopsticks)', desc: 'Mechazilla vangt de booster', lock: 'catch', ok: hasB, on: (x) => x.booster.catchPins, apply: (x) => { x.booster.catchPins = !x.booster.catchPins; } },
        { id: 'pins', name: 'Vangpinnen schip', desc: 'Toren vangt het schip', lock: 'shipcatch', ok: (x) => x.ship.variant !== 'hls' && x.ship.variant !== 'hopper', on: (x) => x.ship.catchPins, apply: (x) => { x.ship.catchPins = !x.ship.catchPins; } },
      ];
      case 'landing': return [
        { id: 'legs', name: 'Landingspoten schip', desc: 'Uitklapbare poten', on: (x) => x.ship.legs, apply: (x) => { x.ship.legs = !x.ship.legs; } },
        { id: 'hlslegs', name: 'HLS-landingspoten', desc: 'Brede maanpoten (kiest HLS-variant)', lock: 'hls', on: (x) => x.ship.variant === 'hls', apply: (x) => { x.ship.variant = 'hls'; x.ship.legs = true; x.ship.heatShield = 0; x.ship.flaps = 0; } },
        { id: 'blegs', name: 'Boosterpoten', desc: 'Landen op een platform i.p.v. vangen', ok: hasB, on: (x) => x.booster.legs, apply: (x) => { x.booster.legs = !x.booster.legs; } },
        { id: 'chop', name: 'Chopsticks-vangst', desc: 'Vangpinnen op booster én schip', lock: 'catch', ok: hasB, on: (x) => x.booster.catchPins && x.ship.catchPins, apply: (x) => { const v = !(x.booster.catchPins && x.ship.catchPins); x.booster.catchPins = v; if (has('shipcatch')) x.ship.catchPins = v; } },
      ];
    }
    void B; void S;
  };

  // ---- DOM ----
  const cv = h('canvas', 'bgrid') as HTMLCanvasElement;
  const catCol = h('div', 'pcats');
  const list = h('div', 'plist glass');
  const readout = h('div', 'breadout');
  const nameEl = h('div', 'bname');
  const selBtn = h('button', { class: 'sbtn', onClick: () => { sel = sel === 'ship' && hasB(d) ? 'booster' : 'ship'; audio.tap(); render(); } }, 'Trap');
  const symBtn = h('button', { class: 'sbtn', onClick: () => change(() => {
    if (sel === 'booster' && hasB(d)) { const o = [13, 20, 29, 33, 35]; d.booster.engines = o[(o.indexOf(d.booster.engines) + 1) % o.length]; toast(`Super Heavy: ${d.booster.engines} Raptors`, '', 900); }
    else { const o = d.ship.variant === 'hopper' ? [1, 2, 3] : [1, 2, 3, 4, 6]; d.ship.sl = o[(o.indexOf(d.ship.sl) + 1) % o.length] || o[0]; toast(`Starship: ${d.ship.sl} zeeniveau-Raptors`, '', 900); }
  }) }, 'Symmetrie');
  const partsBtn = h('button', { class: 'sbtn on', onClick: () => { paletteOpen = !paletteOpen; partsBtn.classList.toggle('on', paletteOpen); render(); } }, 'Onderdelen');
  const undoBtn = h('button', { class: 'sbtn', onClick: () => { const s = hist.pop(); if (s) { d = JSON.parse(s); audio.tap(); render(); } } }, '↶');
  const launchBtn = h('button', { class: 'sbtn go', onClick: () => launch() }, g ? 'Bouwen' : 'Lanceren');
  const menuBtn = h('button', { class: 'sbtn', onClick: () => menu() }, '☰');

  function change(f: () => void) {
    hist.push(JSON.stringify(d)); if (hist.length > 40) hist.shift();
    fork(); f(); audio.tap(); render();
  }
  function render() {
    const parts = P(cat);
    fill(catCol, ...CATS.map(([id, ic, l]) => h('button', { class: 'pcat' + (id === cat ? ' on' : ''), onClick: () => { cat = id; paletteOpen = true; partsBtn.classList.add('on'); render(); } }, h('span', 'i', ic), h('span', 'l', l))));
    list.style.display = paletteOpen ? '' : 'none';
    fill(list, h('div', 'lbl', CATS.find((c) => c[0] === cat)![2]), ...parts.map((p) => {
      const lk = !has(p.lock); const na = p.ok && !p.ok(d); const on = p.on?.(d);
      return h('div', { class: 'pitem' + (on ? ' on' : '') + (lk || na ? ' off' : ''), onClick: () => {
        if (lk) { audio.warn(); toast('🔒 Onderzoek nodig: ' + (RESEARCH_BY_ID[p.lock!]?.name || p.lock), 'bad'); return; }
        if (na) { audio.warn(); toast('Past niet op dit voertuig', 'bad', 1200); return; }
        change(() => p.apply(d));
      } }, h('div', 'pn', (lk ? '🔒 ' : on ? '✓ ' : '') + p.name), h('div', 'pd', p.desc));
    }));
    const st = designStats(d);
    const spec = designToSpec(d);
    let FSL = 0; for (const e of spec.stages[0].engines) FSL += ENGINES[e.id].thrustSL;
    const nl = (x: number) => Math.round(x).toLocaleString('nl-NL');
    const tw = st.liftoffTWR;
    fill(readout,
      h('div', null, h('span', null, 'Massa'), h('b', null, nl(st.totalMass / 1000) + ' t')),
      h('div', null, h('span', null, 'Stuwkracht'), h('b', null, nl(FSL / 9806.65) + ' t')),
      h('div', null, h('span', null, 'Stuwkracht/gewicht'), h('b', { class: tw < 1.05 ? 'bad' : tw < 1.25 ? 'warn' : 'good' }, tw.toFixed(2).replace('.', ','))),
      h('div', null, h('span', null, 'Δv'), h('b', null, nl(st.dvTotal) + ' m/s')));
    fill(nameEl, h('b', null, d.name), h('span', null, `${(sel === 'booster' && hasB(d) ? 'Super Heavy' : 'Starship')} geselecteerd · ${g ? money(buildCost(g, d)) + ' · ' + buildDays(g, d) + ' d' : money(st.cost)}`), st.warnings[0] ? h('span', 'warn', '⚠ ' + st.warnings[0]) : null);
    selBtn.textContent = 'Trap: ' + (sel === 'booster' && hasB(d) ? 'SH' : 'Schip');
    undoBtn.classList.toggle('dis', !hist.length);
    draw();
  }
  // ---- tekenen op het blauwe raster ----
  let raf = 0;
  function draw() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const dpr = Math.min(2, devicePixelRatio || 1); const W = innerWidth, H = innerHeight;
      cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
      const x = cv.getContext('2d')!; x.setTransform(dpr, 0, 0, dpr, 0, 0);
      const bg = x.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#163b6e'); bg.addColorStop(1, '#0d2647');
      x.fillStyle = bg; x.fillRect(0, 0, W, H);
      const cell = 24;
      x.strokeStyle = 'rgba(140,190,255,.10)'; x.lineWidth = 1; x.beginPath();
      for (let gx = (W / 2) % cell; gx < W; gx += cell) { x.moveTo(gx + 0.5, 0); x.lineTo(gx + 0.5, H); }
      for (let gy = 0; gy < H; gy += cell) { x.moveTo(0, gy + 0.5); x.lineTo(W, gy + 0.5); }
      x.stroke();
      x.strokeStyle = 'rgba(160,210,255,.2)'; x.beginPath();
      for (let gx = (W / 2) % (cell * 4); gx < W; gx += cell * 4) { x.moveTo(gx + 0.5, 0); x.lineTo(gx + 0.5, H); }
      for (let gy = 0; gy < H; gy += cell * 4) { x.moveTo(0, gy + 0.5); x.lineTo(W, gy + 0.5); }
      x.stroke();
      const spec = designToSpec(d);
      const total = spec.stages.reduce((a, s) => a + s.length, 0) + 6;
      const left = paletteOpen ? 236 : 70;
      const availH = H - 120 - 150, availW = W - left - 20;
      const s = Math.min(availH / total, availW / 26, 7);
      const cx = left + availW / 2, base = H - 150;
      let off = 0;
      spec.stages.forEach((sp, i) => {
        const spr = stageSprite(sp, true, 0);
        const k = s / PPM;
        const isSel = (sel === 'booster' && sp.kind === 'booster') || (sel === 'ship' && sp.kind === 'ship');
        x.drawImage(spr.c, cx - spr.ox * k, base - off * s - spr.oy * k, spr.w * k, spr.h * k);
        if (isSel) {
          x.strokeStyle = 'rgba(120,220,255,.9)'; x.setLineDash([5, 4]); x.lineWidth = 1.5;
          x.strokeRect(cx - sp.diameter / 2 * s - 6, base - (off + sp.length) * s - 4, sp.diameter * s + 12, sp.length * s + 8); x.setLineDash([]);
        }
        // maatlabel (alleen als er ruimte is)
        if (!paletteOpen)
        x.fillStyle = 'rgba(220,235,255,.75)'; x.font = '600 10px system-ui'; x.textAlign = 'left';
        x.fillText(`${sp.kind === 'booster' ? 'Super Heavy' : sp.name} · ${sp.length.toFixed(0)} m · ${sp.engines.length} Raptors`, cx + sp.diameter / 2 * s + 10, base - (off + sp.length / 2) * s);
        off += sp.length; void i;
      });
      // grondlijn
      x.strokeStyle = 'rgba(200,230,255,.35)'; x.beginPath(); x.moveTo(left, base + 0.5); x.lineTo(W - 10, base + 0.5); x.stroke();
    });
  }
  cv.addEventListener('pointerdown', (e) => {
    // tik op het voertuig selecteert de trap
    const H = innerHeight; const spec = designToSpec(d); if (spec.stages.length < 2) return;
    const total = spec.stages.reduce((a, s) => a + s.length, 0) + 6; const left = paletteOpen ? 236 : 70;
    const s = Math.min((H - 270) / total, (innerWidth - left - 20) / 26, 7); const base = H - 150;
    const m = (base - e.clientY) / s; if (m < 0) return;
    sel = m < spec.stages[0].length ? 'booster' : 'ship'; audio.tap(); render();
  });
  // ---- acties ----
  const stored = () => (g ? g.designs : loadSandboxDesigns());
  function save(quiet = false) {
    fork();
    const l = stored(); const i = l.findIndex((x) => x.id === d.id);
    if (i >= 0) l[i] = clone(d); else l.push(clone(d));
    if (g) saveGame(g); else saveSandboxDesigns(l);
    if (!quiet) { audio.chime(); toast('Ontwerp opgeslagen: ' + d.name, 'good'); }
  }
  function launch() {
    const st = designStats(d);
    if (st.liftoffTWR < 1.05) { audio.warn(); toast('Stuwkracht/gewicht < 1,05 — komt niet van het platform!', 'bad'); return; }
    if (g) {
      save(true);
      const busy = g.builds.filter((b) => !b.ready && b.flights === 0).length;
      if (busy >= maxParallelBuilds(g)) { toast(`High bay vol (${busy}/${maxParallelBuilds(g)}). Upgrade faciliteiten.`, 'bad'); return; }
      const b = orderBuild(g, d);
      if (!b) { toast('Niet genoeg geld', 'bad'); audio.warn(); return; }
      saveGame(g); audio.coin(); toast(`🏭 ${b.name} in productie: ${b.daysLeft} dagen`, 'good'); render(); return;
    }
    save(true);
    const m = hasB(d) ? MISSION_BY_ID.orbital : d.ship.variant === 'hopper' ? MISSION_BY_ID.hop150 : MISSION_BY_ID.hop10k;
    quickFly(app, m, clone(d), { hour: 15.5, back: () => showDesigner(app, g, back, d.id) });
  }
  function menu() {
    const nameInp = h('input', { value: d.name, maxlength: 30, class: 'inp' }) as HTMLInputElement;
    const pick = h('div', 'col', ...designs().map((x) => btn((x.builtin ? '★ ' : '') + x.name, () => { hist.push(JSON.stringify(d)); d = clone(x); document.querySelector('.modal-bg')?.remove(); render(); }, 'small' + (x.id === d.id ? ' on' : ''))));
    modal('Bouwer', h('div', 'col', h('div', 'lbl', 'Naam'), nameInp, h('div', 'lbl', 'Ontwerp laden'), pick), [
      { label: '‹ Verlaten', cls: 'ghost', onClick: () => { cancelAnimationFrame(raf); back(); } },
      ...(!d.builtin && stored().some((x) => x.id === d.id) ? [{ label: '🗑', cls: 'danger', onClick: () => confirmBox('Ontwerp verwijderen?', `<b>${d.name}</b> verwijderen?`, 'Verwijderen', () => { const l = stored().filter((x) => x.id !== d.id); if (g) { g.designs = l; saveGame(g); } else saveSandboxDesigns(l); d = clone(BUILTIN_DESIGNS[3]); render(); }, 'danger') }] : []),
      { label: '💾 Opslaan', cls: 'primary', onClick: () => { fork(); d.name = nameInp.value || d.name; save(); render(); } },
    ]);
  }
  render();
  addEventListener('resize', draw);
  app.stopLoop?.();
  app.setScreen(h('div', 'screen builder',
    cv,
    h('div', 'btop', menuBtn, nameEl, launchBtn),
    catCol, list,
    h('div', 'bbottom', readout, h('div', 'brow', selBtn, symBtn, partsBtn, h('div', 'grow'), undoBtn))));
}
