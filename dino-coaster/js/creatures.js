// Procedural, skinned & animated dinosaurs
import * as THREE from 'three';
import * as TX from './textures.js';
import { mergeGeos } from './world.js';
import { clamp, lerp, makeNoise2D } from './noise.js';
const skinNoise = makeNoise2D(77);

// ---------- geometry helpers ----------
function cr(a, b, c, d, t) {
  return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
}
// stations: [z, y, rx, ryT, ryB]; t in [0,1] along station index
function interp(st, t) {
  const n = st.length;
  const f = clamp(t, 0, 1) * (n - 1);
  const i = Math.min(Math.floor(f), n - 2);
  const u = f - i;
  const p0 = st[Math.max(i - 1, 0)], p1 = st[i], p2 = st[i + 1], p3 = st[Math.min(i + 2, n - 1)];
  const o = [];
  for (let k = 0; k < 5; k++) o.push(cr(p0[k], p1[k], p2[k], p3[k], u));
  for (let k = 2; k < 5; k++) o[k] = Math.max(o[k], 0.004);
  return o;
}

/*
 Loft a body along a spine curve in the z-y plane. Cross sections are
 perpendicular to the spine, so necks can rise steeply.
 Returns geometry plus per-vertex spine parameter.
*/
function loft(st, o = {}) {
  const nA = o.along || 40, nR = o.around || 16;
  const narrow = o.narrow ?? 0.18;
  const rings = [];
  for (let i = 0; i <= nA; i++) rings.push(interp(st, i / nA));
  // arc length
  const arc = [0];
  for (let i = 1; i <= nA; i++) arc.push(arc[i - 1] + Math.hypot(rings[i][0] - rings[i - 1][0], rings[i][1] - rings[i - 1][1]));
  const total = arc[nA] || 1;
  const pos = [], uv = [], prm = [];
  for (let i = 0; i <= nA; i++) {
    const a = rings[Math.max(i - 1, 0)], b = rings[Math.min(i + 1, nA)];
    let tz = b[0] - a[0], ty = b[1] - a[1];
    const tl = Math.hypot(tz, ty) || 1; tz /= tl; ty /= tl;
    const upY = tz, upZ = -ty;
    const [zc, yc, rx, ryT, ryB] = rings[i];
    for (let j = 0; j <= nR; j++) {
      const th = j / nR * Math.PI * 2;
      const s = Math.sin(th), c = Math.cos(th);
      let x = rx * s * (1 - narrow * Math.max(0, c));
      let off = (c >= 0 ? ryT : ryB) * c;
      if (o.bump) {
        // muscle bulges, skin folds and lumpy scutes break the perfect tube silhouette
        const along = arc[i];
        const m = 1 + o.bump * (0.55 * skinNoise(along * 1.6, th * 1.3) + 0.3 * skinNoise(along * 5, th * 4)
          + 0.25 * Math.pow(Math.abs(Math.sin(along * 9)), 6) * Math.max(0, -c * 0.5 + 0.5) * -1);
        x *= m; off *= m;
      }
      pos.push(x, yc + upY * off, zc + upZ * off);
      uv.push((o.uOffset || 0) + (o.uScale ?? 1) * arc[i] / total, j / nR * (o.vScale || 1));
      prm.push(i / nA);
    }
  }
  const idx = [];
  for (let i = 0; i < nA; i++)
    for (let j = 0; j < nR; j++) {
      const a = i * (nR + 1) + j, b = a + nR + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // weld seam normals
  const n = g.attributes.normal;
  for (let i = 0; i <= nA; i++) {
    const a = i * (nR + 1), b = a + nR;
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
  }
  g.userData.param = prm;
  g.userData.rings = rings;
  g.userData.total = total;
  return g;
}

// Limb along -y. stations along length: [d, fwdOffset, rx, rFwd, rBack]
function limbGeo(st, o = {}) {
  const g = loft(st, { along: o.along || 10, around: o.around || 10, narrow: 0, uScale: o.uScale ?? 0.15, uOffset: o.uOffset ?? 0.4 });
  g.rotateX(Math.PI / 2); // +z -> -y, +y -> +z
  return g;
}

function coneGeo(r, h, seg = 6) { return new THREE.ConeGeometry(r, h, seg, 1); }

// sample stations by z (stations monotonic in z)
function atZ(st, z) {
  let best = null, bd = 1e9;
  for (let k = 0; k <= 120; k++) {
    const s = interp(st, k / 120);
    const d = Math.abs(s[0] - z);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

function teeth(st, z0, z1, count, upper, size, curve = 0.25) {
  const gs = [];
  for (let k = 0; k < count; k++) {
    const t = (k + 0.5) / count;
    const z = lerp(z0, z1, t);
    const s = atZ(st, z);
    const h = size * (0.6 + 0.4 * Math.sin(Math.PI * (0.25 + t * 0.6)));
    for (const sd of [-1, 1]) {
      const g = coneGeo(h * 0.28, h, 5);
      // cone points +y; upper teeth point down
      if (upper) g.rotateX(Math.PI + curve); else g.rotateX(-curve);
      const y = upper ? s[1] - s[4] * 0.55 - h * 0.4 : s[1] + s[3] * 0.55 + h * 0.4;
      g.translate(sd * s[2] * 0.84, y, z);
      gs.push(g);
    }
  }
  return mergeGeos(gs);
}

// ---------- materials ----------
const matCache = new Map();
const sharedNormal = { tex: null };
function skinMaterial(key, skin, repeatU = 18, repeatV = 6) {
  const k = key + ':' + repeatU.toFixed(1) + ':' + repeatV.toFixed(1);
  if (matCache.has(k)) return matCache.get(k);
  let base = matCache.get('tex:' + key);
  if (!base) { base = TX.makeSkinTexture(skin); matCache.set('tex:' + key, base); }
  if (!sharedNormal.tex) sharedNormal.tex = TX.makeScaleNormal(3, 14, 2.4);
  const nrm = sharedNormal.tex.clone();
  nrm.needsUpdate = true;
  nrm.repeat.set(repeatU, repeatV);
  const m = new THREE.MeshStandardMaterial({ map: base, normalMap: nrm, normalScale: new THREE.Vector2(0.9, 0.9), roughness: skin.rough ?? 0.74, metalness: 0, envMapIntensity: 0.65 });
  matCache.set(k, m);
  return m;
}
const COMMON = {};
function common() {
  if (COMMON.ready) return COMMON;
  COMMON.claw = new THREE.MeshStandardMaterial({ color: 0x2b241d, roughness: 0.35 });
  COMMON.tooth = new THREE.MeshStandardMaterial({ color: 0xe9dfc5, roughness: 0.3 });
  COMMON.mouth = new THREE.MeshStandardMaterial({ color: 0x4a1514, roughness: 0.45 });
  COMMON.tongue = new THREE.MeshStandardMaterial({ color: 0x8c3a36, roughness: 0.4 });
  COMMON.horn = new THREE.MeshStandardMaterial({ color: 0xcfc3a6, roughness: 0.45 });
  COMMON.beak = new THREE.MeshStandardMaterial({ color: 0x3a3128, roughness: 0.4 });
  COMMON.eyes = {};
  COMMON.ready = true;
  return COMMON;
}
function eyeMat(iris) {
  const c = common();
  const k = iris.join(',');
  if (!c.eyes[k]) c.eyes[k] = new THREE.MeshStandardMaterial({ map: TX.makeEyeTexture(iris), roughness: 0.05, envMapIntensity: 1.6 });
  return c.eyes[k];
}

// ---------- species ----------
export const SPECIES = {
  rex: {
    kind: 'biped', runSpeed: 9, hipHeight: 0, // computed
    skin: { seed: 1, base: [108, 104, 76], dark: [60, 58, 42], belly: [170, 160, 128], stripeFreq: 22, stripeAmt: 0.14, mottle: 0.75, wrinkle: 0.9, backDark: 0.45 },
    body: [
      [-7.4, 0.4, 0.03, 0.03, 0.03], [-6.4, 0.38, 0.13, 0.14, 0.14], [-5.0, 0.3, 0.26, 0.29, 0.28],
      [-3.5, 0.2, 0.42, 0.46, 0.47], [-2.0, 0.12, 0.6, 0.64, 0.68], [-0.6, 0.06, 0.76, 0.8, 0.88],
      [0.6, 0.0, 0.88, 0.86, 1.12], [1.8, 0.04, 0.86, 0.84, 1.22], [2.8, 0.32, 0.7, 0.68, 0.95],
      [3.45, 0.85, 0.54, 0.52, 0.62], [3.9, 1.3, 0.46, 0.46, 0.48], [4.25, 1.52, 0.42, 0.42, 0.44],
    ],
    joints: { root: 5.6, tail: [4.2, 3.2, 2.3, 1.5, 0.8], front: [7.0, 8.4, 9.4, 10.3, 11] },
    neckFrom: 1, // front[1..] are neck bones; last is head
    headPitch: 0.22,
    skull: [[-0.42, 0.02, 0.33, 0.36, 0.34], [-0.08, 0.1, 0.46, 0.44, 0.13], [0.35, 0.08, 0.41, 0.41, 0.09],
      [0.75, 0.02, 0.31, 0.35, 0.075], [1.1, -0.04, 0.25, 0.28, 0.065], [1.4, -0.07, 0.18, 0.19, 0.055], [1.56, -0.08, 0.06, 0.06, 0.03]],
    jaw: { at: [0, -0.06, -0.2], st: [[-0.2, -0.1, 0.34, 0.06, 0.28], [0.25, -0.03, 0.35, 0.05, 0.25], [0.7, -0.02, 0.27, 0.05, 0.19],
      [1.1, -0.03, 0.21, 0.04, 0.13], [1.42, -0.04, 0.14, 0.03, 0.08], [1.56, -0.05, 0.05, 0.02, 0.03]], open: 0.75 },
    teeth: { up: [0.05, 1.45, 11, 0.15], low: [0.3, 1.4, 9, 0.12] },
    eye: { z: 0.18, y: 0.24, r: 0.075, iris: [225, 160, 40] },
    brow: true,
    leg: { at: [0.64, -0.3, 0.15], len: [1.5, 1.45, 0.85], a: [-0.5, 1.1, -0.95],
      thigh: [[-0.35, 0, 0.34, 0.45, 0.62], [0.3, 0, 0.44, 0.48, 0.62], [0.9, 0.04, 0.32, 0.3, 0.38], [1.5, 0, 0.2, 0.2, 0.22], [1.64, 0, 0.08, 0.08, 0.08]],
      shin: [[-0.12, 0, 0.21, 0.22, 0.25], [0.6, 0, 0.18, 0.16, 0.23], [1.3, 0, 0.12, 0.11, 0.12], [1.52, 0, 0.06, 0.06, 0.06]],
      meta: [[-0.1, 0, 0.13, 0.12, 0.14], [0.5, 0, 0.1, 0.1, 0.1], [0.85, 0, 0.12, 0.11, 0.1], [0.97, 0, 0.06, 0.06, 0.06]],
      toe: { n: 3, len: 0.58, r: 0.1, spread: 0.36, claw: 0.14 } },
    arm: { at: [0.6, -0.55, 2.35], len: [0.48, 0.4], r: 0.09, claws: 2, a: [-0.5, -1.1] },
    roarPitch: 0.7, roarSize: 1.4,
  },
};

SPECIES.rex2 = { ...SPECIES.rex, skin: { seed: 2, base: [100, 90, 68], dark: [54, 48, 36], belly: [162, 150, 122], stripeFreq: 18, stripeAmt: 0.12, spotAmt: 0.15, spotFreq: 18, mottle: 0.8, wrinkle: 0.9, backDark: 0.45 } };

SPECIES.carno = {
  kind: 'biped', runSpeed: 10,
  skin: { seed: 5, base: [126, 120, 104], dark: [64, 60, 52], belly: [190, 184, 166], stripeFreq: 30, stripeAmt: 0.3, stripeSharp: 0.6, spotAmt: 0.35, spotFreq: 34, mottle: 0.9, backDark: 0.45, wrinkle: 0.7 },
  body: [
    [-5.2, 0.3, 0.02, 0.02, 0.02], [-4.4, 0.3, 0.09, 0.1, 0.1], [-3.4, 0.24, 0.18, 0.2, 0.2],
    [-2.3, 0.16, 0.3, 0.33, 0.34], [-1.2, 0.08, 0.42, 0.46, 0.5], [-0.2, 0.04, 0.52, 0.55, 0.64],
    [0.7, 0.0, 0.56, 0.56, 0.76], [1.5, 0.06, 0.52, 0.52, 0.76], [2.2, 0.3, 0.42, 0.42, 0.58],
    [2.7, 0.7, 0.33, 0.34, 0.38], [3.05, 1.0, 0.3, 0.3, 0.32],
  ],
  joints: { root: 5.3, tail: [4.0, 3.0, 2.1, 1.3, 0.6], front: [7.0, 8.2, 9.2, 10] },
  neckFrom: 1, headPitch: 0.15,
  skull: [[-0.28, 0.04, 0.24, 0.3, 0.27], [0.0, 0.1, 0.31, 0.36, 0.12], [0.33, 0.1, 0.28, 0.34, 0.1],
    [0.62, 0.05, 0.21, 0.26, 0.08], [0.84, -0.01, 0.13, 0.15, 0.05], [0.92, -0.02, 0.04, 0.04, 0.02]],
  jaw: { at: [0, -0.04, -0.15], st: [[-0.15, -0.08, 0.24, 0.05, 0.2], [0.2, -0.03, 0.25, 0.05, 0.16], [0.55, -0.03, 0.19, 0.04, 0.11],
    [0.82, -0.04, 0.12, 0.03, 0.06], [0.92, -0.04, 0.04, 0.02, 0.02]], open: 0.8 },
  teeth: { up: [0.05, 0.85, 9, 0.08], low: [0.15, 0.82, 8, 0.07] },
  eye: { z: 0.12, y: 0.25, r: 0.055, iris: [200, 60, 40] },
  horns: [{ at: [0.2, 0.36, 0.06], len: 0.38, r: 0.09, rot: [0.1, 0, -1.05] }],
  leg: { at: [0.42, -0.22, 0.12], len: [1.05, 1.1, 0.62], a: [-0.45, 1.05, -0.95],
    thigh: [[-0.25, 0, 0.24, 0.3, 0.42], [0.2, 0, 0.3, 0.32, 0.42], [0.65, 0.03, 0.2, 0.2, 0.26], [1.05, 0, 0.13, 0.13, 0.14], [1.15, 0, 0.06, 0.06, 0.06]],
    shin: [[-0.08, 0, 0.14, 0.15, 0.17], [0.5, 0, 0.12, 0.11, 0.15], [1.1, 0, 0.08, 0.08, 0.08], [1.18, 0, 0.04, 0.04, 0.04]],
    meta: [[-0.06, 0, 0.09, 0.09, 0.1], [0.62, 0, 0.08, 0.08, 0.07], [0.7, 0, 0.04, 0.04, 0.04]],
    toe: { n: 3, len: 0.4, r: 0.07, spread: 0.32, claw: 0.1 } },
  arm: { at: [0.4, -0.35, 1.75], len: [0.22, 0.14], r: 0.06, claws: 4, a: [-0.2, -0.6] },
  roarPitch: 1.0, roarSize: 1.0,
};

SPECIES.spino = {
  kind: 'biped', runSpeed: 7,
  skin: { seed: 9, base: [92, 94, 72], dark: [48, 50, 40], belly: [176, 166, 138], accent: [72, 92, 98], accentAmt: 0.35, stripeFreq: 14, stripeAmt: 0.2, mottle: 0.8, wrinkle: 0.7 },
  body: [
    [-8.6, 0.3, 0.03, 0.12, 0.1], [-7.4, 0.32, 0.1, 0.45, 0.4], [-6.0, 0.3, 0.18, 0.55, 0.5],
    [-4.4, 0.22, 0.3, 0.55, 0.55], [-2.6, 0.12, 0.5, 0.62, 0.68], [-1.0, 0.06, 0.68, 0.74, 0.86],
    [0.6, 0.0, 0.8, 0.82, 1.05], [2.1, 0.05, 0.76, 0.8, 1.05], [3.3, 0.35, 0.6, 0.6, 0.8],
    [4.1, 0.9, 0.42, 0.42, 0.48], [4.8, 1.45, 0.32, 0.32, 0.34], [5.3, 1.75, 0.28, 0.28, 0.3],
  ],
  joints: { root: 5.6, tail: [4.4, 3.4, 2.5, 1.6, 0.8], front: [7.0, 8.3, 9.2, 10.2, 11] },
  neckFrom: 1, headPitch: 0.35,
  skull: [[-0.3, 0.04, 0.24, 0.3, 0.26], [0.05, 0.12, 0.26, 0.3, 0.1], [0.45, 0.09, 0.17, 0.2, 0.07],
    [0.95, 0.03, 0.12, 0.14, 0.06], [1.45, 0.0, 0.11, 0.12, 0.05], [1.75, -0.01, 0.13, 0.12, 0.05], [1.93, -0.02, 0.05, 0.05, 0.03]],
  jaw: { at: [0, -0.04, -0.15], st: [[-0.15, -0.08, 0.24, 0.05, 0.2], [0.3, -0.03, 0.2, 0.04, 0.15], [0.9, -0.03, 0.12, 0.03, 0.08],
    [1.5, -0.03, 0.11, 0.03, 0.07], [1.78, -0.04, 0.11, 0.03, 0.06], [1.92, -0.04, 0.04, 0.02, 0.02]], open: 0.7 },
  teeth: { up: [0.25, 1.85, 16, 0.1], low: [0.3, 1.85, 15, 0.09], curve: 0.05 },
  eye: { z: 0.12, y: 0.26, r: 0.055, iris: [190, 170, 60] },
  crest: true,
  sail: { z0: -2.6, z1: 3.4, h: 2.7, peak: 0.3 },
  leg: { at: [0.6, -0.3, 0.15], len: [1.25, 1.15, 0.65], a: [-0.45, 1.0, -0.9],
    thigh: [[-0.3, 0, 0.32, 0.4, 0.55], [0.3, 0, 0.38, 0.42, 0.55], [0.8, 0.04, 0.27, 0.26, 0.32], [1.25, 0, 0.17, 0.17, 0.18], [1.36, 0, 0.07, 0.07, 0.07]],
    shin: [[-0.1, 0, 0.18, 0.19, 0.21], [0.55, 0, 0.15, 0.14, 0.19], [1.15, 0, 0.1, 0.1, 0.1], [1.24, 0, 0.05, 0.05, 0.05]],
    meta: [[-0.08, 0, 0.11, 0.11, 0.12], [0.65, 0, 0.1, 0.09, 0.09], [0.74, 0, 0.05, 0.05, 0.05]],
    toe: { n: 3, len: 0.55, r: 0.09, spread: 0.4, claw: 0.12 } },
  arm: { at: [0.55, -0.5, 2.9], len: [0.8, 0.7], r: 0.13, claws: 3, a: [-0.6, -0.9] },
  roarPitch: 0.85, roarSize: 1.3,
};

SPECIES.raptor = {
  kind: 'biped', runSpeed: 12,
  skin: { seed: 13, base: [168, 152, 128], dark: [98, 86, 70], belly: [208, 196, 172], stripeFreq: 16, stripeAmt: 0.22, mottle: 0.6, rough: 0.8, wrinkle: 0.6 },
  body: [
    [-2.1, 0.14, 0.01, 0.01, 0.01], [-1.7, 0.14, 0.05, 0.05, 0.05], [-1.1, 0.12, 0.09, 0.1, 0.1],
    [-0.5, 0.07, 0.15, 0.17, 0.18], [0.05, 0.03, 0.2, 0.22, 0.27], [0.45, 0.02, 0.21, 0.22, 0.31],
    [0.8, 0.08, 0.17, 0.18, 0.25], [1.0, 0.25, 0.11, 0.12, 0.13], [1.1, 0.45, 0.085, 0.09, 0.09], [1.2, 0.62, 0.075, 0.08, 0.08],
  ],
  joints: { root: 4.2, tail: [3.2, 2.2, 1.4, 0.6], front: [5.8, 7.0, 8.0, 9] },
  neckFrom: 1, headPitch: 0.6,
  skull: [[-0.09, 0.01, 0.07, 0.08, 0.07], [0.05, 0.035, 0.085, 0.085, 0.03], [0.2, 0.03, 0.068, 0.07, 0.024],
    [0.38, 0.0, 0.048, 0.05, 0.02], [0.5, -0.01, 0.03, 0.032, 0.015], [0.55, -0.015, 0.01, 0.01, 0.01]],
  jaw: { at: [0, -0.02, -0.06], st: [[-0.06, -0.035, 0.07, 0.02, 0.05], [0.12, -0.012, 0.065, 0.016, 0.04], [0.32, -0.012, 0.045, 0.012, 0.026],
    [0.5, -0.014, 0.025, 0.01, 0.015], [0.55, -0.015, 0.01, 0.005, 0.005]], open: 0.85 },
  teeth: { up: [0.03, 0.5, 9, 0.03], low: [0.05, 0.48, 8, 0.025] },
  eye: { z: 0.06, y: 0.065, r: 0.025, iris: [235, 170, 30] },
  feathers: true,
  leg: { at: [0.16, -0.1, 0.06], len: [0.45, 0.5, 0.3], a: [-0.55, 1.2, -1.0],
    thigh: [[-0.12, 0, 0.11, 0.13, 0.17], [0.1, 0, 0.12, 0.13, 0.16], [0.3, 0.01, 0.08, 0.08, 0.1], [0.45, 0, 0.05, 0.05, 0.05], [0.5, 0, 0.025, 0.025, 0.025]],
    shin: [[-0.04, 0, 0.055, 0.06, 0.07], [0.2, 0, 0.05, 0.045, 0.065], [0.5, 0, 0.028, 0.028, 0.028], [0.54, 0, 0.015, 0.015, 0.015]],
    meta: [[-0.03, 0, 0.03, 0.03, 0.032], [0.3, 0, 0.027, 0.027, 0.025], [0.34, 0, 0.014, 0.014, 0.014]],
    toe: { n: 3, len: 0.15, r: 0.022, spread: 0.25, claw: 0.04, sickle: true } },
  arm: { at: [0.13, -0.12, 0.75], len: [0.22, 0.2], r: 0.035, claws: 3, a: [-0.2, -1.2] },
  roarPitch: 2.4, roarSize: 0.5, screech: true,
};
SPECIES.raptor2 = { ...SPECIES.raptor, skin: { seed: 14, base: [150, 136, 114], dark: [86, 74, 60], belly: [200, 190, 168], stripeFreq: 20, stripeAmt: 0.25, mottle: 0.6, rough: 0.8, wrinkle: 0.6 } };

// ---------------- quadrupeds ----------------
SPECIES.brachio = {
  kind: 'quad', runSpeed: 3, H: 4.6,
  skin: { seed: 21, base: [142, 128, 106], dark: [84, 74, 60], belly: [182, 170, 148], stripeFreq: 44, stripeAmt: 0.1, mottle: 0.6, wrinkle: 1.0 },
  body: [
    [-10.5, -1.4, 0.03, 0.03, 0.03], [-9.0, -1.15, 0.18, 0.2, 0.2], [-7.0, -0.6, 0.36, 0.4, 0.42], [-4.8, -0.05, 0.62, 0.7, 0.72],
    [-2.5, 0.35, 1.0, 1.0, 1.25], [0.0, 0.6, 1.42, 1.1, 1.65], [2.5, 1.2, 1.55, 1.1, 1.95], [4.5, 1.9, 1.38, 1.1, 1.8],
    [5.8, 3.0, 0.85, 0.85, 0.92], [6.6, 4.8, 0.6, 0.62, 0.62], [7.2, 6.8, 0.48, 0.5, 0.5], [7.7, 8.8, 0.38, 0.4, 0.4],
    [8.1, 10.4, 0.32, 0.33, 0.33], [8.35, 11.4, 0.28, 0.29, 0.29],
  ],
  joints: { root: 5.0, tail: [3.6, 2.6, 1.6, 0.8], front: [6.8, 8.2, 9.1, 10.0, 10.9, 11.8, 13] },
  neckFrom: 1, headPitch: 1.25,
  skull: [[-0.22, 0.0, 0.22, 0.25, 0.22], [0.1, 0.12, 0.27, 0.32, 0.12], [0.42, 0.05, 0.22, 0.2, 0.08],
    [0.75, -0.04, 0.17, 0.12, 0.06], [0.95, -0.07, 0.14, 0.09, 0.05], [1.03, -0.08, 0.05, 0.04, 0.03]],
  jaw: { at: [0, -0.04, -0.1], st: [[-0.1, -0.06, 0.2, 0.04, 0.12], [0.4, -0.02, 0.19, 0.03, 0.09], [0.8, -0.03, 0.14, 0.03, 0.06], [1.0, -0.03, 0.05, 0.02, 0.02]], open: 0.4 },
  teeth: { up: [0.6, 0.98, 6, 0.04], low: [0.6, 0.95, 5, 0.035], curve: 0 },
  eye: { z: 0.12, y: 0.16, r: 0.05, iris: [120, 90, 50], round: true },
  rear: { at: [1.0, -0.5, 0.2], frac: [0.52, 0.48], a: [-0.12, 0.25], r: [0.62, 0.42, 0.36] },
  front: { at: [1.0, 0.5, 4.6], frac: [0.55, 0.45], a: [0.12, -0.12], r: [0.55, 0.38, 0.33] },
  footH: 0.3, roarPitch: 0.45, roarSize: 1.8, lookPitch: 0.2,
};

SPECIES.stego = {
  kind: 'quad', runSpeed: 3, H: 2.3,
  skin: { seed: 31, base: [104, 112, 74], dark: [60, 66, 42], belly: [180, 174, 140], spotAmt: 0.3, spotFreq: 26, stripeFreq: 10, stripeAmt: 0.1, mottle: 0.9, wrinkle: 0.8 },
  body: [
    [-4.6, -0.05, 0.03, 0.03, 0.03], [-3.8, 0.05, 0.12, 0.14, 0.14], [-2.6, 0.22, 0.28, 0.3, 0.33], [-1.3, 0.45, 0.5, 0.55, 0.62],
    [0.0, 0.55, 0.76, 0.75, 0.98], [1.3, 0.35, 0.8, 0.74, 1.02], [2.4, -0.1, 0.62, 0.58, 0.8], [3.2, -0.45, 0.34, 0.34, 0.38], [3.75, -0.62, 0.22, 0.22, 0.24],
  ],
  joints: { root: 4.0, tail: [3.0, 2.0, 1.1], front: [5.5, 6.6, 7.4, 8] },
  neckFrom: 1, headPitch: 0.4,
  skull: [[-0.1, 0.0, 0.14, 0.15, 0.14], [0.12, 0.03, 0.15, 0.15, 0.08], [0.35, -0.02, 0.1, 0.1, 0.06], [0.52, -0.05, 0.06, 0.06, 0.04], [0.58, -0.06, 0.02, 0.02, 0.02]],
  jaw: { at: [0, -0.03, -0.05], st: [[-0.05, -0.05, 0.13, 0.03, 0.1], [0.3, -0.02, 0.1, 0.02, 0.06], [0.55, -0.03, 0.04, 0.01, 0.02]], open: 0.35 },
  teeth: null,
  beak: true,
  eye: { z: 0.06, y: 0.07, r: 0.03, iris: [150, 120, 50], round: true },
  plates: true, spikes: true,
  rear: { at: [0.55, -0.35, 0.15], frac: [0.55, 0.45], a: [-0.15, 0.3], r: [0.38, 0.22, 0.2] },
  front: { at: [0.5, -0.45, 2.3], frac: [0.55, 0.45], a: [0.1, -0.15], r: [0.26, 0.16, 0.15] },
  footH: 0.18, roarPitch: 1.1, roarSize: 0.9,
};

SPECIES.trike = {
  kind: 'quad', runSpeed: 6, H: 2.15,
  skin: { seed: 41, base: [112, 122, 74], dark: [70, 78, 46], belly: [168, 166, 124], stripeFreq: 12, stripeAmt: 0.14, mottle: 0.9, wrinkle: 0.9, frill: [196, 186, 140] },
  body: [
    [-3.8, 0.0, 0.03, 0.03, 0.03], [-3.0, 0.08, 0.15, 0.17, 0.17], [-1.9, 0.25, 0.42, 0.44, 0.48], [-0.8, 0.4, 0.78, 0.72, 0.9],
    [0.3, 0.45, 0.98, 0.84, 1.15], [1.5, 0.35, 0.98, 0.86, 1.2], [2.5, 0.15, 0.78, 0.72, 1.0], [3.1, 0.05, 0.47, 0.5, 0.55], [3.4, 0.0, 0.4, 0.42, 0.44],
  ],
  joints: { root: 3.8, tail: [2.6, 1.6, 0.8], front: [5.5, 6.6, 7.4, 8] },
  neckFrom: 1, headPitch: 0.3,
  skull: [[-0.32, 0.1, 0.4, 0.45, 0.4], [0.1, 0.1, 0.45, 0.5, 0.34], [0.6, 0.0, 0.33, 0.42, 0.28], [1.1, -0.15, 0.22, 0.32, 0.2], [1.45, -0.3, 0.14, 0.22, 0.1], [1.62, -0.42, 0.05, 0.07, 0.04]],
  jaw: { at: [0, -0.2, 0.1], st: [[-0.1, -0.1, 0.3, 0.06, 0.2], [0.5, -0.08, 0.26, 0.06, 0.16], [1.0, -0.12, 0.17, 0.05, 0.1], [1.35, -0.18, 0.06, 0.03, 0.04]], open: 0.35 },
  teeth: null, beak: true,
  eye: { z: 0.35, y: 0.32, r: 0.06, iris: [170, 120, 40] },
  frill: { w: 2.4, h: 1.7, at: [0, 0.35, -0.3], tilt: -0.75 },
  hornsT: true,
  rear: { at: [0.62, -0.35, 0.3], frac: [0.55, 0.45], a: [-0.2, 0.35], r: [0.45, 0.26, 0.24] },
  front: { at: [0.62, -0.45, 2.5], frac: [0.52, 0.48], a: [0.2, -0.3], r: [0.36, 0.22, 0.21] },
  footH: 0.18, roarPitch: 0.9, roarSize: 1.1,
};
SPECIES.trike2 = { ...SPECIES.trike, skin: { seed: 42, base: [118, 112, 80], dark: [72, 68, 48], belly: [172, 164, 130], stripeFreq: 10, stripeAmt: 0.12, mottle: 1.0, wrinkle: 0.9, frill: [190, 170, 130] } };

SPECIES.parasaur = {
  kind: 'biped', runSpeed: 9, bump: 0.05,
  skin: { seed: 61, base: [152, 128, 94], dark: [92, 74, 52], belly: [204, 190, 160], stripeFreq: 30, stripeAmt: 0.35, mottle: 0.7, wrinkle: 0.8 },
  body: [
    [-5.6, 0.3, 0.02, 0.02, 0.02], [-4.6, 0.3, 0.1, 0.17, 0.17], [-3.4, 0.25, 0.2, 0.33, 0.31], [-2.2, 0.18, 0.33, 0.46, 0.44],
    [-1.0, 0.12, 0.5, 0.6, 0.64], [0.2, 0.1, 0.62, 0.68, 0.88], [1.4, 0.05, 0.62, 0.62, 0.92], [2.4, 0.1, 0.5, 0.5, 0.72],
    [3.0, 0.45, 0.3, 0.3, 0.36], [3.4, 0.9, 0.22, 0.22, 0.24], [3.62, 1.15, 0.2, 0.2, 0.2],
  ],
  joints: { root: 5.0, tail: [3.8, 2.8, 1.9, 1.0], front: [6.6, 8.0, 9.0, 10] },
  neckFrom: 1, headPitch: 0.15,
  skull: [[-0.2, 0.02, 0.16, 0.2, 0.18], [0.05, 0.06, 0.17, 0.2, 0.08], [0.35, 0.02, 0.14, 0.15, 0.06], [0.6, -0.04, 0.14, 0.1, 0.05], [0.75, -0.06, 0.15, 0.08, 0.04], [0.82, -0.07, 0.05, 0.03, 0.02]],
  jaw: { at: [0, -0.03, -0.1], st: [[-0.1, -0.06, 0.15, 0.03, 0.1], [0.3, -0.03, 0.13, 0.03, 0.07], [0.65, -0.04, 0.13, 0.02, 0.04], [0.78, -0.05, 0.04, 0.01, 0.02]], open: 0.45 },
  teeth: null, beak: true,
  eye: { z: 0.0, y: 0.1, r: 0.035, iris: [150, 110, 50] },
  tubeCrest: { at: [0, 0.16, -0.05], len: 1.3, r: 0.07, angle: 0.55, color: 0x8a5a3a },
  leg: { at: [0.45, -0.25, 0.1], len: [1.1, 1.05, 0.55], a: [-0.35, 0.85, -0.75],
    thigh: [[-0.28, 0, 0.27, 0.34, 0.46], [0.2, 0, 0.32, 0.34, 0.45], [0.7, 0.03, 0.22, 0.22, 0.28], [1.1, 0, 0.14, 0.14, 0.15], [1.2, 0, 0.06, 0.06, 0.06]],
    shin: [[-0.08, 0, 0.15, 0.16, 0.18], [0.5, 0, 0.13, 0.12, 0.16], [1.05, 0, 0.09, 0.09, 0.09], [1.13, 0, 0.04, 0.04, 0.04]],
    meta: [[-0.06, 0, 0.1, 0.1, 0.11], [0.55, 0, 0.09, 0.09, 0.08], [0.62, 0, 0.04, 0.04, 0.04]],
    toe: { n: 3, len: 0.32, r: 0.08, spread: 0.3, claw: 0.05 } },
  arm: { at: [0.4, -0.45, 2.2], len: [0.5, 0.45], r: 0.07, claws: 3, a: [-0.9, -0.4] },
  roarPitch: 1.5, roarSize: 0.9,
};

SPECIES.ankylo = {
  kind: 'quad', runSpeed: 2.5, H: 1.6, bump: 0.08,
  skin: { seed: 71, base: [122, 106, 80], dark: [70, 58, 42], belly: [178, 162, 132], spotAmt: 0.45, spotFreq: 30, stripeFreq: 8, stripeAmt: 0.1, mottle: 0.9, wrinkle: 1.0 },
  body: [
    [-3.6, 0.0, 0.03, 0.03, 0.03], [-3.0, 0.05, 0.1, 0.1, 0.1], [-2.1, 0.15, 0.22, 0.2, 0.22], [-1.1, 0.3, 0.72, 0.46, 0.5],
    [0.0, 0.38, 1.05, 0.6, 0.7], [1.2, 0.3, 1.02, 0.58, 0.72], [2.2, 0.05, 0.72, 0.45, 0.55], [2.75, -0.15, 0.42, 0.32, 0.36], [3.0, -0.2, 0.36, 0.3, 0.32],
  ],
  joints: { root: 4.0, tail: [3.0, 2.0, 1.0], front: [5.8, 7.0, 8] },
  neckFrom: 1, headPitch: 0.25,
  skull: [[-0.15, 0, 0.3, 0.22, 0.2], [0.15, 0.04, 0.32, 0.22, 0.12], [0.4, 0, 0.26, 0.17, 0.1], [0.55, -0.05, 0.18, 0.1, 0.06], [0.6, -0.06, 0.06, 0.03, 0.03]],
  jaw: { at: [0, -0.05, -0.05], st: [[-0.05, -0.04, 0.26, 0.03, 0.1], [0.35, -0.02, 0.2, 0.02, 0.06], [0.55, -0.03, 0.06, 0.01, 0.02]], open: 0.3 },
  teeth: null, beak: true, brow: true,
  eye: { z: 0.12, y: 0.08, r: 0.03, iris: [140, 100, 40] },
  armor: true,
  rear: { at: [0.62, -0.25, 0.2], frac: [0.55, 0.45], a: [-0.15, 0.3], r: [0.32, 0.2, 0.19] },
  front: { at: [0.55, -0.35, 2.1], frac: [0.55, 0.45], a: [0.1, -0.15], r: [0.26, 0.17, 0.16] },
  footH: 0.15, roarPitch: 1.3, roarSize: 0.8,
};

const scaleLeg = (L, k, rk = k) => ({
  at: L.at.map(v => v * k), len: L.len.map(v => v * k), a: L.a,
  thigh: L.thigh.map(([z, y, a, b, c]) => [z * k, y * k, a * rk, b * rk, c * rk]),
  shin: L.shin.map(([z, y, a, b, c]) => [z * k, y * k, a * rk, b * rk, c * rk]),
  meta: L.meta.map(([z, y, a, b, c]) => [z * k, y * k, a * rk, b * rk, c * rk]),
  toe: { ...L.toe, len: L.toe.len * k, r: L.toe.r * rk, claw: L.toe.claw * k },
});

// Dilophosaurus: twin head crests and a neck frill it flares before spitting
SPECIES.dilo = {
  kind: 'biped', runSpeed: 9, bump: 0.04,
  skin: { seed: 91, base: [150, 150, 96], dark: [58, 64, 40], belly: [212, 206, 172], spotAmt: 0.5, spotFreq: 22, stripeFreq: 20, stripeAmt: 0.3, accent: [196, 96, 42], accentAmt: 0.45, mottle: 0.6, wrinkle: 0.6 },
  body: [
    [-3.6, 0.25, 0.02, 0.02, 0.02], [-3.0, 0.25, 0.07, 0.08, 0.08], [-2.2, 0.2, 0.14, 0.16, 0.16], [-1.3, 0.12, 0.24, 0.27, 0.28],
    [-0.4, 0.06, 0.33, 0.36, 0.42], [0.4, 0.03, 0.36, 0.38, 0.5], [1.1, 0.08, 0.32, 0.34, 0.46], [1.6, 0.3, 0.22, 0.24, 0.28],
    [1.9, 0.65, 0.16, 0.17, 0.18], [2.05, 0.95, 0.14, 0.15, 0.15], [2.15, 1.15, 0.13, 0.13, 0.13],
  ],
  joints: { root: 5.2, tail: [4.0, 3.0, 2.0, 1.0], front: [6.6, 7.8, 8.7, 9.5, 10] },
  neckFrom: 1, headPitch: 0.25,
  skull: [[-0.15, 0.02, 0.11, 0.13, 0.11], [0.05, 0.05, 0.12, 0.13, 0.04], [0.28, 0.03, 0.09, 0.1, 0.035], [0.48, -0.01, 0.06, 0.07, 0.025], [0.6, -0.02, 0.03, 0.03, 0.015], [0.64, -0.02, 0.01, 0.01, 0.01]],
  jaw: { at: [0, -0.02, -0.08], st: [[-0.08, -0.04, 0.1, 0.02, 0.07], [0.2, -0.02, 0.08, 0.02, 0.05], [0.45, -0.02, 0.05, 0.015, 0.03], [0.6, -0.02, 0.02, 0.01, 0.01]], open: 0.9 },
  teeth: { up: [0.05, 0.58, 9, 0.04], low: [0.08, 0.56, 8, 0.035] },
  eye: { z: 0.08, y: 0.07, r: 0.03, iris: [230, 190, 40] },
  crests: { z0: -0.05, len: 0.5, h: 0.2 },
  neckFrill: { r: 0.62 },
  leg: scaleLeg(SPECIES.carno.leg, 0.75),
  arm: { at: [0.3, -0.3, 1.2], len: [0.3, 0.26], r: 0.05, claws: 3, a: [-0.5, -0.8] },
  roarPitch: 1.8, roarSize: 0.6, screech: true,
};

// Pachycephalosaurus: thick-domed head-butter
SPECIES.pachy = {
  kind: 'biped', runSpeed: 9, bump: 0.05,
  skin: { seed: 101, base: [142, 112, 80], dark: [82, 58, 40], belly: [206, 186, 152], stripeFreq: 18, stripeAmt: 0.5, mottle: 0.6, wrinkle: 0.6 },
  body: [
    [-2.4, 0.15, 0.02, 0.02, 0.02], [-1.9, 0.15, 0.07, 0.08, 0.08], [-1.3, 0.12, 0.15, 0.17, 0.17], [-0.6, 0.08, 0.26, 0.28, 0.3],
    [0.1, 0.05, 0.34, 0.34, 0.42], [0.7, 0.05, 0.34, 0.33, 0.44], [1.15, 0.15, 0.26, 0.26, 0.32], [1.45, 0.38, 0.17, 0.18, 0.18], [1.6, 0.55, 0.15, 0.15, 0.15],
  ],
  joints: { root: 3.9, tail: [2.9, 1.9, 1.0], front: [5.6, 6.8, 7.6, 8] },
  neckFrom: 1, headPitch: 0.2,
  skull: [[-0.12, 0.04, 0.13, 0.15, 0.13], [0.05, 0.06, 0.13, 0.15, 0.08], [0.22, 0.02, 0.1, 0.11, 0.06], [0.38, -0.03, 0.06, 0.06, 0.03], [0.45, -0.05, 0.02, 0.02, 0.02]],
  jaw: { at: [0, -0.04, -0.05], st: [[-0.05, -0.04, 0.11, 0.02, 0.07], [0.2, -0.02, 0.08, 0.02, 0.04], [0.4, -0.03, 0.03, 0.01, 0.015]], open: 0.4 },
  teeth: null, beak: true,
  eye: { z: 0.1, y: 0.08, r: 0.028, iris: [170, 120, 50] },
  dome: { r: 0.2, at: [0, 0.17, 0.0] },
  leg: scaleLeg(SPECIES.raptor.leg, 1.25, 1.6),
  arm: { at: [0.22, -0.2, 0.95], len: [0.16, 0.14], r: 0.035, claws: 3, a: [-0.4, -0.9] },
  roarPitch: 1.7, roarSize: 0.6,
};

// Mosasaurus: giant marine reptile (no legs: flippers and a tail fluke)
SPECIES.mosa = {
  kind: 'swim', runSpeed: 8, bump: 0.03,
  skin: { seed: 111, base: [70, 82, 92], dark: [36, 44, 52], belly: [206, 206, 196], spotAmt: 0.2, spotFreq: 30, stripeFreq: 10, stripeAmt: 0.1, mottle: 0.6, wrinkle: 0.5, rough: 0.45, backDark: 0.6 },
  body: [
    [-7, 0, 0.02, 0.05, 0.05], [-6, 0, 0.12, 0.3, 0.28], [-4.5, 0, 0.3, 0.5, 0.45], [-2.5, 0, 0.55, 0.65, 0.62],
    [-0.5, 0, 0.78, 0.78, 0.8], [1.5, 0, 0.8, 0.78, 0.8], [3.2, 0.05, 0.62, 0.6, 0.62], [4.3, 0.1, 0.48, 0.48, 0.48], [5.0, 0.12, 0.42, 0.42, 0.42],
  ],
  joints: { root: 4.5, tail: [3.5, 2.5, 1.5, 0.7], front: [5.6, 6.6, 7.4, 8] },
  neckFrom: 1, headPitch: 0.05,
  skull: [[-0.3, 0.02, 0.4, 0.36, 0.3], [0.1, 0.06, 0.42, 0.36, 0.12], [0.7, 0.02, 0.3, 0.28, 0.09], [1.3, -0.03, 0.2, 0.2, 0.07], [1.8, -0.06, 0.12, 0.12, 0.05], [2.0, -0.07, 0.04, 0.04, 0.02]],
  jaw: { at: [0, -0.06, -0.2], st: [[-0.2, -0.1, 0.38, 0.06, 0.25], [0.4, -0.04, 0.32, 0.05, 0.2], [1.1, -0.05, 0.22, 0.04, 0.12], [1.7, -0.06, 0.12, 0.03, 0.06], [2.0, -0.06, 0.04, 0.02, 0.02]], open: 0.8 },
  teeth: { up: [0.15, 1.9, 14, 0.12], low: [0.2, 1.85, 13, 0.11] },
  eye: { z: 0.25, y: 0.22, r: 0.06, iris: [200, 200, 120] },
  flippers: [[0.75, 2.4, 1.5], [0.7, -1.4, 1.2]],
  roarPitch: 0.5, roarSize: 1.8,
};

// Plesiosaur (Elasmosaurus-like): small body, very long neck, four big flippers
SPECIES.plesio = {
  kind: 'swim', runSpeed: 5, bump: 0.03,
  skin: { seed: 121, base: [96, 104, 100], dark: [46, 52, 52], belly: [214, 210, 196], spotAmt: 0.35, spotFreq: 26, stripeFreq: 8, stripeAmt: 0.1, mottle: 0.6, wrinkle: 0.4, rough: 0.45, backDark: 0.55 },
  body: [
    [-3.4, 0, 0.02, 0.03, 0.03], [-2.6, 0, 0.12, 0.13, 0.13], [-1.6, 0, 0.35, 0.32, 0.34], [-0.4, 0, 0.72, 0.5, 0.55],
    [0.9, 0, 0.78, 0.52, 0.58], [1.9, 0.05, 0.5, 0.4, 0.42], [2.8, 0.15, 0.26, 0.25, 0.25], [4.0, 0.3, 0.19, 0.19, 0.19],
    [5.2, 0.45, 0.16, 0.16, 0.16], [6.4, 0.6, 0.14, 0.14, 0.14], [7.2, 0.7, 0.13, 0.13, 0.13],
  ],
  joints: { root: 3.6, tail: [2.5, 1.5, 0.6], front: [5.2, 6.2, 7.2, 8.2, 9.2, 10] },
  neckFrom: 1, headPitch: 0.05, lookPitch: 1,
  skull: [[-0.12, 0, 0.1, 0.11, 0.09], [0.1, 0.02, 0.11, 0.1, 0.05], [0.32, 0, 0.07, 0.07, 0.04], [0.5, -0.02, 0.03, 0.03, 0.02]],
  jaw: { at: [0, -0.02, -0.05], st: [[-0.05, -0.03, 0.09, 0.02, 0.06], [0.25, -0.02, 0.06, 0.015, 0.03], [0.48, -0.02, 0.02, 0.01, 0.01]], open: 0.7 },
  teeth: { up: [0.05, 0.46, 9, 0.05], low: [0.06, 0.44, 8, 0.045], curve: 0.5 },
  eye: { z: 0.05, y: 0.06, r: 0.03, iris: [210, 180, 90] },
  flippers: [[0, 1.0, 1.9], [0, -1.2, 1.8]],
  roarPitch: 1.2, roarSize: 0.8,
};

// Dunkleosteus: armoured giant fish with bony blade jaws
SPECIES.dunkle = {
  kind: 'swim', runSpeed: 10, bump: 0.02,
  skin: { seed: 131, base: [92, 96, 104], dark: [40, 44, 50], belly: [190, 192, 184], accent: [120, 112, 96], accentAmt: 0.6, stripeFreq: 6, stripeAmt: 0.1, spotAmt: 0.3, spotFreq: 20, mottle: 0.6, rough: 0.35, backDark: 0.6 },
  body: [
    [-3.2, 0, 0.03, 0.2, 0.2], [-2.6, 0, 0.12, 0.3, 0.28], [-1.6, 0, 0.35, 0.5, 0.48], [-0.4, 0, 0.62, 0.72, 0.7],
    [0.8, 0, 0.78, 0.82, 0.8], [1.8, 0.02, 0.8, 0.78, 0.7], [2.5, 0.0, 0.66, 0.62, 0.55], [2.9, -0.05, 0.42, 0.44, 0.38],
  ],
  joints: { root: 3.6, tail: [2.5, 1.5, 0.6], front: [5.0, 6.0, 7] },
  neckFrom: 1, headPitch: 0,
  skull: [[-0.3, 0.05, 0.55, 0.55, 0.45], [0.1, 0.05, 0.55, 0.5, 0.18], [0.45, 0.0, 0.42, 0.4, 0.12], [0.7, -0.08, 0.25, 0.25, 0.08], [0.82, -0.12, 0.06, 0.06, 0.04]],
  jaw: { at: [0, -0.08, -0.2], st: [[-0.2, -0.1, 0.48, 0.08, 0.3], [0.3, -0.05, 0.4, 0.06, 0.22], [0.7, -0.08, 0.2, 0.05, 0.1], [0.82, -0.1, 0.05, 0.02, 0.02]], open: 0.9 },
  teeth: { up: [0.55, 0.8, 2, 0.16], low: [0.55, 0.78, 2, 0.15], curve: 0.1 },
  eye: { z: 0.15, y: 0.28, r: 0.08, iris: [220, 200, 80] },
  dome: { r: 0.5, at: [0, 0.18, 0.05] },
  flippers: [[0, 1.6, 1.0], [0, -0.6, 0.7]],
  roarPitch: 0.6, roarSize: 1.2,
};

SPECIES.compy = { ...SPECIES.raptor, feathers: false, runSpeed: 9, skin: { seed: 81, base: [118, 124, 82], dark: [60, 66, 40], belly: [196, 190, 150], stripeFreq: 14, stripeAmt: 0.45, mottle: 0.6, wrinkle: 0.4 } };

// ---------------- builder ----------------
export class Dino {
  constructor(key, opts = {}) {
    const spec = SPECIES[key];
    this.key = key;
    this.spec = spec;
    const C = common();
    this.root = new THREE.Group();
    this.pivot = new THREE.Group();
    this.root.add(this.pivot);
    const st = spec.body;
    const bodyLen = st[st.length - 1][0] - st[0][0];
    const girth = Math.max(...st.map(s => s[2])) * 4.5;
    const mat = skinMaterial(key, spec.skin, bodyLen * 1.6, Math.max(3, girth * 1.6));
    this.mat = mat;
    const geo = loft(st, { along: opts.along || 72, around: opts.around || 22, narrow: 0.2, bump: spec.bump ?? 0.05 });
    // ---- bones ----
    const N = st.length - 1;
    const P = idx => { const s = interp(st, idx / N); return new THREE.Vector3(0, s[1], s[0]); };
    const J = spec.joints;
    const rootBone = new THREE.Bone();
    rootBone.position.copy(P(J.root));
    const bones = [rootBone];
    const centers = [];
    this.front = []; this.tail = [];
    let prev = rootBone, prevP = P(J.root);
    J.front.forEach((idx, k) => {
      const b = new THREE.Bone();
      const p = P(idx);
      b.position.copy(p).sub(prevP);
      prev.add(b);
      bones.push(b); this.front.push(b);
      b.userData.pos = p;
      prev = b; prevP = p;
    });
    prev = rootBone; prevP = P(J.root);
    J.tail.forEach(idx => {
      const b = new THREE.Bone();
      const p = P(idx);
      b.position.copy(p).sub(prevP);
      prev.add(b);
      bones.push(b); this.tail.push(b);
      b.userData.pos = p;
      prev = b; prevP = p;
    });
    rootBone.userData.pos = P(J.root);
    // influence centers in station-param units
    const tp = idx => idx / N;
    centers.push([(tp(J.root) + tp(J.front[0])) / 2, 0]);
    J.front.forEach((idx, k) => {
      const nx = k + 1 < J.front.length ? J.front[k + 1] : N;
      centers.push([(tp(idx) + tp(nx)) / 2 + (k + 1 === J.front.length ? 0.02 : 0), 1 + k]);
    });
    centers[0][0] = (tp(J.tail[0]) + tp(J.front[0])) / 2;
    J.tail.forEach((idx, k) => {
      const nx = k + 1 < J.tail.length ? J.tail[k + 1] : 0;
      centers.push([(tp(idx) + tp(nx)) / 2, 1 + J.front.length + k]);
    });
    centers.sort((a, b) => a[0] - b[0]);
    const prm = geo.userData.param;
    const si = new Uint16Array(prm.length * 4), sw = new Float32Array(prm.length * 4);
    for (let v = 0; v < prm.length; v++) {
      const t = prm[v];
      let a = centers[0], b = centers[0], w = 0;
      if (t <= centers[0][0]) { a = b = centers[0]; w = 0; }
      else if (t >= centers[centers.length - 1][0]) { a = b = centers[centers.length - 1]; w = 0; }
      else {
        for (let k = 0; k < centers.length - 1; k++) {
          if (t >= centers[k][0] && t <= centers[k + 1][0]) { a = centers[k]; b = centers[k + 1]; w = (t - a[0]) / (b[0] - a[0]); break; }
        }
      }
      si[v * 4] = a[1]; si[v * 4 + 1] = b[1];
      sw[v * 4] = 1 - w; sw[v * 4 + 1] = w;
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.add(rootBone);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones));
    mesh.frustumCulled = false;
    this.pivot.add(mesh);
    this.mesh = mesh;
    this.rootBone = rootBone;
    this.headBone = this.front[this.front.length - 1];
    this.neck = this.front.slice(spec.neckFrom, this.front.length - 1);
    this.chest = this.front[0];
    const attach = (bone, obj, meshPos) => { obj.position.copy(meshPos).sub(bone.userData.pos); bone.add(obj); return obj; };
    this.attach = attach;
    const boneNearestZ = (z) => {
      let best = rootBone, bd = Math.abs(rootBone.userData.pos.z - z);
      for (const b of this.front.concat(this.tail)) {
        const d = Math.abs(b.userData.pos.z - z);
        if (d < bd && !(b === this.headBone)) { bd = d; best = b; }
      }
      // choose the bone whose segment contains z (tail bones go backwards)
      if (z < rootBone.userData.pos.z) {
        let cand = rootBone;
        for (const b of this.tail) if (b.userData.pos.z >= z) cand = b;
        return cand;
      }
      let cand = rootBone;
      for (const b of this.front) if (b.userData.pos.z <= z && b !== this.headBone) cand = b;
      return cand;
    };

    // ---- head ----
    const head = new THREE.Group();
    const headPos = this.headBone.userData.pos;
    attach(this.headBone, head, headPos);
    head.rotation.x = spec.headPitch;
    this.head = head;
    this.headRest = spec.headPitch;
    const headLen = spec.skull[spec.skull.length - 1][0] - spec.skull[0][0];
    const headMat = skinMaterial(key, spec.skin, headLen * 4, 4);
    const skullGeo = loft(spec.skull, { along: 26, around: 18, narrow: 0.25, uScale: headLen / bodyLen, uOffset: 0.9 });
    const skull = new THREE.Mesh(skullGeo, headMat);
    head.add(skull);
    const jaw = new THREE.Group();
    jaw.position.set(...spec.jaw.at);
    head.add(jaw);
    this.jaw = jaw;
    const jawGeo = loft(spec.jaw.st, { along: 20, around: 16, narrow: 0.1, uScale: headLen / bodyLen, uOffset: 0.85 });
    jaw.add(new THREE.Mesh(jawGeo, headMat));
    // mouth interior
    {
      const mid = atZ(spec.skull, headLen * 0.35 + spec.skull[0][0]);
      const pal = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), C.mouth);
      pal.scale.set(mid[2] * 0.78, Math.max(0.02, mid[4] * 0.6), headLen * 0.42);
      pal.position.set(0, mid[1] - mid[4] * 0.4, spec.skull[0][0] + headLen * 0.45);
      head.add(pal);
      const jm = atZ(spec.jaw.st, headLen * 0.35);
      const tongue = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), C.tongue);
      tongue.scale.set(jm[2] * 0.65, Math.max(0.02, jm[3] * 0.9), headLen * 0.38);
      tongue.position.set(0, jm[1] + jm[3] * 0.2, headLen * 0.38);
      jaw.add(tongue);
      const throat = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), C.mouth);
      const th = spec.skull[0];
      throat.scale.set(th[2] * 0.8, th[4] * 0.7, th[2] * 0.6);
      throat.position.set(0, th[1] - th[4] * 0.2, th[0] + th[2] * 0.5);
      head.add(throat);
    }
    if (spec.teeth) {
      const t = spec.teeth;
      head.add(new THREE.Mesh(teeth(spec.skull, t.up[0], t.up[1], t.up[2], true, t.up[3], t.curve ?? 0.25), C.tooth));
      jaw.add(new THREE.Mesh(teeth(spec.jaw.st, t.low[0], t.low[1], t.low[2], false, t.low[3], t.curve ?? 0.25), C.tooth));
    }
    if (spec.beak) {
      const tip = spec.skull[spec.skull.length - 2];
      const bk = new THREE.Mesh(coneGeo(tip[2] * 1.1, headLen * 0.25, 8), C.beak);
      bk.rotation.x = Math.PI / 2 + 0.5;
      bk.position.set(0, tip[1] - 0.02, tip[0] - headLen * 0.02);
      head.add(bk);
    }
    // eyes
    {
      const e = spec.eye;
      const s = atZ(spec.skull, e.z);
      const cth = clamp((e.y - s[1]) / s[3], -1, 1);
      const sx = s[2] * Math.sqrt(1 - cth * cth) * (1 - 0.25 * Math.max(0, cth));
      const em = eyeMat(e.iris);
      for (const sd of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(e.r, 16, 12), em);
        eye.position.set(sd * (sx - e.r * 0.35), e.y, e.z);
        if (sd < 0) eye.rotation.y = Math.PI;
        eye.rotation.z = sd * 0.15;
        head.add(eye);
        if (spec.brow) {
          const brow = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), headMat);
          brow.scale.set(e.r * 1.2, e.r * 0.7, e.r * 2.2);
          brow.position.set(sd * (sx - e.r * 0.5), e.y + e.r * 1.0, e.z - e.r * 0.3);
          head.add(brow);
        }
      }
    }
    if (spec.horns) {
      for (const h of spec.horns) for (const sd of [-1, 1]) {
        const g = coneGeo(h.r, h.len, 8).translate(0, h.len / 2, 0);
        const m = new THREE.Mesh(g, headMat);
        m.position.set(sd * h.at[0], h.at[1], h.at[2]);
        m.rotation.set(h.rot[0], 0, -sd * Math.abs(h.rot[2]) * 0.9);
        head.add(m);
      }
    }
    if (spec.crests) {
      // two thin bony plates running along the top of the skull
      const c = spec.crests;
      const sh = new THREE.Shape();
      sh.moveTo(0, 0);
      sh.quadraticCurveTo(c.len * 0.35, c.h * 1.3, c.len, c.h * 0.15);
      sh.lineTo(c.len, 0); sh.lineTo(0, 0);
      const cm = new THREE.MeshStandardMaterial({ color: 0xb4502c, roughness: 0.6, side: THREE.DoubleSide });
      for (const sd of [-1, 1]) {
        const g = new THREE.ExtrudeGeometry(sh, { depth: 0.015, bevelEnabled: false });
        g.rotateY(-Math.PI / 2);
        const m = new THREE.Mesh(g, cm);
        const top = atZ(spec.skull, c.z0 + c.len * 0.3);
        m.position.set(sd * 0.045, top[1] + top[3] * 0.8, c.z0);
        m.rotation.z = sd * 0.15;
        head.add(m);
      }
    }
    if (spec.dome) {
      const D = spec.dome;
      const dm = new THREE.Mesh(new THREE.SphereGeometry(D.r, 18, 12), new THREE.MeshStandardMaterial({ map: domeTexture(), roughness: 0.55 }));
      dm.scale.set(1, 0.85, 1.15);
      dm.position.set(...D.at);
      head.add(dm);
      const knobs = [];
      for (let k = 0; k < 9; k++) {
        const a = Math.PI * (0.55 + k / 8 * 0.9);
        const g = coneGeo(0.025, 0.07, 5).translate(0, 0.035, 0);
        g.rotateX(-Math.PI / 2 + 0.3); g.rotateY(a + Math.PI / 2);
        g.translate(Math.cos(a) * D.r * 0.95, D.at[1] - D.r * 0.25, D.at[2] + Math.sin(a) * D.r * 1.05);
        knobs.push(g);
      }
      head.add(new THREE.Mesh(mergeGeos(knobs), C.horn));
    }
    if (spec.crest) {
      const g = coneGeo(0.08, 0.3, 6).scale(0.6, 1, 1.6);
      const m = new THREE.Mesh(g, headMat);
      m.position.set(0, 0.34, 0.5);
      head.add(m);
    }
    if (spec.frill) {
      const f = spec.frill;
      const sh = new THREE.Shape();
      const W = f.w / 2, Hh = f.h;
      sh.moveTo(-W * 0.45, 0);
      const pts = 22;
      for (let i = 0; i <= pts; i++) {
        const a = Math.PI * (1 - i / pts);
        const r = 1 + (i % 2 ? 0.06 : -0.02);
        sh.lineTo(Math.cos(a) * W * r, Math.sin(a) * Hh * r * 0.9 + 0.05);
      }
      sh.lineTo(W * 0.45, 0);
      sh.lineTo(-W * 0.45, 0);
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
      const fmat = new THREE.MeshStandardMaterial({ map: frillTexture(spec.skin), roughness: 0.75, normalMap: mat.normalMap });
      fmat.map.repeat.set(1 / f.w, 1 / (f.h * 1.05));
      fmat.map.offset.set(0.5, 0);
      const m = new THREE.Mesh(g, fmat);
      m.position.set(f.at[0], f.at[1], f.at[2]);
      m.rotation.x = f.tilt;
      head.add(m);
      // epoccipital knobs around the rim (as in the reference)
      const knobs = [];
      const nk = 15;
      for (let i = 0; i < nk; i++) {
        const a = Math.PI * (0.04 + 0.92 * i / (nk - 1));
        const kg = coneGeo(0.1, 0.24, 7).translate(0, 0.1, 0);
        kg.rotateZ(a - Math.PI / 2);
        kg.translate(Math.cos(a) * W * 0.98, Math.sin(a) * Hh * 0.9 * 0.98 + 0.05, 0.05);
        knobs.push(kg);
      }
      m.add(new THREE.Mesh(mergeGeos(knobs), C.horn));
    }
    if (spec.hornsT) {
      for (const sd of [-1, 1]) {
        const g = coneGeo(0.11, 1.25, 10).translate(0, 0.62, 0);
        const m = new THREE.Mesh(g, C.horn);
        m.position.set(sd * 0.24, 0.5, 0.3);
        m.rotation.set(0.95, 0, -sd * 0.22);
        head.add(m);
      }
      const n = new THREE.Mesh(coneGeo(0.08, 0.35, 8).translate(0, 0.17, 0), C.horn);
      n.position.set(0, 0.05, 1.18);
      n.rotation.x = 0.35;
      head.add(n);
    }
    if (spec.feathers) {
      const qm = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 });
      const qs = [];
      // crest along head & neck
      for (let i = 0; i < 9; i++) {
        const g = coneGeo(0.012, 0.11 + (i % 3) * 0.02, 4);
        g.rotateX(-0.9);
        g.translate((i % 2 ? 0.02 : -0.02), 0.08, -0.05 - i * 0.025);
        qs.push(g);
      }
      head.add(new THREE.Mesh(mergeGeos(qs), qm));
    }

    // ---- legs ----
    this.legs = [];
    const limbMat = skinMaterial(key, spec.skin, 3, 3);
    if (spec.kind === 'biped') {
      const L = spec.leg;
      for (const sd of [-1, 1]) {
        const hip = new THREE.Group();
        attach(rootBone, hip, new THREE.Vector3(sd * L.at[0], L.at[1] + rootBone.userData.pos.y, L.at[2] + rootBone.userData.pos.z));
        hip.add(new THREE.Mesh(limbGeo(L.thigh), limbMat));
        const knee = new THREE.Group(); knee.position.y = -L.len[0]; hip.add(knee);
        knee.add(new THREE.Mesh(limbGeo(L.shin), limbMat));
        const ankle = new THREE.Group(); ankle.position.y = -L.len[1]; knee.add(ankle);
        ankle.add(new THREE.Mesh(limbGeo(L.meta), limbMat));
        const toe = new THREE.Group(); toe.position.y = -L.len[2]; ankle.add(toe);
        const T = L.toe;
        for (let k = 0; k < T.n; k++) {
          const yaw = (k - (T.n - 1) / 2) * T.spread * sd * -1 + 0;
          const tg = new THREE.Group();
          tg.rotation.y = (k - (T.n - 1) / 2) * T.spread;
          const len = T.len * (k === 1 ? 1.0 : 0.82);
          const g = loft([[0, 0, T.r, T.r * 0.8, T.r * 0.7], [len * 0.5, -T.r * 0.1, T.r * 0.85, T.r * 0.7, T.r * 0.6], [len, -T.r * 0.3, T.r * 0.4, T.r * 0.35, T.r * 0.3]], { along: 6, around: 8, narrow: 0, uScale: 0.05, uOffset: 0.4 });
          tg.add(new THREE.Mesh(g, limbMat));
          const cl = new THREE.Mesh(coneGeo(T.r * 0.45, T.claw, 6), C.claw);
          cl.rotation.x = Math.PI / 2 + 0.5;
          cl.position.set(0, -T.r * 0.35, len + T.claw * 0.3);
          tg.add(cl);
          toe.add(tg);
          if (T.sickle && k === 1) {
            const sc = new THREE.Mesh(coneGeo(T.r * 0.6, T.claw * 2.2, 6), C.claw);
            sc.position.set(sd * T.r * 1.3, T.r * 0.8, 0.02);
            sc.rotation.x = -0.4;
            toe.add(sc);
          }
        }
        this.legs.push({ hip, knee, ankle, toe, side: sd, a: L.a, phase: sd > 0 ? 0 : Math.PI, front: false });
      }
      const a = L.a;
      const drop = L.len[0] * Math.cos(a[0]) + L.len[1] * Math.cos(a[0] + a[1]) + L.len[2] * Math.cos(a[0] + a[1] + a[2]) + L.toe.r * 0.9;
      this.hipHeight = drop - L.at[1] - rootBone.userData.pos.y;
      this.legLen = L.len[0] + L.len[1] + L.len[2];
      // arms
      if (spec.arm) {
        const A = spec.arm;
        this.arms = [];
        for (const sd of [-1, 1]) {
          const sh = new THREE.Group();
          attach(this.chest, sh, new THREE.Vector3(sd * A.at[0], A.at[1] + interp(st, J.front[0] / N)[1], A.at[2]));
          sh.rotation.x = A.a[0];
          sh.rotation.z = -sd * 0.15;
          sh.add(new THREE.Mesh(limbGeo([[-A.r, 0, A.r * 1.1, A.r * 1.2, A.r * 1.2], [A.len[0] * 0.5, 0, A.r, A.r, A.r], [A.len[0], 0, A.r * 0.8, A.r * 0.8, A.r * 0.8]], { along: 6, around: 8 }), limbMat));
          const el = new THREE.Group(); el.position.y = -A.len[0]; el.rotation.x = A.a[1]; sh.add(el);
          el.add(new THREE.Mesh(limbGeo([[-A.r * 0.6, 0, A.r * 0.85, A.r * 0.85, A.r * 0.85], [A.len[1], 0, A.r * 0.6, A.r * 0.6, A.r * 0.6]], { along: 5, around: 8 }), limbMat));
          for (let c = 0; c < A.claws; c++) {
            const cl = new THREE.Mesh(coneGeo(A.r * 0.35, A.r * 2.2, 5), C.claw);
            cl.position.set((c - (A.claws - 1) / 2) * A.r * 0.7, -A.len[1] - A.r, 0.02);
            cl.rotation.x = Math.PI - 0.6;
            el.add(cl);
          }
          if (spec.feathers) {
            const qm = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9, side: THREE.DoubleSide });
            const fg = new THREE.PlaneGeometry(0.05, 0.16).translate(0, -0.08, 0);
            for (let q = 0; q < 6; q++) {
              const f = new THREE.Mesh(fg, qm);
              f.position.set(sd * 0.01, -q * 0.035, -0.03);
              f.rotation.set(0.5, 0, 0);
              el.add(f);
            }
          }
          this.arms.push({ sh, el, a: A.a, side: sd });
        }
      }
    } else if (spec.kind !== 'swim') {
      // quadruped
      const H = spec.H;
      const mk = (D, isFront) => {
        for (const sd of [-1, 1]) {
          const hip = new THREE.Group();
          const meshPos = new THREE.Vector3(sd * D.at[0], D.at[1] + (isFront ? 0 : rootBone.userData.pos.y), D.at[2]);
          if (isFront) meshPos.y = D.at[1] + interp(st, J.front[0] / N)[1];
          attach(isFront ? this.chest : rootBone, hip, meshPos);
          // required vertical length
          const need = H + meshPos.y - rootBone.userData.pos.y - spec.footH;
          const a = D.a;
          const per = D.frac[0] * Math.cos(a[0]) + D.frac[1] * Math.cos(a[0] + a[1]);
          const Lt = need / per;
          const l0 = D.frac[0] * Lt, l1 = D.frac[1] * Lt;
          const r = D.r;
          hip.add(new THREE.Mesh(limbGeo([[-r[0] * 0.6, 0, r[0] * 0.9, r[0], r[0] * 1.1], [l0 * 0.35, 0, r[0], r[0], r[0] * 1.1], [l0, 0, r[1], r[1], r[1]], [l0 + r[1] * 0.4, 0, r[1] * 0.6, r[1] * 0.6, r[1] * 0.6]]), limbMat));
          const knee = new THREE.Group(); knee.position.y = -l0; hip.add(knee);
          knee.add(new THREE.Mesh(limbGeo([[-r[1] * 0.3, 0, r[1], r[1], r[1]], [l1 * 0.6, 0, r[2] * 0.95, r[2], r[2]], [l1, 0, r[2], r[2], r[2]]]), limbMat));
          const ankle = new THREE.Group(); ankle.position.y = -l1; knee.add(ankle);
          const foot = new THREE.Mesh(new THREE.CylinderGeometry(r[2] * 1.05, r[2] * 1.25, spec.footH, 12).translate(0, -spec.footH / 2, 0), limbMat);
          ankle.add(foot);
          for (let k = 0; k < 4; k++) {
            const nail = new THREE.Mesh(new THREE.SphereGeometry(r[2] * 0.22, 6, 5), C.horn);
            const ang = (k - 1.5) * 0.45;
            nail.position.set(Math.sin(ang) * r[2] * 1.15, -spec.footH * 0.75, Math.cos(ang) * r[2] * 1.15);
            ankle.add(nail);
          }
          this.legs.push({ hip, knee, ankle, toe: null, side: sd, a: [a[0], a[1], -(a[0] + a[1])], front: isFront, phase: 0 });
        }
      };
      mk(spec.rear, false);
      mk(spec.front, true);
      // lateral-sequence walk: LH 0, LF .25, RH .5, RF .75
      for (const l of this.legs) {
        const base = l.side < 0 ? 0 : 0.5;
        l.phase = (base + (l.front ? 0.25 : 0)) * Math.PI * 2;
      }
      this.hipHeight = H - rootBone.userData.pos.y;
      this.legLen = H;
    } else {
      // swimmer: paddle flippers and a vertical tail fluke
      this.flippers = [];
      const fm = skinMaterial(key, spec.skin, 2, 2);
      for (const [x, z, len] of spec.flippers) {
        for (const sd of [-1, 1]) {
          const pivot = new THREE.Group();
          const b = atZ(st, z);
          attach(z > rootBone.userData.pos.z ? this.chest : rootBone, pivot, new THREE.Vector3(sd * b[2] * 0.8, b[1] - b[4] * 0.4, z));
          const g = loft([[0, 0, 0.18, 0.05, 0.05], [len * 0.5, 0, 0.32, 0.04, 0.04], [len, 0, 0.05, 0.02, 0.02]], { along: 8, around: 10, narrow: 0, uScale: 0.1, uOffset: 0.5 });
          g.rotateY(sd * Math.PI / 2 + sd * -0.5); // sweep out and back
          const m = new THREE.Mesh(g, fm);
          pivot.add(m);
          this.flippers.push({ pivot, sd, front: z > 0 });
        }
      }
      const last = this.tail[this.tail.length - 1];
      const fl = new THREE.Shape();
      fl.moveTo(0, 0); fl.quadraticCurveTo(-0.6, 0.9, -1.2, 1.4); fl.quadraticCurveTo(-0.6, 0.4, -0.2, 0);
      fl.quadraticCurveTo(-0.6, -0.3, -0.9, -0.8); fl.quadraticCurveTo(-0.3, -0.4, 0, 0);
      const fg = new THREE.ExtrudeGeometry(fl, { depth: 0.08, bevelEnabled: false });
      fg.translate(0, 0, -0.04); fg.rotateY(-Math.PI / 2);
      const fluke = new THREE.Mesh(fg, fm);
      const tz = st[0][0] + 0.5;
      attach(last, fluke, new THREE.Vector3(0, atZ(st, tz)[1], tz));
      this.hipHeight = 0;
      this.legLen = 4;
    }

    // ---- sail / plates / spikes ----
    if (spec.sail) {
      const S = spec.sail;
      const sh = new THREE.Shape();
      const top = z => {
        const t = (z - S.z0) / (S.z1 - S.z0);
        return S.h * Math.pow(Math.sin(Math.PI * clamp(t, 0, 1)), 0.8) * (1 - 0.25 * t);
      };
      const base = z => atZ(st, z);
      sh.moveTo(S.z0, base(S.z0)[1] + base(S.z0)[3] * 0.6);
      const K = 40;
      for (let i = 0; i <= K; i++) {
        const z = lerp(S.z0, S.z1, i / K);
        const b = base(z);
        sh.lineTo(z, b[1] + b[3] * 0.8 + top(z) * (1 + (i % 2) * 0.03));
      }
      for (let i = K; i >= 0; i--) {
        const z = lerp(S.z0, S.z1, i / K);
        const b = base(z);
        sh.lineTo(z, b[1] + b[3] * 0.55);
      }
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: false });
      g.translate(0, 0, -0.035);
      g.rotateY(-Math.PI / 2);
      const smat = new THREE.MeshStandardMaterial({ map: sailTexture(), roughness: 0.7, side: THREE.DoubleSide });
      smat.map.repeat.set(1 / (S.z1 - S.z0), 1 / 4.5);
      smat.map.offset.set(-S.z0 / (S.z1 - S.z0), 0);
      const sail = new THREE.Mesh(g, smat);
      sail.position.copy(rootBone.userData.pos).negate();
      rootBone.add(sail);
    }
    if (spec.plates) {
      const pmat = new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.6 });
      const plateShape = (w, h) => {
        const s = new THREE.Shape();
        s.moveTo(-w / 2, 0);
        s.bezierCurveTo(-w * 0.6, h * 0.5, -w * 0.15, h * 0.85, 0, h);
        s.bezierCurveTo(w * 0.15, h * 0.85, w * 0.6, h * 0.5, w / 2, 0);
        s.lineTo(-w / 2, 0);
        return s;
      };
      const n = 17;
      for (let i = 0; i < n; i++) {
        const z = lerp(-3.3, 2.9, i / (n - 1));
        const b = atZ(st, z);
        const t = i / (n - 1);
        const h = 0.25 + 0.75 * Math.sin(Math.PI * clamp(t * 1.15 - 0.05, 0, 1));
        const g = new THREE.ExtrudeGeometry(plateShape(h * 0.85, h), { depth: 0.04, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.02, bevelSegments: 1 });
        g.translate(0, 0, -0.02);
        g.rotateY(-Math.PI / 2);
        const m = new THREE.Mesh(g, pmat);
        const sd = i % 2 ? 1 : -1;
        const bone = boneNearestZ(z);
        attach(bone, m, new THREE.Vector3(sd * 0.09, b[1] + b[3] * 0.85, z));
        m.rotation.z = sd * 0.12;
        m.rotation.x = -0.15 + t * 0.3;
        pmat.map.repeat.set(1, 1);
      }
    }
    if (spec.spikes) {
      const last = this.tail[this.tail.length - 1];
      for (const sd of [-1, 1]) for (const k of [0, 1]) {
        const g = coneGeo(0.05, 0.75, 8).translate(0, 0.37, 0);
        const m = new THREE.Mesh(g, C.horn);
        const z = -3.85 - k * 0.4;
        const b = atZ(st, z);
        attach(last, m, new THREE.Vector3(sd * b[2] * 0.6, b[1] + b[3] * 0.4, z));
        m.rotation.set(-0.9, 0, -sd * 0.9);
      }
    }

    // ---- extra species features ----
    if (spec.tubeCrest) {
      const tc = spec.tubeCrest;
      const g = loft([[0, 0, tc.r * 0.8, tc.r, tc.r], [tc.len * 0.5, 0.02, tc.r, tc.r * 1.1, tc.r], [tc.len, 0, tc.r * 0.7, tc.r * 0.8, tc.r * 0.7], [tc.len + 0.06, 0, 0.02, 0.02, 0.02]], { along: 10, around: 10, narrow: 0, uScale: 0.05, uOffset: 0.95 });
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: tc.color, roughness: 0.6, normalMap: mat.normalMap }));
      m.position.set(0, tc.at[1], tc.at[2]);
      m.rotation.x = Math.PI + tc.angle; // point backwards and up
      head.add(m);
    }
    if (spec.armor) {
      // rows of bony osteoderms over the back and spikes on the flanks
      const bonesM = C.horn;
      const studs = [], spikes = [];
      for (let z = -2.4; z <= 2.3; z += 0.34) {
        const b = atZ(st, z);
        const rowN = 5;
        for (let k = 0; k < rowN; k++) {
          const th = (k - (rowN - 1) / 2) * 0.42;
          const sx = Math.sin(th) * b[2] * 0.95, sy = b[1] + Math.cos(th) * b[3] * 0.95;
          const g = coneGeo(0.07, 0.12, 6).translate(0, 0.05, 0);
          g.rotateZ(-th); g.translate(sx, sy, z);
          studs.push(g);
        }
        for (const sd of [-1, 1]) {
          const g = coneGeo(0.06, 0.32, 6).translate(0, 0.16, 0);
          g.rotateZ(-sd * Math.PI / 2 + sd * 0.25); g.translate(sd * b[2] * 0.98, b[1] - b[4] * 0.1, z);
          spikes.push(g);
        }
      }
      const studMesh = new THREE.Mesh(mergeGeos(studs.concat(spikes)), bonesM);
      studMesh.position.copy(rootBone.userData.pos).negate();
      rootBone.add(studMesh);
      // tail club
      const last = this.tail[this.tail.length - 1];
      const club = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), new THREE.MeshStandardMaterial({ map: mat.map, normalMap: mat.normalMap, roughness: 0.6 }));
      club.scale.set(1.3, 0.6, 0.9);
      const zc = st[0][0] + 0.25;
      attach(last, club, new THREE.Vector3(0, atZ(st, zc)[1], zc));
    }

    if (spec.neckFrill) {
      const nb = this.neck[0] || this.chest;
      const g = new THREE.RingGeometry(0.1, spec.neckFrill.r, 28, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), r = Math.hypot(x, y);
        if (r > 0.2) { const a = Math.atan2(y, x), k = 1 + 0.12 * Math.sin(a * 14); p.setXY(i, x * k, y * k); }
      }
      const fr = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: neckFrillTexture(), side: THREE.DoubleSide, roughness: 0.6, transparent: true, alphaTest: 0.3 }));
      fr.position.set(0, 0.05, 0.15);
      nb.add(fr);
      this.frill = fr;
      this.frillOpen = 0; this.frillTarget = 0;
    }
    this.pivot.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    // ---- state ----
    this.pos = new THREE.Vector3();
    this.heading = 0;
    this.speed = 0;
    this.phase = Math.random() * 6;
    this.time = Math.random() * 10;
    this.jawOpen = 0; this.jawTarget = 0;
    this.look = null; this.lookW = 0;
    this.yawN = 0; this.pitchN = 0;
    this.roarT = 0;
    this.lean = 0;
    this.bodyPitch = 0;
    this.headDip = 0;
    this.groundFn = null;
    this.tmp = new THREE.Vector3();
  }

  setScale(s) { this.root.scale.setScalar(s); this.scale = s; }

  roar(dur = 2.4) { this.roarT = dur; this.roarDur = dur; }

  place(x, y, z, heading) { this.pos.set(x, y, z); if (heading !== undefined) this.heading = heading; }

  headWorld(out) {
    this.head.updateWorldMatrix(true, false);
    return out.set(0, 0, 0.6).applyMatrix4(this.head.matrixWorld);
  }

  update(dt) {
    const spec = this.spec;
    this.time += dt;
    const sc = this.scale || 1;
    const k = clamp(this.speed / (spec.runSpeed * sc), 0, 1.4);
    // gait
    const stride = this.legLen * sc * (1.5 + 1.2 * Math.min(k, 1));
    this.phase += (this.speed / stride) * Math.PI * 2 * dt + dt * 0.0;
    const ph = this.phase;
    // root placement
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.heading;
    const bob = spec.kind === 'biped' ? Math.cos(ph * 2) * 0.035 * Math.min(k, 1) * this.legLen : Math.cos(ph * 2) * 0.01 * Math.min(k, 1) * this.legLen;
    const breath = Math.sin(this.time * 1.6) * 0.012 * this.legLen;
    this.pivot.position.y = this.hipHeight + bob + breath - Math.min(k, 1) * 0.04 * this.legLen - (this.crouch || 0) * 0.22 * this.hipHeight;
    const leanT = spec.kind === 'biped' ? Math.min(k, 1) * 0.12 : 0;
    this.lean += (leanT - this.lean) * Math.min(1, dt * 3);
    this.pivot.rotation.x = this.lean + this.bodyPitch;
    // weight shift from foot to foot
    const kk = Math.min(k, 1);
    this.pivot.rotation.z = Math.sin(ph) * (spec.kind === 'biped' ? 0.035 : 0.02) * kk;
    this.pivot.rotation.y = Math.sin(ph) * 0.025 * kk;

    // legs
    for (const l of this.legs) {
      const p = ph + l.phase;
      const s = Math.sin(p), c = Math.cos(p);
      const A = (spec.kind === 'biped' ? 0.5 : 0.32) * Math.min(k, 1.1);
      const lift = Math.max(0, c);
      if (spec.kind === 'biped') {
        l.hip.rotation.x = l.a[0] - A * s;
        l.knee.rotation.x = l.a[1] + lift * A * 1.5;
        l.ankle.rotation.x = l.a[2] - lift * A * 1.1;
        if (l.toe) l.toe.rotation.x = -(l.hip.rotation.x + l.knee.rotation.x + l.ankle.rotation.x) + lift * A * 0.8;
      } else {
        // front legs hang from the chest bone: cancel its tilt so they stay planted
        const ct = l.front ? this.chest.rotation.x : 0;
        l.hip.rotation.x = l.a[0] - A * s - ct;
        l.knee.rotation.x = l.a[1] + lift * A * (l.front ? -0.9 : 1.1);
        l.ankle.rotation.x = -(l.hip.rotation.x + l.knee.rotation.x + ct);
      }
    }
    if (this.arms) for (const a of this.arms) {
      a.sh.rotation.x = a.a[0] + Math.sin(ph + (a.side > 0 ? 0 : Math.PI)) * 0.15 * Math.min(k, 1) + Math.sin(this.time * 1.3) * 0.05;
      a.el.rotation.x = a.a[1] + Math.sin(this.time * 1.7 + a.side) * 0.08;
    }
    if (this.flippers) for (const f of this.flippers) {
      f.pivot.rotation.z = f.sd * (0.25 + Math.sin(this.time * 2.2 + (f.front ? 0 : 1.5)) * 0.35);
      f.pivot.rotation.x = Math.sin(this.time * 2.2 + (f.front ? 0 : 1.5)) * 0.25;
    }
    if (this.frill) {
      this.frillOpen += ((this.frillTarget || 0) - this.frillOpen) * Math.min(1, dt * 6);
      this.frill.scale.setScalar(0.12 + 0.88 * this.frillOpen);
      this.frill.visible = this.frillOpen > 0.05;
    }
    // tail sway
    const tn = this.tail.length;
    this.tail.forEach((b, i) => {
      const w = (i + 1) / tn;
      b.rotation.y = Math.sin(this.time * (1.1 + k) - i * 0.7) * (0.05 + 0.03 * k) * w * 2 - Math.sin(ph - i * 0.4) * 0.05 * Math.min(k, 1) * w
        + (spec.kind === 'swim' ? Math.sin(this.time * 2.4 - i * 0.8) * 0.12 * w : 0)
        + (this.tailSwing || 0) * Math.sin(this.time * 3.2 - i * 0.45) * 0.38 * w;
      b.rotation.x = Math.sin(this.time * 0.9 - i * 0.5) * 0.02 + (k > 0.5 ? -0.02 : 0.015 * w);
    });
    // look / neck
    let yaw = 0, pitch = 0;
    if (this.look && this.lookW > 0) {
      this.root.updateMatrixWorld(true);
      const loc = this.tmp.copy(this.look);
      this.pivot.worldToLocal(loc);
      const nb = (this.neck[0] || this.headBone).userData.pos;
      const hp = this.headBone.userData.pos;
      const dx = loc.x - nb.x, dy = loc.y - nb.y, dz = loc.z - nb.z;
      const restA = Math.atan2(hp.y - nb.y, hp.z - nb.z);
      yaw = clamp(Math.atan2(dx, dz), -1.3, 1.3) * this.lookW;
      pitch = clamp(-(Math.atan2(dy, Math.hypot(dx, dz)) - restA), -0.9, 0.9) * this.lookW * (this.lookPitchMul ?? spec.lookPitch ?? 1);
    }
    yaw += this.extraYaw || 0;
    // roar overrides
    let roarLift = 0, shake = 0;
    if (this.roarT > 0) {
      this.roarT -= dt;
      const t = 1 - this.roarT / this.roarDur;
      const env = Math.sin(Math.PI * clamp(t * 1.2, 0, 1));
      roarLift = -0.35 * env;
      shake = Math.sin(this.time * 38) * 0.05 * env;
      this.jawTarget = Math.max(this.jawTarget, env);
    }
    const sm = Math.min(1, dt * 4);
    this.yawN += (yaw - this.yawN) * sm;
    this.pitchN += (pitch + roarLift - this.pitchN) * sm;
    this.dipN = (this.dipN || 0) + ((this.headDip || 0) - (this.dipN || 0)) * Math.min(1, dt * 2.5);
    const nn = this.neck.length + 1;
    // lowering the head (grazing, drinking, feeding) bends mostly at the base of the neck
    const dip = this.dipN, wSum = nn * (nn + 1) / 2;
    this.neck.forEach((b, i) => {
      b.rotation.y = this.yawN / nn + shake;
      b.rotation.x = this.pitchN / nn + dip * 0.75 * (nn - i) / wSum;
    });
    this.chest.rotation.y = this.yawN * 0.15;
    this.chest.rotation.x = dip * 0.3;
    this.headBone.rotation.y = this.yawN / nn;
    this.headBone.rotation.x = this.pitchN / nn + dip * 0.75 / wSum - dip * 0.12 - Math.cos(this.phase * 2) * 0.03 * Math.min(k, 1) + (this.chew ? Math.sin(this.time * 9) * 0.04 * this.chew : 0);
    // jaw
    this.jawOpen += (this.jawTarget - this.jawOpen) * Math.min(1, dt * (this.jawTarget > this.jawOpen ? 14 : 6));
    this.jaw.rotation.x = this.jawOpen * spec.jaw.open + Math.max(0, Math.sin(this.time * 0.7)) * 0.02;
    this.jawTarget = 0;
  }
}

// ---------- extra textures ----------
let _sailTex = null, _plateTex = null;
const _frill = {};
function sailTexture() {
  if (_sailTex) return _sailTex;
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#2c1c1a'); g.addColorStop(0.35, '#5a2e26'); g.addColorStop(0.75, '#2f4a52'); g.addColorStop(1, '#3a4a38');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 26; i++) {
    const x = 10 + i * 19;
    ctx.strokeStyle = 'rgba(15,10,8,0.6)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, 256); ctx.lineTo(x + 6, 0); ctx.stroke();
  }
  for (let i = 0; i < 3000; i++) {
    ctx.fillStyle = `rgba(${Math.random() * 60 | 0},${Math.random() * 40 | 0},${Math.random() * 30 | 0},0.15)`;
    ctx.fillRect(Math.random() * 512, Math.random() * 256, 3, 3);
  }
  _sailTex = TX.toTexture(c, { repeat: true });
  return _sailTex;
}
function plateTexture() {
  if (_plateTex) return _plateTex;
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 128, 0, 0);
  g.addColorStop(0, '#4c5a32'); g.addColorStop(0.45, '#8a3a2c'); g.addColorStop(1, '#a8473a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(40,10,8,0.5)';
  for (let i = 0; i < 18; i++) { ctx.beginPath(); ctx.moveTo(64, 128); ctx.lineTo(i * 7.5, 0); ctx.stroke(); }
  _plateTex = TX.toTexture(c, { repeat: true });
  return _plateTex;
}
let _domeTex = null, _nfTex = null;
function domeTexture() {
  if (_domeTex) return _domeTex;
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, '#e2d6b8'); g.addColorStop(0.5, '#b9a582'); g.addColorStop(1, '#7c6648');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 64);
  for (let i = 0; i < 300; i++) { ctx.fillStyle = `rgba(60,40,20,${Math.random() * 0.2})`; ctx.fillRect(Math.random() * 128, Math.random() * 64, 2, 2); }
  _domeTex = TX.toTexture(c);
  return _domeTex;
}
function neckFrillTexture() {
  if (_nfTex) return _nfTex;
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 20, 128, 128, 128);
  g.addColorStop(0, '#3a3a20'); g.addColorStop(0.35, '#d8b21e'); g.addColorStop(0.65, '#c2381c'); g.addColorStop(0.92, '#f0d040'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(40,20,10,0.55)'; ctx.lineWidth = 3;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 14) { ctx.beginPath(); ctx.moveTo(128 + Math.cos(a) * 30, 128 + Math.sin(a) * 30); ctx.lineTo(128 + Math.cos(a) * 125, 128 + Math.sin(a) * 125); ctx.stroke(); }
  _nfTex = TX.toTexture(c);
  return _nfTex;
}
function frillTexture(skin) {
  const k = skin.seed;
  if (_frill[k]) return _frill[k];
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  const b = skin.base;
  ctx.fillStyle = `rgb(${b[0]},${b[1]},${b[2]})`; ctx.fillRect(0, 0, 256, 256);
  const g = ctx.createRadialGradient(128, 70, 10, 128, 70, 120);
  const fc = skin.frill || [225, 150, 140];
  g.addColorStop(0, `rgba(${fc[0]},${fc[1]},${fc[2]},0.9)`); g.addColorStop(0.55, `rgba(${fc[0]},${fc[1]},${fc[2]},0.45)`); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    ctx.strokeStyle = 'rgba(30,25,15,0.25)';
    ctx.beginPath(); ctx.arc(Math.random() * 256, Math.random() * 256, 3 + Math.random() * 4, 0, Math.PI * 2); ctx.stroke();
  }
  _frill[k] = TX.toTexture(c, { repeat: false });
  _frill[k].wrapS = _frill[k].wrapT = THREE.ClampToEdgeWrapping;
  return _frill[k];
}

// ---------------- Pteranodon (simple rig) ----------------
export class Ptero {
  constructor() {
    this.root = new THREE.Group();
    const C = common();
    const mat = skinMaterial('ptero', { seed: 51, base: [122, 98, 74], dark: [72, 56, 42], belly: [190, 172, 146], stripeFreq: 4, stripeAmt: 0.1, wrinkle: 0.5 }, 3, 3);
    const body = new THREE.Mesh(loft([[-0.7, 0, 0.02, 0.02, 0.02], [-0.4, 0, 0.12, 0.12, 0.14], [0.1, 0, 0.17, 0.17, 0.2], [0.45, 0.05, 0.12, 0.12, 0.12], [0.7, 0.12, 0.06, 0.06, 0.06]], { along: 14, around: 10 }), mat);
    this.root.add(body);
    const head = new THREE.Group();
    head.position.set(0, 0.14, 0.72);
    head.add(new THREE.Mesh(loft([[-0.35, 0.05, 0.03, 0.12, 0.02], [-0.1, 0.03, 0.07, 0.08, 0.05], [0.4, 0, 0.035, 0.04, 0.03], [0.9, -0.03, 0.01, 0.01, 0.01]], { along: 12, around: 8 }), mat));
    const crest = new THREE.Mesh(coneGeo(0.07, 0.75, 6).scale(0.5, 1, 1.6), new THREE.MeshStandardMaterial({ color: 0xc98745, roughness: 0.55 }));
    crest.rotation.x = -1.9; crest.position.set(0, 0.12, -0.3);
    head.add(crest);
    this.root.add(head);
    const memMat = new THREE.MeshStandardMaterial({ color: 0x6a4a38, roughness: 0.8, side: THREE.DoubleSide, transparent: true, opacity: 0.95 });
    this.wings = [];
    for (const sd of [-1, 1]) {
      const w = new THREE.Group();
      w.position.set(sd * 0.12, 0.05, 0.25);
      const s = new THREE.Shape();
      s.moveTo(0, 0.35); s.quadraticCurveTo(1.8, 0.45, 3.6, 0.1); s.quadraticCurveTo(2.2, -0.6, 0.2, -1.1); s.lineTo(0, 0.35);
      const g = new THREE.ShapeGeometry(s);
      g.rotateX(Math.PI / 2);
      if (sd < 0) g.scale(-1, 1, 1);
      w.add(new THREE.Mesh(g, memMat));
      const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.015, 3.5, 5).rotateZ(Math.PI / 2).translate(sd * 1.75, 0, -0.12), mat);
      w.add(bone);
      this.root.add(w);
      this.wings.push({ w, sd });
    }
    this.root.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.t = Math.random() * 10;
  }
  update(dt, flap = 1) {
    this.t += dt;
    const a = Math.sin(this.t * 3.2) * 0.45 * flap + 0.15;
    for (const { w, sd } of this.wings) w.rotation.z = sd * a;
  }
}
