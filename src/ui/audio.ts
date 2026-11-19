// Procedurele WebAudio: motorgeluid, wind/plasma, knallen, UI-geluiden en ambient muziek.
import { settings } from '../game/state';
import { clamp } from '../core/util';

class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode; sfx!: GainNode; musicBus!: GainNode;
  noise!: AudioBuffer; brown!: AudioBuffer;
  roarLo!: GainNode; roarHi!: GainNode; crackle!: GainNode; wind!: GainNode; windF!: BiquadFilterNode; roarF!: BiquadFilterNode;
  musicNodes: { stop: () => void } | null = null;
  musicOn = false;
  unlocked = false;

  init() {
    if (this.ctx) return;
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx: AudioContext = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain(); this.master.gain.value = 0.8; this.master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    comp.connect(this.master);
    this.sfx = ctx.createGain(); this.sfx.connect(comp);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.2; this.musicBus.connect(this.master);
    const len = ctx.sampleRate * 3;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0), b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; d[i] = w; last = (last + 0.02 * w) / 1.02; b[i] = last * 3.5; }
    const loop = (buf: AudioBuffer) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
    this.roarF = ctx.createBiquadFilter(); this.roarF.type = 'lowpass'; this.roarF.frequency.value = 400;
    this.roarLo = ctx.createGain(); this.roarLo.gain.value = 0;
    loop(this.brown).connect(this.roarF); this.roarF.connect(this.roarLo); this.roarLo.connect(this.sfx);
    const hiF = ctx.createBiquadFilter(); hiF.type = 'bandpass'; hiF.frequency.value = 900; hiF.Q.value = 0.6;
    this.roarHi = ctx.createGain(); this.roarHi.gain.value = 0;
    loop(this.noise).connect(hiF); hiF.connect(this.roarHi); this.roarHi.connect(this.sfx);
    // knetteren: ruis gemoduleerd door willekeurige pulsen
    const crF = ctx.createBiquadFilter(); crF.type = 'highpass'; crF.frequency.value = 1500;
    const crG = ctx.createGain(); crG.gain.value = 0;
    const lfoBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const ld = lfoBuf.getChannelData(0);
    for (let i = 1; i < ld.length; i++) ld[i] = Math.random() < 0.0016 ? 1 : ld[i - 1] * 0.993;
    loop(lfoBuf).connect(crG.gain);
    loop(this.noise).connect(crF); crF.connect(crG);
    this.crackle = ctx.createGain(); this.crackle.gain.value = 0; crG.connect(this.crackle); this.crackle.connect(this.sfx);
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 500; this.windF.Q.value = 0.7;
    this.wind = ctx.createGain(); this.wind.gain.value = 0;
    loop(this.noise).connect(this.windF); this.windF.connect(this.wind); this.wind.connect(this.sfx);
    this.applySettings();
  }
  unlock() {
    this.init();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (!this.unlocked) {
      this.unlocked = true;
      const s = this.ctx.createBufferSource(); s.buffer = this.ctx.createBuffer(1, 1, 22050); s.connect(this.ctx.destination); s.start(0);
      if (settings.music && this.musicOn) this.startMusic();
    }
  }
  applySettings() {
    if (!this.ctx) return;
    this.sfx.gain.value = +settings.sound || 0;
    this.musicBus.gain.value = (+settings.music || 0) * 0.4;
    if (!settings.music) this.stopMusic(); else if (this.musicOn && this.unlocked) this.startMusic();
  }
  // motor: thrust 0..1, dist meters van camera, atmo 0..1, onboard
  engine(thrust: number, dist: number, atmo: number, onboard: boolean, q: number, heat: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const att = onboard ? 0.6 : clamp(900 / (dist + 200), 0.02, 1);
    const medium = onboard ? 1 : clamp(atmo * 1.2, 0, 1);
    const lvl = clamp(thrust, 0, 1.4) * medium;
    this.roarLo.gain.setTargetAtTime(lvl * att * 0.9, t, 0.08);
    this.roarHi.gain.setTargetAtTime(lvl * att * att * 0.22, t, 0.08);
    this.crackle.gain.setTargetAtTime(lvl * att * 0.55 * (onboard ? 0.2 : 1), t, 0.1);
    this.roarF.frequency.setTargetAtTime(160 + 500 * att, t, 0.2);
    const w = clamp(q / 40000, 0, 1) * 0.35 + clamp(heat / 4e5, 0, 1) * 0.4;
    this.wind.gain.setTargetAtTime(w * (onboard ? 1 : 0.6), t, 0.2);
    this.windF.frequency.setTargetAtTime(300 + clamp(q / 30000, 0, 1) * 900 + clamp(heat / 3e5, 0, 1) * 600, t, 0.3);
  }
  silence() { if (!this.ctx) return; const t = this.ctx.currentTime; for (const g of [this.roarLo, this.roarHi, this.crackle, this.wind]) g.gain.setTargetAtTime(0, t, 0.15); }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.2, when = 0, slide = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + dur + 0.05);
  }
  private burst(dur: number, f0: number, f1: number, vol: number, when = 0, type: BiquadFilterType = 'lowpass') {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfx); s.start(t, Math.random() * 2); s.stop(t + dur + 0.05);
  }
  click() { this.tone(1400, 0.05, 'sine', 0.06); }
  tap() { this.tone(900, 0.04, 'triangle', 0.05); }
  back() { this.tone(600, 0.06, 'sine', 0.05, 0, 0.7); }
  beep(hi = false) { this.tone(hi ? 1320 : 880, hi ? 0.35 : 0.12, 'sine', 0.12); }
  warn() { this.tone(740, 0.12, 'square', 0.05); this.tone(740, 0.12, 'square', 0.05, 0.2); }
  boom() { this.burst(0.5, 300, 60, 0.9); this.tone(48, 0.5, 'sine', 0.6, 0, 0.6); this.burst(0.4, 250, 50, 0.6, 0.18); this.tone(44, 0.4, 'sine', 0.4, 0.18, 0.6); }
  explosion(near = 1) { this.burst(2.6, 2400, 60, 0.9 * near); this.tone(38, 1.6, 'sine', 0.8 * near, 0, 0.5); this.burst(1.2, 6000, 400, 0.3 * near, 0.05, 'highpass'); }
  clank() { this.tone(180, 0.6, 'triangle', 0.25, 0, 0.8); this.tone(420, 0.35, 'square', 0.06, 0.01, 0.6); this.burst(0.25, 3000, 600, 0.3); }
  stage() { this.burst(0.5, 1800, 200, 0.5); this.tone(90, 0.4, 'sine', 0.4, 0, 0.6); }
  coin() { this.tone(988, 0.09, 'square', 0.06); this.tone(1319, 0.32, 'square', 0.06, 0.08); }
  chime() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.5, 'sine', 0.12, i * 0.08)); }
  fanfare() { [392, 523, 659, 784, 1047, 1319].forEach((f, i) => { this.tone(f, 0.7, 'triangle', 0.1, i * 0.07); this.tone(f * 2, 0.5, 'sine', 0.03, i * 0.07 + 0.02); }); }
  fail() { [440, 370, 311].forEach((f, i) => this.tone(f, 0.45, 'sawtooth', 0.05, i * 0.16)); }
  objective() { this.tone(880, 0.12, 'sine', 0.1); this.tone(1320, 0.3, 'sine', 0.1, 0.09); }
  haptic(ms = 12) { if (settings.haptics && navigator.vibrate) try { navigator.vibrate(ms); } catch { /* */ } }

  setMusic(on: boolean) { this.musicOn = on; if (on && settings.music && this.ctx && this.unlocked) this.startMusic(); else this.stopMusic(); }
  startMusic() {
    if (!this.ctx || this.musicNodes) return;
    const ctx = this.ctx;
    const out = ctx.createGain(); out.gain.value = 0; out.gain.setTargetAtTime(1, ctx.currentTime, 2);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.4;
    const delay = ctx.createDelay(1.5); delay.delayTime.value = 0.6; const fb = ctx.createGain(); fb.gain.value = 0.35;
    lp.connect(out); out.connect(this.musicBus); out.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(this.musicBus);
    const chords = [[57, 64, 69, 72], [53, 60, 65, 69], [48, 55, 64, 67], [55, 62, 67, 71]];
    const oscs: OscillatorNode[] = [];
    for (let i = 0; i < 4; i++) for (const det of [-6, 6]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = det;
      const g = ctx.createGain(); g.gain.value = 0.035;
      o.connect(g); g.connect(lp); o.start(); oscs.push(o);
    }
    const bass = ctx.createOscillator(); bass.type = 'sine'; const bg = ctx.createGain(); bg.gain.value = 0.12; bass.connect(bg); bg.connect(out); bass.start();
    let ci = 0;
    const setChord = () => {
      const c = chords[ci % chords.length]; const t = ctx.currentTime;
      oscs.forEach((o, k) => o.frequency.setTargetAtTime(440 * Math.pow(2, (c[k >> 1] - 69) / 12), t, 0.8));
      bass.frequency.setTargetAtTime(440 * Math.pow(2, (c[0] - 12 - 69) / 12), t, 0.5);
      lp.frequency.setTargetAtTime(600 + Math.random() * 700, t, 3);
      ci++;
    };
    setChord();
    const iv = setInterval(setChord, 7000);
    this.musicNodes = { stop: () => { clearInterval(iv); const t = ctx.currentTime; out.gain.setTargetAtTime(0, t, 0.6); setTimeout(() => { oscs.forEach((o) => o.stop()); bass.stop(); out.disconnect(); delay.disconnect(); }, 2500); } };
  }
  stopMusic() { if (this.musicNodes) { this.musicNodes.stop(); this.musicNodes = null; } }
}
export const audio = new AudioEngine();
