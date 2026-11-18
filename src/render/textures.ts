import * as THREE from 'three';
import { hash2 } from '../sim/terrain';

// --- 3D value noise voor naadloze bolkaarten ---
function h3(x: number, y: number, z: number) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function noise3(x: number, y: number, z: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(h3(xi, yi, zi), h3(xi + 1, yi, zi), u), l(h3(xi, yi + 1, zi), h3(xi + 1, yi + 1, zi), u), v),
    l(l(h3(xi, yi, zi + 1), h3(xi + 1, yi, zi + 1), u), l(h3(xi, yi + 1, zi + 1), h3(xi + 1, yi + 1, zi + 1), u), v), w);
}
export function fbm3(x: number, y: number, z: number, oct: number) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise3(x * f, y * f, z * f); f *= 2.02; a *= 0.5; }
  return s;
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return { c, g: c.getContext('2d')! };
}

// Wolkenkaart (equirectangulair, naadloos)
export function cloudTexture(w = 1024, h = 512) {
  const { c, g } = canvas(w, h);
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - y / h) * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    // wolkenbanden: ITCZ + middelbreedten
    const band = 0.55 + 0.25 * Math.exp(-((lat * 57.3) ** 2) / 60) + 0.2 * Math.exp(-(((Math.abs(lat * 57.3) - 55) ** 2) / 200)) - 0.18 * Math.exp(-(((Math.abs(lat * 57.3) - 25) ** 2) / 90));
    for (let x = 0; x < w; x++) {
      const lon = (x / w) * Math.PI * 2;
      const px = cl * Math.cos(lon) * 3, py = sl * 3, pz = cl * Math.sin(lon) * 3;
      // domeinvervorming voor wervels
      const q = fbm3(px + 5.2, py + 1.3, pz, 3);
      const n = fbm3(px * 1.6 + q * 1.8, py * 1.6 + q * 1.4, pz * 1.6, 6);
      let v = (n - (1.02 - band * 0.62)) * 3.2;
      v = Math.max(0, Math.min(1, v));
      v = Math.pow(v, 0.85);
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = v * 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export function radialSprite(stops: [number, string][], size = 128) {
  const { c, g } = canvas(size, size);
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export function smokeSprite(size = 128) {
  const { c, g } = canvas(size, size);
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x - size / 2) / (size / 2), dy = (y - size / 2) / (size / 2);
    const r = Math.sqrt(dx * dx + dy * dy);
    const n = fbm3(x / 18, y / 18, 3.3, 4);
    let a = Math.max(0, 1 - r) ** 1.5 * (0.55 + n * 0.9);
    a = Math.min(1, a);
    const i = (y * size + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 230 + n * 25;
    img.data[i + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Roestvrij staal: lichte strepen + lasnaden (ruwheid)
export function steelTextures(rings: number) {
  const W = 256, H = 1024;
  const { c, g } = canvas(W, H);
  g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 1400; i++) {
    const x = Math.random() * W, y = Math.random() * H, l = 20 + Math.random() * 120;
    g.strokeStyle = `rgba(${Math.random() > 0.5 ? 255 : 0},${Math.random() > 0.5 ? 255 : 0},${Math.random() > 0.5 ? 255 : 0},0.035)`;
    g.lineWidth = 1 + Math.random() * 2;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + l); g.stroke();
  }
  // vlekken
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * W, y = Math.random() * H, r = 10 + Math.random() * 40;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${Math.random() > 0.5 ? 200 : 60},${Math.random() > 0.5 ? 200 : 60},${Math.random() > 0.5 ? 200 : 60},0.08)`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // lasnaden (ringen)
  g.fillStyle = 'rgba(40,40,40,0.55)';
  for (let r = 0; r < rings; r++) g.fillRect(0, (r / rings) * H, W, 3);
  g.fillStyle = 'rgba(60,60,60,0.3)';
  for (let r = 0; r < 6; r++) g.fillRect((r / 6) * W, 0, 2, H);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// Hitteschildtegels (zeshoekig, zwart)
export function tileTexture() {
  const S = 512;
  const { c, g } = canvas(S, S);
  g.fillStyle = '#121214'; g.fillRect(0, 0, S, S);
  const r = 16, hgt = Math.sqrt(3) * r;
  for (let row = -1; row < S / hgt + 2; row++) for (let col = -1; col < S / (r * 1.5) + 2; col++) {
    const cx = col * r * 1.5, cy = row * hgt + (col % 2 ? hgt / 2 : 0);
    const shade = 16 + Math.random() * 18;
    g.fillStyle = `rgb(${shade},${shade},${shade + 2})`;
    g.beginPath();
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; g.lineTo(cx + Math.cos(a) * (r - 1.3), cy + Math.sin(a) * (r - 1.3)); }
    g.closePath(); g.fill();
    if (Math.random() < 0.03) { g.fillStyle = 'rgba(230,230,225,0.85)'; g.fill(); } // witte vervangtegel
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
export function gridFinTexture() {
  const S = 128; const { c, g } = canvas(S, S);
  g.clearRect(0, 0, S, S);
  g.strokeStyle = '#555'; g.lineWidth = 5;
  for (let i = -S; i < S * 2; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + S, S); g.stroke(); g.beginPath(); g.moveTo(i + S, 0); g.lineTo(i, S); g.stroke(); }
  g.strokeStyle = '#444'; g.lineWidth = 10; g.strokeRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function latticeTexture() {
  const W = 128, H = 128; const { c, g } = canvas(W, H);
  g.clearRect(0, 0, W, H);
  g.strokeStyle = '#3c3c3e'; g.lineWidth = 9;
  g.strokeRect(0, 0, W, H);
  g.lineWidth = 5; g.beginPath(); g.moveTo(0, 0); g.lineTo(W, H); g.moveTo(W, 0); g.lineTo(0, H); g.stroke();
  g.lineWidth = 4; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
export function concreteTexture() {
  const S = 512; const { c, g } = canvas(S, S);
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const n = fbm3(x / 40, y / 40, 1.7, 5), n2 = hash2(x, y);
    let v = 150 + n * 60 + n2 * 18;
    if (x % 128 < 2 || y % 128 < 2) v -= 50;
    const i = (y * S + x) * 4; img.data[i] = v; img.data[i + 1] = v * 0.98; img.data[i + 2] = v * 0.94; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
// detailtextuur terrein (zand/gras/vlekken), grijswaarden
export function detailTexture() {
  const S = 512; const { c, g } = canvas(S, S);
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const a = x / S * Math.PI * 2, b = y / S * Math.PI * 2;
    const n = fbm3(Math.cos(a) * 2, Math.sin(a) * 2, Math.cos(b) * 2 + Math.sin(b) * 1.3, 6);
    const v = 110 + n * 120 + hash2(x, y) * 25;
    const i = (y * S + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}
// Simpele omgevingskaart voor metaalreflecties
export function envGradient(renderer: THREE.WebGLRenderer) {
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `varying vec3 vP; void main(){ vec3 d = normalize(vP); float h = d.y;
      vec3 sky = mix(vec3(0.55,0.65,0.8), vec3(0.18,0.32,0.62), clamp(h,0.,1.));
      vec3 gnd = mix(vec3(0.33,0.31,0.27), vec3(0.12,0.12,0.12), clamp(-h*2.,0.,1.));
      vec3 c = h > 0. ? sky : gnd;
      c += vec3(4.,3.6,3.)*pow(max(dot(d, normalize(vec3(0.5,0.6,0.3))),0.),200.);
      c += vec3(0.4)*smoothstep(0.08,0.,abs(h));
      gl_FragColor = vec4(c,1.); }`,
  });
  scene.add(new THREE.Mesh(geo, mat));
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.02);
  pm.dispose();
  return rt.texture;
}
