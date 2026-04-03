/**
 * AudioEngine.js — Master Audio Graph
 *
 * Signal flow:
 *   Tone.js instruments → toneOut (GainNode)
 *                                        \
 *   SpatialSynth oscs  → synthInput ─────┴→ masterGain → hardLimiter(-3dB/20:1) → destination
 *
 * Hard Limiter is the FINAL node before ctx.destination. No clipping.
 *
 * Instruments:
 *   MembraneSynth  — 808 kick  (triggerKick)
 *   FMSynth        — drone     (setDronePitch / setFilterCutoff)
 *   AutoFilter     — wraps drone
 *   Kit × 3        — hihat / metal / glitch  (triggerKit / switchKit)
 *
 * NeuralComposer integration:
 *   triggerSequencerNote(trackIdx, note, vel)
 */

const KIT_NAMES   = ['HI-HAT', 'METAL', 'GLITCH'];
const DRONE_NOTES = ['A1','C2','D2','F2','G2','A2','C3','D3','F3','G3','A3'];

export class AudioEngine {
    constructor() {
        this.ctx           = null;

        // Native Web Audio master chain
        this._hardLimiter  = null;
        this._masterGain   = null;  // native gain before limiter (volume control)
        this._toneOut      = null;  // Tone.js instruments feed here
        this._synthInput   = null;  // SpatialSynth oscillators feed here

        // Tone.js instruments
        this._kick         = null;
        this._drone        = null;
        this._autoFilter   = null;
        this._reverb       = null;
        this._kits         = [];
        this._kitIndex     = 0;

        // Loop effects bus (GestureLooper synths route here)
        this._loopDelay    = null;   // Tone.PingPongDelay  — entry point for loops
        this._loopReverb   = null;   // Tone.Reverb         — tail for loops

        this._recDest      = null;
    }

    async init() {
        const Tone = window.Tone;
        if (!Tone) throw new Error('Tone.js not loaded');

        await Tone.start();
        this.ctx = Tone.getContext().rawContext;

        // ── Hard Limiter — absolute final node ───────────────────────────────
        this._hardLimiter = this.ctx.createDynamicsCompressor();
        this._hardLimiter.threshold.value = -3;
        this._hardLimiter.knee.value      = 0;
        this._hardLimiter.ratio.value     = 20;
        this._hardLimiter.attack.value    = 0.001;
        this._hardLimiter.release.value   = 0.05;
        this._hardLimiter.connect(this.ctx.destination);

        // ── Master gain (volume slider target) ───────────────────────────────
        this._masterGain = this.ctx.createGain();
        this._masterGain.gain.value = 0.7;
        this._masterGain.connect(this._hardLimiter);

        // ── Tone.js output bridge ─────────────────────────────────────────────
        // Tone instruments connect to a native GainNode that feeds masterGain.
        // We do this by overriding Tone's final connection using a MediaStreamDest
        // approach — simpler: use Tone.Destination.input directly.
        this._toneOut = this.ctx.createGain();
        this._toneOut.gain.value = 1.0;
        this._toneOut.connect(this._masterGain);

        // Bridge Tone's output chain into toneOut:
        // Tone.Destination is a ToneAudioNode; we connect it to toneOut
        // by disconnecting from ctx.destination and reconnecting to toneOut.
        try {
            const toneDest = Tone.getDestination();
            toneDest.disconnect();
            toneDest.connect(this._toneOut);
        } catch (_) {
            // Fallback: Tone routes directly to ctx.destination, keep going
        }

        // ── Reverb ────────────────────────────────────────────────────────────
        this._reverb = new Tone.Reverb({ decay: 3.2, wet: 0.0 });
        await this._reverb.ready;
        this._reverb.toDestination();

        // ── AutoFilter (drone path) ───────────────────────────────────────────
        this._autoFilter = new Tone.AutoFilter({
            frequency:     0.5,
            baseFrequency: 300,
            octaves:       3.5,
            filter: { type: 'lowpass', rolloff: -12 },
        }).toDestination();
        this._autoFilter.start();

        // ── 808 Kick ──────────────────────────────────────────────────────────
        this._kick = new Tone.MembraneSynth({
            pitchDecay:  0.09,
            octaves:     8,
            oscillator:  { type: 'sine' },
            envelope: { attack: 0.001, decay: 0.45, sustain: 0, release: 0.18 },
        }).toDestination();
        this._kick.volume.value = -2;

        // ── Drone: FMSynth ────────────────────────────────────────────────────
        this._drone = new Tone.FMSynth({
            harmonicity:     0.5,
            modulationIndex: 3,
            oscillator:      { type: 'sawtooth' },
            envelope:        { attack: 0.8, decay: 0.2, sustain: 0.85, release: 2.5 },
            modulation:      { type: 'sine' },
            modulationEnvelope: { attack: 0.5, decay: 0, sustain: 1, release: 2 },
        }).connect(this._autoFilter);
        this._drone.volume.value = -14;
        this._drone.triggerAttack('A1');

        // ── Kit synths ────────────────────────────────────────────────────────
        const hihat = new Tone.NoiseSynth({
            noise:    { type: 'white' },
            envelope: { attack: 0.001, decay: 0.065, sustain: 0, release: 0.01 },
        }).toDestination();
        hihat.volume.value = -8;

        const metal = new Tone.MetalSynth({
            frequency: 400, envelope: { attack: 0.001, decay: 0.14, release: 0.02 },
            harmonicity: 5.1, modulationIndex: 32, resonance: 4200, octaves: 1.5,
        }).toDestination();
        metal.volume.value = -12;

        const glitch = new Tone.PluckSynth({
            attackNoise: 2, dampening: 3800, resonance: 0.98,
        }).toDestination();
        glitch.volume.value = -6;

        this._kits = [hihat, metal, glitch];

        // ── SpatialSynth input ────────────────────────────────────────────────
        // SpatialSynth oscillators connect here → masterGain → hardLimiter
        this._synthInput = this.ctx.createGain();
        this._synthInput.gain.value = 0.55;
        this._synthInput.connect(this._masterGain);

        // ── Loop effects bus (GestureLooper) ──────────────────────────────────
        // Signal chain: FMSynth → _loopDelay → _loopReverb → Tone.Destination
        this._loopReverb = new Tone.Reverb({ decay: 4.0, wet: 0.35 });
        await this._loopReverb.ready;
        this._loopReverb.toDestination();

        this._loopDelay = new Tone.PingPongDelay({
            delayTime: '8n',
            feedback:  0.35,
            wet:       0.28,
        });
        this._loopDelay.connect(this._loopReverb);
    }

    // ── SpatialSynth compatibility ─────────────────────────────────────────────
    get synthInput() { return this._synthInput; }

    // ── Loop bus (GestureLooper synths connect here) ───────────────────────────
    /** Returns the Tone node that is the entry point for loop synths. */
    getLoopBus() { return this._loopDelay; }

    /** Set the wet amount on the loop PingPongDelay (0..1). */
    setLoopDelayWet(v) {
        try { if (this._loopDelay) this._loopDelay.wet.rampTo(Math.max(0, Math.min(1, v)), 0.1); }
        catch (_) {}
    }

    // ── Instruments ───────────────────────────────────────────────────────────

    /** 808-style kick at velocity 0..1 */
    triggerKick(vel = 1.0) {
        try {
            this._kick?.triggerAttackRelease('C1', '8n', undefined, Math.min(1, vel));
        } catch (_) {}
    }

    /** Trigger active kit sound */
    triggerKit(vel = 0.7) {
        try {
            const kit = this._kits[this._kitIndex];
            if (!kit) return;
            if (kit instanceof window.Tone.PluckSynth) {
                const notes = ['C3','D#3','F#3','G#3','A#3'];
                kit.triggerAttack(notes[Math.floor(Math.random() * notes.length)]);
            } else {
                kit.triggerAttackRelease('32n', undefined, vel);
            }
        } catch (_) {}
    }

    /** Cycle kit: hi-hat → metal → glitch */
    switchKit() {
        this._kitIndex = (this._kitIndex + 1) % this._kits.length;
        const el = document.getElementById('kr-status');
        if (el) el.textContent = 'KIT: ' + KIT_NAMES[this._kitIndex];
    }

    /**
     * Fire a NeuralComposer sequencer step.
     * @param {number} trackIdx  0-7
     * @param {string} note      Tone.js note e.g. 'C2'
     * @param {number} vel       0..1
     */
    triggerSequencerNote(trackIdx, note, vel = 0.85) {
        const Tone = window.Tone;
        if (!Tone) return;
        try {
            switch (trackIdx) {
                case 0: this.triggerKick(vel); break;
                case 1: this._kits[0]?.triggerAttackRelease('32n', undefined, vel * 0.6); break;
                case 2: this._kits[1]?.triggerAttackRelease('32n', undefined, vel * 0.7); break;
                case 3: this._kits[2]?.triggerAttack(note); break;
                case 4: {
                    const s = new Tone.Synth({
                        oscillator: { type: 'triangle' },
                        envelope: { attack: 0.01, decay: 0.12, sustain: 0.3, release: 0.4 },
                    }).toDestination();
                    s.volume.value = -10;
                    s.triggerAttackRelease(note, '8n', undefined, vel);
                    setTimeout(() => { try { s.dispose(); } catch (_) {} }, 1200);
                    break;
                }
                case 5: {
                    const s = new Tone.Synth({
                        oscillator: { type: 'square' },
                        envelope: { attack: 0.005, decay: 0.08, sustain: 0.1, release: 0.2 },
                    }).toDestination();
                    s.volume.value = -14;
                    s.triggerAttackRelease(note, '16n', undefined, vel * 0.7);
                    setTimeout(() => { try { s.dispose(); } catch (_) {} }, 700);
                    break;
                }
                case 6: {
                    const s = new Tone.FMSynth({
                        harmonicity: 3, modulationIndex: 10,
                        envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.1 },
                    }).toDestination();
                    s.volume.value = -12;
                    s.triggerAttackRelease(note, '8n', undefined, vel * 0.8);
                    setTimeout(() => { try { s.dispose(); } catch (_) {} }, 900);
                    break;
                }
                case 7: {
                    const s = new Tone.Synth({
                        oscillator: { type: 'sawtooth' },
                        envelope: { attack: 0.01, decay: 0.3, sustain: 0.5, release: 1.2 },
                    }).connect(this._reverb).toDestination();
                    s.volume.value = -18;
                    s.triggerAttackRelease(note, '4n', undefined, vel * 0.6);
                    setTimeout(() => { try { s.dispose(); } catch (_) {} }, 2500);
                    break;
                }
            }
        } catch (_) {}
    }

    // ── Continuous controls ───────────────────────────────────────────────────

    setDronePitch(x) {
        try {
            const idx  = Math.round(x * (DRONE_NOTES.length - 1));
            const note = DRONE_NOTES[Math.max(0, Math.min(DRONE_NOTES.length - 1, idx))];
            this._drone?.setNote(note);
        } catch (_) {}
    }

    setFilterCutoff(y) {
        if (!this._autoFilter) return;
        try { this._autoFilter.baseFrequency = 80 + y * 4000; } catch (_) {}
    }

    setAutoFilterFreq(y) { this.setFilterCutoff(y); }

    // ── HUD sliders ───────────────────────────────────────────────────────────

    setVolume(v) {
        if (!this._masterGain) return;
        this._masterGain.gain.setTargetAtTime(
            Math.max(0.001, v) * 0.85,
            this.ctx.currentTime,
            0.06
        );
    }

    setReverbMix(v) {
        try {
            if (this._reverb) this._reverb.wet.rampTo(v * 0.7, 0.1);
            if (this._autoFilter) this._autoFilter.frequency.value = 0.2 + v * 4;
        } catch (_) {}
    }

    setManualFilter(v) {
        if (!this._autoFilter) return;
        try { this._autoFilter.baseFrequency = 80 + v * 7920; } catch (_) {}
    }

    // ── Recording ─────────────────────────────────────────────────────────────
    getRecordingDest() {
        if (!this.ctx) return null;
        this._recDest = this.ctx.createMediaStreamDestination();
        this._hardLimiter.connect(this._recDest);
        return this._recDest;
    }

    releaseRecordingDest(dest) {
        try { this._hardLimiter.disconnect(dest); } catch (_) {}
        this._recDest = null;
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────
    dispose() {
        try {
            this._drone?.triggerRelease();
            [this._kick, this._drone, this._autoFilter, this._reverb,
             this._loopDelay, this._loopReverb, ...this._kits]
                .forEach(n => { try { n?.dispose(); } catch (_) {} });
            this._synthInput?.disconnect();
            this._toneOut?.disconnect();
            this._masterGain?.disconnect();
            this._hardLimiter?.disconnect();
            // Restore Tone destination to ctx.destination
            try {
                window.Tone?.getDestination().connect(
                    new window.Tone.ToneAudioNode({ context: window.Tone.getContext() })
                );
            } catch (_) {}
        } catch (_) {}
    }
}
