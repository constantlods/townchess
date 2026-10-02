/**
 * Original procedural sound design (Web Audio). Nothing is sampled.
 * Buses: sfx, ambience, music → master. Ambience: electrical hum, air, room tone, and sparse
 * distant events (pipes, creaks, footsteps, metal). Everything stays quiet; chess comes first.
 */
export type Sfx = 'pickup' | 'place' | 'capture' | 'slide' | 'clock' | 'button' | 'check' | 'gameover' | 'select';

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private music!: GainNode;
  private noiseBuf!: AudioBuffer;
  private timers: number[] = [];
  private vols = { sfx: 0.8, amb: 0.55, music: 0.35 };
  reducedHorror = false;
  private duck = 1;

  /** Must be called from a user gesture. */
  async start() {
    if (this.ctx) { await this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.amb = ctx.createGain(); this.music = ctx.createGain();
    this.sfx.connect(this.master); this.amb.connect(this.master); this.music.connect(this.master);
    this.applyVolumes();
    const len = ctx.sampleRate * 3;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    // pinkish noise (Paul Kellet filter)
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    }
    this.startAmbience();
    this.startMusic();
  }

  setVolumes(sfx: number, amb: number, music: number) {
    this.vols = { sfx, amb, music };
    this.applyVolumes();
  }
  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sfx.gain.setTargetAtTime(this.vols.sfx, t, 0.1);
    this.amb.gain.setTargetAtTime(this.vols.amb * 0.5 * this.duck, t, 0.4);
    this.music.gain.setTargetAtTime(this.vols.music * 0.35 * this.duck, t, 0.4);
  }
  /** Fade ambience and music (game over). */
  setDuck(v: number) { this.duck = v; this.applyVolumes(); }

  private noise(): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = true;
    s.loopStart = Math.random(); s.loopEnd = 2.9;
    return s;
  }

  private startAmbience() {
    const ctx = this.ctx!;
    // electrical hum: 50 Hz fundamental + odd harmonics, softly modulated
    const hum = ctx.createGain(); hum.gain.value = 0.05;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    for (const [f, a] of [[50, 1], [100, 0.5], [150, 0.35], [250, 0.12], [350, 0.06]] as const) {
      const o = ctx.createOscillator(); o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.002);
      const g = ctx.createGain(); g.gain.value = a;
      o.connect(g).connect(lp); o.start();
    }
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.015;
    lfo.connect(lfoG).connect(hum.gain); lfo.start();
    lp.connect(hum).connect(this.amb);
    // air movement: band-passed noise with slow swells
    const air = this.noise();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 380; bp.Q.value = 0.6;
    const airG = ctx.createGain(); airG.gain.value = 0.18;
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.05;
    const lfo2G = ctx.createGain(); lfo2G.gain.value = 0.08;
    lfo2.connect(lfo2G).connect(airG.gain); lfo2.start();
    air.connect(bp).connect(airG).connect(this.amb); air.start();
    // low room tone
    const room = this.noise();
    const rlp = ctx.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 90;
    const rg = ctx.createGain(); rg.gain.value = 0.5;
    room.connect(rlp).connect(rg).connect(this.amb); room.start();
    // sparse distant events
    const schedule = () => {
      const wait = 6000 + Math.random() * 14000;
      this.timers.push(window.setTimeout(() => { this.ambientEvent(); schedule(); }, wait));
    };
    schedule();
  }

  private ambientEvent() {
    const r = Math.random();
    if (r < 0.28) this.pipeKnock();
    else if (r < 0.52) this.creak();
    else if (r < 0.68 && !this.reducedHorror) this.footsteps();
    else if (r < 0.84) this.metal();
    else this.drip();
  }

  private env(g: GainNode, t: number, a: number, peak: number, dec: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }

  private burst(bus: AudioNode, freq: number, q: number, peak: number, dec: number, type: BiquadFilterType = 'bandpass', delay = 0, pan = 0) {
    const ctx = this.ctx!; const t = ctx.currentTime + delay;
    const n = this.noise(); const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); this.env(g, t, 0.003, peak, dec);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    n.connect(f).connect(g).connect(p).connect(bus); n.start(t); n.stop(t + dec + 0.1);
  }

  private tone(bus: AudioNode, freq: number, peak: number, dec: number, type: OscillatorType = 'sine', delay = 0, pan = 0, glide = 0) {
    const ctx = this.ctx!; const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(freq * glide, t + dec);
    const g = ctx.createGain(); this.env(g, t, 0.004, peak, dec);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    o.connect(g).connect(p).connect(bus); o.start(t); o.stop(t + dec + 0.1);
  }

  private pipeKnock() {
    const pan = Math.random() * 1.6 - 0.8;
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const d = i * (0.18 + Math.random() * 0.2);
      this.burst(this.amb, 140, 4, 0.5, 0.35, 'bandpass', d, pan);
      for (const f of [420, 977, 1630]) this.tone(this.amb, f * (0.98 + Math.random() * 0.04), 0.03, 0.9, 'sine', d, pan);
    }
  }
  private creak() {
    const ctx = this.ctx!; const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const f0 = 70 + Math.random() * 60;
    o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * (1.2 + Math.random() * 0.5), t + 0.9);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 6;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05, t + 0.2); g.gain.linearRampToValueAtTime(0.0001, t + 1.0);
    // stick-slip roughness
    const am = ctx.createOscillator(); am.frequency.value = 18 + Math.random() * 14; const amG = ctx.createGain(); amG.gain.value = 0.03;
    am.connect(amG).connect(g.gain);
    const p = ctx.createStereoPanner(); p.pan.value = Math.random() - 0.5;
    o.connect(bp).connect(g).connect(p).connect(this.amb); o.start(t); am.start(t); o.stop(t + 1.1); am.stop(t + 1.1);
  }
  private footsteps() {
    const pan = Math.random() < 0.5 ? -0.7 : 0.7;
    const steps = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < steps; i++) this.burst(this.amb, 160, 1.2, 0.14 * (1 - i / (steps * 1.5)), 0.12, 'lowpass', i * 0.62, pan);
  }
  private metal() {
    const pan = Math.random() * 1.4 - 0.7;
    this.burst(this.amb, 2400, 2, 0.08, 0.08, 'bandpass', 0, pan);
    for (const f of [523, 1187, 1913, 2711]) this.tone(this.amb, f * (0.97 + Math.random() * 0.06), 0.012, 2.2, 'sine', 0, pan);
  }
  private drip() {
    const pan = Math.random() * 1.2 - 0.6;
    this.tone(this.amb, 1400 + Math.random() * 600, 0.04, 0.12, 'sine', 0, pan, 1.8);
  }

  private startMusic() {
    // a slow, barely-there drone: two detuned low voices through a moving low-pass
    const ctx = this.ctx!;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300; lp.Q.value = 2;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.021; const lg = ctx.createGain(); lg.gain.value = 160;
    lfo.connect(lg).connect(lp.frequency); lfo.start();
    for (const [f, type] of [[55, 'sawtooth'], [55.4, 'sawtooth'], [82.4, 'triangle'], [65.4, 'sine']] as const) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = type === 'sawtooth' ? 0.05 : 0.08;
      o.connect(g).connect(lp); o.start();
    }
    lp.connect(this.music);
  }

  play(s: Sfx) {
    if (!this.ctx) return;
    const b = this.sfx;
    switch (s) {
      case 'pickup': this.burst(b, 2600, 0.8, 0.12, 0.05); this.tone(b, 620, 0.04, 0.04, 'triangle'); break;
      case 'place': // felt + wood knock: a body resonance plus a short click
        this.burst(b, 1900, 1.5, 0.35, 0.03); this.tone(b, 230, 0.35, 0.09, 'sine'); this.tone(b, 760, 0.12, 0.05, 'triangle'); break;
      case 'capture': this.burst(b, 1700, 1.2, 0.35, 0.04); this.tone(b, 210, 0.3, 0.1); this.burst(b, 1200, 1.4, 0.25, 0.04, 'bandpass', 0.09); this.tone(b, 300, 0.2, 0.08, 'sine', 0.09); break;
      case 'slide': this.burst(b, 1200, 0.5, 0.06, 0.25, 'bandpass'); break;
      case 'clock': this.burst(b, 3800, 3, 0.18, 0.02); this.tone(b, 1800, 0.05, 0.02, 'square'); break;
      case 'button': this.burst(b, 2400, 2, 0.08, 0.02); break;
      case 'select': this.tone(b, 520, 0.03, 0.05, 'triangle'); break;
      case 'check': this.tone(b, 98, 0.25, 1.2, 'sine'); this.tone(b, 146.8, 0.08, 1.0, 'triangle'); break;
      case 'gameover': this.tone(b, 61.7, 0.3, 4, 'sine'); this.tone(b, 92.5, 0.12, 3.5, 'triangle'); this.burst(b, 300, 0.7, 0.1, 3, 'lowpass'); break;
    }
  }

  dispose() {
    for (const t of this.timers) clearTimeout(t);
    this.ctx?.close();
  }
}
