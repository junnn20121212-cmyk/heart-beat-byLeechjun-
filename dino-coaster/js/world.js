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
      transparent: true, opacity: 0.86, envMapIntensity: 1.3,
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
    const tr = this.track;
    const [s0, s1] = [tr.sOf('tunnelIn') - 4, tr.sOf('tunnelOut') + 2];
    const tex = TX.makeRockTextures(61, [0.42, 0.38, 0.33]);
    tex.map.repeat.set(10, 2); tex.normal.repeat.set(10, 2);
    const innerMat = new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normal, roughness: 0.95, side: THREE.BackSide, envMapIntensity: 0.08 });
    const outerMat = new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normal, roughness: 0.95 });
    const smp = { p: new THREE.Vector3(), t: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3() };
    const ringN = 18, step = 1.0;
    const rings = Math.floor((s1 - s0) / step) + 1;
    const n = this.n2;
    const mk = (radiusFn, a0, a1) => {
      const pos = [], uv = [], idx = [];
      for (let k = 0; k < rings; k++) {
        const s = s0 + k * step;
        tr.sample(s, smp);
        const cx = smp.p.x + smp.u.x * 1.4, cy = smp.p.y + smp.u.y * 1.4, cz = smp.p.z + smp.u.z * 1.4;
        for (let j = 0; j <= ringN; j++) {
          const a = a0 + (a1 - a0) * j / ringN;
          const rad = radiusFn(a, s, k);
          const ca = Math.cos(a), sa = Math.sin(a);
          pos.push(cx + (smp.r.x * ca + smp.u.x * sa) * rad, cy + (smp.r.y * ca + smp.u.y * sa) * rad, cz + (smp.r.z * ca + smp.u.z * sa) * rad);
          uv.push(s / 6, j / ringN);
        }
      }
      for (let k = 0; k < rings - 1; k++)
        for (let j = 0; j < ringN; j++) {
          const a = k * (ringN + 1) + j, b = a + ringN + 1;
          idx.push(a, b, a + 1, a + 1, b, b + 1);
        }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const inner = mk((a, s) => 3.0 + 0.35 * n(a * 2, s * 0.3) + (Math.sin(a) < -0.3 ? -0.2 : 0), -0.25 * Math.PI, 1.25 * Math.PI);
    const outer = mk((a, s, k) => {
      const end = Math.min(k, rings - 1 - k);
      return 3.3 + Math.min(end * 0.6, 1) * (3.5 + 2.5 * (n(a * 1.3 + 9, s * 0.05) * 0.5 + 0.5));
    }, -0.3 * Math.PI, 1.3 * Math.PI);
    const mi = new THREE.Mesh(inner, innerMat), mo = new THREE.Mesh(outer, outerMat);
    mi.receiveShadow = true; mo.castShadow = true; mo.receiveShadow = true;
    this.scene.add(mi, mo);
    // torches + glowing eyes in the dark
    const flame = this.flameTex || (this.flameTex = TX.makeFlameTexture());
    this.tunnelEyes = [];
    const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.6, 0.3) });
    for (let s = s0 + 8; s < s1 - 6; s += 13) {
      tr.sample(s, smp);
      const sd = (Math.round(s / 13) % 2) ? 1 : -1;
      const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: flame, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      fl.scale.set(0.5, 0.9, 1);
      fl.position.copy(smp.p).addScaledVector(smp.r, sd * 2.4).addScaledVector(smp.u, 2.1);
      this.scene.add(fl);
      const ph = s;
      this.animated.push(t => { fl.scale.y = 0.85 + Math.sin(t * 19 + ph) * 0.1; fl.material.opacity = 0.85 + Math.sin(t * 31 + ph) * 0.15; });
      // eyes pair
      const eg = new THREE.Group();
      for (const ex of [-0.13, 0.13]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), eyeMat);
        e.position.x = ex;
        eg.add(e);
      }
      eg.position.copy(smp.p).addScaledVector(smp.r, -sd * 2.6).addScaledVector(smp.u, 0.9 + (s % 3) * 0.3).addScaledVector(smp.t, 4);
      eg.lookAt(smp.p.clone().addScaledVector(smp.u, 1.2));
      this.scene.add(eg);
      this.tunnelEyes.push(eg);
    }
    const blinkT = this.tunnelEyes.map((_, i) => i * 1.7);
    this.animated.push(t => {
      this.tunnelEyes.forEach((e, i) => { const b = (t + blinkT[i]) % 4; e.scale.y = b < 0.12 ? 0.1 : 1; });
    });
  }

  update(dt) {
    this.time += dt;
    this.skyUniforms.time.value = this.time;
    this.waterNormal.offset.set(this.time * 0.012, this.time * 0.006);
    this.hemi.intensity += (0.55 * this.hemiFactor - this.hemi.intensity) * Math.min(1, dt * 3);
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
