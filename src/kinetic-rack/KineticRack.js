/**
 * KineticRack.js — Hand-gesture → IDM/Techno instrument controller
 *
 * Gesture mapping (MediaPipe index fingertip = landmark 8):
 *   Left  Index X  → Bass Filter Cutoff
 *   Left  Index Y  → Glitch depth / BitCrusher bits
 *   Left  Pinch    → Kick trigger (thumb lm[4] ↔ index lm[8] < 0.07)
 *   Right Index X  → Atmos Spatial Panning
 *   Right Index Y  → Atmos Reverb Wetness
 *
 * Right index also drives SpatialSynth (palmX/Y compat).
 * Left hand visibility gates SpatialSynth volume.
 *
 * Visuals:
 *   FFTParticles — 8 192 shader-driven GPU particles on a sphere.
 *   Sub-bass bins 0-2 trigger radial kick impulse + white flash.
 *   Cyan (low freq) → Magenta (high freq) gradient.
 */

import * as THREE         from 'three';
import { AudioEngine }    from './AudioEngine.js';
import { NeuralComposer } from './NeuralComposer.js';
import { SpatialSynth }   from './SpatialSynth.js';
import { GestureLooper }  from './GestureLooper.js';

// ─────────────────────────────────────────────────────────────────────────────
//  FFTParticles
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
    float fftVal  = texture2D(uFFTTexture, vec2(aFreqBand, 0.5)).r;
    vFFTValue     = fftVal;
    vFreqBand     = aFreqBand;

    vec3 pos = position;

    // Frequency-based radial displacement
    float disp = fftVal * 1.5;

    // Sub-bass burst: kick impulse pushes low-freq particles outward
    disp += uKickImpulse * 0.9 * (1.0 - aFreqBand);

    // Slow ambient drift
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

    // Cyan at low freq → Magenta at high freq
    vec3 col = mix(vec3(0.0, 1.0, 1.0), vec3(1.0, 0.0, 1.0), vFreqBand);

    // White kick flash
    col = mix(col, vec3(1.0), uKickImpulse * 0.75);

    gl_FragColor = vec4(col * alpha * 1.8, alpha);
}
`;

const N_PARTICLES     = 8192;
const SUB_BASS_THRESH = 0.68;

class FFTParticles {
    constructor(scene) {
        this._scene       = scene;
        this._kickImpulse = 0;

        // 256×1 RGBA DataTexture updated each frame
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

    /**
     * @param {Float32Array} fftData  256 values normalized 0..1
     * @param {number}       elapsed  seconds since start
     * @param {number}       dt       frame delta seconds
     */
    update(fftData, elapsed, dt) {
        // Write FFT into DataTexture R channel
        for (let i = 0; i < 256; i++) {
            const v = Math.floor(fftData[i] * 255);
            this._fftTexData[i * 4]     = v;
            this._fftTexData[i * 4 + 1] = 0;
            this._fftTexData[i * 4 + 2] = 0;
            this._fftTexData[i * 4 + 3] = 255;
        }
        this._fftTex.needsUpdate = true;

        // Sub-bass auto-trigger
        const subBass = (fftData[0] + fftData[1] + fftData[2]) / 3;
        if (subBass > SUB_BASS_THRESH) {
            this._kickImpulse = Math.max(this._kickImpulse, subBass);
        }
        this._kickImpulse = Math.max(0, this._kickImpulse - dt * 3.5);

        this._mat.uniforms.uTime.value        = elapsed;
        this._mat.uniforms.uKickImpulse.value = this._kickImpulse;
    }

    /** Force kick flash from explicit gesture trigger */
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
//  KineticRack
// ─────────────────────────────────────────────────────────────────────────────

const LERP_FACTOR    = 0.15;
const PINCH_THRESH   = 0.07;   // normalized landmark distance
const PINCH_COOLDOWN = 0.35;   // seconds

class KineticRack {
    constructor() {
        this._ae      = new AudioEngine();
        this._nc      = new NeuralComposer();
        this._spatial = null;
        this._looper  = null;

        this._renderer  = null;
        this._scene     = null;
        this._camera    = null;
        this._particles = null;
        this._handLM    = null;

        this._active  = false;
        this._rafId   = null;
        this._elapsed = 0;
        this._lastNow = 0;

        // Smoothed gesture values
        this._s = {
            leftX:     0.5,
            leftY:     0.5,
            rightX:    0.5,
            rightY:    0.5,
            pinchDist: 1.0,
        };
        this._pinchCooldown = 0;
        this._leftVisible   = false;

        // MIDI learn
        this._midiLearnTarget = null;
        this._midiMap         = {};

        // Recording
        this._recording = false;
        this._mediaRec  = null;
        this._recChunks = [];
    }

    // ── Init ──────────────────────────────────────────────────────────────────

    async init(canvasEl) {
        const canvas = canvasEl ?? document.getElementById('kr-canvas');

        // Three.js
        this._renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
        this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this._renderer.setSize(window.innerWidth, window.innerHeight);

        this._scene  = new THREE.Scene();
        this._camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 100);
        this._camera.position.set(0, 0, 3.2);

        // Audio
        await this._ae.init();
        this._nc.init(this._ae);
        window._NC = this._nc;

        // SpatialSynth
        this._spatial = new SpatialSynth(this._scene, this._ae);
        this._spatial.init();

        // FFTParticles
        this._particles = new FFTParticles(this._scene);

        // GestureLooper (isolated — failure must not abort startup)
        try {
            this._looper = new GestureLooper(this._scene, this._ae.getLoopBus());
            window._GestureLooper = this._looper;
        } catch (e) {
            console.warn('[KineticRack] GestureLooper init failed:', e);
        }

        // MediaPipe
        await this._initHandLandmarker();

        window.addEventListener('resize', this._onResize.bind(this));

        this._active  = true;
        this._lastNow = performance.now();
        this._loop();
    }

    async _initHandLandmarker() {
        try {
            const { HandLandmarker, FilesetResolver } = await import(
                'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.js'
            );
            const vision = await FilesetResolver.forVisionTasks(
                'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
            );
            this._handLM = await HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
                    delegate: 'GPU',
                },
                runningMode:                'VIDEO',
                numHands:                   2,
                minHandDetectionConfidence: 0.6,
                minHandPresenceConfidence:  0.6,
                minTrackingConfidence:      0.5,
            });
        } catch (e) {
            console.warn('[KineticRack] HandLandmarker unavailable:', e);
        }
    }

    // ── Main loop ─────────────────────────────────────────────────────────────

    _loop() {
        if (!this._active) return;
        this._rafId = requestAnimationFrame(this._loop.bind(this));

        const now     = performance.now();
        const dt      = Math.min((now - this._lastNow) / 1000, 0.1);
        this._lastNow = now;
        this._elapsed += dt;

        this._pinchCooldown = Math.max(0, this._pinchCooldown - dt);

        this._detectHands();

        const fft = this._ae.getFFT();
        this._particles.update(fft, this._elapsed, dt);

        this._spatial.update(
            this._s.rightX,
            this._s.rightY,
            this._leftVisible,
            this._elapsed
        );

        this._renderer.render(this._scene, this._camera);
    }

    // ── Hand detection ────────────────────────────────────────────────────────

    _detectHands() {
        const video = document.getElementById('kr-video');
        if (!this._handLM || !video || video.readyState < 2) return;

        let results;
        try {
            results = this._handLM.detectForVideo(video, performance.now());
        } catch (_) { return; }

        const hands      = results?.landmarks  ?? [];
        const handedness = results?.handedness ?? [];

        let leftLm  = null;
        let rightLm = null;

        for (let i = 0; i < hands.length; i++) {
            const label = handedness[i]?.[0]?.categoryName;
            if (label === 'Left')  leftLm  = hands[i];
            if (label === 'Right') rightLm = hands[i];
        }

        this._leftVisible = !!leftLm;

        // ── Left hand ────────────────────────────────────────────────────────
        if (leftLm) {
            const lm8 = leftLm[8];   // index fingertip
            const lm4 = leftLm[4];   // thumb tip

            this._s.leftX += (lm8.x - this._s.leftX) * LERP_FACTOR;
            this._s.leftY += (lm8.y - this._s.leftY) * LERP_FACTOR;

            this._ae.setBassFilterCutoff(this._s.leftX);
            this._ae.setGlitchDepth(this._s.leftY);

            // Pinch: euclidean distance thumb↔index fingertip
            const dx   = lm4.x - lm8.x;
            const dy   = lm4.y - lm8.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            this._s.pinchDist += (dist - this._s.pinchDist) * LERP_FACTOR;

            if (this._s.pinchDist < PINCH_THRESH && this._pinchCooldown <= 0) {
                this._ae.triggerKick(0.9);
                this._particles.triggerKickFlash();
                this._pinchCooldown = PINCH_COOLDOWN;
            }
        }

        // ── Right hand ───────────────────────────────────────────────────────
        if (rightLm) {
            const lm8 = rightLm[8];

            this._s.rightX += (lm8.x - this._s.rightX) * LERP_FACTOR;
            this._s.rightY += (lm8.y - this._s.rightY) * LERP_FACTOR;

            this._ae.setSpatialPan(this._s.rightX);
            this._ae.setAtmosReverbWet(this._s.rightY);
        }

        // ── GestureLooper: right hand pinch → record/replay motion loops ─────
        this._looper?.update(rightLm, this._camera);
    }

    // ── Public API ────────────────────────────────────────────────────────────

    async toggle() {
        if (this._active) {
            this._active = false;
            if (this._rafId) cancelAnimationFrame(this._rafId);
        } else if (!this._renderer) {
            // First click — full initialization
            await this.init();
        } else {
            // Resume from pause
            this._active  = true;
            this._lastNow = performance.now();
            this._loop();
        }
    }

    ctrlChange(cc, value) {
        // String keys come from the Tweak UI; numeric keys come from MIDI
        if (typeof cc === 'string') {
            const v = parseFloat(value);
            if (cc === 'vol')        this._ae.setVolume(v);
            if (cc === 'reverb')     this._ae.setReverbMix(v);
            if (cc === 'filter')     this._ae.setManualFilter(v);
            if (cc === 'loopDelay')  this._ae.setLoopDelayWet(v);
            if (cc === 'loopWave')   this._looper?.setWaveform(value);
            return;
        }
        // MIDI CC path
        const norm   = value / 127;
        const target = this._midiMap[cc];
        if (!target) return;
        switch (target) {
            case 'volume':      this._ae.setVolume(norm);           break;
            case 'bassFilter':  this._ae.setBassFilterCutoff(norm); break;
            case 'glitchDepth': this._ae.setGlitchDepth(norm);      break;
            case 'atmosReverb': this._ae.setAtmosReverbWet(norm);   break;
            case 'spatialPan':  this._ae.setSpatialPan(norm);       break;
            case 'reverbMix':   this._ae.setReverbMix(norm);        break;
        }
    }

    clearLoops() {
        this._looper?.clearAll();
    }

    midiLearn(target) {
        this._midiLearnTarget = target;
        console.log('[KineticRack] MIDI learn armed for:', target);
    }

    _onMidiCC(cc) {
        if (this._midiLearnTarget) {
            this._midiMap[cc] = this._midiLearnTarget;
            console.log('[KineticRack] MIDI CC', cc, '→', this._midiLearnTarget);
            this._midiLearnTarget = null;
        }
    }

    async toggleRecording() {
        if (!this._recording) {
            const dest = this._ae.getRecordingDest();
            if (!dest) return;
            this._recChunks = [];
            this._mediaRec  = new MediaRecorder(dest.stream, {
                mimeType: 'audio/webm;codecs=opus',
            });
            this._mediaRec.ondataavailable = e => {
                if (e.data.size > 0) this._recChunks.push(e.data);
            };
            this._mediaRec.onstop = () => {
                const blob = new Blob(this._recChunks, { type: 'audio/webm' });
                const url  = URL.createObjectURL(blob);
                const a    = document.createElement('a');
                a.href     = url;
                a.download = `kr_${Date.now()}.webm`;
                a.click();
                URL.revokeObjectURL(url);
                this._ae.releaseRecordingDest(dest);
            };
            this._mediaRec.start(250);
            this._recording = true;
            document.getElementById('kr-rec-btn')?.classList.add('kr-active');
        } else {
            this._mediaRec?.stop();
            this._recording = false;
            document.getElementById('kr-rec-btn')?.classList.remove('kr-active');
        }
    }

    toggleHelp() {
        document.getElementById('kr-help')?.classList.toggle('kr-visible');
    }

    toggleSonicSuite() {
        document.getElementById('kr-sonic-suite')?.classList.toggle('kr-visible');
    }

    _onResize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        this._camera.aspect = w / h;
        this._camera.updateProjectionMatrix();
        this._renderer.setSize(w, h);
    }

    dispose() {
        this._active = false;
        if (this._rafId) cancelAnimationFrame(this._rafId);
        window.removeEventListener('resize', this._onResize.bind(this));
        this._looper?.dispose();
        this._particles?.dispose();
        this._spatial?.dispose();
        this._nc?.dispose();
        this._ae?.dispose();
        this._renderer?.dispose();
        window._GestureLooper = null;
    }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
const _rack = new KineticRack();
window.KineticRack = _rack;

export { KineticRack };
export default _rack;
