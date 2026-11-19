import { Design, BUILTIN_DESIGNS } from './parts';
import { bus } from '../core/util';

export interface Loan { id: string; name: string; principal: number; balance: number; rate: number; termDays: number; startDay: number; }
export interface HeritageRec { flights: number; ok: number; fail: number; }
export interface Build { id: string; designId: string; name: string; kind: 'stack' | 'ship' | 'booster'; daysLeft: number; daysTotal: number; flights: number; condition: number; ready: boolean; tested: { cryo?: boolean; static?: boolean }; }
export interface Contract {
  id: string; title: string; client: string; desc: string; kind: 'starlink' | 'satellite' | 'government' | 'lunar' | 'tourism' | 'partnership' | 'cargo' | 'daily' | 'grant';
  mission: string; pay: number; advance: number; deadlineDay: number; rep: number; req: string[]; daily?: boolean; accepted?: boolean; payload?: number; crew?: number; penalty?: number;
}
export interface FlightLog { day: number; mission: string; title: string; result: 'succes' | 'gedeeltelijk' | 'mislukt'; notes: string; score: number; vehicle: string; }
export interface StockPoint { d: number; p: number; }
export interface GameState {
  v: number; slot: number; company: string; mode: 'career' | 'sandbox';
  created: number; saved: number; playSeconds: number;
  day: number; money: number; rep: number; hype: number;
  isPublic: boolean; sharePrice: number; sharesOut: number; ownerShares: number; stock: StockPoint[]; ipoDay: number; lastFlightDay: number;
  loans: Loan[]; missedPayments: number;
  team: { eng: number; tech: number; ops: number; safety: number; pilots: number }; morale: number; crunch: boolean;
  facilities: Record<string, number>;
  research: Record<string, boolean>; researching: { id: string; left: number } | null;
  heritage: Record<string, HeritageRec>;
  builds: Build[];
  tests: Record<string, { count: number; ok: number; best?: number }>;
  contracts: Contract[]; contractSeedDay: number;
  milestones: Record<string, number>; achievements: Record<string, number>;
  records: Record<string, number>;
  cert: Record<string, boolean>;
  log: FlightLog[];
  designs: Design[];
  stats: { flights: number; successes: number; failures: number; catches: number; landings: number; revenue: number; spent: number; crewFlown: number; rud: number; streak: number; bestStreak: number };
  padBusyUntil: number; news: { day: number; text: string; kind: string }[];
  tutorial: Record<string, boolean>;
  dailyDone: Record<string, boolean>;
}

export function newGame(company: string, mode: 'career' | 'sandbox', slot: number): GameState {
  const g: GameState = {
    v: 1, slot, company, mode, created: Date.now(), saved: Date.now(), playSeconds: 0,
    day: 0, money: mode === 'sandbox' ? 50e9 : 450e6, rep: 20, hype: 35,
    isPublic: false, sharePrice: 0, sharesOut: 1e9, ownerShares: 1e9, stock: [], ipoDay: -1, lastFlightDay: 0,
    loans: [], missedPayments: 0,
    team: { eng: 120, tech: 260, ops: 60, safety: 20, pilots: 0 }, morale: 72, crunch: false,
    facilities: { highbay: 0, olm: 0, tankfarm: 0, stand: 0, platform: 0, mission: 0 },
    research: {}, researching: null,
    heritage: {}, builds: [], tests: {},
    contracts: [], contractSeedDay: -1,
    milestones: {}, achievements: {}, records: {}, cert: {},
    log: [], designs: [],
    stats: { flights: 0, successes: 0, failures: 0, catches: 0, landings: 0, revenue: 0, spent: 0, crewFlown: 0, rud: 0, streak: 0, bestStreak: 0 },
    padBusyUntil: 0, news: [], tutorial: {}, dailyDone: {},
  };
  if (mode === 'sandbox') {
    for (const id of ['raptor2', 'raptor3', 'hotstage', 'orbital', 'heatshield2', 'heatshield3', 'flaps2', 'catch', 'shipcatch', 'gridfin2', 'mfgscale', 'rapidreuse', 'proptransfer', 'deepspace', 'hls', 'crew', 'abort', 'lifesupport', 'avionics2', 'qa']) g.research[id] = true;
    g.facilities = { highbay: 2, olm: 2, tankfarm: 2, stand: 2, platform: 1, mission: 2 };
    g.team = { eng: 900, tech: 2400, ops: 400, safety: 150, pilots: 12 };
  }
  // startvloot: een Starhopper en een SN-prototype klaar voor de eerste hop
  g.builds.push({ id: 'b1', designId: 'hopper', name: 'Starhopper', kind: 'ship', daysLeft: 0, daysTotal: 20, flights: 0, condition: 1, ready: true, tested: {} });
  g.builds.push({ id: 'b2', designId: 'sn', name: 'SN5', kind: 'ship', daysLeft: 0, daysTotal: 40, flights: 0, condition: 1, ready: true, tested: {} });
  return g;
}

export function allDesigns(g: GameState | null): Design[] {
  return [...BUILTIN_DESIGNS, ...(g ? g.designs : loadSandboxDesigns())];
}
export function findDesign(g: GameState | null, id: string) { return allDesigns(g).find((d) => d.id === id) || BUILTIN_DESIGNS[0]; }

// ---------- Opslaan ----------
const KEY = (slot: number) => `starship_save_${slot}`;
export const SLOTS = 4;
export function saveGame(g: GameState) {
  g.saved = Date.now();
  try { localStorage.setItem(KEY(g.slot), JSON.stringify(g)); bus.emit('saved', g.slot); return true; } catch (e) { console.warn('opslaan mislukt', e); return false; }
}
export function loadGame(slot: number): GameState | null {
  try { const s = localStorage.getItem(KEY(slot)); if (!s) return null; const g = JSON.parse(s) as GameState; return migrate(g); } catch { return null; }
}
export function deleteSave(slot: number) { localStorage.removeItem(KEY(slot)); }
export function slotInfo(slot: number) {
  const g = loadGame(slot);
  if (!g) return null;
  return { company: g.company, mode: g.mode, day: g.day, money: g.money, saved: g.saved, flights: g.stats.flights, isPublic: g.isPublic, share: g.sharePrice };
}
function migrate(g: GameState): GameState {
  const d = newGame(g.company || 'Bedrijf', g.mode || 'career', g.slot || 0);
  for (const k of Object.keys(d) as (keyof GameState)[]) if ((g as any)[k] === undefined) (g as any)[k] = (d as any)[k];
  g.stats = { ...d.stats, ...g.stats };
  return g;
}
// Ontwerpen buiten carrière (sandbox/ontwerper vanuit hoofdmenu)
export function loadSandboxDesigns(): Design[] { try { return JSON.parse(localStorage.getItem('starship_designs') || '[]'); } catch { return []; } }
export function saveSandboxDesigns(d: Design[]) { localStorage.setItem('starship_designs', JSON.stringify(d)); }

// Instellingen
export interface Settings { fps: boolean; sound: number; music: number; units: 'metric'; haptics: boolean; invertY: boolean; joySens: number; autoCam: boolean; subtitles: boolean; lastSlot: number; }
export const settings: Settings = Object.assign({ fps: false, sound: 0.8, music: 0.5, units: 'metric', haptics: true, invertY: false, joySens: 1, autoCam: true, subtitles: true, lastSlot: 0 }, (() => { try { return JSON.parse(localStorage.getItem('starship_settings') || '{}'); } catch { return {}; } })());
export function saveSettings() { localStorage.setItem('starship_settings', JSON.stringify(settings)); bus.emit('settings', settings); }

// Records (globaal, over alle saves)
export const globalRecords: Record<string, number> = (() => { try { return JSON.parse(localStorage.getItem('starship_records') || '{}'); } catch { return {}; } })();
export function saveRecords() { localStorage.setItem('starship_records', JSON.stringify(globalRecords)); }
