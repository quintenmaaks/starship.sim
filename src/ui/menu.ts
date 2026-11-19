// Hoofdmenu, carrièreslots, vrije vlucht, scenario's, testcentrum, instellingen, records
import type { App } from '../app';
import { h, btn, modal, confirmBox, toast } from './dom';
import { fill } from './dom';
import { audio } from './audio';
import { SLOTS, slotInfo, newGame, saveGame, deleteSave, settings, saveSettings, allDesigns, globalRecords, findDesign } from '../game/state';
import { MISSIONS, MissionDef } from '../game/missions';
import { designAllowed } from '../game/career';
import { ACHIEVEMENTS, achievementsOf, grantAchievement } from '../game/economy';
import { money, gameDate, duration } from '../core/util';
import { quickFly, dailyChallenge, dailyState, markDaily, RelMode } from './launch';
import { showDesigner } from './designer';
import { listReplays, loadReplay } from '../flight/replay';
import { BUILTIN_DESIGNS } from '../game/parts';

export function wordmark(size = 30) {
  return h('div', { class: 'wordmark', style: { fontSize: size + 'px' } }, 'STARSHIP');
}

export function showMenu(app: App) {
  app.setBackdrop(BUILTIN_DESIGNS.find((d) => d.id === 'v3c') || BUILTIN_DESIGNS[3], 16.9);
  const item = (ic: string, t: string, s: string, on: () => void, hero = false) =>
    h('div', { class: 'item' + (hero ? ' hero' : ''), onClick: on }, h('div', 'ic', ic), h('div', null, h('div', 't', t), h('div', 's', s)));
  const last = slotInfo(settings.lastSlot);
  const daily = dailyChallenge(); const ds = dailyState();
  const ach = achievementsOf(null); const nAch = Object.keys(ach).length;
  const scr = h('div', 'screen menu',
    h('div', 'brand', wordmark(26), h('div', 'tag', 'Starbase · vluchtsimulator & ruimtebedrijf')),
    h('div', 'items',
      item('🚀', last ? 'Doorgaan: ' + last.company : 'Carrière', last ? `${gameDate(Math.floor(last.day))} · ${money(last.money)} · ${last.flights} vluchten` : 'Bouw je eigen ruimtebedrijf op', () => (last ? app.openCareer(settings.lastSlot) : careerSlots(app)), true),
      last ? item('🏢', 'Carrière & opslag', 'Opslagplaatsen, nieuw bedrijf', () => careerSlots(app)) : null,
      item('🛰️', 'Vrije vlucht', 'Sandbox: elk voertuig, elke missie', () => sandbox(app)),
      item('🎬', "Scenario's", 'Historische momenten & uitdagingen', () => scenarios(app)),
      item('🧪', 'Testcentrum', 'Drukproeven, vuurproeven, hops', () => sandbox(app, 'test')),
      item('📐', 'Ontwerper', 'Ontwerp je eigen Starship', () => showDesigner(app, null, () => showMenu(app))),
      h('div', 'row', { style: { gap: '6px' } } as any,
        btn('📈 Bedrijf', () => (last ? app.openCareer(settings.lastSlot) : careerSlots(app)), 'small ghost grow'),
        btn('🏆 Records', () => records(app), 'small ghost grow'),
        btn('⚙️ Instellingen', () => settingsModal(), 'small ghost grow'))),
    h('div', 'side glass',
      h('div', 'lbl', '🔥 Dagelijkse uitdaging' + (ds.streak ? ` · reeks ${ds.streak}` : '')),
      h('div', { style: { fontWeight: 800, fontSize: '14px', margin: '3px 0 1px' } }, daily.title),
      h('div', 'dim', { style: { fontSize: '11px' } } as any, daily.goal),
      h('div', 'row', { style: { marginTop: '7px' } } as any,
        ds.done?.[daily.key] ? h('span', 'pill good', '✓ Voltooid vandaag') : h('span', 'pill gold', '+1 reeks'),
        h('div', 'grow'),
        btn('Spelen', () => quickFly(app, daily.mission, daily.design, {
          hour: daily.hour, wind: daily.wind, relMode: 'perfect', back: () => showMenu(app),
          onResult: (r) => { if (daily.check(r)) { const s = markDaily(daily.key); grantAchievement(null, 'daily', []); toast(`Dagelijkse uitdaging voltooid! Reeks: ${s.streak} 🔥`, 'gold', 4000); audio.fanfare(); } },
        }), 'small go')),
      h('div', { style: { height: '1px', background: 'rgba(255,255,255,.08)', margin: '9px 0 7px' } }),
      h('div', 'kv', h('span', null, 'Prestaties'), h('b', null, `${nAch}/${ACHIEVEMENTS.length}`)),
      h('div', 'kv', h('span', null, 'Hoogste score'), h('b', null, bestOf('score_', Math.max))),
      h('div', 'kv', h('span', null, 'Preciezer landing/vangst'), h('b', null, bestOf('acc_', Math.min, ' m')))),
    h('div', 'foot', 'Niet-commerciële fangame · geen officieel SpaceX-product', h('br'), 'Zet op beginscherm via Deel → "Zet op beginscherm"'));
  app.setScreen(scr);
}

// ---------- Carrièreslots ----------
export function careerSlots(app: App) {
  const body = h('div', 'cards');
  const m = modal('Carrière — kies een opslagplaats', body, [{ label: 'Terug', cls: 'ghost' }], true);
  for (let s = 0; s < SLOTS; s++) {
    const inf = slotInfo(s);
    body.append(h('div', { class: 'card', onClick: () => { m.close(); if (inf) app.openCareer(s); else newCompany(app, s); } },
      h('div', 'ic', inf ? (inf.mode === 'sandbox' ? '🧰' : '🏢') : '➕'),
      h('div', 't', inf ? inf.company : `Leeg slot ${s + 1}`),
      h('div', 's', inf ? `${inf.mode === 'sandbox' ? 'Onbeperkt' : 'Carrière'} · ${gameDate(Math.floor(inf.day))} · ${money(inf.money)} · ${inf.flights} vluchten${inf.isPublic ? ' · beursgenoteerd' : ''}` : 'Start een nieuw ruimtebedrijf'),
      inf ? h('div', 'row', h('div', 'grow'), h('button', { class: 'btn tiny danger', onClick: (e: Event) => { e.stopPropagation(); confirmBox('Verwijderen?', `Opslag <b>${inf.company}</b> definitief wissen?`, 'Wissen', () => { deleteSave(s); m.close(); careerSlots(app); }, 'danger'); } }, 'Wissen')) : null));
  }
}
function newCompany(app: App, slot: number) {
  const names = ['Noordzee Aerospace', 'Delta Lanceersystemen', 'Polder Orbital', 'Oranje Raketwerken', 'Starbase Holland'];
  const inp = h('input', { class: 'inp', value: names[Math.floor(Math.random() * names.length)], maxlength: 28, style: { width: '100%', padding: '9px', borderRadius: '10px', border: '1px solid rgba(255,255,255,.2)', background: 'rgba(0,0,0,.3)', color: '#fff', fontSize: '15px' } }) as HTMLInputElement;
  let mode: 'career' | 'sandbox' = 'career';
  const seg = h('div', 'seg');
  const segs = [['career', 'Carrière', 'Start met € 450 mln, een Starhopper en een droom.'], ['sandbox', 'Onbeperkt', '€ 50 mld, alles ontgrendeld. Puur bouwen en vliegen.']] as const;
  const desc = h('div', 'dim', { style: { fontSize: '11px', marginTop: '5px' } } as any, segs[0][2]);
  for (const [id, lab, d] of segs) { const b = btn(lab, () => { mode = id; [...seg.children].forEach((c) => c.classList.remove('on')); b.classList.add('on'); desc.textContent = d; }, 'small' + (id === mode ? ' on' : '')); seg.append(b); }
  modal('Nieuw ruimtebedrijf', h('div', null, h('div', 'lbl', 'Bedrijfsnaam'), inp, h('div', 'lbl', { style: { marginTop: '10px' } } as any, 'Modus'), seg, desc), [
    { label: 'Annuleren', cls: 'ghost' },
    { label: 'Oprichten 🚀', cls: 'go', onClick: () => { const g = newGame(inp.value.trim() || 'Mijn Ruimtebedrijf', mode, slot); saveGame(g); app.g = g; settings.lastSlot = slot; saveSettings(); audio.fanfare(); app.hub(); } },
  ]);
  setTimeout(() => inp.select(), 50);
}

// ---------- Vrije vlucht / Testcentrum ----------
export function sandbox(app: App, cat: 'flight' | 'test' | 'all' = 'all') {
  const ms = MISSIONS.filter((m) => m.cat !== 'scenario' && (cat === 'all' || m.cat === cat));
  let sel: MissionDef = ms[0];
  let design = findDesign(null, sel.designs[0]);
  let hour = 15.5, wind = 4, rel: RelMode = 'perfect';
  const list = h('div', 'cards scroll', { style: { flex: '1', alignContent: 'start' } } as any);
  const side = h('div', 'panel glass scroll', { style: { width: '300px' } } as any);
  const renderList = () => {
    fill(list, ...ms.map((m) => h('div', { class: 'card' + (m === sel ? ' sel' : ''), onClick: () => { sel = m; design = findDesign(null, m.designs[0]); renderList(); renderSide(); app.setBackdrop(design, hour); } },
      h('div', 'row', h('span', 'ic', m.icon), h('div', 'grow'), h('span', 'pill ' + (m.cat === 'test' ? 'acc' : ''), m.cat === 'test' ? 'TEST' : 'VLUCHT'), h('span', 'pill', '★'.repeat(m.hard))),
      h('div', 't', m.title), h('div', 's', m.short),
      globalRecords['score_' + m.id] ? h('div', 'pill gold', 'Beste: ' + Math.round(globalRecords['score_' + m.id])) : null)));
  };
  const seg = <T,>(opts: [T, string][], cur: T, set: (v: T) => void) => {
    const s = h('div', 'seg');
    for (const [v, l] of opts) s.append(btn(l, () => { set(v); renderSide(); }, 'small' + (v === cur ? ' on' : '')));
    return s;
  };
  const renderSide = () => {
    const designs = allDesigns(null).filter((d) => designAllowed(sel, d));
    fill(side, 
      h('div', 'row', h('span', { style: { fontSize: '22px' } } as any, sel.icon), h('b', { style: { fontSize: '15px' } } as any, sel.title)),
      h('div', 'dim', { style: { fontSize: '11.5px', lineHeight: '1.35' } } as any, sel.desc),
      h('div', 'lbl', 'Voertuig'), seg(designs.map((d) => [d.id, d.name] as [string, string]), design.id, (id) => { design = findDesign(null, id); app.setBackdrop(design, hour); }),
      h('div', 'lbl', 'Tijdstip'), seg([[8, 'Ochtend'], [13, 'Middag'], [15.5, 'Middag laat'], [16.9, 'Zonsondergang'], [23, 'Nacht']], hour, (v) => { hour = v; app.setBackdrop(design, hour); }),
      h('div', 'lbl', 'Wind'), seg([[0, 'Kalm'], [4, 'Licht'], [9, 'Matig'], [15, 'Stormachtig']], wind, (v) => (wind = v)),
      h('div', 'lbl', 'Betrouwbaarheid'), seg([['perfect', 'Perfect'], ['real', 'Realistisch'], ['rush', 'Gehaast']] as [RelMode, string][], rel, (v) => (rel = v)),
      h('div', 'grow'),
      btn('LANCEREN ▶', () => quickFly(app, sel, design, { hour, wind, relMode: rel, back: () => sandbox(app, cat) }), 'go'));
  };
  renderList(); renderSide();
  app.setBackdrop(design, hour);
  app.setScreen(h('div', 'screen',
    h('div', 'topbar glass', btn('‹ Terug', () => showMenu(app), 'small ghost'), h('div', 'title', cat === 'test' ? 'Testcentrum' : 'Vrije vlucht'), h('div', 'grow'), h('span', 'pill', 'Sandbox · geen kosten')),
    h('div', 'body', list, side)));
}

// ---------- Scenario's ----------
export function scenarios(app: App) {
  const ms = MISSIONS.filter((m) => m.cat === 'scenario');
  const ach = achievementsOf(null);
  app.setBackdrop(findDesign(null, 'v2'), 7.2);
  app.setScreen(h('div', 'screen',
    h('div', 'topbar glass', btn('‹ Terug', () => showMenu(app), 'small ghost'), h('div', 'title', "Scenario's"), h('div', 'grow'), h('span', 'pill gold', `${ms.filter((m) => globalRecords['score_' + m.id] > 0).length}/${ms.length} voltooid`)),
    h('div', 'cards scroll', { style: { flex: '1', alignContent: 'start' } } as any, ...ms.map((m) => {
      const best = globalRecords['score_' + m.id];
      return h('div', { class: 'card', onClick: () => modal(m.icon + ' ' + m.title, h('div', null, h('p', null, m.desc), h('div', 'row', h('span', 'pill', 'Moeilijkheid ' + '★'.repeat(m.hard)), best ? h('span', 'pill gold', 'Record ' + Math.round(best)) : null)), [
        { label: 'Terug', cls: 'ghost' },
        { label: 'Start ▶', cls: 'go', onClick: () => quickFly(app, m, findDesign(null, m.designs[0]), { relMode: m.id === 'sc_engineout' ? 'real' : 'perfect', wind: m.id === 'sc_wind' ? 16 : 3, back: () => scenarios(app) }) }]) },
        h('div', 'row', h('span', 'ic', m.icon), h('div', 'grow'), h('span', 'pill', '★'.repeat(m.hard))),
        h('div', 't', m.title), h('div', 's', m.short),
        best ? h('div', 'pill gold', '✓ ' + Math.round(best)) : h('div', 'pill', 'Nog niet voltooid'));
    })),
    h('div', 'dim', { style: { fontSize: '10px', marginTop: '6px' } } as any, `${Object.keys(ach).length} prestaties ontgrendeld`)));
}

// ---------- Instellingen ----------
export function settingsModal(onChange?: () => void) {
  const body = h('div', null);
  const row = (label: string, ctrl: HTMLElement, sub = '') => h('div', 'opt', h('div', 'oh', h('span', null, label, sub ? h('div', 'dim', { style: { fontSize: '10px' } } as any, sub) : null), ctrl));
  const toggle = (k: 'fps' | 'haptics' | 'invertY' | 'autoCam' | 'subtitles') => { const b = btn(settings[k] ? 'Aan' : 'Uit', () => { (settings as any)[k] = !settings[k]; b.textContent = settings[k] ? 'Aan' : 'Uit'; b.classList.toggle('on', settings[k]); saveSettings(); onChange?.(); }, 'small' + (settings[k] ? ' on' : '')); return b; };
  const slider = (k: 'sound' | 'music' | 'joySens', min: number, max: number) => {
    const s = h('input', { type: 'range', min, max, step: 0.05, value: settings[k], style: { width: '140px' } }) as HTMLInputElement;
    s.addEventListener('input', () => { (settings as any)[k] = +s.value; saveSettings(); audio.applySettings(); });
    s.addEventListener('change', () => audio.tap());
    return s;
  };
  body.append(
    h('div', 'pill acc', { style: { marginBottom: '6px' } } as any, 'Grafiek: ULTRA — altijd maximale kwaliteit'),
    row('FPS-teller', toggle('fps'), 'Toont beelden per seconde tijdens het spel'),
    row('Geluidseffecten', slider('sound', 0, 1)),
    row('Muziek', slider('music', 0, 1)),
    row('Trillen (haptiek)', toggle('haptics')),
    row('Joystick omkeren (Y)', toggle('invertY')),
    row('Joystickgevoeligheid', slider('joySens', 0.4, 2)),
    row('Automatische camera', toggle('autoCam'), 'Wisselt automatisch naar de spannendste camera'),
    row('Ondertitels / grote meldingen', toggle('subtitles')),
    h('div', 'dim', { style: { fontSize: '10px', marginTop: '8px' } } as any, 'Opslag gebeurt automatisch in deze browser. Tip: voeg de game toe aan je beginscherm voor volledig scherm.'));
  modal('Instellingen', body, [{ label: 'Klaar', cls: 'primary' }]);
}

// ---------- Records & prestaties ----------
export function records(app: App) {
  const ach = achievementsOf(null);
  const reps = listReplays();
  const body = h('div', null,
    h('div', 'lbl', 'Prestaties'),
    h('div', 'cards', ...ACHIEVEMENTS.map((a) => h('div', { class: 'card' + (ach[a.id] ? '' : ' locked') }, h('div', 'row', h('span', 'ic', ach[a.id] ? a.icon : '🔒'), h('b', null, a.title)), h('div', 's', a.desc)))),
    h('div', 'lbl', { style: { marginTop: '10px' } } as any, 'Records'),
    ...Object.entries(globalRecords).filter(([k]) => !k.startsWith('score_') && !k.startsWith('acc_')).map(([k, v]) => h('div', 'kv', h('span', null, REC_LABEL[k] || k), h('b', null, fmtRec(k, v)))),
    h('div', 'lbl', { style: { marginTop: '10px' } } as any, 'Opgeslagen herhalingen (beste vluchten)'),
    reps.length ? h('div', 'cards', ...reps.map((k) => { const d = loadReplay(k); return d ? h('div', { class: 'card', onClick: () => { md.close(); app.replay(d, () => showMenu(app)); } }, h('div', 't', '▶ ' + d.title), h('div', 's', `${duration(d.duration)} · score ${Math.round(d.score || 0)}`)) : null; })) : h('div', 'dim', 'Nog geen herhalingen. Vlieg een missie!'));
  const md = modal('Records & prestaties', body, [{ label: 'Sluiten' }], true);
}
export const REC_LABEL: Record<string, string> = { bestScore: 'Hoogste missiescore', bestCatchAcc: 'Preciezer vangst (m)', bestLandAcc: 'Preciezer landing (m)', maxAlt: 'Grootste hoogte', maxSpeed: 'Hoogste snelheid', maxG: 'Hoogste g-kracht', flights: 'Vluchten', catches: 'Vangsten', pressure: 'Hoogste tankdruk' };
export function fmtRec(k: string, v: number) {
  if (k === 'maxAlt') return v > 1e5 ? (v / 1000).toFixed(0) + ' km' : v.toFixed(0) + ' m';
  if (k === 'maxSpeed') return (v * 3.6).toFixed(0) + ' km/u';
  if (k.endsWith('Acc')) return v.toFixed(2) + ' m';
  if (k === 'maxG') return v.toFixed(1) + ' g';
  if (k === 'pressure') return v.toFixed(2) + ' bar';
  return String(Math.round(v));
}

function bestOf(prefix: string, f: (...v: number[]) => number, unit = '') {
  const v = Object.entries(globalRecords).filter(([k]) => k.startsWith(prefix)).map(([, x]) => x);
  if (!v.length) return '—';
  const r = f(...v); return unit ? r.toFixed(2) + unit : String(Math.round(r));
}
