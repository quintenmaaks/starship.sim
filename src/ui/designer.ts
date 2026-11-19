// Ontwerper: stel je eigen Starship + Super Heavy samen met live 3D-voorbeeld op het platform
import type { App } from '../app';
import { h, btn, toast, confirmBox } from './dom';
import { fill } from './dom';
import { audio } from './audio';
import { GameState, allDesigns, loadSandboxDesigns, saveSandboxDesigns, saveGame } from '../game/state';
import { Design, designStats, ENGINES, SHIP_VARIANTS, FLAPS, HEATSHIELDS, GRIDFINS, ShipDesign, BUILTIN_DESIGNS } from '../game/parts';
import { buildCost, buildDays, orderBuild, maxParallelBuilds } from '../game/economy';
import { RESEARCH_BY_ID } from '../game/research';
import { money } from '../core/util';

const clone = (d: Design): Design => JSON.parse(JSON.stringify(d));

export function showDesigner(app: App, g: GameState | null, back: () => void, startId?: string) {
  const has = (r: string | null) => !r || !g || g.mode === 'sandbox' || !!g.research[r];
  const designs = () => allDesigns(g);
  let d: Design = clone(designs().find((x) => x.id === startId) || designs().find((x) => x.id === 'v2') || BUILTIN_DESIGNS[0]);
  let previewTimer = 0;
  const preview = () => { clearTimeout(previewTimer); previewTimer = window.setTimeout(() => app.setBackdrop(d, 15.8), 220); };
  const side = h('div', 'side glass scroll');
  const stats = h('div', 'stats glass scroll');
  const lockTag = (r: string | null) => (has(r) ? null : h('span', 'pill warn', '🔒 ' + (RESEARCH_BY_ID[r!]?.name || r)));

  const seg = <T,>(opts: { v: T; l: string; lock?: string | null }[], cur: T, set: (v: T) => void) => {
    const s = h('div', 'seg');
    for (const o of opts) {
      const ok = has(o.lock ?? null);
      const b = btn((ok ? '' : '🔒 ') + o.l, () => { if (!ok) { audio.warn(); toast('Vergrendeld: onderzoek ' + (RESEARCH_BY_ID[o.lock!]?.name || o.lock), 'bad'); return; } if (d.builtin) fork(); set(o.v); changed(); }, 'small' + (o.v === cur ? ' on' : '') + (ok ? '' : ' disabled'));
      s.append(b);
    }
    return s;
  };
  const range = (label: string, val: number, min: number, max: number, step: number, unit: string, set: (v: number) => void) => {
    const out = h('b', null, val + unit);
    const r = h('input', { type: 'range', min, max, step, value: val, style: { width: '100%' } }) as HTMLInputElement;
    r.addEventListener('input', () => { if (d.builtin) fork(); set(+r.value); out.textContent = r.value + unit; renderStats(); preview(); });
    r.addEventListener('change', () => audio.tap());
    return h('div', 'opt', h('div', 'oh', h('span', null, label), out), r);
  };
  const opt = (label: string, ctrl: HTMLElement, extra: Node | null = null) => h('div', 'opt', h('div', 'oh', h('span', null, label), extra), ctrl);
  const fork = () => { const base = d.name; d.builtin = false; d.id = 'u' + Date.now().toString(36); d.name = base.replace(/ \(kopie\)$/, '') + ' (kopie)'; toast('Kopie gemaakt van standaardontwerp — sla op om te bewaren', ''); };
  const changed = () => { renderSide(); renderStats(); preview(); };

  function renderSide() {
    const b = d.booster, s = d.ship;
    const nameInp = h('input', { value: d.name, maxlength: 30, style: { width: '100%', padding: '7px 9px', borderRadius: '9px', border: '1px solid rgba(255,255,255,.18)', background: 'rgba(0,0,0,.3)', color: '#fff', fontWeight: 700 } }) as HTMLInputElement;
    nameInp.addEventListener('change', () => { if (d.builtin) fork(); d.name = nameInp.value || 'Naamloos'; });
    const pick = h('select', { style: { width: '100%', padding: '6px', borderRadius: '9px', background: 'rgba(0,0,0,.4)', color: '#fff', border: '1px solid rgba(255,255,255,.18)' } }) as HTMLSelectElement;
    for (const x of designs()) pick.append(h('option', { value: x.id, selected: x.id === d.id ? 'selected' : null }, (x.builtin ? '★ ' : '') + x.name));
    pick.addEventListener('change', () => { d = clone(designs().find((x) => x.id === pick.value)!); changed(); });
    const engOpts = (kind: 'sl' | 'vac') => Object.values(ENGINES).filter((e) => e.kind === kind).map((e) => ({ v: e.id, l: e.name.replace('Raptor Vacuum', 'RVac'), lock: e.unlock }));
    fill(side, 
      h('div', 'lbl', 'Ontwerp'), pick, nameInp,
      h('div', 'lbl', { style: { marginTop: '6px' } } as any, '🔵 Super Heavy (eerste trap)'),
      opt('Booster', seg([{ v: false, l: 'Geen' }, { v: true, l: 'Super Heavy', lock: 'orbital' }], b.enabled && s.variant !== 'hopper', (v) => (b.enabled = v))),
      ...(b.enabled && s.variant !== 'hopper' ? [
        range('Tanklengte', b.tankLen, 40, 75, 1, ' m', (v) => (b.tankLen = v)),
        opt('Motoren', seg([13, 20, 29, 33, 35].map((n) => ({ v: n, l: String(n) })), b.engines, (v) => (b.engines = v))),
        opt('Motortype', seg(engOpts('sl'), b.engineType, (v) => (b.engineType = v))),
        opt('Roosterroeren', seg(GRIDFINS.map((l, i) => ({ v: i, l: l.replace(/ \(.*\)/, ''), lock: i === 2 ? 'gridfin2' : null })), b.gridFins, (v) => (b.gridFins = v))),
        opt('Hot-staging-ring', seg([{ v: false, l: 'Nee' }, { v: true, l: 'Ja', lock: 'hotstage' }], b.hotStage, (v) => (b.hotStage = v))),
        opt('Vangpinnen (Mechazilla)', seg([{ v: false, l: 'Nee' }, { v: true, l: 'Ja', lock: 'catch' }], b.catchPins, (v) => (b.catchPins = v))),
      ] : []),
      h('div', 'lbl', { style: { marginTop: '6px' } } as any, '⚪ Starship (tweede trap)'),
      opt('Variant', seg((Object.keys(SHIP_VARIANTS) as ShipDesign['variant'][]).map((k) => ({ v: k, l: SHIP_VARIANTS[k].name.replace('Starship ', '').replace(' / Starlink', ''), lock: SHIP_VARIANTS[k].unlock })), s.variant, (v) => { s.variant = v; if (v === 'hls') { s.heatShield = 0; s.flaps = 0; s.legs = true; } if (v === 'hopper') { s.sl = Math.min(s.sl, 3); s.tankLen = Math.min(s.tankLen, 18); } })),
      h('div', 'dim', { style: { fontSize: '10.5px' } } as any, SHIP_VARIANTS[s.variant].desc),
      range('Tanklengte', s.tankLen, s.variant === 'hopper' ? 8 : 18, s.variant === 'hopper' ? 18 : 50, 1, ' m', (v) => (s.tankLen = v)),
      opt('Zeeniveau-Raptors', seg([1, 2, 3, 4, 6].filter((n) => s.variant !== 'hopper' || n <= 3).map((n) => ({ v: n, l: String(n) })), s.sl, (v) => (s.sl = v))),
      opt('Motortype', seg(engOpts('sl'), s.engineType, (v) => (s.engineType = v))),
      ...(s.variant !== 'hopper' ? [
        opt('Vacuüm-Raptors', seg([0, 3, 6].map((n) => ({ v: n, l: String(n) })), s.vac, (v) => (s.vac = v))),
        s.vac ? opt('RVac-type', seg(engOpts('vac'), s.vacType, (v) => (s.vacType = v))) : null,
        opt('Flaps', seg(FLAPS.map((l, i) => ({ v: i, l, lock: i === 2 ? 'flaps2' : null })), s.flaps, (v) => (s.flaps = v))),
        opt('Hitteschild', seg(HEATSHIELDS.map((l, i) => ({ v: i, l: l.replace(/ \(.*\)/, ''), lock: i === 2 ? 'heatshield2' : i === 3 ? 'heatshield3' : null })), s.heatShield, (v) => (s.heatShield = v))),
        opt('Vangpinnen schip', seg([{ v: false, l: 'Nee' }, { v: true, l: 'Ja', lock: 'shipcatch' }], s.catchPins, (v) => (s.catchPins = v))),
      ] : []),
      opt('Landingspoten', seg([{ v: false, l: 'Nee' }, { v: true, l: 'Ja' }], s.legs, (v) => (s.legs = v))),
      ...(s.variant === 'cargo' || s.variant === 'crew' || s.variant === 'hls' ? [range('Lading', s.payload / 1000, 0, 150, 5, ' t', (v) => (s.payload = v * 1000))] : []),
      ...(s.variant === 'crew' || s.variant === 'hls' ? [range('Bemanning', s.crew, 0, s.variant === 'crew' ? 12 : 4, 1, '', (v) => (s.crew = v))] : []),
    );
  }
  function renderStats() {
    const st = designStats(d);
    const kv = (k: string, v: string, cls = '') => h('div', 'kv', h('span', null, k), h('b', { class: cls }, v));
    const twrCls = st.liftoffTWR < 1.05 ? 'bad' : st.liftoffTWR < 1.25 ? 'warn' : 'good';
    const dvPct = Math.min(1, st.dvTotal / 12000);
    fill(stats, 
      h('div', 'lbl', 'Prestaties'),
      h('div', { style: { fontSize: '26px', fontWeight: 900, fontFamily: 'var(--mono)' } } as any, Math.round(st.dvTotal).toLocaleString('nl-NL') + ' m/s'),
      h('div', 'dim', { style: { fontSize: '10px' } } as any, 'Totale Δv'),
      h('div', 'bar' + (st.leoCapable ? ' good' : ''), h('i', { style: { width: dvPct * 100 + '%' } })),
      h('div', 'dim', { style: { fontSize: '10px', marginBottom: '4px' } } as any, st.leoCapable ? '✓ Bereikt een baan om de aarde (≥ 9,2 km/s)' : 'Suborbitaal — niet genoeg Δv voor een baan'),
      kv('TWR bij lancering', st.liftoffTWR.toFixed(2), twrCls),
      kv('Massa', (st.totalMass / 1000).toFixed(0) + ' t'),
      kv('Hoogte', st.height.toFixed(0) + ' m'),
      st.booster ? kv('Booster Δv', Math.round(st.booster.dv) + ' m/s') : null,
      st.booster ? kv('Booster brandduur', Math.round(st.booster.burnTime) + ' s') : null,
      kv('Schip Δv', Math.round(st.ship.dv) + ' m/s'),
      kv('Schip TWR (vac)', st.ship.twrVac.toFixed(2)),
      kv('Lading', (st.payload / 1000).toFixed(0) + ' t'),
      kv('Onderdelen', money(st.cost)),
      g ? kv('Bouwkosten', money(buildCost(g, d))) : null,
      g ? kv('Bouwtijd', buildDays(g, d) + ' dagen') : null,
      ...st.warnings.map((w) => h('div', { style: { fontSize: '10.5px', color: '#ffcf8a', lineHeight: '1.3', marginTop: '3px' } } as any, '⚠ ' + w)),
      h('div', 'grow'),
      h('div', 'row', { style: { gap: '5px', marginTop: '6px' } } as any,
        btn('💾 Opslaan', save, 'small primary grow'),
        !d.builtin && stored().some((x) => x.id === d.id) ? btn('🗑', del, 'small danger') : null),
      g ? btn('🏭 Bouwen · ' + money(buildCost(g, d)), build, 'small go') : null);
  }
  const stored = () => (g ? g.designs : loadSandboxDesigns());
  function save() {
    if (d.builtin) fork();
    const list = stored(); const i = list.findIndex((x) => x.id === d.id);
    if (i >= 0) list[i] = clone(d); else list.push(clone(d));
    if (g) saveGame(g); else saveSandboxDesigns(list);
    audio.chime(); toast('Ontwerp opgeslagen: ' + d.name, 'good'); renderSide(); renderStats();
  }
  function del() {
    confirmBox('Ontwerp verwijderen?', `<b>${d.name}</b> verwijderen?`, 'Verwijderen', () => {
      const list = stored().filter((x) => x.id !== d.id);
      if (g) { g.designs = list; saveGame(g); } else saveSandboxDesigns(list);
      d = clone(BUILTIN_DESIGNS.find((x) => x.id === 'v2') || BUILTIN_DESIGNS[0]); changed();
    }, 'danger');
  }
  function build() {
    if (!g) return;
    if (d.builtin === false && !stored().some((x) => x.id === d.id)) save();
    if (designStats(d).warnings.some((w) => w.includes('komt niet van het platform'))) { toast('Dit ontwerp komt niet van de grond!', 'bad'); audio.warn(); return; }
    const busy = g.builds.filter((b) => !b.ready && b.flights === 0).length;
    if (busy >= maxParallelBuilds(g)) { toast(`High bay vol (${busy}/${maxParallelBuilds(g)}). Upgrade faciliteiten.`, 'bad'); return; }
    const b = orderBuild(g, d);
    if (!b) { toast('Niet genoeg geld', 'bad'); audio.warn(); return; }
    saveGame(g); audio.coin(); toast(`🏭 ${b.name} in productie: ${b.daysLeft} dagen`, 'good'); renderStats();
  }
  renderSide(); renderStats(); app.setBackdrop(d, 15.8);
  app.setScreen(h('div', 'screen designer',
    h('div', 'topbar glass', btn('‹ Terug', back, 'small ghost'), h('div', 'title', 'Ontwerper'), h('div', 'grow'), g ? h('span', 'pill', money(g.money)) : h('span', 'pill', 'Sandbox')),
    h('div', 'body', side, h('div', 'grow'), stats)));
}
