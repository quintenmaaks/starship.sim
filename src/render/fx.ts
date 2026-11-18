import * as THREE from 'three';
import { smokeSprite, radialSprite } from './textures';

const LOGV = '#include <common>\n#include <logdepthbuf_pars_vertex>\n';
const LOGF = '#include <logdepthbuf_pars_fragment>\n';

// ---------------- Deeltjes (instanced billboards) ----------------
// Posities worden in float64 bewaard in het 'ouder'-frame en elke frame t.o.v. de oorsprong geüpload.
export type PKind = 0 | 1 | 2; // 0=rook (alpha), 1=vuur/gloed (additief), 2=stoom/stof (alpha, licht)
export class Particles {
  mesh: THREE.Mesh; geo: THREE.InstancedBufferGeometry;
  max: number; n = 0;
  px: Float64Array; py: Float64Array; pz: Float64Array; vx: Float32Array; vy: Float32Array; vz: Float32Array;
  age: Float32Array; life: Float32Array; size0: Float32Array; size1: Float32Array; kind: Uint8Array; col: Float32Array; drag: Float32Array; buoy: Float32Array; alpha: Float32Array;
  aPos: THREE.InstancedBufferAttribute; aSz: THREE.InstancedBufferAttribute; aCol: THREE.InstancedBufferAttribute;
  originX = 0; originY = 0; originZ = 0;
  up = new THREE.Vector3(0, 1, 0);
  constructor(max: number, additive: boolean) {
    this.max = max;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.setAttribute('position', base.getAttribute('position')); g.setAttribute('uv', base.getAttribute('uv'));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSz = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage); // size, rotation
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iSz', this.aSz); g.setAttribute('iCol', this.aCol);
    g.instanceCount = 0;
    this.geo = g;
    const tex = additive ? radialSprite([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']], 64) : smokeSprite(128);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uTex: { value: tex }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uAmb: { value: new THREE.Color(0.4, 0.45, 0.5) } },
      vertexShader: LOGV + `attribute vec3 iPos; attribute vec2 iSz; attribute vec4 iCol; varying vec2 vUv; varying vec4 vCol;
        void main(){ vUv = uv; vCol = iCol;
          vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
          float c = cos(iSz.y), s = sin(iSz.y);
          vec2 p = mat2(c, s, -s, c) * position.xy * iSz.x;
          mv.xy += p;
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: LOGF + `uniform sampler2D uTex; uniform vec3 uSunCol; uniform vec3 uAmb; varying vec2 vUv; varying vec4 vCol;
        void main(){
          #include <logdepthbuf_fragment>
          vec4 t = texture2D(uTex, vUv);
          ${additive ? 'gl_FragColor = vec4(vCol.rgb * t.a * vCol.a, 1.0);' : 'vec3 lit = vCol.rgb * (uAmb + uSunCol * 0.8); gl_FragColor = vec4(lit * t.rgb, t.a * vCol.a);'}
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 6 : 5;
    const F = (n: number) => new Float32Array(n);
    this.px = new Float64Array(max); this.py = new Float64Array(max); this.pz = new Float64Array(max);
    this.vx = F(max); this.vy = F(max); this.vz = F(max); this.age = F(max); this.life = F(max); this.size0 = F(max); this.size1 = F(max);
    this.kind = new Uint8Array(max); this.col = F(max * 4); this.drag = F(max); this.buoy = F(max); this.alpha = F(max);
  }
  emit(p: { x: number; y: number; z: number }, v: { x: number; y: number; z: number }, life: number, s0: number, s1: number, r: number, g: number, b: number, a: number, drag = 0.5, buoy = 0) {
    let i: number;
    if (this.n < this.max) i = this.n++;
    else { i = Math.floor(Math.random() * this.max); }
    this.px[i] = p.x; this.py[i] = p.y; this.pz[i] = p.z;
    this.vx[i] = v.x; this.vy[i] = v.y; this.vz[i] = v.z;
    this.age[i] = 0; this.life[i] = life; this.size0[i] = s0; this.size1[i] = s1;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
    this.drag[i] = drag; this.buoy[i] = buoy; this.alpha[i] = Math.random() * 6.28;
  }
  update(dt: number, gravity: THREE.Vector3 | null, wind: THREE.Vector3 | null) {
    let j = 0;
    const P = this.aPos.array as Float32Array, S = this.aSz.array as Float32Array, C = this.aCol.array as Float32Array;
    const up = this.up;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) continue;
      const k = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= k; this.vy[i] *= k; this.vz[i] *= k;
      if (wind) { const w = 1 - k; this.vx[i] += wind.x * w; this.vy[i] += wind.y * w; this.vz[i] += wind.z * w; }
      if (gravity) { this.vx[i] += gravity.x * dt; this.vy[i] += gravity.y * dt; this.vz[i] += gravity.z * dt; }
      const b = this.buoy[i] * dt; this.vx[i] += up.x * b; this.vy[i] += up.y * b; this.vz[i] += up.z * b;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      // compacteren
      if (j !== i) {
        this.px[j] = this.px[i]; this.py[j] = this.py[i]; this.pz[j] = this.pz[i];
        this.vx[j] = this.vx[i]; this.vy[j] = this.vy[i]; this.vz[j] = this.vz[i];
        this.age[j] = this.age[i]; this.life[j] = this.life[i]; this.size0[j] = this.size0[i]; this.size1[j] = this.size1[i];
        this.drag[j] = this.drag[i]; this.buoy[j] = this.buoy[i]; this.alpha[j] = this.alpha[i];
        for (let c = 0; c < 4; c++) this.col[j * 4 + c] = this.col[i * 4 + c];
      }
      const t = this.age[j] / this.life[j];
      P[j * 3] = this.px[j] - this.originX; P[j * 3 + 1] = this.py[j] - this.originY; P[j * 3 + 2] = this.pz[j] - this.originZ;
      S[j * 2] = this.size0[j] + (this.size1[j] - this.size0[j]) * Math.sqrt(t);
      S[j * 2 + 1] = this.alpha[j] + t * 0.6;
      const fade = Math.min(1, t * 8) * (1 - t) * (1 - t);
      C[j * 4] = this.col[j * 4]; C[j * 4 + 1] = this.col[j * 4 + 1]; C[j * 4 + 2] = this.col[j * 4 + 2]; C[j * 4 + 3] = this.col[j * 4 + 3] * fade;
      j++;
    }
    this.n = j;
    this.geo.instanceCount = j;
    this.aPos.needsUpdate = true; this.aSz.needsUpdate = true; this.aCol.needsUpdate = true;
  }
  clear() { this.n = 0; this.geo.instanceCount = 0; }
}

// ---------------- Motorpluimen ----------------
// Eén kegel per motor, schaal/vorm afhankelijk van omgevingsdruk (zeeniveau ↔ vacuüm)
export function plumeMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uThr: { value: 1 }, uVac: { value: 0 }, uCol: { value: new THREE.Color(1, 0.55, 0.3) } },
    vertexShader: LOGV + `uniform float uVac; varying vec2 vUv; varying vec3 vP; void main(){ vUv = uv; vP = position;
      vec3 p = position; float yy = clamp(-p.y, 0.0, 1.0);
      p.xz *= mix(1.0, mix(0.75, 7.0, uVac), pow(yy, mix(1.0, 0.6, uVac)));
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      #include <logdepthbuf_vertex>
      }`,
    fragmentShader: LOGF + `uniform float uTime; uniform float uThr; uniform float uVac; uniform vec3 uCol; varying vec2 vUv; varying vec3 vP;
      float h(float n){ return fract(sin(n)*43758.5453); }
      void main(){
        #include <logdepthbuf_fragment>
        float y = 1.0 - vUv.y;            // 0 bij mondstuk, 1 aan einde
        float core = pow(1.0 - y, 1.5);
        // schokdiamanten (alleen op zeeniveau)
        float diam = (1.0 - uVac) * pow(max(0.0, sin(y * 34.0 - uTime * 2.0)), 6.0) * (1.0 - y) * 1.6;
        float flick = 0.85 + 0.15 * h(floor(uTime * 40.0) + vUv.x * 7.0);
        vec3 hot = vec3(1.0, 0.95, 0.9);
        vec3 c = mix(uCol, hot, core * 0.7) * (core * 1.4 + diam) * flick;
        // methalox: blauw-paars nabij het mondstuk
        c += vec3(0.3, 0.35, 1.0) * smoothstep(0.12, 0.0, y) * 1.5;
        float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;
        float a = (1.0 - y) * (0.6 + 0.4 * edge) * uThr * mix(1.0, 0.35, uVac);
        gl_FragColor = vec4(c * a, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
export function plumeGeometry() {
  // open kegel, punt naar beneden (−Y), basis op y=0 met straal 1, lengte 1
  const g = new THREE.CylinderGeometry(1, 1, 1, 20, 12, true);
  g.translate(0, -0.5, 0);
  return g;
}

// Terugkeerplasma: gloeiende schil rond de buik, intensiteit volgt warmteflux
export function plasmaMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uI: { value: 0 } },
    vertexShader: LOGV + `varying vec3 vN; varying vec3 vV; varying vec2 vUv; void main(){ vUv = uv; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv;
      #include <logdepthbuf_vertex>
      }`,
    fragmentShader: LOGF + `uniform float uTime; uniform float uI; varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      void main(){
        #include <logdepthbuf_fragment>
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
        float n = 0.7 + 0.3 * sin(vUv.y * 40.0 + uTime * 30.0) * sin(vUv.x * 25.0 - uTime * 17.0);
        vec3 c = mix(vec3(1.0, 0.35, 0.5), vec3(1.0, 0.7, 0.4), vUv.y) * (rim * 1.5 + 0.2) * n * uI;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
