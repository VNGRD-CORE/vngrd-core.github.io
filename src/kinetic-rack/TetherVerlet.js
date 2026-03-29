/**
 * NEURAL TETHER — TetherVerlet.js
 * Verlet-integration plasma string instrument with granular synthesis.
 * 128-point physics string pinned to thumb tip & index tip.
 */
import * as THREE from 'three';

const N = 128; // Verlet point count

export class NeuralTether {
  constructor(scene, masterGain, ctx, ctrl) {
    this._scene      = scene;
    this._ctx        = ctx;
    this._master     = masterGain;
    this._ctrl       = ctrl;       // shared {vol, tension} ref

    // ── Physics ──────────────────────────────────────────────────────────
    this._pts  = [];  // [{x,y,z}]  current positions
    this._old  = [];  // [{x,y,z}]  previous positions (Verlet)
    this._hasPins   = false;
    this._tension   = 0;
    this._pinA = new THREE.Vector3();  // thumb tip
    this._pinB = new THREE.Vector3();  // index tip

    // Pre-allocate Vector3 array for CatmullRomCurve3 (avoids GC)
    this._curvePts = Array.from({ length: N }, () => new THREE.Vector3());

    // ── Three.js ─────────────────────────────────────────────────────────
    this._tube      = null;
    this._tubeGeo   = null;
    this._tubeMat   = null;
    this._midLight  = null;
    this._lightA    = null;
    this._lightB    = null;
    this._posAttr   = null;   // cached position BufferAttribute
    this._tubeReady = false;

    // ── Audio ─────────────────────────────────────────────────────────────
    this._grainBuf      = null;
    this._compressor    = null;
    this._convolver     = null;
    this._gainNode      = null;
    this._lastGrainTime = 0;

    this._initVerlet();
    this._init3D();
    this._initAudio();
  }

  // ── Verlet init ──────────────────────────────────────────────────────────
  _initVerlet() {
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const x = t * 0.8 - 0.4;
      this._pts.push({ x, y: 0, z: 0 });
      this._old.push({ x, y: 0, z: 0 });
    }
  }

  // ── Three.js ─────────────────────────────────────────────────────────────
  _init3D() {
    // Tube material — liquid chrome + cyan glow
    this._tubeMat = new THREE.MeshStandardMaterial({
      color:             0x44aaff,
      emissive:          new THREE.Color(0x00f3ff),
      emissiveIntensity: 0.5,
      metalness:         0.96,
      roughness:         0.04,
      envMapIntensity:   1.6,
    });

    // Build tube geometry once; position buffer updated in place each frame
    const initPts = this._pts.map(p => new THREE.Vector3(p.x, p.y, p.z));
    const initCurve = new THREE.CatmullRomCurve3(initPts);
    this._tubeGeo = new THREE.TubeGeometry(initCurve, N - 1, 0.007, 8, false);
    this._posAttr = this._tubeGeo.attributes.position;

    this._tube = new THREE.Mesh(this._tubeGeo, this._tubeMat);
    this._tube.visible = false;
    this._scene.add(this._tube);

    // Mid-point tension light (brightens with tension)
    this._midLight = new THREE.PointLight(0x00f3ff, 0, 3);
    this._scene.add(this._midLight);

    // Anchor point lights
    this._lightA = new THREE.PointLight(0xff00cc, 0, 1.2);
    this._lightB = new THREE.PointLight(0x00f3ff, 0, 1.2);
    this._scene.add(this._lightA);
    this._scene.add(this._lightB);

    this._tubeReady = true;
  }

  // ── Audio init ────────────────────────────────────────────────────────────
  _initAudio() {
    this._grainBuf = this._makeGrainBuffer();

    // Signal chain: grains → compressor → convolver (reverb) → gain → master
    this._compressor = this._ctx.createDynamicsCompressor();
    this._compressor.threshold.value = -18;
    this._compressor.knee.value      = 6;
    this._compressor.ratio.value     = 4;
    this._compressor.attack.value    = 0.003;
    this._compressor.release.value   = 0.15;

    this._convolver        = this._ctx.createConvolver();
    this._convolver.buffer = this._makeIR();

    this._gainNode       = this._ctx.createGain();
    this._gainNode.gain.value = 0.85;

    this._compressor.connect(this._convolver);
    this._convolver.connect(this._gainNode);
    this._gainNode.connect(this._master);
  }

  /** Metallic 65 ms grain buffer (stereo, micro-jittered). */
  _makeGrainBuffer() {
    const rate = this._ctx.sampleRate;
    const len  = Math.floor(rate * 0.065);
    const buf  = this._ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d      = buf.getChannelData(ch);
      const jitter = ch * 0.003;
      for (let i = 0; i < len; i++) {
        const t   = i / rate + jitter;
        const env = Math.exp(-t * 42);
        const sig = (
          Math.sin(Math.PI * 2 * 880  * t) * 0.38 +
          Math.sin(Math.PI * 2 * 1320 * t) * 0.28 +
          Math.sin(Math.PI * 2 * 2640 * t) * 0.14 +
          Math.sin(Math.PI * 2 * 440  * t) * 0.20
        ) * env;
        const noise = (Math.random() * 2 - 1) * Math.exp(-t * 90) * 0.25;
        d[i] = sig + noise;
      }
    }
    return buf;
  }

  /** Synthesised convolution reverb IR (2.8 s exponential decay). */
  _makeIR() {
    const rate = this._ctx.sampleRate;
    const len  = Math.floor(rate * 2.8);
    const buf  = this._ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
      }
    }
    return buf;
  }

  /** Spawn a single granular grain triggered by tension. */
  _spawnGrain(tension, now) {
    // Higher tension → denser grain clouds
    const density  = 0.3 + tension * 2.5 * (this._ctrl.tension ?? 0.5) * 2;
    const interval = 0.055 / density;
    if (now - this._lastGrainTime < interval) return;
    this._lastGrainTime = now;

    const src = this._ctx.createBufferSource();
    src.buffer              = this._grainBuf;
    src.playbackRate.value  = 0.7 + tension * 1.4 + (Math.random() - 0.5) * 0.35;
    src.detune.value        = (Math.random() - 0.5) * 280;

    const g = this._ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.55 + tension * 0.45, now + 0.003);

    src.connect(g);
    g.connect(this._compressor);
    src.start(now);
    src.onended = () => g.disconnect();
  }

  // ── Per-frame tube geometry update (in-place, no GC) ─────────────────────
  _updateTubeGeometry(tension, elapsed) {
    if (!this._tubeReady) return;

    const rippleAmp   = tension * 0.022;
    const rippleFreq  = 6;
    const rippleSpeed = elapsed * 5.5;

    // Build smooth CatmullRomCurve3 from Verlet points + ripple displacement
    const strDir = new THREE.Vector3(
      this._pts[N - 1].x - this._pts[0].x,
      this._pts[N - 1].y - this._pts[0].y,
      this._pts[N - 1].z - this._pts[0].z,
    ).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(strDir.dot(up)) > 0.9) up.set(1, 0, 0);
    const rippleDir = up.clone().cross(strDir).normalize();

    for (let i = 0; i < N; i++) {
      const t    = i / (N - 1);
      const wave = Math.sin(t * rippleFreq * Math.PI * 2 - rippleSpeed) * rippleAmp;
      this._curvePts[i].set(
        this._pts[i].x + rippleDir.x * wave,
        this._pts[i].y + rippleDir.y * wave,
        this._pts[i].z + rippleDir.z * wave,
      );
    }

    const curve  = new THREE.CatmullRomCurve3(this._curvePts);
    // Sample 129 evenly spaced points along the curve
    const path   = curve.getPoints(N);          // length N+1
    const frames = curve.computeFrenetFrames(N, false);

    const SEGS  = N;      // tube path segments
    const RADIAL = 8;     // tube radial segments
    const R     = 0.007;

    let vi = 0;
    for (let i = 0; i <= SEGS; i++) {
      const t       = i / SEGS;
      const waveR   = Math.sin(t * rippleFreq * Math.PI * 2 - rippleSpeed) * rippleAmp;
      const r       = R + Math.abs(waveR);
      const pt      = path[i];
      const fi      = Math.min(i, SEGS - 1);
      const Nv      = frames.normals[fi];
      const Bv      = frames.binormals[fi];

      for (let j = 0; j <= RADIAL; j++) {
        const theta = (j / RADIAL) * Math.PI * 2;
        const cos   = Math.cos(theta);
        const sin   = Math.sin(theta);
        this._posAttr.setXYZ(
          vi++,
          pt.x + r * (cos * Nv.x + sin * Bv.x),
          pt.y + r * (cos * Nv.y + sin * Bv.y),
          pt.z + r * (cos * Nv.z + sin * Bv.z),
        );
      }
    }
    this._posAttr.needsUpdate = true;
    this._tubeGeo.computeVertexNormals();
  }

  // ── Main update (called every frame from KineticRack) ────────────────────
  update(landmarks3D, dt, elapsed, allJoints) {
    if (!landmarks3D.length) {
      this._tube.visible        = false;
      this._midLight.intensity  = 0;
      this._lightA.intensity    = 0;
      this._lightB.intensity    = 0;
      this._hasPins             = false;
      return;
    }

    // Pin to thumb tip (4) and index tip (8) of the first visible hand
    const hand = landmarks3D[0];
    this._pinA.copy(hand[4]);
    this._pinB.copy(hand[8]);
    this._hasPins = true;

    // Fix endpoints
    this._pts[0]     = { x: this._pinA.x, y: this._pinA.y, z: this._pinA.z };
    this._pts[N - 1] = { x: this._pinB.x, y: this._pinB.y, z: this._pinB.z };

    // Physical tension from anchor distance
    const anchorDist = this._pinA.distanceTo(this._pinB);
    this._tension    = THREE.MathUtils.clamp(anchorDist / 0.75, 0, 1);

    // ── Verlet integration ────────────────────────────────────────────────
    const gravity  = 0.00008;
    const damping  = 0.985;
    for (let i = 1; i < N - 1; i++) {
      const p = this._pts[i], o = this._old[i];
      const vx = (p.x - o.x) * damping;
      const vy = (p.y - o.y) * damping;
      const vz = (p.z - o.z) * damping;
      o.x = p.x; o.y = p.y; o.z = p.z;
      p.x += vx;
      p.y += vy - gravity;
      p.z += vz;
    }

    // ── Distance constraints ──────────────────────────────────────────────
    const restLen = anchorDist / (N - 1);
    for (let iter = 0; iter < 12; iter++) {
      for (let i = 0; i < N - 1; i++) {
        const a = this._pts[i], b = this._pts[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const d  = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-5;
        const c  = (d - restLen) / d * 0.5;
        if (i !== 0)     { a.x += dx * c; a.y += dy * c; a.z += dz * c; }
        if (i !== N - 2) { b.x -= dx * c; b.y -= dy * c; b.z -= dz * c; }
      }
    }

    // ── Joint bounding-sphere collision ──────────────────────────────────
    if (allJoints?.length) {
      const R = 0.038;
      for (const jv of allJoints) {
        for (let i = 1; i < N - 1; i++) {
          const dx = this._pts[i].x - jv.x;
          const dy = this._pts[i].y - jv.y;
          const dz = this._pts[i].z - jv.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < R * R && d2 > 1e-6) {
            const inv = (R - Math.sqrt(d2)) / Math.sqrt(d2);
            this._pts[i].x += dx * inv * 0.55;
            this._pts[i].y += dy * inv * 0.55;
            this._pts[i].z += dz * inv * 0.55;
          }
        }
      }
    }

    // ── Visuals ───────────────────────────────────────────────────────────
    this._updateTubeGeometry(this._tension, elapsed);
    this._tube.visible = true;

    // Emissive colour shifts cyan→magenta under tension
    this._tubeMat.emissiveIntensity = 0.4 + this._tension * 3.2;
    this._tubeMat.emissive.setHSL(0.55 - this._tension * 0.18, 1.0, 0.5);
    this._tubeMat.color.setHSL(0.55 - this._tension * 0.12, 1.0, 0.65 + this._tension * 0.15);

    // Mid-point tension light
    const mid = this._pts[Math.floor(N / 2)];
    this._midLight.position.set(mid.x, mid.y, mid.z);
    this._midLight.intensity = 0.4 + this._tension * 12;
    this._midLight.distance  = 1.5  + this._tension * 2.5;
    this._midLight.color.setHSL(0.55 - this._tension * 0.2, 1, 0.5);

    // Anchor lights
    this._lightA.position.copy(this._pinA);
    this._lightA.intensity = 0.8 + this._tension * 4;
    this._lightB.position.copy(this._pinB);
    this._lightB.intensity = 0.8 + this._tension * 4;

    // ── Audio ─────────────────────────────────────────────────────────────
    if (this._ctx.state === 'running' && this._tension > 0.05) {
      this._spawnGrain(this._tension, this._ctx.currentTime);
    }
  }

  setCtrl(id, val) {
    // tension slider scales grain density; vol handled by KineticRack master
  }

  dispose() {
    this._tube.visible = false;
    this._scene.remove(this._tube, this._midLight, this._lightA, this._lightB);
    this._tubeGeo.dispose();
    this._tubeMat.dispose();
    try { this._gainNode.disconnect(); } catch {}
    try { this._convolver.disconnect(); } catch {}
    try { this._compressor.disconnect(); } catch {}
  }
}
