// Gedeelde atmosfeer-scattering (km-eenheden), GLSL + JS-equivalent voor mistkleur
export const ATMO_GLSL = /* glsl */`
const float RP = 6371.0;
const float RA = 6471.0;
const vec3 BR = vec3(5.5e-3, 13.0e-3, 22.4e-3);
const float BM = 21e-3;
const float HR = 8.0;
const float HM = 1.2;
const float GM = 0.76;
vec2 rsi(vec3 r0, vec3 rd, float sr) {
  float a = dot(rd, rd); float b = 2.0 * dot(rd, r0); float c = dot(r0, r0) - (sr * sr);
  float d = (b*b) - 4.0*a*c;
  if (d < 0.0) return vec2(1e5,-1e5);
  float s = sqrt(d);
  return vec2((-b - s)/(2.0*a), (-b + s)/(2.0*a));
}
// geeft inscatter, schrijft transmissie
vec3 atmosphere(vec3 r0, vec3 r, vec3 pSun, float tMax, int iSteps, int jSteps, out vec3 trans) {
  vec2 p = rsi(r0, r, RA);
  trans = vec3(1.0);
  if (p.x > p.y) return vec3(0.0);
  p.y = min(p.y, tMax);
  vec2 pg = rsi(r0, r, RP);
  if (pg.x < pg.y && pg.x > 0.0) p.y = min(p.y, pg.x);
  p.x = max(p.x, 0.0);
  if (p.y <= p.x) return vec3(0.0);
  float iStepSize = (p.y - p.x) / float(iSteps);
  float iTime = p.x;
  vec3 totalR = vec3(0.0); vec3 totalM = vec3(0.0);
  float iOdR = 0.0; float iOdM = 0.0;
  float mu = dot(r, pSun);
  float mumu = mu * mu; float gg = GM * GM;
  float pR = 3.0 / (16.0 * 3.14159265) * (1.0 + mumu);
  float pM = 3.0 / (8.0 * 3.14159265) * ((1.0 - gg) * (mumu + 1.0)) / (pow(max(1.0 + gg - 2.0 * mu * GM, 1e-4), 1.5) * (2.0 + gg));
  for (int i = 0; i < 16; i++) {
    if (i >= iSteps) break;
    vec3 iPos = r0 + r * (iTime + iStepSize * 0.5);
    float iHeight = length(iPos) - RP;
    float odStepR = exp(-iHeight / HR) * iStepSize;
    float odStepM = exp(-iHeight / HM) * iStepSize;
    iOdR += odStepR; iOdM += odStepM;
    float jStepSize = rsi(iPos, pSun, RA).y / float(jSteps);
    float jTime = 0.0; float jOdR = 0.0; float jOdM = 0.0;
    bool shadow = false;
    for (int j = 0; j < 8; j++) {
      if (j >= jSteps) break;
      vec3 jPos = iPos + pSun * (jTime + jStepSize * 0.5);
      float jHeight = length(jPos) - RP;
      if (jHeight < 0.0) { shadow = true; break; }
      jOdR += exp(-jHeight / HR) * jStepSize;
      jOdM += exp(-jHeight / HM) * jStepSize;
      jTime += jStepSize;
    }
    if (!shadow) {
      vec3 attn = exp(-(BM * 1.1 * (iOdM + jOdM) + BR * (iOdR + jOdR)));
      totalR += odStepR * attn; totalM += odStepM * attn;
    }
    iTime += iStepSize;
  }
  trans = exp(-(BR * iOdR + BM * 1.1 * iOdM));
  return 22.0 * (pR * BR * totalR + pM * BM * totalM);
}
`;

// JS-versie (laag aantal samples) voor mist- en lichtkleur
const BR = [5.5e-3, 13.0e-3, 22.4e-3], BM = 21e-3, HR = 8, HM = 1.2, RP = 6371, RA = 6471;
function rsi(r0: number[], rd: number[], sr: number) {
  const b = 2 * (r0[0] * rd[0] + r0[1] * rd[1] + r0[2] * rd[2]);
  const c = r0[0] ** 2 + r0[1] ** 2 + r0[2] ** 2 - sr * sr;
  const d = b * b - 4 * c;
  if (d < 0) return [1e5, -1e5];
  const s = Math.sqrt(d);
  return [(-b - s) / 2, (-b + s) / 2];
}
export function skyColorJS(r0: number[], rd: number[], sun: number[], steps = 10): number[] {
  const p = rsi(r0, rd, RA);
  if (p[0] > p[1]) return [0, 0, 0];
  const pg = rsi(r0, rd, RP);
  if (pg[0] < pg[1] && pg[0] > 0) p[1] = Math.min(p[1], pg[0]);
  p[0] = Math.max(p[0], 0);
  const ds = (p[1] - p[0]) / steps;
  let t = p[0];
  const tR = [0, 0, 0], tM = [0, 0, 0];
  let oR = 0, oM = 0;
  const mu = rd[0] * sun[0] + rd[1] * sun[1] + rd[2] * sun[2];
  const g = 0.76, gg = g * g;
  const pR = 3 / (16 * Math.PI) * (1 + mu * mu);
  const pM = 3 / (8 * Math.PI) * ((1 - gg) * (mu * mu + 1)) / (Math.pow(Math.max(1 + gg - 2 * mu * g, 1e-4), 1.5) * (2 + gg));
  for (let i = 0; i < steps; i++) {
    const pos = [r0[0] + rd[0] * (t + ds / 2), r0[1] + rd[1] * (t + ds / 2), r0[2] + rd[2] * (t + ds / 2)];
    const h = Math.hypot(pos[0], pos[1], pos[2]) - RP;
    const dR = Math.exp(-h / HR) * ds, dM = Math.exp(-h / HM) * ds;
    oR += dR; oM += dM;
    const js = rsi(pos, sun, RA)[1] / 4;
    let jR = 0, jM = 0, sh = false;
    for (let j = 0; j < 4; j++) {
      const q = [pos[0] + sun[0] * js * (j + 0.5), pos[1] + sun[1] * js * (j + 0.5), pos[2] + sun[2] * js * (j + 0.5)];
      const hj = Math.hypot(q[0], q[1], q[2]) - RP;
      if (hj < 0) { sh = true; break; }
      jR += Math.exp(-hj / HR) * js; jM += Math.exp(-hj / HM) * js;
    }
    if (!sh) for (let k = 0; k < 3; k++) {
      const a = Math.exp(-(BM * 1.1 * (oM + jM) + BR[k] * (oR + jR)));
      tR[k] += dR * a; tM[k] += dM * a;
    }
    t += ds;
  }
  return [0, 1, 2].map((k) => 22 * (pR * BR[k] * tR[k] + pM * BM * tM[k]));
}
// transmissie van zonlicht naar punt (zonkleur)
export function sunTransmittance(r0: number[], sun: number[]): number[] {
  const pg = rsi(r0, sun, RP);
  if (pg[0] < pg[1] && pg[0] > 0) return [0, 0, 0];
  const p = rsi(r0, sun, RA);
  const L = Math.max(0, p[1]);
  const n = 12, ds = L / n;
  let oR = 0, oM = 0;
  for (let i = 0; i < n; i++) {
    const q = [r0[0] + sun[0] * ds * (i + 0.5), r0[1] + sun[1] * ds * (i + 0.5), r0[2] + sun[2] * ds * (i + 0.5)];
    const h = Math.max(0, Math.hypot(q[0], q[1], q[2]) - RP);
    oR += Math.exp(-h / HR) * ds; oM += Math.exp(-h / HM) * ds;
  }
  return [0, 1, 2].map((k) => Math.exp(-(BR[k] * oR + BM * 1.1 * oM)));
}
