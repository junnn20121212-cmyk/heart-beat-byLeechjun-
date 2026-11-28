// Scripted dinosaur encounters along the ride
import * as THREE from 'three';
import { Dino, Ptero } from './creatures.js';
import { clamp, lerp, rng } from './noise.js';
import { LINEUP } from './world.js';
import { makeSmokeTexture } from './textures.js';

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
    // big dust plumes kicked up by running herds (visible from far away)
    this.plumes = [];
    const tex = makeSmokeTexture();
    for (let i = 0; i < 48; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0x9a8466, transparent: true, opacity: 0, depthWrite: false }));
      sp.visible = false; scene.add(sp);
      this.plumes.push({ sp, life: 0 });
    }
    this.plumeI = 0;
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
    const d = new Dino(key, { ...(this.q.high ? { along: 96, around: 28 } : {}), ...opts });
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
    // the stretch where the track skims the river (ground under the rails is below water level)
    {
      let w0 = -1, w1 = -1;
      for (let sc = s('dropBottom'); sc < s('lift2Start'); sc += 1) {
        this.trackPoint(sc, 0, tmp);
        if (this.ground(tmp.x, tmp.z) < -0.4) { if (w0 < 0) w0 = sc; w1 = sc; }
      }
      this.waterSpan = w0 > 0 ? [w0, w1] : [s('splash'), s('splash2')];
    }

    // 1) Brachiosaurus herd near the lake (seen from station/lift)
    const brachs = q.high ? [[70, 58, 1.0], [28, 40, 0.85], [92, 112, 1.1]] : [[70, 58, 1.0], [28, 40, 0.85]];
    brachs.forEach(([x, z, sc], i) => {
      const d = this.add('brachio', sc);
      d.place(x, this.ground(x, z), z, Math.random() * 6);
      if (i === 0) this.actors.push(this.drinker(d, new THREE.Vector3(45, 0, 92)));
      else this.actors.push(this.grazer(d, new THREE.Vector3(x, 0, z), 14, 0.9, { bellow: true }));
    });

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
      const sAt = this.world.underRange ? this.world.underRange[1] + 10 : this.waterSpan[1] - 4; // strikes as the cart surfaces
      const d = this.add('spino', 1.0);
      this.actors.push(this.riser(d, sAt, -6.5));
    }

    // 5) BRACHIOSAURUS face-to-face on lift 2
    {
      const sAt = s('brachio') + 6;
      this.trackPoint(sAt, -14, tmp);
      this.track.sample(sAt, this._s);
      const camY = this._s.p.y + 1.4;
      const bsc = clamp((camY + 4.5 - tmp.y) / 15.7, 1.0, 2.2);
      const d = this.add('brachio', bsc);
      d.place(tmp.x, tmp.y, tmp.z);
      this.track.sample(sAt, this._s);
      d.heading = Math.atan2(this._s.r.x, this._s.r.z) + 0.35;
      d.maxLook = 0.55;
      this.actors.push(this.watcher(d, sAt));
    }

    // 6) TRICERATOPS stampede across the plain
    {
      // a whole herd thunders in from ~110 m away, crossing the track just ahead of the cart
      const sAt = s('trike') + 26;
      // every member crosses where the rails are low (~2 m), so they can bound over them
      const herd = [['trike', 1.1, 0, 0], ['trike2', 0.95, 9, -5], ['trike', 1.0, -6, 4], ['trike2', 0.7, 5, 7], ['trike', 1.05, 12, -3]];
      herd.slice(0, q.high ? 5 : 3).forEach(([k, sc, ds, dl], i) => {
        const d = this.add(k, sc);
        this.actors.push(this.charger(d, sAt + ds, -110 + dl, 42 + dl, i === 0));
      });
      for (const [x, z] of [[-70, 252], [-40, 258]]) {
        const g = this.add('stego', 0.95);
        g.place(x, this.ground(x, z), z, 1);
        this.actors.push(this.grazer(g, new THREE.Vector3(x, 0, z), 8, 0.6, { graze: true }));
      }
    }

    // 7) RAPTOR pack through the forest
    {
      const sStart = s('raptor0') - 8, sEnd = s('tunnelIn') - 3;
      // build-up: unseen calls circling in the forest while you corkscrew down the helix
      this.stalk = { s0: s('helix0') + 50, s1: s('raptor0') - 6, next: 0, said: false };
      // the pack runs right beside the cart and takes turns lunging in
      const cfg = [[-3, 3.4, 'raptor'], [2, -3.6, 'raptor2'], [-8, -4.6, 'raptor'], [0, 4.4, 'raptor2'], [-13, 3.0, 'raptor']];
      cfg.slice(0, q.high ? 5 : 3).forEach(([off, lat, k], i) => this.actors.push(this.chaser(this.add(k, 1.0), sStart, sEnd, off, lat, i)));
      // one leaps onto the front of the cart; the airtime hill throws it off
      this.actors.push(this.boarder(this.add('raptor', 1.0), s('raptorBoard') - 12, s('hop2')));
      // one jumps straight over your head after the barrel roll
      this.actors.push(this.leaper(this.add('raptor2', 1.05), s('raptor1') + 44));
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
    this.buildNature();
    this.buildNewcomers();
    this.buildHerds();
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

  // ---------- nature: feeding, hunting, drinking, fishing, grazing ----------
  openSpot(sAt, lat, minTrack = 22) {
    const p = new THREE.Vector3();
    for (const k of [1, 1.25, 1.5, -1, -1.25, -1.5]) {
      this.trackPoint(sAt, lat * k, p);
      if (!this.track.nearestXZ(p.x, p.z, minTrack) && p.y > 1.5) return p.clone();
    }
    return p.clone();
  }

  carcass(key, pos, heading, sc = 1) {
    const d = this.add(key, sc);
    d.place(pos.x, pos.y, pos.z, heading);
    d.jawTarget = 0.7; d.update(0.3); d.update(0.3);
    d.root.rotation.set(0, heading, Math.PI / 2 * 0.92);
    d.root.position.set(pos.x, pos.y + 0.85 * sc, pos.z);
    d.root.updateMatrixWorld(true);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(2.4 * sc, 24).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x2a0905, roughness: 0.55, envMapIntensity: 0.3, transparent: true, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }));
    pool.position.set(pos.x - Math.cos(heading) * 1.5 * sc, pos.y + 0.06, pos.z + Math.sin(heading) * 1.5 * sc);
    pool.scale.set(1.3, 1, 0.8);
    this.scene.add(pool);
    this.world.clearAround(pos.x, pos.z, 12 * sc);
    return d;
  }

  buildNature() {
    const T = this.track, s = n => T.sOf(n), q = this.q;
    // 1) T-Rex feeding on a triceratops, seen from the top of the first drop
    {
      const food = this.openSpot(s('dropBottom') + 12, -34, 20);
      this.feedSpot = food;
      this.carcass('trike2', food, 0.8, 1.0);
      const d = this.add('rex', 1.0);
      const hx = food.x + Math.sin(0.8 + 1.9) * 5.0, hz = food.z + Math.cos(0.8 + 1.9) * 5.0;
      d.place(hx, this.ground(hx, hz), hz, Math.atan2(food.x - hx, food.z - hz));
      this.actors.push(this.feeder(d, food, { roar: true, msg: '티라노가 먹이를 뜯고 있다…', bodyPitch: 0.3 }));
      for (let i = 0; i < (q.high ? 4 : 2); i++) {
        const c = this.add('compy', 0.32);
        c.place(food.x + 6, food.y, food.z, 0);
        this.actors.push(this.scavenger(c, food, i));
      }
    }
    // 2) raptors squabbling over a kill in the forest
    {
      const food = this.openSpot(s('raptor1') + 20, 26, 16);
      this.carcass('parasaur', food, 2.2, 0.9);
      [['raptor', 0.9, 2.2], ['raptor2', 0.85, -1.5]].forEach(([k, sc, a]) => {
        const d = this.add(k, sc);
        const x = food.x + Math.sin(a) * 3.2, z = food.z + Math.cos(a) * 3.2;
        d.place(x, this.ground(x, z), z, Math.atan2(food.x - x, food.z - z));
        this.actors.push(this.feeder(d, food, { screech: true, bodyPitch: 0.35, fast: true }));
      });
    }
    // 3) a Carnotaurus hunting a fleeing parasaurolophus herd, looping across a meadow
    {
      const R = 30;
      const cands = [[s('lift2Top'), 80], [s('hill'), 85], [s('trike') - 30, 70], [s('rexValley') + 40, -80], [s('splash'), 85]];
      let center = null;
      for (const [sc, lat] of cands) {
        for (const k of [1, -1]) {
          const c = new THREE.Vector3();
          this.trackPoint(sc, lat * k, c);
          let ok = c.y > 1.5;
          for (let a = 0; a < 6.28 && ok; a += 0.4) {
            const x = c.x + Math.cos(a) * R, z = c.z + Math.sin(a) * R;
            if (this.ground(x, z) < 1.2 || this.track.nearestXZ(x, z, 14) || Math.abs(this.ground(x, z) - c.y) > 9) ok = false;
          }
          if (ok) { center = c; break; }
        }
        if (center) break;
      }
      if (center) {
        for (let a = 0; a < 6.28; a += 0.15) this.world.clearAround(center.x + Math.cos(a) * R, center.z + Math.sin(a) * R, 6);
        const prey = [];
        for (let i = 0; i < (q.high ? 4 : 3); i++) prey.push(this.add('parasaur', 0.85 + (i % 2) * 0.1));
        const pred = this.add('carno', 1.0);
        this.huntLoop(center, R, prey, pred);
        this.huntCenter = center;
      }
    }
    // 4) parasaurolophus herd grazing by the river
    for (const [x, z, sc] of (q.high ? [[205, 160, 0.95], [214, 150, 1.0], [196, 150, 0.7]] : [[205, 160, 0.95], [214, 150, 1.0]])) {
      const d = this.add('parasaur', sc);
      d.place(x, this.ground(x, z), z, Math.random() * 6);
      this.actors.push(this.grazer(d, new THREE.Vector3(x, 0, z), 7, 0.7, { graze: true }));
    }
    // 5) armoured ankylosaurs on the northern plain
    if (q.high) for (const [x, z] of [[-100, 252], [-8, 246]]) {
      const d = this.add('ankylo', 1.0);
      d.place(x, this.ground(x, z), z, Math.random() * 6);
      this.actors.push(this.grazer(d, new THREE.Vector3(x, 0, z), 6, 0.5, { graze: true }));
    }
    // 6) a pteranodon fishing in the lake
    {
      const p = new Ptero();
      p.root.scale.setScalar(1.4);
      this.scene.add(p.root);
      this.fisher = { p, t: Math.random() * 10, c: new THREE.Vector3(45, 0, 92), splashed: false };
    }
  }

  // ---------- newcomers: Mosasaurus, Dilophosaurus, Pachycephalosaurus ----------
  buildNewcomers() {
    const T = this.track, s = n => T.sOf(n);
    // Mosasaurus: bursts out of the river the coaster skims and arcs right over the rider
    {
      const U = this.world.underRange;
      if (U) this.actors.push(this.mosaDive(this.add('mosa', 1.5), U[0], U[1]));
      else { const [w0, w1] = this.waterSpan; this.actors.push(this.mosaLeap(this.add('mosa', 1.5), w0 + 2, Math.min(w1, w0 + 30))); }
    }
    // Dilophosaurus in the middle of the helix, spitting at the cart as it circles
    {
      const x = -132, z = 172;
      const d = this.add('dilo', 1.4);
      d.place(x, this.ground(x, z), z, 0);
      this.actors.push(this.spitter(d, s('helix0') - 20, s('helixOut') + 10));
    }
    // Pachycephalosaurus: a pair butting heads, and one that rams the cart on the brake run
    {
      const sAt = s('brake2') - 26;
      const A = new THREE.Vector3(), B = new THREE.Vector3();
      this.trackPoint(sAt - 10, 13, A); this.trackPoint(sAt - 10, 21, B);
      const p1 = this.add('pachy', 1.0), p2 = this.add('pachy', 0.95);
      this.actors.push(...this.buttPair(p1, p2, A, B));
      this.actors.push(this.rammer(this.add('pachy', 1.1), sAt, -6));
    }
  }

  // leaps out of the lake like a whale and crashes back with a huge splash
  breacher(d, c, s0, s1) {
    let state = 'under', t = 0, done = false;
    const water = new THREE.Vector3(c.x, 0.2, c.z);
    return {
      d,
      update: (dt, st) => {
        const inWin = this.dsTo(s0, st.s) < 0 && this.dsTo(s1, st.s) > 0;
        if (state === 'under') {
          d.pos.y = -30; d.speed = 0;
          if (inWin && !done) { state = 'breach'; t = 0; done = true; }
          if (!inWin && Math.abs(this.dsTo(s0, st.s)) > 400) done = false;
        } else if (state === 'breach') {
          t += dt;
          const k = clamp(t / 3.4, 0, 1);
          // up out of the water nose-first, arc over, slam back down
          d.pos.set(c.x + Math.sin(d.heading) * (k - 0.5) * 30, -24 + 40 * Math.sin(Math.PI * Math.min(1, k * 1.08)), c.z + Math.cos(d.heading) * (k - 0.5) * 30);
          d.bodyPitch = lerp(-1.25, 1.1, k);
          d.speed = 6; d.jawTarget = k < 0.55 ? 1 : 0.2;
          if (t > 0.35 && !d._s1) {
            d._s1 = true;
            this.particles.burst(water, 300, 'water', 16);
            for (let i = 0; i < 8; i++) this.plume(water.clone().add(new THREE.Vector3((Math.random() - 0.5) * 12, Math.random() * 4, (Math.random() - 0.5) * 12)), 9, 0xe8f0f2);
            this.audio.splash(1.2);
            this.audio.roar(water.clone().add(new THREE.Vector3(0, 8, 0)), { pitch: 0.5, size: 2, dur: 2.4 });
            this.say('오른쪽 호수에서 모사사우루스가 솟구친다!');
          }
          if (k > 0.86 && !d._s2) {
            d._s2 = true;
            this.particles.burst(water, 380, 'water', 15);
            for (let i = 0; i < 12; i++) this.plume(water.clone().add(new THREE.Vector3((Math.random() - 0.5) * 20, Math.random() * 6, (Math.random() - 0.5) * 20)), 13, 0xe8f0f2);
            this.audio.splash(1.4);
            this.fx.shake = Math.max(this.fx.shake, 0.25);
          }
          if (k >= 1) { state = 'under'; d._s1 = d._s2 = false; d.bodyPitch = 0; }
        }
      },
    };
  }

  // breaches ahead of the cart, then hunts it underwater beside the glass tube and rams it
  mosaDive(d, w0, w1) {
    let state = 'wait', t = 0, lunged = false;
    const T = this.track, wp = new THREE.Vector3();
    d.place(0, -60, 0, 0);
    return {
      d,
      update: (dt, st) => {
        const ds0 = this.dsTo(w0, st.s), ds1 = this.dsTo(w1, st.s);
        if (state === 'wait') {
          d.pos.y = -60;
          if (ds0 > 0 && ds0 < 120 && this.eta(w0, st.s) < 1.5) { state = 'breach'; t = 0; d._a = d._c = false; }
        } else if (state === 'breach') {
          // a warning leap straight up out of the pool, right where the track goes under
          t += dt;
          const k = clamp(t / 1.5, 0, 1);
          this.trackPoint(w0 + 10, 6, wp, false);
          T.sample(w0 + 10, this._s);
          d.pos.set(wp.x, -8 + 15 * Math.sin(Math.PI * k), wp.z);
          d.heading = Math.atan2(this._s.t.x, this._s.t.z) + 0.6;
          d.bodyPitch = lerp(-1.3, 1.2, k);
          d.jawTarget = k < 0.6 ? 1 : 0.2; d.speed = 6;
          this.focus = d.pos;
          if (k > 0.1 && !d._a) {
            d._a = true;
            this.particles.burst(new THREE.Vector3(wp.x, 0.2, wp.z), 260, 'water', 13);
            for (let i = 0; i < 6; i++) this.plume(new THREE.Vector3(wp.x + (Math.random() - 0.5) * 8, Math.random() * 3, wp.z + (Math.random() - 0.5) * 8), 6, 0xe8f0f2);
            this.audio.splash(1.3); this.audio.roar(d.headWorld(this._h), { pitch: 0.5, size: 2, dur: 2.2 });
            this.say('모사사우루스다! 그리고 우리는… 물속으로!');
          }
          if (k > 0.9 && !d._c) { d._c = true; this.particles.burst(new THREE.Vector3(wp.x, 0.2, wp.z), 300, 'water', 14); this.audio.splash(1.4); }
          if (k >= 1) { state = 'swim'; t = 0; d.bodyPitch = 0; }
        } else if (state === 'swim') {
          // glides alongside the tube, circles ahead, then lunges at the glass
          t += dt;
          const mid = ds0 < 0 && ds1 > 0;
          const lungeK = lunged ? 0 : clamp((t - 1.2) / 0.6, 0, 1);
          const lat = lerp(5.6, 3.0, lungeK * lungeK);
          T.sample(st.s + 6 - lungeK * 4, this._s);
          d.pos.copy(this._s.p).addScaledVector(this._s.r, lat).addScaledVector(this._s.u, 0.8 + Math.sin(t * 1.5) * 0.4);
          d.heading = Math.atan2(this._s.t.x, this._s.t.z) - lungeK * 1.2;
          d.bodyPitch = Math.sin(t * 1.2) * 0.08;
          d.speed = 4; d.jawTarget = lungeK > 0.3 ? 1 : 0.15;
          d.look = st.cam; d.lookW = lungeK;
          this.focus = d.pos; this.tension = 1;
          if (!lunged && lungeK >= 1) {
            lunged = true;
            this.fx.crack = 1; this.fx.shake = Math.max(this.fx.shake, 1.2); this.fx.wobble = 0.6;
            this.fx.kick = (this.fx.kick || 0) - 1.2;
            this.audio.crash(st.cam, 0.8); this.audio.thump(st.cam, 1.3);
            try { if (navigator.vibrate) navigator.vibrate([200, 50, 300]); } catch (e) { /* ignore */ }
            this.say('쾅! 유리에 금이 갔다!!');
          }
          if (!mid && t > 1) { state = 'gone'; t = 0; }
        } else if (state === 'gone') {
          // sinks away into the deep
          t += dt;
          d.pos.y -= dt * 3; d.pos.addScaledVector(new THREE.Vector3(Math.sin(d.heading), 0, Math.cos(d.heading)), dt * 6);
          if (t > 4) { d.pos.y = -60; }
          if (Math.abs(ds0) > 300) { state = 'wait'; lunged = false; }
        }
      },
    };
  }

  // rises out of the river ahead, arcs over the cart and dives back in behind it
  mosaLeap(d, sDive, sRise) {
    let state = 'wait', t = 0;
    const A = new THREE.Vector3(), B = new THREE.Vector3(), wp = new THREE.Vector3();
    this.trackPoint(sRise, 0, A, false); this.trackPoint(sDive, 0, B, false);
    const sPeak = (sDive + sRise) / 2, DUR = 1.7;
    d.place(0, -60, 0, Math.atan2(B.x - A.x, B.z - A.z));
    return {
      d,
      update: (dt, st) => {
        const ds = this.dsTo(sPeak, st.s);
        if (state === 'wait') {
          d.pos.y = -60; d.speed = 0;
          // time it so the body is overhead just as the cart passes under
          if (ds > 0 && ds < 120 && this.eta(sPeak - 3, st.s) < DUR / 2) { state = 'leap'; t = 0; d._a = d._b = d._c = false; }
        } else if (state === 'leap') {
          t += dt;
          const k = clamp(t / DUR, 0, 1);
          d.pos.lerpVectors(A, B, k);
          d.pos.y = -9 + 18 * Math.sin(Math.PI * k);
          d.heading = Math.atan2(B.x - A.x, B.z - A.z);
          d.bodyPitch = lerp(-1.05, 1.05, k);
          d.speed = 6; d.jawTarget = k < 0.6 ? 1 : 0.3;
          d.look = null; d.lookW = 0;
          this.focus = d.pos; this.tension = 1;
          if (k > 0.1 && !d._a) {
            d._a = true; wp.set(A.x, 0.2, A.z);
            this.particles.burst(wp, 260, 'water', 13);
            for (let i = 0; i < 6; i++) this.plume(wp.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, Math.random() * 3, (Math.random() - 0.5) * 8)), 6, 0xe8f0f2);
            this.audio.splash(1.3);
            this.audio.roar(d.headWorld(this._h), { pitch: 0.5, size: 2, dur: 2.2 });
            this.say('강에서 모사사우루스가 튀어오른다!!');
          }
          if (k > 0.5 && !d._b) {
            d._b = true;
            this.fx.shake = Math.max(this.fx.shake, 0.7); this.fx.drops = 1;
            this.particles.burst(st.cam.clone().add(new THREE.Vector3(0, 3, 0)), 160, 'water', 3);
            this.audio.splash(0.9);
            try { if (navigator.vibrate) navigator.vibrate([120, 60, 200]); } catch (e) { /* ignore */ }
          }
          if (k > 0.9 && !d._c) {
            d._c = true; wp.set(B.x, 0.2, B.z);
            this.particles.burst(wp, 320, 'water', 15);
            for (let i = 0; i < 8; i++) this.plume(wp.clone().add(new THREE.Vector3((Math.random() - 0.5) * 12, Math.random() * 4, (Math.random() - 0.5) * 12)), 9, 0xe8f0f2);
            this.audio.splash(1.4);
            this.fx.shake = Math.max(this.fx.shake, 0.35);
          }
          if (k >= 1) { state = 'done'; d.bodyPitch = 0; d.pos.y = -60; }
        } else if (state === 'done') {
          d.pos.y = -60;
          if (Math.abs(ds) > 300) state = 'wait';
        }
      },
    };
  }

  // ---------- herds of the same species, each with its own habits ----------
  buildHerds() {
    const s = n => this.track.sOf(n), hi = this.q.high;
    // Brachiosaurus: a migrating column, calves beside their mothers, stopping to browse treetops
    {
      const A = this.openSpot(s('liftStart') + 25, 36, 22), B = this.openSpot(s('liftTop') - 15, 36, 22);
      this.herd('brachio', A, hi ? 3 : 2, hi ? 2 : 1, 'migrate', { A, B, s: (s('liftStart') + s('liftTop')) / 2 });
    }
    // Triceratops: defensive ring, adults facing outward with the young in the middle
    this.herd('trike', this.openSpot(s('trike') + 70, 36, 20), hi ? 5 : 4, hi ? 3 : 2, 'ring', { key2: 'trike2', s: s('trike') + 70 });
    // Stegosaurus: turn broadside and swing their spiked tails when the train comes near
    this.herd('stego', this.openSpot(s('hill') + 12, 30, 18), hi ? 3 : 2, 1, 'tailswing', { s: s('hill') + 12 });
    if (hi) this.herd('ankylo', this.openSpot(s('splash2') + 30, -30, 18), 2, 1, 'tailswing', { s: s('splash2') + 30 });
    // Parasaurolophus: grazing herd that calls in a chorus through their crests
    this.herd('parasaur', this.openSpot(s('lift2Start') - 15, -34, 20), hi ? 4 : 3, hi ? 2 : 1, 'chorus', { s: s('lift2Start') - 15 });
    // Velociraptor: a resting pack with one sentinel on watch
    this.herd('raptor', this.openSpot(s('trim') + 8, 22, 14), hi ? 4 : 3, 0, 'sentinel', { key2: 'raptor2', s: s('trim') + 8 });
    // T-Rex juveniles playing around their mother's kill
    if (this.feedSpot) {
      const F = this.feedSpot;
      for (let i = 0; i < (hi ? 2 : 1); i++) {
        const d = this.add('rex', 0.4);
        d.place(F.x + 4, F.y, F.z, 0);
        let t = i * Math.PI, nipT = 1;
        this.actors.push({ d, update: (dt, st) => {
          t += dt; nipT -= dt;
          const a = t * 0.9 + i * Math.PI;
          this._v.set(F.x + Math.cos(a) * (5 + Math.sin(t * 1.7) * 1.5), 0, F.z + Math.sin(a) * (5 + Math.sin(t * 1.7) * 1.5));
          this.moveToward(d, this._v, 5, dt, 6, 12);
          d.jawTarget = Math.max(0, Math.sin(t * 6)) * 0.7;
          if (nipT < 0 && d.pos.distanceTo(st.cam) < 70) { nipT = 2 + Math.random() * 2; this.audio.screech(d.headWorld(this._h), { pitch: 1.5, gain: 0.5 }); }
        } });
      }
    }
    // Pteranodon flock flying in a V
    const n = hi ? 7 : 5;
    this.flock = { t: 0, ps: [] };
    for (let i = 0; i < n; i++) { const p = new Ptero(); p.root.scale.setScalar(1.2); this.scene.add(p.root); this.flock.ps.push(p); }
  }

  herd(key, c, nA, nJ, habit, o = {}) {
    const G = { t: Math.random() * 10, c: c.clone(), habit, o, members: [], alertT: 0, callDone: -1 };
    const total = nA + nJ;
    for (let i = 0; i < total; i++) {
      const juv = i >= nA;
      const k = o.key2 && i % 2 ? o.key2 : key;
      const d = this.add(k, juv ? 0.38 + Math.random() * 0.12 : 0.88 + Math.random() * 0.2);
      const ang = (i / total) * Math.PI * 2;
      const r = juv ? 2.5 : (habit === 'ring' ? 7.5 : 6 + Math.random() * 5);
      const x = c.x + Math.cos(ang) * r, z = c.z + Math.sin(ang) * r;
      d.place(x, this.ground(x, z), z, Math.random() * 6);
      const m = { d, juv, i, ang, mom: juv ? G.members[(i - nA) % nA].d : null, phase: Math.random() * 6 };
      G.members.push(m);
      this.actors.push({ d, update: (dt, st) => this.herdTick(G, m, dt, st) });
    }
    // open meadow around the herd and a clear sightline to the nearest stretch of track
    this.world.clearAround(c.x, c.z, 26);
    // a fan of sightlines from the approaching stretch of track
    if (o.s !== undefined) {
      for (let ds = -70; ds <= 20; ds += 10) {
        this.trackPoint(o.s + ds, 0, this._v);
        const tx = this._v.x, tz = this._v.z;
        const L = Math.hypot(c.x - tx, c.z - tz);
        for (let k = 0.15; k <= 1; k += 7 / L) this.world.clearAround(tx + (c.x - tx) * k, tz + (c.z - tz) * k, 7);
      }
    }
    if (habit === 'migrate') {
      const { A, B } = o, L = A.distanceTo(B);
      for (let k = 0; k <= 1; k += 6 / L) this.world.clearAround(A.x + (B.x - A.x) * k, A.z + (B.z - A.z) * k, 9);
    }
    return G;
  }

  herdTick(G, m, dt, st) {
    const d = m.d, c = G.c;
    if (m.i === 0) { G.t += dt; G.alertT -= dt; }
    const dist = d.pos.distanceTo(st.cam);
    if (dist < 65) G.alertT = 3;
    const alert = G.alertT > 0;
    const tgt = this._v;
    d.chew = 0; d.extraYaw = 0; d.tailSwing = (d.tailSwing || 0) * 0.95;
    switch (G.habit) {
      case 'migrate': {
        const { A, B } = G.o;
        const browse = (G.t % 26) > 17;
        if (m.i === 0 && !browse) G.u = (G.u || 0) + dt * 1.5 / A.distanceTo(B);
        const u = 0.5 - 0.5 * Math.cos(Math.PI * (G.u || 0));
        const dir = B.clone().sub(A).setY(0).normalize();
        const back = Math.sin(Math.PI * (G.u || 0)) >= 0 ? 1 : -1; // walking A->B or B->A
        const lead = A.clone().lerp(B, u);
        if (m.juv) {
          // calves trot beside their mother
          tgt.copy(m.mom.pos).add(new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(4.5));
          this.moveToward(d, tgt, 2.6, dt, 2, 2);
          if (Math.random() < dt * 0.05 && dist < 150) this.audio.bellow(d.headWorld(this._h), { pitch: 1.4, dur: 1, gain: 0.4 });
        } else {
          tgt.copy(lead).addScaledVector(dir, -back * m.i * 15);
          this.moveToward(d, tgt, browse ? 0 : 1.9, dt, 1, 1);
        }
        if (browse && d.speed < 0.3) { d.headDip = m.juv ? 0.9 : -0.55; d.chew = 1; } // adults reach up into the canopy, calves graze
        else d.headDip = 0;
        if (browse && m.i === 0 && G.callDone !== Math.floor(G.t / 26) && dist < 200) { G.callDone = Math.floor(G.t / 26); this.audio.bellow(d.headWorld(this._h), { pitch: 0.42, dur: 3, gain: 0.8 }); d.roar(3); }
        break;
      }
      case 'ring': {
        if (m.juv) {
          tgt.set(c.x + Math.cos(G.t * 0.3 + m.i * 2) * 2.5, 0, c.z + Math.sin(G.t * 0.3 + m.i * 2) * 2.5);
          this.moveToward(d, tgt, 1, dt, 2, 2);
          d.headDip = d.speed < 0.3 ? 0.9 : 0; d.chew = d.speed < 0.3 ? 1 : 0;
        } else {
          const nA = G.members.filter(x => !x.juv).length;
          const a = (m.i / nA) * Math.PI * 2;
          tgt.set(c.x + Math.cos(a) * 7.5, 0, c.z + Math.sin(a) * 7.5);
          this.moveToward(d, tgt, 1.2, dt, 2, 2);
          if (d.pos.distanceTo(tgt) < 1) d.heading = angleLerp(d.heading, Math.atan2(Math.cos(a), Math.sin(a)), dt * 2); // face outward
          // on alert, horns down and stamping; otherwise take turns grazing
          d.headDip = alert ? 0.4 + Math.sin(G.t * 6 + m.i) * 0.08 : (Math.sin(G.t * 0.5 + m.i * 1.3) > 0 ? 0.9 : 0.2);
          d.chew = alert ? 0 : (d.headDip > 0.5 ? 1 : 0);
          if (alert && m.i === 0 && G.callDone !== Math.floor(G.t / 5)) { G.callDone = Math.floor(G.t / 5); this.audio.bellow(d.headWorld(this._h), { pitch: 1.2, dur: 1.3, gain: 0.8 }); d.roar(1.3); }
        }
        break;
      }
      case 'tailswing': {
        if (alert && !m.juv) {
          // turn broadside to the threat and sweep the spiked tail
          d.speed = Math.max(0, d.speed - dt * 3);
          d.heading = angleLerp(d.heading, Math.atan2(st.cam.x - d.pos.x, st.cam.z - d.pos.z) + Math.PI / 2, dt * 1.5);
          d.tailSwing = 1; d.headDip = 0.2;
          if (m.i === 0 && G.callDone !== Math.floor(G.t / 4)) { G.callDone = Math.floor(G.t / 4); this.audio.bellow(d.headWorld(this._h), { pitch: 1.3, dur: 1.2, gain: 0.7 }); }
        } else if (alert && m.juv) {
          // the young hide behind the adults
          tgt.copy(c).addScaledVector(c.clone().sub(st.cam).setY(0).normalize(), 6);
          this.moveToward(d, tgt, 3, dt, 3, 4);
        } else {
          tgt.set(c.x + Math.cos(G.t * 0.07 + m.i * 2) * 8, 0, c.z + Math.sin(G.t * 0.07 + m.i * 2) * 8);
          this.moveToward(d, tgt, m.juv ? 1.2 : 0.8, dt, 1, 1);
          d.headDip = d.speed < 0.4 ? 0.9 : 0; d.chew = d.speed < 0.4 ? 1 : 0;
        }
        break;
      }
      case 'chorus': {
        tgt.set(c.x + Math.cos(G.t * 0.08 + m.i * 1.6) * 9, 0, c.z + Math.sin(G.t * 0.08 + m.i * 1.6) * 9);
        this.moveToward(d, tgt, m.juv ? 1.4 : 1, dt, 1, 1);
        const cyc = G.t % 11, slot = m.i * 0.45;
        const calling = cyc > slot && cyc < slot + 1.6;
        d.headDip = calling ? -0.45 : (d.speed < 0.5 ? 1.5 : 0); // raise the crest to call, otherwise graze
        d.chew = !calling && d.speed < 0.5 ? 1 : 0;
        if (calling && m.lastCall !== Math.floor(G.t / 11) && dist < 160) {
          m.lastCall = Math.floor(G.t / 11);
          this.audio.bellow(d.headWorld(this._h), { pitch: (m.juv ? 2.8 : 1.9) + m.i * 0.12, dur: 1.4, gain: 0.6 });
          d.jawTarget = 0.5;
        }
        break;
      }
      case 'sentinel': {
        d.speed = 0;
        if (m.i === 0) {
          // the lookout stands tall and scans the forest
          d.crouch = 0;
          d.extraYaw = alert ? 0 : Math.sin(G.t * 0.7) * 0.9;
          d.look = st.cam; d.lookW = alert ? 1 : 0;
          if (alert && G.callDone !== Math.floor(G.t / 3)) { G.callDone = Math.floor(G.t / 3); this.audio.screech(d.headWorld(this._h), { pitch: 1.1, gain: 0.8 }); d.jawTarget = 1; }
        } else {
          // the others rest low until the alarm, then rise and stare
          d.crouch += ((alert ? 0 : 1) - (d.crouch || 0)) * Math.min(1, dt * 3);
          d.look = st.cam; d.lookW = alert ? 1 : 0;
          d.headDip = alert ? 0 : 0.5;
          d.tailSwing = alert ? 0 : 0.15;
          if (alert) d.jawTarget = Math.max(0, Math.sin(G.t * 4 + m.i)) * 0.6;
        }
        break;
      }
    }
  }

  // circles with the cart, flares its frill and spits venom at the rider
  spitter(d, s0, s1) {
    let t = 0, spitT = 2.5, spits = 0;
    const blobs = this.spitBlobs || (this.spitBlobs = []);
    return {
      d,
      update: (dt, st) => {
        t += dt;
        const inWin = this.dsTo(s0, st.s) < 0 && this.dsTo(s1, st.s) > 0;
        const dist = d.pos.distanceTo(st.cam);
        d.speed = 0;
        // keep facing the circling cart
        d.heading = angleLerp(d.heading, Math.atan2(st.cam.x - d.pos.x, st.cam.z - d.pos.z), Math.min(1, dt * 2));
        d.look = st.cam; d.lookW = inWin ? 1 : 0.3;
        d.frillTarget = inWin && dist < 60 ? 1 : 0;
        if (!inWin) { spits = 0; spitT = 2.5; return; }
        spitT -= dt;
        d.jawTarget = spitT < 0.6 ? 1 : 0.15;
        if (spitT < 0.6 && spitT + dt >= 0.6) this.audio.screech(d.headWorld(this._h), { pitch: 1.6, gain: 0.9 });
        if (spitT < 0 && spits < 3 && dist < 45) {
          spits++; spitT = 3 + Math.random() * 1.5;
          const from = d.headWorld(this._h).clone();
          blobs.push({ from, t: 0, mesh: this.spitMesh(from) });
          if (spits === 1) this.say('딜로포사우루스가 독침을 뱉는다!');
        }
      },
    };
  }

  spitMesh(from) {
    if (!this._spitMat) this._spitMat = new THREE.MeshStandardMaterial({ color: 0x9be22a, emissive: 0x335a08, roughness: 0.2, transparent: true, opacity: 0.85 });
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), this._spitMat);
    m.position.copy(from);
    this.scene.add(m);
    return m;
  }

  // two males backing off and slamming domes together, over and over
  buttPair(a, b, A, B) {
    let t = Math.random() * 3;
    const mid = A.clone().add(B).multiplyScalar(0.5);
    const dir = B.clone().sub(A).setY(0).normalize();
    const hA = Math.atan2(dir.x, dir.z), hB = Math.atan2(-dir.x, -dir.z);
    a.place(A.x, A.y, A.z, hA); b.place(B.x, B.y, B.z, hB);
    let hit = false;
    const step = (d, sign, dt, st) => {
      const cyc = t % 6;
      let off; // distance from the middle
      if (cyc < 2.2) off = lerp(1.6, 7, cyc / 2.2);            // back off
      else if (cyc < 3.0) off = 7;                              // paw the ground
      else if (cyc < 3.7) off = lerp(7, 1.15, (cyc - 3.0) / 0.7); // charge
      else off = 1.15 + Math.min(0.8, (cyc - 3.7) * 1.5);       // recoil
      const tgt = mid.clone().addScaledVector(dir, sign * off);
      const prev = d.pos.clone();
      d.pos.set(tgt.x, this.ground(tgt.x, tgt.z), tgt.z);
      d.speed = prev.distanceTo(d.pos) / Math.max(dt, 1e-3);
      d.heading = sign < 0 ? hA : hB;
      d.headDip = cyc > 2.8 && cyc < 3.8 ? 0.6 : 0.1;   // head down for the charge
      d.extraYaw = cyc > 3.7 && cyc < 4.6 ? Math.sin(t * 25) * 0.25 : 0; // dazed shake
    };
    return [
      { d: a, update: (dt, st) => {
        t += dt;
        step(a, -1, dt, st);
        const cyc = t % 6;
        if (cyc > 3.68 && !hit) {
          hit = true;
          const dist = mid.distanceTo(st.cam);
          if (dist < 120) { this.audio.thump(mid, 1.0); this.audio.clunk(); }
          this.particles.burst(mid.clone().add(new THREE.Vector3(0, 1.2, 0)), 20, 'dust', 2);
        }
        if (cyc < 1) hit = false;
      } },
      { d: b, update: (dt, st) => step(b, 1, dt, st) },
    ];
  }

  // charges in from the side of the brake run and head-butts the cart
  rammer(d, sAt, lat) {
    const home = new THREE.Vector3();
    this.trackPoint(sAt + 4, lat * 2.2, home);
    d.place(home.x, home.y, home.z, 0);
    let state = 'wait', t = 0;
    const tgt = new THREE.Vector3();
    return {
      d,
      update: (dt, st) => {
        const ds = this.dsTo(sAt, st.s);
        if (state === 'wait') {
          d.speed = 0; d.look = st.cam; d.lookW = ds < 40 && ds > -5 ? 1 : 0;
          this.track.sample(st.s, this._s);
          d.heading = Math.atan2(st.cam.x - d.pos.x, st.cam.z - d.pos.z);
          if (ds < 11 && ds > 0) { state = 'charge'; t = 0; this.audio.bellow(d.headWorld(this._h), { pitch: 1.8, dur: 0.8, gain: 1 }); }
        } else if (state === 'charge') {
          t += dt;
          // aim at the side of the cart just ahead of the rider
          this.track.sample(st.s + 1.2, this._s);
          tgt.copy(this._s.p).addScaledVector(this._s.r, Math.sign(lat) * 1.6);
          this.moveToward(d, tgt, 10, dt, 8, 30);
          d.headDip = 0.65; d.look = null; d.lookW = 0;
          if (d.pos.distanceTo(tgt) < 1.0 || t > 2.5) {
            state = 'dazed'; t = 0;
            this.fx.shake = Math.max(this.fx.shake, 1.3); this.fx.wobble = 0.8;
            this.fx.kick = (this.fx.kick || 0) - Math.sign(lat) * 1.6;
            this.audio.crash(st.cam, 0.9); this.audio.clunk();
            try { if (navigator.vibrate) navigator.vibrate([150, 40, 220]); } catch (e) { /* ignore */ }
            this.say('쾅! 파키케팔로사우루스 박치기!');
          }
        } else if (state === 'dazed') {
          // bounces off, stumbles back and shakes its head
          t += dt;
          d.speed = Math.max(0, 3 - t * 3);
          d.pos.x -= Math.sin(d.heading) * d.speed * dt;
          d.pos.z -= Math.cos(d.heading) * d.speed * dt;
          d.pos.y = this.ground(d.pos.x, d.pos.z);
          d.headDip = 0.2; d.extraYaw = Math.sin(t * 18) * 0.3 * Math.max(0, 1 - t / 2.5);
          if (Math.abs(ds) > 250) { d.extraYaw = 0; d.headDip = 0; d.place(home.x, home.y, home.z, 0); state = 'wait'; }
        }
      },
    };
  }

  drinker(d, water) {
    let t = Math.random() * 10;
    d.heading = Math.atan2(water.x - d.pos.x, water.z - d.pos.z);
    return {
      d,
      update: (dt, st) => {
        t += dt;
        d.speed = 0;
        const cyc = t % 16;
        // lower the long neck to the water, drink, lift and look around
        const down = cyc < 9 ? Math.min(1, cyc / 3) : Math.max(0, 1 - (cyc - 9) / 3);
        d.headDip = down * 2.6;
        d.chew = down > 0.95 ? 0.6 : 0;
        if (down < 0.2 && d.pos.distanceTo(st.cam) < 120) { d.look = st.cam; d.lookW = Math.min(0.5, d.lookW + dt * 0.3); }
        else d.lookW = Math.max(0, d.lookW - dt * 0.5);
        if (down > 0.95 && Math.random() < dt * 0.6) {
          const h = d.headWorld(this._h);
          if (h.y < 2.5) this.particles.burst(new THREE.Vector3(h.x, 0.1, h.z), 6, 'water', 1.2);
        }
      },
    };
  }

  feeder(d, food, o = {}) {
    let t = Math.random() * 6, roarCD = 0, callT = 2 + Math.random() * 4;
    return {
      d,
      update: (dt, st) => {
        t += dt; roarCD -= dt; callT -= dt;
        d.speed = 0;
        const dist = d.pos.distanceTo(st.cam);
        if (o.roar && dist < 70 && roarCD < 0) {
          roarCD = 16; d.roar(2.8);
          this.audio.roar(d.headWorld(this._h), { pitch: d.spec.roarPitch, size: d.spec.roarSize, dur: 2.8 });
          if (o.msg) this.say(o.msg);
        }
        if (o.screech && callT < 0 && dist < 120) {
          callT = 2 + Math.random() * 4;
          this.audio.screech(d.headWorld(this._h), { pitch: 0.9 + Math.random() * 0.3, gain: 0.5 });
          d.jawTarget = 1;
        }
        if (d.roarT > 0) {
          d.look = st.cam; d.lookW = Math.min(1, d.lookW + dt * 2);
          d.headDip = 0; d.chew = 0; d.extraYaw = 0; d.bodyPitch *= 0.9;
          return;
        }
        d.lookW = Math.max(0, d.lookW - dt);
        const speed = o.fast ? 1.6 : 1;
        const cyc = (t * speed) % 7;
        if (cyc < 4.4) {
          // head down in the carcass, chewing
          d.headDip = (o.dip || 1.15) + Math.sin(t * 1.3) * 0.08;
          d.bodyPitch += ((o.bodyPitch || 0.25) - d.bodyPitch) * Math.min(1, dt * 2);
          d.chew = 1; d.extraYaw = 0;
          d.jawTarget = 0.25 + 0.35 * Math.max(0, Math.sin(t * 8));
        } else if (cyc < 5.6) {
          // grip and tear: head yanks up and shakes side to side
          d.headDip = 0.15; d.chew = 0;
          d.extraYaw = Math.sin(t * 20) * 0.22;
          d.jawTarget = 0.1;
          d.bodyPitch += (0.05 - d.bodyPitch) * Math.min(1, dt * 3);
        } else {
          // swallow, glance around
          d.extraYaw = Math.sin(t * 0.8) * 0.3;
          d.headDip = 0.3; d.jawTarget = 0.5; d.chew = 0;
        }
      },
    };
  }

  scavenger(d, food, i) {
    const target = new THREE.Vector3();
    let t = 0, next = 0;
    return {
      d,
      update: (dt) => {
        t += dt; next -= dt;
        if (next < 0) {
          next = 0.6 + Math.random() * 1.6;
          const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 5;
          target.set(food.x + Math.cos(a) * r, 0, food.z + Math.sin(a) * r);
        }
        this.moveToward(d, target, 4.5, dt, 6, 12);
        d.headDip = d.speed < 0.5 ? 0.5 : 0;
        if (d.speed < 0.5) d.chew = 1; else d.chew = 0;
      },
    };
  }

  huntLoop(center, R, prey, pred) {
    let a = 0, t = 0, callT = 3;
    const tgt = new THREE.Vector3();
    const all = prey.concat([pred]);
    all.forEach(d => { d.place(center.x + R, center.y, center.z, 0); });
    const offs = prey.map((_, i) => ({ da: 0.22 * i + 0.08 * Math.random(), dr: (Math.random() - 0.5) * 6 }));
    const runner = (d, ang, dr, spd) => {
      tgt.set(center.x + Math.cos(ang) * (R + dr), 0, center.z + Math.sin(ang) * (R + dr));
      this.moveToward(d, tgt, spd, this._dt, 4, 10);
    };
    prey.forEach((d, i) => this.actors.push({
      d,
      update: (dt, st) => {
        if (i === 0) { t += dt; a += dt * 9.5 / R; }
        this._dt = dt;
        runner(d, a + offs[i].da + 0.25, offs[i].dr + Math.sin(t * 0.7 + i) * 2, 11);
        d.headDip = -0.1;
        if (i === 0) {
          callT -= dt;
          if (callT < 0 && d.pos.distanceTo(st.cam) < 150) { callT = 2.5 + Math.random() * 3; this.audio.bellow(d.headWorld(this._h), { pitch: 2.2, dur: 1.2, gain: 0.7 }); d.roar(1.2); }
        }
      },
    }));
    this.actors.push({
      d: pred,
      update: (dt, st) => {
        this._dt = dt;
        const gap = 0.28 + Math.sin(t * 0.45) * 0.16; // closes in, falls back, lunges again
        runner(pred, a - gap + 0.25, 0, 12);
        const near = gap < 0.17;
        pred.jawTarget = near ? 0.6 + 0.4 * Math.max(0, Math.sin(t * 10)) : 0.2;
        pred.look = prey[0].pos; pred.lookW = 0.6;
        if (near && !this._huntRoar && pred.pos.distanceTo(st.cam) < 160) {
          this._huntRoar = true;
          this.audio.roar(pred.headWorld(this._h), { pitch: 1.0, size: 1.0, dur: 2 });
          pred.roar(2);
          if (pred.pos.distanceTo(st.cam) < 110) this.say('카르노타우루스가 사냥 중이다!');
        }
        if (!near) this._huntRoar = false;
      },
    });
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
        if (opts.graze) { const eat = Math.sin(t * 0.4) > 0.0 && d.speed < 0.6; d.headDip = eat ? (d.spec.kind === 'biped' ? 1.6 : 0.9) : 0; d.chew = eat ? 1 : 0; }
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

  charger(d, sAt, latA, latB, lead = true) {
    const A = new THREE.Vector3(), B = new THREE.Vector3();
    this.trackPoint(sAt, latA, A);
    this.trackPoint(sAt, latB, B);
    // clear a lane through the vegetation for the stampede
    for (let k = 0; k <= 1; k += 6 / A.distanceTo(B)) this.world.clearAround(A.x + (B.x - A.x) * k, A.z + (B.z - A.z) * k, 5);
    const spd = 11.5 * (d.scale || 1) ** 0.3;
    const runTime = Math.abs(latA) / spd + spd / (2 * 4); // includes accelerating from a standstill
    d.place(A.x, A.y, A.z, Math.atan2(B.x - A.x, B.z - A.z));
    let state = 'wait', t = 0, bellowed = false, stepPh = 0;
    // where the herd crosses the rails: it bounds over them instead of walking through
    this.track.sample(sAt, this._s);
    const P0 = this._s.p.clone(), R0 = this._s.r.clone();
    const dirSign = Math.sign(latB - latA) || 1;
    const halfW = 4 + 4 * (d.scale || 1);
    const railAbove = P0.y - this.ground(P0.x, P0.z); // high track: run underneath instead
    let jumping = false;
    const jump = (st) => {
      const latNow = (d.pos.x - P0.x) * R0.x + (d.pos.z - P0.z) * R0.z;
      const u = (latNow * dirSign + halfW) / (2 * halfW);
      if (u > 0 && u < 1 && railAbove < 2.6) {
        const g = this.ground(d.pos.x, d.pos.z);
        const lift = Math.max(0, P0.y + 0.4 - g) + 1.3 * (d.scale || 1);
        d.pos.y = g + lift * Math.sin(Math.PI * u);
        d.bodyPitch = -0.32 * Math.cos(Math.PI * u); // nose up on take-off, down on landing
        d.headDip = -0.2;
        if (!jumping) {
          jumping = true;
          this.particles.burst(d.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), 45, 'dust', 4);
          this.audio.thump(d.pos, 0.7 * (d.scale || 1));
          if (lead) this.audio.bellow(d.headWorld(this._h), { pitch: 1.5, dur: 1.0, gain: 1.0 });
        }
      } else if (jumping && u >= 1) {
        // landing: heavy thud, dust, ground shake
        jumping = false;
        d.bodyPitch = 0; d.headDip = 0.35;
        this.particles.burst(d.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), 70, 'dust', 5);
        this.plume(d.pos, 3 * (d.scale || 1));
        const dist = d.pos.distanceTo(st.cam);
        this.audio.thump(d.pos, 1.2 * (d.scale || 1));
        if (dist < 40) { this.fx.shake = Math.max(this.fx.shake, 0.5 * (1 - dist / 40)); try { if (navigator.vibrate) navigator.vibrate(80); } catch (e) { /* ignore */ } }
      }
    };
    return {
      d,
      update: (dt, st) => {
        const ds = this.dsTo(sAt, st.s);
        if (state === 'wait') {
          d.speed = 0;
          d.headDip = 0.3;
          if (ds < 450 && ds > 0 && this.eta(sAt, st.s) < runTime + (lead ? 0.28 : 1.3)) { state = 'run'; t = 0; d._bumped = false; jumping = false; }
        } else if (state === 'run') {
          t += dt;
          d.headDip = 0.35; // horns down
          if (d._stagger > 0) {
            // knocked sideways after the hit: slows, slews away, head swinging
            d._stagger -= dt;
            d.speed += (4 - d.speed) * Math.min(1, dt * 3);
            d.heading += d._staggerSide * dt * 1.1;
            d.extraYaw = Math.sin(t * 14) * 0.25 * d._stagger;
            d.bodyPitch = Math.sin(t * 9) * 0.08 * d._stagger;
            d.pos.x += Math.sin(d.heading) * d.speed * dt;
            d.pos.z += Math.cos(d.heading) * d.speed * dt;
            d.pos.y = this.ground(d.pos.x, d.pos.z);
            if (d._stagger <= 0) { d.extraYaw = 0; d.bodyPitch = 0; }
          } else this.moveToward(d, B, spd, dt, 1.2, 4);
          jump(st);
          if (lead) this.focus = d.pos;
          if (!bellowed && t > 0.2 + (lead ? 0 : Math.random() * 2)) { bellowed = true; this.audio.bellow(d.headWorld(this._h), { pitch: 1.3 / (d.scale || 1), dur: 1.5, gain: lead ? 1.0 : 0.6 }); if (lead) this.say('저 멀리서 트리케라톱스 무리가 돌진해 온다!'); d.roar(1.5); }
          if (d.pos.distanceTo(B) < 2) { state = 'done'; t = 0; }
          const ph = Math.floor(d.phase / Math.PI);
          if (ph !== stepPh) { stepPh = ph; const dist = d.pos.distanceTo(st.cam); if (dist < 50) { this.audio.thump(d.pos, 0.5); this.fx.shake = Math.max(this.fx.shake, 0.15 * (1 - dist / 50)); } }
          this.particles.emitDust(d.pos, dt);
          // the stampede clips the train: heavy jolt, side shove, thud
          if (!d._bumped && d.pos.distanceTo(st.cam) < (lead ? 8 : 6)) {
            d._bumped = true;
            // which side of the cart got hit (+1 = right, -1 = left)
            this.track.sample(st.s, this._s);
            const side = Math.sign((d.pos.x - st.cam.x) * this._s.r.x + (d.pos.z - st.cam.z) * this._s.r.z) || 1;
            if (lead) {
              // full-body ram: violent rattle, sideways shove, speed jolt, aftershock
              this.fx.shake = Math.max(this.fx.shake, 2.2);
              this.fx.wobble = 1;
              this.fx.kick = (this.fx.kick || 0) + 2.4 * side;
              this.fx.slow = 0.55;
              this.fx.flashDust = 1;
              setTimeout(() => { this.fx.kick = (this.fx.kick || 0) - 1.1 * side; this.fx.shake = Math.max(this.fx.shake, 1.2); this.audio.clunk(); }, 260);
              this.audio.crash(st.cam, 1.3);
              this.audio.bellow(d.headWorld(this._h), { pitch: 1.1, dur: 1.8, gain: 1.2 });
              this.particles.burst(st.cam.clone().addScaledVector(this._s.r, side * 1.5).add(new THREE.Vector3(0, -1, 0)), 160, 'dust', 6);
              for (let k = 0; k < 4; k++) this.plume(st.cam.clone().addScaledVector(this._s.r, side * (2 + k)), 3);
              try { if (navigator.vibrate) navigator.vibrate([350, 60, 200, 60, 400]); } catch (e) { /* ignore */ }
              this.say('쾅!!! 트리케라톱스에게 들이받혔다!');
              // the animal bounces off and staggers away
              d._stagger = 1.4; d._staggerSide = side;
            } else {
              this.fx.shake = Math.max(this.fx.shake, 0.9);
              this.fx.kick = (this.fx.kick || 0) + 0.8 * side;
              this.audio.crash(d.pos, 0.6);
              try { if (navigator.vibrate) navigator.vibrate([120]); } catch (e) { /* ignore */ }
            }
          }
          d._plumeT = (d._plumeT || 0) - dt;
          if (d._plumeT < 0) { d._plumeT = 0.22; this.plume(d.pos, 3 * (d.scale || 1)); }
        } else if (state === 'done') {
          d.speed = Math.max(0, d.speed - dt * 6);
          d.pos.x += Math.sin(d.heading) * d.speed * dt;
          d.pos.z += Math.cos(d.heading) * d.speed * dt;
          d.pos.y = this.ground(d.pos.x, d.pos.z);
          if (d.speed < 0.1) { d.headDip = 0.6; d.chew = 1; }
          if (Math.abs(ds) > 450) { d.place(A.x, A.y, A.z, Math.atan2(B.x - A.x, B.z - A.z)); state = 'wait'; bellowed = false; d.chew = 0; }
        }
      },
    };
  }

  chaser(d, sStart, sEnd, off, lat, i) {
    const hide = new THREE.Vector3();
    this.trackPoint(sStart + 6, lat * 3.2, hide);
    d.place(hide.x, hide.y, hide.z, 0);
    let state = 'hide', t = 0, screechT = 1 + i * 0.7, lungeT = 1.2 + i * 0.9, lunge = 0;
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
          // take turns lunging in at the rider: close the gap, jaws wide, snap
          lungeT -= dt;
          if (lungeT < 0 && lunge <= 0) {
            lunge = 0.5; lungeT = 2.2 + Math.random() * 2.5 + i * 0.3;
            this.audio.screech(d.headWorld(this._h), { pitch: 0.9 + Math.random() * 0.4, gain: 1 });
            this.fx.shake = Math.max(this.fx.shake, 0.35);
            this.fx.kick = (this.fx.kick || 0) - Math.sign(lat) * 0.35; // flinch away
            try { if (navigator.vibrate) navigator.vibrate(60); } catch (e) { /* ignore */ }
          }
          const lk = lunge > 0 ? Math.sin(Math.PI * (1 - lunge / 0.5)) : 0;
          lunge -= dt;
          const sT = st.s + off + Math.sin(t * 0.8 + wob) * 2 + lk * (2 - off * 0.3);
          this.trackPoint(sT, (lat + Math.sin(t * 1.3 + wob) * 0.6) * (1 - 0.45 * lk), target);
          this.moveToward(d, target, 23, dt, 6, 22);
          d.look = st.cam; d.lookW = 1;
          d.jawTarget = lk > 0.1 ? 1 : Math.max(0, Math.sin(t * 3 + wob)) * 0.8;
          d.headDip = -0.15 * lk;
          this.focus = d.pos;
          this.tension = 1;
          screechT -= dt;
          if (screechT < 0) {
            screechT = 1.8 + Math.random() * 2.5;
            d.jawTarget = 1;
            this.audio.screech(d.headWorld(this._h), { pitch: 0.85 + Math.random() * 0.4 });
          }
          if (i === 0 && t < 0.1) this.say('랩터 무리다!! 사방에서 달려든다!');
          if (dsE < 0) { state = i === 0 ? 'tail' : 'stop'; t = 0; if (i === 0) this.say('한 마리가 터널까지 쫓아온다!'); }
        } else if (state === 'tail') {
          // chases right behind the cart along the rails, into the dark tunnel
          t += dt;
          this.track.sample(st.s - 5.5 - Math.max(0, t - 2.5) * 6, this._s);
          d.pos.copy(this._s.p).addScaledVector(this._s.u, 0.2);
          d.heading = Math.atan2(this._s.t.x, this._s.t.z);
          d.speed = st.v * 1.05;
          d.look = st.cam; d.lookW = 1;
          d.jawTarget = Math.max(0, Math.sin(t * 6)) ;
          screechT -= dt;
          if (screechT < 0) { screechT = 1.2 + Math.random(); this.audio.screech(d.headWorld(this._h), { pitch: 1, gain: 1 }); }
          if (this.track.inRange(st.s, 'launch') || t > 7) { state = 'stop'; t = 0; }
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

  // leaps from the bushes onto the cart's nose, snaps at the rider, is flung off on the airtime hill
  boarder(d, sJump, sOff) {
    const home = new THREE.Vector3();
    this.trackPoint(sJump + 6, 10, home);
    d.place(home.x, home.y, home.z, 0);
    let state = 'wait', t = 0, snapT = 0, side = 1;
    const from = new THREE.Vector3(), nose = new THREE.Vector3(), vel = new THREE.Vector3();
    const noseOf = (stS) => {
      this.track.sample(stS, this._s);
      return nose.copy(this._s.p).addScaledVector(this._s.t, 2.3).addScaledVector(this._s.u, 0.95);
    };
    return {
      d,
      update: (dt, st) => {
        const ds = this.dsTo(sJump, st.s);
        if (state === 'wait') {
          d.speed = 0; d.look = st.cam; d.lookW = ds < 40 && ds > -5 ? 1 : 0;
          if (ds < 9 && ds > -2) { state = 'leap'; t = 0; from.copy(d.pos); this.audio.screech(d.headWorld(this._h), { pitch: 1.15, gain: 1 }); }
        } else if (state === 'leap') {
          t += dt;
          const k = clamp(t / 0.65, 0, 1);
          noseOf(st.s);
          d.pos.lerpVectors(from, nose, k * k * (3 - 2 * k));
          d.pos.y += Math.sin(Math.PI * k) * 3;
          d.heading = Math.atan2(-this._s.t.x, -this._s.t.z);
          d.speed = 3; d.jawTarget = 1; d.look = st.cam; d.lookW = 1;
          this.focus = d.pos;
          if (k >= 1) {
            state = 'ride'; t = 0;
            this.fx.shake = Math.max(this.fx.shake, 1.0); this.fx.wobble = 0.7;
            this.fx.kick = (this.fx.kick || 0) + 0.8;
            this.audio.thump(st.cam, 1.2); this.audio.clunk();
            try { if (navigator.vibrate) navigator.vibrate([200, 50, 120]); } catch (e) { /* ignore */ }
            this.say('랩터가 열차에 올라탔다!!');
          }
        } else if (state === 'ride') {
          // clinging to the nose, face to face with the rider
          t += dt; snapT -= dt;
          noseOf(st.s);
          d.pos.copy(nose);
          d.heading = Math.atan2(-this._s.t.x, -this._s.t.z) + Math.sin(t * 5) * 0.15;
          d.speed = 2.5;
          d.look = st.cam; d.lookW = 1;
          d.bodyPitch = 0.25 + Math.sin(t * 9) * 0.05;
          if (snapT < 0) {
            snapT = 0.55 + Math.random() * 0.35;
            d.jawTarget = 1; d.headDip = 0.35;
            this.fx.shake = Math.max(this.fx.shake, 0.45);
            this.fx.flash = Math.max(this.fx.flash, 0.25);
            if (Math.random() < 0.6) this.audio.screech(d.headWorld(this._h), { pitch: 1 + Math.random() * 0.3, gain: 1 });
            try { if (navigator.vibrate) navigator.vibrate(70); } catch (e) { /* ignore */ }
          } else { d.jawTarget = 0.35; d.headDip *= 0.85; }
          this.focus = d.pos; this.tension = 1;
          if (st.s > sOff - 4 || t > 4.5) {
            // the airtime hill flings it off
            state = 'thrown'; t = 0;
            side = Math.random() < 0.5 ? -1 : 1;
            vel.copy(this._s.t).multiplyScalar(st.v * 0.45).addScaledVector(this._s.r, side * 7).add(new THREE.Vector3(0, 6, 0));
            d.headDip = 0; d.bodyPitch = 0;
            this.fx.shake = Math.max(this.fx.shake, 0.8);
            this.fx.kick = (this.fx.kick || 0) - side * 0.9;
            this.audio.screech(d.headWorld(this._h), { pitch: 1.4, gain: 1 });
            this.say('날려버렸다!!');
          }
        } else if (state === 'thrown') {
          t += dt;
          vel.y -= 9.81 * dt;
          d.pos.addScaledVector(vel, dt);
          d.root.rotation.x += dt * 6 * side; d.root.rotation.z += dt * 9;
          d.speed = 6; d.jawTarget = 1;
          const g = this.ground(d.pos.x, d.pos.z);
          if (d.pos.y < g && vel.y < 0) {
            d.pos.y = g; state = 'down'; t = 0;
            d.root.rotation.x = 0; d.root.rotation.z = Math.PI / 2;
            this.particles.burst(d.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), 40, 'dust', 3);
          }
        } else if (state === 'down') {
          d.speed = 0; d.root.rotation.z = Math.PI / 2;
          if (Math.abs(ds) > 300) { d.root.rotation.set(0, 0, 0); d.place(home.x, home.y, home.z, 0); state = 'wait'; }
        }
      },
    };
  }

  // charges down the track at the cart and leaps right over the rider's head
  leaper(d, sAt) {
    const start = new THREE.Vector3();
    this.trackPoint(sAt + 16, 0, start);
    d.place(start.x, start.y, start.z, 0);
    let state = 'wait', t = 0;
    return {
      d,
      update: (dt, st) => {
        const ds = this.dsTo(sAt, st.s);
        if (state === 'wait') {
          this.track.sample(sAt + 16, this._s);
          d.heading = Math.atan2(-this._s.t.x, -this._s.t.z);
          d.speed = 0; d.look = st.cam; d.lookW = ds < 60 ? 1 : 0;
          if (ds < 60 && ds > 30 && !d._warned) { d._warned = true; this.say('앞에 랩터가 서 있다!!'); this.audio.screech(d.headWorld(this._h), { pitch: 0.9, gain: 1 }); }
          if (ds < 13 && ds > -2) { state = 'jump'; t = 0; }
        } else if (state === 'jump') {
          // runs at the cart, launches and sails over the rider's head (cart-relative arc)
          t += dt;
          const k = clamp(t / 0.85, 0, 1);
          const rel = lerp(9, -9, k);
          this.track.sample(st.s + rel, this._s);
          d.pos.copy(this._s.p).addScaledVector(this._s.u, 0.6 + Math.sin(Math.PI * k) * 2.6).addScaledVector(this._s.r, 0.4);
          d.heading = Math.atan2(-this._s.t.x, -this._s.t.z);
          d.speed = 4; d.jawTarget = 1; d.look = st.cam; d.lookW = 1;
          this.focus = d.pos;
          if (k > 0.42 && !d._passed) {
            d._passed = true;
            this.fx.shake = Math.max(this.fx.shake, 0.9); this.fx.flash = Math.max(this.fx.flash, 0.4);
            this.audio.screech(st.cam, { pitch: 1.3, gain: 1.1 }); this.audio.thump(st.cam, 0.8);
            try { if (navigator.vibrate) navigator.vibrate([90, 40, 90]); } catch (e) { /* ignore */ }
            this.say('머리 위로 뛰어넘었다!!');
          }
          if (k >= 1) { state = 'land'; t = 0; d.pos.y = this.ground(d.pos.x, d.pos.z); this.particles.burst(d.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), 50, 'dust', 3); }
        } else if (state === 'land') {
          t += dt;
          this.trackPoint(st.s - 6, -4, this._v);
          this.moveToward(d, this._v, 20, dt, 4, 14);
          d.look = st.cam; d.lookW = 1;
          if (t > 4) state = 'idle';
        } else if (state === 'idle') {
          d.speed = Math.max(0, d.speed - dt * 10);
          if (Math.abs(ds) > 260) { d._warned = d._passed = false; d.place(start.x, start.y, start.z, 0); state = 'wait'; }
        }
      },
    };
  }

  plume(p, size, color = 0x9a8466) {
    const P = this.plumes[this.plumeI++ % this.plumes.length];
    P.life = 1; P.size = size;
    P.sp.material.color.setHex(color);
    P.sp.position.set(p.x + (Math.random() - 0.5) * 2, p.y + 1, p.z + (Math.random() - 0.5) * 2);
    P.sp.visible = true;
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
    if (this.fisher) {
      const F = this.fisher; F.t += dt;
      const cyc = F.t % 14;
      const ang = F.t * 0.35;
      let x = F.c.x + Math.cos(ang) * 26, z = F.c.z + Math.sin(ang) * 26, y = 32;
      if (cyc > 8 && cyc < 12) {
        // dive, skim the water, climb away with a fish
        const k = (cyc - 8) / 4;
        y = 32 - 31.2 * Math.sin(Math.PI * Math.min(1, k * 1.05));
        if (k > 0.45 && k < 0.55 && !F.splashed) { F.splashed = true; this.particles.burst(new THREE.Vector3(x, 0.2, z), 40, 'water', 4); }
      } else F.splashed = false;
      const dx = -Math.sin(ang), dz = Math.cos(ang);
      F.p.root.position.set(x, y, z);
      F.p.root.rotation.set(cyc > 8 && cyc < 10 ? 0.5 : cyc > 10 && cyc < 12 ? -0.4 : 0, Math.atan2(dx, dz), -0.3);
      F.p.update(dt, cyc > 9 && cyc < 11 ? 0.2 : 0.8);
    }
    if (this.stalk) {
      const K = this.stalk;
      const ds0 = this.dsTo(K.s0, st.s), ds1 = this.dsTo(K.s1, st.s);
      if (ds0 < 0 && ds1 > 0) {
        this.tension = Math.max(this.tension, 0.7);
        K.next -= dt;
        if (!K.said) { K.said = true; this.say('…숲속에서 뭔가 우리를 따라온다'); }
        if (K.next < 0) {
          K.next = 0.9 + Math.random() * 1.6;
          const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 25;
          this.audio.screech(new THREE.Vector3(st.cam.x + Math.cos(a) * r, st.cam.y - 4, st.cam.z + Math.sin(a) * r), { pitch: 0.75 + Math.random() * 0.4, gain: 0.55 });
        }
      } else if (ds0 > 50) K.said = false;
    }
    if (this.spitBlobs) for (let i = this.spitBlobs.length - 1; i >= 0; i--) {
      const b = this.spitBlobs[i];
      b.t += dt / 0.55;
      const k = Math.min(1, b.t);
      // lob toward the rider's face
      b.mesh.position.lerpVectors(b.from, st.cam, k);
      b.mesh.position.y += Math.sin(Math.PI * k) * 2;
      if (k >= 1) {
        this.scene.remove(b.mesh);
        this.spitBlobs.splice(i, 1);
        this.fx.splat = 1;
        this.fx.shake = Math.max(this.fx.shake, 0.3);
        this.audio.splash(0.35);
        try { if (navigator.vibrate) navigator.vibrate(50); } catch (e) { /* ignore */ }
        if (!this._splatSaid) { this._splatSaid = true; this.say('으악! 끈적한 독침!'); }
      }
    }
    for (const P of this.plumes) {
      if (P.life <= 0) continue;
      P.life -= dt / 3.5;
      if (P.life <= 0) { P.sp.visible = false; continue; }
      const k = 1 - P.life;
      const sz = P.size * (1 + k * 4);
      P.sp.scale.set(sz, sz * 0.8, 1);
      P.sp.position.y += dt * 1.2;
      P.sp.material.opacity = Math.sin(Math.PI * Math.min(1, k * 1.4)) * 0.55;
    }
    if (this.flock) {
      const F = this.flock; F.t += dt;
      const a = F.t * 0.05;
      const lead = new THREE.Vector3(Math.cos(a) * 170, 58 + Math.sin(F.t * 0.3) * 4, Math.sin(a) * 140 + 60);
      const fwd = new THREE.Vector3(-Math.sin(a) * 170, 0, Math.cos(a) * 140).normalize();
      const side = new THREE.Vector3(-fwd.z, 0, fwd.x);
      F.ps.forEach((p, i) => {
        const row = Math.ceil(i / 2), sd = i % 2 ? 1 : -1;
        p.root.position.copy(lead).addScaledVector(fwd, -row * 5).addScaledVector(side, sd * row * 4.5);
        p.root.rotation.set(0, Math.atan2(fwd.x, fwd.z), -0.12);
        p.update(dt, 0.6 + 0.4 * Math.sin(F.t * 0.5 + i));
      });
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
