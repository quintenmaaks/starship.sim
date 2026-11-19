// Carrièrelogica: missies voorbereiden (voertuig, voorbereiding, kosten) en vluchtresultaten verwerken.
import { GameState, Build, findDesign, allDesigns, globalRecords, saveRecords, saveGame } from './state';
import { MissionDef, MISSIONS, MISSION_BY_ID } from './missions';
import { Design } from './parts';
import { Prep, reliabilityFor, missionCost, refurbCost, buildDays, addMoney, news, stockShock, advanceDays, grantMilestone, grantAchievement, certified, padRecoveryDays, heritageOf } from './economy';
import { clamp, money } from '../core/util';
import type { FlightResult } from '../flight/controller';

export interface Lock { ok: boolean; why: string[] }
export function missionLock(g: GameState | null, m: MissionDef): Lock {
  const why: string[] = [];
  if (!g || g.mode === 'sandbox') return { ok: true, why };
  for (const r of m.needs) if (!g.research[r]) why.push('Onderzoek nodig: ' + r);
  for (const t of m.needsTests || []) if (!(g.tests[t]?.ok > 0)) why.push('Eerst geslaagd: ' + (MISSION_BY_ID[t]?.title || t));
  if (m.crew && g.team.pilots < 4) why.push('Minimaal 4 astronauten in dienst');
  if (m.id === 'crewlunar' && !certified(g)) why.push('Certificering voor bemande maanvluchten vereist');
  return { ok: why.length === 0, why };
}
export function designAllowed(m: MissionDef, d: Design) {
  if (m.designs.includes(d.id)) return true;
  if (!m.designs.includes('*')) {
    // eigen ontwerpen: toegestaan als ze lijken op het type van de eerste standaard
    const base = findDesign(null, m.designs[0]);
    return !d.builtin && d.booster.enabled === base.booster.enabled && (d.ship.variant === base.ship.variant || (base.ship.variant === 'cargo' && d.ship.variant === 'tanker'));
  }
  return true;
}
export function buildsFor(g: GameState, m: MissionDef) {
  return g.builds.filter((b) => { const d = findDesign(g, b.designId); return designAllowed(m, d); });
}
export function prepDays(m: MissionDef, prep: Prep, g: GameState | null) {
  let d = m.days * (prep === 'rush' ? 0.45 : prep === 'thorough' ? 1.8 : 1);
  if (g && m.noFlight && (g.facilities.stand || 0) >= 2) d = Math.min(d, 1);
  return Math.max(0.5, Math.round(d * 2) / 2);
}
export function prepCost(g: GameState, m: MissionDef, prep: Prep) {
  return missionCost(g, m) * (prep === 'thorough' ? 1.35 : prep === 'rush' ? 0.9 : 1);
}
export function padWait(g: GameState, m: MissionDef) {
  if (m.noFlight || ['shipcatch', 'proptransfer', 'lunar', 'crewlunar', 'hop150', 'hop10k'].includes(m.id)) return 0;
  return Math.max(0, Math.ceil(g.padBusyUntil - g.day));
}

export interface FlightCtx { mission: MissionDef; design: Design; build: Build | null; prep: Prep; contractId?: string; relScore: number; hour: number }
export function launchMission(g: GameState, ctx: FlightCtx) {
  const m = ctx.mission;
  const wait = padWait(g, m);
  const days = prepDays(m, ctx.prep, g) + wait;
  addMoney(g, -prepCost(g, m, ctx.prep), `Missiekosten: ${m.title}`);
  advanceDays(g, days);
  if (ctx.prep === 'rush') { g.morale = clamp(g.morale - 3, 0, 100); }
  saveGame(g);
}

export interface Reward {
  money: number; rep: number; hype: number; stockPct: number;
  milestones: string[]; achievements: string[]; unlocks: string[]; records: string[];
  lines: { label: string; value: string; kind: string }[];
  vehicleLost: boolean; contractPaid?: number; heritage: string[];
}

// verwerk resultaat (carrière of losse vlucht)
export function applyResult(g: GameState | null, ctx: FlightCtx, r: FlightResult): Reward {
  const m = ctx.mission;
  const rw: Reward = { money: 0, rep: 0, hype: 0, stockPct: 0, milestones: [], achievements: [], unlocks: [], records: [], lines: [], vehicleLost: false, heritage: [] };
  const q = r.success ? 0.6 + 0.4 * r.score / 100 : r.partial ? 0.25 * r.score / 100 : 0;
  const did = (id: string) => r.objectives.some((o) => o.id === id && o.state === 'done');
  const ach = (id: string) => grantAchievement(g, id, rw.achievements);
  // ---------- records (globaal) ----------
  const rec = (key: string, val: number, label: string, lowerBetter = false) => {
    const cur = globalRecords[key];
    if (cur === undefined || (lowerBetter ? val < cur : val > cur)) { globalRecords[key] = val; rw.records.push(label); }
  };
  if (r.metrics.maxAlt) rec('maxAlt', r.metrics.maxAlt, 'Hoogste vlucht');
  if (r.metrics.maxSpeed) rec('maxSpeed', r.metrics.maxSpeed, 'Hoogste snelheid');
  if (r.success) rec('score_' + m.id, r.score, 'Beste score: ' + m.title);
  if (r.metrics.accuracy !== undefined && (did('land') || did('bcatch') || did('sland'))) rec('acc_' + m.id, r.metrics.accuracy, 'Nauwkeurigste landing: ' + m.title, true);
  if (r.metrics.pressure) rec('pressure', r.metrics.pressure, 'Hoogste tankdruk');
  saveRecords();
  // ---------- prestaties (ook buiten carrière) ----------
  if (!r.aborted) ach('first_flight');
  if (r.anyRud) ach('rud');
  if ((r.metrics.maxSpeed || 0) > 343) ach('mach1');
  if (did('maxq')) ach('maxq');
  if ((r.metrics.maxAlt || 0) > 100000) ach('space');
  if (did('seco') && m.id !== 'suborbital' && !m.id.includes('catch')) ach('orbit');
  if ((r.metrics.maxHeat || 0) > 4e5) ach('plasma');
  if (did('land') && m.id.includes('lunar') || m.id === 'sc_artemis' && did('land')) ach('moon');
  if (did('bcatch') || did('sland') && r.metrics.shipCatch) ach('catch_first');
  if ((did('bcatch') || r.metrics.shipCatch) && r.metrics.accuracy !== undefined && r.metrics.accuracy < 0.5) ach('catch_perfect');
  if (r.metrics.accuracy !== undefined && r.metrics.accuracy < 1 && did('land')) ach('bullseye');
  if (r.success && r.enginesFailed > 0) ach('engineout');
  if (r.success && ctx.hour !== undefined && (ctx.hour < 6 || ctx.hour > 20)) ach('night');
  if (r.success && m.crew) ach('crew');
  if (!g) return rw;

  // ---------- carrière ----------
  const t = (g.tests[m.id] ||= { count: 0, ok: 0 });
  t.count++; if (r.success) t.ok++;
  t.best = Math.max(t.best || 0, r.score);
  const flight = !m.noFlight;
  if (flight) { g.stats.flights++; g.lastFlightDay = g.day; }
  if (r.success) { g.stats.successes++; g.stats.streak++; g.stats.bestStreak = Math.max(g.stats.bestStreak, g.stats.streak); }
  else if (!r.partial || r.anyRud) { g.stats.failures++; g.stats.streak = 0; }
  if (r.anyRud) { g.stats.rud++; if (g.stats.rud >= 5) ach('rud5'); }
  if (r.metrics.boosterCatch || r.metrics.shipCatch) g.stats.catches += (r.metrics.boosterCatch ? 1 : 0) + (r.metrics.shipCatch ? 1 : 0);
  if (did('land')) g.stats.landings++;
  if (m.crew && r.success) g.stats.crewFlown += 4;
  if (g.stats.streak >= 3) ach('streak3');
  if (g.stats.streak >= 10) ach('streak10');
  if (r.success && ctx.prep === 'rush') ach('rush_win');
  if (ctx.prep === 'thorough') { (g as any).thoroughN = ((g as any).thoroughN || 0) + 1; if ((g as any).thoroughN >= 5) ach('thorough'); }
  // heritage
  for (const s of m.heritage) { const h = (g.heritage[s] ||= { flights: 0, ok: 0, fail: 0 }); h.flights++; if (r.success || (r.partial && r.score > 50)) h.ok++; else h.fail++; rw.heritage.push(s); }
  // geld & reputatie
  const base = m.reward;
  rw.money = base.money * q;
  rw.rep = r.success ? base.rep * (0.7 + 0.3 * r.score / 100) : r.partial ? base.rep * 0.2 : -Math.max(1, base.rep * 0.4);
  rw.hype = r.success ? base.hype * (0.6 + 0.4 * r.score / 100) : r.anyRud ? base.hype * 0.25 : -2; // een spectaculaire knal levert ook kijkers op
  if (r.metrics.boosterCatch) { rw.hype += 8; rw.rep += 2; }
  if (r.metrics.shipCatch) { rw.hype += 12; rw.rep += 3; }
  // contract
  if (ctx.contractId) {
    const c = g.contracts.find((x) => x.id === ctx.contractId);
    if (c) {
      if (r.success) {
        const pay = c.pay - (c.advance || 0);
        rw.money += pay; rw.contractPaid = c.pay; rw.rep += c.rep;
        rw.lines.push({ label: `Contract: ${c.client}`, value: '+' + money(pay), kind: 'good' });
        if (c.daily) { g.dailyDone[Math.floor(g.day)] = true; ach('daily'); }
        g.contracts.splice(g.contracts.indexOf(c), 1);
        news(g, `✅ Contract voltooid: ${c.title}`, 'good');
      } else {
        rw.lines.push({ label: `Contract ${c.client}`, value: 'niet voltooid — nog open tot deadline', kind: 'warn' });
      }
    }
  }
  if (rw.money) addMoney(g, rw.money, `Opbrengst: ${m.title}`);
  g.rep = clamp(g.rep + rw.rep, 0, 100);
  g.hype = clamp(g.hype + rw.hype, 0, 100);
  // aandeel reageert
  if (g.isPublic && flight) {
    const before = g.sharePrice;
    let pct = r.success ? 0.015 + m.hard * 0.012 * (0.5 + r.score / 200) : r.partial ? -0.01 : -(0.03 + m.hard * 0.012);
    if (r.metrics.boosterCatch) pct += 0.025; if (r.metrics.shipCatch) pct += 0.04;
    if (m.crew && !r.success) pct -= 0.12;
    pct *= 0.7 + g.hype / 120;
    stockShock(g, pct, (r.success ? 'geslaagde ' : 'mislukte ') + m.title.toLowerCase());
    rw.stockPct = g.sharePrice / before - 1;
    if (g.ipoDay >= 0 && g.stock.length) { const ipoP = g.stock.find((p) => p.d >= g.ipoDay)?.p || before; if (g.sharePrice > ipoP * 2) ach('stock2x'); }
  }
  // voertuig
  if (ctx.build) {
    const b = ctx.build;
    const lostAll = r.anyRud && !r.metrics.boosterCatch && !r.metrics.shipCatch && !did('land') && !did('sland') && !did('bsplash');
    if (m.noFlight) {
      if (m.id === 'tank' || m.id === 'cryo') { if (r.success) b.tested.cryo = true; if (r.anyRud) rw.vehicleLost = true; }
      if (m.id.startsWith('static')) { if (r.success) b.tested.static = true; if (r.anyRud) rw.vehicleLost = true; }
    } else {
      const launched = ['suborbital', 'orbital', 'boostercatch', 'starlink', 'satdeploy', 'crewleo', 'tourism'].includes(m.id);
      const spaceOnly = ['proptransfer', 'lunar', 'crewlunar'].includes(m.id);
      const hasBooster = findDesign(g, b.designId).booster.enabled;
      const boosterOk = !hasBooster || !launched || !!r.metrics.boosterCatch;
      const shipOk = did('land') && !spaceOnly || !!r.metrics.shipCatch;
      if (spaceOnly) { g.builds = g.builds.filter((x) => x !== b); rw.lines.push({ label: 'Voertuig', value: `${b.name} blijft in de ruimte`, kind: '' }); }
      else if (!boosterOk || !shipOk || lostAll) rw.vehicleLost = true;
      else { b.flights++; b.condition = clamp(b.condition - (0.06 + Math.random() * 0.08), 0.3, 1); const rc = refurbCost(g, findDesign(g, b.designId)); addMoney(g, -rc, 'Opknappen: ' + b.name); b.ready = false; b.daysLeft = g.research.rapidreuse ? 2 : 8; b.daysTotal = b.daysLeft; rw.lines.push({ label: 'Voertuig hergebruikt', value: `${b.name} · conditie ${(b.condition * 100).toFixed(0)}%`, kind: 'good' }); }
    }
    if (rw.vehicleLost) { g.builds = g.builds.filter((x) => x !== b); rw.lines.push({ label: 'Voertuig verloren', value: b.name, kind: 'bad' }); }
  }
  // platform-herstel
  if (flight && !['shipcatch', 'proptransfer', 'lunar', 'crewlunar', 'hop150', 'hop10k'].includes(m.id)) {
    g.padBusyUntil = g.day + padRecoveryDays(g) * (r.anyRud && (r.metrics.maxAlt || 0) < 3000 ? 4 : 1);
  }
  // mijlpalen
  const ms = (id: string) => grantMilestone(g, id, rw.milestones);
  if (m.id === 'hop150' && r.success) ms('firsthop');
  if (m.id.startsWith('static') && r.success) ms('firststatic');
  if (m.id === 'hop10k' && r.success) ms('bellyflop');
  if ((r.metrics.maxAlt || 0) > 100000) ms('space');
  if (did('reentry') && (r.metrics.maxSpeed || 0) > 6500) ms('reentry');
  if (did('seco') && ['orbital', 'starlink', 'satdeploy', 'crewleo', 'tourism'].includes(m.id)) ms('orbit');
  if (r.metrics.boosterCatch) ms('catch');
  if (r.metrics.shipCatch) ms('shipcatch');
  if ((g.tests.starlink?.ok || 0) >= 5) ms('starlink5');
  if (m.id === 'proptransfer' && r.success) ms('transfer');
  if (m.id === 'lunar' && r.success) ms('moon');
  if ((m.id === 'crewleo' || m.id === 'tourism') && r.success) ms('crewleo');
  if (certified(g)) ms('certified');
  if (m.id === 'crewlunar' && r.success) ms('crewmoon');
  if (g.money >= 1e9) ach('billion');
  // log
  g.log.unshift({ day: g.day, mission: m.id, title: m.title, result: r.success ? 'succes' : r.partial ? 'gedeeltelijk' : 'mislukt', notes: r.endReason, score: r.score, vehicle: ctx.build?.name || ctx.design.name });
  if (g.log.length > 100) g.log.length = 100;
  news(g, `${r.success ? '🚀' : r.partial ? '⚠️' : '💥'} ${m.title}: ${r.success ? 'geslaagd' : r.partial ? 'gedeeltelijk geslaagd' : 'mislukt'} (score ${r.score})`, r.success ? 'good' : 'bad');
  saveGame(g);
  return rw;
}

// beste ontwerp voor een missie (bij sandbox/scenario)
export function defaultDesignFor(g: GameState | null, m: MissionDef) { return allDesigns(g).find((d) => d.id === m.designs[0]) || allDesigns(g)[0]; }
export function nextMissionSuggestion(g: GameState) {
  const order = ['hop150', 'static_ship', 'hop10k', 'suborbital', 'orbital', 'boostercatch', 'starlink', 'shipcatch', 'proptransfer', 'lunar', 'crewleo', 'crewlunar'];
  for (const id of order) { const m = MISSION_BY_ID[id]; if (!(g.tests[id]?.ok > 0)) return { m, lock: missionLock(g, m) }; }
  return { m: MISSION_BY_ID.starlink, lock: missionLock(g, MISSION_BY_ID.starlink) };
}
export { MISSIONS, heritageOf, buildDays, reliabilityFor };
