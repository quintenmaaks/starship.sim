// Onderzoek & ontwikkeling (R&D-boom)
export interface ResearchNode { id: string; name: string; desc: string; cost: number; days: number; req: string[]; cat: 'motor' | 'structuur' | 'terugkeer' | 'operaties' | 'ruimte' | 'bemanning'; }
export const RESEARCH: ResearchNode[] = [
  { id: 'raptor2', name: 'Raptor 2', desc: 'Vereenvoudigde Raptor: +24% stuwkracht, goedkoper, betrouwbaarder.', cost: 90e6, days: 45, req: [], cat: 'motor' },
  { id: 'raptor3', name: 'Raptor 3', desc: '280 tf, geïntegreerde leidingen. Grote sprong in betrouwbaarheid.', cost: 260e6, days: 90, req: ['raptor2', 'mfgscale'], cat: 'motor' },
  { id: 'hotstage', name: 'Hot staging', desc: 'Schipmotoren ontsteken vóór scheiding: +prestaties, booster heeft ventilatiering nodig.', cost: 35e6, days: 25, req: [], cat: 'structuur' },
  { id: 'orbital', name: 'Orbitale Starship', desc: 'Super Heavy booster + Starship met laadruim (Starlink-dispenser).', cost: 120e6, days: 60, req: ['hotstage'], cat: 'structuur' },
  { id: 'heatshield2', name: 'Hitteschild v2', desc: 'Volledige tegeldekking met betere bevestiging.', cost: 60e6, days: 40, req: [], cat: 'terugkeer' },
  { id: 'heatshield3', name: 'Hitteschild v3', desc: 'Ablatieve back-uplaag onder de tegels. Brandt niet door bij tegelverlies.', cost: 140e6, days: 70, req: ['heatshield2'], cat: 'terugkeer' },
  { id: 'flaps2', name: 'Flaps v2 (lijwaarts)', desc: 'Voorste flaps naar de lijzijde verplaatst: minder hitte, beter stabiel.', cost: 45e6, days: 35, req: ['heatshield2'], cat: 'terugkeer' },
  { id: 'catch', name: 'Mechazilla-vangst', desc: 'Chopsticks + vangpinnen: booster vangen bij de toren. Snelle hergebruik.', cost: 110e6, days: 60, req: ['orbital'], cat: 'operaties' },
  { id: 'shipcatch', name: 'Schipvangst', desc: 'Starship landt in de armen van de toren na terugkeer uit een baan.', cost: 150e6, days: 75, req: ['catch', 'flaps2'], cat: 'operaties' },
  { id: 'gridfin2', name: 'Roosterroeren v2', desc: '3 grotere roosterroeren: betere controle bij terugkeer.', cost: 30e6, days: 20, req: ['catch'], cat: 'structuur' },
  { id: 'mfgscale', name: 'Starfactory', desc: 'Massaproductie: bouwtijd −40%, kosten −20%.', cost: 180e6, days: 80, req: ['orbital'], cat: 'operaties' },
  { id: 'rapidreuse', name: 'Snel hergebruik', desc: 'Inspectie en hertanken binnen dagen. Opknapkosten −60%.', cost: 120e6, days: 60, req: ['catch'], cat: 'operaties' },
  { id: 'proptransfer', name: 'Brandstofoverdracht', desc: 'Tankerschip + koppelsysteem: tanken in een baan om de aarde.', cost: 200e6, days: 90, req: ['orbital'], cat: 'ruimte' },
  { id: 'deepspace', name: 'Diepe-ruimtenavigatie', desc: 'Trans-maaninjectie, koerscorrecties, maanbaan.', cost: 160e6, days: 70, req: ['proptransfer'], cat: 'ruimte' },
  { id: 'hls', name: 'Starship HLS', desc: 'Maanlander met hoge motorpods en landingspoten.', cost: 400e6, days: 120, req: ['deepspace', 'raptor3'], cat: 'ruimte' },
  { id: 'crew', name: 'Bemande cabine', desc: 'Drukcabine, levensondersteuning, ramen, ontsnappingsprocedures.', cost: 300e6, days: 110, req: ['orbital', 'heatshield2'], cat: 'bemanning' },
  { id: 'abort', name: 'Afbreeksysteem', desc: 'Noodscheiding en motor-uit-tolerantie voor bemanning. Vereist voor certificering.', cost: 90e6, days: 50, req: ['crew'], cat: 'bemanning' },
  { id: 'lifesupport', name: 'Langdurige levensondersteuning', desc: 'Missies van weken: nodig voor maanreizen met bemanning.', cost: 180e6, days: 80, req: ['crew', 'deepspace'], cat: 'bemanning' },
  { id: 'avionics2', name: 'Avionica v2', desc: 'Drievoudig redundante vluchtcomputers: minder storingen.', cost: 40e6, days: 30, req: [], cat: 'structuur' },
  { id: 'qa', name: 'Kwaliteitssysteem', desc: 'Strengere inspecties: alle storingskansen −20%.', cost: 70e6, days: 45, req: ['avionics2'], cat: 'operaties' },
];
export const RESEARCH_BY_ID: Record<string, ResearchNode> = Object.fromEntries(RESEARCH.map((r) => [r.id, r]));
export const RESEARCH_CAT: Record<string, string> = { motor: 'Motoren', structuur: 'Structuur', terugkeer: 'Terugkeer', operaties: 'Operaties', ruimte: 'Ruimte', bemanning: 'Bemanning' };

// Faciliteiten
export interface FacilityDef { id: string; name: string; desc: string; levels: { cost: number; days: number; effect: string }[]; }
export const FACILITIES: FacilityDef[] = [
  { id: 'highbay', name: 'High Bay / Mega Bay', desc: 'Stapelen van schepen en boosters. Meer niveaus = sneller bouwen en parallel bouwen.', levels: [
    { cost: 0, days: 0, effect: '1 voertuig tegelijk' }, { cost: 80e6, days: 40, effect: '2 tegelijk, −15% bouwtijd' }, { cost: 220e6, days: 70, effect: '3 tegelijk, −30% bouwtijd' }] },
  { id: 'olm', name: 'Lanceerplatforms (OLM)', desc: 'Orbital Launch Mount met Mechazilla-toren. Tweede pad halveert wachttijd tussen lanceringen.', levels: [
    { cost: 0, days: 0, effect: 'Pad A, 14 dagen herstel' }, { cost: 160e6, days: 80, effect: 'Pad A + B, 7 dagen herstel' }, { cost: 300e6, days: 100, effect: 'Pad A + B + deluge v2, 3 dagen herstel' }] },
  { id: 'tankfarm', name: 'Tankopslag', desc: 'Cryogene opslag voor methaan en zuurstof. Nodig voor snelle cadans.', levels: [
    { cost: 0, days: 0, effect: 'Basis' }, { cost: 50e6, days: 30, effect: '−20% brandstofkosten' }, { cost: 120e6, days: 50, effect: '−35% brandstofkosten, eigen luchtscheiding' }] },
  { id: 'stand', name: "Massey's testlocatie", desc: 'Statische vuurproeven en cryotests. Hoger niveau = goedkopere en snellere tests.', levels: [
    { cost: 0, days: 0, effect: 'Basis' }, { cost: 40e6, days: 25, effect: 'Tests −30% kosten' }, { cost: 90e6, days: 40, effect: 'Tests −50% kosten, tests in 1 dag' }] },
  { id: 'platform', name: 'Offshore platform "Deimos"', desc: 'Lanceer- en landingsplatform op zee. Geeft extra landingsoptie en meer lanceervensters.', levels: [
    { cost: 0, days: 0, effect: 'Niet gebouwd' }, { cost: 250e6, days: 120, effect: 'Operationeel' }] },
  { id: 'mission', name: 'Missiecontrole', desc: 'Betere telemetrie en vluchtleiders: autopiloot betrouwbaarder.', levels: [
    { cost: 0, days: 0, effect: 'Basis' }, { cost: 30e6, days: 20, effect: 'Avionica-storingen −30%' }, { cost: 70e6, days: 35, effect: 'Avionica-storingen −50%, betere replays' }] },
];
