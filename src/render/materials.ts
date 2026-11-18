import * as THREE from 'three';
import { steelTextures, tileTexture, concreteTexture, latticeTexture, gridFinTexture, detailTexture } from './textures';

// Gedeelde materialen (lui aangemaakt)
export class Mats {
  env: THREE.Texture | null = null;
  steel: THREE.MeshStandardMaterial; steelDark: THREE.MeshStandardMaterial; tiles: THREE.MeshStandardMaterial; concrete: THREE.MeshStandardMaterial;
  lattice: THREE.MeshStandardMaterial; paintWhite: THREE.MeshStandardMaterial; paintGrey: THREE.MeshStandardMaterial; black: THREE.MeshStandardMaterial;
  gridFin: THREE.MeshStandardMaterial; engine: THREE.MeshStandardMaterial; glass: THREE.MeshStandardMaterial; lightsOn: THREE.MeshBasicMaterial;
  rust: THREE.MeshStandardMaterial; detail: THREE.Texture; shed: THREE.MeshStandardMaterial; yellow: THREE.MeshStandardMaterial; regolith: THREE.MeshStandardMaterial;
  solar: THREE.MeshStandardMaterial; frost: THREE.MeshStandardMaterial;
  constructor(env: THREE.Texture | null) {
    this.env = env;
    const st = steelTextures(24);
    this.steel = new THREE.MeshStandardMaterial({ color: 0xd8dade, metalness: 1, roughness: 0.32, roughnessMap: st, envMap: env, envMapIntensity: 1.1 });
    const st2 = steelTextures(12);
    this.steelDark = new THREE.MeshStandardMaterial({ color: 0x8a8c90, metalness: 0.9, roughness: 0.5, roughnessMap: st2, envMap: env });
    const tt = tileTexture(); tt.repeat.set(6, 10);
    this.tiles = new THREE.MeshStandardMaterial({ map: tt, color: 0xffffff, metalness: 0.0, roughness: 0.85, envMap: env, envMapIntensity: 0.3 });
    const ct = concreteTexture(); ct.repeat.set(4, 4);
    this.concrete = new THREE.MeshStandardMaterial({ map: ct, color: 0xd0ccc4, roughness: 0.95 });
    const lt = latticeTexture();
    this.lattice = new THREE.MeshStandardMaterial({ map: lt, alphaTest: 0.5, side: THREE.DoubleSide, color: 0x9a9ca0, metalness: 0.6, roughness: 0.5, envMap: env });
    this.paintWhite = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.55, envMap: env, envMapIntensity: 0.4 });
    this.paintGrey = new THREE.MeshStandardMaterial({ color: 0x777a80, roughness: 0.6, metalness: 0.3, envMap: env });
    this.black = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.7 });
    const gf = gridFinTexture();
    this.gridFin = new THREE.MeshStandardMaterial({ map: gf, alphaTest: 0.4, side: THREE.DoubleSide, color: 0x9a9a9a, metalness: 0.8, roughness: 0.45, envMap: env });
    this.engine = new THREE.MeshStandardMaterial({ color: 0x5a5250, metalness: 0.85, roughness: 0.45, envMap: env, side: THREE.DoubleSide, emissive: 0x000000 });
    this.glass = new THREE.MeshStandardMaterial({ color: 0x050608, metalness: 0.2, roughness: 0.05, envMap: env });
    this.lightsOn = new THREE.MeshBasicMaterial({ color: 0xffeecc });
    this.rust = new THREE.MeshStandardMaterial({ color: 0x8a5a3c, roughness: 0.9 });
    this.detail = detailTexture();
    this.shed = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.6, metalness: 0.4, envMap: env });
    this.yellow = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.6 });
    this.regolith = new THREE.MeshStandardMaterial({ color: 0x8a8884, roughness: 1 });
    this.solar = new THREE.MeshStandardMaterial({ color: 0x1a2a5a, metalness: 0.6, roughness: 0.2, envMap: env });
    this.frost = new THREE.MeshStandardMaterial({ color: 0xf4f6fa, roughness: 0.9, transparent: true, opacity: 0.85 });
  }
}
