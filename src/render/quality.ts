// Grafische presets. Index: 0=Laag, 1=Normaal (standaard), 2=Hoog, 3=Ultra
export interface QualityPreset {
  id: number; name: string; desc: string;
  dprMax: number;          // max. pixelratio
  renderScale: number;     // startschaal van resolutie
  adaptive: boolean;       // dynamische resolutie om fps te halen
  targetFps: number;
  shadows: boolean; shadowMap: number;
  bloom: boolean; bloomStrength: number;
  antialias: boolean;      // MSAA in composer
  particles: number;       // max. deeltjes
  terrainLevel: number;    // 0..3 → resolutie terrein/water
  atmoSteps: number;       // 0..3 → atmosfeer-samples
  cloudTex: number;        // breedte wolkenkaart
  volClouds: boolean;      // volumetrisch-achtige wolkenlagen
  vegetation: number;
  stars: number;
  lensflare: boolean;
}
// Altijd Ultra: maximale beelden, ook als de iPhone onder 60 fps zakt.
export const ULTRA: QualityPreset = { id: 3, name: 'Ultra', desc: 'Alles op maximaal', dprMax: 3.0, renderScale: 1, adaptive: false, targetFps: 0, shadows: true, shadowMap: 4096, bloom: true, bloomStrength: 0.8, antialias: true, particles: 6000, terrainLevel: 3, atmoSteps: 3, cloudTex: 4096, volClouds: true, vegetation: 10000, stars: 14000, lensflare: true };
// Alleen als noodvangnet wanneer WebGL crasht / geheugen opraakt (context lost, te grote texture)
export const SAFE: QualityPreset = { ...ULTRA, id: 2, name: 'Veilig', dprMax: 2.0, shadowMap: 2048, cloudTex: 2048, particles: 3000, terrainLevel: 2, vegetation: 5000 };
export function currentPreset(): QualityPreset {
  try {
    if (localStorage.getItem('ss_gfx_safe') === '1') return SAFE;
    const c = document.createElement('canvas').getContext('webgl2');
    const maxTex = c ? (c.getParameter(c.MAX_TEXTURE_SIZE) as number) : 2048;
    if (maxTex < 4096) return SAFE;
  } catch { /* */ }
  return ULTRA;
}
