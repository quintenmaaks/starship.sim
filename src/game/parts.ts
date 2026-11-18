import { EngineSpec, StageSpec, VehicleSpec } from '../sim/spec';
import { G0 } from '../sim/constants';

export interface EngineType { id: string; name: string; kind: 'sl' | 'vac'; thrustSL: number; thrustVac: number; ispSL: number; ispVac: number; mass: number; cost: number; gimbal: number; minThrottle: number; baseRel: number; unlock: string | null; desc: string; }
export const ENGINES: Record<string, EngineType> = {
  r1: { id: 'r1', name: 'Raptor 1', kind: 'sl', thrustSL: 1.85e6, thrustVac: 1.98e6, ispSL: 327, ispVac: 350, mass: 2080, cost: 2.0e6, gimbal: 15, minThrottle: 0.4, baseRel: 0.975, unlock: null, desc: 'Eerste generatie full-flow staged combustion. Complex sanitair, gevoelig.' },
  r1v: { id: 'r1v', name: 'Raptor Vacuum 1', kind: 'vac', thrustSL: 0.9e6, thrustVac: 2.2e6, ispSL: 200, ispVac: 375, mass: 2450, cost: 2.6e6, gimbal: 0, minThrottle: 0.6, baseRel: 0.97, unlock: null, desc: 'Grote vacuümstraalpijp. Niet afvuren op zeeniveau!' },
  r2: { id: 'r2', name: 'Raptor 2', kind: 'sl', thrustSL: 2.30e6, thrustVac: 2.45e6, ispSL: 327, ispVac: 347, mass: 1630, cost: 1.2e6, gimbal: 15, minThrottle: 0.4, baseRel: 0.985, unlock: 'raptor2', desc: 'Vereenvoudigd ontwerp, 230 tf stuwkracht.' },
  r2v: { id: 'r2v', name: 'Raptor Vacuum 2', kind: 'vac', thrustSL: 1.0e6, thrustVac: 2.58e6, ispSL: 200, ispVac: 380, mass: 2000, cost: 1.6e6, gimbal: 0, minThrottle: 0.6, baseRel: 0.982, unlock: 'raptor2', desc: 'RVac met Isp van 380 s.' },
  r3: { id: 'r3', name: 'Raptor 3', kind: 'sl', thrustSL: 2.75e6, thrustVac: 2.94e6, ispSL: 330, ispVac: 350, mass: 1525, cost: 0.9e6, gimbal: 15, minThrottle: 0.4, baseRel: 0.992, unlock: 'raptor3', desc: '280 tf, geïntegreerde leidingen, geen hitteschild-rok nodig.' },
  r3v: { id: 'r3v', name: 'Raptor Vacuum 3', kind: 'vac', thrustSL: 1.2e6, thrustVac: 3.06e6, ispSL: 205, ispVac: 380, mass: 1720, cost: 1.2e6, gimbal: 0, minThrottle: 0.6, baseRel: 0.99, unlock: 'raptor3', desc: 'Lichtste en krachtigste RVac.' },
};

export interface BoosterDesign { enabled: boolean; tankLen: number; engines: number; engineType: string; gridFins: number; catchPins: boolean; hotStage: boolean; legs: boolean; }
export interface ShipDesign {
  variant: 'prototype' | 'cargo' | 'crew' | 'tanker' | 'hls' | 'hopper';
  tankLen: number; sl: number; vac: number; engineType: string; vacType: string;
  flaps: number; heatShield: number; legs: boolean; catchPins: boolean; payload: number; crew: number;
}
export interface Design { id: string; name: string; booster: BoosterDesign; ship: ShipDesign; builtin?: boolean; }

export const SHIP_VARIANTS: Record<ShipDesign['variant'], { name: string; desc: string; unlock: string | null; nose: number; dryAdd: number; cost: number }> = {
  hopper: { name: 'Starhopper', desc: 'Kort testvoertuig met één motor voor lage sprongen.', unlock: null, nose: 6, dryAdd: 0, cost: 8e6 },
  prototype: { name: 'Prototype (SN)', desc: 'Starship zonder laadruimte, voor hops en testvluchten.', unlock: null, nose: 16, dryAdd: 0, cost: 0 },
  cargo: { name: 'Starship Cargo / Starlink', desc: 'Laadruim met "pez"-deur voor satellieten.', unlock: 'orbital', nose: 18, dryAdd: 6000, cost: 8e6 },
  tanker: { name: 'Starship Tanker', desc: 'Extra tankinhoud en koppelpoort voor brandstofoverdracht in de ruimte.', unlock: 'proptransfer', nose: 12, dryAdd: 3000, cost: 10e6 },
  crew: { name: 'Starship Crew', desc: 'Drukcabine voor bemanning, levensondersteuning, ramen.', unlock: 'crew', nose: 20, dryAdd: 18000, cost: 60e6 },
  hls: { name: 'Starship HLS', desc: 'Maanlander: geen hitteschild/flaps, landingspoten en motorpods hoog op de romp.', unlock: 'hls', nose: 20, dryAdd: 12000, cost: 70e6 },
};
export const FLAPS = ['Geen', 'Flaps v1', 'Flaps v2 (lijwaarts)'];
export const HEATSHIELDS = ['Geen', 'Basistegels', 'Volledig hitteschild', 'Hitteschild v3 (ablatieve laag)'];
export const GRIDFINS = ['Geen', '4 roosterroeren (v1)', '3 grote roosterroeren (v2)'];

export const PROP_PER_M_BOOSTER = 55000;
export const PROP_PER_M_SHIP = 44000;

export function buildEngines(n: number, type: string, vacN = 0, vacType = '', ship = false): EngineSpec[] {
  const out: EngineSpec[] = [];
  const et = ENGINES[type];
  const mk = (t: EngineType, x: number, z: number, ring: number, gimbal: boolean): EngineSpec => ({
    id: t.id, kind: t.kind, thrustVac: t.thrustVac, ispVac: t.ispVac, ispSL: t.ispSL, gimbal: gimbal ? t.gimbal * Math.PI / 180 : 0, minThrottle: t.minThrottle, x, z, ring,
  });
  if (ship) {
    const r = n === 1 ? 0 : 1.35;
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + Math.PI / 2; out.push(mk(et, Math.cos(a) * r, Math.sin(a) * r, 0, true)); }
    if (vacN > 0) { const vt = ENGINES[vacType]; for (let i = 0; i < vacN; i++) { const a = i / vacN * Math.PI * 2 + Math.PI / 6; out.push(mk(vt, Math.cos(a) * 3.15, Math.sin(a) * 3.15, 2, false)); } }
    return out;
  }
  const c = Math.min(3, n), inner = Math.min(10, Math.max(0, n - 3)), outer = Math.max(0, n - 13);
  for (let i = 0; i < c; i++) { const a = i / c * Math.PI * 2; const r = c === 1 ? 0 : 1.3; out.push(mk(et, Math.cos(a) * r, Math.sin(a) * r, 0, true)); }
  for (let i = 0; i < inner; i++) { const a = i / inner * Math.PI * 2 + 0.3; out.push(mk(et, Math.cos(a) * 2.85, Math.sin(a) * 2.85, 1, true)); }
  for (let i = 0; i < outer; i++) { const a = i / outer * Math.PI * 2; out.push(mk(et, Math.cos(a) * 4.0, Math.sin(a) * 4.0, 2, false)); }
  return out;
}

export interface StageStats { name: string; dry: number; prop: number; wet: number; dv: number; twrSL: number; twrVac: number; cost: number; length: number; burnTime: number; }
export interface DesignStats { booster: StageStats | null; ship: StageStats; totalMass: number; dvTotal: number; liftoffTWR: number; cost: number; height: number; payload: number; warnings: string[]; leoCapable: boolean; }

export function shipSpec(d: ShipDesign, nameOverride?: string): StageSpec {
  const v = SHIP_VARIANTS[d.variant];
  const et = ENGINES[d.engineType];
  const hopper = d.variant === 'hopper';
  const tankLen = hopper ? Math.min(d.tankLen, 18) : d.tankLen;
  const sl = hopper ? Math.min(d.sl, 3) : d.sl;
  const vac = hopper ? 0 : d.vac;
  const engines = buildEngines(sl, d.engineType, vac, d.vacType, true);
  let dry = (hopper ? 1.2 : 1.6) * 1000 * tankLen + v.nose * 900 + v.dryAdd + engines.reduce((s, e) => s + ENGINES[e.id].mass, 0);
  if (d.flaps > 0) dry += d.flaps === 1 ? 9000 : 7500;
  if (d.heatShield > 0) dry += [0, 6000, 11000, 13000][d.heatShield];
  if (d.legs) dry += d.variant === 'hls' ? 9000 : 3500;
  if (d.catchPins) dry += 800;
  let prop = PROP_PER_M_SHIP * tankLen * (d.variant === 'tanker' ? 1.12 : 1);
  if (hopper) prop = 5500 * tankLen;
  const crew = d.variant === 'crew' || d.variant === 'hls' ? d.crew : 0;
  const payload = d.variant === 'cargo' || d.variant === 'crew' || d.variant === 'hls' ? d.payload : d.variant === 'tanker' ? 0 : 0;
  const parts = ['ship_struct', ...engines.map((e) => e.id)];
  if (d.flaps) parts.push('flaps' + d.flaps);
  if (d.heatShield) parts.push('hs' + d.heatShield);
  if (d.legs) parts.push('legs');
  if (d.catchPins) parts.push('pins_ship');
  if (crew) parts.push('lifesupport');
  if (d.variant === 'tanker') parts.push('transfer');
  return {
    name: nameOverride || (hopper ? 'Starhopper' : 'Starship'), kind: 'ship', dry, propMax: prop, length: tankLen + v.nose + (hopper ? 4 : 2), diameter: 9,
    engines, gridFins: false, flaps: d.flaps > 0, heatShield: d.heatShield > 0 ? [0, 0.75, 0.93, 1][d.heatShield] : 0, legs: d.legs, catchPins: d.catchPins,
    crew, payload, payloadBay: d.variant === 'cargo', tanker: d.variant === 'tanker', cabin: crew > 0, rcs: hopper ? 30000 : 90000,
    maxQ: 45000, maxG: d.variant === 'crew' ? 6 : 8, tankLen, parts,
  };
}
export function boosterSpec(d: BoosterDesign): StageSpec {
  const engines = buildEngines(d.engines, d.engineType);
  let dry = 2000 * d.tankLen + 42000 + engines.reduce((s, e) => s + ENGINES[e.id].mass, 0);
  if (d.gridFins) dry += d.gridFins === 1 ? 12000 : 10500;
  if (d.hotStage) dry += 9000;
  if (d.catchPins) dry += 1200;
  if (d.legs) dry += 9000;
  const parts = ['booster_struct', ...engines.map((e) => e.id)];
  if (d.gridFins) parts.push('fins' + d.gridFins);
  if (d.hotStage) parts.push('hotstage');
  if (d.catchPins) parts.push('pins_booster');
  if (d.legs) parts.push('legs');
  return {
    name: 'Super Heavy', kind: 'booster', dry, propMax: PROP_PER_M_BOOSTER * d.tankLen, length: d.tankLen + 9 + (d.hotStage ? 2 : 0), diameter: 9,
    engines, gridFins: d.gridFins > 0, flaps: false, heatShield: 0, legs: d.legs, catchPins: d.catchPins, crew: 0, payload: 0,
    payloadBay: false, tanker: false, cabin: false, rcs: 150000, maxQ: 60000, maxG: 6, tankLen: d.tankLen, parts,
  };
}
export function designToSpec(d: Design): VehicleSpec {
  const stages: StageSpec[] = [];
  if (d.booster.enabled && d.ship.variant !== 'hopper') stages.push(boosterSpec(d.booster));
  stages.push(shipSpec(d.ship));
  return { name: d.name, stages, designId: d.id };
}
function stageStats(s: StageSpec, above: number): StageStats {
  let FSL = 0, FV = 0, mdot = 0;
  for (const e of s.engines) {
    const t = ENGINES[e.id];
    FV += t.thrustVac; FSL += t.thrustSL; mdot += t.thrustVac / (t.ispVac * G0);
  }
  const wet = s.dry + s.propMax + s.payload + s.crew * 100;
  const m0 = wet + above, m1 = m0 - s.propMax;
  const isp = mdot > 0 ? FV / (mdot * G0) : 0;
  // gemengde Isp: booster op zeeniveau gemiddeld
  const ispEff = s.kind === 'booster' ? isp * 0.965 : isp;
  return {
    name: s.name, dry: s.dry, prop: s.propMax, wet, dv: ispEff * G0 * Math.log(m0 / m1), twrSL: FSL / (m0 * G0), twrVac: FV / (m0 * G0),
    cost: 0, length: s.length, burnTime: mdot > 0 ? s.propMax / mdot : 0,
  };
}
export function partCost(d: Design) {
  const b = d.booster, s = d.ship;
  let cb = 0, cs = 0;
  if (b.enabled && s.variant !== 'hopper') {
    cb = 18e6 + b.tankLen * 0.45e6 + b.engines * ENGINES[b.engineType].cost + (b.gridFins ? 4e6 : 0) + (b.hotStage ? 2e6 : 0) + (b.catchPins ? 1e6 : 0) + (b.legs ? 3e6 : 0);
  }
  const v = SHIP_VARIANTS[s.variant];
  const sl = s.variant === 'hopper' ? Math.min(s.sl, 3) : s.sl;
  cs = 12e6 + s.tankLen * 0.5e6 + v.cost + sl * ENGINES[s.engineType].cost + (s.variant === 'hopper' ? 0 : s.vac * ENGINES[s.vacType].cost)
    + [0, 3e6, 4.5e6][s.flaps] + [0, 6e6, 12e6, 15e6][s.heatShield] + (s.legs ? 2e6 : 0) + (s.catchPins ? 0.8e6 : 0);
  if (s.variant === 'hopper') cs = 6e6 + sl * ENGINES[s.engineType].cost;
  return { booster: cb, ship: cs, total: cb + cs };
}
export function designStats(d: Design): DesignStats {
  const spec = designToSpec(d);
  const warnings: string[] = [];
  const shipS = spec.stages[spec.stages.length - 1];
  const shipSt = stageStats(shipS, 0);
  let boosterSt: StageStats | null = null;
  if (spec.stages.length > 1) boosterSt = stageStats(spec.stages[0], shipSt.wet);
  const costs = partCost(d);
  shipSt.cost = costs.ship; if (boosterSt) boosterSt.cost = costs.booster;
  const totalMass = shipSt.wet + (boosterSt ? boosterSt.wet : 0);
  const liftoffTWR = boosterSt ? boosterSt.twrSL : shipSt.twrSL;
  if (liftoffTWR < 1.05) warnings.push('Stuwkracht/gewicht bij lancering < 1,05 — komt niet van het platform!');
  else if (liftoffTWR < 1.25) warnings.push('Lage TWR bij lancering: veel zwaartekrachtverlies.');
  if (boosterSt && boosterSt.twrSL > 1.9) warnings.push('Zeer hoge TWR: let op max-Q en g-belasting.');
  if (d.ship.variant !== 'hls' && d.ship.variant !== 'hopper' && d.ship.heatShield === 0 && spec.stages.length > 1) warnings.push('Geen hitteschild: het schip overleeft terugkeer vanuit een baan niet.');
  if (d.ship.variant !== 'hls' && d.ship.flaps === 0 && spec.stages.length > 1) warnings.push('Geen flaps: geen gecontroleerde buiklanding mogelijk.');
  if (boosterSt && !d.booster.gridFins) warnings.push('Geen roosterroeren: booster kan niet sturen bij terugkeer.');
  if (boosterSt && !d.booster.hotStage) warnings.push('Geen hot-staging-ring: koude scheiding kost prestaties.');
  if (!d.ship.legs && !d.ship.catchPins && d.ship.variant !== 'hopper') warnings.push('Schip heeft geen poten en geen vangpinnen: landen is onmogelijk.');
  if (d.ship.variant === 'hopper' && !d.ship.legs) warnings.push('Starhopper heeft poten nodig om te landen.');
  if (d.ship.vac > 0 && spec.stages.length === 1 && d.ship.variant !== 'hls') warnings.push('Vacuümmotoren zonder booster: niet op zeeniveau gebruiken.');
  const dvTotal = shipSt.dv + (boosterSt ? boosterSt.dv : 0);
  return { booster: boosterSt, ship: shipSt, totalMass, dvTotal, liftoffTWR, cost: costs.total, height: spec.stages.reduce((s, x) => s + x.length, 0), payload: shipS.payload, warnings, leoCapable: dvTotal > 9200 };
}

export function defaultShip(): ShipDesign { return { variant: 'prototype', tankLen: 34, sl: 3, vac: 0, engineType: 'r1', vacType: 'r1v', flaps: 1, heatShield: 0, legs: true, catchPins: false, payload: 0, crew: 0 }; }
export function defaultBooster(): BoosterDesign { return { enabled: false, tankLen: 62, engines: 33, engineType: 'r2', gridFins: 1, catchPins: false, hotStage: true, legs: false }; }

export const BUILTIN_DESIGNS: Design[] = [
  { id: 'hopper', name: 'Starhopper', builtin: true, booster: { ...defaultBooster(), enabled: false }, ship: { ...defaultShip(), variant: 'hopper', tankLen: 18, sl: 1, vac: 0, flaps: 0, heatShield: 0, legs: true } },
  { id: 'sn', name: 'Starship SN-prototype', builtin: true, booster: { ...defaultBooster(), enabled: false }, ship: { ...defaultShip(), variant: 'prototype', tankLen: 30, sl: 3, vac: 0, flaps: 1, heatShield: 0, legs: true } },
  { id: 'ift', name: 'Starship IFT (Block 1)', builtin: true, booster: { enabled: true, tankLen: 60, engines: 33, engineType: 'r1', gridFins: 1, catchPins: false, hotStage: true, legs: false }, ship: { variant: 'prototype', tankLen: 32, sl: 3, vac: 3, engineType: 'r1', vacType: 'r1v', flaps: 1, heatShield: 1, legs: false, catchPins: false, payload: 0, crew: 0 } },
  { id: 'v2', name: 'Starship V2 Starlink', builtin: true, booster: { enabled: true, tankLen: 62, engines: 33, engineType: 'r2', gridFins: 1, catchPins: true, hotStage: true, legs: false }, ship: { variant: 'cargo', tankLen: 35, sl: 3, vac: 3, engineType: 'r2', vacType: 'r2v', flaps: 2, heatShield: 2, legs: false, catchPins: true, payload: 60000, crew: 0 } },
  { id: 'v3t', name: 'Starship V3 Tanker', builtin: true, booster: { enabled: true, tankLen: 66, engines: 33, engineType: 'r3', gridFins: 2, catchPins: true, hotStage: true, legs: false }, ship: { variant: 'tanker', tankLen: 40, sl: 3, vac: 6, engineType: 'r3', vacType: 'r3v', flaps: 2, heatShield: 3, legs: false, catchPins: true, payload: 0, crew: 0 } },
  { id: 'v3c', name: 'Starship V3 Crew', builtin: true, booster: { enabled: true, tankLen: 66, engines: 33, engineType: 'r3', gridFins: 2, catchPins: true, hotStage: true, legs: false }, ship: { variant: 'crew', tankLen: 38, sl: 3, vac: 6, engineType: 'r3', vacType: 'r3v', flaps: 2, heatShield: 3, legs: true, catchPins: true, payload: 10000, crew: 12 } },
  { id: 'hls', name: 'Starship HLS (maanlander)', builtin: true, booster: { enabled: true, tankLen: 66, engines: 33, engineType: 'r3', gridFins: 2, catchPins: true, hotStage: true, legs: false }, ship: { variant: 'hls', tankLen: 40, sl: 3, vac: 6, engineType: 'r3', vacType: 'r3v', flaps: 0, heatShield: 0, legs: true, catchPins: false, payload: 15000, crew: 4 } },
];
