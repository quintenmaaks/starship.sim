import * as THREE from 'three';
import { ATMO_GLSL } from './atmo';
import { R_E, R_M } from '../sim/constants';
import { QualityPreset } from './quality';
import { gpuCloudTexture } from './cloudgen';

const LOGV = '#include <common>\n#include <logdepthbuf_pars_vertex>\n';
const LOGF = '#include <logdepthbuf_pars_fragment>\n';

export class Space {
  group = new THREE.Group();
  earth: THREE.Mesh; clouds: THREE.Mesh; atmo: THREE.Mesh; moon: THREE.Mesh; stars: THREE.Points; milky: THREE.Mesh;
  sunLight: THREE.DirectionalLight; ambient: THREE.HemisphereLight;
  sunSprite: THREE.Object3D;
  earthMat: THREE.ShaderMaterial; atmoMat: THREE.ShaderMaterial; cloudMat: THREE.ShaderMaterial; moonMat: THREE.ShaderMaterial; starMat: THREE.ShaderMaterial; milkyMat: THREE.ShaderMaterial;
  quality = 2;
  cloudLayers: THREE.Mesh[] = [];
  constructor(renderer: THREE.WebGLRenderer, loader: THREE.TextureLoader, base: string, qp: QualityPreset) {
    const quality = qp.atmoSteps;
    this.quality = quality;
    const ES = [3, 4, 8, 12][quality], EJ = [2, 2, 4, 6][quality], AS = [6, 8, 14, 16][quality], AJ = [2, 3, 6, 8][quality];
    const day = loader.load(base + 'tex/earth_day.jpg'); day.colorSpace = THREE.SRGBColorSpace; day.anisotropy = 8;
    const night = loader.load(base + 'tex/earth_night.jpg'); night.colorSpace = THREE.SRGBColorSpace;
    const moonT = loader.load(base + 'tex/moon.jpg'); moonT.colorSpace = THREE.SRGBColorSpace; moonT.anisotropy = 8;
    const moonH = loader.load(base + 'tex/moon_height.jpg');
    const cloudT = gpuCloudTexture(renderer, qp.cloudTex);
    // ---- Aarde ----
    this.earthMat = new THREE.ShaderMaterial({
      defines: { ES_: ES, EJ_: EJ },
      uniforms: {
        uDay: { value: day }, uNight: { value: night }, uClouds: { value: cloudT }, uSun: { value: new THREE.Vector3(1, 0, 0) },
        uCamE: { value: new THREE.Vector3() }, uCloudRot: { value: 0 }, uQ: { value: quality }, uFogCol: { value: new THREE.Color() }, uFogD: { value: 0 },
      },
      vertexShader: LOGV + `
        varying vec2 vUv; varying vec3 vN; varying vec3 vWE; 
        void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vWE = mat3(modelMatrix) * position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: LOGF + ATMO_GLSL + `
        uniform sampler2D uDay; uniform sampler2D uNight; uniform sampler2D uClouds; uniform vec3 uSun; uniform vec3 uCamE; uniform float uCloudRot; uniform float uQ; uniform vec3 uFogCol; uniform float uFogD;
        varying vec2 vUv; varying vec3 vN; varying vec3 vWE;
        void main(){
          #include <logdepthbuf_fragment>
          vec3 n = normalize(vN);
          vec3 day = texture2D(uDay, vUv).rgb;
          float water = smoothstep(0.02, 0.12, day.b - max(day.r, day.g) * 0.85) ;
          float nl = dot(n, uSun);
          float dayK = smoothstep(-0.08, 0.15, nl);
          vec3 viewDir = normalize(vWE / 1000.0 - uCamE);
          // wolkenschaduw
          float cl = texture2D(uClouds, vUv + vec2(uCloudRot, 0.0)).a;
          vec3 col = day * (0.04 + 1.25 * max(nl, 0.0)) * (1.0 - cl * 0.5);
          // zee-spiegeling
          vec3 h = normalize(uSun - viewDir);
          float spec = pow(max(dot(n, h), 0.0), 120.0) * water * 2.5 * step(0.0, nl);
          col += vec3(1.0, 0.9, 0.75) * spec;
          // nachtlichten
          vec3 lights = texture2D(uNight, vUv).rgb;
          col += lights * vec3(1.0, 0.75, 0.42) * 1.6 * (1.0 - dayK) * (1.0 - cl * 0.8);
          // luchtperspectief
          vec3 pE = vWE / 1000.0;
          vec3 trans;
          float tMax = length(pE - uCamE);
          vec3 ins = atmosphere(uCamE, viewDir, uSun, tMax, ES_, EJ_, trans);
          col = col * trans + ins;
          // aansluiten op de lokale mist van het terrein
          float fk = 1.0 - exp(-tMax * 1000.0 * uFogD);
          col = mix(col, uFogCol, fk);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const seg = [128, 192, 256, 384][qp.terrainLevel];
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(R_E - 250, seg, seg / 2), this.earthMat);
    this.earth.renderOrder = -5;
    // ---- Wolken ----
    this.cloudMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uClouds: { value: cloudT }, uSun: { value: new THREE.Vector3(1, 0, 0) }, uCamE: { value: new THREE.Vector3() }, uFade: { value: 1 } },
      vertexShader: LOGV + `varying vec2 vUv; varying vec3 vN; varying vec3 vWE;
        void main(){ vUv = uv; vN = normalize(mat3(modelMatrix)*normal); vWE = mat3(modelMatrix)*position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);
        #include <logdepthbuf_vertex>
        }`,
      fragmentShader: LOGF + `uniform sampler2D uClouds; uniform vec3 uSun; uniform vec3 uCamE; uniform float uFade; varying vec2 vUv; varying vec3 vN; varying vec3 vWE;
        void main(){
          #include <logdepthbuf_fragment>
          float a = texture2D(uClouds, vUv).a;
          #ifdef LAYER
          // dikkere kern: alleen de dichte delen reiken lager
          a = smoothstep(0.25 + float(LAYER) / float(NL) * 0.5, 1.0, a) * 0.9;
          #endif
          vec3 n = normalize(vN);
          float nl = dot(n, uSun);
          float lit = smoothstep(-0.12, 0.25, nl);
          vec3 tint = mix(vec3(1.0, 0.55, 0.3), vec3(1.0), smoothstep(0.0, 0.35, nl));
          vec3 col = tint * (0.03 + 1.1 * lit);
          gl_FragColor = vec4(col, a * uFade * 0.92);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(R_E + 7000, seg, seg / 2), this.cloudMat);
    this.clouds.renderOrder = -3;
    if (qp.volClouds) {
      // extra schillen geven wolken dikte (parallax) — 'volumetrisch-achtig'
      const n = qp.id >= 3 ? 4 : 2;
      for (let i = 1; i <= n; i++) {
        const m = new THREE.ShaderMaterial({ vertexShader: this.cloudMat.vertexShader, fragmentShader: this.cloudMat.fragmentShader, transparent: true, depthWrite: false });
        m.uniforms = { uClouds: { value: cloudT }, uSun: { value: new THREE.Vector3(1, 0, 0) }, uCamE: { value: new THREE.Vector3() }, uFade: { value: 1 } };
        m.defines = { LAYER: i, NL: n };
        const l = new THREE.Mesh(new THREE.SphereGeometry(R_E + 7000 - i * 900, seg, seg / 2), m);
        l.renderOrder = -4;
        this.cloudLayers.push(l);
      }
    }
    // ---- Atmosfeerschil ----
    this.atmoMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.BackSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      defines: { AS_: AS, AJ_: AJ, RGND: '6368.0' },
      uniforms: { uSun: { value: new THREE.Vector3(1, 0, 0) }, uCamE: { value: new THREE.Vector3() }, uQ: { value: quality } },
      vertexShader: LOGV + `varying vec3 vWE; void main(){ vWE = mat3(modelMatrix)*position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);
        #include <logdepthbuf_vertex>
        }`,
      fragmentShader: LOGF + ATMO_GLSL + `uniform vec3 uSun; uniform vec3 uCamE; uniform float uQ; varying vec3 vWE;
        void main(){
          #include <logdepthbuf_fragment>
          vec3 rd = normalize(vWE / 1000.0 - uCamE);
          vec3 trans;
          vec3 c = atmosphere(uCamE, rd, uSun, 1e9, AS_, AJ_, trans);
          // zonneschijf
          float sd = dot(rd, uSun);
          vec2 pg = rsi(uCamE, rd, RGND);
          bool hitGround = pg.x < pg.y && pg.x > 0.0;
          if (!hitGround) c += vec3(14.0, 13.0, 12.0) * trans * smoothstep(0.99996, 0.99999, sd);
          float a = 1.0 - (trans.r + trans.g + trans.b) / 3.0;
          if (hitGround) a = 1.0;
          gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(R_E + 100000, 128, 64), this.atmoMat);
    this.atmo.renderOrder = -8;
    // ---- Maan ----
    this.moonMat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: moonT }, uH: { value: moonH }, uSun: { value: new THREE.Vector3(1, 0, 0) }, uEarthShine: { value: new THREE.Vector3(0, 0, 0) } },
      vertexShader: LOGV + `varying vec2 vUv; varying vec3 vN; varying vec3 vT; varying vec3 vB;
        void main(){ vUv = uv; vN = normalize(mat3(modelMatrix)*normal);
          vec3 t = normalize(cross(vec3(0.0,1.0,0.0), normal)); if (length(cross(vec3(0.0,1.0,0.0), normal)) < 0.01) t = vec3(1.0,0.0,0.0);
          vT = normalize(mat3(modelMatrix)*t); vB = cross(vN, vT);
          gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: LOGF + `uniform sampler2D uTex; uniform sampler2D uH; uniform vec3 uSun; uniform vec3 uEarthShine; varying vec2 vUv; varying vec3 vN; varying vec3 vT; varying vec3 vB;
        void main(){
          #include <logdepthbuf_fragment>
          vec2 px = vec2(1.0/1024.0, 1.0/512.0);
          float h0 = texture2D(uH, vUv).r, hx = texture2D(uH, vUv + vec2(px.x,0.0)).r, hy = texture2D(uH, vUv + vec2(0.0,px.y)).r;
          vec3 n = normalize(vN - (vT * (hx - h0) - vB * (hy - h0)) * 6.0);
          vec3 c = texture2D(uTex, vUv).rgb;
          float nl = max(dot(n, uSun), 0.0);
          vec3 col = c * (nl * 1.6 + 0.005) + c * uEarthShine * 0.02;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(R_M - 300, 192, 96), this.moonMat);
    // ---- Sterren ----
    const N = qp.stars;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N);
    const gp = new THREE.Vector3(0.3, 0.75, -0.6).normalize();
    for (let i = 0; i < N; i++) {
      let d: THREE.Vector3;
      // concentratie langs de Melkweg
      do { d = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1); } while (d.lengthSq() > 1 || d.lengthSq() < 0.01);
      d.normalize();
      if (Math.random() < 0.4) { d.addScaledVector(gp, -d.dot(gp) * (0.85 + Math.random() * 0.15)).normalize(); }
      pos.set([d.x, d.y, d.z], i * 3);
      const t = Math.random();
      const c = t < 0.2 ? [0.7, 0.8, 1] : t < 0.75 ? [1, 1, 1] : t < 0.92 ? [1, 0.92, 0.75] : [1, 0.7, 0.5];
      const mag = Math.pow(Math.random(), 4);
      col.set(c.map((x) => x * (0.3 + mag * 2.2)), i * 3);
      size[i] = 1.0 + mag * 3.5;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    sg.setAttribute('size', new THREE.BufferAttribute(size, 1));
    this.starMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uVis: { value: 1 }, uPR: { value: 1 } },
      vertexShader: LOGV + `attribute vec3 color; attribute float size; varying vec3 vC; uniform float uPR;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position * 1e11, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = size * uPR;
        #include <logdepthbuf_vertex>
        }`,
      fragmentShader: LOGF + `varying vec3 vC; uniform float uVis; void main(){
        #include <logdepthbuf_fragment>
        vec2 d = gl_PointCoord - 0.5; float a = smoothstep(0.5, 0.0, length(d)); gl_FragColor = vec4(vC * a * uVis, 1.0); }`,
    });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.frustumCulled = false; this.stars.renderOrder = -20;
    // ---- Melkweg ----
    this.milkyMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
      uniforms: { uVis: { value: 1 }, uGP: { value: gp } },
      vertexShader: LOGV + `varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position*1e11,1.0);
        #include <logdepthbuf_vertex>
        }`,
      fragmentShader: LOGF + `uniform float uVis; uniform vec3 uGP; varying vec3 vD;
        float hash(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
        float noise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
          return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
        float fbm(vec3 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.1; a*=0.5;} return s; }
        void main(){
          #include <logdepthbuf_fragment>
          vec3 d = normalize(vD);
          float b = abs(dot(d, uGP));
          float band = exp(-b*b*28.0);
          float n = fbm(d*6.0);
          float dust = smoothstep(0.45, 0.75, fbm(d*11.0+3.0)) * exp(-b*b*120.0);
          vec3 c = vec3(0.55,0.6,0.75) * band * (0.4 + n) * 0.12 * (1.0 - dust*0.8);
          c += vec3(0.9,0.75,0.6) * exp(-b*b*80.0) * smoothstep(0.3,1.0,n) * 0.05;
          gl_FragColor = vec4(c * uVis, 1.0); }`,
    });
    this.milky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.milkyMat);
    this.milky.renderOrder = -21; this.milky.frustumCulled = false;
    // ---- Licht ----
    this.sunLight = new THREE.DirectionalLight(0xffffff, 3.2);
    this.ambient = new THREE.HemisphereLight(0x88aaff, 0x443322, 0.35);
    // zon + lensflare
    this.sunSprite = new THREE.Object3D();

    this.group.add(...this.cloudLayers);
    this.group.add(this.milky, this.stars, this.atmo, this.earth, this.clouds, this.moon, this.sunLight, this.sunLight.target, this.ambient, this.sunSprite);
  }
  // Positioneer alles t.o.v. drijvende oorsprong
  update(o: { origin: THREE.Vector3; camECI: THREE.Vector3; camLocal: THREE.Vector3; sun: THREE.Vector3; earthQ: THREE.Quaternion; moonPos: THREE.Vector3; moonQ: THREE.Quaternion; t: number; skyBright: number; pixelRatio: number }) {
    const ep = new THREE.Vector3().sub(o.origin);
    this.earth.position.copy(ep); this.earth.quaternion.copy(o.earthQ);
    for (const c of [this.clouds, ...this.cloudLayers]) { c.position.copy(ep); c.quaternion.copy(o.earthQ); c.rotateY(o.t * 2e-6); }
    this.atmo.position.copy(ep);
    const camE = o.camECI.clone().multiplyScalar(0.001);
    for (const m of [this.earthMat, this.atmoMat, this.cloudMat, ...this.cloudLayers.map((l) => l.material as THREE.ShaderMaterial)]) { m.uniforms.uSun.value.copy(o.sun); m.uniforms.uCamE.value.copy(camE); }
    const camAlt = o.camECI.length() - R_E;
    const cf = THREE.MathUtils.smoothstep(camAlt, 9000, 30000);
    this.cloudMat.uniforms.uFade.value = cf;
    for (const l of this.cloudLayers) (l.material as THREE.ShaderMaterial).uniforms.uFade.value = cf;
    this.moon.position.copy(o.moonPos).sub(o.origin); this.moon.quaternion.copy(o.moonQ);
    this.moonMat.uniforms.uSun.value.copy(o.sun);
    // sterren/melkweg rond camera
    this.stars.position.copy(o.camLocal); this.milky.position.copy(o.camLocal);
    const vis = THREE.MathUtils.clamp(1 - o.skyBright * 1.2, 0.0, 1);
    this.starMat.uniforms.uVis.value = vis; this.milkyMat.uniforms.uVis.value = vis;
    this.starMat.uniforms.uPR.value = o.pixelRatio;
    // zonlicht
    this.sunLight.position.copy(o.camLocal).addScaledVector(o.sun, 5000);
    this.sunLight.target.position.copy(o.camLocal);
    this.sunSprite.position.copy(o.camLocal).addScaledVector(o.sun, 1e10);
  }
}
