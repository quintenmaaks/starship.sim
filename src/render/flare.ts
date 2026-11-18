import * as THREE from 'three';
import { radialSprite } from './textures';
// Lensflare als 2D-overlay (compatibel met MSAA-nabewerking)
export class Flare {
  scene = new THREE.Scene(); cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
  els: { m: THREE.Mesh; k: number; s: number }[] = [];
  constructor() {
    const glow = radialSprite([[0, 'rgba(255,255,255,1)'], [0.08, 'rgba(255,245,225,0.95)'], [0.3, 'rgba(255,210,160,0.22)'], [1, 'rgba(255,180,120,0)']], 256);
    const ring = radialSprite([[0, 'rgba(255,255,255,0)'], [0.7, 'rgba(160,200,255,0.0)'], [0.85, 'rgba(160,210,255,0.22)'], [1, 'rgba(160,200,255,0)']], 128);
    const dot = radialSprite([[0, 'rgba(255,220,180,0.35)'], [0.6, 'rgba(255,200,150,0.12)'], [1, 'rgba(255,200,150,0)']], 64);
    const streak = (() => { const c = document.createElement('canvas'); c.width = 512; c.height = 32; const g = c.getContext('2d')!; const gr = g.createLinearGradient(0, 0, 512, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(200,220,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 12, 512, 8); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    const add = (tex: THREE.Texture, k: number, s: number, col = 0xffffff, sx = 1) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, color: col, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }));
      m.userData.sx = sx; this.scene.add(m); this.els.push({ m, k, s });
    };
    add(glow, 0, 0.55);
    add(streak, 0, 0.9, 0xffffff, 6);
    add(ring, 0.35, 0.25, 0xaaccff);
    add(dot, 0.55, 0.08, 0xffccaa);
    add(dot, 0.75, 0.14, 0xaaffcc);
    add(ring, 1.0, 0.4, 0xffddaa);
    add(dot, 1.25, 0.06, 0xffaaff);
  }
  // sx, sy in NDC; vis 0..1
  render(r: THREE.WebGLRenderer, sx: number, sy: number, vis: number, aspect: number) {
    if (vis <= 0.01) return;
    this.cam.left = -aspect; this.cam.right = aspect; this.cam.updateProjectionMatrix();
    for (const e of this.els) {
      const x = sx * aspect * (1 - e.k * 2) , y = sy * (1 - e.k * 2);
      e.m.position.set(x, y, -1);
      const s = e.s * (e.k === 0 ? 1 : 1);
      e.m.scale.set(s * (e.m.userData.sx || 1), s, 1);
      (e.m.material as THREE.MeshBasicMaterial).opacity = vis * (e.k === 0 ? 1 : 0.6);
    }
    const ac = r.autoClear; r.autoClear = false;
    r.render(this.scene, this.cam);
    r.autoClear = ac;
  }
}
