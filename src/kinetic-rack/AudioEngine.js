/**
 * AudioEngine.js — Tone.js audio graph
 *
 * Requires: window.Tone  (Tone.js UMD, loaded via <script> tag before this module)
 *
 * Instruments:
 *   MembraneSynth  — heavy kick  (right-hand index velocity → triggerKick)
 *   FMSynth        — deep drone  (left-hand XY → setDronePitch / setAutoFilterFreq)
 *   AutoFilter LFO — wraps drone
 *   Kit synths × 3 — glitch / hi-hat / metal  (pinch → switchKit / triggerKit)
 *
 * TetherVerlet compatibility:
 *   .ctx        → raw AudioContext (from Tone.js)
 *   .synthInput → native GainNode that routes into the final chain
 */

const KIT_NAMES   = ['HI-HAT', 'METAL', 'GLITCH'];
// Drone pitch table mapped to left-hand X position
const DRONE_NOTES = ['A1','C2','D2','F2','G2','A2','C3','D3','F3','G3','A3'];

export class AudioEngine {
    constructor() {
        this.ctx          = null;

        // Tone.js nodes
        this._masterVol   = null;
        this._kick        = null;
        this._drone       = null;
        this._autoFilter  = null;
        this._kits        = [];
        this._kitIndex    = 0;

        // Native Web Audio nodes (for TetherVerlet compatibility + recording)
        this._synthInput  = null;   // TetherVerlet connects here
        this._synthLimiter = null;
        this._recDest     = null;
    }

    async init() {
        const Tone = window.Tone;
        if (!Tone) throw new Error('Tone.js not loaded — add <script src="tone.js"> before KineticRack');

        await Tone.start();
        this.ctx = Tone.getContext().rawContext;

        // ── Master volume (Tone.js chain → ctx.destination) ───────────────────
        this._masterVol = new Tone.Volume(-6).toDestination();

        // ── Kick: MembraneSynth ───────────────────────────────────────────────
        this._kick = new Tone.MembraneSynth({
            pitchDecay:  0.07,
            octaves:     5,
            oscillator:  { type: 'sine' },
            envelope: {
                attack:  0.001,
                decay:   0.4,
                sustain: 0,
                release: 0.14,
            },
        }).connect(this._masterVol);
        this._kick.volume.value = -4;

        // ── AutoFilter (drone → LFO → output) ────────────────────────────────
        this._autoFilter = new Tone.AutoFilter({
            frequency:     0.5,
            baseFrequency: 200,
            octaves:       3.5,
            filter: { type: 'lowpass', rolloff: -12 },
        }).connect(this._masterVol);
        this._autoFilter.start();

        // ── Drone: FMSynth ────────────────────────────────────────────────────
        this._drone = new Tone.FMSynth({
            harmonicity:     0.5,
            modulationIndex: 3,
            oscillator:      { type: 'sawtooth' },
            envelope: {
                attack:  0.8,
                decay:   0.2,
                sustain: 0.85,
                release: 2.5,
            },
            modulation:         { type: 'sine' },
            modulationEnvelope: { attack: 0.5, decay: 0, sustain: 1, release: 2 },
        }).connect(this._autoFilter);
        this._drone.volume.value = -14;
        this._drone.triggerAttack('A1');

        // ── Kit synths (3 kits, cycled by pinch) ─────────────────────────────
        // Kit 0: closed hi-hat
        const hihat = new Tone.NoiseSynth({
            noise:    { type: 'white' },
            envelope: { attack: 0.001, decay: 0.065, sustain: 0, release: 0.01 },
        }).connect(this._masterVol);
        hihat.volume.value = -8;

        // Kit 1: metallic / industrial cymbal
        const metal = new Tone.MetalSynth({
            frequency:      400,
            envelope:       { attack: 0.001, decay: 0.14, release: 0.02 },
            harmonicity:    5.1,
            modulationIndex: 32,
            resonance:      4200,
            octaves:        1.5,
        }).connect(this._masterVol);
        metal.volume.value = -12;

        // Kit 2: pluck / glitch
        const glitch = new Tone.PluckSynth({
            attackNoise: 2,
            dampening:   3800,
            resonance:   0.98,
        }).connect(this._masterVol);
        glitch.volume.value = -6;

        this._kits = [hihat, metal, glitch];
        this._kitIndex = 0;

        // ── Native Web Audio path for TetherVerlet ────────────────────────────
        // Tether connects its oscillators to this._synthInput.
        // They flow: synthInput → synthLimiter → ctx.destination
        // (separate from Tone.js path to avoid double-routing)
        this._synthLimiter = this.ctx.createDynamicsCompressor();
        this._synthLimiter.threshold.value = -3;
        this._synthLimiter.knee.value      = 0;
        this._synthLimiter.ratio.value     = 20;
        this._synthLimiter.attack.value    = 0.005;
        this._synthLimiter.release.value   = 0.05;
        this._synthLimiter.connect(this.ctx.destination);

        this._synthInput = this.ctx.createGain();
        this._synthInput.gain.value = 0.5;
        this._synthInput.connect(this._synthLimiter);
    }

    // ── TetherVerlet compatibility ────────────────────────────────────────────
    /** Native GainNode — TetherVerlet connects its oscs here. */
    get synthInput() { return this._synthInput; }

    // ── Instruments ───────────────────────────────────────────────────────────

    /** Trigger kick drum at velocity 0..1. */
    triggerKick(vel = 1.0) {
        try {
            this._kick?.triggerAttackRelease('C1', '8n', undefined, Math.min(1, vel));
        } catch (_) {}
    }

    /** Trigger the currently selected kit sound at velocity 0..1. */
    triggerKit(vel = 0.7) {
        try {
            const kit = this._kits[this._kitIndex];
            if (!kit) return;
            if (kit instanceof window.Tone.PluckSynth) {
                const notes = ['C3', 'D#3', 'F#3', 'G#3', 'A#3'];
                kit.triggerAttack(notes[Math.floor(Math.random() * notes.length)]);
            } else if (kit instanceof window.Tone.NoiseSynth) {
                kit.triggerAttackRelease('32n', undefined, vel);
            } else {
                kit.triggerAttackRelease('32n', undefined, vel);
            }
        } catch (_) {}
    }

    /** Cycle to the next kit (hi-hat → metal → glitch → …). */
    switchKit() {
        this._kitIndex = (this._kitIndex + 1) % this._kits.length;
        const el = document.getElementById('kr-status');
        if (el) el.textContent = 'KIT: ' + KIT_NAMES[this._kitIndex];
    }

    // ── Left-hand continuous control ──────────────────────────────────────────

    /**
     * Set drone pitch from left-hand X position.
     * @param {number} x  normalised 0..1
     */
    setDronePitch(x) {
        try {
            const idx  = Math.round(x * (DRONE_NOTES.length - 1));
            const note = DRONE_NOTES[Math.max(0, Math.min(DRONE_NOTES.length - 1, idx))];
            this._drone?.setNote(note);
        } catch (_) {}
    }

    /**
     * Set AutoFilter base frequency from left-hand Y position.
     * @param {number} y  normalised 0..1  (hand high = 1)
     */
    setAutoFilterFreq(y) {
        if (!this._autoFilter) return;
        try {
            this._autoFilter.baseFrequency = 80 + y * 4000;
        } catch (_) {}
    }

    // ── HUD slider controls ───────────────────────────────────────────────────

    /** Master volume 0..1. */
    setVolume(v) {
        if (!this._masterVol) return;
        try {
            this._masterVol.volume.rampTo(
                window.Tone.gainToDb(Math.max(0.001, v)),
                0.06
            );
        } catch (_) {}
    }

    /** Reverb mix 0..1 — controls AutoFilter LFO rate as a proxy effect. */
    setReverbMix(v) {
        if (!this._autoFilter) return;
        try {
            this._autoFilter.frequency.value = 0.2 + v * 4;
        } catch (_) {}
    }

    /** Manual filter cutoff from slider 0..1. */
    setManualFilter(v) {
        if (!this._autoFilter) return;
        try {
            this._autoFilter.baseFrequency = 80 + v * 7920;
        } catch (_) {}
    }

    // ── Recording helper ──────────────────────────────────────────────────────
    /** Returns a MediaStreamAudioDestinationNode tapping the native synth path. */
    getRecordingDest() {
        if (!this.ctx) return null;
        this._recDest = this.ctx.createMediaStreamDestination();
        this._synthLimiter?.connect(this._recDest);
        return this._recDest;
    }

    releaseRecordingDest(dest) {
        try { this._synthLimiter?.disconnect(dest); } catch (_) {}
        this._recDest = null;
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────
    dispose() {
        try {
            this._drone?.triggerRelease();
            this._kick?.dispose();
            this._drone?.dispose();
            this._autoFilter?.dispose();
            this._kits.forEach(k => k.dispose());
            this._masterVol?.dispose();
            this._synthInput?.disconnect();
            this._synthLimiter?.disconnect();
        } catch (_) {}
    }
}
