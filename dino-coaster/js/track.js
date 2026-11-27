// Coaster layout, physics pre-simulation, banking and track geometry
import * as THREE from 'three';
import { smoothstep, clamp } from './noise.js';

const G = 9.81;

// ---- Layout (x, y, z). y is absolute height in metres. ----
function helixPoints() {
  const pts = [];
  const C = [-130, 175];
  const steps = 15;
  for (let k = 0; k <= steps; k++) {
    const th = (90 + k * 30) * Math.PI / 180;
    const R = 30 - 10 * (k / steps);
    const y = 18 - 11 * (k / steps);
    pts.push([C[0] + R * Math.cos(th), y, C[1] + R * Math.sin(th)]);
  }
  return pts;
}

const RAW = [];
const IDX = {};
function add(name, p) { if (name) IDX[name] = RAW.length; RAW.push(p); }
add('station0', [-70, 6, 0]);
add('stationStop', [-40, 6, 0]);
add('liftStart', [-15, 6, 0]);
add(null, [10, 9, 0]);
add(null, [32, 23, 0]);
add(null, [54, 37, 0]);
add(null, [76, 51, 0]);
add('liftTop', [92, 61, 0]);
add('crest', [103, 63.5, 0]);
add(null, [111, 61.5, 0]);
add('hold', [116.5, 56.5, 0.3]);
add(null, [120.5, 44, 0.8]);
add(null, [125.8, 27.5, 1.5]);
add(null, [130.6, 18, 2.5]);
add(null, [138.1, 10.5, 4]);
add(null, [147.6, 5.7, 6]);
add('dropBottom', [158.1, 4, 9]);
add('rexValley', [175, 4.5, 18]);
add(null, [195, 8, 42]);
add(null, [206, 17, 70]);
add('hill', [200, 25, 96]);
add(null, [182, 13, 118]);
add(null, [160, 5, 135]);
add('splash', [138, 1.3, 147]);
add('splash2', [118, 1.3, 156]);
add(null, [98, 3, 166]);
add('lift2Start', [78, 7, 176]);
add(null, [58, 15, 186]);
add('brachio', [38, 23, 196]);
add(null, [18, 28, 204]);
add('lift2Top', [0, 29.5, 210]);
add(null, [-16, 26, 214]);
add(null, [-32, 12, 218]);
add('trike', [-52, 6, 218]);
add(null, [-75, 7, 212]);
add('helixIn', [-100, 13, 205]);
{
  const hp = helixPoints();
  hp.forEach((p, i) => add(i === 0 ? 'helix0' : i === hp.length - 1 ? 'helixOut' : null, p));
}
add('raptor0', [-175, 6, 155]);
add(null, [-180, 5, 122]);
add('raptor1', [-174, 5, 88]);
add(null, [-166, 5, 52]);
add('tunnelIn', [-162, 5, 20]);
add(null, [-158, 5, -10]);
add('tunnelOut', [-150, 5, -40]);
add(null, [-138, 7, -64]);
add(null, [-123, 13, -83]);
add('carno', [-104, 19, -98]);
add(null, [-84, 14, -107]);
add(null, [-64, 16, -109]);
add('trim', [-46, 12, -105]);
add(null, [-26, 4, -98]);
add('finalRex', [-6, 2.5, -94]);
add(null, [16, 6, -90]);
add(null, [44, 9, -82]);
add(null, [72, 9, -64]);
add(null, [82, 8, -38]);
add('brake', [64, 7, -16]);
add(null, [28, 6, -22]);
add(null, [-15, 6, -34]);
add('brake2', [-50, 6, -36]);
add(null, [-85, 6, -30]);
add(null, [-104, 6, -16]);
add(null, [-98, 6, -3]);

export const CP_INDEX = IDX;

export class Track {
  constructor() {
    const pts = RAW.map(p => new THREE.Vector3(p[0], p[1], p[2]));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
    this.curve.arcLengthDivisions = 8000;
    this.length = this.curve.getLength();
    this.ds = 0.5;
    this.n = Math.floor(this.length / this.ds);
    this.ds = this.length / this.n;
    const n = this.n;
    this.P = new Float32Array(n * 3);
    this.T = new Float32Array(n * 3);
    this.R = new Float32Array(n * 3);
    this.U = new Float32Array(n * 3);
    this.V = new Float32Array(n);
    this.GV = new Float32Array(n);
    this.zone = new Uint8Array(n); // 0 free,1 station,2 lift,3 drive,4 launch,5 brake
    const tmp = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      this.curve.getPointAt(i / n, tmp);
      this.P[i * 3] = tmp.x; this.P[i * 3 + 1] = tmp.y; this.P[i * 3 + 2] = tmp.z;
    }
    // tangents
    for (let i = 0; i < n; i++) {
      const a = ((i - 1 + n) % n) * 3, b = ((i + 1) % n) * 3;
      let x = this.P[b] - this.P[a], y = this.P[b + 1] - this.P[a + 1], z = this.P[b + 2] - this.P[a + 2];
      const l = Math.hypot(x, y, z);
      this.T[i * 3] = x / l; this.T[i * 3 + 1] = y / l; this.T[i * 3 + 2] = z / l;
    }
    // control point s positions
    this.cpS = RAW.map(p => this.nearestS(p[0], p[1], p[2]));
    this.sOf = name => this.cpS[IDX[name]];
    this._zones();
    this._simulate();
    this._frames();
  }

  nearestS(x, y, z) {
    let best = 1e18, bi = 0;
    for (let i = 0; i < this.n; i++) {
      const dx = this.P[i * 3] - x, dy = this.P[i * 3 + 1] - y, dz = this.P[i * 3 + 2] - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best) { best = d; bi = i; }
    }
    return bi * this.ds;
  }

  _zones() {
    const s = this.sOf, ds = this.ds;
    const mark = (a, b, z) => {
      const i0 = Math.round(a / ds), i1 = Math.round(b / ds);
      for (let i = i0; i <= i1; i++) this.zone[((i % this.n) + this.n) % this.n] = z;
    };
    this.ranges = {
      lift1: [s('liftStart') + 6, s('liftTop') + 4],
      lift2: [s('lift2Start'), s('lift2Top') + 2],
      drive: [s('helixOut') + 10, s('tunnelOut')],
      launch: [s('tunnelOut'), s('tunnelOut') + 50],
      roll: [s('tunnelOut') + 56, s('tunnelOut') + 100],
      trim: [s('trim') - 22, s('trim') - 6],
      brake: [s('brake'), this.length],
      station: [0, s('liftStart') + 6],
      tunnel: [s('tunnelIn') - 6, s('tunnelOut') + 4],
    };
    const r = this.ranges;
    mark(r.brake[0], r.brake[1] - ds, 5);
    mark(r.station[0], r.station[1], 1);
    mark(r.lift1[0], r.lift1[1], 2);
    mark(r.lift2[0], r.lift2[1], 2);
    mark(r.drive[0], r.drive[1], 3);
    mark(r.launch[0], r.launch[1], 4);
    mark(r.trim[0], r.trim[1], 6);
  }

  _simulate() {
    const n = this.n, ds = this.ds;
    const startI = Math.round(this.sOf('stationStop') / ds);
    const brake2 = this.sOf('brake2');
    let v = 2.5;
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < n; k++) {
        const i = (startI + k) % n, j = (i + 1) % n;
        const dy = this.P[j * 3 + 1] - this.P[i * 3 + 1];
        let v2 = v * v - 2 * G * dy - 2 * (0.011 * G + 0.0008 * v * v) * ds;
        let nv = Math.sqrt(Math.max(v2, 0.01));
        const z = this.zone[j];
        if (z === 1) nv = 2.6;
        else if (z === 2) nv = 4.8;
        else if (z === 3) nv = 12.5;
        else if (z === 4) nv = Math.min(30, Math.sqrt(v * v + 2 * 14 * ds));
        else if (z === 6) nv = Math.max(14, Math.min(nv, Math.sqrt(Math.max(v * v - 2 * 6 * ds, 0))));
        else if (z === 5) {
          const target = j * ds > brake2 ? 3.2 : 7.5;
          nv = Math.max(target, Math.min(nv, Math.sqrt(Math.max(v * v - 2 * 4.5 * ds, 0))));
        } else nv = Math.max(nv, 6.5);
        v = nv;
        this.V[j] = v;
      }
    }
  }

  _frames() {
    const n = this.n, ds = this.ds;
    const bank = new Float32Array(n);
    const R0 = new Float32Array(n * 3), U0 = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const tx = this.T[i * 3], ty = this.T[i * 3 + 1], tz = this.T[i * 3 + 2];
      // right = T x Y
      let rx = -tz, rz = tx;
      const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
      // up = R x T
      const ux = 0 * tz - rz * ty, uy = rz * tx - rx * tz, uz = rx * ty - 0 * tx;
      R0[i * 3] = rx; R0[i * 3 + 1] = 0; R0[i * 3 + 2] = rz;
      U0[i * 3] = ux; U0[i * 3 + 1] = uy; U0[i * 3 + 2] = uz;
    }
    const k = 4; // finite difference half width in samples
    for (let i = 0; i < n; i++) {
      const a = ((i - k + n) % n) * 3, b = ((i + k) % n) * 3;
      const dTx = (this.T[b] - this.T[a]) / (2 * k * ds);
      const dTz = (this.T[b + 2] - this.T[a + 2]) / (2 * k * ds);
      const kap = dTx * R0[i * 3] + dTz * R0[i * 3 + 2];
      const v = this.V[i];
      let b0 = Math.atan(v * v * kap / G);
      const z = this.zone[i];
      if (z === 1 || z === 2) b0 *= 0.3;
      bank[i] = clamp(b0, -1.2, 1.2);
    }
    // smooth bank
    let src = bank, dst = new Float32Array(n);
    const W = 16;
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < n; i++) {
        let s = 0, w = 0;
        for (let o = -W; o <= W; o++) {
          const ww = W + 1 - Math.abs(o);
          s += src[(i + o + n) % n] * ww; w += ww;
        }
        dst[i] = s / w;
      }
      const t = src; src = dst; dst = t;
    }
    // zero-g heartline roll: one full barrel roll on top of the banking
    {
      const [r0, r1] = this.ranges.roll;
      for (let i = 0; i < n; i++) {
        const sp = i * ds;
        if (sp < r0 || sp > r1) continue;
        const t = (sp - r0) / (r1 - r0);
        src[i] += Math.PI * 2 * (t * t * (3 - 2 * t));
      }
    }
    this.bank = src;
    for (let i = 0; i < n; i++) {
      const b = src[i], c = Math.cos(b), s = Math.sin(b);
      for (let q = 0; q < 3; q++) {
        const r = R0[i * 3 + q], u = U0[i * 3 + q];
        this.R[i * 3 + q] = r * c - u * s;
        this.U[i * 3 + q] = u * c + r * s;
      }
    }
    // felt vertical g
    for (let i = 0; i < n; i++) {
      const a = ((i - k + n) % n) * 3, b = ((i + k) % n) * 3;
      const v = this.V[i];
      let gv = 0;
      for (let q = 0; q < 3; q++) {
        const dT = (this.T[b + q] - this.T[a + q]) / (2 * k * ds);
        gv += v * v * dT * this.U[i * 3 + q];
      }
      gv += G * this.U[i * 3 + 1];
      this.GV[i] = gv / G;
    }
  }

  wrap(s) { return ((s % this.length) + this.length) % this.length; }

  // Interpolated sample: out = {p,t,r,u (Vector3), v, gv, zone}
  sample(s, out) {
    s = this.wrap(s);
    const f = s / this.ds;
    const i0 = Math.floor(f) % this.n, i1 = (i0 + 1) % this.n, t = f - Math.floor(f);
    const L = (arr, vec) => {
      vec.set(
        arr[i0 * 3] + (arr[i1 * 3] - arr[i0 * 3]) * t,
        arr[i0 * 3 + 1] + (arr[i1 * 3 + 1] - arr[i0 * 3 + 1]) * t,
        arr[i0 * 3 + 2] + (arr[i1 * 3 + 2] - arr[i0 * 3 + 2]) * t);
      return vec;
    };
    L(this.P, out.p);
    L(this.T, out.t).normalize();
    L(this.R, out.r).normalize();
    L(this.U, out.u).normalize();
    out.v = this.V[i0] + (this.V[i1] - this.V[i0]) * t;
    out.gv = this.GV[i0] + (this.GV[i1] - this.GV[i0]) * t;
    out.zone = this.zone[i0];
    return out;
  }

  inRange(s, name) {
    const r = this.ranges[name];
    s = this.wrap(s);
    return s >= r[0] && s <= r[1];
  }

  // Horizontal spatial hash of samples for distance queries
  buildHash(cell = 10) {
    this.hashCell = cell;
    this.hash = new Map();
    for (let i = 0; i < this.n; i += 2) {
      const key = Math.floor(this.P[i * 3] / cell) + ',' + Math.floor(this.P[i * 3 + 2] / cell);
      let a = this.hash.get(key);
      if (!a) { a = []; this.hash.set(key, a); }
      a.push(i);
    }
  }

  // nearest sample horizontally within radius; returns {d, i} or null
  nearestXZ(x, z, radius = 20) {
    const c = this.hashCell;
    const cx = Math.floor(x / c), cz = Math.floor(z / c);
    const rr = Math.ceil(radius / c);
    let best = radius * radius, bi = -1;
    for (let dx = -rr; dx <= rr; dx++)
      for (let dz = -rr; dz <= rr; dz++) {
        const a = this.hash.get((cx + dx) + ',' + (cz + dz));
        if (!a) continue;
        for (const i of a) {
          const ex = this.P[i * 3] - x, ez = this.P[i * 3 + 2] - z;
          const d = ex * ex + ez * ez;
          if (d < best) { best = d; bi = i; }
        }
      }
    return bi < 0 ? null : { d: Math.sqrt(best), i: bi };
  }

  // any sample within radius horizontally whose height is in [y0,y1]
  anyBelow(x, z, radius, y0, y1) {
    const c = this.hashCell;
    const cx = Math.floor(x / c), cz = Math.floor(z / c);
    const rr = Math.ceil(radius / c);
    for (let dx = -rr; dx <= rr; dx++)
      for (let dz = -rr; dz <= rr; dz++) {
        const a = this.hash.get((cx + dx) + ',' + (cz + dz));
        if (!a) continue;
        for (const i of a) {
          const ex = this.P[i * 3] - x, ez = this.P[i * 3 + 2] - z, y = this.P[i * 3 + 1];
          if (ex * ex + ez * ez < radius * radius && y > y0 && y < y1) return true;
        }
      }
    return false;
  }
}

// ---------------- Geometry ----------------

function sweepGeometry(track, opts) {
  const { offR = 0, offU = 0, radius = 0.1, radial = 8, step = 2, s0 = 0, s1 = track.length, closed = false, squashU = 1 } = opts;
  const pos = [], nor = [], idx = [];
  const i0 = Math.round(s0 / track.ds), i1 = Math.round(s1 / track.ds);
  const rings = [];
  for (let i = i0; i <= i1; i += step) rings.push(((i % track.n) + track.n) % track.n);
  if (closed) rings.pop();
  const P = track.P, R = track.R, U = track.U;
  for (const i of rings) {
    const cx = P[i * 3] + R[i * 3] * offR + U[i * 3] * offU;
    const cy = P[i * 3 + 1] + R[i * 3 + 1] * offR + U[i * 3 + 1] * offU;
    const cz = P[i * 3 + 2] + R[i * 3 + 2] * offR + U[i * 3 + 2] * offU;
    for (let j = 0; j <= radial; j++) {
      const a = j / radial * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a) * squashU;
      const nx = R[i * 3] * ca + U[i * 3] * sa, ny = R[i * 3 + 1] * ca + U[i * 3 + 1] * sa, nz = R[i * 3 + 2] * ca + U[i * 3 + 2] * sa;
      pos.push(cx + nx * radius, cy + ny * radius, cz + nz * radius);
      const l = Math.hypot(nx, ny, nz);
      nor.push(nx / l, ny / l, nz / l);
    }
  }
  const nr = rings.length, rl = radial + 1;
  const segs = closed ? nr : nr - 1;
  for (let k = 0; k < segs; k++) {
    const a = k * rl, b = ((k + 1) % nr) * rl;
    for (let j = 0; j < radial; j++) {
      idx.push(a + j, b + j, a + j + 1, a + j + 1, b + j, b + j + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

export function buildTrackMeshes(track, world, q) {
  const group = new THREE.Group();
  const railMat = new THREE.MeshStandardMaterial({ color: 0xd2571c, metalness: 0.55, roughness: 0.38 });
  const spineMat = new THREE.MeshStandardMaterial({ color: 0xb84a18, metalness: 0.5, roughness: 0.45 });
  const tieMat = new THREE.MeshStandardMaterial({ color: 0x3b3d3a, metalness: 0.6, roughness: 0.5 });
  const supMat = new THREE.MeshStandardMaterial({ color: 0x3d4f3a, metalness: 0.35, roughness: 0.6 });
  const L = track.length;

  for (const side of [-1, 1]) {
    const g = sweepGeometry(track, { offR: side * 0.56, offU: 0.02, radius: 0.075, radial: 8, step: 2, closed: true, s1: L });
    const m = new THREE.Mesh(g, railMat);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }
  const spine = new THREE.Mesh(sweepGeometry(track, { offU: -0.58, radius: 0.3, radial: 10, step: 2, closed: true, s1: L }), spineMat);
  spine.castShadow = true; spine.receiveShadow = true;
  group.add(spine);

  // lift chain
  const chainMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, metalness: 0.8, roughness: 0.35 });
  for (const key of ['lift1', 'lift2']) {
    const r = track.ranges[key];
    group.add(new THREE.Mesh(sweepGeometry(track, { offU: -0.05, radius: 0.06, radial: 6, step: 2, s0: r[0], s1: r[1] }), chainMat));
  }

  // ties + struts (instanced)
  const tieGeo = new THREE.BoxGeometry(1.32, 0.12, 0.16);
  const strutGeo = new THREE.BoxGeometry(0.12, 0.5, 0.12);
  const tieStep = 1.2;
  const count = Math.floor(L / tieStep);
  const ties = new THREE.InstancedMesh(tieGeo, tieMat, count);
  const struts = new THREE.InstancedMesh(strutGeo, tieMat, count * 2);
  const smp = { p: new THREE.Vector3(), t: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3() };
  const m4 = new THREE.Matrix4(), back = new THREE.Vector3();
  for (let k = 0; k < count; k++) {
    track.sample(k * tieStep, smp);
    back.copy(smp.t).negate();
    m4.makeBasis(smp.r, smp.u, back);
    m4.setPosition(smp.p.x - smp.u.x * 0.1, smp.p.y - smp.u.y * 0.1, smp.p.z - smp.u.z * 0.1);
    ties.setMatrixAt(k, m4);
    for (const sd of [-1, 1]) {
      m4.makeBasis(smp.r, smp.u, back);
      const px = smp.p.x + smp.r.x * sd * 0.35 - smp.u.x * 0.38;
      const py = smp.p.y + smp.r.y * sd * 0.35 - smp.u.y * 0.38;
      const pz = smp.p.z + smp.r.z * sd * 0.35 - smp.u.z * 0.38;
      const rot = new THREE.Matrix4().makeRotationZ(sd * 0.6);
      m4.multiply(rot);
      m4.setPosition(px, py, pz);
      struts.setMatrixAt(k * 2 + (sd > 0 ? 1 : 0), m4);
    }
  }
  ties.castShadow = true; ties.receiveShadow = true;
  struts.castShadow = true;
  group.add(ties, struts);

  // supports
  const supGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).translate(0, 0.5, 0);
  const footGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const capGeo = new THREE.CylinderGeometry(1, 1, 1, 10).translate(0, 0.5, 0);
  const sups = [], foots = [];
  const supStep = 9;
  for (let s = 0; s < L; s += supStep) {
    if (track.inRange(s, 'tunnel')) continue;
    if (s > track.ranges.roll[0] - 4 && s < track.ranges.roll[1] + 4) continue;
    if (track.inRange(s, 'station') && s < track.sOf('liftStart')) continue;
    if (s > track.sOf('brake2') + 25) continue; // station approach on ground
    track.sample(s, smp);
    const bx = smp.p.x - smp.u.x * 0.85, by = smp.p.y - smp.u.y * 0.85, bz = smp.p.z - smp.u.z * 0.85;
    const gy = world.heightAt(bx, bz);
    const h = by - gy;
    if (h < 0.6) continue;
    // avoid passing through a lower track section
    if (track.anyBelow(bx, bz, 2.6, gy - 1, by - 2.5)) continue;
    const r = 0.22 + Math.min(h, 50) * 0.01;
    sups.push([bx, gy - 0.4, bz, r, h + 0.4]);
    foots.push([bx, gy - 0.5, bz, r * 3.2]);
  }
  const supMesh = new THREE.InstancedMesh(supGeo, supMat, sups.length);
  const capMesh = new THREE.InstancedMesh(capGeo, supMat, sups.length);
  const footMesh = new THREE.InstancedMesh(footGeo, new THREE.MeshStandardMaterial({ color: 0x8a867c, roughness: 0.9 }), foots.length);
  sups.forEach((s, i) => {
    m4.makeScale(s[3], s[4], s[3]); m4.setPosition(s[0], s[1], s[2]);
    supMesh.setMatrixAt(i, m4);
    m4.makeScale(s[3] * 1.4, 0.25, s[3] * 1.4); m4.setPosition(s[0], s[1] + s[4] - 0.25, s[2]);
    capMesh.setMatrixAt(i, m4);
  });
  foots.forEach((f, i) => { m4.makeScale(f[3], 0.9, f[3]); m4.setPosition(f[0], f[1], f[2]); footMesh.setMatrixAt(i, m4); });
  supMesh.castShadow = q.high; supMesh.receiveShadow = true;
  footMesh.receiveShadow = true;
  group.add(supMesh, capMesh, footMesh);
  group.userData.supports = sups;
  return group;
}

// ---------------- Cart ----------------
export function buildCart(texSet) {
  const make = (isFront) => {
    const g = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color: 0xe8a21c, metalness: 0.35, roughness: 0.35 });
    const paintDark = new THREE.MeshStandardMaterial({ color: 0x2a2f24, metalness: 0.3, roughness: 0.5 });
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x2a1a14, roughness: 0.55 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xcfd3d6, metalness: 1.0, roughness: 0.18 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });

    // body shell: side profile extruded across width (x)
    const len = 2.5;
    const sh = new THREE.Shape();
    sh.moveTo(-len / 2, 0.22);
    sh.lineTo(len / 2 - 0.2, 0.22);
    if (isFront) { sh.quadraticCurveTo(len / 2 + 0.35, 0.3, len / 2 + 0.25, 0.85); sh.lineTo(len / 2 - 0.15, 1.0); }
    else { sh.lineTo(len / 2, 0.75); }
    sh.lineTo(-len / 2 + 0.1, 0.78);
    sh.lineTo(-len / 2, 0.22);
    const ext = new THREE.ExtrudeGeometry(sh, { depth: 1.62, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 3, curveSegments: 10 });
    ext.translate(0, 0, -0.81);
    // shape is in (x=z-forward?, y). rotate so shape x -> -z (forward), extrude z -> x (right)
    ext.rotateY(Math.PI / 2);
    // after rotateY(+90): x->-z ... shape x (forward) becomes -z, good (forward = -z)
    const body = new THREE.Mesh(ext, paint);
    body.castShadow = true; body.receiveShadow = true;
    g.add(body);

    // stripes along the sides
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.08, 2.3), paintDark);
    stripe.position.set(0, 0.45, 0.0);
    g.add(stripe);

    // seats (two rows)
    for (const row of [-0.35, 0.65]) {
      for (const sx of [-0.38, 0.38]) {
        const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 0.55), seatMat);
        cushion.position.set(sx, 0.72, row);
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.1), seatMat);
        back.position.set(sx, 0.98, row + 0.3);
        back.rotation.x = -0.15;
        g.add(cushion, back);
        // lap bar (U shape)
        const bar = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.035, 8, 20, Math.PI), chrome);
        bar.rotation.x = Math.PI / 2 + 0.25;
        bar.position.set(sx, 0.86, row - 0.3);
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.44, 10), rubber);
        pad.rotation.z = Math.PI / 2;
        pad.position.set(sx, 0.8, row - 0.52);
        g.add(bar, pad);
      }
    }
    // grab handle at front cowl
    if (isFront) {
      const h = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.03, 8, 24, Math.PI), chrome);
      h.position.set(0, 1.0, -1.0);
      h.rotation.x = -0.3;
      g.add(h);
      // headlights
      for (const sx of [-0.5, 0.5]) {
        const l = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffe6a0, emissiveIntensity: 2 }));
        l.position.set(sx, 0.6, -1.5);
        g.add(l);
      }
      // dino claw marks on cowl
      if (texSet && texSet.claw) {
        const decal = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshStandardMaterial({ map: texSet.claw, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
        decal.position.set(0.55, 0.62, -1.43);
        decal.rotation.y = 0.0;
        decal.rotation.x = -0.25;
        g.add(decal);
      }
    }
    // wheels/bogies
    for (const zz of [-0.8, 0.8]) for (const sx of [-0.56, 0.56]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 14), rubber);
      w.rotation.z = Math.PI / 2;
      w.position.set(sx, 0.16, zz);
      g.add(w);
      const w2 = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 12), rubber);
      w2.rotation.z = Math.PI / 2;
      w2.position.set(sx, -0.14, zz);
      g.add(w2);
    }
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.14, 2.0), paintDark);
    chassis.position.y = 0.12;
    g.add(chassis);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  };
  return { front: make(true), back: make(false) };
}
