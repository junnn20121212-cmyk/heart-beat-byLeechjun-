// DINO RUSH — 3D / Cardboard VR dinosaur roller coaster
import * as THREE from 'three';
import { Track, buildTrackMeshes, buildCart } from './track.js';
import { World } from './world.js';
import { Director } from './encounters.js';
import { AudioEngine } from './audio.js';
import { StereoRenderer, Gyro } from './vr.js';
import * as TX from './textures.js';
import { Riders, HeadInertia } from './riders.js';

const $ = id => document.getElementById(id);
const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

// ---------------- quality ----------------
const params = new URLSearchParams(location.search);
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1100);
let qName = params.get('q') || (() => { try { return localStorage.getItem('dino-q'); } catch (e) { return null; } })() || (isMobile ? 'low' : 'high');
const Q = { high: qName === 'high' };

// ---------------- particles ----------------
class Particles {
  constructor(scene, max = 900) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.mat = new THREE.PointsMaterial({ size: 0.35, map: TX.makeSoftDot(64), vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true, opacity: 0.85 });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.i = 0;
    this.dustAcc = 0;
  }
  spawn(p, v, c, life, drag = 0.5) {
    const i = this.i; this.i = (this.i + 1) % this.max;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set(c, i * 3);
    this.life[i] = life; this.drag[i] = drag;
  }
  burst(p, n, kind, power = 6) {
    const v = new THREE.Vector3(), q = new THREE.Vector3();
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, r = Math.random();
      v.set(Math.cos(a) * r * power * 0.5, (0.5 + Math.random()) * power, Math.sin(a) * r * power * 0.5);
      q.copy(p).add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random(), (Math.random() - 0.5) * 3));
      const c = kind === 'water' ? [0.75 + Math.random() * 0.2, 0.85, 0.9] : kind === 'leaf' ? [0.15, 0.32 + Math.random() * 0.2, 0.08] : [0.45, 0.38, 0.28];
      this.spawn(q, v, c, 1.2 + Math.random() * 1.2, kind === 'leaf' ? 1.5 : 0.4);
    }
  }
  emitDust(p, dt) {
    this.dustAcc += dt * 40;
    const v = new THREE.Vector3();
    while (this.dustAcc > 1) {
      this.dustAcc--;
      v.set((Math.random() - 0.5) * 2, 0.6 + Math.random() * 1.2, (Math.random() - 0.5) * 2);
      this.spawn(new THREE.Vector3(p.x + (Math.random() - 0.5) * 2, p.y + 0.2, p.z + (Math.random() - 0.5) * 2), v, [0.5, 0.43, 0.33], 1.5, 1.2);
    }
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -1e4; continue; }
      this.life[i] -= dt;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 2] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - 9.8 * dt * (this.drag[i] > 1 ? 0.15 : 1);
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

// ---------------- floating dust motes around the viewer (cinematic air) ----------------
function makeDust() {
  const N = Q.high ? 500 : 250, R = 14;
  const pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 2 * R; pos[i * 3 + 1] = (Math.random() - 0.5) * 2 * R * 0.5; pos[i * 3 + 2] = (Math.random() - 0.5) * 2 * R; seed[i] = Math.random() * 10; }
  const g = new THREE.BufferGeometry();
  const world = new Float32Array(N * 3);
  g.setAttribute('position', new THREE.BufferAttribute(world, 3));
  const m = new THREE.PointsMaterial({ size: 0.06, map: TX.makeSoftDot(32), color: 0xe8d7b0, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(g, m);
  points.frustumCulled = false;
  let t = 0;
  return {
    points,
    update(c, dt, v) {
      t += dt;
      for (let i = 0; i < N; i++) {
        pos[i * 3] += Math.sin(t * 0.3 + seed[i]) * dt * 0.15;
        pos[i * 3 + 1] += Math.cos(t * 0.23 + seed[i] * 2) * dt * 0.08;
        for (let k = 0; k < 3; k++) {
          const lim = k === 1 ? R * 0.5 : R;
          // motes live in world space; wrap them into a box around the viewer
          const rel = pos[i * 3 + k] - c.getComponent(k);
          const local = ((rel % (2 * lim)) + 3 * lim) % (2 * lim) - lim;
          world[i * 3 + k] = c.getComponent(k) + local;
        }
      }
      g.attributes.position.needsUpdate = true;
      m.opacity = 0.55 * Math.max(0.2, 1 - v / 25);
    },
  };
}

// ---------------- floating text sign (works in VR) ----------------
class Billboard {
  constructor() {
    this.c = document.createElement('canvas'); this.c.width = 1024; this.c.height = 256;
    this.tex = TX.toTexture(this.c);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthTest: false, fog: false, toneMapped: false }));
    this.mesh.renderOrder = 999;
    this.text = '';
  }
  set(text, sub = '') {
    if (text + sub === this.text) return;
    this.text = text + sub;
    const ctx = this.c.getContext('2d');
    ctx.clearRect(0, 0, 1024, 256);
    if (!text) { this.mesh.visible = false; this.tex.needsUpdate = true; return; }
    this.mesh.visible = true;
    ctx.fillStyle = 'rgba(10,14,8,0.6)';
    ctx.beginPath(); ctx.roundRect(40, 30, 944, 196, 40); ctx.fill();
    ctx.fillStyle = '#ffd24a';
    ctx.font = 'bold 96px "Arial Black", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 512, sub ? 108 : 128);
    if (sub) { ctx.fillStyle = '#f2ead6'; ctx.font = 'bold 44px sans-serif'; ctx.fillText(sub, 512, 190); }
    this.tex.needsUpdate = true;
  }
}

// ---------------- app ----------------
const app = {
  mode: 'normal', // or 'vr'
  state: 'loading',
  s: 0, dist: 0, v: 0, rideT: 0, countdown: 0, endT: 0,
  yaw: 0, pitch: 0, dragging: false, lastDrag: -99,
  fx: { shake: 0, flash: 0, fade: 1 },
  useGyro: false,
  muted: false,
};

let riders, inertia, holdS, menuCam, dust, renderer, scene, camera, track, world, director, audio, stereo, gyro, particles, carts, billboard, headlight, lapS0;
const smp = { p: new THREE.Vector3(), t: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3() };
const smp2 = { p: new THREE.Vector3(), t: new THREE.Vector3(), r: new THREE.Vector3(), u: new THREE.Vector3() };

function setProgress(p, label) {
  $('bar').style.width = Math.round(p * 100) + '%';
  if (label) $('loadLabel').textContent = label;
}

async function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  app.maxPR = Math.min(window.devicePixelRatio || 1, Q.high ? 2 : 1.5);
  app.pr = app.maxPR;
  renderer.setPixelRatio(app.pr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $('view').appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.08, 4000);

  setProgress(0.05, '트랙 설계 · 물리 시뮬레이션');
  await nextFrame();
  track = new Track();
  lapS0 = track.sOf('stationStop');
  holdS = track.sOf('hold') - 1;

  setProgress(0.15, '하늘과 조명');
  await nextFrame();
  world = new World(scene, track, Q);
  world.buildSky(renderer);

  setProgress(0.25, '지형 생성 · 협곡 깎는 중');
  await nextFrame();
  world.buildTerrain();
  world.buildWater();

  setProgress(0.4, '트랙 · 지지대 · 터널 · 역사');
  await nextFrame();
  scene.add(buildTrackMeshes(track, world, Q));
  world.buildStation();
  world.buildTunnel();
  world.buildVolcano();

  setProgress(0.5, '정글 식생 심는 중');
  await nextFrame();
  world.buildVegetation();

  setProgress(0.62, '공룡 피부 · 골격 생성 중');
  await nextFrame();
  audio = new AudioEngine();
  particles = new Particles(scene, Q.high ? 1200 : 700);
  director = new Director({ scene, track, world, audio, fx: app.fx, q: Q, particles });
  director.build();
  director.clearVegetation();

  setProgress(0.85, '탑승차량 준비');
  await nextFrame();
  carts = buildCart({ claw: TX.makeClawMarks() });
  scene.add(carts.front, carts.back);
  camera.position.set(-0.38, 1.36, -0.42);
  carts.front.add(camera);
  riders = new Riders(carts, Q.high);
  inertia = new HeadInertia();
  setBars(1);
  headlight = new THREE.SpotLight(0xfff0d0, 0, 60, 0.55, 0.5, 1.2);
  headlight.position.set(0, 0.8, -1.4);
  headlight.target.position.set(0, -0.5, -20);
  carts.front.add(headlight, headlight.target);
  billboard = new Billboard();
  billboard.mesh.position.set(0, 0.1, -2.6);
  camera.add(billboard.mesh);

  stereo = new StereoRenderer(renderer, Q.high);
  menuCam = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 4000);
  dust = makeDust();
  scene.add(dust.points);
  gyro = new Gyro();

  placeCart(lapS0);
  world.followSun(smp.p);
  setProgress(0.95, '셰이더 컴파일');
  await nextFrame();
  try { renderer.compile(scene, camera); } catch (e) { /* ignore */ }
  setProgress(1, '준비 완료');
  app.state = 'menu';
  $('loading').hidden = true;
  $('menu').hidden = false;
  $('qual').value = Q.high ? 'high' : 'low';
  app.last = performance.now();
  requestAnimationFrame(loop);
}

function placeCart(s) {
  track.sample(s, smp);
  const m = new THREE.Matrix4();
  const back = smp.t.clone().negate();
  m.makeBasis(smp.r, smp.u, back);
  carts.front.quaternion.setFromRotationMatrix(m);
  carts.front.position.copy(smp.p);
  track.sample(s - 2.75, smp2);
  m.makeBasis(smp2.r, smp2.u, smp2.t.clone().negate());
  carts.back.quaternion.setFromRotationMatrix(m);
  carts.back.position.copy(smp2.p);
}

// ---------------- ride feel helpers ----------------
const bars = () => (carts.front.userData.bars || []).concat(carts.back.userData.bars || []);
function setBars(k) { for (const b of bars()) b.rotation.x = 1.25 * k; }
let buzzT = 0;
function buzz(p, force = false) {
  if (!force && buzzT > 0) return;
  buzzT = 0.25;
  try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* ignore */ }
}
let screamT = 0;
function screams(n = 3, opts = {}) {
  if (screamT > 0 || app.muted) return;
  screamT = 3.5;
  const heads = riders.heads();
  for (let i = 0; i < Math.min(n, heads.length); i++) {
    const h = heads[Math.floor(Math.random() * heads.length)];
    setTimeout(() => audio.scream(h, { pitch: 0.75 + Math.random() * 0.7, dur: opts.dur || 1.4 + Math.random() * 0.9, rise: opts.rise || 1.25 }), i * 140 + Math.random() * 120);
  }
}
function splashDrops() {
  if (app.mode !== 'normal') return;
  const el = $('drops');
  el.innerHTML = '';
  for (let i = 0; i < 26; i++) {
    const d = document.createElement('i');
    const sz = 8 + Math.random() * 34;
    d.style.cssText = `left:${Math.random() * 100}%;top:${Math.random() * 100}%;width:${sz}px;height:${sz * (1 + Math.random() * 0.4)}px`;
    el.appendChild(d);
  }
  el.classList.remove('fade'); void el.offsetWidth; el.classList.add('fade');
}

// ---------------- ride control ----------------
async function startRide(mode) {
  app.mode = mode;
  audio.start();
  audio.setMuted(app.muted);
  $('menu').hidden = true;
  $('end').hidden = true;
  if (mode === 'vr') {
    document.body.classList.add('vr');
    try {
      const el = document.documentElement;
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape').catch(() => {});
    } catch (e) { /* not fatal */ }
    const ok = await gyro.request();
    if (!ok) toast('자이로 센서를 사용할 수 없어요. 화면을 드래그해서 둘러보세요.');
    app.useGyro = ok;
  } else {
    document.body.classList.remove('vr');
    if (isMobile && $('gyroToggle').checked) app.useGyro = await gyro.request();
    else { app.useGyro = false; gyro.stop(); }
    $('hud').hidden = false;
  }
  gyro.recenter();
  app.yaw = 0; app.pitch = 0;
  app.dist = 0; app.s = lapS0; app.v = 0; app.rideT = 0;
  app.holdPhase = null; app.launched = false; app.fovKick = 0;
  app.cdTotal = app.countdown; app.barsDown = 0; app.beeped = false; app.wasRoll = false; app.excite = 0;
  setBars(1); inertia.reset();
  audio.announce('다이노 러시에 오신 것을 환영합니다. 안전바를 끝까지 내려 주세요. 공룡에게 손을 흔들지 마세요. 출발합니다!');
  app.countdown = mode === 'vr' ? 8 : 7;
  app.state = 'countdown';
  app.fx.fade = 1;
  onResize();
}

function endRide() {
  app.state = 'end';
  app.endT = 0;
  setTimeout(() => { for (const b of bars()) b.rotation.x = 1.25; audio.hiss(); }, 1800);
  if (app.mode === 'normal') { $('end').hidden = false; $('hud').hidden = true; }
}

function exitToMenu() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  document.body.classList.remove('vr');
  app.mode = 'normal';
  app.state = 'menu';
  $('menu').hidden = false; $('end').hidden = true; $('hud').hidden = true;
  billboard.set('');
  onResize();
}

let toastT = 0;
function toast(t) {
  const el = $('toast');
  el.textContent = t;
  el.classList.add('show');
  toastT = 2.6;
}

// ---------------- input ----------------
function setupInput() {
  const cv = renderer.domElement;
  let lx = 0, ly = 0, lastTap = 0;
  cv.addEventListener('pointerdown', e => {
    app.dragging = true; lx = e.clientX; ly = e.clientY;
    cv.setPointerCapture(e.pointerId);
    const now = performance.now();
    if (now - lastTap < 320) { gyro.recenter(); app.yaw = 0; app.pitch = 0; toast('정면 재설정'); }
    lastTap = now;
  });
  cv.addEventListener('pointermove', e => {
    if (!app.dragging) return;
    const k = 0.0042 * (app.mode === 'vr' ? 1 : 72 / camera.fov);
    app.yaw -= (e.clientX - lx) * k;
    app.pitch -= (e.clientY - ly) * k;
    app.pitch = THREE.MathUtils.clamp(app.pitch, -1.3, 1.3);
    lx = e.clientX; ly = e.clientY;
    app.lastDrag = performance.now() / 1000;
  });
  const up = () => { app.dragging = false; };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  window.addEventListener('keydown', e => {
    if (e.key === 'r' || e.key === 'R') { gyro.recenter(); app.yaw = 0; app.pitch = 0; }
    if (e.key === 'Escape') exitToMenu();
    if (e.key === 'ArrowLeft') app.yaw -= 0.2;
    if (e.key === 'ArrowRight') app.yaw += 0.2;
  });
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 300));

  $('btnNormal').onclick = () => startRide('normal');
  $('btnVR').onclick = () => startRide('vr');
  $('btnAgain').onclick = () => startRide(app.mode);
  $('btnMenu').onclick = exitToMenu;
  $('btnExit').onclick = exitToMenu;
  $('vrExit').onclick = exitToMenu;
  $('btnCenter').onclick = () => { gyro.recenter(); app.yaw = 0; app.pitch = 0; };
  $('btnMute').onclick = () => { app.muted = !app.muted; audio.setMuted(app.muted); $('btnMute').textContent = app.muted ? '소리 켜기' : '소리 끄기'; };
  $('qual').onchange = e => {
    try { localStorage.setItem('dino-q', e.target.value); } catch (err) { /* ignore */ }
    const u = new URL(location.href); u.searchParams.set('q', e.target.value); location.href = u.toString();
  };
  $('lens').onchange = e => { stereo.distort = e.target.checked; };
}

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  app.baseFov = w < h ? 85 : 72;
  camera.fov = app.baseFov;
  camera.updateProjectionMatrix();
}

// ---------------- main loop ----------------
const inertiaQ = new THREE.Quaternion(), headQ = new THREE.Quaternion(), dragQ = new THREE.Quaternion(), shakeQ = new THREE.Quaternion(), tmpE = new THREE.Euler();
const camWorld = new THREE.Vector3(), fwd = new THREE.Vector3();
const statsAcc = { t: 0, n: 0 };

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - app.last) / 1000);
  app.last = now;
  const time = now / 1000;

  // ---- ride ----
  let onLift = false, inTunnel = false;
  if (app.state === 'countdown') {
    app.countdown -= dt;
    app.fx.fade = Math.max(0, app.fx.fade - dt * 0.8);
    const c = Math.ceil(app.countdown);
    if (app.mode === 'vr' && app.countdown > 3) billboard.set('DINO RUSH', '안전바를 내려주세요 · 곧 출발합니다');
    else if (c > 3) billboard.set('DINO RUSH', '안전바를 내려주세요');
    else billboard.set(c > 0 ? String(c) : '출발!', c > 0 ? '꽉 잡으세요!' : '');
    const el = app.cdTotal - app.countdown;
    // lap bars come down one by one, each with a clunk
    const nb = bars().length;
    const lowered = Math.min(nb, Math.floor((el - 1.6) / 0.25) + 1);
    while (app.barsDown < lowered && app.barsDown < nb) { audio.clunk(); if (app.barsDown === 0) buzz(40, true); app.barsDown++; }
    bars().forEach((b, i) => { const t = THREE.MathUtils.clamp((el - 1.6 - i * 0.25 + 0.25) / 0.3, 0, 1); b.rotation.x = 1.25 * (1 - t * t); });
    if (!app.beeped && app.countdown < 1.2) { app.beeped = true; audio.beep(); }
    if (app.countdown <= 0) { app.state = 'ride'; app.rideT = 0; audio.hiss(); setTimeout(() => billboard.set(''), 900); }
  } else if (app.state === 'ride') {
    app.rideT += dt;
    track.sample(app.s, smp);
    let v = smp.v;
    v *= Math.min(1, 0.2 + app.rideT / 1.5);
    // dive-coaster hold: stop on the edge of the first drop, then let go
    if (!app.holdPhase && app.s >= holdS && app.s < holdS + 20) {
      app.holdPhase = 'hold'; app.holdT = 2.8; app.vRel = 0;
      audio.hiss(); app.fx.shake = Math.max(app.fx.shake, 0.25);
      if (app.mode === 'normal') toast('...떨어진다!!'); else { billboard.set('...!!'); app.msgT = 2.4; }
    }
    if (app.holdPhase === 'hold') {
      v = 0; app.holdT -= dt;
      if (app.holdT < 0) { app.holdPhase = 'release'; audio.hiss(); audio.click(0.6, 600); buzz([60, 40, 60], true); screamT = 0; setTimeout(() => screams(4, { dur: 2.6 }), 350); }
    } else if (app.holdPhase === 'release') {
      app.vRel += 9.81 * Math.max(0.15, -smp.t.y) * dt;
      if (app.vRel >= v) app.holdPhase = 'done'; else v = app.vRel;
    }
    // launch kick
    if (smp.zone === 4 && !app.launched) { app.launched = true; audio.launch(); app.fx.shake = Math.max(app.fx.shake, 0.5); app.fovKick = 10; buzz([300, 60, 500], true); screamT = 0; screams(3, { rise: 1.5 }); }
    const remain = track.length - app.dist;
    if (remain < 6) v = Math.max(0.25, Math.min(v, remain * 0.6));
    app.v = v;
    app.dist += v * dt;
    app.s = track.wrap(lapS0 + app.dist);
    if (remain < 0.05) { app.dist = track.length; app.s = lapS0; endRide(); }
  } else if (app.state === 'end') {
    app.v = 0;
    app.endT += dt;
    billboard.set('도착!', app.mode === 'vr' ? '잠시 후 다시 출발합니다' : '살아남았습니다');
    if (app.mode === 'vr' && app.endT > 9) startRide('vr');
  } else {
    app.v = 0;
  }
  track.sample(app.s, smp);
  onLift = smp.zone === 2 && app.state === 'ride';
  inTunnel = track.inRange(app.s, 'tunnel');
  placeCart(app.s);

  // ---- head / camera ----
  const gq = app.useGyro ? gyro.read(headQ) : null;
  if (!gq) headQ.identity();
  // gentle look-assist toward danger when the user is not steering (mouse/touch only)
  if (!app.useGyro && director.focus && time - app.lastDrag > 2.5 && app.state === 'ride') {
    const local = carts.front.worldToLocal(director.focus.clone());
    const want = THREE.MathUtils.clamp(Math.atan2(-local.x, -local.z), -0.9, 0.9);
    app.yaw += (-want - app.yaw) * Math.min(1, dt * 0.9);
  } else if (!app.useGyro && !app.dragging && time - app.lastDrag > 4) {
    app.yaw *= 1 - Math.min(1, dt * 0.6);
    app.pitch *= 1 - Math.min(1, dt * 0.6);
  }
  tmpE.set(-app.pitch, -app.yaw, 0, 'YXZ');
  dragQ.setFromEuler(tmpE);
  if (gq) { tmpE.set(0, -app.yaw, 0, 'YXZ'); dragQ.setFromEuler(tmpE); }
  // shake
  app.fx.shake = Math.max(0, app.fx.shake - dt * 1.6);
  const base = (app.v / 30) * 0.009 + (app.state === 'ride' ? 0.0008 : 0);
  // speed sensation: widen the view with speed (not in VR, where FOV is fixed by the lenses)
  app.fovKick = Math.max(0, (app.fovKick || 0) - dt * 4);
  if (app.mode === 'normal') {
    const want = app.baseFov + THREE.MathUtils.clamp((app.v - 12) * 0.5, 0, 14) + app.fovKick;
    camera.fov += (want - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();
  }
  // tunnel vision under high g / high speed
  {
    const g = app.state === 'ride' ? smp.gv : 1;
    const want = THREE.MathUtils.clamp((g - 2.6) * 0.35, 0, 0.7) + THREE.MathUtils.clamp((app.v - 22) / 30, 0, 0.35) + THREE.MathUtils.clamp(-g * 0.25, 0, 0.2);
    app.fx.vig = (app.fx.vig || 0) + (want - (app.fx.vig || 0)) * Math.min(1, dt * 4);
    $('gvig').style.opacity = app.mode === 'normal' ? app.fx.vig.toFixed(3) : 0;
  }
  const sh = base + app.fx.shake * 0.05;
  tmpE.set(Math.sin(time * 41) * sh + Math.sin(time * 23.7) * sh * 0.6, Math.sin(time * 37.3) * sh * 0.7, Math.sin(time * 29.1) * sh * 0.5);
  shakeQ.setFromEuler(tmpE);
  // head inertia: the body lags behind every push of the cart
  inertia.update(dt, smp.t, smp.r, smp.u, app.v, app.mode === 'vr' ? 0.55 : 1);
  tmpE.set(inertia.rot.pitch, 0, inertia.rot.roll);
  inertiaQ.setFromEuler(tmpE);
  camera.quaternion.copy(dragQ).multiply(inertiaQ).multiply(headQ).multiply(shakeQ);
  const gv = app.state === 'ride' ? smp.gv : 1;
  camera.position.set(-0.38 + inertia.pos.x, 1.36 + inertia.pos.y, -0.42 + inertia.pos.z);
  // passengers: arms up on drops, airtime, the roll and the launch
  {
    const inRoll = track.inRange(app.s, 'roll');
    let want = 0;
    if (app.state === 'ride') {
      want = THREE.MathUtils.clamp((app.v - 20) / 10, 0, 1) * (smp.t.y < -0.2 ? 1 : 0.4);
      if (gv < 0.35 || inRoll || smp.zone === 4 || app.holdPhase === 'release') want = 1;
      if (app.holdPhase === 'hold') want = 0.15;
    }
    app.excite = (app.excite || 0) + (want - (app.excite || 0)) * Math.min(1, dt * 3);
    riders.update(dt, app.excite, inertia.rot);
    if (inRoll && !app.wasRoll) { screamT = 0; screams(4, { dur: 2.4 }); buzz([80, 60, 80, 60, 80], true); }
    app.wasRoll = inRoll;
    if (app.state === 'ride' && gv < 0.15 && app.v > 10) screams(2, { dur: 1.2 });
    if (app.state === 'ride' && gv > 3.3) buzz(90);
    if (onLift && Math.floor(app.dist / 0.55) !== app.lastChain) { app.lastChain = Math.floor(app.dist / 0.55); buzz(12, true); }
  }
  buzzT -= dt; screamT -= dt;
  if (app.fx.flash > (app.lastFlash || 0) + 0.4) { screamT = 0; screams(3, { dur: 1.3, rise: 1.5 }); }
  app.lastFlash = app.fx.flash;

  carts.front.updateMatrixWorld(true);
  camera.getWorldPosition(camWorld);
  fwd.copy(smp.t);

  // ---- world ----
  world.update(dt);
  world.followSun(smp.p);
  headlight.intensity = inTunnel ? 45 : 0;
  world.hemiFactor = inTunnel ? 0.12 : 1;
  const _t0 = performance.now();
  if (app.state === 'menu') {
    // slow cinematic dolly in front of the five-dinosaur line-up
    const c = director.lineupCenter;
    const aspect = window.innerWidth / window.innerHeight;
    const wide = aspect > 1.2;
    const shift = 0;
    const halfW = wide ? 17.5 : 12;
    const vfov = THREE.MathUtils.degToRad(menuCam.fov);
    const dist = Math.max(20, halfW / (Math.tan(vfov / 2) * aspect)) * (1 + Math.sin(time * 0.12) * 0.04);
    const sway = Math.sin(time * 0.09) * 0.12;
    menuCam.aspect = aspect; menuCam.updateProjectionMatrix();
    const cx = c.x + 2.5 + shift;
    menuCam.position.set(cx + Math.sin(sway) * dist, c.y + 1.4, c.z + Math.cos(sway) * dist);
    menuCam.lookAt(cx, c.y + (wide ? 2.6 : 1.5), c.z);
    menuCam.updateMatrixWorld();
    director.menuCam = menuCam.position;
  } else director.menuCam = null;
  director.update(dt, { s: app.s, v: app.v, cam: camWorld, fwd, time });
  dust.update(app.state === 'menu' ? menuCam.position : camWorld, dt, app.v);
  app.tDirector = performance.now() - _t0;
  particles.update(dt);
  // splash when skimming the river
  if (app.state === 'ride' && smp.p.y < 1.6 && app.v > 5) {
    for (let k = 0; k < 6; k++) particles.spawn(
      smp.p.clone().addScaledVector(smp.r, (Math.random() < 0.5 ? -1 : 1) * (0.9 + Math.random() * 0.4)),
      smp.r.clone().multiplyScalar((Math.random() - 0.5) * 6).add(new THREE.Vector3(0, 3 + Math.random() * 4, 0)).addScaledVector(smp.t, app.v * 0.3),
      [0.85, 0.92, 0.95], 1.2, 0.3);
    if (!app.splashed) { app.splashed = true; audio.splash(1); app.fx.shake = Math.max(app.fx.shake, 0.3); splashDrops(); buzz(150, true); screamT = 0; screams(2, { dur: 1.1 }); }
  } else if (smp.p.y > 3) app.splashed = false;
  for (const m of director.messages.splice(0)) {
    if (app.mode === 'normal') toast(m);
    else if (app.state === 'ride') { billboard.set(m); app.msgT = 2.5; }
  }
  if (app.msgT > 0) { app.msgT -= dt; if (app.msgT <= 0 && app.state === 'ride') billboard.set(''); }

  // ---- audio ----
  camera.updateMatrixWorld();
  audio.updateListener(camera);
  audio.update(dt, { speed: app.v, onLift, inTunnel, tension: director.tension });

  // ---- fx ----
  app.fx.flash = Math.max(0, app.fx.flash - dt * 2.2);
  if (app.state === 'end' && app.mode === 'vr' && app.endT > 7) app.fx.fade = Math.min(1, (app.endT - 7) / 2);
  $('flash').style.opacity = (app.fx.flash * 0.55).toFixed(3);
  $('fade').style.opacity = app.mode === 'normal' && app.state !== 'menu' ? app.fx.fade.toFixed(3) : 0;

  // ---- HUD ----
  if (app.mode === 'normal' && app.state !== 'menu') {
    $('spd').textContent = Math.round(app.v * 3.6);
    $('gf').textContent = gv.toFixed(1);
    $('prog').style.width = (app.dist / track.length * 100).toFixed(1) + '%';
  }
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').classList.remove('show'); }

  // ---- render ----
  const _t1 = performance.now();
  if (window.__dino && window.__dino.debugCam) renderer.render(scene, window.__dino.debugCam);
  else if (app.mode === 'vr' && app.state !== 'menu') stereo.render(scene, camera, app.fx);
  else if (app.state === 'menu') { world.followSun(director.lineupCenter); renderer.render(scene, menuCam); }
  else renderer.render(scene, camera);

  app.tRender = performance.now() - _t1;
  // ---- adaptive resolution ----
  statsAcc.t += dt; statsAcc.n++;
  if (statsAcc.t > 2) {
    const fps = statsAcc.n / statsAcc.t;
    statsAcc.t = 0; statsAcc.n = 0;
    if (fps < 40 && app.pr > 0.7) { app.pr = Math.max(0.7, app.pr - 0.15); renderer.setPixelRatio(app.pr); onResize(); }
    else if (fps < 28 && !app.lite && app.state === 'ride') {
      // last resort for slow phones: shorter view distance
      app.lite = true;
      camera.far = 700; camera.updateProjectionMatrix();
      scene.fog.density = 0.0042;
      world.sun.castShadow = false;
    }
    else if (fps > 57 && app.pr < app.maxPR) { app.pr = Math.min(app.maxPR, app.pr + 0.1); renderer.setPixelRatio(app.pr); onResize(); }
    $('fps').textContent = Math.round(fps) + ' fps';
  }
}

init().then(setupInput).catch(err => {
  console.error(err);
  $('loadLabel').textContent = '오류: ' + (err && err.message ? err.message : err);
});

// debug hook (used for automated screenshots)
window.__dino = { makeCam: f => new THREE.PerspectiveCamera(f, innerWidth / innerHeight, 0.1, 3000), app, get track() { return track; }, get director() { return director; }, get world() { return world; }, jump(s) { app.s = track.wrap(s); app.dist = track.wrap(s - lapS0); } };
