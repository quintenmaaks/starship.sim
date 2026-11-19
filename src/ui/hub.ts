// Hoofdkwartier (carrière): tabbladen voor missies, contracten, vloot, R&D, faciliteiten, team, financiën, certificering, prestaties
import type { App } from '../app';
import { h, btn, modal, toast, confirmBox, lineChart } from './dom';
import { audio } from './audio';
import { GameState, saveGame, findDesign, Build } from '../game/state';
import { MISSIONS, MissionDef, MISSION_BY_ID } from '../game/missions';
import {
  ROLES, payrollPerDay, teamQuality, PREP_LABEL, Prep, reliabilityFor, buildCost, buildDays, maxParallelBuilds, valuation, debt, creditRating, loanOffers, takeLoan, repayLoan,
  canIPO, doIPO, issueShares, acceptContract, advanceDays, startResearch, startUpgrade, orderBuild, hire, MILESTONES, CERT_REQS, certified, nextGoals, ACHIEVEMENTS, dateStr, REGULATOR, grantMilestone, news,
} from '../game/economy';
import { RESEARCH, RESEARCH_BY_ID, RESEARCH_CAT, FACILITIES } from '../game/research';
import { missionLock, designAllowed, buildsFor, prepDays, prepCost, padWait, launchMission, FlightCtx, nextMissionSuggestion } from '../game/career';
import { FlightSetup } from '../flight/setup';
import { money, gameDate } from '../core/util';
import { showDesigner } from './designer';
import { showMenu, settingsModal } from './menu';
import { listReplays, loadReplay } from '../flight/replay';

type Tab = 'overzicht' | 'missies' | 'contracten' | 'vloot' | 'onderzoek' | 'faciliteiten' | 'team' | 'financien' | 'cert' | 'prestaties';
const TABS: [Tab, string][] = [['overzicht', '🏠 Overzicht'], ['missies', '🚀 Missies'], ['contracten', '📜 Contracten'], ['vloot', '🏭 Vloot'], ['onderzoek', '🔬 R&D'], ['faciliteiten', '🏗️ Faciliteiten'], ['team', '👷 Team'], ['financien', '📈 Financiën'], ['cert', '🛡️ Certificering'], ['prestaties', '🏆 Prestaties']];
let curTab: Tab = 'overzicht';

const pct = (v: number) => (v * 100).toFixed(0) + '%';
const kv = (k: string, v: string | Node, color = '') => h('div', 'kv', h('span', null, k), h('b', { style: { color } }, v as any));
const bar = (v: number, good = false) => h('div', 'bar' + (good ? ' good' : ''), h('i', { style: { width: Math.max(0, Math.min(1, v)) * 100 + '%' } }));

export function showHub(app: App, tab?: string) {
  const g = app.g!;
  if (tab) curTab = tab as Tab;
  // achtergrond: het meest geavanceerde voertuig op het platform
  const ready = g.builds.filter((b) => b.ready);
  const showD = findDesign(g, (ready[ready.length - 1] || g.builds[g.builds.length - 1])?.designId || 'hopper');
  app.setBackdrop(showD, 16.4);

  const topbar = h('div', 'topbar glass');
  const tabs = h('div', 'tabs');
  const body = h('div', 'body');
  const render = () => {
    const sp = g.isPublic ? g.stock.length > 1 ? g.sharePrice / g.stock[Math.max(0, g.stock.length - 8)].p - 1 : 0 : 0;
    topbar.replaceChildren(
      btn('☰', () => hubMenu(app), 'small ghost'),
      h('div', null, h('div', 'title', g.company), h('div', 'dim', { style: { fontSize: '10px' } } as any, dateStr(g) + ' · dag ' + Math.floor(g.day))),
      h('div', 'grow'),
      h('div', 'stat', h('span', 'lbl', 'Kas'), h('b', { style: { color: g.money < 0 ? '#ff7a6a' : '#4be38a' } }, money(g.money))),
      h('div', 'stat', h('span', 'lbl', 'Reputatie'), h('b', null, g.rep.toFixed(0))),
      h('div', 'stat', h('span', 'lbl', 'Hype'), h('b', null, g.hype.toFixed(0))),
      g.isPublic ? h('div', 'stat', h('span', 'lbl', 'Aandeel'), h('b', { style: { color: sp >= 0 ? '#4be38a' : '#ff7a6a' } }, '€ ' + g.sharePrice.toFixed(2) + (sp >= 0 ? ' ▲' : ' ▼'))) : null,
      btn('+1 dag', () => { skip(1); }, 'small'),
      btn('⏭ ' + skipLabel(g), () => skip(skipDays(g)), 'small primary'));
    tabs.replaceChildren(...TABS.map(([id, l]) => h('div', { class: 'tab' + (id === curTab ? ' on' : ''), onClick: () => { curTab = id; render(); } }, l, badge(g, id) ? h('i', 'dot') : null)));
    body.replaceChildren(TABFN[curTab](app, g, render));
  };
  const skip = (days: number) => {
    const before = new Set(Object.keys(g.research)); const nb = g.builds.filter((b) => b.ready).length;
    advanceDays(g, days); saveGame(g); audio.tap();
    const newR = Object.keys(g.research).filter((r) => !before.has(r));
    for (const r of newR) { toast('🔬 Onderzoek klaar: ' + (RESEARCH_BY_ID[r]?.name || r), 'gold', 3500); audio.chime(); if (r === 'orbital') grantMilestone(g, 'research_orbital', []); }
    if (g.builds.filter((b) => b.ready).length > nb) { toast('🏭 Nieuw voertuig klaar voor de vlucht!', 'good', 3500); audio.chime(); }
    if (g.money < 0) toast('⚠ Negatief saldo — neem een lening of verkoop aandelen', 'bad', 4000);
    render();
  };
  render();
  app.setScreen(h('div', 'screen hub', topbar, tabs, h('div', { style: { height: '6px' } }), body));
  tutorial(app, g, render);
}
function skipDays(g: GameState) {
  const c: number[] = [];
  for (const b of g.builds) if (!b.ready && b.daysLeft > 0) c.push(b.daysLeft);
  if (g.researching) c.push(g.researching.left);
  for (const u of ((g as any).upgrading || []) as { left: number }[]) c.push(u.left);
  const wait = g.padBusyUntil - g.day; if (wait > 0) c.push(wait);
  const d = c.length ? Math.min(...c) : 7;
  return Math.max(1, Math.min(90, Math.ceil(d)));
}
function skipLabel(g: GameState) { const d = skipDays(g); return `${d} d`; }
function badge(g: GameState, t: Tab) {
  if (t === 'contracten') return g.contracts.some((c) => c.daily && !c.accepted);
  if (t === 'onderzoek') return !g.researching;
  if (t === 'financien') return g.money < 0;
  return false;
}
function hubMenu(app: App) {
  const g = app.g!;
  modal('Menu', h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
    btn('💾 Opslaan', () => { saveGame(g); toast('Opgeslagen', 'good'); }, ''),
    btn('⚙️ Instellingen', () => settingsModal(), ''),
    btn('📐 Ontwerper', () => showDesigner(app, g, () => app.hub()), ''),
    btn('🏠 Hoofdmenu', () => { saveGame(g); app.menu(); }, 'ghost')), [{ label: 'Sluiten' }]);
}

// ---------------- Overzicht ----------------
function tabOverview(app: App, g: GameState, render: () => void) {
  const sug = nextMissionSuggestion(g);
  const goals = nextGoals(g, 3);
  const daily = g.contracts.find((c) => c.daily && c.deadlineDay > g.day);
  const doneM = Object.keys(g.milestones).length;
  const left = h('div', 'panel glass scroll', { style: { flex: '1.25' } } as any,
    h('div', 'lbl', 'Volgende missie'),
    h('div', 'row', h('span', { style: { fontSize: '30px' } } as any, sug.m.icon), h('div', 'grow', h('div', { style: { fontWeight: 800, fontSize: '16px' } } as any, sug.m.title), h('div', 'dim', { style: { fontSize: '11px' } } as any, sug.m.short)),
      btn(sug.lock.ok ? 'VLIEG ▶' : '🔒', () => (sug.lock.ok ? prepDialog(app, sug.m) : toast(sug.lock.why.join(' · '), 'bad', 4000)), sug.lock.ok ? 'go' : 'disabled')),
    !sug.lock.ok ? h('div', { style: { fontSize: '11px', color: '#ffcf8a' } } as any, sug.lock.why.join(' · ')) : null,
    daily ? h('div', { class: 'goal', style: { borderColor: 'rgba(255,211,107,.45)', cursor: 'pointer' }, onClick: () => { curTab = 'contracten'; render(); } }, h('div', 'n', 'Dagelijks'), h('div', 'grow', h('b', null, daily.title), h('div', 'dim', { style: { fontSize: '10.5px' } } as any, daily.desc)), h('span', 'pill gold', '+' + money(daily.pay))) : null,
    h('div', 'lbl', `Doelen · ${doneM}/${MILESTONES.length} mijlpalen`),
    bar(doneM / MILESTONES.length, true),
    ...goals.map((m, i) => h('div', 'goal', h('div', 'n', i === 0 ? 'Nu' : 'Daarna'), h('div', 'grow', h('b', null, m.title), h('div', 'dim', { style: { fontSize: '10.5px' } } as any, m.desc)), h('span', 'pill good', '+' + money(m.reward.money)))),
    h('div', 'lbl', 'Statistieken'),
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: '12px' } } as any,
      kv('Vluchten', String(g.stats.flights)), kv('Geslaagd', String(g.stats.successes)),
      kv('Vangsten', String(g.stats.catches)), kv("RUD's", String(g.stats.rud)),
      kv('Reeks', String(g.stats.streak) + ' 🔥'), kv('Waardering', money(valuation(g)))));
  const right = h('div', 'panel glass scroll', { style: { flex: '1' } } as any,
    h('div', 'lbl', '📰 Nieuws'),
    ...(g.news.length ? g.news.slice(0, 25).map((n) => h('div', 'news ' + n.kind, h('span', 'd', gameDate(n.day)), n.text)) : [h('div', 'dim', 'Welkom in Starbase! Het verhaal van je bedrijf begint hier.')]));
  return h('div', { style: { display: 'flex', gap: '8px', flex: '1', minHeight: '0' } }, left, right);
}

// ---------------- Missies ----------------
function tabMissions(app: App, g: GameState) {
  const sections: [string, MissionDef[]][] = [['Testcentrum', MISSIONS.filter((m) => m.cat === 'test' || ['hop150', 'hop10k'].includes(m.id))], ['Vluchten', MISSIONS.filter((m) => m.cat === 'flight' && !['hop150', 'hop10k'].includes(m.id))]];
  return h('div', 'panel glass scroll', { style: { flex: '1' } } as any, ...sections.flatMap(([title, ms]) => [
    h('div', 'lbl', title),
    h('div', 'cards', ...ms.map((m) => {
      const lock = missionLock(g, m); const t = g.tests[m.id];
      const hasC = g.contracts.some((c) => c.accepted && c.mission === m.id);
      return h('div', { class: 'card' + (lock.ok ? '' : ' locked'), onClick: () => (lock.ok ? prepDialog(app, m) : toast(lock.why.join(' · '), 'bad', 4000)) },
        h('div', 'row', h('span', 'ic', lock.ok ? m.icon : '🔒'), h('div', 'grow'), hasC ? h('span', 'pill gold', '📜') : null, h('span', 'pill', '★'.repeat(m.hard))),
        h('div', 't', m.title), h('div', 's', lock.ok ? m.short : lock.why[0]),
        h('div', 'row', { style: { gap: '4px' } } as any, h('span', 'pill', money(m.cost)), m.reward.money ? h('span', 'pill good', '+' + money(m.reward.money)) : null, t ? h('span', 'pill acc', `${t.ok}/${t.count} ✓`) : null));
    }))]));
}

// ---------------- Voorbereiding ----------------
export function prepDialog(app: App, m: MissionDef) {
  const g = app.g!;
  const ok = (b: Build) => b.ready && designAllowed(m, findDesign(g, b.designId));
  const builds = buildsFor(g, m).filter((b) => b.ready);
  const testArticle = m.id === 'tank';
  let build: Build | null = builds[0] || null;
  let prep: Prep = 'normal';
  let hour = 13;
  const contracts = g.contracts.filter((c) => c.accepted && c.mission === m.id);
  let contractId: string | undefined = contracts[0]?.id;
  const body = h('div', null);
  const draw = () => {
    const design = build ? findDesign(g, build.designId) : findDesign(g, m.designs[0] === '*' ? 'sn' : m.designs[0]);
    const rel = reliabilityFor(g, design, prep, build);
    const days = prepDays(m, prep, g), wait = padWait(g, m), cost = prepCost(g, m, prep);
    const segs = (opts: [any, string][], cur: any, set: (v: any) => void) => h('div', 'seg', ...opts.map(([v, l]) => btn(l, () => { set(v); draw(); }, 'small' + (v === cur ? ' on' : ''))));
    body.replaceChildren(
      h('div', 'dim', { style: { fontSize: '11.5px', marginBottom: '6px' } } as any, m.desc),
      h('div', 'lbl', 'Voertuig'),
      testArticle ? h('div', 'pill acc', 'Testtank (wordt meegeleverd)') :
        builds.length ? h('div', 'seg', ...builds.map((b) => btn(`${b.name}${b.flights ? ` · ${b.flights}× gevlogen · ${pct(b.condition)}` : ' · nieuw'}${b.tested.static ? ' 🔥' : ''}${b.tested.cryo ? ' ❄️' : ''}`, () => { build = b; draw(); }, 'small' + (b === build ? ' on' : ''))))
          : h('div', null, h('div', { style: { color: '#ffcf8a', fontSize: '12px' } } as any, 'Geen geschikt voertuig klaar. ' + (g.builds.some((b) => !b.ready && designAllowed(m, findDesign(g, b.designId))) ? 'Er is er een in productie — spoel de tijd door.' : 'Bestel er een in de Vloot.')),
            btn('🏭 Bestel ' + findDesign(g, m.designs[0] === '*' ? 'sn' : m.designs[0]).name, () => { const d = findDesign(g, m.designs[0] === '*' ? 'sn' : m.designs[0]); const b = orderBuild(g, d); if (b) { saveGame(g); toast(`${b.name}: klaar over ${b.daysLeft} dagen`, 'good'); md.close(); app.hub(); } else toast('Niet genoeg geld', 'bad'); }, 'small')),
      h('div', 'lbl', { style: { marginTop: '6px' } } as any, 'Voorbereiding'),
      segs([['rush', '⚡ Haasten'], ['normal', 'Standaard'], ['thorough', '🧯 Extra testen']], prep, (v) => (prep = v)),
      h('div', 'dim', { style: { fontSize: '10.5px' } } as any, prep === 'rush' ? 'Sneller en goedkoper, maar veel meer kans op storingen. Moraal daalt.' : prep === 'thorough' ? 'Langer en duurder, maar veel betrouwbaarder.' : 'Normale procedures.'),
      m.noFlight ? null : h('div', null, h('div', 'lbl', { style: { marginTop: '6px' } } as any, 'Lanceervenster'), segs([[9, 'Ochtend'], [13, 'Middag'], [16.9, 'Zonsondergang'], [23, 'Nacht']], hour, (v) => (hour = v))),
      contracts.length ? h('div', null, h('div', 'lbl', { style: { marginTop: '6px' } } as any, 'Contract'), segs([[undefined, 'Geen'], ...contracts.map((c) => [c.id, `${c.title} (+${money(c.pay)})`] as [any, string])], contractId, (v) => (contractId = v))) : null,
      h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: '14px', marginTop: '8px' } } as any,
        h('div', null,
          h('div', 'lbl', 'Geschatte slagingskans'),
          h('div', { style: { fontSize: '24px', fontWeight: 900, fontFamily: 'var(--mono)', color: rel.score > 0.85 ? '#4be38a' : rel.score > 0.65 ? '#ffcf8a' : '#ff7a6a' } } as any, pct(rel.score)),
          ...rel.breakdown.map((b) => h('div', null, h('div', 'kv', { style: { border: 'none', padding: '1px 0' } } as any, h('span', null, b.label), h('b', null, pct(b.val))), bar(b.val, b.val > 0.9)))),
        h('div', null,
          h('div', 'lbl', 'Planning'),
          kv('Kosten', money(cost), g.money < cost ? '#ff7a6a' : ''),
          kv('Voorbereiding', days + ' dagen'),
          wait ? kv('Wachten op platform', wait + ' dagen', '#ffcf8a') : null,
          kv('Beloning', m.reward.money ? '+' + money(m.reward.money) : '—'),
          kv('Ervaring', m.heritage.join(', ') || '—'),
          h('div', 'dim', { style: { fontSize: '10px', marginTop: '6px' } } as any, 'Elke vlucht bouwt ervaring op: de autopiloot en hardware worden steeds betrouwbaarder.'))));
    md.box.querySelector('.go')?.toggleAttribute('disabled', !(testArticle || (build && ok(build))));
  };
  const md = modal(m.icon + ' ' + m.title, body, [
    { label: 'Annuleren', cls: 'ghost' },
    { label: m.noFlight ? 'START TEST ▶' : 'LANCEREN ▶', cls: 'go', onClick: () => {
      if (!testArticle && !build) { toast('Geen voertuig', 'bad'); return true; }
      if (g.money < prepCost(g, m, prep) && g.money < 0) { toast('Niet genoeg geld — neem een lening', 'bad'); return true; }
      flyCareer(app, m, build, prep, hour, contractId);
    } }], true);
  draw();
}
function flyCareer(app: App, m: MissionDef, build: Build | null, prep: Prep, hour: number, contractId?: string) {
  const g = app.g!;
  const design = build ? findDesign(g, build.designId) : findDesign(g, 'sn');
  const relInfo = reliabilityFor(g, design, prep, build);
  const ctx: FlightCtx = { mission: m, design, build, prep, contractId, relScore: relInfo.score, hour };
  launchMission(g, ctx);
  const setup = new FlightSetup({ mission: m, design, rel: relInfo.rel, hour, wind: 2 + Math.random() * 8 });
  app.fly(setup, ctx, (r, rw) => app.results(r, rw, () => app.hub(), () => { app.hub(); prepDialog(app, m); }), () => app.hub());
}

// ---------------- Contracten ----------------
function tabContracts(app: App, g: GameState, render: () => void) {
  const open = g.contracts.filter((c) => !c.accepted), acc = g.contracts.filter((c) => c.accepted);
  const card = (c: GameState['contracts'][0]) => {
    const m = MISSION_BY_ID[c.mission];
    return h('div', { class: 'card', style: c.daily ? { borderColor: 'rgba(255,211,107,.5)' } : {} },
      h('div', 'row', h('span', 'ic', m?.icon || '📜'), h('div', 'grow'), c.daily ? h('span', 'pill gold', 'VANDAAG') : h('span', 'pill', 'tot ' + gameDate(c.deadlineDay))),
      h('div', 't', c.title), h('div', 's', `${c.client} · ${c.desc}`),
      h('div', 'row', { style: { gap: '4px' } } as any, h('span', 'pill good', '+' + money(c.pay)), c.advance ? h('span', 'pill', 'voorschot ' + money(c.advance)) : null, h('span', 'pill', m?.title || c.mission)),
      c.accepted ? btn('Vliegen ▶', () => { const lk = missionLock(g, m); if (!lk.ok) toast(lk.why.join(' · '), 'bad'); else prepDialog(app, m); }, 'small go')
        : btn('Accepteren', () => { acceptContract(g, c.id); saveGame(g); audio.coin(); toast('Contract getekend: ' + c.title, 'good'); render(); }, 'small primary'));
  };
  return h('div', 'panel glass scroll', { style: { flex: '1' } } as any,
    h('div', 'lbl', 'Geaccepteerd'), acc.length ? h('div', 'cards', ...acc.map(card)) : h('div', 'dim', { style: { fontSize: '11px' } } as any, 'Nog geen lopende contracten.'),
    h('div', 'lbl', 'Aanbiedingen (wisselen dagelijks)'), open.length ? h('div', 'cards', ...open.map(card)) : h('div', 'dim', { style: { fontSize: '11px' } } as any, 'Geen aanbiedingen. Bouw reputatie op met geslaagde vluchten.'));
}

// ---------------- Vloot ----------------
function tabFleet(app: App, g: GameState, render: () => void) {
  const busy = g.builds.filter((b) => !b.ready && b.flights === 0).length;
  const designs = [...['hopper', 'sn', 'ift', 'v2', 'v3t', 'v3c', 'hls'].map((id) => findDesign(g, id)), ...g.designs];
  return h('div', { style: { display: 'flex', gap: '8px', flex: '1', minHeight: '0' } },
    h('div', 'panel glass scroll', { style: { flex: '1' } } as any,
      h('div', 'lbl', `Voertuigen · High Bay ${busy}/${maxParallelBuilds(g)} in gebruik`),
      h('div', 'cards', ...g.builds.map((b) => h('div', 'card',
        h('div', 'row', h('span', 'ic', b.kind === 'stack' ? '🚀' : '🛸'), h('div', 'grow'), b.ready ? h('span', 'pill good', 'KLAAR') : h('span', 'pill warn', Math.ceil(b.daysLeft) + ' d')),
        h('div', 't', b.name), h('div', 's', `${b.flights}× gevlogen · conditie ${pct(b.condition)}${b.tested.cryo ? ' · ❄️ cryo ✓' : ''}${b.tested.static ? ' · 🔥 static ✓' : ''}`),
        !b.ready ? bar(1 - b.daysLeft / Math.max(1, b.daysTotal)) : null,
        h('div', 'row', h('div', 'grow'), btn('Sloop', () => confirmBox('Slopen?', `${b.name} slopen? Onderdelen leveren 10% terug.`, 'Slopen', () => { g.builds = g.builds.filter((x) => x !== b); g.money += buildCost(g, findDesign(g, b.designId)) * 0.1; saveGame(g); render(); }, 'danger'), 'tiny ghost')))))),
    h('div', 'panel glass scroll', { style: { width: '290px' } } as any,
      h('div', 'lbl', 'Productie bestellen'),
      ...designs.map((d) => {
        const lockedR = d.booster.enabled && !g.research.orbital ? 'orbital' : d.ship.variant === 'hls' && !g.research.hls ? 'hls' : d.ship.variant === 'crew' && !g.research.crew ? 'crew' : d.ship.engineType === 'r3' && !g.research.raptor3 ? 'raptor3' : d.ship.engineType === 'r2' && !g.research.raptor2 ? 'raptor2' : null;
        return h('div', 'goal', h('div', 'grow', h('b', null, d.name), h('div', 'dim', { style: { fontSize: '10px' } } as any, lockedR ? '🔒 ' + RESEARCH_BY_ID[lockedR].name : `${money(buildCost(g, d))} · ${buildDays(g, d)} dagen`)),
          btn('Bouw', () => {
            if (lockedR) { toast('Onderzoek nodig: ' + RESEARCH_BY_ID[lockedR].name, 'bad'); return; }
            if (busy >= maxParallelBuilds(g)) { toast('High Bay vol — upgrade faciliteiten', 'bad'); return; }
            const b = orderBuild(g, d); if (!b) { toast('Niet genoeg geld', 'bad'); audio.warn(); return; }
            saveGame(g); audio.coin(); toast(`🏭 ${b.name} in productie`, 'good'); render();
          }, 'tiny' + (lockedR ? ' disabled' : ' primary')));
      }),
      btn('📐 Ontwerper openen', () => showDesigner(app, g, () => app.hub('vloot')), 'small')));
}

// ---------------- R&D ----------------
function tabResearch(_app: App, g: GameState, render: () => void) {
  const cats = Object.keys(RESEARCH_CAT);
  const cur = g.researching ? RESEARCH_BY_ID[g.researching.id] : null;
  return h('div', 'panel glass scroll', { style: { flex: '1' } } as any,
    cur ? h('div', 'goal', h('div', 'n', 'Bezig'), h('div', 'grow', h('b', null, cur.name), bar(1 - g.researching!.left / cur.days)), h('span', 'pill', Math.ceil(g.researching!.left) + ' d')) : h('div', 'goal', { style: { borderColor: 'rgba(255,122,106,.5)' } } as any, '⚠ Geen onderzoek actief — kies er een! Ingenieurs zitten stil.'),
    ...cats.flatMap((c) => {
      const rs = RESEARCH.filter((r) => r.cat === c); if (!rs.length) return [];
      return [h('div', 'lbl', RESEARCH_CAT[c]), h('div', 'tree', ...rs.map((r) => {
        const done = !!g.research[r.id], reqOk = r.req.every((x) => g.research[x]), active = g.researching?.id === r.id;
        return h('div', { class: 'card' + (done ? ' sel' : !reqOk ? ' locked' : ''), onClick: () => {
          if (done || active) return;
          if (!reqOk) { toast('Eerst: ' + r.req.filter((x) => !g.research[x]).map((x) => RESEARCH_BY_ID[x].name).join(', '), 'bad'); return; }
          if (g.researching) { toast('Er loopt al onderzoek', 'bad'); return; }
          if (startResearch(g, r.id)) { saveGame(g); audio.coin(); toast('🔬 Onderzoek gestart: ' + r.name, 'good'); render(); } else toast('Niet genoeg geld', 'bad');
        } }, h('div', 'row', h('b', { style: { fontSize: '12.5px' } } as any, (done ? '✓ ' : !reqOk ? '🔒 ' : '') + r.name), h('div', 'grow'), active ? h('span', 'pill acc', 'bezig') : null),
          h('div', 's', r.desc), done ? null : h('div', 'row', { style: { gap: '4px' } } as any, h('span', 'pill', money(r.cost)), h('span', 'pill', r.days + ' d')));
      }))];
    }));
}

// ---------------- Faciliteiten ----------------
function tabFacilities(_app: App, g: GameState, render: () => void) {
  const up = ((g as any).upgrading || []) as { id: string; left: number }[];
  return h('div', 'panel glass scroll', { style: { flex: '1' } } as any, h('div', 'lbl', 'Starbase-faciliteiten'),
    h('div', 'cards', ...FACILITIES.map((f) => {
      const lvl = g.facilities[f.id] || 0, next = f.levels[lvl + 1], u = up.find((x) => x.id === f.id);
      return h('div', 'card',
        h('div', 'row', h('b', null, f.name), h('div', 'grow'), h('span', 'pill acc', `niv. ${lvl + 1}/${f.levels.length}`)),
        h('div', 's', f.desc), h('div', 's', '✓ ' + f.levels[lvl].effect),
        u ? h('div', null, h('div', 'dim', { style: { fontSize: '10.5px' } } as any, `In aanbouw: ${Math.ceil(u.left)} d`), bar(1 - u.left / next.days)) :
          next ? h('div', 'row', h('div', 's grow', '→ ' + next.effect), btn(`${money(next.cost)} · ${next.days} d`, () => { if (startUpgrade(g, f.id)) { saveGame(g); audio.coin(); toast('🏗️ Bouw gestart: ' + f.name, 'good'); render(); } else toast('Niet genoeg geld', 'bad'); }, 'tiny primary')) : h('span', 'pill good', 'Maximaal'));
    })));
}

// ---------------- Team ----------------
function tabTeam(_app: App, g: GameState, render: () => void) {
  const tq = teamQuality(g);
  const roles = Object.keys(ROLES) as (keyof GameState['team'])[];
  return h('div', { style: { display: 'flex', gap: '8px', flex: '1', minHeight: '0' } },
    h('div', 'panel glass scroll', { style: { flex: '1' } } as any, h('div', 'lbl', 'Personeel'),
      ...roles.map((r) => h('div', 'goal', h('div', 'grow', h('b', null, `${ROLES[r].name}: ${g.team[r]}`), h('div', 'dim', { style: { fontSize: '10px' } } as any, `${ROLES[r].desc} · ${money(ROLES[r].salary)}/jaar`)),
        btn('−10', () => { hire(g, r, -Math.min(10, g.team[r])); saveGame(g); render(); }, 'tiny ghost'),
        btn('+10', () => { if (hire(g, r, r === 'pilots' ? 2 : 10)) { saveGame(g); audio.coin(); render(); } else toast('Niet genoeg geld', 'bad'); }, 'tiny'),
        btn('+50', () => { if (hire(g, r, r === 'pilots' ? 4 : 50)) { saveGame(g); audio.coin(); render(); } else toast('Niet genoeg geld', 'bad'); }, 'tiny primary')))),
    h('div', 'panel glass', { style: { width: '250px' } } as any,
      h('div', 'lbl', 'Moraal'), h('div', { style: { fontSize: '24px', fontWeight: 900 } } as any, g.morale.toFixed(0) + '%'), bar(g.morale / 100, g.morale > 60),
      kv('Loonkosten', money(payrollPerDay(g) * 30) + '/mnd'),
      kv('Teamkwaliteit', pct(tq.overall / 1.4)),
      kv('Ingenieurs', pct(tq.eng / 1.4)), kv('Productie', pct(tq.tech / 1.4)), kv('Veiligheid', pct(tq.safety / 1.5)),
      h('div', 'lbl', { style: { marginTop: '6px' } } as any, 'Crunch-modus'),
      h('div', 'dim', { style: { fontSize: '10.5px' } } as any, '+25% tempo, +35% loonkosten, maar moraal daalt en het storingsrisico stijgt.'),
      btn(g.crunch ? '🔥 Crunch AAN' : 'Crunch uit', () => { g.crunch = !g.crunch; news(g, g.crunch ? 'Crunch-modus: overuren voor iedereen' : 'Crunch voorbij — normale werktijden', g.crunch ? 'bad' : 'good'); saveGame(g); render(); }, 'small' + (g.crunch ? ' danger' : ''))));
}

// ---------------- Financiën ----------------
function tabFinance(_app: App, g: GameState, render: () => void) {
  const cr = creditRating(g); const lo = loanOffers(g); const ipo = canIPO(g);
  const pts = g.stock.map((s) => ({ x: s.d, y: s.p }));
  const chartBox = h('div', null, g.isPublic && pts.length > 1 ? lineChart(pts, 420, 150, pts[pts.length - 1].y >= pts[0].y ? '#4be38a' : '#ff7a6a') : h('div', 'dim', { style: { fontSize: '11px', padding: '30px 0', textAlign: 'center' } } as any, g.isPublic ? 'Koersgeschiedenis wordt opgebouwd…' : 'Nog niet beursgenoteerd. Na een IPO zie je hier de koers live reageren op vluchten — en op lange stiltes.'));
  const growth = g.isPublic && g.stock.length ? g.sharePrice / g.stock[0].p - 1 : 0;
  return h('div', { style: { display: 'flex', gap: '8px', flex: '1', minHeight: '0' } },
    h('div', 'panel glass scroll', { style: { flex: '1.3' } } as any,
      h('div', 'row', h('div', null, h('div', 'lbl', g.isPublic ? 'Aandeel STAR' : 'Bedrijfswaardering'), h('div', { style: { fontSize: '26px', fontWeight: 900, fontFamily: 'var(--mono)' } } as any, g.isPublic ? '€ ' + g.sharePrice.toFixed(2) : money(valuation(g)))),
        h('div', 'grow'), g.isPublic ? h('span', 'pill ' + (growth >= 0 ? 'good' : 'bad'), (growth >= 0 ? '▲ ' : '▼ ') + (growth * 100).toFixed(1) + '% sinds IPO') : null),
      chartBox,
      g.isPublic ? h('div', 'dim', { style: { fontSize: '10.5px' } } as any, `Marktkapitalisatie ${money(valuation(g))} · jouw belang ${pct(g.ownerShares / g.sharesOut)} · ${Math.floor(g.day - g.lastFlightDay)} dagen sinds laatste vlucht${g.day - g.lastFlightDay > 30 ? ' — beleggers worden ongeduldig!' : ''}`) : null,
      h('div', 'lbl', 'Kapitaal ophalen'),
      !g.isPublic ? h('div', 'goal', h('div', 'grow', h('b', null, '🔔 Beursgang (IPO)'), h('div', 'dim', { style: { fontSize: '10.5px' } } as any, ipo.ok ? `Verkoop nieuwe aandelen. Indicatieve waardering ${money(valuation(g) * (0.9 + g.hype / 250))}.` : ipo.why.join(' · '))),
        ...[0.1, 0.2, 0.3].map((p) => btn(pct(p), () => confirmBox('Beursgang', `Breng ${pct(p)} nieuwe aandelen naar de beurs? Daarna reageert de koers op elke vlucht.`, 'Naar de beurs!', () => { doIPO(g, p); grantMilestone(g, 'ipo', []); saveGame(g); audio.fanfare(); render(); }), 'tiny' + (ipo.ok ? ' primary' : ' disabled'))))
        : h('div', 'goal', h('div', 'grow', h('b', null, 'Aandelenemissie'), h('div', 'dim', { style: { fontSize: '10.5px' } } as any, 'Nieuwe aandelen uitgeven: snel geld, maar verwatering en koersdruk.')),
          ...[0.03, 0.08].map((p) => btn(pct(p), () => { issueShares(g, p); saveGame(g); audio.coin(); render(); }, 'tiny primary'))),
      h('div', 'goal', h('div', 'grow', h('b', null, '🏛️ Overheidssubsidies'), h('div', 'dim', { style: { fontSize: '10.5px' } } as any, 'Subsidies en partnerschappen verschijnen als contracten (NASA, ESA, Space Force…).')))),
    h('div', 'panel glass scroll', { style: { flex: '1' } } as any,
      h('div', 'row', h('div', 'lbl', 'Krediet'), h('div', 'grow'), h('span', 'pill ' + (cr.score > 72 ? 'good' : cr.score > 45 ? 'warn' : 'bad'), 'Rating ' + cr.rating)),
      kv('Kas', money(g.money), g.money < 0 ? '#ff7a6a' : '#4be38a'), kv('Schuld', money(debt(g))), kv('Loonkosten', money(payrollPerDay(g) * 30) + '/mnd'),
      kv('Omzet totaal', money(g.stats.revenue)), kv('Uitgaven totaal', money(g.stats.spent)),
      h('div', 'lbl', 'Leningaanbod'),
      ...(lo.offers.length ? lo.offers.map((o) => h('div', 'goal', h('div', 'grow', h('b', null, o.name), h('div', 'dim', { style: { fontSize: '10px' } } as any, `${money(o.principal)} · ${(o.rate * 100).toFixed(1)}% · ${Math.round(o.termDays / 365)} jr`)),
        btn('Lenen', () => { takeLoan(g, o); saveGame(g); audio.coin(); render(); }, 'tiny primary'))) : [h('div', 'dim', { style: { fontSize: '11px' } } as any, 'Geen leningen beschikbaar bij deze kredietwaardigheid.')]),
      g.loans.length ? h('div', 'lbl', 'Lopende leningen') : null,
      ...g.loans.map((l) => h('div', 'goal', h('div', 'grow', h('b', null, l.name), h('div', 'dim', { style: { fontSize: '10px' } } as any, `saldo ${money(l.balance)} · ${(l.rate * 100).toFixed(1)}%`)),
        btn('Aflossen', () => { repayLoan(g, l.id, l.balance); saveGame(g); render(); }, 'tiny')))));
}

// ---------------- Certificering ----------------
function tabCert(app: App, g: GameState) {
  const done = CERT_REQS.filter((r) => r.check(g)).length;
  return h('div', 'panel glass scroll', { style: { flex: '1' } } as any,
    h('div', 'row', h('div', null, h('div', 'lbl', REGULATOR), h('div', { style: { fontSize: '17px', fontWeight: 800 } } as any, 'Certificering bemande maanvluchten')), h('div', 'grow'), certified(g) ? h('span', 'pill good', '✓ GECERTIFICEERD') : h('span', 'pill warn', `${done}/${CERT_REQS.length}`)),
    bar(done / CERT_REQS.length, certified(g)),
    ...CERT_REQS.map((r) => h('div', 'goal', h('span', null, r.check(g) ? '✅' : '⬜'), h('div', 'grow', r.label), h('span', 'pill', r.progress(g)))),
    certified(g) ? btn('🌕 Plan bemande maanlanding', () => prepDialog(app, MISSION_BY_ID.crewlunar), 'go') : h('div', 'dim', { style: { fontSize: '11px' } } as any, 'Pas na volledige certificering mag je mensen naar de Maan vliegen.'));
}

// ---------------- Prestaties ----------------
function tabAch(app: App, g: GameState) {
  const reps = listReplays();
  return h('div', { style: { display: 'flex', gap: '8px', flex: '1', minHeight: '0' } },
    h('div', 'panel glass scroll', { style: { flex: '1.2' } } as any,
      h('div', 'lbl', `Prestaties ${Object.keys(g.achievements).length}/${ACHIEVEMENTS.length}`),
      h('div', 'cards', ...ACHIEVEMENTS.map((a) => h('div', { class: 'card' + (g.achievements[a.id] ? ' sel' : ' locked') }, h('div', 'row', h('span', 'ic', g.achievements[a.id] ? a.icon : '🔒'), h('b', { style: { fontSize: '12px' } } as any, a.title)), h('div', 's', a.desc)))),
      h('div', 'lbl', 'Mijlpalen'),
      ...MILESTONES.map((m) => h('div', 'goal', h('span', null, g.milestones[m.id] !== undefined ? '🏆' : '⬜'), h('div', 'grow', h('b', null, m.title), h('div', 'dim', { style: { fontSize: '10px' } } as any, m.desc)), g.milestones[m.id] !== undefined ? h('span', 'pill good', gameDate(g.milestones[m.id])) : null))),
    h('div', 'panel glass scroll', { style: { flex: '1' } } as any,
      h('div', 'lbl', 'Vluchtlogboek'),
      ...(g.log.length ? g.log.slice(0, 40).map((l) => h('div', 'news ' + (l.result === 'succes' ? 'good' : l.result === 'mislukt' ? 'bad' : ''), h('span', 'd', gameDate(Math.floor(l.day))), `${l.title} · ${l.vehicle} · ${l.result} (${Math.round(l.score)})`)) : [h('div', 'dim', 'Nog geen vluchten.')]),
      h('div', 'lbl', 'Herhalingen'),
      ...reps.map((k) => { const d = loadReplay(k); return d ? btn('▶ ' + d.title, () => app.replay(d, () => app.hub('prestaties')), 'small ghost') : null; })));
}

const TABFN: Record<Tab, (app: App, g: GameState, render: () => void) => HTMLElement> = {
  overzicht: tabOverview, missies: tabMissions, contracten: tabContracts, vloot: tabFleet, onderzoek: tabResearch, faciliteiten: tabFacilities, team: tabTeam, financien: tabFinance, cert: tabCert, prestaties: tabAch,
};

// ---------------- Tutorial (eerste minuten) ----------------
function tutorial(app: App, g: GameState, render: () => void) {
  if (g.mode !== 'career' || g.tutorial.done) return;
  const steps = [
    ['Welkom in Starbase!', `Je bent de baas van <b>${g.company}</b>. Je hebt een Starhopper, een SN-prototype en € 450 mln. Doel: mensen op de Maan.`],
    ['Snel beginnen', 'Op het tabblad <b>Overzicht</b> staat altijd je <b>volgende missie</b>. Druk op <b>VLIEG ▶</b> voor je eerste hop van 150 m.'],
    ['Haasten of testen?', 'Bij elke missie kies je: <b>Haasten</b> (snel, goedkoop, riskant) of <b>Extra testen</b> (traag, duur, veilig). Elke vlucht maakt de autopiloot betrouwbaarder.'],
    ['Geld & tijd', 'Personeel kost elke dag geld. Neem <b>contracten</b> aan, doe <b>onderzoek</b> en ga later naar de <b>beurs</b>. De koers reageert op elke vlucht — en op lange stiltes!'],
  ];
  let i = 0;
  const box = h('div', 'tut glass', { style: { left: '50%', bottom: 'calc(14px + var(--sab))', transform: 'translateX(-50%)' } } as any);
  const draw = () => {
    const [t, s] = steps[i];
    box.replaceChildren(h('div', null, h('b', null, t)), h('div', { html: s, style: { marginTop: '4px' } }),
      h('div', 'row', h('span', 'dim', `${i + 1}/${steps.length}`), h('div', 'grow'), btn('Overslaan', () => end(), 'tiny ghost'), btn(i === steps.length - 1 ? 'Aan de slag!' : 'Volgende', () => { i++; if (i >= steps.length) end(); else draw(); }, 'tiny primary')));
  };
  const end = () => { g.tutorial.done = true; saveGame(g); box.remove(); render(); };
  draw();
  app.screenEl?.append(box);
}
