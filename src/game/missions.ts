// Missiecatalogus (metadata). De vluchtopzet staat in flight/setup.ts
export type MissionCat = 'test' | 'flight' | 'scenario';
export interface MissionDef {
  id: string; title: string; short: string; desc: string; cat: MissionCat;
  designs: string[];          // toegestane ontwerp-id's (eerste = standaard), '*' = elk passend
  needs: string[];            // onderzoek
  needsTests?: string[];      // eerdere tests (voor carrière)
  cost: number;               // operationele kosten (brandstof, personeel), exclusief voertuig
  days: number;               // voorbereidingsdagen
  reward: { money: number; rep: number; hype: number };
  heritage: string[];         // welke systemen ervaring opdoen
  hard: number;               // 1..5 moeilijkheid
  crew?: boolean; icon: string;
  noFlight?: boolean;         // grondtest
}
export const MISSIONS: MissionDef[] = [
  // ---------- Testcentrum ----------
  { id: 'tank', title: 'Tankdruktest', short: 'Druk op de tanks tot de limiet', icon: '🧪', cat: 'test', designs: ['sn', 'hopper', '*'], needs: [], cost: 2e6, days: 2, reward: { money: 0, rep: 1, hype: 1 }, heritage: ['structure'], hard: 1, noFlight: true,
    desc: "Het testartikel staat op Massey's. Verhoog de druk en houd hem vast. Hoe hoger de bewezen druk, hoe sterker de structuur bij echte vluchten. Te ver = knal." },
  { id: 'cryo', title: 'Cryogene proef', short: 'Vloeibare stikstof, koude drukproef', icon: '❄️', cat: 'test', designs: ['sn', 'hopper', '*'], needs: [], cost: 3e6, days: 3, reward: { money: 0, rep: 1, hype: 1 }, heritage: ['structure'], hard: 1, noFlight: true,
    desc: 'Vul de tanks met vloeibare stikstof (−196 °C) en houd de druk 60 seconden stabiel. Vangt lasfouten op vóór de eerste vlucht.' },
  { id: 'static_ship', title: 'Statische vuurproef (schip)', short: 'Motoren aan op de teststand', icon: '🔥', cat: 'test', designs: ['sn', 'v2', 'ift', '*'], needs: [], cost: 6e6, days: 4, reward: { money: 0, rep: 2, hype: 3 }, heritage: ['engine'], hard: 1, noFlight: true,
    desc: "Het schip is vastgeklemd op Massey's. Ontsteek de Raptors en laat ze de geplande duur draaien. Elke geslaagde ontsteking verlaagt het risico van motoruitval in de vlucht." },
  { id: 'static_booster', title: 'Statische vuurproef (Super Heavy)', short: '33 Raptors op de OLM', icon: '💥', cat: 'test', designs: ['v2', 'ift', '*'], needs: ['orbital'], cost: 14e6, days: 5, reward: { money: 0, rep: 3, hype: 6 }, heritage: ['engine', 'booster'], hard: 2, noFlight: true,
    desc: 'Super Heavy staat vast op de Orbital Launch Mount. Alle 33 motoren moeten tegelijk ontsteken en 8 seconden draaien. Het hele dorp hoort het.' },
  { id: 'hop150', title: 'Hop 150 m', short: 'Opstijgen, zweven, landen op Pad C', icon: '🦘', cat: 'test', designs: ['hopper', 'sn'], needs: [], cost: 4e6, days: 3, reward: { money: 10e6, rep: 4, hype: 6 }, heritage: ['engine', 'landing'], hard: 1,
    desc: 'De klassieker. Stijg op vanaf Pad B, klim naar 150 m, verplaats zijwaarts en land precies op Pad C. Je eerste succes ligt binnen handbereik!' },
  { id: 'hop10k', title: 'Hop 10 km + belly flop', short: 'SN8-stijl: klim, buiklanding, flip', icon: '🪂', cat: 'test', designs: ['sn'], needs: [], needsTests: ['hop150'], cost: 9e6, days: 6, reward: { money: 25e6, rep: 7, hype: 14 }, heritage: ['engine', 'landing', 'flaps', 'avionics'], hard: 2,
    desc: 'Klim naar 10 km, schakel motoren één voor één uit, val op je buik met de flaps en voer op het laatste moment de flip-and-burn uit. Spectaculair — als het lukt.' },
  { id: 'suborbital', title: 'Suborbitale testvlucht (IFT)', short: 'Volledige stack, hot staging, plons in zee', icon: '🚀', cat: 'test', designs: ['ift', 'v2'], needs: ['orbital'], needsTests: ['hop10k'], cost: 40e6, days: 10, reward: { money: 60e6, rep: 12, hype: 25 }, heritage: ['engine', 'booster', 'sep', 'tiles', 'flaps', 'avionics'], hard: 3,
    desc: 'Integrated Flight Test: Super Heavy + Starship. Max-Q, hot staging, boostback naar de oceaan, schip op een bijna-baan, terugkeer met plasma en zachte landing in de Indische Oceaan.' },
  { id: 'orbital', title: 'Orbitale vlucht', short: 'Eerste echte baan om de aarde', icon: '🛰️', cat: 'test', designs: ['v2', 'ift'], needs: ['orbital'], needsTests: ['suborbital'], cost: 45e6, days: 10, reward: { money: 80e6, rep: 14, hype: 25 }, heritage: ['engine', 'booster', 'sep', 'tiles', 'avionics'], hard: 3,
    desc: 'Bereik een stabiele baan (perigeum > 150 km). Daarna een deorbit-brand en overleven van de terugkeer.' },
  { id: 'boostercatch', title: 'Boostervangst', short: 'Mechazilla vangt Super Heavy', icon: '🥢', cat: 'test', designs: ['v2', 'v3t', 'v3c'], needs: ['catch'], needsTests: ['suborbital'], cost: 45e6, days: 10, reward: { money: 90e6, rep: 18, hype: 40 }, heritage: ['engine', 'booster', 'catch', 'sep'], hard: 4,
    desc: 'Na hot staging keert Super Heavy terug naar Starbase. De chopsticks moeten hem vangen bij de vangpinnen. Precisie op de meter.' },
  { id: 'shipcatch', title: 'Schipvangst', short: 'Starship uit de baan, gevangen door de toren', icon: '🤖', cat: 'test', designs: ['v2', 'v3t'], needs: ['shipcatch'], needsTests: ['orbital', 'boostercatch'], cost: 30e6, days: 8, reward: { money: 110e6, rep: 20, hype: 45 }, heritage: ['tiles', 'flaps', 'catch', 'avionics', 'landing'], hard: 5,
    desc: 'Starship begint boven de Stille Oceaan aan de terugkeer, glijdt duizenden kilometers op zijn buik en wordt boven Starbase door Mechazilla gevangen.' },
  { id: 'proptransfer', title: 'Brandstofoverdracht', short: 'Twee schepen koppelen in een baan', icon: '⛽', cat: 'test', designs: ['v3t'], needs: ['proptransfer'], needsTests: ['orbital'], cost: 70e6, days: 12, reward: { money: 150e6, rep: 20, hype: 30 }, heritage: ['rcs', 'avionics', 'transfer'], hard: 4,
    desc: 'Een tanker nadert het doelschip met RCS, koppelt en pompt honderden tonnen cryogene brandstof over. Sleutel tot de Maan.' },
  { id: 'lunar', title: 'Maanlanding (onbemand)', short: 'HLS landt op de zuidpool', icon: '🌕', cat: 'test', designs: ['hls'], needs: ['hls'], needsTests: ['proptransfer'], cost: 120e6, days: 20, reward: { money: 400e6, rep: 30, hype: 60 }, heritage: ['engine', 'landing', 'avionics', 'deepspace'], hard: 5,
    desc: 'Starship HLS cirkelt in een lage maanbaan. Voer de remfase uit, kantel naar verticaal en zet hem neer op de Artemis-landingszone bij de zuidpool.' },
  { id: 'crewleo', title: 'Bemande baanvlucht', short: 'Eerste bemanning aan boord', icon: '👩‍🚀', cat: 'test', designs: ['v3c'], needs: ['crew', 'abort'], needsTests: ['orbital', 'shipcatch'], cost: 80e6, days: 15, reward: { money: 250e6, rep: 30, hype: 70 }, heritage: ['engine', 'booster', 'sep', 'tiles', 'avionics', 'crew'], hard: 5, crew: true,
    desc: 'Vier astronauten, een baan om de aarde en een veilige thuiskomst. Elke storing is nu levensgevaarlijk.' },
  { id: 'crewlunar', title: 'Bemande maanlanding', short: 'Mensen op de Maan — het einddoel', icon: '🏁', cat: 'test', designs: ['hls'], needs: ['hls', 'crew', 'lifesupport'], needsTests: ['lunar', 'crewleo'], cost: 300e6, days: 30, reward: { money: 1.5e9, rep: 50, hype: 100 }, heritage: ['engine', 'landing', 'avionics', 'deepspace', 'crew'], hard: 5, crew: true,
    desc: 'Alleen met certificering van de toezichthouder. Land een bemande HLS op de Maan en breng iedereen veilig terug in een maanbaan.' },
  // ---------- Operationele vluchten (contracten) ----------
  { id: 'starlink', title: 'Starlink-lancering', short: 'Satellieten in een baan zetten', icon: '📡', cat: 'flight', designs: ['v2', 'v3t'], needs: ['orbital'], needsTests: ['orbital'], cost: 35e6, days: 8, reward: { money: 0, rep: 4, hype: 6 }, heritage: ['engine', 'booster', 'sep', 'tiles'], hard: 3,
    desc: 'Breng 60 ton Starlink V3-satellieten naar een baan van 300 km en laat ze los via de pez-deur.' },
  { id: 'satdeploy', title: 'Satelliet uitzetten', short: 'Klantsatelliet naar een baan', icon: '🛰️', cat: 'flight', designs: ['v2', 'v3t'], needs: ['orbital'], needsTests: ['orbital'], cost: 35e6, days: 8, reward: { money: 0, rep: 4, hype: 5 }, heritage: ['engine', 'booster', 'sep', 'tiles'], hard: 3,
    desc: 'Een klant betaalt voor een baan met hoog apogeum. Bereik de baan, zet de lading uit en keer terug.' },
  { id: 'tourism', title: 'Ruimtetoerisme', short: 'Betalende passagiers naar een baan', icon: '🎟️', cat: 'flight', designs: ['v3c'], needs: ['crew', 'abort'], needsTests: ['crewleo'], cost: 70e6, days: 12, reward: { money: 0, rep: 8, hype: 20 }, heritage: ['engine', 'booster', 'sep', 'tiles', 'crew'], hard: 4, crew: true,
    desc: 'Een rijke klant en vrienden willen de aarde vanuit een baan zien. Comfort en veiligheid voorop.' },
  // ---------- Scenario's ----------
  { id: 'sc_firsthop', title: 'Eerste sprong', short: 'Snelle start: hop in 60 seconden', icon: '⚡', cat: 'scenario', designs: ['hopper'], needs: [], cost: 0, days: 0, reward: { money: 0, rep: 0, hype: 0 }, heritage: [], hard: 1, desc: 'Je eerste vlucht. Druk op LANCEREN en kijk hoe de Starhopper opstijgt en landt.' },
  { id: 'sc_sn8', title: 'SN8: de buiklanding', short: 'December 2020 opnieuw', icon: '🪂', cat: 'scenario', designs: ['sn'], needs: [], cost: 0, days: 0, reward: { money: 0, rep: 0, hype: 0 }, heritage: [], hard: 2, desc: 'Begin op 10 km hoogte, net voor de belly flop. Lukt het jou wel om de flip te landen?' },
  { id: 'sc_ift5', title: 'IFT-5: de eerste vangst', short: 'Mechazilla vangt Super Heavy', icon: '🥢', cat: 'scenario', designs: ['v2'], needs: [], cost: 0, days: 0, reward: { money: 0, rep: 0, hype: 0 }, heritage: [], hard: 3, desc: 'Volledige lancering. Na hot staging volg je de booster terug naar de toren.' },
  { id: 'sc_boostercatch', title: 'Vangst van dichtbij', short: 'Begin bij de landingsbrand', icon: '🎯', cat: 'scenario', designs: ['v2'], needs: [], cost: 0, days: 0, reward: { money: 0, rep: 0, hype: 0 }, heritage: [], hard: 2, desc: 'Super Heavy valt terug naar de toren. Neem de besturing over of laat de autopiloot het doen.' },
  { id: 'sc_shipcatch', title: 'Mechazilla vangt Starship', short: 'Terugkeer uit een baan', icon: '🤖', cat: 'scenario', designs: ['v2'], needs: [], cost: 0, days: 0, reward: { money: 0, rep: 0, hype: 0 }, heritage: [], hard: 4, desc: 'Plasma, belly flop en een vangst in de chopsticks.' },
  { id: 'sc_night', title: 'Nachtlancering', short: 'Super Heavy in het donker', icon: '🌙', cat: 'scenario', designs: ['v2'], needs: [], cost: 0, days: 0, reward: { money: 0, rep: 0, hype: 0 }, heritage: [], hard: 2, desc: 'Een lancering om middernacht. De vlam verlicht de hele kust.' },
  { id: 'sc_engineout', title: 'Motorstoring!', short: 'Meerdere Raptors vallen uit', icon: '⚠️', cat: 'scenario', designs: ['v2'], needs: [], cost: 0, days: 0, reward: { money: 0, rep: 0, hype: 0 }, heritage: [], hard: 4, desc: 'Lage betrouwbaarheid: motoren vallen uit tijdens de klim. Haal je toch een baan?' },
  { id: 'sc_wind', title: 'Stormachtige max-Q', short: 'Harde windvlagen bij de lancering', icon: '🌪️', cat: 'scenario', designs: ['v2'], needs: [], cost: 0, days: 0, reward: { money: 0, rep: 0, hype: 0 }, heritage: [], hard: 3, desc: 'Windvlagen van 20 m/s. Houd de stack heel door max-Q.' },
  { id: 'sc_orbit', title: 'Uitzicht vanuit de baan', short: 'Rondvliegen boven de aarde', icon: '🌍', cat: 'scenario', designs: ['v2'], needs: [], cost: 0, days: 0, reward: { money: 0, rep: 0, hype: 0 }, heritage: [], hard: 1, desc: 'Je start in een baan van 250 km. Bekijk de zonsopkomst, de maan en de kaart met manoeuvreplanner.' },
  { id: 'sc_tanker', title: 'Tanken in de ruimte', short: 'Koppel en pomp over', icon: '⛽', cat: 'scenario', designs: ['v3t'], needs: [], cost: 0, days: 0, reward: { money: 0, rep: 0, hype: 0 }, heritage: [], hard: 3, desc: 'Twee schepen, 300 m uit elkaar. Breng ze samen en tank bij.' },
  { id: 'sc_artemis', title: 'Artemis III', short: 'Bemande landing op de zuidpool', icon: '🌕', cat: 'scenario', designs: ['hls'], needs: [], cost: 0, days: 0, reward: { money: 0, rep: 0, hype: 0 }, heritage: [], hard: 4, crew: true, desc: 'HLS in een lage maanbaan met vier astronauten. Land ze veilig.' },
  { id: 'sc_tli', title: 'Naar de Maan', short: 'Trans-maaninjectie vanuit een baan', icon: '🧭', cat: 'scenario', designs: ['hls'], needs: [], cost: 0, days: 0, reward: { money: 0, rep: 0, hype: 0 }, heritage: [], hard: 4, desc: 'Volgetankte HLS in een lage baan om de aarde. Voer de TLI-brand uit, versnel de tijd en kom aan bij de Maan.' },
];
export const MISSION_BY_ID: Record<string, MissionDef> = Object.fromEntries(MISSIONS.map((m) => [m.id, m]));
