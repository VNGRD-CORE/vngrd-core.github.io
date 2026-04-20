/**
 * KineticRack.js — Self-contained hand-gesture → audio/visual instrument.
 *
 * Single import: THREE only. All audio via native Web Audio API.
 * No Tone.js. No AudioEngine.js. No SpatialSynth.js. No GestureLooper.js.
 * No NeuralComposer.js.
 */

// ── MAIN IIFE — keeps every class/const/function out of global scope.
// Without this wrapper, `class KineticRack {}` creates a lexical binding in the
// global Declarative Record that *shadows* window.KineticRack, so onclick
// handlers that use the bare identifier `KineticRack.toggle()` resolve to the
// CLASS (no static toggle) instead of the instance → TypeError.
(function () {
'use strict';

const THREE = window.THREE;
// ─────────────────────────────────────────────────────────────────────────────
//  GLSL Shaders
// ─────────────────────────────────────────────────────────────────────────────

const FFT_VERT = /* glsl */`
uniform sampler2D uFFTTexture;
uniform float     uTime;
uniform float     uKickImpulse;

attribute float aFreqBand;
attribute float aPhase;

varying float vFFTValue;
varying float vFreqBand;

void main() {
    float fftVal = texture2D(uFFTTexture, vec2(aFreqBand, 0.5)).r;
    vFFTValue    = fftVal;
    vFreqBand    = aFreqBand;

    vec3 pos = position;

    float disp = fftVal * 1.5;
    disp += uKickImpulse * 0.9 * (1.0 - aFreqBand);

    pos.z += sin(uTime * 0.3 + aPhase) * 0.05;
    pos *= 1.0 + disp;

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);

    float sz = 1.5 + fftVal * 6.0 + uKickImpulse * 5.0 * (1.0 - aFreqBand);
    gl_PointSize = clamp(sz, 0.5, 20.0);
    gl_Position  = projectionMatrix * mvPos;
}
`;

const FFT_FRAG = /* glsl */`
varying float vFFTValue;
varying float vFreqBand;
uniform float uKickImpulse;

void main() {
    vec2  uv   = gl_PointCoord - 0.5;
    float dist = length(uv);
    if (dist > 0.5) discard;

    float alpha = pow(1.0 - dist * 2.0, 2.0) * (0.4 + vFFTValue * 0.6);

    vec3 col = mix(vec3(0.0, 1.0, 1.0), vec3(1.0, 0.0, 1.0), vFreqBand);
    col = mix(col, vec3(1.0), uKickImpulse * 0.75);

    gl_FragColor = vec4(col * alpha * 1.8, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
//  FFTParticles — 8192 shader-driven GPU particles on a sphere
// ─────────────────────────────────────────────────────────────────────────────

const N_PARTICLES     = 8192;
const SUB_BASS_THRESH = 0.68;

class FFTParticles {
    constructor(scene) {
        this._scene       = scene;
        this._kickImpulse = 0;

        this._fftTexData = new Uint8Array(256 * 4);
        this._fftTex     = new THREE.DataTexture(
            this._fftTexData, 256, 1, THREE.RGBAFormat
        );
        this._fftTex.needsUpdate = true;

        this._build();
    }

    _build() {
        const positions = new Float32Array(N_PARTICLES * 3);
        const freqBands = new Float32Array(N_PARTICLES);
        const phases    = new Float32Array(N_PARTICLES);

        for (let i = 0; i < N_PARTICLES; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi   = Math.acos(2 * Math.random() - 1);
            const r     = 0.75 + Math.random() * 0.5;

            positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            positions[i * 3 + 2] = r * Math.cos(phi);

            freqBands[i] = i / N_PARTICLES;
            phases[i]    = Math.random() * Math.PI * 2;
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position',  new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('aFreqBand', new THREE.BufferAttribute(freqBands, 1));
        geo.setAttribute('aPhase',    new THREE.BufferAttribute(phases,    1));

        this._mat = new THREE.ShaderMaterial({
            vertexShader:   FFT_VERT,
            fragmentShader: FFT_FRAG,
            transparent:    true,
            depthWrite:     false,
            blending:       THREE.AdditiveBlending,
            uniforms: {
                uFFTTexture:  { value: this._fftTex },
                uTime:        { value: 0 },
                uKickImpulse: { value: 0 },
            },
        });

        this._points = new THREE.Points(geo, this._mat);
        this._points.renderOrder = 3;
        this._scene.add(this._points);
    }

    update(fftData, elapsed, dt) {
        for (let i = 0; i < 256; i++) {
            const v = Math.floor(fftData[i] * 255);
            this._fftTexData[i * 4]     = v;
            this._fftTexData[i * 4 + 1] = 0;
            this._fftTexData[i * 4 + 2] = 0;
            this._fftTexData[i * 4 + 3] = 255;
        }
        this._fftTex.needsUpdate = true;

        const subBass = (fftData[0] + fftData[1] + fftData[2]) / 3;
        if (subBass > SUB_BASS_THRESH) {
            this._kickImpulse = Math.max(this._kickImpulse, subBass);
        }
        this._kickImpulse = Math.max(0, this._kickImpulse - dt * 3.5);

        this._mat.uniforms.uTime.value        = elapsed;
        this._mat.uniforms.uKickImpulse.value = this._kickImpulse;
    }

    triggerKickFlash() {
        this._kickImpulse = 1.0;
    }

    dispose() {
        this._scene.remove(this._points);
        this._points.geometry.dispose();
        this._mat.dispose();
        this._fftTex.dispose();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  AudioCore — native Web Audio API
// ─────────────────────────────────────────────────────────────────────────────

class AudioCore {
    constructor() {
        this.ctx         = null;
        this._analyser   = null;
        this._masterGain = null;
        this._fftBuf     = null;
        this._oscs       = [];           // upper-octave detuned saws (body)
        this._oscGains   = [];
        this._sub        = null;         // sub-octave sine (weight)
        this._subGain    = null;
        this._noise      = null;         // brown-noise atmosphere bed
        this._noiseGain  = null;
        this._filter     = null;
        this._voiceGain  = null;         // voice-level gate (fades on hand lose)
        this._lfo        = null;
        this._lfoGain    = null;
    }

    async start() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') await this.ctx.resume();

        const ctx = this.ctx;

        // Master chain: masterGain → compressor → lowShelf boost → SAFETY
        // lowpass → analyser → destination. The safety lowpass at 900 Hz is
        // non-negotiable — no matter what the XY pad does, nothing above the
        // low-mid band ever reaches the speakers. Ears-first design.
        this._masterGain = ctx.createGain();
        this._masterGain.gain.value = 0.55;

        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -12;
        compressor.knee.value      = 6;
        compressor.ratio.value     = 10;
        compressor.attack.value    = 0.004;
        compressor.release.value   = 0.18;

        // Brick-wall limiter — catches transients from pluck/arp so the
        // lifted 3.5 kHz ceiling is safe.
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -3;
        limiter.knee.value      = 0;
        limiter.ratio.value     = 20;
        limiter.attack.value    = 0.001;
        limiter.release.value   = 0.08;

        // Safety ceiling lifted 900 → 3500 Hz so the synth can actually
        // sound bright / percussive. Still cut above 3.5 kHz so piercing
        // high harmonics can never reach the speakers.
        this._safetyLP = ctx.createBiquadFilter();
        this._safetyLP.type            = 'lowpass';
        this._safetyLP.frequency.value = 3500;
        this._safetyLP.Q.value         = 0.707;

        this._analyser = ctx.createAnalyser();
        this._analyser.fftSize             = 512;
        this._analyser.smoothingTimeConstant = 0.8;

        this._masterGain.connect(compressor);
        compressor.connect(limiter);
        limiter.connect(this._safetyLP);
        this._safetyLP.connect(this._analyser);
        this._analyser.connect(ctx.destination);

        this._fftBuf = new Float32Array(this._analyser.frequencyBinCount); // 256

        // Gentle sweep lowpass (no resonance) — the XY pad's Y axis drives
        // this within a narrow bass-only range. Q≤0.9 keeps it warm, not
        // whistle-y.
        this._filter = ctx.createBiquadFilter();
        this._filter.type            = 'lowpass';
        this._filter.frequency.value = 300;
        this._filter.Q.value         = 0.7;

        // Voice gate — smooth fade-in/out when hand enters/leaves frame.
        this._voiceGain = ctx.createGain();
        this._voiceGain.gain.value = 0;

        this._filter.connect(this._voiceGain);
        this._voiceGain.connect(this._masterGain);

        // ── Soft-clip waveshaper adds odd-harmonic grit to the body oscs
        //    so the bass has chest-thump weight even when the fundamental
        //    is below what most laptop speakers can reproduce.
        const shaper = ctx.createWaveShaper();
        const _curveN = 2048;
        const _curve  = new Float32Array(_curveN);
        for (let i = 0; i < _curveN; i++) {
            const x = (i * 2) / _curveN - 1;
            _curve[i] = Math.tanh(x * 2.4) / Math.tanh(2.4);
        }
        shaper.curve      = _curve;
        shaper.oversample = '4x';
        shaper.connect(this._filter);

        // ── Body: 2 triangles (-9 / +9 cents) at 70 Hz — true bass register,
        //         a full octave below the old 110 Hz. Soft-clip adds warmth.
        const detunes = [-9, 9];
        for (let i = 0; i < detunes.length; i++) {
            const osc = ctx.createOscillator();
            osc.type            = 'triangle';
            osc.frequency.value = 70;
            osc.detune.value    = detunes[i];

            const g = ctx.createGain();
            g.gain.value = 0.34;

            osc.connect(g);
            g.connect(shaper);
            osc.start();

            this._oscs.push(osc);
            this._oscGains.push(g);
        }

        // ── Sub: pure sine one octave below body — the main bassline tone. ───
        this._sub = ctx.createOscillator();
        this._sub.type            = 'sine';
        this._sub.frequency.value = 35;

        this._subGain = ctx.createGain();
        this._subGain.gain.value = 1.15;

        this._sub.connect(this._subGain);
        this._subGain.connect(this._filter);
        this._sub.start();

        // ── Pluck voice — percussive ADSR-shaped sawtooth for arp + pinch
        //    triggers. Uses a dedicated gain env so the drone keeps running
        //    underneath while notes punch through on top.
        this._pluck = ctx.createOscillator();
        this._pluck.type            = 'sawtooth';
        this._pluck.frequency.value = 55;
        this._pluckGain = ctx.createGain();
        this._pluckGain.gain.value  = 0;
        this._pluck.connect(this._pluckGain);
        this._pluckGain.connect(shaper);
        this._pluck.start();

        // ── FM modulator — silent by default. Pinch gesture opens _modGain
        //    to inject growly sidebands into the body carriers (dubstep-style
        //    wob when fully pinched). Modulator tracks 2× carrier for that
        //    classic metallic-reese character; kept under the safety LP.
        this._modulator = ctx.createOscillator();
        this._modulator.type            = 'sine';
        this._modulator.frequency.value = 140;
        this._modGain = ctx.createGain();
        this._modGain.gain.value = 0;
        this._modulator.connect(this._modGain);
        for (const osc of this._oscs) {
            this._modGain.connect(osc.frequency);
        }
        this._modulator.start();

        // ── LFO — silent by default. Finger-spread opens _lfoGain to wobble
        //    the filter cutoff (dub-bass wub). Rate 0.2–12 Hz.
        this._lfo = ctx.createOscillator();
        this._lfo.type            = 'sine';
        this._lfo.frequency.value = 2.0;
        this._lfoGain = ctx.createGain();
        this._lfoGain.gain.value = 0;
        this._lfo.connect(this._lfoGain);
        this._lfoGain.connect(this._filter.frequency);
        this._lfo.start();

        // Atmosphere noise bed removed — was feeding the filter resonance
        // and adding painful high-frequency hiss.
    }

    getFFT() {
        if (!this._analyser) {
            if (!this._normBuf) this._normBuf = new Float32Array(256);
            return this._normBuf;
        }
        this._analyser.getFloatFrequencyData(this._fftBuf);
        if (!this._normBuf) this._normBuf = new Float32Array(256);
        for (let i = 0; i < 256; i++) {
            this._normBuf[i] = Math.max(0, Math.min(1, (this._fftBuf[i] + 100) / 100));
        }
        return this._normBuf;
    }

    setPitch(hz) {
        if (!this.ctx) return;
        // Hard sub-bass clamp — defense-in-depth so stray callers can't
        // ever push the body oscs into piercing register.
        const clamped = Math.max(28, Math.min(240, hz));
        const t = this.ctx.currentTime;
        // Slight portamento so XY sweeps feel musical, not stepped.
        for (const osc of this._oscs) {
            osc.frequency.setTargetAtTime(clamped, t, 0.04);
        }
        if (this._sub) this._sub.frequency.setTargetAtTime(clamped * 0.5, t, 0.04);
        // Keep FM modulator at 2× carrier so growl tracks pitch.
        if (this._modulator) {
            this._modulator.frequency.setTargetAtTime(clamped * 2.0, t, 0.04);
        }
    }

    setFilter(hz) {
        if (!this._filter) return;
        const clamped = Math.max(60, Math.min(4500, hz));
        this._filter.frequency.setTargetAtTime(clamped, this.ctx.currentTime, 0.03);
    }

    /** Minor-pentatonic scale quantiser — v in 0..1 → one of 10 notes
     *  across two octaves rooted at A1 (55 Hz). Every hand position lands
     *  on an in-key note so the arp / pluck triggers always sound musical. */
    _scaleFreq(v01) {
        const SEMIS = [0, 3, 5, 7, 10]; // A minor pentatonic
        const idx   = Math.max(0, Math.min(9, Math.floor(v01 * 10)));
        const oct   = Math.floor(idx / 5);
        const deg   = idx % 5;
        return 55 * Math.pow(2, (SEMIS[deg] + oct * 12) / 12);
    }

    /** Trigger a percussive note on the pluck voice. vel 0..1. */
    noteOn(freq, vel = 0.7) {
        if (!this._pluck || !this.ctx) return;
        const t = this.ctx.currentTime;
        this._pluck.frequency.setValueAtTime(freq, t);
        const g = this._pluckGain.gain;
        g.cancelScheduledValues(t);
        g.setValueAtTime(g.value, t);
        g.linearRampToValueAtTime(Math.min(0.45, vel * 0.55), t + 0.005);
        g.exponentialRampToValueAtTime(0.001, t + 0.32);
    }

    /** Macro (0..1) — opens filter + adds grit + thickens sub in one
     *  choreographed move. Driven by hand proximity to camera. */
    setMacro(v01) {
        if (!this.ctx) return;
        const v = Math.max(0, Math.min(1, v01));
        const t = this.ctx.currentTime;
        // Filter rides 180 → 2600 Hz (brighter) as macro opens
        this._filter.frequency.setTargetAtTime(180 + v * 2420, t, 0.05);
        // Sub gets heavier
        if (this._subGain) this._subGain.gain.setTargetAtTime(0.8 + v * 0.9, t, 0.05);
        // Body oscs grow slightly
        for (const g of this._oscGains) {
            g.gain.setTargetAtTime(0.22 + v * 0.22, t, 0.05);
        }
    }

    setVolume(v) {
        if (!this._voiceGain) return;
        // Route "vol" to the voice gate, not the master — master stays hot so
        // the compressor keeps its curve. 80 ms gate = musical fade in/out.
        this._voiceGain.gain.setTargetAtTime(
            Math.max(0, Math.min(1, v)),
            this.ctx.currentTime,
            0.08
        );
    }

    setSpatialGate(v) {
        if (!this._voiceGain || !this.ctx) return;
        this._voiceGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.08);
    }

    /** FM depth: 0..2500 Hz into each carrier frequency (pinch → growl). */
    setFM(depthHz) {
        if (!this._modGain || !this.ctx) return;
        const clamped = Math.max(0, Math.min(2500, depthHz));
        this._modGain.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.04);
    }

    /** LFO rate: 0.1..14 Hz wobble on the filter cutoff. */
    setLFORate(hz) {
        if (!this._lfo || !this.ctx) return;
        this._lfo.frequency.setTargetAtTime(
            Math.max(0.1, Math.min(14, hz)), this.ctx.currentTime, 0.08
        );
    }

    /** LFO depth in Hz — how far the filter wobbles around its base cutoff. */
    setLFODepth(hz) {
        if (!this._lfoGain || !this.ctx) return;
        const clamped = Math.max(0, Math.min(500, hz));
        this._lfoGain.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.06);
    }

    triggerKick() {
        if (!this.ctx) return;
        const ctx = this.ctx;
        const t   = ctx.currentTime;

        // Sine osc with pitch envelope 100→30 Hz over 0.5s
        const osc  = ctx.createOscillator();
        osc.type   = 'sine';
        osc.frequency.setValueAtTime(100, t);
        osc.frequency.exponentialRampToValueAtTime(30, t + 0.5);

        // Soft-clip waveshaper (distortion)
        const ws        = ctx.createWaveShaper();
        ws.curve        = _makeSoftClipCurve(256);
        ws.oversample   = '2x';

        const env = ctx.createGain();
        env.gain.setValueAtTime(1.2, t);
        env.gain.exponentialRampToValueAtTime(0.001, t + 0.5);

        osc.connect(ws);
        ws.connect(env);
        env.connect(this._masterGain);

        osc.start(t);
        osc.stop(t + 0.52);
    }

    createLoopNode() {
        if (!this.ctx) return null;
        const ctx = this.ctx;

        // Delay + allpass reverb approximation
        const loopBus = ctx.createGain();
        loopBus.gain.value = 1.0;

        const delay = ctx.createDelay(1.0);
        delay.delayTime.value = 0.25;

        const feedback = ctx.createGain();
        feedback.gain.value = 0.35;

        const allpass = ctx.createBiquadFilter();
        allpass.type            = 'allpass';
        allpass.frequency.value = 700;

        loopBus.connect(delay);
        delay.connect(feedback);
        feedback.connect(allpass);
        allpass.connect(delay);

        loopBus.connect(this._masterGain);
        delay.connect(this._masterGain);

        return loopBus;
    }

    dispose() {
        try {
            for (const osc of this._oscs) {
                osc.stop();
                osc.disconnect();
            }
        } catch (_) {}
        try { this._modulator?.stop(); this._modulator?.disconnect(); } catch (_) {}
        try { this._modGain?.disconnect(); } catch (_) {}
        try { this._lfo?.stop(); this._lfo?.disconnect(); } catch (_) {}
        try { this._lfoGain?.disconnect(); } catch (_) {}
        try { this.ctx?.close(); } catch (_) {}
        this.ctx         = null;
        this._analyser   = null;
        this._masterGain = null;
        this._oscs       = [];
        this._modulator  = null;
        this._modGain    = null;
        this._lfo        = null;
        this._lfoGain    = null;
    }
}

function _makeSoftClipCurve(n) {
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const x = (2 * i) / (n - 1) - 1;
        curve[i] = (Math.PI + 100) * x / (Math.PI + 100 * Math.abs(x));
    }
    return curve;
}

// ─────────────────────────────────────────────────────────────────────────────
//  HandMesh — THREE.LineSegments wireframe of 21 hand landmarks
// ─────────────────────────────────────────────────────────────────────────────

const HAND_CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [0,9],[9,10],[10,11],[11,12],
    [0,13],[13,14],[14,15],[15,16],
    [0,17],[17,18],[18,19],[19,20],
    [5,9],[9,13],[13,17],
];
const N_CONNECTIONS = HAND_CONNECTIONS.length; // 23

class HandMesh {
    constructor(scene, color = 0x00f3ff) {
        this._scene = scene;

        const positions = new Float32Array(N_CONNECTIONS * 2 * 3);
        const geo       = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const mat = new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity:     0.85,
            depthWrite:  false,
        });

        this._mesh = new THREE.LineSegments(geo, mat);
        this._mesh.renderOrder = 4;
        this._mesh.visible     = false;
        scene.add(this._mesh);
    }

    update(landmarks) {
        if (!landmarks) {
            this._mesh.visible = false;
            return;
        }
        this._mesh.visible = true;

        const pos = this._mesh.geometry.attributes.position;
        for (let i = 0; i < N_CONNECTIONS; i++) {
            const [a, b] = HAND_CONNECTIONS[i];
            const la     = landmarks[a];
            const lb     = landmarks[b];

            const base = i * 6;
            pos.array[base]     = (la.x - 0.5) * 4;
            pos.array[base + 1] = -(la.y - 0.5) * 3;
            pos.array[base + 2] = -la.z * 1.5;

            pos.array[base + 3] = (lb.x - 0.5) * 4;
            pos.array[base + 4] = -(lb.y - 0.5) * 3;
            pos.array[base + 5] = -lb.z * 1.5;
        }
        pos.needsUpdate = true;
    }

    dispose() {
        this._scene.remove(this._mesh);
        this._mesh.geometry.dispose();
        this._mesh.material.dispose();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  GestureLooper — records right-hand pinch trajectories as audio loops
// ─────────────────────────────────────────────────────────────────────────────

const LOOP_PALETTE = [
    0x00f3ff, 0xff00cc, 0x00ff88, 0xff8800,
    0xb000ff, 0xffff00, 0xff3344, 0x88aaff,
];

class GestureLooper {
    constructor(scene, loopBus, audioCtx) {
        this._scene    = scene;
        this._loopBus  = loopBus;
        this._ctx      = audioCtx;
        this._loops    = [];
        this._recording = false;
        this._recTrack  = [];
        this._recStart  = 0;
        this._wasPinched = false;
        this._pinchStartT = 0;
    }

    /** @param {Array|null} rightLandmarks */
    update(rightLandmarks) {
        if (!rightLandmarks || !this._ctx) return;

        const lm4 = rightLandmarks[4]; // thumb tip
        const lm8 = rightLandmarks[8]; // index tip
        const dx  = lm4.x - lm8.x;
        const dy  = lm4.y - lm8.y;
        const pinchDist = Math.sqrt(dx * dx + dy * dy);
        const pinched   = pinchDist < 0.05;
        const now       = performance.now();

        if (pinched && !this._wasPinched) {
            // Pinch start
            this._recording  = true;
            this._recTrack   = [];
            this._recStart   = now;
            this._pinchStartT = now;
        }

        if (this._recording && pinched) {
            this._recTrack.push({ x: lm8.x, y: lm8.y, t: now });
        }

        if (!pinched && this._wasPinched && this._recording) {
            const duration = now - this._pinchStartT;
            if (duration > 200 && this._recTrack.length > 1) {
                this._finalizeLoop(this._recTrack, duration, now);
            }
            this._recording = false;
            this._recTrack  = [];
        }

        this._wasPinched = pinched;

        // Playback all active loops
        this._tickLoops(now);
    }

    _finalizeLoop(track, duration, now) {
        if (!this._loopBus || !this._ctx) return;

        const color = LOOP_PALETTE[this._loops.length % LOOP_PALETTE.length];

        // Synth: carrier FM synth
        const carrier  = this._ctx.createOscillator();
        carrier.type   = 'sine';
        const modulator = this._ctx.createOscillator();
        modulator.type  = 'sine';
        modulator.frequency.value = 110;

        const modGain  = this._ctx.createGain();
        modGain.gain.value = 110;

        const ampGain  = this._ctx.createGain();
        ampGain.gain.value = 0.35;

        modulator.connect(modGain);
        modGain.connect(carrier.frequency);
        carrier.connect(ampGain);
        ampGain.connect(this._loopBus);

        carrier.start();
        modulator.start();

        // THREE.Line trail
        const pts = track.map(p => new THREE.Vector3(
            (p.x - 0.5) * 4,
            -(p.y - 0.5) * 3,
            0
        ));
        const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
        const lineMat = new THREE.LineBasicMaterial({
            color, transparent: true, opacity: 0.6, depthWrite: false,
        });
        const line = new THREE.Line(lineGeo, lineMat);
        this._scene.add(line);

        // Playhead sphere
        const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(0.04, 8, 8),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 })
        );
        this._scene.add(sphere);

        this._loops.push({
            track,
            duration,
            startT: now,
            synth: { carrier, modulator, modGain, ampGain },
            line,
            sphere,
            color,
        });
    }

    _tickLoops(now) {
        for (const loop of this._loops) {
            const phase = (now - loop.startT) % loop.duration;
            const pt    = _interpTrack(loop.track, loop.duration, phase);
            if (!pt) continue;

            const freq        = 55 * Math.pow(16, 1 - pt.y);       // 55–880 Hz
            const harmonicity = 0.5 + pt.x * 7.5;
            const modFreq     = freq * harmonicity;

            loop.synth.carrier.frequency.setTargetAtTime(freq, this._ctx.currentTime, 0.02);
            loop.synth.modulator.frequency.setTargetAtTime(modFreq, this._ctx.currentTime, 0.02);
            loop.synth.modGain.gain.setTargetAtTime(freq * harmonicity, this._ctx.currentTime, 0.02);

            loop.sphere.position.set(
                (pt.x - 0.5) * 4,
                -(pt.y - 0.5) * 3,
                0
            );
        }
    }

    clearAll() {
        for (const loop of this._loops) {
            try {
                loop.synth.carrier.stop();
                loop.synth.modulator.stop();
            } catch (_) {}
            try {
                loop.synth.carrier.disconnect();
                loop.synth.modulator.disconnect();
                loop.synth.modGain.disconnect();
                loop.synth.ampGain.disconnect();
            } catch (_) {}
            this._scene.remove(loop.line);
            this._scene.remove(loop.sphere);
            loop.line.geometry.dispose();
            loop.line.material.dispose();
            loop.sphere.geometry.dispose();
            loop.sphere.material.dispose();
        }
        this._loops = [];
    }
}

function _interpTrack(track, duration, phase) {
    if (!track.length) return null;

    const t0   = track[0].t;
    const absT = t0 + phase;

    // Binary search
    let lo = 0, hi = track.length - 1;
    while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (track[mid].t <= absT) lo = mid;
        else hi = mid;
    }

    const a  = track[lo];
    const b  = track[Math.min(lo + 1, track.length - 1)];
    if (a === b) return a;

    const span = b.t - a.t;
    const frac = span > 0 ? (absT - a.t) / span : 0;

    return {
        x: a.x + (b.x - a.x) * frac,
        y: a.y + (b.y - a.y) * frac,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
//  KineticRack — main controller
// ─────────────────────────────────────────────────────────────────────────────

const LERP_FACTOR    = 0.12;
const PINCH_THRESH   = 0.05;
const PINCH_COOLDOWN = 0.35; // seconds

class KineticRack {
    constructor() {
        this._audio     = new AudioCore();
        this._renderer  = null;
        this._scene     = null;
        this._camera    = null;
        this._particles = null;
        this._handLM    = null;
        this._handMeshR = null;
        this._handMeshL = null;
        this._looper    = null;
        this._useWebGPU = false;

        // Worker-based MediaPipe isolation
        this._mpWorker        = null;       // Web Worker running hand detection
        this._mpWorkerReady   = false;
        this._mpPending       = false;      // frame in-flight guard (60 FPS lock)
        this._mpFrameCanvas   = null;       // OffscreenCanvas for frame capture
        this._mpFrameCtx      = null;       // 2D context on the frame canvas
        // Latest landmark data unpacked from worker Transferables
        this._latestRightLm   = null;
        this._latestLeftLm    = null;

        this._active      = false;
        this._initialized = false;
        this._rafId       = null;
        this._elapsed     = 0;
        this._lastNow     = 0;

        // Smoothed gesture values
        this._s = {
            rightX: 0.5, rightY: 0.5,
            leftX:  0.5, leftY:  0.5,
            leftPinchDist: 1.0,
        };
        this._leftPinchCooldown = 0;
        this._leftWasPinched    = false;

        this._onResize = this._onResize.bind(this);
    }

    // ── Status helper ─────────────────────────────────────────────────────────

    _setStatus(msg, live = false) {
        const el = document.getElementById('kr-status');
        if (!el) return;
        el.textContent = msg;
        el.classList.toggle('kr-live', live);
    }

    // ── Initialization ────────────────────────────────────────────────────────

    async init() {
        this._setStatus('STARTING...');

        // Phase 1 — Three.js renderer: prefer WebGPU, fall back to WebGL
        const canvas = document.getElementById('kinetic-canvas');
        if (!canvas) throw new Error('Missing #kinetic-canvas');

        let rendererCreated = false;

        // Attempt WebGPU renderer (Three.js r163+)
        if (navigator.gpu) {
            try {
                const { WebGPURenderer } = await import('three/addons/renderers/WebGPURenderer.js');
                this._renderer = new WebGPURenderer({ canvas, antialias: false, alpha: true });
                await this._renderer.init();
                this._renderer.setClearColor(0x000000, 0);
                this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
                this._renderer.setSize(window.innerWidth, window.innerHeight);
                this._useWebGPU = true;
                rendererCreated = true;
                console.log('[KineticRack] Phase 1: WebGPU renderer active');
            } catch (e) {
                console.warn('[KineticRack] WebGPU unavailable, falling back to WebGL:', e.message);
            }
        }

        if (!rendererCreated) {
            this._renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
            this._renderer.setClearColor(0x000000, 0);
            this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            this._renderer.setSize(window.innerWidth, window.innerHeight);
            this._useWebGPU = false;
            console.log('[KineticRack] Phase 1: WebGL renderer active');
        }

        this._scene  = new THREE.Scene();
        this._camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 100);
        this._camera.position.set(0, 0, 3.2);

        canvas.classList.add('kr-online');
        document.getElementById('kr-skeleton-canvas')?.classList.add('kr-online');
        document.getElementById('kr-rack')?.classList.add('kr-online');
        document.getElementById('kr-launch-btn')?.classList.add('kr-online');

        // Phase 2 — particles (start loop immediately so sphere spins)
        try {
            this._particles = new FFTParticles(this._scene);
        } catch (e) {
            console.warn('[KineticRack] FFTParticles failed:', e);
        }

        this._active  = true;
        this._lastNow = performance.now();
        this._loop();
        this._setStatus('RENDERER OK');
        console.log('[KineticRack] Phase 2: particles + loop started');

        // Phase 3 — camera (non-fatal)
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 1280, height: 720, facingMode: 'user' },
                audio: false,
            });
            const camVid = document.getElementById('kinetic-cam-video');
            const aiVid  = document.getElementById('kr-ai-video');
            if (camVid) {
                camVid.srcObject = stream;
                camVid.classList.add('kr-online');
                await camVid.play().catch(() => {});
            }
            if (aiVid) {
                aiVid.srcObject = stream;
                await aiVid.play().catch(() => {});
            }
            this._setStatus('CAM OK');
            console.log('[KineticRack] Phase 3: camera active');

            // Kick the main-thread MediaPipe Hands tracker now that the video
            // element has a live stream. Safe to call repeatedly — idempotent.
            if (typeof window._startHandTracker === 'function') {
                try { window._startHandTracker(); } catch (e) {
                    console.warn('[KineticRack] _startHandTracker threw:', e);
                }
            }
        } catch (e) {
            console.warn('[KineticRack] Camera unavailable:', e);
            this._setStatus('NO CAM: ' + (e && e.name || 'ERR'));
        }

        // Phase 4 — audio (non-fatal)
        try {
            await this._audio.start();
            this._setStatus('AUDIO OK');
            this._startArp(120); // 16th-note arp at 120 BPM, gated by _handPresent
            console.log('[KineticRack] Phase 4: audio + arp started (gated by hand presence)');
        } catch (e) {
            console.warn('[KineticRack] AudioCore failed:', e);
        }

        // Phase 5 — GestureLooper + HandMesh REMOVED.
        // The X/Y synth is driven by _handTrackFeed in index.html which draws a
        // clean 21-point skeleton HUD on #kr-skeleton-canvas. The old 3D line
        // meshes and pinch-to-loop playhead spheres are intentionally gone.

        // Phase 6 — MediaPipe. The main-thread CDN tracker in
        // src/hand-tracker.js is the single source of truth for landmarks;
        // it writes window._latestHandsLm which _detectHands reads each
        // frame. The old Web Worker path ran a SECOND MediaPipe instance
        // and did a getImageData() per frame — that was tanking render
        // FPS to single digits. It's gone; keep only the lean CDN path.
        this._mpWorkerReady = false;

        window.addEventListener('resize', this._onResize);
        this._initialized = true;

        document.getElementById('kr-stage-hud')?.classList.add('kr-live');
        this._setStatus('HAND SYNTH // LIVE', true);
        console.log('[KineticRack] All phases complete — LIVE');
    }

    async _initHandLandmarker() {
        // Spawn isolated MediaPipe Web Worker — returns landmark data via
        // Transferable ArrayBuffers at a locked 60 FPS cadence.
        try {
            this._mpWorker = new Worker('./src/mediapipe-worker.js', { type: 'module' });

            this._mpWorker.onmessage = (e) => {
                const { type, data, handedness, count } = e.data;

                if (type === 'READY') {
                    this._mpWorkerReady = true;
                    console.log('[KineticRack] MediaPipe worker ready');
                    return;
                }

                if (type === 'ERROR') {
                    console.warn('[KineticRack] MediaPipe worker error:', e.data.message);
                    return;
                }

                if (type === 'LANDMARKS') {
                    this._mpPending = false; // allow next frame dispatch

                    // Unpack Transferable Float32Array (21 landmarks × 3 floats per hand)
                    const lmBuf  = new Float32Array(data);
                    const hdBuf  = new Uint8Array(handedness);
                    const LM_F   = 21 * 3; // floats per hand

                    this._latestRightLm = null;
                    this._latestLeftLm  = null;

                    for (let h = 0; h < Math.min(count, 2); h++) {
                        const label = hdBuf[h]; // 1=Left, 2=Right
                        const base  = h * LM_F;
                        const lms   = [];
                        for (let i = 0; i < 21; i++) {
                            lms.push({
                                x: lmBuf[base + i * 3],
                                y: lmBuf[base + i * 3 + 1],
                                z: lmBuf[base + i * 3 + 2],
                            });
                        }
                        if (label === 2) this._latestRightLm = lms;
                        if (label === 1) this._latestLeftLm  = lms;
                    }
                }
            };

            this._mpWorker.onerror = (e) => {
                console.warn('[KineticRack] MediaPipe worker error event:', e.message);
            };

            // Build a reusable canvas for frame pixel capture
            this._mpFrameCanvas = document.createElement('canvas');
            this._mpFrameCanvas.width  = 320;
            this._mpFrameCanvas.height = 180;
            this._mpFrameCtx = this._mpFrameCanvas.getContext('2d', { willReadFrequently: true });

            // Boot the worker
            this._mpWorker.postMessage({ type: 'INIT' });

        } catch (e) {
            console.warn('[KineticRack] MediaPipe worker failed to start:', e);
        }
    }

    // ── Main loop ─────────────────────────────────────────────────────────────

    _loop() {
        if (!this._active) return;
        this._rafId = requestAnimationFrame(() => this._loop());

        const now     = performance.now();
        const dt      = Math.min((now - this._lastNow) / 1000, 0.1);
        this._lastNow = now;
        this._elapsed += dt;

        this._leftPinchCooldown = Math.max(0, this._leftPinchCooldown - dt);

        this._detectHands();

        const fft = this._audio.getFFT();
        this._particles?.update(fft, this._elapsed, dt);

        this._renderer?.render(this._scene, this._camera);
    }

    // ── Hand detection ────────────────────────────────────────────────────────

    _detectHands() {
        // Landmarks come from the CDN main-thread tracker (hand-tracker.js)
        // which writes window._latestHandsLm after every MediaPipe detection.
        // No per-frame getImageData / worker postMessage here — that was the
        // FPS killer.
        const cdnFeed = window._latestHandsLm || null;
        const rightLm = cdnFeed ? cdnFeed.right : null;
        const leftLm  = cdnFeed ? cdnFeed.left  : null;

        // _handTrackFeed handles audio (pitch/filter/FM/LFO) and the
        // velocity-extrapolated skeleton HUD — single source of truth.
        if (typeof window._handTrackFeed === 'function') {
            try { window._handTrackFeed(rightLm || null, leftLm || null); }
            catch (e) { /* never let UI feed kill the render loop */ }
        }

        if (rightLm) {
            const lm8 = rightLm[8];
            this._s.rightX += (lm8.x - this._s.rightX) * LERP_FACTOR;
            this._s.rightY += (lm8.y - this._s.rightY) * LERP_FACTOR;
            this._audio.setSpatialGate(0.4);
        } else {
            this._audio.setSpatialGate(0);
        }
    }

    // ── Toggle ────────────────────────────────────────────────────────────────

    async toggle() {
        if (this._active) {
            // Stop
            this._active = false;
            this._stopArp();
            if (this._rafId) cancelAnimationFrame(this._rafId);
            if (this._mpWorker) { this._mpWorker.terminate(); this._mpWorker = null; this._mpWorkerReady = false; }
            document.getElementById('kinetic-canvas')?.classList.remove('kr-online');
            document.getElementById('kinetic-cam-video')?.classList.remove('kr-online');
            document.getElementById('kr-skeleton-canvas')?.classList.remove('kr-online');
            document.getElementById('kr-launch-btn')?.classList.remove('kr-online');
            document.getElementById('kr-rack')?.classList.remove('kr-online');
            document.getElementById('kr-stage-hud')?.classList.remove('kr-live');
            this._setStatus('OFFLINE');
        } else if (!this._initialized) {
            // First launch
            try {
                await this.init();
            } catch (e) {
                console.error('[KineticRack] init failed:', e);
                this._setStatus('ERROR: ' + (e?.message ?? e));
                document.getElementById('kr-launch-btn')?.classList.remove('kr-online');
            }
        } else {
            // Resume
            this._active  = true;
            this._lastNow = performance.now();
            this._loop();
            document.getElementById('kinetic-canvas')?.classList.add('kr-online');
            document.getElementById('kr-skeleton-canvas')?.classList.add('kr-online');
            document.getElementById('kr-launch-btn')?.classList.add('kr-online');
            document.getElementById('kr-stage-hud')?.classList.add('kr-live');
            this._setStatus('HAND SYNTH // LIVE', true);
        }
    }

    // ── Arpeggiator — BPM-locked 16th-note pluck voice ───────────────────────
    //  Hand X picks a pivot into the scale; the arp walks forward from there
    //  so static hand positions still make moving patterns. Hand presence
    //  gates it: no hand = no notes.

    _startArp(bpm = 120) {
        if (this._arpId) return;
        const stepMs = (60 / bpm) / 4 * 1000; // 16th note
        this._arpStep = 0;
        this._arpId   = setInterval(() => this._arpTick(), stepMs);
    }

    _stopArp() {
        if (this._arpId) { clearInterval(this._arpId); this._arpId = null; }
        this._audio?.noteOn(0, 0); // flush env
    }

    _arpTick() {
        if (!this._active || !this._handPresent) return;
        const pv   = this._lastPitchV ?? 0.5;
        const mac  = this._lastMacro  ?? 0.3;
        // Step pattern: 0,2,1,3,0,4,2,5 — hops that feel melodic even when
        // the pivot (hand X) is stationary.
        const HOPS = [0, 2, 1, 3, 0, 4, 2, 5];
        const pivotIdx = Math.floor(pv * 10);
        const idx      = (pivotIdx + HOPS[this._arpStep % HOPS.length]) % 10;
        const SEMIS    = [0, 3, 5, 7, 10];
        const oct      = Math.floor(idx / 5);
        const deg      = idx % 5;
        const freq     = 55 * Math.pow(2, (SEMIS[deg] + oct * 12) / 12);
        const vel      = 0.35 + mac * 0.5;
        this._audio.noteOn(freq, vel);
        this._arpStep  = (this._arpStep + 1) % 16;
    }

    /** Pinch rising-edge trigger — fires a scale-quantised pluck at current X. */
    triggerPluck(xV01, vel = 0.8) {
        if (!this._audio) return;
        const freq = this._audio._scaleFreq(xV01);
        this._audio.noteOn(freq, vel);
    }

    // ── Public API ────────────────────────────────────────────────────────────

    get active() { return this._active; }

    ctrlChange(key, val) {
        const v = parseFloat(val);
        // Master volume capped at 0.55 — headroom for the pluck voice under
        // the brick-wall limiter.
        if (key === 'vol')    {
            this._audio.setVolume(Math.min(v, 0.55));
            this._handPresent = v > 0.01;
            return;
        }
        if (key === 'reverb') { /* no-op */ return; }
        // X (horizontal) — continuous log-mapped drone pitch, 35 → 220 Hz.
        // Also tracked for the arpeggiator note selection.
        if (key === 'pitch')  {
            this._audio.setPitch(35 * Math.pow(6.3, v));
            this._lastPitchV = v;
            return;
        }
        // Y (vertical) — macro: filter + body + sub together.
        if (key === 'macro')  {
            this._audio.setMacro(v);
            this._lastMacro = v;
            return;
        }
        // Kept for legacy callers (sliders) — macro is preferred.
        if (key === 'filter') { this._audio.setFilter(180 + v * 2420);  return; }
        // Gestures → modulation. Pinch = FM growl, spread = wobble.
        if (key === 'fm')       { this._audio.setFM(v * 2000);          return; }
        if (key === 'lfoRate')  { this._audio.setLFORate(0.3 + v * 11); return; }
        if (key === 'lfoDepth') { this._audio.setLFODepth(v * 420);     return; }
        console.log('[KineticRack] ctrlChange', key, val);
    }

    /** FM grit depth in Hz — optional external driver (e.g. _handTrackFeed) */
    setFM(depthHz) { this._audio.setFM(depthHz); }

    /** LFO wobble rate in Hz — optional external driver (e.g. _handTrackFeed) */
    setLFORate(hz) { this._audio.setLFORate(hz); }

    midiLearn(target) {
        console.log('[KineticRack] midiLearn:', target);
    }

    toggleHelp() {
        document.getElementById('kr-help-modal')?.classList.toggle('kr-visible');
    }

    toggleRecording() {
        console.log('[KineticRack] toggleRecording (stub)');
    }

    clearLoops() {
        this._looper?.clearAll();
    }

    // ── Resize ────────────────────────────────────────────────────────────────

    _onResize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        if (this._camera) {
            this._camera.aspect = w / h;
            this._camera.updateProjectionMatrix();
        }
        this._renderer?.setSize(w, h);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

if (typeof THREE === 'undefined') {
    console.error('[KineticRack] THREE.js not loaded — check network / CDN');
    const _stub = {
        toggle()          { alert('THREE.js failed to load. Check your network connection.'); },
        ctrlChange()      {},  midiLearn()       {},
        toggleHelp()      {},  toggleRecording() {},  clearLoops() {},
    };
    window.KineticRack = _stub;
} else {
    let _rack;
    try {
        _rack = new KineticRack();
    } catch (e) {
        console.error('[KineticRack] boot failed:', e);
        _rack = {
            toggle()          { alert('KineticRack boot error:\n' + e); },
            ctrlChange()      {},  midiLearn()       {},
            toggleHelp()      {},  toggleRecording() {},  clearLoops() {},
        };
    }
    window.KineticRack = _rack;
}

})();
