// Terrain, water, sky, vegetation, volcano, station, tunnel
import * as THREE from 'three';
import { makeNoise2D, fbm, rng, smoothstep, clamp, lerp } from './noise.js';
import * as TX from './textures.js';

export const HALF = 700;
const RES = 320;
const CELL = (HALF * 2) / RES;
export const VOLCANO = { x: 470, z: -330 };
const RIVER = [[760, 430], [520, 330], [330, 250], [230, 205], [165, 168], [128, 150], [92, 126], [62, 106]];
const LAKE = { x: 45, z: 92, r: 34 };
export const POOL = { x: 127, z: 152, r: 22 }; // deep river pool for the underwater section
export const LINEUP = { x: -60, z: 105 };

function distToPolyline(x, z, pts) {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
    const vx = bx - ax, vz = bz - az;
    const t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
    const d = Math.hypot(x - ax - vx * t, z - az - vz * t);
    if (d < best) best = d;
  }
  return best;
}

export class World {
  constructor(scene, track, q, onProgress) {
    this.scene = scene;
    this.track = track;
    this.q = q;
    this.n1 = makeNoise2D(11); this.n2 = makeNoise2D(23); this.n3 = makeNoise2D(37); this.n4 = makeNoise2D(59);
    track.buildHash(10);
    this.sunDir = new THREE.Vector3(0.55, 0.42, 0.72).normalize();
    this.time = 0;
    this.animated = [];
  }

  baseHeight(x, z) {
    const h0 = this.rawHeight(x, z);
    const dl = Math.hypot(x - LINEUP.x, z - LINEUP.z);
    if (dl < 45) {
      if (this.padH === undefined) this.padH = this.rawHeight(LINEUP.x, LINEUP.z);
      return lerp(this.padH, h0, smoothstep(24, 45, dl));
    }
    return h0;
  }

  rawHeight(x, z) {
    let h = 7.5 + 6 * fbm(this.n1, x * 0.005, z * 0.005, 5) + 3.5 * fbm(this.n2, x * 0.016, z * 0.016, 3);
    const r = Math.hypot(x, z);
    const m = smoothstep(330, 650, r);
    if (m > 0) {
      const rd = 1 - Math.abs(fbm(this.n3, x * 0.004, z * 0.004, 5));
      h += m * (35 + 150 * rd * rd);
    }
    const dv = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
    if (dv < 300) {
      const c = 1 - dv / 300;
      let vh = 6 + 215 * Math.pow(c, 1.7) + 6 * fbm(this.n4, x * 0.03, z * 0.03, 3) * c;
      if (dv < 34) vh -= 45 * Math.pow(1 - dv / 34, 1.3);
      h = Math.max(h, vh);
    }
    // river & lake
    const dr = distToPolyline(x, z, RIVER);
    if (dr < 40) h = lerp(-2.6, h, smoothstep(9, 30, dr));
    const dp = Math.hypot(x - POOL.x, z - POOL.z);
    if (dp < POOL.r + 30) h = Math.min(h, lerp(-10, h, smoothstep(POOL.r - 4, POOL.r + 26, dp + 4 * this.n1(x * 0.06, z * 0.06))));
    const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
    if (dl < 70) h = lerp(-4.5, h, smoothstep(LAKE.r - 4, LAKE.r + 26, dl + 6 * this.n2(x * 0.05, z * 0.05)));
    // station flat pad
    if (x > -95 && x < 0 && z > -22 && z < 22) {
      const w = smoothstep(0, 10, Math.min(x + 95, -x, z + 22, 22 - z));
      h = lerp(h, 4.2, w);
    }
    return h;
  }

  // pure height computation (no rendering) so it can also be exported for Unity
  computeGrid() {
    if (this.grid) return;
    const N = RES + 1;
    const grid = new Float32Array(N * N);
    this.carve = new Float32Array(N * N);
    const tr = this.track;
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const x = -HALF + ix * CELL, z = -HALF + iz * CELL;
        let h = this.baseHeight(x, z);
        const near = tr.nearestXZ(x, z, 22);
        if (near) {
          const ty = tr.P[near.i * 3 + 1];
          const target = ty - 1.9;
          if (target < h) {
            const w = 1 - smoothstep(4.5, 17, near.d);
            const nh = h + (target - h) * w;
            this.carve[iz * N + ix] = h - nh;
            h = nh;
          }
        }
        grid[iz * N + ix] = h;
      }
    }
    this.grid = grid;
    this.N = N;
  }

  buildTerrain() {
    this.computeGrid();
    const N = this.N, grid = this.grid;

    const geo = new THREE.PlaneGeometry(HALF * 2, HALF * 2, RES, RES);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const ix = Math.round((x + HALF) / CELL), iz = Math.round((z + HALF) / CELL);
      const h = grid[iz * N + ix];
      pos.setY(i, h);
    }
    geo.computeVertexNormals();
    const nor = geo.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = pos.getY(i);
      const ix = Math.round((x + HALF) / CELL), iz = Math.round((z + HALF) / CELL);
      const slope = 1 - nor.getY(i);
      const n = this.n4(x * 0.02, z * 0.02) * 0.5 + 0.5;
      const n2 = this.n1(x * 0.11, z * 0.11) * 0.5 + 0.5;
      // grass
      let r = lerp(0.24, 0.38, n), g = lerp(0.34, 0.42, n), b = lerp(0.12, 0.16, n);
      // dry patches
      const dry = smoothstep(0.55, 0.8, this.n2(x * 0.008 + 3, z * 0.008));
      r = lerp(r, 0.46, dry * 0.6); g = lerp(g, 0.42, dry * 0.6); b = lerp(b, 0.22, dry * 0.6);
      // dirt where carved / trampled
      const cv = smoothstep(0.4, 3, this.carve[iz * N + ix]);
      r = lerp(r, 0.4, cv); g = lerp(g, 0.31, cv); b = lerp(b, 0.2, cv);
      // rock on slopes/high
      const rock = clamp(smoothstep(0.22, 0.42, slope + n2 * 0.08) + smoothstep(60, 110, h) * 0.8, 0, 1);
      r = lerp(r, 0.44 + n2 * 0.08, rock); g = lerp(g, 0.41 + n2 * 0.08, rock); b = lerp(b, 0.37 + n2 * 0.06, rock);
      // volcanic
      const dv = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
      const volc = (1 - smoothstep(120, 260, dv)) * smoothstep(20, 60, h);
      r = lerp(r, 0.17, volc); g = lerp(g, 0.15, volc); b = lerp(b, 0.14, volc);
      // banks / underwater
      const dust = 1 - smoothstep(14, 30, Math.hypot(x - LINEUP.x, z - LINEUP.z) + n2 * 6);
      r = lerp(r, 0.47, dust); g = lerp(g, 0.40, dust); b = lerp(b, 0.31, dust);
      const sand = 1 - smoothstep(0.6, 2.2, h);
      r = lerp(r, 0.42, sand); g = lerp(g, 0.37, sand); b = lerp(b, 0.26, sand);
      if (h < -0.3) { const u = smoothstep(-0.3, -3, h); r = lerp(r, 0.18, u); g = lerp(g, 0.17, u); b = lerp(b, 0.12, u); }
      c.setRGB(r, g, b, THREE.SRGBColorSpace);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const gt = TX.makeGroundTextures();
    const rep = (HALF * 2) / 7;
    gt.map.repeat.set(rep, rep); gt.normal.repeat.set(rep, rep);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: gt.map, normalMap: gt.normal, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.95, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.terrain = mesh;
  }

  heightAt(x, z) {
    const fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
    const ix = clamp(Math.floor(fx), 0, this.N - 2), iz = clamp(Math.floor(fz), 0, this.N - 2);
    const tx = clamp(fx - ix, 0, 1), tz = clamp(fz - iz, 0, 1);
    const g = this.grid, N = this.N;
    const a = g[iz * N + ix], b = g[iz * N + ix + 1], c = g[(iz + 1) * N + ix], d = g[(iz + 1) * N + ix + 1];
    // match triangle split of PlaneGeometry (a-c-b, c-d-b)
    if (tx + tz <= 1) return a + (b - a) * tx + (c - a) * tz;
    return d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  }

  groundOrWater(x, z) { return Math.max(this.heightAt(x, z), 0); }

  // ------- Sky -------
  buildSky(renderer) {
    const uniforms = {
      sunDir: { value: this.sunDir.clone() },
      time: { value: 0 },
    };
    const vs = `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`;
    const fs = `
      uniform vec3 sunDir; uniform float time; varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
      float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 zenith = vec3(0.14, 0.24, 0.42);
        vec3 horizon = vec3(0.62, 0.60, 0.54);
        vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.45));
        if (h < 0.0) col = mix(horizon, horizon * 0.75, clamp(-h * 5.0, 0.0, 1.0));
        float sd = max(dot(d, sunDir), 0.0);
        col += vec3(1.0, 0.70, 0.40) * pow(sd, 6.0) * 0.35;
        col += vec3(1.0, 0.85, 0.65) * pow(sd, 90.0) * 1.2;
        col += vec3(1.0, 0.95, 0.85) * smoothstep(0.99990, 0.99996, sd) * 40.0;
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.12) * 1.3 + vec2(time * 0.004, time * 0.0015);
          float c = fbm(uv);
          float cov = smoothstep(0.48, 0.78, c) * smoothstep(0.0, 0.18, h);
          float shade = fbm(uv * 1.7 + 3.0);
          vec3 cc = mix(vec3(0.62, 0.64, 0.68), vec3(1.05, 1.0, 0.95), shade);
          cc += vec3(1.0, 0.7, 0.4) * pow(sd, 5.0) * 0.6;
          col = mix(col, cc, cov * 0.9);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`;
    const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: vs, fragmentShader: fs, side: THREE.BackSide, depthWrite: false, fog: false });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), mat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.sky = sky;
    this.skyUniforms = uniforms;
    this.scene.add(sky);

    // environment map from the sky (no tonemapping inside env)
    const envScene = new THREE.Scene();
    const envMat = mat.clone();
    envMat.uniforms = { sunDir: uniforms.sunDir, time: { value: 0 } };
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), envMat);
    envScene.add(envSky);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.16, 0.18, 0.08) }));
    ground.position.y = -5;
    envScene.add(ground);
    const pm = new THREE.PMREMGenerator(renderer);
    const tm = renderer.toneMapping;
    renderer.toneMapping = THREE.NoToneMapping;
    this.scene.environment = pm.fromScene(envScene, 0.02).texture;
    renderer.toneMapping = tm;
    pm.dispose();

    const horizon = new THREE.Color(0.62, 0.60, 0.54);
    this.scene.fog = new THREE.FogExp2(horizon, 0.0026);
    this.scene.background = horizon;

    // lights
    const hemi = new THREE.HemisphereLight(new THREE.Color(0.55, 0.68, 0.9), new THREE.Color(0.28, 0.25, 0.16), 0.55);
    this.scene.add(hemi);
    this.hemi = hemi;
    this.hemiFactor = 1;
    const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.88, 0.72), 3.2);
    sun.castShadow = true;
    const ss = this.q.high ? 2048 : 1024;
    sun.shadow.mapSize.set(ss, ss);
    const sc = sun.shadow.camera;
    sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 10; sc.far = 500;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.05;
    this.scene.add(sun, sun.target);
    this.sun = sun;
  }

  followSun(p) {
    // snap to texel grid to avoid shimmering
    const step = 110 / this.sun.shadow.mapSize.x;
    const x = Math.round(p.x / step) * step, y = Math.round(p.y / step) * step, z = Math.round(p.z / step) * step;
    this.sun.target.position.set(x, y, z);
    this.sun.position.set(x + this.sunDir.x * 250, y + this.sunDir.y * 250, z + this.sunDir.z * 250);
    this.sky.position.copy(p);
  }

  // ------- Water -------
  buildWater() {
    const nrm = TX.makeWaterNormal();
    nrm.repeat.set(140, 140);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setRGB(0.10, 0.20, 0.17, THREE.SRGBColorSpace),
      roughness: 0.06, metalness: 0.15, normalMap: nrm, normalScale: new THREE.Vector2(0.35, 0.35),
      transparent: true, opacity: 0.86, envMapIntensity: 1.3, side: THREE.DoubleSide,
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2).rotateX(-Math.PI / 2), mat);
    water.position.y = 0;
    water.receiveShadow = true;
    this.scene.add(water);
    this.water = water;
    this.waterNormal = nrm;
  }

  // ------- Vegetation -------
  buildVegetation() {
    const q = this.q;
    const r = rng(77);
    const tr = this.track;
    this.vegMeshes = [];
    const scale = q.high ? 1 : 0.42;

    const mergeColored = (parts) => {
      // parts: [geometry, colorHex]
      const gs = parts.map(([g, col]) => {
        const ng = g.index ? g.toNonIndexed() : g;
        ng.deleteAttribute('uv');
        const cc = new THREE.Color(col);
        const arr = new Float32Array(ng.attributes.position.count * 3);
        for (let i = 0; i < arr.length; i += 3) {
          const v = 0.85 + Math.random() * 0.3;
          arr[i] = cc.r * v; arr[i + 1] = cc.g * v; arr[i + 2] = cc.b * v;
        }
        ng.setAttribute('color', new THREE.BufferAttribute(arr, 3));
        return ng;
      });
      return mergeGeos(gs);
    };
    const jitter = (g, amt, seed) => {
      const rr = rng(seed);
      const p = g.attributes.position;
      const memo = new Map();
      for (let i = 0; i < p.count; i++) {
        const key = p.getX(i).toFixed(3) + ',' + p.getY(i).toFixed(3) + ',' + p.getZ(i).toFixed(3);
        let o = memo.get(key);
        if (!o) { o = [(rr() - 0.5) * amt, (rr() - 0.5) * amt, (rr() - 0.5) * amt]; memo.set(key, o); }
        p.setXYZ(i, p.getX(i) + o[0], p.getY(i) + o[1], p.getZ(i) + o[2]);
      }
      g.computeVertexNormals();
      return g;
    };

    const blob = (r, seed) => {
      const g = new THREE.SphereGeometry(r, q.high ? 10 : 7, q.high ? 7 : 5);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const n = 1 + 0.22 * this.n3(x * 1.3 + seed, z * 1.3 + y) + 0.1 * this.n2(x * 3 + seed, y * 3 - z);
        p.setXYZ(i, x * n, Math.max(y * n * 0.8, -r * 0.3), z * n);
      }
      g.computeVertexNormals();
      return g;
    };
    // conifer (stacked cones)
    const conParts = [[new THREE.CylinderGeometry(0.22, 0.5, 9, 6).translate(0, 4.5, 0), 0x4a3524]];
    const layers = q.high ? 5 : 4;
    for (let k = 0; k < layers; k++) {
      const y = 5 + k * (13 / layers), rad = 4.2 - k * (3.4 / layers);
      conParts.push([blob(1, k).scale(rad, 2.4, rad).translate(0, y + 1.6, 0), k % 2 ? 0x1f3a1a : 0x27431d]);
      conParts.push([new THREE.ConeGeometry(rad * 0.75, 3.2, 10, 1).translate(0, y + 3.2, 0), 0x223f1b]);
    }
    const conifer = mergeColored(conParts);

    // araucaria (tall trunk, umbrella crown)
    const arParts = [[new THREE.CylinderGeometry(0.3, 0.6, 18, 6).translate(0, 9, 0), 0x5a4330]];
    const crowns = q.high ? 7 : 5;
    for (let k = 0; k < crowns; k++) {
      const a = k / crowns * Math.PI * 2;
      arParts.push([blob(2.4, k + 10).scale(1.3, 0.5, 1.3).translate(Math.cos(a) * 3, 17 + (k % 2), Math.sin(a) * 3), 0x2c4a1f]);
    }
    arParts.push([blob(2.8, 99).scale(1.2, 0.55, 1.2).translate(0, 19, 0), 0x325424]);
    const araucaria = mergeColored(arParts);

    // broadleaf bush
    const bushParts = [];
    for (let k = 0; k < 4; k++) {
      bushParts.push([blob(1.3 + k * 0.2, k * 7).translate((k - 1.5) * 0.9, 1.0 + (k % 2) * 0.5, (k % 2 - 0.5) * 1.1), [0x2e4d1e, 0x3a5a22, 0x284419, 0x40602a][k]]);
    }
    const bush = mergeColored(bushParts);

    // rock
    const rock = mergeColored([[jitter(new THREE.IcosahedronGeometry(1.2, 1).scale(1.4, 0.8, 1.1), 0.5, 5), 0x6e6a62]]);

    // palm/cycad trunk + frond cards
    const palmTrunk = mergeColored([[new THREE.CylinderGeometry(0.25, 0.42, 7, 7, 4).translate(0, 3.5, 0), 0x5b4a35]]);
    const frondGeo = (count, len, droop, y0) => {
      const gs = [];
      for (let k = 0; k < count; k++) {
        const g = new THREE.PlaneGeometry(1.1, len, 1, 5);
        // bend: plane along +y, curve it into an arc
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const yy = p.getY(i) + len / 2; // 0..len
          const t = yy / len;
          const phi = 0.9 - droop * t * 0.5;
          p.setXYZ(i, p.getX(i), Math.sin(phi) * yy, -Math.cos(phi) * yy);
        }
        g.computeVertexNormals();
        g.rotateY(k / count * Math.PI * 2 + (k % 2) * 0.2);
        g.translate(0, y0, 0);
        gs.push(g);
      }
      return mergeGeos(gs, true);
    };
    const palmFronds = frondGeo(10, 4.6, 1.4, 7);
    const fernGeo = frondGeo(7, 1.6, 1.1, 0.05);

    const frondTex = TX.makeFrondTexture(4, [0.27, 0.42, 0.14]);
    const fernTex = TX.makeFrondTexture(8, [0.24, 0.40, 0.13]);
    const vegMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: false });
    const frondMat = new THREE.MeshStandardMaterial({ map: frondTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85 });
    const fernMat = new THREE.MeshStandardMaterial({ map: fernTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85 });

    // placement
    const types = {
      conifer: { list: [], n: 1100 * scale, clear: 9, forest: true },
      araucaria: { list: [], n: 380 * scale, clear: 9, forest: true },
      bush: { list: [], n: 1500 * scale, clear: 5, forest: false },
      rock: { list: [], n: 380 * scale, clear: 5, forest: false },
      palm: { list: [], n: 700 * scale, clear: 6, forest: false },
      fern: { list: [], n: 0, clear: 3.2 },
    };
    const okSpot = (x, z, clear) => {
      const h = this.heightAt(x, z);
      if (h < 1.0 || h > 120) return null;
      if (x > -100 && x < 5 && z > -25 && z < 25) return null; // station
      const near = tr.nearestXZ(x, z, clear + 1);
      if (near && near.d < clear) return null;
      // slope check
      const hx = this.heightAt(x + 2, z) - h, hz = this.heightAt(x, z + 2) - h;
      if (Math.hypot(hx, hz) / 2 > 0.7) return null;
      return h;
    };
    for (const [name, t] of Object.entries(types)) {
      let tries = 0;
      while (t.list.length < t.n && tries < t.n * 30) {
        tries++;
        // bias placement toward the track region so it looks lush where we ride
        let x, z;
        if (r() < 0.65) {
          const i = Math.floor(r() * tr.n);
          const ang = r() * Math.PI * 2, d = t.clear + r() * 90;
          x = tr.P[i * 3] + Math.cos(ang) * d; z = tr.P[i * 3 + 2] + Math.sin(ang) * d;
        } else { x = (r() - 0.5) * 1250; z = (r() - 0.5) * 1250; }
        if (Math.abs(x) > HALF - 10 || Math.abs(z) > HALF - 10) continue;
        if (t.forest) {
          const f = fbm(this.n4, x * 0.006, z * 0.006, 3);
          if (r() > smoothstep(-0.25, 0.35, f)) continue;
        }
        const h = okSpot(x, z, t.clear);
        if (h === null) continue;
        t.list.push([x, h, z, r() * Math.PI * 2, 0.7 + r() * 0.6]);
      }
    }
    // ferns hug the track
    const fernN = q.high ? 2600 : 1100;
    for (let k = 0; k < fernN * 4 && types.fern.list.length < fernN; k++) {
      const i = Math.floor(r() * tr.n);
      const side = r() < 0.5 ? -1 : 1;
      const d = 3.2 + r() * 22;
      const x = tr.P[i * 3] + tr.R[i * 3] * side * d, z = tr.P[i * 3 + 2] + tr.R[i * 3 + 2] * side * d;
      const h = okSpot(x, z, 3.2);
      if (h === null) continue;
      types.fern.list.push([x, h, z, r() * Math.PI * 2, 0.8 + r() * 1.2]);
    }

    // grass tufts near the track (alpha cards)
    const grassN = q.high ? 5000 : 1800;
    const grassList = [];
    for (let k = 0; k < grassN * 4 && grassList.length < grassN; k++) {
      const i = Math.floor(r() * tr.n);
      const side = r() < 0.5 ? -1 : 1;
      const d = 2.2 + r() * 26;
      const x = tr.P[i * 3] + tr.R[i * 3] * side * d + (r() - 0.5) * 3, z = tr.P[i * 3 + 2] + tr.R[i * 3 + 2] * side * d + (r() - 0.5) * 3;
      const h = okSpot(x, z, 2.2);
      if (h === null) continue;
      grassList.push([x, h + 0.15, z, r() * Math.PI, 0.7 + r() * 0.8]);
    }
    const gq = [];
    for (let k = 0; k < 3; k++) gq.push(new THREE.PlaneGeometry(1.4, 0.8).translate(0, 0.4, 0).rotateY(k * Math.PI / 3));
    const grassGeo = mergeGeos(gq, true);
    const grassMat = new THREE.MeshStandardMaterial({ map: TX.makeGrassTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
    types.grass = { list: grassList };

    const tiles = 4;
    const add = (geo, mat, list, shadow) => {
      const buckets = Array.from({ length: tiles * tiles }, () => []);
      for (const it of list) {
        const tx = clamp(Math.floor((it[0] + HALF) / (HALF * 2) * tiles), 0, tiles - 1);
        const tz = clamp(Math.floor((it[2] + HALF) / (HALF * 2) * tiles), 0, tiles - 1);
        buckets[tz * tiles + tx].push(it);
      }
      const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), ax = new THREE.Vector3(0, 1, 0);
      for (const b of buckets) {
        if (!b.length) continue;
        const im = new THREE.InstancedMesh(geo, mat, b.length);
        b.forEach((it, i) => {
          qq.setFromAxisAngle(ax, it[3]);
          sc.setScalar(it[4]);
          ps.set(it[0], it[1] - 0.2, it[2]);
          m4.compose(ps, qq, sc);
          im.setMatrixAt(i, m4);
        });
        im.computeBoundingSphere();
        this.vegMeshes.push({ im, list: b });
        im.castShadow = shadow;
        im.receiveShadow = true;
        this.scene.add(im);
      }
    };
    add(conifer, vegMat, types.conifer.list, q.high);
    add(araucaria, vegMat, types.araucaria.list, q.high);
    add(bush, vegMat, types.bush.list, false);
    add(rock, vegMat, types.rock.list, false);
    add(palmTrunk, vegMat, types.palm.list, false);
    add(palmFronds, frondMat, types.palm.list, false);
    add(fernGeo, fernMat, types.fern.list, false);
    add(grassGeo, grassMat, types.grass.list, false);
    this.treeSpots = types.conifer.list.concat(types.araucaria.list);
  }

  // remove vegetation instances around a point (keeps dinosaurs visible)
  clearAround(x, z, rad) {
    const m4 = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const { im, list } of this.vegMeshes) {
      let changed = false;
      list.forEach((it, i) => {
        if ((it[0] - x) ** 2 + (it[2] - z) ** 2 < rad * rad) { im.setMatrixAt(i, m4); changed = true; }
      });
      if (changed) im.instanceMatrix.needsUpdate = true;
    }
  }

  // ------- Volcano smoke + lava -------
  buildVolcano() {
    const top = this.heightAt(VOLCANO.x, VOLCANO.z);
    const lava = new THREE.Mesh(new THREE.CircleGeometry(20, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 0.9, 0.2), fog: false }));
    lava.position.set(VOLCANO.x, top + 2, VOLCANO.z);
    this.scene.add(lava);
    const smokeTex = TX.makeSmokeTexture();
    const puffs = [];
    const r = rng(8);
    for (let i = 0; i < 26; i++) {
      const m = new THREE.SpriteMaterial({ map: smokeTex, color: 0x6c6560, transparent: true, opacity: 0.0, depthWrite: false, fog: true });
      const s = new THREE.Sprite(m);
      s.userData.t = r();
      s.userData.ox = (r() - 0.5) * 20; s.userData.oz = (r() - 0.5) * 20;
      this.scene.add(s);
      puffs.push(s);
    }
    this.smoke = { puffs, top };
  }

  updateVolcano(dt) {
    const { puffs, top } = this.smoke;
    for (const s of puffs) {
      s.userData.t += dt * 0.025;
      if (s.userData.t > 1) s.userData.t -= 1;
      const t = s.userData.t;
      s.position.set(VOLCANO.x + s.userData.ox + t * 160, top + 10 + t * 240, VOLCANO.z + s.userData.oz + t * 60);
      const sz = 40 + t * 180;
      s.scale.set(sz, sz, 1);
      s.material.opacity = Math.sin(t * Math.PI) * 0.75;
      s.material.color.setScalar(0.45 - t * 0.15);
    }
  }

  // ------- Station building -------
  buildStation() {
    const tr = this.track;
    const s0 = tr.sOf('station0') + 4, s1 = tr.sOf('liftStart') - 4;
    const smp = { p: new THREE.Vector3(), t: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3() };
    tr.sample((s0 + s1) / 2, smp);
    const len = s1 - s0;
    const g = new THREE.Group();
    const wood = TX.makeWoodTexture();
    wood.repeat.set(len / 4, 2);
    const woodMat = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.85 });
    const stoneTex = TX.makeRockTextures(44, [0.5, 0.47, 0.42]);
    stoneTex.map.repeat.set(len / 5, 1); stoneTex.normal.repeat.set(len / 5, 1);
    const stoneMat = new THREE.MeshStandardMaterial({ map: stoneTex.map, normalMap: stoneTex.normal, roughness: 0.9 });
    const y0 = smp.p.y;
    // platforms both sides
    for (const sd of [-1, 1]) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(len, 2.8, 4.2), stoneMat);
      base.position.set(0, y0 - 0.95, sd * 3.2);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(len, 0.15, 4.2), woodMat);
      deck.position.set(0, y0 + 0.5, sd * 3.2);
      g.add(base, deck);
      // posts + railing
      for (let x = -len / 2; x <= len / 2 + 0.01; x += len / 6) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 6.5, 8), woodMat);
        post.position.set(x, y0 + 3.6, sd * 4.9);
        g.add(post);
      }
      // torches
      for (let x = -len / 2 + 2; x < len / 2; x += len / 3) {
        const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.4, 6), woodMat);
        torch.position.set(x, y0 + 1.3, sd * 1.6);
        g.add(torch);
        const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flameTex || (this.flameTex = TX.makeFlameTexture()), color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        fl.scale.set(0.45, 0.8, 1);
        fl.position.set(x, y0 + 2.25, sd * 1.6);
        g.add(fl);
        this.animated.push(t => { fl.scale.y = 0.75 + Math.sin(t * 17 + x) * 0.08 + Math.sin(t * 29 + x) * 0.05; });
      }
    }
    // thatched roof
    const thatch = TX.makeThatchTexture();
    thatch.repeat.set(6, 3);
    const roofMat = new THREE.MeshStandardMaterial({ map: thatch, roughness: 1, side: THREE.DoubleSide });
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 7.5, 3.6, 4, 1, true), roofMat);
    roof.rotation.y = Math.PI / 4;
    roof.scale.set((len / 2 + 1.5) / 5.3, 1, 1.08);
    roof.position.set(0, y0 + 8.5, 0);
    g.add(roof);
    // sign
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.25), new THREE.MeshStandardMaterial({ map: TX.makeSignTexture('DINO RUSH', '공룡 협곡 익스프레스'), roughness: 0.8 }));
    sign.position.set(len / 2 + 0.3, y0 + 6.2, 0);
    sign.rotation.y = Math.PI / 2;
    g.add(sign);
    const sign2 = sign.clone(); sign2.position.x = -len / 2 - 0.3; sign2.rotation.y = -Math.PI / 2; g.add(sign2);
    // orient group along track
    const ang = Math.atan2(-smp.t.z, smp.t.x);
    g.rotation.y = ang;
    g.position.set(smp.p.x, 0, smp.p.z);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.scene.add(g);
  }

  // ------- Rock tunnel -------
  buildTunnel() {
    const tr = this.track, hi = this.q.high;
    const [s0, s1] = [tr.sOf('tunnelIn') - 4, tr.sOf('tunnelOut') + 2];
    const len = s1 - s0, sMid = (s0 + s1) / 2;
    const tex = TX.makeRockTextures(61, [0.42, 0.38, 0.33]);
    tex.map.repeat.set(10, 2); tex.normal.repeat.set(10, 2);
    const smp = { p: new THREE.Vector3(), t: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3() };
    const n = this.n2, n3 = this.n3;
    // the passage swells into a tall cavern in the middle
    const cavern = s => Math.exp(-(((s - sMid) / (len * 0.18)) ** 2));
    const ringN = hi ? 44 : 28, step = hi ? 0.5 : 0.8;
    const rings = Math.floor(len / step) + 1;
    const frame = (s) => { tr.sample(s, smp); return smp; };
    // craggy wall radius: big lumps + ledges + small crumbs, flatter floor
    const wallR = (a, s) => {
      const c = cavern(s);
      let r = 3.1 + c * 3.2 + 0.55 * n(a * 2.2, s * 0.25) + 0.25 * n3(a * 6 + 3, s * 0.9) + 0.08 * n(a * 17, s * 3);
      const up = Math.sin(a);
      if (up > 0.2) r += c * 2.2 * up;           // vaulted cavern ceiling
      if (up < -0.35) r = Math.min(r, 2.0 / Math.max(0.35, -up)); // keep a flat-ish floor
      return r;
    };
    // ---- inner rock shell with vertex colours (moss at the mouths, wet streaks, dark cracks) ----
    {
      const pos = [], uv = [], col = [], idx = [];
      const a0 = -0.28 * Math.PI, a1 = 1.28 * Math.PI;
      for (let k = 0; k < rings; k++) {
        const s = s0 + k * step;
        frame(s);
        const cx = smp.p.x + smp.u.x * 1.4, cy = smp.p.y + smp.u.y * 1.4, cz = smp.p.z + smp.u.z * 1.4;
        const mouth = 1 - smoothstep(4, 14, Math.min(s - s0, s1 - s));
        for (let j = 0; j <= ringN; j++) {
          const a = a0 + (a1 - a0) * j / ringN;
          const rad = wallR(a, s);
          const ca = Math.cos(a), sa = Math.sin(a);
          pos.push(cx + (smp.r.x * ca + smp.u.x * sa) * rad, cy + (smp.r.y * ca + smp.u.y * sa) * rad, cz + (smp.r.z * ca + smp.u.z * sa) * rad);
          uv.push(s / 5, (a - a0) * rad / 25); // world-scale UVs so the rock doesn't stretch in the cavern
          const crack = smoothstep(0.1, 0.6, n3(a * 6 + 3, s * 0.9)); // recesses are darker
          const wet = smoothstep(0.55, 0.85, n(a * 0.6 + 40, s * 0.08) * 0.5 + 0.5) * smoothstep(-0.2, 0.6, sa);
          let r = 0.62 - crack * 0.28, g = 0.58 - crack * 0.27, b = 0.53 - crack * 0.24;
          r *= 1 - wet * 0.35; g *= 1 - wet * 0.3; b *= 1 - wet * 0.2;           // dark wet streaks
          r = lerp(r, 0.3, mouth * 0.7); g = lerp(g, 0.42, mouth * 0.7); b = lerp(b, 0.2, mouth * 0.7); // moss
          col.push(r, g, b);
        }
      }
      for (let k = 0; k < rings - 1; k++)
        for (let j = 0; j < ringN; j++) {
          const q = k * (ringN + 1) + j, w = q + ringN + 1;
          idx.push(q, w, q + 1, q + 1, w, w + 1);
        }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const cmap = tex.map.clone(), cnrm = tex.normal.clone();
      cmap.repeat.set(2, 10); cnrm.repeat.set(2, 10); cmap.needsUpdate = cnrm.needsUpdate = true;
      const mat = new THREE.MeshStandardMaterial({ map: cmap, normalMap: cnrm, normalScale: new THREE.Vector2(1.4, 1.4), vertexColors: true, roughness: 0.62, side: THREE.BackSide, envMapIntensity: 0.05 });
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      this.scene.add(m);
    }
    // ---- outer hillside shell ----
    {
      const pos = [], uv = [], idx = [], N = 18, st = 1.0, R = Math.floor(len / st) + 1;
      for (let k = 0; k < R; k++) {
        const s = s0 + k * st; frame(s);
        const cx = smp.p.x + smp.u.x * 1.4, cy = smp.p.y + smp.u.y * 1.4, cz = smp.p.z + smp.u.z * 1.4;
        const end = Math.min(k, R - 1 - k);
        for (let j = 0; j <= N; j++) {
          const a = -0.3 * Math.PI + 1.6 * Math.PI * j / N;
          const rad = wallR(a, s) + 0.4 + Math.min(end * 0.6, 1) * (4 + 3 * (n(a * 1.3 + 9, s * 0.05) * 0.5 + 0.5));
          const ca = Math.cos(a), sa = Math.sin(a);
          pos.push(cx + (smp.r.x * ca + smp.u.x * sa) * rad, cy + (smp.r.y * ca + smp.u.y * sa) * rad, cz + (smp.r.z * ca + smp.u.z * sa) * rad);
          uv.push(s / 6, j / N);
        }
      }
      for (let k = 0; k < R - 1; k++) for (let j = 0; j < N; j++) { const q = k * (N + 1) + j, w = q + N + 1; idx.push(q, w, q + 1, q + 1, w, w + 1); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normal, roughness: 0.95 }));
      m.castShadow = true; m.receiveShadow = true;
      this.scene.add(m);
    }
    const rnd = rng(404);
    const wallPoint = (s, a, inset = 0) => {
      frame(s);
      const rad = wallR(a, s) - inset;
      const ca = Math.cos(a), sa = Math.sin(a);
      return new THREE.Vector3(
        smp.p.x + smp.u.x * 1.4 + (smp.r.x * ca + smp.u.x * sa) * rad,
        smp.p.y + smp.u.y * 1.4 + (smp.r.y * ca + smp.u.y * sa) * rad,
        smp.p.z + smp.u.z * 1.4 + (smp.r.z * ca + smp.u.z * sa) * rad);
    };
    // ---- stalactites and stalagmites ----
    {
      const parts = [];
      const cone = (r, h) => { const g = new THREE.ConeGeometry(r, h, 7, 3); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); const w = 1 + 0.25 * Math.sin(y * 9 + i); p.setX(i, p.getX(i) * w); p.setZ(i, p.getZ(i) * w); } return g; };
      const nT = hi ? 170 : 90;
      for (let i = 0; i < nT; i++) {
        const s = s0 + 3 + rnd() * (len - 6);
        const a = Math.PI * (0.18 + rnd() * 0.64);         // ceiling
        const c = cavern(s);
        const h = (0.35 + rnd() * 0.9) * (1 + c * 2.2);
        const base = wallPoint(s, a, 0.15);
        // keep the dynamic envelope clear: tip must stay > 1.7 m from the passage centre
        frame(s);
        const centre = smp.p.clone().addScaledVector(smp.u, 1.4);
        const maxH = Math.max(0, base.distanceTo(centre) - 1.9);
        const hh = Math.min(h, maxH);
        if (hh < 0.2) continue;
        const g = cone(0.06 + hh * 0.09, hh);
        g.rotateX(Math.PI); g.translate(0, -hh / 2, 0); // hang down
        const dir = centre.clone().sub(base).normalize();
        g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(dir.x * 0.25, -1, dir.z * 0.25).normalize()));
        g.translate(base.x, base.y, base.z);
        parts.push(g);
      }
      const nM = hi ? 90 : 45;
      for (let i = 0; i < nM; i++) {
        const s = s0 + 3 + rnd() * (len - 6);
        const side = rnd() < 0.5 ? -1 : 1;
        const a = side > 0 ? -0.12 * Math.PI - rnd() * 0.1 : Math.PI * 1.12 + rnd() * 0.1; // lower side walls
        const base = wallPoint(s, a, 0.1);
        const h = (0.3 + rnd() * 0.8) * (1 + cavern(s) * 1.5);
        const g = cone(0.1 + h * 0.13, h);
        g.translate(base.x, base.y + h / 2 - 0.1, base.z);
        parts.push(g);
      }
      const geo = mergeGeos(parts);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xb8ab94, roughness: 0.35, map: tex.map, envMapIntensity: 0.1 }));
      m.castShadow = false; m.receiveShadow = true;
      this.scene.add(m);
    }
    // ---- glowing crystals and mushrooms in the cavern ----
    this.caveGlow = [];
    {
      const cryMat = new THREE.MeshStandardMaterial({ color: 0x7fd8ff, emissive: 0x2a9cff, emissiveIntensity: 2.2, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.9 });
      const cryMat2 = new THREE.MeshStandardMaterial({ color: 0xd9a0ff, emissive: 0x9a3cff, emissiveIntensity: 2.0, roughness: 0.15, transparent: true, opacity: 0.9 });
      const mushMat = new THREE.MeshStandardMaterial({ color: 0x9cffb0, emissive: 0x24d860, emissiveIntensity: 1.6, roughness: 0.5 });
      const partsA = [], partsB = [], partsM = [];
      const nC = hi ? 26 : 14;
      for (let i = 0; i < nC; i++) {
        const s = sMid + (rnd() - 0.5) * len * 0.42;
        const a = rnd() < 0.5 ? -0.1 * Math.PI - rnd() * 0.12 : 1.1 * Math.PI + rnd() * 0.12;
        const base = wallPoint(s, a, 0.05);
        const cluster = 3 + Math.floor(rnd() * 4);
        for (let c = 0; c < cluster; c++) {
          const h = 0.25 + rnd() * 0.6;
          const g = new THREE.OctahedronGeometry(1, 0); g.scale(0.07 + h * 0.08, h, 0.07 + h * 0.08);
          g.rotateZ((rnd() - 0.5) * 1.1); g.rotateX((rnd() - 0.5) * 1.1);
          g.translate(base.x + (rnd() - 0.5) * 0.5, base.y + h * 0.6, base.z + (rnd() - 0.5) * 0.5);
          (i % 3 ? partsA : partsB).push(g);
        }
        this.caveGlow.push({ p: base.clone().add(new THREE.Vector3(0, 0.5, 0)), c: i % 3 ? 0x3aa8ff : 0xa040ff });
      }
      for (let i = 0; i < (hi ? 40 : 20); i++) {
        const s = s0 + 6 + rnd() * (len - 12);
        const a = rnd() < 0.5 ? -0.16 * Math.PI : 1.16 * Math.PI;
        const base = wallPoint(s, a, 0.05);
        const stem = new THREE.CylinderGeometry(0.015, 0.02, 0.12, 5).translate(base.x, base.y + 0.06, base.z);
        const cap = new THREE.SphereGeometry(0.06, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1).translate(base.x, base.y + 0.12, base.z);
        partsM.push(stem, cap);
      }
      if (partsA.length) this.scene.add(new THREE.Mesh(mergeGeos(partsA), cryMat));
      if (partsB.length) this.scene.add(new THREE.Mesh(mergeGeos(partsB), cryMat2));
      if (partsM.length) this.scene.add(new THREE.Mesh(mergeGeos(partsM), mushMat));
      this.animated.push(t => { cryMat.emissiveIntensity = 2.0 + Math.sin(t * 1.3) * 0.5; cryMat2.emissiveIntensity = 1.8 + Math.sin(t * 1.7 + 1) * 0.5; mushMat.emissiveIntensity = 1.4 + Math.sin(t * 2.3) * 0.3; });
    }
    // ---- fossil ribcage embedded in the cavern wall ----
    {
      const boneMat = new THREE.MeshStandardMaterial({ color: 0xd9ccb0, roughness: 0.6 });
      const parts = [];
      const sF = sMid + len * 0.08, aF = 0.95 * Math.PI;
      for (let i = 0; i < 9; i++) {
        const p = wallPoint(sF + i * 0.55, aF, 0.05);
        frame(sF + i * 0.55);
        const rib = new THREE.TorusGeometry(0.9 - Math.abs(i - 4) * 0.08, 0.06, 6, 14, Math.PI * 0.9);
        rib.rotateY(Math.atan2(smp.t.x, smp.t.z));
        rib.translate(p.x, p.y - 0.9, p.z);
        parts.push(rib);
        const vert = new THREE.SphereGeometry(0.13, 8, 6).scale(1, 0.8, 1.2).translate(p.x, p.y, p.z);
        parts.push(vert);
      }
      // skull at the front of the spine
      const sp = wallPoint(sF + 5.6, aF, 0.1);
      parts.push(new THREE.SphereGeometry(0.45, 12, 8).scale(1.6, 0.7, 0.8).translate(sp.x, sp.y - 0.2, sp.z));
      for (let k = 0; k < 7; k++) parts.push(new THREE.ConeGeometry(0.04, 0.18, 5).rotateX(Math.PI).translate(sp.x + (k - 3) * 0.12, sp.y - 0.55, sp.z));
      this.scene.add(new THREE.Mesh(mergeGeos(parts), boneMat));
    }
    // ---- puddles on the floor ----
    {
      const pm = new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.04, metalness: 0.4, envMapIntensity: 0.6 });
      for (let i = 0; i < (hi ? 14 : 7); i++) {
        const s = s0 + 5 + rnd() * (len - 10);
        const side = rnd() < 0.5 ? -1 : 1;
        frame(s);
        const p = smp.p.clone().addScaledVector(smp.r, side * (1.2 + rnd() * 0.6)).addScaledVector(smp.u, -0.45);
        const m = new THREE.Mesh(new THREE.CircleGeometry(0.4 + rnd() * 0.5, 16).rotateX(-Math.PI / 2), pm);
        m.scale.set(1.4, 1, 0.8); m.position.copy(p); m.rotation.y = rnd() * 3;
        this.scene.add(m);
      }
    }
    // ---- portals: boulder arch and hanging vines ----
    {
      const rockMat = new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normal, roughness: 0.9, color: 0x9a948a });
      const vineTex = TX.makeFrondTexture(17, [0.2, 0.36, 0.1]);
      const vineMat = new THREE.MeshStandardMaterial({ map: vineTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9 });
      for (const [sp, dirSign] of [[s0 + 1, 1], [s1 - 1, -1]]) {
        for (let k = 0; k < 9; k++) {
          const a = -0.15 * Math.PI + (1.3 * Math.PI) * k / 8;
          const p = wallPoint(sp, a, -0.6);
          const g = new THREE.IcosahedronGeometry(0.8 + rnd() * 0.9, 1);
          const pp = g.attributes.position;
          for (let i = 0; i < pp.count; i++) { const f = 1 + 0.25 * n(pp.getX(i) * 2 + k, pp.getY(i) * 2 + pp.getZ(i)); pp.setXYZ(i, pp.getX(i) * f, pp.getY(i) * f * 0.8, pp.getZ(i) * f); }
          g.computeVertexNormals();
          const m = new THREE.Mesh(g, rockMat);
          m.position.copy(p); m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
          m.castShadow = true; m.receiveShadow = true;
          this.scene.add(m);
        }
        frame(sp);
        for (let k = 0; k < (hi ? 14 : 8); k++) {
          const a = Math.PI * (0.2 + 0.6 * rnd());
          const p = wallPoint(sp + dirSign * 0.3, a, 0.1);
          const L = 1 + rnd() * 1.6;
          const v = new THREE.Mesh(new THREE.PlaneGeometry(0.35, L), vineMat);
          v.position.copy(p).add(new THREE.Vector3(0, -L / 2, 0));
          v.rotation.y = Math.atan2(smp.t.x, smp.t.z) + Math.PI / 2 + (rnd() - 0.5) * 0.6;
          this.scene.add(v);
          const ph = rnd() * 6;
          this.animated.push(t => { v.rotation.z = Math.sin(t * 1.1 + ph) * 0.06; });
        }
      }
    }
    // ---- torches on brackets with real flickering light ----
    const flame = this.flameTex || (this.flameTex = TX.makeFlameTexture());
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x3a2614, roughness: 0.9 });
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.8 });
    this.torchPts = [];
    this.tunnelEyes = [];
    const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.6, 0.3) });
    for (let s = s0 + 7; s < s1 - 5; s += 11) {
      const sd = (Math.round(s / 11) % 2) ? 1 : -1;
      const a = sd > 0 ? 0.08 * Math.PI : 0.92 * Math.PI;
      const wp = wallPoint(s, a, 0.05);
      frame(s);
      const toC = smp.p.clone().addScaledVector(smp.u, 1.4).sub(wp).normalize();
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.6, 6), woodMat);
      stick.position.copy(wp).addScaledVector(toC, 0.25);
      stick.lookAt(wp.clone().addScaledVector(toC, 1).add(new THREE.Vector3(0, 1.4, 0)));
      stick.rotateX(Math.PI / 2);
      const bracket = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.015, 5, 10), ironMat);
      bracket.position.copy(wp).addScaledVector(toC, 0.18);
      this.scene.add(stick, bracket);
      const top = wp.clone().addScaledVector(toC, 0.38).add(new THREE.Vector3(0, 0.3, 0));
      const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: flame, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      fl.scale.set(0.45, 0.85, 1);
      fl.position.copy(top).add(new THREE.Vector3(0, 0.25, 0));
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex || (this.glowTex = TX.makeSoftDot(64, 'rgba(255,150,60,1)', 'rgba(255,120,40,0)')), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.35 }));
      glow.scale.set(2.6, 2.6, 1); glow.position.copy(fl.position);
      this.scene.add(fl, glow);
      this.torchPts.push(fl.position.clone());
      const ph = s;
      this.animated.push(t => { const f = 0.85 + Math.sin(t * 19 + ph) * 0.1 + Math.sin(t * 7.3 + ph) * 0.05; fl.scale.y = f; fl.material.opacity = 0.85 + Math.sin(t * 31 + ph) * 0.15; glow.material.opacity = 0.28 + f * 0.1; });
      // glowing eyes watching from crevices on the other side
      const eg = new THREE.Group();
      for (const ex of [-0.13, 0.13]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), eyeMat); e.position.x = ex; eg.add(e); }
      eg.position.copy(wallPoint(s + 4, sd > 0 ? 1.05 * Math.PI : -0.05 * Math.PI, 0.25));
      eg.lookAt(smp.p.clone().addScaledVector(smp.u, 1.2));
      this.scene.add(eg);
      this.tunnelEyes.push(eg);
    }
    const blinkT = this.tunnelEyes.map((_, i) => i * 1.7);
    this.animated.push(t => { this.tunnelEyes.forEach((e, i) => { const b = (t + blinkT[i]) % 4; e.scale.y = b < 0.12 ? 0.1 : 1; }); });
    // pooled point lights that jump to the torches / crystals nearest the rider
    this.caveLights = [];
    for (let i = 0; i < (hi ? 3 : 2); i++) {
      const L = new THREE.PointLight(0xff9a4a, 0, 14, 1.6);
      this.scene.add(L);
      this.caveLights.push(L);
    }
    // ---- water drips ----
    this.drips = [];
    const dripMat = new THREE.MeshBasicMaterial({ color: 0xbfd8e6, transparent: true, opacity: 0.7 });
    for (let i = 0; i < (hi ? 30 : 14); i++) {
      const s = s0 + 4 + rnd() * (len - 8);
      const top = wallPoint(s, Math.PI * (0.3 + rnd() * 0.4), 0.3);
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.025, 5, 4).scale(1, 2.2, 1), dripMat);
      m.position.copy(top);
      this.scene.add(m);
      frame(s);
      this.drips.push({ m, top, floor: smp.p.y - 0.4, t: rnd() * 2 });
    }
    // ---- bats that burst out toward the cart ----
    this.bats = [];
    const batMat = new THREE.MeshStandardMaterial({ color: 0x4a3a30, emissive: 0x1a120c, roughness: 0.8, side: THREE.DoubleSide });
    for (let i = 0; i < (hi ? 26 : 14); i++) {
      const b = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 5).scale(1, 0.8, 1.5), batMat);
      const wl = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.22).translate(-0.21, 0, 0), batMat);
      const wr = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.22).translate(0.21, 0, 0), batMat);
      wl.rotation.x = wr.rotation.x = -Math.PI / 2;
      b.add(body, wl, wr);
      b.visible = false;
      this.scene.add(b);
      this.bats.push({ g: b, wl, wr, off: new THREE.Vector3((rnd() - 0.5) * 3, (rnd() - 0.3) * 2, rnd() * 8), ph: rnd() * 6 });
    }
    this.batRun = { sStart: tr.sOf('tunnelIn') + 4, t: -1 };
    this.caveRange = [s0, s1];
  }

  // ---------- underwater glass tube, kelp, rocks, light shafts ----------
  buildUnderwater() {
    const tr = this.track, hi = this.q.high;
    // underwater stretch of track
    let w0 = -1, w1 = -1;
    for (let s = tr.sOf('splash') - 30; s < tr.sOf('splash2') + 40; s += 0.5) {
      const i = Math.round(tr.wrap(s) / tr.ds);
      if (tr.P[i * 3 + 1] + 2.6 < 0.2) { if (w0 < 0) w0 = s; w1 = s; }
    }
    if (w0 < 0) return;
    this.underRange = [w0, w1];
    const smp = { p: new THREE.Vector3(), t: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3() };
    const a0 = tr.wrap(w0 - 4), a1 = tr.wrap(w1 + 4);
    // tube shell
    {
      const N = 28, step = 0.6, R = 2.5, rings = Math.floor((a1 - a0) / step) + 1;
      const pos = [], idx = [];
      for (let k = 0; k < rings; k++) {
        tr.sample(a0 + k * step, smp);
        const c = smp.p.clone().addScaledVector(smp.u, 1.0);
        for (let j = 0; j <= N; j++) {
          const a = j / N * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
          pos.push(c.x + (smp.r.x * ca + smp.u.x * sa) * R, c.y + (smp.r.y * ca + smp.u.y * sa) * R, c.z + (smp.r.z * ca + smp.u.z * sa) * R);
        }
      }
      for (let k = 0; k < rings - 1; k++) for (let j = 0; j < N; j++) { const q = k * (N + 1) + j, w = q + N + 1; idx.push(q, w, q + 1, q + 1, w, w + 1); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      const glass = new THREE.MeshStandardMaterial({ color: 0xbfe8ff, roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.5 });
      const m = new THREE.Mesh(g, glass);
      m.renderOrder = 5;
      this.scene.add(m);
      // steel hoops holding the glass
      const hoopMat = new THREE.MeshStandardMaterial({ color: 0x6c7378, metalness: 0.9, roughness: 0.35 });
      const parts = [];
      for (let s = a0; s < a1; s += 3) {
        tr.sample(s, smp);
        const h = new THREE.TorusGeometry(R + 0.04, 0.06, 6, 28);
        const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(smp.r, smp.u, smp.t));
        h.applyQuaternion(q);
        const c = smp.p.clone().addScaledVector(smp.u, 1.0);
        h.translate(c.x, c.y, c.z);
        parts.push(h);
      }
      this.scene.add(new THREE.Mesh(mergeGeos(parts), hoopMat));
    }
    // kelp forest and rocks on the pool floor
    {
      const r = rng(77);
      const kelpMat = new THREE.MeshStandardMaterial({ color: 0x3f6a2a, roughness: 0.8, side: THREE.DoubleSide, transparent: true, opacity: 0.95 });
      this.kelp = [];
      for (let i = 0; i < (hi ? 70 : 35); i++) {
        const a = r() * Math.PI * 2, d = 4 + r() * (POOL.r - 4);
        const x = POOL.x + Math.cos(a) * d, z = POOL.z + Math.sin(a) * d;
        const g0 = this.heightAt(x, z);
        if (g0 > -2) continue;
        const near = tr.nearestXZ(x, z, 4);
        if (near) continue;
        const H = Math.min(-g0 - 0.6, 3 + r() * 5);
        const geo = new THREE.PlaneGeometry(0.35, H, 1, 8).translate(0, H / 2, 0);
        const m = new THREE.Mesh(geo, kelpMat);
        m.position.set(x, g0, z); m.rotation.y = r() * 3;
        this.scene.add(m);
        this.kelp.push({ m, ph: r() * 6, base: geo.attributes.position.array.slice() });
      }
      const rockMat = new THREE.MeshStandardMaterial({ color: 0x55584f, roughness: 0.9 });
      for (let i = 0; i < 18; i++) {
        const a = r() * Math.PI * 2, d = 3 + r() * POOL.r;
        const x = POOL.x + Math.cos(a) * d, z = POOL.z + Math.sin(a) * d;
        const g = new THREE.IcosahedronGeometry(0.5 + r() * 1.2, 0);
        const m = new THREE.Mesh(g, rockMat);
        m.position.set(x, this.heightAt(x, z), z); m.rotation.set(r() * 3, r() * 3, r() * 3); m.scale.y = 0.6;
        this.scene.add(m);
      }
      this.animated.push(t => {
        for (const k of this.kelp) {
          const p = k.m.geometry.attributes.position;
          for (let i = 0; i < p.count; i++) {
            const y = k.base[i * 3 + 1];
            p.setX(i, k.base[i * 3] + Math.sin(t * 1.1 + k.ph + y * 0.5) * 0.12 * y);
          }
          p.needsUpdate = true;
        }
      });
    }
  }

  // no grass or ferns inside the cave
  clearCave() {
    if (!this.caveRange || !this.vegMeshes) return;
    const smp = { p: new THREE.Vector3(), t: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3() };
    for (let s = this.caveRange[0] - 2; s < this.caveRange[1] + 2; s += 3) {
      this.track.sample(s, smp);
      this.clearAround(smp.p.x, smp.p.z, 9);
    }
  }

  // per-frame cave effects; s = cart position, cam = rider position, fwd = track direction
  updateCave(dt, s, cam, fwd, audio) {
    if (!this.caveLights) return;
    const tr = this.track;
    const [s0, s1] = this.caveRange;
    const inside = s > s0 - 15 && s < s1 + 10;
    // nearest torches and crystal clusters get the pooled lights
    const cands = this.torchPts.map(p => ({ p, c: 0xff9a4a, d: p.distanceToSquared(cam) }))
      .concat(this.caveGlow.map(g => ({ p: g.p, c: g.c, d: g.p.distanceToSquared(cam) })))
      .sort((a, b) => a.d - b.d);
    this.caveLights.forEach((L, i) => {
      const c = cands[i];
      if (!inside || !c) { L.intensity = 0; return; }
      L.position.copy(c.p);
      L.color.setHex(c.c);
      const torch = c.c === 0xff9a4a;
      L.intensity = (torch ? 9 : 6) * (0.85 + Math.sin(this.time * (torch ? 17 : 2) + i * 3) * (torch ? 0.12 : 0.2));
    });
    // dripping water
    for (const d of this.drips) {
      d.t += dt;
      const fall = d.t - 1.2;
      if (fall < 0) { d.m.position.copy(d.top); d.m.scale.setScalar(0.4 + d.t / 1.2 * 0.6); }
      else {
        d.m.position.set(d.top.x, d.top.y - 4.9 * fall * fall, d.top.z);
        if (d.m.position.y < d.floor) { d.t = Math.random() * 0.8; if (inside && audio && d.top.distanceTo(cam) < 10) audio.click(0.12, 3200 + Math.random() * 1500); }
      }
    }
    // bats swarm out of the dark toward the rider just after entering
    const B = this.batRun;
    const dsB = tr.wrap(s - B.sStart);
    if (B.t < 0 && dsB > 0 && dsB < 3) { B.t = 0; if (audio) for (let k = 0; k < 4; k++) setTimeout(() => audio.click(0.25, 5500 + Math.random() * 2000), k * 90); }
    if (B.t >= 0) {
      B.t += dt;
      const sm = { p: new THREE.Vector3(), t: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3() };
      for (const b of this.bats) {
        // fly from deep inside the tunnel, past the rider's head and out behind
        const along = 28 - B.t * 22 + b.off.z - 4;
        tr.sample(s + along, sm);
        b.g.position.copy(sm.p).addScaledVector(sm.u, 1.8 + b.off.y * 0.5 + Math.sin(B.t * 9 + b.ph) * 0.25).addScaledVector(sm.r, b.off.x * 0.6 + Math.sin(B.t * 7 + b.ph) * 0.3);
        b.g.lookAt(b.g.position.clone().addScaledVector(sm.t, -1));
        const flap = Math.sin(B.t * 40 + b.ph) * 0.9;
        b.wl.rotation.y = flap; b.wr.rotation.y = -flap;
        b.g.visible = along > -6;
      }
      if (B.t > 2.4) { B.t = -2; this.bats.forEach(b => { b.g.visible = false; }); }
    } else if (B.t < -1 && dsB > 40) B.t = -1;
  }

  update(dt) {
    this.time += dt;
    this.skyUniforms.time.value = this.time;
    this.waterNormal.offset.set(this.time * 0.012, this.time * 0.006);
    this.hemi.intensity += (0.55 * this.hemiFactor - this.hemi.intensity) * Math.min(1, dt * 3);
    if (this.scene.fog) {
      if (!this.fogDay) this.fogDay = this.scene.fog.color.clone();
      const cave = 1 - this.hemiFactor;
      this.scene.fog.color.copy(this.fogDay).lerp(new THREE.Color(0.07, 0.06, 0.05), Math.min(1, cave * 1.15));
    }
    this.updateVolcano(dt);
    for (const f of this.animated) f(this.time);
  }
}

// Merge geometries (non-indexed). Keeps position, normal, and color or uv.
export function mergeGeos(geos, keepUv = false) {
  const list = geos.map(g => (g.index ? g.toNonIndexed() : g));
  let count = 0;
  for (const g of list) count += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  const names = ['position', 'normal'];
  if (list.every(g => g.attributes.color)) names.push('color');
  if (keepUv && list.every(g => g.attributes.uv)) names.push('uv');
  for (const name of names) {
    const size = list[0].attributes[name].itemSize;
    const arr = new Float32Array(count * size);
    let o = 0;
    for (const g of list) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}
