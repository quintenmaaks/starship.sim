// Fysieke specificatie van een voertuig (uit de ontwerper)
export interface EngineSpec {
  id: string;            // onderdeel-id (heritage)
  kind: 'sl' | 'vac';
  thrustVac: number;     // N
  ispVac: number;
  ispSL: number;
  gimbal: number;        // rad (0 voor vaste vacuummotoren)
  minThrottle: number;
  x: number; z: number;  // positie op bodem (m)
  ring: number;          // 0=centrum,1=binnen,2=buiten
}
export interface StageSpec {
  name: string;
  kind: 'booster' | 'ship';
  dry: number;           // kg (incl. structuur, motoren)
  propMax: number;       // kg
  length: number;        // m
  diameter: number;      // m
  engines: EngineSpec[];
  gridFins: boolean;
  flaps: boolean;
  heatShield: number;    // 0..1 kwaliteit/dekking
  legs: boolean;
  catchPins: boolean;
  crew: number;
  payload: number;       // kg
  payloadBay: boolean;
  tanker: boolean;
  cabin: boolean;
  rcs: number;           // N per as
  maxQ: number;          // Pa toelaatbaar
  maxG: number;          // toelaatbare axiale g
  tankLen: number;       // m (voor weergave)
  parts: string[];       // alle onderdeel-ids voor betrouwbaarheid
}
export interface VehicleSpec { name: string; stages: StageSpec[]; designId?: string; }
