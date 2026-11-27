// Cardboard-style stereo rendering with barrel pre-distortion + gyro head tracking
import * as THREE from 'three';

export class StereoRenderer {
  constructor(renderer, high = true) {
    this.renderer = renderer;
    this.ipd = 0.064;
    this.fov = 92;
    this.distort = true;
    this.camL = new THREE.PerspectiveCamera();
    this.camR = new THREE.PerspectiveCamera();
    const gl = renderer.getContext();
    const ext = renderer.extensions;
    const canFloat = renderer.capabilities.isWebGL2 && (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'));
    this.rtType = canFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.rt = [0, 1].map(() => new THREE.WebGLRenderTarget(4, 4, { type: this.rtType, samples: canFloat && high ? 2 : 0, depthBuffer: true }));
    this.uniforms = {
      tex: { value: null },
      k1: { value: 0.26 }, k2: { value: 0.12 },
      aspect: { value: 1 },
      flash: { value: 0 },
      fade: { value: 0 },
      scale: { value: 1.12 },
    };
    this.quadMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        uniform sampler2D tex; uniform float k1, k2, aspect, flash, fade, scale; varying vec2 vUv;
        void main(){
          vec2 p = (vUv - 0.5) * vec2(aspect, 1.0) * 2.0;
          float r2 = dot(p, p);
          vec2 d = p * (1.0 + k1 * r2 + k2 * r2 * r2) / scale;
          vec2 uv = d / vec2(aspect, 1.0) * 0.5 + 0.5;
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
          vec3 c = texture2D(tex, uv).rgb;
          float vig = smoothstep(1.6, 0.6, length(p));
          c *= mix(0.75, 1.0, vig);
          c = mix(c, vec3(0.9, 0.05, 0.02), flash * (1.0 - vig * 0.6) * 0.6);
          c *= (1.0 - fade);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.quadMat);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.size = new THREE.Vector2();
  }

  render(scene, camera, fx) {
    const r = this.renderer;
    r.getDrawingBufferSize(this.size);
    const W = this.size.x, H = this.size.y;
    const ew = Math.floor(W / 2);
    const aspect = ew / H;
    camera.updateMatrixWorld();
    for (const [i, cam] of [[0, this.camL], [1, this.camR]]) {
      cam.fov = this.fov; cam.aspect = aspect; cam.near = camera.near; cam.far = camera.far;
      cam.updateProjectionMatrix();
      cam.matrixWorld.copy(camera.matrixWorld);
      const off = (i === 0 ? -1 : 1) * this.ipd / 2;
      cam.matrixWorld.multiply(new THREE.Matrix4().makeTranslation(off, 0, 0));
      cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
      cam.matrixAutoUpdate = false;
    }
    if (!this.distort) {
      r.setScissorTest(true);
      const pr = r.getPixelRatio();
      for (const [i, cam] of [[0, this.camL], [1, this.camR]]) {
        r.setViewport(i * ew / pr, 0, ew / pr, H / pr);
        r.setScissor(i * ew / pr, 0, ew / pr, H / pr);
        r.render(scene, cam);
      }
      r.setScissorTest(false);
      r.setViewport(0, 0, W / pr, H / pr);
      return;
    }
    const sc = 1.15; // render a bit larger to keep centre sharp
    const rw = Math.min(2048, Math.round(ew * sc)), rh = Math.min(2048, Math.round(H * sc));
    // wider fov for the distorted buffer
    for (const [i, cam] of [[0, this.camL], [1, this.camR]]) {
      cam.fov = this.fov * 1.12;
      cam.updateProjectionMatrix();
      const rt = this.rt[i];
      if (rt.width !== rw || rt.height !== rh) rt.setSize(rw, rh);
      r.setRenderTarget(rt);
      r.clear();
      r.render(scene, cam);
    }
    r.setRenderTarget(null);
    const pr = r.getPixelRatio();
    r.setScissorTest(true);
    this.uniforms.aspect.value = aspect;
    this.uniforms.flash.value = fx.flash || 0;
    this.uniforms.fade.value = fx.fade || 0;
    for (let i = 0; i < 2; i++) {
      r.setViewport(i * ew / pr, 0, ew / pr, H / pr);
      r.setScissor(i * ew / pr, 0, ew / pr, H / pr);
      this.uniforms.tex.value = this.rt[i].texture;
      r.render(this.quadScene, this.quadCam);
    }
    r.setScissorTest(false);
    r.setViewport(0, 0, W / pr, H / pr);
  }
}

// Device orientation -> quaternion (same convention as three's old DeviceOrientationControls)
export class Gyro {
  constructor() {
    this.enabled = false;
    this.has = false;
    this.alpha = 0; this.beta = 0; this.gamma = 0;
    this.q = new THREE.Quaternion();
    this.offset = new THREE.Quaternion();
    this.needCenter = true;
    this._e = new THREE.Euler();
    this._q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
    this._z = new THREE.Vector3(0, 0, 1);
    this._q0 = new THREE.Quaternion();
    this.onEvent = (ev) => {
      if (ev.alpha === null && ev.beta === null) return;
      this.has = true;
      this.alpha = THREE.MathUtils.degToRad(ev.alpha || 0);
      this.beta = THREE.MathUtils.degToRad(ev.beta || 0);
      this.gamma = THREE.MathUtils.degToRad(ev.gamma || 0);
    };
  }

  async request() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== 'granted') return false;
      }
    } catch (e) { return false; }
    window.addEventListener('deviceorientation', this.onEvent, true);
    this.enabled = true;
    return true;
  }

  stop() { window.removeEventListener('deviceorientation', this.onEvent, true); this.enabled = false; }

  recenter() { this.needCenter = true; }

  // returns head quaternion relative to "forward" (-Z), or null if no data yet
  read(out) {
    if (!this.enabled || !this.has) return null;
    const orient = THREE.MathUtils.degToRad((screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0);
    this._e.set(this.beta, this.alpha, -this.gamma, 'YXZ');
    this.q.setFromEuler(this._e);
    this.q.multiply(this._q1);
    this.q.multiply(this._q0.setFromAxisAngle(this._z, -orient));
    if (this.needCenter) {
      // yaw of current forward
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.q);
      const yaw = Math.atan2(-f.x, -f.z);
      this.offset.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
      this.needCenter = false;
    }
    return out.copy(this.offset).multiply(this.q);
  }
}
