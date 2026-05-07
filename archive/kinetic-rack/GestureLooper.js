/**
 * GestureLooper.js — Spatial Gesture Loop Recorder
 *
 * Records right-hand Index Finger X/Y motion during a pinch gesture,
 * then replays it endlessly as audio automation on a dedicated FMSynth.
 *
 * GESTURE:
 *   Right hand pinch (thumb tip ↔ index tip normalised dist < 0.05)
 *     → Start recording index-finger trajectory + deltaTime
 *   Pinch release
 *     → Finalise MotionTrack, spawn FMSynth, add loop to activeLoops
 *
 * AUDIO (per loop):
 *   Tone.FMSynth → loopBus (PingPongDelay + Reverb)
 *   Y-axis (0→1) → frequency  55 Hz – 880 Hz  (4 octaves, exponential)
 *   X-axis (0→1) → harmonicity 0.5 – 8.0
 *
 * VISUAL (per loop):
 *   THREE.Line  — glowing recorded-path trail
 *   THREE.Mesh  — playhead sphere that rides the path in sync
 *
 * TIMING:
 *   All playback uses performance.now() modulo loop duration.
 *   No Tone.Transport or setInterval — zero drift.
 */

import * as THREE from 'three';

// ── Constants ──────────────────────────────────────────────────────────────────
const PINCH_THRESHOLD = 0.05;   // normalised landmark distance
const MIN_RECORD_MS   = 200;    // ignore micro-pinches shorter than this
const FREQ_ROOT       = 55;     // Hz (A1)
const FREQ_OCTAVES    = 4;      // 55 → 880 Hz

// One colour per loop — cycles through the palette
const LOOP_PALETTE = [
    0x00f3ff,   // cyan
    0xff00cc,   // magenta
    0x00ff88,   // green
    0xff8800,   // orange
    0xb000ff,   // violet
    0xffff00,   // yellow
    0xff3344,   // red
    0x88aaff,   // blue
];

// ── GestureLooper ─────────────────────────────────────────────────────────────
export class GestureLooper {
    /**
     * @param {THREE.Scene}  scene
     * @param {object|null}  loopBus  Tone node — loop synths connect here
     */
    constructor(scene, loopBus) {
        this._scene   = scene;
        this._loopBus = loopBus;

        // Recording state
        this._isRecording  = false;
        this._recordStart  = 0;
        this._currentTrack = [];    // { x, y, pos:Vector3, t }[]

        // Live preview line (shown while recording)
        this._previewPts  = [];
        this._previewLine = null;

        // Finalised loops
        this._activeLoops = [];     // { track, duration, startT, synth, line, lineGlow, playhead }[]

        // Palette cycling
        this._colorIdx = 0;

        // Pinch edge detection
        this._wasPinching = false;

        // Current waveform for new synths
        this._waveform = 'sine';
    }

    // ── Main per-frame update ─────────────────────────────────────────────────
    /**
     * Call once per requestAnimationFrame.
     * @param {Array|null}   rightLms  MediaPipe hand landmarks for right hand
     * @param {THREE.Camera} camera
     */
    update(rightLms, camera) {
        const now = performance.now();

        // ── Pinch + index position ───────────────────────────────────────────
        let isPinching  = false;
        let indexPos2D  = null;   // { x:0..1, y:0..1 }  (0 = left/bottom)
        let indexPos3D  = null;   // THREE.Vector3 in world space

        if (rightLms) {
            const thumb = rightLms[4];
            const index = rightLms[8];
            const dx    = thumb.x - index.x;
            const dy    = thumb.y - index.y;
            isPinching  = Math.sqrt(dx * dx + dy * dy) < PINCH_THRESHOLD;

            // Flip X so right side of frame = x:1; flip Y so top = y:1
            indexPos2D = { x: 1 - index.x, y: 1 - index.y };
            indexPos3D = this._lm2w(index, camera);
        }

        // ── State machine ────────────────────────────────────────────────────
        if (isPinching && !this._wasPinching) {
            // PINCH START → begin recording
            this._isRecording  = true;
            this._recordStart  = now;
            this._currentTrack = [];
            this._previewPts   = [];
            this._buildPreviewLine();

        } else if (!isPinching && this._wasPinching && this._isRecording) {
            // PINCH RELEASE → finalise
            const dur = now - this._recordStart;
            if (dur >= MIN_RECORD_MS && this._currentTrack.length >= 4) {
                this._finalizeLoop();
            } else {
                this._isRecording = false;
                this._destroyPreviewLine();
            }
        }
        this._wasPinching = isPinching;

        // ── Capture a frame while recording ─────────────────────────────────
        if (this._isRecording && indexPos2D && indexPos3D) {
            const t = now - this._recordStart;
            this._currentTrack.push({
                x:   indexPos2D.x,
                y:   indexPos2D.y,
                pos: indexPos3D.clone(),
                t,
            });
            this._previewPts.push(indexPos3D.clone());
            this._updatePreviewLine();
        }

        // ── Replay all active loops ──────────────────────────────────────────
        for (const loop of this._activeLoops) {
            const phase = (now - loop.startT) % loop.duration;
            const pt    = this._interpolateTrack(loop.track, phase);
            if (!pt) continue;
            this._applyToSynth(loop.synth, pt.x, pt.y);
            loop.playhead.position.copy(pt.pos);
        }
    }

    // ── Coordinate helpers ────────────────────────────────────────────────────
    _lm2w(lm, cam) {
        const ndc = new THREE.Vector3(-(lm.x * 2 - 1), -(lm.y * 2 - 1), 0.5);
        ndc.unproject(cam);
        const dir  = ndc.sub(cam.position).normalize();
        const dist = -cam.position.z / dir.z;
        return cam.position.clone().add(dir.multiplyScalar(dist));
    }

    // ── Binary-search interpolation over a MotionTrack ───────────────────────
    _interpolateTrack(track, t) {
        if (!track.length) return null;
        if (t <= track[0].t)                    return track[0];
        if (t >= track[track.length - 1].t)     return track[track.length - 1];

        let lo = 0, hi = track.length - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (track[mid].t <= t) lo = mid;
            else                   hi = mid;
        }
        const a = track[lo], b = track[hi];
        const alpha = (t - a.t) / (b.t - a.t);
        return {
            x:   a.x   + (b.x   - a.x)   * alpha,
            y:   a.y   + (b.y   - a.y)   * alpha,
            pos: a.pos.clone().lerp(b.pos, alpha),
        };
    }

    // ── Apply playback point to a Tone.FMSynth ────────────────────────────────
    _applyToSynth(synth, x, y) {
        if (!synth || !window.Tone) return;
        try {
            const freq = FREQ_ROOT * Math.pow(2, y * FREQ_OCTAVES);   // 55–880 Hz
            const harm = 0.5 + x * 7.5;                                // 0.5–8.0

            // Use Tone.js param API (rampTo) — works on Signal, FrequencySignal, Multiply, etc.
            synth.frequency.rampTo(freq, 0.02);
            synth.harmonicity.rampTo(harm, 0.05);
        } catch (_) {}
    }

    // ── Finalise a completed recording into a looping entry ───────────────────
    _finalizeLoop() {
        this._isRecording = false;

        // Clone + normalise timestamps to start at 0
        const track    = this._currentTrack.map(p => ({ ...p }));
        const t0       = track[0].t;
        track.forEach(p => { p.t -= t0; });
        const duration = track[track.length - 1].t;

        const color = LOOP_PALETTE[this._colorIdx % LOOP_PALETTE.length];
        this._colorIdx++;

        // ── Spawn FMSynth ────────────────────────────────────────────────────
        const synth = new window.Tone.FMSynth({
            harmonicity:     2,
            modulationIndex: 5,
            oscillator:      { type: this._waveform },
            envelope:        { attack: 0.08, decay: 0.2, sustain: 0.85, release: 1.2 },
            modulation:      { type: 'sine' },
            modulationEnvelope: { attack: 0.4, decay: 0, sustain: 1, release: 1 },
        });
        synth.volume.value = -20;

        if (this._loopBus) {
            try { synth.connect(this._loopBus); }
            catch (_) { synth.toDestination(); }
        } else {
            synth.toDestination();
        }
        synth.triggerAttack('A2');

        // ── THREE.Line trail (inner bright + outer glow) ─────────────────────
        const positions = new Float32Array(track.length * 3);
        track.forEach((p, i) => {
            positions[i * 3]     = p.pos.x;
            positions[i * 3 + 1] = p.pos.y;
            positions[i * 3 + 2] = p.pos.z;
        });

        const pathGeo = new THREE.BufferGeometry();
        pathGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const line = new THREE.Line(
            pathGeo,
            new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 })
        );
        this._scene.add(line);

        const glowGeo = pathGeo.clone();
        const lineGlow = new THREE.Line(
            glowGeo,
            new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.2 })
        );
        lineGlow.scale.setScalar(1.004);
        this._scene.add(lineGlow);

        // ── Playhead sphere (white core + coloured halo) ─────────────────────
        const playhead = new THREE.Mesh(
            new THREE.SphereGeometry(0.022, 8, 8),
            new THREE.MeshBasicMaterial({ color: 0xffffff })
        );
        playhead.position.copy(track[0].pos);
        this._scene.add(playhead);

        const halo = new THREE.Mesh(
            new THREE.SphereGeometry(0.044, 8, 8),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35 })
        );
        playhead.add(halo);

        // ── Remove preview line, register loop ───────────────────────────────
        this._destroyPreviewLine();
        this._activeLoops.push({
            track,
            duration,
            startT:   performance.now(),
            synth,
            line,
            lineGlow,
            playhead,
        });

        // Update status indicator
        const el = document.getElementById('loop-count-badge');
        if (el) el.textContent = this._activeLoops.length;
    }

    // ── Live preview line management ──────────────────────────────────────────
    _buildPreviewLine() {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
        this._previewLine = new THREE.Line(
            geo,
            new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 })
        );
        this._scene.add(this._previewLine);
    }

    _updatePreviewLine() {
        if (!this._previewLine || !this._previewPts.length) return;
        const pts = this._previewPts;
        const buf = new Float32Array(pts.length * 3);
        pts.forEach((p, i) => {
            buf[i * 3]     = p.x;
            buf[i * 3 + 1] = p.y;
            buf[i * 3 + 2] = p.z;
        });
        const oldGeo = this._previewLine.geometry;
        const newGeo = new THREE.BufferGeometry();
        newGeo.setAttribute('position', new THREE.BufferAttribute(buf, 3));
        this._previewLine.geometry = newGeo;
        oldGeo.dispose();
    }

    _destroyPreviewLine() {
        if (!this._previewLine) return;
        this._scene.remove(this._previewLine);
        this._previewLine.geometry.dispose();
        this._previewLine.material.dispose();
        this._previewLine = null;
        this._previewPts  = [];
    }

    // ── Public controls ───────────────────────────────────────────────────────

    /** Change oscillator waveform on all current + future loops. */
    setWaveform(type) {
        this._waveform = type;
        for (const loop of this._activeLoops) {
            try { loop.synth.oscillator.type = type; } catch (_) {}
        }
    }

    /** Kill all active loops, dispose audio and WebGL resources. */
    clearAll() {
        for (const loop of this._activeLoops) {
            // Audio — release with natural tail, then dispose
            try {
                loop.synth.triggerRelease();
                setTimeout(() => { try { loop.synth.dispose(); } catch (_) {} }, 1500);
            } catch (_) {}

            // WebGL — remove from scene, dispose geometry & material
            [loop.line, loop.lineGlow, loop.playhead].forEach(obj => {
                this._scene.remove(obj);
                obj.geometry?.dispose();
                if (obj.material?.dispose) obj.material.dispose();
                obj.children?.forEach(c => {
                    c.geometry?.dispose();
                    c.material?.dispose();
                });
            });
        }
        this._activeLoops = [];
        this._colorIdx    = 0;
        this._destroyPreviewLine();

        const el = document.getElementById('loop-count-badge');
        if (el) el.textContent = '0';
    }

    /** Full teardown (called when KineticRack goes offline). */
    dispose() {
        this.clearAll();
    }

    // ── Accessors ─────────────────────────────────────────────────────────────
    get loopCount()    { return this._activeLoops.length; }
    get isRecording()  { return this._isRecording; }
}
