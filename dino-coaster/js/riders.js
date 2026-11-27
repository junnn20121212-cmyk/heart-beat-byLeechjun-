// Passengers, the rider's own hands/legs, and head inertia
import * as THREE from 'three';

const SKIN = [0xe8c4a0, 0xd9a57e, 0xc68a62, 0xf0d2b6, 0x8d5a3b];
const SHIRT = [0x2f5d8a, 0xb23a2e, 0x2f6b3f, 0xd9a521, 0x6b3f8a, 0x222222, 0xe8e8e8, 0x3a8a8a];
const HAIR = [0x1a1410, 0x3b2a1c, 0x6b4a2b, 0x111111, 0x8a6a3a];

function pick(a, r) { return a[Math.floor(r * a.length) % a.length]; }

function limb(len, r0, r1, mat) {
  // cylinder along -y from the pivot
  const g = new THREE.CylinderGeometry(r1, r0, len, 8).translate(0, -len / 2, 0);
  return new THREE.Mesh(g, mat);
}

function hand(skinMat) {
  const g = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), skinMat);
  palm.scale.set(0.045, 0.03, 0.06);
  g.add(palm);
  for (let f = 0; f < 4; f++) {
    const fg = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.01, 0.06, 6), skinMat);
    fg.position.set(-0.03 + f * 0.02, -0.025, 0.045);
    fg.rotation.x = 1.2;
    g.add(fg);
  }
  const th = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.05, 6), skinMat);
  th.position.set(0.045, 0, 0.02); th.rotation.z = 0.9;
  g.add(th);
  return g;
}

// A seated passenger in cart-local coordinates (cart forward = -z)
function passenger(sx, row, seed, self = false) {
  let r = seed;
  const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  const skin = new THREE.MeshStandardMaterial({ color: pick(SKIN, rnd()), roughness: 0.7 });
  const shirt = new THREE.MeshStandardMaterial({ color: pick(SHIRT, rnd()), roughness: 0.85 });
  const pants = new THREE.MeshStandardMaterial({ color: rnd() < 0.5 ? 0x2b3a55 : 0x3a3a3a, roughness: 0.9 });
  const hairM = new THREE.MeshStandardMaterial({ color: pick(HAIR, rnd()), roughness: 0.9 });
  const root = new THREE.Group();
  root.position.set(sx, 0.78, row + 0.1);
  const P = { root, arms: [], self, upBias: rnd() * 0.4, phase: rnd() * 6, up: 0 };

  // legs: thighs forward along the seat, shins down
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.1, 0.06, -0.05);
    hip.rotation.x = Math.PI / 2 - 0.15; // thigh points forward
    hip.add(limb(0.44, 0.075, 0.06, pants));
    const knee = new THREE.Group();
    knee.position.y = -0.44; knee.rotation.x = -1.35; hip.add(knee);
    knee.add(limb(0.4, 0.055, 0.045, pants));
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.24), new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.6 }));
    shoe.position.set(0, -0.42, 0.05);
    knee.add(shoe);
    root.add(hip);
  }
  if (!self) {
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.52, 10).translate(0, 0.26, 0), shirt);
    torso.scale.z = 0.75;
    torso.rotation.x = 0.12;
    root.add(torso);
    const neck = new THREE.Group();
    neck.position.set(0, 0.55, 0.05);
    root.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), skin);
    head.position.y = 0.13; head.scale.set(0.9, 1.05, 1);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.118, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairM);
    hair.position.y = 0.14; hair.rotation.x = 0.35;
    neck.add(head, hair);
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1010, roughness: 0.5 });
    for (const e of [-0.04, 0.04]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), dark);
      eye.position.set(e, 0.15, -0.098);
      neck.add(eye);
    }
    const mouth = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshStandardMaterial({ color: 0x5a1a1a, roughness: 0.6 }));
    mouth.position.set(0, 0.085, -0.095);
    mouth.scale.set(0.028, 0.008, 0.012);
    neck.add(mouth);
    P.neck = neck; P.mouth = mouth;
  }
  // arms: shoulder pivot -> upper arm -> elbow -> forearm -> hand
  for (const s of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(s * 0.21, 0.48, 0.02);
    const upper = limb(0.28, 0.05, 0.042, shirt);
    upper.visible = !self; // the rider's own upper arms would fill the view
    sh.add(upper);
    const el = new THREE.Group(); el.position.y = -0.28; sh.add(el);
    el.add(limb(0.26, 0.04, 0.032, self ? shirt : skin));
    const h = hand(skin); h.position.y = -0.3; h.rotation.x = Math.PI; el.add(h);
    root.add(sh);
    P.arms.push({ sh, el, s });
  }
  if (self) {
    // the rider's own body: only what can be seen from the eyes (no torso/head to clip the camera)
    P.arms.forEach(a => { a.sh.position.z = -0.02; });
  }
  root.traverse(o => { if (o.isMesh) { o.castShadow = !self; o.receiveShadow = true; } });
  return P;
}

// Pose an arm: k = 0 hands on the lap bar, k = 1 arms thrown up
function poseArm(a, k, t, ph) {
  const s = a.s;
  // hold the bar
  const shX0 = 0.55, shZ0 = 0, elX0 = 0.55;
  // arms up (V shape)
  const shX1 = 2.85 + Math.sin(t * 3 + ph) * 0.12, shZ1 = s * 0.45, elX1 = 0.2;
  a.sh.rotation.x = shX0 + (shX1 - shX0) * k;
  a.sh.rotation.z = shZ0 + (shZ1 - shZ0) * k;
  a.el.rotation.x = elX0 + (elX1 - elX0) * k;
}

export class Riders {
  constructor(carts, high) {
    this.list = [];
    let seed = 1234;
    const seatsFront = [[0.38, -0.35], [-0.38, 0.65], [0.38, 0.65]];
    seatsFront.forEach(([x, z]) => { const p = passenger(x, z, seed += 977); carts.front.add(p.root); this.list.push(p); });
    if (high) {
      [[-0.38, -0.35], [0.38, -0.35], [-0.38, 0.65], [0.38, 0.65]].forEach(([x, z]) => {
        const p = passenger(x, z, seed += 977); carts.back.add(p.root); this.list.push(p);
      });
    }
    this.self = passenger(-0.38, -0.35, 4242, true);
    carts.front.add(this.self.root);
    this.t = 0;
  }

  // k: 0..1 excitement (arms up), head: {x,y} inertia offsets in radians
  update(dt, excite, head) {
    this.t += dt;
    for (const p of this.list) {
      const want = THREE.MathUtils.clamp(excite * 1.3 - p.upBias, 0, 1);
      p.up += (want - p.up) * Math.min(1, dt * (want > p.up ? 5 : 2));
      p.arms.forEach(a => poseArm(a, p.up, this.t, p.phase + a.s));
      if (p.mouth) p.mouth.scale.y = 0.008 + p.up * 0.03;
      if (p.neck) {
        p.neck.rotation.x = head.pitch * 1.4 + Math.sin(this.t * 1.7 + p.phase) * 0.03;
        p.neck.rotation.z = head.roll * 1.4;
        p.neck.rotation.y = Math.sin(this.t * 0.4 + p.phase) * 0.25 * (1 - excite);
      }
    }
    // own hands stay clamped on the bar, they just jiggle with the ride
    this.self.arms.forEach(a => poseArm(a, 0, this.t, 0));
    this.self.arms.forEach(a => { a.sh.rotation.x += head.pitch * 0.4; });
  }

  // world positions of the other passengers' heads (for screams)
  heads(out = []) {
    out.length = 0;
    for (const p of this.list) {
      const v = new THREE.Vector3(0, 0.65, 0);
      p.root.localToWorld(v);
      out.push(v);
    }
    return out;
  }
}

// Spring-damper head that lags behind the cart's acceleration
export class HeadInertia {
  constructor() {
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.rot = { pitch: 0, roll: 0, vp: 0, vr: 0 };
    this.prevVel = new THREE.Vector3();
    this.f = new THREE.Vector3();
    this.first = true;
  }
  reset() { this.first = true; this.pos.set(0, 0, 0); this.vel.set(0, 0, 0); this.rot = { pitch: 0, roll: 0, vp: 0, vr: 0 }; }
  // T,R,U: cart frame; v: speed. Returns local offsets.
  update(dt, T, R, U, v, scale = 1) {
    if (dt <= 0) return;
    const vel = T.clone().multiplyScalar(v);
    if (this.first) { this.prevVel.copy(vel); this.first = false; }
    const acc = vel.clone().sub(this.prevVel).divideScalar(dt);
    this.prevVel.copy(vel);
    // specific force felt by the rider (acceleration minus gravity)
    acc.y += 9.81;
    this.f.lerp(acc, Math.min(1, dt * 8)); // smooth numeric noise
    const fx = this.f.dot(R), fy = this.f.dot(U) - 9.81, fz = this.f.dot(T);
    // target displacement: head lags opposite to the felt push. Camera local: x=R, y=U, z=-T
    const tx = THREE.MathUtils.clamp(-fx * 0.006, -0.12, 0.12) * scale;
    const ty = THREE.MathUtils.clamp(-fy * 0.0045, -0.08, 0.1) * scale;
    const tz = THREE.MathUtils.clamp(fz * 0.007, -0.1, 0.14) * scale;
    const k = 70, c = 9;
    this.vel.x += ((tx - this.pos.x) * k - this.vel.x * c) * dt;
    this.vel.y += ((ty - this.pos.y) * k - this.vel.y * c) * dt;
    this.vel.z += ((tz - this.pos.z) * k - this.vel.z * c) * dt;
    this.pos.addScaledVector(this.vel, dt);
    // rotations: launch tips the head back, braking forward, corners lean
    const tp = THREE.MathUtils.clamp(fz * 0.012, -0.14, 0.16) * scale;
    const tr = THREE.MathUtils.clamp(fx * 0.01, -0.14, 0.14) * scale;
    const r = this.rot;
    r.vp += ((tp - r.pitch) * 60 - r.vp * 8) * dt; r.pitch += r.vp * dt;
    r.vr += ((tr - r.roll) * 60 - r.vr * 8) * dt; r.roll += r.vr * dt;
  }
}
