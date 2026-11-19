import { GameState, Contract, Loan, Build, findDesign } from './state';
import { MISSION_BY_ID, MissionDef } from './missions';
import { RESEARCH_BY_ID, FACILITIES } from './research';
import { designStats, designToSpec, ENGINES, Design } from './parts';
import { Reliability } from '../sim/vehicle';
import { rng, hashStr, pick, clamp, money, gameDate, bus } from '../core/util';

// ===================== Team =====================
export const ROLES: Record<keyof GameState['team'], { name: string; salary: number; desc: string }> = {
  eng: { name: 'Ingenieurs', salary: 160000, desc: 'Ontwerp en onderzoek. Sneller R&D, minder ontwerpfouten.' },
  tech: { name: 'Technici & lassers', salary: 85000, desc: 'Bouwen in de High Bay. Snellere productie.' },
  ops: { name: 'Lanceerteam', salary: 120000, desc: 'Tanken, aftellen, pad-herstel. Minder vertraging.' },
  safety: { name: 'Veiligheid & QA', salary: 130000, desc: 'Inspecties. Minder storingen, nodig voor certificering.' },
  pilots: { name: 'Astronauten', salary: 200000, desc: 'Nodig voor bemande vluchten (minimaal 4).' },
};
export function payrollPerDay(g: GameState) {
  let s = 0;
  for (const k of Object.keys(ROLES) as (keyof GameState['team'])[]) s += g.team[k] * ROLES[k].salary;
  return (s / 365) * (g.crunch ? 1.35 : 1);
}
export function teamQuality(g: GameState) {
  const t = g.team;
  const eng = clamp(t.eng / 400, 0.2, 1.4), tech = clamp(t.tech / 900, 0.2, 1.4), safety = clamp(t.safety / 80, 0.1, 1.5);
  const morale = g.morale / 100;
  return { eng, tech, safety, morale, overall: (eng + tech + safety) / 3 * (0.6 + 0.6 * morale) };
}

// ===================== Betrouwbaarheid =====================
// Ervaring (heritage) per systeem verlaagt storingskans. Haasten verhoogt die fors.
export type Prep = 'rush' | 'normal' | 'thorough';
export const PREP_LABEL: Record<Prep, string> = { rush: 'Haasten', normal: 'Standaard', thorough: 'Extra testen' };
export function heritageOf(g: GameState | null, sys: string) { const h = g?.heritage[sys]; return h ? h.ok + h.fail * 0.4 : 0; }
export function reliabilityFor(g: GameState | null, design: Design, prep: Prep, build?: Build | null, extra = 1): { rel: Reliability; score: number; breakdown: { label: string; val: number }[] } {
  const spec = designToSpec(design);
  const engType = ENGINES[design.ship.engineType];
  const bEng = design.booster.enabled ? ENGINES[design.booster.engineType] : null;
  const engBase = 1 - Math.min(engType.baseRel, bEng ? bEng.baseRel : 1);
  const h = (s: string) => Math.exp(-heritageOf(g, s) / 5);
  const tq = g ? teamQuality(g) : { safety: 1.2, morale: 1, overall: 1.2, eng: 1.2, tech: 1.2 };
  let k = prep === 'rush' ? 2.6 : prep === 'thorough' ? 0.6 : 1;
  k *= 1.25 - 0.35 * Math.min(1.4, tq.safety) * (0.7 + 0.3 * tq.morale);
  if (g?.research.qa) k *= 0.8;
  if (g?.crunch) k *= 1.3;
  if (build && build.flights > 0) k *= 1 + (1 - build.condition) * 2.5;
  k *= extra;
  const engTested = build?.tested.static ? 0.5 : 1;
  const strTested = build?.tested.cryo ? 0.5 : 1;
  const mc = g ? [1, 0.7, 0.5][g.facilities.mission || 0] : 0.6;
  const av = g?.research.avionics2 ? 0.5 : 1;
  const rel: Reliability = {
    engineIgnition: clamp(engBase * 0.9 * h('engine') * k * engTested, 0, 0.3),
    engineRun: clamp(engBase * 0.00012 * h('engine') * k * engTested, 0, 0.01),
    engineRud: clamp(0.25 * h('engine') * k, 0.02, 0.8),
    structure: clamp(1.05 - 0.25 * h('structure') * k * strTested, 0.6, 1.2),
    tiles: clamp(0.25 * h('tiles') * k * (design.ship.heatShield >= 3 ? 0.4 : 1), 0, 1),
    flaps: clamp(0.0015 * h('flaps') * k * (design.ship.flaps >= 2 ? 0.5 : 1), 0, 0.02),
    avionics: clamp(0.0012 * h('avionics') * k * mc * av, 0, 0.02),
    legs: clamp(0.06 * h('landing') * k, 0, 0.5),
    catchSys: clamp(0.08 * h('catch') * k, 0, 0.5),
    sep: clamp(0.04 * h('sep') * k, 0, 0.4),
    rcs: clamp(0.02 * h('rcs') * k, 0, 0.3),
  };
  void spec;
  // samenvattende succeskans (schatting voor UI)
  const nEng = design.ship.sl + design.ship.vac + (design.booster.enabled ? design.booster.engines : 0);
  const pEng = 1 - Math.pow(1 - rel.engineIgnition * 0.3 - rel.engineRun * 60 * 0.3, nEng);
  const pStruct = (1 - rel.structure) * 0.6 + 0.02;
  const pOther = rel.avionics * 60 + rel.sep * (design.booster.enabled ? 1 : 0) + rel.legs * 0.5 + rel.tiles * 0.15;
  const score = clamp(1 - pEng * 0.6 - pStruct - pOther, 0.05, 0.995);
  const breakdown = [
    { label: 'Motoren', val: 1 - pEng * 0.6 },
    { label: 'Structuur', val: 1 - pStruct },
    { label: 'Avionica', val: 1 - rel.avionics * 60 },
    { label: 'Scheiding', val: 1 - rel.sep },
    { label: 'Landing/vangst', val: 1 - Math.max(rel.legs, rel.catchSys) * 0.6 },
    { label: 'Hitteschild', val: 1 - rel.tiles * 0.3 },
  ];
  return { rel, score, breakdown };
}

// ===================== Kosten =====================
export function buildCost(g: GameState | null, d: Design) {
  const st = designStats(d);
  let c = st.cost;
  if (g?.research.mfgscale) c *= 0.8;
  return c;
}
export function buildDays(g: GameState | null, d: Design) {
  const st = designStats(d);
  let days = 18 + st.height * 0.45 + (d.booster.enabled ? 25 : 0);
  if (g) {
    days *= [1, 0.85, 0.7][g.facilities.highbay || 0];
    if (g.research.mfgscale) days *= 0.6;
    days /= clamp(teamQuality(g).tech, 0.4, 1.3) * (0.7 + g.morale / 330) * (g.crunch ? 1.25 : 1);
  }
  return Math.max(4, Math.round(days));
}
export function maxParallelBuilds(g: GameState) { return 1 + (g.facilities.highbay || 0); }
export function padRecoveryDays(g: GameState) { return [14, 7, 3][g.facilities.olm || 0]; }
export function missionCost(g: GameState, m: MissionDef) {
  let c = m.cost;
  if (m.noFlight) c *= [1, 0.7, 0.5][g.facilities.stand || 0];
  c *= [1, 0.8, 0.65][g.facilities.tankfarm || 0];
  return c;
}
export function refurbCost(g: GameState, d: Design) { return buildCost(g, d) * (g.research.rapidreuse ? 0.04 : 0.12); }

// ===================== Geld & boekhouding =====================
export function addMoney(g: GameState, amount: number, why: string) {
  g.money += amount;
  if (amount > 0) g.stats.revenue += amount; else g.stats.spent -= amount;
  if (Math.abs(amount) >= 1e6) news(g, `${amount > 0 ? '+' : ''}${money(amount)} — ${why}`, amount > 0 ? 'good' : 'cost');
}
export function news(g: GameState, text: string, kind = 'info') {
  g.news.unshift({ day: Math.floor(g.day), text, kind });
  if (g.news.length > 60) g.news.length = 60;
}

// ===================== Kredietwaardigheid & leningen =====================
export function valuation(g: GameState) {
  if (g.isPublic) return g.sharePrice * g.sharesOut;
  // privé: op basis van reputatie, hype en prestaties
  return 1.5e9 + g.rep * 120e6 + g.hype * 40e6 + g.stats.successes * 150e6 + Object.keys(g.milestones).length * 250e6;
}
export function debt(g: GameState) { return g.loans.reduce((s, l) => s + l.balance, 0); }
export function creditRating(g: GameState) {
  const ratio = debt(g) / Math.max(1, valuation(g));
  let score = 100 - ratio * 180 - g.missedPayments * 18 + g.rep * 0.3 + (g.money > 0 ? 5 : -25);
  score = clamp(score, 0, 120);
  const r = score > 105 ? 'AAA' : score > 95 ? 'AA' : score > 85 ? 'A' : score > 72 ? 'BBB' : score > 60 ? 'BB' : score > 45 ? 'B' : score > 30 ? 'CCC' : 'D';
  return { rating: r, score };
}
export function loanOffers(g: GameState) {
  const { rating } = creditRating(g);
  const base: Record<string, number> = { AAA: 0.045, AA: 0.052, A: 0.06, BBB: 0.072, BB: 0.09, B: 0.12, CCC: 0.17, D: 0.3 };
  const r = base[rating];
  const cap = Math.max(0, valuation(g) * 0.35 - debt(g));
  const offers = [
    { name: 'Bankkrediet (2 jaar)', principal: Math.min(cap, 150e6), rate: r, termDays: 730 },
    { name: 'Obligatielening (5 jaar)', principal: Math.min(cap, 600e6), rate: r + 0.01, termDays: 1825 },
    { name: 'Durfkapitaal-converteerbaar (3 jaar)', principal: Math.min(cap, 1.2e9), rate: r + 0.035, termDays: 1095 },
  ].filter((o) => o.principal > 10e6 && rating !== 'D');
  return { rating, offers };
}
export function takeLoan(g: GameState, o: { name: string; principal: number; rate: number; termDays: number }) {
  const l: Loan = { id: 'L' + Date.now(), name: o.name, principal: o.principal, balance: o.principal, rate: o.rate, termDays: o.termDays, startDay: g.day };
  g.loans.push(l);
  addMoney(g, o.principal, 'Lening: ' + o.name);
  g.hype = clamp(g.hype - 1, 0, 100);
}
export function repayLoan(g: GameState, id: string, amount: number) {
  const l = g.loans.find((x) => x.id === id); if (!l) return;
  const a = Math.min(amount, l.balance, g.money);
  if (a <= 0) return;
  l.balance -= a; g.money -= a;
  if (l.balance < 1) g.loans = g.loans.filter((x) => x !== l);
  news(g, `Aflossing ${money(a)} op ${l.name}`, 'info');
}

// ===================== Beurs =====================
export function canIPO(g: GameState) {
  const why: string[] = [];
  if (g.isPublic) why.push('Al beursgenoteerd');
  if (g.rep < 35) why.push('Reputatie minimaal 35');
  if (!g.milestones.orbit) why.push('Eerst een orbitale vlucht');
  return { ok: why.length === 0, why };
}
export function doIPO(g: GameState, pct: number) {
  const val = valuation(g) * (0.9 + g.hype / 250);
  const price = Math.max(5, val / g.sharesOut);
  g.isPublic = true; g.ipoDay = g.day;
  g.sharePrice = price;
  const sold = g.sharesOut * pct;
  const newShares = sold;
  g.sharesOut += newShares;
  addMoney(g, newShares * price * 0.94, `Beursgang (IPO) — ${(pct * 100).toFixed(0)}% nieuwe aandelen`);
  g.stock.push({ d: g.day, p: price });
  g.hype = clamp(g.hype + 15, 0, 100);
  news(g, `🔔 Beursgang! Eerste koers € ${price.toFixed(2)}`, 'good');
  bus.emit('reward', { kind: 'ipo', text: 'Beursgang geslaagd!' });
}
export function issueShares(g: GameState, pct: number) {
  if (!g.isPublic) return;
  const n = g.sharesOut * pct;
  const price = g.sharePrice * 0.92;
  g.sharesOut += n;
  addMoney(g, n * price * 0.97, `Aandelenemissie ${(pct * 100).toFixed(0)}%`);
  g.sharePrice *= 1 - pct * 0.6; // verwatering
  stockPoint(g);
}
export function stockPoint(g: GameState) { g.stock.push({ d: g.day, p: g.sharePrice }); if (g.stock.length > 800) g.stock.splice(0, g.stock.length - 800); }
export function stockShock(g: GameState, pct: number, why: string) {
  if (!g.isPublic) return;
  const before = g.sharePrice;
  g.sharePrice = Math.max(0.5, g.sharePrice * (1 + pct));
  stockPoint(g);
  news(g, `📈 Aandeel ${pct >= 0 ? '+' : ''}${(pct * 100).toFixed(1)}% (€ ${before.toFixed(2)} → € ${g.sharePrice.toFixed(2)}) — ${why}`, pct >= 0 ? 'good' : 'bad');
}

// ===================== Contracten =====================
const CLIENTS = {
  satellite: ['Intelsat', 'SES', 'Viasat', 'Eutelsat', 'OneWeb', 'Telesat', 'Planet', 'Maxar', 'Sirius XM', 'Amazon Kuiper'],
  government: ['NASA', 'ESA', 'US Space Force', 'NRO', 'JAXA', 'NOAA'],
  tourism: ['dearMoon', 'Polaris-programma', 'Axiom Space', 'Inspiration4-team', 'Vast'],
  partnership: ['T-Mobile', 'Google', 'Microsoft Azure Space', 'Toyota', 'Nokia (Maan-4G)'],
};
export function genContracts(g: GameState) {
  const day = Math.floor(g.day);
  if (g.contractSeedDay === day) return;
  // dagelijkse rotatie: oude niet-geaccepteerde contracten verlopen
  g.contracts = g.contracts.filter((c) => c.accepted || (c.deadlineDay > day && !c.daily && Math.random() < 0.85));
  g.contractSeedDay = day;
  const r = rng(hashStr(g.company + day));
  const has = (id: string) => !!g.research[id];
  const tested = (id: string) => (g.tests[id]?.ok || 0) > 0;
  const add = (c: Omit<Contract, 'id'>) => { if (g.contracts.filter((x) => !x.accepted).length < 9) g.contracts.push({ ...c, id: 'C' + day + '_' + Math.floor(r() * 1e6) }); };
  // dagcontract (altijd 1)
  const dailyPool: Omit<Contract, 'id'>[] = [];
  dailyPool.push({ title: 'Dagopdracht: precisiehop', client: 'Starbase', desc: 'Land binnen 2 m van het midden van Pad C. Vandaag alleen!', kind: 'daily', mission: 'hop150', pay: 8e6, advance: 0, deadlineDay: day + 1, rep: 2, req: [], daily: true });
  if (tested('hop150')) dailyPool.push({ title: 'Dagopdracht: hoge sprong', client: 'Starbase', desc: 'Voer vandaag een 10 km-hop met buiklanding uit.', kind: 'daily', mission: 'hop10k', pay: 20e6, advance: 0, deadlineDay: day + 1, rep: 3, req: [], daily: true });
  if (has('catch') && tested('suborbital')) dailyPool.push({ title: 'Dagopdracht: vangst!', client: 'Investeerdersdag', desc: 'Investeerders kijken mee: vang de booster vandaag.', kind: 'daily', mission: 'boostercatch', pay: 70e6, advance: 0, deadlineDay: day + 1, rep: 6, req: ['catch'], daily: true });
  if (tested('orbital')) dailyPool.push({ title: 'Dagopdracht: snelle Starlink', client: 'Starlink', desc: 'Extra satellieten nodig — lanceer vandaag.', kind: 'daily', mission: 'starlink', pay: 90e6, advance: 0, deadlineDay: day + 1, rep: 3, req: ['orbital'], daily: true, payload: 60000 });
  if (!g.dailyDone[day] && !g.contracts.some((c) => c.daily && c.deadlineDay > day)) add(pick(dailyPool, r));
  // gewone contracten
  const n = 1 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const roll = r();
    if (roll < 0.25 && !tested('orbital')) {
      add({ title: 'Subsidie: ' + pick(['herbruikbaarheid', 'methalox-motoren', 'zware lift', 'Mars-architectuur'], r), client: pick(CLIENTS.government, r), desc: 'Overheidsgeld voor een geslaagde suborbitale demonstratie.', kind: 'grant', mission: tested('hop10k') ? 'suborbital' : tested('hop150') ? 'hop10k' : 'hop150', pay: (25 + r() * 40) * 1e6, advance: 10e6, deadlineDay: day + 60 + Math.floor(r() * 60), rep: 4, req: [] });
    } else if (roll < 0.55 && tested('orbital')) {
      add({ title: 'Starlink-batch ' + (10 + Math.floor(r() * 90)), client: 'Starlink', desc: 'Interne lancering: 60 ton satellieten naar LEO.', kind: 'starlink', mission: 'starlink', pay: (60 + r() * 40) * 1e6, advance: 0, deadlineDay: day + 30 + Math.floor(r() * 40), rep: 2, req: ['orbital'], payload: 60000 });
    } else if (roll < 0.7 && tested('orbital')) {
      add({ title: 'Satelliet voor ' + pick(CLIENTS.satellite, r), client: pick(CLIENTS.satellite, r), desc: 'Commerciële lading naar een baan.', kind: 'satellite', mission: 'satdeploy', pay: (90 + r() * 120) * 1e6, advance: 20e6, deadlineDay: day + 45 + Math.floor(r() * 60), rep: 4, req: ['orbital'], payload: 20000, penalty: 30e6 });
    } else if (roll < 0.8 && has('catch')) {
      add({ title: 'Hergebruikdemonstratie', client: pick(CLIENTS.government, r), desc: 'Bewijs snelle herbruikbaarheid met een boostervangst.', kind: 'government', mission: 'boostercatch', pay: (120 + r() * 80) * 1e6, advance: 30e6, deadlineDay: day + 50 + Math.floor(r() * 50), rep: 6, req: ['catch'] });
    } else if (roll < 0.87 && has('proptransfer')) {
      add({ title: 'Tankdemonstratie HLS', client: 'NASA', desc: 'Mijlpaalbetaling: brandstofoverdracht in een baan.', kind: 'government', mission: 'proptransfer', pay: (300 + r() * 200) * 1e6, advance: 80e6, deadlineDay: day + 90 + Math.floor(r() * 60), rep: 10, req: ['proptransfer'] });
    } else if (roll < 0.92 && has('hls')) {
      add({ title: 'Artemis-maanlanding', client: 'NASA', desc: 'Onbemande HLS-demonstratielanding.', kind: 'lunar', mission: 'lunar', pay: (900 + r() * 500) * 1e6, advance: 200e6, deadlineDay: day + 150 + Math.floor(r() * 100), rep: 15, req: ['hls'] });
    } else if (roll < 0.96 && has('crew') && tested('crewleo')) {
      add({ title: 'Toerismevlucht: ' + pick(CLIENTS.tourism, r), client: pick(CLIENTS.tourism, r), desc: 'Betalende passagiers naar een baan.', kind: 'tourism', mission: 'tourism', pay: (200 + r() * 250) * 1e6, advance: 50e6, deadlineDay: day + 60 + Math.floor(r() * 60), rep: 8, req: ['crew'], crew: 4 });
    } else if (g.rep > 30) {
      add({ title: 'Partnerschap met ' + pick(CLIENTS.partnership, r), client: pick(CLIENTS.partnership, r), desc: 'Marketingdeal: vlieg hun logo mee op je volgende geslaagde vlucht.', kind: 'partnership', mission: pick(['hop10k', 'suborbital', 'orbital', 'boostercatch'].filter((m) => !MISSION_BY_ID[m].needs.some((n) => !has(n))), r) || 'hop150', pay: (30 + r() * 80) * 1e6, advance: 10e6, deadlineDay: day + 40 + Math.floor(r() * 40), rep: 5, req: [] });
    }
  }
}
export function acceptContract(g: GameState, id: string) {
  const c = g.contracts.find((x) => x.id === id); if (!c || c.accepted) return;
  c.accepted = true;
  if (c.advance > 0) addMoney(g, c.advance, `Voorschot: ${c.title}`);
}

// ===================== Tijd =====================
export function advanceDays(g: GameState, days: number) {
  const steps = Math.ceil(days);
  for (let i = 0; i < steps; i++) {
    const d = Math.min(1, days - i);
    if (d <= 0) break;
    dayTick(g, d);
  }
  genContracts(g);
}
function dayTick(g: GameState, d: number) {
  g.day += d;
  // salarissen
  g.money -= payrollPerDay(g) * d;
  g.stats.spent += payrollPerDay(g) * d;
  // rente & aflossing (maandelijks verrekend per dag)
  for (const l of g.loans) {
    const interest = l.balance * l.rate / 365 * d;
    const principalPart = l.principal / l.termDays * d;
    const pay = interest + principalPart;
    if (g.money >= pay) { g.money -= pay; l.balance = Math.max(0, l.balance - principalPart); }
    else { g.missedPayments += d / 30; l.balance += interest; g.rep = Math.max(0, g.rep - 0.05 * d); }
  }
  g.loans = g.loans.filter((l) => l.balance > 1);
  // moraal
  const target = 70 + (g.crunch ? -25 : 0) + clamp(g.stats.streak * 2, 0, 15) - clamp(g.money < 0 ? 20 : 0, 0, 20);
  g.morale += (target - g.morale) * 0.03 * d;
  // hype zakt langzaam, sneller als je lang niet vliegt
  const gap = g.day - g.lastFlightDay;
  g.hype = clamp(g.hype - d * (0.12 + (gap > 45 ? 0.25 : 0)), 0, 100);
  // onderzoek
  if (g.researching) {
    const tq = teamQuality(g);
    g.researching.left -= d * clamp(tq.eng, 0.3, 1.4) * (0.7 + g.morale / 330) * (g.crunch ? 1.25 : 1);
    if (g.researching.left <= 0) {
      const r = RESEARCH_BY_ID[g.researching.id];
      g.research[r.id] = true; g.researching = null;
      news(g, `🔬 Onderzoek voltooid: ${r.name}`, 'good');
      bus.emit('reward', { kind: 'research', text: `Onderzoek voltooid: ${r.name}` });
    }
  }
  // faciliteiten in aanbouw
  const up = (g as any).upgrading as { id: string; left: number }[] | undefined;
  if (up) for (const u of up.slice()) {
    u.left -= d;
    if (u.left <= 0) {
      g.facilities[u.id] = (g.facilities[u.id] || 0) + 1;
      up.splice(up.indexOf(u), 1);
      const f = FACILITIES.find((x) => x.id === u.id)!;
      news(g, `🏗️ ${f.name} opgewaardeerd naar niveau ${g.facilities[u.id] + 1}`, 'good');
    }
  }
  // productie
  let active = 0;
  for (const b of g.builds) {
    if (b.ready) continue;
    if (active >= maxParallelBuilds(g)) break;
    active++;
    b.daysLeft -= d;
    if (b.daysLeft <= 0) { b.daysLeft = 0; b.ready = true; news(g, `🏭 ${b.name} is klaar en staat in de raketgaard`, 'good'); }
  }
  // beurskoers (dagelijkse random walk met drift)
  if (g.isPublic) {
    const drift = (g.hype - 40) / 100 * 0.004 + (g.rep - 40) / 100 * 0.002 - (gap > 60 ? 0.003 : 0) - (g.money < 0 ? 0.006 : 0);
    const vol = 0.022;
    const z = (Math.random() + Math.random() + Math.random() - 1.5) * 1.4;
    g.sharePrice = Math.max(0.5, g.sharePrice * Math.exp(drift * d + vol * Math.sqrt(d) * z));
    stockPoint(g);
  }
  // contractdeadlines
  for (const c of g.contracts.slice()) {
    if (c.accepted && c.deadlineDay < g.day) {
      g.contracts.splice(g.contracts.indexOf(c), 1);
      g.rep = clamp(g.rep - c.rep, 0, 100);
      if (c.penalty) addMoney(g, -c.penalty, `Boete: deadline gemist (${c.title})`);
      news(g, `⏰ Deadline gemist: ${c.title}`, 'bad');
      stockShock(g, -0.03, 'contract gemist');
    }
  }
  if (g.money < -200e6) g.morale -= 0.5 * d;
}

export function startResearch(g: GameState, id: string) {
  const r = RESEARCH_BY_ID[id];
  if (!r || g.research[id] || g.researching) return false;
  if (r.req.some((x) => !g.research[x])) return false;
  if (g.money < r.cost && g.mode === 'career') return false;
  addMoney(g, -r.cost, 'Onderzoek: ' + r.name);
  g.researching = { id, left: r.days };
  return true;
}
export function startUpgrade(g: GameState, id: string) {
  const f = FACILITIES.find((x) => x.id === id)!;
  const lvl = g.facilities[id] || 0;
  if (lvl + 1 >= f.levels.length) return false;
  const up = ((g as any).upgrading ||= []) as { id: string; left: number }[];
  if (up.some((u) => u.id === id)) return false;
  const L = f.levels[lvl + 1];
  if (g.money < L.cost && g.mode === 'career') return false;
  addMoney(g, -L.cost, `Bouw: ${f.name} niveau ${lvl + 2}`);
  up.push({ id, left: L.days });
  return true;
}
export function orderBuild(g: GameState, d: Design) {
  const c = buildCost(g, d);
  if (g.money < c && g.mode === 'career') return null;
  addMoney(g, -c, 'Productie: ' + d.name);
  const n = g.builds.length + 1;
  const prefix = d.booster.enabled ? 'B' + (10 + n) + '/S' + (20 + n) : d.ship.variant === 'hopper' ? 'Hopper ' + n : 'SN' + (5 + n);
  const days = buildDays(g, d);
  const b: Build = { id: 'b' + Date.now(), designId: d.id, name: `${prefix} (${d.name})`, kind: d.booster.enabled ? 'stack' : 'ship', daysLeft: days, daysTotal: days, flights: 0, condition: 1, ready: false, tested: {} };
  g.builds.push(b);
  return b;
}
export function hire(g: GameState, role: keyof GameState['team'], n: number) {
  const cost = n > 0 ? n * ROLES[role].salary * 0.15 : 0; // werving
  if (n > 0 && g.money < cost && g.mode === 'career') return false;
  g.team[role] = Math.max(0, g.team[role] + n);
  if (n > 0) addMoney(g, -cost, `Werving: ${n} ${ROLES[role].name.toLowerCase()}`);
  else { g.morale -= Math.min(10, -n * 0.05); news(g, `Ontslag: ${-n} ${ROLES[role].name.toLowerCase()} (moraal daalt)`, 'bad'); }
  return true;
}

// ===================== Mijlpalen & certificering =====================
export interface Milestone { id: string; title: string; desc: string; reward: { money: number; rep: number; hype: number }; tier: number; }
export const MILESTONES: Milestone[] = [
  { id: 'firsthop', title: 'Eerste sprong', desc: 'Voltooi een hop van 150 m.', reward: { money: 20e6, rep: 5, hype: 10 }, tier: 0 },
  { id: 'firststatic', title: 'Vuurdoop', desc: 'Voltooi een statische vuurproef.', reward: { money: 5e6, rep: 2, hype: 4 }, tier: 0 },
  { id: 'bellyflop', title: 'Buiklanding', desc: 'Land na een 10 km-hop met belly flop.', reward: { money: 40e6, rep: 8, hype: 15 }, tier: 1 },
  { id: 'research_orbital', title: 'Naar de baan', desc: 'Onderzoek "Orbitale Starship".', reward: { money: 10e6, rep: 2, hype: 5 }, tier: 1 },
  { id: 'space', title: 'Ruimte bereikt', desc: 'Passeer de Kármánlijn (100 km).', reward: { money: 50e6, rep: 8, hype: 20 }, tier: 2 },
  { id: 'reentry', title: 'Door het vuur', desc: 'Overleef een terugkeer met orbitale snelheid.', reward: { money: 60e6, rep: 10, hype: 20 }, tier: 2 },
  { id: 'orbit', title: 'Stabiele baan', desc: 'Bereik een baan met perigeum boven 150 km.', reward: { money: 100e6, rep: 12, hype: 25 }, tier: 2 },
  { id: 'catch', title: 'Chopsticks!', desc: 'Vang een Super Heavy met de toren.', reward: { money: 150e6, rep: 15, hype: 40 }, tier: 3 },
  { id: 'ipo', title: 'Beursgang', desc: 'Breng het bedrijf naar de beurs.', reward: { money: 0, rep: 5, hype: 15 }, tier: 3 },
  { id: 'shipcatch', title: 'Volledig herbruikbaar', desc: 'Vang ook het schip bij de toren.', reward: { money: 250e6, rep: 20, hype: 50 }, tier: 4 },
  { id: 'starlink5', title: 'Constellatie', desc: 'Voer 5 Starlink-lanceringen uit.', reward: { money: 200e6, rep: 10, hype: 15 }, tier: 4 },
  { id: 'transfer', title: 'Tankstation in de ruimte', desc: 'Voltooi een brandstofoverdracht in een baan.', reward: { money: 300e6, rep: 20, hype: 30 }, tier: 5 },
  { id: 'moon', title: 'Op de Maan', desc: 'Land onbemand op de Maan.', reward: { money: 800e6, rep: 30, hype: 60 }, tier: 6 },
  { id: 'crewleo', title: 'Mensen aan boord', desc: 'Voltooi een bemande baanvlucht.', reward: { money: 400e6, rep: 25, hype: 60 }, tier: 6 },
  { id: 'certified', title: 'Gecertificeerd', desc: 'Behaal certificering voor bemande maanlandingen.', reward: { money: 500e6, rep: 25, hype: 40 }, tier: 7 },
  { id: 'crewmoon', title: 'Een grote sprong', desc: 'Land mensen op de Maan en breng ze terug.', reward: { money: 3e9, rep: 50, hype: 100 }, tier: 8 },
];
export const REGULATOR = 'FAA / NASA Human Spaceflight Office';
export interface CertReq { id: string; label: string; check: (g: GameState) => boolean; progress: (g: GameState) => string; }
export const CERT_REQS: CertReq[] = [
  { id: 'orbits', label: '5 geslaagde orbitale vluchten', check: (g) => orbitalSuccesses(g) >= 5, progress: (g) => `${orbitalSuccesses(g)}/5` },
  { id: 'catches', label: '3 geslaagde vangsten of landingen van het schip', check: (g) => (g.tests.shipcatch?.ok || 0) + (g.tests.crewleo?.ok || 0) >= 3, progress: (g) => `${(g.tests.shipcatch?.ok || 0) + (g.tests.crewleo?.ok || 0)}/3` },
  { id: 'transfer', label: 'Brandstofoverdracht gedemonstreerd', check: (g) => (g.tests.proptransfer?.ok || 0) >= 1, progress: (g) => `${g.tests.proptransfer?.ok || 0}/1` },
  { id: 'lunar', label: 'Onbemande maanlanding', check: (g) => (g.tests.lunar?.ok || 0) >= 1, progress: (g) => `${g.tests.lunar?.ok || 0}/1` },
  { id: 'crewleo', label: 'Bemande baanvlucht veilig voltooid', check: (g) => (g.tests.crewleo?.ok || 0) >= 1, progress: (g) => `${g.tests.crewleo?.ok || 0}/1` },
  { id: 'abort', label: 'Afbreeksysteem ontwikkeld', check: (g) => !!g.research.abort, progress: (g) => (g.research.abort ? 'klaar' : 'nee') },
  { id: 'lifesupport', label: 'Langdurige levensondersteuning', check: (g) => !!g.research.lifesupport, progress: (g) => (g.research.lifesupport ? 'klaar' : 'nee') },
  { id: 'safety', label: 'Veiligheidsteam ≥ 120 mensen', check: (g) => g.team.safety >= 120, progress: (g) => `${g.team.safety}/120` },
  { id: 'pilots', label: '≥ 4 astronauten in dienst', check: (g) => g.team.pilots >= 4, progress: (g) => `${g.team.pilots}/4` },
  { id: 'streak', label: '3 succesvolle vluchten op rij (zonder RUD)', check: (g) => g.stats.bestStreak >= 3, progress: (g) => `${g.stats.bestStreak}/3` },
];
export function orbitalSuccesses(g: GameState) { return ['orbital', 'starlink', 'satdeploy', 'shipcatch', 'proptransfer', 'crewleo', 'tourism', 'boostercatch'].reduce((s, m) => s + (g.tests[m]?.ok || 0), 0); }
export function certified(g: GameState) { return CERT_REQS.every((r) => r.check(g)); }
export function nextGoals(g: GameState, n = 3) {
  return MILESTONES.filter((m) => !g.milestones[m.id]).slice(0, n);
}
export function grantMilestone(g: GameState, id: string, out: string[]) {
  if (g.milestones[id]) return;
  const m = MILESTONES.find((x) => x.id === id); if (!m) return;
  g.milestones[id] = g.day;
  addMoney(g, m.reward.money, 'Mijlpaal: ' + m.title);
  g.rep = clamp(g.rep + m.reward.rep, 0, 100); g.hype = clamp(g.hype + m.reward.hype, 0, 100);
  stockShock(g, 0.04 + m.tier * 0.015, 'mijlpaal: ' + m.title);
  out.push(id);
  news(g, `🏆 Mijlpaal: ${m.title}`, 'good');
}

// ===================== Prestaties (achievements) =====================
export interface Achievement { id: string; title: string; desc: string; icon: string; }
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_flight', title: 'Lift-off!', desc: 'Je eerste vlucht.', icon: '🚀' },
  { id: 'bullseye', title: 'Roos', desc: 'Land binnen 1 m van het padmidden.', icon: '🎯' },
  { id: 'rud', title: 'Snelle ongeplande demontage', desc: 'Je eerste RUD. Het hoort erbij.', icon: '💥' },
  { id: 'rud5', title: 'Iteratief ontwerpen', desc: '5 RUD\'s. Elke knal is data.', icon: '🧨' },
  { id: 'engineout', title: 'Motor-uit-held', desc: 'Missie geslaagd ondanks motoruitval.', icon: '🛠️' },
  { id: 'catch_first', title: 'Mechazilla', desc: 'Eerste vangst met de chopsticks.', icon: '🥢' },
  { id: 'catch_perfect', title: 'Chirurgisch', desc: 'Vangst binnen 0,5 m van het midden.', icon: '🦾' },
  { id: 'streak3', title: 'Op dreef', desc: '3 geslaagde vluchten op rij.', icon: '🔥' },
  { id: 'streak10', title: 'Onstuitbaar', desc: '10 geslaagde vluchten op rij.', icon: '⚡' },
  { id: 'mach1', title: 'Geluidsbarrière', desc: 'Sneller dan geluid.', icon: '💨' },
  { id: 'maxq', title: 'Max-Q overleefd', desc: 'Kom heelhuids door maximale aerodynamische druk.', icon: '🌪️' },
  { id: 'space', title: 'Astronautenvleugels', desc: 'Boven de 100 km.', icon: '🌌' },
  { id: 'orbit', title: 'Rondje aarde', desc: 'Bereik een baan.', icon: '🌍' },
  { id: 'plasma', title: 'Vuurbal', desc: 'Warmteflux boven 1 MW/m².', icon: '☄️' },
  { id: 'moon', title: 'Maanwandelaar', desc: 'Land op de Maan.', icon: '🌕' },
  { id: 'billion', title: 'Miljardair', desc: '€ 1 mld op de bank.', icon: '💰' },
  { id: 'rush_win', title: 'Gokker', desc: 'Missie geslaagd met "Haasten".', icon: '🎲' },
  { id: 'thorough', title: 'Zekerheid voor alles', desc: '5 vluchten met "Extra testen".', icon: '🧯' },
  { id: 'daily', title: 'Dagelijkse kost', desc: 'Voltooi een dagopdracht.', icon: '📅' },
  { id: 'night', title: 'Nachtvlinder', desc: 'Lanceer in het donker.', icon: '🌙' },
  { id: 'stock2x', title: 'Tienbagger in wording', desc: 'Aandeel verdubbeld sinds de IPO.', icon: '📈' },
  { id: 'crew', title: 'Iedereen veilig thuis', desc: 'Bemande vlucht zonder problemen.', icon: '👩‍🚀' },
];
export function grantAchievement(g: GameState | null, id: string, out: string[]) {
  const store = g ? g.achievements : globalAch();
  if (store[id]) return;
  store[id] = Date.now();
  out.push(id);
  if (!g) saveGlobalAch(store);
}
function globalAch(): Record<string, number> { try { return JSON.parse(localStorage.getItem('starship_ach') || '{}'); } catch { return {}; } }
function saveGlobalAch(a: Record<string, number>) { localStorage.setItem('starship_ach', JSON.stringify(a)); }
export function achievementsOf(g: GameState | null) { return g ? g.achievements : globalAch(); }

export function dateStr(g: GameState) { return gameDate(Math.floor(g.day)); }
export { findDesign };
