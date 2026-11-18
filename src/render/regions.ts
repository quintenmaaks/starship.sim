import * as THREE from 'three';
import { RegionDef, PadDef, hash2, fbm } from '../sim/terrain';
import { R_E, R_M } from '../sim/constants';
import { Mats } from './materials';
import { TowerState } from '../sim/world';
import { smokeSprite } from './textures';
import { QualityPreset } from './quality';

const LOGV = '#include <common>\n#include <logdepthbuf_pars_vertex>\n#include <fog_pars_vertex>\n';
const LOGF = '#include <common>\n#include <logdepthbuf_pars_fragment>\n#include <fog_pars_fragment>\n';

function curv(x: number, z: number, R: number) { return -(x * x + z * z) / (2 * R); }

// Polair raster: dicht bij het centrum fijn, ver weg grof
function polarGrid(extent: number, rings: number, segs: number, f: (x: number, z: number) => [number, number, number, number]) {
  const nV = 1 + rings * segs;
  const pos = new Float32Array(nV * 3), col = new Float32Array(nV * 3), uv = new Float32Array(nV * 2), extra = new Float32Array(nV);
  const put = (i: number, x: number, z: number) => {
    const [h, r, g, b] = f(x, z);
    pos[i * 3] = x; pos[i * 3 + 1] = h; pos[i * 3 + 2] = z;
    col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
    uv[i * 2] = x / 37; uv[i * 2 + 1] = z / 37;
    extra[i] = h;
  };
  put(0, 0, 0);
  for (let i = 1; i <= rings; i++) {
    const r = extent * Math.pow(i / rings, 1.75);
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2 + (i % 2) * Math.PI / segs;
      put(1 + (i - 1) * segs + s, Math.cos(a) * r, Math.sin(a) * r);
    }
  }
  const idx: number[] = [];
  for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
  for (let i = 1; i < rings; i++) {
    const a0 = 1 + (i - 1) * segs, b0 = 1 + i * segs;
    for (let s = 0; s < segs; s++) {
      const s1 = (s + 1) % segs;
      const odd = i % 2;
      // verschoven ringen → driehoeken
      if (!odd) { idx.push(a0 + s, a0 + s1, b0 + s); idx.push(a0 + s1, b0 + s1, b0 + s); }
      else { idx.push(a0 + s, b0 + s1, b0 + s); idx.push(a0 + s, a0 + s1, b0 + s1); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('hRaw', new THREE.BufferAttribute(extra, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class RegionView {
  group = new THREE.Group();
  def: RegionDef;
  towerMeshes: { st: TowerState; carriage: THREE.Group; armL: THREE.Group; armR: THREE.Group; qd: THREE.Group }[] = [];
  water: THREE.Mesh | null = null;
  waterMat: THREE.ShaderMaterial | null = null;
  terrain: THREE.Mesh;
  clouds: THREE.Group | null = null;
  padLights: THREE.Object3D[] = [];
  R: number;
  qp: QualityPreset;
  constructor(def: RegionDef, mats: Mats, qp: QualityPreset, towers: TowerState[]) {
    this.qp = qp;
    const quality = qp.terrainLevel;
    this.def = def;
    this.R = def.body === 'earth' ? R_E : R_M;
    const R = this.R;
    const rings = [160, 220, 300, 420][quality], segs = [200, 280, 360, 512][quality];
    const lunar = def.body === 'moon';
    const geo = polarGrid(def.extent, rings, segs, (x, z) => {
      let h = def.height(x, z);
      let c: number[];
      if (lunar) {
        const n = fbm(x / 900 + 3, z / 900, 3);
        const v = 0.36 + n * 0.22 + hash2(Math.floor(x / 7), Math.floor(z / 7)) * 0.03;
        c = [v, v * 0.98, v * 0.95];
      } else if (h < -0.3) {
        const d = Math.min(1, -h / 8);
        c = [0.55 - d * 0.3, 0.5 - d * 0.25, 0.38 - d * 0.12];
      } else {
        const n = fbm(x / 300, z / 300, 3), n2 = fbm(x / 60 + 9, z / 60, 2);
        if (def.id === 'gulf') {
          const coast = 2600 + 400 * Math.sin(z / 2700) + 150 * Math.sin(z / 730 + 1.3) - x;
          const sand = 1 - Math.min(1, Math.max(0, (coast - 120) / 260));
          const veg = Math.max(0, Math.min(1, (n - 0.35) * 3)) * (1 - sand);
          const mud = h < 0.7 ? 0.6 : 0;
          c = [0.78 - veg * 0.42, 0.7 - veg * 0.26, 0.52 - veg * 0.3];
          c = c.map((q, i) => q * (0.85 + n2 * 0.3) * (1 - mud * 0.25) + (i === 1 ? mud * 0.02 : 0));
          if (sand > 0.5) c = [0.86, 0.79, 0.62].map((q) => q * (0.92 + n2 * 0.12));
        } else {
          const veg = Math.max(0, Math.min(1, (n - 0.25) * 2.5));
          c = [0.42 - veg * 0.22, 0.48 - veg * 0.12, 0.3 - veg * 0.16].map((q) => q * (0.85 + n2 * 0.3));
          const coast = 1800 + 900 * Math.sin(z / 5200) + 120 * Math.sin(z / 600) - x;
          if (coast < 160) c = [0.86, 0.8, 0.66];
        }
      }
      return [h + curv(x, z, R), c[0], c[1], c[2]];
    });
    const tmat = new THREE.MeshStandardMaterial({ vertexColors: true, map: mats.detail, roughness: 1, metalness: 0 });
    tmat.onBeforeCompile = (sh) => {
      // detailtextuur op twee schalen, vervaagt met afstand
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
        vec4 dt1 = texture2D(map, vMapUv);
        vec4 dt2 = texture2D(map, vMapUv * 0.071);
        float dd = 0.75 + 0.5 * mix(dt1.r, dt2.r, 0.5);
        diffuseColor.rgb *= dd;`);
    };
    this.terrain = new THREE.Mesh(geo, tmat);
    this.terrain.receiveShadow = true;
    this.group.add(this.terrain);
    if (!lunar) {
      this.makeWater(def, quality);
      this.makeVegetation(def, mats);
      this.makeClouds(def);
    }
    for (const p of def.pads) this.makePad(def, p, mats, towers.filter((t) => t.region === def.id && t.pad.id === p.id)[0]);
    if (def.id === 'gulf') this.makeStarbase(mats);
    if (def.id === 'cape') this.makeCape(mats);
    if (lunar) this.makeLunarBase(mats);
  }
  y(x: number, z: number) { return this.def.height(x, z) + curv(x, z, this.R); }

  makeWater(def: RegionDef, quality: number) {
    const R = this.R;
    const geo = polarGrid(def.extent * 1.02, [120, 150, 180, 240][quality], [160, 200, 256, 360][quality], (x, z) => {
      const h = def.height(x, z);
      return [curv(x, z, R), Math.min(1, Math.max(0, -h / 10)), 0, 0];
    });
    this.waterMat = new THREE.ShaderMaterial({
      fog: true, transparent: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) },
        uSky: { value: new THREE.Color(0.5, 0.65, 0.9) }, uHorizon: { value: new THREE.Color(0.8, 0.85, 0.9) }, uUp: { value: new THREE.Vector3(0, 1, 0) },
        uDeep: { value: new THREE.Color(0.02, 0.09, 0.14) }, uShallow: { value: new THREE.Color(0.1, 0.32, 0.33) }, uLight: { value: 1 },
      }]),
      vertexShader: LOGV + `attribute vec3 color; varying vec3 vW; varying vec2 vL; varying float vDepth; varying vec3 vAX; varying vec3 vAY; varying vec3 vAZ;
        void main(){ vAX = normalize(mat3(modelMatrix)*vec3(1.0,0.0,0.0)); vAY = normalize(mat3(modelMatrix)*vec3(0.0,1.0,0.0)); vAZ = normalize(mat3(modelMatrix)*vec3(0.0,0.0,1.0)); vL = position.xz; vDepth = color.r; vec4 wp = modelMatrix * vec4(position,1.0); vW = wp.xyz;
          vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
          #include <logdepthbuf_vertex>
          #include <fog_vertex>
        }`,
      fragmentShader: LOGF + `uniform float uTime; uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uSky; uniform vec3 uHorizon; uniform vec3 uUp; uniform vec3 uDeep; uniform vec3 uShallow; uniform float uLight;
        varying vec3 vW; varying vec2 vL; varying float vDepth; varying vec3 vAX; varying vec3 vAY; varying vec3 vAZ;
        vec2 hash22(vec2 p){ p = vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3))); return -1.0 + 2.0*fract(sin(p)*43758.5453); }
        float gnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(dot(hash22(i),f), dot(hash22(i+vec2(1,0)),f-vec2(1,0)),u.x), mix(dot(hash22(i+vec2(0,1)),f-vec2(0,1)), dot(hash22(i+vec2(1,1)),f-vec2(1,1)),u.x),u.y); }
        float waves(vec2 p, float dist){
          float h = 0.0; float a = 1.0; float f = 0.035; vec2 dir = vec2(0.8, 0.6);
          for (int i = 0; i < 6; i++){
            float fade = clamp(1.0 - dist * f * 0.004, 0.0, 1.0);
            h += a * fade * gnoise(p * f + dir * uTime * (0.5 + f * 6.0));
            dir = mat2(0.8,-0.6,0.6,0.8) * dir; f *= 2.1; a *= 0.48;
          }
          return h;
        }
        void main(){
          #include <logdepthbuf_fragment>
          vec3 V = normalize(cameraPosition - vW);
          float dist = length(cameraPosition - vW);
          float e = 1.5;
          float h0 = waves(vL, dist), hx = waves(vL + vec2(e,0.0), dist), hz = waves(vL + vec2(0.0,e), dist);
          vec3 nl = normalize(vec3(-(hx-h0)*1.6, e, -(hz-h0)*1.6));
          vec3 N = normalize(vAX * nl.x + vAY * nl.y + vAZ * nl.z);
          vec3 U = uUp;
          float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
          vec3 Rf = reflect(-V, N);
          float ru = max(dot(Rf, U), 0.0);
          vec3 sky = mix(uHorizon, uSky, pow(ru, 0.5));
          vec3 water = mix(uShallow, uDeep, smoothstep(0.0, 0.8, vDepth)) * (0.25 + 0.75 * max(dot(U, uSun), 0.0)) * uLight;
          vec3 col = mix(water, sky, fres);
          float spec = pow(max(dot(Rf, uSun), 0.0), 350.0) * 6.0 + pow(max(dot(Rf, uSun), 0.0), 40.0) * 0.25;
          col += uSunCol * spec * step(0.0, dot(U, uSun));
          // schuim aan de kust
          float foam = smoothstep(0.08, 0.0, vDepth) * (0.5 + 0.5 * sin(vDepth * 60.0 - uTime * 1.5 + gnoise(vL * 0.05) * 6.0));
          col = mix(col, vec3(0.9) * uLight, foam * 0.6);
          gl_FragColor = vec4(col, smoothstep(0.0, 0.02, vDepth) * 0.25 + 0.75);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.water = new THREE.Mesh(geo, this.waterMat);
    this.water.renderOrder = 1;
    this.group.add(this.water);
  }

  makeVegetation(def: RegionDef, mats: Mats) {
    const g = new THREE.IcosahedronGeometry(1, 0);
    g.scale(1, 0.6, 1);
    const m = new THREE.MeshStandardMaterial({ color: def.id === 'gulf' ? 0x7a7f4a : 0x4a6a3a, roughness: 1, flatShading: true });
    const N = this.qp.vegetation;
    const im = new THREE.InstancedMesh(g, m, N);
    const mt = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let n = 0, tries = 0;
    while (n < N && tries < N * 8) {
      tries++;
      const a = hash2(tries, 3) * Math.PI * 2, r = 250 + Math.pow(hash2(tries, 5), 0.8) * 9000;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = def.height(x, z);
      if (h < 0.9) continue;
      if (fbm(x / 300, z / 300, 3) < (def.id === 'gulf' ? 0.42 : 0.3)) continue;
      if (def.pads.some((pd) => Math.hypot(pd.x - x, pd.z - z) < 260)) continue;
      const sc = 0.6 + hash2(tries, 8) * (def.id === 'gulf' ? 1.6 : 5);
      s.set(sc * (1 + hash2(tries, 2)), sc, sc * (1 + hash2(tries, 4)));
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash2(tries, 6) * 6);
      p.set(x, this.y(x, z) + sc * 0.3, z);
      mt.compose(p, q, s);
      im.setMatrixAt(n++, mt);
    }
    im.count = n;
    im.castShadow = false; im.receiveShadow = true;
    this.group.add(im);
  }

  makeClouds(def: RegionDef) {
    const tex = smokeSprite(128);
    const grp = new THREE.Group();
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.85, fog: true });
    for (let i = 0; i < (this.qp.volClouds ? 140 : 70); i++) {
      const a = hash2(i, 41) * Math.PI * 2, r = 4000 + hash2(i, 43) * 38000;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const base = 1400 + hash2(i, 45) * 900;
      const cl = new THREE.Group();
      const n = (this.qp.volClouds ? 9 : 5) + Math.floor(hash2(i, 47) * 6);
      for (let k = 0; k < n; k++) {
        const sp = new THREE.Sprite(mat);
        const sz = 600 + hash2(i * 13 + k, 51) * 900;
        sp.scale.set(sz, sz * 0.75, 1);
        sp.position.set((hash2(i, k + 60) - 0.5) * 1400, hash2(i, k + 80) * 350, (hash2(i, k + 90) - 0.5) * 1400);
        cl.add(sp);
      }
      cl.position.set(x, base + curv(x, z, this.R), z);
      grp.add(cl);
    }
    this.clouds = grp;
    this.group.add(grp);
  }

  // ---------- Bases ----------
  box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.group, cast = true) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z); b.castShadow = cast; b.receiveShadow = true;
    parent.add(b); return b;
  }
  cyl(rt: number, rb: number, h: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.group, seg = 24) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
    b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true;
    parent.add(b); return b;
  }
  padMarkTex(letter: string, lunar = false) {
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const g = c.getContext('2d')!;
    g.fillStyle = lunar ? '#77746f' : '#b9b5ad'; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`; g.fillRect(Math.random() * 512, Math.random() * 512, 3, 3); }
    // brandvlek
    const gr = g.createRadialGradient(256, 256, 10, 256, 256, 200); gr.addColorStop(0, 'rgba(20,18,16,0.55)'); gr.addColorStop(1, 'rgba(20,18,16,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
    g.strokeStyle = lunar ? '#ddd' : '#f2c230'; g.lineWidth = 14;
    g.beginPath(); g.arc(256, 256, 220, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 8; g.beginPath(); g.arc(256, 256, 70, 0, Math.PI * 2); g.stroke();
    g.fillStyle = lunar ? '#eee' : '#f2c230'; g.font = 'bold 120px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(letter, 256, 120);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  }
  makePad(def: RegionDef, p: PadDef, mats: Mats, tower?: TowerState) {
    const gy = this.y(p.x, p.z);
    const site = new THREE.Group(); site.position.set(p.x, 0, p.z); this.group.add(site);
    if (p.kind === 'olm') {
      // betonplaat + stalen deluge-plaat
      this.cyl(60, 62, 1.5, mats.concrete, 0, gy + 0.2, 0, site, 48);
      const plate = this.cyl(8, 8, 0.6, mats.steelDark, 0, gy + 1.2, 0, site, 32);
      plate.receiveShadow = true;
      // zes poten
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2 + Math.PI / 6;
        this.box(2.4, p.top - 2, 2.4, mats.concrete, Math.cos(a) * 9.5, gy + (p.top - 2) / 2 + 1, Math.sin(a) * 9.5, site);
      }
      // tafelring
      const ring = new THREE.Mesh(new THREE.TorusGeometry(8.2, 1.8, 10, 40), mats.steelDark);
      ring.rotation.x = Math.PI / 2; ring.scale.set(1, 1, 1.2); ring.position.set(0, p.top - 1.6, 0); ring.castShadow = true; site.add(ring);
      for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2; this.box(0.6, 1.2, 0.6, mats.paintGrey, Math.cos(a) * 5.6, p.top - 0.4, Math.sin(a) * 5.6, site); }
      // tankopslag (tank farm)
      for (let i = 0; i < 8; i++) {
        const tx = -90 - (i % 4) * 11, tz = -60 + Math.floor(i / 4) * 12;
        this.cyl(4.2, 4.2, 28, i % 3 ? mats.paintWhite : mats.steel, tx, gy + 14, tz, site);
        this.cyl(4.25, 4.25, 0.6, mats.paintGrey, tx, gy + 28, tz, site);
      }
      for (let i = 0; i < 3; i++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(6, 24, 16), mats.paintWhite); s.position.set(-70 + i * 14, gy + 7, 70); s.castShadow = true; site.add(s);
        this.box(3, 2, 3, mats.paintGrey, -70 + i * 14, gy + 1, 70, site);
      }
      // leidingen
      this.box(70, 1.2, 1.2, mats.steelDark, -55, gy + 2, -10, site);
      this.box(1.2, 1.2, 50, mats.steelDark, -88, gy + 2, 5, site);
      if (p.tower) this.makeTower(p, mats, gy, tower);
      // lichtmasten
      for (const [lx, lz] of [[40, 40], [40, -40], [-50, 45], [-50, -45]]) {
        this.cyl(0.4, 0.5, 40, mats.paintGrey, lx, gy + 20, lz, site, 8);
        const l = this.box(3, 1, 1, mats.lightsOn, lx, gy + 40, lz, site, false);
        this.padLights.push(l);
      }
    } else if (p.kind === 'pad' || p.kind === 'lunarpad') {
      const lunar = p.kind === 'lunarpad';
      const m = new THREE.MeshStandardMaterial({ map: this.padMarkTex(p.label.slice(-1), lunar), roughness: 0.95 });
      const d = this.cyl(p.r * 1.4, p.r * 1.45, 1.6, m, 0, gy + p.top - 0.8, 0, site, 48);
      d.material = [mats.concrete, m, mats.concrete] as any;
      if (lunar) {
        for (let i = 0; i < 8; i++) {
          const a = i / 8 * Math.PI * 2;
          this.cyl(0.08, 0.1, 2.5, mats.paintGrey, Math.cos(a) * p.r * 1.5, gy + 1.25, Math.sin(a) * p.r * 1.5, site, 6);
          const l = this.box(0.4, 0.3, 0.4, mats.lightsOn, Math.cos(a) * p.r * 1.5, gy + 2.6, Math.sin(a) * p.r * 1.5, site, false); this.padLights.push(l);
        }
      }
    } else if (p.kind === 'stand') {
      // Massey's: statische teststand met 4 poten, ringconstructie, tanks en wal
      this.cyl(30, 32, 1.2, mats.concrete, 0, gy + 0.3, 0, site, 40);
      for (let i = 0; i < 4; i++) {
        const a = i / 4 * Math.PI * 2 + Math.PI / 4;
        this.box(1.6, p.top, 1.6, mats.steelDark, Math.cos(a) * 6.5, gy + p.top / 2, Math.sin(a) * 6.5, site);
        // diagonale schoren
        const br = this.box(0.5, p.top * 1.1, 0.5, mats.steelDark, Math.cos(a) * 5.5, gy + p.top / 2, Math.sin(a) * 5.5, site);
        br.rotation.set(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3);
      }
      const ring = new THREE.Mesh(new THREE.TorusGeometry(5.6, 0.9, 8, 32), mats.steelDark); ring.rotation.x = Math.PI / 2; ring.position.y = gy + p.top - 0.8; ring.castShadow = true; site.add(ring);
      this.box(14, 2.5, 14, mats.concrete, 0, gy + 1.25, 0, site);
      // wal/berm
      const berm = new THREE.Mesh(new THREE.TorusGeometry(60, 6, 6, 40, Math.PI * 1.4), new THREE.MeshStandardMaterial({ color: 0x9a8a6a, roughness: 1 }));
      berm.rotation.x = Math.PI / 2; berm.scale.z = 0.4; berm.position.y = gy; site.add(berm);
      for (let i = 0; i < 5; i++) this.cyl(3.2, 3.2, 20, mats.paintWhite, 70 + i * 8, gy + 10, -30, site);
      this.box(14, 6, 10, mats.shed, -50, gy + 3, 40, site);
    } else if (p.kind === 'platform') {
      // offshore platform "Deimos"
      const deck = this.box(96, 4, 96, mats.paintGrey, 0, p.top - 2, 0, site);
      const top = new THREE.Mesh(new THREE.PlaneGeometry(92, 92), new THREE.MeshStandardMaterial({ map: this.padMarkTex('D'), roughness: 0.9 }));
      top.rotation.x = -Math.PI / 2; top.position.y = p.top + 0.02; top.receiveShadow = true; site.add(top);
      for (const [lx, lz] of [[-40, -40], [40, -40], [-40, 40], [40, 40]]) this.cyl(4, 5, 60, mats.yellow, lx, p.top - 32, lz, site, 16);
      this.box(80, 6, 4, mats.paintGrey, 0, p.top - 8, -40, site); this.box(80, 6, 4, mats.paintGrey, 0, p.top - 8, 40, site);
      // boortoren en kraan
      const der = this.box(10, 50, 10, mats.lattice, 38, p.top + 25, 38, site); der.castShadow = true;
      this.box(14, 10, 20, mats.paintWhite, -38, p.top + 5, 38, site);
      const crane = this.box(40, 2, 2, mats.yellow, -20, p.top + 16, -38, site); crane.rotation.z = 0.3;
      void deck;
    }
  }

  makeTower(p: PadDef, mats: Mats, gy: number, st?: TowerState) {
    const t = p.tower!;
    const g = new THREE.Group(); g.position.set(t.x - p.x, gy, t.z - p.z);
    // relative to pad site group -> add to site
    const site = this.group.children[this.group.children.length - 1];
    const W = 10, H = t.h;
    // hoekkolommen + vakwerkvlakken
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.box(1.1, H, 1.1, mats.steelDark, sx * W / 2, H / 2, sz * W / 2, g);
    const lt = mats.lattice.clone(); (lt.map as THREE.Texture) = mats.lattice.map!.clone(); lt.map!.repeat.set(1, H / W); lt.map!.needsUpdate = true;
    for (let i = 0; i < 4; i++) {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(W, H), lt);
      const a = i * Math.PI / 2;
      pl.position.set(Math.sin(a) * W / 2, H / 2, Math.cos(a) * W / 2); pl.rotation.y = a; pl.castShadow = true;
      g.add(pl);
    }
    // top: kraan/bliksemafleider
    this.box(W + 2, 3, W + 2, mats.steelDark, 0, H + 1.5, 0, g);
    this.cyl(0.3, 0.6, 25, mats.steelDark, 0, H + 15, 0, g, 6);
    this.box(4, 2, 4, mats.lightsOn, 0, H + 3.5, 0, g, false);
    // QD-arm schip (op ~ 105 m)
    const qd = new THREE.Group(); qd.position.set(W / 2, 106, -W / 2); g.add(qd);
    this.box(22, 3, 3, mats.lattice, 11, 0, 0, qd);
    this.box(4, 4, 4, mats.steelDark, 21, 0, 0, qd);
    // wagen + chopsticks
    const carriage = new THREE.Group(); g.add(carriage);
    this.box(W + 4, 6, W + 4, mats.steelDark, 0, 0, 0, carriage);
    const mkArm = (side: number) => {
      const arm = new THREE.Group();
      arm.position.set(W / 2 + 1, 0, side * 5.2);
      const beam = this.box(34, 3.2, 1.6, mats.steelDark, 17, 0, 0, arm);
      this.box(30, 0.6, 1.0, mats.yellow, 17, 1.9, side * -0.2, arm); // rail
      const pin = this.box(3, 1.4, 2.2, mats.steel, 24, 2.2, -side * 1.1, arm); void pin; void beam;
      carriage.add(arm);
      return arm;
    };
    const armL = mkArm(-1), armR = mkArm(1);
    site.add(g);
    if (st) this.towerMeshes.push({ st, carriage, armL, armR, qd });
    else this.towerMeshes.push({ st: { armH: 90, armOpen: 1 } as any, carriage, armL, armR, qd });
  }

  makeStarbase(mats: Mats) {
    // Bouwlocatie (Starfactory, Mega Bays, raketgaard), ~2,5 km landinwaarts
    const bx = -2300, bz = 700;
    const gy = this.y(bx, bz);
    const corr = mats.shed;
    this.box(90, 95, 60, corr, bx, gy + 47.5, bz, this.group); // Mega Bay 1
    this.box(90, 95, 60, corr, bx + 110, gy + 47.5, bz, this.group); // Mega Bay 2
    this.box(50, 80, 40, mats.paintWhite, bx - 90, gy + 40, bz + 20, this.group); // High Bay
    this.box(240, 30, 120, mats.paintWhite, bx + 40, gy + 15, bz + 140, this.group); // Starfactory
    for (let i = 0; i < 18; i++) this.box(4, 1, 116, mats.glass, bx - 76 + i * 13, gy + 30.6, bz + 140, this.group, false);
    // raketgaard
    for (let i = 0; i < 5; i++) {
      const x = bx - 30 + i * 16, z = bz - 90;
      this.cyl(4.5, 4.5, i % 2 ? 50 : 69, mats.steel, x, gy + (i % 2 ? 25 : 34.5), z, this.group, 24);
      if (i % 2 === 0) { const nose = new THREE.Mesh(new THREE.ConeGeometry(4.5, 0.1, 24), mats.steel); nose.position.set(x, gy + 69, z); this.group.add(nose); }
      else { const n = new THREE.Mesh(new THREE.SphereGeometry(4.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mats.steel); n.scale.y = 2.2; n.position.set(x, gy + 50, z); this.group.add(n); }
    }
    // weg (Highway 4) naar de lanceerlocatie
    const road = new THREE.Mesh(new THREE.PlaneGeometry(2300, 12), new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.9 }));
    road.rotation.x = -Math.PI / 2; road.position.set(-1150, 1.75, 180); road.receiveShadow = true; this.group.add(road);
    // kantoor/lanceercontrole
    this.box(30, 8, 20, mats.paintWhite, bx + 200, gy + 4, bz - 40, this.group);
    this.box(28, 0.5, 18, mats.solar, bx + 200, gy + 8.4, bz - 40, this.group, false);
  }
  makeCape(mats: Mats) {
    const gy = this.y(0, 0);
    // oude vaste servicetoren + watertoren + bliksemmasten
    this.box(12, 105, 12, mats.lattice, 40, gy + 52, -30, this.group);
    const wt = new THREE.Mesh(new THREE.SphereGeometry(7, 20, 14), mats.paintWhite); wt.position.set(-120, gy + 60, 80); this.group.add(wt);
    this.cyl(1, 1, 55, mats.paintGrey, -120, gy + 27, 80, this.group, 8);
    for (const [x, z] of [[70, 70], [-70, 70], [0, -90]]) this.cyl(0.8, 1.2, 180, mats.paintGrey, x, gy + 90, z, this.group, 8);
    this.box(160, 30, 100, mats.paintWhite, -1800, this.y(-1800, 200) + 15, 200, this.group);
  }
  makeLunarBase(mats: Mats) {
    const gy = this.y(260, -150);
    // habitatmodules, zonnepanelen, communicatiemast
    for (let i = 0; i < 3; i++) {
      const h = this.cyl(3, 3, 9, mats.paintWhite, 260 + i * 9, gy + 3, -150, this.group, 20);
      h.rotation.z = Math.PI / 2;
    }
    for (let i = 0; i < 6; i++) {
      const sp = this.box(12, 0.2, 5, mats.solar, 200 + i * 14, gy + 4, -200, this.group);
      sp.rotation.x = 0.9; // lage zon op de zuidpool
      this.cyl(0.15, 0.15, 4, mats.paintGrey, 200 + i * 14, gy + 2, -200, this.group, 6);
    }
    this.cyl(0.2, 0.3, 25, mats.paintGrey, 300, gy + 12, -120, this.group, 6);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 8, 0, Math.PI * 2, 0, 0.8), mats.paintWhite); dish.position.set(300, gy + 25, -120); dish.rotation.x = 2.3; this.group.add(dish);
  }

  update(time: number, sunLocal: THREE.Vector3, night: number) {
    if (this.waterMat) this.waterMat.uniforms.uTime.value = time;
    for (const tm of this.towerMeshes) {
      tm.carriage.position.y = tm.st.armH;
      const open = tm.st.armOpen ?? 1;
      tm.armL.rotation.y = open * 0.75; tm.armR.rotation.y = -open * 0.75;
      tm.qd.rotation.y = (tm as any).qdOpen ? -1.2 : 0;
    }
    for (const l of this.padLights) l.visible = night > 0.3;
    void sunLocal;
  }
}
