export const G0 = 9.80665;
export const MU_E = 3.986004418e14;
export const R_E = 6371000;
export const OMEGA_E = 7.2921159e-5;
export const ATMO_TOP = 140000;
export const MU_M = 4.9048695e12;
export const R_M = 1737400;
export const MOON_A = 384400e3;
export const MOON_INC = 5.1 * Math.PI / 180;
export const MOON_PERIOD = 2 * Math.PI * Math.sqrt(MOON_A ** 3 / (MU_E + MU_M));
export const MOON_SOI = 66100e3;
export const P0 = 101325;

export interface SiteDef { id: string; name: string; lat: number; lon: number; body: 'earth' | 'moon'; kind: string; }
export const SITES: Record<string, SiteDef> = {
  starbase: { id: 'starbase', name: 'Starbase, Texas', lat: 25.997, lon: -97.157, body: 'earth', kind: 'launch' },
  teststand: { id: 'teststand', name: "Massey's testlocatie", lat: 26.010, lon: -97.190, body: 'earth', kind: 'test' },
  offshore: { id: 'offshore', name: 'Offshore platform "Deimos"', lat: 25.997, lon: -96.86, body: 'earth', kind: 'sea' },
  cape: { id: 'cape', name: 'LC-39A, Kennedy Space Center', lat: 28.608, lon: -80.604, body: 'earth', kind: 'launch' },
  lunar: { id: 'lunar', name: 'Artemis-landingszone (zuidpool)', lat: -84.5, lon: 30.0, body: 'moon', kind: 'lunar' },
};
