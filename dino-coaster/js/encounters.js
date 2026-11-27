// Scripted dinosaur encounters along the ride
import * as THREE from 'three';
import { Dino, Ptero } from './creatures.js';
import { clamp, lerp, rng } from './noise.js';
import { LINEUP } from './world.js';

const smp = () => ({ p: new THREE.Vector3(), t: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3() });

function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Director {
  constructor({ scene, track, world, audio, fx, q, particles }) {
    this.scene = scene; this.track = track; this.world = world; this.audio = audio; this.fx = fx; this.q = q; this.particles = particles;
    this.actors = [];
    this.pteros = [];
    this.focus = null;
    this.tension = 0;
    this._s = smp();
    this._v = new THREE.Vector3();
    this._h = new THREE.Vector3();
    this.messages = [];
  }

  // ----- helpers -----
  dsTo(sAt, s) {
    const L = this.track.length;
    let d = ((sAt - s) % L + L) % L;
    if (d > L / 2) d -= L;
    return d;
  }
  // seconds until the cart (at s) reaches sAt, using the simulated speed profile
  eta(sAt, s) {
    const T = this.track;
    const d = this.dsTo(sAt, s);
    if (d < 0) return -1;
    let t = 0;
    const i0 = Math.floor(T.wrap(s) / T.ds), n = Math.ceil(d / T.ds);
    for (let k = 0; k < n; k++) t += T.ds / Math.max(0.5, T.V[(i0 + k) % T.n]);
    return t;
  }
  trackPoint(s, lat, out, onGround = true) {
    this.track.sample(s, this._s);
    out.copy(this._s.p).addScaledVector(this._s.r, lat);
    if (onGround) out.y = this.world.heightAt(out.x, out.z);
    return out;
  }
  ground(x, z) { return this.world.heightAt(x, z); }

  add(key, scale = 1, opts = {}) {
    const d = new Dino(key, opts);
    d.setScale(scale);
    this.scene.add(d.root);
    return d;
  }

  moveToward(d, target, maxSpeed, dt, turnRate = 2.5, accel = 8) {
    const dx = target.x - d.pos.x, dz = target.z - d.pos.z;
    const dist = Math.hypot(dx, dz);
    const want = Math.min(maxSpeed, dist * 1.5);
    d.speed += clamp(want - d.speed, -accel * dt * 2, accel * dt);
    if (dist > 0.05) {
      const hd = Math.atan2(dx, dz);
      d.heading = angleLerp(d.heading, hd, Math.min(1, turnRate * dt));
    }
    const step = Math.min(d.speed * dt, dist);
    d.pos.x += Math.sin(d.heading) * step;
    d.pos.z += Math.cos(d.heading) * step;
    d.pos.y = this.ground(d.pos.x, d.pos.z);
  }

  hit(strength, pos) {
    this.fx.shake = Math.max(this.fx.shake, strength);
    this.fx.flash = Math.max(this.fx.flash, Math.min(1, strength));
    try { if (navigator.vibrate) navigator.vibrate([60, 30, 120]); } catch (e) { /* ignore */ }
    if (pos) this.audio.thump(pos, 1.2 * strength);
  }

  // ----- build all encounters -----
  build() {
    const T = this.track, s = name => T.sOf(name);
    const q = this.q;
    const tmp = new THREE.Vector3();

    // 1) Brachiosaurus herd near the lake (seen from station/lift)
    const brachs = q.high ? [[70, 58, 1.0], [28, 40, 0.85], [92, 112, 1.1]] : [[70, 58, 1.0], [28, 40, 0.85]];
    for (const [x, z, sc] of brachs) {
      const d = this.add('brachio', sc);
      d.place(x, this.ground(x, z), z, Math.random() * 6);
      this.actors.push(this.grazer(d, new THREE.Vector3(x, 0, z), 14, 0.9, { bellow: true }));
    }

    // 2) herbivore herd ahead-left of the lift (seen from the crest)
    const herd = q.high
      ? [['trike', 185, -55, 1], ['trike2', 205, -75, 0.9], ['stego', 170, -92, 1.0], ['stego', 222, -40, 0.9], ['trike', 240, -95, 1.05]]
      : [['trike', 185, -55, 1], ['stego', 170, -92, 1.0], ['trike2', 222, -40, 0.9]];
    for (const [k, x, z, sc] of herd) {
      const d = this.add(k, sc);
      d.place(x, this.ground(x, z), z, Math.random() * 6);
      this.actors.push(this.grazer(d, new THREE.Vector3(x, 0, z), 10, 0.7, { graze: true }));
    }

    // 3) T-REX AMBUSH after the first drop
    {
      const sAt = s('rexValley') + 14;
      const d = this.add('rex', 1.0);
      this.actors.push(this.ambusher(d, sAt, 6.0, { roarAt: 120, chase: 6, chaseSpeed: 14, side: 1, name: 'T-REX' }));
    }

    // 4) SPINOSAURUS rising from the river at the splash
    {
      const sAt = (s('splash') + s('splash2')) / 2;
      const d = this.add('spino', 1.0);
      this.actors.push(this.riser(d, sAt, -6.5));
    }

    // 5) BRACHIOSAURUS face-to-face on lift 2
    {
      const sAt = s('brachio') + 6;
      this.trackPoint(sAt, 14, tmp);
      this.track.sample(sAt, this._s);
      const camY = this._s.p.y + 1.4;
      const bsc = clamp((camY + 4.5 - tmp.y) / 15.7, 1.0, 2.2);
      const d = this.add('brachio', bsc);
      d.place(tmp.x, tmp.y, tmp.z);
      this.track.sample(sAt, this._s);
      d.heading = Math.atan2(-this._s.r.x, -this._s.r.z) - 0.35;
      d.maxLook = 0.55;
      this.actors.push(this.watcher(d, sAt));
    }

    // 6) TRICERATOPS stampede across the plain
    {
      const sAt = s('trike') + 26;
      const d = this.add('trike', 1.1);
      this.actors.push(this.charger(d, sAt, 34));
      if (q.high) {
        const d2 = this.add('trike2', 0.95);
        this.actors.push(this.charger(d2, sAt + 12, 38, 0.6));
      }
      for (const [x, z] of [[-70, 252], [-40, 258]]) {
        const g = this.add('stego', 0.95);
        g.place(x, this.ground(x, z), z, 1);
        this.actors.push(this.grazer(g, new THREE.Vector3(x, 0, z), 8, 0.6, { graze: true }));
      }
    }

    // 7) RAPTOR pack through the forest
    {
      const sStart = s('raptor0') - 10, sEnd = s('tunnelIn') - 8;
      const cfg = [[-5, 4.6, 'raptor'], [3, -4.8, 'raptor2'], [-11, -6.0, 'raptor'], [-2, 6.2, 'raptor2']];
      const pack = cfg.slice(0, q.high ? 4 : 3).map(([off, lat, k], i) => {
        const d = this.add(k, 1.0);
        return this.chaser(d, sStart, sEnd, off, lat, i);
      });
      pack.forEach(a => this.actors.push(a));
      const lp = this.add('raptor', 1.05);
      this.actors.push(this.leaper(lp, s('raptor1') + 10));
    }

    // 8) CARNOTAURUS at the tunnel exit (launch!)
    {
      const sAt = s('tunnelOut') + 18;
      const d = this.add('carno', 1.0);
      this.actors.push(this.ambusher(d, sAt, -5.2, { roarAt: 60, chase: 4, chaseSpeed: 15, side: -1, name: 'CARNO' }));
    }

    // 9) FINAL T-REX over the track
    {
      const sAt = s('finalRex') + 2;
      const d = this.add('rex2', 1.25);
      this.actors.push(this.ambusher(d, sAt, 5.6, { roarAt: 110, chase: 5, chaseSpeed: 13, side: 1, big: true, name: 'REX' }));
    }

    // 10) Pteranodons
    const nP = q.high ? 7 : 4;
    for (let i = 0; i < nP; i++) {
      const p = new Ptero();
      p.root.scale.setScalar(1.2);
      this.scene.add(p.root);
      const c = [[110, 75, 60], [-60, 90, 120], [150, 110, -80]][i % 3];
      this.pteros.push({ p, c, r: 50 + i * 13, h: c[1] + (i % 3) * 12, w: (0.22 + i * 0.03) * (i % 2 ? 1 : -1), a: i * 1.3 });
    }
    // swooper on lift 1
    {
      const p = new Ptero();
      p.root.scale.setScalar(1.3);
      this.scene.add(p.root);
      this.swoop = { p, sAt: T.sOf('liftStart') + 70, done: false, t: -1 };
    }
    this.buildLineup();
  }

  clearVegetation() {
    this.world.clearAround(LINEUP.x, LINEUP.z + 6, 28);
    this.world.clearAround(LINEUP.x - 3, LINEUP.z + 40, 30);
    for (const a of this.actors) {
      const d = a.d, sc = d.scale || 1;
      this.world.clearAround(d.pos.x, d.pos.z, (d.spec.kind === 'quad' ? 9 : 7) * sc);
    }
  }

  // The five-dinosaur line-up from the reference picture (menu backdrop)
  buildLineup() {
    const C = LINEUP;
    this.lineupCenter = new THREE.Vector3(C.x, this.ground(C.x, C.z), C.z);
    const cast = [['raptor2', -10, 1.6, 0.45], ['trike', -4.8, 1.0, 0.35], ['rex', 1.6, 0.95, 0.12], ['brachio', 8.6, 0.6, -0.45]];
    this.lineup = [];
    for (const [k, dx, sc, hd] of cast) {
      const d = this.add(k, sc);
      const x = C.x + dx, z = C.z;
      d.place(x, this.ground(x, z), z, hd);
      const actor = {
        d, lineup: true,
        update: (dt, st) => {
          d.speed = 0;
          const target = this.menuCam || st.cam;
          d.look = target; d.lookW = Math.min(0.85, d.lookW + dt * 0.5);
          d.headDip = 0;
        },
      };
      this.actors.push(actor);
      this.lineup.push(d);
    }
    const p = new Ptero();
    p.root.scale.setScalar(1.7);
    this.scene.add(p.root);
    this.lineupPtero = { p, x: C.x + 12, z: C.z + 4, y: this.ground(C.x + 12, C.z) + 6.5, t: 0 };
  }

  // ----- behaviours -----
  grazer(d, anchor, radius, speed, opts = {}) {
    let t = Math.random() * 10;
    let callT = 6 + Math.random() * 10;
    const target = new THREE.Vector3();
    return {
      d,
      update: (dt, st) => {
        t += dt;
        const w = speed / radius;
        target.set(anchor.x + Math.cos(t * w) * radius, 0, anchor.z + Math.sin(t * w) * radius);
        const walk = Math.sin(t * 0.13) > -0.3;
        this.moveToward(d, target, walk ? speed : 0, dt, 0.8, 1);
        if (opts.graze) d.headDip = Math.sin(t * 0.4) > 0.2 ? 0.6 : 0;
        const dist = d.pos.distanceTo(st.cam);
        if (dist < 70) { d.look = st.cam; d.lookW = Math.max(0, d.lookW + dt * 0.5); d.lookW = Math.min(d.lookW, 0.7); }
        else d.lookW = Math.max(0, d.lookW - dt * 0.5);
        callT -= dt;
        if (callT < 0 && dist < 250) {
          callT = 10 + Math.random() * 14;
          const sp = d.spec;
          if (opts.bellow) { this.audio.bellow(d.headWorld(this._h), { pitch: sp.roarPitch, gain: 0.8 }); d.roar(3); }
          else if (Math.random() < 0.5) { this.audio.bellow(d.headWorld(this._h), { pitch: sp.roarPitch * 1.6, dur: 1.6, gain: 0.5 }); d.roar(1.6); }
        }
      },
    };
  }

  // stands beside the track, roars, lunges at the rider, then chases
  ambusher(d, sAt, lat, o) {
    const home = new THREE.Vector3();
    this.trackPoint(sAt, lat, home);
    const aim = new THREE.Vector3();
    this.trackPoint(sAt - 7, 0, aim);
    d.place(home.x, home.y, home.z, Math.atan2(aim.x - home.x, aim.z - home.z));
    const homeHeading = d.heading;
    let state = 'wait', roared = false, timer = 0, roar2 = false, stepPh = 0;
    const target = new THREE.Vector3();
    const sc = d.scale || 1;
    return {
      d,
      update: (dt, st) => {
        const ds = this.dsTo(sAt, st.s);
        if (state === 'wait') {
          d.speed = 0;
          if (ds < 160 && ds > -5) {
            d.look = st.cam; d.lookW = Math.min(1, d.lookW + dt * 0.8);
            this.focus = d.pos;
            this.tension = Math.max(this.tension, 1 - ds / 160);
          } else d.lookW = Math.max(0, d.lookW - dt * 0.3);
          if (!roared && ds < o.roarAt && ds > 0) {
            roared = true;
            d.roar(2.8);
            this.audio.roar(d.headWorld(this._h), { pitch: d.spec.roarPitch / Math.sqrt(sc), size: d.spec.roarSize * sc, dur: 2.8 });
            this.fx.shake = Math.max(this.fx.shake, 0.25);
            this.say(o.name === 'T-REX' ? '티라노사우루스다!!' : o.name === 'CARNO' ? '카르노타우루스가 기다리고 있다!' : '거대한 티라노가 길을 막았다!');
          }
          // lunge as the cart arrives
          if (ds < 26 && ds > -2) {
            const k = clamp(1 - ds / 26, 0, 1);
            d.jawTarget = 1;
            d.headDip = 0.25 * k;
            const toTrack = new THREE.Vector3();
            this.trackPoint(sAt, 0, toTrack);
            const dir = toTrack.sub(home).setY(0).normalize();
            d.pos.copy(home).addScaledVector(dir, 1.6 * k * sc);
            d.pos.y = this.ground(d.pos.x, d.pos.z);
            d.bodyPitch = 0.12 * k;
          }
          if (ds <= 0.8 && ds > -10) {
            // SNAP
            d.jawOpen *= 0.15;
            this.hit(o.big ? 1.1 : 0.85, st.cam);
            this.audio.roar(d.headWorld(this._h), { pitch: d.spec.roarPitch * 1.1 / Math.sqrt(sc), size: d.spec.roarSize * sc, dur: 2.0, gain: 1.2 });
            state = 'chase'; timer = 0; d.headDip = 0; d.bodyPitch = 0;
          }
        } else if (state === 'chase') {
          timer += dt;
          this.trackPoint(st.s - 9 * sc, o.side * (6 + 2 * sc), target);
          this.moveToward(d, target, o.chaseSpeed * sc, dt, 3.0, 9);
          d.look = st.cam; d.lookW = 1;
          d.jawTarget = 0.5 + 0.5 * Math.max(0, Math.sin(timer * 6));
          this.focus = d.pos;
          if (timer > o.chase || d.pos.distanceTo(st.cam) > 55) { state = 'stop'; timer = 0; }
        } else if (state === 'stop') {
          timer += dt;
          d.speed = Math.max(0, d.speed - dt * 10);
          d.pos.x += Math.sin(d.heading) * d.speed * dt;
          d.pos.z += Math.cos(d.heading) * d.speed * dt;
          d.pos.y = this.ground(d.pos.x, d.pos.z);
          d.look = st.cam; d.lookW = Math.max(0, 1 - timer * 0.1);
          if (!roar2 && timer > 0.8) {
            roar2 = true; d.roar(3);
            this.audio.roar(d.headWorld(this._h), { pitch: d.spec.roarPitch * 0.9, size: d.spec.roarSize * sc, dur: 3 });
          }
          if (timer > 6) { state = 'home'; timer = 0; }
        } else if (state === 'home') {
          // return to start (reset for the next lap), out of view
          if (Math.abs(ds) > 200) {
            d.place(home.x, home.y, home.z, homeHeading);
            d.speed = 0; state = 'wait'; roared = false; roar2 = false; d.lookW = 0;
          } else {
            this.moveToward(d, home, 4 * sc, dt, 1.5, 2);
          }
        }
        // footstep thumps
        if (d.speed > 1.5) {
          const ph = Math.floor(d.phase / Math.PI);
          if (ph !== stepPh) {
            stepPh = ph;
            const dist = d.pos.distanceTo(st.cam);
            if (dist < 60) { this.audio.thump(d.pos, 0.6 * sc); this.fx.shake = Math.max(this.fx.shake, 0.12 * (1 - dist / 60) * sc); }
          }
        }
      },
    };
  }

  riser(d, sAt, lat) {
    const home = new THREE.Vector3();
    this.trackPoint(sAt, lat, home, false);
    const aim = new THREE.Vector3();
    this.trackPoint(sAt - 10, 0, aim, false);
    const heading = Math.atan2(aim.x - home.x, aim.z - home.z);
    const yLow = -9, yUp = -1.9;
    d.place(home.x, yLow, home.z, heading);
    let state = 'hidden', t = 0, roared = false, splashed = false;
    return {
      d,
      update: (dt, st) => {
        const ds = this.dsTo(sAt, st.s);
        if (state === 'hidden') {
          d.pos.y = yLow;
          d.root.visible = false;
          if (ds < 95 && ds > 20) { state = 'rise'; t = 0; d.root.visible = true; }
        } else if (state === 'rise') {
          t += dt;
          const k = clamp(t / 1.3, 0, 1);
          d.pos.y = lerp(yLow, yUp, 1 - Math.pow(1 - k, 3));
          if (!splashed) { splashed = true; this.particles.burst(new THREE.Vector3(home.x, 0.2, home.z), 220, 'water', 9); this.audio.splash(0.9); }
          d.look = st.cam; d.lookW = Math.min(1, d.lookW + dt);
          this.focus = d.pos;
          this.tension = 1;
          if (!roared && t > 0.7) {
            roared = true; d.roar(2.4);
            this.audio.roar(d.headWorld(this._h), { pitch: d.spec.roarPitch, size: 1.3, dur: 2.4 });
            this.say('강에서 스피노사우루스가!!');
          }
          if (ds < 22) { d.jawTarget = 1; d.headDip = 0.3 * clamp(1 - ds / 22, 0, 1); }
          if (ds < 0.5) {
            d.jawOpen *= 0.15;
            this.hit(0.8, st.cam);
            this.particles.burst(st.cam.clone().add(new THREE.Vector3(0, -1, 0)), 160, 'water', 6);
            this.audio.splash(1.2);
            state = 'after'; t = 0;
          }
        } else if (state === 'after') {
          t += dt;
          d.look = st.cam; d.lookW = Math.max(0, 1 - t * 0.2);
          d.headDip = 0;
          if (t > 1.0 && t < 1.05) this.audio.roar(d.headWorld(this._h), { pitch: d.spec.roarPitch * 0.95, size: 1.3, dur: 2.5 }), d.roar(2.5);
          if (Math.abs(ds) > 150) { state = 'sink'; t = 0; }
        } else if (state === 'sink') {
          t += dt;
          d.pos.y = lerp(yUp, yLow, clamp(t / 3, 0, 1));
          if (t > 3) { state = 'hidden'; roared = false; splashed = false; }
        }
      },
    };
  }

  watcher(d, sAt) {
    let called = false, t = 0;
    return {
      d,
      update: (dt, st) => {
        t += dt;
        const ds = this.dsTo(sAt, st.s);
        const near = ds < 70 && ds > -40;
        if (near) {
          d.look = st.cam; d.lookW = Math.min(d.maxLook || 1, d.lookW + dt * 0.5);
          this.focus = d.pos;
          if (!called && ds < 30) {
            called = true; d.roar(3.5);
            this.audio.bellow(d.headWorld(this._h), { pitch: 0.42, dur: 3.5, gain: 1.0 });
            this.say('브라키오사우루스가 인사한다');
          }
        } else {
          d.lookW = Math.max(0, d.lookW - dt * 0.3);
          if (Math.abs(ds) > 200) called = false;
        }
        d.speed = 0;
      },
    };
  }

  charger(d, sAt, lat, delay = 0) {
    const A = new THREE.Vector3(), B = new THREE.Vector3();
    this.trackPoint(sAt, lat, A);
    this.trackPoint(sAt, -lat, B);
    d.place(A.x, A.y, A.z, Math.atan2(B.x - A.x, B.z - A.z));
    let state = 'wait', t = 0, bellowed = false, stepPh = 0;
    return {
      d,
      update: (dt, st) => {
        const ds = this.dsTo(sAt, st.s);
        if (state === 'wait') {
          d.speed = 0;
          d.headDip = 0.3;
          if (ds < 200 && ds > 0 && this.eta(sAt, st.s) < lat / (11.5 * (d.scale || 1)) + 1.3 + delay) { state = 'run'; t = 0; }
        } else if (state === 'run') {
          t += dt;
          d.headDip = 0.35; // horns down
          this.moveToward(d, B, 11.5 * (d.scale || 1), dt, 1.2, 7);
          this.focus = d.pos;
          if (!bellowed && t > 0.2) { bellowed = true; this.audio.bellow(d.headWorld(this._h), { pitch: 1.3, dur: 1.5, gain: 1.0 }); this.say('트리케라톱스 돌진!'); d.roar(1.5); }
          if (d.pos.distanceTo(B) < 2) { state = 'done'; t = 0; }
          const ph = Math.floor(d.phase / Math.PI);
          if (ph !== stepPh) { stepPh = ph; const dist = d.pos.distanceTo(st.cam); if (dist < 50) { this.audio.thump(d.pos, 0.5); this.fx.shake = Math.max(this.fx.shake, 0.15 * (1 - dist / 50)); } }
          this.particles.emitDust(d.pos, dt);
        } else if (state === 'done') {
          d.speed = Math.max(0, d.speed - dt * 6);
          d.pos.x += Math.sin(d.heading) * d.speed * dt;
          d.pos.z += Math.cos(d.heading) * d.speed * dt;
          d.pos.y = this.ground(d.pos.x, d.pos.z);
          if (Math.abs(ds) > 200) { d.place(A.x, A.y, A.z, Math.atan2(B.x - A.x, B.z - A.z)); state = 'wait'; bellowed = false; }
        }
      },
    };
  }

  chaser(d, sStart, sEnd, off, lat, i) {
    const hide = new THREE.Vector3();
    this.trackPoint(sStart + 6, lat * 3.2, hide);
    d.place(hide.x, hide.y, hide.z, 0);
    let state = 'hide', t = 0, screechT = 1 + i * 0.7;
    const target = new THREE.Vector3();
    const wob = Math.random() * 6;
    return {
      d,
      update: (dt, st) => {
        const ds0 = this.dsTo(sStart, st.s);
        const dsE = this.dsTo(sEnd, st.s);
        if (state === 'hide') {
          d.speed = 0;
          d.look = st.cam; d.lookW = ds0 < 60 ? 1 : 0;
          if (ds0 < 4 + i * 2 && ds0 > -40) { state = 'run'; t = 0; }
        } else if (state === 'run') {
          t += dt;
          const sT = st.s + off + Math.sin(t * 0.8 + wob) * 2.5;
          this.trackPoint(sT, lat + Math.sin(t * 1.3 + wob) * 0.8, target);
          this.moveToward(d, target, 16, dt, 5, 14);
          d.look = st.cam; d.lookW = 1;
          d.jawTarget = Math.max(0, Math.sin(t * 3 + wob)) * 0.8;
          this.focus = d.pos;
          this.tension = 1;
          screechT -= dt;
          if (screechT < 0) {
            screechT = 1.8 + Math.random() * 2.5;
            d.jawTarget = 1;
            this.audio.screech(d.headWorld(this._h), { pitch: 0.85 + Math.random() * 0.4 });
          }
          if (i === 0 && t < 0.1) this.say('랩터 무리가 쫓아온다!');
          if (dsE < 0) { state = 'stop'; t = 0; }
        } else if (state === 'stop') {
          t += dt;
          d.speed = Math.max(0, d.speed - dt * 12);
          d.pos.x += Math.sin(d.heading) * d.speed * dt;
          d.pos.z += Math.cos(d.heading) * d.speed * dt;
          d.pos.y = this.ground(d.pos.x, d.pos.z);
          if (t > 0.5 && t < 0.55 && i % 2 === 0) this.audio.screech(d.headWorld(this._h), { pitch: 0.8 });
          if (Math.abs(ds0) > 260) { d.place(hide.x, hide.y, hide.z, 0); state = 'hide'; }
        }
      },
    };
  }

  leaper(d, sAt) {
    const start = new THREE.Vector3();
    this.trackPoint(sAt + 14, 9, start);
    d.place(start.x, start.y, start.z, 0);
    let state = 'wait', t = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    return {
      d,
      update: (dt, st) => {
        const ds = this.dsTo(sAt, st.s);
        if (state === 'wait') {
          d.look = st.cam; d.lookW = 1;
          if (ds < 16 && ds > 0) {
            state = 'jump'; t = 0;
            this.audio.screech(d.headWorld(this._h), { pitch: 1.2, gain: 1 });
          }
        } else if (state === 'jump') {
          t += dt;
          const k = clamp(t / 1.0, 0, 1);
          const sJ = sAt + 5;
          this.trackPoint(sJ, 7.5, a);
          this.trackPoint(sJ, -7.5, b);
          d.pos.lerpVectors(a, b, k);
          const gy = lerp(a.y, b.y, k);
          this.track.sample(sJ, this._s);
          const peak = Math.max(this._s.p.y + 1.6, gy) + 1.2;
          d.pos.y = lerp(gy, peak, Math.sin(Math.PI * k)) - (1 - Math.sin(Math.PI * k)) * 0;
          d.heading = Math.atan2(b.x - a.x, b.z - a.z);
          d.speed = 3; // legs tucked-ish
          d.jawTarget = 1;
          d.look = st.cam; d.lookW = 1;
          this.focus = d.pos;
          if (k > 0.45 && k < 0.5) this.fx.shake = Math.max(this.fx.shake, 0.4);
          if (k >= 1) { state = 'land'; t = 0; this.particles.burst(d.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), 50, 'dust', 3); }
        } else if (state === 'land') {
          t += dt;
          const target = this._v;
          this.trackPoint(st.s - 4, -6, target);
          this.moveToward(d, target, 14, dt, 4, 12);
          d.look = st.cam; d.lookW = 1;
          if (t > 4) state = 'idle';
        } else if (state === 'idle') {
          d.speed = Math.max(0, d.speed - dt * 10);
          if (Math.abs(ds) > 260) { d.place(start.x, start.y, start.z, 0); state = 'wait'; }
        }
      },
    };
  }

  say(text) {
    const now = performance.now();
    if (this._lastMsg === text && now - this._lastMsgT < 4000) return;
    this._lastMsg = text; this._lastMsgT = now;
    this.messages.push(text);
  }

  update(dt, st) {
    this.focus = null;
    this.tension = Math.max(0, this.tension - dt * 0.3);
    for (const a of this.actors) {
      const d = a.d;
      a.update(dt, st);
      const near = d.pos.distanceTo(st.cam) < 420;
      if (d.key === 'spino') { if (!near) d.root.visible = false; }
      else d.root.visible = near;
      if (d.root.visible) d.update(dt);
    }
    if (this.lineupPtero) {
      const L = this.lineupPtero; L.t += dt;
      L.p.root.position.set(L.x, L.y + Math.sin(L.t * 1.6) * 0.5, L.z);
      L.p.root.rotation.set(-0.55, -0.3, Math.sin(L.t * 0.8) * 0.05);
      L.p.update(dt, 0.7);
    }
    // pteranodons
    for (const P of this.pteros) {
      P.a += P.w * dt;
      const x = P.c[0] + Math.cos(P.a) * P.r, z = P.c[2] + Math.sin(P.a) * P.r;
      const y = P.h + Math.sin(P.a * 2.3) * 6;
      P.p.root.position.set(x, y, z);
      const dx = -Math.sin(P.a) * Math.sign(P.w), dz = Math.cos(P.a) * Math.sign(P.w);
      P.p.root.rotation.set(0, Math.atan2(dx, dz), -Math.sign(P.w) * 0.35);
      P.p.update(dt, 0.5 + 0.5 * Math.max(0, Math.sin(P.a * 3)));
    }
    const sw = this.swoop;
    if (sw) {
      const ds = this.dsTo(sw.sAt, st.s);
      if (sw.t < 0 && ds < 1 && ds > -2) { sw.t = 0; this.audio.screech(st.cam, { pitch: 1.6, gain: 0.6 }); }
      if (sw.t >= 0) {
        sw.t += dt;
        const k = sw.t / 4.0;
        const f = st.fwd;
        // fly from far ahead/up, skim over the rider, exit behind
        const dist = lerp(90, -40, k);
        sw.p.root.position.copy(st.cam).addScaledVector(f, dist).add(new THREE.Vector3(Math.sin(k * 3) * 4, 2.2 + Math.abs(dist) * 0.18, 0));
        sw.p.root.lookAt(st.cam.clone().addScaledVector(f, dist - 20).setY(sw.p.root.position.y - 1));
        sw.p.update(dt, 1);
        sw.p.root.visible = true;
        if (k > 0.66 && !sw.hit) { sw.hit = true; this.fx.shake = Math.max(this.fx.shake, 0.3); this.say('프테라노돈!'); }
        if (k > 1) { sw.t = -1; sw.hit = false; sw.p.root.visible = false; }
      } else sw.p.root.visible = false;
    }
  }
}
