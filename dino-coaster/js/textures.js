// Procedurally generated textures (canvas based)
import * as THREE from 'three';
import { rng, makeTileNoise, tileFbm, clamp, smoothstep, lerp } from './noise.js';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function toTexture(c, { srgb = true, repeat = false, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

// Turn a tileable height array into a tangent-space normal map canvas
function heightToNormalCanvas(h, W, H, strength) {
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const l = h[y * W + ((x - 1 + W) % W)], r = h[y * W + ((x + 1) % W)];
      const u = h[((y - 1 + H) % H) * W + x], b = h[((y + 1) % H) * W + x];
      let nx = (l - r) * strength, ny = (b - u) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * W + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Voronoi scale pattern: returns height array (tileable)
function voronoiHeights(W, cells, seed, roundness = 0.35) {
  const r = rng(seed);
  const pts = new Float32Array(cells * cells * 2);
  for (let i = 0; i < cells * cells; i++) { pts[i * 2] = r(); pts[i * 2 + 1] = r(); }
  const out = new Float32Array(W * W);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W * cells, v = (y + 0.5) / W * cells;
      const cx = Math.floor(u), cy = Math.floor(v);
      let f1 = 9, f2 = 9;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy;
          const wx = ((nx % cells) + cells) % cells, wy = ((ny % cells) + cells) % cells;
          const k = (wy * cells + wx) * 2;
          const px = nx + pts[k], py = ny + pts[k + 1];
          const dd = Math.hypot(u - px, v - py);
          if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) f2 = dd;
        }
      }
      const edge = smoothstep(0.0, roundness, f2 - f1);
      out[y * W + x] = edge * (1 - 0.45 * f1);
    }
  }
  return out;
}

export function makeScaleNormal(seed = 3, cells = 14, strength = 2.2) {
  const W = 256;
  const h = voronoiHeights(W, cells, seed);
  // add a second finer layer
  const h2 = voronoiHeights(W, cells * 2, seed + 7, 0.3);
  for (let i = 0; i < h.length; i++) h[i] = h[i] * 0.75 + h2[i] * 0.25;
  return toTexture(heightToNormalCanvas(h, W, W, strength), { srgb: false, repeat: true });
}

// ---------- Ground detail ----------
export function makeGroundTextures() {
  const W = 256;
  const tn = makeTileNoise(91);
  const tn2 = makeTileNoise(17);
  const c = makeCanvas(W, W);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, W);
  const h = new Float32Array(W * W);
  const r = rng(5);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / W;
      const n = tileFbm(tn, u, v, 8, 5);
      const n2 = tileFbm(tn2, u, v, 32, 3);
      let val = 0.72 + 0.35 * (n - 0.5) + 0.25 * (n2 - 0.5) + (r() - 0.5) * 0.12;
      val = clamp(val, 0.35, 1);
      h[y * W + x] = n * 0.6 + n2 * 0.4;
      const i = (y * W + x) * 4;
      // slight green/brown variation
      img.data[i] = clamp(val * (1.0 + (n2 - 0.5) * 0.2), 0, 1) * 255;
      img.data[i + 1] = val * 255;
      img.data[i + 2] = clamp(val * 0.9, 0, 1) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // grass blades strokes
  ctx.globalAlpha = 0.25;
  for (let i = 0; i < 1600; i++) {
    const x = r() * W, y = r() * W, l = 2 + r() * 5;
    const g = 120 + r() * 120;
    ctx.strokeStyle = `rgb(${g * 0.85},${g},${g * 0.7})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 2, y - l); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const map = toTexture(c, { repeat: true });
  const normal = toTexture(heightToNormalCanvas(h, W, W, 4), { srgb: false, repeat: true });
  return { map, normal };
}

export function makeRockTextures(seed = 33, tint = [0.52, 0.48, 0.43]) {
  const W = 256;
  const tn = makeTileNoise(seed);
  const vh = voronoiHeights(W, 6, seed + 1, 0.12);
  const c = makeCanvas(W, W);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, W);
  const h = new Float32Array(W * W);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / W;
      const n = tileFbm(tn, u, v, 6, 6);
      const crack = vh[y * W + x];
      const hh = n * 0.7 + crack * 0.5;
      h[y * W + x] = hh;
      const val = clamp(0.55 + (n - 0.5) * 0.9, 0.15, 1) * (0.65 + 0.35 * crack);
      const i = (y * W + x) * 4;
      img.data[i] = clamp(val * tint[0] * 1.9, 0, 1) * 255;
      img.data[i + 1] = clamp(val * tint[1] * 1.9, 0, 1) * 255;
      img.data[i + 2] = clamp(val * tint[2] * 1.9, 0, 1) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return {
    map: toTexture(c, { repeat: true }),
    normal: toTexture(heightToNormalCanvas(h, W, W, 6), { srgb: false, repeat: true }),
  };
}

export function makeWaterNormal() {
  const W = 256;
  const tn = makeTileNoise(71);
  const h = new Float32Array(W * W);
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / W;
      h[y * W + x] = tileFbm(tn, u, v, 8, 5) + 0.3 * Math.sin((u + v) * Math.PI * 2 * 6);
    }
  return toTexture(heightToNormalCanvas(h, W, W, 3), { srgb: false, repeat: true });
}

export function makeWoodTexture() {
  const W = 256, H = 256;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const tn = makeTileNoise(9);
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      const n = tileFbm(tn, u * 0.25, v * 4, 8, 4);
      const grain = 0.5 + 0.5 * Math.sin((v * 40 + n * 8) * Math.PI);
      const plank = (Math.floor(v * 6) % 2) * 0.06;
      const val = 0.55 + grain * 0.18 + (n - 0.5) * 0.3 - plank;
      const i = (y * W + x) * 4;
      img.data[i] = clamp(val * 0.62, 0, 1) * 255;
      img.data[i + 1] = clamp(val * 0.44, 0, 1) * 255;
      img.data[i + 2] = clamp(val * 0.28, 0, 1) * 255;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = 'rgba(30,18,8,0.55)';
  for (let k = 1; k < 6; k++) { ctx.beginPath(); ctx.moveTo(0, k * H / 6); ctx.lineTo(W, k * H / 6); ctx.stroke(); }
  return toTexture(c, { repeat: true });
}

export function makeThatchTexture() {
  const W = 256;
  const c = makeCanvas(W, W);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#6b5530'; ctx.fillRect(0, 0, W, W);
  const r = rng(12);
  for (let i = 0; i < 2500; i++) {
    const x = r() * W, y = r() * W, l = 10 + r() * 24;
    const g = 90 + r() * 90;
    ctx.strokeStyle = `rgba(${g + 40},${g + 15},${g * 0.45},0.8)`;
    ctx.lineWidth = 1 + r();
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * 3, y + l); ctx.stroke();
  }
  return toTexture(c, { repeat: true });
}

// Fern / palm frond with transparent background. Frond runs bottom (stem) to top (tip).
export function makeFrondTexture(seed = 4, hue = [0.28, 0.45, 0.16]) {
  const W = 128, H = 256;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const r = rng(seed);
  const col = (k) => `rgb(${Math.round(hue[0] * 255 * k)},${Math.round(hue[1] * 255 * k)},${Math.round(hue[2] * 255 * k)})`;
  ctx.lineCap = 'round';
  // stem
  ctx.strokeStyle = col(0.7); ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(W / 2, H); ctx.quadraticCurveTo(W / 2 + 6, H / 2, W / 2, 4); ctx.stroke();
  const n = 26;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const y = H - 10 - t * (H - 20);
    const len = (W / 2 - 4) * Math.sin(Math.PI * (0.15 + t * 0.85)) * (0.85 + r() * 0.15);
    for (const s of [-1, 1]) {
      const k = 0.75 + r() * 0.5;
      ctx.fillStyle = col(k);
      ctx.beginPath();
      ctx.moveTo(W / 2, y);
      ctx.quadraticCurveTo(W / 2 + s * len * 0.5, y - 9, W / 2 + s * len, y - 14 - t * 4);
      ctx.quadraticCurveTo(W / 2 + s * len * 0.5, y + 2, W / 2, y + 4);
      ctx.fill();
    }
  }
  const t = toTexture(c);
  t.premultiplyAlpha = false;
  return t;
}

export function makeSoftDot(size = 64, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.4, inner.replace(/[\d.]+\)$/, '0.6)'));
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return toTexture(c);
}

export function makeSmokeTexture() {
  const W = 128;
  const c = makeCanvas(W, W);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, W);
  const tn = makeTileNoise(55);
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      const dx = (x - W / 2) / (W / 2), dy = (y - W / 2) / (W / 2);
      const d = Math.hypot(dx, dy);
      const n = tileFbm(tn, x / W, y / W, 4, 4);
      const a = clamp((1 - d) * 1.4, 0, 1) * clamp(n * 1.6 - 0.2, 0, 1);
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = a * 255;
    }
  ctx.putImageData(img, 0, 0);
  return toTexture(c);
}

export function makeFlameTexture() {
  const W = 64, H = 128;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(W / 2, H * 0.7, 2, W / 2, H * 0.6, H * 0.5);
  g.addColorStop(0, 'rgba(255,255,220,1)');
  g.addColorStop(0.25, 'rgba(255,190,60,0.95)');
  g.addColorStop(0.6, 'rgba(255,80,10,0.5)');
  g.addColorStop(1, 'rgba(120,20,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(W / 2, 2);
  ctx.bezierCurveTo(W * 0.95, H * 0.5, W * 0.9, H * 0.95, W / 2, H - 2);
  ctx.bezierCurveTo(W * 0.1, H * 0.95, W * 0.05, H * 0.5, W / 2, 2);
  ctx.fill();
  return toTexture(c);
}

export function makeEyeTexture(iris = [220, 160, 40], slit = true) {
  const W = 256, H = 128;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1a120a'; ctx.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2, R = 26;
  const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, R);
  g.addColorStop(0, `rgb(${iris[0] * 1.1},${iris[1] * 1.1},${iris[2]})`);
  g.addColorStop(0.7, `rgb(${iris[0]},${iris[1]},${iris[2]})`);
  g.addColorStop(1, `rgb(${iris[0] * 0.4},${iris[1] * 0.35},${iris[2] * 0.3})`);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
  // iris fibers
  ctx.strokeStyle = 'rgba(80,40,10,0.35)';
  for (let a = 0; a < Math.PI * 2; a += 0.15) {
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 6, cy + Math.sin(a) * 6);
    ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.stroke();
  }
  ctx.fillStyle = '#050302';
  ctx.beginPath();
  if (slit) ctx.ellipse(cx, cy, 4.5, R * 0.85, 0, 0, Math.PI * 2);
  else ctx.arc(cx, cy, 9, 0, Math.PI * 2);
  ctx.fill();
  return toTexture(c);
}

/*
 Dinosaur skin. Texture u runs along the body (tail -> head), v runs around the
 circumference with v=0 / v=1 on the dorsal midline and v=0.5 on the belly.
*/
export function makeSkinTexture(p, W = 1024, H = 512) {
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const tn = makeTileNoise(p.seed || 1);
  const tn2 = makeTileNoise((p.seed || 1) + 100);
  const base = p.base, dark = p.dark, belly = p.belly, accent = p.accent || p.base;
  const r = rng((p.seed || 1) * 7);
  for (let y = 0; y < H; y++) {
    const v = y / H;
    const dorsal = Math.cos(v * Math.PI * 2); // 1 = back, -1 = belly
    const bellyMix = smoothstep(-0.05, -0.7, dorsal);
    const flank = 1 - Math.abs(dorsal);
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const n = tileFbm(tn, u, v, 6, 4);
      const nf = tileFbm(tn2, u, v, 48, 2);
      // stripes across the body, wobbling
      const sv = Math.sin((u * p.stripeFreq + (n - 0.5) * 1.6 + 0.12 * Math.sin(v * 25)) * Math.PI * 2);
      let stripe = smoothstep(p.stripeSharp || 0.35, 0.95, sv) * smoothstep(-0.45, 0.4, dorsal);
      stripe *= p.stripeAmt;
      // blotches/spots
      const spot = p.spotAmt ? smoothstep(0.58, 0.7, tileFbm(tn2, u, v, p.spotFreq || 20, 3)) * p.spotAmt : 0;
      let cr = base[0], cg = base[1], cb = base[2];
      // accent on flanks (e.g. blue on spinosaurus)
      if (p.accentAmt) {
        const a = p.accentAmt * flank * smoothstep(0.45, 0.65, n);
        cr = lerp(cr, accent[0], a); cg = lerp(cg, accent[1], a); cb = lerp(cb, accent[2], a);
      }
      const dk = clamp(stripe + spot + smoothstep(0.75, 1.0, dorsal) * (p.backDark ?? 0.35), 0, 1);
      cr = lerp(cr, dark[0], dk); cg = lerp(cg, dark[1], dk); cb = lerp(cb, dark[2], dk);
      cr = lerp(cr, belly[0], bellyMix); cg = lerp(cg, belly[1], bellyMix); cb = lerp(cb, belly[2], bellyMix);
      // skin folds / wrinkles (cinematic, less cartoony)
      if (p.wrinkle) {
        const fold = Math.pow(Math.abs(Math.sin((u * 140 + (n - 0.5) * 6 + Math.sin(v * 31) * 0.4) * Math.PI)), 14);
        const fine = Math.pow(Math.abs(Math.sin((u * 420 + nf * 3 + v * 7) * Math.PI)), 20);
        const k = p.wrinkle * (0.22 * fold * smoothstep(0.3, 0.7, n) + 0.1 * fine);
        cr *= 1 - k; cg *= 1 - k; cb *= 1 - k;
      }
      // large-scale mottling + fine scale speckle
      const m = 0.82 + 0.36 * (n - 0.5) * 2 * (p.mottle ?? 0.5) + (nf - 0.5) * 0.35 + (r() - 0.5) * 0.06;
      const i = (y * W + x) * 4;
      img.data[i] = clamp(cr * m, 0, 255);
      img.data[i + 1] = clamp(cg * m, 0, 255);
      img.data[i + 2] = clamp(cb * m, 0, 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = toTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Simple painted sign
export function makeSignTexture(title, sub) {
  const W = 1024, H = 256;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const wood = ctx.createLinearGradient(0, 0, 0, H);
  wood.addColorStop(0, '#5a3a1c'); wood.addColorStop(1, '#3a220f');
  ctx.fillStyle = wood; ctx.fillRect(0, 0, W, H);
  const r = rng(3);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  for (let i = 0; i < 60; i++) { const y = r() * H; ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(W * 0.3, y + 6, W * 0.6, y - 6, W, y); ctx.stroke(); }
  ctx.strokeStyle = '#1e1208'; ctx.lineWidth = 14; ctx.strokeRect(7, 7, W - 14, H - 14);
  ctx.fillStyle = '#f2b632';
  ctx.font = 'bold 118px Impact, "Arial Black", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 5;
  ctx.fillText(title, W / 2, H * 0.42);
  ctx.font = 'bold 44px "Arial Black", sans-serif';
  ctx.fillStyle = '#f4e6c8';
  ctx.fillText(sub, W / 2, H * 0.8);
  return toTexture(c);
}

export function makeClawMarks() {
  const W = 256;
  const c = makeCanvas(W, W);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, W);
  ctx.strokeStyle = 'rgba(40,20,10,0.9)';
  ctx.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    ctx.lineWidth = 10 - k;
    ctx.beginPath();
    ctx.moveTo(60 + k * 45, 30);
    ctx.quadraticCurveTo(90 + k * 45, 120, 80 + k * 45, 225);
    ctx.stroke();
  }
  return toTexture(c);
}

export function makeGrassTexture() {
  const W = 256, H = 128;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const r = rng(21);
  for (let i = 0; i < 140; i++) {
    const x = 8 + r() * (W - 16), h = H * (0.35 + r() * 0.6), lean = (r() - 0.5) * 30;
    const g = 70 + r() * 70;
    ctx.fillStyle = `rgb(${Math.round(g * 0.62 + r() * 30)},${Math.round(g + 20)},${Math.round(g * 0.32)})`;
    ctx.beginPath();
    ctx.moveTo(x - 2.5, H);
    ctx.quadraticCurveTo(x + lean * 0.4, H - h * 0.6, x + lean, H - h);
    ctx.quadraticCurveTo(x + lean * 0.4 + 1, H - h * 0.6, x + 2.5, H);
    ctx.fill();
  }
  return toTexture(c);
}
