/**
 * TetherVerlet.js — Fluid Tether: 128-point Verlet string + 3-oscillator synth
 *
 * PINNING:   left wrist  ←→  right wrist
 * SYNTHESIS: 3 detuned sawtooth OSCs → LP filter → AudioEngine.synthInput
 * VISUAL:    6 layered additive-blend Lines (plasma glow) + mid PointLight
 *            colour shifts cyan→white→magenta as tension rises
 */

import * as THREE from 'three';

const N         = 128;   // Verlet point count
const GRAV      = 0.00012;
const DAMP      = 0.986;
const ITERS     = 14;    // constraint solver iterations

export class TetherVerlet {
    constructor(scene, audioEngine) {
        this._scene  = scene;
        this._ae     = audioEngine;
        this._active = false;

        // Verlet state
        this._pts = [];   // {x,y,z}  current
        this._old = [];   // {x,y,z}  previous
        this._pinL = new THREE.Vector3();  // left  wrist (trigger hand)
        this._pinR = new THREE.Vector3();  // right wrist (modulate hand)
        this._hasBoth = false;
        this._tension = 0;

        // Pre-allocated curve points (avoid GC)
        this._curvePts = Array.from({ length: N }, () => new THREE.Vector3());

        // Three.js
        this._lines    = [];    // [{line, geo, layer}]
        this._tubeGeo  = null;
        this._posAttr  = null;
        this._midLight = null;
        this._pinLLight = null;
        this._pinRLight = null;

        // Audio — 3 sawtooth oscillators
        this._oscs   = [];
        this._oscGains = [];
        this._masterG = null;
        this._lastFreq = 110;
    }

    init() {
        this._initVerlet();
        this._initVisuals();
        this._initAudio();
    }

    // ── Verlet ────────────────────────────────────────────────────────────────
    _initVerlet() {
        for (let i = 0; i < N; i++) {
            const t = i / (N - 1);
            const x = t * 0.8 - 0.4;
            this._pts.push({ x, y: 0, z: 0 });
            this._old.push({ x, y: 0, z: 0 });
        }
    }

    // ── Visuals ───────────────────────────────────────────────────────────────
    _initVisuals() {
        // Layer specs: [color, base-opacity, yOffset, waveAmp, waveFreqMult]
        const layers = [
            { c: 0xffffff, o: 1.00, yo: 0.000, wa: 0.018, wf: 1.0 },
            { c: 0x00f3ff, o: 0.72, yo: 0.000, wa: 0.030, wf: 1.6 },
            { c: 0xff00cc, o: 0.55, yo: 0.000, wa: 0.044, wf: 2.2 },
            { c: 0x00f3ff, o: 0.28, yo: 0.072, wa: 0.016, wf: 0.7 },
            { c: 0xff00cc, o: 0.28, yo:-0.072, wa: 0.016, wf: 0.7 },
            { c: 0xffffff, o: 0.10, yo: 0.000, wa: 0.065, wf: 3.5 },
        ];

        for (const spec of layers) {
            const arr = new Float32Array(N * 3);
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
            const mat = new THREE.LineBasicMaterial({
                color:       new THREE.Color(spec.c),
                transparent: true,
                opacity:     spec.o,
                blending:    THREE.AdditiveBlending,
                depthWrite:  false,
            });
            const line = new THREE.Line(geo, mat);
            line.visible     = false;
            line.renderOrder = 3;
            this._scene.add(line);
            this._lines.push({ line, geo, spec });
        }

        // Mid-string tension light
        this._midLight = new THREE.PointLight(0x00f3ff, 0, 6);
        this._scene.add(this._midLight);

        // Anchor lights
        this._pinLLight = new THREE.PointLight(0xff00cc, 0, 2.5);
        this._pinRLight = new THREE.PointLight(0x00f3ff, 0, 2.5);
        this._scene.add(this._pinLLight);
        this._scene.add(this._pinRLight);
    }

    // ── Audio — 3 detuned sawtooths → AudioEngine.synthInput ─────────────────
    _initAudio() {
        if (!this._ae?.ctx) return;
        const ctx = this._ae.ctx;

        this._masterG = ctx.createGain();
        this._masterG.gain.value = 0;
        this._masterG.connect(this._ae.synthInput);

        const detunes = [-8, 0, 8];
        for (const dt of detunes) {
            const osc = ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.value = 110;
            osc.detune.value    = dt;

            const g = ctx.createGain();
            g.gain.value = 0.32;

            osc.connect(g);
            g.connect(this._masterG);
            osc.start();

            this._oscs.push(osc);
            this._oscGains.push(g);
        }
    }

    // ── Per-frame update ──────────────────────────────────────────────────────
    /**
     * @param {THREE.Vector3|null} leftWrist   world-space left  wrist position
     * @param {THREE.Vector3|null} rightWrist  world-space right wrist position
     * @param {number} dt      delta time
     * @param {number} elapsed total elapsed time
     */
    update(leftWrist, rightWrist, dt, elapsed) {
        if (!this._active) return;

        this._hasBoth = !!(leftWrist && rightWrist);

        if (!this._hasBoth) {
            this._hide();
            return;
        }

        this._pinL.copy(leftWrist);
        this._pinR.copy(rightWrist);

        // Pin endpoints
        this._pts[0]     = { x: this._pinL.x, y: this._pinL.y, z: this._pinL.z };
        this._pts[N - 1] = { x: this._pinR.x, y: this._pinR.y, z: this._pinR.z };

        const anchorDist = this._pinL.distanceTo(this._pinR);
        this._tension    = THREE.MathUtils.clamp(anchorDist / 1.2, 0, 1);

        this._stepVerlet(anchorDist, dt);
        this._updateLines(elapsed);
        this._updateAudio(anchorDist);
    }

    _stepVerlet(anchorDist, dt) {
        // Integrate (skip pinned endpoints)
        for (let i = 1; i < N - 1; i++) {
            const p = this._pts[i], o = this._old[i];
            const vx = (p.x - o.x) * DAMP;
            const vy = (p.y - o.y) * DAMP;
            const vz = (p.z - o.z) * DAMP;
            o.x = p.x; o.y = p.y; o.z = p.z;
            p.x += vx;
            p.y += vy - GRAV;
            p.z += vz;
        }

        // Constraint solve
        const rest = anchorDist / (N - 1);
        for (let iter = 0; iter < ITERS; iter++) {
            for (let i = 0; i < N - 1; i++) {
                const a = this._pts[i], b = this._pts[i + 1];
                const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
                const d  = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
                const c  = (d - rest) / d * 0.5;
                if (i !== 0)     { a.x += dx * c; a.y += dy * c; a.z += dz * c; }
                if (i !== N - 2) { b.x -= dx * c; b.y -= dy * c; b.z -= dz * c; }
            }
        }
    }

    _updateLines(elapsed) {
        const T = this._tension;
        const fNorm = T; // 0=loose(cyan) → 1=taut(magenta)

        // Axis perpendicular to string for ripple displacement
        const strDir = new THREE.Vector3(
            this._pts[N - 1].x - this._pts[0].x,
            this._pts[N - 1].y - this._pts[0].y,
            this._pts[N - 1].z - this._pts[0].z,
        ).normalize();
        const up = Math.abs(strDir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
        const rDir = up.clone().cross(strDir).normalize();

        for (const { line, geo, spec } of this._lines) {
            const pos = geo.attributes.position.array;
            for (let i = 0; i < N; i++) {
                const t    = i / (N - 1);
                const wave = Math.sin(t * Math.PI * 4 * spec.wf + elapsed * 5) * spec.wa * (0.4 + T);
                pos[i * 3]     = this._pts[i].x + rDir.x * wave;
                pos[i * 3 + 1] = this._pts[i].y + rDir.y * wave + spec.yo;
                pos[i * 3 + 2] = this._pts[i].z + rDir.z * wave;
            }
            geo.attributes.position.needsUpdate = true;
            line.visible = true;

            // Colour shift with tension (inner layers only)
            if (spec.o > 0.4) {
                line.material.color.setHSL(0.56 - fNorm * 0.22, 1.0, 0.72 + fNorm * 0.18);
            }
        }

        // Mid-string tension light
        const m = this._pts[N >> 1];
        this._midLight.position.set(m.x, m.y, m.z);
        this._midLight.color.setHSL(0.56 - fNorm * 0.22, 1, 0.5);
        this._midLight.intensity = 0.8 + T * 14;
        this._midLight.distance  = 3.5 + T * 4;

        this._pinLLight.position.copy(this._pinL);
        this._pinLLight.intensity = 0.6 + T * 4;
        this._pinRLight.position.copy(this._pinR);
        this._pinRLight.intensity = 0.6 + T * 4;
    }

    _updateAudio(anchorDist) {
        if (!this._ae?.ctx || !this._masterG) return;
        const ctx = this._ae.ctx;

        // Distance → frequency (55–880 Hz logarithmic)
        const target = 55 * Math.pow(16, Math.min(1, anchorDist / 1.4));
        this._lastFreq = this._lastFreq + (target - this._lastFreq) * 0.06;

        for (const osc of this._oscs) {
            osc.frequency.setTargetAtTime(this._lastFreq, ctx.currentTime, 0.02);
        }

        // Bring gain up when both hands visible
        this._masterG.gain.setTargetAtTime(0.75, ctx.currentTime, 0.15);
    }

    _hide() {
        for (const { line } of this._lines) line.visible = false;
        this._midLight.intensity  = 0;
        this._pinLLight.intensity = 0;
        this._pinRLight.intensity = 0;
        if (this._masterG) {
            this._masterG.gain.setTargetAtTime(0, this._ae.ctx.currentTime, 0.1);
        }
    }

    activate() {
        this._active = true;
    }

    deactivate() {
        this._active = false;
        this._hide();
    }

    dispose() {
        this.deactivate();
        for (const { line } of this._lines) {
            this._scene.remove(line);
            line.geometry.dispose();
            line.material.dispose();
        }
        this._scene.remove(this._midLight);
        this._scene.remove(this._pinLLight);
        this._scene.remove(this._pinRLight);
        for (const osc of this._oscs) { try { osc.stop(); } catch {} }
        this._masterG?.disconnect();
    }
}
