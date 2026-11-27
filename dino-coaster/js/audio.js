// Fully synthesized 3D audio (WebAudio, no sample files)
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.clackDist = 0;
    this.chainDist = 0;
    this.birdT = 2;
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    // master chain
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.25;
    this.master.connect(comp); comp.connect(ctx.destination);
    // noise buffers
    const len = ctx.sampleRate * 2;
    this.white = ctx.createBuffer(1, len, ctx.sampleRate);
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = this.white.getChannelData(0), b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      w[i] = Math.random() * 2 - 1;
      last = (last + 0.02 * w[i]) / 1.02;
      b[i] = last * 3.5;
    }
    // distortion curve
    const n = 1024; this.curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i / n * 2 - 1; this.curve[i] = Math.tanh(x * 3.2); }

    // wind
    this.wind = this._loop(this.white);
    this.windBP = ctx.createBiquadFilter(); this.windBP.type = 'bandpass'; this.windBP.Q.value = 0.6; this.windBP.frequency.value = 500;
    this.windG = ctx.createGain(); this.windG.gain.value = 0;
    this.wind.connect(this.windBP); this.windBP.connect(this.windG); this.windG.connect(this.master);
    // rail rumble
    this.rumble = this._loop(this.brown);
    this.rumbleLP = ctx.createBiquadFilter(); this.rumbleLP.type = 'lowpass'; this.rumbleLP.frequency.value = 140;
    this.rumbleG = ctx.createGain(); this.rumbleG.gain.value = 0;
    this.rumble.connect(this.rumbleLP); this.rumbleLP.connect(this.rumbleG); this.rumbleG.connect(this.master);
    // jungle insects
    this.insect = this._loop(this.white);
    const ibp = ctx.createBiquadFilter(); ibp.type = 'bandpass'; ibp.frequency.value = 5200; ibp.Q.value = 8;
    this.insectG = ctx.createGain(); this.insectG.gain.value = 0.025;
    const trem = ctx.createOscillator(); trem.frequency.value = 23;
    const tremG = ctx.createGain(); tremG.gain.value = 0.02;
    trem.connect(tremG); tremG.connect(this.insectG.gain); trem.start();
    this.insect.connect(ibp); ibp.connect(this.insectG); this.insectG.connect(this.master);
    // low ominous drone
    this.drone = ctx.createOscillator(); this.drone.type = 'sawtooth'; this.drone.frequency.value = 43;
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 120;
    this.droneG = ctx.createGain(); this.droneG.gain.value = 0;
    this.drone.connect(dlp); dlp.connect(this.droneG); this.droneG.connect(this.master);
    this.drone.start();
  }

  _loop(buf) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf; s.loop = true;
    s.loopStart = Math.random(); s.start(0, Math.random() * 1.5);
    return s;
  }

  setMuted(m) {
    this.enabled = !m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  panner(pos, ref = 10) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref; p.maxDistance = 2000; p.rolloffFactor = 1.1;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, pos.y, pos.z);
    p.connect(this.master);
    return p;
  }

  updateListener(cam) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    const e = cam.matrixWorld.elements;
    const px = e[12], py = e[13], pz = e[14];
    const fx = -e[8], fy = -e[9], fz = -e[10];
    const ux = e[4], uy = e[5], uz = e[6];
    if (L.positionX) {
      const t = this.ctx.currentTime;
      L.positionX.setValueAtTime(px, t); L.positionY.setValueAtTime(py, t); L.positionZ.setValueAtTime(pz, t);
      L.forwardX.setValueAtTime(fx, t); L.forwardY.setValueAtTime(fy, t); L.forwardZ.setValueAtTime(fz, t);
      L.upX.setValueAtTime(ux, t); L.upY.setValueAtTime(uy, t); L.upZ.setValueAtTime(uz, t);
    } else {
      L.setPosition(px, py, pz);
      L.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  // big theropod roar
  roar(pos, { pitch = 1, dur = 2.6, gain = 1.0, size = 1 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const out = ctx.createGain(); out.gain.value = 0;
    out.connect(this.panner(pos, 14 * size));
    const mix = ctx.createGain();
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    const f0 = 85 * pitch;
    osc.frequency.setValueAtTime(f0 * 0.8, t0);
    osc.frequency.linearRampToValueAtTime(f0 * 1.45, t0 + dur * 0.18);
    osc.frequency.linearRampToValueAtTime(f0 * 1.1, t0 + dur * 0.6);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.55, t0 + dur);
    const osc2 = ctx.createOscillator(); osc2.type = 'square';
    osc2.frequency.setValueAtTime(f0 * 0.503, t0);
    osc2.frequency.linearRampToValueAtTime(f0 * 0.71, t0 + dur * 0.2);
    osc2.frequency.exponentialRampToValueAtTime(f0 * 0.3, t0 + dur);
    const vib = ctx.createOscillator(); vib.frequency.value = 17 + Math.random() * 8;
    const vibG = ctx.createGain(); vibG.gain.value = f0 * 0.18;
    vib.connect(vibG); vibG.connect(osc.frequency); vibG.connect(osc2.frequency);
    const og = ctx.createGain(); og.gain.value = 0.55;
    osc.connect(og); og.connect(mix);
    const og2 = ctx.createGain(); og2.gain.value = 0.35;
    osc2.connect(og2); og2.connect(mix);
    const nz = ctx.createBufferSource(); nz.buffer = this.white; nz.loop = true;
    const ng = ctx.createGain(); ng.gain.value = 0.8;
    nz.connect(ng); ng.connect(mix);
    // amplitude growl
    const am = ctx.createGain(); am.gain.value = 0.75;
    const amo = ctx.createOscillator(); amo.frequency.value = 9 + Math.random() * 5;
    const amg = ctx.createGain(); amg.gain.value = 0.25;
    amo.connect(amg); amg.connect(am.gain);
    const sh = ctx.createWaveShaper(); sh.curve = this.curve;
    mix.connect(sh); sh.connect(am);
    // formants
    const forms = [[300, 2.5, 1.0], [720, 4, 0.7], [1500, 5, 0.35], [2900, 6, 0.12]];
    for (const [f, q, g] of forms) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * Math.sqrt(pitch); bp.Q.value = q;
      bp.frequency.setValueAtTime(f * Math.sqrt(pitch) * 0.8, t0);
      bp.frequency.linearRampToValueAtTime(f * Math.sqrt(pitch) * 1.15, t0 + dur * 0.25);
      bp.frequency.linearRampToValueAtTime(f * Math.sqrt(pitch) * 0.85, t0 + dur);
      const gg = ctx.createGain(); gg.gain.value = g;
      am.connect(bp); bp.connect(gg); gg.connect(out);
    }
    // sub thump (not spatial, felt)
    const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.setValueAtTime(48 * pitch, t0); sub.frequency.exponentialRampToValueAtTime(28, t0 + dur);
    const subG = ctx.createGain(); subG.gain.value = 0;
    sub.connect(subG); subG.connect(this.master);
    const dist = 1;
    subG.gain.linearRampToValueAtTime(0.5 * gain * size * dist, t0 + 0.2);
    subG.gain.linearRampToValueAtTime(0, t0 + dur);
    // envelope
    out.gain.linearRampToValueAtTime(1.6 * gain, t0 + 0.18);
    out.gain.linearRampToValueAtTime(1.25 * gain, t0 + dur * 0.55);
    out.gain.linearRampToValueAtTime(0.0, t0 + dur);
    const nodes = [osc, osc2, vib, nz, amo, sub];
    nodes.forEach(nn => { nn.start(t0); nn.stop(t0 + dur + 0.1); });
  }

  screech(pos, { pitch = 1, gain = 0.8 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime, dur = 0.9 + Math.random() * 0.3;
    const out = ctx.createGain(); out.gain.value = 0;
    out.connect(this.panner(pos, 6));
    const osc = ctx.createOscillator(); osc.type = 'sawtooth';
    const f = 620 * pitch;
    osc.frequency.setValueAtTime(f, t0);
    osc.frequency.linearRampToValueAtTime(f * 1.7, t0 + 0.15);
    osc.frequency.linearRampToValueAtTime(f * 1.3, t0 + 0.5);
    osc.frequency.exponentialRampToValueAtTime(f * 0.7, t0 + dur);
    const vib = ctx.createOscillator(); vib.frequency.value = 34;
    const vg = ctx.createGain(); vg.gain.value = f * 0.12;
    vib.connect(vg); vg.connect(osc.frequency);
    const nz = ctx.createBufferSource(); nz.buffer = this.white; nz.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
    const ng = ctx.createGain(); ng.gain.value = 0.35;
    nz.connect(hp); hp.connect(ng);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1700 * pitch; bp.Q.value = 3;
    const sh = ctx.createWaveShaper(); sh.curve = this.curve;
    osc.connect(sh); sh.connect(bp); ng.connect(bp);
    const bp2 = ctx.createBiquadFilter(); bp2.type = 'bandpass'; bp2.frequency.value = 3300 * pitch; bp2.Q.value = 5;
    sh.connect(bp2);
    bp.connect(out); bp2.connect(out);
    out.gain.linearRampToValueAtTime(gain, t0 + 0.05);
    out.gain.linearRampToValueAtTime(gain * 0.6, t0 + dur * 0.6);
    out.gain.linearRampToValueAtTime(0, t0 + dur);
    [osc, vib, nz].forEach(nn => { nn.start(t0); nn.stop(t0 + dur + 0.05); });
  }

  // gentle low call (sauropod / herbivores)
  bellow(pos, { pitch = 1, dur = 3, gain = 0.7 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const out = ctx.createGain(); out.gain.value = 0;
    out.connect(this.panner(pos, 30));
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(55 * pitch, t0);
    o.frequency.linearRampToValueAtTime(75 * pitch, t0 + dur * 0.4);
    o.frequency.linearRampToValueAtTime(50 * pitch, t0 + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400; lp.Q.value = 6;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 220; bp.Q.value = 3;
    o.connect(lp); lp.connect(out); o.connect(bp); bp.connect(out);
    out.gain.linearRampToValueAtTime(gain, t0 + dur * 0.3);
    out.gain.linearRampToValueAtTime(0, t0 + dur);
    o.start(t0); o.stop(t0 + dur + 0.1);
  }

  thump(pos, strength = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(70, t0); o.frequency.exponentialRampToValueAtTime(30, t0 + 0.25);
    const g = ctx.createGain(); g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.9 * strength, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
    o.connect(g); g.connect(this.panner(pos, 12));
    o.start(t0); o.stop(t0 + 0.4);
  }

  splash(gain = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const nz = ctx.createBufferSource(); nz.buffer = this.white;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5000, t0); lp.frequency.exponentialRampToValueAtTime(400, t0 + 1.4);
    const g = ctx.createGain(); g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.9 * gain, t0 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 1.6);
    nz.connect(lp); lp.connect(g); g.connect(this.master);
    nz.start(t0); nz.stop(t0 + 1.7);
  }

  click(gain = 0.25, freq = 2500) {
    const ctx = this.ctx, t0 = ctx.currentTime;
    const nz = ctx.createBufferSource(); nz.buffer = this.white;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 2;
    const g = ctx.createGain(); g.gain.value = gain;
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
    nz.connect(bp); bp.connect(g); g.connect(this.master);
    nz.start(t0, Math.random()); nz.stop(t0 + 0.06);
  }

  bird() {
    const ctx = this.ctx, t0 = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    const f = 1800 + Math.random() * 1800;
    const n = 1 + Math.floor(Math.random() * 3);
    const g = ctx.createGain(); g.gain.value = 0;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * 0.16;
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * (1.3 + Math.random() * 0.4), t + 0.08);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 0.02);
      g.gain.linearRampToValueAtTime(0, t + 0.12);
    }
    o.connect(g);
    if (pan) { pan.pan.value = Math.random() * 2 - 1; g.connect(pan); pan.connect(this.master); } else g.connect(this.master);
    o.start(t0); o.stop(t0 + n * 0.16 + 0.1);
  }

  update(dt, st) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = st.speed;
    const vn = Math.min(1, v / 30);
    this.windG.gain.setTargetAtTime(0.03 + vn * vn * 0.55, t, 0.1);
    this.windBP.frequency.setTargetAtTime(300 + v * 45, t, 0.1);
    this.rumbleG.gain.setTargetAtTime(v > 0.5 ? 0.12 + vn * 0.55 : 0, t, 0.1);
    this.rumbleLP.frequency.setTargetAtTime(90 + v * 6, t, 0.1);
    this.insectG.gain.setTargetAtTime(st.inTunnel ? 0.0 : 0.025, t, 0.3);
    this.droneG.gain.setTargetAtTime(st.tension * 0.12, t, 0.5);
    // rail joints
    this.clackDist += v * dt;
    if (this.clackDist > 3.2) { this.clackDist = 0; if (v > 1) this.click(0.05 + vn * 0.12, 900); }
    if (st.onLift) {
      this.chainDist += v * dt;
      if (this.chainDist > 0.55) { this.chainDist = 0; this.click(0.32, 1900); }
    }
    this.birdT -= dt;
    if (this.birdT < 0 && !st.inTunnel) { this.birdT = 1 + Math.random() * 4; this.bird(); }
  }
}
