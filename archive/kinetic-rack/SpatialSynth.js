/**
 * SpatialSynth.js — 3D Spatial Field instrument
 *
 * Replaces TetherVerlet physics with a DSP-mapped spatial field.
 *
 * RIGHT HAND (modulation):
 *   Palm X → Pitch / Granular position (0..1 → frequency scale)
 *   Palm Y → Filter Cutoff (0..1 → 80..8000 Hz)
 *
 * LEFT HAND (volume gate):
 *   Visible  → volume ramps open (setTargetAtTime, τ=0.12)
 *   Hidden   → volume fades to 0  (setTargetAtTime, τ=0.35)
 *   Fast downward snap → 808 kick trigger (handled by KineticRack)
 *
 * VISUAL:
 *   3D field of 2000 points arranged in a DSP-grid plane.
 *   Right-hand X/Y warp the grid — Y-columns shift in Z creating
 *   a "frequency landscape". All rendered via custom GLSL shaders.
 *   WebGL only — no 2D canvas.
 *
 * AUDIO:
 *   3 detuned oscillators (sawtooth) → BiquadFilter → masterGain → ae.synthInput
 *   All param changes via setTargetAtTime to prevent clicks.
 */

import * as THREE from 'three';

const GRID_COLS    = 40;
const GRID_ROWS    = 50;
const GRID_N       = GRID_COLS * GRID_ROWS;   // 2 000 points

// Frequency range: palm X maps over 2 octaves above a root
const FREQ_ROOT    = 55;     // Hz
const FREQ_RANGE   = 4;      // octaves

const vertexShader = /* glsl */`
attribute float aIntensity;
attribute vec3  aColor;

varying float vIntensity;
varying vec3  vColor;

uniform float uTime;
uniform vec2  uPalmXY;   // right palm 0..1
uniform float uGate;     // left hand visible 0..1

void main() {
    vIntensity = aIntensity;
    vColor     = aColor;

    vec3 pos = position;

    // Warp: columns near palm X get pushed toward camera (Z+)
    float col  = (pos.x + 1.1) / 2.2;            // 0..1 across grid width
    float dist = abs(col - uPalmXY.x);
    float warp = exp(-dist * dist * 8.0) * uPalmXY.y * 0.6;
    pos.z += warp;

    // Slow ambient drift
    pos.z += sin(uTime * 0.4 + pos.x * 2.1 + pos.y * 1.7) * 0.04 * uGate;

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);

    float sz = aIntensity * (220.0 / -mvPos.z) * (0.4 + uGate * 0.6);
    gl_PointSize = clamp(sz, 0.5, 48.0);
    gl_Position  = projectionMatrix * mvPos;
}
`;

const fragmentShader = /* glsl */`
varying float vIntensity;
varying vec3  vColor;

void main() {
    vec2  uv   = gl_PointCoord - 0.5;
    float dist = length(uv);
    if (dist > 0.5) discard;

    float alpha = pow(1.0 - dist * 2.0, 2.2) * vIntensity;
    gl_FragColor = vec4(vColor * alpha * 2.0, alpha);
}
`;

export class SpatialSynth {
    constructor(scene, audioEngine) {
        this._scene  = scene;
        this._ae     = audioEngine;
        this._active = false;

        // Smoothed palm state (LERP done by KineticRack before passing in)
        this._palmX  = 0.5;
        this._palmY  = 0.5;
        this._gate   = 0;     // 0..1 left hand visibility

        // Web Audio nodes
        this._oscs       = [];
        this._oscFilter  = null;
        this._masterGain = null;
        this._lastFreq   = FREQ_ROOT;

        // Three.js
        this._geo     = null;
        this._mat     = null;
        this._points  = null;

        // Typed arrays for grid state
        this._positions  = new Float32Array(GRID_N * 3);
        this._colors     = new Float32Array(GRID_N * 3);
        this._intensities = new Float32Array(GRID_N);
        this._homeX      = new Float32Array(GRID_N);
        this._homeY      = new Float32Array(GRID_N);
    }

    init() {
        this._buildGrid();
        this._buildAudio();
        this._active = true;
    }

    // ── Grid geometry ─────────────────────────────────────────────────────────

    _buildGrid() {
        const T = THREE;

        for (let r = 0; r < GRID_ROWS; r++) {
            for (let c = 0; c < GRID_COLS; c++) {
                const i  = r * GRID_COLS + c;
                const px = (c / (GRID_COLS - 1)) * 2.2 - 1.1;
                const py = (r / (GRID_ROWS - 1)) * 1.6 - 0.8;

                this._positions[i * 3]     = px;
                this._positions[i * 3 + 1] = py;
                this._positions[i * 3 + 2] = 0;

                this._homeX[i] = px;
                this._homeY[i] = py;

                // Base color: deep cyan-teal grid
                const bright = 0.25 + 0.35 * (r / GRID_ROWS);
                this._colors[i * 3]     = 0.0;
                this._colors[i * 3 + 1] = bright * 0.9;
                this._colors[i * 3 + 2] = bright;

                this._intensities[i] = 0.1 + Math.random() * 0.15;
            }
        }

        const geo = new T.BufferGeometry();
        geo.setAttribute('position',   new T.BufferAttribute(this._positions,   3));
        geo.setAttribute('aColor',     new T.BufferAttribute(this._colors,      3));
        geo.setAttribute('aIntensity', new T.BufferAttribute(this._intensities, 1));

        const mat = new T.ShaderMaterial({
            vertexShader,
            fragmentShader,
            transparent: true,
            depthWrite:  false,
            blending:    T.AdditiveBlending,
            uniforms: {
                uTime:    { value: 0 },
                uPalmXY:  { value: new T.Vector2(0.5, 0.5) },
                uGate:    { value: 0 },
            },
        });

        this._geo    = geo;
        this._mat    = mat;
        this._points = new T.Points(geo, mat);
        this._points.renderOrder = 4;
        this._scene.add(this._points);
    }

    // ── Audio ─────────────────────────────────────────────────────────────────

    _buildAudio() {
        const ctx = this._ae?.ctx;
        if (!ctx) return;

        // Master gain for this synth (gate control)
        this._masterGain = ctx.createGain();
        this._masterGain.gain.value = 0;
        this._masterGain.connect(this._ae.synthInput);

        // BiquadFilter: palm Y controls cutoff
        this._oscFilter = ctx.createBiquadFilter();
        this._oscFilter.type            = 'lowpass';
        this._oscFilter.frequency.value = 800;
        this._oscFilter.Q.value         = 3.5;
        this._oscFilter.connect(this._masterGain);

        // 3 detuned sawtooth oscillators
        const detunes = [-6, 0, +6];
        for (const dt of detunes) {
            const osc = ctx.createOscillator();
            osc.type            = 'sawtooth';
            osc.frequency.value = FREQ_ROOT;
            osc.detune.value    = dt;

            const g = ctx.createGain();
            g.gain.value = 0.28;

            osc.connect(g);
            g.connect(this._oscFilter);
            osc.start();

            this._oscs.push(osc);
        }
    }

    // ── Per-frame update ──────────────────────────────────────────────────────

    /**
     * Called every frame by KineticRack (after LERP smoothing).
     *
     * @param {number|null} palmX   Right palm X 0..1  (null if no right hand)
     * @param {number|null} palmY   Right palm Y 0..1  (null if no right hand)
     * @param {boolean}     leftVisible  Whether left hand is currently tracked
     * @param {number}      elapsed  Total time from THREE.Clock
     */
    update(palmX, palmY, leftVisible, elapsed) {
        if (!this._active) return;

        const ctx = this._ae?.ctx;

        // ── Gate: left hand modulates volume (never hard-silences) ───────────
        // 0.3 base so the synth is always audible; left hand opens it fully.
        const targetGate = leftVisible ? 0.75 : 0.3;
        if (ctx && this._masterGain) {
            this._masterGain.gain.setTargetAtTime(
                targetGate,
                ctx.currentTime,
                leftVisible ? 0.12 : 0.35
            );
        }
        this._gate += (targetGate - this._gate) * 0.08;

        // ── Pitch: right palm X ───────────────────────────────────────────────
        if (palmX !== null) {
            this._palmX += (palmX - this._palmX) * 0.12;
            const targetFreq = FREQ_ROOT * Math.pow(2, this._palmX * FREQ_RANGE);
            if (ctx) {
                for (const osc of this._oscs) {
                    osc.frequency.setTargetAtTime(targetFreq, ctx.currentTime, 0.04);
                }
            }
        }

        // ── Filter: right palm Y ──────────────────────────────────────────────
        if (palmY !== null) {
            this._palmY += (palmY - this._palmY) * 0.10;
            const targetCutoff = 80 + this._palmY * 7920;
            if (ctx && this._oscFilter) {
                this._oscFilter.frequency.setTargetAtTime(targetCutoff, ctx.currentTime, 0.03);
            }
        }

        // ── Visual uniforms ───────────────────────────────────────────────────
        this._mat.uniforms.uTime.value   = elapsed;
        this._mat.uniforms.uPalmXY.value.set(
            palmX ?? this._palmX,
            palmY ?? this._palmY
        );
        this._mat.uniforms.uGate.value   = this._gate;

        // ── Color modulation: cyan base → magenta at high filter, gold at high pitch
        const px = this._palmX;
        const py = this._palmY;
        const g  = this._gate;

        for (let i = 0; i < GRID_N; i++) {
            const r = i * 3;
            const col  = (this._homeX[i] + 1.1) / 2.2;   // 0..1
            const row  = (this._homeY[i] + 0.8) / 1.6;   // 0..1

            // Distance from palm X position
            const colDist = Math.abs(col - px);
            const hot     = Math.exp(-colDist * colDist * 6.0) * g;

            // Resting: dark teal
            let cr = 0.0  + hot * (py * 0.9 + px * 0.2);
            let cg = 0.12 + hot * (0.6 - py * 0.5);
            let cb = 0.30 + hot * (1.0 - px * 0.6);

            // Row brightness modulation
            const rowBright = 0.3 + row * 0.7;
            cr *= rowBright;
            cg *= rowBright;
            cb *= rowBright;

            // Smooth update
            this._colors[r]     = this._colors[r]     * 0.88 + cr * 0.12;
            this._colors[r + 1] = this._colors[r + 1] * 0.88 + cg * 0.12;
            this._colors[r + 2] = this._colors[r + 2] * 0.88 + cb * 0.12;

            // Intensity: active zone brightens
            const targetI = 0.08 + hot * 0.92;
            this._intensities[i] = this._intensities[i] * 0.90 + targetI * 0.10;
        }

        this._geo.attributes.aColor.needsUpdate     = true;
        this._geo.attributes.aIntensity.needsUpdate = true;
    }

    deactivate() {
        this._active = false;
        if (this._masterGain && this._ae?.ctx) {
            this._masterGain.gain.setTargetAtTime(0, this._ae.ctx.currentTime, 0.2);
        }
        if (this._points) this._points.visible = false;
    }

    activate() {
        this._active = true;
        if (this._points) this._points.visible = true;
    }

    dispose() {
        this.deactivate();
        for (const osc of this._oscs) { try { osc.stop(); } catch (_) {} }
        this._masterGain?.disconnect();
        this._oscFilter?.disconnect();
        if (this._points) {
            this._scene.remove(this._points);
            this._geo.dispose();
            this._mat.dispose();
        }
    }
}
