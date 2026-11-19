// Resultatenscherm na een vlucht: oordeel, score, beloningen (optellend), ontgrendelingen, confetti
import type { App } from '../app';
import type { FlightResult } from '../flight/controller';
import type { Reward } from '../game/career';
import { h, btn, countUp, confetti } from './dom';
import { audio } from './audio';
import { MILESTONES, ACHIEVEMENTS } from '../game/economy';
import { money, duration } from '../core/util';

export function showResults(app: App, r: FlightResult, rw: Reward, onContinue: () => void, onRetry?: () => void) {
  const career = !!(app.g && app.g.mode === 'career');
  const verdict = r.aborted ? ['AFGEBROKEN', '#c9d1db'] : r.success ? (r.score >= 90 ? ['PERFECTE MISSIE', '#ffd36b'] : ['MISSIE GESLAAGD', '#4be38a']) : r.partial ? ['GEDEELTELIJK GESLAAGD', '#ffcf8a'] : ['MISSIE MISLUKT', '#ff7a6a'];
  const stars = r.success ? (r.score >= 90 ? 3 : r.score >= 70 ? 2 : 1) : 0;
  const scoreEl = h('div', 'score', '0');
  const rewards = h('div', 'rewards');
  const rwBox = (cls: string, label: string, to: number, fmt: (v: number) => string, delay: number) => {
    const b = h('b', null, fmt(0)); const e = h('div', { class: 'reward ' + cls, style: { animationDelay: delay + 'ms' } }, b, h('span', null, label));
    rewards.append(e); countUp(b, to, fmt, 900, delay); return e;
  };
  let d = 400;
  if (career) {
    if (rw.money) { rwBox(rw.money >= 0 ? 'money' : 'neg', 'Inkomsten', rw.money, (v) => (v >= 0 ? '+' : '') + money(v), d); d += 180; }
    if (rw.rep) { rwBox(rw.rep >= 0 ? '' : 'neg', 'Reputatie', rw.rep, (v) => (v >= 0 ? '+' : '') + v.toFixed(0), d); d += 180; }
    if (rw.hype) { rwBox(rw.hype >= 0 ? '' : 'neg', 'Hype', rw.hype, (v) => (v >= 0 ? '+' : '') + v.toFixed(0), d); d += 180; }
    if (rw.stockPct) { rwBox(rw.stockPct >= 0 ? 'stock' : 'neg', 'Aandeel', rw.stockPct * 100, (v) => (v >= 0 ? '▲ ' : '▼ ') + Math.abs(v).toFixed(1) + '%', d); d += 180; }
  }
  rwBox('', 'Vluchtduur', r.simTime, (v) => duration(v), d); d += 180;
  if (r.metrics.maxAlt) { rwBox('', 'Max. hoogte', r.metrics.maxAlt / 1000, (v) => v.toFixed(v < 10 ? 2 : 0) + ' km', d); d += 180; }
  if (r.metrics.maxSpeed) { rwBox('', 'Topsnelheid', r.metrics.maxSpeed * 3.6, (v) => Math.round(v).toLocaleString('nl-NL') + ' km/u', d); d += 180; }
  if (r.metrics.accuracy !== undefined && isFinite(r.metrics.accuracy)) { rwBox('', 'Precisie', r.metrics.accuracy, (v) => v.toFixed(2) + ' m', d); d += 180; }

  const unlocks = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
  const addUnlock = (ic: string, t: string, s: string, delay: number) => {
    unlocks.append(h('div', { class: 'unlock', style: { animationDelay: delay + 'ms' } }, h('div', 'ic', ic), h('div', null, h('b', null, t), h('br'), h('span', null, s))));
    setTimeout(() => { audio.chime(); audio.haptic(30); }, delay);
  };
  let ud = d + 300;
  for (const id of rw.milestones) { const m = MILESTONES.find((x) => x.id === id); if (m) { addUnlock('🏆', 'Mijlpaal: ' + m.title, m.desc + (m.reward.money ? ' · +' + money(m.reward.money) : ''), ud); ud += 350; } }
  for (const id of rw.achievements) { const a = ACHIEVEMENTS.find((x) => x.id === id); if (a) { addUnlock(a.icon, 'Prestatie: ' + a.title, a.desc, ud); ud += 350; } }
  for (const u of rw.unlocks) { addUnlock('🔓', 'Ontgrendeld', u, ud); ud += 350; }
  for (const rec of rw.records) { addUnlock('📊', 'Nieuw record!', rec, ud); ud += 250; }

  const objs = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px' } }, ...r.objectives.map((o) => h('span', 'pill ' + (o.state === 'done' ? 'good' : o.state === 'fail' ? 'bad' : ''), (o.state === 'done' ? '✓ ' : o.state === 'fail' ? '✗ ' : '○ ') + o.label + (o.optional ? ' (bonus)' : ''))));
  const lines = h('div', null, ...rw.lines.map((l) => h('div', 'kv', h('span', null, l.label), h('b', { style: { color: l.kind === 'good' ? '#4be38a' : l.kind === 'bad' ? '#ff7a6a' : '' } }, l.value))));

  const box = h('div', 'box glass scroll',
    h('div', 'row', h('div', null,
      h('div', 'lbl', r.mission.icon + ' ' + r.mission.title),
      h('div', { class: 'verdict', style: { color: verdict[1] } }, verdict[0]),
      h('div', 'dim', { style: { fontSize: '11px' } } as any, r.endReason)),
      h('div', 'grow'),
      h('div', { style: { textAlign: 'right' } } as any, h('div', { style: { fontSize: '20px', letterSpacing: '4px', color: '#ffd36b' } } as any, '★'.repeat(stars) + '☆'.repeat(3 - stars)), scoreEl, h('div', 'lbl', 'score'))),
    objs, rewards, unlocks, lines,
    h('div', 'row', { style: { gap: '6px', marginTop: '4px' } } as any,
      btn('▶ Herhaling', () => app.replay(r.replay, () => showResults(app, r, { ...rw, milestones: [], achievements: [], records: [], unlocks: [] }, onContinue, onRetry)), 'small ghost'),
      h('div', 'grow'),
      onRetry ? btn(career ? '↻ Opnieuw' : '↻ Nog een keer', onRetry, 'small') : null,
      btn(career ? 'Naar hoofdkwartier ›' : 'Doorgaan ›', onContinue, 'small go')));
  app.setScreen(h('div', 'screen results', box));
  countUp(scoreEl, r.score, (v) => String(Math.round(v)), 1100, 200);
  if (r.success) { audio.fanfare(); confetti(r.score >= 90 ? 140 : 70); } else if (!r.aborted) audio.fail();
}
